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
        triggerRunSimulation();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedSlots = resolveEffectiveDofSlots(config);
  const toggleDofSlot = (slot: DistillDofSlotId) => {
    if (selectedSlots.includes(slot)) {
      onChangeConfig({ activeDofSlots: selectedSlots.filter((s) => s !== slot) });
    } else if (selectedSlots.length < 2) {
      onChangeConfig({ activeDofSlots: [...selectedSlots, slot] });
    }
  };

  const calcMode: DistillCalcMode = config.columnCalcMode ?? 'rigorous_mesh';
  const isDualQualityMode =
    calcMode === 'rigorous_mesh' &&
    selectedSlots.includes('top_spec') &&
    selectedSlots.includes('bot_spec');
  const isAutoStageActive =
    calcMode === 'design_stages' ||
    (isDualQualityMode && config.autoOptimizeStagesOnDualSpec !== false);
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

  const spec1: DistillDesignSpec = { ...DEFAULT_SPEC1, ...(config.spec1 ?? {}) };
  const spec2: DistillDesignSpec = { ...DEFAULT_SPEC2, ...(config.spec2 ?? {}) };

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
    return {
      id: 'SC-1',
      enabled,
      label: '사이드컷 S',
      stage: Math.max(2, Math.min(rawTotal - 2, Math.round(rawTotal * 0.3))),
      autoOptimizeStage: false,
      phase: 'liquid',
      specType: 's_over_f_mass',
      specValue: 0.15,
      targetComp: activeComps[1] ?? activeComps[0],
    };
  };

  const sideCutCfg: DistillSideCutConfig = config.sideCut
    ? { ...makeDefaultSideCut(Boolean(config.sideCut.enabled)), ...config.sideCut }
    : makeDefaultSideCut(false);
  const sideCutEnabled = Boolean(config.sideCut?.enabled);

  const toggleSideCutEnabled = () => {
    if (!config.sideCut) {
      onChangeConfig({ sideCut: makeDefaultSideCut(true) });
      return;
    }
    onChangeConfig({ sideCut: { ...sideCutCfg, enabled: !sideCutEnabled } });
  };

  const updateSideCut = (patch: Partial<DistillSideCutConfig>) => {
    const base = config.sideCut ? sideCutCfg : makeDefaultSideCut(true);
    onChangeConfig({ sideCut: { ...base, ...patch } });
  };

  const renderSideCutCard = (mode: 'rigorous_specs' | 'design_stages') => {
    const maxSideStage = Math.max(2, N - 1);
    const clampedSideStage = Math.max(2, Math.min(maxSideStage, Math.round(sideCutCfg.stage || 2)));
    const specMeta = SIDECUT_SPEC_META[sideCutCfg.specType] ?? SIDECUT_SPEC_META.s_over_f_mass;
    const showTargetComp =
      Boolean(sideCutCfg.autoOptimizeStage) ||
      sideCutCfg.specType === 'purity_wt_pct' ||
      sideCutCfg.specType === 'recovery_pct' ||
      sideCutCfg.specType === 'impurity_ppm';
    const scCompOptions =
      sideCutCfg.targetComp && !activeComps.includes(sideCutCfg.targetComp)
        ? [sideCutCfg.targetComp, ...activeComps]
        : activeComps;
    const effectiveTargetComp = sideCutCfg.targetComp ?? scCompOptions[0] ?? 'H2O';
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
              {mode === 'rigorous_specs'
                ? '⑤ 사이드컷 (측류 인출 · Side-Cut) 변수 설정 [선택 자유도 +1]'
                : '③ 사이드컷(측류) 동시 인출 옵션 (선택)'}
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
            {/* 공정 실무 빠른 프리셋 스트립 (정밀모사 탭 ①) */}
            {mode === 'rigorous_specs' && (
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
                      const sortedByBp = [...activeComps].sort(
                        (a, b) => (COMP_CATALOG_META[a]?.tbC ?? 100) - (COMP_CATALOG_META[b]?.tbC ?? 100)
                      );
                      const midComp =
                        sortedByBp.length >= 3
                          ? sortedByBp[Math.floor(sortedByBp.length / 2)]
                          : (activeComps[1] ?? activeComps[0]);
                      const keepCurrent =
                        sideCutCfg.targetComp &&
                        sortedByBp.length >= 3 &&
                        sideCutCfg.targetComp !== sortedByBp[0] &&
                        sideCutCfg.targetComp !== sortedByBp[sortedByBp.length - 1];
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
            )}

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
                  syncKey={`${unitTag}-scstage-${mode}-${sideCutCfg.autoOptimizeStage ? 'auto' : 'man'}`}
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
                  onEnterRun={triggerRunSimulation}
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
                    {scCompOptions.map((ck) => (
                      <option key={ck} value={ck}>
                        {formatCompOption(ck)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={labelStyle}>목표 수치 ({specMeta.unit})</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-scval-${mode}-${sideCutCfg.specType}`}
                  step={specMeta.step}
                  min={specMeta.min}
                  max={specMeta.max}
                  value={sideCutCfg.specValue}
                  onValueChange={(v) => updateSideCut({ specValue: v })}
                  onEnterRun={triggerRunSimulation}
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
                          if (contextMode === 'design_stages') {
                            onChangeConfig({
                              columnCalcMode: 'rigorous_mesh',
                              activeDofSlots: ['rr', 'split'],
                              totalStages: c.stagesN,
                              feedStage: c.feedStage,
                              topSpecType: 'reflux_ratio',
                              topSpecValue: Number(c.refluxRatio.toFixed(3)),
                              splitSpecType: 'd_over_f_mass',
                              splitSpecValue: Number(c.dOverFMass.toFixed(4)),
                              ...syncedSideCut,
                            });
                          } else {
                            onChangeConfig({
                              totalStages: c.stagesN,
                              feedStage: c.feedStage,
                              topSpecType: 'reflux_ratio',
                              topSpecValue: Number(c.refluxRatio.toFixed(3)),
                              splitSpecType: 'd_over_f_mass',
                              splitSpecValue: Number(c.dOverFMass.toFixed(4)),
                              autoOptimizeStagesOnDualSpec: false,
                              ...syncedSideCut,
                            });
                          }
                          window.setTimeout(() => triggerRunSimulation(), 30);
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
                    disabled={isRunningFeedback}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 7,
                      border: '1px solid #60A5FA',
                      background: isSimDirty ? '#D97706' : '#2563EB',
                      color: '#FFFFFF',
                      fontSize: 11.2,
                      fontWeight: 900,
                      cursor: isRunningFeedback ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isRunningFeedback ? '⏳ 계산 중...' : '▶ RUN 실행'}
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
                disabled={isRunningFeedback}
                style={{
                  padding: '8px 15px',
                  borderRadius: 7,
                  border: isRunningFeedback
                    ? '1.5px solid #93C5FD'
                    : isSimDirty
                    ? '1.5px solid #FDE047'
                    : '1px solid #60A5FA',
                  background: isRunningFeedback
                    ? '#1D4ED8'
                    : isSimDirty
                    ? '#D97706'
                    : '#2563EB',
                  color: '#FFFFFF',
                  fontSize: 11.8,
                  fontWeight: 900,
                  cursor: isRunningFeedback ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: isSimDirty
                    ? '0 0 0 3px rgba(245,158,11,0.30)'
                    : '0 2px 6px rgba(15,23,42,0.25)',
                }}
              >
                {isRunningFeedback
                  ? '⏳ 수렴 계산 중...'
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
            {/* ── 상단 시뮬레이션 계산방식(2-Mode) 선택 스위처 (통일된 슬레이트·네이비 톤) ── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                padding: '9px 14px',
                background: '#E2E8F0',
                borderBottom: '1px solid #CBD5E1',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({
                    columnCalcMode: 'design_stages',
                    designRefluxMode: config.designRefluxMode ?? 'auto_opt',
                  })
                }
                style={{
                  padding: '7px 10px',
                  borderRadius: 7,
                  border: calcMode === 'design_stages' ? '2px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: calcMode === 'design_stages' ? '#1E3A8A' : '#FFFFFF',
                  color: calcMode === 'design_stages' ? '#FFFFFF' : '#1E293B',
                  fontSize: 11.5,
                  fontWeight: 900,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>① 목표순도 → 단수·유량 자동설계</div>
                <div style={{ fontSize: 9.5, fontWeight: 600, opacity: 0.9, marginTop: 1 }}>
                  목표 순도·회수율 기반 단수·유량 자동 산출
                </div>
              </button>
              <button
                type="button"
                onClick={() => onChangeConfig({ columnCalcMode: 'rigorous_mesh' })}
                style={{
                  padding: '7px 10px',
                  borderRadius: 7,
                  border: calcMode === 'rigorous_mesh' ? '2px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: calcMode === 'rigorous_mesh' ? '#1E3A8A' : '#FFFFFF',
                  color: calcMode === 'rigorous_mesh' ? '#FFFFFF' : '#1E293B',
                  fontSize: 11.5,
                  fontWeight: 900,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>② 단수 지정 → 다단 정밀모사</div>
                <div style={{ fontSize: 9.5, fontWeight: 600, opacity: 0.9, marginTop: 1 }}>
                  고정 단수(N) 정밀 수렴 (자유도 2/2)
                </div>
              </button>
            </div>

            {/* 좌측 3개 세그먼트 탭 (정밀모사 모드에서만 노출) */}
            {calcMode === 'rigorous_mesh' && (
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
                    { id: 'specs', label: `① 운전·품질 조건 (${selectedSlots.length}/2${config.sideCut?.enabled ? '+측류' : ''})` },
                    { id: 'tower', label: `② 탑 단수·피드단 구성 (N=${N}단)` },
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
            )}

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
              {/* ── 상단 통합 [시뮬레이션 실행 상태 · 수렴 판정 · 오류 원인 & 원클릭 수정] 패널 ── */}
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
                if (isSimDirty) {
                  return (
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
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid #B45309',
                            background: '#D97706',
                            color: '#FFFFFF',
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ▶ RUN 실행
                        </button>
                      )}
                    </div>
                  );
                }
                if (!diag) return null;

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
                    {(diag.level !== 'ok' || diag.remedies.length > 0) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                        {diag.level !== 'ok' && (
                          <button
                            type="button"
                            onClick={runAiAutoFixDistill}
                            disabled={isAiBusy}
                            style={{
                              padding: '5px 11px',
                              borderRadius: 6,
                              border: '1px solid #7C3AED',
                              background: '#7C3AED',
                              color: '#FFFFFF',
                              fontSize: 10.8,
                              fontWeight: 900,
                              cursor: isAiBusy ? 'wait' : 'pointer',
                            }}
                          >
                            {isAiBusy ? (aiStepLabel || '⏳ AI 해결 탐색 중...') : '✨ AI 자동 해결'}
                          </button>
                        )}
                        {diag.remedies.map((rem, ri) => (
                          <button
                            key={ri}
                            type="button"
                            onClick={() => {
                              onChangeConfig(rem.patch);
                              window.setTimeout(() => triggerRunSimulation(), 30);
                            }}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: `1px solid ${boxBd}`,
                              background: '#FFFFFF',
                              color: titleCol,
                              fontSize: 10.8,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            🔧 적용 후 재실행: {rem.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── 모드 A: 목표순도 기반 단수·유량 자동설계 통합 화면 ── */}
              {calcMode === 'design_stages' && (() => {
                const sortedByBp = [...activeComps].sort(
                  (a, b) => (COMP_CATALOG_META[a]?.tbC ?? 100) - (COMP_CATALOG_META[b]?.tbC ?? 100)
                );
                const defaultLk = sortedByBp[0] ?? 'HCl';
                const defaultHk = sortedByBp.find((c) => c !== defaultLk) ?? sortedByBp[0] ?? 'H2O';
                const lkSel: SimCompKey = config.designLkComp ?? result?.shortcutDesign?.lkComp ?? defaultLk;
                const hkSel: SimCompKey =
                  config.designHkComp ??
                  result?.shortcutDesign?.hkComp ??
                  (defaultHk !== lkSel ? defaultHk : activeComps.find((c) => c !== lkSel) ?? activeComps[0] ?? 'H2O');
                const topBasis: DistillEndpointBasis = config.designTopBasis ?? 'purity_wt_pct';
                const botBasis: DistillEndpointBasis = config.designBotBasis ?? 'purity_wt_pct';
                const lkFormula = COMP_META[lkSel]?.formula ?? lkSel;
                const hkFormula = COMP_META[hkSel]?.formula ?? hkSel;
                const sameKeyError = lkSel === hkSel;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {/* 섹션 1: 필수 입력 조건 (2개 명확 그룹화 + 완료 여부 즉시 표시) */}
                    <div
                      style={{
                        padding: '11px 12px',
                        borderRadius: 9,
                        background: '#FFFFFF',
                        border: sameKeyError ? '1.5px solid #DC2626' : '1.5px solid #CBD5E1',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                          paddingBottom: 8,
                          marginBottom: 9,
                          borderBottom: '1px solid #E2E8F0',
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                          필수 입력 2개 (탑정 · 탑저)
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 900,
                            padding: '2px 9px',
                            borderRadius: 999,
                            background: sameKeyError ? '#FEF2F2' : '#ECFDF5',
                            color: sameKeyError ? '#991B1B' : '#065F46',
                            border: sameKeyError ? '1px solid #FCA5A5' : '1px solid #A7F3D0',
                          }}
                        >
                          {sameKeyError
                            ? '✕ 상부(LK)와 하부(HK)를 서로 다르게 선택하세요'
                            : '✓ 2/2 입력 완료'}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 9 }}>
                        {/* 탑정 조건 카드 (무채색 슬레이트 + 단일 스틸블루 포인트) */}
                        <div style={{ ...cardStyle, border: '1px solid #CBD5E1', background: '#F8FAFC' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>① 탑정(D) 목표 조건</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#334155', background: '#E2E8F0', padding: '1px 6px', borderRadius: 999 }}>
                              필수 1/2 ✓
                            </span>
                          </div>
                          <label style={labelStyle}>탑정 주 회수 경질성분 (LK)</label>
                          <select
                            value={lkSel}
                            onChange={(e) => onChangeConfig({ designLkComp: e.target.value as SimCompKey })}
                            style={selectBaseStyle}
                          >
                            {SIM_COMPS.map((ck) => (
                              <option key={ck} value={ck}>
                                {formatCompOption(ck)}
                              </option>
                            ))}
                          </select>

                          <label style={{ ...labelStyle, marginTop: 8 }}>지정할 기준 선택 (택 1)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 7 }}>
                            {(
                              [
                                { id: 'purity_wt_pct', lbl: '성분농도 wt%' },
                                { id: 'impurity_wt_ppm', lbl: '불순물 ppm' },
                                { id: 'recovery_pct', lbl: '회수율 %' },
                              ] as { id: DistillEndpointBasis; lbl: string }[]
                            ).map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => onChangeConfig({ designTopBasis: b.id })}
                                style={{
                                  padding: '4px 3px',
                                  borderRadius: 5,
                                  border: topBasis === b.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                  background: topBasis === b.id ? '#EFF6FF' : '#FFFFFF',
                                  color: topBasis === b.id ? '#1D4ED8' : '#475569',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {b.lbl}
                              </button>
                            ))}
                          </div>

                          {topBasis === 'purity_wt_pct' && (
                            <>
                              <label style={labelStyle}>
                                탑정(D) 내 [{lkFormula}] 목표 농도 (wt%)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dlk`}
                                min={0.01}
                                max={99.9999}
                                step={0.001}
                                value={config.designTopPurityWtPct ?? 99.5}
                                onValueChange={(v) => onChangeConfig({ designTopPurityWtPct: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                            </>
                          )}
                          {topBasis === 'impurity_wt_ppm' && (
                            <>
                              <label style={labelStyle}>
                                탑정(D) 내 [{hkFormula}] 불순물 허용 농도 (wt ppm)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dlkppm`}
                                min={1}
                                max={200000}
                                step={50}
                                value={config.designTopImpurityPpm ?? 500}
                                onValueChange={(v) => onChangeConfig({ designTopImpurityPpm: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                              <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3 }}>
                                환산 [{lkFormula}] 순도 ≈ {(100 - (config.designTopImpurityPpm ?? 500) / 10000).toFixed(3)} wt%
                              </div>
                            </>
                          )}
                          {topBasis === 'recovery_pct' && (
                            <>
                              <label style={labelStyle}>
                                원료 대비 탑정(D) [{lkFormula}] 목표 회수율 (%)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dlkrec`}
                                min={50}
                                max={99.9999}
                                step={0.001}
                                value={config.designTopRecoveryPct ?? 99.2}
                                onValueChange={(v) => onChangeConfig({ designTopRecoveryPct: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                            </>
                          )}
                        </div>

                        {/* 탑저 조건 카드 (오류처럼 보이던 적색 테두리/배경 완전 제거 — 상부와 동일한 클린 슬레이트 톤) */}
                        <div style={{ ...cardStyle, border: '1px solid #CBD5E1', background: '#F8FAFC' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>② 탑저(B) 목표 조건</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#334155', background: '#E2E8F0', padding: '1px 6px', borderRadius: 999 }}>
                              필수 2/2 ✓
                            </span>
                          </div>
                          <label style={labelStyle}>탑저 주 관출 중질성분 (HK)</label>
                          <select
                            value={hkSel}
                            onChange={(e) => onChangeConfig({ designHkComp: e.target.value as SimCompKey })}
                            style={selectBaseStyle}
                          >
                            {SIM_COMPS.map((ck) => (
                              <option key={ck} value={ck}>
                                {formatCompOption(ck)}
                              </option>
                            ))}
                          </select>

                          <label style={{ ...labelStyle, marginTop: 8 }}>지정할 기준 선택 (택 1)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 7 }}>
                            {(
                              [
                                { id: 'purity_wt_pct', lbl: '성분농도 wt%' },
                                { id: 'impurity_wt_ppm', lbl: '불순물 ppm' },
                                { id: 'recovery_pct', lbl: '회수율 %' },
                              ] as { id: DistillEndpointBasis; lbl: string }[]
                            ).map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => onChangeConfig({ designBotBasis: b.id })}
                                style={{
                                  padding: '4px 3px',
                                  borderRadius: 5,
                                  border: botBasis === b.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                  background: botBasis === b.id ? '#EFF6FF' : '#FFFFFF',
                                  color: botBasis === b.id ? '#1D4ED8' : '#475569',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {b.lbl}
                              </button>
                            ))}
                          </div>

                          {botBasis === 'purity_wt_pct' && (
                            <>
                              <label style={labelStyle}>
                                탑저(B) 내 [{hkFormula}] 목표 농도 (wt%)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dhk`}
                                min={0.01}
                                max={99.9999}
                                step={0.001}
                                value={config.designBotPurityWtPct ?? 99.0}
                                onValueChange={(v) => onChangeConfig({ designBotPurityWtPct: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                              <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3 }}>
                                ※ [{hkFormula}] 회수율(%)은 별도 입력 없이 자동 산출됩니다.
                              </div>
                              {(() => {
                                const botTargetVal = config.designBotPurityWtPct ?? 99.0;
                                const feedHkTotal = feeds.reduce((s, f) => s + (f.flowsKgH[hkSel] || 0), 0);
                                const feedLkTotal = feeds.reduce((s, f) => s + (f.flowsKgH[lkSel] || 0), 0);
                                const heavyList = activeComps.filter(
                                  (c) => c !== lkSel && c !== hkSel && feeds.reduce((s, f) => s + (f.flowsKgH[c] || 0), 0) > 1e-4
                                );
                                // HK보다 무거운 성분 또는 공비/잔류 성분 체크 (이미 결과에 미달 진단이 있거나, 회수율 연동 잔류 LK 초과 시 안내)
                                const topRecVal = topBasis === 'recovery_pct' ? (config.designTopRecoveryPct ?? 99.2) : 100;
                                const lkSlipEstKg = topBasis === 'recovery_pct' ? feedLkTotal * Math.max(0, 1 - topRecVal / 100) : 0;
                                const maxByLkSlipPct =
                                  feedHkTotal > 1e-6 && lkSlipEstKg > 1e-6
                                    ? (feedHkTotal / (feedHkTotal + lkSlipEstKg)) * 100
                                    : 100;
                                if (topBasis === 'recovery_pct' && botTargetVal > maxByLkSlipPct + 0.0005) {
                                  return (
                                    <div
                                      style={{
                                        marginTop: 5,
                                        padding: '5px 7px',
                                        borderRadius: 6,
                                        background: '#FFFBEB',
                                        border: '1px solid #FDE68A',
                                        fontSize: 10,
                                        color: '#92400E',
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      <b>물질수지 한계:</b> 탑정 [{lkFormula}] 회수율 {topRecVal}% 기준 시 미회수 {lkFormula}({lkSlipEstKg.toFixed(4)} kg/h)가 탑저로 남아 탑저 [{hkFormula}] 최대 농도가 <b>{maxByLkSlipPct.toFixed(4)}%</b>로 제한됩니다. 탑정 회수율을 상향하거나 탑저 기준을 <b>회수율(%)</b>로 변경하세요.
                                    </div>
                                  );
                                }
                                if (heavyList.length > 0 && result?.diagnostics?.level === 'warning') {
                                  return (
                                    <div
                                      style={{
                                        marginTop: 5,
                                        padding: '5px 7px',
                                        borderRadius: 6,
                                        background: '#FFFBEB',
                                        border: '1px solid #FDE68A',
                                        fontSize: 10,
                                        color: '#92400E',
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      <b>물질수지 안내:</b> 원료 내 비주성분({heavyList.join('·')}) 잔류 여부에 따라 순도 상한이 제한될 수 있습니다. 하단 진단 가이드의 수정안을 확인하세요.
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </>
                          )}
                          {botBasis === 'impurity_wt_ppm' && (
                            <>
                              <label style={labelStyle}>
                                탑저(B) 내 [{lkFormula}] 불순물 허용 농도 (wt ppm)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dhkppm`}
                                min={1}
                                max={200000}
                                step={50}
                                value={config.designBotImpurityPpm ?? 500}
                                onValueChange={(v) => onChangeConfig({ designBotImpurityPpm: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                              <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3 }}>
                                환산 [{hkFormula}] 순도 ≈ {(100 - (config.designBotImpurityPpm ?? 500) / 10000).toFixed(3)} wt%
                              </div>
                            </>
                          )}
                          {botBasis === 'recovery_pct' && (
                            <>
                              <label style={labelStyle}>
                                원료 대비 탑저(B) [{hkFormula}] 목표 회수율 (%)
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-dhkrec`}
                                min={50}
                                max={99.9999}
                                step={0.001}
                                value={config.designBotRecoveryPct ?? 99.2}
                                onValueChange={(v) => onChangeConfig({ designBotRecoveryPct: v })}
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {renderSideCutCard('design_stages')}

                    {/* 섹션 2: 운전 설정 */}
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 9,
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>
                          운전 설정 (환류 · 압력 · 열역학)
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.15fr 0.85fr', gap: 9 }}>
                        <div style={{ ...cardStyle, padding: '9px 11px' }}>
                          <label style={labelStyle}>환류비(Reflux) 기준</label>
                          {(() => {
                            const effRMode: DistillRefluxDesignMode =
                              config.designRefluxMode ??
                              (typeof config.designRefluxMult === 'number' ? 'r_mult' : 'auto_opt');
                            return (
                              <>
                                <select
                                  value={effRMode}
                                  onChange={(e) =>
                                    onChangeConfig({
                                      designRefluxMode: e.target.value as DistillRefluxDesignMode,
                                    })
                                  }
                                  style={selectBaseStyle}
                                >
                                  <option value="auto_opt">
                                    ✨ AI 다중후보 자동최적화 (단수·피드단·환류비·유량 TAC 최소 선정)
                                  </option>
                                  <option value="r_mult">최소환류비 배수 지정 (R = 배수 × R_min)</option>
                                  <option value="fixed_rr">운전 환류비 (RR = L₀/D) 직접 입력</option>
                                </select>
                                <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: 6, marginTop: 8 }}>
                                  <div>
                                    {effRMode === 'auto_opt' ? (
                                      <>
                                        <label style={labelStyle}>AI 탐색 범위</label>
                                        <div
                                          style={{
                                            ...inputBaseStyle,
                                            background: '#ECFDF5',
                                            borderColor: '#6EE7B7',
                                            color: '#065F46',
                                            display: 'flex',
                                            alignItems: 'center',
                                            fontSize: 10.5,
                                            fontFamily: 'sans-serif',
                                          }}
                                        >
                                          1.15~1.80×R_min TAC 최소
                                        </div>
                                      </>
                                    ) : effRMode === 'r_mult' ? (
                                      <>
                                        <label style={labelStyle}>R / R_min 배수</label>
                                        <BufferedNumberInput
                                          syncKey={`${unitTag}-rmult`}
                                          min={1.05}
                                          max={5.0}
                                          step={0.05}
                                          value={config.designRefluxMult ?? 1.25}
                                          onValueChange={(v) => onChangeConfig({ designRefluxMult: v })}
                                          onEnterRun={triggerRunSimulation}
                                          style={inputBaseStyle}
                                        />
                                      </>
                                    ) : (
                                      <>
                                        <label style={labelStyle}>직접 지정 RR</label>
                                        <BufferedNumberInput
                                          syncKey={`${unitTag}-drr`}
                                          min={0.15}
                                          max={75}
                                          step={0.1}
                                          value={config.designFixedRR ?? config.topSpecValue ?? 2.8}
                                          onValueChange={(v) => onChangeConfig({ designFixedRR: v, topSpecValue: v })}
                                          onEnterRun={triggerRunSimulation}
                                          style={inputBaseStyle}
                                        />
                                      </>
                                    )}
                                  </div>
                                  <div>
                                    <label style={labelStyle}>탑정 응축기 형식</label>
                                    <select
                                      value={condenserType}
                                      onChange={(e) =>
                                        onChangeConfig({ condenserType: e.target.value as DistillCondenserType })
                                      }
                                      style={selectBaseStyle}
                                    >
                                      <option value="total">전응축기 (액상 유출)</option>
                                      <option value="decanter_ech">공비 유수분리 디캔터</option>
                                      <option value="partial">부분응축기 (기상 유출)</option>
                                    </select>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        <div style={{ ...cardStyle, padding: '9px 11px' }}>
                          <label style={labelStyle}>탑정 운전압력 (kgf/cm²G)</label>
                          <BufferedNumberInput
                            syncKey={`${unitTag}-dpress`}
                            min={-0.99}
                            max={35}
                            step={0.05}
                            value={topPress}
                            onValueChange={(v) => onChangeConfig({ topPressKgcm2g: v })}
                            onEnterRun={triggerRunSimulation}
                            style={inputBaseStyle}
                          />
                          <label style={{ ...labelStyle, marginTop: 8 }}>단효율 (%) / 열역학</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 6 }}>
                            <BufferedNumberInput
                              syncKey={`${unitTag}-deff`}
                              min={25}
                              max={100}
                              step={5}
                              value={murphreeEff}
                              onValueChange={(v) => onChangeConfig({ murphreeEffPct: v })}
                              onEnterRun={triggerRunSimulation}
                              style={inputBaseStyle}
                            />
                            <select
                              value={thermoModel}
                              onChange={(e) => onChangeConfig({ thermoModel: e.target.value as DistillThermoModel })}
                              style={selectBaseStyle}
                            >
                              <option value="AUTO">AUTO (자동)</option>
                              <option value="ENRTL">ENRTL</option>
                              <option value="NRTL">NRTL</option>
                              <option value="PR">PR</option>
                              <option value="SRK">SRK</option>
                              <option value="ELEC_HCL_AZEO">HCl공비</option>
                              <option value="PENG_ROB">PR-EOS(호환)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 자동설계 산출 KPI 요약 카드 (무채색 화이트/슬레이트 톤) */}
                    {result?.shortcutDesign && (
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
                            자동설계 산출 요약 (단수 · 환류비 · 상하부 유량)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onChangeConfig({
                                columnCalcMode: 'rigorous_mesh',
                                activeDofSlots: ['rr', 'split'],
                                totalStages: result.shortcutDesign!.solvedStagesN,
                                feedStage: result.shortcutDesign!.solvedFeedStage,
                                topSpecType: 'reflux_ratio',
                                topSpecValue: Number(result.actualRefluxRatio.toFixed(3)),
                                splitSpecType: 'd_over_f_mass',
                                splitSpecValue: Number(result.actualDOverFMass.toFixed(4)),
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
                            산출 단수({result.shortcutDesign.solvedStagesN}단)·RR을 정밀모사 값으로 확정 →
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

                        {(result.sideCutMassKgH ?? 0) > 1e-4 && (
                          <div
                            style={{
                              marginTop: 7,
                              padding: '5px 9px',
                              borderRadius: 6,
                              background: '#F5F3FF',
                              border: '1px solid #DDD6FE',
                              color: '#5B21B6',
                              fontSize: 10.5,
                              fontWeight: 800,
                              fontFamily: MONO,
                            }}
                          >
                            🟣 사이드컷 측류(S): {result.sideCutStageUsed ?? '-'}단 ({result.sideCutPhase === 'G' ? '기상' : '액상'}) · {result.sideCutMassKgH!.toFixed(1)} kg/h (S/F {((result.actualSOverFMass ?? 0) * 100).toFixed(1)}%)
                            {result.sideCutSpecStatus?.label ? ` · ${result.sideCutSpecStatus.label}` : ''}
                          </div>
                        )}

                        {result.shortcutDesign.candidates && result.shortcutDesign.candidates.length > 0 &&
                          renderCandidateComparisonTable(result.shortcutDesign.candidates, 'design_stages')}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 탭 2: 탑·피드단 구성 */}
              {calcMode === 'rigorous_mesh' && leftTab === 'tower' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
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
                        onEnterRun={triggerRunSimulation}
                        style={inputBaseStyle}
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
                        {recFeedStage !== primaryFeedStage && (
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
                        value={primaryFeedStage}
                        onValueChange={(rawF) =>
                          onChangeConfig({
                            feedStage: Math.max(2, Math.min(N - 1, Math.round(rawF || 10))),
                          })
                        }
                        onEnterRun={triggerRunSimulation}
                        style={inputBaseStyle}
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
                            onEnterRun={triggerRunSimulation}
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
                                    onEnterRun={triggerRunSimulation}
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

              {/* 탭 1 (통합): 4개 후보 중 딱 2개 조건만 선택하는 단계별 운전·품질 가이드 (DOF = 2) */}
              {calcMode === 'rigorous_mesh' && leftTab === 'specs' && (() => {
                const count = selectedSlots.length;
                const isRrSel = selectedSlots.includes('rr');
                const isSplitSel = selectedSlots.includes('split');
                const isTopSel = selectedSlots.includes('top_spec');
                const isBotSel = selectedSlots.includes('bot_spec');

                const defLk = activeComps[0] ?? 'ECH';
                const defHk = activeComps.find((c) => c !== defLk) ?? defLk;

                const topMetric: DistillSpecMetric = config.topQualityMetric ?? spec1.metric ?? 'purity_wt_pct';
                const topComp: SimCompKey =
                  config.topQualityComp ?? (topMetric === 'impurity_wt_ppm' ? defHk : defLk);
                const topTarget: number =
                  config.topQualityTarget ?? (topMetric === 'impurity_wt_ppm' ? 200 : 99.5);
                const topCompFormula = COMP_META[topComp]?.formula ?? topComp;

                const botMetric: DistillSpecMetric = config.botQualityMetric ?? spec2.metric ?? 'purity_wt_pct';
                const botComp: SimCompKey =
                  config.botQualityComp ?? (botMetric === 'impurity_wt_ppm' ? defLk : defHk);
                const botTarget: number =
                  config.botQualityTarget ?? (botMetric === 'impurity_wt_ppm' ? 200 : 99.0);
                const botCompFormula = COMP_META[botComp]?.formula ?? botComp;

                const renderSlotHeader = (
                  slotId: DistillDofSlotId,
                  titleText: string,
                  autoSummaryText: string
                ) => {
                  const selIdx = selectedSlots.indexOf(slotId);
                  const isSel = selIdx >= 0;
                  const canAdd = !isSel && count < 2;
                  const isLockedAuto = !isSel && count >= 2;
                  return (
                    <div
                      onClick={() => {
                        if (!isLockedAuto) toggleDofSlot(slotId);
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        cursor: isLockedAuto ? 'default' : 'pointer',
                        marginBottom: isSel ? 9 : 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          disabled={isLockedAuto}
                          onChange={() => toggleDofSlot(slotId)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 15, height: 15, cursor: isLockedAuto ? 'not-allowed' : 'pointer' }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            color: isSel ? '#0F172A' : isLockedAuto ? '#64748B' : '#1E293B',
                          }}
                        >
                          {titleText}
                        </span>
                      </div>

                      {isSel && (
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
                          ✓ 필수 {selIdx + 1}/2 지정됨 (클릭 시 해제)
                        </span>
                      )}
                      {canAdd && (
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
                          + 클릭하여 {count === 0 ? '1번째' : '2번째 추가'} 조건으로 선택
                        </span>
                      )}
                      {isLockedAuto && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                        </div>
                      )}
                    </div>
                  );
                };

                const slotCardBoxStyle = (isSel: boolean): React.CSSProperties => {
                  const canAdd = !isSel && count < 2;
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

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* 상단 단계별 진행 배너 (0/2 -> 1/2 -> 2/2 완료) */}
                    <div
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: count === 2 ? '#F0FDF4' : '#FFFBEB',
                        border: count === 2 ? '1.5px solid #86EFAC' : '1.5px solid #FCD34D',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontSize: 11.5, fontWeight: 900, color: count === 2 ? '#166534' : '#92400E' }}>
                        {count === 0 && '필수 조건 [0/2]: 아래 4개 후보 중 알고 있는 1번째 운전·품질 조건을 선택하세요.'}
                        {count === 1 && '필수 조건 [1/2]: 점선으로 활성화된 후보 중 추가 조건 1개만 더 선택하면 완료됩니다.'}
                        {count === 2 && '✓ 필수 입력 완료 [2/2]: 4개 중 2개 조건 지정 완료 — 나머지 2개와 회수율은 자동 계산됩니다.'}
                      </div>
                      <button
                        type="button"
                        onClick={() => onChangeConfig({ activeDofSlots: [] })}
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

                    {/* 후보 ①: 상부 환류비 (RR) / 보일업비 */}
                    <div style={slotCardBoxStyle(isRrSel)}>
                      {renderSlotHeader(
                        'rr',
                        '① 상부 환류비 (RR = L₀/D) 또는 재비율 지정',
                        result ? `RR = ${result.actualRefluxRatio.toFixed(2)}` : '시뮬레이션 시 역산'
                      )}
                      {isRrSel && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.35fr 1fr', gap: 8 }}>
                          <div>
                            <label style={labelStyle}>환류/재비 입력 방식</label>
                            <select
                              value={topSpecType}
                              onChange={(e) =>
                                onChangeConfig({ topSpecType: e.target.value as DistillTopSpecType })
                              }
                              style={selectBaseStyle}
                            >
                              <option value="reflux_ratio">몰 환류비 (Reflux Ratio, RR = L₀/D)</option>
                              <option value="reflux_mass_kgh">환류 액상 유량 L₀ (kg/h)</option>
                              <option value="boilup_ratio">리보일러 재비율 (Boilup Ratio, VB/B)</option>
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>
                              {topSpecType === 'reflux_mass_kgh'
                                ? '환류 액상 유량 (kg/h)'
                                : topSpecType === 'boilup_ratio'
                                ? '재비율 (VB/B)'
                                : '운전 환류비 (RR)'}
                            </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-topspec`}
                                step={0.1}
                                min={0.05}
                                value={topSpecValue}
                                onValueChange={(v) =>
                                  onChangeConfig({ topSpecValue: Math.max(0.05, v || 1.5) })
                                }
                                onEnterRun={triggerRunSimulation}
                                style={inputBaseStyle}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 후보 ②: 탑정/탑저 유량 분배 사양 (D/F, B/F, D, B) */}
                      <div style={slotCardBoxStyle(isSplitSel)}>
                        {renderSlotHeader(
                          'split',
                          '② 탑정/탑저 유출 분배비 (D/F · B/F) 또는 유량(kg/h) 지정',
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
                                    onChangeConfig({ splitSpecType: e.target.value as DistillSplitSpecType })
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
                                    onChangeConfig({ splitSpecValue: Math.max(0.0001, v || 0.5) })
                                  }
                                  onEnterRun={triggerRunSimulation}
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
                            </div>
                          </>
                        )}
                      </div>

                      {/* 후보 ③: 탑정(D) 목표 제품 농도 / 불순물 농도 / 회수율 */}
                      <div style={slotCardBoxStyle(isTopSel)}>
                        {renderSlotHeader(
                          'top_spec',
                          '③ 탑정 유출(D) 목표 제품 농도(wt%) · 불순물(ppm) · 회수율(%)',
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
                                      const nextComp = m.id === 'impurity_wt_ppm' ? defHk : defLk;
                                      const nextTgt = m.id === 'impurity_wt_ppm' ? 200 : 99.5;
                                      onChangeConfig({
                                        topQualityMetric: m.id,
                                        topQualityComp: nextComp,
                                        topQualityTarget: nextTgt,
                                      });
                                    }}
                                    style={{
                                      padding: '5px 6px',
                                      borderRadius: 6,
                                      border: topMetric === m.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                      background: topMetric === m.id ? '#EFF6FF' : '#FFFFFF',
                                      color: topMetric === m.id ? '#1D4ED8' : '#475569',
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
                                  {topMetric === 'impurity_wt_ppm'
                                    ? '탑정(D)에서 억제할 불순물 성분'
                                    : topMetric === 'recovery_pct'
                                    ? '탑정(D)으로 회수할 성분'
                                    : '탑정(D) 목표 제품 성분'}
                                </label>
                                <select
                                  value={topComp}
                                  onChange={(e) =>
                                    onChangeConfig({ topQualityComp: e.target.value as SimCompKey })
                                  }
                                  style={selectBaseStyle}
                                >
                                  {SIM_COMPS.map((ck) => (
                                    <option key={ck} value={ck}>
                                      {formatCompOption(ck)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ ...labelStyle, color: '#0F172A' }}>
                                  {topMetric === 'impurity_wt_ppm'
                                    ? `탑정(D) 내 [${topCompFormula}] 허용 농도 (wt ppm)`
                                    : topMetric === 'recovery_pct'
                                    ? `원료 대비 탑정(D) [${topCompFormula}] 회수율 (%)`
                                    : `탑정(D) 내 [${topCompFormula}] 목표 농도 (wt%)`}
                                </label>
                                <BufferedNumberInput
                                  syncKey={`${unitTag}-topq-${topMetric}`}
                                  step={topMetric === 'impurity_wt_ppm' ? 25 : 0.1}
                                  min={0.001}
                                  max={topMetric === 'impurity_wt_ppm' ? 500000 : 99.999}
                                  value={topTarget}
                                  onValueChange={(v) => onChangeConfig({ topQualityTarget: v })}
                                  onEnterRun={triggerRunSimulation}
                                  style={inputBaseStyle}
                                />
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: '#475569' }}>
                              {topMetric === 'impurity_wt_ppm'
                                ? `※ 입력하신 수치는 탑정(D) 스트림 내 [${topCompFormula}]의 허용 불순물 농도(ppm = ${(topTarget / 10000).toFixed(4)} wt%)입니다.`
                                : topMetric === 'recovery_pct'
                                ? `※ 입력하신 수치는 유입 원료 중 탑정(D)으로 회수되는 [${topCompFormula}]의 질량 회수율(%)입니다.`
                                : `※ 입력하신 수치는 탑정(D) 스트림 내 [${topCompFormula}]의 질량 농도(wt%)입니다. 회수율(%)은 별도 입력 없이 자동 계산됩니다.`}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 후보 ④: 탑저(B) 목표 제품 농도 / 불순물 농도 / 회수율 (붉은색 제거 — 차분한 슬레이트/블루 통일) */}
                      <div style={slotCardBoxStyle(isBotSel)}>
                        {renderSlotHeader(
                          'bot_spec',
                          '④ 탑저 관출(B) 목표 제품 농도(wt%) · 불순물(ppm) · 회수율(%)',
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
                                      const nextComp = m.id === 'impurity_wt_ppm' ? defLk : defHk;
                                      const nextTgt = m.id === 'impurity_wt_ppm' ? 200 : 99.0;
                                      onChangeConfig({
                                        botQualityMetric: m.id,
                                        botQualityComp: nextComp,
                                        botQualityTarget: nextTgt,
                                      });
                                    }}
                                    style={{
                                      padding: '5px 6px',
                                      borderRadius: 6,
                                      border: botMetric === m.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                      background: botMetric === m.id ? '#EFF6FF' : '#FFFFFF',
                                      color: botMetric === m.id ? '#1D4ED8' : '#475569',
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
                                  {botMetric === 'impurity_wt_ppm'
                                    ? '탑저(B)에서 억제할 불순물 성분'
                                    : botMetric === 'recovery_pct'
                                    ? '탑저(B)로 회수할 성분'
                                    : '탑저(B) 목표 제품 성분'}
                                </label>
                                <select
                                  value={botComp}
                                  onChange={(e) =>
                                    onChangeConfig({ botQualityComp: e.target.value as SimCompKey })
                                  }
                                  style={selectBaseStyle}
                                >
                                  {SIM_COMPS.map((ck) => (
                                    <option key={ck} value={ck}>
                                      {formatCompOption(ck)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ ...labelStyle, color: '#0F172A' }}>
                                  {botMetric === 'impurity_wt_ppm'
                                    ? `탑저(B) 내 [${botCompFormula}] 허용 농도 (wt ppm)`
                                    : botMetric === 'recovery_pct'
                                    ? `원료 대비 탑저(B) [${botCompFormula}] 회수율 (%)`
                                    : `탑저(B) 내 [${botCompFormula}] 목표 농도 (wt%)`}
                                </label>
                                <BufferedNumberInput
                                  syncKey={`${unitTag}-botq-${botMetric}`}
                                  step={botMetric === 'impurity_wt_ppm' ? 25 : 0.1}
                                  min={0.001}
                                  max={botMetric === 'impurity_wt_ppm' ? 500000 : 99.999}
                                  value={botTarget}
                                  onValueChange={(v) => onChangeConfig({ botQualityTarget: v })}
                                  onEnterRun={triggerRunSimulation}
                                  style={inputBaseStyle}
                                />
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: '#475569' }}>
                              {botMetric === 'impurity_wt_ppm'
                                ? `※ 입력하신 수치는 탑저(B) 스트림 내 [${botCompFormula}]의 허용 불순물 농도(ppm = ${(botTarget / 10000).toFixed(4)} wt%)입니다.`
                                : botMetric === 'recovery_pct'
                                ? `※ 입력하신 수치는 유입 원료 중 탑저(B)로 회수되는 [${botCompFormula}]의 질량 회수율(%)입니다.`
                                : `※ 입력하신 수치는 탑저(B) 스트림 내 [${botCompFormula}]의 질량 농도(wt%)입니다. 회수율(%)은 별도 입력 없이 자동 계산됩니다.`}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 후보 ⑤ (선택 자유도 +1): 사이드컷 (측류 인출 · Side-Cut) 변수 설정 */}
                      {renderSideCutCard('rigorous_specs')}

                      {/* ③ 탑정 + ④ 탑저 2개 품질 스펙 동시 지정 시: AI 단수·공급단·환류비·유량 자동 동시최적화 및 후보 비교표 */}
                      {isTopSel && isBotSel && (() => {
                        const autoOptStages = config.autoOptimizeStagesOnDualSpec !== false;
                        return (
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 9,
                              background: autoOptStages ? '#F0FDF4' : '#F8FAFC',
                              border: autoOptStages ? '1.5px solid #34D399' : '1px solid #CBD5E1',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
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
                              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#065F46' }}>
                                ✨ AI 이중 목표품질(③+④) → 단수·공급단·환류비·탑정유량 자동 최적화
                              </span>
                              {result && (
                                <span
                                  style={{
                                    fontSize: 10.2,
                                    fontFamily: MONO,
                                    fontWeight: 800,
                                    color: '#0F172A',
                                  }}
                                >
                                  현재 해: N={result.totalStagesUsed}단 · Nf={result.feedStageUsed}단 · RR={result.actualRefluxRatio.toFixed(2)} · D={distTotalKgH.toFixed(1)} kg/h
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => {
                                  onChangeConfig({ autoOptimizeStagesOnDualSpec: true });
                                  window.setTimeout(() => triggerRunSimulation(), 30);
                                }}
                                style={{
                                  padding: '6px 9px',
                                  borderRadius: 6,
                                  border: autoOptStages ? '1.5px solid #059669' : '1px solid #CBD5E1',
                                  background: autoOptStages ? '#059669' : '#FFFFFF',
                                  color: autoOptStages ? '#FFFFFF' : '#334155',
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                ✨ AI 단수·공급단·환류비·유량 자동탐색 (TAC 최적 · 권장)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onChangeConfig({ autoOptimizeStagesOnDualSpec: false });
                                  window.setTimeout(() => triggerRunSimulation(), 30);
                                }}
                                style={{
                                  padding: '6px 9px',
                                  borderRadius: 6,
                                  border: !autoOptStages ? '1.5px solid #1E293B' : '1px solid #CBD5E1',
                                  background: !autoOptStages ? '#1E293B' : '#FFFFFF',
                                  color: !autoOptStages ? '#FFFFFF' : '#334155',
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                🔒 단수 수동 고정 (N={config.totalStages ?? 24}단 유지 · RR/유량만 역산)
                              </button>
                            </div>
                            {result?.dualSpecCandidates &&
                              result.dualSpecCandidates.length > 0 &&
                              renderCandidateComparisonTable(result.dualSpecCandidates, 'dual_spec')}
                          </div>
                        );
                      })()}

                      {/* 응축기 / 리보일러 열수지 카드 (무채색 슬레이트 카드 — 오류로 오인되는 붉은 배경 제거) */}
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

              {/* 탭 4: 압력·열역학·효율 */}
              {calcMode === 'rigorous_mesh' && leftTab === 'pressure' && (
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
                        onEnterRun={triggerRunSimulation}
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
                        onEnterRun={triggerRunSimulation}
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
                        onEnterRun={triggerRunSimulation}
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
                disabled={isRunningFeedback}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 7,
                  border: isSimDirty ? '1.5px solid #FDE047' : '1px solid #60A5FA',
                  background: isRunningFeedback
                    ? '#1D4ED8'
                    : isSimDirty
                    ? '#D97706'
                    : '#2563EB',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: isRunningFeedback ? 'wait' : 'pointer',
                  textAlign: 'center',
                }}
              >
                {isRunningFeedback
                  ? '⏳ 수렴 계산 중...'
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

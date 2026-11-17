'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  SIM_COMPS,
  COMP_META,
  solveFlowsheet,
  type SimCompKey,
  type FlowNodeDef,
  type FlowEdgeDef,
  type TearSolverMethod,
} from '@/lib/calculations/flowsheetSolver';
import type { SimPropertyMethod } from '@/lib/calculations/componentCatalog';
import {
  DESIGN_SPEC_STREAM_METRIC_LABELS,
  DESIGN_SPEC_UNIT_METRIC_LABELS,
  MANIPULATED_PARAM_LABELS,
  readManipulatedParam,
  solveFlowsheetWithDesignSpecs,
  runFlowsheetSensitivity,
  type DesignSpecDef,
  type DesignSpecStreamMetric,
  type DesignSpecUnitMetric,
  type ManipulatedParamKey,
  type FlowsheetDesignSpecSolveResult,
  type SensitivityWatchedOutput,
  type SensitivityAnalysisResult,
  type FlowsheetSolveResultCompat,
} from '@/lib/calculations/flowsheetOptimization';

export type OptimizationModalTab = 'design_spec' | 'sensitivity' | 'tear_solver';

export interface FlowsheetOptimizationModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: OptimizationModalTab;
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
  currentResult: FlowsheetSolveResultCompat;
  activeComponents: SimCompKey[];
  propertyMethod: SimPropertyMethod;
  tearMethod: TearSolverMethod;
  onChangeTearMethod: (method: TearSolverMethod) => void;
  designSpecs: DesignSpecDef[];
  onChangeDesignSpecs: (specs: DesignSpecDef[]) => void;
  onApplyAdjustedNodes: (adjustedNodes: FlowNodeDef[], solved: FlowsheetSolveResultCompat) => void;
}

const CHART_COLORS = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];

function getAvailableParamsForNode(node?: FlowNodeDef): ManipulatedParamKey[] {
  if (!node) return Object.keys(MANIPULATED_PARAM_LABELS) as ManipulatedParamKey[];
  switch (node.unitType) {
    case 'feed':
      return ['feed_comp_kgh', 'feed_total_scale', 'operTempC', 'operPressKgcm2g'];
    case 'distillation':
      return ['refluxRatio', 'distillateRateKgH', 'sideCutRateKgH', 'sideCutRatioSF', 'sideCutStage'];
    case 'splitter':
      return ['splitRatioTop'];
    case 'hex':
    case 'cooler':
    case 'liquefier':
      return ['operTempC', 'specifiedDutyMcalH', 'operPressKgcm2g'];
    case 'reactor':
      return ['operTempC', 'operPressKgcm2g', 'conversion', 'specifiedDutyMcalH'];
    case 'pump':
    case 'compressor':
    case 'valve':
      return ['outletPressKgcm2g'];
    case 'absorber':
    case 'extractor':
      return ['operTempC', 'operPressKgcm2g', 'makeupSolventKgH'];
    case 'separator':
    case 'evaporator':
    case 'electrolyzer':
    case 'saturator':
    case 'chelate_tower':
    case 'desiccant_dryer':
      return ['operTempC', 'operPressKgcm2g'];
    default:
      return ['operTempC', 'operPressKgcm2g', 'outletPressKgcm2g'];
  }
}

function getSmartParamDefaults(
  node: FlowNodeDef | undefined,
  paramKey: ManipulatedParamKey,
  comp: SimCompKey | undefined,
  currentResult: FlowsheetSolveResultCompat
): {
  minBound: number;
  maxBound: number;
  initialGuess: number;
  steps: number;
  secValuesText: string;
} {
  const curVal = node ? readManipulatedParam(node, paramKey, comp) : 0;
  const unitRes = node ? currentResult.units.find(u => u.nodeId === node.id) : undefined;
  const feedRef = unitRes && unitRes.inletMassKgH > 1 ? unitRes.inletMassKgH : 1000;

  switch (paramKey) {
    case 'sideCutRateKgH': {
      const guess = curVal > 0 ? curVal : Number((feedRef * 0.15).toFixed(1));
      const minB = curVal > 0 ? Number(Math.max(0, curVal * 0.2).toFixed(1)) : Number(Math.max(1, feedRef * 0.02).toFixed(1));
      const upperCap = unitRes && unitRes.inletMassKgH > 1 ? Math.max(curVal * 1.25, unitRes.inletMassKgH * 0.82) : Math.max(curVal * 2.5, 800);
      const maxB = curVal > 0 ? Number(Math.min(upperCap, Math.max(curVal * 2.2, feedRef * 0.6)).toFixed(1)) : Number((feedRef * 0.6).toFixed(1));
      return {
        minBound: minB,
        maxBound: Math.max(minB + 1, maxB),
        initialGuess: Number(guess.toFixed(2)),
        steps: 10,
        secValuesText: [0.08, 0.15, 0.25].map(f => Number((feedRef * f).toFixed(1))).join(', '),
      };
    }
    case 'sideCutRatioSF': {
      const guess = curVal > 0 ? curVal : 0.15;
      const maxB = curVal > 0.5 ? Math.min(0.85, Number((curVal + 0.2).toFixed(2))) : 0.6;
      return {
        minBound: 0.02,
        maxBound: maxB,
        initialGuess: Number(guess.toFixed(3)),
        steps: 10,
        secValuesText: '0.05, 0.15, 0.30',
      };
    }
    case 'sideCutStage': {
      const totalStages = Math.max(4, Math.round(node?.params.distillConfig?.totalStages ?? 24));
      const minB = 2;
      const maxB = Math.max(3, totalStages - 1);
      const steps = Math.max(2, Math.min(25, maxB - minB + 1));
      const s1 = Math.max(minB, Math.round(totalStages * 0.25));
      const s2 = Math.max(s1 + 1, Math.min(maxB, Math.round(totalStages * 0.45)));
      const s3 = Math.max(s2 + 1, Math.min(maxB, Math.round(totalStages * 0.65)));
      return {
        minBound: minB,
        maxBound: maxB,
        initialGuess: Math.max(minB, Math.min(maxB, Math.round(curVal || totalStages * 0.35))),
        steps,
        secValuesText: Array.from(new Set([s1, s2, s3])).join(', '),
      };
    }
    case 'refluxRatio': {
      const guess = curVal > 0 ? curVal : 2.5;
      return {
        minBound: Math.max(0.2, Number((guess * 0.4).toFixed(2))),
        maxBound: Number(Math.max(guess * 2.5, 6.0).toFixed(2)),
        initialGuess: Number(guess.toFixed(3)),
        steps: 10,
        secValuesText: '1.5, 2.5, 4.0',
      };
    }
    case 'distillateRateKgH': {
      const isMassSpec = node?.params.distillConfig?.splitSpecType === 'distillate_kgh';
      const guess = isMassSpec ? curVal : Number((feedRef * 0.5).toFixed(1));
      const minB = Number(Math.max(1, guess * 0.3).toFixed(1));
      const maxB = Number(Math.max(guess * 1.8, feedRef * 0.9).toFixed(1));
      return {
        minBound: minB,
        maxBound: Math.max(minB + 1, maxB),
        initialGuess: Number(guess.toFixed(2)),
        steps: 10,
        secValuesText: [0.3, 0.5, 0.7].map(f => Number((feedRef * f).toFixed(1))).join(', '),
      };
    }
    case 'splitRatioTop':
      return {
        minBound: 0.05,
        maxBound: 0.95,
        initialGuess: Number(curVal.toFixed(3)),
        steps: 10,
        secValuesText: '0.2, 0.5, 0.8',
      };
    case 'feed_total_scale':
      return {
        minBound: 0.5,
        maxBound: 1.5,
        initialGuess: 1.0,
        steps: 10,
        secValuesText: '0.8, 1.0, 1.2',
      };
    case 'feed_comp_kgh': {
      const minB = Number(Math.max(0, curVal * 0.2).toFixed(2));
      const maxB = Number(Math.max(100, curVal * 2.5).toFixed(2));
      return {
        minBound: minB,
        maxBound: maxB,
        initialGuess: Number(curVal.toFixed(3)),
        steps: 10,
        secValuesText: [0.5, 1.0, 1.5].map(f => Number(Math.max(1, curVal * f).toFixed(1))).join(', '),
      };
    }
    case 'conversion':
      return {
        minBound: 0.5,
        maxBound: 0.999,
        initialGuess: Number(curVal.toFixed(3)),
        steps: 10,
        secValuesText: '0.8, 0.9, 0.98',
      };
    case 'makeupSolventKgH': {
      const maxB = Math.max(500, Number((curVal * 2.5).toFixed(1)));
      return {
        minBound: 0,
        maxBound: maxB,
        initialGuess: Number(curVal.toFixed(2)),
        steps: 10,
        secValuesText: '100, 300, 500',
      };
    }
    case 'specifiedDutyMcalH':
      return {
        minBound: Number((curVal - 200).toFixed(1)),
        maxBound: Number((curVal + 200).toFixed(1)),
        initialGuess: Number(curVal.toFixed(2)),
        steps: 10,
        secValuesText: '-200, 0, 200',
      };
    case 'operPressKgcm2g':
    case 'outletPressKgcm2g': {
      const minB = Number(Math.max(-0.9, curVal - 1.5).toFixed(2));
      const maxB = Number((curVal + 3.0).toFixed(2));
      return {
        minBound: minB,
        maxBound: maxB,
        initialGuess: Number(curVal.toFixed(3)),
        steps: 10,
        secValuesText: [minB, curVal, maxB].map(v => Number(v.toFixed(2))).join(', '),
      };
    }
    case 'operTempC':
    default: {
      const minB = Math.round(curVal - 25);
      const maxB = Math.round(curVal + 25);
      return {
        minBound: minB,
        maxBound: maxB,
        initialGuess: Number(curVal.toFixed(2)),
        steps: 10,
        secValuesText: `${Math.round(curVal - 15)}, ${Math.round(curVal)}, ${Math.round(curVal + 15)}`,
      };
    }
  }
}

export default function FlowsheetOptimizationModal({
  open,
  onClose,
  initialTab = 'design_spec',
  nodes,
  edges,
  currentResult,
  activeComponents,
  propertyMethod,
  tearMethod,
  onChangeTearMethod,
  designSpecs,
  onChangeDesignSpecs,
  onApplyAdjustedNodes,
}: FlowsheetOptimizationModalProps) {
  const [activeTab, setActiveTab] = useState<OptimizationModalTab>(initialTab);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showAllComps, setShowAllComps] = useState<boolean>(false);

  // Design Spec execution state
  const [specSolveResult, setSpecSolveResult] = useState<FlowsheetDesignSpecSolveResult | null>(null);
  const [selectedSpecLogIdx, setSelectedSpecLogIdx] = useState<number>(0);
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);

  // Sensitivity state
  const defaultManipNode = useMemo(
    () =>
      nodes.find(n => n.unitType !== 'product' && !n.unitType.endsWith('_visual')) ??
      nodes[0] ??
      null,
    [nodes]
  );
  const defaultEdge = useMemo(() => edges[0] ?? null, [edges]);
  const defaultComp: SimCompKey = activeComponents[0] ?? 'H2O';

  const [sensPrimNodeId, setSensPrimNodeId] = useState<string>('');
  const [sensPrimParam, setSensPrimParam] = useState<ManipulatedParamKey>('operTempC');
  const [sensPrimComp, setSensPrimComp] = useState<SimCompKey>(defaultComp);
  const [sensMin, setSensMin] = useState<number>(10);
  const [sensMax, setSensMax] = useState<number>(90);
  const [sensSteps, setSensSteps] = useState<number>(10);

  const [sensSecEnabled, setSensSecEnabled] = useState<boolean>(false);
  const [sensSecNodeId, setSensSecNodeId] = useState<string>('');
  const [sensSecParam, setSensSecParam] = useState<ManipulatedParamKey>('operPressKgcm2g');
  const [sensSecComp, setSensSecComp] = useState<SimCompKey>(defaultComp);
  const [sensSecValuesText, setSensSecValuesText] = useState<string>('1.0, 3.0, 5.0');

  const [watchedOutputs, setWatchedOutputs] = useState<SensitivityWatchedOutput[]>([]);
  const [sensResult, setSensResult] = useState<SensitivityAnalysisResult | null>(null);
  const [csvCopied, setCsvCopied] = useState<boolean>(false);

  // Tear solver benchmark state
  const [relTolInput, setRelTolInput] = useState<number>(1e-4);
  const [maxIterInput, setMaxIterInput] = useState<number>(80);
  const [tearBenchmark, setTearBenchmark] = useState<{
    wegstein: { res: FlowsheetSolveResultCompat; ms: number };
    broyden: { res: FlowsheetSolveResultCompat; ms: number };
  } | null>(null);

  // Escape & mobile back-button (popstate) guard
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
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    closedByPopStateRef.current = false;
    window.history.pushState({ optimizationModalOpen: true }, '');
    pushedHistoryRef.current = true;
    const onPopState = () => {
      if (pushedHistoryRef.current) {
        closedByPopStateRef.current = true;
        pushedHistoryRef.current = false;
        onClose();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Initialize sensitivity defaults when nodes/edges become available
  useEffect(() => {
    const primMissing = !sensPrimNodeId || !nodes.some(n => n.id === sensPrimNodeId);
    if (primMissing && defaultManipNode) {
      setSensPrimNodeId(defaultManipNode.id);
      const initParam = getAvailableParamsForNode(defaultManipNode)[0] ?? 'operTempC';
      const smart = getSmartParamDefaults(defaultManipNode, initParam, defaultComp, currentResult);
      setSensPrimParam(initParam);
      setSensMin(smart.minBound);
      setSensMax(smart.maxBound);
      setSensSteps(smart.steps);
    }
    const secMissing = !sensSecNodeId || !nodes.some(n => n.id === sensSecNodeId);
    if (secMissing && defaultManipNode) {
      setSensSecNodeId(defaultManipNode.id);
      const secAvail = getAvailableParamsForNode(defaultManipNode);
      const initSecParam = secAvail[1] ?? secAvail[0] ?? 'operPressKgcm2g';
      const smartSec = getSmartParamDefaults(defaultManipNode, initSecParam, defaultComp, currentResult);
      setSensSecParam(initSecParam);
      setSensSecValuesText(smartSec.secValuesText);
    }
    if (watchedOutputs.length === 0 && defaultEdge) {
      const initialWatched: SensitivityWatchedOutput[] = [
        {
          id: 'w-1',
          label: `${defaultEdge.streamNo} 총유량 (kg/h)`,
          streamEdgeId: defaultEdge.id,
          metric: 'total_flow_kgh',
        },
      ];
      const heatUnit = nodes.find(
        n =>
          n.unitType === 'hex' ||
          n.unitType === 'cooler' ||
          n.unitType === 'distillation' ||
          n.unitType === 'reactor' ||
          n.unitType === 'separator'
      );
      if (heatUnit) {
        initialWatched.push({
          id: 'w-2',
          label: `${heatUnit.tag} 열부하 (Mcal/h)`,
          unitNodeId: heatUnit.id,
          unitMetric: 'heat_duty_mcalh',
        });
      }
      setWatchedOutputs(initialWatched);
    }
  }, [defaultManipNode, defaultEdge, nodes, sensPrimNodeId, sensSecNodeId, watchedOutputs.length]);

  const selectableComps = useMemo(() => {
    if (showAllComps) return SIM_COMPS;
    return activeComponents.length > 0 ? activeComponents : SIM_COMPS.slice(0, 15);
  }, [showAllComps, activeComponents]);

  const nodeLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, `${n.tag} · ${n.name}`);
    return m;
  }, [nodes]);

  const edgeLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      const sTag = nodes.find(n => n.id === e.source)?.tag ?? e.source;
      const tTag = nodes.find(n => n.id === e.target)?.tag ?? e.target;
      m.set(e.id, `${e.streamNo} (${sTag} → ${tTag})`);
    }
    return m;
  }, [edges, nodes]);

  if (!open) return null;

  // ── Design Spec Handlers ──
  const handleAddDesignSpec = () => {
    const firstStream = edges[edges.length - 1] ?? edges[0];
    const firstManip =
      nodes.find(
        n =>
          n.unitType === 'distillation' ||
          n.unitType === 'splitter' ||
          n.unitType === 'hex' ||
          n.unitType === 'cooler' ||
          n.unitType === 'feed' ||
          n.unitType === 'separator'
      ) ?? nodes[0];
    if (!firstManip) return;

    const defaultParam: ManipulatedParamKey =
      firstManip.unitType === 'distillation'
        ? 'refluxRatio'
        : firstManip.unitType === 'splitter'
          ? 'splitRatioTop'
          : firstManip.unitType === 'feed'
            ? 'feed_comp_kgh'
            : 'operTempC';
    const smart = getSmartParamDefaults(firstManip, defaultParam, defaultComp, currentResult);

    const nextSpec: DesignSpecDef = {
      id: `ds-${Date.now().toString(36)}`,
      name: `DS-${designSpecs.length + 1}`,
      enabled: true,
      measured: firstStream
        ? {
            streamEdgeId: firstStream.id,
            metric: 'comp_wt_pct',
            comp: defaultComp,
            targetValue: 30.0,
            tolerance: 1e-3,
          }
        : {
            unitNodeId: firstManip.id,
            unitMetric: 'outlet_mass_kgh',
            targetValue: 1000,
            tolerance: 1e-2,
          },
      manipulated: {
        nodeId: firstManip.id,
        paramKey: defaultParam,
        comp: defaultParam === 'feed_comp_kgh' ? defaultComp : undefined,
        minBound: smart.minBound,
        maxBound: smart.maxBound,
        initialGuess: smart.initialGuess,
      },
    };
    onChangeDesignSpecs([...designSpecs, nextSpec]);
    setAppliedBanner(null);
  };

  const updateSpecAt = (idx: number, patch: Partial<DesignSpecDef>) => {
    const next = designSpecs.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChangeDesignSpecs(next);
    setAppliedBanner(null);
  };

  const removeSpecAt = (idx: number) => {
    onChangeDesignSpecs(designSpecs.filter((_, i) => i !== idx));
    setAppliedBanner(null);
  };

  const handleRunDesignSpecs = () => {
    setAppliedBanner(null);
    const res = solveFlowsheetWithDesignSpecs(nodes, edges, designSpecs, {
      propertyMethod,
      activeComponents,
      tearMethod,
      relTolerance: relTolInput,
      maxIterations: maxIterInput,
    });
    setSpecSolveResult(res);
    setSelectedSpecLogIdx(0);
  };

  const handleApplyDesignSpecResult = () => {
    if (!specSolveResult) return;
    onApplyAdjustedNodes(specSolveResult.adjustedNodes, specSolveResult.solveResult);
    setAppliedBanner('조작변수 값이 장치 사양에 반영되었습니다.');
  };

  // ── Sensitivity Handlers ──
  const handleAddWatchedOutput = () => {
    const e0 = edges[edges.length - 1] ?? edges[0];
    const id = `w-${Date.now().toString(36)}`;
    if (e0) {
      setWatchedOutputs(prev => [
        ...prev,
        {
          id,
          label: `${e0.streamNo} ${defaultComp} 농도(wt%)`,
          streamEdgeId: e0.id,
          metric: 'comp_wt_pct',
          comp: defaultComp,
        },
      ]);
    } else if (nodes[0]) {
      setWatchedOutputs(prev => [
        ...prev,
        {
          id,
          label: `${nodes[0].tag} 열부하(Mcal/h)`,
          unitNodeId: nodes[0].id,
          unitMetric: 'heat_duty_mcalh',
        },
      ]);
    }
  };

  const updateWatchedAt = (idx: number, patch: Partial<SensitivityWatchedOutput>) => {
    setWatchedOutputs(prev => prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  };

  const handleRunSensitivity = () => {
    if (!sensPrimNodeId || watchedOutputs.length === 0) return;
    const secVals = sensSecEnabled
      ? sensSecValuesText
          .split(',')
          .map(s => Number(s.trim()))
          .filter(v => Number.isFinite(v))
      : [];
    const res = runFlowsheetSensitivity(
      nodes,
      edges,
      {
        primaryVar: {
          nodeId: sensPrimNodeId,
          paramKey: sensPrimParam,
          comp: sensPrimParam === 'feed_comp_kgh' ? sensPrimComp : undefined,
          label: `${nodeLabelMap.get(sensPrimNodeId) ?? sensPrimNodeId} · ${MANIPULATED_PARAM_LABELS[sensPrimParam].labelKo}`,
          minValue: sensMin,
          maxValue: sensMax,
          steps: Math.max(2, Math.min(30, sensSteps)),
        },
        secondaryVar:
          sensSecEnabled && secVals.length > 0
            ? {
                nodeId: sensSecNodeId,
                paramKey: sensSecParam,
                comp: sensSecParam === 'feed_comp_kgh' ? sensSecComp : undefined,
                label: MANIPULATED_PARAM_LABELS[sensSecParam].labelKo,
                values: secVals,
              }
            : undefined,
        watchedOutputs,
      },
      {
        propertyMethod,
        activeComponents,
        tearMethod,
        relTolerance: relTolInput,
        maxIterations: maxIterInput,
      }
    );
    setSensResult(res);
    setCsvCopied(false);
  };

  const handleExportSensitivityCsv = () => {
    if (!sensResult) return;
    const header = [
      'Step',
      `${MANIPULATED_PARAM_LABELS[sensPrimParam].labelKo}`,
      ...(sensSecEnabled ? ['2차변수'] : []),
      'Converged',
      'Iterations',
      ...watchedOutputs.map(w => w.label),
    ].join(',');
    const lines = sensResult.flatRows.map(r =>
      [
        r.stepIndex + 1,
        r.primaryValue,
        ...(sensSecEnabled ? [r.secondaryValue ?? ''] : []),
        r.converged ? 'TRUE' : 'FALSE',
        r.iterations,
        ...watchedOutputs.map(w => Number((r.outputs[w.id] ?? 0).toFixed(5))),
      ].join(',')
    );
    const csvText = [header, ...lines].join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(csvText).catch(() => {});
      setCsvCopied(true);
    }
    if (typeof window !== 'undefined') {
      const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowsheet_sensitivity_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // ── Tear Solver Benchmark Handler ──
  const handleRunTearBenchmark = () => {
    const tW0 = Date.now();
    const wegRes = solveFlowsheet(nodes, edges, {
      propertyMethod,
      activeComponents,
      tearMethod: 'wegstein',
      relTolerance: relTolInput,
      maxIterations: maxIterInput,
    });
    const wegMs = Math.max(1, Date.now() - tW0);

    const tB0 = Date.now();
    const broyRes = solveFlowsheet(nodes, edges, {
      propertyMethod,
      activeComponents,
      tearMethod: 'broyden',
      relTolerance: relTolInput,
      maxIterations: maxIterInput,
    });
    const broyMs = Math.max(1, Date.now() - tB0);

    setTearBenchmark({
      wegstein: { res: wegRes, ms: wegMs },
      broyden: { res: broyRes, ms: broyMs },
    });
  };

  // Shared inline styles
  const inputStyle: React.CSSProperties = {
    padding: '5px 7px',
    fontSize: 11.5,
    borderRadius: 5,
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: '#0F172A',
    boxSizing: 'border-box',
    width: '100%',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    color: '#475569',
    marginBottom: 3,
    display: 'block',
  };

  return (
    <div
      onClick={e => {
        if (e.target === e.currentTarget) handleCloseModal();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 14,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: isMobile ? '100vw' : 'min(1160px, 96vw)',
          height: isMobile ? '100dvh' : 'min(860px, 92vh)',
          background: '#F8FAFC',
          borderRadius: isMobile ? 0 : 12,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: isMobile ? 'none' : '1px solid #334155',
        }}
      >
        {/* Pinned Header */}
        <div
          style={{
            background: '#142435',
            color: '#FFFFFF',
            padding: isMobile ? '10px 12px' : '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexShrink: 0,
            borderBottom: '1px solid #1E3A5F',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: isMobile ? 13 : 15,
                fontWeight: 800,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              🎯 목표역산 · 민감도 · 수렴기 설정
            </div>
            <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
              장치 {nodes.length} · 스트림 {edges.length} · Tear {currentResult.convergence.tearEdgeIds.length} · {currentResult.propertyMethodUsed}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseModal}
            style={{
              padding: isMobile ? '6px 10px' : '6px 13px',
              fontSize: 12,
              fontWeight: 800,
              borderRadius: 6,
              border: '1px solid #475569',
              background: '#1E293B',
              color: '#F8FAFC',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            ✕ 닫기
          </button>
        </div>

        {/* 3-Tab Navigation Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
            gap: 4,
            padding: isMobile ? '6px 8px' : '8px 16px',
            background: '#E2E8F0',
            borderBottom: '1px solid #CBD5E1',
            flexShrink: 0,
          }}
        >
          {(
            [
              {
                key: 'design_spec',
                label: `🎯 목표역산 (Design Spec${designSpecs.length > 0 ? ` · ${designSpecs.filter(d => d.enabled).length}` : ''})`,
              },
              {
                key: 'sensitivity',
                label: '📈 민감도 분석 (Sensitivity)',
              },
              {
                key: 'tear_solver',
                label: `🔄 수렴기 설정 (${tearMethod.toUpperCase()})`,
              },
            ] as { key: OptimizationModalTab; label: string }[]
          ).map(tab => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: isMobile ? '7px 8px' : '8px 12px',
                  fontSize: isMobile ? 11.5 : 12.5,
                  fontWeight: 800,
                  borderRadius: 6,
                  border: active ? '1.5px solid #1D4ED8' : '1px solid #CBD5E1',
                  background: active ? '#FFFFFF' : '#F1F5F9',
                  color: active ? '#1E3A8A' : '#475569',
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Scrollable Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? '10px 10px 24px' : '16px 18px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* ════════════════════════════════════════════════════════════════════
              TAB 1: DESIGN SPEC (피드백 목표역산 제어기)
             ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'design_spec' && (
            <>
              <div
                style={{
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.5, color: '#1E3A8A', fontWeight: 700 }}>
                  목표 사양 역산 (단일 1D Secant–Brent · 다변수 감쇠 Broyden)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label
                    style={{
                      fontSize: 11,
                      color: '#334155',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showAllComps}
                      onChange={e => setShowAllComps(e.target.checked)}
                    />
                    전체 {SIM_COMPS.length}종
                  </label>
                  <button
                    type="button"
                    onClick={handleAddDesignSpec}
                    style={{
                      padding: '6px 12px',
                      fontSize: 11.5,
                      fontWeight: 800,
                      borderRadius: 6,
                      border: '1px solid #2563EB',
                      background: '#2563EB',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    + Spec 추가
                  </button>
                </div>
              </div>

              {designSpecs.length === 0 ? (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px dashed #94A3B8',
                    borderRadius: 8,
                    padding: '24px 16px',
                    textAlign: 'center',
                    color: '#64748B',
                    fontSize: 12,
                  }}
                >
                  등록된 Design Spec 없음 · [+ Spec 추가]로 역산 조건을 구성하세요.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {designSpecs.map((spec, idx) => {
                    const isUnitTarget = !!spec.measured.unitNodeId && !spec.measured.streamEdgeId;
                    const sMetric: DesignSpecStreamMetric = spec.measured.metric ?? 'comp_wt_pct';
                    const needsTargetComp =
                      !isUnitTarget &&
                      (DESIGN_SPEC_STREAM_METRIC_LABELS[sMetric]?.needsComp ||
                        sMetric === 'comp_recovery_pct');
                    const mParam = spec.manipulated.paramKey;
                    const needsManipComp = !!MANIPULATED_PARAM_LABELS[mParam]?.needsComp;

                    return (
                      <div
                        key={spec.id}
                        style={{
                          background: '#FFFFFF',
                          border: spec.enabled ? '1.5px solid #93C5FD' : '1px solid #CBD5E1',
                          borderRadius: 8,
                          padding: isMobile ? 10 : 12,
                          opacity: spec.enabled ? 1 : 0.72,
                        }}
                      >
                        {/* Spec Header */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
                            <input
                              type="checkbox"
                              checked={spec.enabled}
                              onChange={e => updateSpecAt(idx, { enabled: e.target.checked })}
                              style={{ width: 15, height: 15, cursor: 'pointer' }}
                            />
                            <input
                              type="text"
                              value={spec.name}
                              onChange={e => updateSpecAt(idx, { name: e.target.value })}
                              style={{
                                ...inputStyle,
                                width: isMobile ? 160 : 230,
                                fontWeight: 800,
                                background: '#F8FAFC',
                              }}
                            />
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: 99,
                                background: spec.enabled ? '#DBEAFE' : '#E2E8F0',
                                color: spec.enabled ? '#1E40AF' : '#64748B',
                              }}
                            >
                              {spec.enabled ? '활성' : '비활성'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSpecAt(idx)}
                            style={{
                              padding: '4px 9px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 5,
                              border: '1px solid #FCA5A5',
                              background: '#FEF2F2',
                              color: '#B91C1C',
                              cursor: 'pointer',
                            }}
                          >
                            삭제
                          </button>
                        </div>

                        {/* Two-column Target vs Manipulated */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                            gap: 10,
                          }}
                        >
                          {/* Target Box */}
                          <div
                            style={{
                              background: '#F8FAFC',
                              border: '1px solid #E2E8F0',
                              borderRadius: 6,
                              padding: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8,
                              }}
                            >
                              <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0F766E' }}>
                                ① 목표치 (Target)
                              </span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSpecAt(idx, {
                                      measured: {
                                        streamEdgeId: edges[0]?.id ?? '',
                                        metric: 'comp_wt_pct',
                                        comp: defaultComp,
                                        targetValue: spec.measured.targetValue,
                                        tolerance: spec.measured.tolerance ?? 1e-3,
                                      },
                                    })
                                  }
                                  style={{
                                    padding: '2px 7px',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    borderRadius: 4,
                                    border: '1px solid #99F6E4',
                                    background: !isUnitTarget ? '#CCFBF1' : '#FFFFFF',
                                    color: '#0F766E',
                                    cursor: 'pointer',
                                  }}
                                >
                                  스트림
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSpecAt(idx, {
                                      measured: {
                                        unitNodeId: nodes[0]?.id ?? '',
                                        unitMetric: 'heat_duty_mcalh',
                                        targetValue: spec.measured.targetValue,
                                        tolerance: spec.measured.tolerance ?? 1e-3,
                                      },
                                    })
                                  }
                                  style={{
                                    padding: '2px 7px',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    borderRadius: 4,
                                    border: '1px solid #99F6E4',
                                    background: isUnitTarget ? '#CCFBF1' : '#FFFFFF',
                                    color: '#0F766E',
                                    cursor: 'pointer',
                                  }}
                                >
                                  장치
                                </button>
                              </div>
                            </div>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                                gap: 8,
                              }}
                            >
                              {!isUnitTarget ? (
                                <>
                                  <div>
                                    <span style={labelStyle}>스트림</span>
                                    <select
                                      value={spec.measured.streamEdgeId ?? ''}
                                      onChange={e =>
                                        updateSpecAt(idx, {
                                          measured: { ...spec.measured, streamEdgeId: e.target.value },
                                        })
                                      }
                                      style={inputStyle}
                                    >
                                      {edges.map(ed => (
                                        <option key={ed.id} value={ed.id}>
                                          {edgeLabelMap.get(ed.id) ?? ed.streamNo}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <span style={labelStyle}>측정 항목</span>
                                    <select
                                      value={sMetric}
                                      onChange={e =>
                                        updateSpecAt(idx, {
                                          measured: {
                                            ...spec.measured,
                                            metric: e.target.value as DesignSpecStreamMetric,
                                          },
                                        })
                                      }
                                      style={inputStyle}
                                    >
                                      {(Object.keys(DESIGN_SPEC_STREAM_METRIC_LABELS) as DesignSpecStreamMetric[]).map(
                                        mk => (
                                          <option key={mk} value={mk}>
                                            {DESIGN_SPEC_STREAM_METRIC_LABELS[mk].labelKo}
                                          </option>
                                        )
                                      )}
                                    </select>
                                  </div>
                                  {needsTargetComp && (
                                    <div>
                                      <span style={labelStyle}>
                                        성분{sMetric === 'comp_recovery_pct' ? ' (미선택=총유량)' : ''}
                                      </span>
                                      <select
                                        value={spec.measured.comp ?? ''}
                                        onChange={e =>
                                          updateSpecAt(idx, {
                                            measured: {
                                              ...spec.measured,
                                              comp: (e.target.value || undefined) as SimCompKey | undefined,
                                            },
                                          })
                                        }
                                        style={inputStyle}
                                      >
                                        {sMetric === 'comp_recovery_pct' && (
                                          <option value="">전체 질량 회수율 (%)</option>
                                        )}
                                        {selectableComps.map(ck => (
                                          <option key={ck} value={ck}>
                                            {ck} ({COMP_META[ck].label})
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                  {sMetric === 'comp_recovery_pct' && (
                                    <div>
                                      <span style={labelStyle}>기준 Feed (미지정=전체)</span>
                                      <select
                                        value={spec.measured.refFeedNodeId ?? ''}
                                        onChange={e =>
                                          updateSpecAt(idx, {
                                            measured: {
                                              ...spec.measured,
                                              refFeedNodeId: e.target.value || undefined,
                                            },
                                          })
                                        }
                                        style={inputStyle}
                                      >
                                        <option value="">전체 Feed 합산</option>
                                        {nodes.map(n => (
                                          <option key={n.id} value={n.id}>
                                            {nodeLabelMap.get(n.id)}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div>
                                    <span style={labelStyle}>장치</span>
                                    <select
                                      value={spec.measured.unitNodeId ?? ''}
                                      onChange={e =>
                                        updateSpecAt(idx, {
                                          measured: { ...spec.measured, unitNodeId: e.target.value },
                                        })
                                      }
                                      style={inputStyle}
                                    >
                                      {nodes.map(n => (
                                        <option key={n.id} value={n.id}>
                                          {nodeLabelMap.get(n.id)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <span style={labelStyle}>장치 지표</span>
                                    <select
                                      value={spec.measured.unitMetric ?? 'heat_duty_mcalh'}
                                      onChange={e =>
                                        updateSpecAt(idx, {
                                          measured: {
                                            ...spec.measured,
                                            unitMetric: e.target.value as DesignSpecUnitMetric,
                                          },
                                        })
                                      }
                                      style={inputStyle}
                                    >
                                      {(Object.keys(DESIGN_SPEC_UNIT_METRIC_LABELS) as DesignSpecUnitMetric[]).map(
                                        uk => (
                                          <option key={uk} value={uk}>
                                            {DESIGN_SPEC_UNIT_METRIC_LABELS[uk].labelKo}
                                          </option>
                                        )
                                      )}
                                    </select>
                                  </div>
                                </>
                              )}

                              <div>
                                <span style={labelStyle}>목표값 (Target)</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={spec.measured.targetValue}
                                  onChange={e =>
                                    updateSpecAt(idx, {
                                      measured: {
                                        ...spec.measured,
                                        targetValue: Number(e.target.value),
                                      },
                                    })
                                  }
                                  style={inputStyle}
                                />
                              </div>
                              <div>
                                <span style={labelStyle}>허용오차 (Tol)</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={spec.measured.tolerance ?? 0.001}
                                  onChange={e =>
                                    updateSpecAt(idx, {
                                      measured: {
                                        ...spec.measured,
                                        tolerance: Math.max(1e-7, Number(e.target.value) || 1e-3),
                                      },
                                    })
                                  }
                                  style={inputStyle}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Manipulated Box */}
                          <div
                            style={{
                              background: '#F8FAFC',
                              border: '1px solid #E2E8F0',
                              borderRadius: 6,
                              padding: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8,
                              }}
                            >
                              <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1D4ED8' }}>
                                ② 조작변수 (Manipulated)
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const nd = nodes.find(n => n.id === spec.manipulated.nodeId);
                                  if (!nd) return;
                                  const val = readManipulatedParam(
                                    nd,
                                    spec.manipulated.paramKey,
                                    spec.manipulated.comp
                                  );
                                  updateSpecAt(idx, {
                                    manipulated: { ...spec.manipulated, initialGuess: Number(val.toFixed(4)) },
                                  });
                                }}
                                style={{
                                  padding: '2px 7px',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  borderRadius: 4,
                                  border: '1px solid #BFDBFE',
                                  background: '#EFF6FF',
                                  color: '#1D4ED8',
                                  cursor: 'pointer',
                                }}
                              >
                                현재값 → 초기값
                              </button>
                            </div>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                                gap: 8,
                              }}
                            >
                              <div>
                                <span style={labelStyle}>장치 (Node)</span>
                                <select
                                  value={spec.manipulated.nodeId}
                                  onChange={e => {
                                    const nextNodeId = e.target.value;
                                    const nextNode = nodes.find(n => n.id === nextNodeId);
                                    const avail = getAvailableParamsForNode(nextNode);
                                    const nextKey = avail.includes(mParam) ? mParam : (avail[0] ?? mParam);
                                    const nextComp =
                                      nextKey === 'feed_comp_kgh'
                                        ? (spec.manipulated.comp ?? defaultComp)
                                        : undefined;
                                    const smart = getSmartParamDefaults(nextNode, nextKey, nextComp, currentResult);
                                    updateSpecAt(idx, {
                                      manipulated: {
                                        ...spec.manipulated,
                                        nodeId: nextNodeId,
                                        paramKey: nextKey,
                                        comp: nextComp,
                                        minBound: smart.minBound,
                                        maxBound: smart.maxBound,
                                        initialGuess: smart.initialGuess,
                                      },
                                    });
                                  }}
                                  style={inputStyle}
                                >
                                  {nodes.map(n => (
                                    <option key={n.id} value={n.id}>
                                      {nodeLabelMap.get(n.id)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <span style={labelStyle}>파라미터</span>
                                <select
                                  value={mParam}
                                  onChange={e => {
                                    const nextKey = e.target.value as ManipulatedParamKey;
                                    const manipNode = nodes.find(n => n.id === spec.manipulated.nodeId);
                                    const nextComp =
                                      nextKey === 'feed_comp_kgh'
                                        ? (spec.manipulated.comp ?? defaultComp)
                                        : undefined;
                                    const smart = getSmartParamDefaults(manipNode, nextKey, nextComp, currentResult);
                                    updateSpecAt(idx, {
                                      manipulated: {
                                        ...spec.manipulated,
                                        paramKey: nextKey,
                                        comp: nextComp,
                                        minBound: smart.minBound,
                                        maxBound: smart.maxBound,
                                        initialGuess: smart.initialGuess,
                                      },
                                    });
                                  }}
                                  style={inputStyle}
                                >
                                  {(() => {
                                    const manipNode = nodes.find(n => n.id === spec.manipulated.nodeId);
                                    const avail = getAvailableParamsForNode(manipNode);
                                    const choices = avail.includes(mParam) ? avail : [...avail, mParam];
                                    return choices.map(pk => (
                                      <option key={pk} value={pk}>
                                        {MANIPULATED_PARAM_LABELS[pk].labelKo}
                                      </option>
                                    ));
                                  })()}
                                </select>
                              </div>

                              {needsManipComp && (
                                <div style={{ gridColumn: isMobile ? 'auto' : '1 / -1' }}>
                                  <span style={labelStyle}>대상 성분</span>
                                  <select
                                    value={spec.manipulated.comp ?? defaultComp}
                                    onChange={e =>
                                      updateSpecAt(idx, {
                                        manipulated: {
                                          ...spec.manipulated,
                                          comp: e.target.value as SimCompKey,
                                        },
                                      })
                                    }
                                    style={inputStyle}
                                  >
                                    {selectableComps.map(ck => (
                                      <option key={ck} value={ck}>
                                        {ck} ({COMP_META[ck].label})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div>
                                <span style={labelStyle}>하한 (Min)</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={spec.manipulated.minBound}
                                  onChange={e =>
                                    updateSpecAt(idx, {
                                      manipulated: {
                                        ...spec.manipulated,
                                        minBound: Number(e.target.value),
                                      },
                                    })
                                  }
                                  style={inputStyle}
                                />
                              </div>
                              <div>
                                <span style={labelStyle}>상한 (Max)</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={spec.manipulated.maxBound}
                                  onChange={e =>
                                    updateSpecAt(idx, {
                                      manipulated: {
                                        ...spec.manipulated,
                                        maxBound: Number(e.target.value),
                                      },
                                    })
                                  }
                                  style={inputStyle}
                                />
                              </div>
                              <div style={{ gridColumn: isMobile ? 'auto' : '1 / -1' }}>
                                <span style={labelStyle}>초기값 (Initial Guess)</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={spec.manipulated.initialGuess ?? ''}
                                  placeholder="미입력 시 현재 설정값"
                                  onChange={e =>
                                    updateSpecAt(idx, {
                                      manipulated: {
                                        ...spec.manipulated,
                                        initialGuess:
                                          e.target.value === '' ? undefined : Number(e.target.value),
                                      },
                                    })
                                  }
                                  style={inputStyle}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '8px 0',
                }}
              >
                <button
                  type="button"
                  disabled={designSpecs.filter(d => d.enabled).length === 0}
                  onClick={handleRunDesignSpecs}
                  style={{
                    padding: '9px 18px',
                    fontSize: 12.5,
                    fontWeight: 800,
                    borderRadius: 7,
                    border: 'none',
                    background:
                      designSpecs.filter(d => d.enabled).length === 0 ? '#94A3B8' : '#1D4ED8',
                    color: '#FFFFFF',
                    cursor:
                      designSpecs.filter(d => d.enabled).length === 0 ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(29,78,216,0.28)',
                  }}
                >
                  ▶ 역산 실행 (Solve)
                </button>

                {specSolveResult && (
                  <button
                    type="button"
                    onClick={handleApplyDesignSpecResult}
                    style={{
                      padding: '9px 18px',
                      fontSize: 12.5,
                      fontWeight: 800,
                      borderRadius: 7,
                      border: '1px solid #047857',
                      background: '#059669',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(5,150,105,0.28)',
                    }}
                  >
                    ✅ 결과 반영 (Apply)
                  </button>
                )}
              </div>

              {appliedBanner && (
                <div
                  style={{
                    background: '#ECFDF5',
                    border: '1px solid #6EE7B7',
                    color: '#065F46',
                    borderRadius: 7,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ✓ {appliedBanner}
                </div>
              )}

              {/* Design Spec Results & Iteration History */}
              {specSolveResult && (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                      역산 결과 ({specSolveResult.solverMethodUsed === 'secant_brent_1d' ? 'Secant–Brent' : specSolveResult.solverMethodUsed === 'damped_broyden_nd' ? 'Broyden' : '직결'} · {specSolveResult.outerIterations}회)
                    </div>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 800,
                        background: specSolveResult.converged ? '#DCFCE7' : '#FEF3C7',
                        color: specSolveResult.converged ? '#166534' : '#92400E',
                      }}
                    >
                      {specSolveResult.converged ? '전체 목표 수렴 완료' : '일부 미수렴 / 경계 도달'}
                    </span>
                  </div>

                  {/* Summary Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 11.5,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#334155', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>제어기</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>상태</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>목표치</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>달성치</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>오차</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>최종 조작변수</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>반복수</th>
                        </tr>
                      </thead>
                      <tbody>
                        {specSolveResult.specResults.map((sr, i) => (
                          <tr
                            key={sr.specId}
                            onClick={() => setSelectedSpecLogIdx(i)}
                            style={{
                              cursor: 'pointer',
                              background: selectedSpecLogIdx === i ? '#EFF6FF' : '#FFFFFF',
                              borderBottom: '1px solid #E2E8F0',
                            }}
                          >
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{sr.name}</td>
                            <td style={{ padding: '6px 8px' }}>
                              <span
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  background: sr.converged ? '#DCFCE7' : '#FEE2E2',
                                  color: sr.converged ? '#166534' : '#991B1B',
                                }}
                              >
                                {sr.converged ? 'CONVERGED' : 'UNCONVERGED'}
                              </span>
                            </td>
                            <td style={{ padding: '6px 8px' }}>{sr.targetValue.toFixed(4)}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 700, color: '#0F766E' }}>
                              {sr.achievedValue.toFixed(4)}
                            </td>
                            <td style={{ padding: '6px 8px' }}>{sr.residualError.toExponential(2)}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 800, color: '#1D4ED8' }}>
                              {sr.finalManipulatedValue.toFixed(5)}
                            </td>
                            <td style={{ padding: '6px 8px' }}>{sr.iterations}회</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Iteration Convergence Log for Selected Spec */}
                  {specSolveResult.specResults[selectedSpecLogIdx] && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#475569', marginBottom: 5 }}>
                        반복 수렴 이력 — {specSolveResult.specResults[selectedSpecLogIdx].name}
                      </div>
                      <div
                        style={{
                          maxHeight: 200,
                          overflowY: 'auto',
                          border: '1px solid #E2E8F0',
                          borderRadius: 6,
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: 11,
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          <thead>
                            <tr style={{ background: '#F8FAFC', color: '#475569', textAlign: 'left' }}>
                              <th style={{ padding: '5px 8px', borderBottom: '1px solid #E2E8F0' }}>Iter</th>
                              <th style={{ padding: '5px 8px', borderBottom: '1px solid #E2E8F0' }}>조작변수 u</th>
                              <th style={{ padding: '5px 8px', borderBottom: '1px solid #E2E8F0' }}>측정 결과 y(u)</th>
                              <th style={{ padding: '5px 8px', borderBottom: '1px solid #E2E8F0' }}>오차 y - y*</th>
                              <th style={{ padding: '5px 8px', borderBottom: '1px solid #E2E8F0' }}>내부수렴</th>
                            </tr>
                          </thead>
                          <tbody>
                            {specSolveResult.specResults[selectedSpecLogIdx].history.map(h => (
                              <tr key={h.iter} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '4px 8px' }}>#{h.iter}</td>
                                <td style={{ padding: '4px 8px', color: '#1D4ED8' }}>
                                  {h.manipulatedValue.toFixed(5)}
                                </td>
                                <td style={{ padding: '4px 8px' }}>{h.achievedValue.toFixed(5)}</td>
                                <td style={{ padding: '4px 8px' }}>{h.error.toExponential(3)}</td>
                                <td style={{ padding: '4px 8px', color: h.flowsheetConverged ? '#059669' : '#DC2626' }}>
                                  {h.flowsheetConverged ? 'OK' : 'WARN'}
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

          {/* ════════════════════════════════════════════════════════════════════
              TAB 2: SENSITIVITY ANALYSIS (다변수 민감도 분석 & SVG 트렌드 차트)
             ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'sensitivity' && (
            <>
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: isMobile ? 10 : 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>
                  ① 독립변수 설정 (Sweep)
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)',
                    gap: 8,
                  }}
                >
                  <div>
                    <span style={labelStyle}>장치</span>
                    <select
                      value={sensPrimNodeId}
                      onChange={e => {
                        const nextId = e.target.value;
                        const nextNode = nodes.find(n => n.id === nextId);
                        const avail = getAvailableParamsForNode(nextNode);
                        const nextParam = avail.includes(sensPrimParam) ? sensPrimParam : (avail[0] ?? sensPrimParam);
                        const smart = getSmartParamDefaults(nextNode, nextParam, sensPrimComp, currentResult);
                        setSensPrimNodeId(nextId);
                        setSensPrimParam(nextParam);
                        setSensMin(smart.minBound);
                        setSensMax(smart.maxBound);
                        setSensSteps(smart.steps);
                      }}
                      style={inputStyle}
                    >
                      {nodes.map(n => (
                        <option key={n.id} value={n.id}>
                          {nodeLabelMap.get(n.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span style={labelStyle}>파라미터</span>
                    <select
                      value={sensPrimParam}
                      onChange={e => {
                        const nextParam = e.target.value as ManipulatedParamKey;
                        const primNode = nodes.find(n => n.id === sensPrimNodeId);
                        const smart = getSmartParamDefaults(primNode, nextParam, sensPrimComp, currentResult);
                        setSensPrimParam(nextParam);
                        setSensMin(smart.minBound);
                        setSensMax(smart.maxBound);
                        setSensSteps(smart.steps);
                      }}
                      style={inputStyle}
                    >
                      {(() => {
                        const primNode = nodes.find(n => n.id === sensPrimNodeId);
                        const avail = getAvailableParamsForNode(primNode);
                        const choices = avail.includes(sensPrimParam) ? avail : [...avail, sensPrimParam];
                        return choices.map(pk => (
                          <option key={pk} value={pk}>
                            {MANIPULATED_PARAM_LABELS[pk].labelKo}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                  {sensPrimParam === 'feed_comp_kgh' && (
                    <div>
                      <span style={labelStyle}>성분</span>
                      <select
                        value={sensPrimComp}
                        onChange={e => setSensPrimComp(e.target.value as SimCompKey)}
                        style={inputStyle}
                      >
                        {selectableComps.map(ck => (
                          <option key={ck} value={ck}>
                            {ck} ({COMP_META[ck].label})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <span style={labelStyle}>최소 (Min)</span>
                    <input
                      type="number"
                      step="any"
                      value={sensMin}
                      onChange={e => setSensMin(Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <span style={labelStyle}>최대 (Max)</span>
                    <input
                      type="number"
                      step="any"
                      value={sensMax}
                      onChange={e => setSensMax(Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <span style={labelStyle}>스텝 (2~30)</span>
                    <input
                      type="number"
                      min={2}
                      max={30}
                      value={sensSteps}
                      onChange={e => setSensSteps(Math.max(2, Math.min(30, Number(e.target.value) || 10)))}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Optional 2nd Variable */}
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11.5,
                      fontWeight: 800,
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={sensSecEnabled}
                      onChange={e => {
                        const enabled = e.target.checked;
                        setSensSecEnabled(enabled);
                        if (enabled) {
                          const secNode = nodes.find(n => n.id === sensSecNodeId);
                          const avail = getAvailableParamsForNode(secNode);
                          if (!avail.includes(sensSecParam)) {
                            const nextSecParam =
                              avail.find(pk => !(sensSecNodeId === sensPrimNodeId && pk === sensPrimParam)) ??
                              avail[0] ??
                              sensSecParam;
                            const smart = getSmartParamDefaults(secNode, nextSecParam, sensSecComp, currentResult);
                            setSensSecParam(nextSecParam);
                            setSensSecValuesText(smart.secValuesText);
                          }
                        }
                      }}
                    />
                    2차 변수 동시 스윕 (2D)
                  </label>
                  {sensSecEnabled && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <div>
                        <span style={labelStyle}>2차 장치</span>
                        <select
                          value={sensSecNodeId}
                          onChange={e => {
                            const nextId = e.target.value;
                            const nextNode = nodes.find(n => n.id === nextId);
                            const avail = getAvailableParamsForNode(nextNode);
                            const nextParam = avail.includes(sensSecParam)
                              ? sensSecParam
                              : (avail.find(pk => !(nextId === sensPrimNodeId && pk === sensPrimParam)) ?? avail[0] ?? sensSecParam);
                            const smart = getSmartParamDefaults(nextNode, nextParam, sensSecComp, currentResult);
                            setSensSecNodeId(nextId);
                            setSensSecParam(nextParam);
                            setSensSecValuesText(smart.secValuesText);
                          }}
                          style={inputStyle}
                        >
                          {nodes.map(n => (
                            <option key={n.id} value={n.id}>
                              {nodeLabelMap.get(n.id)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span style={labelStyle}>2차 파라미터</span>
                        <select
                          value={sensSecParam}
                          onChange={e => {
                            const nextParam = e.target.value as ManipulatedParamKey;
                            const secNode = nodes.find(n => n.id === sensSecNodeId);
                            const smart = getSmartParamDefaults(secNode, nextParam, sensSecComp, currentResult);
                            setSensSecParam(nextParam);
                            setSensSecValuesText(smart.secValuesText);
                          }}
                          style={inputStyle}
                        >
                          {(() => {
                            const secNode = nodes.find(n => n.id === sensSecNodeId);
                            const avail = getAvailableParamsForNode(secNode);
                            const choices = avail.includes(sensSecParam) ? avail : [...avail, sensSecParam];
                            return choices.map(pk => (
                              <option key={pk} value={pk}>
                                {MANIPULATED_PARAM_LABELS[pk].labelKo}
                              </option>
                            ));
                          })()}
                        </select>
                      </div>
                      {sensSecParam === 'feed_comp_kgh' && (
                        <div>
                          <span style={labelStyle}>2차 성분</span>
                          <select
                            value={sensSecComp}
                            onChange={e => setSensSecComp(e.target.value as SimCompKey)}
                            style={inputStyle}
                          >
                            {selectableComps.map(ck => (
                              <option key={ck} value={ck}>
                                {ck}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <span style={labelStyle}>값 목록 (쉼표 구분)</span>
                        <input
                          type="text"
                          value={sensSecValuesText}
                          onChange={e => setSensSecValuesText(e.target.value)}
                          placeholder="1.0, 2.5, 5.0"
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Watched Outputs */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                      ② 관측 출력 (Watched Outputs)
                    </span>
                    <button
                      type="button"
                      onClick={handleAddWatchedOutput}
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        borderRadius: 5,
                        border: '1px solid #0F766E',
                        background: '#CCFBF1',
                        color: '#0F766E',
                        cursor: 'pointer',
                      }}
                    >
                      + 출력 추가
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {watchedOutputs.map((w, wIdx) => {
                      const isUnit = !!w.unitNodeId && !w.streamEdgeId;
                      return (
                        <div
                          key={w.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile
                              ? '1fr'
                              : '90px 1.2fr 1.2fr 1fr 1.2fr auto',
                            gap: 6,
                            alignItems: 'center',
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: 6,
                            padding: 7,
                          }}
                        >
                          <select
                            value={isUnit ? 'unit' : 'stream'}
                            onChange={e => {
                              if (e.target.value === 'unit') {
                                const u0 = nodes[0];
                                updateWatchedAt(wIdx, {
                                  streamEdgeId: undefined,
                                  metric: undefined,
                                  unitNodeId: u0?.id ?? '',
                                  unitMetric: 'heat_duty_mcalh',
                                  label: `${u0?.tag ?? 'Unit'} 열부하(Mcal/h)`,
                                });
                              } else {
                                const ed0 = edges[0];
                                updateWatchedAt(wIdx, {
                                  unitNodeId: undefined,
                                  unitMetric: undefined,
                                  streamEdgeId: ed0?.id ?? '',
                                  metric: 'total_flow_kgh',
                                  label: `${ed0?.streamNo ?? 'Stream'} 총유량(kg/h)`,
                                });
                              }
                            }}
                            style={inputStyle}
                          >
                            <option value="stream">배관</option>
                            <option value="unit">장치</option>
                          </select>

                          {!isUnit ? (
                            <>
                              <select
                                value={w.streamEdgeId ?? ''}
                                onChange={e => {
                                  const ed = edges.find(x => x.id === e.target.value);
                                  updateWatchedAt(wIdx, {
                                    streamEdgeId: e.target.value,
                                    label: `${ed?.streamNo ?? ''} ${DESIGN_SPEC_STREAM_METRIC_LABELS[w.metric ?? 'total_flow_kgh'].unit}`,
                                  });
                                }}
                                style={inputStyle}
                              >
                                {edges.map(ed => (
                                  <option key={ed.id} value={ed.id}>
                                    {edgeLabelMap.get(ed.id)}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={w.metric ?? 'total_flow_kgh'}
                                onChange={e => {
                                  const mk = e.target.value as DesignSpecStreamMetric;
                                  const ed = edges.find(x => x.id === w.streamEdgeId);
                                  updateWatchedAt(wIdx, {
                                    metric: mk,
                                    comp:
                                      DESIGN_SPEC_STREAM_METRIC_LABELS[mk].needsComp && !w.comp
                                        ? defaultComp
                                        : w.comp,
                                    label: `${ed?.streamNo ?? ''} ${DESIGN_SPEC_STREAM_METRIC_LABELS[mk].labelKo}`,
                                  });
                                }}
                                style={inputStyle}
                              >
                                {(Object.keys(DESIGN_SPEC_STREAM_METRIC_LABELS) as DesignSpecStreamMetric[]).map(
                                  mk => (
                                    <option key={mk} value={mk}>
                                      {DESIGN_SPEC_STREAM_METRIC_LABELS[mk].labelKo}
                                    </option>
                                  )
                                )}
                              </select>
                              <select
                                value={w.comp ?? ''}
                                onChange={e =>
                                  updateWatchedAt(wIdx, {
                                    comp: (e.target.value || undefined) as SimCompKey | undefined,
                                  })
                                }
                                style={inputStyle}
                              >
                                <option value="">(성분 무관/전체)</option>
                                {selectableComps.map(ck => (
                                  <option key={ck} value={ck}>
                                    {ck}
                                  </option>
                                ))}
                              </select>
                            </>
                          ) : (
                            <>
                              <select
                                value={w.unitNodeId ?? ''}
                                onChange={e => {
                                  const nd = nodes.find(x => x.id === e.target.value);
                                  updateWatchedAt(wIdx, {
                                    unitNodeId: e.target.value,
                                    label: `${nd?.tag ?? ''} ${DESIGN_SPEC_UNIT_METRIC_LABELS[w.unitMetric ?? 'heat_duty_mcalh'].labelKo}`,
                                  });
                                }}
                                style={inputStyle}
                              >
                                {nodes.map(n => (
                                  <option key={n.id} value={n.id}>
                                    {nodeLabelMap.get(n.id)}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={w.unitMetric ?? 'heat_duty_mcalh'}
                                onChange={e => {
                                  const uk = e.target.value as DesignSpecUnitMetric;
                                  const nd = nodes.find(x => x.id === w.unitNodeId);
                                  updateWatchedAt(wIdx, {
                                    unitMetric: uk,
                                    label: `${nd?.tag ?? ''} ${DESIGN_SPEC_UNIT_METRIC_LABELS[uk].labelKo}`,
                                  });
                                }}
                                style={inputStyle}
                              >
                                {(Object.keys(DESIGN_SPEC_UNIT_METRIC_LABELS) as DesignSpecUnitMetric[]).map(
                                  uk => (
                                    <option key={uk} value={uk}>
                                      {DESIGN_SPEC_UNIT_METRIC_LABELS[uk].labelKo}
                                    </option>
                                  )
                                )}
                              </select>
                              <div style={{ fontSize: 10.5, color: '#94A3B8', textAlign: 'center' }}>-</div>
                            </>
                          )}

                          <input
                            type="text"
                            value={w.label}
                            onChange={e => updateWatchedAt(wIdx, { label: e.target.value })}
                            placeholder="범례명"
                            style={inputStyle}
                          />

                          <button
                            type="button"
                            onClick={() => setWatchedOutputs(prev => prev.filter((_, i) => i !== wIdx))}
                            style={{
                              padding: '4px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 4,
                              border: '1px solid #FCA5A5',
                              background: '#FEF2F2',
                              color: '#B91C1C',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleRunSensitivity}
                    style={{
                      padding: '9px 18px',
                      fontSize: 12.5,
                      fontWeight: 800,
                      borderRadius: 7,
                      border: 'none',
                      background: '#0F766E',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(15,118,110,0.28)',
                    }}
                  >
                    ▶ 민감도 실행 ({sensSteps} Steps)
                  </button>

                  {sensResult && (
                    <button
                      type="button"
                      onClick={handleExportSensitivityCsv}
                      style={{
                        padding: '8px 14px',
                        fontSize: 11.5,
                        fontWeight: 800,
                        borderRadius: 6,
                        border: '1px solid #334155',
                        background: '#FFFFFF',
                        color: '#0F172A',
                        cursor: 'pointer',
                      }}
                    >
                      📥 {csvCopied ? '복사 · CSV 저장 완료' : 'CSV 내보내기'}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline SVG Multi-Axis Trend Chart + Data Table */}
              {sensResult && watchedOutputs.length > 0 && (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                      민감도 트렌드 ({sensResult.flatRows.length} pts · {sensResult.elapsedMs} ms)
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B' }}>
                      좌축: {watchedOutputs[0]?.label}
                      {watchedOutputs[1] && !sensSecEnabled ? ` | 우축: ${watchedOutputs[1].label}` : ''}
                    </span>
                  </div>

                  <SensitivitySvgChart
                    sensResult={sensResult}
                    watchedOutputs={watchedOutputs}
                    xLabel={MANIPULATED_PARAM_LABELS[sensPrimParam].labelKo}
                  />

                  <div style={{ overflowX: 'auto', maxHeight: 240, border: '1px solid #E2E8F0', borderRadius: 6 }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 11,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#334155', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>#</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>
                            {MANIPULATED_PARAM_LABELS[sensPrimParam].labelKo}
                          </th>
                          {sensResult.secondaryValues[0] !== null && (
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>2차변수</th>
                          )}
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #CBD5E1' }}>수렴</th>
                          {watchedOutputs.map((w, i) => (
                            <th
                              key={w.id}
                              style={{
                                padding: '6px 8px',
                                borderBottom: '1px solid #CBD5E1',
                                color: CHART_COLORS[i % CHART_COLORS.length],
                              }}
                            >
                              {w.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sensResult.flatRows.map((r, rIdx) => (
                          <tr key={rIdx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '5px 8px' }}>{rIdx + 1}</td>
                            <td style={{ padding: '5px 8px', fontWeight: 700 }}>{r.primaryValue.toFixed(4)}</td>
                            {sensResult.secondaryValues[0] !== null && (
                              <td style={{ padding: '5px 8px' }}>{r.secondaryValue}</td>
                            )}
                            <td style={{ padding: '5px 8px', color: r.converged ? '#059669' : '#DC2626' }}>
                              {r.converged ? `OK (${r.iterations})` : `FAIL (${r.iterations})`}
                            </td>
                            {watchedOutputs.map(w => (
                              <td key={w.id} style={{ padding: '5px 8px' }}>
                                {(r.outputs[w.id] ?? 0).toFixed(4)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              TAB 3: TEAR SOLVER SETTINGS (Wegstein vs Simultaneous Broyden)
             ════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'tear_solver' && (
            <>
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: isMobile ? 12 : 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                  Tear 수렴 알고리즘
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)',
                    gap: 8,
                  }}
                >
                  {(
                    [
                      {
                        key: 'auto',
                        title: 'AUTO 자동 선택 (권장)',
                        desc: '단일 루프 Wegstein · 다중 루프(≥2 Tear) 동시 Broyden',
                      },
                      {
                        key: 'broyden',
                        title: 'Broyden 동시 준뉴턴',
                        desc: '결합 Tear 상태벡터 · Sherman–Morrison 역야코비안 갱신',
                      },
                      {
                        key: 'wegstein',
                        title: 'Bounded Wegstein',
                        desc: 'Rayleigh q ∈ [-5, 0] · 양수 보존 가드 가속',
                      },
                      {
                        key: 'direct',
                        title: '감쇠 직접치환 (Direct)',
                        desc: '순차 대입 · 진동 시 q=0.5 감쇠',
                      },
                    ] as { key: TearSolverMethod; title: string; desc: string }[]
                  ).map(opt => {
                    const selected = tearMethod === opt.key;
                    return (
                      <div
                        key={opt.key}
                        onClick={() => onChangeTearMethod(opt.key)}
                        style={{
                          padding: 11,
                          borderRadius: 8,
                          border: selected ? '2px solid #1D4ED8' : '1px solid #CBD5E1',
                          background: selected ? '#EFF6FF' : '#F8FAFC',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, color: selected ? '#1E3A8A' : '#0F172A' }}>
                          {selected ? '● ' : '○ '}
                          {opt.title}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.4 }}>{opt.desc}</div>
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1.4fr',
                    gap: 10,
                    alignItems: 'end',
                  }}
                >
                  <div>
                    <span style={labelStyle}>상대 허용오차 (Rel Tol)</span>
                    <select
                      value={String(relTolInput)}
                      onChange={e => setRelTolInput(Number(e.target.value))}
                      style={inputStyle}
                    >
                      <option value="0.001">1e-3 (빠른 검토)</option>
                      <option value="0.0001">1e-4 (표준 설계)</option>
                      <option value="0.00001">1e-5 (고정밀 수지)</option>
                      <option value="0.000001">1e-6 (초정밀 검증)</option>
                    </select>
                  </div>
                  <div>
                    <span style={labelStyle}>최대 반복수 (Max Iter)</span>
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={maxIterInput}
                      onChange={e => setMaxIterInput(Math.max(10, Math.min(300, Number(e.target.value) || 80)))}
                      style={inputStyle}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRunTearBenchmark}
                    style={{
                      padding: '9px 14px',
                      fontSize: 12,
                      fontWeight: 800,
                      borderRadius: 7,
                      border: 'none',
                      background: '#1E3A8A',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ Wegstein vs Broyden 비교
                  </button>
                </div>

                {/* Current Tear Stream Residual Inspection */}
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 7,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
                    현재 Tear 잔차 진단 ({currentResult.convergence.solverMethodLabel})
                  </div>
                  {currentResult.convergence.tearEdgeIds.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: '#64748B' }}>
                      순환 루프 없음 (Direct DAG 1패스 해석)
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#E2E8F0', color: '#334155', textAlign: 'left' }}>
                            <th style={{ padding: '5px 8px' }}>Tear 배관</th>
                            <th style={{ padding: '5px 8px' }}>질량 절대잔차(kg/h)</th>
                            <th style={{ padding: '5px 8px' }}>질량 상대잔차</th>
                            <th style={{ padding: '5px 8px' }}>온도 잔차(°C)</th>
                            <th style={{ padding: '5px 8px' }}>엔탈피 상대잔차</th>
                            <th style={{ padding: '5px 8px' }}>판정</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(currentResult.convergence.tearResiduals ?? []).map(tr => (
                            <tr key={tr.edgeId} style={{ borderBottom: '1px solid #E2E8F0' }}>
                              <td style={{ padding: '5px 8px', fontWeight: 700 }}>{tr.streamNo}</td>
                              <td style={{ padding: '5px 8px' }}>{tr.massAbsKgH}</td>
                              <td style={{ padding: '5px 8px' }}>{tr.massRel.toExponential(2)}</td>
                              <td style={{ padding: '5px 8px' }}>{tr.tempAbsC}</td>
                              <td style={{ padding: '5px 8px' }}>{tr.enthalpyRel.toExponential(2)}</td>
                              <td
                                style={{
                                  padding: '5px 8px',
                                  fontWeight: 800,
                                  color: tr.withinTolerance ? '#059669' : '#DC2626',
                                }}
                              >
                                {tr.withinTolerance ? 'CONVERGED' : 'EXCEEDED'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Side-by-side Wegstein vs Broyden Benchmark */}
                {tearBenchmark && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                      gap: 10,
                    }}
                  >
                    {(
                      [
                        { label: 'Bounded Wegstein', data: tearBenchmark.wegstein, color: '#D97706' },
                        { label: 'Simultaneous Broyden', data: tearBenchmark.broyden, color: '#1D4ED8' },
                      ] as const
                    ).map(card => {
                      const c = card.data.res.convergence;
                      return (
                        <div
                          key={card.label}
                          style={{
                            border: `1.5px solid ${card.color}`,
                            borderRadius: 8,
                            padding: 12,
                            background: '#FFFFFF',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 6,
                            }}
                          >
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: card.color }}>
                              {card.label}
                            </span>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 800,
                                padding: '2px 7px',
                                borderRadius: 99,
                                background: c.converged ? '#DCFCE7' : '#FEE2E2',
                                color: c.converged ? '#166534' : '#991B1B',
                              }}
                            >
                              {c.converged ? '수렴 완료' : '미수렴'} · {c.iterations}회 ({card.data.ms} ms)
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                            최대 질량잔차: {c.maxResidualKgH} kg/h · 진단: {c.recycleDiagnosis ?? 'none'}
                          </div>
                          {c.iterationHistory && c.iterationHistory.length > 0 && (
                            <div
                              style={{
                                marginTop: 8,
                                maxHeight: 130,
                                overflowY: 'auto',
                                fontSize: 10.5,
                                fontFamily: 'JetBrains Mono, monospace',
                                background: '#F8FAFC',
                                padding: 6,
                                borderRadius: 5,
                              }}
                            >
                              {c.iterationHistory.map(h => (
                                <div key={h.iter}>
                                  #{h.iter}: rel={h.maxTearRel.toExponential(2)} · step={h.step}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pure Inline-SVG Multi-Axis / Multi-Series Sensitivity Chart
 */
function SensitivitySvgChart({
  sensResult,
  watchedOutputs,
  xLabel,
}: {
  sensResult: SensitivityAnalysisResult;
  watchedOutputs: SensitivityWatchedOutput[];
  xLabel: string;
}) {
  const W = 760;
  const H = 270;
  const padL = 62;
  const padR = 62;
  const padT = 22;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xVals = sensResult.primaryValues;
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const xSpan = Math.max(1e-9, xMax - xMin);
  const toX = (v: number) => padL + ((v - xMin) / xSpan) * plotW;

  const isMultiFamily = sensResult.series.length > 1;
  const leftOutput = watchedOutputs[0];
  const rightOutput = !isMultiFamily && watchedOutputs.length >= 2 ? watchedOutputs[1] : null;

  // Gather Left Axis range
  const leftVals: number[] = [];
  for (const s of sensResult.series) {
    for (const r of s.rows) {
      if (leftOutput) leftVals.push(r.outputs[leftOutput.id] ?? 0);
      if (!isMultiFamily && watchedOutputs.length > 2) {
        for (let k = 2; k < watchedOutputs.length; k++) {
          leftVals.push(r.outputs[watchedOutputs[k].id] ?? 0);
        }
      }
    }
  }
  const lMinRaw = leftVals.length > 0 ? Math.min(...leftVals) : 0;
  const lMaxRaw = leftVals.length > 0 ? Math.max(...leftVals) : 1;
  const lPad = Math.max(1e-6, (lMaxRaw - lMinRaw) * 0.08 || Math.abs(lMaxRaw) * 0.05 || 1);
  const lMin = lMinRaw - lPad;
  const lMax = lMaxRaw + lPad;
  const toYLeft = (v: number) => padT + plotH - ((v - lMin) / Math.max(1e-9, lMax - lMin)) * plotH;

  // Gather Right Axis range (when 1D sweep with >=2 watched outputs)
  const rightVals: number[] = [];
  if (rightOutput) {
    for (const r of sensResult.series[0]?.rows ?? []) {
      rightVals.push(r.outputs[rightOutput.id] ?? 0);
    }
  }
  const rMinRaw = rightVals.length > 0 ? Math.min(...rightVals) : 0;
  const rMaxRaw = rightVals.length > 0 ? Math.max(...rightVals) : 1;
  const rPad = Math.max(1e-6, (rMaxRaw - rMinRaw) * 0.08 || Math.abs(rMaxRaw) * 0.05 || 1);
  const rMin = rMinRaw - rPad;
  const rMax = rMaxRaw + rPad;
  const toYRight = (v: number) => padT + plotH - ((v - rMin) / Math.max(1e-9, rMax - rMin)) * plotH;

  // Build curve polylines
  const curves: { label: string; color: string; points: { x: number; y: number; ok: boolean }[] }[] = [];
  if (isMultiFamily && leftOutput) {
    sensResult.series.forEach((ser, sIdx) => {
      curves.push({
        label: `${leftOutput.label} (${ser.secondaryLabel})`,
        color: CHART_COLORS[sIdx % CHART_COLORS.length],
        points: ser.rows.map(r => ({
          x: toX(r.primaryValue),
          y: toYLeft(r.outputs[leftOutput.id] ?? 0),
          ok: r.converged,
        })),
      });
    });
  } else if (sensResult.series[0]) {
    watchedOutputs.forEach((wo, wIdx) => {
      const useRight = wIdx === 1 && !!rightOutput;
      curves.push({
        label: `${wo.label}${useRight ? ' (우축)' : ''}`,
        color: CHART_COLORS[wIdx % CHART_COLORS.length],
        points: sensResult.series[0].rows.map(r => ({
          x: toX(r.primaryValue),
          y: useRight ? toYRight(r.outputs[wo.id] ?? 0) : toYLeft(r.outputs[wo.id] ?? 0),
          ok: r.converged,
        })),
      });
    });
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: 300,
          background: '#F8FAFC',
          borderRadius: 6,
          border: '1px solid #E2E8F0',
        }}
      >
        {/* Horizontal Gridlines & Left Y Ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padT + plotH * (1 - frac);
          const lVal = lMin + frac * (lMax - lMin);
          const rVal = rMin + frac * (rMax - rMin);
          return (
            <g key={frac}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E2E8F0" strokeWidth={1} />
              <text x={padL - 6} y={y + 3.5} fontSize={9.5} fill="#1D4ED8" textAnchor="end">
                {lVal.toFixed(Math.abs(lVal) >= 100 ? 0 : 2)}
              </text>
              {rightOutput && (
                <text x={W - padR + 6} y={y + 3.5} fontSize={9.5} fill="#059669" textAnchor="start">
                  {rVal.toFixed(Math.abs(rVal) >= 100 ? 0 : 2)}
                </text>
              )}
            </g>
          );
        })}

        {/* X Axis Ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const x = padL + frac * plotW;
          const xv = xMin + frac * xSpan;
          return (
            <g key={frac}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#F1F5F9" strokeWidth={1} />
              <text x={x} y={padT + plotH + 15} fontSize={9.5} fill="#334155" textAnchor="middle">
                {xv.toFixed(Math.abs(xv) >= 100 ? 1 : 2)}
              </text>
            </g>
          );
        })}

        {/* Plot Border */}
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={1.2}
        />

        {/* X Axis Label */}
        <text x={padL + plotW / 2} y={H - 6} fontSize={10.5} fontWeight={700} fill="#0F172A" textAnchor="middle">
          {xLabel}
        </text>

        {/* Curves */}
        {curves.map(c => (
          <g key={c.label}>
            <polyline
              fill="none"
              stroke={c.color}
              strokeWidth={2.2}
              points={c.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            />
            {c.points.map((p, idx) => (
              <circle
                key={idx}
                cx={p.x}
                cy={p.y}
                r={p.ok ? 3.2 : 4.2}
                fill={p.ok ? c.color : '#EF4444'}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            ))}
          </g>
        ))}

        {/* Legend */}
        {curves.slice(0, 4).map((c, idx) => (
          <g key={c.label} transform={`translate(${padL + idx * 165}, 13)`}>
            <line x1={0} y1={0} x2={14} y2={0} stroke={c.color} strokeWidth={2.5} />
            <text x={18} y={3.5} fontSize={9.5} fontWeight={700} fill="#1E293B">
              {c.label.length > 22 ? `${c.label.slice(0, 22)}…` : c.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

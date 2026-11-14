'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MW } from '../../lib/calculations/constants';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';
import {
  PROPERTY_METHOD_INFO,
  type ResolvedPropertyMethod,
} from '../../lib/calculations/componentCatalog';
import {
  ALL_REACTOR_COMPS,
  INDUSTRIAL_REACTION_TEMPLATES,
  calcReactionStdThermo,
  checkStoichiometryBalance,
  solveChemicalReactor,
  type ReactorAxialPoint,
  type ReactorConfig,
  type ReactorModelType,
  type ReactorThermalMode,
  type StoicReactionSpec,
} from '../../lib/calculations/chemicalReactor';

export interface ReactorWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  unitTag: string;
  unitName: string;
  inletFlowsKgH: Partial<Record<SimCompKey, number>>;
  inletTempC: number;
  inletPressKgcm2g: number;
  activeComponents: SimCompKey[];
  propertyMethod: ResolvedPropertyMethod;
  initialConfig?: ReactorConfig;
  onApplyConfig: (cfg: ReactorConfig) => void;
}

const MONO = 'JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace';

const MODEL_TABS: Array<{
  key: ReactorModelType;
  labelKo: string;
  shortTag: string;
  descKo: string;
}> = [
  {
    key: 'stoic',
    labelKo: '양론 전환',
    shortTag: 'STOIC',
    descKo: '화학양론 계수(ν_i)와 기준 반응물 전환율(X) 지정',
  },
  {
    key: 'equilibrium',
    labelKo: '화학 평형',
    shortTag: 'EQUIL',
    descKo: 'ΔG°(T) 기반 Keq(T) 및 실제기체(φ_i)·액상(γ_i) 평형',
  },
  {
    key: 'gibbs',
    labelKo: '깁스 최소화',
    shortTag: 'GIBBS',
    descKo: '반응식 없이 원소 보존 하 총 Gibbs 자유에너지 최소화',
  },
  {
    key: 'cstr',
    labelKo: '연속교반 CSTR',
    shortTag: 'CSTR',
    descKo: '완전혼합 체류시간(V) + Arrhenius 속도식 + 자켓 UA',
  },
  {
    key: 'pfr',
    labelKo: '관형 PFR',
    shortTag: 'PFR',
    descKo: '60-구간 RK4 축방향 T(z)·X(z)·P(z) + Ergun 압력강하',
  },
];

const THERMAL_OPTIONS: Array<{ key: ReactorThermalMode; labelKo: string }> = [
  { key: 'isothermal', labelKo: '등온 운전 (T 지정)' },
  { key: 'adiabatic', labelKo: '단열 운전 (Q = 0)' },
  { key: 'specified_duty', labelKo: '열부하 지정 (Q 지정)' },
  { key: 'jacket_ua', labelKo: '열매체 자켓 (UA 열전달)' },
];

function cloneConfig(
  cfg: ReactorConfig | undefined,
  inletTempC: number,
  inletPressKgcm2g: number,
  propMethod: ResolvedPropertyMethod,
  activeComps: SimCompKey[]
): ReactorConfig {
  if (!cfg) {
    return {
      model: 'stoic',
      thermalMode: 'adiabatic',
      operTempC: inletTempC,
      operPressKgcm2g: inletPressKgcm2g,
      phaseMode: 'vle',
      propertyMethod: propMethod,
      volumeM3: 4.0,
      tubeCount: 1,
      tubeDiamM: 0.8,
      tubeLengthM: 8.0,
      jacketTempC: inletTempC,
      overallU_KcalM2HC: 200,
      catalystVoidage: 0.42,
      particleDiamMm: 0,
      gibbsSpeciesPool: [...activeComps],
      gibbsInertSet: [],
      reactions: [
        {
          id: 'R1',
          name: '주반응 1',
          stoic: { H2: -1, Cl2: -1, HCl: 2 },
          keyComp: 'Cl2',
          conversion: 0.99,
          k0Forward: 1.0e4,
          EaForwardKJmol: 60,
          reversible: false,
        },
      ],
    };
  }
  return {
    ...cfg,
    propertyMethod: cfg.propertyMethod ?? propMethod,
    phaseMode: cfg.phaseMode ?? 'vle',
    gibbsSpeciesPool: cfg.gibbsSpeciesPool ? [...cfg.gibbsSpeciesPool] : [...activeComps],
    gibbsInertSet: cfg.gibbsInertSet ? [...cfg.gibbsInertSet] : [],
    reactions: (cfg.reactions ?? []).map((r) => ({
      ...r,
      stoic: { ...r.stoic },
      keqOverride: r.keqOverride ? { ...r.keqOverride } : undefined,
      ordersForward: r.ordersForward ? { ...r.ordersForward } : undefined,
      ordersReverse: r.ordersReverse ? { ...r.ordersReverse } : undefined,
    })),
  };
}

function formatEquation(stoic: Partial<Record<SimCompKey, number>>, reversible?: boolean): string {
  const lhs: string[] = [];
  const rhs: string[] = [];
  for (const [k, nu] of Object.entries(stoic) as [SimCompKey, number][]) {
    if (!nu) continue;
    const absNu = Math.abs(nu);
    const coef = absNu === 1 ? '' : `${Number(absNu.toFixed(3))} `;
    if (nu < 0) lhs.push(`${coef}${k}`);
    else rhs.push(`${coef}${k}`);
  }
  const arrow = reversible ? '⇌' : '→';
  if (lhs.length === 0 && rhs.length === 0) return '(화학양론 계수 미입력)';
  return `${lhs.join(' + ') || '∅'} ${arrow} ${rhs.join(' + ') || '∅'}`;
}

function buildSampleFeedForConfig(cfg: ReactorConfig): Partial<Record<SimCompKey, number>> {
  const sample: Partial<Record<SimCompKey, number>> = {};
  const rxns = cfg.reactions ?? [];
  if (rxns.length > 0) {
    for (const rxn of rxns) {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu && nu < 0) {
          const mw = (MW as Record<string, number>)[k] ?? 40;
          const kmol = Math.max(50, Math.abs(nu) * 80);
          sample[k] = Math.max(sample[k] ?? 0, kmol * mw);
        }
      }
    }
  }
  if (Object.keys(sample).length === 0 && cfg.gibbsSpeciesPool) {
    for (const k of cfg.gibbsSpeciesPool.slice(0, 2)) {
      const mw = (MW as Record<string, number>)[k] ?? 30;
      sample[k] = 80 * mw;
    }
  }
  return sample;
}

// ── PFR 축방향 프로파일 인라인 SVG 차트 컴포넌트 ──────────────────────────────

function PfrAxialSvgChart({
  profile,
  hotspotTempC,
}: {
  profile: ReactorAxialPoint[];
  hotspotTempC?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!profile || profile.length < 2) return null;

  const W = 520;
  const H = 205;
  const padL = 44;
  const padR = 44;
  const padT = 22;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const temps = profile.map((p) => p.tempC);
  const press = profile.map((p) => p.pressKgcm2g);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const tSpan = Math.max(2, tMax - tMin);
  const pMin = Math.min(...press);
  const pMax = Math.max(...press);
  const pSpan = Math.max(0.05, pMax - pMin);

  const xOf = (zFrac: number) => padL + zFrac * plotW;
  const yTemp = (t: number) => padT + plotH - ((t - (tMin - 0.08 * tSpan)) / (1.16 * tSpan)) * plotH;
  const yConv = (x: number) => padT + plotH - Math.max(0, Math.min(1, x)) * plotH;
  const yPress = (p: number) => padT + plotH - ((p - (pMin - 0.08 * pSpan)) / (1.16 * pSpan)) * plotH;

  const tempPoints = profile.map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yTemp(pt.tempC).toFixed(1)}`).join(' ');
  const convPoints = profile
    .map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yConv(pt.conversion).toFixed(1)}`)
    .join(' ');
  const pressPoints = profile
    .map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yPress(pt.pressKgcm2g).toFixed(1)}`)
    .join(' ');

  let hotNode = profile[0];
  for (const pt of profile) {
    if (pt.tempC > hotNode.tempC) hotNode = pt;
  }

  const activeNode = hoverIdx !== null ? profile[hoverIdx] : hotNode;

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 9,
        border: '1px solid #CBD5E1',
        background: '#F8FAFC',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44' }}>
          관형 PFR 축방향 프로파일 (60-Step RK4)
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>
          <span style={{ color: '#1D4ED8' }}>● T(z) 온도 [°C]</span>
          <span style={{ color: '#0D9488' }}>● X(z) 전환율 [%]</span>
          <span style={{ color: '#D97706' }}>-- P(z) 압력 [kg/cm²g]</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
          const z = Math.max(0, Math.min(1, (relX - padL) / plotW));
          const idx = Math.round(z * (profile.length - 1));
          setHoverIdx(Math.max(0, Math.min(profile.length - 1, idx)));
        }}
      >
        {/* 배경 격자 */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((g) => {
          const gy = padT + (1 - g) * plotH;
          return (
            <g key={g}>
              <line
                x1={padL}
                y1={gy}
                x2={W - padR}
                y2={gy}
                stroke="#E2E8F0"
                strokeWidth={1}
              />
              <text
                x={W - padR + 5}
                y={gy + 3.5}
                fontSize={9.5}
                fill="#0D9488"
                fontFamily={MONO}
                fontWeight={700}
              >
                {(g * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* 좌측 온도 눈금 */}
        <text x={4} y={padT + 6} fontSize={9.5} fill="#1D4ED8" fontFamily={MONO} fontWeight={700}>
          {tMax.toFixed(0)}°
        </text>
        <text x={4} y={padT + plotH} fontSize={9.5} fill="#1D4ED8" fontFamily={MONO} fontWeight={700}>
          {tMin.toFixed(0)}°
        </text>

        {/* X축 z/L 눈금 */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((zf) => (
          <text
            key={zf}
            x={xOf(zf)}
            y={H - 8}
            textAnchor="middle"
            fontSize={9.5}
            fill="#475569"
            fontFamily={MONO}
            fontWeight={700}
          >
            z/L={zf.toFixed(2)}
          </text>
        ))}

        {/* 압력 곡선 */}
        <polyline
          fill="none"
          stroke="#D97706"
          strokeWidth={1.8}
          strokeDasharray="5,3"
          points={pressPoints}
        />

        {/* 전환율 곡선 */}
        <polyline fill="none" stroke="#0D9488" strokeWidth={2.3} points={convPoints} />

        {/* 온도 곡선 */}
        <polyline fill="none" stroke="#1D4ED8" strokeWidth={2.5} points={tempPoints} />

        {/* Hotspot 마커 */}
        {hotspotTempC !== undefined && (
          <g>
            <circle
              cx={xOf(hotNode.zFrac)}
              cy={yTemp(hotNode.tempC)}
              r={4.5}
              fill="#1D4ED8"
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
            <text
              x={Math.min(W - padR - 55, Math.max(padL + 4, xOf(hotNode.zFrac) - 22))}
              y={Math.max(13, yTemp(hotNode.tempC) - 7)}
              fontSize={9.5}
              fill="#1E3A8A"
              fontFamily={MONO}
              fontWeight={800}
            >
              Tmax {hotNode.tempC.toFixed(1)}°C
            </text>
          </g>
        )}

        {/* 호버 수직 가이드 */}
        {hoverIdx !== null && activeNode && (
          <line
            x1={xOf(activeNode.zFrac)}
            y1={padT}
            x2={xOf(activeNode.zFrac)}
            y2={padT + plotH}
            stroke="#64748B"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}
      </svg>

      {activeNode && (
        <div
          style={{
            marginTop: 5,
            padding: '4px 8px',
            borderRadius: 6,
            background: '#EFF6FF',
            fontSize: 11,
            fontFamily: MONO,
            fontWeight: 700,
            color: '#1E3A8A',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span>
            z = {activeNode.lengthM.toFixed(2)} m ({(activeNode.zFrac * 100).toFixed(0)}%)
          </span>
          <span>T = {activeNode.tempC.toFixed(2)} °C</span>
          <span>X = {(activeNode.conversion * 100).toFixed(2)} %</span>
          <span>P = {activeNode.pressKgcm2g.toFixed(3)} kg/cm²g</span>
          <span>F_tot = {activeNode.totalMolarKmolH.toFixed(2)} kmol/h</span>
        </div>
      )}
    </div>
  );
}

// ── 메인 반응기 워크벤치 모달 ────────────────────────────────────────────────

export function ReactorWorkbenchModal({
  open,
  onClose,
  unitTag,
  unitName,
  inletFlowsKgH,
  inletTempC,
  inletPressKgcm2g,
  activeComponents,
  propertyMethod,
  initialConfig,
  onApplyConfig,
}: ReactorWorkbenchModalProps) {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [cfg, setCfg] = useState<ReactorConfig>(() =>
    cloneConfig(initialConfig, inletTempC, inletPressKgcm2g, propertyMethod, activeComponents)
  );
  const [useSampleFeed, setUseSampleFeed] = useState<boolean>(false);
  const [compToAddByRxn, setCompToAddByRxn] = useState<Record<string, SimCompKey>>({});
  const pushedHistoryRef = useRef(false);

  // 초기 설정 동기화
  useEffect(() => {
    if (open) {
      const next = cloneConfig(
        initialConfig,
        inletTempC,
        inletPressKgcm2g,
        propertyMethod,
        activeComponents
      );
      setCfg(next);
      let liveSum = 0;
      for (const v of Object.values(inletFlowsKgH)) liveSum += v ?? 0;
      setUseSampleFeed(liveSum <= 1e-9);
    }
  }, [open, initialConfig, inletTempC, inletPressKgcm2g, propertyMethod, activeComponents, inletFlowsKgH]);

  // 반응형 브레이크포인트 감지
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape 키 및 모바일 브라우저 뒤로가기(popstate) 지원
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    window.history.pushState({ reactorWorkbenchModal: true }, '');
    pushedHistoryRef.current = true;

    const onPopState = () => {
      pushedHistoryRef.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        window.history.back();
      }
    };
  }, [open, onClose]);

  const selectableComponents = useMemo<SimCompKey[]>(() => {
    const set = new Set<SimCompKey>(activeComponents);
    for (const [k, m] of Object.entries(inletFlowsKgH) as [SimCompKey, number][]) {
      if ((m ?? 0) > 0) set.add(k);
    }
    for (const rxn of cfg.reactions ?? []) {
      for (const k of Object.keys(rxn.stoic) as SimCompKey[]) set.add(k);
    }
    for (const k of cfg.gibbsSpeciesPool ?? []) set.add(k);
    const prioritized = Array.from(set);
    for (const k of ALL_REACTOR_COMPS) {
      if (!set.has(k)) prioritized.push(k);
    }
    return prioritized;
  }, [activeComponents, inletFlowsKgH, cfg.reactions, cfg.gibbsSpeciesPool]);

  const previewFeed = useMemo<Partial<Record<SimCompKey, number>>>(() => {
    if (useSampleFeed) return buildSampleFeedForConfig(cfg);
    return inletFlowsKgH;
  }, [useSampleFeed, cfg, inletFlowsKgH]);

  const previewTempC = useSampleFeed ? (cfg.operTempC ?? inletTempC) : inletTempC;
  const previewPressG = useSampleFeed ? (cfg.operPressKgcm2g ?? inletPressKgcm2g) : inletPressKgcm2g;

  const liveResult = useMemo(() => {
    return solveChemicalReactor(previewFeed, previewTempC, previewPressG, cfg);
  }, [previewFeed, previewTempC, previewPressG, cfg]);

  if (!open) return null;

  const applyTemplate = (tplId: string) => {
    const tpl = INDUSTRIAL_REACTION_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const cloned = cloneConfig(
      tpl.defaultConfig,
      inletTempC,
      inletPressKgcm2g,
      tpl.defaultConfig.propertyMethod ?? propertyMethod,
      activeComponents
    );
    setCfg(cloned);
    // 실제 피드에 해당 반응물이 없으면 자동으로 샘플 피드 프리뷰 활성화
    let hasReactantInLive = false;
    for (const rxn of cloned.reactions ?? []) {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu && nu < 0 && (inletFlowsKgH[k] ?? 0) > 1e-6) {
          hasReactantInLive = true;
        }
      }
    }
    if (!hasReactantInLive) setUseSampleFeed(true);
  };

  const updateReaction = (idx: number, patch: Partial<StoicReactionSpec>) => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, reactions: list };
    });
  };

  const updateStoicCoef = (rxnIdx: number, comp: SimCompKey, nuVal: number) => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      const nextStoic = { ...(list[rxnIdx].stoic ?? {}) };
      if (!Number.isFinite(nuVal) || Math.abs(nuVal) < 1e-12) {
        delete nextStoic[comp];
      } else {
        nextStoic[comp] = nuVal;
      }
      list[rxnIdx] = { ...list[rxnIdx], stoic: nextStoic };
      return { ...prev, reactions: list };
    });
  };

  const addReaction = () => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      const nextId = `R${list.length + 1}`;
      const c1 = activeComponents[0] ?? 'CO';
      const c2 = activeComponents[1] ?? 'H2O';
      list.push({
        id: nextId,
        name: `반응 ${list.length + 1}`,
        stoic: { [c1]: -1, [c2]: 1 },
        keyComp: c1,
        conversion: 0.8,
        k0Forward: 1e4,
        EaForwardKJmol: 60,
        reversible: false,
      });
      return { ...prev, reactions: list };
    });
  };

  const removeReaction = (idx: number) => {
    setCfg((prev) => {
      const list = (prev.reactions ?? []).filter((_, i) => i !== idx);
      return { ...prev, reactions: list };
    });
  };

  const toggleGibbsPoolComp = (comp: SimCompKey) => {
    setCfg((prev) => {
      const pool = new Set<SimCompKey>(prev.gibbsSpeciesPool ?? []);
      if (pool.has(comp)) pool.delete(comp);
      else pool.add(comp);
      return { ...prev, gibbsSpeciesPool: Array.from(pool) };
    });
  };

  const toggleGibbsInertComp = (comp: SimCompKey) => {
    setCfg((prev) => {
      const inerts = new Set<SimCompKey>(prev.gibbsInertSet ?? []);
      if (inerts.has(comp)) inerts.delete(comp);
      else inerts.add(comp);
      return { ...prev, gibbsInertSet: Array.from(inerts) };
    });
  };

  // 입출구 스트림 비교 행 데이터
  const streamRows = ALL_REACTOR_COMPS.filter(
    (k) => (previewFeed[k] ?? 0) > 1e-8 || (liveResult.outletFlowsKgH[k] ?? 0) > 1e-8
  );
  let totOutMoles = 0;
  for (const k of streamRows) {
    totOutMoles += (liveResult.outletFlowsKgH[k] ?? 0) / ((MW as Record<string, number>)[k] ?? 40);
  }

  const inputStyle: React.CSSProperties = {
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

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 800,
    color: '#475569',
    marginBottom: 4,
  };

  const cardStyle: React.CSSProperties = {
    padding: isMobile ? '10px 11px' : '12px 14px',
    borderRadius: 9,
    border: '1px solid #E2E8F0',
    background: '#FFFFFF',
  };

  const isKinetic = cfg.model === 'cstr' || cfg.model === 'pfr';
  const dutyKW = liveResult.heatDutyKcalH / 860.42;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? '100vw' : 'min(1260px, 96vw)',
          height: isMobile ? '100dvh' : 'min(880px, 93vh)',
          background: '#F8FAFC',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid #CBD5E1',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.38)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#1A2F44',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* ── 상단 고정 헤더 (Deep Industrial Navy) ── */}
        <div
          style={{
            background: '#1A2F44',
            color: '#FFFFFF',
            padding: isMobile ? '10px 12px' : '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#2563EB',
                  fontSize: 11,
                  fontWeight: 900,
                  fontFamily: MONO,
                }}
              >
                {unitTag}
              </span>
              <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 900 }}>
                범용 화학 반응기 워크벤치 — {unitName}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: liveResult.converged ? '#059669' : '#D97706',
                  fontSize: 10.5,
                  fontWeight: 800,
                  fontFamily: MONO,
                }}
              >
                {liveResult.converged ? 'CONVERGED' : 'CHECK SPEC'}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#93C5FD', marginTop: 3 }}>
              양론 · 화학평형(Keq) · Gibbs 자유에너지 최소화 · CSTR · 다관식 충전층 PFR 통합 해석기
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: isMobile ? '6px 11px' : '6px 12px',
              height: 32,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.42)',
              background: '#142435',
              color: '#FFFFFF',
              fontSize: 12.5,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            ✕ 닫기
          </button>
        </div>

        {/* ── 본문 스크롤 영역 (데스크탑 2단 / 모바일 1단) ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? 10 : 16,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.22fr 1fr',
            gap: isMobile ? 12 : 16,
            alignItems: 'start',
          }}
        >
          {/* ── 좌측: 반응기 모델 · 템플릿 · 운전조건 · 양론/속도론 편집 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 1) 14종 산업 화학반응 프리셋 빠른 불러오기 */}
            <div style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 7,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#1A2F44' }}>
                  산업 표준 반응 템플릿 (14종)
                </span>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 700,
                    color: useSampleFeed ? '#1D4ED8' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useSampleFeed}
                    onChange={(e) => setUseSampleFeed(e.target.checked)}
                  />
                  프리뷰에 반응물 샘플 피드 사용
                </label>
              </div>
              <select
                value={cfg.presetId ?? ''}
                onChange={(e) => applyTemplate(e.target.value)}
                style={selectStyle}
              >
                <option value="">-- 직접 구성 또는 14종 산업 반응 템플릿 선택 --</option>
                {INDUSTRIAL_REACTION_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    [{tpl.category}] {tpl.labelKo}
                  </option>
                ))}
              </select>
              {cfg.presetId && (
                <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                  {INDUSTRIAL_REACTION_TEMPLATES.find((t) => t.id === cfg.presetId)?.descKo}
                </div>
              )}
            </div>

            {/* 2) 5종 반응기 모델 탭 */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 8 }}>
                반응기 해석 모델 선택 (5종)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
                  gap: 6,
                }}
              >
                {MODEL_TABS.map((m) => {
                  const active = cfg.model === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() =>
                        setCfg((prev) => ({
                          ...prev,
                          model: m.key,
                          thermalMode:
                            prev.thermalMode === 'jacket_ua' && m.key !== 'cstr' && m.key !== 'pfr'
                              ? 'isothermal'
                              : prev.thermalMode,
                        }))
                      }
                      style={{
                        padding: '8px 6px',
                        borderRadius: 8,
                        border: active ? '2px solid #1D4ED8' : '1px solid #CBD5E1',
                        background: active ? '#EFF6FF' : '#FFFFFF',
                        color: active ? '#1E3A8A' : '#334155',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 900, fontFamily: MONO, color: '#2563EB' }}>
                        {m.shortTag}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 2 }}>{m.labelKo}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 7 }}>
                {MODEL_TABS.find((t) => t.key === cfg.model)?.descKo}
              </div>
            </div>

            {/* 3) 열수지 · 상모드 · 운전 조건 · 기하 치수 */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 9 }}>
                열수지 모드 · 상평형 · 기하 구조 설정
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                  gap: 8,
                }}
              >
                <div>
                  <label style={labelStyle}>열수지 모드</label>
                  <select
                    value={cfg.thermalMode}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, thermalMode: e.target.value as ReactorThermalMode }))
                    }
                    style={selectStyle}
                  >
                    {THERMAL_OPTIONS.filter(
                      (opt) => opt.key !== 'jacket_ua' || cfg.model === 'cstr' || cfg.model === 'pfr'
                    ).map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.labelKo}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>반응 상 모드</label>
                  <select
                    value={cfg.phaseMode ?? 'vle'}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        phaseMode: e.target.value as 'vapor' | 'liquid' | 'vle',
                      }))
                    }
                    style={selectStyle}
                  >
                    <option value="vle">기액평형 (VLE 자동)</option>
                    <option value="vapor">기상 반응 (Vapor)</option>
                    <option value="liquid">액상 반응 (Liquid)</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>물성 패키지</label>
                  <select
                    value={cfg.propertyMethod ?? propertyMethod}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        propertyMethod: e.target.value as ResolvedPropertyMethod,
                      }))
                    }
                    style={selectStyle}
                  >
                    {(['ENRTL', 'NRTL', 'PR', 'SRK'] as ResolvedPropertyMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {m} — {PROPERTY_METHOD_INFO[m]?.shortKo ?? m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>운전 압력 [kg/cm²g]</label>
                  <input
                    type="number"
                    step="0.5"
                    value={cfg.operPressKgcm2g ?? inletPressKgcm2g}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, operPressKgcm2g: Number(e.target.value) }))
                    }
                    style={inputStyle}
                  />
                </div>

                {cfg.thermalMode === 'isothermal' && (
                  <div>
                    <label style={labelStyle}>등온 운전 온도 [°C]</label>
                    <input
                      type="number"
                      step="5"
                      value={cfg.operTempC ?? inletTempC}
                      onChange={(e) => setCfg((p) => ({ ...p, operTempC: Number(e.target.value) }))}
                      style={inputStyle}
                    />
                  </div>
                )}

                {cfg.thermalMode === 'specified_duty' && (
                  <div>
                    <label style={labelStyle}>지정 열부하 Q [kcal/h]</label>
                    <input
                      type="number"
                      step="1000"
                      value={cfg.specifiedDutyKcalH ?? 0}
                      onChange={(e) =>
                        setCfg((p) => ({ ...p, specifiedDutyKcalH: Number(e.target.value) }))
                      }
                      style={inputStyle}
                    />
                  </div>
                )}

                {cfg.thermalMode === 'jacket_ua' && (
                  <>
                    <div>
                      <label style={labelStyle}>열매체 온도 T_jacket [°C]</label>
                      <input
                        type="number"
                        step="5"
                        value={cfg.jacketTempC ?? inletTempC}
                        onChange={(e) =>
                          setCfg((p) => ({ ...p, jacketTempC: Number(e.target.value) }))
                        }
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>총괄열전달계수 U [kcal/m²·h·°C]</label>
                      <input
                        type="number"
                        step="10"
                        value={cfg.overallU_KcalM2HC ?? 200}
                        onChange={(e) =>
                          setCfg((p) => ({ ...p, overallU_KcalM2HC: Number(e.target.value) }))
                        }
                        style={inputStyle}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* CSTR / PFR 기하 및 충전층 Ergun 입력 */}
              {isKinetic && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px dashed #CBD5E1',
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                    gap: 8,
                  }}
                >
                  <div>
                    <label style={labelStyle}>반응기 부피 V [m³]</label>
                    <input
                      type="number"
                      min="0.001"
                      step="0.5"
                      value={cfg.volumeM3 ?? 4.0}
                      onChange={(e) =>
                        setCfg((p) => ({
                          ...p,
                          volumeM3: Math.max(0.0001, Number(e.target.value)),
                        }))
                      }
                      style={inputStyle}
                    />
                  </div>

                  {cfg.model === 'pfr' && (
                    <>
                      <div>
                        <label style={labelStyle}>병렬 튜브 수 N_tube</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={cfg.tubeCount ?? 1}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              tubeCount: Math.max(1, Math.round(Number(e.target.value))),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>튜브 내경 D [m]</label>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={cfg.tubeDiamM ?? 0.1}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              tubeDiamM: Math.max(0.005, Number(e.target.value)),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>튜브 길이 L [m]</label>
                        <input
                          type="number"
                          min="0.1"
                          step="0.5"
                          value={cfg.tubeLengthM ?? 4.0}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              tubeLengthM: Math.max(0.05, Number(e.target.value)),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>촉매 입경 d_p [mm] (Ergun)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={cfg.particleDiamMm ?? 0}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              particleDiamMm: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>촉매 공극률 ε (0.2~0.9)</label>
                        <input
                          type="number"
                          min="0.2"
                          max="0.9"
                          step="0.02"
                          value={cfg.catalystVoidage ?? 0.42}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              catalystVoidage: Math.max(0.15, Math.min(0.95, Number(e.target.value))),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 4) 모델별 화학양론/속도식 또는 Gibbs 화학종 풀 편집기 */}
            {cfg.model === 'gibbs' ? (
              <div style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 900 }}>
                    Gibbs 평형 탐색 화학종 풀 (Species Pool) & 불활성 성분
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setCfg((p) => ({
                          ...p,
                          gibbsSpeciesPool: Array.from(
                            new Set([...(p.gibbsSpeciesPool ?? []), 'CH4', 'H2O', 'CO', 'CO2', 'H2', 'NH3', 'N2'])
                          ),
                        }))
                      }
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#EFF6FF',
                        color: '#1D4ED8',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      + 합성가스 풀 추가
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>
                  유입 원소(C, H, O, N, Cl, S, Na...)를 보존하면서 총 Gibbs 에너지를 최소화할 생성 가능 성분들을 선택하세요.
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {selectableComponents.slice(0, 28).map((k) => {
                    const inPool = (cfg.gibbsSpeciesPool ?? []).includes(k);
                    const isInert = (cfg.gibbsInertSet ?? []).includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleGibbsPoolComp(k)}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 999,
                          border: inPool ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                          background: isInert ? '#FEF3C7' : inPool ? '#DBEAFE' : '#FFFFFF',
                          color: isInert ? '#92400E' : inPool ? '#1E3A8A' : '#475569',
                          fontSize: 11,
                          fontWeight: 800,
                          fontFamily: MONO,
                          cursor: 'pointer',
                        }}
                      >
                        {inPool ? '✓ ' : ''}
                        {k}
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 5 }}>
                  반응 제외 불활성 성분 (Inert 고정):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(['N2', 'Ar', 'H2O', 'CH4', 'CO2'] as SimCompKey[]).map((k) => {
                    const isInert = (cfg.gibbsInertSet ?? []).includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleGibbsInertComp(k)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          border: isInert ? '1.5px solid #D97706' : '1px solid #CBD5E1',
                          background: isInert ? '#FEF3C7' : '#FFFFFF',
                          color: isInert ? '#92400E' : '#64748B',
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: MONO,
                          cursor: 'pointer',
                        }}
                      >
                        {isInert ? '불활성 고정: ' : ''}
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 900 }}>
                    반응 화학양론 및 속도/평형 파라미터 ({(cfg.reactions ?? []).length}개 반응)
                  </span>
                  <button
                    type="button"
                    onClick={addReaction}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #1D4ED8',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    + 반응 추가
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(cfg.reactions ?? []).map((rxn, idx) => {
                    const bal = checkStoichiometryBalance(rxn.stoic);
                    const stdThermo = calcReactionStdThermo(
                      rxn,
                      liveResult.outletTempC,
                      cfg.phaseMode === 'liquid' ? 'liquid' : 'vapor'
                    );
                    const stoicEntries = Object.entries(rxn.stoic) as [SimCompKey, number][];
                    const addKey = compToAddByRxn[rxn.id] ?? selectableComponents[0] ?? 'H2';

                    return (
                      <div
                        key={rxn.id}
                        style={{
                          padding: '10px 11px',
                          borderRadius: 8,
                          border: bal.balanced ? '1px solid #CBD5E1' : '1.5px solid #D97706',
                          background: '#F8FAFC',
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                padding: '2px 7px',
                                borderRadius: 5,
                                background: '#1A2F44',
                                color: '#FFFFFF',
                                fontSize: 10.5,
                                fontWeight: 900,
                                fontFamily: MONO,
                              }}
                            >
                              #{idx + 1}
                            </span>
                            <input
                              type="text"
                              value={rxn.name ?? rxn.id}
                              onChange={(e) => updateReaction(idx, { name: e.target.value })}
                              style={{ ...inputStyle, width: 170, height: 27, fontFamily: 'inherit' }}
                            />
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: bal.balanced ? '#DCFCE7' : '#FEF3C7',
                                color: bal.balanced ? '#166534' : '#92400E',
                                fontSize: 10.5,
                                fontWeight: 800,
                                fontFamily: MONO,
                              }}
                            >
                              {bal.balanced
                                ? '원소 균형 OK'
                                : `불균형 ΔMW=${bal.mwResidualGmol.toFixed(2)}`}
                            </span>
                          </div>

                          {(cfg.reactions ?? []).length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeReaction(idx)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: '1px solid #FCA5A5',
                                background: '#FEF2F2',
                                color: '#B91C1C',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              삭제
                            </button>
                          )}
                        </div>

                        {/* 반응식 요약 및 ΔH° / Keq 표시 */}
                        <div
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            fontSize: 11.5,
                            fontFamily: MONO,
                            fontWeight: 800,
                            color: '#1E3A8A',
                            marginBottom: 8,
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <span>
                            {formatEquation(
                              rxn.stoic,
                              cfg.model === 'equilibrium' || rxn.reversible
                            )}
                          </span>
                          <span style={{ color: '#475569' }}>
                            ΔH°₂₉₈={stdThermo.dH298KJmol.toFixed(1)} kJ/mol | Keq(
                            {liveResult.outletTempC.toFixed(0)}°C)=
                            {stdThermo.Keq > 1e4 || stdThermo.Keq < 1e-3
                              ? stdThermo.Keq.toExponential(2)
                              : stdThermo.Keq.toFixed(3)}
                          </span>
                        </div>

                        {/* 양론 계수 ν_i 칩 편집 */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            alignItems: 'center',
                            marginBottom: 8,
                          }}
                        >
                          {stoicEntries.map(([comp, nu]) => (
                            <div
                              key={comp}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 6px',
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  fontFamily: MONO,
                                  color: nu < 0 ? '#1D4ED8' : '#059669',
                                }}
                              >
                                {comp}
                              </span>
                              <input
                                type="number"
                                step="0.5"
                                value={nu}
                                onChange={(e) =>
                                  updateStoicCoef(idx, comp, Number(e.target.value))
                                }
                                style={{
                                  width: 58,
                                  height: 24,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  border: '1px solid #CBD5E1',
                                  fontFamily: MONO,
                                  fontSize: 11.5,
                                  fontWeight: 800,
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => updateStoicCoef(idx, comp, 0)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#94A3B8',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  padding: '0 2px',
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}

                          {/* 성분 추가 */}
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <select
                              value={addKey}
                              onChange={(e) =>
                                setCompToAddByRxn((p) => ({
                                  ...p,
                                  [rxn.id]: e.target.value as SimCompKey,
                                }))
                              }
                              style={{ ...selectStyle, width: 105, height: 26, fontSize: 11 }}
                            >
                              {selectableComponents.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateStoicCoef(idx, addKey, rxn.stoic[addKey] ?? 1)
                              }
                              style={{
                                height: 26,
                                padding: '0 8px',
                                borderRadius: 5,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              + 계수 추가
                            </button>
                          </div>
                        </div>

                        {/* 모델별 반응 세부 파라미터 */}
                        {cfg.model === 'stoic' && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 8,
                            }}
                          >
                            <div>
                              <label style={labelStyle}>기준 반응물 (Key Component)</label>
                              <select
                                value={rxn.keyComp ?? ''}
                                onChange={(e) =>
                                  updateReaction(idx, { keyComp: e.target.value as SimCompKey })
                                }
                                style={selectStyle}
                              >
                                {stoicEntries
                                  .filter(([, nu]) => nu < 0)
                                  .map(([c]) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>
                                목표 전환율 X (0 ~ 1): {((rxn.conversion ?? 0.9) * 100).toFixed(1)}%
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                value={rxn.conversion ?? 0.9}
                                onChange={(e) =>
                                  updateReaction(idx, {
                                    conversion: Math.max(0, Math.min(1, Number(e.target.value))),
                                  })
                                }
                                style={inputStyle}
                              />
                            </div>
                          </div>
                        )}

                        {isKinetic && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr',
                              gap: 8,
                            }}
                          >
                            <div>
                              <label style={labelStyle}>빈도인자 k₀_fwd [kmol/m³·s 기준]</label>
                              <input
                                type="number"
                                step="100"
                                value={rxn.k0Forward ?? 1e4}
                                onChange={(e) =>
                                  updateReaction(idx, { k0Forward: Math.max(0, Number(e.target.value)) })
                                }
                                style={inputStyle}
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>활성화 에너지 Ea_fwd [kJ/mol]</label>
                              <input
                                type="number"
                                step="1"
                                value={rxn.EaForwardKJmol ?? 60}
                                onChange={(e) =>
                                  updateReaction(idx, { EaForwardKJmol: Number(e.target.value) })
                                }
                                style={inputStyle}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 5 }}>
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 11.5,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(rxn.reversible)}
                                  onChange={(e) =>
                                    updateReaction(idx, { reversible: e.target.checked })
                                  }
                                />
                                가역 반응 (Keq 역반응 연동)
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── 우측: 실시간 시뮬레이션 프리뷰 · 보존율 배지 · PFR 차트 · 스트림 표 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 보존 진단 & 상태 배너 */}
            <div
              style={{
                ...cardStyle,
                background: liveResult.converged ? '#F0FDF4' : '#FFFBEB',
                border: liveResult.converged ? '1px solid #86EFAC' : '1px solid #FCD34D',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: '#1A2F44' }}>
                {liveResult.statusNote}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 7,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  fontWeight: 800,
                }}
              >
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: liveResult.atomBalanceMaxRelErr < 1e-6 ? '#DCFCE7' : '#FEF3C7',
                    color: liveResult.atomBalanceMaxRelErr < 1e-6 ? '#166534' : '#92400E',
                  }}
                >
                  원소보존 오차: {liveResult.atomBalanceMaxRelErr.toExponential(2)}
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: liveResult.massBalanceRelErr < 1e-6 ? '#DCFCE7' : '#FEF3C7',
                    color: liveResult.massBalanceRelErr < 1e-6 ? '#166534' : '#92400E',
                  }}
                >
                  질량보존 오차: {liveResult.massBalanceRelErr.toExponential(2)}
                </span>
                {useSampleFeed && (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#DBEAFE',
                      color: '#1E40AF',
                    }}
                  >
                    샘플 피드 프리뷰 활성
                  </span>
                )}
              </div>

              {liveResult.warnings.length > 0 && (
                <div style={{ marginTop: 7, fontSize: 11, color: '#B45309', fontWeight: 700 }}>
                  {liveResult.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}
            </div>

            {/* 핵심 성능 지표 KPI 카드 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}
            >
              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                  출구 온도 T_out / ΔT
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {liveResult.outletTempC.toFixed(1)} °C{' '}
                  <span
                    style={{
                      fontSize: 12,
                      color:
                        liveResult.outletTempC - previewTempC >= 0 ? '#D97706' : '#0284C7',
                    }}
                  >
                    ({liveResult.outletTempC - previewTempC >= 0 ? '+' : ''}
                    {(liveResult.outletTempC - previewTempC).toFixed(1)} °C)
                  </span>
                </div>
                {liveResult.hotspotTempC !== undefined && (
                  <div style={{ fontSize: 11, color: '#1D4ED8', fontFamily: MONO, fontWeight: 700 }}>
                    최고점 Hotspot: {liveResult.hotspotTempC.toFixed(1)} °C
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                  반응기 열부하 Q ({liveResult.heatDutyKcalH >= 0 ? '가열/흡열' : '냉각/발열'})
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {Math.round(liveResult.heatDutyKcalH).toLocaleString()} kcal/h
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: MONO, fontWeight: 700 }}>
                  ({dutyKW.toFixed(1)} kW)
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                  출구 압력 / 충전층 ΔP
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {liveResult.outletPressKgcm2g.toFixed(2)} kg/cm²g
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: MONO, fontWeight: 700 }}>
                  ΔP = {liveResult.pressureDropBar.toFixed(3)} bar
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                  주요 반응물 전환율 (X)
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, fontFamily: MONO, marginTop: 4 }}>
                  {Object.keys(liveResult.keyConversions).length === 0
                    ? '—'
                    : Object.entries(liveResult.keyConversions)
                        .slice(0, 3)
                        .map(([k, x]) => `${k}: ${(x * 100).toFixed(1)}%`)
                        .join(' | ')}
                </div>
              </div>
            </div>

            {/* PFR 축방향 프로파일 SVG 차트 */}
            {cfg.model === 'pfr' && liveResult.axialProfile && (
              <PfrAxialSvgChart
                profile={liveResult.axialProfile}
                hotspotTempC={liveResult.hotspotTempC}
              />
            )}

            {/* 입출구 성분 물질수지 및 기액 분배 표 */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 8 }}>
                입·출구 성분 물질수지 및 상분배 요약
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 11.5,
                    fontFamily: MONO,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: '2px solid #CBD5E1', color: '#475569' }}>
                      <th style={{ textAlign: 'left', padding: '5px 4px' }}>성분</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>유입 [kg/h]</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>출구 [kg/h]</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>출구 [mol%]</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>기상/액상</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streamRows.map((k) => {
                      const mIn = previewFeed[k] ?? 0;
                      const mOut = liveResult.outletFlowsKgH[k] ?? 0;
                      const mw = (MW as Record<string, number>)[k] ?? 40;
                      const molPct = totOutMoles > 0 ? ((mOut / mw) / totOutMoles) * 100 : 0;
                      const vFrac = mOut > 1e-9 ? ((liveResult.vapFlowsKgH[k] ?? 0) / mOut) * 100 : 0;
                      return (
                        <tr key={k} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '5px 4px', fontWeight: 800, color: '#1A2F44' }}>
                            {k}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#64748B' }}>
                            {mIn.toFixed(1)}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 800 }}>
                            {mOut.toFixed(1)}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#1D4ED8' }}>
                            {molPct.toFixed(2)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#0D9488' }}>
                            V {vFrac.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* ── 하단 고정 액션 바 (Sticky Footer) ── */}
        <div
          style={{
            padding: isMobile ? '10px 12px' : '11px 18px',
            borderTop: '1px solid #CBD5E1',
            background: '#FFFFFF',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() =>
              setCfg(
                cloneConfig(
                  initialConfig,
                  inletTempC,
                  inletPressKgcm2g,
                  propertyMethod,
                  activeComponents
                )
              )
            }
            style={{
              padding: '7px 12px',
              borderRadius: 7,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#475569',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            초기값 복원
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: 12.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyConfig(cfg);
                onClose();
              }}
              style={{
                padding: '8px 18px',
                borderRadius: 7,
                border: '1px solid #1D4ED8',
                background: '#1D4ED8',
                color: '#FFFFFF',
                fontSize: 12.5,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              반응기 설정 적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReactorWorkbenchModal;

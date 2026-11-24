'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  COMP_META,
  SIM_COMPS,
  getCompLabel,
  type SimCompKey,
} from '@/lib/calculations/flowsheetSolver';
import {
  UnitNumberInput,
  UnitSelect,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import type { AppLang } from '@/lib/i18n/uiText';

export type FeedBasisMode = 'mass_flow' | 'wt_pct' | 'mol_pct';

interface FeedCompositionEditorProps {
  nodeId: string;
  flowsKgH: Partial<Record<SimCompKey, number>>;
  activeComponents: SimCompKey[];
  feedFlowUnit: string;
  onFeedFlowUnitChange: (unitId: string) => void;
  onReplaceFlows: (nextFlows: Partial<Record<SimCompKey, number>>) => void;
  onUpdateSingleComp: (comp: SimCompKey, valKgH: number) => void;
  onOpenCompSetup: () => void;
  onEnterRun?: () => void;
  lang: AppLang;
  variant?: 'modern' | 'classic';
}

function computeFlowsFromWtPct(
  totalKgH: number,
  wtPctMap: Record<string, number>,
  comps: SimCompKey[]
): Partial<Record<SimCompKey, number>> {
  const next: Partial<Record<SimCompKey, number>> = {};
  const safeTotal = Math.max(0, totalKgH);
  for (const c of comps) {
    const pct = Math.max(0, Number(wtPctMap[c]) || 0);
    next[c] = Number(((safeTotal * pct) / 100).toFixed(6));
  }
  return next;
}

function computeFlowsFromMolPct(
  totalKgH: number,
  molPctMap: Record<string, number>,
  comps: SimCompKey[]
): Partial<Record<SimCompKey, number>> {
  const next: Partial<Record<SimCompKey, number>> = {};
  const safeTotal = Math.max(0, totalKgH);
  let totalWeightedMw = 0;
  for (const c of comps) {
    const pct = Math.max(0, Number(molPctMap[c]) || 0);
    const mw = COMP_META[c]?.mw ?? 18.015;
    totalWeightedMw += pct * mw;
  }
  if (totalWeightedMw <= 1e-12 || safeTotal <= 0) {
    for (const c of comps) next[c] = 0;
    return next;
  }
  for (const c of comps) {
    const pct = Math.max(0, Number(molPctMap[c]) || 0);
    const mw = COMP_META[c]?.mw ?? 18.015;
    const wtFrac = (pct * mw) / totalWeightedMw;
    next[c] = Number((safeTotal * wtFrac).toFixed(6));
  }
  return next;
}

function deriveFractionsFromFlows(
  flowsKgH: Partial<Record<SimCompKey, number>>,
  comps: SimCompKey[],
  mode: 'wt_pct' | 'mol_pct'
): { totalKgH: number; pcts: Record<string, number> } {
  const totalKgH = comps.reduce((s, c) => s + Math.max(0, Number(flowsKgH[c]) || 0), 0);
  const pcts: Record<string, number> = {};
  if (mode === 'wt_pct') {
    for (const c of comps) {
      const m = Math.max(0, Number(flowsKgH[c]) || 0);
      pcts[c] = totalKgH > 1e-12 ? Number(((m / totalKgH) * 100).toFixed(3)) : 0;
    }
    return { totalKgH, pcts };
  }
  let totalMol = 0;
  const mols: Record<string, number> = {};
  for (const c of comps) {
    const m = Math.max(0, Number(flowsKgH[c]) || 0);
    const mw = COMP_META[c]?.mw ?? 18.015;
    const n = m / mw;
    mols[c] = n;
    totalMol += n;
  }
  for (const c of comps) {
    pcts[c] = totalMol > 1e-12 ? Number(((mols[c] / totalMol) * 100).toFixed(3)) : 0;
  }
  return { totalKgH, pcts };
}

export default function FeedCompositionEditor({
  nodeId,
  flowsKgH,
  activeComponents,
  feedFlowUnit,
  onFeedFlowUnitChange,
  onReplaceFlows,
  onUpdateSingleComp,
  onOpenCompSetup,
  onEnterRun,
  lang,
  variant = 'modern',
}: FeedCompositionEditorProps) {
  const isEn = lang === 'en';
  const [basis, setBasis] = useState<FeedBasisMode>('mass_flow');
  const [draftTotalKgH, setDraftTotalKgH] = useState<number>(0);
  const [draftPcts, setDraftPcts] = useState<Record<string, number>>({});

  const visibleComps = useMemo(
    () =>
      SIM_COMPS.filter(
        comp => activeComponents.includes(comp) || (Number(flowsKgH?.[comp]) || 0) > 0
      ),
    [activeComponents, flowsKgH]
  );

  const actualTotalKgH = useMemo(
    () =>
      Object.values(flowsKgH ?? {}).reduce((a, b) => a + Math.max(0, Number(b) || 0), 0),
    [flowsKgH]
  );

  // 노드 변경 또는 입력 모드 전환 시 현재 유량으로부터 총유량 및 분율 동기화
  useEffect(() => {
    if (basis === 'wt_pct' || basis === 'mol_pct') {
      const { totalKgH, pcts } = deriveFractionsFromFlows(flowsKgH, visibleComps, basis);
      setDraftTotalKgH(totalKgH);
      setDraftPcts(pcts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, basis]);

  const pctSum = useMemo(
    () => visibleComps.reduce((s, c) => s + Math.max(0, Number(draftPcts[c]) || 0), 0),
    [visibleComps, draftPcts]
  );
  const pctIsBalanced = Math.abs(pctSum - 100) < 0.05;

  const handleTotalFlowChange = (newTotalKgH: number) => {
    const safeTotal = Math.max(0, newTotalKgH);
    setDraftTotalKgH(safeTotal);
    if (basis === 'wt_pct') {
      if (pctSum > 1e-9) {
        // 현재 입력된 분율 비율대로 총유량 분배 (합계가 100이 아니어도 비율 유지 또는 직접 곱셈)
        const nextFlows = computeFlowsFromWtPct(safeTotal, draftPcts, visibleComps);
        onReplaceFlows(nextFlows);
      }
    } else if (basis === 'mol_pct') {
      if (pctSum > 1e-9) {
        const nextFlows = computeFlowsFromMolPct(safeTotal, draftPcts, visibleComps);
        onReplaceFlows(nextFlows);
      }
    }
  };

  const handlePctChange = (comp: SimCompKey, rawVal: string) => {
    const parsed = rawVal === '' ? 0 : Math.max(0, Math.min(100, Number(rawVal)));
    const safePct = Number.isFinite(parsed) ? parsed : 0;
    const nextPcts = { ...draftPcts, [comp]: safePct };
    setDraftPcts(nextPcts);
    const effectiveTotal = draftTotalKgH > 0 ? draftTotalKgH : actualTotalKgH;
    if (effectiveTotal > 0) {
      const nextFlows =
        basis === 'wt_pct'
          ? computeFlowsFromWtPct(effectiveTotal, nextPcts, visibleComps)
          : computeFlowsFromMolPct(effectiveTotal, nextPcts, visibleComps);
      onReplaceFlows(nextFlows);
    }
  };

  const handleNormalize = () => {
    if (pctSum <= 1e-9) return;
    const normalized: Record<string, number> = {};
    for (const c of visibleComps) {
      const raw = Math.max(0, Number(draftPcts[c]) || 0);
      normalized[c] = Number(((raw / pctSum) * 100).toFixed(3));
    }
    setDraftPcts(normalized);
    const effectiveTotal = draftTotalKgH > 0 ? draftTotalKgH : actualTotalKgH;
    if (effectiveTotal > 0) {
      const nextFlows =
        basis === 'wt_pct'
          ? computeFlowsFromWtPct(effectiveTotal, normalized, visibleComps)
          : computeFlowsFromMolPct(effectiveTotal, normalized, visibleComps);
      onReplaceFlows(nextFlows);
    }
  };

  const isClassic = variant === 'classic';

  return (
    <div
      style={
        isClassic
          ? { display: 'flex', flexDirection: 'column', gap: 5 }
          : {
              background: '#F8FAFC',
              padding: 9,
              borderRadius: 6,
              border: '1px solid #E2E8F0',
            }
      }
    >
      {/* 헤더 + 단위 + 성분 설정 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isClassic ? 2 : 6,
          gap: 5,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: isClassic ? 10.5 : 11,
              fontWeight: isClassic ? 700 : 900,
              color: isClassic ? '#334155' : '#0F172A',
            }}
          >
            {basis === 'mass_flow'
              ? isEn
                ? 'Component Mass Flows'
                : '성분별 질량유량'
              : basis === 'wt_pct'
                ? isEn
                  ? 'Total Flow + wt%'
                  : '총유량 + 질량비(wt%)'
                : isEn
                  ? 'Total Flow + mol%'
                  : '총유량 + 몰비(mol%)'}
          </span>
          <UnitSelect
            quantity="massFlow"
            value={feedFlowUnit}
            onChange={onFeedFlowUnitChange}
            size="xs"
          />
          <button
            type="button"
            onClick={onOpenCompSetup}
            style={{
              padding: '2px 7px',
              fontSize: 9.5,
              fontWeight: isClassic ? 800 : 700,
              borderRadius: 4,
              border: isClassic ? '1px solid #93C5FD' : '1px solid #CBD5E1',
              background: isClassic ? '#EFF6FF' : '#FFFFFF',
              color: isClassic ? '#1D4ED8' : '#1E293B',
              cursor: 'pointer',
            }}
          >
            {isEn
              ? `+ Components (${activeComponents.length})`
              : `+ 성분 설정 (${activeComponents.length}종)`}
          </button>
        </div>
        {basis === 'mass_flow' && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 900,
              color: '#0F172A',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {isEn ? 'Total' : '합계'}{' '}
            {formatCanonicalValue('massFlow', actualTotalKgH, feedFlowUnit)}{' '}
            {getUnitLabel('massFlow', feedFlowUnit)}
          </span>
        )}
      </div>

      {/* 입력 방식 3단 전환 탭 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 3,
          background: '#E2E8F0',
          padding: 2,
          borderRadius: 6,
          marginBottom: isClassic ? 4 : 7,
        }}
      >
        {(
          [
            { id: 'mass_flow', ko: '개별 유량', en: 'Mass Flow' },
            { id: 'wt_pct', ko: '총유량 + wt%', en: 'Total + wt%' },
            { id: 'mol_pct', ko: '총유량 + mol%', en: 'Total + mol%' },
          ] as const
        ).map(tab => {
          const active = basis === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBasis(tab.id)}
              style={{
                padding: '4px 4px',
                fontSize: 10,
                fontWeight: active ? 800 : 600,
                borderRadius: 4,
                border: 'none',
                background: active ? '#1E3A8A' : 'transparent',
                color: active ? '#FFFFFF' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isEn ? tab.en : tab.ko}
            </button>
          );
        })}
      </div>

      {/* 총유량 + 비율 모드일 때 상단 총유량 입력 박스 */}
      {basis !== 'mass_flow' && (
        <div
          style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: 6,
            padding: '7px 8px',
            marginBottom: isClassic ? 4 : 7,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 900, color: '#1E3A8A' }}>
              {isEn ? 'Total Mass Flow' : '전체 총 유량'}
            </span>
            <UnitNumberInput
              quantity="massFlow"
              unitId={feedFlowUnit}
              onUnitChange={onFeedFlowUnitChange}
              syncKey={`${nodeId}-total-flow-${basis}`}
              minCanonical={0}
              value={draftTotalKgH}
              onValueChange={handleTotalFlowChange}
              onEnterRun={onEnterRun}
              containerStyle={{ width: 144, flexShrink: 0 }}
              inputStyle={{
                padding: '3px 6px',
                textAlign: 'right',
                border: '1.5px solid #2563EB',
                background: '#FFFFFF',
                color: '#0F172A',
                borderRadius: 4,
                fontSize: 11.5,
                fontWeight: 900,
                fontFamily: 'JetBrains Mono, monospace',
              }}
              selectStyle={{ minWidth: 46, fontSize: 9.5 }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: pctIsBalanced ? '#15803D' : '#B45309',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {isEn ? 'Sum' : '비율 합계'}: {pctSum.toFixed(2)}{' '}
              {basis === 'wt_pct' ? 'wt%' : 'mol%'}
              {pctIsBalanced ? ' ✓' : ''}
            </span>
            {!pctIsBalanced && pctSum > 0 && (
              <button
                type="button"
                onClick={handleNormalize}
                style={{
                  padding: '2px 7px',
                  fontSize: 9.5,
                  fontWeight: 800,
                  borderRadius: 4,
                  border: '1px solid #F59E0B',
                  background: '#FEF3C7',
                  color: '#92400E',
                  cursor: 'pointer',
                }}
              >
                {isEn ? 'Normalize 100%' : '100% 자동맞춤'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 성분별 행 리스트 */}
      <div
        style={
          isClassic
            ? { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }
            : undefined
        }
      >
        {visibleComps.map(comp => {
          const val = Number(flowsKgH?.[comp]) || 0;
          const pctVal = Number(draftPcts[comp]) || 0;

          if (basis === 'mass_flow') {
            return (
              <div
                key={comp}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  marginBottom: isClassic ? 0 : 4,
                }}
                title={isEn ? COMP_META[comp].formula : COMP_META[comp].label}
              >
                <span
                  style={{
                    fontSize: isClassic ? 10 : 11,
                    fontWeight: val > 0 ? 800 : 600,
                    color: val > 0 ? '#0F172A' : '#475569',
                    minWidth: 0,
                    width: isClassic ? 64 : undefined,
                    flexShrink: isClassic ? 0 : undefined,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isClassic ? comp : getCompLabel(comp, lang)}
                </span>
                <UnitNumberInput
                  quantity="massFlow"
                  unitId={feedFlowUnit}
                  onUnitChange={onFeedFlowUnitChange}
                  syncKey={`${nodeId}-fc-${comp}`}
                  minCanonical={0}
                  value={val}
                  onValueChange={v => onUpdateSingleComp(comp, Math.max(0, v))}
                  onEnterRun={onEnterRun}
                  containerStyle={{ width: isClassic ? undefined : 132, flexShrink: 0 }}
                  inputStyle={{
                    height: isClassic ? 24 : undefined,
                    padding: isClassic ? '0 5px' : '3px 6px',
                    textAlign: 'right',
                    border: val > 0 ? '1px solid #64748B' : '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    borderRadius: 4,
                    fontSize: isClassic ? 11 : 11.5,
                    fontWeight: val > 0 ? 800 : 600,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                  selectStyle={{ minWidth: isClassic ? 50 : 46, fontSize: 9.5 }}
                />
              </div>
            );
          }

          return (
            <div
              key={comp}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                marginBottom: isClassic ? 0 : 4,
              }}
              title={isEn ? COMP_META[comp].formula : COMP_META[comp].label}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: isClassic ? 10 : 11,
                    fontWeight: pctVal > 0 ? 800 : 600,
                    color: pctVal > 0 ? '#0F172A' : '#475569',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isClassic ? comp : getCompLabel(comp, lang)}
                </div>
                {val > 0 && (
                  <div
                    style={{
                      fontSize: 9.5,
                      color: '#64748B',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    ≈ {formatCanonicalValue('massFlow', val, feedFlowUnit)}{' '}
                    {getUnitLabel('massFlow', feedFlowUnit)}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={pctVal === 0 ? '' : pctVal}
                  placeholder="0"
                  onChange={e => handlePctChange(comp, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && onEnterRun) onEnterRun();
                  }}
                  style={{
                    width: 78,
                    height: isClassic ? 24 : 26,
                    padding: '2px 6px',
                    textAlign: 'right',
                    border: pctVal > 0 ? '1px solid #2563EB' : '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    borderRadius: 4,
                    fontSize: 11.5,
                    fontWeight: pctVal > 0 ? 800 : 600,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#475569',
                    width: 34,
                    textAlign: 'left',
                  }}
                >
                  {basis === 'wt_pct' ? 'wt%' : 'mol%'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

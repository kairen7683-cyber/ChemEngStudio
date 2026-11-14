'use client';

import React, { useMemo, useState } from 'react';
import { Edge, Node } from 'reactflow';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { StreamData } from '@/lib/calculations/streams';

interface Props {
  allEdges: Edge[];
  allNodes: Node[];
  onClose: () => void;
}

// 미표기 스트림별 원인 안내 사전 (사용자가 왜 안 보이는지 한눈에 파악 가능)
const MISSING_REASON_HINTS: Record<string, string> = {
  '003': 'Salt Hopper→D-010 배관이 현재 [001]로 중복 지정되어 있음 (편집 모드에서 [003]으로 변경 가능)',
  '006': 'BaCl₂ 약품 배관이 [017]로 지정되어 있음',
  '008': 'NaOH 약품 주입 배관이 [105]로 지정되어 있음',
  '009': 'Na₂CO₃ 약품 배관이 [017]로 지정되어 있음',
  '014': '응집제(D-060→P-064→T-030) 보조 주입 라인 미작도',
  '015': '슬러지 시드 순환(P-033→D-020) 배관이 [002]로 지정되어 있음',
  '016': '브라인 슬러지 퍼지(KV-030 배출) 드레인 라인 미작도',
  '021': 'T-030 상등액→D-040 구간 배관이 [004]로 지정되어 있음',
  '101': '여과조제 Body Feed (D-130→P-134) 보조 라인 미작도',
  '110': 'Precoat 순환(D-120→P-124→F-140) 보조 라인 미작도',
  '214': '전해조 음극→D-220 2상 연결 배관이 [211]로 표기됨',
  '257': '잔류염소 제거 약품(PHCV-281→D-280) 보조 주입 라인 미작도',
  '259': 'D-280→P-284 펌프 흡입/토출 세부 구간 미분리 ([250]/[256]으로 통합 표기)',
  '614': '고압 수소 냉각기(E-5680) 응축수 소량 드레인 라인 미작도',
};

function fmt(v: number | undefined, dec = 1): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function StreamCoverageDrawer({ allEdges, allNodes, onClose }: Props) {
  const { balance } = useBalanceStore();
  const { edgeStreamMap, setEditMode, syncLineTableStreams } = usePFDStore();
  const streams: StreamData[] = balance?.streams ?? [];

  const [tab, setTab] = useState<'missing' | 'drawn' | 'all'>('missing');
  const [secFilter, setSecFilter] = useState<string>('all');

  // 현재 PFD 캔버스 위에 실제로 존재하는 배관(Edge) 및 라벨 노드의 streamId 집계
  const { drawnSet, labelOnlySet } = useMemo(() => {
    const edgeSet = new Set<string>();
    for (const e of allEdges) {
      const sid = (edgeStreamMap[e.id] ?? e.data?.streamId ?? '').trim();
      if (sid) edgeSet.add(sid);
    }
    // Cross-section 기본 점선 배관 보정
    if (allEdges.some(e => e.id === 'cross-250-100')) edgeSet.add('250');
    if (allEdges.some(e => e.id === 'cross-217-L1')) { edgeSet.add('217'); edgeSet.add('L1'); }
    if (allEdges.some(e => e.id === 'cross-220-400')) edgeSet.add('220');
    if (allEdges.some(e => e.id === 'cross-221-600')) edgeSet.add('221');

    const lblSet = new Set<string>();
    for (const n of allNodes) {
      if (n.type === 'streamLabel' && n.data?.streamId) {
        const sid = String(n.data.streamId).trim();
        if (sid && !edgeSet.has(sid)) lblSet.add(sid);
      }
    }
    return { drawnSet: edgeSet, labelOnlySet: lblSet };
  }, [allEdges, allNodes, edgeStreamMap]);

  const missingStreams = useMemo(
    () => streams.filter(s => !drawnSet.has(s.id) && !labelOnlySet.has(s.id)),
    [streams, drawnSet, labelOnlySet]
  );

  const drawnStreams = useMemo(
    () => streams.filter(s => drawnSet.has(s.id) || labelOnlySet.has(s.id)),
    [streams, drawnSet, labelOnlySet]
  );

  const displayList = useMemo(() => {
    const base = tab === 'missing' ? missingStreams : tab === 'drawn' ? drawnStreams : streams;
    if (secFilter === 'all') return base;
    return base.filter(s => s.section === secFilter);
  }, [tab, secFilter, missingStreams, drawnStreams, streams]);

  // 섹션별 미표기 건수 요약
  const missingBySec = useMemo(() => {
    const counts: Record<string, number> = { '100': 0, '200': 0, '300': 0, '400': 0, '600': 0 };
    missingStreams.forEach(s => {
      if (counts[s.section] !== undefined) counts[s.section]++;
    });
    return counts;
  }, [missingStreams]);

  return (
    <div style={{
      position: 'absolute',
      top: 56,
      right: 14,
      width: 410,
      maxHeight: 'calc(100% - 76px)',
      background: '#FFFFFF',
      border: '1.5px solid #1A2F44',
      borderRadius: 12,
      boxShadow: '0 12px 32px rgba(26,47,68,0.24)',
      zIndex: 40,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* 헤더 */}
      <div style={{
        padding: '10px 14px',
        background: '#1A2F44',
        color: '#FFFFFF',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900 }}>
            📋 전해공장 PFD 스트림 매핑 현황
          </div>
          <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
            전체 {streams.length}개 중 <b>도면 표기 {drawnStreams.length}개</b> · <b style={{ color: '#FCD34D' }}>미표기 {missingStreams.length}개</b>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      {/* 상단 탭 & 섹션 필터 */}
      <div style={{ padding: '8px 12px', background: '#F6F7F2', borderBottom: '1px solid #E5E2DC', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[
            { id: 'missing' as const, label: `⚠️ 미표기 (${missingStreams.length})`, activeBg: '#B45309' },
            { id: 'drawn' as const,   label: `✅ 표기됨 (${drawnStreams.length})`,   activeBg: '#0F766E' },
            { id: 'all' as const,     label: `전체 (${streams.length})`,             activeBg: '#1A2F44' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, height: 27, borderRadius: 6, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
                background: tab === t.id ? t.activeBg : '#FFFFFF',
                color: tab === t.id ? '#FFFFFF' : '#2C353E',
                border: `1px solid ${tab === t.id ? t.activeBg : '#DFDCD4'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 섹션별 필터 칩 */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: '전체' },
            { id: '100', label: `100 염수 (${missingBySec['100']})` },
            { id: '200', label: `200 전해 (${missingBySec['200']})` },
            { id: '300', label: `300 농축 (${missingBySec['300']})` },
            { id: '400', label: `400 염소 (${missingBySec['400']})` },
            { id: '600', label: `600 수소 (${missingBySec['600']})` },
          ].map(sc => (
            <button
              key={sc.id}
              onClick={() => setSecFilter(sc.id)}
              style={{
                padding: '2px 7px', borderRadius: 10, fontSize: 9.5, fontWeight: 700, cursor: 'pointer',
                background: secFilter === sc.id ? '#1A2F44' : '#FFFFFF',
                color: secFilter === sc.id ? '#FFFFFF' : '#5A6570',
                border: '1px solid #DFDCD4',
              }}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      {/* 본문 스트림 리스트 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {displayList.map(s => {
          const isDrawn = drawnSet.has(s.id) || labelOnlySet.has(s.id);
          const hint = MISSING_REASON_HINTS[s.id];
          return (
            <div
              key={s.id}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                background: isDrawn ? '#F8FAFC' : '#FFFBEB',
                border: `1px solid ${isDrawn ? '#E2E8F0' : '#FCD34D'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 900,
                    padding: '1px 6px', borderRadius: 4,
                    background: isDrawn ? '#1A2F44' : '#D97706', color: '#FFFFFF',
                  }}>
                    [{s.id}]
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: '#5A6570' }}>{s.section} Sec</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, color: s.phase === 'G' ? '#0F5338' : '#0369A1', fontFamily: 'JetBrains Mono, monospace' }}>
                    {s.phase ?? 'L'}
                  </span>
                </div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, fontWeight: 800, color: '#1A2F44' }}>
                  {fmt(s.total_kgh, 1)} kg/h
                </span>
              </div>

              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#1A2F44', marginTop: 3 }}>
                {s.name}
              </div>
              <div style={{ fontSize: 9.5, color: '#5A6570', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
                {fmt(s.temperature_C, 1)} °C · {fmt(s.pressure_kgcm2g, 2)} kg/cm²G · {fmt(s.volFlow_m3h, 1)} m³/h
              </div>

              {!isDrawn && (
                <div style={{
                  marginTop: 4, fontSize: 9.2, color: '#92400E',
                  background: '#FEF3C7', padding: '3px 6px', borderRadius: 4, lineHeight: 1.35,
                }}>
                  💡 {hint ?? '현재 도면에 연결 배관이 없거나 동기화 전 상태입니다.'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 하단 액션 바 */}
      <div style={{
        padding: '8px 12px', background: '#FAF9F5', borderTop: '1px solid #E5E2DC',
        display: 'flex', gap: 6,
      }}>
        <button
          onClick={() => {
            setEditMode(true);
            onClose();
          }}
          style={{
            flex: 1, height: 30, borderRadius: 7, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
            background: '#1A2F44', color: '#FFFFFF', border: 'none',
          }}
        >
          ✏️ 편집 모드에서 배관/번호 지정
        </button>
        <button
          onClick={() => {
            syncLineTableStreams();
            window.location.reload();
          }}
          title="누락된 기본 동기화 배관(202, 211, 252, 256, 426 등)을 복원합니다"
          style={{
            height: 30, padding: '0 10px', borderRadius: 7, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
            background: '#ECFDF5', color: '#0F766E', border: '1px solid #A7F3D0',
          }}
        >
          🔗 기본 배관 동기화
        </button>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import type {
  FlowsheetConvergenceInfo,
  FlowsheetBalanceReport,
  UnitConvergenceEntry,
  TearResidualEntry,
  MakeupReportEntry,
  UnitEnergyCheck,
} from '@/lib/calculations/flowsheetSolver';

export interface ConvergenceReportPanelProps {
  convergence?: FlowsheetConvergenceInfo;
  balance?: FlowsheetBalanceReport;
  elapsedMs?: number;
  onClose?: () => void;
  onSelectNode?: (nodeId: string) => void;
  /** 인라인 임베디드 모드 여부 (false면 팝오버/모달 스타일) */
  inline?: boolean;
}

const KIND_LABEL_MAP: Record<string, string> = {
  makeup_water: '보충수(Water)',
  salt: '고체염(Salt)',
  solvent: '보충용제(Solvent)',
  reagent: '반응시약(Reagent)',
  multiplier: '배수증폭(Scale)',
  other: '기타 보충',
};

export default function ConvergenceReportPanel({
  convergence,
  balance,
  elapsedMs,
  onClose,
  onSelectNode,
  inline = false,
}: ConvergenceReportPanelProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'units' | 'tear' | 'makeup' | 'balance'>('all');
  const [unitFilter, setUnitFilter] = useState<'all' | 'failed' | 'warning'>('all');

  if (!convergence) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: '#64748B',
          textAlign: 'center',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        시뮬레이션 해석 결과가 없습니다.
      </div>
    );
  }

  const overall = convergence.overallStatus ?? (convergence.converged ? 'converged' : 'failed');
  const isOk = overall === 'converged';
  const isWarn = overall === 'converged_with_warnings';
  const isFail = overall === 'failed';

  const badgeBg = isOk ? '#ECFDF5' : isWarn ? '#FFFBEB' : '#FEF2F2';
  const badgeBorder = isOk ? '#A7F3D0' : isWarn ? '#FDE68A' : '#FECACA';
  const badgeColor = isOk ? '#065F46' : isWarn ? '#92400E' : '#991B1B';
  const badgeText = isOk
    ? '✓ 엄밀 수렴 완료 (Converged)'
    : isWarn
      ? '⚠ 경고 동반 수렴 (Converged w/ Warnings)'
      : '✕ 미수렴 (Convergence Failed)';

  const unitList = convergence.unitConvergence ?? [];
  const filteredUnits = unitList.filter(u => {
    if (unitFilter === 'failed') return u.status === 'failed';
    if (unitFilter === 'warning') return u.status === 'warning';
    return true;
  });

  const tearResiduals: TearResidualEntry[] = convergence.tearResiduals ?? [];
  const makeupReport: MakeupReportEntry[] = convergence.makeupReport ?? [];
  const energyChecks: UnitEnergyCheck[] = balance?.unitEnergyChecks ?? [];
  const flaggedEnergyChecks = energyChecks.filter(e => e.flagged);

  const containerStyle: React.CSSProperties = inline
    ? {
        width: '100%',
        background: '#FFFFFF',
        borderRadius: 8,
        border: '1px solid #E2E8F0',
        padding: 12,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        boxSizing: 'border-box',
        color: '#0F172A',
      }
    : {
        width: '100%',
        maxWidth: 440,
        maxHeight: '85vh',
        overflowY: 'auto',
        background: '#FFFFFF',
        borderRadius: 10,
        border: '1.5px solid #CBD5E1',
        boxShadow: '0 16px 36px rgba(15, 23, 42, 0.22)',
        padding: '12px 14px',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        boxSizing: 'border-box',
        color: '#0F172A',
      };

  return (
    <div style={containerStyle}>
      {/* ── 헤더: 상태 배지 + 닫기 버튼 ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 9px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                background: badgeBg,
                color: badgeColor,
                border: `1px solid ${badgeBorder}`,
                letterSpacing: '-0.2px',
              }}
            >
              {badgeText}
            </span>
            {elapsedMs !== undefined && (
              <span
                style={{
                  fontSize: 10.5,
                  color: '#64748B',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {elapsedMs} ms
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: '#1E293B',
              marginTop: 5,
              wordBreak: 'break-word',
            }}
          >
            {convergence.solverMethodLabel || '공정 시뮬레이터 수렴 진단'}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: '#F1F5F9',
              border: 'none',
              borderRadius: 6,
              width: 24,
              height: 24,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* ── 요약 문구 ── */}
      {convergence.summary && (
        <div
          style={{
            background: isOk ? '#F8FAFC' : isWarn ? '#FEFCE8' : '#FEF2F2',
            border: `1px solid ${isOk ? '#E2E8F0' : isWarn ? '#FEF08A' : '#FECACA'}`,
            borderRadius: 6,
            padding: '7px 9px',
            fontSize: 10.5,
            lineHeight: 1.5,
            color: isOk ? '#334155' : isWarn ? '#854D0E' : '#991B1B',
            fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 10,
            wordBreak: 'break-word',
          }}
        >
          {convergence.summary}
        </div>
      )}

      {/* ── 탭 내비게이션 ── */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #E2E8F0',
          paddingBottom: 6,
          marginBottom: 10,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {(
          [
            ['all', '종합 요약'],
            ['units', `장치별 (${convergence.failedUnitCount ?? 0}✕/${convergence.warningUnitCount ?? 0}⚠)`],
            ['tear', `순환 루프 (${tearResiduals.length})`],
            ['makeup', `보충·약품 (${(convergence.makeupTotalKgH ?? 0).toFixed(0)} kg/h)`],
            ['balance', '수지 결산'],
          ] as const
        ).map(([tabKey, tabLabel]) => {
          const isSelected = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              style={{
                background: isSelected ? '#1E293B' : '#F1F5F9',
                color: isSelected ? '#FFFFFF' : '#475569',
                border: 'none',
                borderRadius: 5,
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: isSelected ? 800 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      {/* ── 탭 내용 ── */}

      {/* 1. 종합 요약 (All) */}
      {(activeTab === 'all' || activeTab === 'units') && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: '#334155' }}>
              장치별 수렴 판정 ({unitList.length}기)
            </span>
            <div style={{ display: 'inline-flex', gap: 3 }}>
              {(
                [
                  ['all', '전체'],
                  ['failed', `실패(${convergence.failedUnitCount ?? 0})`],
                  ['warning', `경고(${convergence.warningUnitCount ?? 0})`],
                ] as const
              ).map(([fk, fl]) => (
                <button
                  key={fk}
                  type="button"
                  onClick={() => setUnitFilter(fk)}
                  style={{
                    fontSize: 9.5,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid #CBD5E1',
                    background: unitFilter === fk ? '#CBD5E1' : '#FFFFFF',
                    color: '#1E293B',
                    cursor: 'pointer',
                    fontWeight: unitFilter === fk ? 700 : 500,
                  }}
                >
                  {fl}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: activeTab === 'all' ? 170 : 340,
              overflowY: 'auto',
              border: '1px solid #F1F5F9',
              borderRadius: 6,
              padding: 4,
            }}
          >
            {filteredUnits.length === 0 ? (
              <div style={{ fontSize: 10.5, color: '#94A3B8', textAlign: 'center', padding: 8 }}>
                해당 조건의 장치가 없습니다.
              </div>
            ) : (
              filteredUnits.map(u => {
                const uIsFail = u.status === 'failed';
                const uIsWarn = u.status === 'warning';
                const uIsOk = u.status === 'converged';
                const uBg = uIsFail ? '#FEF2F2' : uIsWarn ? '#FEFCE8' : uIsOk ? '#F0FDF4' : '#F8FAFC';
                const uBorder = uIsFail ? '#FECACA' : uIsWarn ? '#FEF08A' : uIsOk ? '#BBF7D0' : '#E2E8F0';
                const uColor = uIsFail ? '#991B1B' : uIsWarn ? '#854D0E' : uIsOk ? '#166534' : '#64748B';

                return (
                  <div
                    key={`${u.nodeId}-${u.tag}`}
                    onClick={() => onSelectNode?.(u.nodeId)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '5px 7px',
                      borderRadius: 5,
                      background: uBg,
                      border: `1px solid ${uBorder}`,
                      cursor: onSelectNode ? 'pointer' : 'default',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    title={onSelectNode ? '클릭 시 해당 장치로 이동합니다' : undefined}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: '#0F172A' }}>
                        [{u.tag}] <span style={{ fontWeight: 500, color: '#64748B' }}>({u.unitType})</span>
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: uColor,
                          fontSize: 9.5,
                        }}
                      >
                        {uIsFail ? '✕ 실패' : uIsWarn ? '⚠ 경고' : uIsOk ? '✓ 수렴' : '— N/A'}
                      </span>
                    </div>
                    {u.message && (
                      <div style={{ color: uColor, fontSize: 9.5, lineHeight: 1.35 }}>
                        {u.message}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 2. 순환 루프 & Tear 스트림 잔차 */}
      {(activeTab === 'all' || activeTab === 'tear') && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#334155', marginBottom: 5 }}>
            순환 배관 (Tear Stream) 수렴 상세
          </div>
          {tearResiduals.length === 0 ? (
            <div
              style={{
                fontSize: 10.5,
                color: '#64748B',
                background: '#F8FAFC',
                padding: '6px 8px',
                borderRadius: 5,
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              순환 배관(Recycle Loop) 없음 (단방향 직렬 공정 Direct DAG)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                style={{
                  fontSize: 10,
                  color: '#475569',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                <span>상대 허용오차: {(convergence.relTolerance ?? 1e-4).toExponential(0)}</span>
                <span>
                  진단:{' '}
                  <b>
                    {convergence.recycleDiagnosis === 'oscillating'
                      ? '진동 감지'
                      : convergence.recycleDiagnosis === 'diverging'
                        ? '발산 감지'
                        : convergence.recycleDiagnosis === 'stalled'
                          ? '수렴 정체'
                          : '안정 수렴'}
                  </b>
                </span>
              </div>
              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  overflowX: 'auto',
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 9.5,
                    fontFamily: 'JetBrains Mono, monospace',
                    textAlign: 'left',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#F1F5F9', color: '#475569' }}>
                      <th style={{ padding: '4px 6px' }}>배관</th>
                      <th style={{ padding: '4px 6px' }}>질량상대</th>
                      <th style={{ padding: '4px 6px' }}>온도상대</th>
                      <th style={{ padding: '4px 6px' }}>엔탈피상대</th>
                      <th style={{ padding: '4px 6px' }}>판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tearResiduals.map(tr => (
                      <tr
                        key={tr.edgeId}
                        style={{
                          borderTop: '1px solid #F1F5F9',
                          background: tr.withinTolerance ? '#FFFFFF' : '#FFFBEB',
                        }}
                      >
                        <td style={{ padding: '4px 6px', fontWeight: 700 }}>#{tr.streamNo}</td>
                        <td style={{ padding: '4px 6px' }}>{tr.massRel.toExponential(1)}</td>
                        <td style={{ padding: '4px 6px' }}>{tr.tempRel.toExponential(1)}</td>
                        <td style={{ padding: '4px 6px' }}>{tr.enthalpyRel.toExponential(1)}</td>
                        <td
                          style={{
                            padding: '4px 6px',
                            fontWeight: 700,
                            color: tr.withinTolerance ? '#059669' : '#D97706',
                          }}
                        >
                          {tr.withinTolerance ? '✓ 합격' : '⚠ 미달'}
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

      {/* 3. 보충·약품 주입 정직성 보고 */}
      {(activeTab === 'all' || activeTab === 'makeup') && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 5,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: '#334155' }}>
              비배관 자동 보충·약품 주입 내역
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'JetBrains Mono, monospace',
                color: (convergence.makeupTotalKgH ?? 0) > 0 ? '#B45309' : '#059669',
                fontWeight: 700,
              }}
            >
              합계 {(convergence.makeupTotalKgH ?? 0).toFixed(1)} kg/h
            </span>
          </div>

          {makeupReport.length === 0 ? (
            <div
              style={{
                fontSize: 10.5,
                color: '#64748B',
                background: '#F8FAFC',
                padding: '6px 8px',
                borderRadius: 5,
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              외부 인위적 보충 없음 (순수 배관망 수지 100% 일치)
            </div>
          ) : (
            <div
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                overflowX: 'auto',
                maxHeight: activeTab === 'all' ? 140 : 280,
                overflowY: 'auto',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 9.5,
                  fontFamily: 'JetBrains Mono, monospace',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr style={{ background: '#F1F5F9', color: '#475569' }}>
                    <th style={{ padding: '4px 6px' }}>장치</th>
                    <th style={{ padding: '4px 6px' }}>유형</th>
                    <th style={{ padding: '4px 6px' }}>유량(kg/h)</th>
                    <th style={{ padding: '4px 6px' }}>주입 사유</th>
                  </tr>
                </thead>
                <tbody>
                  {makeupReport.map((m, i) => (
                    <tr
                      key={`${m.nodeId}-${m.kind}-${i}`}
                      style={{
                        borderTop: '1px solid #F1F5F9',
                        background: '#FFFFFF',
                      }}
                    >
                      <td style={{ padding: '4px 6px', fontWeight: 700 }}>{m.tag}</td>
                      <td style={{ padding: '4px 6px', color: '#64748B' }}>
                        {KIND_LABEL_MAP[m.kind] ?? m.kind}
                      </td>
                      <td style={{ padding: '4px 6px', fontWeight: 700, color: '#B45309' }}>
                        {m.totalKgH.toFixed(1)}
                      </td>
                      <td style={{ padding: '4px 6px', color: '#334155' }}>{m.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. 물질·에너지 종합 수지 (Balance) */}
      {(activeTab === 'all' || activeTab === 'balance') && balance && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#334155', marginBottom: 5 }}>
            물질·에너지 종합 수지 결산
          </div>
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 6,
              padding: '7px 9px',
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.6,
            }}
          >
            {/* 물리 배관망만 */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#475569' }}>• 물리 배관망 수지차 (보충 제외):</span>
              <b
                style={{
                  color:
                    Math.abs(balance.physicalMassImbalanceKgH ?? 0) < 0.5 ? '#059669' : '#DC2626',
                }}
              >
                {(balance.physicalMassImbalanceKgH ?? 0).toFixed(2)} kg/h (
                {(balance.physicalMassImbalancePct ?? 0).toFixed(3)}%)
              </b>
            </div>

            {/* 보충 포함 총 수지 */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#475569' }}>• 보충 포함 총 물질 수지차:</span>
              <b style={{ color: Math.abs(balance.massImbalanceKgH) < 0.5 ? '#059669' : '#DC2626' }}>
                {balance.massImbalanceKgH.toFixed(2)} kg/h ({balance.massImbalancePct.toFixed(3)}%)
              </b>
            </div>

            {/* 에너지 잔차 */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#475569' }}>• 전 플랜트 에너지 잔차:</span>
              <b
                style={{
                  color:
                    Math.abs(balance.energyResidualPct) < 0.5
                      ? '#059669'
                      : Math.abs(balance.energyResidualPct) < 2
                        ? '#D97706'
                        : '#DC2626',
                }}
              >
                {balance.energyResidualKW.toFixed(1)} kW ({balance.energyResidualPct.toFixed(2)}%)
              </b>
            </div>

            {/* 미연결 출구 / 보충 유입 카운트 */}
            <div style={{ marginTop: 4, color: '#64748B', fontSize: 9.5 }}>
              미연결 출구 {balance.unroutedOutlets.length}개 ({balance.unroutedOutKgH.toFixed(0)} kg/h) ·
              보충 유입 {balance.makeupInlets.length}개 ({balance.makeupInKgH.toFixed(0)} kg/h)
            </div>
          </div>

          {/* 에너지 잔차 초과 장치 (>0.5%) */}
          {flaggedEnergyChecks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#B45309', marginBottom: 3 }}>
                ⚠ 에너지 잔차 0.5% 초과 장치 ({flaggedEnergyChecks.length}기)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {flaggedEnergyChecks.map(ec => (
                  <div
                    key={ec.nodeId}
                    style={{
                      fontSize: 9.5,
                      fontFamily: 'JetBrains Mono, monospace',
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      padding: '3px 6px',
                      borderRadius: 4,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>[{ec.tag}]</span>
                    <span style={{ color: '#B45309' }}>
                      {ec.residualKW.toFixed(1)} kW ({ec.residualPct.toFixed(2)}% / 규모{' '}
                      {ec.throughputKW.toFixed(0)} kW)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

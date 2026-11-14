'use client';

import React, { useState } from 'react';
import type { FlowsheetBalanceReport, BoundaryStreamEntry } from '@/lib/calculations/flowsheetSolver';

/**
 * 플로우시트 전체 물질·에너지 수지 결산 요약 (미연결 출구 / 보충 유입 명시)
 * - compact: 한 줄 요약만 표시 (수렴 진단 팝오버 등)
 */
export default function FlowsheetBalanceSummary({
  balance,
  compact = false,
  onSelectNode,
}: {
  balance?: FlowsheetBalanceReport;
  compact?: boolean;
  onSelectNode?: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!balance) return null;

  const massOk = Math.abs(balance.massImbalanceKgH) < 0.5;
  const ePct = Math.abs(balance.energyResidualPct);
  const eColor = ePct < 2 ? '#059669' : ePct < 10 ? '#D97706' : '#DC2626';
  const fmt = (v: number, d = 1) => v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

  const massLine = (
    <span>
      질량 불균형{' '}
      <b style={{ color: massOk ? '#059669' : '#DC2626' }}>
        {fmt(balance.massImbalanceKgH, 2)} kg/h ({fmt(balance.massImbalancePct, 3)}%)
      </b>
    </span>
  );
  const energyLine = (
    <span>
      에너지 잔차{' '}
      <b style={{ color: eColor }}>
        {fmt(balance.energyResidualKW)} kW ({fmt(balance.energyResidualPct, 2)}%)
      </b>
    </span>
  );

  if (compact) {
    return (
      <div style={{ marginTop: 2 }}>
        <div>• {massLine}</div>
        <div>• {energyLine}</div>
        <div>
          • 미연결 출구 {balance.unroutedOutlets.length}건 ({fmt(balance.unroutedOutKgH, 0)} kg/h) · 보충 유입{' '}
          {balance.makeupInlets.length}건 ({fmt(balance.makeupInKgH, 0)} kg/h)
        </div>
      </div>
    );
  }

  const renderRows = (rows: BoundaryStreamEntry[], color: string) =>
    rows.map((b, i) => (
      <tr
        key={`${b.nodeId}-${b.port}-${i}`}
        onClick={() => onSelectNode?.(b.nodeId)}
        style={{ borderBottom: '1px solid #F1F5F9', cursor: onSelectNode ? 'pointer' : 'default' }}
      >
        <td style={{ padding: '3px 8px', fontWeight: 800, color }}>{b.tag}</td>
        <td style={{ padding: '3px 8px', fontFamily: 'Inter, sans-serif' }}>{b.label}</td>
        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{fmt(b.totalMassKgH, 2)}</td>
        <td style={{ padding: '3px 8px', textAlign: 'right' }}>{fmt(b.tempC)}</td>
        <td style={{ padding: '3px 8px', fontFamily: 'Inter, sans-serif', color: '#475569' }}>{b.compositionLabel}</td>
      </tr>
    ));

  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        background: '#F8FAFC',
        borderBottom: '1.5px solid #CBD5E1',
        padding: '5px 10px',
        color: '#1E293B',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}>
        <b style={{ fontFamily: 'Inter, sans-serif' }}>📐 전체 수지</b>
        <span>원료 {fmt(balance.feedInKgH, 0)}</span>
        <span>+ 보충 {fmt(balance.makeupInKgH, 0)}</span>
        <span>− 제품 {fmt(balance.productOutKgH, 0)}</span>
        <span>− 미연결출구 {fmt(balance.unroutedOutKgH, 0)} kg/h</span>
        {massLine}
        {energyLine}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            borderRadius: 5,
            padding: '1px 7px',
            fontSize: 10.5,
            fontWeight: 800,
            cursor: 'pointer',
            color: '#334155',
          }}
        >
          경계 스트림 {balance.unroutedOutlets.length + balance.makeupInlets.length}건 {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: '#64748B', marginBottom: 3 }}>
            에너지 = ΣH원료 {fmt(balance.feedEnthalpyKW)} + ΣH보충 {fmt(balance.makeupEnthalpyKW)} + ΣQ {fmt(balance.unitHeatDutyKW)} + ΣW{' '}
            {fmt(balance.unitPowerKW)} − ΣH제품 {fmt(balance.productEnthalpyKW)} − ΣH미연결 {fmt(balance.unroutedEnthalpyKW)} kW (25°C 현열+잠열 기준, 생성열 미포함)
          </div>
          {(balance.unroutedOutlets.length > 0 || balance.makeupInlets.length > 0) && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #CBD5E1', color: '#475569' }}>
                  <th style={{ padding: '3px 8px', textAlign: 'left' }}>장치</th>
                  <th style={{ padding: '3px 8px', textAlign: 'left' }}>경계 스트림</th>
                  <th style={{ padding: '3px 8px', textAlign: 'right' }}>kg/h</th>
                  <th style={{ padding: '3px 8px', textAlign: 'right' }}>°C</th>
                  <th style={{ padding: '3px 8px', textAlign: 'left' }}>조성</th>
                </tr>
              </thead>
              <tbody>
                {balance.unroutedOutlets.length > 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '3px 8px', fontWeight: 800, color: '#B45309', fontFamily: 'Inter, sans-serif' }}>
                      ▼ 미연결 출구 (계외 배출)
                    </td>
                  </tr>
                )}
                {renderRows(balance.unroutedOutlets, '#B45309')}
                {balance.makeupInlets.length > 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '3px 8px', fontWeight: 800, color: '#1D4ED8', fontFamily: 'Inter, sans-serif' }}>
                      ▲ 보충 · 약품 · 배수 유입 (배관 없는 계내 유입)
                    </td>
                  </tr>
                )}
                {renderRows(balance.makeupInlets, '#1D4ED8')}
              </tbody>
            </table>
          )}
          {balance.unitEnergyResiduals.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10.5, color: '#475569' }}>
              장치별 에너지 잔차:{' '}
              {balance.unitEnergyResiduals.slice(0, 6).map(u => `${u.tag} ${fmt(u.residualKW, 0)}kW`).join(' · ')}
            </div>
          )}
          {balance.unitMassImbalances.length > 0 && (
            <div style={{ marginTop: 2, fontSize: 10.5, color: '#DC2626' }}>
              장치별 질량 불균형: {balance.unitMassImbalances.slice(0, 6).map(u => `${u.tag} ${fmt(u.imbalanceKgH, 1)}kg/h`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

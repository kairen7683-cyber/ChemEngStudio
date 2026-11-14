'use client';

import React from 'react';
import type { FlowsheetSolveResult } from '@/lib/calculations/flowsheetSolver';

interface ControlPanelProps {
  solved: FlowsheetSolveResult;
  elapsedMs: number;
  lastRunTime: string;
  blockCount: number;
  streamCount: number;
  propertyMethodLabel: string;
  statusState: 'incomplete' | 'ready' | 'ok' | 'warn' | 'fail';
}

export function ClassicControlPanel({
  solved,
  elapsedMs,
  lastRunTime,
  blockCount,
  streamCount,
}: {
  solved: FlowsheetSolveResult;
  elapsedMs: number;
  lastRunTime: string;
  blockCount: number;
  streamCount: number;
}) {
  const conv = solved.convergence;
  const bal = solved.balance;
  const lines: string[] = [];
  if (conv.isIdle) {
    lines.push('>> Flowsheet ready. Press F5 or click [▶ Run] to solve.');
  } else {
    lines.push(
      `>> Sequential Modular Solver (${conv.methodUsed || conv.tearMethod || 'wegstein'}) finished in ${elapsedMs} ms @ ${lastRunTime}`
    );
    lines.push(
      `>> Topology: ${blockCount} Blocks, ${streamCount} Streams, ${conv.tearEdgeIds.length} Tear Stream(s), ${conv.iterations} Iteration(s)`
    );
    lines.push(
      `>> Overall Mass Balance Closure Error: ${(bal?.massImbalancePct ?? 0).toFixed(4)}% | Max Residual: ${conv.maxResidualKgH.toFixed(3)} kg/h`
    );
    const unitAlerts = (conv.unitConvergence ?? []).filter(u => u.status === 'warning' || u.status === 'failed').slice(0, 6);
    for (const u of unitAlerts) {
      lines.push(`! [${u.status.toUpperCase()}] ${u.tag}: ${u.message}`);
    }
    if (conv.converged) {
      lines.push('*** SIMULATION CONVERGED NORMAL ***');
    } else {
      lines.push('*** SIMULATION FINISHED WITH WARNINGS / ERRORS ***');
    }
  }

  return (
    <div
      style={{
        height: 112,
        background: '#FFFFFF',
        borderTop: '1px solid #CBD5E1',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: '2px 10px',
          background: '#E2E8F0',
          borderBottom: '1px solid #CBD5E1',
          fontSize: 10,
          fontWeight: 800,
          color: '#1E293B',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Control Panel — Solver Console</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#475569' }}>
          Iter: {conv.iterations} | Closure Err: {(bal?.massImbalancePct ?? 0).toFixed(3)}%
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '5px 10px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10.5,
          lineHeight: 1.45,
          color: '#0F172A',
          background: '#F8FAFC',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.startsWith('!')
                ? '#B45309'
                : line.includes('CONVERGED NORMAL')
                  ? '#15803D'
                  : line.includes('ERRORS')
                    ? '#B91C1C'
                    : '#1E293B',
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClassicStatusBar({
  statusState,
  propertyMethodLabel,
  blockCount,
  streamCount,
  lastRunTime,
  elapsedMs,
  activeComponentsCount,
}: Omit<ControlPanelProps, 'solved'> & { activeComponentsCount: number }) {
  const statusMap = {
    ok: { bg: '#16A34A', text: '✔ Results Available (Converged)' },
    warn: { bg: '#D97706', text: '⚠ Results with Warnings' },
    ready: { bg: '#0284C7', text: '● Input Complete (Ready to Run F5)' },
    incomplete: { bg: '#64748B', text: '○ Required Input Incomplete' },
    fail: { bg: '#DC2626', text: '✕ Convergence Error' },
  }[statusState];

  return (
    <div
      style={{
        height: 24,
        background: '#E5E7EB',
        borderTop: '1px solid #CBD5E1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        fontSize: 10.5,
        color: '#1E293B',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            padding: '1px 8px',
            borderRadius: 3,
            background: statusMap.bg,
            color: '#FFFFFF',
            fontWeight: 800,
            fontSize: 10,
          }}
        >
          {statusMap.text}
        </span>
        <span>Method: <b>{propertyMethodLabel}</b></span>
        <span>Components: <b>{activeComponentsCount}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#475569' }}>
        <span>Blocks: {blockCount} | Streams: {streamCount}</span>
        <span>Last Run: {lastRunTime} ({elapsedMs}ms)</span>
      </div>
    </div>
  );
}

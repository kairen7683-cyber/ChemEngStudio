'use client';

import React, { useState } from 'react';
import type { FlowEdgeDef, FlowNodeDef, FlowUnitType } from '@/lib/calculations/flowsheetSolver';

export type ExplorerSelectedKind = 'block' | 'stream' | 'setup_comp' | 'setup_method';

export interface ClassicMdiTab {
  key: string;
  kind: 'pfd' | 'summary' | 'control' | 'block' | 'stream';
  title: string;
  refId?: string;
}

interface ExplorerProps {
  activeComponentsCount: number;
  totalComponentsCount: number;
  effectiveMethodLabel: string;
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
  selectedKind: ExplorerSelectedKind;
  selectedId: string | null;
  activeTabKey: string;
  blockStatusMap: Map<string, 'ok' | 'err' | 'incomplete'>;
  streamMassMap: Map<string, number>;
  getModelName: (u: FlowUnitType) => string;
  onSelectCompSetup: () => void;
  onSelectMethodSetup: () => void;
  onOpenMdiTab: (tab: ClassicMdiTab) => void;
  onSelectStream: (edgeId: string) => void;
  onSelectBlock: (nodeId: string) => void;
}

function StatusIcon({ state }: { state: 'ok' | 'err' | 'incomplete' }) {
  if (state === 'ok') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: 999,
          background: '#16A34A',
          flexShrink: 0,
        }}
        title="Specified / Converged"
      />
    );
  }
  if (state === 'err') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: 999,
          background: '#DC2626',
          flexShrink: 0,
        }}
        title="Warning / Error"
      />
    );
  }
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: 999,
        background: '#2563EB',
        flexShrink: 0,
      }}
      title="Input Ready"
    />
  );
}

export default function ClassicExplorerTree(props: ExplorerProps) {
  const {
    activeComponentsCount,
    totalComponentsCount,
    effectiveMethodLabel,
    simDefs,
    flowEdges,
    selectedKind,
    selectedId,
    activeTabKey,
    blockStatusMap,
    streamMassMap,
    getModelName,
    onSelectCompSetup,
    onSelectMethodSetup,
    onOpenMdiTab,
    onSelectStream,
    onSelectBlock,
  } = props;

  const [propsOpen, setPropsOpen] = useState(true);
  const [blocksOpen, setBlocksOpen] = useState(true);
  const [streamsOpen, setStreamsOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);

  return (
    <aside
      style={{
        width: '100%',
        height: '100%',
        background: '#FFFFFF',
        overflowY: 'auto',
        padding: '6px 6px 12px',
        fontSize: 11.2,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 900,
          color: '#475569',
          padding: '2px 6px 6px',
          borderBottom: '1px solid #E2E8F0',
          marginBottom: 5,
          letterSpacing: '0.03em',
        }}
      >
        ALL FOLDERS
      </div>

      {/* Properties */}
      <div style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setPropsOpen(v => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '3px 4px',
            border: 'none',
            background: 'transparent',
            fontWeight: 800,
            color: '#0F172A',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>{propsOpen ? '▾' : '▸'}</span>
          <StatusIcon state={activeComponentsCount > 0 ? 'ok' : 'err'} />
          <span>Properties</span>
        </button>
        {propsOpen && (
          <div style={{ paddingLeft: 14 }}>
            <button
              type="button"
              onClick={onSelectCompSetup}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '3px 6px',
                borderRadius: 3,
                border: 'none',
                background: selectedKind === 'setup_comp' ? '#DBEAFE' : 'transparent',
                color: selectedKind === 'setup_comp' ? '#1E3A8A' : '#334155',
                fontWeight: selectedKind === 'setup_comp' ? 800 : 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.8,
              }}
            >
              <StatusIcon state="ok" />
              <span>Components ({activeComponentsCount}/{totalComponentsCount})</span>
            </button>
            <button
              type="button"
              onClick={onSelectMethodSetup}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '3px 6px',
                borderRadius: 3,
                border: 'none',
                background: selectedKind === 'setup_method' ? '#DBEAFE' : 'transparent',
                color: selectedKind === 'setup_method' ? '#1E3A8A' : '#334155',
                fontWeight: selectedKind === 'setup_method' ? 800 : 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.8,
              }}
            >
              <StatusIcon state="ok" />
              <span>Methods ({effectiveMethodLabel})</span>
            </button>
          </div>
        )}
      </div>

      {/* Simulation -> Main Flowsheet */}
      <div style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => onOpenMdiTab({ key: 'pfd', kind: 'pfd', title: 'Main Flowsheet' })}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '4px 6px',
            borderRadius: 3,
            border: 'none',
            background: activeTabKey === 'pfd' ? '#DBEAFE' : '#F8FAFC',
            color: activeTabKey === 'pfd' ? '#003399' : '#0F172A',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>📐</span>
          <span>Main Flowsheet</span>
        </button>
      </div>

      {/* Blocks */}
      <div style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setBlocksOpen(v => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '3px 4px',
            border: 'none',
            background: 'transparent',
            fontWeight: 800,
            color: '#0F172A',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>{blocksOpen ? '▾' : '▸'}</span>
          <span>Blocks ({simDefs.length})</span>
        </button>
        {blocksOpen && (
          <div style={{ paddingLeft: 12 }}>
            {simDefs.map(d => {
              const active = selectedKind === 'block' && selectedId === d.id;
              const st = blockStatusMap.get(d.id) ?? 'incomplete';
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onSelectBlock(d.id)}
                  onDoubleClick={() =>
                    onOpenMdiTab({ key: `block:${d.id}`, kind: 'block', title: d.tag, refId: d.id })
                  }
                  title="클릭: 우측 스펙 입력 · 더블클릭: 중앙 MDI 데이터시트 탭 열기"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '3px 6px',
                    borderRadius: 3,
                    border: 'none',
                    background: active ? '#DBEAFE' : 'transparent',
                    color: active ? '#003399' : '#1E293B',
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 4,
                    fontSize: 10.8,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <StatusIcon state={st} />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.tag}
                    </span>
                  </span>
                  <span style={{ fontSize: 9.5, color: '#64748B', flexShrink: 0 }}>
                    {getModelName(d.unitType)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Streams */}
      <div style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setStreamsOpen(v => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '3px 4px',
            border: 'none',
            background: 'transparent',
            fontWeight: 800,
            color: '#0F172A',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>{streamsOpen ? '▾' : '▸'}</span>
          <span>Streams ({flowEdges.length})</span>
        </button>
        {streamsOpen && (
          <div style={{ paddingLeft: 12 }}>
            {flowEdges.map(e => {
              const active = selectedKind === 'stream' && selectedId === e.id;
              const mass = streamMassMap.get(e.id) ?? 0;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelectStream(e.id)}
                  onDoubleClick={() =>
                    onOpenMdiTab({ key: `stream:${e.id}`, kind: 'stream', title: e.streamNo, refId: e.id })
                  }
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '3px 6px',
                    borderRadius: 3,
                    border: 'none',
                    background: active ? '#DBEAFE' : 'transparent',
                    color: active ? '#003399' : '#1E293B',
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 4,
                    fontSize: 10.8,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <StatusIcon state={mass > 0 ? 'ok' : 'incomplete'} />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{e.streamNo}</span>
                  </span>
                  <span style={{ fontSize: 9.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                    {mass > 0 ? `${mass.toFixed(0)}` : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results Summary */}
      <div>
        <button
          type="button"
          onClick={() => setResultsOpen(v => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '3px 4px',
            border: 'none',
            background: 'transparent',
            fontWeight: 800,
            color: '#0F172A',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>{resultsOpen ? '▾' : '▸'}</span>
          <span>Results Summary</span>
        </button>
        {resultsOpen && (
          <div style={{ paddingLeft: 14 }}>
            <button
              type="button"
              onClick={() => onOpenMdiTab({ key: 'summary', kind: 'summary', title: 'Stream Summary' })}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '3px 6px',
                borderRadius: 3,
                border: 'none',
                background: activeTabKey === 'summary' ? '#DBEAFE' : 'transparent',
                color: activeTabKey === 'summary' ? '#003399' : '#334155',
                fontWeight: activeTabKey === 'summary' ? 800 : 600,
                cursor: 'pointer',
                fontSize: 10.8,
              }}
            >
              📊 Streams Table
            </button>
            <button
              type="button"
              onClick={() => onOpenMdiTab({ key: 'control', kind: 'control', title: 'Control Panel' })}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '3px 6px',
                borderRadius: 3,
                border: 'none',
                background: activeTabKey === 'control' ? '#DBEAFE' : 'transparent',
                color: activeTabKey === 'control' ? '#003399' : '#334155',
                fontWeight: activeTabKey === 'control' ? 800 : 600,
                cursor: 'pointer',
                fontSize: 10.8,
              }}
            >
              🖥 Convergence Report
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

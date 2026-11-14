'use client';

import React, { useRef, useState } from 'react';
import { SIM_COMPS, COMP_META, SolvedStream, type SimCompKey } from '@/lib/calculations/flowsheetSolver';

interface HorizontalFlowsheetStreamTableProps {
  streams: SolvedStream[];
  selectedEdgeId: string | null;
  onSelectStream: (edgeId: string) => void;
  onDeleteStream: (edgeId: string) => void;
  configuredComps?: SimCompKey[];
}

const LABEL_W = 186;
const UNIT_W = 78;
const COL_W = 98;

export default function HorizontalFlowsheetStreamTable({
  streams,
  selectedEdgeId,
  onSelectStream,
  onDeleteStream,
  configuredComps,
}: HorizontalFlowsheetStreamTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [compViewMode, setCompViewMode] = useState<'active' | 'configured' | 'all'>('active');
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });

  const activeComps = SIM_COMPS.filter(ck =>
    streams.some(s => (s.flowsKgH[ck] || 0) > 0.00005)
  );
  const configSet = new Set<SimCompKey>(
    configuredComps && configuredComps.length > 0 ? configuredComps : SIM_COMPS.slice(0, 9)
  );
  activeComps.forEach(c => configSet.add(c));
  const mergedConfiguredComps = SIM_COMPS.filter(ck => configSet.has(ck));

  const visibleComps =
    compViewMode === 'all'
      ? SIM_COMPS
      : compViewMode === 'configured'
        ? mergedConfiguredComps
        : activeComps.length > 0
          ? activeComps
          : mergedConfiguredComps;

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = scrollRef.current;
    if (!el) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !scrollRef.current) return;
    scrollRef.current.scrollLeft = dragStart.current.left - (e.clientX - dragStart.current.x);
    scrollRef.current.scrollTop = dragStart.current.top - (e.clientY - dragStart.current.y);
  };

  const stopDrag = () => setDragging(false);

  if (streams.length === 0) {
    return (
      <div style={{ padding: '24px 16px', fontSize: 12, color: '#64748B', textAlign: 'center' }}>
        캔버스에서 장치 간 배관을 연결하면 전해 PFD와 동일한 가로 확장형 H&amp;MB 스트림 시트가 자동 생성됩니다.
      </div>
    );
  }

  const stickyCornerLabel: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    top: 0,
    zIndex: 6,
    width: LABEL_W,
    minWidth: LABEL_W,
    maxWidth: LABEL_W,
    background: '#EFECE5',
    borderRight: '1px solid #DFDCD4',
    borderBottom: '1px solid #DFDCD4',
    padding: '5px 10px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 800,
    color: '#1A2F44',
  };

  const stickyCornerUnit: React.CSSProperties = {
    position: 'sticky',
    left: LABEL_W,
    top: 0,
    zIndex: 6,
    width: UNIT_W,
    minWidth: UNIT_W,
    maxWidth: UNIT_W,
    background: '#EFECE5',
    borderRight: '2px solid #C8C4BA',
    borderBottom: '1px solid #DFDCD4',
    padding: '5px 8px',
    textAlign: 'right',
    fontSize: 9.5,
    fontWeight: 700,
    color: '#64748B',
  };

  const stickyRowLabel = (bg: string, bold = false, indent = false): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 3,
    width: LABEL_W,
    minWidth: LABEL_W,
    maxWidth: LABEL_W,
    background: bg,
    borderRight: '1px solid #E5E2DC',
    borderBottom: '1px solid #EFECE5',
    padding: indent ? '4px 10px 4px 20px' : '4px 10px',
    fontSize: 10,
    fontWeight: bold ? 800 : 600,
    fontStyle: indent ? 'italic' : 'normal',
    color: bold ? '#1A2F44' : '#27272A',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  const stickyRowUnit = (bg: string): React.CSSProperties => ({
    position: 'sticky',
    left: LABEL_W,
    zIndex: 3,
    width: UNIT_W,
    minWidth: UNIT_W,
    maxWidth: UNIT_W,
    background: bg,
    borderRight: '2px solid #C8C4BA',
    borderBottom: '1px solid #EFECE5',
    padding: '4px 8px',
    textAlign: 'right',
    fontSize: 9,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#7A7872',
    whiteSpace: 'nowrap',
  });

  const cellValStyle = (s: SolvedStream, rowBg: string, align: 'right' | 'center' = 'right'): React.CSSProperties => {
    const sel = s.edgeId === selectedEdgeId;
    return {
      minWidth: COL_W,
      width: COL_W,
      padding: '4px 8px',
      textAlign: align,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      background: sel ? '#FEF3C7' : rowBg,
      borderRight: '1px solid #EFECE5',
      borderBottom: '1px solid #EFECE5',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
  };

  const renderPhaseBadge = (s: SolvedStream) => {
    const isLiqCl2 = s.phase === 'L' && s.totalMassKgH > 0 && s.flowsKgH.Cl2 / s.totalMassKgH > 0.5;
    const color = isLiqCl2
      ? '#0284C7'
      : s.phase === 'G'
        ? '#0F5338'
        : s.phase === 'L/G'
          ? '#7C2D12'
          : '#1A2F44';
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          padding: '1px 6px',
          borderRadius: 3,
          color,
          background: `${color}16`,
          border: `1px solid ${color}45`,
        }}
      >
        {isLiqCl2 ? 'L (Liq Cl₂)' : s.phase}
      </span>
    );
  };

  return (
    <div
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        background: '#FFFFFF',
      }}
    >
      <table
        style={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          width: 'max-content',
          minWidth: '100%',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <thead>
          {/* 1단 헤더: 스트림 번호 (우측 가로 확장!) */}
          <tr>
            <th style={stickyCornerLabel}>항목 (Property Item)</th>
            <th style={stickyCornerUnit}>단위</th>
            {streams.map(s => {
              const sel = s.edgeId === selectedEdgeId;
              return (
                <th
                  key={s.edgeId}
                  onClick={() => onSelectStream(s.edgeId)}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 4,
                    minWidth: COL_W,
                    width: COL_W,
                    background: sel ? '#FDE68A' : s.isTearStream ? '#F5F3FF' : '#F6F7F2',
                    borderRight: '1px solid #DFDCD4',
                    borderBottom: '1px solid #DFDCD4',
                    padding: '5px 6px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 10.5,
                        fontWeight: 900,
                        color: s.isTearStream ? '#6D28D9' : '#0F5338',
                      }}
                    >
                      [{s.streamNo}]{s.isTearStream ? '♻' : ''}
                    </span>
                    <button
                      title={`배관 [${s.streamNo}] 삭제`}
                      onClick={ev => {
                        ev.stopPropagation();
                        onDeleteStream(s.edgeId);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: 900,
                        cursor: 'pointer',
                        padding: '0 2px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: '#475569',
                      marginTop: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${s.fromTag} → ${s.toTag} (${s.portRole})`}
                  >
                    {s.fromTag}→{s.toTag}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {/* 01. 유체 식별 / 핵심 농도 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>유체 식별 (Fluid / Conc.)</td>
            <td style={stickyRowUnit('#FAF9F5')}>—</td>
            {streams.map(s => (
              <td
                key={s.edgeId}
                onClick={() => onSelectStream(s.edgeId)}
                style={{
                  ...cellValStyle(s, '#FAF9F5', 'center'),
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: s.keyConcLabel.includes('액화 Cl₂') ? '#0284C7' : '#1A2F44',
                }}
                title={s.keyConcLabel}
              >
                {s.keyConcLabel}
              </td>
            ))}
          </tr>

          {/* 02. 상 (Phase) */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>Phase (상 상태)</td>
            <td style={stickyRowUnit('#FFFFFF')}>—</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={cellValStyle(s, '#FFFFFF', 'center')}>
                {renderPhaseBadge(s)}
              </td>
            ))}
          </tr>

          {/* 03. 기상 분율 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>Vapor Fraction (기상분율 β)</td>
            <td style={stickyRowUnit('#FAF9F5')}>wt frac</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#52525B' }}>
                {s.vaporFraction.toFixed(2)}
              </td>
            ))}
          </tr>

          {/* 04. 온도 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF', true)}>Temperature (온도)</td>
            <td style={stickyRowUnit('#FFFFFF')}>°C</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), fontWeight: 800, color: '#1A2F44' }}>
                {s.tempC.toFixed(1)}
              </td>
            ))}
          </tr>

          {/* 05. 압력 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>Pressure (압력)</td>
            <td style={stickyRowUnit('#FAF9F5')}>kg/cm²G</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), fontWeight: 700, color: '#334155' }}>
                {s.pressKgcm2g.toFixed(2)}
              </td>
            ))}
          </tr>

          {/* 06. 몰 유량 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>Molar Flow (몰유량)</td>
            <td style={stickyRowUnit('#FFFFFF')}>kmol/h</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#1A2F44' }}>
                {s.totalMolarKmolH.toFixed(1)}
              </td>
            ))}
          </tr>

          {/* 07. 부피 유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>Volume Flow (부피유량)</td>
            <td style={stickyRowUnit('#FAF9F5')}>m³/h</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#0F5338', fontWeight: 700 }}>
                {s.volFlowM3H.toFixed(1)}
              </td>
            ))}
          </tr>

          {/* 08. 평균 분자량 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>Average MW (평균분자량)</td>
            <td style={stickyRowUnit('#FFFFFF')}>g/mol</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#52525B' }}>
                {s.avgMW.toFixed(2)}
              </td>
            ))}
          </tr>

          {/* 09. 밀도 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>Density (밀도 ρ)</td>
            <td style={stickyRowUnit('#FAF9F5')}>kg/m³</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#334155' }}>
                {s.phase === 'G' ? s.densityKgM3.toFixed(2) : s.densityKgM3.toFixed(0)}
              </td>
            ))}
          </tr>

          {/* 10. 압축인자 Z / 비열 Cp */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>Heat Capacity Cp (기상 Z)</td>
            <td style={stickyRowUnit('#FFFFFF')}>kcal/kg°C</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#52525B' }}>
                {s.cpKcalKgC.toFixed(3)}
                {s.compressibilityZ !== undefined ? ` (Z=${s.compressibilityZ.toFixed(2)})` : ''}
              </td>
            ))}
          </tr>

          {/* 11. 엔탈피 유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>Enthalpy Flow (엔탈피 유량)</td>
            <td style={stickyRowUnit('#FAF9F5')}>Mcal/h</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#7C2D12', fontWeight: 700 }}>
                {(s.enthalpyKcalH / 1000).toFixed(1)}
              </td>
            ))}
          </tr>

          {/* 12. 수분 농도 (가스/액화염소 스트림용) */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>Moisture (가스 수분농도)</td>
            <td style={stickyRowUnit('#FFFFFF')}>wt ppm</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#0369A1' }}>
                {s.moistureWtPpm !== null ? s.moistureWtPpm.toLocaleString() : '—'}
              </td>
            ))}
          </tr>

          {/* 구분 배너: 성분별 질량유량 */}
          <tr>
            <td
              style={{
                position: 'sticky',
                left: 0,
                zIndex: 3,
                background: '#EFECE5',
                borderTop: '1.5px solid #C8C4BA',
                borderBottom: '1px solid #DFDCD4',
                padding: '4px 10px',
                fontSize: 9.5,
                fontWeight: 900,
                color: '#1A2F44',
                letterSpacing: '0.04em',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span>━ 성분별 질량 유량</span>
                <button
                  type="button"
                  onClick={() =>
                    setCompViewMode(m =>
                      m === 'active'
                        ? configuredComps && configuredComps.length > 0
                          ? 'configured'
                          : 'all'
                        : m === 'configured'
                          ? 'all'
                          : 'active'
                    )
                  }
                  style={{
                    border: '1px solid #C8C4BA',
                    background: compViewMode !== 'active' ? '#1A2F44' : '#FFFFFF',
                    color: compViewMode !== 'active' ? '#FFFFFF' : '#334155',
                    borderRadius: 4,
                    padding: '1px 5px',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                  title="활성 성분(유량>0) / 프로젝트 설정 성분 / 등록 전체 성분을 순환 표시합니다"
                >
                  {compViewMode === 'all'
                    ? `전체 ${SIM_COMPS.length}종`
                    : compViewMode === 'configured'
                      ? `설정 ${mergedConfiguredComps.length}종`
                      : `활성 ${visibleComps.length}종`}
                </button>
              </div>
            </td>
            <td
              style={{
                position: 'sticky',
                left: LABEL_W,
                zIndex: 3,
                background: '#EFECE5',
                borderTop: '1.5px solid #C8C4BA',
                borderBottom: '1px solid #DFDCD4',
                borderRight: '2px solid #C8C4BA',
                padding: '4px 8px',
                fontSize: 9,
                fontWeight: 800,
                color: '#64748B',
                textAlign: 'right',
              }}
            >
              kg/h
            </td>
            {streams.map(s => (
              <td
                key={s.edgeId}
                style={{
                  background: '#EFECE5',
                  borderTop: '1.5px solid #C8C4BA',
                  borderBottom: '1px solid #DFDCD4',
                  borderRight: '1px solid #E5E2DC',
                }}
              />
            ))}
          </tr>

          {/* 13. 총 질량유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>Total Mass Flow (총 질량유량)</td>
            <td style={stickyRowUnit('#FAF9F5')}>kg/h</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), fontWeight: 900, color: '#18181B' }}>
                {s.totalMassKgH.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </td>
            ))}
          </tr>

          {/* 14+. 개별 성분 질량유량 */}
          {visibleComps.map((comp, idx) => {
            const bg = idx % 2 === 0 ? '#FFFFFF' : '#FAF9F5';
            return (
              <tr key={comp}>
                <td style={stickyRowLabel(bg, false, true)}>{COMP_META[comp].label}</td>
                <td style={stickyRowUnit(bg)}>kg/h</td>
                {streams.map(s => {
                  const val = s.flowsKgH[comp] || 0;
                  return (
                    <td
                      key={s.edgeId}
                      onClick={() => onSelectStream(s.edgeId)}
                      style={{
                        ...cellValStyle(s, bg),
                        color: val >= 0.0001 ? '#1A2F44' : '#CBD5E1',
                        fontWeight: val >= 0.0001 ? 700 : 400,
                      }}
                    >
                      {val >= 1.0
                        ? val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                        : val >= 0.0001
                          ? val.toFixed(4)
                          : '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { StreamData } from '@/lib/calculations/streams';
import { useState } from 'react';
import { editModeRef } from './SectionGroupNode';

// ── Custom Icon Renderer (아이콘 관리 모달에서 등록한 커스텀 SVG 우선 렌더링) ──
function useCustomIconSvg(type: string, fallbackW: number, fallbackH: number) {
  const customIcon = usePFDStore(s => s.customIcons?.[type]);
  if (!customIcon) return null;
  return (
    <svg
      width={fallbackW}
      height={fallbackH}
      viewBox={customIcon.viewBox}
      dangerouslySetInnerHTML={{ __html: customIcon.svgInner }}
    />
  );
}

// ── 공통 핸들 스타일 ────────────────────────────────────────
const hs = (color: string) => ({
  background: color, width: 8, height: 8,
  border: '2px solid var(--bg-elevated)',
});

// ── PPT-style connection handles ─────────────────────────────
// Handles live INSIDE .pfd-node-body (position:relative) so that
// percentage-based left/top are anchored to the body element, not
// the outer flex wrapper. This fixes the snap-to-handle issue.
//
// Layout: 2 per side = 8 total
//   SOURCE (pipe starts here) → Right (a=25%, b=75%), Bottom (a=30%, b=70%)
//   TARGET (pipe ends here)   → Left  (a=25%, b=75%), Top   (a=30%, b=70%)

interface BodyWithHandlesProps {
  bodyStyle?: React.CSSProperties;
  bodyClass?: string;
  color?: string;
  visible: boolean;
  children: React.ReactNode;
}

function BodyWithHandles({ bodyStyle, bodyClass = 'pfd-node-body', color = '#60a5fa', visible, children }: BodyWithHandlesProps) {
  // Gate handle visibility AND interactivity on editMode.
  // Hover state (visible) still drives the animation, but handles are
  // invisible and non-interactive when not in edit mode.
  const inEditMode = editModeRef.current;
  const show = visible && inEditMode;

  const handleBase: React.CSSProperties = {
    width: 12, height: 12,
    borderRadius: '50%',
    border: `2.5px solid #0a0e1a`,
    boxShadow: show ? `0 0 8px ${color}cc, 0 0 2px #fff4` : 'none',
    opacity: show ? 1 : 0,
    transition: 'opacity 0.12s, box-shadow 0.12s',
    cursor: show ? 'crosshair' : 'default',
    pointerEvents: show ? 'all' : 'none',   // non-interactive in view mode
    zIndex: 50,
    background: color,
  };

  // All handles are type="source" so any handle can start OR end a connection.
  // ConnectionMode.Loose (set on ReactFlow) allows source→source connections,
  // making every handle fully bidirectional without src/tgt distinction.
  return (
    <div className={bodyClass} style={{ ...bodyStyle, position: 'relative', overflow: 'visible' }}>
      {children}

      <Handle type="source" position={Position.Right}  id="src-r1" style={{ ...handleBase, top: '25%',  right: '-6px' }} />
      <Handle type="source" position={Position.Right}  id="src-r2" style={{ ...handleBase, top: '75%',  right: '-6px' }} />
      <Handle type="source" position={Position.Bottom} id="src-b1" style={{ ...handleBase, left: '30%', bottom: '-6px' }} />
      <Handle type="source" position={Position.Bottom} id="src-b2" style={{ ...handleBase, left: '70%', bottom: '-6px' }} />
      <Handle type="source" position={Position.Left}   id="tgt-l1" style={{ ...handleBase, top: '25%',  left: '-6px' }} />
      <Handle type="source" position={Position.Left}   id="tgt-l2" style={{ ...handleBase, top: '75%',  left: '-6px' }} />
      <Handle type="source" position={Position.Top}    id="tgt-t1" style={{ ...handleBase, left: '30%', top: '-6px' }} />
      <Handle type="source" position={Position.Top}    id="tgt-t2" style={{ ...handleBase, left: '70%', top: '-6px' }} />
    </div>
  );
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스트림 라벨 + 호버 툴팁 (핵심 컴포넌트)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function StreamLabelNode({ data }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const { balance } = useBalanceStore();
  const stream = balance.streams.find(s => s.id === data.streamId);

  const phaseColor = data.phase === 'G'   ? '#a78bfa'
    : data.phase === 'L/G' ? '#fbbf24'
    : '#4ade80';

  return (
    <div style={{ position: 'relative' }}>
      {/* All handles are type=source for bidirectional connection (ConnectionMode.Loose) */}
      <Handle type="source" position={Position.Right}  id="src-r1" style={{ opacity: 0, width: 4, height: 4, top: '25%'  }} />
      <Handle type="source" position={Position.Right}  id="src-r2" style={{ opacity: 0, width: 4, height: 4, top: '75%'  }} />
      <Handle type="source" position={Position.Bottom} id="src-b1" style={{ opacity: 0, width: 4, height: 4, left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="src-b2" style={{ opacity: 0, width: 4, height: 4, left: '70%' }} />
      <Handle type="source" position={Position.Left}   id="tgt-l1" style={{ opacity: 0, width: 4, height: 4, top: '25%'  }} />
      <Handle type="source" position={Position.Left}   id="tgt-l2" style={{ opacity: 0, width: 4, height: 4, top: '75%'  }} />
      <Handle type="source" position={Position.Top}    id="tgt-t1" style={{ opacity: 0, width: 4, height: 4, left: '30%' }} />
      <Handle type="source" position={Position.Top}    id="tgt-t2" style={{ opacity: 0, width: 4, height: 4, left: '70%' }} />

      {/* 스트림 번호 배지 */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? 'var(--bg-hover)' : 'var(--bg-card)',
          border: `1px solid ${hovered ? phaseColor : `${phaseColor}55`}`,
          borderRadius: 4,
          padding: '3px 8px',
          cursor: 'crosshair',
          minWidth: 40,
          textAlign: 'center',
          transition: 'all 0.15s ease',
          boxShadow: hovered ? `0 0 12px ${phaseColor}40` : 'none',
        }}
      >
        <div style={{
          fontSize: 11, fontWeight: 700,
          fontFamily: 'JetBrains Mono, monospace',
          color: hovered ? phaseColor : 'var(--text-primary)',
          letterSpacing: '0.3px',
        }}>
          [{data.streamId}]
        </div>
        {data.flowKgh !== undefined && (
          <div style={{
            fontSize: 9, color: 'var(--accent-primary)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {Number(data.flowKgh).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} kg/h
          </div>
        )}
        {/* 상 표시 */}
        <div style={{
          fontSize: 8, color: phaseColor, opacity: 0.8,
          fontFamily: 'JetBrains Mono',
        }}>
          {data.phase || 'L'}
        </div>
      </div>

      {/* 호버 툴팁 */}
      {hovered && stream && (
        <StreamTooltip stream={stream} phaseColor={phaseColor} />
      )}
    </div>
  );
}

// ── 리치 툴팁 컴포넌트 ──────────────────────────────────────
function StreamTooltip({ stream, phaseColor }: { stream: StreamData; phaseColor: string }) {
  const comps = Object.entries(stream.components)
    .filter(([, v]) => v && v > 0)
    .sort(([, a], [, b]) => (b || 0) - (a || 0));

  const total = stream.total_kgh;

  const compLabels: Record<string, string> = {
    NaCl: 'NaCl', H2O: 'H₂O', NaOH: 'NaOH', Cl2: 'Cl₂',
    H2: 'H₂', HCl: 'HCl', O2: 'O₂', H2SO4: 'H₂SO₄',
    BaCl2: 'BaCl₂', Na2SO3: 'Na₂SO₃',
  };

  const compColors: Record<string, string> = {
    NaCl: '#4ade80', H2O: '#94a3b8', NaOH: '#f97316', Cl2: '#60a5fa',
    H2: '#a78bfa', HCl: '#fde68a', O2: '#fb923c', H2SO4: '#fbbf24',
    BaCl2: '#86efac', Na2SO3: '#c4b5fd',
  };

  const fmtN = (v: number | undefined, dec = 0) => {
    if (!v) return '—';
    return v.toLocaleString('ko-KR', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };

  return (
    <div style={{
      position: 'absolute',
      left: '110%',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 9999,
      width: 280,
      background: '#FFFFFF',
      border: `1px solid ${phaseColor}55`,
      borderRadius: 8,
      boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px ${phaseColor}22`,
      backdropFilter: 'blur(12px)',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      {/* 헤더 */}
      <div style={{
        background: `linear-gradient(90deg, ${phaseColor}20, transparent)`,
        borderBottom: `1px solid ${phaseColor}30`,
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <span style={{
            fontSize: 13, fontWeight: 700, color: phaseColor,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.5px',
          }}>
            [{stream.id}]
          </span>
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', marginLeft: 8,
          }}>
            {stream.section} Sec
          </span>
        </div>
        <span style={{
          fontSize: 9, padding: '2px 6px',
          background: `${phaseColor}25`,
          border: `1px solid ${phaseColor}44`,
          borderRadius: 10, color: phaseColor, fontWeight: 700,
          fontFamily: 'JetBrains Mono',
        }}>
          {stream.phase || 'L'}
        </span>
      </div>

      {/* 스트림 이름 */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{stream.name}</div>
        {stream.description && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {stream.description}
          </div>
        )}
      </div>

      {/* 유량 조성 */}
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
          유량 조성
        </div>
        {comps.map(([key, val]) => {
          const pct = total > 0 ? ((val || 0) / total * 100) : 0;
          return (
            <div key={key} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: compColors[key] || 'var(--text-primary)',
                  fontFamily: 'JetBrains Mono',
                }}>
                  {compLabels[key] || key}
                </span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>
                    {fmtN(val, 1)} kg/h
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono', width: 38, textAlign: 'right' }}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
              {/* 조성 바 */}
              <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${Math.min(100, pct)}%`,
                  background: compColors[key] || phaseColor,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          );
        })}
        {/* 합계 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          paddingTop: 6, marginTop: 2,
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>합  계</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'JetBrains Mono' }}>
            {fmtN(total, 0)} kg/h
          </span>
        </div>
      </div>

      {/* 운전 조건 */}
      <div style={{
        padding: '6px 12px 8px',
        background: 'rgba(255,255,255,0.02)',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>
          운전 조건
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' }}>
          {[
            { label: '온도', value: stream.temperature_C, unit: '°C' },
            { label: '압력', value: stream.pressure_kgcm2g, unit: 'kg/cm².G' },
            { label: '밀도', value: stream.density_kgm3, unit: 'kg/m³', dec: 2 },
            { label: '농도', value: stream.concentration, unit: 'wt%', dec: 1 },
          ].filter(r => r.value !== undefined && r.value !== null).map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>
                {fmtN(row.value, row.dec ?? 0)} {row.unit}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 전해조 (Electrolyzer — Bipolar Filter-Press Membrane Cell Stack)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function ElectrolyzerNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('electrolyzer', 96, 62);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles
        color="#0284c7" visible={hov}
        bodyStyle={{ width: 100, height: 70, padding: 2 }}
      >
        {customSvg ?? (
          <svg width="96" height="62" viewBox="0 0 96 62">
            {/* Heavy End Press Frames */}
            <rect x="4" y="6" width="5" height="44" rx="1" fill="#1A2F44" />
            <rect x="87" y="6" width="5" height="44" rx="1" fill="#1A2F44" />
            {/* Tie-Rods (Top & Bottom) */}
            <line x1="2" y1="11" x2="94" y2="11" stroke={stroke} strokeWidth="1.5" />
            <line x1="2" y1="45" x2="94" y2="45" stroke={stroke} strokeWidth="1.5" />
            {/* Cell Stack Body */}
            <rect x="9" y="8" width="78" height="40" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Bipolar Cell Elements & Ion-Exchange Membranes */}
            <rect x="9" y="8" width="39" height="40" fill="rgba(16,185,129,0.08)" />
            <rect x="48" y="8" width="39" height="40" fill="rgba(249,115,22,0.08)" />
            {[22, 35, 61, 74].map(x => (
              <line key={x} x1={x} y1="8" x2={x} y2="48" stroke="#94a3b8" strokeWidth="0.9" />
            ))}
            {/* Central Ion-Exchange Membrane (IEM) */}
            <line x1="48" y1="6" x2="48" y2="50" stroke="#0284c7" strokeWidth="2.2" strokeDasharray="4 2" />
            {/* Anode / Cathode Labels & Busbars */}
            <rect x="13" y="15" width="22" height="12" rx="2" fill="#ecfdf5" stroke="#059669" strokeWidth="1" />
            <text x="24" y="24" fontSize="8" fontWeight="800" fill="#059669" fontFamily="JetBrains Mono" textAnchor="middle">AN+</text>
            <rect x="61" y="15" width="22" height="12" rx="2" fill="#fff7ed" stroke="#ea580c" strokeWidth="1" />
            <text x="72" y="24" fontSize="8" fontWeight="800" fill="#ea580c" fontFamily="JetBrains Mono" textAnchor="middle">CA-</text>
            {/* Gas Disengagement Header */}
            <path d="M24 39 L24 31 M21 34 L24 31 L27 34" stroke="#059669" strokeWidth="1.3" fill="none" />
            <path d="M72 39 L72 31 M69 34 L72 31 L75 34" stroke="#ea580c" strokeWidth="1.3" fill="none" />
            {/* Support Pedestals */}
            <path d="M16 48 L12 58 M22 48 L22 58 M10 58 L25 58" stroke={stroke} strokeWidth="1.6" fill="none" />
            <path d="M74 48 L74 58 M80 48 L84 58 M71 58 L86 58" stroke={stroke} strokeWidth="1.6" fill="none" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 반응기 / 교반 드럼 (Agitated Drum / Reactor / Clarifier)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function AgitatedDrumNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('agitatedDrum', 48, 62);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 54, height: 66, padding: 2 }}>
        {customSvg ?? (
          <svg width="48" height="62" viewBox="0 0 48 62">
            {/* Agitator Motor Drive Box [M] */}
            <rect x="17" y="1" width="14" height="10" rx="1.5" fill="#1A2F44" stroke={stroke} strokeWidth="1.2" />
            <text x="24" y="8.5" fontSize="7" fontWeight="800" fill="#FFFFFF" fontFamily="JetBrains Mono" textAnchor="middle">M</text>
            <line x1="24" y1="11" x2="24" y2="16" stroke={stroke} strokeWidth="1.8" />
            {/* Vertical Cylindrical Vessel with 2:1 Ellipsoidal Top & Conical/Ellipsoidal Bottom */}
            <path d="M8 21 A16 5.5 0 0 1 40 21 L40 48 A16 5.5 0 0 1 8 48 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Internal Side Baffles */}
            <line x1="10.5" y1="23" x2="10.5" y2="45" stroke="#64748b" strokeWidth="1.2" />
            <line x1="37.5" y1="23" x2="37.5" y2="45" stroke="#64748b" strokeWidth="1.2" />
            {/* Liquid Level Wave */}
            <line x1="8.5" y1="27" x2="39.5" y2="27" stroke="#0284c7" strokeWidth="1" strokeDasharray="3 2" />
            {/* Agitator Shaft */}
            <line x1="24" y1="16" x2="24" y2="45" stroke={stroke} strokeWidth="1.6" />
            {/* Upper Pitched-Blade Impeller */}
            <path d="M15 33 C18 30, 21 36, 24 33 C27 30, 30 36, 33 33" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
            {/* Lower Rushton Turbine Impeller */}
            <line x1="13" y1="43" x2="35" y2="43" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
            <line x1="14" y1="40.5" x2="14" y2="45.5" stroke={stroke} strokeWidth="1.6" />
            <line x1="34" y1="40.5" x2="34" y2="45.5" stroke={stroke} strokeWidth="1.6" />
            {/* Support Legs */}
            <line x1="13" y1="52.5" x2="10" y2="60" stroke={stroke} strokeWidth="1.6" />
            <line x1="35" y1="52.5" x2="38" y2="60" stroke={stroke} strokeWidth="1.6" />
            <line x1="7" y1="60" x2="15" y2="60" stroke={stroke} strokeWidth="1.6" />
            <line x1="33" y1="60" x2="41" y2="60" stroke={stroke} strokeWidth="1.6" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수직 드럼 / 저장 탱크 (Vertical Drum / Storage Tank)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function TankNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  // If data.agitated is set, render AgitatedDrumNode graphic while keeping TankNode handles
  const isAgitated = Boolean(data.agitated);
  const customSvg = useCustomIconSvg(isAgitated ? 'agitatedDrum' : 'tank', 48, 60);
  if (isAgitated) {
    return <AgitatedDrumNode {...({ data } as NodeProps)} />;
  }
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 54, height: 66, padding: 2 }}>
        {customSvg ?? (
          <svg width="48" height="60" viewBox="0 0 48 60">
            {/* Top Nozzle */}
            <line x1="24" y1="2" x2="24" y2="7" stroke={stroke} strokeWidth="1.8" />
            <line x1="20" y1="2" x2="28" y2="2" stroke={stroke} strokeWidth="1.8" />
            {/* Vertical Cylindrical Shell with 2:1 Ellipsoidal Heads */}
            <path d="M8 13 A16 6 0 0 1 40 13 L40 46 A16 6 0 0 1 8 46 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Liquid Fill Tint & Level Line with PFD Level Triangle (▽) */}
            <path d="M8.8 34 L39.2 34 L39.2 46 A15.2 5.2 0 0 1 8.8 46 Z" fill="rgba(2,132,199,0.09)" />
            <line x1="8.5" y1="34" x2="39.5" y2="34" stroke="#0284c7" strokeWidth="1.2" strokeDasharray="3 2" />
            <polygon points="24,34 21,29 27,29" fill="none" stroke="#0284c7" strokeWidth="1.1" />
            {/* Weld Seam Lines (Head-to-Shell Tangents) */}
            <line x1="8" y1="13" x2="40" y2="13" stroke="#94a3b8" strokeWidth="0.7" strokeDasharray="2 2" />
            <line x1="8" y1="46" x2="40" y2="46" stroke="#94a3b8" strokeWidth="0.7" strokeDasharray="2 2" />
            {/* External Level Gauge (LG) */}
            <path d="M40 19 L44 19 L44 41 L40 41" fill="none" stroke="#64748b" strokeWidth="1.1" />
            {/* Support Skirt / Legs */}
            <line x1="13" y1="51" x2="11" y2="58" stroke={stroke} strokeWidth="1.7" />
            <line x1="35" y1="51" x2="37" y2="58" stroke={stroke} strokeWidth="1.7" />
            <line x1="8" y1="58" x2="16" y2="58" stroke={stroke} strokeWidth="1.7" />
            <line x1="32" y1="58" x2="40" y2="58" stroke={stroke} strokeWidth="1.7" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수평 드럼 (Horizontal Drum — Saddle Supports & Weir/Level)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function DrumHorizontalNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('drumHorizontal', 70, 36);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 76, height: 40, padding: 2 }}>
        {customSvg ?? (
          <svg width="70" height="36" viewBox="0 0 70 36">
            {/* Horizontal Cylindrical Shell with 2:1 Ellipsoidal Dished Ends */}
            <path d="M12 4 L58 4 A9 11 0 0 1 58 26 L12 26 A9 11 0 0 1 12 4 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Head Tangent Seams */}
            <line x1="12" y1="4" x2="12" y2="26" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="2 2" />
            <line x1="58" y1="4" x2="58" y2="26" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="2 2" />
            {/* Internal Overflow Weir & Liquid Level */}
            <line x1="44" y1="12" x2="44" y2="26" stroke={stroke} strokeWidth="1.3" />
            <line x1="5" y1="17" x2="44" y2="17" stroke="#0284c7" strokeWidth="1.1" strokeDasharray="3 2" />
            <polygon points="24,17 21.5,12.5 26.5,12.5" fill="none" stroke="#0284c7" strokeWidth="1" />
            {/* Dual Saddle Supports */}
            <path d="M18 26 L15 33 L25 33 L22 26" fill="#e2e8f0" stroke={stroke} strokeWidth="1.4" />
            <path d="M48 26 L45 33 L55 33 L52 26" fill="#e2e8f0" stroke={stroke} strokeWidth="1.4" />
            <line x1="12" y1="33" x2="58" y2="33" stroke={stroke} strokeWidth="1.5" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 원심 펌프 (Centrifugal Pump — ISO 10628 Volute + Tangential Nozzle + Pedestal)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function PumpNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('pump', 32, 32);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 36, height: 36, padding: 2 }}>
        {customSvg ?? (
          <svg width="32" height="32" viewBox="0 0 32 32">
            {/* Baseplate Pedestal Triangle (ISO PFD Standard) */}
            <polygon points="15,17 7,29 23,29" fill="#e2e8f0" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
            <line x1="4" y1="29" x2="26" y2="29" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
            {/* Tangential Top/Right Discharge Nozzle */}
            <path d="M15 5 L28 5 L28 11 L23 11" fill="#FFFFFF" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
            {/* Horizontal Center Suction Nozzle */}
            <line x1="1" y1="16" x2="6" y2="16" stroke={stroke} strokeWidth="2" />
            {/* Circular Pump Volute Casing */}
            <circle cx="15" cy="16" r="10.5" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Impeller Eye & Directional Flow Chevron */}
            <circle cx="15" cy="16" r="3.5" fill="none" stroke={stroke} strokeWidth="1.3" />
            <path d="M13 11 L21 16 L13 21" fill="none" stroke="#0284c7" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 기액 분리기 / 수직 K.O 드럼 (Vertical Knock-Out Drum / Vapor-Liquid Separator)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function SeparatorNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('separator', 38, 70);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 44, height: 76, padding: 2 }}>
        {customSvg ?? (
          <svg width="38" height="70" viewBox="0 0 38 70">
            {/* Top Vapor Outlet Nozzle */}
            <line x1="19" y1="1" x2="19" y2="5" stroke={stroke} strokeWidth="1.8" />
            <line x1="15" y1="1" x2="23" y2="1" stroke={stroke} strokeWidth="1.8" />
            {/* Vertical Cylindrical Drum with Ellipsoidal Heads */}
            <path d="M5 11 A14 6 0 0 1 33 11 L33 56 A14 6 0 0 1 5 56 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Top Wire-Mesh Demister Pad (Cross-Hatched Band) */}
            <rect x="5.5" y="16" width="27" height="7" fill="rgba(148,163,184,0.22)" stroke={stroke} strokeWidth="1.1" />
            <path d="M7 16 L13 23 M13 16 L19 23 M19 16 L25 23 M25 16 L31 23 M13 16 L7 23 M19 16 L13 23 M25 16 L19 23 M31 16 L25 23" stroke={stroke} strokeWidth="0.7" />
            {/* Inlet Schoepentoeter / Baffle */}
            <path d="M5.5 31 L14 31 L14 36" fill="none" stroke={stroke} strokeWidth="1.3" />
            {/* Liquid Holdup Zone & Level Indicator */}
            <path d="M5.8 43 L32.2 43 L32.2 56 A13.2 5.2 0 0 1 5.8 56 Z" fill="rgba(2,132,199,0.10)" />
            <line x1="5.5" y1="43" x2="32.5" y2="43" stroke="#0284c7" strokeWidth="1.2" strokeDasharray="3 2" />
            <polygon points="19,43 16.5,38.5 21.5,38.5" fill="none" stroke="#0284c7" strokeWidth="1" />
            {/* Support Skirt */}
            <path d="M9 60 L7 68 L31 68 L29 60" fill="none" stroke={stroke} strokeWidth="1.6" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 열교환기 (Heat Exchanger — ISO 10628 Shell & Tube / TEMA Symbol)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function HeatExchangerNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('heatExchanger', 54, 42);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color="#ea580c" visible={hov} bodyStyle={{ width: 60, height: 48, padding: 2 }}>
        {customSvg ?? (
          <svg width="54" height="42" viewBox="0 0 54 42">
            {/* Shell Nozzles (Top & Bottom) */}
            <line x1="16" y1="2" x2="16" y2="8" stroke={stroke} strokeWidth="1.7" />
            <line x1="13" y1="2" x2="19" y2="2" stroke={stroke} strokeWidth="1.7" />
            <line x1="38" y1="34" x2="38" y2="40" stroke={stroke} strokeWidth="1.7" />
            <line x1="35" y1="40" x2="41" y2="40" stroke={stroke} strokeWidth="1.7" />
            {/* TEMA Horizontal Shell & Bonnets */}
            <path d="M9 8 L45 8 A6 13 0 0 1 45 34 L9 34 A6 13 0 0 1 9 8 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Tubesheets (Left & Right) */}
            <line x1="11" y1="8" x2="11" y2="34" stroke={stroke} strokeWidth="1.5" />
            <line x1="43" y1="8" x2="43" y2="34" stroke={stroke} strokeWidth="1.5" />
            {/* Internal Tube-Pass Zigzag / Coil Symbol (PFD Standard) */}
            <polyline points="4,21 11,21 16,13 23,29 31,13 38,29 43,21 50,21" fill="none" stroke="#ea580c" strokeWidth="1.7" strokeLinejoin="round" />
            {/* Saddle Supports */}
            <path d="M16 34 L14 39 M38 34 L40 39" stroke={stroke} strokeWidth="1.4" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 강하막 증발관 (Falling Film Evaporator — Calandria Shell + Top Distributor)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function EvaporatorNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('evaporator', 34, 84);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 38, height: 90, padding: 2 }}>
        {customSvg ?? (
          <svg width="34" height="84" viewBox="0 0 34 84">
            {/* Top Liquor Feed Nozzle */}
            <line x1="17" y1="1" x2="17" y2="5" stroke={stroke} strokeWidth="1.8" />
            {/* Tall Vertical Tubular Evaporator Body */}
            <path d="M5 11 A12 6 0 0 1 29 11 L29 68 L21 78 L13 78 L5 68 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
            {/* Top Falling-Film Liquor Distributor Tray */}
            <line x1="6" y1="15" x2="28" y2="15" stroke="#0284c7" strokeWidth="1.3" />
            {/* Upper & Lower Tubesheets */}
            <line x1="5" y1="21" x2="29" y2="21" stroke={stroke} strokeWidth="1.8" />
            <line x1="5" y1="62" x2="29" y2="62" stroke={stroke} strokeWidth="1.8" />
            {/* Calandria Heating Section Tint */}
            <rect x="5.8" y="21.8" width="22.4" height="39.4" fill="rgba(234,88,12,0.08)" />
            {/* Vertical Falling-Film Heating Tubes */}
            {[10, 14.5, 19.5, 24].map(x => (
              <line key={x} x1={x} y1="21" x2={x} y2="62" stroke={stroke} strokeWidth="1.1" />
            ))}
            {/* Shell-Side Baffles */}
            <line x1="5" y1="34" x2="21" y2="34" stroke="#ea580c" strokeWidth="1.1" />
            <line x1="13" y1="48" x2="29" y2="48" stroke="#ea580c" strokeWidth="1.1" />
            {/* Bottom Outlet Nozzle & Support Legs */}
            <line x1="17" y1="78" x2="17" y2="83" stroke={stroke} strokeWidth="1.8" />
            <line x1="8" y1="71" x2="6" y2="82" stroke={stroke} strokeWidth="1.6" />
            <line x1="26" y1="71" x2="28" y2="82" stroke={stroke} strokeWidth="1.6" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 증류컬럼 / 트레이탑 (Distillation / Tray Column — Sieve Trays & Downcomers)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function TowerNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('tower', 34, 84);
  // If tagged as Falling-Film Evaporator (E-320/330/340) or subType==='evap', render EvaporatorNode
  const tagStr = String(data.tag || '');
  if (data.subType === 'evap' || /^E-3[234]0/.test(tagStr)) {
    return <EvaporatorNode {...({ data } as NodeProps)} />;
  }
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 38, height: 90, padding: 2 }}>
        {customSvg ?? (
          <svg width="34" height="84" viewBox="0 0 34 84">
            {/* Top Overhead Vapor Nozzle */}
            <line x1="17" y1="1" x2="17" y2="5" stroke={stroke} strokeWidth="1.8" />
            {/* Vertical Column Shell with 2:1 Ellipsoidal Heads */}
            <path d="M5 11 A12 6 0 0 1 29 11 L29 68 A12 6 0 0 1 5 68 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Alternating Sieve Trays with Downcomers (Authentic PFD Distillation Column) */}
            {[19, 29, 39, 49, 59].map((y, idx) => {
              const leftDown = idx % 2 === 1;
              return (
                <g key={y}>
                  <line
                    x1={leftDown ? 9 : 5.5}
                    y1={y}
                    x2={leftDown ? 28.5 : 25}
                    y2={y}
                    stroke={stroke}
                    strokeWidth="1.3"
                  />
                  {/* Downcomer Weir */}
                  <line
                    x1={leftDown ? 9 : 25}
                    y1={y}
                    x2={leftDown ? 9 : 25}
                    y2={y + 6}
                    stroke={stroke}
                    strokeWidth="1.2"
                  />
                  {/* Bubbling Caps / Tray Perforation Dots */}
                  <line
                    x1={leftDown ? 12 : 8}
                    y1={y - 1.8}
                    x2={leftDown ? 26 : 22}
                    y2={y - 1.8}
                    stroke="#0284c7"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                </g>
              );
            })}
            {/* Bottom Sump Liquid Level */}
            <line x1="6" y1="66" x2="28" y2="66" stroke="#0284c7" strokeWidth="1" strokeDasharray="2 2" />
            {/* Column Support Skirt */}
            <path d="M8 72 L6 82 L28 82 L26 72" fill="#e2e8f0" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
            <line x1="4" y1="82" x2="30" y2="82" stroke={stroke} strokeWidth="2" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팩킹컬럼 / 충진탑 (Packed Column — ISO 10628 Crossed 'X' Packed Beds + Distributor)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function TowerPackingNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('towerPacking', 34, 84);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 38, height: 90, padding: 2 }}>
        {customSvg ?? (
          <svg width="34" height="84" viewBox="0 0 34 84">
            {/* Top Overhead Gas Nozzle */}
            <line x1="17" y1="1" x2="17" y2="5" stroke={stroke} strokeWidth="1.8" />
            {/* Vertical Column Shell with 2:1 Ellipsoidal Heads */}
            <path d="M5 11 A12 6 0 0 1 29 11 L29 68 A12 6 0 0 1 5 68 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            {/* Upper Liquid Spray Distributor Header */}
            <line x1="8" y1="15" x2="26" y2="15" stroke="#0284c7" strokeWidth="1.3" />
            <line x1="11" y1="15" x2="11" y2="18" stroke="#0284c7" strokeWidth="1.1" />
            <line x1="17" y1="15" x2="17" y2="18" stroke="#0284c7" strokeWidth="1.1" />
            <line x1="23" y1="15" x2="23" y2="18" stroke="#0284c7" strokeWidth="1.1" />
            {/* Upper Packed Bed Section (PFD Standard Crossed Diagonals 'X') */}
            <rect x="5.5" y="19" width="23" height="20" fill="rgba(2,132,199,0.06)" stroke={stroke} strokeWidth="1.2" />
            <line x1="5.5" y1="19" x2="28.5" y2="39" stroke={stroke} strokeWidth="1.2" />
            <line x1="28.5" y1="19" x2="5.5" y2="39" stroke={stroke} strokeWidth="1.2" />
            {/* Mid Redistributor Spray Header */}
            <line x1="8" y1="42" x2="26" y2="42" stroke="#0284c7" strokeWidth="1.2" strokeDasharray="2 1" />
            {/* Lower Packed Bed Section (PFD Standard Crossed Diagonals 'X') */}
            <rect x="5.5" y="45" width="23" height="19" fill="rgba(2,132,199,0.06)" stroke={stroke} strokeWidth="1.2" />
            <line x1="5.5" y1="45" x2="28.5" y2="64" stroke={stroke} strokeWidth="1.2" />
            <line x1="28.5" y1="45" x2="5.5" y2="64" stroke={stroke} strokeWidth="1.2" />
            {/* Column Support Skirt */}
            <path d="M8 72 L6 82 L28 82 L26 72" fill="#e2e8f0" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
            <line x1="4" y1="82" x2="30" y2="82" stroke={stroke} strokeWidth="2" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 배관 브랜치 (헤더 합류점)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function BranchNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('branch', 20, 20);
  const color = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={color} visible={hov} bodyStyle={{ width: 20, height: 20, borderRadius: '50%', padding: 0 }}>
        {customSvg ?? (
          <svg width="20" height="20" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5" fill="#FFFFFF" stroke={color} strokeWidth="2" />
            <circle cx="10" cy="10" r="2" fill={color} />
          </svg>
        )}
      </BodyWithHandles>
      {data.tag && <div className="pfd-node-tag" style={{ fontSize: '7px' }}>{data.tag}</div>}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 믹서 (In-Line Static Mixer / 배수 ×N 표기)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function MixerNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('mixer', 34, 34);
  const stroke = '#1A2F44';
  const n = data.multiplier && data.multiplier > 0 ? data.multiplier : 1;
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 40, height: 40, padding: 2 }}>
        {customSvg ?? (
          <svg width="34" height="34" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="14" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" />
            <line x1="10" y1="10" x2="24" y2="24" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
            <line x1="24" y1="10" x2="10" y2="24" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>
        {data.tag}{'\n'}
        <span style={{ color: '#0284c7', fontWeight: 800 }}>×{n}</span>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 압축기 (Centrifugal Compressor — ISO 10628 Diverging Trapezoid + Casing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function CompressorNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('compressor', 42, 42);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 46, height: 46, padding: 2 }}>
        {customSvg ?? (
          <svg width="42" height="42" viewBox="0 0 42 42">
            {/* Support Pedestal */}
            <path d="M12 32 L8 39 L34 39 L30 32" fill="#e2e8f0" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
            {/* Suction & Discharge Nozzles */}
            <line x1="7" y1="3" x2="7" y2="12" stroke={stroke} strokeWidth="2" />
            <line x1="35" y1="2" x2="35" y2="7" stroke={stroke} strokeWidth="2" />
            {/* ISO 10628 Centrifugal Compressor Diverging Trapezoid Body */}
            <polygon points="4,12 38,6 38,34 4,28" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
            {/* Internal Rotor Impeller Hub & Compression Direction Arrow */}
            <circle cx="18" cy="20" r="3" fill={stroke} />
            <path d="M11 20 L31 20 M26 15.5 L31 20 L26 24.5" fill="none" stroke="#0284c7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 필터 / 캔들필터 / 여과기 (Candle Filter / Cartridge Filter Vessel)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function FilterNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('filter', 46, 54);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 52, height: 60, padding: 2 }}>
        {customSvg ?? (
          <svg width="46" height="54" viewBox="0 0 46 54">
            {/* Top Ellipsoidal Head + Cylindrical Shell + Conical Sludge Hopper Bottom */}
            <path d="M7 10 A16 5.5 0 0 1 39 10 L39 36 L26 49 L20 49 L7 36 Z" fill="#FFFFFF" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
            {/* Upper Tube-Sheet Header */}
            <line x1="7" y1="15" x2="39" y2="15" stroke={stroke} strokeWidth="1.8" />
            {/* Hanging Vertical Candle Filter Elements (Dashed Porous Cartridges) */}
            {[13, 19.5, 26.5, 33].map(x => (
              <rect key={x} x={x - 2} y="15" width="4" height="19" rx="1.5" fill="rgba(16,185,129,0.12)" stroke={stroke} strokeWidth="1.1" strokeDasharray="2.5 1.5" />
            ))}
            {/* Conical Bottom Diagonal Filter Mesh Line */}
            <line x1="10" y1="36" x2="36" y2="36" stroke="#64748b" strokeWidth="1" strokeDasharray="2 2" />
            {/* Support Legs */}
            <line x1="11" y1="40" x2="9" y2="52" stroke={stroke} strokeWidth="1.6" />
            <line x1="35" y1="40" x2="37" y2="52" stroke={stroke} strokeWidth="1.6" />
            <line x1="6" y1="52" x2="13" y2="52" stroke={stroke} strokeWidth="1.6" />
            <line x1="33" y1="52" x2="40" y2="52" stroke={stroke} strokeWidth="1.6" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '8px', whiteSpace: 'pre-line', textAlign: 'center' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 컨트롤 밸브 (Control Valve — Diaphragm Actuator + Bowtie Body)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function ValveNode({ data }: NodeProps) {
  const [hov, setHov] = useState(false);
  const customSvg = useCustomIconSvg('valve', 24, 24);
  const stroke = '#1A2F44';
  return (
    <div className="pfd-node" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <BodyWithHandles color={stroke} visible={hov} bodyStyle={{ width: 28, height: 28, padding: 2 }}>
        {customSvg ?? (
          <svg width="24" height="24" viewBox="0 0 24 24">
            {/* Diaphragm Actuator Dome */}
            <path d="M6 6 A6 5 0 0 1 18 6 Z" fill="#1A2F44" stroke={stroke} strokeWidth="1.3" />
            <line x1="12" y1="6" x2="12" y2="14" stroke={stroke} strokeWidth="1.5" />
            {/* ISO Bowtie Valve Body */}
            <polygon points="3,9 12,14 3,19" fill="#FFFFFF" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
            <polygon points="21,9 12,14 21,19" fill="#FFFFFF" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        )}
      </BodyWithHandles>
      <div className="pfd-node-tag" style={{ fontSize: '7px' }}>{data.tag}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 섹션 헤더 라벨
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function SectionLabelNode({ data }: NodeProps) {
  return (
    <div style={{
      background: `linear-gradient(90deg, ${data.color}15, transparent)`,
      border: `1px solid ${data.color}28`,
      borderLeft: `3px solid ${data.color}`,
      borderRadius: '0 6px 6px 0',
      padding: '4px 20px 4px 10px',
      pointerEvents: 'none',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: data.color,
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: '0.5px',
      }}>
        {data.label}
      </span>
    </div>
  );
}

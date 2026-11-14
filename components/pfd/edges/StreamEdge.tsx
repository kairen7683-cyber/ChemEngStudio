'use client';
import { FC, useState, useCallback, useEffect } from 'react';
import {
  EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
} from 'reactflow';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useBalanceStore } from '@/lib/stores/balanceStore';

// ── Module-level Orthogonal Segment Registry for Line-Crossing Detection ──
interface Seg2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orient: 'H' | 'V';
}

const EDGE_SEGMENT_REGISTRY = new Map<string, Seg2D[]>();

/**
 * Extract axis-aligned (horizontal/vertical) straight segments from an SVG path string
 * produced by ReactFlow's getSmoothStepPath (`M x y L x y Q cx cy x y ...`).
 */
function extractOrthogonalSegments(pathStr: string): Seg2D[] {
  const tokens = pathStr.match(/[MLQ]|-?\d+(?:\.\d+)?/gi);
  if (!tokens) return [];
  const pts: { x: number; y: number }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i].toUpperCase();
    if (t === 'M' || t === 'L') {
      const x = parseFloat(tokens[i + 1]);
      const y = parseFloat(tokens[i + 2]);
      if (!isNaN(x) && !isNaN(y)) pts.push({ x, y });
      i += 3;
    } else if (t === 'Q') {
      // Quadratic curve: control point (cx, cy) is the true corner vertex, followed by end (x, y)
      const cx = parseFloat(tokens[i + 1]);
      const cy = parseFloat(tokens[i + 2]);
      const x = parseFloat(tokens[i + 3]);
      const y = parseFloat(tokens[i + 4]);
      if (!isNaN(cx) && !isNaN(cy)) pts.push({ x: cx, y: cy });
      if (!isNaN(x) && !isNaN(y)) pts.push({ x, y });
      i += 5;
    } else {
      i += 1;
    }
  }

  // Coalesce collinear consecutive segments into clean H / V spans
  const rawSegs: Seg2D[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < 1.5 && dy < 1.5) continue;
    if (dy <= 2.0 && dx > 3) {
      rawSegs.push({
        x1: Math.min(a.x, b.x),
        y1: (a.y + b.y) * 0.5,
        x2: Math.max(a.x, b.x),
        y2: (a.y + b.y) * 0.5,
        orient: 'H',
      });
    } else if (dx <= 2.0 && dy > 3) {
      rawSegs.push({
        x1: (a.x + b.x) * 0.5,
        y1: Math.min(a.y, b.y),
        x2: (a.x + b.x) * 0.5,
        y2: Math.max(a.y, b.y),
        orient: 'V',
      });
    }
  }

  // Merge adjacent segments of the same orientation
  const merged: Seg2D[] = [];
  for (const seg of rawSegs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.orient === seg.orient) {
      if (seg.orient === 'H' && Math.abs(prev.y1 - seg.y1) < 2.5 && Math.abs(prev.x2 - seg.x1) < 18) {
        prev.x1 = Math.min(prev.x1, seg.x1);
        prev.x2 = Math.max(prev.x2, seg.x2);
        continue;
      }
      if (seg.orient === 'V' && Math.abs(prev.x1 - seg.x1) < 2.5 && Math.abs(prev.y2 - seg.y1) < 18) {
        prev.y1 = Math.min(prev.y1, seg.y1);
        prev.y2 = Math.max(prev.y2, seg.y2);
        continue;
      }
    }
    merged.push({ ...seg });
  }
  return merged;
}

/**
 * Find all crossing points where this edge's VERTICAL segments cross another edge's HORIZONTAL segments.
 * Per ISO 10628 / PIP PIC001 PFD standard, horizontal main lines stay continuous and vertical crossing lines break.
 */
function findVerticalCrossings(edgeId: string, mySegs: Seg2D[]): { x: number; y: number }[] {
  const crossings: { x: number; y: number }[] = [];
  const margin = 7; // ignore endpoints/T-junctions within 7px of segment ends

  for (const vSeg of mySegs) {
    if (vSeg.orient !== 'V') continue;
    const vx = vSeg.x1;
    const vyMin = vSeg.y1 + margin;
    const vyMax = vSeg.y2 - margin;
    if (vyMax <= vyMin) continue;

    EDGE_SEGMENT_REGISTRY.forEach((otherSegs, otherId) => {
      if (otherId === edgeId) return;
      for (const hSeg of otherSegs) {
        if (hSeg.orient !== 'H') continue;
        const hy = hSeg.y1;
        const hxMin = hSeg.x1 + margin;
        const hxMax = hSeg.x2 - margin;
        if (hxMax <= hxMin) continue;

        if (vx >= hxMin && vx <= hxMax && hy >= vyMin && hy <= vyMax) {
          crossings.push({ x: vx, y: hy });
        }
      }
    });
  }
  return crossings;
}

// ── Tooltip row helper ─────────────────────────────────────────────────────
function TRow({ label, value, unit, color }: {
  label: string; value: string | number | undefined; unit?: string; color?: string;
}) {
  if (value == null || value === '') return null;
  return (
    <tr>
      <td style={{ color: '#3F3F46', paddingRight: 10, fontSize: 10, whiteSpace: 'nowrap', paddingBottom: 2 }}>
        {label}
      </td>
      <td style={{ color: color ?? '#e2e8f0', fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>
        {typeof value === 'number' ? value.toLocaleString('en', { maximumFractionDigits: 1 }) : value}
        {unit && <span style={{ color: '#3F3F46', fontWeight: 400, marginLeft: 3 }}>{unit}</span>}
      </td>
    </tr>
  );
}

/**
 * StreamEdge -- custom ReactFlow edge
 *
 * - Renders the pipe path + a stream-number badge in the middle
 * - Double-click (EDIT MODE ONLY) to edit the stream number
 * - Hover shows a rich styled tooltip with stream data
 */
const StreamEdge: FC<EdgeProps> = ({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition, targetPosition,
  style,
  markerEnd,
  data,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const [hovered, setHovered] = useState(false);

  const { edgeStreamMap, setEdgeStream, editMode } = usePFDStore();
  const balance = useBalanceStore(s => s.balance);
  const streams = balance?.streams ?? [];

  // Override in store wins over the initial data.streamId
  const streamId: string = edgeStreamMap[id] ?? data?.streamId ?? '';
  const stream = streamId ? streams.find(s => s.id === streamId) : undefined;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 6,
  });

  // Register this edge's orthogonal segments & compute vertical line-break crossings
  const mySegs = extractOrthogonalSegments(edgePath);
  EDGE_SEGMENT_REGISTRY.set(id, mySegs);
  useEffect(() => {
    EDGE_SEGMENT_REGISTRY.set(id, extractOrthogonalSegments(edgePath));
    return () => {
      EDGE_SEGMENT_REGISTRY.delete(id);
    };
  }, [id, edgePath]);

  const crossings = findVerticalCrossings(id, mySegs);
  const maskId = `pfd-edge-mask-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  // ── Edit: only allowed in edit mode ───────────────────────────────────
  const startEdit = useCallback((evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (!editMode) return;   // VIEW MODE: no editing
    setDraft(streamId);
    setEditing(true);
  }, [streamId, editMode]);

  const commitEdit = useCallback(() => {
    const v = draft.trim();
    setEdgeStream(id, v);   // empty string = clear
    setEditing(false);
  }, [draft, id, setEdgeStream]);

  const edgeColor = (style?.stroke as string) ?? data?.color ?? '#94a3b8';

  // ── Format flow rate ───────────────────────────────────────────────────
  const flowLabel = stream?.total_kgh != null
    ? stream.total_kgh >= 1000
      ? `${(stream.total_kgh / 1000).toFixed(1)} t/h`
      : `${stream.total_kgh.toFixed(0)} kg/h`
    : null;

  // ── Components summary ─────────────────────────────────────────────────
  const compLines = stream?.components
    ? Object.entries(stream.components)
        .filter(([, v]) => v != null && (v as number) > 0)
        .map(([k, v]) => `${k}: ${(v as number).toFixed(1)} kg/h`)
    : [];

  const strokeW = Number(style?.strokeWidth ?? 1.8);

  return (
    <>
      {/* SVG Mask to cleanly hide/break vertical pipe segments at every crossing point */}
      {crossings.length > 0 && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="20000" height="20000">
            <rect x="-5000" y="-5000" width="20000" height="20000" fill="white" />
            {crossings.map((pt, idx) => (
              <circle key={idx} cx={pt.x} cy={pt.y} r={6.5} fill="black" />
            ))}
          </mask>
        </defs>
      )}

      {/* Background Halo Casing (ensures clean PFD separation & hides crossing line underneath) */}
      <path
        d={edgePath}
        fill="none"
        stroke="#F6F7F2"
        strokeWidth={strokeW + 4.5}
        strokeLinecap="butt"
        strokeLinejoin="round"
        mask={crossings.length > 0 ? `url(#${maskId})` : undefined}
        style={{ pointerEvents: 'none' }}
      />

      {/* Main Process Stream Pipe Path */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        fill="none"
        stroke={edgeColor}
        strokeWidth={strokeW}
        strokeDasharray={style?.strokeDasharray as string | undefined}
        markerEnd={markerEnd}
        mask={crossings.length > 0 ? `url(#${maskId})` : undefined}
      />

      {/* Invisible Wide Interaction Path for Easy Clicking & Hovering */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="react-flow__edge-interaction"
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 20,
          }}
          className="nodrag nopan"
        >
          {editing ? (
            /* ── Edit input ────────────────────────────────────────── */
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter')  commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              onClick={e => e.stopPropagation()}
              placeholder="e.g. 201"
              style={{
                width: 72,
                fontSize: 11,
                padding: '2px 6px',
                border: `1.5px solid ${edgeColor}`,
                borderRadius: 4,
                background: '#0f172a',
                color: '#1A2F44',
                outline: 'none',
                fontFamily: 'monospace',
              }}
            />
          ) : streamId ? (
            /* ── Stream badge + rich hover tooltip ─────────────────── */
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {/* Badge */}
              <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onDoubleClick={startEdit}
                style={{
                  background: edgeColor + '1a',
                  border: `1px solid ${edgeColor}70`,
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: edgeColor,
                  cursor: editMode ? 'pointer' : 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.6,
                  backdropFilter: 'blur(3px)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>[{streamId}]</span>
                {flowLabel && (
                  <span style={{ opacity: 0.65, fontWeight: 400 }}>{flowLabel}</span>
                )}
              </div>

              {/* Rich tooltip */}
              {hovered && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 8,
                    background: '#FFFFFF',
                    border: `1px solid ${edgeColor}44`,
                    borderRadius: 10,
                    padding: '10px 14px',
                    minWidth: 200,
                    zIndex: 9999,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${edgeColor}22`,
                    backdropFilter: 'blur(12px)',
                    pointerEvents: 'none',
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                >
                  {/* Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                    paddingBottom: 8, borderBottom: `1px solid ${edgeColor}30`,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: edgeColor,
                      boxShadow: `0 0 6px ${edgeColor}`,
                    }}/>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44', letterSpacing: '0.02em' }}>
                      Stream [{streamId}]
                    </span>
                    {stream?.phase && (
                      <span style={{
                        marginLeft: 'auto',
                        fontSize: 9, fontWeight: 700,
                        color: edgeColor,
                        background: edgeColor + '22',
                        border: `1px solid ${edgeColor}44`,
                        borderRadius: 3, padding: '1px 5px',
                      }}>
                        {stream.phase}
                      </span>
                    )}
                  </div>

                  {stream ? (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <tbody>
                        <TRow label="Total Flow" value={stream.total_kgh?.toFixed(1)}  unit="kg/h"      color={edgeColor} />
                        <TRow label="Mass Flow"  value={stream.total_kgh != null ? (stream.total_kgh * 24 / 1000).toFixed(2) : undefined} unit="t/day" />
                        <TRow label="Temp"       value={stream.temperature_C}          unit="°C"        />
                        <TRow label="Pressure"   value={stream.pressure_kgcm2g}        unit="kg/cm²G"   />
                        <TRow label="Density"    value={stream.density_kgm3}           unit="kg/m³"     />
                        {stream.concentration != null && (
                          <TRow label="Conc."    value={stream.concentration.toFixed(1)} unit="wt%"     />
                        )}
                        {compLines.length > 0 && (
                          <tr><td colSpan={2} style={{ paddingTop: 6, paddingBottom: 2 }}>
                            <div style={{ fontSize: 9, color: '#2C353E', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 3 }}>Components</div>
                            {compLines.slice(0, 4).map(l => (
                              <div key={l} style={{ fontSize: 9, color: '#3F3F46', lineHeight: 1.6 }}>{l}</div>
                            ))}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>
                      Stream data not found
                    </div>
                  )}

                  {editMode && (
                    <div style={{
                      marginTop: 8, paddingTop: 7,
                      borderTop: `1px solid rgba(255,255,255,0.06)`,
                      fontSize: 9, color: '#2C353E',
                    }}>
                      Double-click to edit stream number
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : editMode ? (
            /* ── Edit mode, no stream yet: show dot hint ────────────── */
            <div
              onDoubleClick={startEdit}
              title="Double-click to assign stream number"
              style={{
                width: 10, height: 10,
                borderRadius: '50%',
                border: '1px dashed #475569',
                cursor: 'pointer',
                background: 'transparent',
              }}
            />
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default StreamEdge;

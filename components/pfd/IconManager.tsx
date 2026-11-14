'use client';

import { useState, useRef, useCallback } from 'react';
import { usePFDStore, EQUIPMENT_TYPES, CustomIconDef } from '@/lib/stores/pfdStore';

// ── 인앱 SVG 그리기 툴 타입 ──────────────────────────────────
type DrawTool = 'select' | 'line' | 'rect' | 'circle' | 'path';

interface DrawShape {
  id: string;
  type: DrawTool;
  props: Record<string, number | string>;
}

// ── 기본 아이콘 SVG (미리보기용) ─────────────────────────────
const DEFAULT_ICONS: Record<string, { viewBox: string; inner: string }> = {
  agitatedDrum: {
    viewBox: '0 0 48 62',
    inner: `<rect x="17" y="1" width="14" height="10" rx="1.5" fill="#1A2F44" stroke="#1A2F44" stroke-width="1.2"/>
<text x="24" y="8.5" font-size="7" font-weight="800" fill="#FFFFFF" font-family="monospace" text-anchor="middle">M</text>
<line x1="24" y1="11" x2="24" y2="16" stroke="#1A2F44" stroke-width="1.8"/>
<path d="M8 21 A16 5.5 0 0 1 40 21 L40 48 A16 5.5 0 0 1 8 48 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="24" y1="16" x2="24" y2="45" stroke="#1A2F44" stroke-width="1.6"/>
<path d="M15 33 C18 30, 21 36, 24 33 C27 30, 30 36, 33 33" fill="none" stroke="#1A2F44" stroke-width="1.6"/>
<line x1="13" y1="43" x2="35" y2="43" stroke="#1A2F44" stroke-width="2"/>`,
  },
  tank: {
    viewBox: '0 0 48 60',
    inner: `<path d="M8 13 A16 6 0 0 1 40 13 L40 46 A16 6 0 0 1 8 46 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="8.5" y1="34" x2="39.5" y2="34" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="3 2"/>
<polygon points="24,34 21,29 27,29" fill="none" stroke="#0284c7" stroke-width="1.1"/>
<line x1="13" y1="51" x2="11" y2="58" stroke="#1A2F44" stroke-width="1.7"/>
<line x1="35" y1="51" x2="37" y2="58" stroke="#1A2F44" stroke-width="1.7"/>`,
  },
  drumHorizontal: {
    viewBox: '0 0 70 36',
    inner: `<path d="M12 4 L58 4 A9 11 0 0 1 58 26 L12 26 A9 11 0 0 1 12 4 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="44" y1="12" x2="44" y2="26" stroke="#1A2F44" stroke-width="1.3"/>
<line x1="5" y1="17" x2="44" y2="17" stroke="#0284c7" stroke-width="1.1" stroke-dasharray="3 2"/>
<path d="M18 26 L15 33 L25 33 L22 26 M48 26 L45 33 L55 33 L52 26" fill="#e2e8f0" stroke="#1A2F44" stroke-width="1.4"/>`,
  },
  pump: {
    viewBox: '0 0 32 32',
    inner: `<polygon points="15,17 7,29 23,29" fill="#e2e8f0" stroke="#1A2F44" stroke-width="1.6"/>
<path d="M15 5 L28 5 L28 11 L23 11" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.7"/>
<circle cx="15" cy="16" r="10.5" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<circle cx="15" cy="16" r="3.5" fill="none" stroke="#1A2F44" stroke-width="1.3"/>`,
  },
  separator: {
    viewBox: '0 0 38 70',
    inner: `<path d="M5 11 A14 6 0 0 1 33 11 L33 56 A14 6 0 0 1 5 56 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<rect x="5.5" y="16" width="27" height="7" fill="rgba(148,163,184,0.22)" stroke="#1A2F44" stroke-width="1.1"/>
<line x1="5.5" y1="43" x2="32.5" y2="43" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="3 2"/>`,
  },
  heatExchanger: {
    viewBox: '0 0 54 42',
    inner: `<path d="M9 8 L45 8 A6 13 0 0 1 45 34 L9 34 A6 13 0 0 1 9 8 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<polyline points="4,21 11,21 16,13 23,29 31,13 38,29 43,21 50,21" fill="none" stroke="#ea580c" stroke-width="1.7"/>`,
  },
  towerPacking: {
    viewBox: '0 0 34 84',
    inner: `<path d="M5 11 A12 6 0 0 1 29 11 L29 68 A12 6 0 0 1 5 68 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<rect x="5.5" y="19" width="23" height="20" fill="none" stroke="#1A2F44" stroke-width="1.2"/>
<line x1="5.5" y1="19" x2="28.5" y2="39" stroke="#1A2F44" stroke-width="1.2"/>
<line x1="28.5" y1="19" x2="5.5" y2="39" stroke="#1A2F44" stroke-width="1.2"/>
<rect x="5.5" y="45" width="23" height="19" fill="none" stroke="#1A2F44" stroke-width="1.2"/>
<line x1="5.5" y1="45" x2="28.5" y2="64" stroke="#1A2F44" stroke-width="1.2"/>
<line x1="28.5" y1="45" x2="5.5" y2="64" stroke="#1A2F44" stroke-width="1.2"/>`,
  },
  tower: {
    viewBox: '0 0 34 84',
    inner: `<path d="M5 11 A12 6 0 0 1 29 11 L29 68 A12 6 0 0 1 5 68 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="5.5" y1="20" x2="25" y2="20" stroke="#1A2F44" stroke-width="1.3"/>
<line x1="9" y1="32" x2="28.5" y2="32" stroke="#1A2F44" stroke-width="1.3"/>
<line x1="5.5" y1="44" x2="25" y2="44" stroke="#1A2F44" stroke-width="1.3"/>
<line x1="9" y1="56" x2="28.5" y2="56" stroke="#1A2F44" stroke-width="1.3"/>`,
  },
  evaporator: {
    viewBox: '0 0 34 84',
    inner: `<path d="M5 11 A12 6 0 0 1 29 11 L29 68 L21 78 L13 78 L5 68 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="5" y1="21" x2="29" y2="21" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="5" y1="62" x2="29" y2="62" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="11" y1="21" x2="11" y2="62" stroke="#1A2F44" stroke-width="1.1"/>
<line x1="17" y1="21" x2="17" y2="62" stroke="#1A2F44" stroke-width="1.1"/>
<line x1="23" y1="21" x2="23" y2="62" stroke="#1A2F44" stroke-width="1.1"/>`,
  },
  compressor: {
    viewBox: '0 0 42 42',
    inner: `<polygon points="4,12 38,6 38,34 4,28" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<circle cx="18" cy="20" r="3" fill="#1A2F44"/>
<path d="M11 20 L31 20 M26 15.5 L31 20 L26 24.5" fill="none" stroke="#0284c7" stroke-width="1.6"/>`,
  },
  filter: {
    viewBox: '0 0 46 54',
    inner: `<path d="M7 10 A16 5.5 0 0 1 39 10 L39 36 L26 49 L20 49 L7 36 Z" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="7" y1="15" x2="39" y2="15" stroke="#1A2F44" stroke-width="1.8"/>
<rect x="12" y="15" width="4" height="19" fill="none" stroke="#1A2F44" stroke-width="1.1" stroke-dasharray="2.5 1.5"/>
<rect x="21" y="15" width="4" height="19" fill="none" stroke="#1A2F44" stroke-width="1.1" stroke-dasharray="2.5 1.5"/>
<rect x="30" y="15" width="4" height="19" fill="none" stroke="#1A2F44" stroke-width="1.1" stroke-dasharray="2.5 1.5"/>`,
  },
  valve: {
    viewBox: '0 0 24 24',
    inner: `<path d="M6 6 A6 5 0 0 1 18 6 Z" fill="#1A2F44" stroke="#1A2F44" stroke-width="1.3"/>
<line x1="12" y1="6" x2="12" y2="14" stroke="#1A2F44" stroke-width="1.5"/>
<polygon points="3,9 12,14 3,19" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.5"/>
<polygon points="21,9 12,14 21,19" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.5"/>`,
  },
  electrolyzer: {
    viewBox: '0 0 96 62',
    inner: `<rect x="9" y="8" width="78" height="40" fill="#FFFFFF" stroke="#1A2F44" stroke-width="1.8"/>
<line x1="48" y1="6" x2="48" y2="50" stroke="#0284c7" stroke-width="2.2" stroke-dasharray="4 2"/>
<text x="26" y="28" font-size="9" font-weight="800" fill="#059669" font-family="monospace" text-anchor="middle">AN+</text>
<text x="70" y="28" font-size="9" font-weight="800" fill="#ea580c" font-family="monospace" text-anchor="middle">CA-</text>`,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 인앱 드로잉 캔버스 (간단한 SVG 에디터)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function DrawingCanvas({ onExport }: { onExport: (svgInner: string) => void }) {
  const [tool, setTool] = useState<DrawTool>('line');
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [drawing, setDrawing] = useState<DrawShape | null>(null);
  const [strokeColor, setStrokeColor] = useState('#60a5fa');
  const [fillColor, setFillColor] = useState('none');
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const SIZE = 200;

  const getSVGPos = (e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width * SIZE),
      y: Math.round((e.clientY - rect.top) / rect.height * SIZE),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pos = getSVGPos(e);
    if (tool === 'select') return;
    const newShape: DrawShape = {
      id: Date.now().toString(),
      type: tool,
      props: {
        x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y,
        x: pos.x, y: pos.y, width: 0, height: 0,
        cx: pos.x, cy: pos.y, rx: 0, ry: 0,
        stroke: strokeColor, fill: fillColor, strokeWidth,
        points: `${pos.x},${pos.y}`,
      },
    };
    setDrawing(newShape);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pos = getSVGPos(e);
    setDrawing(prev => {
      if (!prev) return prev;
      const startX = prev.props.x1 as number;
      const startY = prev.props.y1 as number;
      if (prev.type === 'line') {
        return { ...prev, props: { ...prev.props, x2: pos.x, y2: pos.y } };
      } else if (prev.type === 'rect') {
        return { ...prev, props: { ...prev.props,
          x: Math.min(startX, pos.x), y: Math.min(startY, pos.y),
          width: Math.abs(pos.x - startX), height: Math.abs(pos.y - startY) } };
      } else if (prev.type === 'circle') {
        const r = Math.sqrt((pos.x - startX) ** 2 + (pos.y - startY) ** 2);
        return { ...prev, props: { ...prev.props, cx: startX, cy: startY, rx: r, ry: r } };
      } else if (prev.type === 'path') {
        return { ...prev, props: { ...prev.props,
          points: `${prev.props.points} ${pos.x},${pos.y}` } };
      }
      return prev;
    });
  };

  const onMouseUp = () => {
    if (drawing) setShapes(s => [...s, drawing]);
    setDrawing(null);
  };

  const renderShape = (s: DrawShape, key?: string) => {
    const p = s.props;
    const common = {
      key, stroke: p.stroke as string, fill: p.fill as string,
      strokeWidth: p.strokeWidth as number, onClick: () => setSelectedId(s.id),
      style: { cursor: 'pointer', outline: selectedId === s.id ? '1px dashed #fff' : 'none' },
    };
    if (s.type === 'line') return <line {...common} x1={p.x1 as number} y1={p.y1 as number} x2={p.x2 as number} y2={p.y2 as number} />;
    if (s.type === 'rect') return <rect {...common} x={p.x as number} y={p.y as number} width={p.width as number} height={p.height as number} />;
    if (s.type === 'circle') return <ellipse {...common} cx={p.cx as number} cy={p.cy as number} rx={p.rx as number} ry={p.ry as number} />;
    if (s.type === 'path') return <polyline {...common} points={p.points as string} fill="none" />;
    return null;
  };

  const exportSVG = () => {
    const inner = shapes.map(s => {
      const p = s.props;
      if (s.type === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}"/>`;
      if (s.type === 'rect') return `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}"/>`;
      if (s.type === 'circle') return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}"/>`;
      if (s.type === 'path') return `<polyline points="${p.points}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill}"/>`;
      return '';
    }).join('\n');
    onExport(inner);
  };

  const tools: { id: DrawTool; label: string }[] = [
    { id: 'select', label: '선택' }, { id: 'line', label: '선' },
    { id: 'rect', label: '사각형' }, { id: 'circle', label: '원/타원' },
    { id: 'path', label: '경로' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 도구 모음 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {tools.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)} style={{
            padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: tool === t.id ? '#3b82f6' : 'var(--bg-elevated)',
            border: `1px solid ${tool === t.id ? '#3b82f6' : 'var(--border-default)'}`,
            color: tool === t.id ? 'white' : 'var(--text-secondary)',
          }}>{t.label}</button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', margin: '0 4px' }} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>선 색상</label>
        <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
          style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>채우기</label>
        <input type="color" value={fillColor === 'none' ? '#000000' : fillColor}
          onChange={e => setFillColor(e.target.value)}
          style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
        <button onClick={() => setFillColor('none')} style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
          background: fillColor === 'none' ? '#3b82f6' : 'var(--bg-elevated)',
          border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
        }}>없음</button>
        <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>선 굵기</label>
        <input type="range" min="0.5" max="4" step="0.5" value={strokeWidth}
          onChange={e => setStrokeWidth(Number(e.target.value))}
          style={{ width: 60 }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{strokeWidth}</span>
      </div>

      {/* SVG 캔버스 */}
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-base)' }}>
        <svg
          ref={svgRef}
          width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ display: 'block', cursor: tool === 'select' ? 'default' : 'crosshair' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* 격자 */}
          {Array.from({ length: 20 }, (_, i) => (
            <g key={i}>
              <line x1={i*10} y1={0} x2={i*10} y2={200} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              <line x1={0} y1={i*10} x2={200} y2={i*10} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
            </g>
          ))}
          {shapes.map((s, i) => renderShape(s, s.id))}
          {drawing && renderShape(drawing, 'drawing')}
        </svg>
      </div>

      {/* 하단 버튼 */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => {
            if (selectedId) setShapes(s => s.filter(x => x.id !== selectedId));
            setSelectedId(null);
          }} disabled={!selectedId} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)', opacity: selectedId ? 1 : 0.4,
          }}>선택 삭제</button>
          <button onClick={() => { setShapes([]); setSelectedId(null); }} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            color: '#ef4444',
          }}>전체 지우기</button>
        </div>
        <button onClick={exportSVG} disabled={shapes.length === 0} style={{
          padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
          background: shapes.length > 0 ? '#3b82f6' : 'var(--bg-elevated)',
          border: 'none', color: 'white', opacity: shapes.length > 0 ? 1 : 0.4,
        }}>이 아이콘 사용 →</button>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 아이콘 관리 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface IconManagerProps {
  onClose: () => void;
}

export default function IconManager({ onClose }: IconManagerProps) {
  const { customIcons, setCustomIcon, removeCustomIcon } = usePFDStore();
  const [selectedType, setSelectedType] = useState(EQUIPMENT_TYPES[0].type);
  const [tab, setTab] = useState<'upload' | 'paste' | 'draw'>('upload');
  const [svgCode, setSvgCode] = useState('');
  const [previewSvg, setPreviewSvg] = useState('');
  const [parseError, setParseError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const currentType = EQUIPMENT_TYPES.find(t => t.type === selectedType)!;
  const customIcon = customIcons[selectedType];
  const defaultIcon = DEFAULT_ICONS[selectedType];

  const parseAndPreview = (code: string) => {
    setSvgCode(code);
    setParseError('');
    try {
      const match = code.match(/<svg([^>]*)>([\s\S]*?)<\/svg>/i);
      if (!match) { setParseError('올바른 SVG 형식이 아닙니다.'); return; }
      setPreviewSvg(match[2]);
    } catch {
      setParseError('SVG 파싱 오류');
    }
  };

  const applyFromCode = () => {
    try {
      const match = svgCode.match(/<svg([^>]*)>([\s\S]*?)<\/svg>/i);
      if (!match) { setParseError('올바른 SVG 형식이 아닙니다.'); return; }
      const attrs = match[1];
      const inner = match[2];
      const vbMatch = attrs.match(/viewBox="([^"]+)"/);
      const wMatch = attrs.match(/width="([^"]+)"/);
      const hMatch = attrs.match(/height="([^"]+)"/);
      setCustomIcon(selectedType, {
        viewBox: vbMatch ? vbMatch[1] : `0 0 ${currentType.defaultW} ${currentType.defaultH}`,
        svgInner: inner,
        width: wMatch ? parseInt(wMatch[1]) : currentType.defaultW,
        height: hMatch ? parseInt(hMatch[1]) : currentType.defaultH,
      });
      alert('✅ 아이콘이 적용되었습니다.');
    } catch {
      setParseError('적용 오류');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseAndPreview(text);
      setTab('paste');
    };
    reader.readAsText(file);
  };

  const applyFromDraw = (inner: string) => {
    setCustomIcon(selectedType, {
      viewBox: '0 0 200 200',
      svgInner: inner,
      width: currentType.defaultW * 2,
      height: currentType.defaultH * 2,
    });
    alert('✅ 그린 아이콘이 적용되었습니다.');
  };

  const previewIcon = customIcon || (defaultIcon ? {
    viewBox: defaultIcon.viewBox,
    svgInner: defaultIcon.inner,
    width: currentType.defaultW,
    height: currentType.defaultH,
  } : null);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 12, width: 860, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
      }}>
        {/* 헤더 */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-elevated)',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              🎨 장치 아이콘 관리
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              SVG 파일 업로드, 코드 붙여넣기, 또는 직접 그리기로 장치 아이콘을 교체하세요
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 좌측: 장치 타입 목록 */}
          <div style={{
            width: 180, flexShrink: 0, borderRight: '1px solid var(--border-subtle)',
            overflowY: 'auto', background: 'var(--bg-surface)',
          }}>
            {EQUIPMENT_TYPES.map(et => {
              const hasCustom = !!customIcons[et.type];
              return (
                <button
                  key={et.type}
                  onClick={() => setSelectedType(et.type)}
                  style={{
                    width: '100%', padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
                    background: selectedType === et.type ? 'rgba(0,212,255,0.08)' : 'transparent',
                    border: 'none',
                    borderLeft: selectedType === et.type ? '2px solid var(--accent-primary)' : '2px solid transparent',
                    color: selectedType === et.type ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: selectedType === et.type ? 600 : 400,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <span>{et.label}</span>
                  {hasCustom && (
                    <span style={{
                      fontSize: 8, background: '#10b981', color: 'white',
                      padding: '1px 5px', borderRadius: 6, fontWeight: 700,
                    }}>커스텀</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 우측: 편집 영역 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* 현재 아이콘 미리보기 */}
            <div style={{
              padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'var(--bg-elevated)',
            }}>
              <div style={{
                width: 80, height: 80, background: 'var(--bg-card)',
                border: '1px solid var(--border-default)', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {previewIcon ? (
                  <svg
                    viewBox={previewIcon.viewBox}
                    width={Math.min(60, previewIcon.width)}
                    height={Math.min(60, previewIcon.height)}
                    dangerouslySetInnerHTML={{ __html: previewIcon.svgInner }}
                  />
                ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>없음</span>}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {currentType.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {customIcon ? '✅ 커스텀 아이콘 사용 중' : '기본 아이콘 사용 중'}
                </div>
              </div>
              {customIcon && (
                <button
                  onClick={() => {
                    if (window.confirm('기본 아이콘으로 되돌릴까요?')) removeCustomIcon(selectedType);
                  }}
                  style={{
                    marginLeft: 'auto', padding: '5px 12px', fontSize: 11,
                    borderRadius: 6, cursor: 'pointer', background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444',
                  }}
                >
                  기본값으로 초기화
                </button>
              )}
            </div>

            {/* 탭 선택 */}
            <div style={{
              display: 'flex', gap: 0,
              borderBottom: '1px solid var(--border-subtle)',
              padding: '0 20px',
              background: 'var(--bg-surface)',
            }}>
              {[
                { id: 'upload', label: '📁 파일 업로드' },
                { id: 'paste',  label: '📋 SVG 코드 붙여넣기' },
                { id: 'draw',   label: '✏️ 직접 그리기' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as typeof tab)}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', background: 'transparent',
                    border: 'none', borderBottom: tab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                    color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >{t.label}</button>
              ))}
            </div>

            {/* 탭 내용 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

              {tab === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <input ref={fileRef} type="file" accept=".svg" onChange={onFileChange}
                    style={{ display: 'none' }} />
                  {/* 드래그앤드롭 영역 */}
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)'; }}
                    onDragLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; }}
                    onDrop={e => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = ev => { parseAndPreview(ev.target?.result as string); setTab('paste'); };
                        reader.readAsText(file);
                      }
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
                    }}
                    style={{
                      border: '2px dashed var(--border-default)', borderRadius: 10,
                      padding: '40px 20px', textAlign: 'center', cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                      SVG 파일을 드래그하거나 클릭하여 업로드
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      Inkscape, Illustrator, Figma 등에서 내보낸 .svg 파일 지원
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                    💡 <strong>팁:</strong> Inkscape에서 장치를 그린 후 &quot;일반 SVG로 저장&quot;하여 업로드하면 됩니다.
                    viewBox 속성이 있는 SVG 파일이면 어떤 것이든 사용 가능합니다.
                  </div>
                </div>
              )}

              {tab === 'paste' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                      SVG 코드를 여기에 붙여넣으세요:
                    </label>
                    <textarea
                      value={svgCode}
                      onChange={e => parseAndPreview(e.target.value)}
                      placeholder={`<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="30" cy="30" r="25" fill="none" stroke="#60a5fa" stroke-width="2"/>\n</svg>`}
                      style={{
                        width: '100%', height: 180, resize: 'vertical',
                        background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                        borderRadius: 6, padding: 10, fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 11, color: 'var(--text-primary)', outline: 'none',
                      }}
                    />
                  </div>
                  {parseError && (
                    <div style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 6 }}>
                      ⚠️ {parseError}
                    </div>
                  )}
                  {previewSvg && (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>미리보기:</div>
                        <div style={{
                          background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                          borderRadius: 8, padding: 12, display: 'inline-block',
                        }}>
                          <svg viewBox="0 0 100 100" width={100} height={100}
                            dangerouslySetInnerHTML={{ __html: previewSvg }} />
                        </div>
                      </div>
                      <button onClick={applyFromCode} style={{
                        marginTop: 22, padding: '8px 20px', fontSize: 13, fontWeight: 600,
                        borderRadius: 8, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        border: 'none', color: 'white',
                      }}>
                        ✅ 이 아이콘 적용
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tab === 'draw' && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                    기본 도형을 그려서 아이콘으로 사용하세요. 200×200 캔버스 기준으로 그려집니다.
                  </div>
                  <DrawingCanvas onExport={applyFromDraw} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';
import React, { useState, useCallback } from 'react';
import { usePFDStore, UserEquipmentNode } from '@/lib/stores/pfdStore';

// ── Equipment type catalog ─────────────────────────────────────────────────
export const CATALOG = [
  { type: 'agitatedDrum',   label: '반응기/교반드럼',      color: '#1A2F44' },
  { type: 'tank',           label: '수직드럼(탱크)',       color: '#1A2F44' },
  { type: 'drumHorizontal', label: '수평드럼',            color: '#1A2F44' },
  { type: 'separator',      label: '기액분리기(K.O)',      color: '#1A2F44' },
  { type: 'towerPacking',   label: '팩킹컬럼(충진탑)',     color: '#0284c7' },
  { type: 'tower',          label: '증류컬럼(트레이)',     color: '#0284c7' },
  { type: 'evaporator',     label: '강하막증발관',         color: '#ea580c' },
  { type: 'filter',         label: '필터(캔들/수지)',      color: '#059669' },
  { type: 'heatExchanger',  label: '열교환기(HEX)',       color: '#ea580c' },
  { type: 'pump',           label: '원심펌프',            color: '#0284c7' },
  { type: 'compressor',     label: '압축기',              color: '#7c3aed' },
  { type: 'valve',          label: '컨트롤밸브',           color: '#64748b' },
  { type: 'branch',         label: '배관 브랜치',          color: '#64748b' },
  { type: 'mixer',          label: '믹서(배수 ×N)',        color: '#d97706' },
  { type: 'electrolyzer',   label: '이온교환막 전해조',    color: '#0284c7' },
] as const;

const SECTIONS = ['100', '200', '300', '400', '600'] as const;

const COLOR_SWATCHES = [
  '#1A2F44', '#0284c7', '#059669', '#ea580c',
  '#7c3aed', '#d97706', '#64748b', '#00d4ff',
];

// ── Inline SVG icons per equipment type ───────────────────────────────────
export function EquipIcon({ type, color, size = 38 }: { type: string; color: string; size?: number }) {
  const s = { stroke: color, fill: '#FFFFFF', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const sLine = { stroke: color, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const icons: Record<string, React.ReactNode> = {
    agitatedDrum: (
      <>
        <rect x="15" y="2" width="10" height="7" rx="1" fill={color} />
        <path d="M9 13 A11 4 0 0 1 31 13 L31 32 A11 4 0 0 1 9 32 Z" {...s} />
        <line x1="20" y1="9" x2="20" y2="30" {...sLine} />
        <path d="M13 22 C16 19, 18 25, 20 22 C22 19, 24 25, 27 22" {...sLine} />
        <line x1="12" y1="29" x2="28" y2="29" {...sLine} strokeWidth={2} />
      </>
    ),
    tank: (
      <>
        <path d="M9 10 A11 4.5 0 0 1 31 10 L31 31 A11 4.5 0 0 1 9 31 Z" {...s} />
        <line x1="9.5" y1="23" x2="30.5" y2="23" {...sLine} strokeDasharray="2.5 1.5" />
        <polygon points="20,23 18,19.5 22,19.5" fill="none" stroke={color} strokeWidth="1.1" />
        <line x1="13" y1="34" x2="11" y2="38" {...sLine} />
        <line x1="27" y1="34" x2="29" y2="38" {...sLine} />
      </>
    ),
    drumHorizontal: (
      <>
        <path d="M9 11 L31 11 A5 8 0 0 1 31 27 L9 27 A5 8 0 0 1 9 11 Z" {...s} />
        <line x1="25" y1="16" x2="25" y2="27" {...sLine} />
        <line x1="5" y1="20" x2="25" y2="20" {...sLine} strokeDasharray="2 1.5" />
        <path d="M12 27 L10 33 M28 27 L30 33 M8 33 L32 33" {...sLine} />
      </>
    ),
    separator: (
      <>
        <path d="M10 8 A10 4 0 0 1 30 8 L30 32 A10 4 0 0 1 10 32 Z" {...s} />
        <rect x="10.5" y="12" width="19" height="4.5" fill="none" stroke={color} strokeWidth="1.1" />
        <path d="M11 12 L16 16.5 M16 12 L21 16.5 M21 12 L26 16.5 M16 12 L11 16.5 M21 12 L16 16.5 M26 12 L21 16.5" stroke={color} strokeWidth="0.8" />
        <line x1="10.5" y1="25" x2="29.5" y2="25" {...sLine} strokeDasharray="2 1.5" />
      </>
    ),
    towerPacking: (
      <>
        <path d="M12 7 A8 4 0 0 1 28 7 L28 33 A8 4 0 0 1 12 33 Z" {...s} />
        <rect x="12.5" y="11" width="15" height="9" fill="none" stroke={color} strokeWidth="1" />
        <line x1="12.5" y1="11" x2="27.5" y2="20" {...sLine} strokeWidth={1.1} />
        <line x1="27.5" y1="11" x2="12.5" y2="20" {...sLine} strokeWidth={1.1} />
        <rect x="12.5" y="22" width="15" height="9" fill="none" stroke={color} strokeWidth="1" />
        <line x1="12.5" y1="22" x2="27.5" y2="31" {...sLine} strokeWidth={1.1} />
        <line x1="27.5" y1="22" x2="12.5" y2="31" {...sLine} strokeWidth={1.1} />
      </>
    ),
    tower: (
      <>
        <path d="M12 7 A8 4 0 0 1 28 7 L28 33 A8 4 0 0 1 12 33 Z" {...s} />
        <path d="M12.5 13 H24 V16 M27.5 19 H16 V22 M12.5 25 H24 V28" {...sLine} strokeWidth={1.2} />
      </>
    ),
    evaporator: (
      <>
        <path d="M12 6 A8 4 0 0 1 28 6 L28 30 L22 36 L18 36 L12 30 Z" {...s} />
        <line x1="12" y1="12" x2="28" y2="12" {...sLine} />
        <line x1="12" y1="28" x2="28" y2="28" {...sLine} />
        <line x1="16" y1="12" x2="16" y2="28" {...sLine} strokeWidth={1} />
        <line x1="20" y1="12" x2="20" y2="28" {...sLine} strokeWidth={1} />
        <line x1="24" y1="12" x2="24" y2="28" {...sLine} strokeWidth={1} />
      </>
    ),
    filter: (
      <>
        <path d="M9 8 A11 4 0 0 1 31 8 L31 26 L22 35 L18 35 L9 26 Z" {...s} />
        <line x1="9" y1="12" x2="31" y2="12" {...sLine} />
        <rect x="13" y="12" width="3" height="12" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 1" />
        <rect x="18.5" y="12" width="3" height="12" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 1" />
        <rect x="24" y="12" width="3" height="12" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 1" />
      </>
    ),
    heatExchanger: (
      <>
        <path d="M8 10 L32 10 A4 10 0 0 1 32 30 L8 30 A4 10 0 0 1 8 10 Z" {...s} />
        <polyline points="4,20 10,20 14,14 20,26 26,14 30,20 36,20" {...sLine} />
      </>
    ),
    pump: (
      <>
        <polygon points="19,21 11,33 27,33" fill="none" stroke={color} strokeWidth="1.5" />
        <path d="M19 9 L32 9 L32 15 L27 15" {...s} />
        <circle cx="19" cy="20" r="10" {...s} />
        <circle cx="19" cy="20" r="3" {...sLine} />
      </>
    ),
    compressor: (
      <>
        <polygon points="7,13 33,8 33,32 7,27" {...s} />
        <path d="M13 20 L27 20 M23 16 L27 20 L23 24" {...sLine} />
      </>
    ),
    valve: (
      <>
        <path d="M13 10 A7 5 0 0 1 27 10 Z" fill={color} />
        <line x1="20" y1="10" x2="20" y2="21" {...sLine} />
        <polygon points="7,14 20,21 7,28" {...s} />
        <polygon points="33,14 20,21 33,28" {...s} />
      </>
    ),
    branch: (
      <>
        <line x1="20" y1="6" x2="20" y2="34" {...sLine} />
        <line x1="6" y1="20" x2="34" y2="20" {...sLine} />
        <circle cx="20" cy="20" r="4" fill={color} stroke={color} />
      </>
    ),
    mixer: (
      <>
        <circle cx="20" cy="20" r="13" {...s} />
        <line x1="13" y1="13" x2="27" y2="27" {...sLine} />
        <line x1="27" y1="13" x2="13" y2="27" {...sLine} />
      </>
    ),
    electrolyzer: (
      <>
        <rect x="5" y="9" width="30" height="22" rx="2" {...s} />
        <line x1="20" y1="9" x2="20" y2="31" {...sLine} strokeDasharray="3 2" />
        <line x1="12" y1="9" x2="12" y2="31" {...sLine} strokeWidth={1} />
        <line x1="28" y1="9" x2="28" y2="31" {...sLine} strokeWidth={1} />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      {icons[type] ?? icons['tank']}
    </svg>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onNodeAdded?: (node: import('reactflow').Node) => void;
}

export function AddEquipmentPanel({ onClose, onNodeAdded }: Props) {
  const addUserNode    = usePFDStore(s => s.addUserNode);
  const removeUserNode = usePFDStore(s => s.removeUserNode);
  const userNodes      = usePFDStore(s => s.userNodes);

  const [selType,    setSelType]    = useState<string>('tank');
  const [tag,        setTag]        = useState('');
  const [name,       setName]       = useState('');
  const [section,    setSection]    = useState<string>('100');
  const [selColor,   setSelColor]   = useState('#4ade80');
  const [multiplier, setMultiplier] = useState(5);

  const handleAdd = useCallback(() => {
    const trimTag  = tag.trim();
    const trimName = name.trim();
    if (!trimTag || !trimName) {
      alert('Tag와 용도/이름을 입력하세요.');
      return;
    }
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const isMixer = selType === 'mixer';
    const node: UserEquipmentNode = {
      id, tag: trimTag, name: trimName,
      type: selType, section, color: selColor,
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 120 },
      ...(isMixer ? { multiplier } : {}),
    };
    addUserNode(node);
    // Notify parent so rfNodes can be updated immediately
    if (onNodeAdded) {
      onNodeAdded({
        id,
        type: selType,
        position: node.position,
        data: { tag: trimTag, name: trimName, color: selColor, ...(isMixer ? { multiplier } : {}) },
      });
    }
    setTag('');
    setName('');
  }, [tag, name, selType, section, selColor, multiplier, addUserNode, onNodeAdded]);

  const catalogEntry = CATALOG.find(c => c.type === selType);
  const activeColor  = selColor || catalogEntry?.color || '#4ade80';

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 300, height: '100%',
      background: 'rgba(10,14,26,0.96)',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      backdropFilter: 'blur(16px)',
      zIndex: 50,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', system-ui, sans-serif",
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em' }}>
          ＋ 장치 삽입
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#64748b',
          cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px',
        }}>✕</button>
      </div>

      <div style={{ padding: '12px 14px', flex: 1 }}>

        {/* ─ Equipment Type selector ─ */}
        <Label>장치 종류 선택</Label>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 14,
        }}>
          {CATALOG.map(({ type, label, color }) => {
            const active = selType === type;
            return (
              <button key={type} onClick={() => { setSelType(type); setSelColor(color); }}
                style={{
                  background: active ? color + '22' : 'rgba(255,255,255,0.04)',
                  border: active ? `1.5px solid ${color}` : '1.5px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, padding: '6px 4px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  transition: 'all 0.15s',
                }}>
                <EquipIcon type={type} color={active ? color : '#64748b'} />
                <span style={{ fontSize: 9, color: active ? color : '#64748b', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ─ Tag ─ */}
        <Label>Tag 번호 *</Label>
        <input
          value={tag} onChange={e => setTag(e.target.value)}
          placeholder="예: D-010, P-044A/B"
          style={inputStyle}
        />

        {/* ─ Name/Purpose ─ */}
        <Label>용도 / 이름 *</Label>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="예: 포화조, Brine Saturation Tank"
          style={inputStyle}
        />

        {/* ─ Multiplier (mixer 전용) ─ */}
        {selType === 'mixer' && (
          <>
            <Label>배수 (×N) — 동형 장치 N대를 대표해 유량을 N배로 표기</Label>
            <input
              type="number" min={1} step={1}
              value={multiplier}
              onChange={e => setMultiplier(Math.max(1, Number(e.target.value) || 1))}
              placeholder="예: 5 (전해조 5기 중 1기만 그릴 때)"
              style={inputStyle}
            />
          </>
        )}

        {/* ─ Section ─ */}
        <Label>섹션</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {SECTIONS.map(sec => (
            <button key={sec} onClick={() => setSection(sec)} style={{
              flex: 1, height: 28, borderRadius: 5, fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
              background: section === sec ? activeColor + '22' : 'rgba(255,255,255,0.05)',
              border: section === sec ? `1.5px solid ${activeColor}` : '1.5px solid rgba(255,255,255,0.1)',
              color: section === sec ? activeColor : '#64748b',
              transition: 'all 0.15s',
            }}>{sec}</button>
          ))}
        </div>

        {/* ─ Color ─ */}
        <Label>색상</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {COLOR_SWATCHES.map(c => (
            <button key={c} onClick={() => setSelColor(c)} style={{
              width: 24, height: 24, borderRadius: 5, background: c,
              border: selColor === c ? '2px solid #fff' : '2px solid transparent',
              cursor: 'pointer', transition: 'border 0.1s',
              boxShadow: selColor === c ? '0 0 0 1px rgba(255,255,255,0.4)' : 'none',
            }}/>
          ))}
        </div>

        {/* ─ Add button ─ */}
        <button onClick={handleAdd} style={{
          width: '100%', height: 38, borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: `linear-gradient(135deg, ${activeColor}dd, ${activeColor}88)`,
          border: 'none', color: '#fff', cursor: 'pointer',
          boxShadow: `0 2px 12px ${activeColor}44`,
          transition: 'opacity 0.15s', letterSpacing: '0.02em',
          marginBottom: 16,
        }}>
          ＋ 캔버스에 삽입
        </button>

        {/* ─ Added nodes list ─ */}
        {userNodes.length > 0 && (
          <>
            <div style={{
              fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.06em',
              textTransform: 'uppercase', marginBottom: 8,
            }}>삽입된 장치 ({userNodes.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {userNodes.map(n => (
                <div key={n.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 6, padding: '5px 8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: n.color || '#4ade80', flexShrink: 0 }}/>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{n.tag}</div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>{n.name} · {n.section}Sec</div>
                    </div>
                  </div>
                  <button onClick={() => removeUserNode(n.id)} style={{
                    background: 'none', border: 'none', color: '#ef4444',
                    cursor: 'pointer', fontSize: 14, padding: '1px 4px', lineHeight: 1,
                  }}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tiny helpers ────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 32, marginBottom: 12,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: '#e2e8f0', fontSize: 12,
  padding: '0 10px', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default AddEquipmentPanel;

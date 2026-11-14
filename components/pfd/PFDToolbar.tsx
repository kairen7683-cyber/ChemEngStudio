'use client';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePFDStore } from '@/lib/stores/pfdStore';

/* ── Icon helpers ─────────────────────────────────────────── */
const PencilIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
  </svg>
);
const CheckIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const EyeIcon = ({ open }: { open: boolean }) => open ? (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>
  </svg>
);
const GridIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const PlusIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const ResetIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);
const ExportIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const UndoIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 14 4 9 9 4"/>
    <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
  </svg>
);
const RedoIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 14 20 9 15 4"/>
    <path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
  </svg>
);
const ImportIcon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const QUICK_DRAG_ITEMS = [
  { type: 'electrolyzer',  label: '전해조',     tagPrefix: 'EL',  isCalc: true },
  { type: 'separator',     label: '기액분리기', tagPrefix: 'D',   isCalc: true },
  { type: 'heatExchanger', label: '열교환기',   tagPrefix: 'E',   isCalc: true },
  { type: 'towerPacking',  label: '팩킹컬럼',   tagPrefix: 'T',   isCalc: true },
  { type: 'evaporator',    label: '증발관',     tagPrefix: 'EV',  isCalc: true },
  { type: 'pump',          label: '펌프',       tagPrefix: 'P',   isCalc: true },
  { type: 'compressor',    label: '압축기',     tagPrefix: 'C',   isCalc: true },
  { type: 'tank',          label: '수직드럼',   tagPrefix: 'TK',  isCalc: false },
  { type: 'drumHorizontal',label: '수평드럼',   tagPrefix: 'D',   isCalc: false },
  { type: 'filter',        label: '필터',       tagPrefix: 'F',   isCalc: false },
  { type: 'valve',         label: '밸브',       tagPrefix: 'FCV', isCalc: false },
  { type: 'mixer',         label: '믹서×N',     tagPrefix: 'M',   isCalc: false },
];

/* ── Button ───────────────────────────────────────────────── */
function Btn({ children, isActive, title, onClick }: {
  children: React.ReactNode; color?: string; isActive?: boolean;
  activeColor?: string; title?: string; onClick?: () => void;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      title={title} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        height: 29, padding: '0 9px', borderRadius: 6,
        fontSize: 11, fontWeight: 700, cursor: 'pointer',
        background: isActive ? '#1A2F44' : hov ? '#EFECE5' : 'transparent',
        color: isActive ? '#FFFFFF' : '#3F3F46',
        border: 'none',
        display: 'flex', alignItems: 'center', gap: 5,
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}

const Sep = () => (
  <div style={{ width: 1, height: 18, background: '#E5E2DC', flexShrink: 0 }} />
);

/* ── Auto-save indicator ──────────────────────────────────── */
function AutoSaveIndicator() {
  const [savedAt, setSavedAt] = useState('');

  function now() {
    return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  useEffect(() => {
    setSavedAt(now());
    const unsub = usePFDStore.subscribe(() => {
      setSavedAt(now());
    });
    return unsub;
  }, []);

  if (!savedAt) return null;

  return (
    <span style={{
      fontSize: 10, color: '#0F766E', padding: '2px 7px',
      background: '#ECFDF5',
      border: '1px solid #A7F3D0',
      borderRadius: 4,
      display: 'flex', alignItems: 'center', gap: 4,
      fontWeight: 700,
    }}>
      <span style={{ fontSize: 9 }}>●</span>
      저장됨 {savedAt}
    </span>
  );
}

/* ── Import helper ────────────────────────────────────────── */
function importJSON(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const payload = JSON.parse(text);

        if (!payload || typeof payload !== 'object') {
          throw new Error('유효하지 않은 백업 파일입니다.');
        }
        if (payload.version === undefined) {
          throw new Error('PFD 백업 파일이 아닙니다 (version 필드 없음).');
        }

        const savedAt = payload.savedAt
          ? new Date(payload.savedAt).toLocaleString('ko-KR')
          : '알 수 없음';

        const ok = window.confirm(
          `백업 파일을 불러오겠습니까?\n\n저장 시각: ${savedAt}\n\n현재 편집 내용은 덮어씌워집니다.`
        );
        if (!ok) { resolve(); return; }

        usePFDStore.setState({
          nodePositions:   payload.nodePositions   ?? {},
          edgeStreamMap:   payload.edgeStreamMap   ?? {},
          userNodes:       payload.userNodes        ?? [],
          userEdges:       payload.userEdges        ?? [],
          deletedNodeIds:  payload.deletedNodeIds   ?? [],
          deletedEdgeIds:  payload.deletedEdgeIds   ?? [],
          nodeTagOverrides: payload.nodeTagOverrides ?? {},
        });

        window.location.reload();
        resolve();
      } catch (err) {
        alert(`불러오기 실패: ${(err as Error).message}`);
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 오류'));
    reader.readAsText(file);
  });
}

function exportJSON() {
  const s = usePFDStore.getState();
  const payload = {
    version: 1, savedAt: new Date().toISOString(),
    nodePositions: s.nodePositions,
    edgeStreamMap: s.edgeStreamMap,
    userNodes: s.userNodes,
    userEdges: s.userEdges,
    deletedNodeIds: s.deletedNodeIds,
    deletedEdgeIds: s.deletedEdgeIds,
    nodeTagOverrides: s.nodeTagOverrides,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pfd_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportBtnWrapper() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hov, setHov] = React.useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = '';
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        title="백업 파일(JSON)을 불러와서 복원"
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          height: 29, padding: '0 9px', borderRadius: 6,
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: hov ? '#EFECE5' : 'transparent',
          color: '#3F3F46',
          border: 'none',
          display: 'flex', alignItems: 'center', gap: 5,
          whiteSpace: 'nowrap',
        }}
      >
        <ImportIcon /> 불러오기
      </button>
    </>
  );
}

/* ── Main component ───────────────────────────────────────── */
interface PFDToolbarProps {
  onOpenIconManager: () => void;
  onOpenAddPanel: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  missingStreamCount?: number;
  totalStreamCount?: number;
  onOpenStreamCoverage?: () => void;
  highlightCalcUnits?: boolean;
  onToggleHighlightCalc?: () => void;
}

export function PFDToolbar({
  onOpenIconManager,
  onOpenAddPanel,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  missingStreamCount = 0,
  totalStreamCount = 0,
  onOpenStreamCoverage,
  highlightCalcUnits = false,
  onToggleHighlightCalc,
}: PFDToolbarProps) {
  const editMode       = usePFDStore(s => s.editMode);
  const showCrossEdges = usePFDStore(s => s.showCrossEdges);
  const setEditMode    = usePFDStore(s => s.setEditMode);
  const toggleCross    = usePFDStore(s => s.toggleCrossEdges);

  const handleReset = useCallback(() => {
    if (window.confirm(
      '모든 편집 내용(장치 삽입/삭제/위치/배관)을 공정 기본 배치(실제 공정 세팅)로 복원하겠습니까?\n이 작업은 되돌릴 수 없습니다.'
    )) {
      usePFDStore.getState().resetNodePositions();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        onRedo?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onUndo, onRedo]);

  return (
    <div style={{
      position: 'absolute', top: 10, left: 10, zIndex: 20,
      maxWidth: 'calc(100% - 230px)',
      display: 'flex', flexDirection: 'column',
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(255, 255, 255, 0.97)',
      backdropFilter: 'blur(14px)',
      border: '1px solid #DFDCD4',
      boxShadow: '0 2px 12px rgba(24,24,27,0.10)',
    }}>
      {/* ── Button row ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', flexWrap: 'wrap' }}>

        {/* Edit / View toggle */}
        <Btn
          isActive={editMode}
          title={editMode ? '보기 모드로 전환' : '편집 모드로 전환 (드래그 배치 활성화)'}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? <CheckIcon /> : <PencilIcon />}
          {editMode ? '편집 완료 (보기 전환)' : '편집 모드'}
        </Btn>

        <Sep />

        {/* 미표기 스트림 확인 버튼 (공정도 쪽에서 즉시 확인!) */}
        {onOpenStreamCoverage && (
          <>
            <button
              onClick={onOpenStreamCoverage}
              title="전체 스트림 중 현재 공정도(PFD)에 아직 안 그려진 미표기 스트림 목록을 확인합니다"
              style={{
                height: 29, padding: '0 10px', borderRadius: 6,
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                background: missingStreamCount > 0 ? '#FFFBEB' : '#ECFDF5',
                color: missingStreamCount > 0 ? '#B45309' : '#0F766E',
                border: `1px solid ${missingStreamCount > 0 ? '#FCD34D' : '#A7F3D0'}`,
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
              }}
            >
              📋 미표기 스트림 ({missingStreamCount}/{totalStreamCount})
            </button>
            <Sep />
          </>
        )}

        {/* 계산 장치 vs 단순 그림 장치 색상 구분 토글 */}
        {onToggleHighlightCalc && (
          <>
            <Btn
              isActive={highlightCalcUnits}
              title="열·물질수지 계산 연동 장치(청록 실선)와 단순 도면 표기 장치(회색 점선)를 색상으로 구분합니다"
              onClick={onToggleHighlightCalc}
            >
              ⚡ 계산/도면 장치 구분
            </Btn>
            <Sep />
          </>
        )}

        {/* Cross-section edge toggle */}
        <Btn
          isActive={showCrossEdges}
          title={showCrossEdges ? '섹션 연결선 숨기기' : '섹션 연결선 표시'}
          onClick={toggleCross}
        >
          <EyeIcon open={showCrossEdges} />
          섹션연결
        </Btn>

        <Sep />

        {/* Icon manager */}
        <Btn title="커스텀 아이콘 관리" onClick={onOpenIconManager}>
          <GridIcon /> 아이콘
        </Btn>

        <Sep />

        {/* Auto-save indicator */}
        <AutoSaveIndicator />

        <Sep />

        {/* Backup export / import */}
        <Btn title="현재 상태를 JSON 파일로 백업" onClick={exportJSON}>
          <ExportIcon /> 백업
        </Btn>
        <ImportBtnWrapper />

        {/* Edit-mode-only buttons */}
        {editMode && (
          <>
            <Sep />
            <Btn title="실행 취소 (Ctrl+Z)" onClick={onUndo}>
              <UndoIcon /> 되돌리기
            </Btn>
            <Btn title="다시 실행 (Ctrl+Y)" onClick={onRedo}>
              <RedoIcon /> 다시하기
            </Btn>
            <Sep />
            <Btn title="상세 장치 삽입 패널" onClick={onOpenAddPanel}>
              <PlusIcon /> 상세삽입
            </Btn>
            <Btn title="모든 편집 초기화" onClick={handleReset}>
              <ResetIcon /> 초기화
            </Btn>
          </>
        )}
      </div>

      {/* ── View mode inspector guide ──────────────────────── */}
      {!editMode && (
        <div style={{
          padding: '4px 10px', fontSize: 10, fontWeight: 600,
          color: '#1A2F44', background: '#F6F7F2',
          borderTop: '1px solid #E5E2DC',
          borderLeft: '3px solid #0F766E',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          lineHeight: 1.5,
        }}>
          <span>
            💡 <b>장치·배관 클릭</b>: 사양·기액분리·물질수지 확인 &nbsp;|&nbsp; <b>📋 미표기 스트림</b> 버튼으로 아직 안 그려진 라인 확인 가능
          </span>
          <Link
            href="/flowsheet-simulator"
            style={{
              fontSize: 10, fontWeight: 800, color: '#0F766E', textDecoration: 'none',
              padding: '2px 8px', borderRadius: 4, background: '#ECFDF5', border: '1px solid #A7F3D0',
              whiteSpace: 'nowrap',
            }}
          >
            🧪 도면→자동 물질수지 빌더 (Beta) →
          </Link>
        </div>
      )}

      {/* ── Edit mode Drag & Drop Quick Palette ────────────── */}
      {editMode && (
        <div style={{
          padding: '6px 10px', fontSize: 10,
          background: '#FFF7ED',
          borderTop: '1px solid #FED7AA',
          borderLeft: '3px solid #EA580C',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#9A3412', marginRight: 3 }}>
              🖱️ 도면으로 드래그 앤 드랍하여 바로 추가:
            </span>
            {QUICK_DRAG_ITEMS.map(item => (
              <span
                key={item.type}
                draggable
                onDragStart={ev => {
                  ev.dataTransfer.setData('application/pfd-equip', JSON.stringify(item));
                  ev.dataTransfer.effectAllowed = 'copy';
                }}
                title="마우스로 끌어서 공정도 원하는 위치에 놓으세요"
                style={{
                  padding: '2px 7px',
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'grab',
                  userSelect: 'none',
                  background: item.isCalc ? '#ECFDF5' : '#F8FAFC',
                  color: item.isCalc ? '#0F766E' : '#475569',
                  border: item.isCalc ? '1.5px solid #0F766E' : '1.5px dashed #94A3B8',
                }}
              >
                {item.isCalc ? '⚡' : '🖼️'} {item.label}
              </span>
            ))}
          </div>
          <div style={{ color: '#9A3412', fontWeight: 600 }}>
            배관 연결: 장치 점(핸들) 드래그 &nbsp;|&nbsp; 삭제: 선택 후 Delete &nbsp;|&nbsp; 실행취소: Ctrl+Z
          </div>
        </div>
      )}
    </div>
  );
}

export default PFDToolbar;

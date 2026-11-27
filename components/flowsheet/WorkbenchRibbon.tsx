'use client';

import React, { useEffect, useState } from 'react';
import { useUnitStore } from '@/lib/stores/unitStore';
import { UNIT_PRESETS } from '@/lib/units/unitSystem';

export interface WorkbenchRibbonProps {
  lang: 'ko' | 'en';
  // Context
  isPlantSimMode: boolean;
  activeSheetTitle: string;
  activeSheetId: string;
  hasMultipleSheets: boolean;
  onGoMasterSheet: () => void;
  // Run & Status
  isSimRunning: boolean;
  isSimDirty: boolean;
  isIdle: boolean;
  effectiveStatus: 'dirty' | 'converged' | 'warning' | 'failed';
  iterations: number;
  elapsedMs: number;
  warningCount: number;
  failedCount: number;
  onRunSim: () => void;
  onToggleConvDiag: () => void;
  // Solver / Thermo / Comps
  propertyMethod: string;
  activeCompCount: number;
  onOpenCompSetup: () => void;
  onOpenPropertyMethod?: () => void;
  // View / Layout
  layoutMode: 'canvas' | 'split' | 'table';
  onChangeLayoutMode: (mode: 'canvas' | 'split' | 'table') => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onFitView: () => void;
  streamLabelMode?: 'full' | 'compact';
  onToggleStreamLabelMode?: () => void;
  onExportPfdPng?: () => void;
  // Edit / History
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Case & Sheet actions
  onResetOrClear: () => void;
  boundarySyncEnabled?: boolean;
  onToggleBoundarySync?: () => void;
  // Quick Navigation / Tools
  onOpenCaseMenu?: () => void;
  onSaveCase?: () => void;
  onOpenHub?: () => void;
  onShareToHub?: () => void;
  onOpenSpecModal?: () => void;
  enabledSpecsCount?: number;
  onOpenComponentRequest?: () => void;
  onNavigateRoute: (href: string) => void;
  onSwitchClassicUi?: () => void;
  // Optional extra slot (e.g. convergence diagnostics popover or admin preset selector)
  plantCustomDesign?: { labelKo: string; labelEn: string; href: string } | null;
  rightExtraSlot?: React.ReactNode;
}

type RibbonTabId = 'home' | 'design_econ' | 'settings';

const RIBBON_TABS: Array<{ id: RibbonTabId; ko: string; en: string }> = [
  { id: 'home', ko: '홈', en: 'Home' },
  { id: 'design_econ', ko: '장치설계 · 경제성', en: 'Design & Economics' },
  { id: 'settings', ko: '설정', en: 'Settings' },
];

function RibbonGroup({
  label,
  children,
  noDivider = false,
}: {
  label: string;
  children: React.ReactNode;
  noDivider?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '2px 8px 1px',
        borderRight: noDivider ? 'none' : '1px solid #E2E8F0',
        flexShrink: 0,
        height: 44,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 28,
        }}
      >
        {children}
      </div>
      <span
        style={{
          fontSize: 9,
          lineHeight: '11px',
          fontWeight: 600,
          color: '#94A3B8',
          letterSpacing: '0.02em',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default function WorkbenchRibbon({
  lang,
  isPlantSimMode,
  activeSheetTitle,
  activeSheetId,
  hasMultipleSheets,
  onGoMasterSheet,
  isSimRunning,
  isSimDirty,
  isIdle,
  effectiveStatus,
  iterations,
  elapsedMs,
  warningCount,
  failedCount,
  onRunSim,
  onToggleConvDiag,
  propertyMethod,
  activeCompCount,
  onOpenCompSetup,
  onOpenPropertyMethod,
  layoutMode,
  onChangeLayoutMode,
  explorerOpen,
  onToggleExplorer,
  paletteOpen,
  onTogglePalette,
  inspectorOpen,
  onToggleInspector,
  onFitView,
  streamLabelMode = 'full',
  onToggleStreamLabelMode,
  onExportPfdPng,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetOrClear,
  boundarySyncEnabled = false,
  onToggleBoundarySync,
  onOpenCaseMenu,
  onSaveCase,
  onOpenHub,
  onShareToHub,
  onOpenSpecModal,
  enabledSpecsCount = 0,
  onOpenComponentRequest,
  onNavigateRoute,
  onSwitchClassicUi,
  plantCustomDesign,
  rightExtraSlot,
}: WorkbenchRibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTabId>('home');
  const unitPresetId = useUnitStore(s => s.presetId);
  const applyUnitPreset = useUnitStore(s => s.applyPreset);
  const tagStandard = useUnitStore(s => s.tagStandard);
  const setTagStandard = useUnitStore(s => s.setTagStandard);
  const [wbTheme, setWbTheme] = useState<'light' | 'dark'>('light');
  const [projMeta, setProjMeta] = useState<{ projectName: string; rev: string; engineer: string }>({
    projectName: '',
    rev: 'Rev.0',
    engineer: '',
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('chemeng_project_meta_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setProjMeta({
            projectName: String(parsed.projectName ?? ''),
            rev: String(parsed.rev ?? 'Rev.0'),
            engineer: String(parsed.engineer ?? ''),
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const updateProjMeta = (patch: Partial<{ projectName: string; rev: string; engineer: string }>) => {
    setProjMeta(prev => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem('chemeng_project_meta_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('chemplant-wb-theme-v1');
    const next: 'light' | 'dark' = saved === 'dark' ? 'dark' : 'light';
    setWbTheme(next);
    if (next === 'dark') {
      document.documentElement.setAttribute('data-wb-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-wb-theme');
    }
  }, []);

  const toggleWbTheme = () => {
    const next: 'light' | 'dark' = wbTheme === 'dark' ? 'light' : 'dark';
    setWbTheme(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chemplant-wb-theme-v1', next);
      if (next === 'dark') {
        document.documentElement.setAttribute('data-wb-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-wb-theme');
      }
    }
  };

  // Compute flat convergence status presentation
  const statusInfo = (() => {
    if (isIdle) {
      return {
        dot: '#94A3B8',
        text: t('미실행', 'Not Run'),
        color: '#64748B',
        bg: '#F1F5F9',
        border: '#E2E8F0',
      };
    }
    if (isSimDirty || effectiveStatus === 'dirty') {
      return {
        dot: '#D97706',
        text: t('조건 변경됨', 'Modified'),
        color: '#92400E',
        bg: '#FFFBEB',
        border: '#FDE68A',
      };
    }
    if (effectiveStatus === 'converged') {
      return {
        dot: '#059669',
        text: isEn
          ? `Converged (${iterations} · ${elapsedMs}ms) ▾`
          : `수렴 (${iterations}회·${elapsedMs}ms) ▾`,
        color: '#065F46',
        bg: '#ECFDF5',
        border: '#A7F3D0',
      };
    }
    if (effectiveStatus === 'warning') {
      return {
        dot: '#D97706',
        text: isEn ? `Warning (${warningCount}) ▾` : `경고 (${warningCount}) ▾`,
        color: '#92400E',
        bg: '#FFFBEB',
        border: '#FDE68A',
      };
    }
    return {
      dot: '#DC2626',
      text: isEn ? `Failed (${failedCount}) ▾` : `미수렴 (${failedCount}) ▾`,
      color: '#991B1B',
      bg: '#FEF2F2',
      border: '#FECACA',
    };
  })();

  const handleRequestComponent = () => {
    if (onOpenComponentRequest) {
      onOpenComponentRequest();
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chemeng:open-component-request'));
    }
  };

  const handleClassicUi = () => {
    if (onSwitchClassicUi) {
      onSwitchClassicUi();
    } else {
      onNavigateRoute('/classic-simulator');
    }
  };

  return (
    <div
      className="wb-ribbon-root"
      style={{
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #CBD5E1',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        userSelect: 'none',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
      }}
    >
      <style>{`
        .wb-ribbon-scroll::-webkit-scrollbar { height: 4px; }
        .wb-ribbon-scroll::-webkit-scrollbar-track { background: transparent; }
        .wb-ribbon-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }
        .wb-tab-btn {
          height: 28px;
          padding: 0 12px;
          border: none;
          background: transparent;
          font-size: 11.5px;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
          white-space: nowrap;
        }
        .wb-tab-btn:hover {
          color: #1E3A8A;
          background-color: #F1F5F9;
        }
        .wb-tab-btn.active {
          color: #1E3A8A;
          font-weight: 700;
          background-color: #FFFFFF;
          border-bottom-color: #1E3A8A;
        }
        .wb-cmd-btn {
          height: 26px;
          padding: 0 8px;
          border-radius: 4px;
          border: 1px solid #E2E8F0;
          background: #FFFFFF;
          color: #334155;
          font-size: 11.5px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .wb-cmd-btn:hover:not(:disabled) {
          background: #F1F5F9;
          border-color: #CBD5E1;
          color: #0F172A;
        }
        .wb-cmd-btn:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }
        .wb-cmd-btn.active {
          background: #EFF6FF;
          border-color: #93C5FD;
          color: #1E3A8A;
          font-weight: 600;
        }
        .wb-run-btn {
          height: 26px;
          padding: 0 11px;
          border-radius: 4px;
          border: 1px solid #1E3A8A;
          background: #1E3A8A;
          color: #FFFFFF;
          font-size: 11.5px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          white-space: nowrap;
          letter-spacing: 0.01em;
          transition: background-color 120ms ease;
        }
        .wb-run-btn:hover:not(:disabled) {
          background: #1D4ED8;
          border-color: #1D4ED8;
        }
        .wb-run-btn:disabled {
          opacity: 0.72;
          cursor: wait;
        }
        .wb-seg-wrap {
          display: inline-flex;
          align-items: center;
          background: #F1F5F9;
          border: 1px solid #E2E8F0;
          border-radius: 4px;
          padding: 1px;
          height: 26px;
        }
        .wb-seg-btn {
          height: 22px;
          padding: 0 7px;
          border: none;
          border-radius: 3px;
          background: transparent;
          color: #475569;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 120ms ease, color 120ms ease;
        }
        .wb-seg-btn:hover {
          color: #0F172A;
        }
        .wb-seg-btn.active {
          background: #FFFFFF;
          color: #1E3A8A;
          font-weight: 700;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
        }
        .wb-icon-btn {
          height: 26px;
          min-width: 26px;
          padding: 0 6px;
          border-radius: 4px;
          border: 1px solid #E2E8F0;
          background: #FFFFFF;
          color: #334155;
          font-size: 13px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .wb-icon-btn:hover:not(:disabled) {
          background: #F1F5F9;
          border-color: #CBD5E1;
          color: #0F172A;
        }
        .wb-icon-btn:disabled {
          opacity: 0.38;
          cursor: not-allowed;
        }
      `}</style>

      {/* Row 1: Compact Tab Strip (~28px) */}
      <div
        style={{
          height: 28,
          backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            overflowX: 'auto',
          }}
        >
          {RIBBON_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`wb-tab-btn${isActive ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {isEn ? tab.en : tab.ko}
              </button>
            );
          })}
        </div>

        {/* Right contextual quick actions on tab bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
          }}
        >
          {isPlantSimMode && activeSheetTitle && (
            <span
              title={activeSheetTitle}
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#475569',
                padding: '0 6px',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              ▸ {activeSheetTitle}
            </span>
          )}
          {onOpenCaseMenu && (
            <button
              type="button"
              onClick={onOpenCaseMenu}
              style={{
                height: 20,
                padding: '0 7px',
                borderRadius: 3,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('케이스', 'Cases')}
            </button>
          )}
          {onSaveCase && (
            <button
              type="button"
              onClick={onSaveCase}
              style={{
                height: 20,
                padding: '0 7px',
                borderRadius: 3,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E3A8A',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('저장', 'Save')}
            </button>
          )}
          {onOpenHub && (
            <button
              type="button"
              onClick={onOpenHub}
              title={t('Process Hub (관리자 비공개 프리뷰)', 'Process Hub (Admin Private Preview)')}
              style={{
                height: 20,
                padding: '0 7px',
                borderRadius: 3,
                border: '1px solid #FCD34D',
                background: '#FFFBEB',
                color: '#92400E',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🔒 Hub
            </button>
          )}
          {onShareToHub && (
            <button
              type="button"
              onClick={onShareToHub}
              title={t('현재 공정을 Process Hub에 공유', 'Publish current flowsheet to Process Hub')}
              style={{
                height: 20,
                padding: '0 7px',
                borderRadius: 3,
                border: '1px solid #93C5FD',
                background: '#EFF6FF',
                color: '#1D4ED8',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ⬆ {t('공유', 'Share')}
            </button>
          )}
          <button
            type="button"
            onClick={toggleWbTheme}
            title={
              wbTheme === 'dark'
                ? t('라이트 모드로 전환', 'Switch to Light Mode')
                : t('다크 모드로 전환', 'Switch to Dark Mode')
            }
            aria-label={t('화면 테마 전환', 'Toggle Light / Dark Theme')}
            style={{
              height: 20,
              width: 24,
              padding: 0,
              borderRadius: 3,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#334155',
              fontSize: 11.5,
              lineHeight: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {wbTheme === 'dark' ? '☀' : '🌙'}
          </button>
        </div>
      </div>

      {/* Row 2: Single-line Grouped Command Strip (~46px) */}
      <div
        className="wb-ribbon-scroll"
        style={{
          height: 46,
          backgroundColor: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '0 4px',
        }}
      >
        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <>
            {hasMultipleSheets && activeSheetId !== 'master' && (
              <RibbonGroup label={t('시트', 'Sheet')}>
                <button
                  type="button"
                  className="wb-cmd-btn"
                  onClick={onGoMasterSheet}
                  style={{
                    color: '#1E3A8A',
                    borderColor: '#BFDBFE',
                    backgroundColor: '#EFF6FF',
                    fontWeight: 600,
                  }}
                >
                  <span>←</span>
                  <span>{t('마스터', 'Master')}</span>
                </button>
              </RibbonGroup>
            )}

            <RibbonGroup label={t('실행 · 해석', 'Run & Analysis')}>
              <button
                type="button"
                className="wb-run-btn"
                onClick={onRunSim}
                disabled={isSimRunning}
                title={t('시뮬레이션 실행 (F5)', 'Run Simulation (F5)')}
              >
                <span>{isSimRunning ? '◌' : '▶'}</span>
                <span>{isSimRunning ? t('계산 중...', 'Running...') : 'RUN (F5)'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleConvDiag}
                title={t('수렴 진단 열기/닫기', 'Toggle Convergence Diagnostics')}
                style={{
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 4,
                  border: `1px solid ${statusInfo.border}`,
                  backgroundColor: statusInfo.bg,
                  color: statusInfo.color,
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: statusInfo.dot,
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <span>{statusInfo.text}</span>
              </button>

              {onOpenSpecModal && (
                <button
                  type="button"
                  className={`wb-cmd-btn${enabledSpecsCount > 0 ? ' active' : ''}`}
                  onClick={onOpenSpecModal}
                  title={t(
                    '목표역산 제어기(Design Spec), 민감도 분석(Sensitivity), 리사이클 수렴기 설정',
                    'Design Spec controller, Sensitivity analysis, and recycle solver settings'
                  )}
                >
                  <span>◎</span>
                  <span>{t('목표역산 · 민감도', 'Specs · Sensitivity')}</span>
                  {enabledSpecsCount > 0 && (
                    <span
                      style={{
                        padding: '0 5px',
                        borderRadius: 999,
                        background: '#1E3A8A',
                        color: '#FFFFFF',
                        fontSize: 9.5,
                        fontWeight: 900,
                      }}
                    >
                      {enabledSpecsCount}
                    </span>
                  )}
                </button>
              )}
            </RibbonGroup>

            <RibbonGroup label={t('보기', 'View')}>
              <div className="wb-seg-wrap" role="group" aria-label={t('레이아웃 모드', 'Layout Mode')}>
                <button
                  type="button"
                  className={`wb-seg-btn${layoutMode === 'canvas' ? ' active' : ''}`}
                  onClick={() => onChangeLayoutMode('canvas')}
                >
                  {t('도면만 크게', 'Canvas')}
                </button>
                <button
                  type="button"
                  className={`wb-seg-btn${layoutMode === 'split' ? ' active' : ''}`}
                  onClick={() => onChangeLayoutMode('split')}
                >
                  {t('도면+스트림', 'Split')}
                </button>
              </div>
              <button
                type="button"
                className={`wb-cmd-btn${paletteOpen ? ' active' : ''}`}
                onClick={onTogglePalette}
                title={t('장치 팔레트 열기/닫기', 'Toggle Unit Palette')}
              >
                {t('팔레트', 'Palette')}
              </button>
              <button
                type="button"
                className={`wb-cmd-btn${inspectorOpen ? ' active' : ''}`}
                onClick={onToggleInspector}
                title={t('우측 속성창 열기/닫기', 'Toggle Property Inspector')}
              >
                {t('속성창', 'Inspector')}
              </button>
              {onToggleStreamLabelMode && (
                <button
                  type="button"
                  className={`wb-cmd-btn${streamLabelMode === 'compact' ? ' active' : ''}`}
                  onClick={onToggleStreamLabelMode}
                  title={t('도면 스트림 라벨 표시 밀도 전환 (상세 T·P·F ↔ 번호만)', 'Toggle stream callout labels (Full T·P·F ↔ No. Only)')}
                >
                  {streamLabelMode === 'compact'
                    ? t('라벨: 번호만', 'Labels: No.')
                    : t('라벨: 상세', 'Labels: Full')}
                </button>
              )}
            </RibbonGroup>

            <RibbonGroup label={t('제어 · 편집', 'Edit & Controls')} noDivider={!rightExtraSlot}>
              <button
                type="button"
                className="wb-icon-btn"
                onClick={onUndo}
                disabled={!canUndo}
                title={t('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')}
                aria-label={t('실행 취소', 'Undo')}
                style={{ fontSize: 14, fontWeight: 700 }}
              >
                ↩
              </button>
              <button
                type="button"
                className="wb-icon-btn"
                onClick={onRedo}
                disabled={!canRedo}
                title={t('다시 실행 (Ctrl+Y)', 'Redo (Ctrl+Y)')}
                aria-label={t('다시 실행', 'Redo')}
                style={{ fontSize: 14, fontWeight: 700 }}
              >
                ↪
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onFitView}
                title={t('도면 전체 맞춤', 'Fit Flowsheet to View')}
              >
                {t('전체 맞춤', 'Fit')}
              </button>
              {onExportPfdPng && (
                <button
                  type="button"
                  className="wb-cmd-btn"
                  onClick={onExportPfdPng}
                  title={t('현재 PFD 도면을 고해상도 이미지(PNG)로 저장', 'Export current PFD canvas as PNG image')}
                >
                  {t('PFD 저장', 'Export PFD')}
                </button>
              )}
              {hasMultipleSheets && onToggleBoundarySync && (
                <label
                  style={{
                    height: 26,
                    padding: '0 7px',
                    borderRadius: 4,
                    border: '1px solid #E2E8F0',
                    backgroundColor: boundarySyncEnabled ? '#EFF6FF' : '#FFFFFF',
                    color: boundarySyncEnabled ? '#1E3A8A' : '#334155',
                    fontSize: 11,
                    fontWeight: boundarySyncEnabled ? 700 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={boundarySyncEnabled}
                    onChange={onToggleBoundarySync}
                    style={{ width: 12, height: 12, accentColor: '#1E3A8A', cursor: 'pointer', margin: 0 }}
                  />
                  <span>{t('상하위 연동', 'Sync')}</span>
                </label>
              )}
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onResetOrClear}
                title={isPlantSimMode ? t('초기값 복원', 'Restore Defaults') : t('캔버스 초기화', 'Clear Canvas')}
              >
                {isPlantSimMode ? t('초기값 복원', 'Restore') : t('초기화', 'Clear')}
              </button>
            </RibbonGroup>
          </>
        )}

        {/* TAB 2: DESIGN & ECONOMICS — 장치설계 + 경제성 통합 (중복 제거) */}
        {activeTab === 'design_econ' && (
          <>
            <RibbonGroup
              label={t('범용 상세 설계 · 경제성', 'Equipment Sizing & Economics')}
              noDivider={!plantCustomDesign && !rightExtraSlot}
            >
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=equip')}
              >
                {t('장치목록 · 데이터시트 · CAPEX', 'Equipment List · Datasheets · CAPEX')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=chempro')}
              >
                {t('열교환기 (TEMA/판형)', 'Heat Exchanger (TEMA/Plate)')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=compressor')}
              >
                {t('압축기 상세설계', 'Compressor Design')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=psv_flare')}
              >
                {t('PSV · 플레어 안전설계', 'PSV & Flare Safety')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/process-economics')}
              >
                {t('원단위 · 경제성 분석 (OPEX)', 'Unit & Economic Analysis (OPEX)')}
              </button>
            </RibbonGroup>

            {plantCustomDesign && (
              <RibbonGroup
                label={t('공장 맞춤 장치', 'Plant-Specific Design')}
                noDivider={!rightExtraSlot}
              >
                <button
                  type="button"
                  className="wb-cmd-btn"
                  onClick={() => onNavigateRoute(plantCustomDesign.href)}
                  style={{
                    color: '#1E3A8A',
                    borderColor: '#BFDBFE',
                    backgroundColor: '#EFF6FF',
                    fontWeight: 700,
                  }}
                >
                  {isEn ? plantCustomDesign.labelEn : plantCustomDesign.labelKo}
                </button>
              </RibbonGroup>
            )}
          </>
        )}

        {/* TAB 3: SETTINGS — 성분·열역학 + 단위계 + 태그 표준 + 화면 테마 통합 */}
        {activeTab === 'settings' && (
          <>
            <RibbonGroup label={t('성분 · 열역학', 'Components & Thermo')}>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onOpenCompSetup}
                title={t('열역학 모델 및 성분 설정', 'Thermodynamics & Component Setup')}
              >
                <span>
                  {isEn
                    ? `Thermo · Comps (${activeCompCount})`
                    : `열역학 · 성분 (${activeCompCount}종)`}
                </span>
                <span
                  onClick={(e) => {
                    if (onOpenPropertyMethod) {
                      e.stopPropagation();
                      onOpenPropertyMethod();
                    }
                  }}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#1E3A8A',
                    backgroundColor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  }}
                >
                  {propertyMethod}
                </span>
              </button>
            </RibbonGroup>

            <RibbonGroup label={t('단위계', 'Unit System')}>
              <div className="wb-seg-wrap" role="group" aria-label={t('단위계 프리셋', 'Unit System Preset')}>
                {UNIT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`wb-seg-btn${unitPresetId === p.id ? ' active' : ''}`}
                    onClick={() => applyUnitPreset(p.id)}
                    title={p.desc}
                  >
                    {p.shortName}
                  </button>
                ))}
              </div>
            </RibbonGroup>

            <RibbonGroup label={t('장치 태그 표준', 'Tag Standard')}>
              <div className="wb-seg-wrap" role="group" aria-label={t('장치 태그 표준', 'Equipment Tag Standard')}>
                <button
                  type="button"
                  className={`wb-seg-btn${tagStandard === 'KR_JP' ? ' active' : ''}`}
                  onClick={() => setTagStandard('KR_JP')}
                >
                  {t('한국·일본 EPC', 'KR·JP EPC')}
                </button>
                <button
                  type="button"
                  className={`wb-seg-btn${tagStandard === 'GLOBAL_US' ? ' active' : ''}`}
                  onClick={() => setTagStandard('GLOBAL_US')}
                >
                  {t('미국·글로벌 EPC', 'US·Global EPC')}
                </button>
              </div>
            </RibbonGroup>

            <RibbonGroup label={t('데이터시트 프로젝트 정보', 'Datasheet Project Info')} noDivider={!rightExtraSlot}>
              <input
                type="text"
                value={projMeta.projectName}
                onChange={e => updateProjMeta({ projectName: e.target.value })}
                placeholder={t('프로젝트명', 'Project Name')}
                style={{
                  height: 24,
                  width: 118,
                  padding: '0 6px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#0F172A',
                }}
              />
              <input
                type="text"
                value={projMeta.rev}
                onChange={e => updateProjMeta({ rev: e.target.value })}
                placeholder="Rev.0"
                style={{
                  height: 24,
                  width: 52,
                  padding: '0 5px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#0F172A',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              />
              <input
                type="text"
                value={projMeta.engineer}
                onChange={e => updateProjMeta({ engineer: e.target.value })}
                placeholder={t('작성자', 'Engineer')}
                style={{
                  height: 24,
                  width: 78,
                  padding: '0 6px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#0F172A',
                }}
              />
            </RibbonGroup>
          </>
        )}

        {/* Optional right extra slot */}
        {rightExtraSlot && (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              paddingLeft: 8,
              paddingRight: 4,
              flexShrink: 0,
            }}
          >
            {rightExtraSlot}
          </div>
        )}
      </div>
    </div>
  );
}

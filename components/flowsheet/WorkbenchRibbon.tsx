'use client';

import React, { useEffect, useState } from 'react';

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
  onOpenComponentRequest?: () => void;
  onNavigateRoute: (href: string) => void;
  onSwitchClassicUi?: () => void;
  // Optional extra slot (e.g. convergence diagnostics popover or admin preset selector)
  plantCustomDesign?: { labelKo: string; labelEn: string; href: string } | null;
  rightExtraSlot?: React.ReactNode;
}

type RibbonTabId = 'home' | 'equipment' | 'economics' | 'properties' | 'view';

const RIBBON_TABS: Array<{ id: RibbonTabId; ko: string; en: string }> = [
  { id: 'home', ko: '홈', en: 'Home' },
  { id: 'equipment', ko: '장치설계', en: 'Equipment' },
  { id: 'economics', ko: '경제성', en: 'Economics' },
  { id: 'properties', ko: '물성 · DB', en: 'Properties & DB' },
  { id: 'view', ko: '보기', en: 'View' },
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetOrClear,
  boundarySyncEnabled = false,
  onToggleBoundarySync,
  onOpenCaseMenu,
  onSaveCase,
  onOpenComponentRequest,
  onNavigateRoute,
  onSwitchClassicUi,
  plantCustomDesign,
  rightExtraSlot,
}: WorkbenchRibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTabId>('home');
  const [wbTheme, setWbTheme] = useState<'light' | 'dark'>('light');
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
            gap: 6,
            flexShrink: 0,
          }}
        >
          {activeSheetTitle && (
            <span
              title={activeSheetTitle}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                borderRadius: 3,
                padding: '1px 7px',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeSheetTitle}
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

            <RibbonGroup label={t('실행', 'Run')}>
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
            </RibbonGroup>

            <RibbonGroup label={t('설정', 'Setup')}>
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
                <button
                  type="button"
                  className={`wb-seg-btn${layoutMode === 'table' ? ' active' : ''}`}
                  onClick={() => onChangeLayoutMode('table')}
                >
                  {t('스트림 전체', 'Streams')}
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
            </RibbonGroup>

            <RibbonGroup label={t('편집', 'Edit')} noDivider={!rightExtraSlot}>
              <button
                type="button"
                className="wb-icon-btn"
                onClick={onUndo}
                disabled={!canUndo}
                title={t('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')}
                aria-label={t('실행 취소', 'Undo')}
              >
                ↶
              </button>
              <button
                type="button"
                className="wb-icon-btn"
                onClick={onRedo}
                disabled={!canRedo}
                title={t('다시 실행 (Ctrl+Y)', 'Redo (Ctrl+Y)')}
                aria-label={t('다시 실행', 'Redo')}
              >
                ↷
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onFitView}
                title={t('도면 전체 맞춤', 'Fit Flowsheet to View')}
              >
                {t('전체 맞춤', 'Fit')}
              </button>
            </RibbonGroup>
          </>
        )}

        {/* TAB 2: EQUIPMENT — 범용 장치 설계 vs 공장 맞춤 장치 명확 분리 */}
        {activeTab === 'equipment' && (
          <>
            <RibbonGroup
              label={t('범용 장치 설계', 'General Equipment Sizing')}
              noDivider={!plantCustomDesign && !rightExtraSlot}
            >
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
                onClick={() => onNavigateRoute('/unit-equipment')}
              >
                {t('범용 6종 숏컷', '6-Unit Shortcuts')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=compressor')}
              >
                {t('압축기 설계', 'Compressor')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=psv_flare')}
              >
                {t('PSV·플레어', 'PSV & Flare')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/equipment-design?tab=equip')}
              >
                {t('장치목록', 'Equipment List')}
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

        {/* TAB 3: ECONOMICS */}
        {activeTab === 'economics' && (
          <RibbonGroup label={t('공정 경제성 · 원가', 'Process Economics & Costing')} noDivider={!rightExtraSlot}>
            <button
              type="button"
              className="wb-cmd-btn"
              onClick={() => onNavigateRoute('/economics-handbook')}
            >
              {t('104종 공정경제성 핸드북', '104-Process Economics Handbook')}
            </button>
            <button
              type="button"
              className="wb-cmd-btn"
              onClick={() => onNavigateRoute('/process-economics')}
            >
              {t('원단위 · 경제성 분석', 'Unit & Economic Analysis')}
            </button>
            <button
              type="button"
              className="wb-cmd-btn"
              onClick={() => onNavigateRoute('/unit-equipment')}
            >
              {t('장치 CAPEX/OPEX', 'Equipment CAPEX/OPEX')}
            </button>
          </RibbonGroup>
        )}

        {/* TAB 4: PROPERTIES & DB */}
        {activeTab === 'properties' && (
          <>
            <RibbonGroup label={t('열역학 · 성분', 'Thermo & Comps')}>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onOpenCompSetup}
              >
                <span>{t('열역학 · 성분 설정', 'Thermo & Component Setup')}</span>
                <span
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
                  {propertyMethod} · {activeCompCount}
                </span>
              </button>
              {onOpenPropertyMethod && (
                <button
                  type="button"
                  className="wb-cmd-btn"
                  onClick={onOpenPropertyMethod}
                >
                  {t('열역학 모델 변경', 'Property Method')}
                </button>
              )}
            </RibbonGroup>

            <RibbonGroup label={t('물성 DB', 'Property DB')} noDivider={!rightExtraSlot}>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={() => onNavigateRoute('/property-db')}
              >
                {t('물성 DB 조회', 'Property DB Lookup')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={handleRequestComponent}
                style={{
                  color: '#1E3A8A',
                  borderColor: '#BFDBFE',
                  backgroundColor: '#EFF6FF',
                  fontWeight: 600,
                }}
              >
                {t('물질등록 요청', 'Request Component')}
              </button>
            </RibbonGroup>
          </>
        )}

        {/* TAB 5: VIEW & TOOLS */}
        {activeTab === 'view' && (
          <>
            <RibbonGroup label={t('화면 제어', 'Viewport')}>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onFitView}
              >
                {t('전체 맞춤 (Fit View)', 'Fit View')}
              </button>
              <button
                type="button"
                className={`wb-cmd-btn${layoutMode === 'canvas' ? ' active' : ''}`}
                onClick={() => onChangeLayoutMode('canvas')}
              >
                {t('도면만 크게', 'Canvas Only')}
              </button>
            </RibbonGroup>

            <RibbonGroup label={t('시트 · 초기화', 'Sheet & Reset')} noDivider={!rightExtraSlot}>
              {hasMultipleSheets && onToggleBoundarySync && (
                <label
                  style={{
                    height: 26,
                    padding: '0 8px',
                    borderRadius: 4,
                    border: '1px solid #E2E8F0',
                    backgroundColor: boundarySyncEnabled ? '#EFF6FF' : '#FFFFFF',
                    color: boundarySyncEnabled ? '#1E3A8A' : '#334155',
                    fontSize: 11.5,
                    fontWeight: boundarySyncEnabled ? 600 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={boundarySyncEnabled}
                    onChange={onToggleBoundarySync}
                    style={{
                      width: 13,
                      height: 13,
                      accentColor: '#1E3A8A',
                      cursor: 'pointer',
                      margin: 0,
                    }}
                  />
                  <span>{t('상하위 연동', 'Boundary Sync')}</span>
                </label>
              )}

              <button
                type="button"
                className="wb-cmd-btn"
                onClick={toggleWbTheme}
                title={t('라이트 / 다크 테마 전환', 'Toggle Light / Dark theme')}
              >
                {wbTheme === 'dark'
                  ? t('☀ 라이트 모드', '☀ Light Mode')
                  : t('🌙 다크 모드', '🌙 Dark Mode')}
              </button>
              <button
                type="button"
                className="wb-cmd-btn"
                onClick={onResetOrClear}
              >
                {isPlantSimMode
                  ? t('초기값 복원', 'Restore Defaults')
                  : t('캔버스 초기화', 'Clear Canvas')}
              </button>
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

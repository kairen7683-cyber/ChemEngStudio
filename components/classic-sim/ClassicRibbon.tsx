'use client';

import {
  FlaskCompIcon,
  SaveArchiveIcon,
  DownloadFileIcon,
  PlusSquareIcon,
  SpecControlIcon,
  FitFrameIcon,
  PlayTriangleIcon,
} from '@/components/ui/EngIcons';

import React from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { formatPlantLabelForUser } from '@/lib/plantRegistry';
import type { ClassicPlantPresetOption } from '@/lib/classicPlantPresets';
import type { SimPropertyMethod } from '@/lib/calculations/componentCatalog';
import type { TearSolverMethod } from '@/lib/calculations/flowsheetSolver';

export type ClassicRibbonTab = 'home' | 'view' | 'flowsheet' | 'convergence';

interface ClassicRibbonProps {
  ribbonTab: ClassicRibbonTab;
  setRibbonTab: (t: ClassicRibbonTab) => void;
  isMobile: boolean;
  showExplorer: boolean;
  setShowExplorer: (v: boolean | ((p: boolean) => boolean)) => void;
  showPalette: boolean;
  setShowPalette: (v: boolean | ((p: boolean) => boolean)) => void;
  showControlPanel: boolean;
  setShowControlPanel: (v: boolean | ((p: boolean) => boolean)) => void;
  showStreamCallouts: boolean;
  setShowStreamCallouts: (v: boolean | ((p: boolean) => boolean)) => void;
  orthogonalEdges: boolean;
  setOrthogonalEdges: (v: boolean | ((p: boolean) => boolean)) => void;
  isSimRunning: boolean;
  onRun: () => void;
  onReset: () => void;
  onNextStep: () => void;
  thermoMethod: SimPropertyMethod;
  onChangeThermo: (m: SimPropertyMethod) => void;
  tearMethod: TearSolverMethod;
  onChangeTearMethod: (t: TearSolverMethod) => void;
  onOpenCompSetup: () => void;
  onOpenOptModal: () => void;
  onFitView: () => void;
  onClearBlank: () => void;
  onOpenSaveBar: () => void;
  onExportJson: () => void;
  onSwitchToModernUi: () => void;
  examples: Array<{ id: string; label: string }>;
  onSelectExample: (id: string) => void;
  plantPresets: ClassicPlantPresetOption[];
  onSelectPlantPreset: (presetKey: string) => void;
}

const RIBBON_BTN: React.CSSProperties = {
  padding: '4px 9px',
  fontSize: 11,
  fontWeight: 700,
  borderRadius: 4,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

export default function ClassicRibbon(props: ClassicRibbonProps) {
  const {
    ribbonTab,
    setRibbonTab,
    isMobile,
    showExplorer,
    setShowExplorer,
    showPalette,
    setShowPalette,
    showControlPanel,
    setShowControlPanel,
    showStreamCallouts,
    setShowStreamCallouts,
    orthogonalEdges,
    setOrthogonalEdges,
    isSimRunning,
    onRun,
    onReset,
    onNextStep,
    thermoMethod,
    onChangeThermo,
    tearMethod,
    onChangeTearMethod,
    onOpenCompSetup,
    onOpenOptModal,
    onFitView,
    onClearBlank,
    onOpenSaveBar,
    onExportJson,
    onSwitchToModernUi,
    examples,
    onSelectExample,
    plantPresets,
    onSelectPlantPreset,
  } = props;

  const { user } = useAuth();

  const groupedPresets: Array<{ group: string; label: string; items: ClassicPlantPresetOption[] }> = [
    { group: 'electrolysis', label: formatPlantLabelForUser('PLANT 01 · 전해공장 (수렴 완료)', user), items: plantPresets.filter(p => p.plantGroup === 'electrolysis') },
    { group: 'hcl1A', label: formatPlantLabelForUser('PLANT 02 · 염산합성/정제 (수렴 완료)', user), items: plantPresets.filter(p => p.plantGroup === 'hcl1A') },
    { group: 'ech', label: formatPlantLabelForUser('PLANT 03 · ECH 공정 (수렴 완료)', user), items: plantPresets.filter(p => p.plantGroup === 'ech') },
    { group: 'cms', label: formatPlantLabelForUser('PLANT 04 · 클로로메탄(CMS) 공정 (수렴 완료)', user), items: plantPresets.filter(p => p.plantGroup === 'cms') },
    { group: 'mdi', label: formatPlantLabelForUser('PLANT 05 · MDI 통합 공정 (수렴 완료)', user), items: plantPresets.filter(p => p.plantGroup === 'mdi') },
  ].filter(g => g.items.length > 0);

  return (
    <div style={{ background: '#F3F4F6', borderBottom: '1px solid #CBD5E1', flexShrink: 0 }}>
      {/* Ribbon Tab Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 10px 0',
          background: '#E5E7EB',
          borderBottom: '1px solid #CBD5E1',
          gap: 8,
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 900,
              color: '#003399',
              padding: '3px 8px 3px 2px',
              letterSpacing: '-0.02em',
              whiteSpace: 'nowrap',
            }}
          >
            CLASSIC DESKTOP SIMULATOR
          </span>
          {(
            [
              { id: 'home', label: 'Home' },
              { id: 'view', label: 'View' },
              { id: 'flowsheet', label: 'Flowsheet' },
              { id: 'convergence', label: 'Convergence' },
            ] as const
          ).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setRibbonTab(t.id)}
              style={{
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: ribbonTab === t.id ? 800 : 600,
                border: ribbonTab === t.id ? '1px solid #CBD5E1' : '1px solid transparent',
                borderBottom: ribbonTab === t.id ? '1px solid #F3F4F6' : 'none',
                borderRadius: '4px 4px 0 0',
                background: ribbonTab === t.id ? '#F3F4F6' : 'transparent',
                color: ribbonTab === t.id ? '#003399' : '#334155',
                cursor: 'pointer',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onSwitchToModernUi}
          title="현재 플로우시트·성분·열역학 모델 상태를 유지하며 모던 웹 UI로 전환합니다"
          style={{
            padding: '2.5px 9px',
            fontSize: 10.5,
            fontWeight: 800,
            borderRadius: 4,
            border: '1px solid #1D4ED8',
            background: '#FFFFFF',
            color: '#1D4ED8',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          모던 UI로 전환 ↗
        </button>
      </div>

      {/* Ribbon Command Bar */}
      <div
        className="no-scrollbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          overflowX: 'auto',
          background: '#F3F4F6',
        }}
      >
        {ribbonTab === 'home' && (
          <>
            <button
              type="button"
              onClick={onRun}
              disabled={isSimRunning}
              style={{
                padding: '4px 12px',
                fontSize: 11.2,
                fontWeight: 900,
                borderRadius: 4,
                border: '1px solid #0369A1',
                background: isSimRunning ? '#64748B' : '#0284C7',
                color: '#FFFFFF',
                cursor: isSimRunning ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <PlayTriangleIcon size={11} />
                {isSimRunning ? 'Running...' : 'Run (F5)'}
              </span>
            </button>

            <button
              type="button"
              onClick={onNextStep}
              title="Next Input Check (누락되거나 미완료된 입력 폼으로 즉시 포커스 이동)"
              style={{ ...RIBBON_BTN, borderColor: '#003399', color: '#003399' }}
            >
              N→ Next
            </button>

            <button type="button" onClick={onReset} style={RIBBON_BTN} title="계산 결과를 Idle 상태로 초기화">
              ↺ Reset
            </button>

            <span style={{ width: 1, height: 18, background: '#CBD5E1', flexShrink: 0 }} />

            <button type="button" onClick={onOpenCompSetup} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <FlaskCompIcon size={13} /> Components
            </button>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
              Method:
              <select
                value={thermoMethod}
                onChange={e => onChangeThermo(e.target.value as SimPropertyMethod)}
                style={{
                  height: 24,
                  padding: '0 6px',
                  fontSize: 10.8,
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                }}
              >
                <option value="AUTO">AUTO (Recommend)</option>
                <option value="ENRTL">ELECNRTL (Electrolyte)</option>
                <option value="NRTL">NRTL (Activity)</option>
                <option value="PR">PENG-ROB (EOS)</option>
                <option value="SRK">RK-SOAVE (EOS)</option>
              </select>
            </label>

            <span style={{ width: 1, height: 18, background: '#CBD5E1', flexShrink: 0 }} />

            {groupedPresets.length > 0 && (
              <select
                defaultValue=""
                onChange={e => {
                  if (e.target.value) onSelectPlantPreset(e.target.value);
                  e.target.value = '';
                }}
                style={{
                  height: 25,
                  padding: '0 7px',
                  fontSize: 10.8,
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid #93C5FD',
                  background: '#EFF6FF',
                  color: '#1E3A8A',
                  maxWidth: 230,
                  cursor: 'pointer',
                }}
              >
                <option value="" disabled>
                  예제 공정 수렴 케이스 불러오기...
                </option>
                {groupedPresets.map(g => (
                  <optgroup key={g.group} label={g.label}>
                    {g.items.map(it => (
                      <option key={it.presetKey} value={it.presetKey}>
                        {it.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            <select
              defaultValue=""
              onChange={e => {
                if (e.target.value) onSelectExample(e.target.value);
                e.target.value = '';
              }}
              style={{
                height: 25,
                padding: '0 7px',
                fontSize: 10.8,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                maxWidth: 165,
                cursor: 'pointer',
              }}
            >
              <option value="" disabled>
                기초 예제...
              </option>
              {examples.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>
          </>
        )}

        {ribbonTab === 'view' && (
          <>
            {!isMobile && (
              <button
                type="button"
                onClick={() => setShowExplorer(v => !v)}
                style={{
                  ...RIBBON_BTN,
                  background: showExplorer ? '#DBEAFE' : '#FFFFFF',
                  borderColor: showExplorer ? '#1D4ED8' : '#CBD5E1',
                }}
              >
                {showExplorer ? '☑' : '☐'} Navigation Pane
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowPalette(v => !v)}
              style={{
                ...RIBBON_BTN,
                background: showPalette ? '#DBEAFE' : '#FFFFFF',
                borderColor: showPalette ? '#1D4ED8' : '#CBD5E1',
              }}
            >
              {showPalette ? '☑' : '☐'} Model Palette
            </button>
            <button
              type="button"
              onClick={() => setShowControlPanel(v => !v)}
              style={{
                ...RIBBON_BTN,
                background: showControlPanel ? '#DBEAFE' : '#FFFFFF',
                borderColor: showControlPanel ? '#1D4ED8' : '#CBD5E1',
              }}
            >
              {showControlPanel ? '☑' : '☐'} Control Panel
            </button>
            <span style={{ width: 1, height: 18, background: '#CBD5E1', flexShrink: 0 }} />
            <button
              type="button"
              onClick={() => setShowStreamCallouts(v => !v)}
              style={{
                ...RIBBON_BTN,
                background: showStreamCallouts ? '#DBEAFE' : '#FFFFFF',
                borderColor: showStreamCallouts ? '#1D4ED8' : '#CBD5E1',
              }}
            >
              {showStreamCallouts ? '☑' : '☐'} Stream Callouts (T/P/Flow)
            </button>
            <button
              type="button"
              onClick={() => setOrthogonalEdges(v => !v)}
              style={{
                ...RIBBON_BTN,
                background: orthogonalEdges ? '#DBEAFE' : '#FFFFFF',
                borderColor: orthogonalEdges ? '#1D4ED8' : '#CBD5E1',
              }}
            >
              {orthogonalEdges ? '☑' : '☐'} 90° Orthogonal Streams
            </button>
            <button type="button" onClick={onFitView} style={RIBBON_BTN}>
              ⤢ Zoom Fit
            </button>
          </>
        )}

        {ribbonTab === 'flowsheet' && (
          <>
            <button type="button" onClick={onOpenSaveBar} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <SaveArchiveIcon size={13} /> Save Case
            </button>
            <button type="button" onClick={onExportJson} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <DownloadFileIcon size={13} /> Export JSON
            </button>
            <button type="button" onClick={onClearBlank} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <PlusSquareIcon size={13} /> New Blank Flowsheet
            </button>
            <button type="button" onClick={onFitView} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <FitFrameIcon size={13} /> Align / Fit
            </button>
          </>
        )}

        {ribbonTab === 'convergence' && (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.8, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
              Tear Solver:
              <select
                value={tearMethod}
                onChange={e => onChangeTearMethod(e.target.value as TearSolverMethod)}
                style={{
                  height: 24,
                  padding: '0 6px',
                  fontSize: 10.8,
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                }}
              >
                <option value="wegstein">Wegstein (Accelerated)</option>
                <option value="broyden">Broyden Quasi-Newton</option>
                <option value="direct">Direct Substitution</option>
              </select>
            </label>
            <button type="button" onClick={onOpenOptModal} style={{ ...RIBBON_BTN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <SpecControlIcon size={13} /> Design Spec / Sensitivity / Tear Options
            </button>
            <button
              type="button"
              onClick={onRun}
              style={{
                ...RIBBON_BTN,
                background: '#0284C7',
                borderColor: '#0369A1',
                color: '#FFFFFF',
              }}
            >
              ▶ Reinitialize & Run
            </button>
          </>
        )}
      </div>
    </div>
  );
}

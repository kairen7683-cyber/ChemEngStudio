'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBalanceStore, type PlantId } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import {
  PLANT_REGISTRY,
  getPlantRegistryItem,
  isPlantAllowed,
  isSimulatorOnlyUser,
  showPlantNumbersForUser,
  formatPlantCodeAndName,
  type PlantWorkspaceTab,
} from '@/lib/plantRegistry';
import { useUnitStore } from '@/lib/stores/unitStore';
import { t, type AppLang } from '@/lib/i18n/uiText';
import {
  getPreferredSimUiMode,
  setPreferredSimUiMode,
  type SimUiMode,
} from '@/lib/simUiHandoff';
import {
  listAllSavedUserCases,
  deleteSavedUserCase,
  stagePendingCaseLoad,
  setActiveCaseTitle,
  getActiveCaseTitle,
  PROJECTS_UPDATED_EVENT,
  LOAD_SAVED_CASE_EVENT,
  OPEN_SHORTCUT_CALC_EVENT,
  type UnifiedSavedCaseEntry,
} from '@/lib/caseManagerBridge';
import { parseProcessTextFile } from '@/lib/interop/processTextInterop';
import { reportInteropGaps } from '@/lib/auth/authClient';
import { HeaderUserControls } from '@/components/auth/AdminConsoleModal';
import { HeaderUnitSettingsButton } from '@/components/units/UnitControls';
import { useAuth } from '@/components/auth/AuthContext';
import { PwaInstallButton } from '@/components/pwa/PwaRegistrar';
import {
  CalcShortcutIcon,
  DocSheetIcon,
  FlaskCompIcon,
  FolderOpenIcon,
  PfdSchematicIcon,
  PlusSquareIcon,
} from '@/components/ui/EngIcons';
import ValidationReportModal from '@/components/validation/ValidationReportModal';
import FeedbackModal from '@/components/feedback/FeedbackModal';

function formatSavedDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

export default function Header() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { user } = useAuth();

  const [isMobile, setIsMobile] = useState(false);
  const [simUiMode, setSimUiMode] = useState<SimUiMode>('modern');
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [outputsMenuOpen, setOutputsMenuOpen] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [caseMenuPos, setCaseMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 16 });
  const [outputsMenuPos, setOutputsMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 260 });
  const [savedCases, setSavedCases] = useState<UnifiedSavedCaseEntry[]>([]);
  const [activeCaseInfo, setActiveCaseInfo] = useState<{ title: string; plantId: PlantId } | null>(null);

  const caseDropdownRef = useRef<HTMLDivElement | null>(null);
  const caseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const outputsDropdownRef = useRef<HTMLDivElement | null>(null);
  const outputsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);
  const processTextImportRef = useRef<HTMLInputElement | null>(null);

  const {
    activePlantId,
    setActivePlantId,
    hydrateActivePlant,
    lastPlantReturnHref,
    setLastPlantReturnHref,
  } = useBalanceStore();
  const equipSubTab = usePFDStore(s => s.equipSubTab || 'evap');
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);
  const lang = useUnitStore(s => s.lang);
  const setLang = useUnitStore(s => s.setLang);
  const hydrateUnits = useUnitStore(s => s.hydrate);
  const simOnly = isSimulatorOnlyUser(user);

  const refreshCaseState = useCallback(() => {
    setSavedCases(listAllSavedUserCases(pid => isPlantAllowed(pid, user)));
    setActiveCaseInfo(getActiveCaseTitle());
  }, [user]);

  useEffect(() => {
    refreshCaseState();
    if (typeof window === 'undefined') return;
    const onProjectsUpdated = () => refreshCaseState();
    window.addEventListener(PROJECTS_UPDATED_EVENT, onProjectsUpdated);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, onProjectsUpdated);
  }, [refreshCaseState]);

  useEffect(() => {
    if (!caseMenuOpen && !outputsMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (caseMenuOpen && caseDropdownRef.current && !caseDropdownRef.current.contains(target)) {
        setCaseMenuOpen(false);
      }
      if (outputsMenuOpen && outputsDropdownRef.current && !outputsDropdownRef.current.contains(target)) {
        setOutputsMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCaseMenuOpen(false);
        setOutputsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [caseMenuOpen, outputsMenuOpen]);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  // 클라이언트 마운트 시 저장된 활성 공장, 단위/언어 및 선호 시뮬레이터 UI 복원
  useEffect(() => {
    hydrateActivePlant();
    hydrateUnits();
    setSimUiMode(getPreferredSimUiMode());
  }, [hydrateActivePlant, hydrateUnits]);

  // URL로 직접 /flowsheet-simulator 또는 /classic-simulator 진입 시 컨텍스트 동기화
  useEffect(() => {
    if (pathname.startsWith('/flowsheet-simulator')) {
      if (activePlantId !== 'new_builder') setActivePlantId('new_builder');
      setSimUiMode('modern');
      setPreferredSimUiMode('modern');
    } else if (pathname.startsWith('/classic-simulator')) {
      if (activePlantId !== 'classic_sim') setActivePlantId('classic_sim');
      setSimUiMode('classic');
      setPreferredSimUiMode('classic');
    }
  }, [pathname, activePlantId, setActivePlantId]);

  const allowedCommercialPlants = simOnly
    ? []
    : PLANT_REGISTRY.filter(
        p => !p.isSandbox && !p.hiddenFromSelector && isPlantAllowed(p.id, user)
      );

  // 계정에 할당된 공장 목록 기준으로 허용되지 않은 예제 공장에 머무르지 않도록 자동 전환
  useEffect(() => {
    if (!user) return;
    const curMeta = getPlantRegistryItem(activePlantId);
    if (!curMeta.isSandbox && !isPlantAllowed(activePlantId, user)) {
      const firstAllowed = PLANT_REGISTRY.find(
        p => !p.isSandbox && !p.hiddenFromSelector && isPlantAllowed(p.id, user)
      );
      if (firstAllowed) {
        setActivePlantId(firstAllowed.id);
      } else {
        setActivePlantId('new_builder');
      }
    }
  }, [user, activePlantId, setActivePlantId]);

  const plantMeta = getPlantRegistryItem(activePlantId);
  const isSimulatorMode = activePlantId === 'new_builder' || activePlantId === 'classic_sim';
  const isUnitCalcTool = pathname.startsWith('/unit-equipment');
  const isPropDbTool = pathname.startsWith('/property-db');
  const isGlobalToolMode = isUnitCalcTool || isPropDbTool;
  const isSimulatorRoute =
    pathname === '/' ||
    pathname.startsWith('/material-balance') ||
    pathname.startsWith('/flowsheet-simulator') ||
    pathname.startsWith('/classic-simulator');

  const effectiveUi: SimUiMode = pathname.startsWith('/classic-simulator')
    ? 'classic'
    : pathname.startsWith('/flowsheet-simulator') ||
        pathname === '/' ||
        pathname.startsWith('/material-balance')
      ? 'modern'
      : simUiMode;

  const displayCaseTitle =
    activeCaseInfo &&
    (activeCaseInfo.plantId === activePlantId ||
      ((activeCaseInfo.plantId === 'new_builder' || activeCaseInfo.plantId === 'classic_sim') &&
        isSimulatorMode))
      ? activeCaseInfo.title
      : null;

  const caseTriggerLabel =
    isSimulatorMode || simOnly
      ? `${t(lang, 'header_my_cases')} · ${displayCaseTitle || t(lang, 'header_default_workspace')}`
      : `${t(lang, 'header_example_prefix')} ${formatPlantCodeAndName(plantMeta, user)}`;

  const getActiveWorkspaceTabKey = (): PlantWorkspaceTab['key'] => {
    if (pathname.startsWith('/process-economics') || pathname.startsWith('/pep-yearbook')) return 'econ';
    if (pathname.startsWith('/special-process')) return 'design';
    if (pathname.startsWith('/equipment-design')) {
      return equipSubTab === 'equip' ? 'equip' : 'design';
    }
    return 'pfd';
  };
  const currentTabKey = getActiveWorkspaceTabKey();

  const getLocalizedTabLabel = (tab: PlantWorkspaceTab): string => {
    switch (tab.key) {
      case 'pfd':
        return t(lang, 'header_tab_pfd');
      case 'design':
        return t(lang, 'header_tab_design');
      case 'equip':
        return t(lang, 'header_tab_equip');
      case 'econ':
        return t(lang, 'header_tab_econ');
      default:
        return tab.label;
    }
  };

  const handleSelectPlant = (nextId: PlantId) => {
    const nextMeta = getPlantRegistryItem(nextId);
    if (!nextMeta.isSandbox && !isPlantAllowed(nextId, user)) {
      const fallback = allowedCommercialPlants[0];
      if (fallback) {
        setActivePlantId(fallback.id);
        router.push(fallback.defaultHref);
      }
      return;
    }
    setActivePlantId(nextId);

    if (isGlobalToolMode || nextMeta.isSandbox) {
      router.push(nextMeta.defaultHref);
      return;
    }

    const matchingTab = nextMeta.tabs.find(t => t.key === currentTabKey);
    if (matchingTab) {
      if (matchingTab.equipTab) {
        setEquipSubTab(matchingTab.equipTab);
      }
      router.push(matchingTab.href);
    } else {
      router.push(nextMeta.defaultHref);
    }
  };

  const handleSelectSimUiMode = (targetUi: SimUiMode) => {
    setPreferredSimUiMode(targetUi);
    setSimUiMode(targetUi);
    const onSimulatorPage =
      pathname.startsWith('/flowsheet-simulator') ||
      pathname.startsWith('/classic-simulator') ||
      pathname === '/' ||
      pathname.startsWith('/material-balance');
    if (onSimulatorPage && typeof window !== 'undefined') {
      const currentUi: SimUiMode = pathname.startsWith('/classic-simulator') ? 'classic' : 'modern';
      if (currentUi === targetUi) return;
      window.dispatchEvent(
        new CustomEvent('chemplant:request-ui-switch', { detail: { targetUi } })
      );
      return;
    }
    handleSelectPlant(targetUi === 'classic' ? 'classic_sim' : 'new_builder');
  };

  const handleOpenDefaultWorkspace = () => {
    const targetId: PlantId = simUiMode === 'classic' ? 'classic_sim' : 'new_builder';
    setCaseMenuOpen(false);
    setActiveCaseTitle(null, targetId);
    setActivePlantId(targetId);
    router.push(targetId === 'classic_sim' ? '/classic-simulator' : '/flowsheet-simulator');
  };

  const handleStartNewBlankCase = () => {
    const targetPlantId: PlantId = simUiMode === 'classic' ? 'classic_sim' : 'new_builder';
    setCaseMenuOpen(false);
    setActiveCaseTitle(null, targetPlantId);
    stagePendingCaseLoad({
      action: 'new_blank',
      targetPlantId,
      uiMode: simUiMode,
    });
    setActivePlantId(targetPlantId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
    }
    router.push(simUiMode === 'classic' ? '/classic-simulator' : '/flowsheet-simulator');
  };

  const handleOpenSavedCase = (item: UnifiedSavedCaseEntry) => {
    setCaseMenuOpen(false);
    setActiveCaseTitle(item.name, item.targetPlantId);
    stagePendingCaseLoad({
      action: 'load_project',
      targetPlantId: item.targetPlantId,
      uiMode: item.uiMode,
      caseName: item.name,
      rawProject: item.rawProject,
    });
    setActivePlantId(item.targetPlantId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
    }
    router.push(
      item.uiMode === 'classic'
        ? '/classic-simulator'
        : item.targetPlantId === 'new_builder'
          ? '/flowsheet-simulator'
          : '/material-balance'
    );
  };

  const handleSelectExamplePlant = (plantId: PlantId) => {
    if (!isPlantAllowed(plantId, user)) return;
    setCaseMenuOpen(false);
    setActiveCaseTitle(null, plantId);
    setActivePlantId(plantId);
    router.push('/material-balance');
  };

  const handleImportJsonCase = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const actualState = parsed?.state ?? parsed;
        if (
          !actualState ||
          !Array.isArray(actualState.simDefs) ||
          !Array.isArray(actualState.flowEdges)
        ) {
          alert(t(lang, 'header_json_invalid'));
          return;
        }
        const baseName = file.name.replace(/\.json$/i, '') || t(lang, 'header_json_default_name');
        const targetPlantId: PlantId = simUiMode === 'classic' ? 'classic_sim' : 'new_builder';
        setCaseMenuOpen(false);
        setActiveCaseTitle(baseName, targetPlantId);
        stagePendingCaseLoad({
          action: 'load_project',
          targetPlantId,
          uiMode: simUiMode,
          caseName: baseName,
          rawProject: {
            id: `import_${Date.now()}`,
            name: baseName,
            savedAt: new Date().toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { hour12: false }),
            state: actualState,
          },
        });
        setActivePlantId(targetPlantId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
        }
        router.push(simUiMode === 'classic' ? '/classic-simulator' : '/flowsheet-simulator');
      } catch {
        alert(t(lang, 'header_json_parse_error'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportProcessTextCase = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rawText = String(reader.result ?? '');
        const res = parseProcessTextFile(rawText, file.name);
        const importedDefs = Array.isArray(res.defs) ? res.defs : Object.values(res.defs ?? {});

        // Privacy-safe automatic interop gap reporting (no filenames or confidential tags)
        const unmapped_components = res.summary?.unmappedComps ?? [];
        const unsupportedBlocksSet = new Set<string>();
        let portConnWarnCount = 0;
        for (const w of res.warnings ?? []) {
          if (w.includes('대체 매핑')) {
            const m = w.match(/장치\s*유형\s*'([^']+)'/);
            unsupportedBlocksSet.add(m?.[1] ? m[1].trim() : 'unknown_block_fallback');
          } else if (w.includes('지원되지 않는')) {
            const mThermo = w.match(/열역학\s*모델\s*'([^']+)'/);
            if (mThermo?.[1]) {
              unsupportedBlocksSet.add(`thermo:${mThermo[1].trim()}`);
            } else {
              const mAny = w.match(/'([^']+)'/);
              unsupportedBlocksSet.add(mAny?.[1] ? mAny[1].trim() : 'unsupported_feature');
            }
          }
          if (/포트|연결|port|connect/i.test(w)) {
            portConnWarnCount += 1;
          }
        }
        const unsupported_blocks = Array.from(unsupportedBlocksSet);

        const connectedIds = new Set<string>();
        for (const edge of res.edges ?? []) {
          if (edge.source) connectedIds.add(edge.source);
          if (edge.target) connectedIds.add(edge.target);
        }
        const isolatedBlocks = importedDefs.filter(
          def => def.unitType !== 'feed' && def.unitType !== 'product' && !connectedIds.has(def.id)
        );
        const connectionWarningsSet = new Set<string>();
        for (const blk of isolatedBlocks) {
          connectionWarningsSet.add(`isolated_block:${blk.unitType}`);
        }
        if (isolatedBlocks.length > 0) {
          connectionWarningsSet.add(`missing_connections:${isolatedBlocks.length}`);
        }
        if (portConnWarnCount > 0) {
          connectionWarningsSet.add(`port_connection_warnings:${portConnWarnCount}`);
        }
        const connection_warnings = Array.from(connectionWarningsSet);

        if (
          unmapped_components.length > 0 ||
          unsupported_blocks.length > 0 ||
          connection_warnings.length > 0
        ) {
          void reportInteropGaps({
            source_type: file.name.toLowerCase().endsWith('.bkp') ? 'bkp' : 'inp',
            unmapped_components,
            unsupported_blocks,
            connection_warnings,
          });
        }
        if (importedDefs.length === 0) {
          alert(
            lang === 'en'
              ? `No valid process blocks found in "${file.name}".`
              : `"${file.name}" 파일에서 불러올 수 있는 공정 장치 블록을 찾지 못했습니다.`
          );
          return;
        }
        const positions: Record<string, { x: number; y: number }> = {};
        (res.rfNodes ?? []).forEach((n, idx) => {
          if (n?.id && n.position) {
            positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          } else if (importedDefs[idx]) {
            positions[importedDefs[idx].id] = { x: 80 + idx * 180, y: 120 };
          }
        });
        const baseName =
          (res.title || file.name.replace(/\.(bkp|inp|txt)$/i, '') || 'imported_process').trim();
        const targetPlantId: PlantId = simUiMode === 'classic' ? 'classic_sim' : 'new_builder';
        const actualState = {
          simDefs: importedDefs,
          flowEdges: res.edges,
          positions,
          activeComponents: res.activeComponents,
          propertyMethod: res.propertyMethod,
          thermoMethod: res.propertyMethod,
          presetId: 'custom',
        };
        setCaseMenuOpen(false);
        setActiveCaseTitle(baseName, targetPlantId);
        stagePendingCaseLoad({
          action: 'load_project',
          targetPlantId,
          uiMode: simUiMode,
          caseName: baseName,
          rawProject: {
            id: `import_inp_${Date.now()}`,
            name: baseName,
            savedAt: new Date().toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { hour12: false }),
            state: actualState,
          },
        });
        setActivePlantId(targetPlantId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
        }
        router.push(simUiMode === 'classic' ? '/classic-simulator' : '/flowsheet-simulator');
        if (res.warnings.length > 0) {
          alert(
            `${baseName}: 장치 ${res.summary.unitCount}개 · 스트림 ${res.summary.edgeCount}개 불러오기 완료\n\n참고:\n- ${res.warnings.slice(0, 4).join('\n- ')}`
          );
        }
      } catch {
        alert(
          lang === 'en'
            ? 'Failed to parse the .bkp/.inp process file.'
            : '.bkp / .inp 공정 파일을 해석하는 중 오류가 발생했습니다.'
        );
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleWorkspaceTabClick = (tab: PlantWorkspaceTab) => {
    setOutputsMenuOpen(false);
    if (tab.equipTab) {
      setEquipSubTab(tab.equipTab);
    }
    router.push(tab.href);
  };

  const handleOpenToolbox = (toolHref: string) => {
    if (!isGlobalToolMode) {
      const curSearch = typeof window !== 'undefined' ? window.location.search : '';
      const returnUrl = pathname === '/' ? plantMeta.defaultHref : `${pathname}${curSearch}`;
      setLastPlantReturnHref(returnUrl);
    }
    router.push(toolHref);
  };

  const handleOpenShortcutCalc = () => {
    if (isSimulatorRoute && typeof window !== 'undefined') {
      const curSearch = window.location.search;
      const returnUrl = pathname === '/' ? plantMeta.defaultHref : `${pathname}${curSearch}`;
      setLastPlantReturnHref(returnUrl);
      window.dispatchEvent(new CustomEvent(OPEN_SHORTCUT_CALC_EVENT));
      return;
    }
    handleOpenToolbox('/unit-equipment');
  };

  const handleReturnToPlant = () => {
    if (activePlantId === 'classic_sim') {
      router.push('/classic-simulator');
      return;
    }
    if (activePlantId === 'new_builder') {
      const validSimReturn =
        lastPlantReturnHref === '/' || lastPlantReturnHref.startsWith('/flowsheet-simulator');
      router.push(validSimReturn ? lastPlantReturnHref : '/flowsheet-simulator');
      return;
    }
    const validExampleReturn =
      lastPlantReturnHref === '/' || lastPlantReturnHref.startsWith('/material-balance');
    router.push(validExampleReturn ? lastPlantReturnHref : '/material-balance');
  };

  const auxPageTitle = isUnitCalcTool
    ? t(lang, 'header_aux_shortcut')
    : isPropDbTool
      ? t(lang, 'header_aux_prop_db')
      : pathname.startsWith('/process-economics') || pathname.startsWith('/pep-yearbook')
        ? t(lang, 'header_aux_econ')
        : pathname.startsWith('/equipment-design')
          ? equipSubTab === 'equip'
            ? t(lang, 'header_aux_equip')
            : equipSubTab === 'psv_flare'
              ? t(lang, 'header_aux_psv_flare')
              : t(lang, 'header_aux_design')
          : t(lang, 'header_aux_default');

  return (
    <header
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: 100,
        background: '#0F172A',
      }}
    >
      {/* ── 1단 글로벌 바: 모노크롬 다크 슬레이트 ── */}
      <div
        className="no-scrollbar"
        style={{
          width: '100%',
          minHeight: 40,
          padding: '4px 12px',
          background: '#0F172A',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {/* 좌측: 로고 + 케이스/예제 선택 + UI 스타일 + 참고/산출물 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => router.push(plantMeta.defaultHref)}
            title={t(lang, 'header_brand_title')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: 'transparent',
              border: 'none',
              padding: '2px 4px 2px 0',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <img
              src="/icon-192-v2.png"
              alt="ChemPlant Studio"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid #334155',
              }}
            />
            {!isMobile && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#F8FAFC',
                  letterSpacing: '-0.3px',
                  whiteSpace: 'nowrap',
                }}
              >
                ChemPlant Studio
              </span>
            )}
          </button>

          {isMobile && <PwaInstallButton variant="header" />}

          {!isMobile && (
            <>
              <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: '#94A3B8',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t(lang, 'header_case_label')}
              </span>
            </>
          )}

          {/* 통합 작업 케이스 / 예제 드롭다운 */}
          <div ref={caseDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={caseTriggerRef}
              type="button"
              onClick={() => {
                if (!caseMenuOpen) {
                  refreshCaseState();
                  if (caseTriggerRef.current) {
                    const rect = caseTriggerRef.current.getBoundingClientRect();
                    setCaseMenuPos({
                      top: rect.bottom + 6,
                      left: Math.max(8, Math.min(rect.left, window.innerWidth - 356)),
                    });
                  }
                }
                setOutputsMenuOpen(false);
                setCaseMenuOpen(v => !v);
              }}
              title={
                simOnly
                  ? t(lang, 'header_case_trigger_title_sim_only')
                  : t(lang, 'header_case_trigger_title')
              }
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: caseMenuOpen ? '1px solid #64748B' : '1px solid #334155',
                background: '#1E293B',
                color: '#F8FAFC',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                maxWidth: isMobile ? 200 : 280,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {caseTriggerLabel}
              </span>
              <span style={{ fontSize: 9.5, opacity: 0.75, flexShrink: 0 }}>
                {caseMenuOpen ? '▲' : '▼'}
              </span>
            </button>

            {caseMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: caseMenuPos.top,
                  left: caseMenuPos.left,
                  width: 348,
                  maxHeight: '78vh',
                  overflowY: 'auto',
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 10,
                  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.24)',
                  padding: 8,
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#64748B',
                    padding: '2px 6px',
                    letterSpacing: '0.2px',
                  }}
                >
                  {t(lang, 'header_case_section_my')}
                </div>

                <button
                  type="button"
                  onClick={handleOpenDefaultWorkspace}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: 7,
                    border:
                      isSimulatorMode && !displayCaseTitle
                        ? '1.5px solid #1E3A8A'
                        : '1px solid #E2E8F0',
                    background: isSimulatorMode && !displayCaseTitle ? '#F8FAFC' : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                    color: '#0F172A',
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PfdSchematicIcon size={13} />
                    <span>{t(lang, 'header_case_resume_default')}</span>
                  </span>
                  {isSimulatorMode && !displayCaseTitle && (
                    <span style={{ fontSize: 11, fontWeight: 900, color: '#1E3A8A' }}>✓</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleStartNewBlankCase}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: 7,
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                    color: '#1E293B',
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PlusSquareIcon size={13} />
                    <span>{t(lang, 'header_case_new_blank')}</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => jsonImportRef.current?.click()}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 7,
                    border: '1px dashed #CBD5E1',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                    color: '#334155',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FolderOpenIcon size={13} />
                    <span>{t(lang, 'header_case_import_json')}</span>
                  </span>
                </button>
                <input
                  ref={jsonImportRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonCase}
                  style={{ display: 'none' }}
                />

                <button
                  type="button"
                  onClick={() => processTextImportRef.current?.click()}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 7,
                    border: '1px dashed #93C5FD',
                    background: '#F8FAFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                    color: '#1D4ED8',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FolderOpenIcon size={13} />
                    <span>
                      {lang === 'en'
                        ? 'Import .bkp / .inp Process File...'
                        : '.bkp / .inp 공정 파일 불러오기...'}
                    </span>
                  </span>
                </button>
                <input
                  ref={processTextImportRef}
                  type="file"
                  accept=".bkp,.inp,.txt"
                  onChange={handleImportProcessTextCase}
                  style={{ display: 'none' }}
                />

                {savedCases.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    {savedCases.map(item => {
                      const isActive =
                        displayCaseTitle === item.name && item.targetPlantId === activePlantId;
                      const dateStr = formatSavedDate(item.savedAt);
                      return (
                        <div
                          key={item.uid}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            borderRadius: 7,
                            border: isActive ? '1.5px solid #1E3A8A' : '1px solid transparent',
                            background: isActive ? '#F8FAFC' : '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenSavedCase(item)}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: '2px 4px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              textAlign: 'left',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: isActive ? 800 : 700,
                                  color: '#0F172A',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.name}
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  marginTop: 2,
                                  fontSize: 9.8,
                                  color: '#64748B',
                                  fontWeight: 600,
                                }}
                              >
                                <span
                                  style={{
                                    padding: '0.5px 5px',
                                    borderRadius: 4,
                                    background: '#F1F5F9',
                                    border: '1px solid #CBD5E1',
                                    color: '#334155',
                                    fontWeight: 700,
                                  }}
                                >
                                  {item.scopeLabel}
                                </span>
                                <span>
                                  {lang === 'en' ? `${item.nodeCount} units` : `장치 ${item.nodeCount}개`}
                                </span>
                                {dateStr ? <span>· {dateStr}</span> : null}
                              </div>
                            </div>
                            {isActive && (
                              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#1E3A8A', flexShrink: 0 }}>
                                ✓
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            title={t(lang, 'header_case_delete_title')}
                            onClick={e => {
                              e.stopPropagation();
                              deleteSavedUserCase(item);
                              refreshCaseState();
                            }}
                            style={{
                              padding: '4px 6px',
                              borderRadius: 5,
                              border: 'none',
                              background: 'transparent',
                              color: '#94A3B8',
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '6px 8px', fontSize: 10.5, color: '#94A3B8' }}>
                    {t(lang, 'header_case_empty')}
                  </div>
                )}

                {!simOnly && allowedCommercialPlants.length > 0 && (
                  <>
                    <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: '#64748B',
                        padding: '2px 6px',
                        letterSpacing: '0.2px',
                      }}
                    >
                      {t(lang, 'header_case_section_examples')} ({allowedCommercialPlants.length})
                    </div>
                    {allowedCommercialPlants.map(p => {
                      const selected = !isSimulatorMode && p.id === activePlantId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectExamplePlant(p.id)}
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            borderRadius: 7,
                            border: selected ? '1.5px solid #1E3A8A' : '1px solid transparent',
                            background: selected ? '#F8FAFC' : '#FFFFFF',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                            {showPlantNumbersForUser(user) && (
                              <span
                                style={{
                                  fontSize: 9.2,
                                  fontWeight: 800,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: selected ? '#1E3A8A' : '#1E293B',
                                  color: '#FFFFFF',
                                  flexShrink: 0,
                                }}
                              >
                                {p.code}
                              </span>
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 11.8,
                                  fontWeight: selected ? 800 : 700,
                                  color: '#0F172A',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {p.shortLabel}
                              </div>
                              <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 600 }}>
                                {p.capacityBadge}
                              </div>
                            </div>
                          </div>
                          {selected && (
                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#1E3A8A', flexShrink: 0 }}>
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />

          {/* 보기: [모던 UI | 클래식 UI] */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {!isMobile && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: '#94A3B8',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(lang, 'header_view_label')}
              </span>
            )}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: 2,
                gap: 2,
              }}
              title={t(lang, 'header_view_title')}
            >
              <button
                type="button"
                onClick={() => handleSelectSimUiMode('modern')}
                style={{
                  padding: '2.5px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: effectiveUi === 'modern' ? '#1E3A8A' : 'transparent',
                  color: effectiveUi === 'modern' ? '#FFFFFF' : '#94A3B8',
                  fontSize: 10.5,
                  fontWeight: effectiveUi === 'modern' ? 800 : 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(lang, 'header_modern_ui')}
              </button>
              <button
                type="button"
                onClick={() => handleSelectSimUiMode('classic')}
                style={{
                  padding: '2.5px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: effectiveUi === 'classic' ? '#1E3A8A' : 'transparent',
                  color: effectiveUi === 'classic' ? '#FFFFFF' : '#94A3B8',
                  fontSize: 10.5,
                  fontWeight: effectiveUi === 'classic' ? 800 : 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(lang, 'header_classic_ui')}
              </button>
            </div>
          </div>

          {/* 참고 · 산출물 드롭다운 */}
          <div ref={outputsDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={outputsTriggerRef}
              type="button"
              onClick={() => {
                if (!outputsMenuOpen && outputsTriggerRef.current) {
                  const rect = outputsTriggerRef.current.getBoundingClientRect();
                  setOutputsMenuPos({
                    top: rect.bottom + 6,
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
                  });
                }
                setCaseMenuOpen(false);
                setOutputsMenuOpen(v => !v);
              }}
              title={t(lang, 'header_outputs_title')}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                border: outputsMenuOpen ? '1px solid #64748B' : '1px solid #334155',
                background: '#1E293B',
                color: '#E2E8F0',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <DocSheetIcon size={13} />
                <span>{t(lang, 'header_outputs_btn')}</span>
              </span>
              <span style={{ fontSize: 9, opacity: 0.75 }}>{outputsMenuOpen ? '▲' : '▼'}</span>
            </button>

            {outputsMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: outputsMenuPos.top,
                  left: outputsMenuPos.left,
                  width: 256,
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 9,
                  boxShadow: '0 14px 28px rgba(15, 23, 42, 0.22)',
                  padding: 6,
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#64748B',
                    padding: '3px 8px 4px',
                  }}
                >
                  {t(lang, 'header_outputs_heading')}
                </div>
                {plantMeta.tabs.map(tab => {
                  const active =
                    !isGlobalToolMode &&
                    currentTabKey === tab.key &&
                    !(pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare');
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleWorkspaceTabClick(tab)}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        borderRadius: 6,
                        border: active ? '1px solid #1E3A8A' : '1px solid transparent',
                        background: active ? '#F8FAFC' : '#FFFFFF',
                        color: active ? '#1E3A8A' : '#1E293B',
                        fontSize: 11.5,
                        fontWeight: active ? 800 : 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        textAlign: 'left',
                      }}
                    >
                      <span>{getLocalizedTabLabel(tab)}</span>
                      {active && <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setOutputsMenuOpen(false);
                    setEquipSubTab('psv_flare');
                    router.push('/equipment-design?tab=psv_flare');
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border:
                      pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare'
                        ? '1px solid #1E3A8A'
                        : '1px solid transparent',
                    background:
                      pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare'
                        ? '#F8FAFC'
                        : '#FFFFFF',
                    color:
                      pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare'
                        ? '#1E3A8A'
                        : '#1E293B',
                    fontSize: 11.5,
                    fontWeight:
                      pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare'
                        ? 800
                        : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                  }}
                >
                  <span>{t(lang, 'header_psv_flare')}</span>
                  {pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare' && (
                    <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>
                  )}
                </button>
                <div
                  style={{
                    height: 1,
                    background: '#E2E8F0',
                    margin: '4px 4px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setOutputsMenuOpen(false);
                    setValidationModalOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    textAlign: 'left',
                  }}
                >
                  <DocSheetIcon size={13} />
                  <span>{t(lang, 'header_validation_report')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 우측: 독립 엔지니어링 도구함 & 계정 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            paddingLeft: 8,
          }}
        >
          <button
            type="button"
            onClick={handleOpenShortcutCalc}
            title={t(lang, 'header_shortcut_calc_title')}
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: isUnitCalcTool ? '#1E3A8A' : '#1E293B',
              color: '#F8FAFC',
              fontSize: 10.8,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CalcShortcutIcon size={13} />
            <span>{t(lang, 'header_shortcut_calc')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenToolbox('/property-db')}
            title={t(lang, 'header_prop_db_title')}
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: isPropDbTool ? '#1E3A8A' : '#1E293B',
              color: '#F8FAFC',
              fontSize: 10.8,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <FlaskCompIcon size={13} />
            <span>{t(lang, 'header_prop_db')}</span>
          </button>

          <HeaderUnitSettingsButton isMobile={isMobile} />

          {/* Compact KO | EN Language Toggle Pill */}
          <div
            role="group"
            aria-label="Language Selector"
            title={t(lang, 'header_lang_toggle_title')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#0F172A',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: 2,
              gap: 1,
              flexShrink: 0,
            }}
          >
            {(['ko', 'en'] as AppLang[]).map(code => {
              const active = lang === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: active ? '#1E3A8A' : 'transparent',
                    color: active ? '#FFFFFF' : '#94A3B8',
                    fontSize: 10,
                    fontWeight: active ? 800 : 600,
                    letterSpacing: '0.03em',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {code.toUpperCase()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            title={lang === 'en' ? 'Send beta feedback' : '베타 피드백 접수'}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: '#1E293B',
              color: '#E2E8F0',
              fontSize: 10.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <DocSheetIcon size={12} />
            <span>{lang === 'en' ? 'Feedback' : '피드백'}</span>
          </button>

          <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0, marginLeft: 2 }} />
          <HeaderUserControls />
        </div>
      </div>

      {/* ── 2단 컨텍스트 바: 비-시뮬레이터 보조 화면에서만 슬림 모노크롬 바 표시 ── */}
      {!isSimulatorRoute && (
        <div
          className="no-scrollbar"
          style={{
            width: '100%',
            minHeight: 32,
            padding: '4px 12px',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A' }}>
              {auxPageTitle}
            </span>
            <span style={{ color: '#CBD5E1' }}>·</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>
              {caseTriggerLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={handleReturnToPlant}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#1E293B',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t(lang, 'header_return_to_sim')}
          </button>
        </div>
      )}

      <ValidationReportModal
        open={validationModalOpen}
        onClose={() => setValidationModalOpen(false)}
      />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </header>
  );
}

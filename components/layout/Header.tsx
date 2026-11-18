'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBalanceStore, type PlantId } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import {
  PLANT_REGISTRY,
  getPlantRegistryItem,
  isPlantAllowed,
  type PlantWorkspaceTab,
} from '@/lib/plantRegistry';
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
import { HeaderUserControls } from '@/components/auth/AdminConsoleModal';
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
  const [caseMenuPos, setCaseMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 16 });
  const [outputsMenuPos, setOutputsMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 260 });
  const [savedCases, setSavedCases] = useState<UnifiedSavedCaseEntry[]>([]);
  const [activeCaseInfo, setActiveCaseInfo] = useState<{ title: string; plantId: PlantId } | null>(null);

  const caseDropdownRef = useRef<HTMLDivElement | null>(null);
  const caseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const outputsDropdownRef = useRef<HTMLDivElement | null>(null);
  const outputsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);

  const {
    activePlantId,
    setActivePlantId,
    hydrateActivePlant,
    lastPlantReturnHref,
    setLastPlantReturnHref,
  } = useBalanceStore();
  const equipSubTab = usePFDStore(s => s.equipSubTab || 'evap');
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);

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

  // 클라이언트 마운트 시 저장된 활성 공장 및 선호 시뮬레이터 UI 복원
  useEffect(() => {
    hydrateActivePlant();
    setSimUiMode(getPreferredSimUiMode());
  }, [hydrateActivePlant]);

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

  const allowedCommercialPlants = PLANT_REGISTRY.filter(
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

  const caseTriggerLabel = isSimulatorMode
    ? `내 케이스 · ${displayCaseTitle || '기본 작업공간'}`
    : `[예제] ${plantMeta.code} · ${plantMeta.shortLabel}`;

  const getActiveWorkspaceTabKey = (): PlantWorkspaceTab['key'] => {
    if (pathname.startsWith('/pep-yearbook')) return 'econ';
    if (pathname.startsWith('/special-process')) return 'design';
    if (pathname.startsWith('/equipment-design')) {
      return equipSubTab === 'equip' ? 'equip' : 'design';
    }
    return 'pfd';
  };
  const currentTabKey = getActiveWorkspaceTabKey();

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
          alert('유효한 시뮬레이션 JSON 파일이 아닙니다.');
          return;
        }
        const baseName = file.name.replace(/\.json$/i, '') || '불러온 케이스';
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
            savedAt: new Date().toLocaleString('ko-KR', { hour12: false }),
            state: actualState,
          },
        });
        setActivePlantId(targetPlantId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
        }
        router.push(simUiMode === 'classic' ? '/classic-simulator' : '/flowsheet-simulator');
      } catch {
        alert('JSON 파일을 해석하지 못했습니다.');
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
    ? '단품 숏컷 설계 도구'
    : isPropDbTool
      ? '물성 · 열역학 DB'
      : pathname.startsWith('/pep-yearbook')
        ? '원단위 · 경제성 · 벤치마크'
        : pathname.startsWith('/equipment-design')
          ? equipSubTab === 'equip'
            ? '공장 장치목록'
            : '핵심장치 상세설계'
          : '보조 엔지니어링 도구';

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
            title="시뮬레이터 메인 화면으로 이동"
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
                케이스:
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
              title="작업 케이스 또는 내장 예제 공장 열기"
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
                  내 작업 케이스
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
                    <span>기본 시뮬레이터 작업공간 (이어하기)</span>
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
                    <span>새 빈 케이스로 시작</span>
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
                    <span>JSON 케이스 파일 불러오기...</span>
                  </span>
                </button>
                <input
                  ref={jsonImportRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonCase}
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
                                <span>장치 {item.nodeCount}개</span>
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
                            title="저장 케이스 삭제"
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
                    저장된 사용자 케이스가 없습니다.
                  </div>
                )}

                {allowedCommercialPlants.length > 0 && (
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
                      내장 예제 공장 (참고 케이스) ({allowedCommercialPlants.length})
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
                보기:
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
              title="시뮬레이터 인터페이스 스타일 선택 (모던 UI / 클래식 UI)"
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
                모던 UI
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
                클래식 UI
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
              title="현재 컨텍스트의 참고 자료 및 산출물 화면 이동"
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
                <span>참고 · 산출물</span>
              </span>
              <span style={{ fontSize: 9, opacity: 0.75 }}>{outputsMenuOpen ? '▲' : '▼'}</span>
            </button>

            {outputsMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: outputsMenuPos.top,
                  left: outputsMenuPos.left,
                  width: 244,
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
                  참고 · 산출물 이동
                </div>
                {plantMeta.tabs.map(tab => {
                  const active = !isGlobalToolMode && currentTabKey === tab.key;
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
                      <span>{tab.label}</span>
                      {active && <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
                    </button>
                  );
                })}
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
            title="단품 장치 숏컷 설계 도구 (열교환기·펌프·컬럼·용기·배관·PSV)"
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
            <span>단품 숏컷 계산기</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenToolbox('/property-db')}
            title="열역학 모델 · 순수·혼합물 물성 계산 DB"
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
            <span>물성 · 열역학 DB</span>
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
            ← 시뮬레이터로 복귀
          </button>
        </div>
      )}
    </header>
  );
}

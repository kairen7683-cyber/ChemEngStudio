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
} from '@/lib/plantRegistry';
import { useUnitStore } from '@/lib/stores/unitStore';
import { UNIT_PRESETS } from '@/lib/units/unitSystem';
import { TAG_STANDARDS } from '@/lib/units/tagNaming';
import {
  TAG_STANDARD_TEXT_EN,
  UNIT_PRESET_NAMES_EN,
  t,
  type AppLang,
} from '@/lib/i18n/uiText';
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
  OPEN_SAVE_CASE_EVENT,
  type UnifiedSavedCaseEntry,
} from '@/lib/caseManagerBridge';
import { parseProcessTextFile } from '@/lib/interop/processTextInterop';
import { reportInteropGaps } from '@/lib/auth/authClient';
import { HeaderUserControls } from '@/components/auth/AdminConsoleModal';
import { HeaderUnitSettingsButton } from '@/components/units/UnitControls';
import { useAuth } from '@/components/auth/AuthContext';
import { PUBLIC_MINI_EXAMPLES, type PublicMiniExample } from '@/lib/publicMiniExamples';
import { PwaInstallButton } from '@/components/pwa/PwaRegistrar';
import {
  CalcShortcutIcon,
  DocSheetIcon,
  FlaskCompIcon,
  FolderOpenIcon,
  PfdSchematicIcon,
  PlusSquareIcon,
  SaveArchiveIcon,
  SlidersParamIcon,
  VesselEquipIcon,
} from '@/components/ui/EngIcons';
import ValidationReportModal from '@/components/validation/ValidationReportModal';
import FeedbackModal from '@/components/feedback/FeedbackModal';
import ResolvedFeedbackToast from '@/components/feedback/ResolvedFeedbackToast';
import ComponentRequestModal from '@/components/flowsheet/ComponentRequestModal';

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
  const { user, isGuestDemo, promptGuestAuth } = useAuth();

  const [isMobile, setIsMobile] = useState(false);
  const [simUiMode, setSimUiMode] = useState<SimUiMode>('modern');
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [compReqModalOpen, setCompReqModalOpen] = useState(false);
  const [wbTheme, setWbTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('chemeng_wb_theme_v1');
      if (saved === 'dark' || saved === 'light') {
        setWbTheme(saved);
        document.documentElement.setAttribute('data-wb-theme', saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const applyWbTheme = (next: 'light' | 'dark') => {
    setWbTheme(next);
    try {
      window.localStorage.setItem('chemeng_wb_theme_v1', next);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-wb-theme', next);
    }
  };

  const [caseMenuPos, setCaseMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 16 });
  const [toolsMenuPos, setToolsMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 320 });
  const [settingsMenuPos, setSettingsMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 600 });

  const [savedCases, setSavedCases] = useState<UnifiedSavedCaseEntry[]>([]);
  const [activeCaseInfo, setActiveCaseInfo] = useState<{ title: string; plantId: PlantId } | null>(null);

  const caseDropdownRef = useRef<HTMLDivElement | null>(null);
  const caseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toolsDropdownRef = useRef<HTMLDivElement | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const unifiedImportRef = useRef<HTMLInputElement | null>(null);

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
  const presetId = useUnitStore(s => s.presetId);
  const applyPreset = useUnitStore(s => s.applyPreset);
  const tagStandard = useUnitStore(s => s.tagStandard);
  const setTagStandard = useUnitStore(s => s.setTagStandard);
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
    if (typeof window === 'undefined') return;
    const onOpenCompReq = () => setCompReqModalOpen(true);
    window.addEventListener('chemeng:open-component-request', onOpenCompReq);
    return () => window.removeEventListener('chemeng:open-component-request', onOpenCompReq);
  }, []);

  useEffect(() => {
    if (!caseMenuOpen && !toolsMenuOpen && !settingsMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (caseMenuOpen && caseDropdownRef.current && !caseDropdownRef.current.contains(target)) {
        setCaseMenuOpen(false);
      }
      if (toolsMenuOpen && toolsDropdownRef.current && !toolsDropdownRef.current.contains(target)) {
        setToolsMenuOpen(false);
      }
      if (settingsMenuOpen && settingsDropdownRef.current && !settingsDropdownRef.current.contains(target)) {
        setSettingsMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCaseMenuOpen(false);
        setToolsMenuOpen(false);
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [caseMenuOpen, toolsMenuOpen, settingsMenuOpen]);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  // 클라이언트 마운트 시 저장된 활성 공장, 단위/언어 복원 (통합 단일 UI 사용)
  useEffect(() => {
    hydrateActivePlant();
    hydrateUnits();
    setSimUiMode('modern');
    setPreferredSimUiMode('modern');
  }, [hydrateActivePlant, hydrateUnits]);

  // 리본(WorkbenchRibbon)에서 검증 리포트 모달 호출 시 수신
  useEffect(() => {
    const onOpenVal = () => setValidationModalOpen(true);
    window.addEventListener('chemeng:open-validation-report', onOpenVal);
    return () => window.removeEventListener('chemeng:open-validation-report', onOpenVal);
  }, []);

  // URL로 직접 /flowsheet-simulator 또는 /classic-simulator 진입 시 컨텍스트 동기화
  // 주의: activePlantId를 의존성 배열에 넣으면 시뮬레이터 화면에서 예제 공장 클릭 시
  // pathname 전환 완료 전에 activePlantId가 다시 new_builder/classic_sim으로 덮어쓰이는 버그 발생!
  useEffect(() => {
    const currentPlantId = useBalanceStore.getState().activePlantId;
    if (pathname.startsWith('/flowsheet-simulator')) {
      if (currentPlantId !== 'new_builder') setActivePlantId('new_builder');
      setSimUiMode('modern');
      setPreferredSimUiMode('modern');
    } else if (pathname.startsWith('/classic-simulator')) {
      if (currentPlantId !== 'classic_sim') setActivePlantId('classic_sim');
      setSimUiMode('classic');
      setPreferredSimUiMode('classic');
    }
  }, [pathname, setActivePlantId]);

  const allowedCommercialPlants = simOnly
    ? []
    : PLANT_REGISTRY.filter(
        p => !p.isSandbox && !p.hiddenFromSelector && isPlantAllowed(p.id, user)
      );

  // 계정에 할당된 공장 목록 기준으로 허용되지 않은 예제 공장에 머무르지 않도록 자동 전환
  useEffect(() => {
    if (!user && !isGuestDemo) return;
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
  }, [user, isGuestDemo, activePlantId, setActivePlantId]);

  const plantMeta = getPlantRegistryItem(activePlantId);
  const isSimulatorMode = activePlantId === 'new_builder' || activePlantId === 'classic_sim';
  const isUnitCalcTool = pathname.startsWith('/unit-equipment');
  const isPropDbTool = pathname.startsWith('/property-db');
  const isEconHandbookTool = pathname.startsWith('/economics-handbook');
  const isGlobalToolMode = isUnitCalcTool || isPropDbTool || isEconHandbookTool;
  const isFlowsheetOrClassicRoute =
    pathname.startsWith('/flowsheet-simulator') || pathname.startsWith('/classic-simulator');
  const isSimulatorRoute =
    pathname === '/' ||
    pathname.startsWith('/material-balance') ||
    isFlowsheetOrClassicRoute;

  const showReturnToSimBtn = !isSimulatorRoute;

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

  const activeCasePillText =
    isSimulatorMode || simOnly
      ? displayCaseTitle || t(lang, 'header_default_workspace')
      : formatPlantCodeAndName(plantMeta, user);

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
    router.push(nextMeta.defaultHref);
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
    const targetHref = simUiMode === 'classic' ? '/classic-simulator' : '/flowsheet-simulator';
    const alreadyOnTarget = pathname.startsWith(targetHref);
    setCaseMenuOpen(false);
    setToolsMenuOpen(false);
    setSettingsMenuOpen(false);
    setActiveCaseTitle(null, targetPlantId);
    stagePendingCaseLoad({
      action: 'new_blank',
      targetPlantId,
      uiMode: simUiMode,
    });
    setActivePlantId(targetPlantId);
    if (alreadyOnTarget) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
      }
    } else {
      router.push(targetHref);
    }
  };

  const handleTriggerSaveCase = (mode: 'quick_save' | 'save_as') => {
    setCaseMenuOpen(false);
    setToolsMenuOpen(false);
    setSettingsMenuOpen(false);
    if (isGuestDemo && !user) {
      promptGuestAuth(
        lang === 'en'
          ? 'Sign up for free to save your process cases.'
          : '무료 가입 후 작업 케이스를 저장할 수 있습니다.',
        'register'
      );
      return;
    }
    if (typeof window === 'undefined') return;
    if (isFlowsheetOrClassicRoute) {
      window.dispatchEvent(new CustomEvent(OPEN_SAVE_CASE_EVENT, { detail: { mode } }));
      return;
    }
    const targetHref =
      activePlantId === 'classic_sim' || simUiMode === 'classic'
        ? '/classic-simulator'
        : '/flowsheet-simulator';
    router.push(targetHref);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_SAVE_CASE_EVENT, { detail: { mode } }));
    }, 250);
  };

  const handleOpenSavedCase = (item: UnifiedSavedCaseEntry) => {
    const targetHref =
      item.uiMode === 'classic'
        ? '/classic-simulator'
        : item.targetPlantId === 'new_builder'
          ? '/flowsheet-simulator'
          : '/material-balance';
    const alreadyOnTarget = pathname.startsWith(targetHref);
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
    if (alreadyOnTarget) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
      }
    } else {
      router.push(targetHref);
    }
  };

  const handleSelectExamplePlant = (plantId: PlantId) => {
    if (!isPlantAllowed(plantId, user)) return;
    setCaseMenuOpen(false);
    setActiveCaseTitle(null, plantId);
    setActivePlantId(plantId);
    router.push('/material-balance');
  };

  const handleOpenPublicMiniExample = (ex: PublicMiniExample) => {
    const isClassic = pathname.startsWith('/classic-simulator') || simUiMode === 'classic';
    const targetPlantId: PlantId = isClassic ? 'classic_sim' : 'new_builder';
    const targetHref = isClassic ? '/classic-simulator' : '/flowsheet-simulator';
    const alreadyOnTarget = pathname.startsWith(targetHref);
    const caseName = lang === 'en' ? ex.btnLabelEn : ex.btnLabel;
    const positions: Record<string, { x: number; y: number }> = {};
    const simDefs = ex.nodes.map(({ position, nameEn, ...rest }) => {
      positions[rest.id] = { ...position };
      return {
        ...rest,
        name: lang === 'en' ? (nameEn || rest.name) : rest.name,
        params: { ...rest.params },
      };
    });
    const flowEdges = ex.edges.map(e => ({ ...e }));
    const compSet = new Set<string>();
    simDefs.forEach(d => {
      Object.entries(d.params?.feedFlowsKgH ?? {}).forEach(([k, v]) => {
        if (typeof v === 'number' && v > 0) compSet.add(k);
      });
    });
    const actualState = {
      simDefs,
      flowEdges,
      positions,
      propertyMethod: ex.recommendedMethod ?? 'AUTO',
      activeComponents: Array.from(compSet),
      isSimDirty: true,
    };
    setCaseMenuOpen(false);
    setActiveCaseTitle(caseName, targetPlantId);
    stagePendingCaseLoad({
      action: 'load_project',
      targetPlantId,
      uiMode: isClassic ? 'classic' : 'modern',
      caseName,
      rawProject: {
        id: `public_mini_${ex.id}`,
        name: caseName,
        savedAt: new Date().toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { hour12: false }),
        state: actualState,
      },
    });
    setActivePlantId(targetPlantId);
    if (alreadyOnTarget) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(LOAD_SAVED_CASE_EVENT));
      }
    } else {
      router.push(targetHref);
    }
  };

  const importJsonFile = (file: File) => {
    if (isGuestDemo && !user) {
      promptGuestAuth(
        lang === 'en'
          ? 'Sign up for free to import .json, .bkp, or .inp files.'
          : '무료 가입 후 .json / .bkp / .inp 파일을 불러올 수 있습니다.',
        'register'
      );
      return;
    }
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
  };

  const importProcessTextFile = (file: File) => {
    if (isGuestDemo && !user) {
      promptGuestAuth(
        lang === 'en'
          ? 'Sign up for free to import .json, .bkp, or .inp files.'
          : '무료 가입 후 .json / .bkp / .inp 파일을 불러올 수 있습니다.',
        'register'
      );
      return;
    }
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
            lang === 'en'
              ? `${baseName}: Imported ${res.summary.unitCount} units · ${res.summary.edgeCount} streams\n\nNotes:\n- ${res.warnings.slice(0, 4).join('\n- ')}`
              : `${baseName}: 장치 ${res.summary.unitCount}개 · 스트림 ${res.summary.edgeCount}개 불러오기 완료\n\n참고:\n- ${res.warnings.slice(0, 4).join('\n- ')}`
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
  };

  const processImportedFile = (file: File) => {
    if (file.name.toLowerCase().endsWith('.json')) {
      importJsonFile(file);
    } else {
      importProcessTextFile(file);
    }
  };

  const handleOpenUnifiedFilePicker = async () => {
    if (isGuestDemo && !user) {
      setCaseMenuOpen(false);
      promptGuestAuth(
        lang === 'en'
          ? 'Sign up for free to import .json, .bkp, or .inp files.'
          : '무료 가입 후 .json / .bkp / .inp 파일을 불러올 수 있습니다.',
        'register'
      );
      return;
    }
    type OpenFilePickerFn = (options?: {
      multiple?: boolean;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<Array<{ getFile: () => Promise<File> }>>;

    const picker =
      typeof window !== 'undefined'
        ? (window as Window & { showOpenFilePicker?: OpenFilePickerFn }).showOpenFilePicker
        : undefined;

    if (typeof picker === 'function') {
      try {
        const [handle] = await picker({
          multiple: false,
          types: [
            {
              description:
                lang === 'en'
                  ? 'All Process Files (.json, .bkp, .inp)'
                  : '모든 공정 파일 (.json, .bkp, .inp)',
              accept: { 'application/octet-stream': ['.json', '.bkp', '.inp', '.txt'] },
            },
            {
              description:
                lang === 'en'
                  ? 'ChemPlant JSON Case (.json)'
                  : 'ChemPlant JSON 케이스 (.json)',
              accept: { 'application/json': ['.json'] },
            },
            {
              description:
                lang === 'en'
                  ? 'Process Text / Backup (.bkp, .inp)'
                  : '공정 텍스트 / 백업 파일 (.bkp, .inp)',
              accept: { 'text/plain': ['.bkp', '.inp', '.txt'] },
            },
          ],
        });
        if (handle) {
          const file = await handle.getFile();
          processImportedFile(file);
        }
        return;
      } catch (err: unknown) {
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          (typeof err === 'object' &&
            err !== null &&
            'name' in err &&
            (err as { name?: string }).name === 'AbortError')
        ) {
          return;
        }
        // Fallback to hidden file input if showOpenFilePicker fails in restricted contexts
      }
    }
    unifiedImportRef.current?.click();
  };

  const handleUnifiedFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImportedFile(file);
    }
    e.target.value = '';
  };

  const handleOpenToolbox = (toolHref: string) => {
    setToolsMenuOpen(false);
    if (!isGlobalToolMode) {
      const curSearch = typeof window !== 'undefined' ? window.location.search : '';
      const returnUrl = pathname === '/' ? plantMeta.defaultHref : `${pathname}${curSearch}`;
      setLastPlantReturnHref(returnUrl);
    }
    router.push(toolHref);
  };

  const handleOpenShortcutCalc = () => {
    setToolsMenuOpen(false);
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

  const navBtnStyle: React.CSSProperties = {
    padding: isMobile ? '4px 7px' : '4px 9px',
    borderRadius: 6,
    border: '1px solid #334155',
    background: '#1E293B',
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const isToolsActive =
    isUnitCalcTool ||
    isPropDbTool ||
    isEconHandbookTool ||
    (pathname.startsWith('/equipment-design') &&
      (equipSubTab === 'psv_flare' || equipSubTab === 'compressor'));

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
      {/* ── 단일 데스크톱 스타일 글로벌 메뉴 바 ── */}
      <div
        className="no-scrollbar"
        style={{
          width: '100%',
          minHeight: 42,
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
        {/* ── 좌측: 브랜드 + 빠른 파일 실행(새 공정 · 열기 · 저장 · 새로고침) + 활성 케이스 배지 ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
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

          <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />

          {/* 새 공정 */}
          <button
            type="button"
            onClick={handleStartNewBlankCase}
            title={t(lang, 'header_case_new_blank')}
            style={navBtnStyle}
          >
            <PlusSquareIcon size={13} />
            <span>{lang === 'en' ? 'New' : '새 공정'}</span>
          </button>

          {/* 열기 ▾ (케이스 / 파일 / 예제 드롭다운) */}
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
                setToolsMenuOpen(false);
                setSettingsMenuOpen(false);
                setCaseMenuOpen(v => !v);
              }}
              title={
                simOnly
                  ? t(lang, 'header_case_trigger_title_sim_only')
                  : t(lang, 'header_case_trigger_title')
              }
              style={{
                ...navBtnStyle,
                border: caseMenuOpen ? '1px solid #60A5FA' : '1px solid #334155',
                background: caseMenuOpen ? '#1E3A8A' : '#1E293B',
              }}
            >
              <FolderOpenIcon size={13} />
              <span>{lang === 'en' ? 'Open' : '열기'}</span>
              <span style={{ fontSize: 9, opacity: 0.78 }}>{caseMenuOpen ? '▴' : '▾'}</span>
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
                  onClick={() => void handleOpenUnifiedFilePicker()}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
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
                        ? 'Import File (.json, .bkp, .inp)...'
                        : '파일에서 불러오기 (.json, .bkp, .inp)...'}
                    </span>
                  </span>
                </button>
                <input
                  ref={unifiedImportRef}
                  type="file"
                  accept=".json,.bkp,.inp,.txt"
                  onChange={handleUnifiedFileInputChange}
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

                <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#0F766E',
                    padding: '2px 6px',
                    letterSpacing: '0.2px',
                  }}
                >
                  {lang === 'en'
                    ? `Public Mini Examples (${PUBLIC_MINI_EXAMPLES.length})`
                    : `공개 미니 예제 · 교과서 표준 (${PUBLIC_MINI_EXAMPLES.length})`}
                </div>
                {PUBLIC_MINI_EXAMPLES.map((ex, idx) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => handleOpenPublicMiniExample(ex)}
                    style={{
                      width: '100%',
                      padding: '6px 9px',
                      borderRadius: 7,
                      border: '1px solid transparent',
                      background: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#F0FDFA';
                      e.currentTarget.style.borderColor = '#99F6E4';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#FFFFFF';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: 5,
                        background: '#0F766E',
                        color: '#FFFFFF',
                        flexShrink: 0,
                        letterSpacing: '0.2px',
                      }}
                    >
                      MINI 0{idx + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: '#0F172A',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {(lang === 'en' ? ex.btnLabelEn : ex.btnLabel).replace(/^(미니|Mini)\s*\d+:\s*/i, '')}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: '#64748B',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {lang === 'en'
                          ? `${ex.nodes.length} blocks · ${ex.recommendedMethod ?? 'AUTO'}`
                          : `장치 ${ex.nodes.length}개 · ${ex.recommendedMethod ?? 'AUTO'}`}
                      </div>
                    </div>
                  </button>
                ))}

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

          {/* 저장 */}
          <button
            type="button"
            onClick={() => handleTriggerSaveCase('quick_save')}
            title={lang === 'en' ? 'Quick save current case' : '현재 케이스 바로 저장'}
            style={navBtnStyle}
          >
            <SaveArchiveIcon size={13} />
            <span>{lang === 'en' ? 'Save' : '저장'}</span>
          </button>

          {/* 다른 이름으로 저장 */}
          <button
            type="button"
            onClick={() => handleTriggerSaveCase('save_as')}
            title={lang === 'en' ? 'Save as new name or export file' : '새 이름으로 저장 및 파일 내보내기'}
            style={navBtnStyle}
          >
            <DocSheetIcon size={13} />
            <span>{lang === 'en' ? 'Save As' : isMobile ? '다른이름 저장' : '다른 이름으로 저장'}</span>
          </button>

          {/* 라이브러리 ▾ 전역 통합 드롭다운 (시뮬레이션 독립 백과 · DB · 숏컷 계산기 · 검증) */}
          <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />
          <div ref={toolsDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={toolsTriggerRef}
              type="button"
              onClick={() => {
                if (!toolsMenuOpen && toolsTriggerRef.current) {
                  const rect = toolsTriggerRef.current.getBoundingClientRect();
                  setToolsMenuPos({
                    top: rect.bottom + 6,
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 284)),
                  });
                }
                setCaseMenuOpen(false);
                setSettingsMenuOpen(false);
                setToolsMenuOpen(v => !v);
              }}
              title={lang === 'en' ? 'Reference libraries, Property DB & standalone calculators' : '공정경제성 핸드북 · 물성 DB · 단품 숏컷 계산기'}
              style={{
                ...navBtnStyle,
                border: toolsMenuOpen || isToolsActive ? '1px solid #60A5FA' : '1px solid #334155',
                background: toolsMenuOpen || isToolsActive ? '#1E3A8A' : '#1E293B',
              }}
            >
              <CalcShortcutIcon size={13} />
              <span>{lang === 'en' ? 'Library' : '라이브러리'}</span>
              <span style={{ fontSize: 9, opacity: 0.78 }}>{toolsMenuOpen ? '▴' : '▾'}</span>
            </button>

            {toolsMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: toolsMenuPos.top,
                  left: toolsMenuPos.left,
                  width: 276,
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
                    letterSpacing: '0.2px',
                  }}
                >
                  {lang === 'en' ? 'Reference & Standalone Tools' : '전역 라이브러리 · 독립 계산기'}
                </div>

                <button
                  type="button"
                  onClick={handleOpenShortcutCalc}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: 6,
                    border: isUnitCalcTool ? '1px solid #1E3A8A' : '1px solid transparent',
                    background: isUnitCalcTool ? '#EFF6FF' : '#FFFFFF',
                    color: isUnitCalcTool ? '#1E3A8A' : '#1E293B',
                    fontSize: 11.3,
                    fontWeight: isUnitCalcTool ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <CalcShortcutIcon size={13} />
                    <span>
                      {lang === 'en' ? 'Unit Shortcut Calculators (6)' : '단품 숏컷 계산기 (6종)'}
                    </span>
                  </span>
                  {isUnitCalcTool && <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenToolbox('/property-db')}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: 6,
                    border: isPropDbTool ? '1px solid #1E3A8A' : '1px solid transparent',
                    background: isPropDbTool ? '#EFF6FF' : '#FFFFFF',
                    color: isPropDbTool ? '#1E3A8A' : '#1E293B',
                    fontSize: 11.3,
                    fontWeight: isPropDbTool ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <FlaskCompIcon size={13} />
                    <span>{lang === 'en' ? 'Property · Thermo DB' : '물성 · 열역학 DB'}</span>
                  </span>
                  {isPropDbTool && <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenToolbox('/economics-handbook')}
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: 6,
                    border: isEconHandbookTool ? '1px solid #1E3A8A' : '1px solid transparent',
                    background: isEconHandbookTool ? '#EFF6FF' : '#FFFFFF',
                    color: isEconHandbookTool ? '#1E3A8A' : '#1E293B',
                    fontSize: 11.3,
                    fontWeight: isEconHandbookTool ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <DocSheetIcon size={13} />
                    <span>
                      {lang === 'en'
                        ? 'Process Economics Handbook (104)'
                        : '공정 경제성 · 원단위 핸드북 (104종)'}
                    </span>
                  </span>
                  {isEconHandbookTool && <span style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
                </button>

                <div style={{ height: 1, background: '#E2E8F0', margin: '4px 4px' }} />

                <button
                  type="button"
                  onClick={() => {
                    setToolsMenuOpen(false);
                    setCompReqModalOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 11.3,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    textAlign: 'left',
                  }}
                >
                  <FlaskCompIcon size={13} />
                  <span>{lang === 'en' ? 'Request Component' : '물질등록 요청'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setToolsMenuOpen(false);
                    setValidationModalOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 11.3,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    textAlign: 'left',
                  }}
                >
                  <DocSheetIcon size={13} />
                  <span>{t(lang, 'header_validation_report')}</span>
                </button>
              </div>
            )}
          </div>

          {/* 서브페이지에서만 표시: ← 시뮬레이션 복귀 */}
          {showReturnToSimBtn && (
            <button
              type="button"
              onClick={handleReturnToPlant}
              title={t(lang, 'header_return_to_sim')}
              style={{
                ...navBtnStyle,
                border: '1px solid #3B82F6',
                background: '#1E3A8A',
                color: '#FFFFFF',
              }}
            >
              <span>{lang === 'en' ? '← Simulation' : '← 시뮬레이션'}</span>
            </button>
          )}
        </div>

        {/* ── 중앙: 현재 열린 케이스(문서) 제목 ── */}
        {!isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 0,
              flex: '0 1 auto',
            }}
          >
            <span
              title={activeCasePillText}
              style={{
                padding: '3px 12px',
                borderRadius: 999,
                border: '1px solid #334155',
                background: '#0B1220',
                color: '#E2E8F0',
                fontSize: 11.2,
                fontWeight: 700,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeCasePillText}
            </span>
          </div>
        )}

        {/* ── 우측: 새로고침 + 피드백 + 언어(KO|EN) + 통합 설정 드롭다운 + 계정/관리자 컨트롤 ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          {/* 새로고침 — 우측 유틸리티 영역 */}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.location.reload();
            }}
            title={lang === 'en' ? 'Refresh' : '새로고침'}
            aria-label={lang === 'en' ? 'Refresh' : '새로고침'}
            style={{
              ...navBtnStyle,
              padding: '4px 8px',
              fontSize: 10.5,
              lineHeight: 1.1,
            }}
          >
            {lang === 'en' ? 'Refresh' : '새로고침'}
          </button>

          {/* 물질등록 요청 (상단 바 상시 노출 — 라이브러리 메뉴와 함께 빠른 접근 제공) */}
          <button
            type="button"
            onClick={() => {
              setCaseMenuOpen(false);
              setToolsMenuOpen(false);
              setSettingsMenuOpen(false);
              setCompReqModalOpen(true);
            }}
            title={lang === 'en' ? 'Request New Component / Community DB' : '물질등록 요청 · 커뮤니티 물성 DB'}
            style={navBtnStyle}
          >
            <FlaskCompIcon size={12} />
            <span>{lang === 'en' ? 'Request Component' : '물질등록 요청'}</span>
          </button>

          {/* 피드백 (상단 바 상시 노출) */}
          <button
            type="button"
            onClick={() => {
              setCaseMenuOpen(false);
              setToolsMenuOpen(false);
              setSettingsMenuOpen(false);
              setFeedbackOpen(true);
            }}
            title={lang === 'en' ? 'Send Feedback' : '피드백 / 의견 보내기'}
            style={navBtnStyle}
          >
            <DocSheetIcon size={12} />
            <span>{lang === 'en' ? 'Feedback' : '피드백'}</span>
          </button>

          {/* 언어 전환 KO | EN (상단 바 상시 노출) */}
          <div
            role="group"
            aria-label="Language Selector"
            title={lang === 'en' ? 'Switch Language (KO / EN)' : '언어 전환 (KO / EN)'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#0B1220',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: 2,
              gap: 2,
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
                    padding: '2.5px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: active ? '#1E3A8A' : 'transparent',
                    color: active ? '#FFFFFF' : '#94A3B8',
                    fontSize: 10.5,
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {code.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* 설정 ▾ — 데스크톱 시뮬레이터에서는 하단 리본 [설정] 탭으로 통합, 모바일 및 서브페이지에서는 상단에 상시 표시 */}
          {(isMobile || (!pathname.startsWith('/flowsheet-simulator') && !pathname.startsWith('/material-balance'))) && (
            <div ref={settingsDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={settingsTriggerRef}
              type="button"
              onClick={() => {
                if (!settingsMenuOpen && settingsTriggerRef.current) {
                  const rect = settingsTriggerRef.current.getBoundingClientRect();
                  const menuWidth = 286;
                  setSettingsMenuPos({
                    top: rect.bottom + 6,
                    left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
                  });
                }
                setCaseMenuOpen(false);
                setToolsMenuOpen(false);
                setSettingsMenuOpen(v => !v);
              }}
              title={lang === 'en' ? 'View Mode, Units & Tag Standard' : '화면 보기 모드 · 단위계 · 태그 표준 설정'}
              style={{
                ...navBtnStyle,
                border: settingsMenuOpen ? '1px solid #60A5FA' : '1px solid #334155',
                background: settingsMenuOpen ? '#1E3A8A' : '#1E293B',
              }}
            >
              <SlidersParamIcon size={12} />
              <span>{lang === 'en' ? 'Settings' : '설정'}</span>
              <span style={{ fontSize: 9, opacity: 0.78 }}>{settingsMenuOpen ? '▴' : '▾'}</span>
            </button>

            {settingsMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: settingsMenuPos.top,
                  left: settingsMenuPos.left,
                  width: 286,
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 10,
                  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.24)',
                  padding: 10,
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  color: '#0F172A',
                }}
              >
                {/* 화면 테마 (라이트 / 다크) */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B', marginBottom: 5 }}>
                    {lang === 'en' ? 'Appearance Theme' : '화면 테마'}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 4,
                      background: '#F1F5F9',
                      border: '1px solid #CBD5E1',
                      borderRadius: 7,
                      padding: 3,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => applyWbTheme('light')}
                      style={{
                        padding: '5px 8px',
                        borderRadius: 5,
                        border: 'none',
                        background: wbTheme === 'light' ? '#1E3A8A' : 'transparent',
                        color: wbTheme === 'light' ? '#FFFFFF' : '#475569',
                        fontSize: 11,
                        fontWeight: wbTheme === 'light' ? 800 : 600,
                        cursor: 'pointer',
                      }}
                    >
                      {lang === 'en' ? '☀ Light' : '☀ 라이트'}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyWbTheme('dark')}
                      style={{
                        padding: '5px 8px',
                        borderRadius: 5,
                        border: 'none',
                        background: wbTheme === 'dark' ? '#1E3A8A' : 'transparent',
                        color: wbTheme === 'dark' ? '#FFFFFF' : '#475569',
                        fontSize: 11,
                        fontWeight: wbTheme === 'dark' ? 800 : 600,
                        cursor: 'pointer',
                      }}
                    >
                      {lang === 'en' ? '🌙 Dark' : '🌙 다크'}
                    </button>
                  </div>
                </div>

                <div style={{ height: 1, background: '#E2E8F0' }} />

                {/* 단위계 프리셋 */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B', marginBottom: 5 }}>
                    {lang === 'en' ? 'Unit System Preset' : '단위계 프리셋'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {UNIT_PRESETS.map(p => {
                      const active = presetId === p.id;
                      const presetName = lang === 'en' ? UNIT_PRESET_NAMES_EN[p.id] : p.shortName;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p.id)}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: active ? '1.5px solid #1E3A8A' : '1px solid #E2E8F0',
                            background: active ? '#EFF6FF' : '#F8FAFC',
                            color: active ? '#1E3A8A' : '#334155',
                            fontSize: 11,
                            fontWeight: active ? 800 : 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {presetName}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 장치 태그 표준 */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B', marginBottom: 5 }}>
                    {lang === 'en' ? 'Equipment Tag Standard' : '장치 태그 표준'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {TAG_STANDARDS.map(std => {
                      const active = tagStandard === std.id;
                      const stdName = lang === 'en' ? TAG_STANDARD_TEXT_EN[std.id].name : std.name;
                      return (
                        <button
                          key={std.id}
                          type="button"
                          onClick={() => setTagStandard(std.id)}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: active ? '1.5px solid #1E3A8A' : '1px solid #E2E8F0',
                            background: active ? '#EFF6FF' : '#F8FAFC',
                            color: active ? '#1E3A8A' : '#334155',
                            fontSize: 10.5,
                            fontWeight: active ? 800 : 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={stdName}
                        >
                          {stdName}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 세부 단위 설정 모달 버튼 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#475569' }}>
                    {lang === 'en' ? 'Per-Quantity Overrides' : '항목별 세부 단위'}
                  </span>
                  <HeaderUnitSettingsButton isMobile={isMobile} />
                </div>

                {/* 서비스 소개 / 요금제 (랜딩 페이지 보기) */}
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsMenuOpen(false);
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('chemeng:open-landing'));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      color: '#0F172A',
                      fontSize: 11.2,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <span>
                      {lang === 'en'
                        ? 'Product Overview & Pricing'
                        : '서비스 소개 · 요금제 보기 (랜딩)'}
                    </span>
                    <span style={{ fontSize: 11, color: '#1E3A8A', fontWeight: 900 }}>↗</span>
                  </button>
                </div>
              </div>
            )}
            </div>
          )}

          <span style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />
          <HeaderUserControls />
        </div>
      </div>

      <ValidationReportModal
        open={validationModalOpen}
        onClose={() => setValidationModalOpen(false)}
      />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
      <ComponentRequestModal
        open={compReqModalOpen}
        onClose={() => setCompReqModalOpen(false)}
      />
      <ResolvedFeedbackToast />
    </header>
  );
}

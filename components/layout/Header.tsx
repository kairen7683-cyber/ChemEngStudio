'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBalanceStore, type PlantId } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import {
  PLANT_REGISTRY,
  getPlantRegistryItem,
  type PlantWorkspaceTab,
} from '@/lib/plantRegistry';
import {
  getPreferredSimUiMode,
  setPreferredSimUiMode,
  type SimUiMode,
} from '@/lib/simUiHandoff';
import { HeaderUserControls } from '@/components/auth/AdminConsoleModal';

export default function Header() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [simUiMode, setSimUiMode] = useState<SimUiMode>('modern');
  const [plantMenuOpen, setPlantMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 42, left: 16 });
  const plantDropdownRef = useRef<HTMLDivElement | null>(null);
  const plantTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!plantMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (plantDropdownRef.current && !plantDropdownRef.current.contains(e.target as Node)) {
        setPlantMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlantMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [plantMenuOpen]);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  const {
    activePlantId,
    lastCommercialPlantId,
    setActivePlantId,
    hydrateActivePlant,
    lastPlantReturnHref,
    setLastPlantReturnHref,
  } = useBalanceStore();
  const equipSubTab = usePFDStore(s => s.equipSubTab || 'evap');
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);

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

  const handleSelectSimUiMode = (targetUi: SimUiMode) => {
    setPreferredSimUiMode(targetUi);
    setSimUiMode(targetUi);
    const onSimulatorPage =
      pathname.startsWith('/flowsheet-simulator') || pathname.startsWith('/classic-simulator');
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

  const plantMeta = getPlantRegistryItem(activePlantId);
  const isSimulatorMode = activePlantId === 'new_builder' || activePlantId === 'classic_sim';
  const dropdownPlantMeta = getPlantRegistryItem(isSimulatorMode ? lastCommercialPlantId : activePlantId);
  const isUnitCalcTool = pathname.startsWith('/unit-equipment');
  const isPropDbTool = pathname.startsWith('/property-db');
  const isGlobalToolMode = isUnitCalcTool || isPropDbTool;
  const isCommercialPlantActive = !isSimulatorMode && !isGlobalToolMode;

  // 현재 활성 워크스페이스 탭 판별
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
    setActivePlantId(nextId);

    // 도구함 화면이거나 샌드박스/표준 시뮬레이터 선택 시 즉시 해당 기본 시뮬레이터 화면으로 진입
    if (isGlobalToolMode || nextMeta.isSandbox) {
      router.push(nextMeta.defaultHref);
      return;
    }

    // 현재 보고 있던 탭 성격(공정도 / 상세설계 / 장치목록 / 경제성)이 새 공장에도 있으면 유지, 없으면 기본 화면으로 이동
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

  const handleWorkspaceTabClick = (tab: PlantWorkspaceTab) => {
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

  const handleReturnToPlant = () => {
    const fallback = plantMeta.defaultHref;
    const target =
      lastPlantReturnHref &&
      !lastPlantReturnHref.startsWith('/unit-equipment') &&
      !lastPlantReturnHref.startsWith('/property-db')
        ? lastPlantReturnHref
        : fallback;
    router.push(target);
  };

  return (
    <header
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: 100,
        background: '#FFFFFF',
        borderBottom: '1px solid #CBD5E1',
      }}
    >
      {/* ── 1단 글로벌 바: 좌측 [플랫폼 로고 + 공장/프로젝트 선택기] · 우측 [독립 엔지니어링 도구함] ── */}
      <div
        className="no-scrollbar"
        style={{
          width: '100%',
          minHeight: 40,
          padding: '4px 12px',
          background: '#142435',
          borderBottom: '1px solid #243B53',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {/* 좌측: 로고 + 공장 스위처 */}
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
            title="현재 선택된 공장의 메인 공정도 화면으로 이동"
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
            <span
              style={{
                width: 25,
                height: 25,
                borderRadius: 6,
                background: '#2563EB',
                color: '#FFFFFF',
                fontWeight: 900,
                fontSize: 10.5,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              CP
            </span>
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

          {!isMobile && (
            <>
              <span style={{ width: 1, height: 18, background: '#334E68', flexShrink: 0 }} />

              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#94A3B8',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                대상 공장:
              </span>
            </>
          )}

          <div ref={plantDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={plantTriggerRef}
              type="button"
              onClick={() => {
                if (!plantMenuOpen && plantTriggerRef.current) {
                  const rect = plantTriggerRef.current.getBoundingClientRect();
                  setMenuPos({
                    top: rect.bottom + 6,
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
                  });
                }
                setPlantMenuOpen(v => !v);
              }}
              title="상용 공정 플랜트 선택"
              style={{
                padding: '4px 10px',
                borderRadius: 7,
                border: isCommercialPlantActive ? '1.5px solid #60A5FA' : '1px solid #334E68',
                background: isCommercialPlantActive ? '#FFFFFF' : '#1A2F44',
                color: isCommercialPlantActive ? '#0F172A' : '#E2E8F0',
                fontSize: 11.5,
                fontWeight: isCommercialPlantActive ? 900 : 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                boxShadow: isCommercialPlantActive ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: isCommercialPlantActive ? '#1E293B' : 'rgba(255,255,255,0.14)',
                  color: '#FFFFFF',
                }}
              >
                {dropdownPlantMeta.code}
              </span>
              <span>{dropdownPlantMeta.shortLabel}</span>
              {dropdownPlantMeta.isDev && (
                <span
                  style={{
                    fontSize: 8.5,
                    fontWeight: 800,
                    padding: '0.5px 4px',
                    borderRadius: 4,
                    background: '#FEF3C7',
                    color: '#92400E',
                  }}
                >
                  개발중
                </span>
              )}
              <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 2 }}>
                {plantMenuOpen ? '▲' : '▼'}
              </span>
            </button>

            {plantMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  left: menuPos.left,
                  width: 332,
                  maxHeight: '75vh',
                  overflowY: 'auto',
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 10,
                  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.28)',
                  padding: 6,
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#64748B',
                    padding: '4px 8px 2px',
                    letterSpacing: '0.3px',
                  }}
                >
                  상용 공정 플랜트 ({PLANT_REGISTRY.filter(p => !p.isSandbox && !p.hiddenFromSelector).length})
                </div>
                {PLANT_REGISTRY.filter(p => !p.isSandbox && !p.hiddenFromSelector).map(p => {
                  const selected = isCommercialPlantActive && p.id === activePlantId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPlantMenuOpen(false);
                        handleSelectPlant(p.id);
                      }}
                      style={{
                        width: '100%',
                        padding: '7px 9px',
                        borderRadius: 7,
                        border: selected ? '1.5px solid #2563EB' : '1px solid transparent',
                        background: selected ? '#EFF6FF' : '#FFFFFF',
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
                            background: selected ? '#1E40AF' : '#1E293B',
                            color: '#FFFFFF',
                            flexShrink: 0,
                          }}
                        >
                          {p.code}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: selected ? 900 : 700,
                              color: '#0F172A',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.shortLabel}
                            </span>
                            {p.isDev && (
                              <span
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 800,
                                  padding: '0.5px 4px',
                                  borderRadius: 4,
                                  background: '#FEF3C7',
                                  color: '#92400E',
                                }}
                              >
                                개발중
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                            {p.capacityBadge}
                          </div>
                        </div>
                      </div>
                      {selected && (
                        <span style={{ fontSize: 12, fontWeight: 900, color: '#2563EB', flexShrink: 0 }}>
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <span style={{ width: 1, height: 18, background: '#334E68', flexShrink: 0, marginLeft: 2 }} />

          {!isMobile && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#94A3B8',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              시뮬레이터:
            </span>
          )}

          {(() => {
            const isSimActive =
              !isGlobalToolMode && (activePlantId === 'new_builder' || activePlantId === 'classic_sim');
            const effectiveUi: SimUiMode =
              pathname.startsWith('/classic-simulator')
                ? 'classic'
                : pathname.startsWith('/flowsheet-simulator')
                  ? 'modern'
                  : simUiMode;
            return (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleSelectPlant(effectiveUi === 'classic' ? 'classic_sim' : 'new_builder')}
                  title="공정 시뮬레이터 열기"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: isSimActive ? '1.5px solid #60A5FA' : '1px solid #334E68',
                    background: isSimActive ? '#FFFFFF' : '#1A2F44',
                    color: isSimActive ? '#0F172A' : '#E2E8F0',
                    fontSize: 11.2,
                    fontWeight: isSimActive ? 900 : 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    whiteSpace: 'nowrap',
                    boxShadow: isSimActive ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
                  }}
                >
                  <span
                    style={{
                      fontSize: 8.8,
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: isSimActive ? '#1D4ED8' : 'rgba(255,255,255,0.14)',
                      color: '#FFFFFF',
                    }}
                  >
                    SIM
                  </span>
                  <span>공정 시뮬레이터</span>
                </button>

                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: '#0F172A',
                    border: '1px solid #334E68',
                    borderRadius: 7,
                    padding: 2,
                    gap: 2,
                  }}
                  title="시뮬레이터 인터페이스 스타일 선택 (모던 웹 UI / 클래식 데스크톱 UI)"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectSimUiMode('modern')}
                    style={{
                      padding: '2.5px 7px',
                      borderRadius: 5,
                      border: 'none',
                      background: effectiveUi === 'modern' ? '#2563EB' : 'transparent',
                      color: effectiveUi === 'modern' ? '#FFFFFF' : '#94A3B8',
                      fontSize: 10.2,
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
                      padding: '2.5px 7px',
                      borderRadius: 5,
                      border: 'none',
                      background: effectiveUi === 'classic' ? '#0284C7' : 'transparent',
                      color: effectiveUi === 'classic' ? '#FFFFFF' : '#94A3B8',
                      fontSize: 10.2,
                      fontWeight: effectiveUi === 'classic' ? 800 : 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    클래식 UI
                  </button>
                </div>
              </div>
            );
          })()}
        </div>

        {/* 우측: 독립 엔지니어링 도구함 (공장 컨텍스트와 분리된 단품 계산기 & 물성 DB) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
            paddingLeft: 8,
          }}
        >
          <span
            style={{
              fontSize: 9.8,
              fontWeight: 700,
              color: '#94A3B8',
              whiteSpace: 'nowrap',
            }}
          >
            독립 도구함:
          </span>
          <button
            type="button"
            onClick={() => handleOpenToolbox('/unit-equipment')}
            title="플로우시트 연결 없이 빠르게 계산하는 단품 장치 숏컷 설계 도구 (열교환기·펌프·배관·용기·PSV)"
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              border: isUnitCalcTool ? '1.5px solid #93C5FD' : '1px solid #334E68',
              background: isUnitCalcTool ? '#2563EB' : '#1A2F44',
              color: '#FFFFFF',
              fontSize: 10.8,
              fontWeight: isUnitCalcTool ? 900 : 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>⚡ 단품 숏컷 계산기</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenToolbox('/property-db')}
            title="현재 선택된 공장의 핵심 유체를 우선 표시하는 열역학 모델 · 물성 계산 DB"
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              border: isPropDbTool ? '1.5px solid #93C5FD' : '1px solid #334E68',
              background: isPropDbTool ? '#2563EB' : '#1A2F44',
              color: '#FFFFFF',
              fontSize: 10.8,
              fontWeight: isPropDbTool ? 900 : 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>📚 물성 · 열역학 DB</span>
          </button>

          <span style={{ width: 1, height: 18, background: '#334E68', flexShrink: 0, marginLeft: 2 }} />
          <HeaderUserControls />
        </div>
      </div>

      {/* ── 2단 컨텍스트 워크스페이스 바: 선택된 공장의 전용 업무 탭만 표시 ── */}
      <div
        className="no-scrollbar"
        style={{
          width: '100%',
          minHeight: 34,
          padding: '0 12px',
          background: isGlobalToolMode ? '#EFF6FF' : '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {isGlobalToolMode ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', padding: '4px 0' }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: '#1E3A8A',
                  color: '#FFFFFF',
                }}
              >
                독립 엔지니어링 도구함
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A' }}>
                {isUnitCalcTool
                  ? '단품 장치 숏컷 설계 (열교환기 · 펌프 · 컬럼 · 용기 · 배관 · 안전밸브)'
                  : '물질별 적합 열역학 모델 & 순수·전해질·냉매 물성 계산기'}
              </span>
              <span style={{ fontSize: 10.5, color: '#475569' }}>
                · 현재 작업 중인 기준 공장: <b style={{ color: '#1E3A8A' }}>[{plantMeta.code}] {plantMeta.shortLabel}</b>
              </span>
            </div>

            <button
              type="button"
              onClick={handleReturnToPlant}
              style={{
                padding: '4px 11px',
                borderRadius: 5,
                border: '1px solid #1E3A8A',
                background: '#1E3A8A',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              ← [{plantMeta.code}] {plantMeta.shortLabel} 공정 화면으로 복귀
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {/* 현재 선택된 공장 타이틀 (불필요한 박스/배지 제거) */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A' }}>
                  {plantMeta.title}
                </span>
                {plantMeta.capacityBadge ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#64748B',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {plantMeta.capacityBadge}
                  </span>
                ) : null}
              </div>

              <span style={{ width: 1, height: 15, background: '#CBD5E1', flexShrink: 0 }} />

              {/* 선택된 공장 전용 워크스페이스 탭 (밑줄형 클린 탭) */}
              <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {plantMeta.tabs.map(tab => {
                  const active = currentTabKey === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleWorkspaceTabClick(tab)}
                      style={{
                        height: 32,
                        padding: '0 8px',
                        border: 'none',
                        borderBottom: active ? '2px solid #1D4ED8' : '2px solid transparent',
                        background: 'transparent',
                        color: active ? '#1D4ED8' : '#475569',
                        fontSize: 11.5,
                        fontWeight: active ? 800 : 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

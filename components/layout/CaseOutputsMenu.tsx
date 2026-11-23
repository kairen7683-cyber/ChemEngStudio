'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useAuth } from '@/components/auth/AuthContext';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  getPlantRegistryItem,
  isSimulatorOnlyUser,
  formatPlantLabelForUser,
  type PlantWorkspaceTab,
} from '@/lib/plantRegistry';
import { t } from '@/lib/i18n/uiText';

export interface CaseOutputsMenuProps {
  compact?: boolean;
  unitCount?: number;
}

export default function CaseOutputsMenu({ compact = false, unitCount }: CaseOutputsMenuProps) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { user } = useAuth();
  const { activePlantId, setActivePlantId } = useBalanceStore();
  const equipSubTab = usePFDStore(s => s.equipSubTab || 'evap');
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);
  const lang = useUnitStore(s => s.lang);

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 44, left: 200 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const simOnly = isSimulatorOnlyUser(user);
  const isStandalone =
    activePlantId === 'new_builder' || activePlantId === 'classic_sim' || simOnly;
  const activePlant = getPlantRegistryItem(activePlantId);

  const getActiveTabKey = (): PlantWorkspaceTab['key'] => {
    if (pathname.startsWith('/process-economics') || pathname.startsWith('/pep-yearbook')) return 'econ';
    if (pathname.startsWith('/special-process')) return 'design';
    if (pathname.startsWith('/equipment-design')) {
      return equipSubTab === 'equip' ? 'equip' : 'design';
    }
    return 'pfd';
  };
  const currentTabKey = getActiveTabKey();

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

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 280;
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      });
    }
    setOpen(v => !v);
  };

  const handleNavigateCustomItem = (href: string, equipTab?: string) => {
    setOpen(false);
    if (simOnly && activePlantId !== 'new_builder' && activePlantId !== 'classic_sim') {
      setActivePlantId('new_builder');
    }
    if (equipTab) {
      setEquipSubTab(equipTab);
    }
    router.push(href);
  };

  const handleNavigatePlantTab = (tab: PlantWorkspaceTab) => {
    setOpen(false);
    if (tab.equipTab) {
      setEquipSubTab(tab.equipTab);
    }
    router.push(tab.href);
  };

  const plantOutputTabs = activePlant.tabs.filter(
    tab =>
      tab.href !== '/flowsheet-simulator' &&
      tab.href !== '/classic-simulator' &&
      tab.href !== '/material-balance'
  );

  const standaloneOutputItems = [
    {
      key: 'unit-equipment',
      label:
        lang === 'en'
          ? 'Equipment List · Datasheets · CAPEX'
          : '장치목록 · 데이터시트 · 투자비 (CAPEX)',
      href: '/unit-equipment',
      active: pathname.startsWith('/unit-equipment'),
      equipTab: undefined as string | undefined,
    },
  ];

  const plantHeadingLabel = formatPlantLabelForUser(activePlant.shortLabel, user);
  const headingText = isStandalone
    ? lang === 'en'
      ? 'Current Case Outputs'
      : '현재 케이스 산출물'
    : lang === 'en'
      ? `${plantHeadingLabel} Outputs`
      : `${plantHeadingLabel} 산출물`;

  const triggerBg = compact
    ? open
      ? '#1E3A8A'
      : '#1E293B'
    : open
      ? '#EFF6FF'
      : '#FFFFFF';
  const triggerBorder = compact
    ? open
      ? '1px solid #60A5FA'
      : '1px solid #334155'
    : open
      ? '1px solid #2563EB'
      : '1px solid #CBD5E1';
  const triggerColor = compact ? '#F8FAFC' : open ? '#1E3A8A' : '#0F172A';

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        title={
          isStandalone
            ? lang === 'en'
              ? 'Equipment list, datasheets, and CAPEX for the active case'
              : '현재 시뮬레이션 케이스의 장치목록·데이터시트·투자비(CAPEX) 산출물'
            : lang === 'en'
              ? 'Outputs and engineering sheets for the active simulation'
              : '현재 시뮬레이션 케이스의 장치목록·설계·경제성 산출물'
        }
        style={{
          padding: compact ? '4px 9px' : '5px 10px',
          borderRadius: 6,
          border: triggerBorder,
          background: triggerBg,
          color: triggerColor,
          fontSize: compact ? 11 : 11.5,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
      >
        <span>📊 {lang === 'en' ? 'Outputs' : '산출물'}</span>
        <span style={{ fontSize: 9, opacity: 0.78 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            width: 280,
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
            {headingText}
          </div>

          {isStandalone ? (
            unitCount === 0 ? (
              <div
                style={{
                  padding: '8px 9px',
                  borderRadius: 6,
                  background: '#F8FAFC',
                  border: '1px dashed #CBD5E1',
                  color: '#64748B',
                  fontSize: 11,
                  lineHeight: 1.45,
                  fontWeight: 500,
                }}
              >
                {lang === 'en'
                  ? 'Empty case. Place units and run the simulation to generate outputs for this case.'
                  : '빈 케이스입니다. 장치를 배치하고 실행하면 이 케이스의 산출물이 생성됩니다.'}
              </div>
            ) : (
              standaloneOutputItems.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleNavigateCustomItem(item.href, item.equipTab)}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: item.active ? '1px solid #1E3A8A' : '1px solid transparent',
                    background: item.active ? '#EFF6FF' : '#FFFFFF',
                    color: item.active ? '#1E3A8A' : '#1E293B',
                    fontSize: 11.3,
                    fontWeight: item.active ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span>{item.label}</span>
                  {item.active && (
                    <span style={{ fontSize: 11, fontWeight: 900, flexShrink: 0 }}>✓</span>
                  )}
                </button>
              ))
            )
          ) : (
            plantOutputTabs.map(tab => {
              const active =
                currentTabKey === tab.key &&
                !(pathname.startsWith('/equipment-design') && equipSubTab === 'psv_flare');
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleNavigatePlantTab(tab)}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: active ? '1px solid #1E3A8A' : '1px solid transparent',
                    background: active ? '#EFF6FF' : '#FFFFFF',
                    color: active ? '#1E3A8A' : '#1E293B',
                    fontSize: 11.3,
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                  }}
                >
                  <span>{getLocalizedTabLabel(tab)}</span>
                  {active && (
                    <span style={{ fontSize: 11, fontWeight: 900, flexShrink: 0 }}>✓</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

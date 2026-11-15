'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { SIM_COMPS, COMP_META, type SimCompKey } from '@/lib/calculations/flowsheetSolver';
import {
  type SimPropertyMethod,
  type ResolvedPropertyMethod,
  type CompChemicalFamily,
  PROPERTY_METHOD_INFO,
  COMP_CATALOG_META,
  COMP_FAMILY_LABELS,
  PLANT_COMPONENT_PRESETS,
  GENERAL_COMPONENT_PACKS,
  recommendPropertyMethod,
} from '@/lib/calculations/componentCatalog';
import {
  EXTENDED_CHEMICAL_LIBRARY,
  EXTENDED_LIB_CATEGORY_LABELS,
  JOBACK_GROUPS,
  type ExtendedLibCategory,
  type JobackGroupId,
  type CustomSlotKey,
  predictPropertiesFromJobackGroups,
  buildSpecFromJobackGroups,
  applyExtendedChemicalToSlot,
  applyCustomSpecToSlot,
  getActiveCustomSlotSpec,
  resetCustomSlot,
} from '@/lib/calculations/customComponentEngine';

export interface ComponentPropertySetupModalProps {
  open: boolean;
  onClose: () => void;
  activeComponents: SimCompKey[];
  propertyMethod: SimPropertyMethod;
  currentFeedFlows?: Partial<Record<SimCompKey, number>>;
  maxPressKgcm2g?: number;
  currentPlantContext?: string;
  onApply: (nextComponents: SimCompKey[], nextPropertyMethod: SimPropertyMethod) => void;
}

const FAMILY_ORDER: Array<'ALL' | CompChemicalFamily> = [
  'ALL',
  'polar_solvent',
  'hydrocarbon',
  'aromatic',
  'gas_syngas',
  'electrolyte_inorg',
  'chlor_ech',
];

export default function ComponentPropertySetupModal({
  open,
  onClose,
  activeComponents,
  propertyMethod,
  currentFeedFlows,
  maxPressKgcm2g = 1.0,
  currentPlantContext,
  onApply,
}: ComponentPropertySetupModalProps) {
  const isPlantCtx =
    currentPlantContext === 'electrolyzer_plant' ||
    currentPlantContext === 'hcl_1a_plant' ||
    currentPlantContext === 'ech_gte_plant' ||
    currentPlantContext === 'cms_plant';

  const [sourceTab, setSourceTab] = useState<'general' | 'plant' | 'custom'>(isPlantCtx ? 'plant' : 'general');
  const [draftComps, setDraftComps] = useState<SimCompKey[]>(activeComponents);
  const [draftMethod, setDraftMethod] = useState<SimPropertyMethod>(propertyMethod);
  const [familyFilter, setFamilyFilter] = useState<'ALL' | CompChemicalFamily>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [customSubTab, setCustomSubTab] = useState<'library' | 'joback'>('library');
  const [extCatFilter, setExtCatFilter] = useState<'ALL' | ExtendedLibCategory>('ALL');
  const [extSearch, setExtSearch] = useState('');
  const [slotRev, setSlotRev] = useState(0);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [jbNameKo, setJbNameKo] = useState('이소아밀아세테이트');
  const [jbFormula, setJbFormula] = useState('C7H14O2');
  const [jbTbExpStr, setJbTbExpStr] = useState('142.0');
  const [jbGroups, setJbGroups] = useState<Partial<Record<JobackGroupId, number>>>({
    CH3: 3,
    CH2_chain: 2,
    CH_chain: 1,
    COO_ester: 1,
  });
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  useEffect(() => {
    if (open) {
      setDraftComps(activeComponents.length > 0 ? activeComponents : ['H2O', 'N2']);
      setDraftMethod(propertyMethod || 'AUTO');
      setSourceTab(isPlantCtx ? 'plant' : 'general');
      setSearchQuery('');
    }
  }, [open, activeComponents, propertyMethod, isPlantCtx]);

  const inUseSet = useMemo(() => {
    const s = new Set<SimCompKey>();
    if (currentFeedFlows) {
      for (const k of SIM_COMPS) {
        if ((currentFeedFlows[k] ?? 0) > 1e-6) s.add(k);
      }
    }
    return s;
  }, [currentFeedFlows]);

  const recommendation = useMemo(
    () => recommendPropertyMethod(draftComps, currentFeedFlows, maxPressKgcm2g),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftComps, currentFeedFlows, maxPressKgcm2g, slotRev]
  );

  const effectiveResolved: ResolvedPropertyMethod =
    draftMethod === 'AUTO' ? recommendation.method : draftMethod;

  const filteredComps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return SIM_COMPS.filter(k => {
      const cat = COMP_CATALOG_META[k];
      const meta = COMP_META[k];
      if (!cat || !meta) return false;
      if (familyFilter !== 'ALL' && cat.family !== familyFilter) return false;
      if (!q) return true;
      return (
        k.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        meta.formula.toLowerCase().includes(q) ||
        cat.cas.includes(q) ||
        cat.noteKo.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyFilter, searchQuery, slotRev]);

  const filteredExtLibrary = useMemo(() => {
    const q = extSearch.trim().toLowerCase();
    return EXTENDED_CHEMICAL_LIBRARY.filter(item => {
      if (extCatFilter !== 'ALL' && item.category !== extCatFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.nameKo.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.formula.toLowerCase().includes(q) ||
        item.cas.includes(q)
      );
    });
  }, [extCatFilter, extSearch]);

  const liveJobackPred = useMemo(() => {
    const parsedTb = jbTbExpStr.trim() !== '' ? Number(jbTbExpStr) : undefined;
    const tbOpt = parsedTb !== undefined && Number.isFinite(parsedTb) ? parsedTb : undefined;
    return predictPropertiesFromJobackGroups(jbGroups, { tbExpC: tbOpt });
  }, [jbGroups, jbTbExpStr]);

  if (!open) return null;

  const toggleComp = (comp: SimCompKey) => {
    setDraftComps(prev => {
      if (prev.includes(comp)) {
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== comp);
      }
      const nextSet = new Set([...prev, comp]);
      return SIM_COMPS.filter(c => nextSet.has(c));
    });
  };

  const applyPresetList = (list: SimCompKey[], mergeWithInUse = true) => {
    const nextSet = new Set<SimCompKey>(list);
    if (mergeWithInUse) {
      inUseSet.forEach(c => nextSet.add(c));
    }
    setDraftComps(SIM_COMPS.filter(c => nextSet.has(c)));
    setDraftMethod('AUTO');
  };

  const ensureSlotInDraft = (slot: CustomSlotKey) => {
    setDraftComps(prev => {
      if (prev.includes(slot)) return prev;
      const nextSet = new Set([...prev, slot]);
      return SIM_COMPS.filter(c => nextSet.has(c));
    });
  };

  const handleAssignExtToSlot = (slot: CustomSlotKey, chemId: string) => {
    const applied = applyExtendedChemicalToSlot(slot, chemId);
    if (!applied) return;
    ensureSlotInDraft(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(`✓ ${slot} ← ${applied.nameKo} (${applied.formula}), Tb ${applied.tbC.toFixed(1)}°C`);
  };

  const handleAssignJobackToSlot = (slot: CustomSlotKey) => {
    const parsedTb = jbTbExpStr.trim() !== '' ? Number(jbTbExpStr) : undefined;
    const tbOpt = parsedTb !== undefined && Number.isFinite(parsedTb) ? parsedTb : undefined;
    const { spec } = buildSpecFromJobackGroups(jbGroups, {
      formula: jbFormula,
      nameKo: jbNameKo,
      tbExpC: tbOpt,
    });
    applyCustomSpecToSlot(slot, spec);
    ensureSlotInDraft(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(`✓ ${slot} ← ${spec.nameKo} (${spec.formula}), Tc ${spec.tcK.toFixed(1)}K, Pc ${spec.pcBar.toFixed(1)}bar`);
  };

  const handleResetSlot = (slot: CustomSlotKey) => {
    const def = resetCustomSlot(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(`↺ ${slot} 기본값 (${def.nameKo}) 복원`);
  };

  const adjustJobackGroup = (gid: JobackGroupId, delta: number) => {
    setJbGroups(prev => {
      const nextVal = Math.max(0, Math.min(24, (prev[gid] ?? 0) + delta));
      const copy = { ...prev };
      if (nextVal <= 0) delete copy[gid];
      else copy[gid] = nextVal;
      return copy;
    });
  };

  const slot1Spec = getActiveCustomSlotSpec('CUSTOM_1');
  const slot2Spec = getActiveCustomSlotSpec('CUSTOM_2');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.52)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: isMobile ? '100vw' : 'min(1080px, 96vw)',
          height: isMobile ? '100dvh' : undefined,
          maxHeight: isMobile ? '100dvh' : '90vh',
          background: '#FFFFFF',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.34)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: isMobile ? '10px 12px' : '12px 18px',
            background: '#142435',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>🧪 성분 · 열역학 물성 설정</span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#2563EB',
                  color: '#FFFFFF',
                }}
              >
                {draftComps.length}종 · {draftMethod === 'AUTO' ? `AUTO(${effectiveResolved})` : effectiveResolved}
              </span>
            </div>
            <div style={{ fontSize: isMobile ? 10.2 : 11, color: '#CBD5E1', marginTop: 2 }}>
              범용 {SIM_COMPS.length}종 · 공장 표준 · 확장 {EXTENDED_CHEMICAL_LIBRARY.length}종 · Joback+UNIFAC
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: isMobile ? '5px 10px' : 0,
              width: isMobile ? 'auto' : 30,
              height: 30,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.4)',
              background: '#1A2F44',
              color: '#FFFFFF',
              fontSize: isMobile ? 12 : 14,
              fontWeight: 900,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isMobile ? '✕ 닫기' : '✕'}
          </button>
        </div>

        {/* 본문 2단 레이아웃: 좌측 [성분 선택] / 우측 [열역학 물성 모델 자동·수동 선택] */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.55fr 1fr',
            overflowY: isMobile ? 'auto' : 'hidden',
            overflowX: 'hidden',
          }}
        >
          {/* 좌측: 성분 설정 영역 */}
          <div
            style={{
              padding: isMobile ? '12px' : '14px 16px',
              borderRight: isMobile ? 'none' : '1px solid #E2E8F0',
              borderBottom: isMobile ? '1px solid #E2E8F0' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 0,
              overflow: isMobile ? 'visible' : 'hidden',
            }}
          >
            {/* 모드 스위치 탭: 범용 공정 개발 vs 공장별 표준 성분 vs 100+ 확장물질 · UNIFAC 분자설계 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div
                style={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  gap: 2,
                  background: '#F1F5F9',
                  padding: 3,
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  maxWidth: '100%',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSourceTab('general')}
                  style={{
                    padding: isMobile ? '5px 8px' : '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: sourceTab === 'general' ? '#1D4ED8' : 'transparent',
                    color: sourceTab === 'general' ? '#FFFFFF' : '#334155',
                    fontSize: isMobile ? 10.8 : 11.2,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🌐 범용 ({SIM_COMPS.length}종)
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('plant')}
                  style={{
                    padding: isMobile ? '5px 8px' : '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: sourceTab === 'plant' ? '#0F5338' : 'transparent',
                    color: sourceTab === 'plant' ? '#FFFFFF' : '#334155',
                    fontSize: isMobile ? 10.8 : 11.2,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🏭 공장 표준
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('custom')}
                  style={{
                    padding: isMobile ? '5px 8px' : '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: sourceTab === 'custom' ? '#7C3AED' : 'transparent',
                    color: sourceTab === 'custom' ? '#FFFFFF' : '#5B21B6',
                    fontSize: isMobile ? 10.8 : 11.2,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  🧪 확장 · Joback/UNIFAC
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => setDraftComps([...SIM_COMPS])}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 5,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  전체 ({SIM_COMPS.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const base: SimCompKey[] = inUseSet.size > 0 ? Array.from(inUseSet) : ['H2O'];
                    setDraftComps(SIM_COMPS.filter(c => base.includes(c)));
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 5,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#64748B',
                    cursor: 'pointer',
                  }}
                >
                  사용중만
                </button>
              </div>
            </div>

            {sourceTab === 'custom' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
                {/* 현재 배정된 CUSTOM_1 / CUSTOM_2 슬롯 상태 카드 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: 6,
                  }}
                >
                  {([
                    { slot: 'CUSTOM_1' as CustomSlotKey, spec: slot1Spec },
                    { slot: 'CUSTOM_2' as CustomSlotKey, spec: slot2Spec },
                  ]).map(({ slot, spec }) => {
                    const activeInFlow = draftComps.includes(slot);
                    const unifacStr = Object.entries(spec.unifacGroups)
                      .map(([g, n]) => `${g}×${n}`)
                      .join(', ');
                    return (
                      <div
                        key={slot}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: activeInFlow ? '1.6px solid #7C3AED' : '1px solid #CBD5E1',
                          background: activeInFlow ? '#F5F3FF' : '#F8FAFC',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 900,
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                background: '#6D28D9',
                                color: '#FFFFFF',
                              }}
                            >
                              {slot}
                            </span>
                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                              {spec.nameKo} ({spec.formula})
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => toggleComp(slot)}
                              style={{
                                padding: '2px 6px',
                                fontSize: 9.5,
                                fontWeight: 800,
                                borderRadius: 4,
                                border: '1px solid #7C3AED',
                                background: activeInFlow ? '#7C3AED' : '#FFFFFF',
                                color: activeInFlow ? '#FFFFFF' : '#6D28D9',
                                cursor: 'pointer',
                              }}
                            >
                              {activeInFlow ? '✓ 활성' : '+ 포함'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetSlot(slot)}
                              style={{
                                padding: '2px 6px',
                                fontSize: 9.5,
                                fontWeight: 700,
                                borderRadius: 4,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                color: '#64748B',
                                cursor: 'pointer',
                              }}
                            >
                              초기화
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                          MW {spec.mw.toFixed(2)} · Tb {spec.tbC.toFixed(1)}°C · Tc {spec.tcK.toFixed(1)}K · Pc {spec.pcBar.toFixed(1)}bar · ω {spec.omega.toFixed(3)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#6D28D9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          UNIFAC: {unifacStr || 'CH2×2'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {slotNotice && (
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: '#ECFDF5',
                      border: '1px solid #6EE7B7',
                      color: '#065F46',
                      fontSize: 10.8,
                      fontWeight: 800,
                    }}
                  >
                    {slotNotice}
                  </div>
                )}

                {/* 서브 모드 선택: 128종 확장 라이브러리 vs Joback+UNIFAC 분자 직접 설계 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setCustomSubTab('library')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: customSubTab === 'library' ? '1.5px solid #7C3AED' : '1px solid #CBD5E1',
                      background: customSubTab === 'library' ? '#EDE9FE' : '#FFFFFF',
                      color: customSubTab === 'library' ? '#5B21B6' : '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    📚 확장 라이브러리 ({EXTENDED_CHEMICAL_LIBRARY.length}종)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomSubTab('joback')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: customSubTab === 'joback' ? '1.5px solid #0F766E' : '1px solid #CBD5E1',
                      background: customSubTab === 'joback' ? '#CCFBF1' : '#FFFFFF',
                      color: customSubTab === 'joback' ? '#0F766E' : '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    🧬 Joback + UNIFAC 분자설계
                  </button>
                </div>

                {customSubTab === 'library' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 220 }}>
                    <input
                      type="text"
                      value={extSearch}
                      onChange={e => setExtSearch(e.target.value)}
                      placeholder="물질명, 화학식, CAS 검색..."
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '6px 10px',
                        fontSize: 11.2,
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#F8FAFC',
                      }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(['ALL', ...(Object.keys(EXTENDED_LIB_CATEGORY_LABELS) as ExtendedLibCategory[])] as const).map(cat => {
                        const active = extCatFilter === cat;
                        const cnt =
                          cat === 'ALL'
                            ? EXTENDED_CHEMICAL_LIBRARY.length
                            : EXTENDED_CHEMICAL_LIBRARY.filter(x => x.category === cat).length;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setExtCatFilter(cat)}
                            style={{
                              padding: '3px 7px',
                              borderRadius: 999,
                              border: active ? '1px solid #7C3AED' : '1px solid #CBD5E1',
                              background: active ? '#7C3AED' : '#FFFFFF',
                              color: active ? '#FFFFFF' : '#475569',
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {cat === 'ALL' ? `전체 (${cnt})` : `${EXTENDED_LIB_CATEGORY_LABELS[cat]} (${cnt})`}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minHeight: 200,
                        maxHeight: isMobile ? 340 : 380,
                        overflowY: 'auto',
                        border: '1px solid #E2E8F0',
                        borderRadius: 8,
                        background: '#F8FAFC',
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      {filteredExtLibrary.map(item => {
                        const isSlot1 = slot1Spec.id === item.id;
                        const isSlot2 = slot2Spec.id === item.id;
                        return (
                          <div
                            key={item.id}
                            style={{
                              padding: '7px 9px',
                              borderRadius: 7,
                              border: isSlot1 || isSlot2 ? '1.5px solid #7C3AED' : '1px solid #E2E8F0',
                              background: isSlot1 || isSlot2 ? '#F5F3FF' : '#FFFFFF',
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>{item.nameKo}</span>
                                <span style={{ fontSize: 10.2, fontWeight: 700, color: '#6D28D9', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {item.formula}
                                </span>
                                <span style={{ fontSize: 9.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                                  CAS {item.cas}
                                </span>
                              </div>
                              <div style={{ fontSize: 9.8, color: '#475569', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                                MW {item.mw.toFixed(1)} · Tb {item.tbC.toFixed(1)}°C · Tc {item.tcK.toFixed(0)}K · Pc {item.pcBar.toFixed(1)}bar · ΔHf° {item.dHfIg298_kJ_mol.toFixed(0)}kJ/mol
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => handleAssignExtToSlot('CUSTOM_1', item.id)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #7C3AED',
                                  background: isSlot1 ? '#7C3AED' : '#FFFFFF',
                                  color: isSlot1 ? '#FFFFFF' : '#6D28D9',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {isSlot1 ? '✓ #1' : '슬롯#1'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAssignExtToSlot('CUSTOM_2', item.id)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #0F766E',
                                  background: isSlot2 ? '#0F766E' : '#FFFFFF',
                                  color: isSlot2 ? '#FFFFFF' : '#0F766E',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {isSlot2 ? '✓ #2' : '슬롯#2'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Joback + Hansen UNIFAC 분자 직접 설계 빌더 */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '1.2fr 0.9fr 1fr',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>물질명</label>
                        <input
                          type="text"
                          value={jbNameKo}
                          onChange={e => setJbNameKo(e.target.value)}
                          placeholder="물질명"
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #CBD5E1' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>화학식</label>
                        <input
                          type="text"
                          value={jbFormula}
                          onChange={e => setJbFormula(e.target.value)}
                          placeholder="C7H14O2"
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #CBD5E1', fontFamily: 'JetBrains Mono, monospace' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#0F766E' }}>실험 Tb (°C, 선택)</label>
                        <input
                          type="text"
                          value={jbTbExpStr}
                          onChange={e => setJbTbExpStr(e.target.value)}
                          placeholder="미입력 시 Joback 추산"
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #5EEAD4', background: '#F0FDFA', fontFamily: 'JetBrains Mono, monospace' }}
                        />
                      </div>
                    </div>

                    {/* 빠른 분자 예시 프리셋 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#64748B' }}>예시:</span>
                      {[
                        { label: '이소아밀아세테이트', f: 'C7H14O2', tb: '142.0', g: { CH3: 3, CH2_chain: 2, CH_chain: 1, COO_ester: 1 } as Partial<Record<JobackGroupId, number>> },
                        { label: '시클로헥실메탄올', f: 'C7H14O', tb: '181.0', g: { CH2_ring: 5, CH_ring: 1, CH2_chain: 1, OH_alcohol: 1 } as Partial<Record<JobackGroupId, number>> },
                        { label: '프로필벤젠', f: 'C9H12', tb: '159.2', g: { ACH_arom: 5, AC_arom: 1, CH2_chain: 2, CH3: 1 } as Partial<Record<JobackGroupId, number>> },
                        { label: '초기화', f: 'Custom', tb: '', g: { CH3: 2 } as Partial<Record<JobackGroupId, number>> },
                      ].map(ex => (
                        <button
                          key={ex.label}
                          type="button"
                          onClick={() => {
                            setJbNameKo(ex.label === '초기화' ? '사용자 설계 분자' : ex.label);
                            setJbFormula(ex.f);
                            setJbTbExpStr(ex.tb);
                            setJbGroups(ex.g);
                          }}
                          style={{
                            padding: '2.5px 7px',
                            fontSize: 9.8,
                            fontWeight: 700,
                            borderRadius: 4,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#334155',
                            cursor: 'pointer',
                          }}
                        >
                          {ex.label}
                        </button>
                      ))}
                    </div>

                    {/* Joback 작용기 카운터 그리드 */}
                    <div
                      style={{
                        maxHeight: isMobile ? 220 : 215,
                        overflowY: 'auto',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        background: '#F8FAFC',
                        padding: 6,
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                        gap: 4,
                      }}
                    >
                      {(Object.keys(JOBACK_GROUPS) as JobackGroupId[]).map(gid => {
                        const def = JOBACK_GROUPS[gid];
                        const cnt = jbGroups[gid] ?? 0;
                        return (
                          <div
                            key={gid}
                            style={{
                              padding: '4px 7px',
                              borderRadius: 5,
                              border: cnt > 0 ? '1.3px solid #0F766E' : '1px solid #E2E8F0',
                              background: cnt > 0 ? '#F0FDFA' : '#FFFFFF',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 4,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                                {def.symbol}
                              </span>{' '}
                              <span style={{ fontSize: 9.8, color: '#475569' }}>{def.labelKo}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => adjustJobackGroup(gid, -1)}
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  border: '1px solid #CBD5E1',
                                  background: '#FFFFFF',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  lineHeight: 1,
                                }}
                              >
                                -
                              </button>
                              <span style={{ minWidth: 16, textAlign: 'center', fontSize: 11, fontWeight: 900, color: cnt > 0 ? '#0F766E' : '#94A3B8' }}>
                                {cnt}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustJobackGroup(gid, 1)}
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  border: '1px solid #0F766E',
                                  background: '#CCFBF1',
                                  color: '#0F766E',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  lineHeight: 1,
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 실시간 물성 예측 결과 & 슬롯 배정 */}
                    <div
                      style={{
                        padding: '9px 11px',
                        borderRadius: 8,
                        border: '1.5px solid #0F766E',
                        background: '#F0FDFA',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <div style={{ fontSize: 10.8, fontWeight: 900, color: '#0F766E' }}>
                        🔬 Joback · Lee–Kesler · UNIFAC 물성 추산
                      </div>
                      <div style={{ fontSize: 10.2, color: '#1E293B', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
                        MW <b>{liveJobackPred.mw.toFixed(2)}</b> g/mol · Tb <b>{liveJobackPred.tbC.toFixed(1)}°C</b> (Joback {(liveJobackPred.tbJoback_K - 273.15).toFixed(1)}°C) · Tc <b>{liveJobackPred.tc_K.toFixed(1)} K</b> · Pc <b>{liveJobackPred.pc_bar.toFixed(2)} bar</b> · ω <b>{liveJobackPred.omega.toFixed(3)}</b>
                        <br />
                        ΔHf°(g,298K) <b>{liveJobackPred.dHfIg298_kJ_mol.toFixed(1)}</b> kJ/mol · ΔHvap(298K) <b>{liveJobackPred.dHvap298_kJ_mol.toFixed(1)}</b> kJ/mol · μL(25°C) <b>{liveJobackPred.viscLiq298_cP.toFixed(2)}</b> cP
                        <br />
                        UNIFAC:{' '}
                        <b>
                          {Object.entries(liveJobackPred.unifacGroups)
                            .map(([g, n]) => `${g}:${n}`)
                            .join(', ')}
                        </b>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                        <button
                          type="button"
                          onClick={() => handleAssignJobackToSlot('CUSTOM_1')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #7C3AED',
                            background: '#7C3AED',
                            color: '#FFFFFF',
                            fontSize: 10.8,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          ✓ CUSTOM_1 적용
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssignJobackToSlot('CUSTOM_2')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #0F766E',
                            background: '#0F766E',
                            color: '#FFFFFF',
                            fontSize: 10.8,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          ✓ CUSTOM_2 적용
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : sourceTab === 'plant' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', paddingRight: 2 }}>
                <div style={{ fontSize: 10.5, color: '#64748B' }}>
                  공장별 표준 성분 프리셋 (로드 후 범용 탭에서 추가/편집 가능)
                </div>
                {PLANT_COMPONENT_PRESETS.map(preset => {
                  const isExact =
                    preset.components.length === draftComps.length &&
                    preset.components.every(c => draftComps.includes(c));
                  return (
                    <div
                      key={preset.plantId}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 9,
                        border: isExact ? '1.8px solid #059669' : '1px solid #CBD5E1',
                        background: isExact ? '#ECFDF5' : '#F8FAFC',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 900,
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: '#0F5338',
                              color: '#FFFFFF',
                            }}
                          >
                            {preset.code}
                          </span>
                          <span style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A' }}>
                            {preset.labelKo}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyPresetList(preset.components)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #059669',
                            background: isExact ? '#059669' : '#FFFFFF',
                            color: isExact ? '#FFFFFF' : '#065F46',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isExact ? '✓ 적용됨' : '불러오기'}
                        </button>
                      </div>
                      <div style={{ fontSize: 10.8, color: '#475569' }}>{preset.descKo}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {preset.components.map(c => (
                          <span
                            key={c}
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1.5px 6px',
                              borderRadius: 4,
                              background: '#FFFFFF',
                              border: '1px solid #CBD5E1',
                              color: '#1E293B',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {COMP_META[c]?.label ?? c}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {/* 범용 공정 빠른 스타터 패키지 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>
                    ⚡ 빠른 프리셋:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {GENERAL_COMPONENT_PACKS.map(pk => (
                      <button
                        key={pk.id}
                        type="button"
                        onClick={() => applyPresetList(pk.components)}
                        title={pk.descKo}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid #BFDBFE',
                          background: '#EFF6FF',
                          color: '#1E3A8A',
                          fontSize: 10.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span>{pk.labelKo}</span>
                        <span
                          style={{
                            fontSize: 9,
                            padding: '0.5px 4px',
                            borderRadius: 3,
                            background: '#DBEAFE',
                            color: '#1D4ED8',
                          }}
                        >
                          {pk.badge}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 검색창 + 화학군 필터 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="물질명, 화학식, CAS 검색..."
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 11.5,
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {FAMILY_ORDER.map(fam => {
                      const active = familyFilter === fam;
                      const count =
                        fam === 'ALL'
                          ? SIM_COMPS.length
                          : SIM_COMPS.filter(k => COMP_CATALOG_META[k]?.family === fam).length;
                      return (
                        <button
                          key={fam}
                          type="button"
                          onClick={() => setFamilyFilter(fam)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 999,
                            border: active ? '1px solid #1D4ED8' : '1px solid #CBD5E1',
                            background: active ? '#1D4ED8' : '#FFFFFF',
                            color: active ? '#FFFFFF' : '#475569',
                            fontSize: 10.2,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {fam === 'ALL' ? `전체 (${count})` : `${COMP_FAMILY_LABELS[fam]} (${count})`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 검증된 40종 물질 그리드 */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 6,
                    alignContent: 'start',
                    paddingRight: 3,
                  }}
                >
                  {filteredComps.map(comp => {
                    const checked = draftComps.includes(comp);
                    const inUse = inUseSet.has(comp);
                    const meta = COMP_META[comp];
                    const cat = COMP_CATALOG_META[comp];
                    return (
                      <div
                        key={comp}
                        onClick={() => toggleComp(comp)}
                        style={{
                          padding: '7px 9px',
                          borderRadius: 7,
                          border: checked ? '1.5px solid #2563EB' : '1px solid #E2E8F0',
                          background: checked ? '#EFF6FF' : '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {}}
                              style={{ margin: 0, cursor: 'pointer' }}
                            />
                            <span
                              style={{
                                fontSize: 11.3,
                                fontWeight: checked ? 900 : 700,
                                color: '#0F172A',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                            {inUse && (
                              <span
                                style={{
                                  fontSize: 8.8,
                                  fontWeight: 900,
                                  padding: '1px 4px',
                                  borderRadius: 3,
                                  background: '#DCFCE7',
                                  color: '#166534',
                                }}
                              >
                                유량있음
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 9.2,
                                color: '#64748B',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            >
                              Tb {cat.tbC > 500 ? '비휘발' : `${cat.tbC}°C`}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <span style={{ fontSize: 9.8, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cat.noteKo}
                          </span>
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {cat.reliableMethods.map(m => (
                              <span
                                key={m}
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 800,
                                  padding: '0.5px 3.5px',
                                  borderRadius: 3,
                                  background: m === effectiveResolved ? '#1E40AF' : '#F1F5F9',
                                  color: m === effectiveResolved ? '#FFFFFF' : '#475569',
                                }}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 우측: 열역학 물성 모델 (Property Method) 자동 추천 + 수동 지정 */}
          <div
            style={{
              padding: '14px 16px',
              background: '#F8FAFC',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
              ⚗️ 물성 모델 (Property Method)
            </div>

            {/* 자동 선택 (AUTO) 카드 */}
            <div
              onClick={() => setDraftMethod('AUTO')}
              style={{
                padding: '11px 12px',
                borderRadius: 9,
                border: draftMethod === 'AUTO' ? '2px solid #2563EB' : '1px solid #CBD5E1',
                background: draftMethod === 'AUTO' ? '#EFF6FF' : '#FFFFFF',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={draftMethod === 'AUTO'} onChange={() => setDraftMethod('AUTO')} />
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#1E3A8A' }}>
                    ✨ 자동 선택 (AUTO · 권장)
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: '#1D4ED8',
                    color: '#FFFFFF',
                  }}
                >
                  추천 {recommendation.method}
                </span>
              </div>
              <div style={{ fontSize: 10.8, color: '#1E40AF', fontWeight: 700, lineHeight: 1.45 }}>
                {recommendation.reasonKo}
              </div>
            </div>

            <div style={{ fontSize: 10.8, fontWeight: 800, color: '#475569', marginTop: 2 }}>
              개별 모델 직접 선택:
            </div>

            {(['ENRTL', 'NRTL', 'PR', 'SRK'] as const).map(mCode => {
              const info = PROPERTY_METHOD_INFO[mCode];
              const isManualSelected = draftMethod === mCode;
              const isAutoActive = draftMethod === 'AUTO' && recommendation.method === mCode;
              return (
                <div
                  key={mCode}
                  onClick={() => setDraftMethod(mCode)}
                  style={{
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: isManualSelected
                      ? `1.8px solid ${info.accent}`
                      : isAutoActive
                        ? `1.5px dashed ${info.accent}`
                        : '1px solid #CBD5E1',
                    background: isManualSelected ? info.bg : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        checked={isManualSelected}
                        onChange={() => setDraftMethod(mCode)}
                      />
                      <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                        {info.labelKo}
                      </span>
                    </div>
                    {isAutoActive && (
                      <span
                        style={{
                          fontSize: 9.2,
                          fontWeight: 900,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: info.bg,
                          border: `1px solid ${info.border}`,
                          color: info.accent,
                        }}
                      >
                        AUTO 활성
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#334155', fontFamily: 'JetBrains Mono, monospace' }}>
                    {info.formulaDesc}
                  </div>
                  <div style={{ fontSize: 10.2, color: '#64748B', lineHeight: 1.4 }}>
                    적합: {info.bestForKo}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 하단 선택 성분 요약 + 적용 버튼 바 */}
        <div
          style={{
            padding: '10px 18px',
            background: '#F1F5F9',
            borderTop: '1px solid #CBD5E1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
              maxHeight: 48,
              overflowY: 'auto',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#334155', marginRight: 4 }}>
              선택 ({draftComps.length}):
            </span>
            {draftComps.map(c => (
              <span
                key={c}
                onClick={() => toggleComp(c)}
                title="클릭하여 제거"
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: '#FFFFFF',
                  border: '1px solid #94A3B8',
                  color: '#0F172A',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {c} ×
              </span>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isMobile ? 'flex-end' : undefined,
              width: isMobile ? '100%' : undefined,
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draftComps, draftMethod);
                onClose();
              }}
              style={{
                padding: '7px 18px',
                borderRadius: 7,
                border: '1px solid #1D4ED8',
                background: '#2563EB',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
              }}
            >
              ✓ 적용 및 재계산
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

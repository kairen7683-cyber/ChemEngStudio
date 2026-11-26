'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useUnitStore } from '@/lib/stores/unitStore';
import { useAuth } from '@/components/auth/AuthContext';
import { FlaskCompIcon } from '@/components/ui/EngIcons';
import {
  ADD_COMPONENT_TO_SIM_EVENT,
  CUSTOM_COMPONENTS_UPDATED_EVENT,
  deleteCustomComponent,
  fetchAndRegisterCustomComponents,
  getRegisteredCustomComponents,
  requestNewCustomComponent,
  reviewCustomComponent,
  type CustomComponentRecord,
} from '@/lib/calculations/dynamicComponents';

interface ComponentRequestModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = 'request' | 'registry';

function fmtNum(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(digits);
}

function calcAntoineAtTb(rec: CustomComponentRecord): number {
  const denom = Math.max(15.0, Number(rec.tb_c) + Number(rec.antoine_c));
  return Math.pow(10, Number(rec.antoine_a) - Number(rec.antoine_b) / denom);
}

export default function ComponentRequestModal({ open, onClose }: ComponentRequestModalProps) {
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const { authenticated, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState<ModalTab>('request');

  // Form states (Tab 1)
  const [query, setQuery] = useState('');
  const [nameKo, setNameKo] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [tbInput, setTbInput] = useState('');
  const [rhoInput, setRhoInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createdRecord, setCreatedRecord] = useState<CustomComponentRecord | null>(null);
  const [addedKeyFeedback, setAddedKeyFeedback] = useState<string | null>(null);

  // Registry states (Tab 2)
  const [registryItems, setRegistryItems] = useState<CustomComponentRecord[]>(() =>
    getRegisteredCustomComponents()
  );
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadRegistry = useCallback(async () => {
    setLoadingRegistry(true);
    setRegistryError(null);
    try {
      const items = await fetchAndRegisterCustomComponents();
      setRegistryItems(items);
    } catch (err) {
      setRegistryError(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to load community component registry.'
            : '커뮤니티 물질 DB를 불러오지 못했습니다.'
      );
    } finally {
      setLoadingRegistry(false);
    }
  }, [isEn]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setAddedKeyFeedback(null);
    void loadRegistry();
  }, [open, loadRegistry]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUpdated = () => {
      setRegistryItems(getRegisteredCustomComponents());
    };
    window.addEventListener(CUSTOM_COMPONENTS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(CUSTOM_COMPONENTS_UPDATED_EVENT, onUpdated);
  }, []);

  if (!open) return null;

  const dispatchAddToSimulator = (compKey: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(ADD_COMPONENT_TO_SIM_EVENT, {
        detail: { compKey },
      })
    );
    setAddedKeyFeedback(compKey);
    window.setTimeout(() => {
      setAddedKeyFeedback(prev => (prev === compKey ? null : prev));
    }, 2400);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticated) {
      setErrorMsg(
        isEn
          ? 'Please sign in first to request and register a new component.'
          : '새 물질을 자동 조회·등록하려면 먼저 로그인해 주세요.'
      );
      return;
    }
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setErrorMsg(
        isEn
          ? 'Please enter a component name, CAS number, or chemical formula.'
          : '물질명, CAS 번호 또는 화학식을 입력해 주세요.'
      );
      return;
    }

    const parsedTb = tbInput.trim() !== '' ? Number(tbInput.trim()) : null;
    if (parsedTb !== null && Number.isNaN(parsedTb)) {
      setErrorMsg(
        isEn ? 'Normal boiling point Tb must be a valid number.' : '정상비점 Tb는 숫자로 입력해 주세요.'
      );
      return;
    }
    const parsedRho = rhoInput.trim() !== '' ? Number(rhoInput.trim()) : null;
    if (parsedRho !== null && (Number.isNaN(parsedRho) || parsedRho <= 0)) {
      setErrorMsg(
        isEn
          ? 'Liquid density at 25°C must be a positive number.'
          : '액체 밀도(25°C)는 양의 숫자로 입력해 주세요.'
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setCreatedRecord(null);
    try {
      const rec = await requestNewCustomComponent({
        query: cleanQuery,
        name_ko: isEn ? undefined : nameKo.trim() || undefined,
        tb_c: parsedTb,
        rho_l_25: parsedRho,
        note: noteInput.trim() || undefined,
      });
      setCreatedRecord(rec);
      setRegistryItems(getRegisteredCustomComponents());
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to fetch and calibrate component properties.'
            : '물성 자동 조회 및 보정에 실패했습니다.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveGlobal = async (rec: CustomComponentRecord) => {
    setBusyId(rec.id);
    setRegistryError(null);
    try {
      const updated = await reviewCustomComponent(rec.id, { status: 'approved' });
      setRegistryItems(updated);
    } catch (err) {
      setRegistryError(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to approve component.'
            : '공식 DB 승격에 실패했습니다.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rec: CustomComponentRecord) => {
    setBusyId(rec.id);
    setRegistryError(null);
    try {
      const updated = await deleteCustomComponent(rec.id);
      setRegistryItems(updated);
      if (createdRecord?.id === rec.id) {
        setCreatedRecord(null);
      }
    } catch (err) {
      setRegistryError(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to delete component.'
            : '물질 삭제에 실패했습니다.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const visibleRegistry = registryItems.filter(
    r => r.status === 'approved' || r.status === 'pending'
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? 'Component Request & Registry' : '물질 등록 요청 및 커뮤니티 DB'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10030,
        background: 'rgba(15, 23, 42, 0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '88vh',
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.34)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#0F172A',
            color: '#F8FAFC',
            padding: '13px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #1E293B',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: '#1E3A8A',
                color: '#FFFFFF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FlaskCompIcon size={15} />
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.2px' }}>
                {isEn ? 'Component Request & Community DB' : '물질 등록 요청 · 커뮤니티 물성 DB'}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                {isEn
                  ? 'Auto-fetch PubChem properties, calibrate Tc/Pc/ω/Antoine, and use immediately'
                  : 'PubChem 실측 조회 · 임계물성/Antoine 자동 보정 후 시뮬레이터 즉시 사용'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? 'Close' : '닫기'}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid #334155',
              background: '#1E293B',
              color: '#CBD5E1',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            padding: '0 16px',
            gap: 4,
          }}
        >
          {(
            [
              {
                id: 'request' as ModalTab,
                label: isEn ? 'Request New Component' : '새 물질 등록 요청',
              },
              {
                id: 'registry' as ModalTab,
                label: isEn
                  ? `Community Registry (${visibleRegistry.length})`
                  : `커뮤니티 DB 현황 (${visibleRegistry.length})`,
              },
            ]
          ).map(item => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  if (item.id === 'registry') void loadRegistry();
                }}
                style={{
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: active ? '2.5px solid #1E3A8A' : '2.5px solid transparent',
                  background: 'transparent',
                  color: active ? '#1E3A8A' : '#64748B',
                  fontSize: 12.2,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div
          style={{
            padding: '16px 18px 18px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {tab === 'request' ? (
            <>
              {!authenticated && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#334155',
                    fontSize: 12,
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 3 }}>
                    {isEn ? 'Sign-in Required' : '로그인이 필요합니다'}
                  </div>
                  <div>
                    {isEn
                      ? 'Please sign in from the top-right account menu to request and register new chemical components. You can still browse approved community components in the Registry tab.'
                      : '새 물질 자동 조회 및 등록 요청은 로그인 후 이용할 수 있습니다. 우측 상단 계정 메뉴에서 로그인해 주세요. 승인된 커뮤니티 DB 물질은 [커뮤니티 DB 현황] 탭에서 바로 확인할 수 있습니다.'}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11.8,
                      fontWeight: 700,
                      color: '#0F172A',
                      marginBottom: 5,
                    }}
                  >
                    {isEn ? 'Name / CAS No. / Formula' : '물질명 · CAS 번호 · 화학식'}{' '}
                    <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    disabled={!authenticated || submitting}
                    placeholder="NMP, 872-50-4, Fluoroethylene carbonate, C3H3FO3"
                    style={{
                      width: '100%',
                      padding: '9px 11px',
                      borderRadius: 7,
                      border: '1px solid #CBD5E1',
                      background: authenticated ? '#FFFFFF' : '#F1F5F9',
                      color: '#0F172A',
                      fontSize: 12.5,
                      outline: 'none',
                    }}
                  />
                </div>

                {!isEn && (
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 11.8,
                        fontWeight: 700,
                        color: '#334155',
                        marginBottom: 5,
                      }}
                    >
                      한글 표시명 (선택)
                    </label>
                    <input
                      type="text"
                      value={nameKo}
                      onChange={e => setNameKo(e.target.value)}
                      disabled={!authenticated || submitting}
                      placeholder="예: 플루오로에틸렌 카보네이트"
                      style={{
                        width: '100%',
                        padding: '8px 11px',
                        borderRadius: 7,
                        border: '1px solid #CBD5E1',
                        background: authenticated ? '#FFFFFF' : '#F1F5F9',
                        color: '#0F172A',
                        fontSize: 12.3,
                        outline: 'none',
                      }}
                    />
                  </div>
                )}

                {/* Collapsible Optional Experimental Inputs */}
                <div
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    background: '#F8FAFC',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowOptional(v => !v)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'transparent',
                      color: '#334155',
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>
                      {isEn
                        ? 'Optional Experimental Overrides (Tb, ρ_L, Note)'
                        : '선택 실측값 · 요청 메모 입력 (선택)'}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B' }}>
                      {showOptional ? '▲' : '▼'}
                    </span>
                  </button>

                  {showOptional && (
                    <div
                      style={{
                        padding: '4px 12px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        borderTop: '1px solid #E2E8F0',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: 11.2,
                              fontWeight: 700,
                              color: '#475569',
                              marginBottom: 4,
                            }}
                          >
                            {isEn ? 'Normal Boiling Point Tb (°C)' : '정상비점 Tb (°C)'}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={tbInput}
                            onChange={e => setTbInput(e.target.value)}
                            disabled={!authenticated || submitting}
                            placeholder={isEn ? 'e.g. 212.0' : '예: 212.0'}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              borderRadius: 6,
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: 12,
                            }}
                          />
                        </div>
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: 11.2,
                              fontWeight: 700,
                              color: '#475569',
                              marginBottom: 4,
                            }}
                          >
                            {isEn ? 'Liquid Density 25°C (kg/m³)' : '액체 밀도 25°C (kg/m³)'}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={rhoInput}
                            onChange={e => setRhoInput(e.target.value)}
                            disabled={!authenticated || submitting}
                            placeholder={isEn ? 'e.g. 1454' : '예: 1454'}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              borderRadius: 6,
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: 12,
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 11.2,
                            fontWeight: 700,
                            color: '#475569',
                            marginBottom: 4,
                          }}
                        >
                          {isEn ? 'Request Note (Optional)' : '요청 메모 (선택)'}
                        </label>
                        <input
                          type="text"
                          value={noteInput}
                          onChange={e => setNoteInput(e.target.value)}
                          disabled={!authenticated || submitting}
                          placeholder={
                            isEn
                              ? 'Process context or reference SDS/literature'
                              : '사용 공정 또는 참고 문헌/SDS 메모'
                          }
                          style={{
                            width: '100%',
                            padding: '7px 10px',
                            borderRadius: 6,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            fontSize: 12,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {errorMsg && (
                  <div
                    style={{
                      padding: '9px 12px',
                      borderRadius: 7,
                      border: '1px solid #FECACA',
                      background: '#FEF2F2',
                      color: '#B91C1C',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {errorMsg}
                  </div>
                )}

                {submitting && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #BFDBFE',
                      background: '#EFF6FF',
                      color: '#1E3A8A',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#1E3A8A',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span>
                      {isEn
                        ? 'Querying PubChem → Calibrating Critical Props & Antoine → Registering...'
                        : 'PubChem 실측 조회 → 임계물성/Antoine 역보정 → DB 등록 중...'}
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 7,
                      border: '1px solid #CBD5E1',
                      background: '#FFFFFF',
                      color: '#334155',
                      fontSize: 12.2,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {isEn ? 'Close' : '닫기'}
                  </button>
                  <button
                    type="submit"
                    disabled={!authenticated || submitting || !query.trim()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 7,
                      border: '1px solid #1E3A8A',
                      background:
                        !authenticated || submitting || !query.trim() ? '#94A3B8' : '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: 12.3,
                      fontWeight: 800,
                      cursor:
                        !authenticated || submitting || !query.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting
                      ? isEn
                        ? 'Processing...'
                        : '조회 · 보정 중...'
                      : isEn
                        ? 'Auto-Fetch, Calibrate & Register'
                        : '자동 물성 조회 · 보정 및 등록'}
                  </button>
                </div>
              </form>

              {/* Calibrated Property Summary Card on Success */}
              {createdRecord && (
                <div
                  style={{
                    borderRadius: 10,
                    border: '1px solid #93C5FD',
                    background: '#F8FAFC',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 5,
                            background: '#1E3A8A',
                            color: '#FFFFFF',
                            fontSize: 11,
                            fontWeight: 800,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}
                        >
                          {createdRecord.comp_key}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A' }}>
                          {createdRecord.formula} (
                          {isEn
                            ? createdRecord.name_en || createdRecord.comp_key
                            : createdRecord.name_ko || createdRecord.name_en}
                          )
                        </span>
                      </div>
                      <div style={{ fontSize: 11.2, color: '#475569', marginTop: 3 }}>
                        CAS: <strong>{createdRecord.cas_no || 'N/A'}</strong>
                        {' · '}
                        <span
                          style={{
                            color: '#0F766E',
                            fontWeight: 700,
                          }}
                        >
                          Antoine(Tb) = {fmtNum(calcAntoineAtTb(createdRecord), 3)} barA ✓
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => dispatchAddToSimulator(createdRecord.comp_key)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 7,
                        border: '1px solid #1E3A8A',
                        background:
                          addedKeyFeedback === createdRecord.comp_key ? '#0F766E' : '#1E3A8A',
                        color: '#FFFFFF',
                        fontSize: 11.8,
                        fontWeight: 800,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {addedKeyFeedback === createdRecord.comp_key
                        ? isEn
                          ? 'Added to Simulator ✓'
                          : '시뮬레이터에 추가됨 ✓'
                        : isEn
                          ? '+ Add to Current Simulator'
                          : '+ 현재 시뮬레이터 성분에 바로 추가'}
                    </button>
                  </div>

                  {/* Calibrated Property Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    {[
                      { k: 'MW', v: `${fmtNum(createdRecord.mw, 2)} g/mol` },
                      { k: 'Tb', v: `${fmtNum(createdRecord.tb_c, 1)} °C` },
                      { k: 'Tc', v: `${fmtNum(createdRecord.tc_c, 1)} °C` },
                      { k: 'Pc', v: `${fmtNum(createdRecord.pc_bar, 2)} bar` },
                      { k: 'ω', v: fmtNum(createdRecord.omega, 3) },
                      { k: 'ρ_L (25°C)', v: `${fmtNum(createdRecord.rho_l_25, 1)} kg/m³` },
                      { k: 'ΔH_vap', v: `${fmtNum(createdRecord.hvap_tb_kj_kg, 1)} kJ/kg` },
                      {
                        k: 'Status',
                        v:
                          createdRecord.status === 'approved'
                            ? isEn
                              ? 'Approved'
                              : '공식 승인'
                            : isEn
                              ? 'Pending (Ready)'
                              : '검토 대기 (즉시 사용)',
                      },
                    ].map(cell => (
                      <div
                        key={cell.k}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: 6,
                          padding: '6px 8px',
                        }}
                      >
                        <div style={{ fontSize: 10.2, color: '#64748B', fontWeight: 700 }}>
                          {cell.k}
                        </div>
                        <div
                          style={{
                            fontSize: 11.8,
                            color: '#0F172A',
                            fontWeight: 800,
                            marginTop: 2,
                          }}
                        >
                          {cell.v}
                        </div>
                      </div>
                    ))}
                  </div>

                  {(createdRecord.source_summary || createdRecord.calibration_note) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#475569',
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: 6,
                        padding: '8px 10px',
                        lineHeight: 1.5,
                      }}
                    >
                      {createdRecord.source_summary && (
                        <div>
                          <strong style={{ color: '#0F172A' }}>
                            {isEn ? 'Source: ' : '출처: '}
                          </strong>
                          {createdRecord.source_summary}
                        </div>
                      )}
                      {createdRecord.calibration_note && (
                        <div style={{ marginTop: 2 }}>
                          <strong style={{ color: '#0F172A' }}>
                            {isEn ? 'Calibration: ' : '보정 내역: '}
                          </strong>
                          {createdRecord.calibration_note}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Tab 2: Community Registry */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.8, color: '#475569' }}>
                  {isEn
                    ? 'Approved community components and your pending requests are active in the solver.'
                    : '공식 승인된 커뮤니티 물질과 본인이 요청한 대기 물질은 시뮬레이터에서 즉시 사용할 수 있습니다.'}
                </div>
                <button
                  type="button"
                  onClick={() => void loadRegistry()}
                  disabled={loadingRegistry}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#334155',
                    fontSize: 11.2,
                    fontWeight: 700,
                    cursor: loadingRegistry ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {loadingRegistry
                    ? isEn
                      ? 'Loading...'
                      : '불러오는 중...'
                    : isEn
                      ? 'Refresh'
                      : '새로고침'}
                </button>
              </div>

              {registryError && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 7,
                    border: '1px solid #FECACA',
                    background: '#FEF2F2',
                    color: '#B91C1C',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {registryError}
                </div>
              )}

              {loadingRegistry && visibleRegistry.length === 0 ? (
                <div
                  style={{
                    padding: '28px 16px',
                    textAlign: 'center',
                    color: '#64748B',
                    fontSize: 12.2,
                  }}
                >
                  {isEn ? 'Loading community components...' : '커뮤니티 물질 DB를 조회하는 중...'}
                </div>
              ) : visibleRegistry.length === 0 ? (
                <div
                  style={{
                    padding: '28px 16px',
                    textAlign: 'center',
                    color: '#64748B',
                    fontSize: 12.2,
                    border: '1px dashed #CBD5E1',
                    borderRadius: 8,
                    background: '#F8FAFC',
                  }}
                >
                  {isEn
                    ? 'No custom components registered yet. Request one in the first tab!'
                    : '아직 등록된 커뮤니티 물질이 없습니다. 첫 번째 탭에서 새 물질을 요청해 보세요.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibleRegistry.map(rec => {
                    const isApproved = rec.status === 'approved';
                    const isBusy = busyId === rec.id;
                    const justAdded = addedKeyFeedback === rec.comp_key;
                    return (
                      <div
                        key={rec.id ?? rec.comp_key}
                        style={{
                          border: '1px solid #E2E8F0',
                          borderRadius: 9,
                          padding: '10px 12px',
                          background: '#FFFFFF',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 7,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: isApproved ? '#10B981' : '#F59E0B',
                                  display: 'inline-block',
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 12.8,
                                  fontWeight: 800,
                                  color: '#0F172A',
                                }}
                              >
                                {rec.formula} (
                                {isEn ? rec.name_en || rec.comp_key : rec.name_ko || rec.name_en})
                              </span>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  background: '#F1F5F9',
                                  color: '#334155',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                }}
                              >
                                {rec.comp_key}
                              </span>
                            </div>

                            <div
                              style={{
                                fontSize: 11,
                                color: isApproved ? '#047857' : '#B45309',
                                fontWeight: 700,
                                marginTop: 2,
                              }}
                            >
                              {isApproved
                                ? isEn
                                  ? 'Approved Global DB'
                                  : '공식 DB 승인'
                                : isEn
                                  ? 'Pending Review · Ready in Your Simulator'
                                  : '검토 대기 · 내 시뮬레이터 즉시 사용 가능'}
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => dispatchAddToSimulator(rec.comp_key)}
                              style={{
                                padding: '5px 9px',
                                borderRadius: 6,
                                border: '1px solid #1E3A8A',
                                background: justAdded ? '#0F766E' : '#EFF6FF',
                                color: justAdded ? '#FFFFFF' : '#1E3A8A',
                                fontSize: 11.2,
                                fontWeight: 800,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {justAdded
                                ? isEn
                                  ? 'Added ✓'
                                  : '추가됨 ✓'
                                : isEn
                                  ? '+ Add to Simulator'
                                  : '+ 시뮬레이터에 추가'}
                            </button>

                            {isAdmin && !isApproved && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleApproveGlobal(rec)}
                                style={{
                                  padding: '5px 9px',
                                  borderRadius: 6,
                                  border: '1px solid #047857',
                                  background: '#ECFDF5',
                                  color: '#047857',
                                  fontSize: 11.2,
                                  fontWeight: 800,
                                  cursor: isBusy ? 'wait' : 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isEn ? 'Approve Global' : '공식 DB 승격'}
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleDelete(rec)}
                                style={{
                                  padding: '5px 9px',
                                  borderRadius: 6,
                                  border: '1px solid #FECACA',
                                  background: '#FEF2F2',
                                  color: '#B91C1C',
                                  fontSize: 11.2,
                                  fontWeight: 700,
                                  cursor: isBusy ? 'wait' : 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isEn ? 'Delete' : '삭제'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px 14px',
                            fontSize: 11.2,
                            color: '#475569',
                            paddingTop: 4,
                            borderTop: '1px solid #F1F5F9',
                          }}
                        >
                          <span>
                            MW: <strong style={{ color: '#0F172A' }}>{fmtNum(rec.mw, 2)}</strong>
                          </span>
                          <span>
                            Tb: <strong style={{ color: '#0F172A' }}>{fmtNum(rec.tb_c, 1)}°C</strong>
                          </span>
                          <span>
                            Tc: <strong style={{ color: '#0F172A' }}>{fmtNum(rec.tc_c, 1)}°C</strong>
                          </span>
                          <span>
                            CAS: <strong style={{ color: '#0F172A' }}>{rec.cas_no || 'N/A'}</strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

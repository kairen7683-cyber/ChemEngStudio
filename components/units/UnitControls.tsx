'use client';

import React, { useEffect, useRef, useState } from 'react';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import { SlidersParamIcon } from '@/components/ui/EngIcons';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  UNIT_PRESETS,
  UNIT_QUANTITIES,
  fromCanonical,
  getUnitOption,
  toCanonical,
  type UnitQuantity,
} from '@/lib/units/unitSystem';
import { TAG_STANDARDS } from '@/lib/units/tagNaming';
import {
  QUANTITY_LABELS_EN,
  TAG_STANDARD_TEXT_EN,
  UNIT_PRESET_NAMES_EN,
  t,
  type AppLang,
} from '@/lib/i18n/uiText';

function roundClean(v: number, digits = 5): number {
  if (!Number.isFinite(v)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * 전역 기본 단위를 따르되, 개별 행/입력창에서 사용자가 드롭다운으로 단위를 바꾸면
 * 해당 컴포넌트에서만 독립적으로 유지하고, 헤더에서 전역 기본 단위를 변경하면 즉시 동기화합니다.
 */
export function useLocalUnit(
  quantity: UnitQuantity,
  controlledUnitId?: string
): [string, (nextUnitId: string) => void] {
  const globalUnit = useUnitStore(s => s.units[quantity]);
  const revision = useUnitStore(s => s.revision);
  const hydrate = useUnitStore(s => s.hydrate);
  const [override, setOverride] = useState<{ rev: number; id: string } | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const activeId =
    controlledUnitId ?? (override && override.rev === revision ? override.id : globalUnit);

  const setUnitId = (nextUnitId: string) => {
    setOverride({ rev: revision, id: nextUnitId });
  };

  return [activeId, setUnitId];
}

export interface UnitSelectProps {
  quantity: UnitQuantity;
  value: string;
  onChange: (nextUnitId: string) => void;
  size?: 'xs' | 'sm';
  style?: React.CSSProperties;
  title?: string;
  disabled?: boolean;
}

export function UnitSelect({
  quantity,
  value,
  onChange,
  size = 'xs',
  style,
  title,
  disabled,
}: UnitSelectProps) {
  const meta = UNIT_QUANTITIES[quantity];
  const lang = useUnitStore(s => s.lang);
  const defaultTitle =
    lang === 'en'
      ? `Change ${QUANTITY_LABELS_EN[quantity]} unit`
      : `${meta.labelKo} 단위 변경`;
  return (
    <select
      value={value}
      disabled={disabled}
      title={title ?? defaultTitle}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onChange={e => {
        e.stopPropagation();
        onChange(e.target.value);
      }}
      style={{
        fontSize: size === 'xs' ? 10 : 11,
        fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        color: '#334155',
        background: '#F8FAFC',
        border: '1px solid #CBD5E1',
        borderRadius: 4,
        padding: size === 'xs' ? '1px 2px' : '2px 4px',
        cursor: disabled ? 'default' : 'pointer',
        outline: 'none',
        maxWidth: '100%',
        ...style,
      }}
    >
      {meta.options.map(opt => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export interface UnitNumberInputProps {
  quantity: UnitQuantity;
  /** Canonical internal value expected by the solver */
  value: number;
  /** Called with converted canonical internal value */
  onValueChange: (canonicalVal: number) => void;
  unitId?: string;
  onUnitChange?: (unitId: string) => void;
  onEnterRun?: () => void;
  syncKey?: string | number;
  minCanonical?: number;
  maxCanonical?: number;
  decimals?: number;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  inputStyle?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
}

export function UnitNumberInput({
  quantity,
  value,
  onValueChange,
  unitId,
  onUnitChange,
  onEnterRun,
  syncKey,
  minCanonical,
  maxCanonical,
  decimals,
  disabled,
  placeholder,
  title,
  inputStyle,
  selectStyle,
  containerStyle,
}: UnitNumberInputProps) {
  const [localUnitId, setLocalUnitId] = useLocalUnit(quantity, unitId);
  const activeUnitId = unitId ?? localUnitId;
  const opt = getUnitOption(quantity, activeUnitId);

  const displayDigits = decimals ?? Math.max(2, (opt.decimals ?? 2) + 1);
  const displayVal = roundClean(fromCanonical(quantity, value, activeUnitId), displayDigits);
  const minDisplay =
    minCanonical !== undefined ? fromCanonical(quantity, minCanonical, activeUnitId) : undefined;
  const maxDisplay =
    maxCanonical !== undefined ? fromCanonical(quantity, maxCanonical, activeUnitId) : undefined;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 3,
        width: '100%',
        minWidth: 0,
        ...containerStyle,
      }}
    >
      <BufferedNumberInput
        syncKey={`${syncKey ?? ''}:${activeUnitId}`}
        value={displayVal}
        min={minDisplay}
        max={maxDisplay}
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        onEnterRun={onEnterRun}
        onValueChange={nextDisp => {
          const nextCan = roundClean(toCanonical(quantity, nextDisp, activeUnitId), 6);
          onValueChange(nextCan);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          ...inputStyle,
        }}
      />
      <UnitSelect
        quantity={quantity}
        value={activeUnitId}
        disabled={disabled}
        onChange={nextId => {
          if (onUnitChange) onUnitChange(nextId);
          else setLocalUnitId(nextId);
        }}
        size="xs"
        style={{
          flexShrink: 0,
          minWidth: 56,
          ...selectStyle,
        }}
      />
    </div>
  );
}

export interface UnitNullableNumberInputProps {
  quantity: UnitQuantity;
  value: number | undefined;
  onValueChange: (canonicalVal: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  inputStyle?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
}

export function UnitNullableNumberInput({
  quantity,
  value,
  onValueChange,
  placeholder,
  disabled,
  inputStyle,
  selectStyle,
  containerStyle,
}: UnitNullableNumberInputProps) {
  const [localUnitId, setLocalUnitId] = useLocalUnit(quantity);
  const opt = getUnitOption(quantity, localUnitId);
  const displayDigits = Math.max(2, (opt.decimals ?? 2) + 1);
  const formatted =
    value !== undefined && Number.isFinite(value)
      ? String(roundClean(fromCanonical(quantity, value, localUnitId), displayDigits))
      : '';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 3,
        width: '100%',
        minWidth: 0,
        ...containerStyle,
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={formatted}
        onChange={e => {
          const raw = e.target.value.trim();
          if (raw === '') {
            onValueChange(undefined);
            return;
          }
          const num = Number(raw);
          if (Number.isFinite(num)) {
            onValueChange(roundClean(toCanonical(quantity, num, localUnitId), 6));
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          ...inputStyle,
        }}
      />
      <UnitSelect
        quantity={quantity}
        value={localUnitId}
        disabled={disabled}
        onChange={setLocalUnitId}
        size="xs"
        style={{
          flexShrink: 0,
          minWidth: 56,
          ...selectStyle,
        }}
      />
    </div>
  );
}

const MODAL_QUANTITIES: UnitQuantity[] = [
  'temp',
  'pressG',
  'deltaP',
  'massFlow',
  'molarFlow',
  'volFlow',
  'heatDuty',
  'power',
  'density',
  'cp',
  'htc',
  'fouling',
  'area',
  'volume',
  'length',
  'velocity',
  'viscosity',
];

export function HeaderUnitSettingsButton({ isMobile = false }: { isMobile?: boolean }) {
  const units = useUnitStore(s => s.units);
  const presetId = useUnitStore(s => s.presetId);
  const tagStandard = useUnitStore(s => s.tagStandard);
  const lang = useUnitStore(s => s.lang);
  const hydrate = useUnitStore(s => s.hydrate);
  const setUnit = useUnitStore(s => s.setUnit);
  const applyPreset = useUnitStore(s => s.applyPreset);
  const setTagStandard = useUnitStore(s => s.setTagStandard);
  const setLang = useUnitStore(s => s.setLang);
  const resetDefaults = useUnitStore(s => s.resetDefaults);

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const activePresetMeta = UNIT_PRESETS.find(p => p.id === presetId);
  const shortBadge = activePresetMeta ? activePresetMeta.shortName : t(lang, 'unit_btn_custom');
  const activePresetName = activePresetMeta
    ? lang === 'en'
      ? UNIT_PRESET_NAMES_EN[activePresetMeta.id]
      : activePresetMeta.name
    : '';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t(lang, 'unit_btn_title')}
        style={{
          padding: isMobile ? '4px 7px' : '4px 9px',
          borderRadius: 6,
          border: open ? '1px solid #60A5FA' : '1px solid #334155',
          background: open ? '#1E3A8A' : '#1E293B',
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
        <SlidersParamIcon size={12} />
        <span>{isMobile ? shortBadge : `${t(lang, 'unit_btn_prefix')} · ${shortBadge}`}</span>
        <span style={{ fontSize: 9, opacity: 0.75 }}>▾</span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: isMobile ? 'flex-end' : 'center',
            justifyContent: 'center',
            padding: isMobile ? 0 : 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: isMobile ? '100%' : 580,
              maxWidth: '100%',
              maxHeight: isMobile ? '86vh' : '88vh',
              background: '#FFFFFF',
              borderRadius: isMobile ? '14px 14px 0 0' : 10,
              border: '1px solid #CBD5E1',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.28)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              color: '#0F172A',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 16px',
                background: '#0F172A',
                color: '#F8FAFC',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <SlidersParamIcon size={15} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{t(lang, 'unit_modal_title')}</div>
                  <div style={{ fontSize: 10.5, color: '#94A3B8' }}>
                    {t(lang, 'unit_modal_subtitle')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  border: '1px solid #334155',
                  background: '#1E293B',
                  color: '#E2E8F0',
                  borderRadius: 6,
                  padding: '4px 9px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t(lang, 'unit_modal_close')}
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Language Switcher */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
                  {t(lang, 'unit_modal_lang_heading')}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                  }}
                >
                  {(
                    [
                      { id: 'ko' as AppLang, label: '한국어 (KO)', desc: t(lang, 'unit_modal_lang_ko_desc') },
                      { id: 'en' as AppLang, label: 'English (EN)', desc: t(lang, 'unit_modal_lang_en_desc') },
                    ]
                  ).map(opt => {
                    const active = lang === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLang(opt.id)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 7,
                          border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: active ? '#EFF6FF' : '#F8FAFC',
                          color: '#0F172A',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: active ? '#1E3A8A' : '#0F172A' }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3, lineHeight: 1.35 }}>
                          {opt.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment Tag Naming Standard */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
                  {t(lang, 'unit_modal_tag_heading')}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: 6,
                  }}
                >
                  {TAG_STANDARDS.map(std => {
                    const active = tagStandard === std.id;
                    const stdName = lang === 'en' ? TAG_STANDARD_TEXT_EN[std.id].name : std.name;
                    const stdDesc = lang === 'en' ? TAG_STANDARD_TEXT_EN[std.id].desc : std.desc;
                    return (
                      <button
                        key={std.id}
                        type="button"
                        onClick={() => setTagStandard(std.id)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 7,
                          border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: active ? '#EFF6FF' : '#F8FAFC',
                          color: '#0F172A',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: active ? '#1E3A8A' : '#0F172A' }}>
                          {stdName}
                        </div>
                        <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3, lineHeight: 1.35 }}>
                          {stdDesc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Presets */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
                  {t(lang, 'unit_modal_preset_heading')}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                    gap: 6,
                  }}
                >
                  {UNIT_PRESETS.map(p => {
                    const active = presetId === p.id;
                    const presetName = lang === 'en' ? UNIT_PRESET_NAMES_EN[p.id] : p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPreset(p.id)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 9px',
                          borderRadius: 7,
                          border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: active ? '#EFF6FF' : '#F8FAFC',
                          color: '#0F172A',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: active ? '#1E3A8A' : '#0F172A' }}>
                          {presetName}
                        </div>
                        <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3, lineHeight: 1.3 }}>
                          {p.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Per-quantity overrides */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>
                    {t(lang, 'unit_modal_override_heading')}
                  </span>
                  <span style={{ fontSize: 10, color: '#64748B' }}>
                    {presetId === 'CUSTOM'
                      ? t(lang, 'unit_modal_custom_badge')
                      : `${t(lang, 'unit_modal_preset_badge_prefix')} ${activePresetName}`}
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: 6,
                  }}
                >
                  {MODAL_QUANTITIES.map(q => {
                    const meta = UNIT_QUANTITIES[q];
                    return (
                      <div
                        key={q}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 9px',
                          borderRadius: 6,
                          border: '1px solid #E2E8F0',
                          background: '#FFFFFF',
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#1E293B' }}>
                          {lang === 'en' ? QUANTITY_LABELS_EN[q] : meta.labelKo}
                        </span>
                        <UnitSelect
                          quantity={q}
                          value={units[q]}
                          onChange={val => setUnit(q, val)}
                          size="sm"
                          style={{ minWidth: 96 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '10px 14px',
                borderTop: '1px solid #E2E8F0',
                background: '#F8FAFC',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 10.5, color: '#64748B' }}>
                {t(lang, 'unit_modal_footer_hint')}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={resetDefaults}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#334155',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t(lang, 'unit_modal_reset')}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: '1px solid #0F172A',
                    background: '#0F172A',
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t(lang, 'unit_modal_done')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

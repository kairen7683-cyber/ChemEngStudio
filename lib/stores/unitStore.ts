'use client';

import { create } from 'zustand';
import {
  DEFAULT_UNIT_PREFS,
  UNIT_PRESETS,
  UNIT_QUANTITIES,
  detectPresetId,
  type UnitPreferences,
  type UnitPresetId,
  type UnitQuantity,
} from '@/lib/units/unitSystem';
import { DEFAULT_TAG_STANDARD, type TagStandardId } from '@/lib/units/tagNaming';
import type { AppLang } from '@/lib/i18n/uiText';

const STORAGE_KEY = 'chemeng_unit_prefs_v1';
const TAG_STD_STORAGE_KEY = 'chemeng_tag_standard_v1';
const LANG_STORAGE_KEY = 'chemeng_lang_v1';

function loadInitialLang(): AppLang {
  if (typeof window === 'undefined') return 'ko';
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (raw === 'ko' || raw === 'en') return raw;
    const browserLang = (window.navigator?.language || '').toLowerCase();
    return browserLang.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

function saveLang(lang: AppLang): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
}

function loadInitialTagStandard(): TagStandardId {
  if (typeof window === 'undefined') return DEFAULT_TAG_STANDARD;
  try {
    const raw = window.localStorage.getItem(TAG_STD_STORAGE_KEY);
    if (raw === 'KR_JP' || raw === 'GLOBAL_US') return raw;
  } catch {
    // ignore
  }
  return DEFAULT_TAG_STANDARD;
}

function saveTagStandard(std: TagStandardId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAG_STD_STORAGE_KEY, std);
  } catch {
    // ignore
  }
}

function loadInitialUnits(): UnitPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_UNIT_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UNIT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UnitPreferences>;
    const merged: UnitPreferences = { ...DEFAULT_UNIT_PREFS };
    (Object.keys(UNIT_QUANTITIES) as UnitQuantity[]).forEach(q => {
      const candidate = parsed[q];
      if (candidate && UNIT_QUANTITIES[q].options.some(o => o.id === candidate)) {
        merged[q] = candidate;
      }
    });
    return merged;
  } catch {
    return { ...DEFAULT_UNIT_PREFS };
  }
}

function saveUnits(units: UnitPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
    window.dispatchEvent(new CustomEvent('chemeng-units-changed', { detail: units }));
  } catch {
    // ignore storage quota errors
  }
}

interface UnitStoreState {
  units: UnitPreferences;
  presetId: UnitPresetId;
  tagStandard: TagStandardId;
  lang: AppLang;
  hydrated: boolean;
  revision: number;
  hydrate: (force?: boolean) => void;
  setUnit: (quantity: UnitQuantity, unitId: string) => void;
  setUnits: (partial: Partial<UnitPreferences>) => void;
  applyPreset: (presetId: Exclude<UnitPresetId, 'CUSTOM'>) => void;
  setTagStandard: (std: TagStandardId) => void;
  setLang: (lang: AppLang) => void;
  resetDefaults: () => void;
}

export const useUnitStore = create<UnitStoreState>((set, get) => ({
  units: { ...DEFAULT_UNIT_PREFS },
  presetId: 'METRIC_ENG',
  tagStandard: DEFAULT_TAG_STANDARD,
  lang: 'ko',
  hydrated: false,
  revision: 0,

  hydrate: (force = false) => {
    if (get().hydrated && !force) return;
    const loaded = loadInitialUnits();
    const loadedTagStd = loadInitialTagStandard();
    const loadedLang = loadInitialLang();
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = loadedLang;
    }
    set(s => ({
      units: loaded,
      presetId: detectPresetId(loaded),
      tagStandard: loadedTagStd,
      lang: loadedLang,
      hydrated: true,
      revision: force ? s.revision + 1 : s.revision,
    }));
  },

  setTagStandard: std => {
    saveTagStandard(std);
    set({ tagStandard: std });
  },

  setLang: lang => {
    saveLang(lang);
    set({ lang });
  },

  setUnit: (quantity, unitId) => {
    const valid = UNIT_QUANTITIES[quantity].options.some(o => o.id === unitId);
    if (!valid) return;
    const next: UnitPreferences = { ...get().units, [quantity]: unitId };
    saveUnits(next);
    set(s => ({
      units: next,
      presetId: detectPresetId(next),
      revision: s.revision + 1,
    }));
  },

  setUnits: partial => {
    if (!partial || typeof partial !== 'object') return;
    const next: UnitPreferences = { ...get().units };
    let changed = false;
    (Object.keys(UNIT_QUANTITIES) as UnitQuantity[]).forEach(q => {
      const candidate = partial[q];
      if (
        typeof candidate === 'string' &&
        UNIT_QUANTITIES[q].options.some(o => o.id === candidate) &&
        next[q] !== candidate
      ) {
        next[q] = candidate;
        changed = true;
      }
    });
    if (!changed) return;
    saveUnits(next);
    set(s => ({
      units: next,
      presetId: detectPresetId(next),
      revision: s.revision + 1,
    }));
  },

  applyPreset: presetId => {
    const found = UNIT_PRESETS.find(p => p.id === presetId);
    if (!found) return;
    const next: UnitPreferences = { ...found.units };
    saveUnits(next);
    set(s => ({
      units: next,
      presetId: found.id,
      revision: s.revision + 1,
    }));
  },

  resetDefaults: () => {
    const next: UnitPreferences = { ...DEFAULT_UNIT_PREFS };
    saveUnits(next);
    set(s => ({
      units: next,
      presetId: 'METRIC_ENG',
      revision: s.revision + 1,
    }));
  },
}));

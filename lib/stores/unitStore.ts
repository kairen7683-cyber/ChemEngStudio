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

const STORAGE_KEY = 'chemeng_unit_prefs_v1';
const TAG_STD_STORAGE_KEY = 'chemeng_tag_standard_v1';

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
  hydrated: boolean;
  revision: number;
  hydrate: () => void;
  setUnit: (quantity: UnitQuantity, unitId: string) => void;
  applyPreset: (presetId: Exclude<UnitPresetId, 'CUSTOM'>) => void;
  setTagStandard: (std: TagStandardId) => void;
  resetDefaults: () => void;
}

export const useUnitStore = create<UnitStoreState>((set, get) => ({
  units: { ...DEFAULT_UNIT_PREFS },
  presetId: 'METRIC_ENG',
  tagStandard: DEFAULT_TAG_STANDARD,
  hydrated: false,
  revision: 0,

  hydrate: () => {
    if (get().hydrated) return;
    const loaded = loadInitialUnits();
    const loadedTagStd = loadInitialTagStandard();
    set({
      units: loaded,
      presetId: detectPresetId(loaded),
      tagStandard: loadedTagStd,
      hydrated: true,
    });
  },

  setTagStandard: std => {
    saveTagStandard(std);
    set({ tagStandard: std });
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

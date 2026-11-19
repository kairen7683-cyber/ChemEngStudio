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

const STORAGE_KEY = 'chemeng_unit_prefs_v1';

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
  hydrated: boolean;
  revision: number;
  hydrate: () => void;
  setUnit: (quantity: UnitQuantity, unitId: string) => void;
  applyPreset: (presetId: Exclude<UnitPresetId, 'CUSTOM'>) => void;
  resetDefaults: () => void;
}

export const useUnitStore = create<UnitStoreState>((set, get) => ({
  units: { ...DEFAULT_UNIT_PREFS },
  presetId: 'METRIC_ENG',
  hydrated: false,
  revision: 0,

  hydrate: () => {
    if (get().hydrated) return;
    const loaded = loadInitialUnits();
    set({
      units: loaded,
      presetId: detectPresetId(loaded),
      hydrated: true,
    });
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

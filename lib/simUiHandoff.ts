'use client';

import type {
  FlowEdgeDef,
  FlowNodeDef,
  SimCompKey,
} from '@/lib/calculations/flowsheetSolver';
import type { SimPropertyMethod } from '@/lib/calculations/componentCatalog';

export type SimUiMode = 'modern' | 'classic';

export const SIM_UI_PREF_KEY = 'chemplant-sim-ui-pref-v1';
export const SIM_UI_HANDOFF_KEY = 'chemplant-ui-switch-handoff-v1';

export interface UiSwitchHandoffPayload {
  timestamp: number;
  fromUi: SimUiMode;
  title?: string;
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
  positions: Record<string, { x: number; y: number }>;
  activeComponents?: SimCompKey[];
  thermoMethod?: SimPropertyMethod;
}

export function getPreferredSimUiMode(): SimUiMode {
  if (typeof window === 'undefined') return 'modern';
  try {
    const v = window.localStorage.getItem(SIM_UI_PREF_KEY);
    return v === 'classic' ? 'classic' : 'modern';
  } catch {
    return 'modern';
  }
}

export function setPreferredSimUiMode(mode: SimUiMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIM_UI_PREF_KEY, mode);
  } catch {
    // ignore
  }
}

export function saveUiSwitchHandoff(payload: Omit<UiSwitchHandoffPayload, 'timestamp'>): void {
  if (typeof window === 'undefined') return;
  try {
    const full: UiSwitchHandoffPayload = {
      ...payload,
      timestamp: Date.now(),
    };
    window.sessionStorage.setItem(SIM_UI_HANDOFF_KEY, JSON.stringify(full));
  } catch {
    // ignore
  }
}

export function consumeUiSwitchHandoff(): UiSwitchHandoffPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SIM_UI_HANDOFF_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(SIM_UI_HANDOFF_KEY);
    const parsed = JSON.parse(raw) as UiSwitchHandoffPayload;
    if (!parsed || !Array.isArray(parsed.simDefs) || !Array.isArray(parsed.flowEdges)) {
      return null;
    }
    // 10분 이상 지난 일회성 핸드오프는 폐기
    if (Date.now() - Number(parsed.timestamp || 0) > 10 * 60 * 1000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

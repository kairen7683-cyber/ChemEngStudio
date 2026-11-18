import type { PlantId } from '@/lib/stores/balanceStore';

export const PENDING_CASE_LOAD_KEY = 'chemplant-pending-case-load-v1';
export const ACTIVE_CASE_TITLE_KEY = 'chemplant-active-case-title-v1';
export const PROJECTS_UPDATED_EVENT = 'chemplant:projects-updated';
export const LOAD_SAVED_CASE_EVENT = 'chemplant:load-saved-case';
export const OPEN_SHORTCUT_CALC_EVENT = 'chemplant:open-shortcut-calc';

export interface UnifiedSavedCaseEntry {
  uid: string;
  projectId: string;
  name: string;
  savedAt: string;
  storageKey: string;
  targetPlantId: PlantId;
  uiMode: 'modern' | 'classic';
  scopeLabel: string;
  nodeCount: number;
  rawProject: any;
}

export interface PendingCaseLoadPayload {
  action: 'load_project' | 'new_blank';
  targetPlantId: PlantId;
  uiMode: 'modern' | 'classic';
  caseName?: string;
  rawProject?: any;
  ts: number;
}

const CASE_STORAGE_SOURCES: Array<{
  storageKey: string;
  targetPlantId: PlantId;
  uiMode: 'modern' | 'classic';
  scopeLabel: string;
  isPlantDerived: boolean;
}> = [
  {
    storageKey: 'chemplant-builder-projects-v1',
    targetPlantId: 'new_builder',
    uiMode: 'modern',
    scopeLabel: '내 케이스',
    isPlantDerived: false,
  },
  {
    storageKey: 'chemplant-classic-sim-projects-v1',
    targetPlantId: 'classic_sim',
    uiMode: 'classic',
    scopeLabel: '클래식 케이스',
    isPlantDerived: false,
  },
  {
    storageKey: 'chemplant-plant02-projects-v1',
    targetPlantId: 'clorsim_sim',
    uiMode: 'modern',
    scopeLabel: '전해 파생',
    isPlantDerived: true,
  },
  {
    storageKey: 'chemplant-plant03-projects-v1',
    targetPlantId: 'hcl_synth',
    uiMode: 'modern',
    scopeLabel: '1A 염산 파생',
    isPlantDerived: true,
  },
  {
    storageKey: 'chemplant-plant04-projects-v1',
    targetPlantId: 'ech_gte',
    uiMode: 'modern',
    scopeLabel: 'ECH 파생',
    isPlantDerived: true,
  },
  {
    storageKey: 'chemplant-plant05-projects-v1',
    targetPlantId: 'cms_plant',
    uiMode: 'modern',
    scopeLabel: 'CMS 파생',
    isPlantDerived: true,
  },
  {
    storageKey: 'chemplant-plant06-projects-v1',
    targetPlantId: 'mdi_plant',
    uiMode: 'modern',
    scopeLabel: 'MDI 파생',
    isPlantDerived: true,
  },
];

export function listAllSavedUserCases(
  isAllowed: (pid: PlantId) => boolean
): UnifiedSavedCaseEntry[] {
  if (typeof window === 'undefined') return [];
  const entries: Array<UnifiedSavedCaseEntry & { _order: number }> = [];
  let orderIdx = 0;

  for (const src of CASE_STORAGE_SOURCES) {
    if (src.isPlantDerived && !isAllowed(src.targetPlantId)) continue;
    try {
      const raw = window.localStorage.getItem(src.storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const pid = String(item.id || `${src.storageKey}-${orderIdx}`);
        const name = String(item.name || '이름 없는 케이스');
        const savedAt = String(item.savedAt || '');
        const nodeCount = Number(
          item.nodeCount ??
            item.state?.simDefs?.length ??
            item.simDefs?.length ??
            0
        );
        entries.push({
          uid: `${src.storageKey}::${pid}`,
          projectId: pid,
          name,
          savedAt,
          storageKey: src.storageKey,
          targetPlantId: src.targetPlantId,
          uiMode: src.uiMode,
          scopeLabel: src.scopeLabel,
          nodeCount: Number.isFinite(nodeCount) ? nodeCount : 0,
          rawProject: item,
          _order: orderIdx++,
        });
      }
    } catch {
      // ignore corrupted storage entry
    }
  }

  entries.sort((a, b) => {
    const ta = Date.parse(a.savedAt);
    const tb = Date.parse(b.savedAt);
    if (!Number.isNaN(tb) && !Number.isNaN(ta) && tb !== ta) {
      return tb - ta;
    }
    return a._order - b._order;
  });

  return entries.map(({ _order: _unused, ...rest }) => rest);
}

export function stagePendingCaseLoad(
  payload: Omit<PendingCaseLoadPayload, 'ts'>
): void {
  if (typeof window === 'undefined') return;
  try {
    const full: PendingCaseLoadPayload = {
      ...payload,
      ts: Date.now(),
    };
    window.sessionStorage.setItem(PENDING_CASE_LOAD_KEY, JSON.stringify(full));
  } catch {
    // ignore storage quota errors
  }
}

export function consumePendingCaseLoad(
  expectedUiMode?: 'modern' | 'classic'
): PendingCaseLoadPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCaseLoadPayload;
    if (!parsed || typeof parsed !== 'object') {
      window.sessionStorage.removeItem(PENDING_CASE_LOAD_KEY);
      return null;
    }
    const ageMs = Date.now() - Number(parsed.ts || 0);
    if (ageMs < 0 || ageMs > 60 * 1000) {
      window.sessionStorage.removeItem(PENDING_CASE_LOAD_KEY);
      return null;
    }
    if (expectedUiMode && parsed.uiMode !== expectedUiMode) {
      return null;
    }
    window.sessionStorage.removeItem(PENDING_CASE_LOAD_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function notifyProjectsUpdated(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(PROJECTS_UPDATED_EVENT));
  } catch {
    // ignore dispatch errors
  }
}

export function deleteSavedUserCase(entry: UnifiedSavedCaseEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(entry.storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(
          item => item && String(item.id) !== String(entry.projectId)
        );
        window.localStorage.setItem(entry.storageKey, JSON.stringify(filtered));
      }
    }
    const curTitle = getActiveCaseTitle();
    if (
      curTitle &&
      curTitle.title === entry.name &&
      curTitle.plantId === entry.targetPlantId
    ) {
      window.localStorage.removeItem(ACTIVE_CASE_TITLE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  notifyProjectsUpdated();
}

export function setActiveCaseTitle(title: string | null, plantId: PlantId): void {
  if (typeof window === 'undefined') return;
  try {
    if (!title || !title.trim()) {
      window.localStorage.removeItem(ACTIVE_CASE_TITLE_KEY);
    } else {
      window.localStorage.setItem(
        ACTIVE_CASE_TITLE_KEY,
        JSON.stringify({ title: title.trim(), plantId })
      );
    }
    notifyProjectsUpdated();
  } catch {
    // ignore storage errors
  }
}

export function getActiveCaseTitle(): { title: string; plantId: PlantId } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_CASE_TITLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: string; plantId?: PlantId };
    if (parsed?.title && parsed?.plantId) {
      return { title: parsed.title, plantId: parsed.plantId };
    }
    return null;
  } catch {
    return null;
  }
}

export function mapFlowUnitTypeToChemProTab(
  unitType?: string
): 'hx' | 'pump' | 'column' | 'piping' | 'vessel' | 'psv' {
  switch (unitType) {
    case 'distillation':
    case 'absorber':
    case 'desiccant_dryer':
    case 'extractor':
      return 'column';
    case 'pump':
    case 'compressor':
      return 'pump';
    case 'separator':
    case 'h_drum_visual':
    case 'tank_visual':
    case 'flash':
      return 'vessel';
    case 'valve':
      return 'psv';
    case 'pipe':
      return 'piping';
    case 'hex':
    case 'cooler':
    case 'liquefier':
    case 'evaporator':
    default:
      return 'hx';
  }
}

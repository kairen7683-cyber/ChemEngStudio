'use client';

import {
  SIM_COMPS,
  COMP_META,
  COMP_LABEL_EN,
  type SimCompKey,
} from './flowsheetSolver';
import {
  RIGOROUS_CRIT,
  DYNAMIC_ANTOINE,
  type CritProps,
} from './rigorousThermo';
import {
  COMP_CATALOG_META,
  COMP_FAMILY_LABELS,
  type CompCatalogEntry,
  type CompChemicalFamily,
  type ResolvedPropertyMethod,
} from './componentCatalog';

export interface CustomComponentRecord {
  id: number;
  comp_key: string;
  name_ko: string;
  name_en: string;
  formula: string;
  cas_no: string;
  smiles: string;
  mw: number;
  tb_c: number;
  tm_c: number;
  tc_c: number;
  pc_bar: number;
  omega: number;
  rho_l_25: number;
  cp_liq_kj_kgk: number;
  cp_gas_kj_kgk: number;
  hvap_tb_kj_kg: number;
  antoine_a: number;
  antoine_b: number;
  antoine_c: number;
  family: string;
  is_gas_std: number | boolean;
  source_summary: string;
  calibration_note: string;
  status: string;
  requested_by_user_id: number | null;
  requested_by_username: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
}

export const CUSTOM_COMPONENTS_UPDATED_EVENT = 'chemplant-custom-components-updated';
export const ADD_COMPONENT_TO_SIM_EVENT = 'chemplant-add-component-to-sim';

let registeredCustomComponents: CustomComponentRecord[] = [];

export function getRegisteredCustomComponents(): CustomComponentRecord[] {
  return registeredCustomComponents;
}

function normalizeFamily(raw?: string): CompChemicalFamily {
  const valid: CompChemicalFamily[] = [
    'electrolyte_inorg',
    'chlor_ech',
    'gas_syngas',
    'hydrocarbon',
    'aromatic',
    'polar_solvent',
  ];
  if (raw && (valid as string[]).includes(raw)) {
    return raw as CompChemicalFamily;
  }
  return 'polar_solvent';
}

function mapFamilyToMetaGroup(
  family: CompChemicalFamily
): 'core' | '1B_inorg' | '2_ech' | 'gas_syngas' | 'hydrocarbon' | 'aromatic' | 'polar_solvent' {
  switch (family) {
    case 'electrolyte_inorg':
      return '1B_inorg';
    case 'chlor_ech':
      return '2_ech';
    case 'gas_syngas':
      return 'gas_syngas';
    case 'hydrocarbon':
      return 'hydrocarbon';
    case 'aromatic':
      return 'aromatic';
    case 'polar_solvent':
    default:
      return 'polar_solvent';
  }
}

function reliableMethodsForFamily(family: CompChemicalFamily): ResolvedPropertyMethod[] {
  switch (family) {
    case 'electrolyte_inorg':
      return ['ENRTL', 'NRTL'];
    case 'gas_syngas':
      return ['SRK', 'PR', 'NRTL'];
    case 'hydrocarbon':
    case 'aromatic':
      return ['PR', 'SRK', 'NRTL'];
    case 'chlor_ech':
      return ['NRTL', 'PR', 'ENRTL'];
    case 'polar_solvent':
    default:
      return ['NRTL', 'PR', 'SRK'];
  }
}

export function registerDynamicComponents(records: CustomComponentRecord[]): void {
  const list = Array.isArray(records) ? records : [];
  registeredCustomComponents = list.slice();

  const compMetaMap = COMP_META as Record<
    string,
    {
      formula: string;
      label: string;
      mw: number;
      isGasAtStd: boolean;
      cpLiq: number;
      cpGas: number;
      group: 'core' | '1B_inorg' | '2_ech' | 'gas_syngas' | 'hydrocarbon' | 'aromatic' | 'polar_solvent';
    }
  >;
  const labelEnMap = COMP_LABEL_EN as Record<string, string>;
  const critMap = RIGOROUS_CRIT as Record<string, CritProps>;
  const catalogMap = COMP_CATALOG_META as Record<string, CompCatalogEntry>;

  for (const rec of list) {
    if (!rec || !rec.comp_key) continue;
    if (rec.status !== 'approved' && rec.status !== 'pending') continue;

    const key = rec.comp_key as SimCompKey;
    const family = normalizeFamily(rec.family);
    const isGas = Boolean(rec.is_gas_std);
    const formula = rec.formula || rec.comp_key;
    const nameKo = rec.name_ko || rec.name_en || rec.comp_key;
    const nameEn = rec.name_en || rec.name_ko || rec.comp_key;

    if (!SIM_COMPS.includes(key)) {
      SIM_COMPS.push(key);
    }

    compMetaMap[key] = {
      formula,
      label: `${formula} (${nameKo})`,
      mw: Number(rec.mw) || 100.0,
      isGasAtStd: isGas,
      cpLiq: Number(rec.cp_liq_kj_kgk) || 1.8,
      cpGas: Number(rec.cp_gas_kj_kgk) || 1.2,
      group: mapFamilyToMetaGroup(family),
    };

    labelEnMap[key] = `${formula} (${nameEn})`;

    critMap[key] = {
      Tc_K: (Number(rec.tc_c) || 350) + 273.15,
      Pc_bar: Number(rec.pc_bar) || 40.0,
      omega: Number(rec.omega) || 0.3,
      mw: Number(rec.mw) || 100.0,
    };

    DYNAMIC_ANTOINE[key] = {
      A: Number(rec.antoine_a) || 4.0,
      B: Number(rec.antoine_b) || 1200.0,
      C: Number(rec.antoine_c) || 220.0,
    };

    catalogMap[key] = {
      cas: rec.cas_no || 'N/A',
      tbC: Number(rec.tb_c) ?? 100.0,
      family,
      familyLabelKo: COMP_FAMILY_LABELS[family],
      reliableMethods: reliableMethodsForFamily(family),
      isElectrolyte: family === 'electrolyte_inorg',
      isPermanentGas: isGas && Number(rec.tb_c) < -50,
      isPolarOrganic: family === 'polar_solvent' || family === 'chlor_ech',
      isHydrocarbon: family === 'hydrocarbon' || family === 'aromatic',
      noteKo: rec.source_summary || rec.calibration_note || '커뮤니티 등록 동적 성분',
    };
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CUSTOM_COMPONENTS_UPDATED_EVENT));
  }
}

export async function fetchAndRegisterCustomComponents(): Promise<CustomComponentRecord[]> {
  const res = await fetch('/api/components/custom', {
    method: 'GET',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || '커스텀 물질 목록 조회 실패');
  }
  const items: CustomComponentRecord[] = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.components)
      ? data.components
      : Array.isArray(data)
        ? data
        : [];
  registerDynamicComponents(items);
  return items;
}

export interface RequestCustomComponentPayload {
  query: string;
  name_ko?: string;
  tb_c?: number | null;
  rho_l_25?: number | null;
  note?: string;
}

export async function requestNewCustomComponent(
  payload: RequestCustomComponentPayload
): Promise<CustomComponentRecord> {
  const res = await fetch('/api/components/request', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || '물질 자동 물성 조회 및 등록 실패');
  }
  const item = (data.item ?? data.component ?? data) as CustomComponentRecord;
  if (item && item.comp_key) {
    const merged = [
      item,
      ...registeredCustomComponents.filter(r => r.comp_key !== item.comp_key && r.id !== item.id),
    ];
    registerDynamicComponents(merged);
  }
  return item;
}

export async function reviewCustomComponent(
  id: number,
  payload: { status: 'approved' | 'rejected' | 'pending'; admin_note?: string }
): Promise<CustomComponentRecord[]> {
  const res = await fetch(`/api/components/${id}/review`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || '물질 승인 상태 변경 실패');
  }
  return await fetchAndRegisterCustomComponents();
}

export async function deleteCustomComponent(id: number): Promise<CustomComponentRecord[]> {
  const target = registeredCustomComponents.find(r => r.id === id);
  const res = await fetch(`/api/components/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || '물질 삭제 실패');
  }
  if (target?.comp_key) {
    delete DYNAMIC_ANTOINE[target.comp_key];
    const idx = SIM_COMPS.indexOf(target.comp_key as SimCompKey);
    if (idx >= 0) {
      SIM_COMPS.splice(idx, 1);
    }
  }
  return await fetchAndRegisterCustomComponents();
}

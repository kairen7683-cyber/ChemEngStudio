import type { PlantId } from '@/lib/stores/balanceStore';

export interface PlantWorkspaceTab {
  key: 'pfd' | 'design' | 'equip' | 'econ';
  label: string;
  shortLabel: string;
  href: string;
  equipTab?: string;
}

export interface PlantRegistryItem {
  id: PlantId;
  code: string;
  shortLabel: string;
  title: string;
  capacityBadge: string;
  accent: string;
  accentSoftBg: string;
  accentBorder: string;
  isDev?: boolean;
  hiddenFromSelector?: boolean;
  isSandbox?: boolean;
  defaultHref: string;
  tabs: PlantWorkspaceTab[];
}

export const PLANT_REGISTRY: PlantRegistryItem[] = [
  {
    id: 'clorsim',
    code: 'REF',
    shortLabel: '전해 기준수지',
    title: '전해 기준공정 참고수지 (CA 468 T/D)',
    capacityBadge: '468 T/D · 참고기준',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    hiddenFromSelector: true,
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 공정도·수지', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=evap', equipTab: 'evap' },
      { key: 'equip', label: '③ 장치목록 (60+)', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성·기준', href: '/process-economics' },
    ],
  },
  {
    id: 'clorsim_sim',
    code: 'PLANT 01',
    shortLabel: '전해 통합공정',
    title: '전해공장 통합 시뮬레이션 예제 (100~700)',
    capacityBadge: '예제 · 다단 계층 SIM',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=evap', equipTab: 'evap' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성', href: '/process-economics' },
    ],
  },
  {
    id: 'hcl_synth',
    code: 'PLANT 02',
    shortLabel: '1A 염산·회수',
    title: '1A 초고순도·무수염산 & 폐염산 회수 예제',
    capacityBadge: '예제 · 5N AHCl · PSD',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=packing', equipTab: 'packing' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성', href: '/process-economics' },
    ],
  },
  {
    id: 'ech_gte',
    code: 'PLANT 03',
    shortLabel: 'ECH (7만톤)',
    title: '글리세린 기반 에피클로로히드린 예제 (GTE-ECH 70,000 TPA)',
    capacityBadge: '예제 · 70,000 TPA · 8.75 t/h',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=distill', equipTab: 'distill' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성', href: '/process-economics' },
    ],
  },
  {
    id: 'cms_plant',
    code: 'PLANT 04',
    shortLabel: '클로로메탄 (CMS)',
    title: 'AIBN 액상 염소화 클로로메탄 예제 (MCL 120 · CFM 80 T/D)',
    capacityBadge: '예제 · Cl₂ 220 · MCL 120 · CFM 80 T/D',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=cms_hub', equipTab: 'cms_hub' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성', href: '/process-economics' },
    ],
  },
  {
    id: 'mdi_plant',
    code: 'PLANT 05',
    shortLabel: 'MDI (10만톤)',
    title: 'MDI 10만톤 통합 공정 예제 (MDA · 포스겐화 · Pure/PMDI)',
    capacityBadge: '예제 · 100,000 TPA · 12.5 t/h',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=mdi_hub', equipTab: 'mdi_hub' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 경제성', href: '/process-economics' },
    ],
  },
  {
    id: 'new_builder',
    code: 'SIM',
    shortLabel: '공정 시뮬레이터',
    title: '공정 시뮬레이터',
    capacityBadge: '',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    isSandbox: true,
    defaultHref: '/flowsheet-simulator',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 시뮬레이터', href: '/flowsheet-simulator' },
      { key: 'equip', label: '③ 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 벤치마크', href: '/process-economics' },
    ],
  },
  {
    id: 'classic_sim',
    code: 'CLASSIC',
    shortLabel: '클래식 시뮬레이터',
    title: '클래식 공정 시뮬레이터',
    capacityBadge: '',
    accent: '#1E3A8A',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#CBD5E1',
    isSandbox: true,
    defaultHref: '/classic-simulator',
    tabs: [
      { key: 'pfd', label: '① 시뮬레이터 도면', shortLabel: '① 클래식 UI', href: '/classic-simulator' },
      { key: 'econ', label: '④ 원단위·경제성', shortLabel: '④ 벤치마크', href: '/process-economics' },
    ],
  },
];

export function getPlantRegistryItem(id: PlantId): PlantRegistryItem {
  return PLANT_REGISTRY.find(p => p.id === id) ?? PLANT_REGISTRY.find(p => !p.hiddenFromSelector) ?? PLANT_REGISTRY[0];
}

export const PLANT_GROUP_TO_ID: Record<'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi', PlantId> = {
  electrolysis: 'clorsim_sim',
  hcl1A: 'hcl_synth',
  ech: 'ech_gte',
  cms: 'cms_plant',
  mdi: 'mdi_plant',
};

export function isSimulatorOnlyUser(
  user?: { role?: string; allowed_plants?: string[] | null } | null
): boolean {
  if (!user || user.role === 'admin') return false;
  return (
    Array.isArray(user.allowed_plants) &&
    user.allowed_plants.length > 0 &&
    user.allowed_plants.includes('simulator_only') &&
    !user.allowed_plants.includes('*')
  );
}

/**
 * 실공정 또는 실공정 장치가 일부 포함된 공장 ID는 대표(관리자) 계정 전용으로 영구 잠금.
 * - clorsim / clorsim_sim (PLANT 01 전해 통합공정)
 * - cms_plant (PLANT 04 클로로메탄 CMS)
 */
export const OWNER_ONLY_PLANTS = new Set<string>([
  'clorsim',
  'clorsim_sim',
  'cms_plant',
]);

export function isPlantAllowed(
  plantId: string,
  user?: { role?: string; allowed_plants?: string[] | null } | null
): boolean {
  if (plantId === 'new_builder' || plantId === 'classic_sim') return true;
  if (OWNER_ONLY_PLANTS.has(plantId)) {
    return user?.role === 'admin';
  }
  if (!user) return true;
  if (user.role === 'admin') return true;
  if (!Array.isArray(user.allowed_plants) || user.allowed_plants.length === 0) return true;
  if (user.allowed_plants.includes('*')) return true;
  if (user.allowed_plants.includes('simulator_only')) return false;
  return user.allowed_plants.includes(plantId);
}

/**
 * 관리자 계정에는 내부 관리 편의를 위해 PLANT 01~05 번호를 유지하고,
 * 일반/접근제한 계정에는 타 공장 존재가 노출되지 않도록 PLANT 번호 접두어를 제거합니다.
 */
export function showPlantNumbersForUser(
  user?: { role?: string } | null
): boolean {
  return user?.role === 'admin';
}

export function stripPlantNumberPrefix(label: string): string {
  return label
    .replace(/^PLANT\s*0?\d+\s*[·:\-—]?\s*/i, '')
    .replace(/^\[PLANT\s*0?\d+\]\s*/i, '')
    .trim();
}

export function formatPlantLabelForUser(
  label: string,
  user?: { role?: string } | null
): string {
  if (showPlantNumbersForUser(user)) return label;
  return stripPlantNumberPrefix(label);
}

export function formatPlantCodeAndName(
  plant: Pick<PlantRegistryItem, 'code' | 'shortLabel'>,
  user?: { role?: string } | null,
  separator = ' · '
): string {
  if (showPlantNumbersForUser(user) && /^PLANT\s/i.test(plant.code)) {
    return `${plant.code}${separator}${plant.shortLabel}`;
  }
  return plant.shortLabel;
}

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
    accent: '#0F5338',
    accentSoftBg: '#ECFDF5',
    accentBorder: '#6EE7B7',
    hiddenFromSelector: true,
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 공정도 & 물질수지', shortLabel: '① 공정도·수지', href: '/material-balance' },
      { key: 'design', label: '② 공정·장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=evap', equipTab: 'evap' },
      { key: 'equip', label: '③ 공장 장치목록 (60+)', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성 · 설계기준', shortLabel: '④ 경제성·기준', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'clorsim_sim',
    code: 'PLANT 01',
    shortLabel: '전해 시뮬레이터',
    title: '전해공장 통합 시뮬레이터 (100~700)',
    capacityBadge: '다단 계층 SIM',
    accent: '#1E3A8A',
    accentSoftBg: '#EFF6FF',
    accentBorder: '#93C5FD',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 계층 공정도 & 시뮬레이션', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 공정·장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=evap', equipTab: 'evap' },
      { key: 'equip', label: '③ 공장 장치목록 (SIM 연동)', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성', shortLabel: '④ 경제성', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'hcl_synth',
    code: 'PLANT 02',
    shortLabel: '1A 염산·회수',
    title: '1A 초고순도·무수염산 & 폐염산 회수',
    capacityBadge: '5N AHCl · PSD',
    accent: '#0F766E',
    accentSoftBg: '#F0FDFA',
    accentBorder: '#5EEAD4',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 계층 공정도 & 시뮬레이션', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② 1A 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=packing', equipTab: 'packing' },
      { key: 'equip', label: '③ 1A 공장 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성', shortLabel: '④ 경제성', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'ech_gte',
    code: 'PLANT 03',
    shortLabel: 'ECH (7만톤)',
    title: '글리세린 기반 에피클로로히드린 (GTE-ECH 70,000 TPA)',
    capacityBadge: '70,000 TPA · 8.75 t/h',
    accent: '#7C3AED',
    accentSoftBg: '#F5F3FF',
    accentBorder: '#C4B5FD',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 계층 공정도 & 시뮬레이션', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② ECH 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=distill', equipTab: 'distill' },
      { key: 'equip', label: '③ ECH 공장 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성', shortLabel: '④ 경제성', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'cms_plant',
    code: 'PLANT 04',
    shortLabel: '클로로메탄 (CMS)',
    title: '메틸클로라이드 AIBN 액상 염소화 클로로메탄 (MCL 120 · CFM 80 T/D)',
    capacityBadge: 'Cl₂ 220 · MCL 120 · CFM 80 T/D',
    accent: '#0891B2',
    accentSoftBg: '#ECFEFF',
    accentBorder: '#67E8F9',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 계층 공정도 & 시뮬레이션', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② CMS 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=cms_hub', equipTab: 'cms_hub' },
      { key: 'equip', label: '③ CMS 공장 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성', shortLabel: '④ 경제성', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'mdi_plant',
    code: 'PLANT 05',
    shortLabel: 'MDI (10만톤)',
    title: 'MDI 10만톤 통합 공정 (MDA · 포스겐화 · Pure/PMDI)',
    capacityBadge: '100,000 TPA · 12.5 t/h',
    accent: '#B45309',
    accentSoftBg: '#FFFBEB',
    accentBorder: '#FCD34D',
    defaultHref: '/material-balance',
    tabs: [
      { key: 'pfd', label: '① 계층 공정도 & 시뮬레이션', shortLabel: '① 시뮬레이션', href: '/material-balance' },
      { key: 'design', label: '② MDI 핵심장치 상세설계', shortLabel: '② 장치설계', href: '/equipment-design?tab=mdi_hub', equipTab: 'mdi_hub' },
      { key: 'equip', label: '③ MDI 공장 장치목록', shortLabel: '③ 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '④ 원단위 · 경제성', shortLabel: '④ 경제성', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'new_builder',
    code: 'SIM',
    shortLabel: '공정 시뮬레이터',
    title: '공정 시뮬레이터',
    capacityBadge: '',
    accent: '#334155',
    accentSoftBg: '#F8FAFC',
    accentBorder: '#94A3B8',
    isSandbox: true,
    defaultHref: '/flowsheet-simulator',
    tabs: [
      { key: 'pfd', label: '① 공정 시뮬레이터 & PFD', shortLabel: '① 시뮬레이터', href: '/flowsheet-simulator' },
      { key: 'equip', label: '② 시뮬레이터 장치목록', shortLabel: '② 장치목록', href: '/equipment-design?tab=equip', equipTab: 'equip' },
      { key: 'econ', label: '③ 공정 벤치마크 경제성', shortLabel: '③ 벤치마크', href: '/pep-yearbook' },
    ],
  },
  {
    id: 'classic_sim',
    code: 'CLASSIC',
    shortLabel: '클래식 시뮬레이터',
    title: '공정 시뮬레이터',
    capacityBadge: '',
    accent: '#1E40AF',
    accentSoftBg: '#EFF6FF',
    accentBorder: '#93C5FD',
    isSandbox: true,
    defaultHref: '/classic-simulator',
    tabs: [
      { key: 'pfd', label: '① 클래식 플로우시트 시뮬레이터', shortLabel: '① 클래식 UI', href: '/classic-simulator' },
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

export function isPlantAllowed(
  plantId: string,
  user?: { role?: string; allowed_plants?: string[] | null } | null
): boolean {
  if (!user) return true;
  if (user.role === 'admin') return true;
  if (!Array.isArray(user.allowed_plants) || user.allowed_plants.length === 0) return true;
  if (user.allowed_plants.includes('*')) return true;
  return user.allowed_plants.includes(plantId);
}

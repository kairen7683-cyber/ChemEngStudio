// =====================================================================
// PFD 배관 유체 종류 색상 매핑 (공유 상수)
// SelectionPanel + PFDCanvas 에서 공통으로 사용
// =====================================================================

import { StreamData } from '@/lib/calculations/streams';

export interface FluidPreset {
  key: string;
  color: string;
  label: string;
}

/** 유체별 프리셋 색상 목록 */
export const FLUID_PRESETS: FluidPreset[] = [
  { key: 'Brine',  color: '#4ade80', label: 'Brine / NaCl' },
  { key: 'Cl2',    color: '#60a5fa', label: 'Cl₂ 가스' },
  { key: 'NaOH',   color: '#f97316', label: 'NaOH' },
  { key: 'H2',     color: '#a78bfa', label: 'H₂ 가스' },
  { key: 'H2SO4',  color: '#fbbf24', label: 'H₂SO₄' },
  { key: 'CW',     color: '#38bdf8', label: '냉각수 / CW' },
  { key: 'Steam',  color: '#94a3b8', label: '증기 (Steam)' },
  { key: 'HCl',    color: '#fb7185', label: 'HCl' },
  { key: 'BaCl2',  color: '#f0abfc', label: 'BaCl₂' },
  { key: 'Waste',  color: '#6b7280', label: '폐수 (Waste)' },
  { key: 'custom', color: '',        label: '기타 (직접 선택)' },
];

/** fluidKey → color 빠른 조회 */
export function colorFromFluidKey(key: string, customColor = '#6b7280'): string {
  if (key === 'custom') return customColor;
  return FLUID_PRESETS.find(p => p.key === key)?.color ?? customColor;
}

/**
 * StreamData 조성 분석 → fluidKey 자동 결정
 * 가장 질량 유량이 큰 성분을 기준으로 판단
 */
export function fluidKeyFromStream(stream: StreamData): string {
  const c = stream.components ?? {};
  const sorted = Object.entries(c)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  const dominant = sorted[0]?.[0] ?? '';

  switch (dominant) {
    case 'NaCl': return 'Brine';
    case 'NaOH': return 'NaOH';
    case 'Cl2':  return 'Cl2';
    case 'H2':   return 'H2';
    case 'H2SO4':return 'H2SO4';
    case 'H2O': {
      // 물이 우세 → 온도/압력 힌트로 Steam vs CW 구분
      if ((stream.temperature_C ?? 0) > 100) return 'Steam';
      if (stream.description?.toLowerCase().includes('steam')) return 'Steam';
      if (stream.description?.toLowerCase().includes('cw') ||
          stream.description?.toLowerCase().includes('냉각수')) return 'CW';
      return 'CW';
    }
    case 'HCl':  return 'HCl';
    case 'BaCl2':return 'BaCl2';
    default:     return 'Brine';
  }
}

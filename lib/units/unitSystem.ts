export type UnitQuantity =
  | 'temp'
  | 'pressG'
  | 'deltaP'
  | 'massFlow'
  | 'molarFlow'
  | 'volFlow'
  | 'density'
  | 'cp'
  | 'heatDuty'
  | 'power'
  | 'htc'
  | 'fouling'
  | 'area'
  | 'volume'
  | 'length'
  | 'velocity'
  | 'viscosity';

export interface UnitOption {
  id: string;
  label: string;
  /** Convert from canonical internal unit to this display unit */
  fromCanonical: (v: number) => number;
  /** Convert from this display unit back to canonical internal unit */
  toCanonical: (v: number) => number;
  /** Recommended decimal digits when formatting */
  decimals?: number;
}

export interface QuantityMeta {
  key: UnitQuantity;
  labelKo: string;
  canonicalId: string;
  options: UnitOption[];
}

const ATM_KGF_CM2 = 1.03322745;
const BAR_PER_KGF_CM2 = 0.980665;
const ATM_BAR = 1.01325;
const KPA_PER_KGF_CM2 = 98.0665;
const ATM_KPA = 101.325;
const PSI_PER_KGF_CM2 = 14.2233433;
const ATM_PSI = 14.6959488;
const MMHG_PER_BAR = 750.061683;

export const UNIT_QUANTITIES: Record<UnitQuantity, QuantityMeta> = {
  temp: {
    key: 'temp',
    labelKo: '온도 (Temperature)',
    canonicalId: 'C',
    options: [
      { id: 'C', label: '°C', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
      { id: 'K', label: 'K', fromCanonical: v => v + 273.15, toCanonical: v => v - 273.15, decimals: 1 },
      { id: 'F', label: '°F', fromCanonical: v => (v * 9) / 5 + 32, toCanonical: v => ((v - 32) * 5) / 9, decimals: 1 },
    ],
  },
  pressG: {
    key: 'pressG',
    labelKo: '압력 (Pressure)',
    canonicalId: 'kgcm2g',
    options: [
      { id: 'kgcm2g', label: 'kg/cm²G', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'kgcm2a', label: 'kg/cm²A', fromCanonical: v => v + ATM_KGF_CM2, toCanonical: v => v - ATM_KGF_CM2, decimals: 2 },
      { id: 'barG', label: 'barG', fromCanonical: v => v * BAR_PER_KGF_CM2, toCanonical: v => v / BAR_PER_KGF_CM2, decimals: 2 },
      { id: 'barA', label: 'barA', fromCanonical: v => v * BAR_PER_KGF_CM2 + ATM_BAR, toCanonical: v => (v - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 2 },
      { id: 'kPaG', label: 'kPaG', fromCanonical: v => v * KPA_PER_KGF_CM2, toCanonical: v => v / KPA_PER_KGF_CM2, decimals: 1 },
      { id: 'kPaA', label: 'kPaA', fromCanonical: v => v * KPA_PER_KGF_CM2 + ATM_KPA, toCanonical: v => (v - ATM_KPA) / KPA_PER_KGF_CM2, decimals: 1 },
      { id: 'atm', label: 'atm', fromCanonical: v => (v * BAR_PER_KGF_CM2 + ATM_BAR) / ATM_BAR, toCanonical: v => (v * ATM_BAR - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 3 },
      { id: 'mmHgA', label: 'mmHgA', fromCanonical: v => (v * BAR_PER_KGF_CM2 + ATM_BAR) * MMHG_PER_BAR, toCanonical: v => (v / MMHG_PER_BAR - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 1 },
      { id: 'psig', label: 'psig', fromCanonical: v => v * PSI_PER_KGF_CM2, toCanonical: v => v / PSI_PER_KGF_CM2, decimals: 1 },
      { id: 'psia', label: 'psia', fromCanonical: v => v * PSI_PER_KGF_CM2 + ATM_PSI, toCanonical: v => (v - ATM_PSI) / PSI_PER_KGF_CM2, decimals: 1 },
    ],
  },
  deltaP: {
    key: 'deltaP',
    labelKo: '차압 (ΔP)',
    canonicalId: 'kgcm2',
    options: [
      { id: 'kgcm2', label: 'kg/cm²', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      { id: 'bar', label: 'bar', fromCanonical: v => v * BAR_PER_KGF_CM2, toCanonical: v => v / BAR_PER_KGF_CM2, decimals: 3 },
      { id: 'kPa', label: 'kPa', fromCanonical: v => v * KPA_PER_KGF_CM2, toCanonical: v => v / KPA_PER_KGF_CM2, decimals: 2 },
      { id: 'mmH2O', label: 'mmH₂O', fromCanonical: v => v * 10000, toCanonical: v => v / 10000, decimals: 0 },
      { id: 'mmHg', label: 'mmHg', fromCanonical: v => v * 735.55924, toCanonical: v => v / 735.55924, decimals: 1 },
      { id: 'psi', label: 'psi', fromCanonical: v => v * PSI_PER_KGF_CM2, toCanonical: v => v / PSI_PER_KGF_CM2, decimals: 2 },
    ],
  },
  massFlow: {
    key: 'massFlow',
    labelKo: '질량 유량 (Mass Flow)',
    canonicalId: 'kgh',
    options: [
      { id: 'kgh', label: 'kg/h', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
      { id: 'th', label: 't/h', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 3 },
      { id: 'td', label: 't/d', fromCanonical: v => (v * 24) / 1000, toCanonical: v => (v * 1000) / 24, decimals: 2 },
      { id: 'kgs', label: 'kg/s', fromCanonical: v => v / 3600, toCanonical: v => v * 3600, decimals: 3 },
      { id: 'kgmin', label: 'kg/min', fromCanonical: v => v / 60, toCanonical: v => v * 60, decimals: 2 },
      { id: 'lbh', label: 'lb/h', fromCanonical: v => v * 2.20462262, toCanonical: v => v / 2.20462262, decimals: 1 },
    ],
  },
  molarFlow: {
    key: 'molarFlow',
    labelKo: '몰 유량 (Molar Flow)',
    canonicalId: 'kmolh',
    options: [
      { id: 'kmolh', label: 'kmol/h', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'mols', label: 'mol/s', fromCanonical: v => v / 3.6, toCanonical: v => v * 3.6, decimals: 2 },
      { id: 'kmold', label: 'kmol/d', fromCanonical: v => v * 24, toCanonical: v => v / 24, decimals: 1 },
      { id: 'lbmolh', label: 'lbmol/h', fromCanonical: v => v * 2.20462262, toCanonical: v => v / 2.20462262, decimals: 2 },
    ],
  },
  volFlow: {
    key: 'volFlow',
    labelKo: '부피 유량 (Vol. Flow)',
    canonicalId: 'm3h',
    options: [
      { id: 'm3h', label: 'm³/h', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'm3min', label: 'm³/min', fromCanonical: v => v / 60, toCanonical: v => v * 60, decimals: 3 },
      { id: 'Lmin', label: 'L/min', fromCanonical: v => (v * 1000) / 60, toCanonical: v => (v * 60) / 1000, decimals: 1 },
      { id: 'm3d', label: 'm³/d', fromCanonical: v => v * 24, toCanonical: v => v / 24, decimals: 1 },
      { id: 'gpm', label: 'gpm', fromCanonical: v => v * 4.4028675, toCanonical: v => v / 4.4028675, decimals: 2 },
      { id: 'ft3h', label: 'ft³/h', fromCanonical: v => v * 35.3146667, toCanonical: v => v / 35.3146667, decimals: 1 },
    ],
  },
  density: {
    key: 'density',
    labelKo: '밀도 (Density)',
    canonicalId: 'kgm3',
    options: [
      { id: 'kgm3', label: 'kg/m³', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'gcm3', label: 'g/cm³', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 4 },
      { id: 'lbft3', label: 'lb/ft³', fromCanonical: v => v * 0.06242796, toCanonical: v => v / 0.06242796, decimals: 3 },
    ],
  },
  cp: {
    key: 'cp',
    labelKo: '비열 (Cp)',
    canonicalId: 'kcalkgC',
    options: [
      { id: 'kcalkgC', label: 'kcal/kg°C', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      { id: 'kJkgK', label: 'kJ/kg·K', fromCanonical: v => v * 4.1868, toCanonical: v => v / 4.1868, decimals: 3 },
      { id: 'BtulbF', label: 'Btu/lb·°F', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
    ],
  },
  heatDuty: {
    key: 'heatDuty',
    labelKo: '열부하 / 엔탈피 (Duty)',
    canonicalId: 'Mcalh',
    options: [
      { id: 'Mcalh', label: 'Mcal/h', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
      { id: 'kcalh', label: 'kcal/h', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 0 },
      { id: 'kW', label: 'kW', fromCanonical: v => v * 1.163, toCanonical: v => v / 1.163, decimals: 1 },
      { id: 'MW', label: 'MW', fromCanonical: v => v * 0.001163, toCanonical: v => v / 0.001163, decimals: 3 },
      { id: 'GJh', label: 'GJ/h', fromCanonical: v => v * 0.0041868, toCanonical: v => v / 0.0041868, decimals: 3 },
      { id: 'MMBtuh', label: 'MMBtu/h', fromCanonical: v => v * 0.00396832, toCanonical: v => v / 0.00396832, decimals: 3 },
    ],
  },
  power: {
    key: 'power',
    labelKo: '동력 (Power)',
    canonicalId: 'kW',
    options: [
      { id: 'kW', label: 'kW', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
      { id: 'MW', label: 'MW', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 3 },
      { id: 'HP', label: 'HP', fromCanonical: v => v * 1.34102209, toCanonical: v => v / 1.34102209, decimals: 1 },
      { id: 'kcalh', label: 'kcal/h', fromCanonical: v => v * 859.8452, toCanonical: v => v / 859.8452, decimals: 0 },
    ],
  },
  htc: {
    key: 'htc',
    labelKo: '총괄 열전달계수 (U)',
    canonicalId: 'kcalm2hC',
    options: [
      { id: 'kcalm2hC', label: 'kcal/m²h°C', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
      { id: 'Wm2K', label: 'W/m²·K', fromCanonical: v => v * 1.163, toCanonical: v => v / 1.163, decimals: 1 },
      { id: 'Btuhft2F', label: 'Btu/h·ft²·°F', fromCanonical: v => v * 0.204816, toCanonical: v => v / 0.204816, decimals: 2 },
    ],
  },
  fouling: {
    key: 'fouling',
    labelKo: '오염계수 (Rf)',
    canonicalId: 'm2hCkcal',
    options: [
      { id: 'm2hCkcal', label: 'm²h°C/kcal', fromCanonical: v => v, toCanonical: v => v, decimals: 5 },
      { id: 'm2KW', label: 'm²·K/W', fromCanonical: v => v / 1.163, toCanonical: v => v * 1.163, decimals: 5 },
      { id: 'hft2FBtu', label: 'h·ft²·°F/Btu', fromCanonical: v => v / 0.204816, toCanonical: v => v * 0.204816, decimals: 5 },
    ],
  },
  area: {
    key: 'area',
    labelKo: '면적 (Area)',
    canonicalId: 'm2',
    options: [
      { id: 'm2', label: 'm²', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'ft2', label: 'ft²', fromCanonical: v => v * 10.7639104, toCanonical: v => v / 10.7639104, decimals: 1 },
    ],
  },
  volume: {
    key: 'volume',
    labelKo: '부피 / 용적 (Volume)',
    canonicalId: 'm3',
    options: [
      { id: 'm3', label: 'm³', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'L', label: 'L', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 0 },
      { id: 'ft3', label: 'ft³', fromCanonical: v => v * 35.3146667, toCanonical: v => v / 35.3146667, decimals: 1 },
      { id: 'gal', label: 'gal', fromCanonical: v => v * 264.172052, toCanonical: v => v / 264.172052, decimals: 1 },
    ],
  },
  length: {
    key: 'length',
    labelKo: '길이 / 직경 (Length)',
    canonicalId: 'm',
    options: [
      { id: 'm', label: 'm', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      { id: 'mm', label: 'mm', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 1 },
      { id: 'cm', label: 'cm', fromCanonical: v => v * 100, toCanonical: v => v / 100, decimals: 2 },
      { id: 'in', label: 'in', fromCanonical: v => v * 39.3700787, toCanonical: v => v / 39.3700787, decimals: 2 },
      { id: 'ft', label: 'ft', fromCanonical: v => v * 3.2808399, toCanonical: v => v / 3.2808399, decimals: 2 },
    ],
  },
  velocity: {
    key: 'velocity',
    labelKo: '유속 (Velocity)',
    canonicalId: 'ms',
    options: [
      { id: 'ms', label: 'm/s', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
      { id: 'fts', label: 'ft/s', fromCanonical: v => v * 3.2808399, toCanonical: v => v / 3.2808399, decimals: 2 },
    ],
  },
  viscosity: {
    key: 'viscosity',
    labelKo: '점도 (Viscosity)',
    canonicalId: 'cP',
    options: [
      { id: 'cP', label: 'cP', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      { id: 'mPas', label: 'mPa·s', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      { id: 'Pas', label: 'Pa·s', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 5 },
    ],
  },
};

export type UnitPreferences = Record<UnitQuantity, string>;

export type UnitPresetId = 'METRIC_ENG' | 'SI' | 'SI_BARG' | 'US_FIELD' | 'CUSTOM';

export interface UnitPresetDef {
  id: Exclude<UnitPresetId, 'CUSTOM'>;
  name: string;
  shortName: string;
  desc: string;
  units: UnitPreferences;
}

export const UNIT_PRESETS: UnitPresetDef[] = [
  {
    id: 'METRIC_ENG',
    name: '공학 MKS (기본)',
    shortName: 'MKS',
    desc: '°C · kg/cm²G · kg/h · Mcal/h · kW',
    units: {
      temp: 'C',
      pressG: 'kgcm2g',
      deltaP: 'kgcm2',
      massFlow: 'kgh',
      molarFlow: 'kmolh',
      volFlow: 'm3h',
      density: 'kgm3',
      cp: 'kcalkgC',
      heatDuty: 'Mcalh',
      power: 'kW',
      htc: 'kcalm2hC',
      fouling: 'm2hCkcal',
      area: 'm2',
      volume: 'm3',
      length: 'm',
      velocity: 'ms',
      viscosity: 'cP',
    },
  },
  {
    id: 'SI',
    name: 'SI 표준 (barA · kW)',
    shortName: 'SI',
    desc: '°C · barA · kPa · kg/h · kW · W/m²·K',
    units: {
      temp: 'C',
      pressG: 'barA',
      deltaP: 'kPa',
      massFlow: 'kgh',
      molarFlow: 'kmolh',
      volFlow: 'm3h',
      density: 'kgm3',
      cp: 'kJkgK',
      heatDuty: 'kW',
      power: 'kW',
      htc: 'Wm2K',
      fouling: 'm2KW',
      area: 'm2',
      volume: 'm3',
      length: 'm',
      velocity: 'ms',
      viscosity: 'mPas',
    },
  },
  {
    id: 'SI_BARG',
    name: 'SI 플랜트 (barG · t/h)',
    shortName: 'SI-P',
    desc: '°C · barG · t/h · MW · kW',
    units: {
      temp: 'C',
      pressG: 'barG',
      deltaP: 'bar',
      massFlow: 'th',
      molarFlow: 'kmolh',
      volFlow: 'm3h',
      density: 'kgm3',
      cp: 'kJkgK',
      heatDuty: 'MW',
      power: 'kW',
      htc: 'Wm2K',
      fouling: 'm2KW',
      area: 'm2',
      volume: 'm3',
      length: 'm',
      velocity: 'ms',
      viscosity: 'cP',
    },
  },
  {
    id: 'US_FIELD',
    name: 'US / Field (°F · psig)',
    shortName: 'US',
    desc: '°F · psig · lb/h · gpm · MMBtu/h · HP',
    units: {
      temp: 'F',
      pressG: 'psig',
      deltaP: 'psi',
      massFlow: 'lbh',
      molarFlow: 'lbmolh',
      volFlow: 'gpm',
      density: 'lbft3',
      cp: 'BtulbF',
      heatDuty: 'MMBtuh',
      power: 'HP',
      htc: 'Btuhft2F',
      fouling: 'hft2FBtu',
      area: 'ft2',
      volume: 'ft3',
      length: 'ft',
      velocity: 'fts',
      viscosity: 'cP',
    },
  },
];

export const DEFAULT_UNIT_PREFS: UnitPreferences = { ...UNIT_PRESETS[0].units };

export function getUnitOption(quantity: UnitQuantity, unitId?: string): UnitOption {
  const meta = UNIT_QUANTITIES[quantity];
  if (!unitId) return meta.options[0];
  return meta.options.find(o => o.id === unitId) ?? meta.options[0];
}

export function fromCanonical(quantity: UnitQuantity, canonicalVal: number, unitId?: string): number {
  if (!Number.isFinite(canonicalVal)) return canonicalVal;
  return getUnitOption(quantity, unitId).fromCanonical(canonicalVal);
}

export function toCanonical(quantity: UnitQuantity, displayVal: number, unitId?: string): number {
  if (!Number.isFinite(displayVal)) return displayVal;
  return getUnitOption(quantity, unitId).toCanonical(displayVal);
}

export function getUnitLabel(quantity: UnitQuantity, unitId?: string): string {
  return getUnitOption(quantity, unitId).label;
}

export function formatCanonicalValue(
  quantity: UnitQuantity,
  canonicalVal: number,
  unitId?: string,
  overrideDecimals?: number
): string {
  if (!Number.isFinite(canonicalVal)) return '—';
  const opt = getUnitOption(quantity, unitId);
  const converted = opt.fromCanonical(canonicalVal);
  const decimals = overrideDecimals ?? opt.decimals ?? 2;
  if (Math.abs(converted) >= 1000 && decimals <= 1) {
    return converted.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return converted.toFixed(decimals);
}

export function detectPresetId(units: UnitPreferences): UnitPresetId {
  for (const preset of UNIT_PRESETS) {
    const allMatch = (Object.keys(preset.units) as UnitQuantity[]).every(
      k => units[k] === preset.units[k]
    );
    if (allMatch) return preset.id;
  }
  return 'CUSTOM';
}

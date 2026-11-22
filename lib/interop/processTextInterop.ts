// ============================================================================
// 공정 텍스트 파일(.inp / .bkp) 양방향 호환 파서 & 내보내기 엔진
// Standard Process Flowsheet Text File (.inp / .bkp) Interop Engine
// - 88종 컴포넌트 DB(CAS·화학식·관용명) 자동 매핑
// - 단위계(ENG / SI / MET) 및 온도·압력·유량·열부하 자동 환산
// - 토폴로지 자동 복원(Feed/Product 자동 생성 + 포트 매핑 + 좌→우 BFS 레이아웃)
// ============================================================================

import {
  SIM_COMPS,
  emptySimFlows,
  type FlowEdgeDef,
  type FlowNodeDef,
  type FlowUnitParams,
  type FlowUnitType,
  type SimCompKey,
  type SourcePortId,
  type TargetPortId,
} from '../calculations/flowsheetSolver';
import {
  COMP_CATALOG_META,
  type SimPropertyMethod,
} from '../calculations/componentCatalog';
import { MW } from '../calculations/constants';
import type { DistillColumnParams } from '../calculations/rigorousDistillation';

export interface ProcessTextImportResult {
  title: string;
  defs: Record<string, FlowNodeDef>;
  rfNodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: { unitId: string };
  }>;
  edges: FlowEdgeDef[];
  activeComponents: SimCompKey[];
  propertyMethod: SimPropertyMethod;
  summary: {
    unitCount: number;
    edgeCount: number;
    mappedCompCount: number;
    unmappedComps: string[];
  };
  warnings: string[];
}

export interface ProcessTextExportInput {
  title?: string;
  defs: Record<string, FlowNodeDef> | FlowNodeDef[];
  edges: FlowEdgeDef[];
  activeComponents: SimCompKey[];
  propertyMethod?: string;
}

// ============================================================================
// 1. 단위계 및 물리량 환산 유틸리티
// ============================================================================

interface UnitContext {
  temp: 'C' | 'K' | 'F' | 'R';
  pres:
    | 'BAR'
    | 'ATM'
    | 'KPA'
    | 'MPA'
    | 'PA'
    | 'PSIA'
    | 'PSIG'
    | 'KGCM2'
    | 'MMHG';
  massFlow: 'KG/HR' | 'KG/SEC' | 'G/SEC' | 'LB/HR' | 'TON/HR';
  moleFlow: 'KMOL/HR' | 'KMOL/SEC' | 'MOL/SEC' | 'LBMOL/HR';
  duty: 'MCAL/HR' | 'KCAL/HR' | 'KW' | 'MW' | 'W' | 'BTU/HR' | 'MMBTU/HR' | 'GJ/HR';
}

const DEFAULT_UNITS_BY_SET: Record<'MET' | 'SI' | 'ENG', UnitContext> = {
  MET: {
    temp: 'C',
    pres: 'BAR',
    massFlow: 'KG/HR',
    moleFlow: 'KMOL/HR',
    duty: 'MCAL/HR',
  },
  SI: {
    temp: 'K',
    pres: 'PA',
    massFlow: 'KG/SEC',
    moleFlow: 'KMOL/SEC',
    duty: 'W',
  },
  ENG: {
    temp: 'F',
    pres: 'PSIA',
    massFlow: 'LB/HR',
    moleFlow: 'LBMOL/HR',
    duty: 'BTU/HR',
  },
};

function parseTempUnit(raw: string): UnitContext['temp'] | null {
  const u = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (u === 'C' || u === 'DEGC' || u === 'CELSIUS') return 'C';
  if (u === 'K' || u === 'KELVIN') return 'K';
  if (u === 'F' || u === 'DEGF' || u === 'FAHRENHEIT') return 'F';
  if (u === 'R' || u === 'RANKINE') return 'R';
  return null;
}

function parsePresUnit(raw: string): UnitContext['pres'] | null {
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (u === 'BAR' || u === 'BARA') return 'BAR';
  if (u === 'ATM') return 'ATM';
  if (u === 'KPA' || u === 'KN/SQM') return 'KPA';
  if (u === 'MPA' || u === 'MN/SQM') return 'MPA';
  if (u === 'PA' || u === 'N/SQM') return 'PA';
  if (u === 'PSIA' || u === 'PSI') return 'PSIA';
  if (u === 'PSIG') return 'PSIG';
  if (u === 'KG/SQCM' || u === 'KG/CM2' || u === 'KGCM2' || u === 'AT') return 'KGCM2';
  if (u === 'MMHG' || u === 'TORR') return 'MMHG';
  return null;
}

function parseMassFlowUnit(raw: string): UnitContext['massFlow'] | null {
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (u === 'KG/HR' || u === 'KG/H') return 'KG/HR';
  if (u === 'KG/SEC' || u === 'KG/S') return 'KG/SEC';
  if (u === 'G/SEC' || u === 'G/S') return 'G/SEC';
  if (u === 'LB/HR' || u === 'LB/H') return 'LB/HR';
  if (u === 'TON/HR' || u === 'MT/HR' || u === 'TONNE/HR') return 'TON/HR';
  return null;
}

function parseMoleFlowUnit(raw: string): UnitContext['moleFlow'] | null {
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (u === 'KMOL/HR' || u === 'KMOL/H' || u === 'KGMOL/HR') return 'KMOL/HR';
  if (u === 'KMOL/SEC' || u === 'KMOL/S' || u === 'KGMOL/SEC') return 'KMOL/SEC';
  if (u === 'MOL/SEC' || u === 'MOL/S' || u === 'GMOL/SEC') return 'MOL/SEC';
  if (u === 'LBMOL/HR' || u === 'LBMOL/H') return 'LBMOL/HR';
  return null;
}

function parseDutyUnit(raw: string): UnitContext['duty'] | null {
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (u === 'MCAL/HR' || u === 'GCAL/HR') return u === 'GCAL/HR' ? 'MCAL/HR' : 'MCAL/HR';
  if (u === 'KCAL/HR' || u === 'KCAL/H') return 'KCAL/HR';
  if (u === 'KW') return 'KW';
  if (u === 'MW') return 'MW';
  if (u === 'W' || u === 'J/SEC' || u === 'J/S') return 'W';
  if (u === 'BTU/HR' || u === 'BTU/H') return 'BTU/HR';
  if (u === 'MMBTU/HR' || u === 'MBTU/HR') return 'MMBTU/HR';
  if (u === 'GJ/HR' || u === 'GJ/H') return 'GJ/HR';
  return null;
}

function toTempC(val: number, unit: UnitContext['temp']): number {
  switch (unit) {
    case 'C':
      return val;
    case 'K':
      return val - 273.15;
    case 'F':
      return ((val - 32) * 5) / 9;
    case 'R':
      return ((val - 491.67) * 5) / 9;
  }
}

function toBarA(val: number, unit: UnitContext['pres']): number {
  switch (unit) {
    case 'BAR':
      return val;
    case 'ATM':
      return val * 1.01325;
    case 'KPA':
      return val / 100;
    case 'MPA':
      return val * 10;
    case 'PA':
      return val / 100000;
    case 'PSIA':
      return val * 0.06894757;
    case 'PSIG':
      return (val + 14.69595) * 0.06894757;
    case 'KGCM2':
      return val * 0.980665;
    case 'MMHG':
      return val * 0.00133322;
  }
}

function toDeltaBar(val: number, unit: UnitContext['pres']): number {
  switch (unit) {
    case 'BAR':
      return val;
    case 'ATM':
      return val * 1.01325;
    case 'KPA':
      return val / 100;
    case 'MPA':
      return val * 10;
    case 'PA':
      return val / 100000;
    case 'PSIA':
    case 'PSIG':
      return val * 0.06894757;
    case 'KGCM2':
      return val * 0.980665;
    case 'MMHG':
      return val * 0.00133322;
  }
}

function barAToKgcm2g(barA: number): number {
  return Number((barA * 1.0197162 - 1.033227).toFixed(4));
}

function kgcm2gToBarA(kgcm2g: number): number {
  return Number(Math.max(0.01, (kgcm2g + 1.033227) / 1.0197162).toFixed(4));
}

function toMassFlowKgH(val: number, unit: UnitContext['massFlow']): number {
  switch (unit) {
    case 'KG/HR':
      return val;
    case 'KG/SEC':
      return val * 3600;
    case 'G/SEC':
      return val * 3.6;
    case 'LB/HR':
      return val * 0.45359237;
    case 'TON/HR':
      return val * 1000;
  }
}

function toMoleFlowKmolH(val: number, unit: UnitContext['moleFlow']): number {
  switch (unit) {
    case 'KMOL/HR':
      return val;
    case 'KMOL/SEC':
      return val * 3600;
    case 'MOL/SEC':
      return val * 3.6;
    case 'LBMOL/HR':
      return val * 0.45359237;
  }
}

function toDutyMcalH(val: number, unit: UnitContext['duty']): number {
  switch (unit) {
    case 'MCAL/HR':
      return val;
    case 'KCAL/HR':
      return val / 1000;
    case 'KW':
      return val * 0.859845;
    case 'MW':
      return val * 859.845;
    case 'W':
      return val * 0.000859845;
    case 'BTU/HR':
      return val * 0.000251996;
    case 'MMBTU/HR':
      return val * 251.996;
    case 'GJ/HR':
      return val * 238.846;
  }
}

// ============================================================================
// 2. 88종 컴포넌트 매핑 테이블 (CAS / 화학식 / 표준명 / 관용 별칭)
// ============================================================================

const COMP_ALIASES: Record<SimCompKey, string[]> = {
  H2O: ['WATER', 'H2O', 'STEAM', 'AQUA'],
  NaCl: ['NACL', 'SODIUM-CHLORIDE', 'SALT', 'HALITE'],
  NaOH: ['NAOH', 'SODIUM-HYDROXIDE', 'CAUSTIC', 'CAUSTIC-SODA'],
  Cl2: ['CL2', 'CHLORINE'],
  H2: ['H2', 'HYDROGEN'],
  HCl: ['HCL', 'HYDROGEN-CHLORIDE', 'HYDROCHLORIC-ACID'],
  H2SO4: ['H2SO4', 'SULFURIC-ACID'],
  O2: ['O2', 'OXYGEN'],
  NaOCl: ['NAOCL', 'NACLO', 'SODIUM-HYPOCHLORITE'],
  N2: ['N2', 'NITROGEN'],
  NaClO3: ['NACLO3', 'SODIUM-CHLORATE'],
  FeCl2: ['FECL2', 'FERROUS-CHLORIDE', 'IRON-II-CHLORIDE'],
  FeCl3: ['FECL3', 'FERRIC-CHLORIDE', 'IRON-III-CHLORIDE'],
  PAC: ['PAC', 'POLY-ALUMINUM-CHLORIDE', 'AL2OH5CL'],
  Glycerol: ['GLYCEROL', 'GLYCERIN', 'C3H8O3', '1,2,3-PROPANETRIOL'],
  MCH: ['MCH', 'MONOCHLOROHYDRIN', '3-CHLORO-1,2-PROPANEDIOL', 'C3H7CLO2'],
  DCH: ['DCH', 'DICHLOROHYDRIN', '1,3-DICHLORO-2-PROPANOL', 'C3H6CL2O'],
  ECH: ['ECH', 'EPICHLOROHYDRIN', 'C3H5CLO', '1-CHLORO-2,3-EPOXYPROPANE'],
  DCP: ['DCP', '1,2-DICHLOROPROPANE', 'PROPYLENE-DICHLORIDE', 'C3H6CL2'],
  CH4: ['CH4', 'METHANE'],
  CO: ['CO', 'CARBON-MONOXIDE'],
  CO2: ['CO2', 'CARBON-DIOXIDE'],
  NH3: ['NH3', 'AMMONIA', 'H3N'],
  C2H4: ['C2H4', 'ETHYLENE', 'ETHENE'],
  C2H6: ['C2H6', 'ETHANE'],
  C3H6: ['C3H6', 'PROPYLENE', 'PROPENE'],
  C3H8: ['C3H8', 'PROPANE'],
  nC4H10: ['NC4H10', 'N-BUTANE', 'BUTANE', 'C4H10-1', 'C4H10', 'NBUTANE'],
  nC6H14: ['NC6H14', 'N-HEXANE', 'HEXANE', 'C6H14-1', 'C6H14', 'NHEXANE'],
  nC7H16: ['NC7H16', 'N-HEPTANE', 'HEPTANE', 'C7H16-1', 'C7H16', 'NHEPTANE'],
  Benzene: ['BENZENE', 'C6H6', 'BENZ'],
  Toluene: ['TOLUENE', 'C7H8', 'METHYLBENZENE', 'TOL'],
  pXylene: ['PXYLENE', 'P-XYLENE', 'PARA-XYLENE', '1,4-DIMETHYLBENZENE', 'C8H10-1', 'XYLENE'],
  MeOH: ['MEOH', 'METHANOL', 'CH4O', 'CH3OH', 'METHYL-ALCOHOL'],
  EtOH: ['ETOH', 'ETHANOL', 'C2H6O-2', 'C2H5OH', 'ETHYL-ALCOHOL'],
  IPA: ['IPA', 'ISOPROPANOL', '2-PROPANOL', 'ISOPROPYL-ALCOHOL', 'C3H8O-2', 'IPOH'],
  Acetone: ['ACETONE', 'PROPANONE', '2-PROPANONE', 'C3H6O-1', 'C3H6O', 'DIMETHYL-KETONE'],
  AceticAcid: ['ACETICACID', 'ACETIC-ACID', 'C2H4O2-1', 'C2H4O2', 'CH3COOH', 'HOAC', 'ETHANOIC-ACID'],
  EtOAc: ['ETOAC', 'ETAC', 'ETHYL-ACETATE', 'C4H8O2-3', 'C4H8O2', 'EA'],
  CHCl3: ['CHCL3', 'CHLOROFORM', 'TRICHLOROMETHANE', 'CFM'],
  Ar: ['AR', 'ARGON'],
  H2S: ['H2S', 'HYDROGEN-SULFIDE'],
  SO2: ['SO2', 'SULFUR-DIOXIDE'],
  SO3: ['SO3', 'SULFUR-TRIOXIDE'],
  iC4H10: ['IC4H10', 'ISOBUTANE', 'I-BUTANE', '2-METHYLPROPANE', 'C4H10-2', 'IBUTANE'],
  C4H8_1: ['C4H8_1', '1-BUTENE', 'BUTENE-1', '1-C4H8', 'C4H8-1', 'BUTENE'],
  nC5H12: ['NC5H12', 'N-PENTANE', 'PENTANE', 'C5H12-1', 'C5H12', 'NPENTANE'],
  nC8H18: ['NC8H18', 'N-OCTANE', 'OCTANE', 'C8H18-1', 'C8H18', 'NOCTANE'],
  Cyclohexane: ['CYCLOHEXANE', 'C6H12-1', 'C6H12', 'CYC6'],
  Ethylbenzene: ['ETHYLBENZENE', 'ETHYL-BENZENE', 'C8H10-4', 'EB'],
  Styrene: ['STYRENE', 'C8H8', 'VINYLBENZENE', 'SM'],
  Cumene: ['CUMENE', 'ISOPROPYLBENZENE', 'C9H12-1', 'C9H12'],
  Phenol: ['PHENOL', 'C6H6O', 'C6H5OH', 'HYDROXYBENZENE'],
  THF: ['THF', 'TETRAHYDROFURAN', 'C4H8O-2', 'OXOLANE'],
  DMF: ['DMF', 'N,N-DIMETHYLFORMAMIDE', 'DIMETHYLFORMAMIDE', 'C3H7NO-1', 'C3H7NO'],
  DMSO: ['DMSO', 'DIMETHYL-SULFOXIDE', 'DIMETHYLSULFOXIDE', 'C2H6OS'],
  MTBE: ['MTBE', 'METHYL-TERT-BUTYL-ETHER', 'C5H12O-D2', 'C5H12O'],
  MEK: ['MEK', 'METHYL-ETHYL-KETONE', '2-BUTANONE', 'BUTANONE', 'C4H8O-3'],
  DMC: ['DMC', 'DIMETHYL-CARBONATE', 'C3H6O3'],
  EG: ['EG', 'MEG', 'ETHYLENE-GLYCOL', '1,2-ETHANEDIOL', 'C2H6O2'],
  MEA: ['MEA', 'MONOETHANOLAMINE', 'ETHANOLAMINE', '2-AMINOETHANOL', 'C2H7NO'],
  MDEA: ['MDEA', 'METHYLDIETHANOLAMINE', 'N-METHYLDIETHANOLAMINE', 'C5H13NO2'],
  FormicAcid: ['FORMICACID', 'FORMIC-ACID', 'HCOOH', 'CH2O2', 'METHANOIC-ACID'],
  HNO3: ['HNO3', 'NITRIC-ACID'],
  CH3Cl: ['CH3CL', 'METHYL-CHLORIDE', 'CHLOROMETHANE', 'R40'],
  CH2Cl2: ['CH2CL2', 'DCM', 'DICHLOROMETHANE', 'METHYLENE-CHLORIDE', 'MCL'],
  CCl4: ['CCL4', 'CARBON-TETRACHLORIDE', 'TETRACHLOROMETHANE', 'CTC'],
  C2Cl4: ['C2CL4', 'PERCHLOROETHYLENE', 'TETRACHLOROETHYLENE', 'PCE', 'PERC'],
  COCl2: ['COCL2', 'PHOSGENE', 'CARBONYL-CHLORIDE'],
  HCHO: ['HCHO', 'FORMALDEHYDE', 'CH2O', 'METHANAL', 'FORMALIN'],
  MCB: ['MCB', 'CHLOROBENZENE', 'MONOCHLOROBENZENE', 'C6H5CL'],
  Aniline: ['ANILINE', 'C6H7N', 'C6H5NH2', 'AMINOBENZENE'],
  MDA: ['MDA', '4,4-METHYLENEDIANILINE', 'METHYLENEDIANILINE', 'C13H14N2'],
  MDI: ['MDI', 'METHYLENE-DIPHENYL-DIISOCYANATE', '4,4-MDI', 'C15H10N2O2'],
  PMDI: ['PMDI', 'POLYMERIC-MDI'],
  CUSTOM_1: ['CUSTOM_1', 'CUSTOM-1', 'CUSTOM1'],
  CUSTOM_2: ['CUSTOM_2', 'CUSTOM-2', 'CUSTOM2'],
  H2O2: ['H2O2', 'HYDROGEN-PEROXIDE', 'PEROXIDE'],
  H3PO4: ['H3PO4', 'PHOSPHORIC-ACID', 'ORTHOPHOSPHORIC-ACID'],
  HF: ['HF', 'HYDROGEN-FLUORIDE', 'HYDROFLUORIC-ACID'],
  KOH: ['KOH', 'POTASSIUM-HYDROXIDE', 'CAUSTIC-POTASH'],
  NH4OH: ['NH4OH', 'AMMONIUM-HYDROXIDE', 'AQUEOUS-AMMONIA'],
  TMAH: ['TMAH', 'TETRAMETHYLAMMONIUM-HYDROXIDE', 'C4H13NO'],
  NMP: ['NMP', 'N-METHYL-2-PYRROLIDONE', 'N-METHYLPYRROLIDONE', '1-METHYL-2-PYRROLIDINONE', 'C5H9NO'],
  BCS: ['BCS', '2-BUTOXYETHANOL', 'BUTYL-CELLOSOLVE', 'EGBE', 'C6H14O2'],
  Na2CO3: ['NA2CO3', 'SODIUM-CARBONATE', 'SODA-ASH'],
  NaHSO3: ['NAHSO3', 'SODIUM-BISULFITE', 'SODIUM-HYDROGEN-SULFITE'],
  CaOH2: ['CAOH2', 'CA(OH)2', 'CALCIUM-HYDROXIDE', 'SLAKED-LIME'],
};

// 내보내기용 표준 화학식/명칭 (읽기 쉬운 .inp 형식)
const COMP_EXPORT_SPEC: Partial<Record<SimCompKey, string>> = {
  H2O: 'H2O',
  MeOH: 'CH4O',
  EtOH: 'C2H6O-2',
  IPA: 'C3H8O-2',
  Benzene: 'C6H6',
  Toluene: 'C7H8',
  pXylene: 'C8H10-1',
  Acetone: 'C3H6O-1',
  AceticAcid: 'C2H4O2-1',
  EtOAc: 'C4H8O2-3',
  nC4H10: 'C4H10-1',
  iC4H10: 'C4H10-2',
  nC5H12: 'C5H12-1',
  nC6H14: 'C6H14-1',
  nC7H16: 'C7H16-1',
  nC8H18: 'C8H18-1',
  Cyclohexane: 'C6H12-1',
  Ethylbenzene: 'C8H10-4',
  Styrene: 'C8H8',
  Cumene: 'C9H12-1',
  Phenol: 'C6H6O',
  THF: 'C4H8O-2',
  DMF: 'C3H7NO-1',
  DMSO: 'C2H6OS',
  MTBE: 'C5H12O-D2',
  MEK: 'C4H8O-3',
  DMC: 'C3H6O3',
  EG: 'C2H6O2',
  MEA: 'C2H7NO',
  MDEA: 'C5H13NO2',
  FormicAcid: 'CH2O2',
  CH2Cl2: 'CH2CL2',
  NMP: 'C5H9NO',
  BCS: 'C6H14O2',
};

function normalizeCompToken(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toUpperCase()
    .replace(/\s+/g, '-');
}

function buildCompLookup(): Map<string, SimCompKey> {
  const map = new Map<string, SimCompKey>();
  for (const key of SIM_COMPS) {
    map.set(normalizeCompToken(key), key);
    const meta = COMP_CATALOG_META[key];
    if (meta?.cas) {
      map.set(normalizeCompToken(meta.cas), key);
      map.set(normalizeCompToken(meta.cas).replace(/-/g, ''), key);
    }
    const aliases = COMP_ALIASES[key] ?? [];
    for (const a of aliases) {
      map.set(normalizeCompToken(a), key);
      // 하이픈/언더스코어 제거 변형도 허용
      const compact = normalizeCompToken(a).replace(/[-_]/g, '');
      if (!map.has(compact)) {
        map.set(compact, key);
      }
    }
  }
  return map;
}

const COMP_LOOKUP = buildCompLookup();

function resolveSimComp(token: string): SimCompKey | null {
  const norm = normalizeCompToken(token);
  if (!norm) return null;
  const direct = COMP_LOOKUP.get(norm);
  if (direct) return direct;
  const compact = norm.replace(/[-_]/g, '');
  return COMP_LOOKUP.get(compact) ?? null;
}

function mwOfComp(key: SimCompKey): number {
  return (MW as Record<string, number>)[key] ?? 50.0;
}

// ============================================================================
// 3. 텍스트 전처리 및 섹션 분리 (주석 제거 · 줄 이어쓰기 · 바이너리/리포트 절단)
// ============================================================================

const TOP_LEVEL_KEYWORDS = new Set([
  'TITLE',
  'DESCRIPTION',
  'IN-UNITS',
  'OUT-UNITS',
  'DEF-STREAMS',
  'DATABANKS',
  'PROP-SOURCES',
  'COMPONENTS',
  'SOLVE',
  'FLOWSHEET',
  'HIERARCHY',
  'END-HIERARCHY',
  'PROPERTIES',
  'PROP-DATA',
  'PROP-SET',
  'CHEMISTRY',
  'REACTIONS',
  'STREAM-CLASS',
  'STREAM',
  'BLOCK',
  'DESIGN-SPEC',
  'SENSITIVITY',
  'CALCULATOR',
  'TRANSFER',
  'OPTIMIZATION',
  'CONSTRAINT',
  'FORTRAN',
  'CONVERGENCE',
  'CONV-OPTIONS',
  'EO-OPTIONS',
  'SIM-OPTIONS',
  'FLOWSHEET-OPTIONS',
  'RUN-CONTROL',
  'REPORT',
  'STREAM-REPORT',
  'STREAM-RESULTS',
  'BLOCK-RESULTS',
  'UTILITY',
  'COSTING',
  'DYNAMICS',
  'PRESSURE-RELIEF',
  'GRAPHICS_BACKUP',
  'PFD',
  'VERSION',
  'SECTION',
  'HISTORY',
  'END-INPUT',
]);

const TRAILER_STOP_MARKERS = [
  '*** SUMMARY',
  'SIMULATION RESULTS',
  'END-INPUT',
];

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ';' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

interface ParsedSection {
  keyword: string;
  headerTokens: string[];
  bodyLines: string[];
}

function splitIntoSections(rawText: string): ParsedSection[] {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');

  // 1) 바이너리/리포트 트레일러 절단 + 주석 제거 + '&' 줄 이어쓰기 병합
  const logicalLines: Array<{ text: string; indented: boolean }> = [];
  let pendingLine: { text: string; indented: boolean } | null = null;

  for (const raw of rawLines) {
    // NUL 바이트가 포함된 순수 바이너리 행만 건너뛰고, 단일 제어문자(FF/Ctrl-Z 등)로 전체 파일을 조기 중단하지 않음
    if (raw.includes('\x00')) {
      continue;
    }
    const sanitizedRaw = raw.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
    const upperTrim = sanitizedRaw.trim().toUpperCase();
    if (TRAILER_STOP_MARKERS.some((m) => upperTrim.startsWith(m))) {
      break;
    }

    const noComment = stripInlineComment(sanitizedRaw);
    const trimmedRight = noComment.replace(/\s+$/, '');
    if (trimmedRight.trim().length === 0) {
      continue;
    }

    const isIndented = /^\s+/.test(trimmedRight);
    const hasContinuation = trimmedRight.endsWith('&');
    const cleanPart = hasContinuation
      ? trimmedRight.slice(0, -1).replace(/\s+$/, '')
      : trimmedRight;

    if (pendingLine) {
      pendingLine.text += ' ' + cleanPart.trim();
      if (!hasContinuation) {
        logicalLines.push(pendingLine);
        pendingLine = null;
      }
    } else if (hasContinuation) {
      pendingLine = { text: cleanPart, indented: isIndented };
    } else {
      logicalLines.push({ text: cleanPart, indented: isIndented });
    }
  }
  if (pendingLine) {
    logicalLines.push(pendingLine);
  }

  // 2) 최상위 섹션으로 그룹핑
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const item of logicalLines) {
    const tokens = tokenizeLine(item.text);
    if (tokens.length === 0) continue;
    const firstUpper = tokens[0].toUpperCase();

    const startsNewSection =
      (!item.indented && TOP_LEVEL_KEYWORDS.has(firstUpper)) ||
      (item.indented &&
        (firstUpper === 'TITLE' ||
          firstUpper === 'IN-UNITS' ||
          firstUpper === 'COMPONENTS' ||
          firstUpper === 'PROPERTIES' ||
          firstUpper === 'FLOWSHEET' ||
          firstUpper === 'STREAM' ||
          firstUpper === 'BLOCK') &&
        // FLOWSHEET 내부의 'BLOCK B1 IN=... OUT=...' 는 새 섹션이 아님
        !(current?.keyword === 'FLOWSHEET' && firstUpper === 'BLOCK'));

    if (startsNewSection) {
      current = {
        keyword: firstUpper,
        headerTokens: tokens.slice(1),
        bodyLines: [],
      };
      sections.push(current);
    } else if (current) {
      current.bodyLines.push(item.text.trim());
    }
  }

  return sections;
}

// ============================================================================
// 4. Key=Value 및 인라인 단위 파서 (<C>, <BAR>, <KMOL/HR> 등)
// ============================================================================

interface KvEntry {
  key: string;
  value: string;
  inlineUnit?: string;
}

function parseKeyValues(text: string): KvEntry[] {
  const tokens = tokenizeLine(text);
  const out: KvEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const eqIdx = tok.indexOf('=');
    if (eqIdx > 0) {
      const key = tok.slice(0, eqIdx).toUpperCase();
      let value = tok.slice(eqIdx + 1);
      if (value === '' && i + 1 < tokens.length) {
        value = tokens[++i];
      }
      let inlineUnit: string | undefined;
      if (i + 1 < tokens.length && /^<[^>]+>$/.test(tokens[i + 1])) {
        inlineUnit = tokens[++i].slice(1, -1);
      }
      out.push({ key, value, inlineUnit });
    }
  }
  return out;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[<>]/g, '').replace(/D([+-]?\d+)/i, 'E$1');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// 5. 블록 유형 및 열역학 모델 매핑
// ============================================================================

function mapPropertyMethod(
  rawMethod: string,
  warnings: string[]
): SimPropertyMethod {
  const m = rawMethod.toUpperCase().trim();
  if (m === 'NRTL' || m.startsWith('NRTL-')) return 'NRTL';
  if (m === 'PENG-ROB' || m === 'PR' || m.startsWith('PR-') || m.startsWith('PRMH') || m === 'PRWS') {
    return 'PR';
  }
  if (m === 'RK-SOAVE' || m === 'SRK' || m.startsWith('RKS-') || m === 'PSRK' || m === 'SR-POLAR') {
    return 'SRK';
  }
  if (m === 'ELECNRTL' || m.startsWith('ENRTL') || m === 'PITZER' || m === 'OLI') {
    return 'ENRTL';
  }
  if (m === 'UNIQUAC' || m.startsWith('UNIQ-') || m === 'WILSON' || m === 'UNIFAC') {
    warnings.push(
      `열역학 모델 '${rawMethod}'은(는) 호환 활동도 계수 모델인 NRTL로 자동 매핑되었습니다.`
    );
    return 'NRTL';
  }
  if (m === 'IDEAL' || m === 'SYSOP0') {
    warnings.push(
      `열역학 모델 '${rawMethod}'은(는) 자동 선택(AUTO) 모드로 매핑되었습니다.`
    );
    return 'AUTO';
  }
  warnings.push(
    `지원되지 않는 열역학 모델 '${rawMethod}'이(가) 감지되어 자동 선택(AUTO)으로 설정했습니다.`
  );
  return 'AUTO';
}

function mapBlockType(
  rawType: string,
  blockId: string,
  warnings: string[]
): FlowUnitType {
  const t = rawType.toUpperCase().trim();
  switch (t) {
    case 'MIXER':
      return 'mixer';
    case 'FSPLIT':
    case 'SSPLIT':
      return 'splitter';
    case 'HEATER':
    case 'COOLER':
    case 'HEATX':
    case 'MHEATX':
      return 'hex';
    case 'FLASH2':
    case 'FLASH3':
    case 'SEP':
    case 'SEP2':
      return 'separator';
    case 'RADFRAC':
    case 'DSTWU':
    case 'DISTL':
    case 'PETROFRAC':
    case 'SCFRAC':
      return 'distillation';
    case 'ABSBR':
      return 'absorber';
    case 'EXTRACT':
      return 'extractor';
    case 'PUMP':
      return 'pump';
    case 'COMPR':
    case 'MCOMPR':
      return 'compressor';
    case 'RSTOIC':
    case 'RYIELD':
    case 'REQUIL':
    case 'RCSTR':
    case 'RPLUG':
    case 'RGIBBS':
      return 'reactor';
    case 'VALVE':
      return 'valve';
    default:
      warnings.push(
        `블록 '${blockId}'의 장치 유형 '${rawType}'은(는) 기본 혼합기(mixer)로 대체 매핑되었습니다.`
      );
      return 'mixer';
  }
}

function defaultUnitLabel(unitType: FlowUnitType, blockId: string, rawType?: string): string {
  const rawUpper = (rawType ?? '').toUpperCase();
  if (rawUpper === 'HEATER') return `${blockId} 가열기`;
  if (rawUpper === 'COOLER') return `${blockId} 냉각기`;
  if (rawUpper === 'HEATX' || rawUpper === 'MHEATX') return `${blockId} 열교환기`;
  switch (unitType) {
    case 'mixer':
      return `${blockId} 혼합기`;
    case 'splitter':
      return `${blockId} 분배기`;
    case 'hex':
      return `${blockId} 열교환기`;
    case 'separator':
      return `${blockId} 기액분리기`;
    case 'distillation':
      return `${blockId} 증류탑`;
    case 'absorber':
      return `${blockId} 흡수탑`;
    case 'extractor':
      return `${blockId} 추출탑`;
    case 'pump':
      return `${blockId} 펌프`;
    case 'compressor':
      return `${blockId} 압축기`;
    case 'reactor':
      return `${blockId} 반응기`;
    case 'valve':
      return `${blockId} 감압밸브`;
    default:
      return blockId;
  }
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

// ============================================================================
// 6. 메인 파서: parseProcessTextFile
// ============================================================================

export function parseProcessTextFile(
  rawText: string,
  fileName?: string
): ProcessTextImportResult {
  const warnings: string[] = [];
  const sections = splitIntoSections(rawText || '');

  const fallbackTitle = fileName
    ? fileName.replace(/\.(inp|bkp|txt)$/i, '')
    : '가져온 공정 모델';
  let title = fallbackTitle;

  const units: UnitContext = { ...DEFAULT_UNITS_BY_SET.MET };
  let propertyMethod: SimPropertyMethod = 'AUTO';

  const localCompMap = new Map<string, SimCompKey>();
  const activeComponents: SimCompKey[] = [];
  const unmappedComps: string[] = [];

  // 1차 패스: TITLE, IN-UNITS, COMPONENTS, PROPERTIES 파싱
  for (const sec of sections) {
    if (sec.keyword === 'TITLE') {
      const joined = [...sec.headerTokens, ...sec.bodyLines]
        .join(' ')
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (joined) title = joined;
    } else if (sec.keyword === 'IN-UNITS') {
      const allText = [...sec.headerTokens, ...sec.bodyLines].join(' ');
      const tokens = tokenizeLine(allText);
      if (tokens.length > 0) {
        const base = tokens[0].toUpperCase();
        if (base === 'ENG') Object.assign(units, DEFAULT_UNITS_BY_SET.ENG);
        else if (base === 'SI') Object.assign(units, DEFAULT_UNITS_BY_SET.SI);
        else if (base.startsWith('MET')) Object.assign(units, DEFAULT_UNITS_BY_SET.MET);
      }
      for (const kv of parseKeyValues(allText)) {
        if (kv.key === 'TEMP' || kv.key === 'TEMPERATURE') {
          const u = parseTempUnit(kv.value);
          if (u) units.temp = u;
        } else if (kv.key === 'PRES' || kv.key === 'PRESSURE') {
          const u = parsePresUnit(kv.value);
          if (u) units.pres = u;
        } else if (kv.key === 'MASS-FLOW') {
          const u = parseMassFlowUnit(kv.value);
          if (u) units.massFlow = u;
        } else if (kv.key === 'MOLE-FLOW') {
          const u = parseMoleFlowUnit(kv.value);
          if (u) units.moleFlow = u;
        } else if (kv.key === 'FLOW') {
          const mf = parseMassFlowUnit(kv.value);
          if (mf) units.massFlow = mf;
          const molf = parseMoleFlowUnit(kv.value);
          if (molf) units.moleFlow = molf;
        } else if (kv.key === 'HEAT-DUTY' || kv.key === 'QCALC' || kv.key === 'DUTY') {
          const d = parseDutyUnit(kv.value);
          if (d) units.duty = d;
        }
      }
    } else if (sec.keyword === 'PROPERTIES') {
      const allTokens = [...sec.headerTokens, ...tokenizeLine(sec.bodyLines.join(' '))];
      if (allTokens.length > 0) {
        propertyMethod = mapPropertyMethod(allTokens[0], warnings);
      }
    } else if (sec.keyword === 'COMPONENTS') {
      const compLines = [
        ...(sec.headerTokens.length > 0 ? [sec.headerTokens.join(' ')] : []),
        ...sec.bodyLines,
      ];
      for (const line of compLines) {
        const toks = tokenizeLine(line);
        if (toks.length === 0) continue;
        // 'COMP-ID FORMULA / ALIAS' 형태
        const compId = toks[0];
        let matched: SimCompKey | null = null;
        // 2번째 이후 토큰(화학식/CAS/표준명) 우선 탐색 후 1번째 토큰(ID) 탐색
        for (let i = 1; i < toks.length; i++) {
          if (toks[i] === '/') continue;
          matched = resolveSimComp(toks[i]);
          if (matched) break;
        }
        if (!matched) {
          matched = resolveSimComp(compId);
        }

        if (matched) {
          localCompMap.set(normalizeCompToken(compId), matched);
          if (toks[1]) {
            localCompMap.set(normalizeCompToken(toks[1]), matched);
          }
          if (!activeComponents.includes(matched)) {
            activeComponents.push(matched);
          }
        } else {
          if (!unmappedComps.includes(compId)) {
            unmappedComps.push(compId);
            warnings.push(
              `성분 '${compId}'(${toks[1] ?? '미지정'})은(는) 내장 88종 물성 DB에 없어 매핑에서 제외되었습니다.`
            );
          }
        }
      }
    }
  }

  const mappedCompCount = activeComponents.length;
  if (activeComponents.length === 0) {
    activeComponents.push('MeOH', 'H2O');
    warnings.push(
      '매핑된 유효 성분이 없어 기본 2성분계(MeOH, H2O)로 자동 초기화되었습니다.'
    );
  } else if (activeComponents.length === 1) {
    const pad: SimCompKey = activeComponents[0] === 'H2O' ? 'MeOH' : 'H2O';
    activeComponents.push(pad);
    warnings.push(
      `단일 성분(${activeComponents[0]})만 감지되어 시뮬레이터 최소 성분 수(2종) 충족을 위해 ${pad}을(를) 보조 성분으로 추가했습니다.`
    );
  }

  // 2차 패스: FLOWSHEET 토폴로지 파싱
  interface FlowsheetBlockEntry {
    id: string;
    inStreams: string[];
    outStreams: string[];
  }
  const flowsheetBlocks: FlowsheetBlockEntry[] = [];
  const blockMap = new Map<string, FlowsheetBlockEntry>();

  for (const sec of sections) {
    if (sec.keyword !== 'FLOWSHEET') continue;
    let currentEntry: FlowsheetBlockEntry | null = null;
    let mode: 'none' | 'in' | 'out' = 'none';

    for (const line of sec.bodyLines) {
      const toks = tokenizeLine(line);
      if (toks.length === 0) continue;

      let startIdx = 0;
      if (toks[0].toUpperCase() === 'BLOCK' && toks.length >= 2) {
        const bId = toks[1];
        const existing = blockMap.get(bId);
        if (existing) {
          currentEntry = existing;
        } else {
          currentEntry = { id: bId, inStreams: [], outStreams: [] };
          flowsheetBlocks.push(currentEntry);
          blockMap.set(bId, currentEntry);
        }
        mode = 'none';
        startIdx = 2;
      } else if (!currentEntry) {
        continue;
      }

      for (let i = startIdx; i < toks.length; i++) {
        const tok = toks[i].replace(/,+$/, '');
        if (!tok) continue;
        const upper = tok.toUpperCase();

        if (upper.startsWith('IN=')) {
          mode = 'in';
          const rest = tok.slice(3).replace(/,+$/, '');
          if (rest && !/\((HEAT|WORK)\)$/i.test(rest)) currentEntry.inStreams.push(rest);
        } else if (upper === 'IN') {
          mode = 'in';
        } else if (upper.startsWith('OUT=')) {
          mode = 'out';
          const rest = tok.slice(4).replace(/,+$/, '');
          if (rest && !/\((HEAT|WORK)\)$/i.test(rest)) currentEntry.outStreams.push(rest);
        } else if (upper === 'OUT') {
          mode = 'out';
        } else if (upper === '(HEAT)' || upper === '(WORK)') {
          // 직전 스트림이 열/일 스트림으로 표시된 경우 물질 스트림 목록에서 제거
          if (mode === 'in' && currentEntry.inStreams.length > 0) currentEntry.inStreams.pop();
          else if (mode === 'out' && currentEntry.outStreams.length > 0) currentEntry.outStreams.pop();
        } else if (tok.startsWith('(') && tok.endsWith(')')) {
          continue;
        } else if (/\((HEAT|WORK)\)$/i.test(tok)) {
          continue;
        } else {
          if (mode === 'in') currentEntry.inStreams.push(tok);
          else if (mode === 'out') currentEntry.outStreams.push(tok);
        }
      }
    }
  }

  // 3차 패스: BLOCK 정의 및 파라미터 파싱
  const defs: Record<string, FlowNodeDef> = {};
  const blockRawTypeMap = new Map<string, string>();
  const pendingPratioMap = new Map<string, number>();

  for (const sec of sections) {
    if (sec.keyword !== 'BLOCK') continue;
    if (sec.headerTokens.length < 2) continue;
    const bId = sec.headerTokens[0];
    const rawType = sec.headerTokens[1];
    const unitType = mapBlockType(rawType, bId, warnings);
    blockRawTypeMap.set(bId, rawType.toUpperCase());

    const nodeId = `blk_${sanitizeId(bId)}`;
    const params: FlowUnitParams = {
      calcMode: 'rigorous',
    };

    const distillCfg: DistillColumnParams = {};
    let hasDistillCfg = false;
    const fsBlock = blockMap.get(bId);

    for (const line of sec.bodyLines) {
      const toks = tokenizeLine(line);
      if (toks.length === 0) continue;
      const head = toks[0].toUpperCase();

      if (head === 'PARAM' || head === 'CONFIG' || head === 'SPECS' || head === 'ESTIMATE') {
        for (const kv of parseKeyValues(line)) {
          const val = parseNumber(kv.value);
          if (val === null) continue;

          if (kv.key === 'TEMP' || kv.key === 'T') {
            const tu = kv.inlineUnit ? parseTempUnit(kv.inlineUnit) ?? units.temp : units.temp;
            params.operTempC = Number(toTempC(val, tu).toFixed(2));
            if (unitType === 'reactor') params.reactorThermalMode = 'isothermal';
          } else if (kv.key === 'PRES' || kv.key === 'P') {
            const pu = kv.inlineUnit ? parsePresUnit(kv.inlineUnit) ?? units.pres : units.pres;
            if (val > 0) {
              const pKgcm2g = barAToKgcm2g(toBarA(val, pu));
              if (unitType === 'pump' || unitType === 'compressor') {
                params.outletPressKgcm2g = pKgcm2g;
              } else if (unitType === 'distillation') {
                distillCfg.topPressKgcm2g = pKgcm2g;
                hasDistillCfg = true;
              } else {
                params.operPressKgcm2g = pKgcm2g;
              }
            } else if (val < 0) {
              // 음수 PRES는 압력강하(ΔP)를 의미
              const dpBar = toDeltaBar(Math.abs(val), pu);
              params.pressureDropKgcm2 = Number((dpBar * 1.0197162).toFixed(4));
            }
          } else if (kv.key === 'DELP' || kv.key === 'DP') {
            const pu = kv.inlineUnit ? parsePresUnit(kv.inlineUnit) ?? units.pres : units.pres;
            const dpBar = toDeltaBar(Math.abs(val), pu);
            if (unitType === 'pump' || unitType === 'compressor') {
              // 기본 흡입압 1 barA 기준으로 토출압 추정 (추후 피드 압력 반영 가능)
              params.outletPressKgcm2g = barAToKgcm2g(1.01325 + dpBar);
            } else {
              params.pressureDropKgcm2 = Number((dpBar * 1.0197162).toFixed(4));
            }
          } else if (kv.key === 'PRATIO') {
            pendingPratioMap.set(nodeId, val);
          } else if (kv.key === 'EFF' || kv.key === 'SEFF' || kv.key === 'PEFF') {
            params.efficiency = val > 1 ? val / 100 : val;
          } else if (kv.key === 'DUTY' || kv.key === 'Q') {
            const du = kv.inlineUnit ? parseDutyUnit(kv.inlineUnit) ?? units.duty : units.duty;
            const dutyMcalH = Number(toDutyMcalH(val, du).toFixed(3));
            if (unitType === 'hex') {
              params.hexSpecMode = 'heat_duty';
              params.specifiedDutyMcalH = dutyMcalH;
            } else if (unitType === 'separator' && Math.abs(val) < 1e-9) {
              params.flashMode = 'adiabatic';
            } else if (unitType === 'reactor' && Math.abs(val) < 1e-9) {
              params.reactorThermalMode = 'adiabatic';
            }
          } else if (kv.key === 'VFRAC') {
            if (unitType === 'separator' && params.operTempC === undefined) {
              params.flashMode = 'isothermal';
            }
          } else if (kv.key === 'NSTAGE' || kv.key === 'NSTAGES') {
            distillCfg.totalStages = Math.max(3, Math.round(val));
            hasDistillCfg = true;
          } else if (kv.key === 'RR' || kv.key === 'MOLE-RR' || kv.key === 'BASIS-RR') {
            distillCfg.topSpecType = 'reflux_ratio';
            distillCfg.topSpecValue = val;
            hasDistillCfg = true;
          } else if (kv.key === 'D:F' || kv.key === 'DF' || kv.key === 'MOLE-D:F' || kv.key === 'DISTIL-RATE') {
            distillCfg.splitSpecType = 'd_over_f_mole';
            distillCfg.splitSpecValue = val;
            hasDistillCfg = true;
          } else if (kv.key === 'MASS-D:F') {
            distillCfg.splitSpecType = 'd_over_f_mass';
            distillCfg.splitSpecValue = val;
            hasDistillCfg = true;
          } else if (kv.key === 'FEED-STAGE') {
            distillCfg.feedStage = Math.max(1, Math.round(val));
            hasDistillCfg = true;
          } else if (kv.key === 'DP-STAGE' || kv.key === 'COL-DP') {
            const pu = kv.inlineUnit ? parsePresUnit(kv.inlineUnit) ?? units.pres : units.pres;
            const dpKgcm2 = toDeltaBar(Math.abs(val), pu) * 1.0197162;
            distillCfg.stageDeltaPKgcm2 =
              kv.key === 'COL-DP' && distillCfg.totalStages
                ? Number((dpKgcm2 / Math.max(1, distillCfg.totalStages)).toFixed(5))
                : Number(dpKgcm2.toFixed(5));
            hasDistillCfg = true;
          } else if (kv.key === 'CONV' || kv.key === 'EXTENT') {
            params.conversion = val > 1 ? val / 100 : val;
          } else if (kv.key === 'VOL' || kv.key === 'VOLUME') {
            params.reactorVolumeM3 = val;
          } else if (kv.key === 'FRAC') {
            params.splitRatioTop = Math.max(0, Math.min(1, val));
          }
        }
      } else if (head === 'FRAC' || head === 'SPLIT-FRAC') {
        // 예: FRAC S3 0.35
        if (toks.length >= 3) {
          const streamName = toks[1];
          const val = parseNumber(toks[2]);
          if (val !== null) {
            const clamped = Math.max(0, Math.min(1, val));
            if (fsBlock && fsBlock.outStreams[1] === streamName) {
              params.splitRatioTop = Number((1 - clamped).toFixed(4));
            } else {
              params.splitRatioTop = clamped;
            }
          }
        }
      } else if (head === 'FEEDS') {
        // 예: FEEDS S3 10 / FEEDS S3 10 ON-STAGE
        if (toks.length >= 3) {
          const stg = parseNumber(toks[2]);
          if (stg !== null) {
            distillCfg.feedStage = Math.max(1, Math.round(stg));
            hasDistillCfg = true;
          }
        }
      } else if (head === 'P-SPEC' || head === 'COL-SPECS') {
        // 예: P-SPEC 1 1.2 <BAR> 또는 COL-SPECS D:F=0.5 MOLE-RR=2.5
        if (head === 'P-SPEC' && toks.length >= 3) {
          const pVal = parseNumber(toks[2]);
          if (pVal !== null && pVal > 0) {
            const inlineU =
              toks[3] && /^<[^>]+>$/.test(toks[3])
                ? parsePresUnit(toks[3].slice(1, -1)) ?? units.pres
                : units.pres;
            distillCfg.topPressKgcm2g = barAToKgcm2g(toBarA(pVal, inlineU));
            hasDistillCfg = true;
          }
        } else {
          for (const kv of parseKeyValues(line)) {
            const val = parseNumber(kv.value);
            if (val === null) continue;
            if (kv.key === 'MOLE-RR' || kv.key === 'RR') {
              distillCfg.topSpecType = 'reflux_ratio';
              distillCfg.topSpecValue = val;
              hasDistillCfg = true;
            } else if (kv.key === 'D:F' || kv.key === 'MOLE-D:F') {
              distillCfg.splitSpecType = 'd_over_f_mole';
              distillCfg.splitSpecValue = val;
              hasDistillCfg = true;
            } else if (kv.key === 'MASS-D:F') {
              distillCfg.splitSpecType = 'd_over_f_mass';
              distillCfg.splitSpecValue = val;
              hasDistillCfg = true;
            }
          }
        }
      }
    }

    if (unitType === 'reactor') {
      const rt = rawType.toUpperCase();
      if (rt === 'RCSTR') params.reactorModel = 'cstr';
      else if (rt === 'RPLUG') params.reactorModel = 'pfr';
      else params.reactorModel = 'conversion';
    }

    if (unitType === 'distillation') {
      const totalStages = distillCfg.totalStages ?? 20;
      const feedStage = Math.min(
        totalStages - 1,
        Math.max(2, distillCfg.feedStage ?? Math.round(totalStages / 2))
      );
      params.distillConfig = {
        columnCalcMode: 'rigorous_mesh',
        thermoModel: propertyMethod,
        totalStages,
        feedStage,
        condenserType: 'total',
        reboilerType: 'kettle',
        topPressKgcm2g: distillCfg.topPressKgcm2g ?? 0.0,
        stageDeltaPKgcm2: distillCfg.stageDeltaPKgcm2 ?? 0.004,
        topSpecType: distillCfg.topSpecType ?? 'reflux_ratio',
        topSpecValue: distillCfg.topSpecValue ?? 2.0,
        splitSpecType: distillCfg.splitSpecType ?? 'd_over_f_mole',
        splitSpecValue: distillCfg.splitSpecValue ?? 0.5,
      };
    } else if (hasDistillCfg) {
      params.distillConfig = distillCfg;
    }

    defs[nodeId] = {
      id: nodeId,
      tag: bId,
      name: defaultUnitLabel(unitType, bId, rawType),
      unitType,
      params,
    };
  }

  // FLOWSHEET에 선언되었으나 BLOCK 섹션이 누락된 블록 보완
  for (const fb of flowsheetBlocks) {
    const nodeId = `blk_${sanitizeId(fb.id)}`;
    if (!defs[nodeId]) {
      warnings.push(
        `FLOWSHEET 블록 '${fb.id}'의 상세 BLOCK 정의가 없어 기본 혼합기(mixer)로 생성했습니다.`
      );
      defs[nodeId] = {
        id: nodeId,
        tag: fb.id,
        name: `${fb.id} 혼합기`,
        unitType: 'mixer',
        params: { calcMode: 'rigorous' },
      };
    }
  }

  // 4차 패스: 스트림 입출력 분석 → Feed / Product 자동 생성 및 FlowEdgeDef 구성
  const streamProducer = new Map<string, { blockId: string; nodeId: string; outIndex: number }>();
  const streamConsumers = new Map<
    string,
    Array<{ blockId: string; nodeId: string; inIndex: number }>
  >();
  const allStreamOrder: string[] = [];
  const trackStream = (s: string) => {
    if (!allStreamOrder.includes(s)) allStreamOrder.push(s);
  };

  for (const fb of flowsheetBlocks) {
    const nodeId = `blk_${sanitizeId(fb.id)}`;
    fb.inStreams.forEach((s, idx) => {
      trackStream(s);
      const list = streamConsumers.get(s) ?? [];
      list.push({ blockId: fb.id, nodeId, inIndex: idx });
      streamConsumers.set(s, list);
    });
    fb.outStreams.forEach((s, idx) => {
      trackStream(s);
      streamProducer.set(s, { blockId: fb.id, nodeId, outIndex: idx });
    });
  }

  // Feed / Product 노드 생성
  const feedNodeIdByStream = new Map<string, string>();
  const prodNodeIdByStream = new Map<string, string>();

  for (const s of allStreamOrder) {
    const hasProd = streamProducer.has(s);
    const hasCons = (streamConsumers.get(s)?.length ?? 0) > 0;
    if (!hasProd && hasCons) {
      const fId = `feed_${sanitizeId(s)}`;
      feedNodeIdByStream.set(s, fId);
      defs[fId] = {
        id: fId,
        tag: s,
        name: `${s} 공급`,
        unitType: 'feed',
        params: {
          feedTempC: 25,
          feedPressKgcm2g: 0,
          feedFlowsKgH: emptySimFlows(),
        },
      };
    } else if (hasProd && !hasCons) {
      const pId = `prod_${sanitizeId(s)}`;
      prodNodeIdByStream.set(s, pId);
      defs[pId] = {
        id: pId,
        tag: s,
        name: `${s} 제품`,
        unitType: 'product',
        params: {},
      };
    }
  }

  // 5차 패스: STREAM 섹션 파싱 (온도·압력·질량/몰유량·분율 → kg/hr 변환)
  for (const sec of sections) {
    if (sec.keyword !== 'STREAM') continue;
    if (sec.headerTokens.length === 0) continue;
    const streamId = sec.headerTokens[0];
    const feedNodeId = feedNodeIdByStream.get(streamId);
    if (!feedNodeId || !defs[feedNodeId]) continue;

    let tempC = 25;
    let pressBarA = 1.01325;
    let totalMassKgH: number | null = null;
    let totalMoleKmolH: number | null = null;

    const massFlows: Partial<Record<SimCompKey, number>> = {};
    const moleFlows: Partial<Record<SimCompKey, number>> = {};
    const massFracs: Partial<Record<SimCompKey, number>> = {};
    const moleFracs: Partial<Record<SimCompKey, number>> = {};

    type TableMode = 'none' | 'MASS-FLOW' | 'MOLE-FLOW' | 'MASS-FRAC' | 'MOLE-FRAC';
    let tableMode: TableMode = 'none';
    let tableMassUnit: UnitContext['massFlow'] = units.massFlow;
    let tableMoleUnit: UnitContext['moleFlow'] = units.moleFlow;

    for (const line of sec.bodyLines) {
      const toks = tokenizeLine(line);
      if (toks.length === 0) continue;
      const head = toks[0].toUpperCase();

      if (head === 'SUBSTREAM') {
        tableMode = 'none';
        for (const kv of parseKeyValues(line)) {
          const val = parseNumber(kv.value);
          if (val === null) continue;
          if (kv.key === 'TEMP' || kv.key === 'T') {
            const tu = kv.inlineUnit ? parseTempUnit(kv.inlineUnit) ?? units.temp : units.temp;
            tempC = Number(toTempC(val, tu).toFixed(2));
          } else if (kv.key === 'PRES' || kv.key === 'P') {
            const pu = kv.inlineUnit ? parsePresUnit(kv.inlineUnit) ?? units.pres : units.pres;
            pressBarA = toBarA(val, pu);
          } else if (kv.key === 'MASS-FLOW') {
            const mu = kv.inlineUnit
              ? parseMassFlowUnit(kv.inlineUnit) ?? units.massFlow
              : units.massFlow;
            totalMassKgH = toMassFlowKgH(val, mu);
          } else if (kv.key === 'MOLE-FLOW') {
            const mu = kv.inlineUnit
              ? parseMoleFlowUnit(kv.inlineUnit) ?? units.moleFlow
              : units.moleFlow;
            totalMoleKmolH = toMoleFlowKmolH(val, mu);
          }
        }
        continue;
      }

      // 테이블 헤더 감지: MASS-FLOW / MOLE-FLOW / MASS-FRAC / MOLE-FRAC
      let startIdx = 0;
      if (
        head === 'MASS-FLOW' ||
        head === 'MOLE-FLOW' ||
        head === 'MASS-FRAC' ||
        head === 'MOLE-FRAC'
      ) {
        tableMode = head;
        tableMassUnit = units.massFlow;
        tableMoleUnit = units.moleFlow;
        startIdx = 1;
        // 옵션 단위 토큰 확인 (예: MASS-FLOW <KG/HR> H2O 500)
        if (toks[startIdx] && /^<[^>]+>$/.test(toks[startIdx])) {
          const uStr = toks[startIdx].slice(1, -1);
          const mu = parseMassFlowUnit(uStr);
          if (mu) tableMassUnit = mu;
          const molf = parseMoleFlowUnit(uStr);
          if (molf) tableMoleUnit = molf;
          startIdx++;
        }
      }

      if (tableMode !== 'none') {
        // 'COMP VAL' 쌍을 한 줄에 여러 개 또는 1개씩 파싱
        for (let i = startIdx; i + 1 < toks.length; i += 2) {
          const compTok = toks[i];
          const valTok = toks[i + 1];
          // 단위 토큰이면 건너뜀
          if (/^<[^>]+>$/.test(compTok)) {
            i -= 1;
            continue;
          }
          const num = parseNumber(valTok);
          if (num === null) {
            i -= 1;
            continue;
          }
          const simKey =
            localCompMap.get(normalizeCompToken(compTok)) ?? resolveSimComp(compTok);
          if (!simKey) {
            warnings.push(
              `스트림 '${streamId}'의 성분 '${compTok}'은(는) 매핑되지 않아 유량에서 제외되었습니다.`
            );
            continue;
          }
          if (tableMode === 'MASS-FLOW') {
            massFlows[simKey] = (massFlows[simKey] ?? 0) + toMassFlowKgH(num, tableMassUnit);
          } else if (tableMode === 'MOLE-FLOW') {
            moleFlows[simKey] = (moleFlows[simKey] ?? 0) + toMoleFlowKmolH(num, tableMoleUnit);
          } else if (tableMode === 'MASS-FRAC') {
            massFracs[simKey] = (massFracs[simKey] ?? 0) + num;
          } else if (tableMode === 'MOLE-FRAC') {
            moleFracs[simKey] = (moleFracs[simKey] ?? 0) + num;
          }
        }
      }
    }

    // 최종 성분별 질량유량(kg/hr) 조립
    const resolvedFlows = emptySimFlows();
    const hasMassFlows = Object.keys(massFlows).length > 0;
    const hasMoleFlows = Object.keys(moleFlows).length > 0;
    const hasMassFracs = Object.keys(massFracs).length > 0;
    const hasMoleFracs = Object.keys(moleFracs).length > 0;

    if (hasMassFlows) {
      for (const [k, v] of Object.entries(massFlows)) {
        resolvedFlows[k as SimCompKey] = Number((v ?? 0).toFixed(4));
      }
    } else if (hasMoleFlows) {
      for (const [k, v] of Object.entries(moleFlows)) {
        const key = k as SimCompKey;
        resolvedFlows[key] = Number(((v ?? 0) * mwOfComp(key)).toFixed(4));
      }
    } else if (hasMassFracs) {
      const sumW = Object.values(massFracs).reduce((a, b) => a + (b ?? 0), 0) || 1;
      let totMass = totalMassKgH;
      if (totMass === null && totalMoleKmolH !== null) {
        // 1 / M_avg = sum(w_i / M_i)
        let invAvgMw = 0;
        for (const [k, w] of Object.entries(massFracs)) {
          invAvgMw += ((w ?? 0) / sumW) / mwOfComp(k as SimCompKey);
        }
        const avgMw = invAvgMw > 0 ? 1 / invAvgMw : 50;
        totMass = totalMoleKmolH * avgMw;
      }
      const effMass = totMass ?? 1000;
      for (const [k, w] of Object.entries(massFracs)) {
        resolvedFlows[k as SimCompKey] = Number((((w ?? 0) / sumW) * effMass).toFixed(4));
      }
    } else if (hasMoleFracs) {
      const sumX = Object.values(moleFracs).reduce((a, b) => a + (b ?? 0), 0) || 1;
      let avgMw = 0;
      for (const [k, x] of Object.entries(moleFracs)) {
        avgMw += ((x ?? 0) / sumX) * mwOfComp(k as SimCompKey);
      }
      const effMole =
        totalMoleKmolH !== null
          ? totalMoleKmolH
          : totalMassKgH !== null && avgMw > 0
            ? totalMassKgH / avgMw
            : 100;
      for (const [k, x] of Object.entries(moleFracs)) {
        const key = k as SimCompKey;
        const kmolH = ((x ?? 0) / sumX) * effMole;
        resolvedFlows[key] = Number((kmolH * mwOfComp(key)).toFixed(4));
      }
    }

    defs[feedNodeId].params = {
      ...defs[feedNodeId].params,
      feedTempC: tempC,
      feedPressKgcm2g: barAToKgcm2g(pressBarA),
      feedFlowsKgH: resolvedFlows,
    };
  }

  // PRATIO 지정된 압축기/펌프 토출압 보정
  for (const [nodeId, pratio] of pendingPratioMap.entries()) {
    const def = defs[nodeId];
    if (def && def.params.outletPressKgcm2g === undefined && pratio > 0) {
      def.params.outletPressKgcm2g = barAToKgcm2g(1.01325 * pratio);
    }
  }

  // 6차 패스: FlowEdgeDef[] 생성 (포트 자동 매핑)
  const edges: FlowEdgeDef[] = [];

  const pickSourcePort = (
    srcNode: FlowNodeDef,
    outIndex: number,
    totalOuts: number
  ): SourcePortId => {
    if (srcNode.unitType === 'separator') {
      if (outIndex === 0) return 'vapor';
      if (outIndex === 1) return 'liquid';
      return 'out';
    }
    if (srcNode.unitType === 'distillation') {
      if (outIndex === 0) return 'vapor';
      if (outIndex === 1) return 'liquid';
      if (outIndex === 2) return 'side_cut';
      return 'out';
    }
    if (srcNode.unitType === 'splitter') {
      if (outIndex === 0) return 'out1';
      if (outIndex === 1) return 'out2';
      return 'out';
    }
    if (srcNode.unitType === 'hex' && totalOuts >= 2) {
      return outIndex === 0 ? 'out' : 'util_out';
    }
    return 'out';
  };

  const pickTargetPort = (
    tgtNode: FlowNodeDef,
    inIndex: number,
    totalIns: number
  ): TargetPortId => {
    if (tgtNode.unitType === 'hex' && totalIns >= 2) {
      return inIndex === 0 ? 'in' : 'util_in';
    }
    if (tgtNode.unitType === 'absorber' && totalIns >= 2) {
      return inIndex === 0 ? 'in' : 'solvent';
    }
    return 'in';
  };

  for (const s of allStreamOrder) {
    const prod = streamProducer.get(s);
    const consList = streamConsumers.get(s) ?? [];
    const sourceNodeId = prod ? prod.nodeId : feedNodeIdByStream.get(s);
    if (!sourceNodeId || !defs[sourceNodeId]) continue;

    const srcDef = defs[sourceNodeId];
    const srcBlock = prod ? blockMap.get(prod.blockId) : undefined;
    const sourcePort: SourcePortId = prod
      ? pickSourcePort(srcDef, prod.outIndex, srcBlock?.outStreams.length ?? 1)
      : 'out';

    if (consList.length > 0) {
      consList.forEach((cons, idx) => {
        const tgtDef = defs[cons.nodeId];
        if (!tgtDef) return;
        const tgtBlock = blockMap.get(cons.blockId);
        const targetPort = pickTargetPort(
          tgtDef,
          cons.inIndex,
          tgtBlock?.inStreams.length ?? 1
        );
        edges.push({
          id: consList.length === 1 ? `edge_${sanitizeId(s)}` : `edge_${sanitizeId(s)}_${idx + 1}`,
          streamNo: s,
          name: s,
          source: sourceNodeId,
          target: cons.nodeId,
          sourcePort,
          targetPort,
        });
      });
    } else {
      const prodNodeId = prodNodeIdByStream.get(s);
      if (prodNodeId && defs[prodNodeId]) {
        edges.push({
          id: `edge_${sanitizeId(s)}`,
          streamNo: s,
          name: s,
          source: sourceNodeId,
          target: prodNodeId,
          sourcePort,
          targetPort: 'in',
        });
      }
    }
  }

  // 7차 패스: 좌→우 토폴로지 BFS 자동 레이아웃 (x = 80 + layer * 260, y = 100 + row * 170)
  const nodeIds = Object.keys(defs);
  const outAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) {
    outAdj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    outAdj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const layerOf = new Map<string, number>();
  const queue: string[] = [];

  for (const id of nodeIds) {
    if (defs[id].unitType === 'feed' || (inDeg.get(id) ?? 0) === 0) {
      layerOf.set(id, 0);
      queue.push(id);
    }
  }
  if (queue.length === 0 && nodeIds.length > 0) {
    layerOf.set(nodeIds[0], 0);
    queue.push(nodeIds[0]);
  }

  const maxLayerCap = Math.max(1, nodeIds.length);
  let headIdx = 0;
  while (headIdx < queue.length) {
    const cur = queue[headIdx++];
    const curLayer = layerOf.get(cur) ?? 0;
    for (const nxt of outAdj.get(cur) ?? []) {
      const candidate = Math.min(curLayer + 1, maxLayerCap);
      const prev = layerOf.get(nxt);
      if (prev === undefined || (candidate > prev && candidate <= maxLayerCap)) {
        layerOf.set(nxt, candidate);
        queue.push(nxt);
      }
    }
  }

  for (const id of nodeIds) {
    if (!layerOf.has(id)) layerOf.set(id, 0);
  }

  // Product 노드는 항상 우측 끝 열로 정렬
  const maxNonProdLayer = nodeIds.reduce((acc, id) => {
    if (defs[id].unitType === 'product') return acc;
    return Math.max(acc, layerOf.get(id) ?? 0);
  }, 0);
  for (const id of nodeIds) {
    if (defs[id].unitType === 'product') {
      const curL = layerOf.get(id) ?? 0;
      layerOf.set(id, Math.max(curL, maxNonProdLayer + 1));
    }
  }

  const rowsByLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layerOf.get(id) ?? 0;
    const list = rowsByLayer.get(l) ?? [];
    list.push(id);
    rowsByLayer.set(l, list);
  }

  const rfNodes: ProcessTextImportResult['rfNodes'] = [];
  const sortedLayers = Array.from(rowsByLayer.keys()).sort((a, b) => a - b);
  for (const layer of sortedLayers) {
    const idsInLayer = rowsByLayer.get(layer) ?? [];
    idsInLayer.forEach((unitId, row) => {
      rfNodes.push({
        id: unitId,
        type: 'unitNode',
        position: {
          x: 80 + layer * 260,
          y: 100 + row * 170,
        },
        data: { unitId },
      });
    });
  }

  return {
    title,
    defs,
    rfNodes,
    edges,
    activeComponents,
    propertyMethod,
    summary: {
      unitCount: nodeIds.length,
      edgeCount: edges.length,
      mappedCompCount,
      unmappedComps,
    },
    warnings,
  };
}

// ============================================================================
// 7. 공정 텍스트 파일(.inp) 내보내기: exportProcessTextFile
// ============================================================================

function mapPropertyMethodForExport(method?: string): string {
  const m = (method ?? 'NRTL').toUpperCase();
  if (m === 'PR' || m === 'PENG-ROB') return 'PENG-ROB';
  if (m === 'SRK' || m === 'RK-SOAVE') return 'RK-SOAVE';
  if (m === 'ENRTL' || m === 'ELECNRTL') return 'ELECNRTL';
  if (m === 'NRTL') return 'NRTL';
  return 'NRTL';
}

function mapUnitTypeForExport(unit: FlowNodeDef, inCount: number, outCount: number): string {
  switch (unit.unitType) {
    case 'mixer':
      return 'MIXER';
    case 'splitter':
      return 'FSPLIT';
    case 'hex':
    case 'cooler':
    case 'liquefier':
      return inCount >= 2 && outCount >= 2 ? 'HEATX' : 'HEATER';
    case 'separator':
      return 'FLASH2';
    case 'distillation':
      return 'RADFRAC';
    case 'absorber':
      return 'ABSBR';
    case 'extractor':
      return 'EXTRACT';
    case 'pump':
      return 'PUMP';
    case 'compressor':
      return 'COMPR';
    case 'reactor':
      if (unit.params.reactorModel === 'cstr') return 'RCSTR';
      if (unit.params.reactorModel === 'pfr') return 'RPLUG';
      return 'RSTOIC';
    case 'valve':
      return 'VALVE';
    default:
      return 'MIXER';
  }
}

function safeToken(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '_');
  return cleaned || 'U1';
}

export function exportProcessTextFile(input: ProcessTextExportInput): string {
  const defsList: FlowNodeDef[] = Array.isArray(input.defs)
    ? input.defs
    : Object.values(input.defs);
  const title = (input.title || 'Process Flowsheet Export').replace(/'/g, '');
  const propMethod = mapPropertyMethodForExport(input.propertyMethod);

  const lines: string[] = [];
  lines.push('; Standard Process Flowsheet Text File (.inp)');
  lines.push(`TITLE '${title}'`);
  lines.push('');
  lines.push('IN-UNITS MET PRESSURE=bar TEMPERATURE=C');
  lines.push('');

  // COMPONENTS
  lines.push('COMPONENTS');
  const comps = input.activeComponents.length > 0 ? input.activeComponents : (['MeOH', 'H2O'] as SimCompKey[]);
  for (const c of comps) {
    const spec = COMP_EXPORT_SPEC[c] ?? c.toUpperCase();
    lines.push(`    ${c} ${spec}`);
  }
  lines.push('');

  // PROPERTIES
  lines.push(`PROPERTIES ${propMethod}`);
  lines.push('');

  // FLOWSHEET (non-feed, non-product blocks)
  const unitBlocks = defsList.filter(
    (d) => d.unitType !== 'feed' && d.unitType !== 'product'
  );
  const inEdgesByNode = new Map<string, FlowEdgeDef[]>();
  const outEdgesByNode = new Map<string, FlowEdgeDef[]>();

  for (const e of input.edges) {
    const outList = outEdgesByNode.get(e.source) ?? [];
    outList.push(e);
    outEdgesByNode.set(e.source, outList);

    const inList = inEdgesByNode.get(e.target) ?? [];
    inList.push(e);
    inEdgesByNode.set(e.target, inList);
  }

  // 포트 순서 정규화 (vapor/out1/out 우선, liquid/out2/util_out 후순위)
  const outPortOrder = (p?: SourcePortId): number => {
    if (p === 'vapor' || p === 'out1' || p === 'out') return 0;
    if (p === 'liquid' || p === 'out2' || p === 'util_out') return 1;
    if (p === 'side_cut') return 2;
    return 3;
  };
  const inPortOrder = (p?: TargetPortId): number => {
    if (!p || p === 'in') return 0;
    if (p === 'util_in' || p === 'solvent' || p === 'liq_in') return 1;
    return 2;
  };

  lines.push('FLOWSHEET');
  for (const blk of unitBlocks) {
    const ins = [...(inEdgesByNode.get(blk.id) ?? [])].sort(
      (a, b) => inPortOrder(a.targetPort) - inPortOrder(b.targetPort)
    );
    const outs = [...(outEdgesByNode.get(blk.id) ?? [])].sort(
      (a, b) => outPortOrder(a.sourcePort) - outPortOrder(b.sourcePort)
    );
    const inNames = ins.map((e) => safeToken(e.streamNo || e.name || e.id));
    const outNames = outs.map((e) => safeToken(e.streamNo || e.name || e.id));
    const parts = [`    BLOCK ${safeToken(blk.tag)}`];
    if (inNames.length > 0) parts.push(`IN=${inNames.join(' ')}`);
    if (outNames.length > 0) parts.push(`OUT=${outNames.join(' ')}`);
    lines.push(parts.join(' '));
  }
  lines.push('');

  // STREAM (feed units)
  const feedUnits = defsList.filter((d) => d.unitType === 'feed');
  for (const f of feedUnits) {
    const outEdges = outEdgesByNode.get(f.id) ?? [];
    const streamName = safeToken(
      outEdges[0]?.streamNo || outEdges[0]?.name || f.tag
    );
    const tempC = f.params.feedTempC ?? 25;
    const pressBarA = kgcm2gToBarA(f.params.feedPressKgcm2g ?? 0);
    lines.push(`STREAM ${streamName}`);
    lines.push(`    SUBSTREAM MIXED TEMP=${tempC} PRES=${pressBarA}`);
    const flows = f.params.feedFlowsKgH ?? {};
    const nonZeroEntries = Object.entries(flows).filter(
      ([, v]) => typeof v === 'number' && v > 0
    );
    if (nonZeroEntries.length > 0) {
      lines.push('    MASS-FLOW');
      for (const [compKey, kgH] of nonZeroEntries) {
        lines.push(`        ${compKey} ${Number((kgH ?? 0).toFixed(4))}`);
      }
    }
    lines.push('');
  }

  // BLOCK definitions
  for (const blk of unitBlocks) {
    const ins = inEdgesByNode.get(blk.id) ?? [];
    const outs = [...(outEdgesByNode.get(blk.id) ?? [])].sort(
      (a, b) => outPortOrder(a.sourcePort) - outPortOrder(b.sourcePort)
    );
    const bType = mapUnitTypeForExport(blk, ins.length, outs.length);
    lines.push(`BLOCK ${safeToken(blk.tag)} ${bType}`);

    const p = blk.params;
    if (blk.unitType === 'distillation') {
      const dc = p.distillConfig;
      const nstage = dc?.totalStages ?? 20;
      const rr = dc?.topSpecValue ?? 2.0;
      const df = dc?.splitSpecValue ?? 0.5;
      const feedStage = dc?.feedStage ?? Math.round(nstage / 2);
      const topBarA = kgcm2gToBarA(dc?.topPressKgcm2g ?? 0);
      lines.push(`    PARAM NSTAGE=${nstage} RR=${rr} D:F=${df}`);
      const primaryIn = ins[0] ? safeToken(ins[0].streamNo || ins[0].name || ins[0].id) : 'FEED';
      lines.push(`    FEEDS ${primaryIn} ${feedStage}`);
      lines.push(`    P-SPEC 1 ${topBarA}`);
      if (dc?.stageDeltaPKgcm2 !== undefined) {
        const dpBar = Number((dc.stageDeltaPKgcm2 / 1.0197162).toFixed(5));
        lines.push(`    PARAM DP-STAGE=${dpBar}`);
      }
    } else if (blk.unitType === 'splitter') {
      const ratio = p.splitRatioTop ?? 0.5;
      const firstOut = outs[0] ? safeToken(outs[0].streamNo || outs[0].name || outs[0].id) : 'OUT1';
      lines.push(`    FRAC ${firstOut} ${ratio}`);
    } else if (blk.unitType === 'pump' || blk.unitType === 'compressor') {
      const paramTokens: string[] = [];
      if (p.outletPressKgcm2g !== undefined) {
        paramTokens.push(`PRES=${kgcm2gToBarA(p.outletPressKgcm2g)}`);
      }
      if (p.efficiency !== undefined) {
        paramTokens.push(`EFF=${p.efficiency}`);
      }
      if (paramTokens.length > 0) {
        lines.push(`    PARAM ${paramTokens.join(' ')}`);
      }
    } else {
      const paramTokens: string[] = [];
      if (p.operTempC !== undefined) {
        paramTokens.push(`TEMP=${p.operTempC}`);
      }
      if (p.operPressKgcm2g !== undefined) {
        paramTokens.push(`PRES=${kgcm2gToBarA(p.operPressKgcm2g)}`);
      }
      if (p.hexSpecMode === 'heat_duty' && p.specifiedDutyMcalH !== undefined) {
        paramTokens.push(`DUTY=${p.specifiedDutyMcalH}`);
      }
      if (blk.unitType === 'separator' && p.flashMode === 'adiabatic') {
        paramTokens.push('DUTY=0');
      }
      if (blk.unitType === 'reactor' && p.conversion !== undefined) {
        paramTokens.push(`CONV=${p.conversion}`);
      }
      if (paramTokens.length > 0) {
        lines.push(`    PARAM ${paramTokens.join(' ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

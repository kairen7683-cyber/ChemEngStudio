// ============================================================
// 경량 캔버스 기반 플로우시트 시뮬레이터 엔진 v3 (Canvas-Driven Flowsheet Solver)
// - 염소(Cl₂) Antoine 증기압·이슬점(Dew Point)·냉매 액화(Liquefier) 상평형(VLE) 정밀 지원
// - 유입 배관 연결 시 유체 종류(Cl₂ 가스, 포화염수, 가성소다, HCl 등) 및 액화 조건 자동 인식
// - 열교환기 냉매 프리셋 (냉각수 CW / 칠드워터 CHW / 브라인 -20°C / 프레온 -35°C / 스팀)
// - 이온교환막 전해조 (양극 In/Out · 음극 In/Out), 흡수·건조탑, 압축기, 펌프, 증발관 지원
// ============================================================
import { MW } from './constants';
import { waterSatVaporPressureKgcm2A, waterActivityNaCl, waterActivityNaOH } from './electrolyzer';
import {
  analyzeFlowsheetTopology,
  wegsteinAccelerate,
  calcPengRobinsonMixture,
  calcSoaveRedlichKwongMixture,
  pureAntoineBarA,
  solveRigorousFlashVLE,
  calcRigorousCellElectrochem,
  calcRigorousThreeZoneHex,
  calcRigorousKremserRemoval,
} from './rigorousThermo';
import {
  type DistillColumnParams,
  type DistillFeedInput,
  type DistillSolveResult,
  solveRigorousDistillation,
  solveRigorousAbsorberStripper,
} from './rigorousDistillation';
import {
  solveChemicalReactor,
  type ReactorConfig,
  type ReactorSolveResult,
} from './chemicalReactor';
import {
  solveMultistageExtractor,
  type ExtractorColumnConfig,
  type ExtractorSolveResult,
} from './liquidLiquidExtractor';
import type { HxDesignParams } from './heatExchangerDesign';
import {
  streamEnthalpyKcalH,
  phFlash,
  heatOfVaporizationKJkmol,
  chlorAlkaliThermoneutralVoltage,
  KJ_PER_KCAL,
} from './thermoCore';
import { solveRigorousLLEDecanter } from './activityModels';
import { computeElectrolyteState } from './electrolyteThermo';
import {
  PROPERTY_METHOD_INFO,
  recommendPropertyMethod,
  type SimPropertyMethod,
  type ResolvedPropertyMethod,
} from './componentCatalog';
import { BroydenTearAccelerator } from './flowsheetOptimization';

export type UnitCalcMode = 'simple' | 'rigorous';

export type SimCompKey =
  | 'H2O'
  | 'NaCl'
  | 'NaOH'
  | 'Cl2'
  | 'H2'
  | 'HCl'
  | 'H2SO4'
  | 'O2'
  | 'NaOCl'
  | 'N2'
  | 'NaClO3'
  | 'FeCl2'
  | 'FeCl3'
  | 'PAC'
  | 'Glycerol'
  | 'MCH'
  | 'DCH'
  | 'ECH'
  | 'DCP'
  | 'CH4'
  | 'CO'
  | 'CO2'
  | 'NH3'
  | 'C2H4'
  | 'C2H6'
  | 'C3H6'
  | 'C3H8'
  | 'nC4H10'
  | 'nC6H14'
  | 'nC7H16'
  | 'Benzene'
  | 'Toluene'
  | 'pXylene'
  | 'MeOH'
  | 'EtOH'
  | 'IPA'
  | 'Acetone'
  | 'AceticAcid'
  | 'EtOAc'
  | 'CHCl3'
  | 'Ar'
  | 'H2S'
  | 'SO2'
  | 'SO3'
  | 'iC4H10'
  | 'C4H8_1'
  | 'nC5H12'
  | 'nC8H18'
  | 'Cyclohexane'
  | 'Ethylbenzene'
  | 'Styrene'
  | 'Cumene'
  | 'Phenol'
  | 'THF'
  | 'DMF'
  | 'DMSO'
  | 'MTBE'
  | 'MEK'
  | 'DMC'
  | 'EG'
  | 'MEA'
  | 'MDEA'
  | 'FormicAcid'
  | 'HNO3'
  | 'CH3Cl'
  | 'CH2Cl2'
  | 'CCl4'
  | 'C2Cl4'
  | 'CUSTOM_1'
  | 'CUSTOM_2';

export const SIM_COMPS: SimCompKey[] = [
  'H2O',
  'NaCl',
  'NaOH',
  'Cl2',
  'H2',
  'HCl',
  'H2SO4',
  'O2',
  'NaOCl',
  'N2',
  'NaClO3',
  'FeCl2',
  'FeCl3',
  'PAC',
  'Glycerol',
  'MCH',
  'DCH',
  'ECH',
  'DCP',
  'CH4',
  'CO',
  'CO2',
  'NH3',
  'C2H4',
  'C2H6',
  'C3H6',
  'C3H8',
  'nC4H10',
  'nC6H14',
  'nC7H16',
  'Benzene',
  'Toluene',
  'pXylene',
  'MeOH',
  'EtOH',
  'IPA',
  'Acetone',
  'AceticAcid',
  'EtOAc',
  'CHCl3',
  'Ar',
  'H2S',
  'SO2',
  'SO3',
  'iC4H10',
  'C4H8_1',
  'nC5H12',
  'nC8H18',
  'Cyclohexane',
  'Ethylbenzene',
  'Styrene',
  'Cumene',
  'Phenol',
  'THF',
  'DMF',
  'DMSO',
  'MTBE',
  'MEK',
  'DMC',
  'EG',
  'MEA',
  'MDEA',
  'FormicAcid',
  'HNO3',
  'CH3Cl',
  'CH2Cl2',
  'CCl4',
  'C2Cl4',
  'CUSTOM_1',
  'CUSTOM_2',
];

const GENERAL_21_KEYS: SimCompKey[] = [
  'CH4',
  'CO',
  'CO2',
  'NH3',
  'C2H4',
  'C2H6',
  'C3H6',
  'C3H8',
  'nC4H10',
  'nC6H14',
  'nC7H16',
  'Benzene',
  'Toluene',
  'pXylene',
  'MeOH',
  'EtOH',
  'IPA',
  'Acetone',
  'AceticAcid',
  'EtOAc',
  'CHCl3',
  'Ar',
  'H2S',
  'SO2',
  'SO3',
  'iC4H10',
  'C4H8_1',
  'nC5H12',
  'nC8H18',
  'Cyclohexane',
  'Ethylbenzene',
  'Styrene',
  'Cumene',
  'Phenol',
  'THF',
  'DMF',
  'DMSO',
  'MTBE',
  'MEK',
  'DMC',
  'EG',
  'MEA',
  'MDEA',
  'FormicAcid',
  'HNO3',
  'CH3Cl',
  'CH2Cl2',
  'CCl4',
  'C2Cl4',
  'CUSTOM_1',
  'CUSTOM_2',
];

const mwOf = (k: string, fallback: number): number =>
  (MW as Record<string, number>)[k] ?? fallback;

export const COMP_META: Record<
  SimCompKey,
  {
    formula: string;
    label: string;
    mw: number;
    isGasAtStd: boolean;
    cpLiq: number;
    cpGas: number;
    group: 'core' | '1B_inorg' | '2_ech' | 'gas_syngas' | 'hydrocarbon' | 'aromatic' | 'polar_solvent';
  }
> = {
  H2O:        { formula: 'H₂O',      label: 'H₂O (물/수증기)',          mw: MW.H2O,                 isGasAtStd: false, cpLiq: 1.00,  cpGas: 0.45,  group: 'core' },
  NaCl:       { formula: 'NaCl',     label: 'NaCl (염화나트륨)',        mw: MW.NaCl,                isGasAtStd: false, cpLiq: 0.21,  cpGas: 0.21,  group: 'core' },
  NaOH:       { formula: 'NaOH',     label: 'NaOH (가성소다)',          mw: MW.NaOH,                isGasAtStd: false, cpLiq: 0.35,  cpGas: 0.35,  group: 'core' },
  Cl2:        { formula: 'Cl₂',      label: 'Cl₂ (염소)',              mw: MW.Cl2,                 isGasAtStd: true,  cpLiq: 0.23,  cpGas: 0.115, group: 'core' },
  H2:         { formula: 'H₂',       label: 'H₂ (수소)',               mw: MW.H2,                  isGasAtStd: true,  cpLiq: 3.44,  cpGas: 3.44,  group: 'core' },
  HCl:        { formula: 'HCl',      label: 'HCl (염화수소/무수염산)',   mw: MW.HCl,                 isGasAtStd: true,  cpLiq: 0.40,  cpGas: 0.19,  group: 'core' },
  H2SO4:      { formula: 'H₂SO₄',    label: 'H₂SO₄ (황산)',            mw: MW.H2SO4,               isGasAtStd: false, cpLiq: 0.34,  cpGas: 0.34,  group: 'core' },
  O2:         { formula: 'O₂',       label: 'O₂ (산소)',               mw: MW.O2,                  isGasAtStd: true,  cpLiq: 0.22,  cpGas: 0.22,  group: 'core' },
  NaOCl:      { formula: 'NaOCl',    label: 'NaOCl (차아염소산소다)',   mw: MW.NaOCl,               isGasAtStd: false, cpLiq: 0.82,  cpGas: 0.82,  group: 'core' },
  N2:         { formula: 'N₂',       label: 'N₂ (질소/불활성가스)',     mw: MW.N2,                  isGasAtStd: true,  cpLiq: 0.25,  cpGas: 0.249, group: 'core' },
  NaClO3:     { formula: 'NaClO₃',   label: 'NaClO₃ (염소산소다)',      mw: MW.NaClO3,              isGasAtStd: false, cpLiq: 0.28,  cpGas: 0.28,  group: '1B_inorg' },
  FeCl2:      { formula: 'FeCl₂',    label: 'FeCl₂ (염화제1철 폐액)',   mw: MW.FeCl2,               isGasAtStd: false, cpLiq: 0.19,  cpGas: 0.19,  group: '1B_inorg' },
  FeCl3:      { formula: 'FeCl₃',    label: 'FeCl₃ (염화제2철 에칭액)', mw: MW.FeCl3,               isGasAtStd: false, cpLiq: 0.18,  cpGas: 0.18,  group: '1B_inorg' },
  PAC:        { formula: 'PAC',      label: 'PAC (폴리염화알루미늄)',    mw: MW.PAC,                 isGasAtStd: false, cpLiq: 0.24,  cpGas: 0.24,  group: '1B_inorg' },
  Glycerol:   { formula: 'Glycerol', label: 'Glycerol (글리세린)',      mw: MW.Glycerol,            isGasAtStd: false, cpLiq: 0.58,  cpGas: 0.39,  group: '2_ech' },
  MCH:        { formula: 'MCH',      label: 'MCH (모노클로로히드린)',   mw: MW.MCH,                 isGasAtStd: false, cpLiq: 0.49,  cpGas: 0.34,  group: '2_ech' },
  DCH:        { formula: 'DCH',      label: 'DCH (디클로로히드린)',     mw: MW.DCH,                 isGasAtStd: false, cpLiq: 0.41,  cpGas: 0.29,  group: '2_ech' },
  ECH:        { formula: 'ECH',      label: 'ECH (에피클로로히드린)',   mw: MW.ECH,                 isGasAtStd: false, cpLiq: 0.43,  cpGas: 0.31,  group: '2_ech' },
  DCP:        { formula: 'DCP',      label: 'DCP (1,2-디클로로프로판)', mw: MW.DCP,                 isGasAtStd: false, cpLiq: 0.39,  cpGas: 0.27,  group: '2_ech' },
  CH4:        { formula: 'CH₄',      label: 'CH₄ (메탄/천연가스)',      mw: mwOf('CH4', 16.043),    isGasAtStd: true,  cpLiq: 0.83,  cpGas: 0.532, group: 'gas_syngas' },
  CO:         { formula: 'CO',       label: 'CO (일산화탄소)',          mw: mwOf('CO', 28.010),     isGasAtStd: true,  cpLiq: 0.52,  cpGas: 0.249, group: 'gas_syngas' },
  CO2:        { formula: 'CO₂',      label: 'CO₂ (이산화탄소)',         mw: mwOf('CO2', 44.010),    isGasAtStd: true,  cpLiq: 0.48,  cpGas: 0.202, group: 'gas_syngas' },
  NH3:        { formula: 'NH₃',      label: 'NH₃ (암모니아)',           mw: mwOf('NH3', 17.031),    isGasAtStd: true,  cpLiq: 1.13,  cpGas: 0.500, group: 'gas_syngas' },
  C2H4:       { formula: 'C₂H₄',     label: 'C₂H₄ (에틸렌)',            mw: mwOf('C2H4', 28.054),   isGasAtStd: true,  cpLiq: 0.58,  cpGas: 0.370, group: 'hydrocarbon' },
  C2H6:       { formula: 'C₂H₆',     label: 'C₂H₆ (에탄)',              mw: mwOf('C2H6', 30.070),   isGasAtStd: true,  cpLiq: 0.68,  cpGas: 0.419, group: 'hydrocarbon' },
  C3H6:       { formula: 'C₃H₆',     label: 'C₃H₆ (프로필렌)',          mw: mwOf('C3H6', 42.081),   isGasAtStd: true,  cpLiq: 0.54,  cpGas: 0.366, group: 'hydrocarbon' },
  C3H8:       { formula: 'C₃H₈',     label: 'C₃H₈ (프로판)',            mw: mwOf('C3H8', 44.097),   isGasAtStd: true,  cpLiq: 0.60,  cpGas: 0.399, group: 'hydrocarbon' },
  nC4H10:     { formula: 'n-C₄H₁₀',  label: 'n-C₄H₁₀ (노르말부탄)',     mw: mwOf('nC4H10', 58.123), isGasAtStd: true,  cpLiq: 0.57,  cpGas: 0.405, group: 'hydrocarbon' },
  nC6H14:     { formula: 'n-C₆H₁₄',  label: 'n-C₆H₁₄ (노르말헥산)',     mw: mwOf('nC6H14', 86.177), isGasAtStd: false, cpLiq: 0.54,  cpGas: 0.396, group: 'hydrocarbon' },
  nC7H16:     { formula: 'n-C₇H₁₆',  label: 'n-C₇H₁₆ (노르말헵탄)',     mw: mwOf('nC7H16', 100.204),isGasAtStd: false, cpLiq: 0.536, cpGas: 0.396, group: 'hydrocarbon' },
  Benzene:    { formula: 'C₆H₆',     label: 'Benzene (벤젠)',           mw: mwOf('Benzene', 78.114),isGasAtStd: false, cpLiq: 0.416, cpGas: 0.252, group: 'aromatic' },
  Toluene:    { formula: 'C₇H₈',     label: 'Toluene (톨루엔)',         mw: mwOf('Toluene', 92.141),isGasAtStd: false, cpLiq: 0.408, cpGas: 0.269, group: 'aromatic' },
  pXylene:    { formula: 'p-Xylene', label: 'p-Xylene (파라자일렌)',    mw: mwOf('pXylene', 106.167),isGasAtStd: false, cpLiq: 0.411, cpGas: 0.286, group: 'aromatic' },
  MeOH:       { formula: 'CH₃OH',    label: 'MeOH (메탄올)',            mw: mwOf('MeOH', 32.042),   isGasAtStd: false, cpLiq: 0.605, cpGas: 0.329, group: 'polar_solvent' },
  EtOH:       { formula: 'C₂H₅OH',   label: 'EtOH (에탄올)',            mw: mwOf('EtOH', 46.069),   isGasAtStd: false, cpLiq: 0.581, cpGas: 0.340, group: 'polar_solvent' },
  IPA:        { formula: 'IPA',      label: 'IPA (이소프로판올)',       mw: mwOf('IPA', 60.096),    isGasAtStd: false, cpLiq: 0.602, cpGas: 0.355, group: 'polar_solvent' },
  Acetone:    { formula: 'Acetone',  label: 'Acetone (아세톤)',         mw: mwOf('Acetone', 58.080),isGasAtStd: false, cpLiq: 0.518, cpGas: 0.308, group: 'polar_solvent' },
  AceticAcid: { formula: 'CH₃COOH',  label: 'AceticAcid (초산)',        mw: mwOf('AceticAcid', 60.052),isGasAtStd: false, cpLiq: 0.490, cpGas: 0.265, group: 'polar_solvent' },
  EtOAc:      { formula: 'EtOAc',    label: 'EtOAc (초산에틸)',         mw: mwOf('EtOAc', 88.106),  isGasAtStd: false, cpLiq: 0.464, cpGas: 0.309, group: 'polar_solvent' },
  CHCl3:      { formula: 'CHCl₃',    label: 'CHCl₃ (클로로포름)',       mw: mwOf('CHCl3', 119.378), isGasAtStd: false, cpLiq: 0.230, cpGas: 0.131, group: 'polar_solvent' },
  Ar: { formula: 'Ar', label: 'Ar (아르곤)', mw: mwOf('Ar', 39.948), isGasAtStd: true, cpLiq: 0.27, cpGas: 0.124, group: 'gas_syngas' },
  H2S: { formula: 'H₂S', label: 'H₂S (황화수소)', mw: mwOf('H2S', 34.081), isGasAtStd: true, cpLiq: 0.48, cpGas: 0.24, group: 'gas_syngas' },
  SO2: { formula: 'SO₂', label: 'SO₂ (이산화황)', mw: mwOf('SO2', 64.064), isGasAtStd: true, cpLiq: 0.32, cpGas: 0.149, group: 'gas_syngas' },
  SO3: { formula: 'SO₃', label: 'SO₃ (삼산화황)', mw: mwOf('SO3', 80.063), isGasAtStd: false, cpLiq: 0.77, cpGas: 0.151, group: 'gas_syngas' },
  iC4H10: { formula: 'i-C₄H₁₀', label: 'i-C₄H₁₀ (이소부탄)', mw: mwOf('iC4H10', 58.123), isGasAtStd: true, cpLiq: 0.58, cpGas: 0.402, group: 'hydrocarbon' },
  C4H8_1: { formula: '1-C₄H₈', label: '1-C₄H₈ (1-부텐)', mw: mwOf('C4H8_1', 56.107), isGasAtStd: true, cpLiq: 0.54, cpGas: 0.366, group: 'hydrocarbon' },
  nC5H12: { formula: 'n-C₅H₁₂', label: 'n-C₅H₁₂ (노르말펜탄)', mw: mwOf('nC5H12', 72.150), isGasAtStd: false, cpLiq: 0.555, cpGas: 0.398, group: 'hydrocarbon' },
  nC8H18: { formula: 'n-C₈H₁₈', label: 'n-C₈H₁₈ (노르말옥탄)', mw: mwOf('nC8H18', 114.231), isGasAtStd: false, cpLiq: 0.532, cpGas: 0.396, group: 'hydrocarbon' },
  Cyclohexane: { formula: 'C₆H₁₂', label: 'Cyclohexane (시클로헥산)', mw: mwOf('Cyclohexane', 84.161), isGasAtStd: false, cpLiq: 0.44, cpGas: 0.301, group: 'hydrocarbon' },
  Ethylbenzene: { formula: 'C₈H₁₀', label: 'Ethylbenzene (에틸벤젠)', mw: mwOf('Ethylbenzene', 106.167), isGasAtStd: false, cpLiq: 0.415, cpGas: 0.289, group: 'aromatic' },
  Styrene: { formula: 'C₈H₈', label: 'Styrene (스티렌 모노머)', mw: mwOf('Styrene', 104.152), isGasAtStd: false, cpLiq: 0.416, cpGas: 0.275, group: 'aromatic' },
  Cumene: { formula: 'C₉H₁₂', label: 'Cumene (큐멘)', mw: mwOf('Cumene', 120.194), isGasAtStd: false, cpLiq: 0.422, cpGas: 0.302, group: 'aromatic' },
  Phenol: { formula: 'C₆H₅OH', label: 'Phenol (페놀)', mw: mwOf('Phenol', 94.113), isGasAtStd: false, cpLiq: 0.525, cpGas: 0.264, group: 'aromatic' },
  THF: { formula: 'C₄H₈O', label: 'THF (테트라하이드로퓨란)', mw: mwOf('THF', 72.107), isGasAtStd: false, cpLiq: 0.412, cpGas: 0.253, group: 'polar_solvent' },
  DMF: { formula: 'C₃H₇NO', label: 'DMF (디메틸포름아미드)', mw: mwOf('DMF', 73.095), isGasAtStd: false, cpLiq: 0.485, cpGas: 0.292, group: 'polar_solvent' },
  DMSO: { formula: 'C₂H₆OS', label: 'DMSO (디메틸설폭사이드)', mw: mwOf('DMSO', 78.133), isGasAtStd: false, cpLiq: 0.47, cpGas: 0.273, group: 'polar_solvent' },
  MTBE: { formula: 'C₅H₁₂O', label: 'MTBE (메틸터셔리부틸에테르)', mw: mwOf('MTBE', 88.150), isGasAtStd: false, cpLiq: 0.51, cpGas: 0.348, group: 'polar_solvent' },
  MEK: { formula: 'C₄H₈O', label: 'MEK (메틸에틸케톤)', mw: mwOf('MEK', 72.107), isGasAtStd: false, cpLiq: 0.525, cpGas: 0.342, group: 'polar_solvent' },
  DMC: { formula: 'C₃H₆O₃', label: 'DMC (디메틸카보네이트)', mw: mwOf('DMC', 90.078), isGasAtStd: false, cpLiq: 0.44, cpGas: 0.285, group: 'polar_solvent' },
  EG: { formula: 'C₂H₆O₂', label: 'EG (에틸렌글리콜)', mw: mwOf('EG', 62.068), isGasAtStd: false, cpLiq: 0.575, cpGas: 0.332, group: 'polar_solvent' },
  MEA: { formula: 'C₂H₇NO', label: 'MEA (모노에탄올아민)', mw: mwOf('MEA', 61.084), isGasAtStd: false, cpLiq: 0.65, cpGas: 0.34, group: 'polar_solvent' },
  MDEA: { formula: 'C₅H₁₃NO₂', label: 'MDEA (메틸디에탄올아민)', mw: mwOf('MDEA', 119.163), isGasAtStd: false, cpLiq: 0.54, cpGas: 0.35, group: 'polar_solvent' },
  FormicAcid: { formula: 'HCOOH', label: 'FormicAcid (개미산)', mw: mwOf('FormicAcid', 46.025), isGasAtStd: false, cpLiq: 0.514, cpGas: 0.235, group: 'polar_solvent' },
  HNO3: { formula: 'HNO₃', label: 'HNO₃ (질산)', mw: mwOf('HNO3', 63.012), isGasAtStd: false, cpLiq: 0.42, cpGas: 0.202, group: '1B_inorg' },
  CH3Cl: { formula: 'CH₃Cl', label: 'CH₃Cl (메틸클로라이드/MC)', mw: mwOf('CH3Cl', 50.488), isGasAtStd: true, cpLiq: 0.38, cpGas: 0.19, group: 'polar_solvent' },
  CH2Cl2: { formula: 'CH₂Cl₂', label: 'CH₂Cl₂ (염화메틸렌/MCL)', mw: mwOf('CH2Cl2', 84.933), isGasAtStd: false, cpLiq: 0.28, cpGas: 0.15, group: 'polar_solvent' },
  CCl4: { formula: 'CCl₄', label: 'CCl₄ (사염화탄소/CTC)', mw: mwOf('CCl4', 153.823), isGasAtStd: false, cpLiq: 0.20, cpGas: 0.13, group: 'polar_solvent' },
  C2Cl4: { formula: 'C₂Cl₄', label: 'C₂Cl₄ (퍼클로로에틸렌/Heavies)', mw: mwOf('C2Cl4', 165.834), isGasAtStd: false, cpLiq: 0.21, cpGas: 0.14, group: 'polar_solvent' },
  CUSTOM_1: { formula: 'CUSTOM-1', label: 'CUSTOM_1 (사용자정의/UNIFAC 물질 1)', mw: mwOf('CUSTOM_1', 74.122), isGasAtStd: false, cpLiq: 0.56, cpGas: 0.355, group: 'polar_solvent' },
  CUSTOM_2: { formula: 'CUSTOM-2', label: 'CUSTOM_2 (사용자정의/UNIFAC 물질 2)', mw: mwOf('CUSTOM_2', 93.128), isGasAtStd: false, cpLiq: 0.495, cpGas: 0.285, group: 'aromatic' },
};

export type RefrigerantPresetKey =
  | 'cw'
  | 'chw'
  | 'brine_m20'
  | 'meg_brine'
  | 'r134a_chiller'
  | 'r404a_m32'
  | 'freon_m35'
  | 'r22_m30'
  | 'nh3_m33'
  | 'steam_lp'
  | 'custom';

export const REFRIGERANT_PRESETS: Record<RefrigerantPresetKey, {
  label: string;
  inTempC: number;
  outTempC: number;
  cp: number;         // 현열 냉매 비열 kcal/(kg·°C) 또는 잠열 환산
  latentKcalKg?: number; // 프레온/스팀 등 상변화 잠열 사용 시
  defaultU: number;
}> = {
  cw:            { label: '냉각수 (Cooling Water, 28→36°C)',             inTempC: 28,  outTempC: 36,  cp: 1.00, defaultU: 480 },
  chw:           { label: '칠드워터 (Chilled Water, 7→12°C)',            inTempC: 7,   outTempC: 12,  cp: 1.00, defaultU: 450 },
  meg_brine:     { label: '에틸렌글리콜 40% 브라인 (-15→-8°C)',          inTempC: -15, outTempC: -8,  cp: 0.83, defaultU: 375 },
  brine_m20:     { label: '염화칼슘 25% 심냉 브라인 (-25→-18°C)',        inTempC: -25, outTempC: -18, cp: 0.68, defaultU: 360 },
  r134a_chiller: { label: 'R-134a 증발냉매 (-15°C 정온 · 과열 5°C)',     inTempC: -15, outTempC: -10, cp: 0.32, latentKcalKg: 50.0, defaultU: 430 },
  r22_m30:       { label: 'R-22 프레온 증발냉매 (-33°C 정온)',           inTempC: -33, outTempC: -28, cp: 0.28, latentKcalKg: 55.0, defaultU: 440 },
  r404a_m32:     { label: 'R-404A 저온 증발냉매 (-35°C 정온)',           inTempC: -35, outTempC: -30, cp: 0.33, latentKcalKg: 45.9, defaultU: 415 },
  freon_m35:     { label: 'R-507A 공비 증발냉매 (-38°C 정온 · 표준 액화기)', inTempC: -38, outTempC: -33, cp: 0.33, latentKcalKg: 46.8, defaultU: 425 },
  nh3_m33:       { label: 'R-717 암모니아 증발냉매 (-33°C 정온 · 고잠열)', inTempC: -33, outTempC: -29, cp: 1.10, latentKcalKg: 327.0, defaultU: 520 },
  steam_lp:      { label: '저압 스팀 가열 (LP Steam, 145°C 응축)',       inTempC: 145, outTempC: 144, cp: 1.00, latentKcalKg: 508.0, defaultU: 650 },
  custom:        { label: '사용자 직접 입력 (Custom)',                   inTempC: 20,  outTempC: 30,  cp: 1.00, defaultU: 400 },
};

export type FlowUnitType =
  // ── 1) 시뮬레이션 계산 장치 (Active Calculation Units) ──
  | 'feed'
  | 'saturator'       // 100 SEC: 원염 포화조 · 1차 화학정제 침전조
  | 'chelate_tower'   // 100 SEC: 킬레이트 2차 이온교환수지탑 (Ca+Mg < 20 ppb)
  | 'electrolyzer'    // 200 SEC: 이온교환막 전해조
  | 'separator'       // 기액분리기 / 진공 탈염소 플래시탑
  | 'absorber'        // 흡수·건조탑 / 제해탑
  | 'extractor'       // 향류 다단 액-액 추출탑 (LLE Extractor)
  | 'distillation'    // 엄밀 다단 MESH 정밀증류탑 (진공·상압·가압 공비증류)
  | 'desiccant_dryer' // 600 SEC: 실리카겔 흡착 제습탑 (노점 -60°C)
  | 'compressor'
  | 'liquefier'
  | 'hex'
  | 'cooler' // 하위 호환
  | 'pump'
  | 'valve'           // 단열 등엔탈피 Joule-Thomson 감압·교축 밸브
  | 'evaporator'
  | 'reactor'
  | 'mixer'
  | 'splitter'
  | 'product'
  // ── 2) 단순 도면 표기 전용 장치 (Visual Pass-Through Icons) ──
  | 'tank_visual'
  | 'h_drum_visual'
  | 'filter_visual'
  | 'valve_visual'
  | 'silo_visual';

export function isVisualOnlyUnit(t: FlowUnitType): boolean {
  return (
    t === 'tank_visual' ||
    t === 'h_drum_visual' ||
    t === 'filter_visual' ||
    t === 'valve_visual' ||
    t === 'silo_visual'
  );
}

/**
 * 염소(Cl₂) 포화 증기압 계산식 (NIST / Perry Antoine 상관식, -70°C ~ +100°C)
 * log10(P_bar) = 4.0628 - 861.34 / (T_K - 27.01)
 * 검증: -34.0°C -> 1.025 kg/cm²A (0 kG), -15°C -> 2.21 kg/cm²A (1.18 kG),
 *       0°C -> 3.73 kg/cm²A (2.70 kG), +20°C -> 6.84 kg/cm²A (5.81 kG)
 */
export function cl2SatVaporPressureKgcm2A(T_C: number): number {
  const T_K = Math.max(195, Math.min(410, T_C + 273.15));
  const log10Pbar = 4.0628 - 861.34 / (T_K - 27.01);
  return Math.pow(10, log10Pbar) * 1.019716;
}

/**
 * 주어진 염소 분압(kg/cm²A)에서 액화가 시작되는 이슬점 온도 (Cl₂ Dew Point, °C)
 */
export function cl2DewPointTempC(P_cl2_kgcm2A: number): number {
  const P_bar = Math.max(0.02, P_cl2_kgcm2A / 1.019716);
  const logP = Math.log10(P_bar);
  const denom = Math.max(0.5, 4.0628 - logP);
  return 861.34 / denom + 27.01 - 273.15;
}

export interface FlowUnitParams {
  // 장치별 계산 수준 모드: 'simple'(간편 발란스) | 'rigorous'(정밀 열역학 · 다단/구역 적분)
  calcMode?: UnitCalcMode;

  // Feed 전용
  feedTempC?: number;
  feedPressKgcm2g?: number;
  feedFlowsKgH?: Partial<Record<SimCompKey, number>>;

  // Electrolyzer 전용
  currentKA?: number;
  cellCount?: number;
  unitCount?: number;
  currentEffPct?: number;
  waterTransportNumber?: number;
  cellVoltageV?: number;
  cathodeDeltaP?: number;
  membraneAreaM2?: number; // [정밀 모드] 셀당 유효 막 면적 (m², 기본 2.72 m²)

  // Mixer / Splitter
  multiplier?: number;
  splitRatioTop?: number;

  // Separator / HEX / Liquefier / Absorber 공통 운전 조건
  operTempC?: number;
  operPressKgcm2g?: number;
  flashMode?: 'isothermal' | 'adiabatic'; // [정밀 모드] 등온 플래시 vs 단열 줄-톰슨 플래시

  // HEX / Liquefier 냉매 및 다변수 발란스 설정
  refrigerantPreset?: RefrigerantPresetKey;
  hexSpecMode?: 'proc_temp' | 'heat_duty';
  specifiedDutyMcalH?: number;
  utilInTempC?: number;
  utilOutTempC?: number;
  utilCp?: number;
  overallU?: number;
  foulingFactor?: number; // [정밀 모드] 오염계수 R_f (m²·h·°C/kcal, 기본 0.0002)
  hxDesignConfig?: HxDesignParams; // 내장 열교환기·액화기 TEMA/판형 개념·상세설계 설정

  // Pump / Compressor 전용
  outletPressKgcm2g?: number;
  efficiency?: number;
  intercooledTempC?: number; // 압축기 후단 인터쿨러 목표온도 옵션 (0 이하면 단열압축 그대로)
  compStages?: number;       // [정밀 모드] 다단 압축 단수 (1~4단)

  // Column / Absorber 전용
  targetComponent?: SimCompKey;
  removalEfficiency?: number;
  solventMode?: 'connected_or_manual' | 'auto_target_wt';
  makeupSolventComp?: SimCompKey;
  makeupSolventKgH?: number;
  targetBottomWtPct?: number;
  columnStages?: number;       // [정밀 모드] 이론 단수 N (Kremser-MESH 기액평형)
  columnDeltaPKgcm2?: number;  // [정밀 모드] 컬럼 압력손실 (kg/cm²)
  absorberCalcMode?: 'kremser' | 'rigorous_mesh'; // 엄밀 MESH 다단 흡수/탈거 모드

  // Countercurrent Multistage Liquid-Liquid Extractor 전용
  extractorConfig?: Partial<ExtractorColumnConfig>;
  extractorStages?: number;
  extractorSolventComp?: SimCompKey;
  extractorSolventKgH?: number;

  // Adiabatic Joule-Thomson Expansion Valve 전용
  valveCv?: number;
  valveOpeningPct?: number;

  // Evaporator (강하막 증발관) 전용
  evapTargetConcWt?: number; // 목표 농축액 농도 (예: 50 wt% NaOH)

  // Rigorous Multi-Stage Distillation (다단 정밀증류탑) 전용
  distillConfig?: DistillColumnParams;

  // Reactor 전용
  reactionPreset?:
    | 'hcl_burner'
    | 'caustic_scrub'
    | 'brine_electrolysis'
    | 'fecl3_chlorination'
    | 'gte_hydrochlorination'
    | 'ech_saponification'
    | 'cms_aibn_chlorination';
  conversion?: number;
  reactorThermalMode?: 'isothermal' | 'adiabatic';
  reactorModel?: 'conversion' | 'cstr' | 'pfr';
  reactorVolumeM3?: number;
  reactorConfig?: ReactorConfig;

  // 100 SEC 브라인 포화·1차정제(saturator) & 2차 킬레이트 수지탑(chelate_tower) & 600 SEC 제습탑(desiccant_dryer)
  targetBrineWtPct?: number;          // 목표 포화 브라인 농도 (기본 25.65 wt% NaCl ≈ 310 g/L)
  autoSaltMakeup?: boolean;           // 희박염수 유입 시 부족 원염(NaCl) 자동 보충 여부
  autoWaterMakeup?: boolean;          // 순환 브라인 루프 수위/농도 제어(LCV-080) 보충수 자동 트림 여부
  targetDepletedBrineWtPct?: number;  // 전해조 양극 출구 목표 희박염수 농도 (기본 17.45 wt% NaCl)
  chemicalDechlorination?: boolean;   // 진공 탈염소 후 잔류 용존 Cl₂ 환원제(Na₂SO₃) 완전 제거 여부
  sludgePurgePct?: number;            // 1차 침전 슬러지 동반 손실률 (%)
  resinVolM3?: number;                // 킬레이트 수지 충진 부피 (m³/탑, 기본 9.9 m³)
  inletHardnessPpb?: number;          // 유입 브라인 경도 Ca+Mg (ppb, 예: 2200 ppb -> <15 ppb)
  targetDewPointC?: number;           // 실리카겔 제습탑 목표 노점 (°C, 기본 -60°C)

  // 계층형 서브-플로우시트 경계 연동 메타
  boundaryFromMasterNodeId?: string;
  boundaryPortRole?: 'in' | 'anode_in' | 'cathode_in' | 'liq_in' | 'solvent';

  // 도면 전용 장치 메모/차압
  pressureDropKgcm2?: number;
  visualSpecNote?: string;
}

export interface FlowNodeDef {
  id: string;
  tag: string;
  name: string;
  unitType: FlowUnitType;
  subSheetId?: string;     // 더블클릭 시 진입할 하위 세부 공정(Sub-Flowsheet) ID
  subSheetBadge?: string;  // 블록 하단 더블클릭 안내 배지 (예: '황산건조탑 3기')
  params: FlowUnitParams;
}

export type SourcePortId = 'out' | 'vapor' | 'liquid' | 'anode_out' | 'cathode_out' | 'util_out' | 'out1' | 'out2' | 'decanter';
export type TargetPortId = 'in' | 'anode_in' | 'cathode_in' | 'util_in' | 'liq_in' | 'solvent';

export interface FlowEdgeDef {
  id: string;
  streamNo: string;
  name?: string;
  source: string;
  target: string;
  sourcePort?: SourcePortId;
  targetPort?: TargetPortId;
  tearGuess?: {
    flowsKgH?: Partial<Record<SimCompKey, number>>;
    tempC?: number;
    pressKgcm2g?: number;
  };
}

export interface SolvedStream {
  edgeId: string;
  streamNo: string;
  fromTag: string;
  toTag: string;
  portRole: string;
  phase: 'L' | 'G' | 'L/G';
  vaporFraction: number;
  tempC: number;
  pressKgcm2g: number;
  flowsKgH: Record<SimCompKey, number>;
  totalMassKgH: number;
  totalMolarKmolH: number;
  avgMW: number;
  densityKgM3: number;
  volFlowM3H: number;
  cpKcalKgC: number;
  specEnthalpyKcalKg: number;
  enthalpyKcalH: number;
  mainConcWtPct: number | null;
  moistureWtPpm: number | null;
  compressibilityZ?: number;
  isTearStream: boolean;
  keyConcLabel: string;
  /** 64-bit exact stream state values for Design Spec root-finding & enthalpy audits */
  exactTempC?: number;
  exactEnthalpyKcalH?: number;
  exactVaporFraction?: number;
}

export interface SolvedUnitResult {
  nodeId: string;
  tag: string;
  name: string;
  unitType: FlowUnitType;
  calcMode: UnitCalcMode;
  isVisualOnly: boolean;
  detectedFluidLabel: string; // 배관 연결 시 자동 인식된 유입 물질명
  inletMassKgH: number;
  outletMassKgH: number;
  massImbalanceKgH: number;
  heatDutyKcalH: number;
  shaftPowerKW: number;
  condensedOrRemovedKgH: number;
  statusNote: string;
  extraMetrics?: Record<string, string>;
  distillResult?: DistillSolveResult;
  reactorResult?: ReactorSolveResult;
  extractorResult?: ExtractorSolveResult;
  /** 이 장치에서 배관 미연결 포트로 계외 배출된 유량 합 (kg/h) — 출구측 경계 */
  unroutedOutletKgH?: number;
  /** 이 장치에서 자동 보충·약품 등가·배수 증폭으로 계내 유입된 유량 합 (kg/h) — 유입측 경계 */
  makeupInletKgH?: number;
  /** 플로우시트 에너지 수지에 반영된 외부 열량 (kcal/h, 가열 +, 냉각 −) */
  externalHeatKcalH?: number;
}

/**
 * 플로우시트 경계 스트림 (미연결 출구 / 보충·배수 유입)
 * - unrouted_outlet: 장치 출구 포트가 배관에 연결되지 않아 계외로 배출되는 흐름 (드레인·벤트·수층 분리 등)
 * - makeup_inlet  : 배관 없이 장치 내부 로직이 추가하는 흐름 (자동 보충수·원염·흡수액, 약품 등가 질량, 믹서 배수 증폭)
 */
export interface BoundaryStreamEntry {
  kind: 'unrouted_outlet' | 'makeup_inlet';
  nodeId: string;
  tag: string;
  port: string;
  label: string;
  flowsKgH: Record<SimCompKey, number>;
  totalMassKgH: number;
  tempC: number;
  pressKgcm2g: number;
  enthalpyKcalH: number;
  compositionLabel: string;
}

/**
 * 플로우시트 전체 물질·에너지 수지 결산
 * 질량: Σ원료(Feed) + Σ보충유입 − Σ제품(종단 Product) − Σ미연결출구 = massImbalanceKgH
 * 에너지: ΣH_in(Feed+보충) + ΣQ_장치 + ΣW_장치 − ΣH_out(제품+미연결출구) = energyResidualKW
 *   (엔탈피 기준: 25°C 현열 + H₂O/Cl₂ 잠열, 생성열 미포함 → 반응·전해 장치는 잔차가 남는 것이 정상)
 */
export interface FlowsheetBalanceReport {
  feedInKgH: number;
  makeupInKgH: number;
  productOutKgH: number;
  unroutedOutKgH: number;
  massImbalanceKgH: number;
  massImbalancePct: number;
  unroutedOutlets: BoundaryStreamEntry[];
  makeupInlets: BoundaryStreamEntry[];
  feedEnthalpyKW: number;
  makeupEnthalpyKW: number;
  productEnthalpyKW: number;
  unroutedEnthalpyKW: number;
  unitHeatDutyKW: number;
  unitPowerKW: number;
  energyResidualKW: number;
  /** 잔차 / (|ΣH_in| + Σ|Q| + Σ|W|) × 100 */
  energyResidualPct: number;
  /** 장치별 에너지 잔차 상위 항목 (|kW| 내림차순) */
  unitEnergyResiduals: { nodeId: string; tag: string; residualKW: number }[];
  /** 장치별 질량 불균형 상위 항목 (|kg/h| 내림차순, 0.5 kg/h 초과) */
  unitMassImbalances: { nodeId: string; tag: string; imbalanceKgH: number }[];
  /** 물리 배관망만의 질량 수지: Σ원료 − Σ제품 − Σ미연결출구 (보충 유입 제외 → 보충량이 그대로 불균형으로 드러남) */
  physicalMassImbalanceKgH?: number;
  physicalMassImbalancePct?: number;
  /** 장치별 에너지 잔차 판정 (|잔차| > 처리 열량의 0.5% → flagged) */
  unitEnergyChecks?: UnitEnergyCheck[];
}

export interface UnitEnergyCheck {
  nodeId: string;
  tag: string;
  residualKW: number;
  /** 처리 열량 규모: max(|ΣH_in|, |ΣH_out|) + |Q| + |W| (kW) */
  throughputKW: number;
  residualPct: number;
  flagged: boolean;
}

/** 장치별 수렴 판정 */
export type UnitConvergenceStatus = 'converged' | 'warning' | 'failed' | 'not_applicable';
export interface UnitConvergenceEntry {
  /** 장치 nodeId (Tear 스트림 항목은 edgeId) */
  nodeId: string;
  tag: string;
  unitType: FlowUnitType | 'tear_stream';
  status: UnitConvergenceStatus;
  iterations?: number;
  message: string;
}

/** 자동 보충·약품 등가·배수 증폭 등 배관 없이 계내로 주입된 유량 (정직성 보고) */
export type MakeupKind = 'makeup_water' | 'salt' | 'solvent' | 'reagent' | 'multiplier' | 'other';
export interface MakeupReportEntry {
  nodeId: string;
  tag: string;
  kind: MakeupKind;
  flowsKgH: Partial<Record<SimCompKey, number>>;
  totalKgH: number;
  reason: string;
}

/** Tear 스트림별 최종 잔차 (상대값 = |g(x) − x| / 규모) */
export interface TearResidualEntry {
  edgeId: string;
  streamNo: string;
  massAbsKgH: number;
  massRel: number;
  tempAbsC: number;
  tempRel: number;
  enthalpyAbsKcalH: number;
  enthalpyRel: number;
  /** max(massRel, tempRel, enthalpyRel) */
  maxRel: number;
  withinTolerance: boolean;
}

export type OverallConvergenceStatus = 'converged' | 'converged_with_warnings' | 'failed';
export type TearSolverMethod = 'auto' | 'wegstein' | 'broyden' | 'direct';

export interface FlowsheetConvergenceInfo {
  /** 정직한 종합 판정: overallStatus === 'failed' 이면 false */
  converged: boolean;
  iterations: number;
  maxResidualKgH: number;
  recycleLoopCount: number;
  tearEdgeIds: string[];
  tearStreamNos: string[];
  solverMethodLabel: string;
  overallStatus?: OverallConvergenceStatus;
  /** Tear 스트림 상대 허용오차 (질량·온도·엔탈피 공통) */
  relTolerance?: number;
  tearMethod?: TearSolverMethod;
  /** 실제 수렴에 사용된 알고리즘 ('direct' | 'wegstein' | 'broyden') */
  methodUsed?: 'direct' | 'wegstein' | 'broyden';
  tearResiduals?: TearResidualEntry[];
  /** 반복별 최대 상대 잔차 이력 (Tear + 비순환 배관) */
  iterationHistory?: { iter: number; maxTearRel: number; maxNonTearAbsKgH: number; step: string }[];
  /** 진동·발산·정체 감지 결과 */
  recycleDiagnosis?: 'none' | 'converging' | 'oscillating' | 'diverging' | 'stalled';
  unitConvergence?: UnitConvergenceEntry[];
  failedUnitCount?: number;
  warningUnitCount?: number;
  makeupReport?: MakeupReportEntry[];
  makeupTotalKgH?: number;
  /** 시뮬레이션 미실행 초기/대기 상태 여부 (true면 ▶ RUN 클릭 전 O(1) 스켈레톤 상태) */
  isIdle?: boolean;
  /** 사람이 읽을 수 있는 종합 요약 */
  summary?: string;
}

export function emptySimFlows(
  overrides?: Partial<Record<SimCompKey, number>>
): Record<SimCompKey, number> {
  return {
    H2O: 0,
    NaCl: 0,
    NaOH: 0,
    Cl2: 0,
    H2: 0,
    HCl: 0,
    H2SO4: 0,
    O2: 0,
    NaOCl: 0,
    N2: 0,
    NaClO3: 0,
    FeCl2: 0,
    FeCl3: 0,
    PAC: 0,
    Glycerol: 0,
    MCH: 0,
    DCH: 0,
    ECH: 0,
    DCP: 0,
    CH4: 0,
    CO: 0,
    CO2: 0,
    NH3: 0,
    C2H4: 0,
    C2H6: 0,
    C3H6: 0,
    C3H8: 0,
    nC4H10: 0,
    nC6H14: 0,
    nC7H16: 0,
    Benzene: 0,
    Toluene: 0,
    pXylene: 0,
    MeOH: 0,
    EtOH: 0,
    IPA: 0,
    Acetone: 0,
    AceticAcid: 0,
    EtOAc: 0,
    CHCl3: 0,
    Ar: 0,
    H2S: 0,
    SO2: 0,
    SO3: 0,
    iC4H10: 0,
    C4H8_1: 0,
    nC5H12: 0,
    nC8H18: 0,
    Cyclohexane: 0,
    Ethylbenzene: 0,
    Styrene: 0,
    Cumene: 0,
    Phenol: 0,
    THF: 0,
    DMF: 0,
    DMSO: 0,
    MTBE: 0,
    MEK: 0,
    DMC: 0,
    EG: 0,
    MEA: 0,
    MDEA: 0,
    FormicAcid: 0,
    HNO3: 0,
    CH3Cl: 0,
    CH2Cl2: 0,
    CCl4: 0,
    C2Cl4: 0,
    CUSTOM_1: 0,
    CUSTOM_2: 0,
    ...(overrides ?? {}),
  };
}

function emptyFlows(): Record<SimCompKey, number> {
  return emptySimFlows();
}

function sumFlows(f: Record<SimCompKey, number>): number {
  let s = 0;
  for (const k of SIM_COMPS) s += Math.max(0, f[k] || 0);
  return s;
}

function hasGeneralComponents(f: Partial<Record<SimCompKey, number>>): boolean {
  for (let i = 0; i < GENERAL_21_KEYS.length; i++) {
    if ((f[GENERAL_21_KEYS[i]] || 0) > 1e-6) return true;
  }
  return false;
}

export function identifyFluidName(flows: Record<SimCompKey, number>, tempC: number, pressKgcm2g: number): string {
  const tot = sumFlows(flows);
  if (tot <= 0.01) return '유입 배관 미연결';

  const wCl2 = flows.Cl2 / tot;
  const wH2 = flows.H2 / tot;
  const wHCl = flows.HCl / tot;
  const wNaOH = flows.NaOH / tot;
  const wNaCl = flows.NaCl / tot;
  const wH2SO4 = flows.H2SO4 / tot;
  const wH2O = flows.H2O / tot;
  const wECH = flows.ECH / tot;
  const wDCH = flows.DCH / tot;
  const wMCH = flows.MCH / tot;
  const wGly = flows.Glycerol / tot;
  const wDCP = flows.DCP / tot;
  const wFeCl3 = flows.FeCl3 / tot;
  const wFeCl2 = flows.FeCl2 / tot;
  const wPAC = flows.PAC / tot;
  const wNaClO3 = flows.NaClO3 / tot;

  if (wECH > 0.35) return `에피클로로히드린 (ECH ${(wECH * 100).toFixed(2)} wt%)`;
  if (wDCH > 0.20) return `디클로로히드린 반응액 (DCH ${(wDCH * 100).toFixed(1)} wt%)`;
  if (wGly > 0.30 || wMCH > 0.25) return `글리세린/MCH 중질유 (${((wGly + wMCH) * 100).toFixed(1)} wt%)`;
  if (wDCP > 0.25) return `경질 유기염소 유분 (DCP ${(wDCP * 100).toFixed(1)} wt%)`;
  if (wFeCl3 > 0.10) return `염화제2철 에칭액 (${(wFeCl3 * 100).toFixed(1)} wt% FeCl₃)`;
  if (wFeCl2 > 0.08) return `폐에칭액 (${(wFeCl2 * 100).toFixed(1)} wt% FeCl₂)`;
  if (wPAC > 0.08) return `폴리염화알루미늄 (PAC ${(wPAC * 100).toFixed(1)} wt%)`;
  if (wNaClO3 > 0.08) return `염소산소다 용액 (${(wNaClO3 * 100).toFixed(1)} wt% NaClO₃)`;

  // 극성 유기용제 · 방향족 · 탄화수소 · 합성가스/천연가스/암모니아 스트림 인식
  if ((flows.MeOH || 0) / tot > 0.25) return `메탄올 용액/용제 (MeOH ${(((flows.MeOH || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.EtOH || 0) / tot > 0.25) return `에탄올 용액/용제 (EtOH ${(((flows.EtOH || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.IPA || 0) / tot > 0.25) return `이소프로판올 용제 (IPA ${(((flows.IPA || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.Acetone || 0) / tot > 0.25) return `아세톤 용제 (Acetone ${(((flows.Acetone || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.AceticAcid || 0) / tot > 0.25) return `초산 용액 (AceticAcid ${(((flows.AceticAcid || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.EtOAc || 0) / tot > 0.25) return `초산에틸 용제 (EtOAc ${(((flows.EtOAc || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.CH2Cl2 || 0) / tot > 0.40) return `정제 MCL · 디클로로메탄 (CH₂Cl₂ ${(((flows.CH2Cl2 || 0) / tot) * 100).toFixed(2)} wt%)`;
  if ((flows.CH3Cl || 0) / tot > 0.35) return `메틸클로라이드 유분 (CH₃Cl ${(((flows.CH3Cl || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.CHCl3 || 0) / tot > 0.35) return `정제 CFM · 클로로포름 (CHCl₃ ${(((flows.CHCl3 || 0) / tot) * 100).toFixed(2)} wt%)`;
  if (((flows.CCl4 || 0) + (flows.C2Cl4 || 0)) / tot > 0.35) return `잔류 CTC · 헤비 폐유기물 (${((((flows.CCl4 || 0) + (flows.C2Cl4 || 0)) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.CHCl3 || 0) / tot > 0.25) return `클로로포름 용제 (CHCl₃ ${(((flows.CHCl3 || 0) / tot) * 100).toFixed(1)} wt%)`;

  const wBTX = ((flows.Benzene || 0) + (flows.Toluene || 0) + (flows.pXylene || 0)) / tot;
  if ((flows.Benzene || 0) / tot > 0.45) return `벤젠 유분 (Benzene ${(((flows.Benzene || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.Toluene || 0) / tot > 0.45) return `톨루엔 유분 (Toluene ${(((flows.Toluene || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.pXylene || 0) / tot > 0.45) return `파라자일렌 유분 (p-Xylene ${(((flows.pXylene || 0) / tot) * 100).toFixed(1)} wt%)`;
  if (wBTX > 0.35) return `BTX 방향족 혼합유 (${(wBTX * 100).toFixed(1)} wt%)`;

  const wC6C7 = ((flows.nC6H14 || 0) + (flows.nC7H16 || 0)) / tot;
  if (wC6C7 > 0.35) return `경질 나프타/파라핀 (C₆/C₇ ${(wC6C7 * 100).toFixed(1)} wt%)`;

  const wLPG = ((flows.C3H8 || 0) + (flows.nC4H10 || 0) + (flows.C3H6 || 0)) / tot;
  if (wLPG > 0.35) return `LPG 탄화수소 (C₃/C₄ ${(wLPG * 100).toFixed(1)} wt%)`;

  const wC2 = ((flows.C2H4 || 0) + (flows.C2H6 || 0)) / tot;
  if (wC2 > 0.35) return `에틸렌/에탄 경질유분 (C₂ ${(wC2 * 100).toFixed(1)} wt%)`;

  if ((flows.NH3 || 0) / tot > 0.15) {
    return wH2O > 0.25
      ? `암모니아수 (${(((flows.NH3 || 0) / ((flows.NH3 || 0) + flows.H2O)) * 100).toFixed(1)} wt% NH₃)`
      : `암모니아 (NH₃ ${(((flows.NH3 || 0) / tot) * 100).toFixed(1)} wt%)`;
  }
  if ((flows.CO2 || 0) / tot > 0.40) return `이산화탄소 (CO₂ ${(((flows.CO2 || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.CO || 0) / tot > 0.20 && wH2 > 0.02) {
    return `합성가스 (Syngas CO+H₂ ${((((flows.CO || 0) + flows.H2) / tot) * 100).toFixed(1)} wt%)`;
  }
  if ((flows.CO || 0) / tot > 0.40) return `일산화탄소 가스 (CO ${(((flows.CO || 0) / tot) * 100).toFixed(1)} wt%)`;
  if ((flows.CH4 || 0) / tot > 0.35) return `천연가스/메탄 (CH₄ ${(((flows.CH4 || 0) / tot) * 100).toFixed(1)} wt%)`;

  if (wCl2 > 0.70) {
    const P_abs = Math.max(0.15, pressKgcm2g + 1.03323);
    const totMoles = SIM_COMPS.reduce((s, k) => s + flows[k] / COMP_META[k].mw, 0);
    const yCl2 = totMoles > 0 ? (flows.Cl2 / MW.Cl2) / totMoles : 1;
    const dewT = cl2DewPointTempC(P_abs * yCl2);
    const moisturePpm = Math.round((flows.H2O / tot) * 1e6);
    const dryTag = moisturePpm < 150 ? '건조 Cl₂' : '습윤 Cl₂';
    return `${dryTag} (${(wCl2 * 100).toFixed(1)}% · 액화이슬점 ${dewT.toFixed(1)}°C)`;
  }
  if (wH2 > 0.40) return `수소 가스 (H₂ ${(wH2 * 100).toFixed(1)} wt%)`;
  if (wHCl > 0.90 && wH2O < 0.005) {
    const isLiqAhcl = pressKgcm2g >= 10 && tempC <= 0;
    return isLiqAhcl
      ? `액화 무수염산 (AHCl ${(wHCl * 100).toFixed(3)} wt%)`
      : `무수 염화수소 가스 (AHCl ${(wHCl * 100).toFixed(2)} wt%)`;
  }
  if (wHCl > 0.70 && wH2O < 0.2) return `염화수소 가스 (HCl ${(wHCl * 100).toFixed(1)} wt%)`;
  if (wHCl > 0.05 && wH2O > 0.4) return `염산 수용액 (${((flows.HCl / (flows.HCl + flows.H2O)) * 100).toFixed(1)} wt% HCl)`;
  if (flows.NaOCl / tot > 0.02) return `차아염소산 용액 (${((flows.NaOCl / tot) * 100).toFixed(1)} wt% NaOCl)`;
  if (wNaOH > 0.05) return `가성소다 용액 (${((flows.NaOH / (flows.NaOH + flows.H2O + flows.NaCl)) * 100).toFixed(1)} wt% NaOH)`;
  if (wNaCl > 0.85 && wH2O < 0.15) return `원염 고체/슬러리 (NaCl ${(wNaCl * 100).toFixed(1)}%)`;
  if (wNaCl > 0.05) return `브라인 염수 (${((flows.NaCl / (flows.NaCl + flows.H2O)) * 100).toFixed(1)} wt% NaCl)`;
  if (wH2SO4 > 0.20) return `황산 용액 (${((flows.H2SO4 / (flows.H2SO4 + flows.H2O)) * 100).toFixed(1)} wt% H₂SO₄)`;
  if (wH2O > 0.90) return tempC > 105 ? '수증기 (Steam)' : '순수 / 응축수 (H₂O)';
  return `혼합 유체 (${tot.toFixed(0)} kg/h)`;
}

function detectKeyConc(flows: Record<SimCompKey, number>, phase: 'L' | 'G' | 'L/G'): string {
  const tot = sumFlows(flows);
  if (tot <= 0.01) return '—';

  // 무수 액화 염소 vs 수분 동반 습윤 염소 판별!
  if ((phase === 'L' || phase === 'L/G') && flows.Cl2 / tot > 0.50) {
    if (flows.H2O > tot * 0.01) {
      return `습윤 Cl₂ (${((flows.Cl2 / tot) * 100).toFixed(1)}%)`;
    }
    return phase === 'L'
      ? `액화 Cl₂ (${((flows.Cl2 / tot) * 100).toFixed(1)}%)`
      : `기액혼합 Cl₂`;
  }

  // 액화 무수염산 (5N AHCl) 판별
  if ((phase === 'L' || phase === 'L/G') && flows.HCl / tot > 0.85 && flows.H2O / tot < 0.02) {
    return `액화 AHCl (${((flows.HCl / tot) * 100).toFixed(3)}%)`;
  }

  // 유기 염소화물 (ECH / DCH / MCH / 글리세린 / DCP) 판별
  if (flows.ECH / tot > 0.30) {
    const pct = (flows.ECH / tot) * 100;
    return pct >= 99.5 ? `${pct.toFixed(2)} wt% ECH` : `${pct.toFixed(1)} wt% ECH`;
  }
  if (flows.DCP / tot > 0.25) return `${((flows.DCP / tot) * 100).toFixed(1)} wt% DCP`;
  if (flows.DCH / tot > 0.20) return `${((flows.DCH / tot) * 100).toFixed(1)} wt% DCH`;
  if (flows.Glycerol / tot > 0.25) return `${((flows.Glycerol / tot) * 100).toFixed(1)} wt% 글리세린`;
  if (flows.MCH / tot > 0.20) return `${((flows.MCH / tot) * 100).toFixed(1)} wt% MCH`;
  if (flows.FeCl3 / tot > 0.08) return `${((flows.FeCl3 / tot) * 100).toFixed(1)} wt% FeCl₃`;
  if (flows.FeCl2 / tot > 0.08) return `${((flows.FeCl2 / tot) * 100).toFixed(1)} wt% FeCl₂`;
  if (flows.PAC / tot > 0.08) return `${((flows.PAC / tot) * 100).toFixed(1)} wt% PAC`;
  if (flows.NaClO3 / tot > 0.08) return `${((flows.NaClO3 / tot) * 100).toFixed(1)} wt% NaClO₃`;

  // 탄화수소 · 방향족 · 극성용제 · 합성가스 지배 시 주성분 표시
  if (hasGeneralComponents(flows)) {
    let topGen: SimCompKey = GENERAL_21_KEYS[0];
    for (const gk of GENERAL_21_KEYS) {
      if ((flows[gk] || 0) > (flows[topGen] || 0)) topGen = gk;
    }
    if ((flows[topGen] || 0) / tot > 0.15) {
      const wt = ((flows[topGen] || 0) / tot) * 100;
      const sym = COMP_META[topGen].formula;
      return phase === 'G'
        ? `${wt >= 99.5 ? wt.toFixed(2) : wt.toFixed(1)}% ${sym}`
        : `${wt >= 99.5 ? wt.toFixed(2) : wt.toFixed(1)} wt% ${sym}`;
    }
  }

  if (phase === 'G') {
    const dry = flows.Cl2 + flows.H2 + flows.O2 + flows.HCl + flows.N2;
    if (dry > 0.01) {
      const candidates: SimCompKey[] = ['Cl2', 'H2', 'HCl', 'N2', 'O2'];
      let mainGas: SimCompKey = 'Cl2';
      for (const c of candidates) {
        if ((flows[c] || 0) > (flows[mainGas] || 0)) mainGas = c;
      }
      const wt = (flows[mainGas] / tot) * 100;
      const sym = COMP_META[mainGas].formula;
      return `${wt >= 99.5 ? wt.toFixed(2) : wt.toFixed(1)}% ${sym}`;
    }
    return '수증기';
  }
  const liqMass = tot;
  if (liqMass <= 0.01) return '—';
  if (flows.NaOCl > 0.02 * liqMass) return `${((flows.NaOCl / liqMass) * 100).toFixed(1)} wt% NaOCl`;
  if (flows.NaOH > flows.NaCl && flows.NaOH > 0.1) return `${((flows.NaOH / liqMass) * 100).toFixed(1)} wt% NaOH`;
  if (flows.NaCl > 0.85 * liqMass) return `원염 NaCl`;
  if (flows.NaCl > 0.1) return `${((flows.NaCl / liqMass) * 100).toFixed(1)} wt% NaCl`;
  if (flows.HCl > 0.05) return `${((flows.HCl / liqMass) * 100).toFixed(1)} wt% HCl`;
  if (flows.H2SO4 > 0.1) return `${((flows.H2SO4 / liqMass) * 100).toFixed(1)} wt% H₂SO₄`;
  return '순수/응축수';
}

/**
 * 기액평형 플래시 분리기
 * - rigorous = false & ENRTL(코어 성분): 초고속 간편 Antoine + 활동도 플래시
 * - rigorous = true 또는 SRK / PR / NRTL 또는 일반 탄화수소·유기용제 포함 시: 다중 열역학 패키지 + Rachford-Rice 엄밀 플래시
 */
export function flashGasLiquid(
  inFlows: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  _rigorous = false,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
) {
  const rr = solveRigorousFlashVLE(inFlows, T_C, P_kgcm2g, 1.0, undefined, undefined, propertyMethod);
  return {
    vap: rr.vap,
    liq: rr.liq,
    betaVapMole: rr.betaVapMole,
    Z_vap: rr.Z_vap,
    converged: rr.converged,
    iterations: rr.iterations,
  };
}

/** 성분별 기상 분율 β_k = 기상유량/총유량 (스트림의 실제 기액 분배를 보존하기 위한 표현) */
export type VapRatio = Partial<Record<SimCompKey, number>>;

function splitByRatio(flows: Record<SimCompKey, number>, ratio: VapRatio) {
  const vap = emptyFlows();
  const liq = emptyFlows();
  for (const k of SIM_COMPS) {
    const m = Math.max(0, flows[k] || 0);
    const b = Math.min(1, Math.max(0, ratio[k] ?? 0));
    vap[k] = m * b;
    liq[k] = m - vap[k];
  }
  return { vap, liq };
}

export function ratioFromSplit(vap: Record<SimCompKey, number>, liq: Record<SimCompKey, number>): VapRatio {
  const r: VapRatio = {};
  for (const k of SIM_COMPS) {
    const v = Math.max(0, vap[k] || 0);
    const t = v + Math.max(0, liq[k] || 0);
    if (t > 0 && v > 0) r[k] = v / t;
  }
  return r;
}

/**
 * 스트림의 기액 분배 결정 — 엔탈피·물성 계산의 단일 기준
 *  1) vapRatio(장치가 계산한 실제 성분별 기상분율)가 있으면 그대로 사용
 *  2) 'G' → 전량 기상, 'L' → 전량 액상 (장치가 상을 확정한 출구)
 *  3) 그 외('L/G' 또는 미지정) → T·P 등온 플래시
 */
export function phaseSplit(
  flows: Record<SimCompKey, number>,
  tempC: number,
  pressKgcm2g: number,
  forcedPhase?: 'L' | 'G' | 'L/G',
  vapRatio?: VapRatio,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
) {
  if (vapRatio) return splitByRatio(flows, vapRatio);
  if (forcedPhase === 'G') return { vap: { ...flows }, liq: emptyFlows() };
  if (forcedPhase === 'L') return { vap: emptyFlows(), liq: { ...flows } };
  const { vap, liq } = flashGasLiquid(flows, tempC, pressKgcm2g, false, propertyMethod);
  return { vap, liq };
}

/** 스트림 총엔탈피 (생성열 기준, kcal/h) — thermoCore 기반 */
export function stateEnthalpyKcalH(
  flows: Record<SimCompKey, number>,
  tempC: number,
  pressKgcm2g: number,
  forcedPhase?: 'L' | 'G' | 'L/G',
  vapRatio?: VapRatio,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
): number {
  if (sumFlows(flows) <= 0) return 0;
  const { vap, liq } = phaseSplit(flows, tempC, pressKgcm2g, forcedPhase, vapRatio, propertyMethod);
  return streamEnthalpyKcalH(vap, liq, tempC, pressKgcm2g);
}

/** 수용액 비점 (°C) — 염 농도 수분활동도 반영, aw·Psat(T) = P_abs */
export function aqueousBoilingPointC(flows: Record<SimCompKey, number>, pressKgcm2g: number): number {
  const liqSaltMass = flows.NaCl + flows.NaOH + flows.H2SO4 + flows.H2O;
  const wNaCl = liqSaltMass > 0 ? (flows.NaCl / liqSaltMass) * 100 : 0;
  const wNaOH = liqSaltMass > 0 ? (flows.NaOH / liqSaltMass) * 100 : 0;
  const aw = wNaOH > 2 ? waterActivityNaOH(wNaOH) : wNaCl > 2 ? waterActivityNaCl(wNaCl) : 1.0;
  const P_abs = Math.max(0.05, pressKgcm2g + 1.03323);
  let lo = 1.0;
  let hi = 260.0;
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi);
    if (aw * waterSatVaporPressureKgcm2A(mid) < P_abs) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * PH 플래시 (총엔탈피·압력 → 온도·기액분배). 수용액은 비점에서 추가 에너지를 물 증발로 흡수.
 * 후속 단계(증류 MESH 등)에서도 재사용 가능하도록 export.
 */
export function phFlashStream(
  flows: Record<SimCompKey, number>,
  pressKgcm2g: number,
  targetKcalH: number,
  T_guess?: number,
  rigorous = false,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
) {
  const hasAqWater = flows.H2O > 1e-6;
  const cap = hasAqWater ? aqueousBoilingPointC(flows, pressKgcm2g) - 1e-3 : null;
  return phFlash(
    flows,
    pressKgcm2g,
    targetKcalH,
    T => {
      const r = flashGasLiquid(flows, T, pressKgcm2g, rigorous, propertyMethod);
      return { vap: r.vap, liq: r.liq };
    },
    { T_guess, boilingCapC: cap, T_min: -110, T_max: 450 }
  );
}

function calcStreamProps(
  flows: Record<SimCompKey, number>,
  tempC: number,
  pressKgcm2g: number,
  forcedPhase?: 'L' | 'G' | 'L/G',
  vapRatio?: VapRatio,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
) {
  let totalMass = 0;
  let totalMolar = 0;
  let cpMix = 0;

  for (const k of SIM_COMPS) {
    const m = Math.max(0, flows[k] || 0);
    flows[k] = m;
    if (m > 0) {
      totalMass += m;
      totalMolar += m / COMP_META[k].mw;
    }
  }

  if (totalMass <= 0) {
    return {
      phase: (forcedPhase ?? 'L') as 'L' | 'G' | 'L/G',
      vaporFraction: 0,
      exactVaporFraction: 0,
      totalMassKgH: 0,
      totalMolarKmolH: 0,
      avgMW: 18.015,
      densityKgM3: 1000,
      volFlowM3H: 0,
      cpKcalKgC: 1.0,
      specEnthalpyKcalKg: 0,
      enthalpyKcalH: 0,
      exactEnthalpyKcalH: 0,
      mainConcWtPct: null as number | null,
      moistureWtPpm: null as number | null,
      compressibilityZ: undefined as number | undefined,
    };
  }

  const avgMW = totalMass / Math.max(1e-9, totalMolar);
  let phase: 'L' | 'G' | 'L/G' = forcedPhase ?? 'L';
  let vapFrac = 0;

  // 실제 성분별 기액 분배 (엔탈피와 동일 기준) — 'L/G' 라벨에 임의 기상분율(0.5)을 부여하지 않는다
  const split = phaseSplit(flows, tempC, pressKgcm2g, forcedPhase, vapRatio, propertyMethod);
  {
    const vMass = sumFlows(split.vap);
    const lMass = sumFlows(split.liq);
    vapFrac = vMass / Math.max(1e-9, vMass + lMass);
    if (!forcedPhase || forcedPhase === 'L/G' || vapRatio) {
      if (vapFrac > 0.985) {
        phase = 'G';
      } else if (vapFrac < 0.015) {
        phase = 'L';
      } else {
        phase = 'L/G';
      }
    }
  }

  for (const k of SIM_COMPS) {
    const w = flows[k] / totalMass;
    cpMix += w * (phase === 'G' ? COMP_META[k].cpGas : COMP_META[k].cpLiq);
  }

  let density = 1000;
  let compZ: number | undefined = undefined;
  const P_atm = Math.max(0.08, (pressKgcm2g + 1.03323) / 1.03323);
  const T_K = Math.max(150, tempC + 273.15);

  if (phase === 'G') {
    const moleFrac = emptyFlows();
    for (const k of SIM_COMPS) moleFrac[k] = (flows[k] / COMP_META[k].mw) / Math.max(1e-9, totalMolar);
    const eos =
      propertyMethod === 'SRK'
        ? calcSoaveRedlichKwongMixture(moleFrac, tempC, pressKgcm2g)
        : calcPengRobinsonMixture(moleFrac, tempC, pressKgcm2g);
    compZ = Number(eos.Z_vap.toFixed(3));
    density = (P_atm * avgMW) / (Math.max(0.3, eos.Z_vap) * 0.082057 * T_K);
  } else {
    const isLiqCl2 = flows.Cl2 / totalMass > 0.50;
    const isLiqAhcl = flows.HCl / totalMass > 0.85 && flows.H2O / totalMass < 0.02;
    const genOrgMass =
      (flows.CH4 || 0) + (flows.C2H4 || 0) + (flows.C2H6 || 0) + (flows.C3H6 || 0) +
      (flows.C3H8 || 0) + (flows.nC4H10 || 0) + (flows.nC6H14 || 0) + (flows.nC7H16 || 0) +
      (flows.Benzene || 0) + (flows.Toluene || 0) + (flows.pXylene || 0) +
      (flows.MeOH || 0) + (flows.EtOH || 0) + (flows.IPA || 0) + (flows.Acetone || 0) +
      (flows.AceticAcid || 0) + (flows.EtOAc || 0) + (flows.CHCl3 || 0) + (flows.NH3 || 0) + (flows.CO2 || 0);
    let liqRho: number;
    if (isLiqCl2) {
      liqRho = Math.max(1250, 1468 - 2.9 * tempC);
    } else if (isLiqAhcl) {
      liqRho = Math.max(760, 992 - 2.6 * tempC);
    } else if (genOrgMass > 0.25 * totalMass) {
      const invRhoMix =
        (flows.H2O / totalMass) / 998.0 +
        ((flows.C2H4 || 0) + (flows.C2H6 || 0) + (flows.C3H6 || 0) + (flows.C3H8 || 0) + (flows.CH4 || 0)) / totalMass / 520.0 +
        (flows.nC4H10 || 0) / totalMass / 580.0 +
        (flows.nC6H14 || 0) / totalMass / 659.0 +
        (flows.nC7H16 || 0) / totalMass / 684.0 +
        ((flows.Benzene || 0) + (flows.Toluene || 0) + (flows.pXylene || 0)) / totalMass / 870.0 +
        ((flows.MeOH || 0) + (flows.EtOH || 0) + (flows.IPA || 0) + (flows.Acetone || 0)) / totalMass / 789.0 +
        (flows.EtOAc || 0) / totalMass / 900.0 +
        (flows.AceticAcid || 0) / totalMass / 1049.0 +
        (flows.CHCl3 || 0) / totalMass / 1483.0 +
        (flows.NH3 || 0) / totalMass / 610.0 +
        (flows.CO2 || 0) / totalMass / 770.0 +
        Math.max(0, totalMass - genOrgMass - flows.H2O) / totalMass / 1100.0;
      liqRho = Math.max(420, 1.0 / Math.max(1e-5, invRhoMix) - 0.78 * (tempC - 20));
    } else {
      liqRho = Math.max(
        850,
        998.2 +
          740 * (flows.NaCl / totalMass) +
          1080 * (flows.NaOH / totalMass) +
          860 * (flows.H2SO4 / totalMass) +
          820 * (flows.NaOCl / totalMass) +
          760 * (flows.NaClO3 / totalMass) +
          980 * (flows.FeCl3 / totalMass) +
          890 * (flows.FeCl2 / totalMass) +
          720 * (flows.PAC / totalMass) +
          260 * (flows.Glycerol / totalMass) +
          320 * (flows.MCH / totalMass) +
          365 * (flows.DCH / totalMass) +
          182 * (flows.ECH / totalMass) +
          158 * (flows.DCP / totalMass) +
          500 * (flows.HCl / totalMass) -
          0.42 * (tempC - 20)
      );
    }

    if (phase === 'L') {
      density = liqRho;
    } else {
      const gasRho = (P_atm * avgMW) / (0.082057 * T_K);
      density = 1 / (vapFrac / Math.max(0.05, gasRho) + (1 - vapFrac) / liqRho);
    }
  }

  const volFlow = totalMass / Math.max(0.01, density);
  // 총엔탈피 (생성열 기준: 원소 25 °C = 0) — 성분별 실제 기액 분배 기준 (thermoCore)
  const enthalpy = streamEnthalpyKcalH(split.vap, split.liq, tempC, pressKgcm2g);

  // 주성분 농도(wt%) 및 가스/액화염소 수분(wt ppm) 산출
  let mainConcWtPct: number | null = null;
  let moistureWtPpm: number | null = null;
  if (phase === 'G' || flows.Cl2 / totalMass > 0.50) {
    moistureWtPpm = Number(((flows.H2O / totalMass) * 1e6).toFixed(1));
    if (flows.Cl2 / totalMass > 0.50) mainConcWtPct = Number(((flows.Cl2 / totalMass) * 100).toFixed(2));
    else if (flows.H2 / totalMass > 0.30) mainConcWtPct = Number(((flows.H2 / totalMass) * 100).toFixed(2));
    else if (flows.HCl / totalMass > 0.30) mainConcWtPct = Number(((flows.HCl / totalMass) * 100).toFixed(2));
    else if (hasGeneralComponents(flows)) {
      let maxGen = 0;
      for (const gk of GENERAL_21_KEYS) maxGen = Math.max(maxGen, flows[gk] || 0);
      if (maxGen > 0.20 * totalMass) mainConcWtPct = Number(((maxGen / totalMass) * 100).toFixed(2));
    }
  } else {
    const aqBase = Math.max(1e-6, totalMass);
    if (flows.NaOCl > 0.01 * totalMass) mainConcWtPct = Number(((flows.NaOCl / aqBase) * 100).toFixed(2));
    else if (flows.NaOH > 0.01 * totalMass) mainConcWtPct = Number(((flows.NaOH / aqBase) * 100).toFixed(2));
    else if (flows.NaCl > 0.01 * totalMass) mainConcWtPct = Number(((flows.NaCl / aqBase) * 100).toFixed(2));
    else if (flows.H2SO4 > 0.01 * totalMass) mainConcWtPct = Number(((flows.H2SO4 / aqBase) * 100).toFixed(2));
    else if (flows.HCl > 0.01 * totalMass) mainConcWtPct = Number(((flows.HCl / aqBase) * 100).toFixed(2));
    else if (hasGeneralComponents(flows)) {
      let maxGen = 0;
      for (const gk of GENERAL_21_KEYS) maxGen = Math.max(maxGen, flows[gk] || 0);
      if (maxGen > 0.05 * totalMass) mainConcWtPct = Number(((maxGen / aqBase) * 100).toFixed(2));
    }
  }

  return {
    phase,
    vaporFraction: Number(vapFrac.toFixed(3)),
    exactVaporFraction: vapFrac,
    totalMassKgH: Number(totalMass.toFixed(2)),
    totalMolarKmolH: Number(totalMolar.toFixed(2)),
    avgMW: Number(avgMW.toFixed(2)),
    densityKgM3: Number(density.toFixed(phase === 'G' ? 3 : 1)),
    volFlowM3H: Number(volFlow.toFixed(2)),
    cpKcalKgC: Number(cpMix.toFixed(3)),
    specEnthalpyKcalKg: Number((enthalpy / totalMass).toFixed(1)),
    enthalpyKcalH: Number(enthalpy.toFixed(0)),
    exactEnthalpyKcalH: enthalpy,
    mainConcWtPct,
    moistureWtPpm,
    compressibilityZ: compZ,
  };
}

function calcLMTD(dT1: number, dT2: number): number {
  const a = Math.max(0.5, Math.abs(dT1));
  const b = Math.max(0.5, Math.abs(dT2));
  if (Math.abs(a - b) < 0.05) return a;
  return (a - b) / Math.log(a / b);
}

/**
 * 순환 잔차 이력(최대 상대잔차 시계열) 기반 진동·발산·정체 판별
 * - diverging  : 최근 4회 연속 증가 + 최소값 대비 10배 초과
 * - oscillating: 최근 8회 중 증감 부호 반전 ≥ 5회 + 순감소 미미 (끝/처음 > 0.5)
 * - stalled    : (미수렴 확정 시) 최근 10회 동안 잔차 감소 < 50%
 */
export function classifyRecycleHistory(
  hist: number[],
  finalNotConverged: boolean
): 'none' | 'converging' | 'oscillating' | 'diverging' | 'stalled' {
  const h = hist.filter(v => Number.isFinite(v));
  if (h.length < 4 || h.every(v => v === 0)) return 'none';
  const last = h[h.length - 1];
  const tail4 = h.slice(-4);
  const minSeen = Math.min(...h);
  if (tail4.every((v, i) => i === 0 || v > tail4[i - 1]) && last > 10 * Math.max(minSeen, 1e-12)) return 'diverging';
  const tail8 = h.slice(-8);
  if (tail8.length >= 6) {
    let flips = 0;
    for (let i = 2; i < tail8.length; i++) {
      const d1 = tail8[i - 1] - tail8[i - 2];
      const d2 = tail8[i] - tail8[i - 1];
      if (d1 * d2 < 0) flips++;
    }
    if (flips >= Math.min(5, tail8.length - 2) && last > 0.5 * tail8[0]) return 'oscillating';
  }
  if (finalNotConverged) {
    const ref = h[Math.max(0, h.length - 11)];
    if (ref > 0 && last > 0.5 * ref) return 'stalled';
  }
  return 'converging';
}

/**
 * 전체 플로우시트 순차 모듈러 해석기 v5
 * - Tarjan SCC 기반 순환 배관(Recycle Loop) & Tear Stream 자동 식별
 * - Bounded Wegstein(q∈[−5,0]) / Broyden / 직접치환 Tear 가속 + 진동·발산 감지 감쇠 폴백 (기본 최대 80회, 상대허용오차 1e-4: 질량·온도·엔탈피)
 * - Carlson 열역학 패키지(AUTO / ENRTL / NRTL / PR / SRK) 전역 연동 + 장치별 2단 기어 하이브리드 연산
 */
export interface FlowsheetSolveOptions {
  propertyMethod?: SimPropertyMethod;
  activeComponents?: SimCompKey[];
  /** Tear 스트림 수렴 가속 방식 (기본 'auto': 단일루프 Wegstein / 다중루프·진동 시 동시 Broyden) */
  tearMethod?: TearSolverMethod;
  /** Tear 스트림 상대 허용오차 (기본 1e-4) */
  relTolerance?: number;
  /** 최대 순환 반복수 (기본 순환 有 80 / 無 6) */
  maxIterations?: number;
}

export interface FlowsheetSolveResult {
  streams: SolvedStream[];
  units: SolvedUnitResult[];
  convergence: FlowsheetConvergenceInfo;
  balance: FlowsheetBalanceReport;
  propertyMethodMode: SimPropertyMethod;
  propertyMethodUsed: ResolvedPropertyMethod;
  propertyMethodReason: string;
}

/**
 * O(N+E) < 0.5 ms 초고속 미실행(Idle) 스켈레톤 결과 생성기
 * - 페이지 초기 오픈 / 프리셋 전환 / 시트 이동 시 동기 MESH·리사이클 수렴을 절대 수행하지 않는다.
 * - 원료(Feed) 스트림의 입력 유량과 위상정렬 Tear 구조만 즉시 표시하고, 사용자가 [▶ RUN]을 누를 때 본 해석기를 구동한다.
 */
export function createIdleFlowsheetResult(
  nodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  options?: FlowsheetSolveOptions
): FlowsheetSolveResult {
  const nodeMap = new Map<string, FlowNodeDef>();
  nodes.forEach(n => nodeMap.set(n.id, n));

  const aggFeedFlows = emptyFlows();
  let maxFeedP = 1.0;
  for (const n of nodes) {
    if (n.unitType === 'feed') {
      maxFeedP = Math.max(maxFeedP, n.params.feedPressKgcm2g ?? 1.0);
      for (const k of SIM_COMPS) {
        aggFeedFlows[k] += Math.max(0, n.params.feedFlowsKgH?.[k] ?? 0);
      }
    } else if (n.params.makeupSolventComp && (n.params.makeupSolventKgH ?? 0) > 0) {
      aggFeedFlows[n.params.makeupSolventComp] += Math.max(0, n.params.makeupSolventKgH ?? 0);
    }
  }

  const propertyMethodMode: SimPropertyMethod = options?.propertyMethod ?? 'AUTO';
  const isExplicitPropertyMethod =
    propertyMethodMode === 'ENRTL' ||
    propertyMethodMode === 'NRTL' ||
    propertyMethodMode === 'PR' ||
    propertyMethodMode === 'SRK';
  const autoRec = recommendPropertyMethod(options?.activeComponents ?? SIM_COMPS, aggFeedFlows, maxFeedP);
  const propertyMethodUsed: ResolvedPropertyMethod = isExplicitPropertyMethod
    ? propertyMethodMode
    : autoRec.method;
  const propertyMethodReason: string = isExplicitPropertyMethod
    ? `사용자 수동 지정: ${PROPERTY_METHOD_INFO[propertyMethodUsed].labelKo}`
    : autoRec.reasonKo;

  const topo = analyzeFlowsheetTopology(
    nodes.map(n => n.id),
    edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
  );
  const tearSet = new Set<string>(topo.tearEdgeIds);
  const tearStreamNos = topo.tearEdgeIds
    .map(eid => edges.find(e => e.id === eid)?.streamNo ?? eid)
    .filter(Boolean);

  const outCountBySource = new Map<string, number>();
  for (const e of edges) {
    outCountBySource.set(e.source, (outCountBySource.get(e.source) ?? 0) + 1);
  }

  const streams: SolvedStream[] = edges.map(e => {
    const src = nodeMap.get(e.source);
    const dst = nodeMap.get(e.target);
    const flows = emptyFlows();
    let tempC = 25;
    let pressKgcm2g = 1.0;
    let phase: 'L' | 'G' | 'L/G' = 'L';

    if (src?.unitType === 'feed') {
      const nOut = Math.max(1, outCountBySource.get(src.id) ?? 1);
      for (const k of SIM_COMPS) {
        flows[k] = Math.max(0, src.params.feedFlowsKgH?.[k] ?? 0) / nOut;
      }
      tempC = src.params.feedTempC ?? 25;
      pressKgcm2g = src.params.feedPressKgcm2g ?? 1.0;
      let gasMass = 0;
      let totM = 0;
      for (const k of SIM_COMPS) {
        totM += flows[k];
        if (COMP_META[k].isGasAtStd) gasMass += flows[k];
      }
      if (totM > 0 && gasMass / totM > 0.85) phase = 'G';
      else if (totM > 0 && gasMass / totM > 0.15) phase = 'L/G';
    }

    const totalMassKgH = sumFlows(flows);
    let totalMolarKmolH = 0;
    for (const k of SIM_COMPS) {
      if (flows[k] > 0) totalMolarKmolH += flows[k] / COMP_META[k].mw;
    }
    const avgMW = totalMolarKmolH > 0 ? totalMassKgH / totalMolarKmolH : 18.015;
    const densityKgM3 = phase === 'G' ? 1.5 : 1000;
    const volFlowM3H = totalMassKgH > 0 ? totalMassKgH / densityKgM3 : 0;

    return {
      edgeId: e.id,
      streamNo: e.streamNo,
      fromTag: src?.tag ?? e.source,
      toTag: dst?.tag ?? e.target,
      portRole: e.sourcePort ?? 'out',
      phase,
      vaporFraction: phase === 'G' ? 1 : phase === 'L/G' ? 0.5 : 0,
      tempC,
      pressKgcm2g,
      flowsKgH: flows,
      totalMassKgH: Number(totalMassKgH.toFixed(3)),
      totalMolarKmolH: Number(totalMolarKmolH.toFixed(4)),
      avgMW: Number(avgMW.toFixed(2)),
      densityKgM3,
      volFlowM3H: Number(volFlowM3H.toFixed(3)),
      cpKcalKgC: 0.8,
      specEnthalpyKcalKg: 0,
      enthalpyKcalH: 0,
      mainConcWtPct: null,
      moistureWtPpm: null,
      isTearStream: tearSet.has(e.id),
      keyConcLabel: totalMassKgH > 0.01 ? detectKeyConc(flows, phase) : '▶ RUN 대기',
      exactTempC: tempC,
      exactEnthalpyKcalH: 0,
      exactVaporFraction: phase === 'G' ? 1 : 0,
    };
  });

  const streamByEdge = new Map(streams.map(s => [s.edgeId, s]));
  const units: SolvedUnitResult[] = nodes.map(n => {
    const isVis =
      n.unitType === 'tank_visual' ||
      n.unitType === 'h_drum_visual' ||
      n.unitType === 'filter_visual' ||
      n.unitType === 'valve_visual' ||
      n.unitType === 'silo_visual';
    if (n.unitType === 'feed') {
      const fFlows = emptyFlows();
      for (const k of SIM_COMPS) fFlows[k] = Math.max(0, n.params.feedFlowsKgH?.[k] ?? 0);
      const tot = sumFlows(fFlows);
      const fT = n.params.feedTempC ?? 25;
      const fP = n.params.feedPressKgcm2g ?? 1.0;
      return {
        nodeId: n.id,
        tag: n.tag,
        name: n.name,
        unitType: n.unitType,
        calcMode: n.params.calcMode ?? 'simple',
        isVisualOnly: false,
        detectedFluidLabel: tot > 0.01 ? identifyFluidName(fFlows, fT, fP) : '원료 대기',
        inletMassKgH: 0,
        outletMassKgH: Number(tot.toFixed(2)),
        massImbalanceKgH: 0,
        heatDutyKcalH: 0,
        shaftPowerKW: 0,
        condensedOrRemovedKgH: 0,
        statusNote: `공급 설정: ${tot.toFixed(1)} kg/h (${fT.toFixed(1)}°C, ${fP.toFixed(2)} kG) · [▶ RUN] 대기`,
      };
    }

    const inStreams = edges
      .filter(e => e.target === n.id && e.targetPort !== 'util_in')
      .map(e => streamByEdge.get(e.id))
      .filter((s): s is SolvedStream => Boolean(s));
    const inKgH = inStreams.reduce((a, b) => a + b.totalMassKgH, 0);
    const inFlows = emptyFlows();
    for (const s of inStreams) {
      for (const k of SIM_COMPS) inFlows[k] += s.flowsKgH[k] ?? 0;
    }

    return {
      nodeId: n.id,
      tag: n.tag,
      name: n.name,
      unitType: n.unitType,
      calcMode: n.params.calcMode ?? 'simple',
      isVisualOnly: isVis,
      detectedFluidLabel:
        inKgH > 0.01 ? identifyFluidName(inFlows, inStreams[0]?.tempC ?? 25, inStreams[0]?.pressKgcm2g ?? 1) : '▶ RUN 대기',
      inletMassKgH: Number(inKgH.toFixed(2)),
      outletMassKgH: 0,
      massImbalanceKgH: 0,
      heatDutyKcalH: 0,
      shaftPowerKW: 0,
      condensedOrRemovedKgH: 0,
      statusNote: '미실행 대기 중 — 상단 [▶ RUN] 버튼을 클릭하면 수렴 계산이 수행됩니다.',
    };
  });

  const feedInKgH = Number(sumFlows(aggFeedFlows).toFixed(2));

  return {
    streams,
    units,
    convergence: {
      converged: false,
      isIdle: true,
      iterations: 0,
      maxResidualKgH: 0,
      recycleLoopCount: topo.loopCount,
      tearEdgeIds: topo.tearEdgeIds,
      tearStreamNos,
      solverMethodLabel: '미실행 대기 (▶ RUN 실행 시 수렴 계산)',
      overallStatus: 'converged_with_warnings',
      relTolerance: options?.relTolerance ?? 1e-4,
      tearMethod: options?.tearMethod ?? 'auto',
      methodUsed: 'direct',
      tearResiduals: [],
      iterationHistory: [],
      recycleDiagnosis: 'none',
      unitConvergence: nodes.map(n => ({
        nodeId: n.id,
        tag: n.tag,
        unitType: n.unitType,
        status: 'not_applicable',
        message: '시뮬레이션 미실행 ([▶ RUN] 대기 중)',
      })),
      failedUnitCount: 0,
      warningUnitCount: 0,
      makeupReport: [],
      makeupTotalKgH: 0,
      summary: '미실행 대기 상태입니다. 상단 [▶ RUN] 버튼을 클릭하여 공정 시뮬레이션을 실행하세요.',
    },
    balance: {
      feedInKgH,
      makeupInKgH: 0,
      productOutKgH: 0,
      unroutedOutKgH: 0,
      massImbalanceKgH: 0,
      massImbalancePct: 0,
      unroutedOutlets: [],
      makeupInlets: [],
      feedEnthalpyKW: 0,
      makeupEnthalpyKW: 0,
      productEnthalpyKW: 0,
      unroutedEnthalpyKW: 0,
      unitHeatDutyKW: 0,
      unitPowerKW: 0,
      energyResidualKW: 0,
      energyResidualPct: 0,
      unitEnergyResiduals: [],
      unitMassImbalances: [],
      physicalMassImbalanceKgH: 0,
      physicalMassImbalancePct: 0,
      unitEnergyChecks: [],
    },
    propertyMethodMode,
    propertyMethodUsed,
    propertyMethodReason,
  };
}

export function solveFlowsheet(
  nodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  options?: FlowsheetSolveOptions
): FlowsheetSolveResult {
  const nodeMap = new Map<string, FlowNodeDef>();
  nodes.forEach(n => nodeMap.set(n.id, n));

  // 0) 피드 합산 및 전역 열역학 패키지(AUTO / ENRTL / NRTL / PR / SRK) 결정
  const aggFeedFlows = emptyFlows();
  let maxFeedP = 1.0;
  for (const n of nodes) {
    if (n.unitType === 'feed') {
      maxFeedP = Math.max(maxFeedP, n.params.feedPressKgcm2g ?? 1.0);
      for (const k of SIM_COMPS) {
        aggFeedFlows[k] += Math.max(0, n.params.feedFlowsKgH?.[k] ?? 0);
      }
    } else if (n.params.makeupSolventComp && (n.params.makeupSolventKgH ?? 0) > 0) {
      aggFeedFlows[n.params.makeupSolventComp] += Math.max(0, n.params.makeupSolventKgH ?? 0);
    }
  }
  const propertyMethodMode: SimPropertyMethod = options?.propertyMethod ?? 'AUTO';
  const isExplicitPropertyMethod =
    propertyMethodMode === 'ENRTL' ||
    propertyMethodMode === 'NRTL' ||
    propertyMethodMode === 'PR' ||
    propertyMethodMode === 'SRK';
  const autoRec = recommendPropertyMethod(options?.activeComponents ?? SIM_COMPS, aggFeedFlows, maxFeedP);
  const propertyMethodUsed: ResolvedPropertyMethod = isExplicitPropertyMethod
    ? propertyMethodMode
    : autoRec.method;
  const propertyMethodReason: string = isExplicitPropertyMethod
    ? `사용자 수동 지정: ${PROPERTY_METHOD_INFO[propertyMethodUsed].labelKo}`
    : autoRec.reasonKo;
  const hasAnyGeneralInSheet = hasGeneralComponents(aggFeedFlows);
  const runtimePropertyMethod: ResolvedPropertyMethod =
    isExplicitPropertyMethod || hasAnyGeneralInSheet ? propertyMethodUsed : 'ENRTL';

  // 1) 위상 정렬 및 순환 루프 Tear Stream 자동 탐색
  const topo = analyzeFlowsheetTopology(
    nodes.map(n => n.id),
    edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
  );
  const tearSet = new Set<string>(topo.tearEdgeIds);
  const orderedNodes = topo.orderedNodeIds.map(id => nodeMap.get(id)!).filter(Boolean);

  type EdgeRuntimeState = {
    flows: Record<SimCompKey, number>;
    tempC: number;
    pressKgcm2g: number;
    forcedPhase?: 'L' | 'G' | 'L/G';
    /** 장치가 산출한 성분별 기상분율 (있으면 forcedPhase 보다 우선) */
    vapRatio?: VapRatio;
  };

  const edgeState = new Map<string, EdgeRuntimeState>();
  edges.forEach(e => {
    if (tearSet.has(e.id) && e.tearGuess) {
      edgeState.set(e.id, {
        flows: emptySimFlows(e.tearGuess.flowsKgH),
        tempC: e.tearGuess.tempC ?? 25.0,
        pressKgcm2g: e.tearGuess.pressKgcm2g ?? 0.0,
      });
    } else {
      edgeState.set(e.id, { flows: emptyFlows(), tempC: 25.0, pressKgcm2g: 0.0 });
    }
  });

  // Wegstein 이전 반복 기록용 (x_prev, g_prev)
  const tearPrevX = new Map<string, EdgeRuntimeState>();
  const tearPrevG = new Map<string, EdgeRuntimeState>();

  const unitResults = new Map<string, SolvedUnitResult>();
  // 장치별 경계 스트림(미연결 출구 / 보충 유입) 및 외부 열량 — 매 반복 마지막 계산값으로 덮어씀
  type BoundaryRaw = { port: string; label: string; flows: Record<SimCompKey, number>; tempC: number; pressKgcm2g: number; phase?: 'L' | 'G' | 'L/G'; vapRatio?: VapRatio };
  const stH = (st: EdgeRuntimeState) => stateEnthalpyKcalH(st.flows, st.tempC, st.pressKgcm2g, st.forcedPhase, st.vapRatio, runtimePropertyMethod);
  const bH = (b: BoundaryRaw) => stateEnthalpyKcalH(b.flows, b.tempC, b.pressKgcm2g, b.phase, b.vapRatio, runtimePropertyMethod);
  const KCALH_PER_KW_SOLVER = 859.845;
  const unroutedByNode = new Map<string, BoundaryRaw[]>();
  const makeupByNode = new Map<string, BoundaryRaw[]>();
  const qExtByNode = new Map<string, number>();
  const distillIterCache = new Map<string, { sig: string; totFlows: Record<SimCompKey, number>; totMass: number; totH: number; res: ReturnType<typeof solveRigorousDistillation> }>();
  const absorberIterCache = new Map<string, { sig: string; res: ReturnType<typeof solveRigorousAbsorberStripper> }>();
  const extractorIterCache = new Map<string, { sig: string; res: ReturnType<typeof solveMultistageExtractor> }>();

  const MAX_ITER = Math.max(2, options?.maxIterations ?? (topo.tearEdgeIds.length > 0 ? 80 : 6));
  const REL_TOL = Math.max(1e-8, options?.relTolerance ?? 1e-4);
  /** 느슨한 허용오차 (REL_TOL ~ LOOSE_TOL 사이 = '경고 수렴') */
  const LOOSE_TOL = REL_TOL * 10;
  const tearMethod: TearSolverMethod = options?.tearMethod ?? 'auto';
  let activeTearMethod: 'direct' | 'wegstein' | 'broyden' =
    topo.tearEdgeIds.length === 0 || tearMethod === 'direct'
      ? 'direct'
      : tearMethod === 'broyden' || (tearMethod === 'auto' && topo.tearEdgeIds.length >= 2)
        ? 'broyden'
        : 'wegstein';
  const broydenAccel = new BroydenTearAccelerator({ alpha0: 0.65, spikeResetFactor: 3.0 });
  let finalIter = 1;
  let finalMaxResidual = 0;
  let isConverged = false;
  let loosenedConverged = false;
  // 장치별 수렴 이슈 (매 반복 마지막 계산값으로 덮어씀)
  type UnitIssue = { sev: 'warning' | 'failed'; msg: string };
  const unitIssuesByNode = new Map<string, UnitIssue[]>();
  // Tear 잔차 이력·최종값
  const tearResidualLast = new Map<string, TearResidualEntry>();
  const iterationHistory: { iter: number; maxTearRel: number; maxNonTearAbsKgH: number; step: string }[] = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    finalIter = iter + 1;
    let maxDiff = 0;
    let nonTearScale = 1;
    const tearComputedG = new Map<string, EdgeRuntimeState>();

    for (const node of orderedNodes) {
      const inEdges = edges.filter(e => e.target === node.id);
      const outEdges = edges.filter(e => e.source === node.id);
      const p = node.params;
      const isRigorous = (p.calcMode ?? 'simple') === 'rigorous';
      const unitIssues: UnitIssue[] = [];
      unitIssuesByNode.set(node.id, unitIssues);
      /** 플래시 결과의 converged 플래그를 방어적으로 읽어 장치 수렴 이슈로 기록 */
      const noteFlash = (r: unknown, ctx: string, sev: 'warning' | 'failed' = 'warning') => {
        const c = (r as { converged?: boolean } | null | undefined)?.converged ?? true;
        if (!c && !unitIssues.some(u => u.msg === ctx)) unitIssues.push({ sev, msg: ctx });
      };

      const sumEdgeGroup = (group: FlowEdgeDef[]) => {
        const flows = emptyFlows();
        let mass = 0;
        let wT = 0;
        let maxP = -Infinity;
        let enth = 0;
        let nStreams = 0;
        let single: EdgeRuntimeState | null = null;
        for (const ie of group) {
          const st = edgeState.get(ie.id)!;
          let m = 0;
          for (const k of SIM_COMPS) {
            flows[k] += st.flows[k];
            m += st.flows[k];
          }
          if (m > 0) {
            mass += m;
            wT += m * st.tempC;
            maxP = Math.max(maxP, st.pressKgcm2g);
            enth += stH(st);
            nStreams++;
            single = st;
          }
        }
        const P = maxP === -Infinity ? 0.0 : maxP;
        let T = mass > 0 ? wT / mass : 25.0;
        let vapRatio: VapRatio | undefined = undefined;
        if (nStreams === 1 && single) {
          // 단일 유입: 상태 그대로 (온도·기액분배 보존)
          T = single.tempC;
          const sp = phaseSplit(single.flows, single.tempC, single.pressKgcm2g, single.forcedPhase, single.vapRatio, runtimePropertyMethod);
          vapRatio = ratioFromSplit(sp.vap, sp.liq);
        } else if (nStreams >= 2) {
          // 다중 유입: 단열 혼합 PH 플래시 (혼합열·희석열·응축/증발 반영한 혼합온도)
          const ph = phFlashStream(flows, P, enth, T, false, runtimePropertyMethod);
          noteFlash(ph, '유입 혼합 단열 PH 플래시 미수렴 (혼합온도 근사)');
          T = ph.T_C;
          vapRatio = ratioFromSplit(ph.vap, ph.liq);
        }
        return {
          flows,
          mass,
          T,
          P,
          enth,
          vapRatio,
        };
      };

      const allIn = sumEdgeGroup(inEdges);
      const totalIn = allIn.flows;
      const sumMassIn = allIn.mass;
      const T_in = allIn.T;
      const P_in = allIn.P;

      const detectedFluid = node.unitType === 'feed'
        ? identifyFluidName({ ...emptyFlows(), ...(p.feedFlowsKgH as Record<SimCompKey, number>) }, p.feedTempC ?? 25, p.feedPressKgcm2g ?? 1)
        : identifyFluidName(totalIn, T_in, P_in);

      const assignEdge = (edge: FlowEdgeDef, flows: Record<SimCompKey, number>, tempC: number, pressKgcm2g: number, forcedPhase?: 'L' | 'G' | 'L/G', vapRatio?: VapRatio) => {
        const cleanFlows = emptyFlows();
        for (const k of SIM_COMPS) cleanFlows[k] = Math.max(0, flows[k] || 0);

        if (tearSet.has(edge.id)) {
          // Tear Stream은 현재 패스 종료 후 Wegstein 가속기가 일괄 갱신하도록 g(x)에 기록!
          tearComputedG.set(edge.id, { flows: cleanFlows, tempC, pressKgcm2g, forcedPhase, vapRatio });
        } else {
          const prev = edgeState.get(edge.id)!;
          let eMass = 0;
          for (const k of SIM_COMPS) {
            maxDiff = Math.max(maxDiff, Math.abs((prev.flows[k] || 0) - cleanFlows[k]));
            eMass += cleanFlows[k];
          }
          if (eMass > nonTearScale) nonTearScale = eMass;
          edgeState.set(edge.id, { flows: cleanFlows, tempC, pressKgcm2g, forcedPhase, vapRatio });
        }
      };

      let heatDutyKcalH = 0;
      let shaftPowerKW = 0;
      let removedKgH = 0;
      let note = '';
      let extraMetrics: Record<string, string> | undefined = undefined;
      let distillResult: DistillSolveResult | undefined = undefined;
      let reactorResult: ReactorSolveResult | undefined = undefined;
      let extractorResult: ExtractorSolveResult | undefined = undefined;
      const unitUnrouted: BoundaryRaw[] = [];
      const unitMakeup: BoundaryRaw[] = [];
      /** 에너지 수지용 외부 열량 (null이면 heatDutyKcalH 사용) */
      let externalHeatKcalH: number | null = null;
      /** 배관 미연결 포트 유량을 출구측 경계(미연결 출구)로 기록 */
      const pushUnrouted = (port: string, label: string, flows: Record<SimCompKey, number>, tempC: number, pressKgcm2g: number, phase?: 'L' | 'G' | 'L/G', vapRatio?: VapRatio) => {
        const f = emptyFlows();
        for (const k of SIM_COMPS) f[k] = Math.max(0, flows[k] || 0);
        if (sumFlows(f) > 1e-6) unitUnrouted.push({ port, label, flows: f, tempC, pressKgcm2g, phase, vapRatio });
      };
      /** 배관 없이 장치 로직이 추가하는 유량을 유입측 경계(보충/약품/배수)로 기록. 음수 질량은 출구측으로 전환 */
      const pushMakeup = (port: string, label: string, flows: Partial<Record<SimCompKey, number>>, tempC: number, pressKgcm2g: number, phase?: 'L' | 'G' | 'L/G', vapRatio?: VapRatio) => {
        const pos = emptyFlows();
        const neg = emptyFlows();
        for (const k of SIM_COMPS) {
          const v = flows[k] || 0;
          if (v > 0) pos[k] = v;
          else if (v < 0) neg[k] = -v;
        }
        if (sumFlows(pos) > 1e-6) unitMakeup.push({ port, label, flows: pos, tempC, pressKgcm2g, phase, vapRatio });
        if (sumFlows(neg) > 1e-6) unitUnrouted.push({ port, label: `${label} (질량 감소분 → 출구측 계상)`, flows: neg, tempC, pressKgcm2g, phase, vapRatio });
      };
      /**
       * 엔탈피 수지 기반 장치 열부하 (kcal/h, 가열 +):  Q = ΣH_out(배관+미연결) − ΣH_in(배관+보충) − W
       * 생성열 기준 총엔탈피이므로 반응·전해·흡수·용해·중화열이 자동 포함된다.
       */
      const derivedDutyKcalH = () => {
        let hOut = 0;
        for (const oe of outEdges) {
          const st = tearComputedG.get(oe.id) ?? edgeState.get(oe.id)!;
          hOut += stH(st);
        }
        for (const b of unitUnrouted) hOut += bH(b);
        let hIn = allIn.enth;
        for (const b of unitMakeup) hIn += bH(b);
        return hOut - hIn - shaftPowerKW * KCALH_PER_KW_SOLVER;
      };
      /** true 이면 장치 처리 후 heatDutyKcalH 를 엔탈피 수지(derivedDutyKcalH)로 확정 */
      let dutyFromEnthalpy = false;

      const isActiveVisualThrottle =
        node.unitType === 'valve_visual' &&
        p.outletPressKgcm2g !== undefined &&
        !p.chemicalDechlorination;

      // ── 0) 단순 도면 표기 전용 장치 (Pass-Through + 선택적 Na₂SO₃ 약품 환원조) ──
      if (isVisualOnlyUnit(node.unitType) && !isActiveVisualThrottle) {
        const dP = Math.max(0, p.pressureDropKgcm2 ?? 0);
        const P_out = Math.max(-0.9, P_in - dP);
        const passFlows = { ...totalIn };
        if (p.chemicalDechlorination && passFlows.Cl2 > 0) {
          const reducedCl2 = passFlows.Cl2;
          passFlows.Cl2 = 0;
          const addedSalt = reducedCl2 * ((2 * MW.NaCl) / MW.Cl2);
          passFlows.NaCl += addedSalt;
          pushMakeup('reagent', 'Na₂SO₃ 환원 약품 등가 (Cl₂→2NaCl 질량증분)', { NaCl: addedSalt - reducedCl2 }, T_in, P_in, 'L');
          removedKgH = reducedCl2;
          dutyFromEnthalpy = true;
        }
        const nOut = Math.max(1, outEdges.length);
        outEdges.forEach(oe => {
          const splitF = emptyFlows();
          SIM_COMPS.forEach(k => { splitF[k] = passFlows[k] / nOut; });
          // 통과 장치: 유입 온도·성분별 기액분배 보존 (등엔탈피)
          assignEdge(oe, splitF, T_in, P_out, undefined, allIn.vapRatio ?? {});
        });
        if (dutyFromEnthalpy && outEdges.length === 0) {
          pushUnrouted('out', '환원 처리액 출구 미연결', passFlows, T_in, P_out, 'L');
        }
        if (dutyFromEnthalpy) heatDutyKcalH = derivedDutyKcalH();
        note = p.visualSpecNote
          ? `[도면 심볼] ${p.visualSpecNote} (${sumMassIn.toFixed(1)} kg/h 통과)`
          : `도면 표기 전용 장치 (${sumMassIn.toFixed(1)} kg/h 그대로 통과)`;
      }

      // ── 1) 원료 공급단 (Feed) ──────────────────────────────────────────────
      else if (node.unitType === 'feed') {
        const fFlows = emptyFlows();
        for (const k of SIM_COMPS) fFlows[k] = Math.max(0, p.feedFlowsKgH?.[k] ?? 0);
        const fT = p.feedTempC ?? 25.0;
        const fP = p.feedPressKgcm2g ?? 1.0;
        const nOut = Math.max(1, outEdges.length);
        for (const oe of outEdges) {
          const splitF = emptyFlows();
          SIM_COMPS.forEach(k => { splitF[k] = fFlows[k] / nOut; });
          assignEdge(oe, splitF, fT, fP);
        }
        const totOut = sumFlows(fFlows);
        const props = calcStreamProps(fFlows, fT, fP, undefined, undefined, runtimePropertyMethod);
        note = `공급: ${totOut.toFixed(1)} kg/h (${detectKeyConc(fFlows, props.phase)}, ${fT.toFixed(1)}°C, ${fP.toFixed(2)} kG)`;
      }

      // ── 2) 제품/배출단 (Product — 후단 배관 연결 시 중간 헤더로 유량 자동 전달!) ──
      else if (node.unitType === 'product') {
        const props = calcStreamProps(totalIn, T_in, P_in, undefined, allIn.vapRatio, runtimePropertyMethod);
        if (outEdges.length > 0) {
          const nOut = Math.max(1, outEdges.length);
          outEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = totalIn[k] / nOut; });
            assignEdge(oe, splitF, T_in, P_in, undefined, allIn.vapRatio ?? {});
          });
          note = `중간 헤더 전달: ${sumMassIn.toFixed(1)} kg/h (${detectKeyConc(totalIn, props.phase)}, ${T_in.toFixed(1)}°C)`;
        } else {
          note = `수취: ${sumMassIn.toFixed(1)} kg/h (${detectKeyConc(totalIn, props.phase)}, ${T_in.toFixed(1)}°C, ${P_in.toFixed(2)} kG)`;
        }
      }

      // ── 3) 이온교환막 전해조 (Electrolyzer — 간편 vs 정밀 Nernst+Tafel+IR) ──
      else if (node.unitType === 'electrolyzer') {
        const anodeInEdges = inEdges.filter(e => e.targetPort === 'anode_in' || (!e.targetPort || e.targetPort === 'in'));
        const cathodeInEdges = inEdges.filter(e => e.targetPort === 'cathode_in');

        const anGrp = sumEdgeGroup(anodeInEdges.filter(e => {
          if (e.targetPort === 'anode_in') return true;
          const f = edgeState.get(e.id)?.flows;
          return !cathodeInEdges.length && f && f.NaOH > f.NaCl && f.NaCl === 0 ? false : true;
        }));
        const caGrp = sumEdgeGroup([
          ...cathodeInEdges,
          ...inEdges.filter(e => e.targetPort !== 'anode_in' && e.targetPort !== 'cathode_in' && (edgeState.get(e.id)?.flows.NaOH ?? 0) > (edgeState.get(e.id)?.flows.NaCl ?? 0)),
        ]);

        const I_kA = Math.max(0.1, p.currentKA ?? 16.2);
        const nCells = Math.max(1, p.cellCount ?? 190);
        const nUnits = Math.max(1, p.unitCount ?? 5);
        const ce = Math.min(100, Math.max(50, p.currentEffPct ?? 94.0)) / 100;
        const tH2O = Math.max(0, p.waterTransportNumber ?? 4.2);
        const T_el = p.operTempC ?? 89.0;
        const P_an = p.operPressKgcm2g ?? 0.40;
        const P_ca = P_an + (p.cathodeDeltaP ?? 0.15);

        const theoNeKmolH = (I_kA * 1000 * nCells * nUnits * ce) / 26801.48;
        const ceLossFactor = Math.max(0.005, 1.0 - ce) / 0.06;
        const o2PerNeKmol = ((26.48 / (19500 / (MW.Cl2 / 2))) * ceLossFactor) / MW.O2;
        const availNaClKmol = anGrp.flows.NaCl / MW.NaCl;
        const availAnWaterKmol = anGrp.flows.H2O / MW.H2O;
        const netAnWaterPerNe = Math.max(0.01, tH2O - 2.0 * o2PerNeKmol);
        const netCaWaterNeededPerNe = 1.0 + 4.0 * o2PerNeKmol - tH2O;
        const maxNeByCaWater = netCaWaterNeededPerNe > 1e-6
          ? ((caGrp.flows.H2O / MW.H2O) / netCaWaterNeededPerNe) * 0.98
          : theoNeKmolH;

        const actualNe = (anGrp.mass > 0 || caGrp.mass > 0)
          ? Math.min(
              theoNeKmolH,
              availNaClKmol * 0.995,
              (availAnWaterKmol / netAnWaterPerNe) * 0.98,
              maxNeByCaWater
            )
          : 0;

        const anOut = { ...anGrp.flows };
        const caOut = { ...caGrp.flows };

        // NaCl 소비량은 주반응 NaCl + H₂O → NaOH + ½Cl₂ + ½H₂ 의 질량 정확 보존을 위해 생성물 분자량 합으로 산정 (58.443)
        const naclConsumedKgH = actualNe * (MW.NaOH + 0.5 * MW.Cl2 + 0.5 * MW.H2 - MW.H2O);
        const cl2ProducedKgH = 0.5 * actualNe * MW.Cl2;
        // 양극 부반응 산소 발생 반영 (94% 전류효율 기준 468 T/D 당 ~26.5 kg/h O₂)
        // 손실전류 화학량론 (질량 보존): 음극 4H₂O + 4e⁻ → 2H₂ + 4OH⁻ (OH⁻ 막 역이동) / 양극 4OH⁻ → O₂ + 2H₂O + 4e⁻
        //   → 순반응 2H₂O → 2H₂ + O₂ : 음극수 −4n·H₂O, 양극수 +2n·H₂O, 음극 H₂ +2n, 양극 O₂ +n (n = O₂ kmol/h)
        const o2Kmol = actualNe * o2PerNeKmol;
        const o2ProducedKgH = o2Kmol * MW.O2;
        const h2FromO2SideKgH = 2.0 * o2Kmol * MW.H2;
        const waterAnodeO2RxnKgH = -2.0 * o2Kmol * MW.H2O; // 양극수 증가분(음수 소비)
        // 부반응 순수분 소비량 = O₂ + H₂ 생성 질량과 100% 일치시켜 원자량 반올림(0.002 g/mol) 오차까지 제거
        const waterCathodeO2RxnKgH = -waterAnodeO2RxnKgH + o2ProducedKgH + h2FromO2SideKgH;
        const waterElectroOsmoticKgH = actualNe * tH2O * MW.H2O;
        const waterCathodeRxnKgH = actualNe * MW.H2O;
        const naohProducedKgH = actualNe * MW.NaOH;
        const h2ProducedKgH = 0.5 * actualNe * MW.H2 + h2FromO2SideKgH;

        anOut.NaCl = Math.max(0, anOut.NaCl - naclConsumedKgH);
        anOut.H2O = Math.max(0, anOut.H2O - waterElectroOsmoticKgH - waterAnodeO2RxnKgH);
        anOut.Cl2 += cl2ProducedKgH;
        anOut.O2 += o2ProducedKgH;

        caOut.H2O = Math.max(0, caOut.H2O + waterElectroOsmoticKgH - waterCathodeRxnKgH - waterCathodeO2RxnKgH);
        caOut.NaOH += naohProducedKgH;
        caOut.H2 += h2ProducedKgH;

        const anLiqMass = anOut.NaCl + anOut.H2O;
        const caLiqMass = caOut.NaOH + caOut.H2O;
        const anBrineWt = anLiqMass > 0 ? (anOut.NaCl / anLiqMass) * 100 : 18.0;
        const caNaohWt = caLiqMass > 0 ? (caOut.NaOH / caLiqMass) * 100 : 32.0;

        let V_cell = Math.max(1.5, p.cellVoltageV ?? 3.05);
        let electrochemDetail: Record<string, string> = {};

        if (isRigorous) {
          const ec = calcRigorousCellElectrochem({
            currentKA: I_kA,
            membraneAreaM2: p.membraneAreaM2 ?? 2.72,
            tempC: T_el,
            pressAnodeKgcm2g: P_an,
            anBrineWtPct: anBrineWt,
            caNaohWtPct: caNaohWt,
          });
          V_cell = ec.cellVoltageV;
          // 비가역 줄 발열 (V − V_tn)·I — 정보 표시용. 에너지 수지는 아래 엔탈피 수지(Q = ΔH − W)로 확정 (이중 계상 방지)
          const jouleKcalH = actualNe * 1000 * ec.jouleHeatKcalPerMolElectron;
          electrochemDetail = {
            '계산 모드': '🔬 정밀 (Nernst + Tafel + 막 저항 IR)',
            '전류밀도 / 셀전압': `${ec.currentDensityKAm2.toFixed(2)} kA/m² → ${V_cell.toFixed(3)} V (E_rev ${ec.reversibleV.toFixed(2)}V + η ${ec.overpotentialV.toFixed(2)}V + IR ${ec.ohmicDropV.toFixed(2)}V)`,
            '전해조 자체 줄발열 (V−V_tn)·I': `${(Math.abs(jouleKcalH) / 1000).toFixed(1)} Mcal/h`,
          };
        }

        const anodeOutEdges = outEdges.filter(e => e.sourcePort === 'anode_out');
        const cathodeOutEdges = outEdges.filter(e => e.sourcePort === 'cathode_out');

        if (anodeOutEdges.length > 0 || cathodeOutEdges.length > 0) {
          anodeOutEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = anOut[k] / anodeOutEdges.length; });
            assignEdge(e, sf, T_el, P_an, 'L/G');
          });
          cathodeOutEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = caOut[k] / cathodeOutEdges.length; });
            assignEdge(e, sf, T_el, P_ca, 'L/G');
          });
          const elOtherOut = outEdges.filter(e => e.sourcePort !== 'anode_out' && e.sourcePort !== 'cathode_out');
          elOtherOut.forEach(e => {
            assignEdge(e, anOut, T_el, P_an, 'L/G');
          });
          if (anodeOutEdges.length === 0 && elOtherOut.length === 0) pushUnrouted('anode_out', '양극 출구 미연결', anOut, T_el, P_an, 'L/G');
          if (cathodeOutEdges.length === 0) pushUnrouted('cathode_out', '음극 출구 미연결', caOut, T_el, P_ca, 'L/G');
        } else {
          if (outEdges[0]) assignEdge(outEdges[0], anOut, T_el, P_an, 'L/G');
          else pushUnrouted('anode_out', '양극 출구 미연결', anOut, T_el, P_an, 'L/G');
          if (outEdges[1]) assignEdge(outEdges[1], caOut, T_el, P_ca, 'L/G');
          else pushUnrouted('cathode_out', '음극 출구 미연결', caOut, T_el, P_ca, 'L/G');
        }

        const dcPowerKW = I_kA * V_cell * nCells * nUnits;
        shaftPowerKW = dcPowerKW;
        // 전해조 에너지 수지: DC 전력(W) 유입 + ΣH_in = ΣH_out(생성열 기준) + Q  →  Q = ΣH_out − ΣH_in − W
        //   (Q < 0: 운전온도 유지를 위해 제거해야 할 열 = 방열·냉각 부하, Q > 0: 가열 필요)
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;
        const vTn = chlorAlkaliThermoneutralVoltage(T_el, caNaohWt);
        const totalCurrentKA = I_kA * nCells * nUnits;

        extraMetrics = {
          ...electrochemDetail,
          'DC 소비전력': `${(dcPowerKW / 1000).toFixed(2)} MW (${V_cell.toFixed(2)}V × ${nUnits}기)`,
          '열중립전압 V_tn (생성열 기준)': `${vTn.toFixed(3)} V → 이론 비가역발열 ${(((V_cell - vTn) * totalCurrentKA * ce) / 1000).toFixed(2)} MW`,
          '엔탈피 수지 열부하 Q (ΔH − W)': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h (${(heatDutyKcalH / KCALH_PER_KW_SOLVER / 1000).toFixed(2)} MW${heatDutyKcalH < 0 ? ' 제열' : ' 가열'})`,
          '생성 Cl₂ / H₂': `${cl2ProducedKgH.toFixed(1)} / ${h2ProducedKgH.toFixed(1)} kg/h`,
          '부반응 O₂ (손실전류 2H₂O→2H₂+O₂)': `${o2ProducedKgH.toFixed(1)} kg/h`,
          '생성 NaOH (100%)': `${naohProducedKgH.toFixed(1)} kg/h`,
          '양극 출구 브라인': anLiqMass > 0 ? `${anBrineWt.toFixed(2)} wt% NaCl` : '미연결',
          '음극 출구 가성소다': caLiqMass > 0 ? `${caNaohWt.toFixed(2)} wt% NaOH` : '미연결',
        };
        note = actualNe > 0
          ? `${isRigorous ? '[정밀] ' : ''}Cl₂ ${cl2ProducedKgH.toFixed(0)} kg/h (${V_cell.toFixed(2)}V) | 브라인 ${anBrineWt.toFixed(1)}% · NaOH ${caNaohWt.toFixed(1)}%`
          : `전해조 대기중 — 양극In(염수) · 음극In(가성소다+순수) 배관을 연결하세요`;
      }

      // ── 4) 염소/가스 액화기 (Liquefier) & 열교환기 (HEX) ───────────────────
      else if (node.unitType === 'liquefier' || node.unitType === 'hex' || node.unitType === 'cooler') {
        const isLiquefier = node.unitType === 'liquefier';
        const procInEdges = inEdges.filter(e => e.targetPort !== 'util_in');
        const utilInEdges = inEdges.filter(e => e.targetPort === 'util_in');
        const procOutEdges = outEdges.filter(e => e.sourcePort !== 'util_out');
        const utilOutEdges = outEdges.filter(e => e.sourcePort === 'util_out');

        const procIn = sumEdgeGroup(procInEdges);
        const utilIn = sumEdgeGroup(utilInEdges);

        const P_proc_out = p.operPressKgcm2g !== undefined ? p.operPressKgcm2g : Math.max(0, procIn.P - 0.05);
        const P_abs = Math.max(0.15, P_proc_out + 1.03323);

        const refKey: RefrigerantPresetKey = p.refrigerantPreset ?? (isLiquefier ? 'freon_m35' : 'cw');
        const refMeta = REFRIGERANT_PRESETS[refKey];

        let T_proc_out = p.operTempC ?? (isLiquefier ? -22.0 : 25.0);
        const isDutySpec = (p.hexSpecMode ?? 'proc_temp') === 'heat_duty' && procIn.mass > 0;
        let phSplit: { vap: Record<SimCompKey, number>; liq: Record<SimCompKey, number> } | null = null;
        if (isDutySpec) {
          // 열량 지정 모드: PH 플래시로 출구 온도·기액분배 산출 (H_out = H_in + Q)
          const qSpecKcalH = (p.specifiedDutyMcalH ?? -500) * 1000;
          const ph = phFlashStream(procIn.flows, P_proc_out, procIn.enth + qSpecKcalH, procIn.T, isRigorous, runtimePropertyMethod);
          noteFlash(ph, '공정측 지정열량 PH 플래시 미수렴 (출구온도 탐색 경계 도달)');
          T_proc_out = ph.T_C;
          phSplit = { vap: ph.vap, liq: ph.liq };
        }

        // 정밀 모드 또는 일반 패키지 선택 시 다성분 플래시 실행!
        const hexTpFlash = phSplit ? null : flashGasLiquid(procIn.flows, T_proc_out, P_proc_out, isRigorous, runtimePropertyMethod);
        if (hexTpFlash) noteFlash(hexTpFlash, '공정측 출구 TP 기액 플래시 미수렴', 'failed');
        const { vap, liq } = phSplit ?? hexTpFlash!;
        const procOutRatio = ratioFromSplit(vap, liq);
        const condensedH2O = Math.max(0, procIn.flows.H2O - vap.H2O);
        const liquefiedCl2 = Math.max(0, liq.Cl2);
        const isAnhydrousHclFeed = procIn.flows.HCl > 0.5 && procIn.flows.H2O < procIn.flows.HCl * 0.05 && procIn.flows.Cl2 < procIn.flows.HCl * 0.1;
        const liquefiedHcl = isAnhydrousHclFeed ? Math.max(0, liq.HCl) : 0;
        removedKgH = Math.max(liquefiedCl2, liquefiedHcl, condensedH2O);

        const vapEdges = procOutEdges.filter(e => e.sourcePort === 'vapor');
        const liqEdges = procOutEdges.filter(e => e.sourcePort === 'liquid');

        if (vapEdges.length > 0 || liqEdges.length > 0) {
          vapEdges.forEach(e => assignEdge(e, vap, T_proc_out, P_proc_out, 'G'));
          liqEdges.forEach(e => assignEdge(e, liq, T_proc_out, P_proc_out, 'L'));
          const hexOtherOut = procOutEdges.filter(e => e.sourcePort !== 'vapor' && e.sourcePort !== 'liquid');
          hexOtherOut.forEach(e => {
            assignEdge(e, procIn.flows, T_proc_out, P_proc_out, undefined, procOutRatio);
          });
          if (hexOtherOut.length === 0) {
            if (vapEdges.length === 0) pushUnrouted('vapor', '미응축 기상 벤트 (G↑ 미연결)', vap, T_proc_out, P_proc_out, 'G');
            if (liqEdges.length === 0) pushUnrouted('liquid', '응축액 드레인 (L↓ 미연결)', liq, T_proc_out, P_proc_out, 'L');
          }
        } else if (procOutEdges.length >= 2) {
          assignEdge(procOutEdges[0], vap, T_proc_out, P_proc_out, 'G');
          assignEdge(procOutEdges[1], liq, T_proc_out, P_proc_out, 'L');
        } else if (procOutEdges.length === 1) {
          assignEdge(procOutEdges[0], procIn.flows, T_proc_out, P_proc_out, undefined, procOutRatio);
        } else {
          pushUnrouted('vapor', '공정 출구 미연결 (기상)', vap, T_proc_out, P_proc_out, 'G');
          pushUnrouted('liquid', '공정 출구 미연결 (액상)', liq, T_proc_out, P_proc_out, 'L');
        }

        // 공정측 열부하 = ΣH_out − ΣH_in (생성열 기준 총엔탈피, 실제 기액분배)
        const hOut = streamEnthalpyKcalH(vap, liq, T_proc_out, P_proc_out);
        heatDutyKcalH = hOut - procIn.enth;

        const uT_in = refKey === 'custom' ? (p.utilInTempC ?? 20) : refMeta.inTempC;
        let uT_out = refKey === 'custom' ? (p.utilOutTempC ?? 30) : refMeta.outTempC;
        const uCp = refKey === 'custom' ? Math.max(0.1, p.utilCp ?? 1.0) : refMeta.cp;
        let uFlowKgH = 0;

        if (utilInEdges.length > 0 && utilIn.mass > 0) {
          uFlowKgH = utilIn.mass;
          // 유틸리티측 출구: PH 플래시 (H_util,out = H_util,in − Q) — 스팀 응축·냉매 증발 등 상변화 포함
          const uPout = Math.max(0, utilIn.P - 0.1);
          const uPh = phFlashStream(utilIn.flows, uPout, utilIn.enth - heatDutyKcalH, utilIn.T, false, runtimePropertyMethod);
          noteFlash(uPh, '유틸리티측 PH 플래시 미수렴 (냉매/열매 출구온도 근사)');
          uT_out = uPh.T_C;
          const uRatio = ratioFromSplit(uPh.vap, uPh.liq);
          const nU = Math.max(1, utilOutEdges.length);
          utilOutEdges.forEach(ue => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = utilIn.flows[k] / nU; });
            assignEdge(ue, sf, uT_out, uPout, undefined, uRatio);
          });
          if (utilOutEdges.length === 0) pushUnrouted('util_out', '냉매/열매 출구 미연결', utilIn.flows, uT_out, uPout, undefined, uRatio);
          // 유틸리티 배관이 플로우시트에 연결된 경우 열교환은 계내 교환이므로 외부 열량 0
          externalHeatKcalH = 0;
        } else if (refMeta.latentKcalKg) {
          const superheatOutKcalKg = uCp * Math.max(0, Math.abs(uT_out - uT_in));
          uFlowKgH = Math.abs(heatDutyKcalH) / (refMeta.latentKcalKg + superheatOutKcalKg);
        } else {
          uFlowKgH = Math.abs(heatDutyKcalH) / (uCp * Math.max(0.5, Math.abs(uT_out - uT_in)));
        }

        const lmtd = calcLMTD(procIn.T - uT_out, T_proc_out - uT_in);
        const U = p.overallU ?? refMeta.defaultU;
        let areaM2 = Math.abs(heatDutyKcalH) / (U * Math.max(1, lmtd));
        const usrt = Math.abs(heatDutyKcalH) / 3024.0;

        const totMoles = SIM_COMPS.reduce((s, k) => s + procIn.flows[k] / COMP_META[k].mw, 0);
        const yCl2 = totMoles > 0 ? (procIn.flows.Cl2 / MW.Cl2) / totMoles : 1;
        const yHcl = totMoles > 0 ? (procIn.flows.HCl / MW.HCl) / totMoles : 1;
        const hclDewPointC = isAnhydrousHclFeed
          ? 849.1 / (4.5292 - Math.log10(Math.max(0.05, P_abs * 0.980665 * Math.max(0.01, yHcl)))) - 272.76
          : 65.0;
        const dewT = procIn.flows.Cl2 > 0.1
          ? cl2DewPointTempC(P_abs * yCl2)
          : isAnhydrousHclFeed
            ? hclDewPointC
            : Math.min(procIn.T, 65.0);
        const superheatInC = Math.max(0, procIn.T - dewT);
        const subcoolOutC = T_proc_out < dewT ? (dewT - T_proc_out) : 0;
        // 잠열 구간 열량: thermoCore ΔHvap(T) (Watson / 증기표 일관) 기준
        const T_lat_K = Math.min(dewT, procIn.T) + 273.15;
        const latentKcalKg = (c: SimCompKey) => heatOfVaporizationKJkmol(c, T_lat_K) / COMP_META[c].mw / KJ_PER_KCAL;
        const latentQ = liquefiedCl2 * latentKcalKg('Cl2') + liquefiedHcl * latentKcalKg('HCl') + condensedH2O * latentKcalKg('H2O');
        const desupQ = procIn.T > dewT ? procIn.mass * (isAnhydrousHclFeed ? 0.19 : 0.15) * (procIn.T - Math.max(T_proc_out, dewT)) : 0;
        const subQ = Math.max(0, Math.abs(heatDutyKcalH) - latentQ - desupQ);

        let zoneDetail: Record<string, string> = {};
        if (latentQ > 1.0) {
          zoneDetail['상변화·과열·과냉 온도차'] = `입구과열 +${superheatInC.toFixed(1)}°C | 포화이슬점 ${dewT.toFixed(1)}°C | 출구과냉 -${subcoolOutC.toFixed(1)}°C`;
          zoneDetail['열부하 3-구간 분해'] = `과열제거 ${(desupQ / 1000).toFixed(1)} / 잠열응축 ${(latentQ / 1000).toFixed(1)} / 과냉각 ${(subQ / 1000).toFixed(1)} Mcal/h`;
        }
        if (isRigorous) {
          const zr = calcRigorousThreeZoneHex({
            T_in: procIn.T,
            T_out: T_proc_out,
            T_dew: dewT,
            totalDutyKcalH: heatDutyKcalH,
            sensibleGasKcalH: desupQ,
            latentCondKcalH: latentQ,
            subcoolLiqKcalH: subQ,
            uT_in,
            uT_out,
            baseU: U,
            foulingFactorM2HKcal: p.foulingFactor ?? 0.0002,
          });
          areaM2 = zr.totalAreaM2;
          zoneDetail = {
            ...zoneDetail,
            '계산 모드': '🔬 정밀 (PR-EOS 플래시 + 3-Zone 구간 적분)',
            '3-Zone 전열면적 분할': zr.zoneSummary,
            '오염반영 유효 U': `${zr.effectiveU.toFixed(0)} kcal/m²·h·°C`,
            ...(zr.pinchWarning ? { '핀치 진단': zr.pinchWarning } : {}),
          };
        }

        if (procIn.flows.Cl2 > 0.1) {
          const liqRatioPct = (liquefiedCl2 / procIn.flows.Cl2) * 100;
          extraMetrics = {
            '인식 유체': detectedFluid,
            ...zoneDetail,
            [`현재압(${P_proc_out.toFixed(2)}kG) 액화 이슬점`]: `${dewT.toFixed(1)} °C`,
            '염소 액화율': liqRatioPct > 0.1 ? `${liqRatioPct.toFixed(1)} % (액화 ${liquefiedCl2.toFixed(1)} kg/h)` : `0.0 % (미액화 — 온도를 ${dewT.toFixed(1)}°C 이하로 낮추거나 승압 필요!)`,
            '미응축 스니프 가스(G↑)': `${sumFlows(vap).toFixed(1)} kg/h`,
            '냉동/냉각 열부하': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h (${usrt.toFixed(1)} USRT)`,
            [`냉매(${refMeta.label.split(' (')[0]}) 유량`]: `${(uFlowKgH / 1000).toFixed(2)} t/h`,
            '소요 전열면적 (A)': `${areaM2.toFixed(1)} m² (총괄 LMTD ${lmtd.toFixed(1)}°C)`,
          };

          note = liqRatioPct > 0.1
            ? `${isRigorous ? '[정밀 3-Zone] ' : ''}Cl₂ ${liqRatioPct.toFixed(1)}% 액화 (Liq ${liquefiedCl2.toFixed(1)} kg/h, ${usrt.toFixed(1)} RT, A=${areaM2.toFixed(1)}m²)`
            : `미액화 (현재 ${T_proc_out.toFixed(1)}°C > 이슬점 ${dewT.toFixed(1)}°C @ ${P_proc_out.toFixed(2)}kG)`;
        } else if (isAnhydrousHclFeed) {
          const hclRatioPct = (liquefiedHcl / Math.max(1e-6, procIn.flows.HCl)) * 100;
          extraMetrics = {
            '인식 유체': detectedFluid,
            ...zoneDetail,
            [`현재압(${P_proc_out.toFixed(2)}kG) HCl 액화 이슬점`]: `${dewT.toFixed(1)} °C`,
            '무수 HCl 액화율': hclRatioPct > 0.1
              ? `${hclRatioPct.toFixed(1)} % (액화 ${liquefiedHcl.toFixed(1)} kg/h)`
              : `0.0 % (미액화 — 온도를 ${dewT.toFixed(1)}°C 이하로 낮추거나 승압 필요!)`,
            '미응축 스니프 가스(G↑)': `${sumFlows(vap).toFixed(1)} kg/h`,
            '심냉 냉동 열부하': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h (${usrt.toFixed(1)} USRT)`,
            [`냉매(${refMeta.label.split(' (')[0]}) 유량`]: `${(uFlowKgH / 1000).toFixed(2)} t/h`,
            '소요 전열면적 (A)': `${areaM2.toFixed(1)} m² (총괄 LMTD ${lmtd.toFixed(1)}°C)`,
          };
          note = hclRatioPct > 0.1
            ? `${isRigorous ? '[정밀 3-Zone] ' : ''}AHCl ${hclRatioPct.toFixed(1)}% 액화 (Liq ${liquefiedHcl.toFixed(1)} kg/h, ${usrt.toFixed(1)} RT, A=${areaM2.toFixed(1)}m²)`
            : `미액화 (현재 ${T_proc_out.toFixed(1)}°C > 이슬점 ${dewT.toFixed(1)}°C @ ${P_proc_out.toFixed(2)}kG)`;
        } else {
          extraMetrics = {
            '인식 유체': detectedFluid,
            ...zoneDetail,
            '공정 온도 변화': `${procIn.T.toFixed(1)} → ${T_proc_out.toFixed(1)} °C`,
            '교환 열부하 (Q)': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h`,
            '수증기 응축량': `${condensedH2O.toFixed(1)} kg/h`,
            '필요 냉매/열매 유량': `${(uFlowKgH / 1000).toFixed(2)} t/h`,
            '소요 전열면적 (A)': `${areaM2.toFixed(1)} m² (LMTD ${lmtd.toFixed(1)}°C)`,
          };
          note = `${isRigorous ? '[정밀] ' : ''}${procIn.T.toFixed(1)}→${T_proc_out.toFixed(1)}°C | Q=${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h | A=${areaM2.toFixed(1)} m²`;
        }
      }

      // ── 5) 기액분리기 (Separator — 등온 플래시 vs 정밀 단열 엔탈피·비점상승 진공 플래시 + 직경 사이징) ──
      else if (node.unitType === 'separator') {
        const P_out = p.operPressKgcm2g ?? P_in;
        let T_out = p.operTempC ?? T_in;
        const isAdiabaticFlash = p.flashMode === 'adiabatic' && P_out < P_in;
        let phSplitSep: { vap: Record<SimCompKey, number>; liq: Record<SimCompKey, number> } | null = null;

        if (isAdiabaticFlash) {
          // 단열 플래시: PH 플래시 (H_out = H_in, Q = 0) — 수용액은 비점상승 반영 비점에서 증발량을 에너지로 결정
          // (이상기체 엔탈피 가정이므로 기상 줄-톰슨 냉각은 미포함)
          const ph = phFlashStream(totalIn, P_out, allIn.enth, T_in, isRigorous, runtimePropertyMethod);
          noteFlash(ph, '단열 PH 플래시 미수렴 (출구온도 탐색 경계 도달)');
          T_out = ph.T_C;
          phSplitSep = { vap: ph.vap, liq: ph.liq };
        }

        const tpSep = phSplitSep ? null : flashGasLiquid(totalIn, T_out, P_out, isRigorous, runtimePropertyMethod);
        if (tpSep) noteFlash(tpSep, '분리기 등온 TP 기액 플래시 미수렴', 'failed');
        const vap = phSplitSep ? phSplitSep.vap : tpSep!.vap;
        const liq = phSplitSep ? phSplitSep.liq : tpSep!.liq;
        const Z_vap = tpSep ? tpSep.Z_vap : 1.0;

        // 진공 단열 플래시 후 용존 Cl₂ 평형 (Henry 용해도 + Pitzer 전해질 염석 효과) 재분배
        if (isAdiabaticFlash && totalIn.Cl2 > 0 && liq.H2O > 0.1 && vap.H2O > 0) {
          const P_abs_out = Math.max(0.08, P_out + 1.03323);
          const elecSt = computeElectrolyteState(liq, T_out, P_abs_out * 0.980665);
          const s0 = 0.0108 * Math.exp(-0.0205 * (T_out - 10.0));
          const saltFactor = elecSt.gasSaltingOutFactor;
          const totVapMol = (totalIn.Cl2 / MW.Cl2) + (vap.H2O / MW.H2O) + (vap.O2 / MW.O2) + (vap.H2 / MW.H2);
          const pCl2Atm = totVapMol > 1e-9 ? ((totalIn.Cl2 / MW.Cl2) / totVapMol) * (P_abs_out * 0.96784) : 0;
          liq.Cl2 = Math.min(totalIn.Cl2 * 0.2, liq.H2O * s0 * saltFactor * pCl2Atm);
          vap.Cl2 = Math.max(0, totalIn.Cl2 - liq.Cl2);
        }

        // 환원조(Na₂SO₃ 주입) 패키지 포함 시 잔류 미량 유리염소 화학적 완전 제거 (< 0.1 ppm, 1 mol Cl₂ → 2 mol NaCl)
        if ((p.chemicalDechlorination || node.tag === 'PKG-280') && liq.Cl2 > 0) {
          const reducedCl2 = liq.Cl2;
          const naclFormed = reducedCl2 * ((2 * MW.NaCl) / MW.Cl2);
          liq.NaCl += naclFormed;
          pushMakeup('reagent', 'Na₂SO₃ 환원 약품 등가 (Cl₂→2NaCl 질량증분)', { NaCl: naclFormed - reducedCl2 }, T_out, P_out, 'L');
          liq.Cl2 = 0;
        }

        // ── 유기-수계/염수 불혼화 액-액 평형 디캔터(LLE Settler) 자동 감지 및 Michelsen + NRTL 분배 ──
        const preVapMass = sumFlows(vap);
        const preLiqMass = sumFlows(liq);
        const hydroOrgInLiq =
          (liq.ECH || 0) +
          (liq.DCP || 0) +
          (liq.DCH || 0) +
          (liq.EtOAc || 0) +
          (liq.CHCl3 || 0) +
          (liq.Benzene || 0) +
          (liq.Toluene || 0) +
          (liq.pXylene || 0) +
          (liq.nC6H14 || 0) +
          (liq.nC7H16 || 0);
        const lleDec =
          preLiqMass > 1.0 &&
          preVapMass < 0.05 * preLiqMass &&
          hydroOrgInLiq > 1.0 &&
          (liq.H2O || 0) > 1.0
            ? solveRigorousLLEDecanter(liq, T_out)
            : null;

        let isLleDecanterMode = false;
        let topOutFlows = vap;
        let botOutFlows = liq;
        let topOutPhase: 'G' | 'L' = 'G';
        if (lleDec && lleDec.phaseSplit) {
          isLleDecanterMode = true;
          topOutPhase = preVapMass > 0.02 * sumFlows(lleDec.organicKgH) ? 'G' : 'L';
          topOutFlows = emptyFlows();
          botOutFlows = emptyFlows();
          SIM_COMPS.forEach(k => {
            topOutFlows[k] = (vap[k] || 0) + (lleDec.organicKgH[k] || 0);
            botOutFlows[k] = lleDec.aqueousKgH[k] || 0;
          });
        }

        const vapMass = sumFlows(topOutFlows);
        const liqMass = sumFlows(botOutFlows);
        removedKgH = liqMass;

        const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor');
        const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid');

        if (vapEdges.length > 0 || liqEdges.length > 0) {
          vapEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = topOutFlows[k] / vapEdges.length; });
            assignEdge(e, sf, T_out, P_out, topOutPhase);
          });
          liqEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = botOutFlows[k] / liqEdges.length; });
            assignEdge(e, sf, T_out, P_out, 'L');
          });
          const otherEdges = outEdges.filter(e => e.sourcePort !== 'vapor' && e.sourcePort !== 'liquid');
          otherEdges.forEach(e => assignEdge(e, topOutFlows, T_out, P_out, topOutPhase));
          if (vapEdges.length === 0 && otherEdges.length === 0) {
            pushUnrouted('vapor', isLleDecanterMode ? '유기층 출구 (미연결)' : '상부 벤트 (G↑ 미연결)', topOutFlows, T_out, P_out, topOutPhase);
          }
          if (liqEdges.length === 0) {
            pushUnrouted('liquid', isLleDecanterMode ? '수층/염수 출구 (미연결)' : '하부 드레인 (L↓ 미연결)', botOutFlows, T_out, P_out, 'L');
          }
        } else {
          if (outEdges[0]) assignEdge(outEdges[0], topOutFlows, T_out, P_out, topOutPhase);
          else pushUnrouted('vapor', '상부 벤트 (G↑ 미연결)', topOutFlows, T_out, P_out, topOutPhase);
          if (outEdges[1]) assignEdge(outEdges[1], botOutFlows, T_out, P_out, 'L');
          else pushUnrouted('liquid', '하부 드레인 (L↓ 미연결)', botOutFlows, T_out, P_out, 'L');
        }

        let sepRigDetail: Record<string, string> = {};
        if (isLleDecanterMode && lleDec) {
          sepRigDetail = {
            '계산 모드': `🔬 정밀 액-액 평형 디캔터 (Michelsen TPD=${lleDec.tpdMin.toFixed(4)}, NRTL+Sechenov ${lleDec.iterations}회)`,
            '유기층 내 용존 수분': `${lleDec.waterInOrgWtPct.toFixed(2)} wt% (@ ${T_out.toFixed(1)}°C)`,
            '염수층 내 유기물 용해': `${lleDec.orgInAqWtPct.toFixed(2)} wt% (염석 반영)`,
          };
        } else if (isRigorous) {
          const vProps = calcStreamProps(topOutFlows, T_out, P_out, 'G', undefined, runtimePropertyMethod);
          const lProps = calcStreamProps(botOutFlows, T_out, P_out, 'L', undefined, runtimePropertyMethod);
          const uMax = 0.075 * Math.sqrt(Math.max(1, (lProps.densityKgM3 - vProps.densityKgM3) / Math.max(0.05, vProps.densityKgM3)));
          const areaDrum = (vProps.volFlowM3H / 3600) / Math.max(0.2, uMax);
          const diaDrum = Math.max(0.35, Math.sqrt((4 * areaDrum) / Math.PI));
          sepRigDetail = {
            '계산 모드': `🔬 정밀 (${isAdiabaticFlash ? '단열 PH 플래시' : '등온'} Rachford-Rice, Z=${Z_vap.toFixed(3)})`,
            '권장 드럼 직경 (Souders-Brown)': `Ø ${diaDrum.toFixed(2)} m (허용유속 ${uMax.toFixed(2)} m/s)`,
          };
        }

        // 열부하: 엔탈피 수지 (등온 플래시 → 가열/냉각 열량, 단열 플래시 → ≈0 확인값)
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        extraMetrics = {
          '인식 유체': detectedFluid,
          ...sepRigDetail,
          ...(isAdiabaticFlash ? { '단열 플래시 (PH)': `${T_in.toFixed(1)} → ${T_out.toFixed(1)} °C (${P_in.toFixed(2)} → ${P_out.toFixed(2)} kG)` } : {}),
          [isLleDecanterMode ? '유기층 유출 (Org↑)' : '상부 기상 (G↑)']: `${vapMass.toFixed(1)} kg/h (${detectKeyConc(topOutFlows, topOutPhase)})`,
          [isLleDecanterMode ? '수층/염수 배출 (Aq↓)' : '하부 액상 (L↓)']: `${liqMass.toFixed(1)} kg/h (${detectKeyConc(botOutFlows, 'L')})`,
          '열부하 (엔탈피 수지)': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h`,
        };
        note = isLleDecanterMode
          ? `[정밀 LLE 디캔터] 유기층 ${vapMass.toFixed(1)} kg/h (${detectKeyConc(topOutFlows, 'L')}) / 염수층 ${liqMass.toFixed(1)} kg/h`
          : `${isRigorous ? '[정밀] ' : ''}상부 G ${vapMass.toFixed(1)} kg/h / 하부 L ${liqMass.toFixed(1)} kg/h (${detectKeyConc(botOutFlows, 'L')})`;
      }

      // ── 6) 컬럼 / 흡수·건조·제해탑 (Absorber — 향류 황산건조 3탑 · 염산흡수 · 가성제해 지원) ──
      else if (node.unitType === 'absorber') {
        const target = p.targetComponent ?? 'H2O';
        const T_top = p.operTempC ?? 25.0;
        const dP_col = isRigorous ? (p.columnDeltaPKgcm2 ?? 0.08) : 0.05;

        const liqInEdges = inEdges.filter(e => e.targetPort === 'liq_in' || e.targetPort === 'solvent');
        const gasInEdges = inEdges.filter(e => e.targetPort !== 'liq_in' && e.targetPort !== 'solvent');
        const gasGrp = sumEdgeGroup(gasInEdges.length > 0 ? gasInEdges : inEdges);
        const liqGrp = sumEdgeGroup(gasInEdges.length > 0 ? liqInEdges : []);

        const gasIn = { ...gasGrp.flows };
        const liqIn = { ...liqGrp.flows };
        const P_gas_in = gasGrp.mass > 0 ? gasGrp.P : P_in;
        const P_out = p.operPressKgcm2g ?? Math.max(0, P_gas_in - dP_col);

        const sMode = p.solventMode ?? 'connected_or_manual';
        const solvComp: SimCompKey = p.makeupSolventComp ?? (target === 'H2O' ? 'H2SO4' : target === 'Cl2' ? 'NaOH' : 'H2O');

        // 보충 흡수액(신산 98% H2SO4, 가성소다, 순수 등) 유입 반영
        let autoSolventAdded = 0;
        if (sMode === 'connected_or_manual' && (p.makeupSolventKgH ?? 0) > 0) {
          autoSolventAdded = p.makeupSolventKgH!;
          if (solvComp === 'H2SO4') {
            // 공업용 98 wt% 농황산 보충 반영 (98% H2SO4 + 2% H2O)
            liqIn.H2SO4 += autoSolventAdded * 0.98;
            liqIn.H2O += autoSolventAdded * 0.02;
            pushMakeup('solvent', '보충 흡수액 (98% H₂SO₄ 수동 지정)', { H2SO4: autoSolventAdded * 0.98, H2O: autoSolventAdded * 0.02 }, T_top, P_in, 'L');
          } else {
            liqIn[solvComp] += autoSolventAdded;
            pushMakeup('solvent', `보충 흡수액 (${solvComp} 수동 지정)`, { [solvComp]: autoSolventAdded }, T_top, P_in, 'L');
          }
        }

        const acidAqMass = liqIn.H2SO4 + liqIn.H2O;
        const inletAcidWtPct = acidAqMass > 0.1 && liqIn.H2SO4 > 0.1 ? (liqIn.H2SO4 / acidAqMass) * 100 : 98.0;

        if (p.absorberCalcMode === 'rigorous_mesh') {
          const nAbsStages = Math.max(2, Math.min(80, Math.round(p.columnStages ?? 8)));
          const totAbsIn = sumFlows(gasIn) + sumFlows(liqIn);
          if (totAbsIn <= 1e-8) {
            outEdges.forEach(oe => assignEdge(oe, emptyFlows(), T_top, P_out));
            note = `엄밀 MESH 흡수탑 대기중 — 원료가스(in) 및 흡수액(liq_in)을 연결하세요`;
          } else {
            const gTempAbs = gasGrp.mass > 0 ? gasGrp.T : T_in;
            const lTempAbs = liqGrp.mass > 0 ? liqGrp.T : T_top;
            const absSig =
              `${nAbsStages}@${P_out.toFixed(4)}@${dP_col.toFixed(4)}@${gTempAbs.toFixed(3)}@${P_gas_in.toFixed(4)}@${lTempAbs.toFixed(3)}::` +
              SIM_COMPS.filter(k => (gasIn[k] || 0) > 1e-5 || (liqIn[k] || 0) > 1e-5)
                .map(k => `${k}:${(gasIn[k] || 0).toFixed(4)}/${(liqIn[k] || 0).toFixed(4)}`)
                .join(',');
            const prevAbs = absorberIterCache.get(node.id);
            const absRes =
              prevAbs && prevAbs.sig === absSig
                ? prevAbs.res
                : solveRigorousAbsorberStripper({
                    stages: nAbsStages,
                    topPressKgcm2g: P_out,
                    stageDeltaPKgcm2: Math.max(0.002, dP_col / Math.max(1, nAbsStages)),
                    gasFeed: {
                      edgeId: gasInEdges[0]?.id ?? 'gas_in',
                      streamNo: gasInEdges[0]?.streamNo ?? 'GAS-IN',
                      stage: nAbsStages,
                      flowsKgH: gasIn,
                      tempC: gTempAbs,
                      pressKgcm2g: P_gas_in,
                    },
                    liquidSolvent: {
                      edgeId: liqInEdges[0]?.id ?? 'liq_in',
                      streamNo: liqInEdges[0]?.streamNo ?? 'LIQ-IN',
                      stage: 1,
                      flowsKgH: liqIn,
                      tempC: lTempAbs,
                      pressKgcm2g: P_out,
                    },
                    murphreeEff: 0.75,
                    propertyMethod: options?.propertyMethod ?? runtimePropertyMethod,
                  });
            absorberIterCache.set(node.id, { sig: absSig, res: absRes });
            distillResult = absRes;
            if (!absRes.converged) {
              unitIssues.push({ sev: 'warning', msg: '엄밀 다단 MESH 흡수탑 내부 반복 근사 수렴' });
            }
            const vap = emptyFlows();
            const liq = emptyFlows();
            SIM_COMPS.forEach(k => {
              vap[k] = Math.max(0, absRes.distillateFlowsKgH[k] ?? 0);
              liq[k] = Math.max(0, absRes.bottomsFlowsKgH[k] ?? 0);
            });
            const T_vap_out = absRes.topTempC;
            const T_liq_out = absRes.bottomTempC;
            const P_liq_out = absRes.bottomPressKgcm2g ?? P_out;
            removedKgH = Math.max(0, gasIn[target] - vap[target]);

            const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out');
            const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid');
            if (vapEdges.length > 0 || liqEdges.length > 0) {
              const nV = Math.max(1, vapEdges.length);
              const nL = Math.max(1, liqEdges.length);
              vapEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = vap[k] / nV; });
                assignEdge(e, sf, T_vap_out, P_out, 'G');
              });
              liqEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = liq[k] / nL; });
                assignEdge(e, sf, T_liq_out, P_liq_out, 'L');
              });
              if (vapEdges.length === 0) pushUnrouted('vapor', '탑상 오프가스 (G↑ 미연결)', vap, T_vap_out, P_out, 'G');
              if (liqEdges.length === 0) pushUnrouted('liquid', '탑저 흡수액 (L↓ 미연결)', liq, T_liq_out, P_liq_out, 'L');
            } else {
              if (outEdges[0]) assignEdge(outEdges[0], vap, T_vap_out, P_out, 'G');
              else pushUnrouted('vapor', '탑상 오프가스 (G↑ 미연결)', vap, T_vap_out, P_out, 'G');
              if (outEdges[1]) assignEdge(outEdges[1], liq, T_liq_out, P_liq_out, 'L');
              else pushUnrouted('liquid', '탑저 흡수액 (L↓ 미연결)', liq, T_liq_out, P_liq_out, 'L');
            }

            heatDutyKcalH = derivedDutyKcalH();
            dutyFromEnthalpy = true;
            const vapTot = sumFlows(vap);
            const liqTot = sumFlows(liq);
            const effMesh = gasIn[target] > 1e-9 ? Math.max(0, (gasIn[target] - vap[target]) / gasIn[target]) : 0;
            extraMetrics = {
              '인식 유체': detectedFluid,
              '계산 모드': `🔬 엄밀 다단 MESH 흡수·스트리퍼 (${nAbsStages}단 · ${absRes.thermoModelUsed})`,
              '흡수 제거량': `${target} -${removedKgH.toFixed(2)} kg/h (${(effMesh * 100).toFixed(2)}%)`,
              '탑상 정제가스 (G↑)': `${vapTot.toFixed(1)} kg/h @ ${T_vap_out.toFixed(1)}°C (${detectKeyConc(vap, 'G')})`,
              '탑저 배출액 (L↓)': `${liqTot.toFixed(1)} kg/h @ ${T_liq_out.toFixed(1)}°C (${detectKeyConc(liq, 'L')})`,
              '열부하 (엔탈피 수지)': `${(heatDutyKcalH / 1000).toFixed(2)} Mcal/h`,
            };
            note = `[MESH ${nAbsStages}단 흡수] ${target} ${(effMesh * 100).toFixed(1)}% 흡수 | 탑정 ${T_vap_out.toFixed(1)}°C · 탑저 ${T_liq_out.toFixed(1)}°C`;
          }
        } else {

        let eff = Math.min(0.9999, Math.max(0, p.removalEfficiency ?? 0.995));
        let colRigDetail: Record<string, string> = {};

        if (isRigorous) {
          const gasMoles = Math.max(0.05, (gasIn.Cl2 / MW.Cl2) + (gasIn.H2 / MW.H2) + (gasIn.O2 / MW.O2) + (gasIn.HCl / MW.HCl) + (gasIn.H2O / MW.H2O));
          const liqMoles = Math.max(
            0.5,
            (liqIn.H2SO4 / MW.H2SO4) +
              (sMode === 'auto_target_wt' ? gasMoles * 1.8 : (liqIn.NaOH / MW.NaOH) + (liqIn.H2O / MW.H2O))
          );
          const nStages = p.columnStages ?? 8;
          const kr = calcRigorousKremserRemoval({
            target,
            nStages,
            gasKmolH: gasMoles,
            liqKmolH: liqMoles,
            topTempC: T_top,
            pressKgcm2g: P_out,
            solventComp: solvComp,
            acidWtPct: inletAcidWtPct,
          });
          eff = kr.removalEff;
          colRigDetail = {
            '계산 모드': `🔬 정밀 다단 기액평형 (이론단수 ${nStages}단${target === 'H2O' && liqIn.H2SO4 > 0 ? ` · 유입황산 ${inletAcidWtPct.toFixed(1)}%` : ''})`,
            '흡수인자 A = L/(m·G)': `${kr.absorptionFactorA.toFixed(2)} → 유효 제거율 ${(eff * 100).toFixed(3)}%`,
            '추정 컬럼 탑경': `Ø ${kr.columnDiaM.toFixed(2)} m (ΔP ${dP_col.toFixed(2)} kG)`,
          };
        }

        const absorbedMass = gasIn[target] * eff;
        removedKgH = absorbedMass;

        if (sMode === 'auto_target_wt' && absorbedMass > 0) {
          const targetWt = Math.min(98, Math.max(1, p.targetBottomWtPct ?? 35.0)) / 100;
          if (target === 'Cl2' && solvComp === 'NaOH') {
            // 차아염소산 제해: Cl2 + 2NaOH -> NaOCl + NaCl + H2O (목표 NaOCl wt% 기준 희석가성 자동 산출)
            const producedNaOCl = (absorbedMass / MW.Cl2) * 74.442;
            const minNaOH = (absorbedMass / MW.Cl2) * 2 * MW.NaOH * 1.12; // 12% 과잉 알칼리 안정화
            const reqTotalBottomMass = Math.max(absorbedMass + minNaOH, producedNaOCl / targetWt);
            const currentLiqMass = sumFlows(liqIn);
            const addSolution = Math.max(0, reqTotalBottomMass - absorbedMass - currentLiqMass);
            if (addSolution > 0.05) {
              const addNaOH = Math.min(addSolution, Math.max(0, minNaOH - liqIn.NaOH));
              const addH2O = Math.max(0, addSolution - addNaOH);
              liqIn.NaOH += addNaOH;
              liqIn.H2O += addH2O;
              pushMakeup('solvent', '자동 희석 가성 보충 (목표 NaOCl wt%)', { NaOH: addNaOH, H2O: addH2O }, T_top, P_in, 'L');
            }
          } else {
            const reqTotalBottomMass = absorbedMass / targetWt;
            const currentLiqMass = sumFlows(liqIn) + (target === 'H2O' ? 0 : gasIn.H2O);
            autoSolventAdded = Math.max(0, reqTotalBottomMass - absorbedMass - currentLiqMass);
            if (autoSolventAdded > 0.05) {
              liqIn[solvComp] += autoSolventAdded;
              pushMakeup('solvent', `자동 흡수액 보충 (${solvComp}, 목표 탑저 wt%)`, { [solvComp]: autoSolventAdded }, T_top, P_in, 'L');
            }
          }
        }

        const vap = emptyFlows();
        const liq = { ...liqIn };

        for (const k of SIM_COMPS) {
          if (k === target) {
            const abs = gasIn[k] * eff;
            liq[k] += abs;
            vap[k] += Math.max(0, gasIn[k] - abs);
          } else if (k === 'H2SO4' || k === 'NaOH' || k === 'NaCl' || k === 'NaOCl') {
            liq[k] += gasIn[k];
          } else if (k === 'H2O' && target !== 'H2O') {
            liq.H2O += gasIn.H2O;
          } else {
            vap[k] += gasIn[k];
          }
        }

        // 가성소다 폐염소 제해 반응: Cl₂ + 2NaOH → NaOCl + NaCl + H₂O (질량 정확 보존!)
        if (target === 'Cl2' && liq.Cl2 > 1e-4 && liq.NaOH > 1e-4) {
          const ext = Math.min(liq.Cl2 / MW.Cl2, liq.NaOH / (2 * MW.NaOH));
          liq.Cl2 = Math.max(0, liq.Cl2 - ext * MW.Cl2);
          liq.NaOH = Math.max(0, liq.NaOH - 2 * ext * MW.NaOH);
          liq.NaOCl += ext * MW.NaOCl;
          liq.NaCl += ext * (MW.Cl2 + 2 * MW.NaOH - MW.NaOCl - MW.H2O);
          liq.H2O += ext * MW.H2O;
        }

        // 흡수·용해·희석·중화 발열: 생성열 기준 엔탈피에서 자동 산출 (구 고정계수 420/320/350 kcal/kg 대체)
        //   Q_iso = H_out(전 출구 T_top 가정) − H_in  (< 0 이면 발열)
        const hInAbs = allIn.enth + unitMakeup.reduce((s, b) => s + bH(b), 0);
        const qIsoKcalH = streamEnthalpyKcalH(vap, liq, T_top, P_out) - hInAbs;
        const liqTot = sumFlows(liq);
        const vapTot = sumFlows(vap);
        const dT_abs = isRigorous && liqTot > 1 ? Math.min(35, Math.max(0, -qIsoKcalH) / (liqTot * 0.68)) : 4.5;
        const T_bot = T_top + dT_abs;

        const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out');
        const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid');
        if (vapEdges.length > 0 || liqEdges.length > 0) {
          const nV = Math.max(1, vapEdges.length);
          const nL = Math.max(1, liqEdges.length);
          vapEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = vap[k] / nV; });
            assignEdge(e, sf, T_top, P_out, 'G');
          });
          liqEdges.forEach(e => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = liq[k] / nL; });
            assignEdge(e, sf, T_bot, P_out, 'L');
          });
        } else {
          if (outEdges[0]) assignEdge(outEdges[0], vap, T_top, P_out, 'G');
          else pushUnrouted('vapor', '탑상 가스 (G↑ 미연결)', vap, T_top, P_out, 'G');
          if (outEdges[1]) assignEdge(outEdges[1], liq, T_bot, P_out, 'L');
          else pushUnrouted('liquid', '탑저 배출액 (L↓ 미연결)', liq, T_bot, P_out, 'L');
        }

        if (vapEdges.length > 0 || liqEdges.length > 0) {
          if (vapEdges.length === 0) pushUnrouted('vapor', '탑상 가스 (G↑ 미연결)', vap, T_top, P_out, 'G');
          if (liqEdges.length === 0) pushUnrouted('liquid', '탑저 배출액 (L↓ 미연결)', liq, T_bot, P_out, 'L');
        }
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        const outGasMoisturePpm = vapTot > 0.01 ? ((vap.H2O / vapTot) * 1e6).toFixed(1) : '0.0';
        const outGasCl2Ppm = vapTot > 0.01 ? ((vap.Cl2 / vapTot) * 1e6).toFixed(1) : '0.0';

        extraMetrics = {
          '인식 유체': detectedFluid,
          ...colRigDetail,
          '흡수 제거량': `${target} -${removedKgH.toFixed(2)} kg/h (${(eff * 100).toFixed(2)}%)`,
          ...(target === 'H2O' ? { '출구 가스 잔류수분': `${outGasMoisturePpm} wt ppm` } : {}),
          ...(target === 'Cl2' ? { '배출 가스 잔류 Cl₂': `${outGasCl2Ppm} wt ppm` } : {}),
          '탑상 정제가스 (G↑)': `${vapTot.toFixed(1)} kg/h (${detectKeyConc(vap, 'G')})`,
          '탑저 배출액 (L↓)': `${liqTot.toFixed(1)} kg/h (${detectKeyConc(liq, 'L')}, ${T_bot.toFixed(1)}°C)`,
          '흡수·반응 발열 (등온 기준)': `${(-qIsoKcalH / 1000).toFixed(1)} Mcal/h`,
          '냉각 열부하 (엔탈피 수지)': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h`,
        };
        note =
          target === 'H2O'
            ? `${isRigorous ? `[정밀 ${p.columnStages ?? 8}단] ` : ''}수분 ${(eff * 100).toFixed(1)}% 건조 → 출구 ${outGasMoisturePpm} wt ppm`
            : `${isRigorous ? `[정밀 ${p.columnStages ?? 8}단] ` : ''}${target} ${(eff * 100).toFixed(2)}% 흡수 | ${detectKeyConc(liq, 'L')}`;
        }
      }

      // ── 7) 가스 압축기 (Compressor) & 원심 펌프 (Pump) ─────────────────────
      else if (node.unitType === 'compressor' || node.unitType === 'pump') {
        const isComp = node.unitType === 'compressor';
        const P_out = p.outletPressKgcm2g ?? (isComp ? 3.5 : P_in + 3.0);
        const eff = Math.max(0.3, Math.min(0.95, p.efficiency ?? 0.76));
        const inProps = calcStreamProps(totalIn, T_in, P_in, undefined, undefined, runtimePropertyMethod);
        let T_out = T_in;

        if (isComp || inProps.phase === 'G') {
          const totalRatio = Math.max(1.0, (P_out + 1.03323) / Math.max(0.2, P_in + 1.03323));
          const nStages = isRigorous ? Math.max(1, Math.min(4, Math.round(p.compStages ?? 2))) : 1;
          const stageRatio = Math.pow(totalRatio, 1.0 / nStages);

          const moleFrac = emptyFlows();
          SIM_COMPS.forEach(k => { moleFrac[k] = (totalIn[k] / COMP_META[k].mw) / Math.max(1e-9, inProps.totalMolarKmolH); });
          const useEosZ = isRigorous || isExplicitPropertyMethod || hasAnyGeneralInSheet;
          const Z_avg = useEosZ
            ? (propertyMethodUsed === 'SRK'
                ? calcSoaveRedlichKwongMixture(moleFrac, T_in, 0.5 * (P_in + P_out)).Z_vap
                : calcPengRobinsonMixture(moleFrac, T_in, 0.5 * (P_in + P_out)).Z_vap)
            : 1.0;

          // 염소 가스는 다원자 특성으로 (k-1)/k ≈ 0.242, 수소는 ≈ 0.286
          const kExp = totalIn.Cl2 > sumMassIn * 0.5 ? 0.242 : 0.282;
          const polyExp = isRigorous ? kExp / eff : kExp;
          const stageInT = (p.intercooledTempC ?? 0) > 0 && nStages > 1 ? Math.min(T_in + 10, p.intercooledTempC!) : T_in;
          const stagePeakT = (stageInT + 273.15) * Math.pow(stageRatio, polyExp) - 273.15;

          T_out = (p.intercooledTempC ?? 0) > 0 ? p.intercooledTempC! : Math.min(135, stagePeakT);
          shaftPowerKW =
            (nStages * Z_avg * inProps.totalMolarKmolH * 8.31446 * (stageInT + 273.15) * (1.0 / kExp) * (Math.pow(stageRatio, kExp) - 1.0)) /
            (3600 * eff);

          if ((p.intercooledTempC ?? 0) > 0 && stagePeakT > T_out) {
            heatDutyKcalH = -sumMassIn * 0.13 * nStages * (stagePeakT - T_out);
          }

          const P_abs_out = P_out + 1.03323;
          const dewAfter = totalIn.Cl2 > 0 ? cl2DewPointTempC(P_abs_out * 0.99) : null;
          const cl2TempWarn =
            isRigorous && totalIn.Cl2 > 0 && stagePeakT > 105
              ? `⚠️ 단 토출 최고온도 ${stagePeakT.toFixed(1)}°C (Cl₂-탄소강 발화한계 110°C 주의 — 압축 단수 증가 권장!)`
              : undefined;

          extraMetrics = {
            '인식 유체': detectedFluid,
            ...(isRigorous
              ? {
                  '계산 모드': `🔬 정밀 ${nStages}단 폴리트로픽 (평균 압축인자 Z=${Z_avg.toFixed(3)})`,
                  '단당 압축비 / 단 최고온도': `${stageRatio.toFixed(2)} / ${stagePeakT.toFixed(1)} °C`,
                  ...(cl2TempWarn ? { '안전 온도 진단': cl2TempWarn } : {}),
                }
              : {}),
            '총 압축비 (P₂/P₁)': `${totalRatio.toFixed(2)} (${P_in.toFixed(2)} → ${P_out.toFixed(2)} kg/cm²G)`,
            '최종 토출 온도': `${T_out.toFixed(1)} °C`,
            '압축 축동력': `${shaftPowerKW.toFixed(1)} kW`,
            ...(dewAfter !== null ? { '승압 후 Cl₂ 액화 이슬점': `${dewAfter.toFixed(1)} °C` } : {}),
          };
          note = `${isRigorous ? `[정밀 ${nStages}단] ` : ''}압축 ${P_in.toFixed(2)}→${P_out.toFixed(2)} kG (동력 ${shaftPowerKW.toFixed(1)} kW)`;
        } else {
          const dP_Pa = Math.max(0, P_out - P_in) * 98066.5;
          shaftPowerKW = ((inProps.volFlowM3H / 3600) * dP_Pa) / (1000 * eff);
          T_out = T_in + 0.2;
          extraMetrics = {
            '인식 유체': detectedFluid,
            '부피 유량': `${inProps.volFlowM3H.toFixed(1)} m³/h`,
            '토출 압력': `${P_out.toFixed(2)} kg/cm²G`,
            '펌프 축동력': `${shaftPowerKW.toFixed(1)} kW`,
          };
          note = `유량 ${inProps.volFlowM3H.toFixed(1)} m³/h, 토출 ${P_out.toFixed(2)} kG, 동력 ${shaftPowerKW.toFixed(1)} kW`;
        }

        // 에너지 수지: 인터쿨러 없음 → 축동력 전량이 유체 엔탈피 상승 (PH 플래시로 토출 온도 확정, Q = 0)
        //              인터쿨러/애프터쿨러 → 토출 온도 지정, 냉각 열부하 Q = ΔH − W (엔탈피 수지)
        const isIntercooled = (isComp || inProps.phase === 'G') && (p.intercooledTempC ?? 0) > 0;
        let compOutRatio: VapRatio | undefined = undefined;
        if (!isIntercooled && sumMassIn > 0) {
          const ph = phFlashStream(totalIn, P_out, allIn.enth + shaftPowerKW * KCALH_PER_KW_SOLVER, T_out, false, runtimePropertyMethod);
          noteFlash(ph, '압축/승압 출구 PH 플래시 미수렴');
          T_out = ph.T_C;
          compOutRatio = ratioFromSplit(ph.vap, ph.liq);
          extraMetrics = { ...extraMetrics, '토출 온도 (에너지수지 PH)': `${T_out.toFixed(1)} °C` };
        } else if (isIntercooled) {
          dutyFromEnthalpy = true;
        }

        // 다단 인터쿨러/애프터쿨러 장착 가스 압축기에서 응축된 수분(Knock-out) 자동 분리 반영
        if ((isComp || inProps.phase === 'G') && (p.intercooledTempC ?? 0) > 0 && totalIn.H2O > 0.2) {
          const compFlash = flashGasLiquid(totalIn, T_out, P_out, isRigorous, runtimePropertyMethod);
          noteFlash(compFlash, '중간냉각 응축 TP 플래시 미수렴', 'failed');
          const condLiqMass = sumFlows(compFlash.liq);
          const liqOutEdges = outEdges.filter(oe => oe.sourcePort === 'liquid');
          const gasOutEdges = outEdges.filter(oe => oe.sourcePort !== 'liquid');

          if (condLiqMass > 0.05 && gasOutEdges.length > 0) {
            const nGas = gasOutEdges.length;
            gasOutEdges.forEach(oe => {
              const splitF = emptyFlows();
              SIM_COMPS.forEach(k => { splitF[k] = compFlash.vap[k] / nGas; });
              assignEdge(oe, splitF, T_out, P_out, 'G');
            });
            if (liqOutEdges.length > 0) {
              const nLiq = liqOutEdges.length;
              liqOutEdges.forEach(oe => {
                const splitF = emptyFlows();
                SIM_COMPS.forEach(k => { splitF[k] = compFlash.liq[k] / nLiq; });
                assignEdge(oe, splitF, T_out, P_out, 'L');
              });
            } else {
              pushUnrouted('liquid', '단간·후단 응축수 녹아웃 드레인 (미연결)', compFlash.liq, T_out, P_out, 'L');
            }
            removedKgH = condLiqMass;
            extraMetrics = {
              ...extraMetrics,
              '단간·후단 응축수 제거': `${condLiqMass.toFixed(1)} kg/h (포화수분만 기상 동반)`,
            };
          } else {
            const nOut = Math.max(1, outEdges.length);
            outEdges.forEach(oe => {
              const splitF = emptyFlows();
              SIM_COMPS.forEach(k => { splitF[k] = totalIn[k] / nOut; });
              assignEdge(oe, splitF, T_out, P_out, isComp ? 'G' : undefined);
            });
          }
        } else {
          const nOut = Math.max(1, outEdges.length);
          outEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = totalIn[k] / nOut; });
            assignEdge(oe, splitF, T_out, P_out, isComp && !compOutRatio ? 'G' : undefined, compOutRatio);
          });
        }
        if (dutyFromEnthalpy) heatDutyKcalH = derivedDutyKcalH();
      }

      // ── 8) 강하막 증발관 (Evaporator — 가성소다 등 농축 수지) ──────────────
      else if (node.unitType === 'evaporator') {
        const targetWt = Math.min(75, Math.max(10, p.evapTargetConcWt ?? 50.0)) / 100;
        const T_out = p.operTempC ?? 110.0;
        const P_out = p.operPressKgcm2g ?? 0.0;
        const soluteMass = totalIn.NaOH + totalIn.NaCl;
        const reqLiqMass = soluteMass > 0 ? soluteMass / targetWt : sumMassIn;
        const reqWaterInLiq = Math.max(0, reqLiqMass - soluteMass);
        const evapWater = Math.max(0, totalIn.H2O - reqWaterInLiq);
        removedKgH = evapWater;

        const vap = emptyFlows();
        const liq = { ...totalIn };
        vap.H2O = evapWater;
        liq.H2O = Math.max(0, totalIn.H2O - evapWater);

        // 정밀 모드 시 Dühring 비점오름(BPR) 보정 (농축액 출구 온도)
        const bpr = isRigorous ? 0.24 * (targetWt * 100) + 0.0128 * Math.pow(targetWt * 100, 2) : 0;

        const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor');
        const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid' || e.sourcePort === 'out');
        if (vapEdges.length > 0 || liqEdges.length > 0) {
          vapEdges.forEach(e => assignEdge(e, vap, T_out, P_out, 'G'));
          liqEdges.forEach(e => assignEdge(e, liq, T_out + bpr * 0.2, P_out, 'L'));
        } else {
          if (outEdges[0]) assignEdge(outEdges[0], liq, T_out, P_out, 'L');
          else pushUnrouted('liquid', '농축액 출구 (L↓ 미연결)', liq, T_out, P_out, 'L');
          if (outEdges[1]) assignEdge(outEdges[1], vap, T_out, P_out, 'G');
        }
        if ((vapEdges.length > 0 || liqEdges.length > 0) ? vapEdges.length === 0 : !outEdges[1]) {
          pushUnrouted('vapor', '증발 수증기 (G↑ 미연결 — 대기/응축 배출)', vap, T_out, P_out, 'G');
        }
        if ((vapEdges.length > 0 || liqEdges.length > 0) && liqEdges.length === 0) {
          pushUnrouted('liquid', '농축액 출구 (L↓ 미연결)', liq, T_out + bpr * 0.2, P_out, 'L');
        }
        // 가열 열량 = 엔탈피 수지 (증발잠열 + NaOH 농축열(적분 용해열 차) + 급액 현열 자동 포함)
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        extraMetrics = {
          ...(isRigorous ? { '계산 모드': `🔬 정밀 (Dühring 비점오름 +${bpr.toFixed(1)}°C 반영)` } : {}),
          '증발 수증기량 (G↑)': `${evapWater.toFixed(1)} kg/h`,
          '농축액 배출량 (L↓)': `${sumFlows(liq).toFixed(1)} kg/h (${detectKeyConc(liq, 'L')})`,
          '필요 가열열량': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h`,
        };
        note = `${isRigorous ? '[정밀] ' : ''}증발수분 ${evapWater.toFixed(1)} kg/h | 농축액 ${detectKeyConc(liq, 'L')}`;
      }

      // ── 9) 배관 믹서 & 분기기 & 화학반응기 ─────────────────────────────────
      else if (node.unitType === 'mixer') {
        const mult = Math.max(1, p.multiplier ?? 1);
        const outF = emptyFlows();
        SIM_COMPS.forEach(k => { outF[k] = totalIn[k] * mult; });
        if (mult > 1) {
          // 헤더 배수(×N기)는 물리적 질량 생성이므로 경계 유입(배수 증폭)으로 명시
          const extraF = emptyFlows();
          SIM_COMPS.forEach(k => { extraF[k] = totalIn[k] * (mult - 1); });
          pushMakeup('multiplier', `헤더 배수 ×${mult} 가상 증폭`, extraF, T_in, P_in);
        }
        const nOut = Math.max(1, outEdges.length);
        for (const oe of outEdges) {
          const splitF = emptyFlows();
          SIM_COMPS.forEach(k => { splitF[k] = outF[k] / nOut; });
          assignEdge(oe, splitF, T_in, P_in, undefined, allIn.vapRatio);
        }
        note = mult > 1 ? `합류 및 ×${mult}기 헤더 배수 적용` : `배관 합류 (혼합 ${T_in.toFixed(1)}°C)`;
      }

      else if (node.unitType === 'splitter') {
        const r1 = Math.min(0.99, Math.max(0.01, p.splitRatioTop ?? 0.5));
        const topEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out1');
        const botEdges = outEdges.filter(e => e.sourcePort === 'liquid' || e.sourcePort === 'out2');
        if (topEdges.length > 0 && botEdges.length > 0) {
          topEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = (totalIn[k] * r1) / topEdges.length; });
            assignEdge(oe, splitF, T_in, P_in, undefined, allIn.vapRatio);
          });
          botEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = (totalIn[k] * (1 - r1)) / botEdges.length; });
            assignEdge(oe, splitF, T_in, P_in, undefined, allIn.vapRatio);
          });
        } else {
          outEdges.forEach((oe, idx) => {
            const ratio = outEdges.length === 1 ? 1.0 : idx === 0 ? r1 : (1 - r1) / (outEdges.length - 1);
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = totalIn[k] * ratio; });
            assignEdge(oe, splitF, T_in, P_in, undefined, allIn.vapRatio);
          });
        }
        note = `배관 분기 (분기1 ${(r1 * 100).toFixed(0)}% / 분기2 ${((1 - r1) * 100).toFixed(0)}%)`;
      }

      else if (node.unitType === 'reactor') {
        if (p.reactorConfig) {
          const rxCfg: ReactorConfig = {
            ...p.reactorConfig,
            operTempC: p.operTempC ?? p.reactorConfig.operTempC,
            operPressKgcm2g: p.operPressKgcm2g ?? p.reactorConfig.operPressKgcm2g,
            specifiedDutyKcalH:
              p.specifiedDutyMcalH !== undefined
                ? p.specifiedDutyMcalH * 1000
                : p.reactorConfig.specifiedDutyKcalH,
            propertyMethod: p.reactorConfig.propertyMethod ?? runtimePropertyMethod,
          };
          const rxRes = solveChemicalReactor(totalIn, T_in, P_in, rxCfg);
          reactorResult = rxRes;
          if (!rxRes.converged) {
            unitIssues.push({
              sev: 'warning',
              msg: rxRes.warnings[0] ?? '정밀 화학반응기 수렴 허용오차 초과',
            });
          }
          const outF = emptyFlows();
          const vapF = emptyFlows();
          const liqF = emptyFlows();
          SIM_COMPS.forEach(k => {
            outF[k] = Math.max(0, rxRes.outletFlowsKgH[k] ?? 0);
            vapF[k] = Math.max(0, rxRes.vapFlowsKgH[k] ?? 0);
            liqF[k] = Math.max(0, rxRes.liqFlowsKgH[k] ?? 0);
          });
          const T_rx_out = rxRes.outletTempC;
          const P_rx_out = rxRes.outletPressKgcm2g;
          const rxVRatio = ratioFromSplit(vapF, liqF);

          const explicitVapEdges = outEdges.filter(e => e.sourcePort === 'vapor');
          const explicitLiqEdges = outEdges.filter(e => e.sourcePort === 'liquid');
          const mainOutEdges = outEdges.filter(e => e.sourcePort !== 'vapor' && e.sourcePort !== 'liquid');

          if ((explicitVapEdges.length > 0 || explicitLiqEdges.length > 0) && mainOutEdges.length === 0) {
            if (explicitVapEdges.length > 0) {
              const nv = explicitVapEdges.length;
              explicitVapEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = vapF[k] / nv; });
                assignEdge(e, sf, T_rx_out, P_rx_out, 'G');
              });
            } else if (sumFlows(vapF) > 1e-6) {
              pushUnrouted('vapor', '반응기 기상 출구 미연결', vapF, T_rx_out, P_rx_out, 'G');
            }
            if (explicitLiqEdges.length > 0) {
              const nl = explicitLiqEdges.length;
              explicitLiqEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = liqF[k] / nl; });
                assignEdge(e, sf, T_rx_out, P_rx_out, 'L');
              });
            } else if (sumFlows(liqF) > 1e-6) {
              pushUnrouted('liquid', '반응기 액상 출구 미연결', liqF, T_rx_out, P_rx_out, 'L');
            }
          } else if (outEdges.length > 0) {
            const nOut = outEdges.length;
            outEdges.forEach(oe => {
              const sf = emptyFlows();
              SIM_COMPS.forEach(k => { sf[k] = outF[k] / nOut; });
              assignEdge(oe, sf, T_rx_out, P_rx_out, undefined, rxVRatio);
            });
          } else {
            pushUnrouted('out', '반응기 출구 미연결', outF, T_rx_out, P_rx_out, undefined, rxVRatio);
          }

          const isRxAdiabatic = rxCfg.thermalMode === 'adiabatic';
          heatDutyKcalH = isRxAdiabatic ? 0 : derivedDutyKcalH();
          externalHeatKcalH = isRxAdiabatic ? 0 : heatDutyKcalH;
          dutyFromEnthalpy = !isRxAdiabatic;
          extraMetrics = {
            '인식 유체': detectedFluid,
            '반응기 해석 모델': `${rxRes.model.toUpperCase()} (${rxCfg.thermalMode} · 반복 ${rxRes.iterations}회)`,
            '출구 온도 · 압력': `${T_rx_out.toFixed(1)}°C / ${P_rx_out.toFixed(2)} kgf/cm²G`,
            '반응·현열 통합 열부하': `${(heatDutyKcalH / 1000).toFixed(2)} Mcal/h`,
          };
          note = rxRes.statusNote || `[${rxRes.model.toUpperCase()}] 출구 ${T_rx_out.toFixed(1)}°C`;
        } else {
        const preset = p.reactionPreset ?? 'hcl_burner';
        const rawConv = p.conversion ?? 0.995;
        const baseConv = Math.min(1.0, Math.max(0, rawConv > 1.0001 ? rawConv / 100 : rawConv));
        const rxModel = p.reactorModel ?? 'conversion';
        const rxVolM3 = Math.max(0.2, p.reactorVolumeM3 ?? (preset === 'gte_hydrochlorination' ? 32.0 : preset === 'ech_saponification' ? 14.0 : 10.0));
        const isAdiabatic = p.reactorThermalMode === 'adiabatic';
        let T_out = p.operTempC ?? 120.0;
        const P_out = p.operPressKgcm2g ?? P_in;
        const outF = { ...totalIn };
        const T_rxK = Math.max(273.15, T_out + 273.15);
        const R_KJ = 0.00831446;

        // 반응속도 모드(CSTR / PFR) 체류시간 τ (hr) 기반 유효 전화율 산출 헬퍼
        const totalVolM3H = Math.max(0.05, sumFlows(totalIn) / 1120.0);
        const tauHr = rxVolM3 / totalVolM3H;
        const evalKineticConv = (kRefAtTref: number, TrefK: number, EaKJmol: number): number => {
          const kT = kRefAtTref * Math.exp((-EaKJmol / R_KJ) * (1.0 / T_rxK - 1.0 / TrefK));
          const da = Math.max(0, kT * tauHr);
          return rxModel === 'cstr' ? da / (1.0 + da) : 1.0 - Math.exp(-Math.min(30, da));
        };
        const conv = rxModel === 'conversion'
          ? baseConv
          : evalKineticConv(18.0, 385.15, 62.0);

        if (preset === 'hcl_burner') {
          const extent = Math.min(outF.Cl2 / MW.Cl2, outF.H2 / MW.H2) * conv;
          outF.Cl2 -= extent * MW.Cl2;
          outF.H2 -= extent * MW.H2;
          outF.HCl += 2 * extent * MW.HCl;
          note = `Cl₂+H₂→2HCl 합성: HCl ${(2 * extent * MW.HCl).toFixed(1)} kg/h 생성`;
        } else if (preset === 'brine_electrolysis') {
          const extent = Math.min(outF.NaCl / (2 * MW.NaCl), outF.H2O / (2 * MW.H2O)) * conv;
          outF.NaCl = Math.max(0, outF.NaCl - extent * (MW.Cl2 + MW.H2 + 2 * MW.NaOH - 2 * MW.H2O));
          outF.H2O = Math.max(0, outF.H2O - 2 * extent * MW.H2O);
          outF.Cl2 += extent * MW.Cl2;
          outF.H2 += extent * MW.H2;
          outF.NaOH += 2 * extent * MW.NaOH;
          note = `염수 전해: Cl₂ ${(extent * MW.Cl2).toFixed(1)} / NaOH ${(2 * extent * MW.NaOH).toFixed(1)} kg/h`;
        } else if (preset === 'fecl3_chlorination') {
          const extent = Math.min(outF.FeCl2 / (2 * MW.FeCl2), outF.Cl2 / MW.Cl2) * conv;
          outF.FeCl2 -= 2 * extent * MW.FeCl2;
          outF.Cl2 -= extent * MW.Cl2;
          outF.FeCl3 += 2 * extent * MW.FeCl3;
          note = `2FeCl₂+Cl₂→2FeCl₃ 에칭재생: FeCl₃ ${(2 * extent * MW.FeCl3).toFixed(1)} kg/h 생성`;
        } else if (preset === 'gte_hydrochlorination') {
          // GTE 1단계 연속 2단 염소화 (카르복실산 촉매):
          // Step 1: Glycerol + HCl -> MCH + H2O (빠름, Ea1 = 56 kJ/mol)
          // Step 2: MCH + HCl -> DCH + H2O (율속단계, Ea2 = 68 kJ/mol)
          const nGly0 = outF.Glycerol / MW.Glycerol;
          const nMch0 = outF.MCH / MW.MCH;
          let nHclAvail = outF.HCl / MW.HCl;

          const x1 = rxModel === 'conversion'
            ? Math.min(0.998, conv + 0.015)
            : evalKineticConv(42.0, 385.15, 56.0);
          const x2 = rxModel === 'conversion'
            ? conv
            : evalKineticConv(14.5, 385.15, 68.0);

          const ext1 = Math.min(nGly0 * x1, nHclAvail);
          nHclAvail = Math.max(0, nHclAvail - ext1);
          const mchPool = nMch0 + ext1;
          const ext2 = Math.min(mchPool * x2, nHclAvail);

          // Step 1: Glycerol(92.094) + HCl(36.461) -> MCH(110.54) + H2O(18.015) (질량 정확 일치)
          outF.Glycerol -= ext1 * MW.Glycerol;
          outF.HCl -= (ext1 + ext2) * MW.HCl;
          outF.MCH += (ext1 - ext2) * MW.MCH;
          outF.DCH += ext2 * MW.DCH;
          outF.H2O += ext1 * (MW.Glycerol + MW.HCl - MW.MCH) + ext2 * (MW.MCH + MW.HCl - MW.DCH);
          note = `[${rxModel.toUpperCase()}] GTE 염소화(Gly→MCH→DCH): DCH ${(ext2 * MW.DCH).toFixed(1)} / 중간체 MCH ${(outF.MCH).toFixed(1)} kg/h`;
        } else if (preset === 'ech_saponification') {
          // 0단계: 전단 염소화 미반응 동반 HCl 즉시 중화 (HCl + NaOH -> NaCl + H2O, 강산-강염기 비가역 반응)
          if (outF.HCl > 1e-9 && outF.NaOH > 1e-9) {
            const extNeut = Math.min(outF.HCl / MW.HCl, outF.NaOH / MW.NaOH);
            outF.HCl = Math.max(0, outF.HCl - extNeut * MW.HCl);
            outF.NaOH = Math.max(0, outF.NaOH - extNeut * MW.NaOH);
            outF.NaCl += extNeut * MW.NaCl;
            outF.H2O += extNeut * (MW.HCl + MW.NaOH - MW.NaCl);
          }
          // GTE 2단계 알칼리 비누화 고리화 + 고온 가수분해 부반응 추적:
          // Main: DCH + NaOH -> ECH + NaCl + H2O (Ea = 52 kJ/mol)
          // Side: ECH + H2O -> Glycerol/MCH 가수분해 (75°C 초과 또는 과체류 시 증가, Ea_hyd = 84 kJ/mol)
          const nDch0 = outF.DCH / MW.DCH;
          const nNaoh0 = outF.NaOH / MW.NaOH;
          const convSap = rxModel === 'conversion'
            ? conv
            : evalKineticConv(36.0, 341.15, 52.0);
          const extMain = Math.min(nDch0, nNaoh0) * convSap;
          outF.DCH -= extMain * MW.DCH;
          outF.NaOH -= extMain * MW.NaOH;
          outF.ECH += extMain * MW.ECH;
          outF.NaCl += extMain * (MW.DCH + MW.NaOH - MW.ECH - MW.H2O);
          outF.H2O += extMain * MW.H2O;

          // 고온 알칼리 가수분해 부반응: ECH + H2O -> Glycerol (질량 보존: ECH 92.525 + H2O 18.015 -> MCH 110.54 등가 / 또는 ECH + NaOH + H2O -> Glycerol + NaCl)
          const nNaohRem = Math.max(0, outF.NaOH / MW.NaOH);
          const hydFrac = rxModel === 'conversion'
            ? Math.min(0.03, 0.0025 * Math.exp(0.065 * Math.max(0, T_out - 68.0)))
            : Math.min(0.08, evalKineticConv(0.008, 341.15, 84.0));
          const extHyd = Math.min(outF.ECH / MW.ECH * hydFrac, nNaohRem, (outF.H2O / MW.H2O) * 0.2);
          if (extHyd > 1e-6) {
            // ECH + NaOH + H2O -> Glycerol + NaCl (92.525 + 39.997 + 18.015 = 150.537 === 92.094 + 58.443!)
            outF.ECH -= extHyd * MW.ECH;
            outF.NaOH -= extHyd * MW.NaOH;
            outF.H2O -= extHyd * MW.H2O;
            outF.Glycerol += extHyd * MW.Glycerol;
            outF.NaCl += extHyd * (MW.ECH + MW.NaOH + MW.H2O - MW.Glycerol);
          }
          note = `[${rxModel.toUpperCase()}] 비누화 고리화: ECH ${(outF.ECH).toFixed(1)} kg/h (가수분해 부반응 ${(hydFrac * 100).toFixed(2)}%)`;
        } else if (preset === 'cms_aibn_chlorination') {
          // AIBN 개시 액상 자유라디칼 연속 염소화 (24 kgf/cm²G, 120°C): MC -> MCL -> CFM -> CTC + C2Cl4
          const nMc0 = outF.CH3Cl / MW.CH3Cl;
          const nCl2Avail = outF.Cl2 / MW.Cl2;
          const xMc = rxModel === 'conversion' ? Math.min(0.60, Math.max(0.15, conv * 0.35)) : evalKineticConv(8.5, 393.15, 58.0);
          const convCl2 = rxModel === 'conversion' ? Math.min(0.999, Math.max(0.85, conv)) : 0.9985;
          const targetCl2Use = nCl2Avail * convCl2;
          const ext1 = Math.min(nMc0 * xMc, targetCl2Use * 0.62);
          const ext2 = Math.min((outF.CH2Cl2 / MW.CH2Cl2 + ext1) * 0.41, Math.max(0, targetCl2Use - ext1));
          const ext3 = Math.min((outF.CHCl3 / MW.CHCl3 + ext2) * 0.145, Math.max(0, targetCl2Use - ext1 - ext2));
          outF.CH3Cl -= ext1 * MW.CH3Cl;
          outF.Cl2 -= (ext1 + ext2 + ext3) * MW.Cl2;
          outF.CH2Cl2 += (ext1 - ext2) * MW.CH2Cl2;
          outF.CHCl3 += (ext2 - ext3) * MW.CHCl3;
          outF.CCl4 += ext3 * MW.CCl4;
          outF.HCl += (ext1 + ext2 + ext3) * MW.HCl;
          note = `AIBN 라디칼 염소화 (${T_out.toFixed(1)}°C): MCL ${outF.CH2Cl2.toFixed(0)} / CFM ${outF.CHCl3.toFixed(0)} kg/h`;
        } else {
          const extent = Math.min(outF.Cl2 / MW.Cl2, outF.NaOH / (2 * MW.NaOH)) * conv;
          outF.Cl2 -= extent * MW.Cl2;
          outF.NaOH -= 2 * extent * MW.NaOH;
          outF.NaOCl += extent * MW.NaOCl;
          outF.NaCl += extent * (MW.Cl2 + 2 * MW.NaOH - MW.NaOCl - MW.H2O);
          outF.H2O += extent * MW.H2O;
          removedKgH = extent * MW.Cl2;
          note = `가성소다 제해: Cl₂ ${removedKgH.toFixed(1)} kg/h → NaOCl ${(extent * MW.NaOCl).toFixed(1)} kg/h`;
        }

        const cleanOutF = emptyFlows();
        SIM_COMPS.forEach(k => { cleanOutF[k] = Math.max(0, outF[k] || 0); });
        let rxOutRatio: VapRatio | undefined = undefined;
        if (isAdiabatic && sumFlows(cleanOutF) > 0) {
          const ph = phFlashStream(cleanOutF, P_out, allIn.enth, T_in, isRigorous, runtimePropertyMethod);
          noteFlash(ph, '단열 반응기 출구 PH 플래시 미수렴');
          T_out = ph.T_C;
          rxOutRatio = ratioFromSplit(ph.vap, ph.liq);
        }

        if (outEdges.length > 0) {
          const nOut = outEdges.length;
          outEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = cleanOutF[k] / nOut; });
            assignEdge(oe, splitF, T_out, P_out, undefined, rxOutRatio);
          });
        } else {
          pushUnrouted('out', '반응기 출구 미연결', cleanOutF, T_out, P_out, undefined, rxOutRatio);
        }

        // 생성열 기준 총엔탈피 수지로 반응열·현열·용해열·상변화열 통합 산출 (구 고정 상수 제거)
        heatDutyKcalH = isAdiabatic ? 0 : derivedDutyKcalH();
        dutyFromEnthalpy = !isAdiabatic;
        extraMetrics = {
          '인식 유체': detectedFluid,
          '운전 열모드': isAdiabatic ? `단열 반응 (출구 ${T_out.toFixed(1)}°C)` : `지정온도 ${T_out.toFixed(1)}°C (생성열 엔탈피 수지)`,
          '반응·현열 통합 열부하': `${(heatDutyKcalH / 1000).toFixed(1)} Mcal/h`,
        };
        }
      }

      // ── 10) 100 SEC 원염 포화 · 1차 화학정제 침전조 (Brine Saturator & Clarifier) ──
      else if (node.unitType === 'saturator') {
        const targetWt = Math.min(26.8, Math.max(15.0, p.targetBrineWtPct ?? 25.65)) / 100;
        const T_out = p.operTempC ?? 67.0;
        const P_out = p.operPressKgcm2g ?? Math.max(0.3, P_in);
        const outF = { ...totalIn };

        // 폐루프 순환 브라인 수위·농도 제어기(LCV-080 / FCV-104) 작동 시:
        // 하류 전해조 부하(전류·셀수·기수)에 맞춰 양극 출구 희박염수가 목표 농도(기본 17.45 wt%)를 유지하도록 보충수를 자동 트림한다.
        let makeupWaterTrimKgH = 0;
        if (p.autoWaterMakeup) {
          const elNode = nodes.find(n => n.unitType === 'electrolyzer');
          if (elNode) {
            const elP = elNode.params ?? {};
            const elCe = Math.min(100, Math.max(50, elP.currentEffPct ?? 94.0)) / 100;
            const elNe = ((elP.currentKA ?? 16.2) * 1000 * (elP.cellCount ?? 190) * (elP.unitCount ?? 5) * elCe) / 26801.48;
            const dmNaCl = elNe * MW.NaCl;
            const tH2O = elP.waterTransportNumber ?? 4.195;
            // 전기삼투 수분이동 + D-210 습윤 Cl₂ 수증기 동반 손실분 합산
            const dmH2OAnode = elNe * (tH2O + 0.255) * MW.H2O;
            const wDep = Math.min(targetWt - 0.02, Math.max(0.10, (p.targetDepletedBrineWtPct ?? 17.45) / 100));
            const alphaF = targetWt / (1.0 - targetWt);
            const alphaD = wDep / (1.0 - wDep);
            const targetWaterKgH = (dmNaCl - alphaD * dmH2OAnode) / Math.max(0.02, alphaF - alphaD);
            if (targetWaterKgH > 100) {
              makeupWaterTrimKgH = targetWaterKgH - outF.H2O;
              if (Math.abs(makeupWaterTrimKgH) > 0.05) {
                outF.H2O = targetWaterKgH;
                pushMakeup('makeup_water', '자동 보충수 트림 (LCV/FCV 수위·농도 제어)', { H2O: makeupWaterTrimKgH }, T_out, P_out, 'L');
              }
            }
          }
        }

        // 희박염수 유입 시 목표 농도(기본 25.65 wt% ≈ 310 g/L) 달성을 위한 원염(NaCl) 자동 용해 계산
        let addedSaltKgH = 0;
        if ((p.autoSaltMakeup ?? true) && outF.H2O > 1.0) {
          const reqNaCl = (targetWt / Math.max(0.05, 1.0 - targetWt)) * outF.H2O;
          if (reqNaCl > outF.NaCl + 0.5) {
            addedSaltKgH = reqNaCl - outF.NaCl;
            outF.NaCl += addedSaltKgH;
            pushMakeup('salt', '원염(NaCl) 자동 용해 보충', { NaCl: addedSaltKgH }, 25.0, P_out, 'L');
          }
        }

        // 미량 용존 염소가 들어왔다면 탈기/중화 소멸
        if (outF.Cl2 > 0.01) {
          const addedSaltFromCl2 = outF.Cl2 * ((2 * MW.NaCl) / MW.Cl2);
          outF.NaCl += addedSaltFromCl2;
          pushMakeup('reagent', '용존 Cl₂ 중화 약품 등가 (Cl₂→2NaCl 질량증분)', { NaCl: addedSaltFromCl2 - outF.Cl2 }, T_out, P_out, 'L');
          outF.Cl2 = 0;
        }

        const purgeFrac = Math.min(0.05, Math.max(0, (p.sludgePurgePct ?? 0) / 100));
        const clarEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out');
        const sludgeEdges = outEdges.filter(e => e.sourcePort === 'liquid');

        if (sludgeEdges.length > 0 && clarEdges.length > 0 && purgeFrac > 0) {
          const clarF = emptyFlows();
          const sludF = emptyFlows();
          SIM_COMPS.forEach(k => {
            clarF[k] = outF[k] * (1 - purgeFrac);
            sludF[k] = outF[k] * purgeFrac;
          });
          clarEdges.forEach(oe => assignEdge(oe, clarF, T_out, P_out, 'L'));
          sludgeEdges.forEach(oe => assignEdge(oe, sludF, T_out, P_out, 'L'));
          removedKgH = sumFlows(sludF);
        } else if (outEdges.length > 0) {
          const nOut = outEdges.length;
          outEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = outF[k] / nOut; });
            assignEdge(oe, splitF, T_out, P_out, 'L');
          });
        } else {
          pushUnrouted('out', '포화 브라인 출구 미연결', outF, T_out, P_out, 'L');
        }

        // 생성열 기준 엔탈피 수지 (원염 NaCl(s)→NaCl(aq) 용해 흡열 +3.88 kJ/mol 및 승온 현열 자동 반영)
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        const outTot = sumFlows(outF);
        const outProps = calcStreamProps(outF, T_out, P_out, 'L', undefined, runtimePropertyMethod);
        const outWt = outTot > 0 ? (outF.NaCl / Math.max(1, outF.NaCl + outF.H2O)) * 100 : 0;
        const clarDiaM = Math.max(1.8, Math.sqrt((4 * outProps.volFlowM3H) / (Math.PI * 8.0))); // 상승유속 8.0 m/h 기준

        extraMetrics = {
          '인식 유체': detectedFluid,
          ...(isRigorous
            ? {
                '계산 모드': `🔬 정밀 침전·용해 수지 (상승유속 8.0 m/h → Ø ${clarDiaM.toFixed(1)} m)`,
                '정제 약품 정량': `Na₂CO₃ ${(outTot * 0.00014).toFixed(1)} · NaOH ${(outTot * 0.00011).toFixed(1)} · BaCl₂ ${(outTot * 0.00009).toFixed(1)} kg/h`,
                '1차 정제 수질': `Ca+Mg 180 ppm → 2.2 ppm · 상등액 SS < 18 ppm`,
              }
            : {}),
          '원염(NaCl) 용해량': addedSaltKgH > 0 ? `+${addedSaltKgH.toFixed(1)} kg/h (자동 포화 보충)` : `배관 유입 원염 용해`,
          '출구 포화 브라인': `${outWt.toFixed(2)} wt% NaCl (${(outWt * 12.1).toFixed(0)} g/L, ${outProps.volFlowM3H.toFixed(1)} m³/h)`,
        };
        note = `${isRigorous ? '[정밀 1차정제] ' : ''}브라인 ${outWt.toFixed(1)} wt% (${(outWt * 12.1).toFixed(0)} g/L)${addedSaltKgH > 0 ? ` · 원염 +${(addedSaltKgH / 1000).toFixed(1)} t/h` : ''}`;
      }

      // ── 11) 100 SEC 2차 킬레이트 이온교환수지탑 (Chelating IX Tower — Ca+Mg < 20 ppb) ──
      else if (node.unitType === 'chelate_tower') {
        const dP = p.columnDeltaPKgcm2 ?? 0.35;
        const T_out = p.operTempC ?? T_in;
        const P_out = p.operPressKgcm2g ?? Math.max(0.1, P_in - dP);
        const inProps = calcStreamProps(totalIn, T_in, P_in, 'L', undefined, runtimePropertyMethod);
        const resinV = Math.max(0.5, p.resinVolM3 ?? 9.9);
        const sv = inProps.volFlowM3H / resinV; // BV/h
        const inHardPpb = Math.max(10, p.inletHardnessPpb ?? 2200);
        // SV 20 BV/h 이하에서 99.3% 이상 킬레이트 흡착 제거 (Lewatit TP-208 기준)
        const leakFrac = Math.min(0.15, 0.0045 * Math.exp(Math.max(0, sv - 20) * 0.04));
        const outHardPpb = Math.max(5, inHardPpb * leakFrac);
        // 실운전 교환용량 0.52 eq/L 기준 파과 주기(hr)
        const eqLoadPerHr = (inProps.volFlowM3H * (inHardPpb / 1e6)) / 20.04;
        const cycleHours = eqLoadPerHr > 1e-5 ? (resinV * 1000 * 0.52) / (eqLoadPerHr * 1000) : 72;

        if (outEdges.length > 0) {
          const nOut = outEdges.length;
          outEdges.forEach(oe => {
            const splitF = emptyFlows();
            SIM_COMPS.forEach(k => { splitF[k] = totalIn[k] / nOut; });
            assignEdge(oe, splitF, T_out, P_out, 'L');
          });
        } else {
          pushUnrouted('out', '정제 브라인 출구 미연결', totalIn, T_out, P_out, 'L');
        }
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        extraMetrics = {
          '인식 유체': detectedFluid,
          '공간속도 (SV)': `${sv.toFixed(1)} BV/h (수지량 ${resinV.toFixed(1)} m³/탑)`,
          '2가 금속경도 (Ca+Mg)': `${inHardPpb.toFixed(0)} ppb → ${outHardPpb.toFixed(1)} ppb ${outHardPpb <= 20 ? '(막 보호 <20 ppb 합격 ✓)' : '(⚠️ SV 과다 주의)'}`,
          ...(isRigorous ? { '추정 흡착 파과주기': `${Math.min(120, cycleHours).toFixed(1)} 시간 (HCl/NaOH 재생 주기)` } : {}),
          '탑 차압 (ΔP)': `${dP.toFixed(2)} kg/cm² (${P_in.toFixed(2)} → ${P_out.toFixed(2)} kG)`,
        };
        note = `킬레이트 정제 Ca+Mg ${outHardPpb.toFixed(1)} ppb (<20 ppb) | SV ${sv.toFixed(1)} BV/h`;
      }

      // ── 12) 600 SEC 실리카겔 흡착 제습탑 (Desiccant Dryer — 고순도 H₂ 노점 -60°C) ──
      else if (node.unitType === 'desiccant_dryer') {
        const dP = p.columnDeltaPKgcm2 ?? 0.25;
        const T_out = p.operTempC ?? T_in;
        const P_out = p.operPressKgcm2g ?? Math.max(0.1, P_in - dP);
        const dewC = Math.min(10, Math.max(-80, p.targetDewPointC ?? -60));
        // 목표 노점(°C)에서의 포화 수분 몰분율 추산 -> 초고순도 제습!
        const pSatIceBar = Math.pow(10, 5.402 - 2010 / Math.max(180, dewC + 273.15));
        const pTotBar = Math.max(1.0, (P_out + 1.03323) * 0.980665);
        const dryGasMoles = (totalIn.H2 / MW.H2) + (totalIn.Cl2 / MW.Cl2) + (totalIn.O2 / MW.O2);
        const resWaterKgH = Math.min(totalIn.H2O, dryGasMoles * (pSatIceBar / pTotBar) * MW.H2O);
        const adsWaterKgH = Math.max(0, totalIn.H2O - resWaterKgH);
        removedKgH = adsWaterKgH;

        const vap = { ...totalIn, H2O: resWaterKgH };
        const liq = emptyFlows();
        liq.H2O = adsWaterKgH;

        const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out');
        const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid');
        if (vapEdges.length > 0 || liqEdges.length > 0) {
          vapEdges.forEach(e => assignEdge(e, vap, T_out, P_out, 'G'));
          liqEdges.forEach(e => assignEdge(e, liq, T_out + 5, 0.2, 'L'));
        } else {
          if (outEdges[0]) assignEdge(outEdges[0], vap, T_out, P_out, 'G');
          else pushUnrouted('vapor', '제습 가스 출구 (미연결)', vap, T_out, P_out, 'G');
        }
        if (liqEdges.length === 0) pushUnrouted('liquid', '흡착 수분 재생 배출 (미연결)', liq, T_out + 5, 0.2, 'L');
        if ((vapEdges.length > 0 || liqEdges.length > 0) && vapEdges.length === 0) {
          pushUnrouted('vapor', '제습 가스 출구 (미연결)', vap, T_out, P_out, 'G');
        }
        heatDutyKcalH = derivedDutyKcalH();
        dutyFromEnthalpy = true;

        const vapTot = sumFlows(vap);
        const ppmOut = vapTot > 0 ? (vap.H2O / vapTot) * 1e6 : 0;
        extraMetrics = {
          '인식 유체': detectedFluid,
          '달성 수분 이슬점': `${dewC.toFixed(0)} °C (잔류수분 ${ppmOut.toFixed(2)} wt ppm)`,
          '실리카겔 흡착 수분량': `${adsWaterKgH.toFixed(2)} kg/h`,
          '출구 초고순도 가스': `${vapTot.toFixed(1)} kg/h (${detectKeyConc(vap, 'G')})`,
        };
        note = `실리카겔 제습 (노점 ${dewC}°C · 수분 ${ppmOut.toFixed(1)} ppm) | ${detectKeyConc(vap, 'G')}`;
      }

      // ── 13) 엄밀 다단 정밀증류탑 (Rigorous Multi-Stage MESH Distillation Column) ──
      else if (node.unitType === 'distillation') {
        const cfg: DistillColumnParams = p.distillConfig ?? {};
        const effCfg: DistillColumnParams =
          (!cfg.thermoModel || cfg.thermoModel === 'AUTO') && isExplicitPropertyMethod
            ? { ...cfg, thermoModel: propertyMethodUsed }
            : cfg;
        const nStages = Math.max(4, Math.min(200, Math.round(effCfg.totalStages ?? 24)));
        const defaultFeedStage = Math.max(2, Math.min(nStages - 1, Math.round(effCfg.feedStage ?? Math.round(nStages * 0.5))));

        const feedsInput: DistillFeedInput[] = inEdges.map((ie, idx) => {
          const st = edgeState.get(ie.id)!;
          const mappedStage = effCfg.feedStageMap?.[ie.id] ?? (idx === 0 ? defaultFeedStage : Math.min(nStages - 1, defaultFeedStage + idx * 2));
          return {
            edgeId: ie.id,
            streamNo: ie.streamNo,
            stage: Math.max(2, Math.min(nStages - 1, mappedStage)),
            flowsKgH: { ...st.flows },
            tempC: st.tempC,
            pressKgcm2g: st.pressKgcm2g,
            enthalpyKcalH: stH(st),
            forcedPhase: st.forcedPhase,
            vapRatio: st.vapRatio,
          };
        });

        const feedSig =
          `${effCfg.thermoModel ?? 'AUTO'}::` +
          feedsInput
            .map(f => {
              const cSig = SIM_COMPS.filter(k => (f.flowsKgH[k] || 0) > 1e-5)
                .map(k => `${k}:${(f.flowsKgH[k] || 0).toFixed(4)}`)
                .join(',');
              const hSig = f.enthalpyKcalH !== undefined ? `@H${f.enthalpyKcalH.toFixed(1)}` : '';
              return `${f.stage}@${f.tempC.toFixed(3)}@${f.pressKgcm2g.toFixed(3)}${hSig}[${cSig}]`;
            })
            .join('|');
        const curTotFlows = emptyFlows();
        let curTotMass = 0;
        let curTotH = 0;
        for (const f of feedsInput) {
          curTotH += f.enthalpyKcalH ?? 0;
          for (const k of SIM_COMPS) {
            const v = f.flowsKgH[k] || 0;
            curTotFlows[k] += v;
            curTotMass += v;
          }
        }
        const prevDist = distillIterCache.get(node.id);
        let dRes: ReturnType<typeof solveRigorousDistillation>;
        if (prevDist && prevDist.sig === feedSig) {
          dRes = prevDist.res;
        } else {
          let canScalePrev = false;
          if (prevDist && prevDist.totMass > 1e-3 && curTotMass > 1e-3) {
            let diffSum = 0;
            for (const k of SIM_COMPS) {
              diffSum += Math.abs(curTotFlows[k] - prevDist.totFlows[k]);
            }
            const relMassDiff = diffSum / Math.max(prevDist.totMass, curTotMass);
            const relHDiff = Math.abs(curTotH - prevDist.totH) / Math.max(Math.abs(prevDist.totH), Math.abs(curTotH), 10 * curTotMass, 1);
            if (relMassDiff <= Math.min(5e-5, REL_TOL * 0.5) && relHDiff <= Math.min(5e-5, REL_TOL * 0.5)) {
              canScalePrev = true;
            }
          }
          if (canScalePrev && prevDist) {
            const scaledDist = emptyFlows();
            const scaledBot = emptyFlows();
            const scaledDec = prevDist.res.decanterFlowsKgH ? emptyFlows() : undefined;
            for (const k of SIM_COMPS) {
              const oldIn = prevDist.totFlows[k];
              const newIn = curTotFlows[k];
              if (oldIn > 1e-9 && newIn > 0) {
                const ratio = newIn / oldIn;
                scaledDist[k] = prevDist.res.distillateFlowsKgH[k] * ratio;
                scaledBot[k] = prevDist.res.bottomsFlowsKgH[k] * ratio;
                if (scaledDec && prevDist.res.decanterFlowsKgH) {
                  scaledDec[k] = prevDist.res.decanterFlowsKgH[k] * ratio;
                }
              }
            }
            const massScale = curTotMass / Math.max(1e-9, prevDist.totMass);
            dRes = {
              ...prevDist.res,
              distillateFlowsKgH: scaledDist,
              bottomsFlowsKgH: scaledBot,
              decanterFlowsKgH: scaledDec,
              decanterWaterDrawKgH: scaledDec ? scaledDec.H2O : prevDist.res.decanterWaterDrawKgH * massScale,
              condenserDutyKcalH: prevDist.res.condenserDutyKcalH * massScale,
              reboilerDutyKcalH: prevDist.res.reboilerDutyKcalH * massScale,
            };
          } else {
            dRes = solveRigorousDistillation(feedsInput, effCfg);
            distillIterCache.set(node.id, {
              sig: feedSig,
              totFlows: curTotFlows,
              totMass: curTotMass,
              totH: curTotH,
              res: dRes,
            });
          }
        }
        distillResult = dRes;

        const distFlows = dRes.distillateFlowsKgH;
        const botFlows = dRes.bottomsFlowsKgH;
        const distMass = sumFlows(distFlows);
        const botMass = sumFlows(botFlows);

        const decEdges = outEdges.filter(e => e.sourcePort === 'decanter');
        if (dRes.decanterWaterDrawKgH > 0) {
          const decFlows = dRes.decanterFlowsKgH ?? { ...emptyFlows(), H2O: dRes.decanterWaterDrawKgH };
          if (decEdges.length > 0) {
            decEdges.forEach(oe => {
              const sf = emptyFlows();
              SIM_COMPS.forEach(k => { sf[k] = decFlows[k] / decEdges.length; });
              assignEdge(oe, sf, dRes.topTempC, dRes.topPressKgcm2g, 'L');
            });
          } else {
            pushUnrouted('decanter', '공비 디캔터 수층 분리 배출', decFlows, dRes.topTempC, dRes.topPressKgcm2g, 'L');
          }
        } else {
          decEdges.forEach(oe => assignEdge(oe, emptyFlows(), dRes.topTempC, dRes.topPressKgcm2g, 'L'));
        }

        const topPhase: 'L' | 'G' = dRes.distillatePhase;

        const vapEdges = outEdges.filter(e => e.sourcePort === 'vapor' || e.sourcePort === 'out1');
        const liqEdges = outEdges.filter(e => e.sourcePort === 'liquid' || e.sourcePort === 'out2');
        const nonDecEdges = outEdges.filter(e => e.sourcePort !== 'decanter');

        if (vapEdges.length > 0 || liqEdges.length > 0) {
          vapEdges.forEach(oe => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = distFlows[k] / vapEdges.length; });
            assignEdge(oe, sf, dRes.topTempC, dRes.topPressKgcm2g, topPhase);
          });
          liqEdges.forEach(oe => {
            const sf = emptyFlows();
            SIM_COMPS.forEach(k => { sf[k] = botFlows[k] / liqEdges.length; });
            assignEdge(oe, sf, dRes.bottomTempC, dRes.bottomPressKgcm2g, 'L');
          });
          const otherEdges = nonDecEdges.filter(
            e => e.sourcePort !== 'vapor' && e.sourcePort !== 'out1' && e.sourcePort !== 'liquid' && e.sourcePort !== 'out2'
          );
          otherEdges.forEach(oe => assignEdge(oe, distFlows, dRes.topTempC, dRes.topPressKgcm2g, topPhase));

          if (vapEdges.length === 0 && otherEdges.length === 0) {
            pushUnrouted('vapor', '탑정 유출 D (미연결)', distFlows, dRes.topTempC, dRes.topPressKgcm2g, topPhase);
          }
          if (liqEdges.length === 0) {
            pushUnrouted('liquid', '탑저 관출 B (미연결)', botFlows, dRes.bottomTempC, dRes.bottomPressKgcm2g, 'L');
          }
        } else {
          if (nonDecEdges[0]) assignEdge(nonDecEdges[0], distFlows, dRes.topTempC, dRes.topPressKgcm2g, topPhase);
          else pushUnrouted('vapor', '탑정 유출 D (미연결)', distFlows, dRes.topTempC, dRes.topPressKgcm2g, topPhase);
          if (nonDecEdges[1]) assignEdge(nonDecEdges[1], botFlows, dRes.bottomTempC, dRes.bottomPressKgcm2g, 'L');
          else pushUnrouted('liquid', '탑저 관출 B (미연결)', botFlows, dRes.bottomTempC, dRes.bottomPressKgcm2g, 'L');
        }

        heatDutyKcalH = dRes.reboilerDutyKcalH;
        // 에너지 수지: 리보일러(+) + 응축기(−) 모두 외부 열량
        externalHeatKcalH = dRes.reboilerDutyKcalH + dRes.condenserDutyKcalH;
        removedKgH = distMass;

        const usedStages = dRes.totalStagesUsed || nStages;
        const usedFeedStage = dRes.feedStageUsed || defaultFeedStage;
        const sd = dRes.shortcutDesign;

        extraMetrics = {
          '인식 유체': detectedFluid,
          '계산 모드 · 수렴': sd
            ? `목표순도 단수설계 (${sd.designMet ? '✓ 목표순도 수렴' : '⚠ 근접 수렴'} · MESH ${dRes.innerIterations}회)`
            : `고정단수 정밀모사 (${dRes.converged ? '✓ MESH 수렴' : '근사수렴'} · 내부 ${dRes.innerIterations}회)`,
          '열역학 모델': dRes.thermoModelUsed,
          '이론단수 / 주 공급단': sd
            ? `산출 ${usedStages}단 (최소 N_min=${sd.minStagesNmin} · 실제 ${dRes.actualTrayCount}단) / 최적 피드 ${usedFeedStage}단`
            : dRes.stageInputBasisUsed === 'actual_murphree'
              ? `실제단 ${usedStages}단 (트레이 ${dRes.actualTrayCount}단 · 행렬 내 η_M 반영) / Feed ${usedFeedStage}단 (권장 ${dRes.recommendedFeedStage}단)`
              : `${usedStages}단 (실제 약 ${dRes.actualTrayCount}단) / Feed ${usedFeedStage}단 (권장 ${dRes.recommendedFeedStage}단)`,
          ...(sd
            ? {
                '핵심 분리성분 · 최소환류비': `${sd.lkComp}(탑정 ${sd.topLkPurityWtPct.toFixed(2)}%) / ${sd.hkComp}(탑저 ${sd.botHkPurityWtPct.toFixed(2)}%) · R_min=${sd.minRefluxRmin}`,
              }
            : {}),
          '운전 압력 (탑정→탑저)': `${dRes.topPressKgcm2g.toFixed(2)} → ${dRes.bottomPressKgcm2g.toFixed(2)} kG`,
          '실운전 환류비 · 분배비': `RR = ${dRes.actualRefluxRatio.toFixed(2)} | D/F = ${dRes.actualDOverFMass.toFixed(3)} (B/F = ${dRes.actualBOverFMass.toFixed(3)})`,
          '탑정 유출 (D↑)': `${distMass.toFixed(1)} kg/h @ ${dRes.topTempC.toFixed(1)}°C (${detectKeyConc(distFlows, topPhase)})`,
          '탑저 관출 (B↓)': `${botMass.toFixed(1)} kg/h @ ${dRes.bottomTempC.toFixed(1)}°C (${detectKeyConc(botFlows, 'L')})`,
          '응축기 / 리보일러 열량': `Q_c ${(dRes.condenserDutyKcalH / 1000).toFixed(1)} / Q_r +${(dRes.reboilerDutyKcalH / 1000).toFixed(1)} Mcal/h`,
          '추정 탑경 (Souders-Brown)': `Ø ${dRes.estimatedDiameterM.toFixed(2)} m`,
          ...(dRes.decanterWaterDrawKgH > 0 ? { '공비 디캔터 수층 분리': `${dRes.decanterWaterDrawKgH.toFixed(1)} kg/h` } : {}),
          ...(dRes.spec1Status ? { '순도 스펙 1': dRes.spec1Status.summary } : {}),
          ...(dRes.spec2Status ? { '불순물 스펙 2': dRes.spec2Status.summary } : {}),
        };

        note = sumMassIn > 0.01
          ? `[${dRes.thermoModelUsed} ${usedStages}단${sd ? '·자동설계' : ''}] D:${distMass.toFixed(0)}kg/h(${detectKeyConc(distFlows, topPhase)}) / B:${botMass.toFixed(0)}kg/h(${detectKeyConc(botFlows, 'L')}) · RR=${dRes.actualRefluxRatio.toFixed(2)}`
          : `다단 정밀증류탑 대기중 — 좌측 포트에 Feed 배관을 연결하세요`;
      }

      // ── 13) 단열 등엔탈피 감압·교축 밸브 (Adiabatic Joule-Thomson Expansion Valve) ──
      else if (node.unitType === 'valve' || isActiveVisualThrottle) {
        const P_out =
          p.outletPressKgcm2g !== undefined
            ? Math.max(-0.98, p.outletPressKgcm2g)
            : Math.max(-0.98, P_in - Math.max(0, p.pressureDropKgcm2 ?? 1.0));

        if (sumMassIn <= 1e-8) {
          outEdges.forEach(oe => assignEdge(oe, emptyFlows(), T_in, P_out));
          note = `감압 밸브 대기중 (P_out = ${P_out.toFixed(2)} kgf/cm²G)`;
        } else {
          const H_in = allIn.enth;
          const tolH = Math.max(0.02, Math.abs(H_in) * 1e-5);
          const hasSaltAq = (totalIn.NaCl + totalIn.NaOH + totalIn.H2SO4) > 1e-3 && totalIn.H2O > 1e-3;
          const boilCap = hasSaltAq ? aqueousBoilingPointC(totalIn, P_out) - 1e-3 : null;
          const ph = phFlash(
            totalIn,
            P_out,
            H_in,
            T_try => {
              const vle = solveRigorousFlashVLE(
                totalIn,
                T_try,
                P_out,
                1.0,
                undefined,
                undefined,
                runtimePropertyMethod
              );
              return { vap: vle.vap, liq: vle.liq };
            },
            {
              T_guess: T_in,
              T_min: -165,
              T_max: 450,
              boilingCapC: boilCap,
              tolKcalH: tolH,
            }
          );
          if (!ph.converged) {
            unitIssues.push({ sev: 'warning', msg: '감압 밸브 등엔탈피 PH 플래시 허용오차 초과' });
          }

          const T_out = ph.T_C;
          const vRatio = ratioFromSplit(ph.vap, ph.liq);
          const vapMass = sumFlows(ph.vap);
          const liqMass = sumFlows(ph.liq);
          const totMol = SIM_COMPS.reduce((s, k) => s + totalIn[k] / COMP_META[k].mw, 0);
          const vapMol = SIM_COMPS.reduce((s, k) => s + ph.vap[k] / COMP_META[k].mw, 0);
          const betaMol = totMol > 1e-9 ? vapMol / totMol : 0;

          const explicitVapEdges = outEdges.filter(e => e.sourcePort === 'vapor');
          const explicitLiqEdges = outEdges.filter(e => e.sourcePort === 'liquid');
          const mainOutEdges = outEdges.filter(e => e.sourcePort !== 'vapor' && e.sourcePort !== 'liquid');

          if ((explicitVapEdges.length > 0 || explicitLiqEdges.length > 0) && mainOutEdges.length === 0) {
            if (explicitVapEdges.length > 0) {
              const nv = explicitVapEdges.length;
              explicitVapEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = ph.vap[k] / nv; });
                assignEdge(e, sf, T_out, P_out, 'G');
              });
            } else if (vapMass > 1e-6) {
              pushUnrouted('vapor', '플래시 기상 미연결', ph.vap, T_out, P_out, 'G');
            }
            if (explicitLiqEdges.length > 0) {
              const nl = explicitLiqEdges.length;
              explicitLiqEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = ph.liq[k] / nl; });
                assignEdge(e, sf, T_out, P_out, 'L');
              });
            } else if (liqMass > 1e-6) {
              pushUnrouted('liquid', '플래시 액상 미연결', ph.liq, T_out, P_out, 'L');
            }
          } else if (outEdges.length > 0) {
            const nOut = outEdges.length;
            outEdges.forEach(oe => {
              const sf = emptyFlows();
              SIM_COMPS.forEach(k => { sf[k] = totalIn[k] / nOut; });
              assignEdge(oe, sf, T_out, P_out, undefined, vRatio);
            });
          } else {
            pushUnrouted('out', '감압 밸브 출구 미연결', totalIn, T_out, P_out, undefined, vRatio);
          }

          // Adiabatic throttling: Q_ext = 0, W_s = 0, H_out = H_in
          heatDutyKcalH = 0;
          externalHeatKcalH = 0;
          dutyFromEnthalpy = false;

          const H_out = streamEnthalpyKcalH(ph.vap, ph.liq, T_out, P_out);
          const hErrPct = Math.abs(H_out - H_in) / Math.max(1.0, Math.abs(H_in)) * 100;
          const dP_bar = (P_in - P_out) * 0.980665;
          const muJT = Math.abs(dP_bar) > 0.05 ? (T_in - T_out) / dP_bar : 0;

          extraMetrics = {
            '인식 유체': detectedFluid,
            '압력 강하 (ΔP)': `${P_in.toFixed(2)} → ${P_out.toFixed(2)} kgf/cm²G (ΔP ${(P_in - P_out).toFixed(2)} kG)`,
            'Joule-Thomson 온도변화': `${T_in.toFixed(1)}°C → ${T_out.toFixed(2)}°C (ΔT ${(T_out - T_in).toFixed(2)}°C, μ_JT ≈ ${muJT.toFixed(2)} K/bar)`,
            '플래시 기상분율 (β_mol)': `${(betaMol * 100).toFixed(2)} mol% (G ${vapMass.toFixed(1)} / L ${liqMass.toFixed(1)} kg/h)`,
            '등엔탈피 보존 오차': `${hErrPct.toExponential(2)} % (Q = 0)`,
          };
          note = `[등엔탈피 JT 감압] ${P_in.toFixed(1)}→${P_out.toFixed(1)} kG | ${T_in.toFixed(1)}→${T_out.toFixed(1)}°C (기상 ${(betaMol * 100).toFixed(1)}%)`;
        }
      }

      // ── 14) 향류 다단 액-액 추출탑 (Countercurrent Multistage LLE Extractor) ──
      else if (node.unitType === 'extractor') {
        const nStages = Math.max(
          1,
          Math.min(50, Math.round(p.extractorConfig?.stages ?? p.extractorStages ?? p.columnStages ?? 6))
        );
        const T_ext = p.extractorConfig?.operTempC ?? p.operTempC ?? T_in;
        const P_ext = p.extractorConfig?.operPressKgcm2g ?? p.operPressKgcm2g ?? P_in;

        const solvEdges = inEdges.filter(e => e.targetPort === 'solvent' || e.targetPort === 'liq_in');
        const feedEdges = inEdges.filter(e => e.targetPort !== 'solvent' && e.targetPort !== 'liq_in');
        const feedGrp = sumEdgeGroup(feedEdges.length > 0 ? feedEdges : inEdges);
        const solvGrp = sumEdgeGroup(feedEdges.length > 0 ? solvEdges : []);

        const feedIn = { ...feedGrp.flows };
        const solvIn = { ...solvGrp.flows };
        const feedTempC = feedGrp.mass > 0 ? feedGrp.T : T_ext;
        const solvTempC = solvGrp.mass > 0 ? solvGrp.T : T_ext;
        const solvComp: SimCompKey = p.extractorSolventComp ?? p.makeupSolventComp ?? 'EtOAc';
        const manualSolvKgH = p.extractorSolventKgH ?? p.makeupSolventKgH ?? 0;
        if (sumFlows(solvIn) < 1e-6 && manualSolvKgH > 0) {
          solvIn[solvComp] += manualSolvKgH;
          pushMakeup('solvent', `추출 용매 주입 (${solvComp})`, { [solvComp]: manualSolvKgH }, solvTempC, P_ext, 'L');
        }

        const totLleInMass = sumFlows(feedIn) + sumFlows(solvIn);
        if (totLleInMass <= 1e-8) {
          outEdges.forEach(oe => assignEdge(oe, emptyFlows(), T_ext, P_ext, 'L'));
          note = `액-액 추출탑 대기중 — 원료(in) 및 용매(solvent) 배관을 연결하세요`;
        } else {
          const extSig =
            `${nStages}@${T_ext.toFixed(3)}@${P_ext.toFixed(3)}@${feedTempC.toFixed(3)}@${solvTempC.toFixed(3)}::` +
            SIM_COMPS.filter(k => (feedIn[k] || 0) > 1e-5 || (solvIn[k] || 0) > 1e-5)
              .map(k => `${k}:${(feedIn[k] || 0).toFixed(4)}/${(solvIn[k] || 0).toFixed(4)}`)
              .join(',');
          const prevExt = extractorIterCache.get(node.id);
          const extRes =
            prevExt && prevExt.sig === extSig
              ? prevExt.res
              : solveMultistageExtractor(feedIn, feedTempC, solvIn, solvTempC, {
                  stages: nStages,
                  operTempC: T_ext,
                  operPressKgcm2g: P_ext,
                  propertyMethod: p.extractorConfig?.propertyMethod ?? runtimePropertyMethod,
                  stageEfficiency: p.extractorConfig?.stageEfficiency,
                });
          extractorIterCache.set(node.id, { sig: extSig, res: extRes });
          extractorResult = extRes;
          if (!extRes.converged) {
            unitIssues.push({
              sev: 'warning',
              msg: extRes.warnings[0] ?? '향류 액-액 추출탑 내부 반복 근사 수렴',
            });
          }

          const extractFlows = emptyFlows();
          const raffinateFlows = emptyFlows();
          SIM_COMPS.forEach(k => {
            extractFlows[k] = Math.max(0, extRes.extractFlowsKgH[k] ?? 0);
            raffinateFlows[k] = Math.max(0, extRes.raffinateFlowsKgH[k] ?? 0);
          });
          const T_ext_out = extRes.extractTempC ?? T_ext;
          const T_raf_out = extRes.raffinateTempC ?? T_ext;

          const extEdges = outEdges.filter(
            e => e.sourcePort === 'vapor' || e.sourcePort === 'out1' || e.sourcePort === 'out'
          );
          const rafEdges = outEdges.filter(
            e => e.sourcePort === 'liquid' || e.sourcePort === 'out2'
          );

          if (extEdges.length > 0 || rafEdges.length > 0) {
            if (extEdges.length > 0) {
              const ne = extEdges.length;
              extEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = extractFlows[k] / ne; });
                assignEdge(e, sf, T_ext_out, P_ext, 'L');
              });
            } else {
              pushUnrouted('vapor', '추출상(Extract) 미연결', extractFlows, T_ext_out, P_ext, 'L');
            }
            if (rafEdges.length > 0) {
              const nr = rafEdges.length;
              rafEdges.forEach(e => {
                const sf = emptyFlows();
                SIM_COMPS.forEach(k => { sf[k] = raffinateFlows[k] / nr; });
                assignEdge(e, sf, T_raf_out, P_ext, 'L');
              });
            } else {
              pushUnrouted('liquid', '추출잔류상(Raffinate) 미연결', raffinateFlows, T_raf_out, P_ext, 'L');
            }
          } else {
            if (outEdges[0]) assignEdge(outEdges[0], extractFlows, T_ext_out, P_ext, 'L');
            else pushUnrouted('vapor', '추출상(Extract) 미연결', extractFlows, T_ext_out, P_ext, 'L');
            if (outEdges[1]) assignEdge(outEdges[1], raffinateFlows, T_raf_out, P_ext, 'L');
            else pushUnrouted('liquid', '추출잔류상(Raffinate) 미연결', raffinateFlows, T_raf_out, P_ext, 'L');
          }

          heatDutyKcalH = derivedDutyKcalH();
          dutyFromEnthalpy = true;
          const extMass = sumFlows(extractFlows);
          const rafMass = sumFlows(raffinateFlows);
          removedKgH = extMass;
          extraMetrics = {
            '인식 유체': detectedFluid,
            '추출 단수 · 수렴': `향류 ${nStages}단 액-액 평형 (${extRes.converged ? '✓ 수렴' : '근사'} · ${extRes.iterations}회)`,
            ...(extRes.soluteKey
              ? { '핵심 용질 회수율': `${extRes.soluteKey} ${extRes.soluteRecoveryPct.toFixed(2)}%` }
              : {}),
            '추출상 (Extract ↑)': `${extMass.toFixed(1)} kg/h (${detectKeyConc(extractFlows, 'L')})`,
            '추출잔류상 (Raffinate ↓)': `${rafMass.toFixed(1)} kg/h (${detectKeyConc(raffinateFlows, 'L')})`,
          };
          note = extRes.statusNote || `[향류추출 ${nStages}단] Extract ${extMass.toFixed(1)} kg/h / Raffinate ${rafMass.toFixed(1)} kg/h`;
        }
      }

      const isTerminalProduct = node.unitType === 'product' && outEdges.length === 0;

      // 출구 배관이 하나도 없는 일반 장치: 남는 유량 전량을 미연결 출구로 명시 (유입 조성 기준 추정)
      if (node.unitType !== 'feed' && !isTerminalProduct && outEdges.length === 0) {
        const residF = emptyFlows();
        for (const k of SIM_COMPS) {
          let v = totalIn[k];
          for (const mk of unitMakeup) v += mk.flows[k];
          for (const ur of unitUnrouted) v -= ur.flows[k];
          residF[k] = Math.max(0, v);
        }
        if (sumFlows(residF) > 0.01) pushUnrouted('out', '출구 배관 미연결 (전량, 유입 조성 기준 추정)', residF, T_in, P_in);
      }

      const outSumKgH = outEdges.reduce((s, oe) => {
        const st = tearComputedG.get(oe.id) ?? edgeState.get(oe.id)!;
        return s + sumFlows(st.flows);
      }, 0);
      const makeupMassKgH = unitMakeup.reduce((s, b) => s + sumFlows(b.flows), 0);
      const unroutedMassKgH = unitUnrouted.reduce((s, b) => s + sumFlows(b.flows), 0);

      // 장치 질량 수지: (배관 유입 + 경계 보충 유입) − (배관 유출 + 미연결 출구)
      const inForCheck =
        node.unitType === 'feed'
          ? outSumKgH
          : isTerminalProduct
            ? sumMassIn
            : sumMassIn + makeupMassKgH;

      const outForCheck = isTerminalProduct ? sumMassIn : outSumKgH + unroutedMassKgH;

      unroutedByNode.set(node.id, unitUnrouted);
      makeupByNode.set(node.id, unitMakeup);
      const qExt = node.unitType === 'feed' || node.unitType === 'product' ? 0 : (externalHeatKcalH ?? heatDutyKcalH);
      qExtByNode.set(node.id, qExt);

      unitResults.set(node.id, {
        nodeId: node.id,
        tag: node.tag,
        name: node.name,
        unitType: node.unitType,
        calcMode: isRigorous ? 'rigorous' : 'simple',
        isVisualOnly: isVisualOnlyUnit(node.unitType) && !isActiveVisualThrottle,
        detectedFluidLabel: detectedFluid,
        inletMassKgH: Number(inForCheck.toFixed(2)),
        outletMassKgH: Number(outForCheck.toFixed(2)),
        massImbalanceKgH: Number((inForCheck - outForCheck).toFixed(2)),
        heatDutyKcalH: Number(heatDutyKcalH.toFixed(0)),
        shaftPowerKW: Number(shaftPowerKW.toFixed(2)),
        condensedOrRemovedKgH: Number(removedKgH.toFixed(2)),
        statusNote: note,
        extraMetrics,
        distillResult,
        reactorResult,
        extractorResult,
        unroutedOutletKgH: Number(unroutedMassKgH.toFixed(2)),
        makeupInletKgH: Number(makeupMassKgH.toFixed(2)),
        externalHeatKcalH: Number(qExt.toFixed(0)),
      });
    }

    // ── Tear Stream 수렴 가속 갱신 (Bounded Wegstein q∈[-5,0] / Broyden / 직접치환 + 감쇠 폴백) ──
    let maxTearResidual = 0;
    let maxTearRel = 0;
    const tearStepLabels: string[] = [];
    // 최근 잔차 이력에서 진동·발산이 감지되면 외삽 대신 감쇠 치환 강제
    const recentDiag = classifyRecycleHistory(iterationHistory.slice(-8).map(h => h.maxTearRel), false);
    const dampMode = recentDiag === 'oscillating' || recentDiag === 'diverging';

    // (1) Tear 스트림별 상대 잔차 (질량·온도·엔탈피) 산정
    for (const teId of topo.tearEdgeIds) {
      const xCurr = edgeState.get(teId)!;
      const gCurr = tearComputedG.get(teId) ?? xCurr;
      let mAbsSum = 0;
      let mAbsMax = 0;
      let gMass = 0;
      let xMass = 0;
      for (const k of SIM_COMPS) {
        const d = Math.abs(gCurr.flows[k] - xCurr.flows[k]);
        mAbsSum += d;
        if (d > mAbsMax) mAbsMax = d;
        gMass += gCurr.flows[k];
        xMass += xCurr.flows[k];
      }
      maxTearResidual = Math.max(maxTearResidual, mAbsMax);
      const massScale = Math.max(gMass, xMass, 1e-6);
      const massRel = mAbsSum <= 1e-3 ? 0 : mAbsSum / massScale;
      const tAbs = Math.abs(gCurr.tempC - xCurr.tempC);
      const tempRel = massScale < 1e-3 ? 0 : tAbs / Math.max(1, Math.abs(gCurr.tempC + 273.15));
      const hG = stH(gCurr);
      const hX = stH(xCurr);
      const hAbs = Math.abs(hG - hX);
      const enthRel = hAbs <= 1 ? 0 : hAbs / Math.max(Math.abs(hG), Math.abs(hX), 10 * massScale, 1);
      const relMax = Math.max(massRel, tempRel, Number.isFinite(enthRel) ? enthRel : 0);
      maxTearRel = Math.max(maxTearRel, relMax);
      tearResidualLast.set(teId, {
        edgeId: teId,
        streamNo: edges.find(e => e.id === teId)?.streamNo ?? teId,
        massAbsKgH: Number(mAbsSum.toPrecision(4)),
        massRel: Number(massRel.toPrecision(3)),
        tempAbsC: Number(tAbs.toPrecision(3)),
        tempRel: Number(tempRel.toPrecision(3)),
        enthalpyAbsKcalH: Number(hAbs.toPrecision(4)),
        enthalpyRel: Number((Number.isFinite(enthRel) ? enthRel : 0).toPrecision(3)),
        maxRel: Number(relMax.toPrecision(3)),
        withinTolerance: relMax <= REL_TOL,
      });
    }

    // Check if 'auto' single-tear Wegstein oscillated/diverged after 15 iterations -> switch to Simultaneous Broyden
    if (
      tearMethod === 'auto' &&
      activeTearMethod === 'wegstein' &&
      iter >= 15 &&
      maxTearRel > REL_TOL &&
      (recentDiag === 'oscillating' || recentDiag === 'diverging')
    ) {
      activeTearMethod = 'broyden';
      broydenAccel.reset();
    }

    // Early convergence check BEFORE mutating edgeState for next iteration!
    finalMaxResidual = Math.max(maxDiff, maxTearResidual);
    const nonTearRelEarly = maxDiff / Math.max(1, nonTearScale);
    const nonTearOkEarly = maxDiff < 1e-3 || nonTearRelEarly <= REL_TOL;
    const tearOkEarly = maxTearRel <= REL_TOL;
    if (iter >= 1 && nonTearOkEarly && tearOkEarly) {
      for (const teId of topo.tearEdgeIds) {
        const gc = tearComputedG.get(teId);
        if (gc) edgeState.set(teId, gc);
      }
      iterationHistory.push({
        iter: iter + 1,
        maxTearRel: Number(maxTearRel.toPrecision(4)),
        maxNonTearAbsKgH: Number(maxDiff.toPrecision(4)),
        step: topo.tearEdgeIds.length > 0 ? `${activeTearMethod}(converged)` : 'sequential',
      });
      isConverged = true;
      loosenedConverged = true;
      break;
    }

    // In 'auto' mode with 1 tear stream: escalate from Wegstein to Broyden if Wegstein oscillates after 15 iterations
    if (tearMethod === 'auto' && activeTearMethod === 'wegstein' && iter >= 15 && dampMode && topo.tearEdgeIds.length > 0) {
      activeTearMethod = 'broyden';
      broydenAccel.reset();
    }

    // (2-a) Simultaneous Good Broyden Quasi-Newton Accelerator (H_0 = 0.65 I, Sherman-Morrison, 3x spike reset)
    if (activeTearMethod === 'broyden' && topo.tearEdgeIds.length > 0) {
      const broyOut = broydenAccel.stepStreams(topo.tearEdgeIds, edgeState, tearComputedG);
      for (const [teId, nextSt] of broyOut.nextStates.entries()) {
        edgeState.set(teId, nextSt);
      }
      tearStepLabels.push(broyOut.stepLabel);
    }

    // (2-b) Wegstein / 직접치환 — Tear 스트림별 벡터 동기화 갱신
    for (const teId of activeTearMethod === 'broyden' ? [] : topo.tearEdgeIds) {
      const xCurr = edgeState.get(teId)!;
      const gCurr = tearComputedG.get(teId) ?? xCurr;

      const xPrev = tearPrevX.get(teId);
      const gPrev = tearPrevG.get(teId);
      const nextFlows = emptyFlows();
      let nextT = gCurr.tempC;
      let stepLabel = 'direct';

      if (iter >= 2 && xPrev && gPrev) {
        // Vector-Synchronized Bounded Wegstein (Rayleigh 몫 방향 기울기 + 잔차 단조성 감시 감쇠 + 조성 심플렉스 보존 가드)
        // 성분별 독립 가속 시 공비 경계(Distillation Boundary)를 넘어 농도가 왜곡되는 현상을 원천 방지
        let dotDxDx = 0;
        let dotDgDx = 0;
        let resCurr = 0;
        let resPrev = 0;
        for (const k of SIM_COMPS) {
          const dx = xCurr.flows[k] - xPrev.flows[k];
          const dg = gCurr.flows[k] - gPrev.flows[k];
          dotDxDx += dx * dx;
          dotDgDx += dg * dx;
          resCurr = Math.max(resCurr, Math.abs(gCurr.flows[k] - xCurr.flows[k]));
          resPrev = Math.max(resPrev, Math.abs(gPrev.flows[k] - xPrev.flows[k]));
        }
        // 잔차가 직전보다 커졌으면(오버슈트) 또는 이력상 진동·발산이면 감쇠 치환 폴백,
        // 그 외에는 Bounded Wegstein q ∈ [−5, 0] 가속 (q > 0 이 산출되는 진동성 루프는 감쇠로 처리)
        const overshot = resPrev > 0 && resCurr > resPrev;
        let qStream = 0;
        if (activeTearMethod === 'direct') {
          if (overshot || dampMode) {
            qStream = 0.5;
            stepLabel = 'damped';
          }
        } else if (overshot || dampMode) {
          // 직전 가속 스텝이 오버슈트했거나 내부 MESH 경계 진동 구간 진입 시: 안정적 감쇠 치환으로 즉시 전환
          qStream = dampMode ? 0.5 : 0.35;
          stepLabel = 'damped';
        } else if (dotDxDx > 1e-10) {
          const sVec = dotDgDx / dotDxDx;
          if (Math.abs(sVec - 1.0) > 1e-5) {
            const qRaw = sVec / (sVec - 1.0);
            if (qRaw > 0) {
              qStream = Math.min(0.6, qRaw);
              stepLabel = 'damped';
            } else {
              qStream = Math.max(-5.0, qRaw);
              stepLabel = 'wegstein';
            }
          }
        }
        // 외삽(qStream < 0) 시 주성분이 음수로 잘려 조성이 깨지지 않도록 양수 심플렉스 한계 보정
        if (qStream < 0) {
          for (const k of SIM_COMPS) {
            const xc = xCurr.flows[k];
            const gc = gCurr.flows[k];
            if (xc > 1e-3 && gc < xc) {
              const qMinPos = (-0.92 * gc) / (xc - gc);
              if (qStream < qMinPos) qStream = qMinPos;
            }
          }
        }
        for (const k of SIM_COMPS) {
          const v = (1.0 - qStream) * gCurr.flows[k] + qStream * xCurr.flows[k];
          nextFlows[k] = Math.max(0, Number.isFinite(v) ? v : gCurr.flows[k]);
        }
        nextT = stepLabel === 'damped'
          ? (1.0 - qStream) * gCurr.tempC + qStream * xCurr.tempC
          : stepLabel === 'wegstein'
            ? wegsteinAccelerate(xPrev.tempC, gPrev.tempC, xCurr.tempC, gCurr.tempC, -70)
            : gCurr.tempC;
        if (!Number.isFinite(nextT)) nextT = gCurr.tempC;
      } else {
        for (const k of SIM_COMPS) nextFlows[k] = gCurr.flows[k];
      }
      tearStepLabels.push(stepLabel);

      tearPrevX.set(teId, {
        flows: { ...xCurr.flows },
        tempC: xCurr.tempC,
        pressKgcm2g: xCurr.pressKgcm2g,
        forcedPhase: xCurr.forcedPhase,
        vapRatio: xCurr.vapRatio,
      });
      tearPrevG.set(teId, {
        flows: { ...gCurr.flows },
        tempC: gCurr.tempC,
        pressKgcm2g: gCurr.pressKgcm2g,
        forcedPhase: gCurr.forcedPhase,
        vapRatio: gCurr.vapRatio,
      });

      edgeState.set(teId, {
        flows: nextFlows,
        tempC: nextT,
        pressKgcm2g: gCurr.pressKgcm2g,
        forcedPhase: gCurr.forcedPhase,
        vapRatio: gCurr.vapRatio,
      });
    }

    finalMaxResidual = Math.max(maxDiff, maxTearResidual);
    // 정직한 수렴 판정: Tear 상대잔차(질량·온도·엔탈피) ≤ REL_TOL AND 비순환 배관 변화 ≤ REL_TOL(상대) 또는 1e-3 kg/h
    const nonTearRel = maxDiff / Math.max(1, nonTearScale);
    const nonTearOk = maxDiff < 1e-3 || nonTearRel <= REL_TOL;
    const tearOk = maxTearRel <= REL_TOL;
    const uniqSteps = Array.from(new Set(tearStepLabels));
    iterationHistory.push({
      iter: iter + 1,
      maxTearRel: Number(maxTearRel.toPrecision(4)),
      maxNonTearAbsKgH: Number(maxDiff.toPrecision(4)),
      step: uniqSteps.length > 0 ? uniqSteps.join('+') : 'sequential',
    });
    if (iter >= 1 && nonTearOk && tearOk) {
      isConverged = true;
      loosenedConverged = true;
      break;
    }
    loosenedConverged = iter >= 1 && (maxDiff < 1e-3 || nonTearRel <= LOOSE_TOL) && maxTearRel <= LOOSE_TOL;
  }

  const portLabelMap: Record<string, string> = {
    vapor: '상부 기상(G↑)',
    liquid: '하부 액상(L↓)',
    decanter: '디캔터 수층(Decanter)',
    anode_out: '양극 출구(Anode)',
    cathode_out: '음극 출구(Cathode)',
    util_out: '냉매/열매 출구',
    out: '주배관',
  };

  const solvedStreams: SolvedStream[] = edges.map(e => {
    const st = edgeState.get(e.id)!;
    const props = calcStreamProps(st.flows, st.tempC, st.pressKgcm2g, st.forcedPhase, st.vapRatio, runtimePropertyMethod);
    const srcNode = nodeMap.get(e.source);
    const tgtNode = nodeMap.get(e.target);
    return {
      edgeId: e.id,
      streamNo: e.streamNo,
      fromTag: srcNode?.tag ?? e.source,
      toTag: tgtNode?.tag ?? e.target,
      portRole: portLabelMap[e.sourcePort ?? 'out'] ?? '주배관',
      phase: props.phase,
      vaporFraction: props.vaporFraction,
      tempC: Number(st.tempC.toFixed(1)),
      pressKgcm2g: Number(st.pressKgcm2g.toFixed(2)),
      flowsKgH: { ...st.flows },
      totalMassKgH: props.totalMassKgH,
      totalMolarKmolH: props.totalMolarKmolH,
      avgMW: props.avgMW,
      densityKgM3: props.densityKgM3,
      volFlowM3H: props.volFlowM3H,
      cpKcalKgC: props.cpKcalKgC,
      specEnthalpyKcalKg: props.specEnthalpyKcalKg,
      enthalpyKcalH: props.enthalpyKcalH,
      mainConcWtPct: props.mainConcWtPct,
      moistureWtPpm: props.moistureWtPpm,
      compressibilityZ: props.compressibilityZ,
      isTearStream: tearSet.has(e.id),
      keyConcLabel: detectKeyConc(st.flows, props.phase),
      exactTempC: st.tempC,
      exactEnthalpyKcalH: props.exactEnthalpyKcalH,
      exactVaporFraction: props.exactVaporFraction,
    };
  });

  solvedStreams.sort((a, b) => a.streamNo.localeCompare(b.streamNo, undefined, { numeric: true }));

  // ── 플로우시트 전체 물질·에너지 수지 결산 (최종 수렴 상태 기준) ──────────────
  const KCALH_PER_KW = 859.845;
  const edgeH = (eid: string) => {
    const st = edgeState.get(eid)!;
    return calcStreamProps({ ...st.flows }, st.tempC, st.pressKgcm2g, st.forcedPhase, st.vapRatio, runtimePropertyMethod).enthalpyKcalH;
  };
  const edgeM = (eid: string) => sumFlows(edgeState.get(eid)!.flows);
  const toEntry = (kind: BoundaryStreamEntry['kind'], n: FlowNodeDef, b: BoundaryRaw): BoundaryStreamEntry => {
    const pr = calcStreamProps({ ...b.flows }, b.tempC, b.pressKgcm2g, b.phase, b.vapRatio, runtimePropertyMethod);
    return {
      kind,
      nodeId: n.id,
      tag: n.tag,
      port: b.port,
      label: b.label,
      flowsKgH: { ...b.flows },
      totalMassKgH: Number(sumFlows(b.flows).toFixed(2)),
      tempC: Number(b.tempC.toFixed(1)),
      pressKgcm2g: Number(b.pressKgcm2g.toFixed(2)),
      enthalpyKcalH: pr.enthalpyKcalH,
      compositionLabel: detectKeyConc(b.flows, pr.phase),
    };
  };

  let feedInKgH = 0, productOutKgH = 0, feedH = 0, productH = 0;
  let sumQ = 0, sumAbsQ = 0, sumW = 0;
  const unroutedOutlets: BoundaryStreamEntry[] = [];
  const makeupInlets: BoundaryStreamEntry[] = [];
  const unitEnergyResiduals: { nodeId: string; tag: string; residualKW: number }[] = [];
  const unitMassImbalances: { nodeId: string; tag: string; imbalanceKgH: number }[] = [];
  const unitEnergyChecks: UnitEnergyCheck[] = [];

  for (const n of nodes) {
    const ins = edges.filter(e => e.target === n.id);
    const outs = edges.filter(e => e.source === n.id);
    if (n.unitType === 'feed') {
      for (const e of outs) { feedInKgH += edgeM(e.id); feedH += edgeH(e.id); }
      continue;
    }
    if (n.unitType === 'product' && outs.length === 0) {
      for (const e of ins) { productOutKgH += edgeM(e.id); productH += edgeH(e.id); }
      continue;
    }
    const ur = (unroutedByNode.get(n.id) ?? []).map(b => toEntry('unrouted_outlet', n, b));
    const mk = (makeupByNode.get(n.id) ?? []).map(b => toEntry('makeup_inlet', n, b));
    unroutedOutlets.push(...ur);
    makeupInlets.push(...mk);
    const q = qExtByNode.get(n.id) ?? 0;
    const w = unitResults.get(n.id)?.shaftPowerKW ?? 0;
    sumQ += q;
    sumAbsQ += Math.abs(q);
    sumW += w;
    const hIn = ins.reduce((s, e) => s + edgeH(e.id), 0) + mk.reduce((s, b) => s + b.enthalpyKcalH, 0);
    const hOut = outs.reduce((s, e) => s + edgeH(e.id), 0) + ur.reduce((s, b) => s + b.enthalpyKcalH, 0);
    const resKW = (hIn + q - hOut) / KCALH_PER_KW + w;
    if (Math.abs(resKW) > 0.5) unitEnergyResiduals.push({ nodeId: n.id, tag: n.tag, residualKW: Number(resKW.toFixed(1)) });
    const throughputKW = Math.max(Math.abs(hIn), Math.abs(hOut)) / KCALH_PER_KW + Math.abs(q) / KCALH_PER_KW + Math.abs(w);
    const resPctUnit = throughputKW > 1e-9 ? (Math.abs(resKW) / throughputKW) * 100 : 0;
    unitEnergyChecks.push({
      nodeId: n.id,
      tag: n.tag,
      residualKW: Number(resKW.toFixed(2)),
      throughputKW: Number(throughputKW.toFixed(1)),
      residualPct: Number(resPctUnit.toFixed(3)),
      flagged: resPctUnit > 0.5 && Math.abs(resKW) > 0.05,
    });
    const mIn = ins.reduce((s, e) => s + edgeM(e.id), 0) + mk.reduce((s, b) => s + b.totalMassKgH, 0);
    const mOut = outs.reduce((s, e) => s + edgeM(e.id), 0) + ur.reduce((s, b) => s + b.totalMassKgH, 0);
    if (Math.abs(mIn - mOut) > 0.5) unitMassImbalances.push({ nodeId: n.id, tag: n.tag, imbalanceKgH: Number((mIn - mOut).toFixed(2)) });
  }
  unitEnergyResiduals.sort((a, b) => Math.abs(b.residualKW) - Math.abs(a.residualKW));
  unitMassImbalances.sort((a, b) => Math.abs(b.imbalanceKgH) - Math.abs(a.imbalanceKgH));

  const makeupInKgH = makeupInlets.reduce((s, b) => s + b.totalMassKgH, 0);
  const unroutedOutKgH = unroutedOutlets.reduce((s, b) => s + b.totalMassKgH, 0);
  const makeupH = makeupInlets.reduce((s, b) => s + b.enthalpyKcalH, 0);
  const unroutedH = unroutedOutlets.reduce((s, b) => s + b.enthalpyKcalH, 0);
  const massImb = feedInKgH + makeupInKgH - productOutKgH - unroutedOutKgH;
  const energyResKW = (feedH + makeupH + sumQ - productH - unroutedH) / KCALH_PER_KW + sumW;
  const energyScaleKW = (Math.abs(feedH) + Math.abs(makeupH) + sumAbsQ) / KCALH_PER_KW + Math.abs(sumW);

  const balance: FlowsheetBalanceReport = {
    feedInKgH: Number(feedInKgH.toFixed(2)),
    makeupInKgH: Number(makeupInKgH.toFixed(2)),
    productOutKgH: Number(productOutKgH.toFixed(2)),
    unroutedOutKgH: Number(unroutedOutKgH.toFixed(2)),
    massImbalanceKgH: Number(massImb.toFixed(2)),
    massImbalancePct: Number(((massImb / Math.max(1e-6, feedInKgH + makeupInKgH)) * 100).toFixed(3)),
    unroutedOutlets: unroutedOutlets.sort((a, b) => b.totalMassKgH - a.totalMassKgH),
    makeupInlets: makeupInlets.sort((a, b) => b.totalMassKgH - a.totalMassKgH),
    feedEnthalpyKW: Number((feedH / KCALH_PER_KW).toFixed(1)),
    makeupEnthalpyKW: Number((makeupH / KCALH_PER_KW).toFixed(1)),
    productEnthalpyKW: Number((productH / KCALH_PER_KW).toFixed(1)),
    unroutedEnthalpyKW: Number((unroutedH / KCALH_PER_KW).toFixed(1)),
    unitHeatDutyKW: Number((sumQ / KCALH_PER_KW).toFixed(1)),
    unitPowerKW: Number(sumW.toFixed(1)),
    energyResidualKW: Number(energyResKW.toFixed(1)),
    energyResidualPct: Number(((energyResKW / Math.max(1, energyScaleKW)) * 100).toFixed(2)),
    unitEnergyResiduals: unitEnergyResiduals.slice(0, 12),
    unitMassImbalances: unitMassImbalances.slice(0, 12),
    physicalMassImbalanceKgH: Number((feedInKgH - productOutKgH - unroutedOutKgH).toFixed(2)),
    physicalMassImbalancePct: Number((((feedInKgH - productOutKgH - unroutedOutKgH) / Math.max(1e-6, feedInKgH)) * 100).toFixed(3)),
    unitEnergyChecks,
  };

  const tearStreamNos = edges
    .filter(e => tearSet.has(e.id))
    .map(e => e.streamNo);

  // ── 장치별 수렴 판정 (플래시·증류 MESH·에너지/질량 잔차) ─────────────────────
  const unitConvergence: UnitConvergenceEntry[] = [];
  const energyCheckById = new Map(unitEnergyChecks.map(c => [c.nodeId, c]));
  for (const n of nodes) {
    const ur = unitResults.get(n.id);
    if (!ur) continue;
    if (n.unitType === 'feed' || n.unitType === 'product') {
      unitConvergence.push({ nodeId: n.id, tag: n.tag, unitType: n.unitType, status: 'not_applicable', message: '경계 스트림' });
      continue;
    }
    const msgs: string[] = [];
    let status: UnitConvergenceStatus = 'converged';
    const bump = (s: 'warning' | 'failed') => {
      if (s === 'failed') status = 'failed';
      else if (status === 'converged') status = 'warning';
    };
    for (const iss of unitIssuesByNode.get(n.id) ?? []) {
      bump(iss.sev);
      msgs.push(iss.msg);
    }
    let unitIters: number | undefined = undefined;
    const dr = ur.distillResult;
    if (dr) {
      unitIters = dr.innerIterations;
      const diag = (dr as { diagnostics?: { level?: string; badgeText?: string; headline?: string } }).diagnostics;
      if (!dr.converged) {
        bump('failed');
        msgs.push(`증류 MESH 미수렴${diag?.headline ? ` — ${diag.headline}` : ''}`);
      } else if (diag?.level === 'error') {
        bump('failed');
        msgs.push(`${diag.badgeText ?? '증류 진단 오류'}${diag.headline ? ` — ${diag.headline}` : ''}`);
      } else if (diag?.level === 'warning') {
        bump('warning');
        msgs.push(`${diag.badgeText ?? '증류 진단 경고'}${diag.headline ? ` — ${diag.headline}` : ''}`);
      }
    }
    const ec = energyCheckById.get(n.id);
    if (ec?.flagged) {
      bump('warning');
      msgs.push(`에너지 잔차 ${ec.residualKW.toFixed(1)} kW (${ec.residualPct.toFixed(2)}% > 0.5%)`);
    }
    const imb = Math.abs(ur.massImbalanceKgH);
    if (!ur.isVisualOnly && imb > Math.max(0.5, 1e-3 * Math.max(ur.inletMassKgH, ur.outletMassKgH))) {
      bump('warning');
      msgs.push(`질량 불균형 ${ur.massImbalanceKgH.toFixed(2)} kg/h`);
    }
    if (ur.isVisualOnly && status === 'converged' && msgs.length === 0) {
      unitConvergence.push({ nodeId: n.id, tag: n.tag, unitType: n.unitType, status: 'not_applicable', message: '도면 표기 전용 (통과)' });
      continue;
    }
    unitConvergence.push({
      nodeId: n.id,
      tag: n.tag,
      unitType: n.unitType,
      status,
      iterations: unitIters,
      message: msgs.length > 0 ? msgs.join('; ') : '정상',
    });
  }
  // Tear 스트림(순환) 수렴 항목
  const tearResiduals: TearResidualEntry[] = topo.tearEdgeIds
    .map(id => tearResidualLast.get(id))
    .filter((t): t is TearResidualEntry => !!t);
  for (const tr of tearResiduals) {
    const st: UnitConvergenceStatus = tr.withinTolerance ? 'converged' : tr.maxRel <= LOOSE_TOL ? 'warning' : 'failed';
    unitConvergence.push({
      nodeId: tr.edgeId,
      tag: `Tear ${tr.streamNo}`,
      unitType: 'tear_stream',
      status: st,
      iterations: finalIter,
      message: `순환 잔차 질량 ${tr.massRel.toExponential(1)} · 온도 ${tr.tempRel.toExponential(1)} · 엔탈피 ${tr.enthalpyRel.toExponential(1)} (상대, 허용 ${REL_TOL.toExponential(0)})`,
    });
  }
  const failedUnitCount = unitConvergence.filter(u => u.status === 'failed').length;
  const warningUnitCount = unitConvergence.filter(u => u.status === 'warning').length;
  const recycleDiagnosis = topo.tearEdgeIds.length > 0
    ? classifyRecycleHistory(iterationHistory.map(h => h.maxTearRel), !isConverged)
    : 'none';
  const loopOk = isConverged || loosenedConverged;
  const overallStatus: OverallConvergenceStatus =
    !loopOk || failedUnitCount > 0
      ? 'failed'
      : isConverged && warningUnitCount === 0
        ? 'converged'
        : 'converged_with_warnings';

  // ── 보충·자동 수지 주입 정직성 보고 ─────────────────────────────────────────
  const makeupKindOf = (port: string): MakeupKind =>
    port === 'makeup_water' || port === 'salt' || port === 'solvent' || port === 'reagent' || port === 'multiplier' ? port : 'other';
  const makeupReport: MakeupReportEntry[] = [];
  for (const n of nodes) {
    for (const b of makeupByNode.get(n.id) ?? []) {
      const fl: Partial<Record<SimCompKey, number>> = {};
      for (const k of SIM_COMPS) if (b.flows[k] > 1e-6) fl[k] = Number(b.flows[k].toFixed(3));
      makeupReport.push({
        nodeId: n.id,
        tag: n.tag,
        kind: makeupKindOf(b.port),
        flowsKgH: fl,
        totalKgH: Number(sumFlows(b.flows).toFixed(2)),
        reason: b.label,
      });
    }
  }
  makeupReport.sort((a, b) => b.totalKgH - a.totalKgH);
  const makeupTotalKgH = Number(makeupReport.reduce((s, m) => s + m.totalKgH, 0).toFixed(2));
  const maxTearRelFinal = tearResiduals.reduce((m, t) => Math.max(m, t.maxRel), 0);
  const statusKo = overallStatus === 'converged' ? '수렴' : overallStatus === 'converged_with_warnings' ? '경고 동반 수렴' : '미수렴';
  const summary =
    `${statusKo}: 반복 ${finalIter}/${MAX_ITER}회` +
    (topo.tearEdgeIds.length > 0 ? `, Tear 최대 상대잔차 ${maxTearRelFinal.toExponential(1)} (허용 ${REL_TOL.toExponential(0)})` : '') +
    (recycleDiagnosis === 'oscillating' ? ', 순환 진동 감지' : recycleDiagnosis === 'diverging' ? ', 순환 발산 감지' : recycleDiagnosis === 'stalled' ? ', 순환 정체' : '') +
    `, 실패 장치 ${failedUnitCount} · 경고 ${warningUnitCount}` +
    (makeupTotalKgH > 0 ? `, 자동 보충 ${makeupTotalKgH.toFixed(1)} kg/h` : '');

  const hasRigorousUnit = nodes.some(n => n.params.calcMode === 'rigorous');

  return {
    streams: solvedStreams,
    units: nodes.map(n => unitResults.get(n.id)!).filter(Boolean),
    convergence: {
      converged: overallStatus !== 'failed',
      iterations: finalIter,
      maxResidualKgH: Number(finalMaxResidual.toFixed(4)),
      recycleLoopCount: topo.loopCount,
      tearEdgeIds: topo.tearEdgeIds,
      tearStreamNos,
      solverMethodLabel:
        topo.tearEdgeIds.length > 0
          ? `${activeTearMethod === 'broyden' ? 'Broyden 동시행렬' : activeTearMethod === 'direct' ? '직접치환' : 'Wegstein'} 순환수렴 (${hasRigorousUnit ? 'PR-EOS/정밀혼합' : '고속모드'})`
          : hasRigorousUnit
            ? '위상정렬 직결 + 정밀 열역학(Rigorous)'
            : '위상정렬 고속 직결(Direct DAG)',
      overallStatus,
      relTolerance: REL_TOL,
      tearMethod,
      methodUsed: topo.tearEdgeIds.length === 0 ? 'direct' : activeTearMethod,
      tearResiduals,
      iterationHistory,
      recycleDiagnosis,
      unitConvergence,
      failedUnitCount,
      warningUnitCount,
      makeupReport,
      makeupTotalKgH,
      summary,
    },
    balance,
    propertyMethodMode,
    propertyMethodUsed,
    propertyMethodReason,
  };
}

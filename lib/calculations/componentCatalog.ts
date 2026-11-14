import type { SimCompKey } from './flowsheetSolver';

export type SimPropertyMethod = 'AUTO' | 'ENRTL' | 'NRTL' | 'PR' | 'SRK';
export type ResolvedPropertyMethod = 'ENRTL' | 'NRTL' | 'PR' | 'SRK';

export type CompChemicalFamily =
  | 'electrolyte_inorg'
  | 'chlor_ech'
  | 'gas_syngas'
  | 'hydrocarbon'
  | 'aromatic'
  | 'polar_solvent';

export interface PropertyMethodMeta {
  code: ResolvedPropertyMethod;
  labelKo: string;
  shortKo: string;
  formulaDesc: string;
  bestForKo: string;
  accent: string;
  bg: string;
  border: string;
}

export const PROPERTY_METHOD_INFO: Record<ResolvedPropertyMethod, PropertyMethodMeta> = {
  ENRTL: {
    code: 'ENRTL',
    labelKo: 'ENRTL (전해질 수용액 · 다상 활동도)',
    shortKo: '전해질 · 산/염기 수용액',
    formulaDesc: 'Pitzer-Debye-Hückel 이온 활동도 + Extended NRTL(a_ij + b_ij/T) + Sechenov 염석 + 용해열',
    bestForKo: '식염전해(NaCl·NaOH), 염산(HCl 공비·흡수), 황산 건조, 암모니아수, 유기염소-염수 2액상 분리',
    accent: '#0F766E',
    bg: '#F0FDFA',
    border: '#5EEAD4',
  },
  NRTL: {
    code: 'NRTL',
    labelKo: 'NRTL (비이상 액상 활동도 γ-φ)',
    shortKo: '극성 유기용제 · 공비/LLE',
    formulaDesc: 'Extended NRTL(τ_ij = a_ij + b_ij/T) + 25-그룹 Hansen UNIFAC 실시간 보완 + Poynting/PR 기상 퓨개시티 + LLE',
    bestForKo: '알코올(MeOH·EtOH·IPA)-물 공비증류, 아세톤·초산·초산에틸, 클로로포름, ECH·클로로히드린 정제, 유수분리(LLE)',
    accent: '#7C3AED',
    bg: '#F5F3FF',
    border: '#C4B5FD',
  },
  PR: {
    code: 'PR',
    labelKo: 'PR (Peng-Robinson 3차 상태방정식)',
    shortKo: '탄화수소 · 방향족 · 액화가스',
    formulaDesc: 'P = RT/(v-b) - aα(T,ω)/[v(v+b)+b(v-b)], 이진 상호작용 k_ij, 기액 퓨개시티(φ^L=φ^V) 및 잔류 엔탈피',
    bestForKo: '천연가스(CH₄), LPG(에탄·프로판·부탄), 헥산·헵탄, BTX 방향족(벤젠·톨루엔·자일렌), 액화 Cl₂·CO₂·무수 HCl',
    accent: '#1D4ED8',
    bg: '#EFF6FF',
    border: '#93C5FD',
  },
  SRK: {
    code: 'SRK',
    labelKo: 'SRK (Soave-Redlich-Kwong 3차 상태방정식)',
    shortKo: '수소 · 합성가스 · 경질 올레핀',
    formulaDesc: 'P = RT/(v-b) - aα(T)/[v(v+b)], Graboski-Daubert H₂ 양자보정 α_H2, 이진 상호작용 k_ij 및 잔류 엔탈피',
    bestForKo: '고압 수소(H₂), 합성가스(CO·H₂·CH₄·N₂), 에틸렌·프로필렌 올레핀 분리, 석유화학 가스 공정',
    accent: '#0369A1',
    bg: '#F0F9FF',
    border: '#7DD3FC',
  },
};

export interface CompCatalogEntry {
  cas: string;
  tbC: number;
  family: CompChemicalFamily;
  familyLabelKo: string;
  reliableMethods: ResolvedPropertyMethod[];
  isElectrolyte?: boolean;
  isPermanentGas?: boolean;
  isPolarOrganic?: boolean;
  isHydrocarbon?: boolean;
  noteKo: string;
}

export const COMP_FAMILY_LABELS: Record<CompChemicalFamily, string> = {
  electrolyte_inorg: '전해질 · 산 · 무기염',
  chlor_ech: '염소 · ECH · 클로로히드린',
  gas_syngas: '산업가스 · 합성가스',
  hydrocarbon: '파라핀 · 올레핀 탄화수소',
  aromatic: 'BTX 방향족 탄화수소',
  polar_solvent: '알코올 · 케톤 · 극성용제',
};

export const COMP_CATALOG_META: Record<SimCompKey, CompCatalogEntry> = {
  // 1) 기존 전해 · 무기 · ECH 19종
  H2O: {
    cas: '7732-18-5',
    tbC: 100.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL', 'PR', 'SRK'],
    noteKo: '공정수 · 수증기 · 수용액 용매 표준',
  },
  NaCl: {
    cas: '7647-14-5',
    tbC: 1465.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '원염 브라인 전해질 (Pitzer 삼투·염석·용해열)',
  },
  NaOH: {
    cas: '1310-73-2',
    tbC: 1388.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '가성소다 강알칼리 전해질 (비점상승·희석열)',
  },
  Cl2: {
    cas: '7782-50-5',
    tbC: -34.0,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'ENRTL'],
    noteKo: '염소 가스 · 심냉 액화 및 브라인 용해(Sechenov)',
  },
  H2: {
    cas: '1333-74-0',
    tbC: -252.9,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR', 'ENRTL'],
    isPermanentGas: true,
    noteKo: '수소 (SRK Graboski-Daubert 양자 보정 내장)',
  },
  HCl: {
    cas: '7647-01-0',
    tbC: -85.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'PR', 'SRK'],
    isElectrolyte: true,
    noteKo: '염화수소 (수용액 압력변동 공비증류 및 무수 액화)',
  },
  H2SO4: {
    cas: '7664-93-9',
    tbC: 337.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '황산 건조산 · 강전해질 (수분 흡수 평형·희석열)',
  },
  O2: {
    cas: '7782-44-7',
    tbC: -183.0,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR', 'ENRTL'],
    isPermanentGas: true,
    noteKo: '산소 · 수전해/전해 부생가스',
  },
  NaOCl: {
    cas: '7681-52-9',
    tbC: 101.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '차아염소산소다 수용액 전해질',
  },
  N2: {
    cas: '7727-37-9',
    tbC: -195.8,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR', 'NRTL', 'ENRTL'],
    isPermanentGas: true,
    noteKo: '질소 퍼지 · 불활성 운반 가스',
  },
  NaClO3: {
    cas: '7775-09-9',
    tbC: 300.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '염소산소다 무기염 전해질',
  },
  FeCl2: {
    cas: '7758-94-3',
    tbC: 1023.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '염화제일철 에칭 폐액 성분',
  },
  FeCl3: {
    cas: '7705-08-0',
    tbC: 316.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '염화제이철 재생 에칭액 성분',
  },
  PAC: {
    cas: '1327-41-9',
    tbC: 500.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '폴리염화알루미늄 무기 응집제',
  },
  Glycerol: {
    cas: '56-81-5',
    tbC: 290.0,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '글리세롤 (GTE 원료 · 고비점 다가알코올)',
  },
  MCH: {
    cas: '96-24-2',
    tbC: 213.0,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '모노클로로히드린 (3-MCPD 반응 중간체)',
  },
  DCH: {
    cas: '96-23-1',
    tbC: 174.3,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '디클로로히드린 (1,3-DCH 비누화 원료)',
  },
  ECH: {
    cas: '106-89-8',
    tbC: 116.1,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '에피클로로히드린 (물과 88°C 불균일 공비·LLE)',
  },
  DCP: {
    cas: '78-87-5',
    tbC: 96.4,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'ENRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '1,2-디클로로프로판 (경질 유기염소 부산물·LLE)',
  },

  // 2) 산업가스 · 합성가스 확장 (4종)
  CH4: {
    cas: '74-82-8',
    tbC: -161.5,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['PR', 'SRK'],
    isPermanentGas: true,
    isHydrocarbon: true,
    noteKo: '메탄 · 천연가스/개질가스 주성분',
  },
  CO: {
    cas: '630-08-0',
    tbC: -191.5,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR'],
    isPermanentGas: true,
    noteKo: '일산화탄소 · 합성가스(Syngas) 핵심 성분',
  },
  CO2: {
    cas: '124-38-9',
    tbC: -78.5,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['PR', 'SRK', 'ENRTL'],
    noteKo: '이산화탄소 (고압 액화 · 산성가스 포집)',
  },
  NH3: {
    cas: '7664-41-7',
    tbC: -33.3,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['ENRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '암모니아 (냉매 액화 PR/SRK 및 암모니아수 ENRTL)',
  },

  // 3) 파라핀 · 올레핀 탄화수소 (7종)
  C2H4: {
    cas: '74-85-1',
    tbC: -103.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['SRK', 'PR'],
    isHydrocarbon: true,
    noteKo: '에틸렌 (C2 스플리터 · 석유화학 기초유분)',
  },
  C2H6: {
    cas: '74-84-0',
    tbC: -88.6,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: '에탄 (천연가스 NGL · 탈에탄탑)',
  },
  C3H6: {
    cas: '115-07-1',
    tbC: -47.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['SRK', 'PR'],
    isHydrocarbon: true,
    noteKo: '프로필렌 (C3 스플리터 · 석유화학 유분)',
  },
  C3H8: {
    cas: '74-98-6',
    tbC: -42.1,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: '프로판 (LPG · 탈프로판탑 · 냉매)',
  },
  nC4H10: {
    cas: '106-97-8',
    tbC: -0.5,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: '노르말부탄 (LPG · 탈부탄탑 표준)',
  },
  nC6H14: {
    cas: '110-54-3',
    tbC: 68.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '노르말헥산 (추출·공비 용제 및 경질 나프타)',
  },
  nC7H16: {
    cas: '142-82-5',
    tbC: 98.4,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '노르말헵탄 (정유 증류 기준 탄화수소)',
  },

  // 4) BTX 방향족 탄화수소 (3종)
  Benzene: {
    cas: '71-43-2',
    tbC: 80.1,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '벤젠 (BTX 분별증류 및 공비 탈수제·LLE)',
  },
  Toluene: {
    cas: '108-88-3',
    tbC: 110.6,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '톨루엔 (BTX 분별증류 · 유기 추출 용제·LLE)',
  },
  pXylene: {
    cas: '106-42-3',
    tbC: 138.4,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '파라자일렌 (방향족 중질분 정제)',
  },

  // 5) 극성 유기용제 · 알코올 · 케톤 · 에스테르 · 염소계 용제 (7종)
  MeOH: {
    cas: '67-56-1',
    tbC: 64.7,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL', 'SRK'],
    isPolarOrganic: true,
    noteKo: '메탄올 (물과 비공비 비이상 증류 · 용제 회수)',
  },
  EtOH: {
    cas: '64-17-5',
    tbC: 78.3,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '에탄올 (물과 78.1°C 최소비점 균일공비 혼합물)',
  },
  IPA: {
    cas: '67-63-0',
    tbC: 82.3,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '이소프로판올 (반도체 세정액 회수 · 물과 80.3°C 공비)',
  },
  Acetone: {
    cas: '67-64-1',
    tbC: 56.1,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '아세톤 (케톤 용제 회수 · 클로로포름 최대비점 공비)',
  },
  AceticAcid: {
    cas: '64-19-7',
    tbC: 117.9,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '초산 (유기산 탈수 증류 · 에스테르화 공정)',
  },
  EtOAc: {
    cas: '141-78-6',
    tbC: 77.1,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '초산에틸 (물과 불균일 공비 및 액-액 디캔터 분리)',
  },
  CHCl3: {
    cas: '67-66-3',
    tbC: 61.2,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '클로로포름 (염소계 추출 용제 · 수층 LLE 분리)',
  },
  Ar: {
    cas: '7440-37-1',
    tbC: -185.8,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR'],
    isPermanentGas: true,
    noteKo: '불활성 퍼지·암모니아 루프 축적 가스',
  },
  H2S: {
    cas: '7783-06-4',
    tbC: -60.3,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['SRK', 'PR', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '산성가스(Sour Gas) · 아민 흡수 제거 대상',
  },
  SO2: {
    cas: '7446-09-5',
    tbC: -10.0,
    family: 'gas_syngas',
    familyLabelKo: COMP_FAMILY_LABELS.gas_syngas,
    reliableMethods: ['NRTL', 'ENRTL', 'SRK', 'PR'],
    isPolarOrganic: true,
    noteKo: '배연탈황·황산 접촉산화 원료 가스',
  },
  SO3: {
    cas: '7446-11-9',
    tbC: 44.8,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['NRTL', 'ENRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: 'SO₂ 접촉산화 생성물 · 발연황산 흡수',
  },
  iC4H10: {
    cas: '75-28-5',
    tbC: -11.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: 'C4 이성질체 분별증류(De-isobutanizer) 및 알킬화 원료',
  },
  C4H8_1: {
    cas: '106-98-9',
    tbC: -6.3,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['SRK', 'PR'],
    isHydrocarbon: true,
    noteKo: 'C4 올레핀 정제 및 공중합 단량체',
  },
  nC5H12: {
    cas: '109-66-0',
    tbC: 36.1,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: '경질 나프타 · 탈펜탄탑(Depentanizer) 기준 탄화수소',
  },
  nC8H18: {
    cas: '111-65-9',
    tbC: 125.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK'],
    isHydrocarbon: true,
    noteKo: '중질 가솔린 · 케로신 분별증류 탄화수소',
  },
  Cyclohexane: {
    cas: '110-82-7',
    tbC: 80.7,
    family: 'hydrocarbon',
    familyLabelKo: COMP_FAMILY_LABELS.hydrocarbon,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '벤젠 수소화 생성물 · 나일론 원료 · 공비 탈수제',
  },
  Ethylbenzene: {
    cas: '100-41-4',
    tbC: 136.2,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '스티렌 단량체(SM) 탈수소화 반응 원료',
  },
  Styrene: {
    cas: '100-42-5',
    tbC: 145.2,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '에틸벤젠/스티렌 초다단 진공 정밀증류 핵심 단량체',
  },
  Cumene: {
    cas: '98-82-8',
    tbC: 152.4,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isHydrocarbon: true,
    noteKo: '벤젠+프로필렌 알킬화 생성물 · 페놀/아세톤 공정 중간체',
  },
  Phenol: {
    cas: '108-95-2',
    tbC: 181.8,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '큐멘 산화분해 제품 · 방향족 극성 추출 용매',
  },
  THF: {
    cas: '109-99-9',
    tbC: 66.0,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '고분자·이차전지·제약 환형 에테르 용제 (압력변동 증류)',
  },
  DMF: {
    cas: '68-12-2',
    tbC: 153.0,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '아크릴·폴리우레탄·부타디엔 추출증류 고비점 극성 비양자성 용제',
  },
  DMSO: {
    cas: '67-68-5',
    tbC: 189.0,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '반도체 박리액(Stripper)·방향족 추출 고비점 용제',
  },
  MTBE: {
    cas: '1634-04-4',
    tbC: 55.2,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '옥탄가 향상제 · 이소부텐+메탄올 반응증류 표준 물질',
  },
  MEK: {
    cas: '78-93-3',
    tbC: 79.6,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '코팅·자기테이프·탈랍 공정 범용 케톤 용제 (수층 공비)',
  },
  DMC: {
    cas: '616-38-6',
    tbC: 90.3,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL'],
    isPolarOrganic: true,
    noteKo: '이차전지 전해액 사슬형 카보네이트 핵심 용매 (메탄올 공비)',
  },
  EG: {
    cas: '107-21-1',
    tbC: 197.3,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '가스 탈수제 · 폴리에스터 원료 · 부동액',
  },
  MEA: {
    cas: '141-43-5',
    tbC: 170.4,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['ENRTL', 'NRTL'],
    isPolarOrganic: true,
    noteKo: '연소배가스 CO₂·H₂S 화학흡수·재생 표준 알칸올아민',
  },
  MDEA: {
    cas: '105-59-9',
    tbC: 247.1,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['ENRTL', 'NRTL'],
    isPolarOrganic: true,
    noteKo: '선택적 H₂S/CO₂ 고압 산성가스 세정 3급 아민',
  },
  FormicAcid: {
    cas: '64-18-6',
    tbC: 100.8,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '물과 최고비점 공비혼합물 형성 카르복실산',
  },
  HNO3: {
    cas: '7697-37-2',
    tbC: 83.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL'],
    isElectrolyte: true,
    noteKo: '무기 강산 · 물과 68 wt% 최고비점 공비(120.5°C)',
  },
  CUSTOM_1: {
    cas: '71-36-3',
    tbC: 117.7,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'PR', 'SRK', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: 'Joback+UNIFAC 작용기 추산기 또는 120종 확장 라이브러리 매핑 슬롯 #1 (기본: n-Butanol)',
  },
  CUSTOM_2: {
    cas: '62-53-3',
    tbC: 184.1,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: 'Joback+UNIFAC 작용기 추산기 또는 120종 확장 라이브러리 매핑 슬롯 #2 (기본: Aniline)',
  },
};

export interface PlantComponentPreset {
  plantId: 'clorsim' | 'clorsim_sim' | 'hcl_synth' | 'ech_gte' | 'green_h2';
  code: string;
  labelKo: string;
  descKo: string;
  components: SimCompKey[];
  defaultMethod: SimPropertyMethod;
}

export const PLANT_COMPONENT_PRESETS: PlantComponentPreset[] = [
  {
    plantId: 'clorsim_sim',
    code: 'PLANT 01',
    labelKo: '전해공장 (식염수 정제 · 전해 · 가성소다 · 염소액화)',
    descKo: '브라인 전해질, 가성소다 농축, 습염소 황산건조 및 액화 공정 표준 11종',
    components: ['H2O', 'NaCl', 'NaOH', 'Cl2', 'H2', 'HCl', 'H2SO4', 'O2', 'N2', 'NaOCl', 'NaClO3'],
    defaultMethod: 'AUTO',
  },
  {
    plantId: 'hcl_synth',
    code: 'PLANT 02',
    labelKo: '1A 초고순도·무수염산 & 폐염산 회수(PSD)',
    descKo: '염소·수소 합성버너, 압력변동 공비증류(PSD), 심냉 무수염산 및 에칭액 성분 10종',
    components: ['H2O', 'HCl', 'Cl2', 'H2', 'N2', 'O2', 'NaOH', 'NaCl', 'FeCl2', 'FeCl3'],
    defaultMethod: 'AUTO',
  },
  {
    plantId: 'ech_gte',
    code: 'PLANT 03',
    labelKo: 'ECH 7만톤 (글리세린 염소화 · 비누화 · 정제)',
    descKo: 'GTE 글리세롤 연속 염소화(MCH/DCH), 가성소다 비누화, 공비 탈수 및 진공 정제 10종',
    components: ['H2O', 'Glycerol', 'HCl', 'MCH', 'DCH', 'ECH', 'DCP', 'NaOH', 'NaCl', 'N2'],
    defaultMethod: 'AUTO',
  },
];

export function getPlantDefaultComponents(plantKey?: string): SimCompKey[] {
  if (plantKey === 'clorsim' || plantKey === 'clorsim_sim' || plantKey === 'electrolyzer_plant') {
    return [...PLANT_COMPONENT_PRESETS[0].components];
  }
  if (plantKey === 'hcl_synth' || plantKey === 'hcl_1a_plant') {
    return [...PLANT_COMPONENT_PRESETS[1].components];
  }
  if (plantKey === 'ech_gte' || plantKey === 'ech_gte_plant') {
    return [...PLANT_COMPONENT_PRESETS[2].components];
  }
  // 범용 기본 시작 세트 (자주 쓰는 물·유기용제·기본가스·전해질 코어)
  return ['H2O', 'MeOH', 'EtOH', 'Acetone', 'EtOAc', 'Toluene', 'N2', 'H2', 'CO2', 'NaCl', 'NaOH', 'HCl'];
}

export interface GeneralComponentPack {
  id: string;
  labelKo: string;
  badge: string;
  descKo: string;
  components: SimCompKey[];
}

export const GENERAL_COMPONENT_PACKS: GeneralComponentPack[] = [
  {
    id: 'polar_solvents',
    labelKo: '알코올 · 케톤 · 용제 회수 (공비/추출)',
    badge: 'NRTL 최적',
    descKo: 'MeOH, EtOH, IPA, 아세톤, 초산, 초산에틸 + 물 공비증류 및 디캔터 분리',
    components: ['H2O', 'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'N2'],
  },
  {
    id: 'btx_refinery',
    labelKo: 'BTX 방향족 · 정유 나프타 분별증류',
    badge: 'PR / NRTL',
    descKo: '벤젠, 톨루엔, 파라자일렌, 헥산, 헵탄 탄화수소 정밀 증류 및 수층 분리',
    components: ['Benzene', 'Toluene', 'pXylene', 'nC6H14', 'nC7H16', 'H2', 'CH4'],
  },
  {
    id: 'light_hc_lpg',
    labelKo: '천연가스 · 에틸렌/프로필렌 · LPG 가스분리',
    badge: 'PR / SRK',
    descKo: '메탄, 에틸렌, 에탄, 프로필렌, 프로판, 노르말부탄 심냉·가압 증류',
    components: ['CH4', 'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'CO2', 'N2'],
  },
  {
    id: 'syngas_h2_nh3',
    labelKo: '합성가스 · 수소 · 암모니아 · CO₂ 공정',
    badge: 'SRK / ENRTL',
    descKo: '개질 합성가스(H₂·CO·CO₂·CH₄), 고압 암모니아 합성/액화 및 수세정',
    components: ['H2', 'CO', 'CO2', 'CH4', 'N2', 'NH3', 'H2O', 'O2'],
  },
  {
    id: 'chlorinated_org',
    labelKo: '염소계 용제 · 클로로히드린 정제',
    badge: 'NRTL / ENRTL',
    descKo: '클로로포름, 아세톤, 메탄올, ECH, DCP, DCH 및 수층 액-액 분리',
    components: ['H2O', 'CHCl3', 'Acetone', 'MeOH', 'ECH', 'DCP', 'DCH', 'HCl'],
  },
  {
    id: 'sm_cumene_aromatics',
    labelKo: '스타이렌(SM) · 큐멘 · 페놀 방향족 공정',
    badge: 'PR / NRTL',
    descKo: '에틸벤젠 탈수소 스타이렌(EB/SM) 정밀 감압증류 및 큐멘 산화 페놀·아세톤 정제',
    components: ['Benzene', 'Toluene', 'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'Acetone', 'H2', 'H2O'],
  },
  {
    id: 'amine_sour_gas',
    labelKo: '아민 산성가스(CO₂·H₂S) 흡수 · 재생 공정',
    badge: 'ENRTL / NRTL',
    descKo: 'MEA·MDEA 아민 수용액에 의한 천연가스/연도가스 CO₂·H₂S·SO₂ 흡수 및 탈거탑',
    components: ['H2O', 'MEA', 'MDEA', 'CO2', 'H2S', 'SO2', 'CH4', 'N2'],
  },
  {
    id: 'battery_semi_solvents',
    labelKo: '배터리 카보네이트 · 반도체 극성용제 회수',
    badge: 'NRTL + UNIFAC',
    descKo: 'DMC·THF·DMF·DMSO·MEK·MTBE·EG 및 확장 슬롯(EC/PC/EMC/NMP/PGMEA) 회수 정제',
    components: ['H2O', 'DMC', 'THF', 'DMF', 'DMSO', 'MEK', 'MTBE', 'EG', 'CUSTOM_1', 'CUSTOM_2'],
  },
];

export interface PropertyRecommendation {
  method: ResolvedPropertyMethod;
  reasonKo: string;
  alternatives: ResolvedPropertyMethod[];
}

/**
 * Carlson 열역학 의사결정 트리 기반 자동 물성 패키지 추천기
 * - 사용자가 복잡한 상태방정식/활동도 모델 선택을 고민하지 않도록
 *   현재 선택된 성분(또는 실제 유입 피드 유량)의 극성·전해질·수소/탄화수소 특성을 판별해 최적 모델을 자동 결정한다.
 */
export function recommendPropertyMethod(
  components: readonly SimCompKey[],
  feedFlowsKgH?: Partial<Record<SimCompKey, number>>,
  maxPressKgcm2g = 1.0
): PropertyRecommendation {
  let present: SimCompKey[] = [];
  if (feedFlowsKgH) {
    present = (Object.keys(feedFlowsKgH) as SimCompKey[]).filter(
      k => (feedFlowsKgH[k] ?? 0) > 1e-6 && COMP_CATALOG_META[k] !== undefined
    );
  }
  if (present.length === 0) {
    present = components.filter(k => COMP_CATALOG_META[k] !== undefined);
  }
  if (present.length === 0) {
    return {
      method: 'PR',
      reasonKo: '기본 상태방정식(Peng-Robinson) 대기 상태',
      alternatives: ['SRK', 'NRTL', 'ENRTL'],
    };
  }

  const hasH2O = present.includes('H2O');
  const hasElectrolyte = present.some(k => COMP_CATALOG_META[k]?.isElectrolyte);
  const hasNH3 = present.includes('NH3');
  const hasPolarOrg = present.some(k => COMP_CATALOG_META[k]?.isPolarOrganic && k !== 'NH3');
  const hasHydrocarbon = present.some(k => COMP_CATALOG_META[k]?.isHydrocarbon);
  const hasH2OrCO = present.includes('H2') || present.includes('CO');
  const hasLightOlefin = present.includes('C2H4') || present.includes('C3H6');

  // 1) 이온성 전해질(산·알칼리·염)이 물/극성 용매와 공존하거나 암모니아 수용액인 계 -> ENRTL
  if ((hasElectrolyte && (hasH2O || hasPolarOrg)) || (hasNH3 && hasH2O)) {
    // 무수 염화수소/염소 액화 예외 판별 (수분이 극미량이고 염이 없는 순수 가스 액화 계)
    if (feedFlowsKgH && !present.some(k => k !== 'HCl' && COMP_CATALOG_META[k]?.isElectrolyte)) {
      const h2oMass = feedFlowsKgH.H2O ?? 0;
      const hclMass = feedFlowsKgH.HCl ?? 0;
      const orgMass = present
        .filter(k => COMP_CATALOG_META[k]?.isPolarOrganic)
        .reduce((s, k) => s + (feedFlowsKgH[k] ?? 0), 0);
      if (hclMass > 0 && h2oMass < hclMass * 0.02 && orgMass < 1e-3) {
        return {
          method: 'PR',
          reasonKo: '무수 HCl/가스 압축·액화 계 → 고압 기액평형 및 액상 밀도가 정확한 PR 상태방정식 자동 적용',
          alternatives: ['SRK', 'ENRTL'],
        };
      }
    }
    return {
      method: 'ENRTL',
      reasonKo: '전해질(산·알칼리·염) 수용액 계 → 이온 활동도·비점상승·용해열·염석효과를 반영하는 ENRTL 자동 적용',
      alternatives: ['NRTL', 'PR'],
    };
  }

  // 2) 비전해질 극성 유기물(알코올·케톤·에스테르·유기산·클로로히드린·염소용제) 또는 물+탄화수소(LLE/공비) -> NRTL
  if (hasPolarOrg || (hasH2O && hasHydrocarbon && maxPressKgcm2g < 25)) {
    return {
      method: 'NRTL',
      reasonKo: '극성 유기물·수소결합·공비/액액분리(LLE) 계 → 비이상 액상 활동도(NRTL + UNIFAC) 자동 적용',
      alternatives: ['ENRTL', 'PR'],
    };
  }

  // 3) 무수 수소(H2)·합성가스(CO)·경질 올레핀(C2H4, C3H6) 중심 계 -> SRK
  if ((hasH2OrCO || hasLightOlefin) && !hasElectrolyte && (!hasH2O || maxPressKgcm2g >= 15)) {
    return {
      method: 'SRK',
      reasonKo: '수소·합성가스·경질 올레핀 계 → H₂ Graboski-Daubert 보정이 내장된 SRK 상태방정식 자동 적용',
      alternatives: ['PR', 'NRTL'],
    };
  }

  // 4) 파라핀 탄화수소 · BTX 방향족 · 고압 액화가스(Cl2, CO2, NH3, CH4~C7) -> PR
  return {
    method: 'PR',
    reasonKo: '비극성 탄화수소·방향족·액화가스 계 → 기액 퓨개시티와 액상 압축성 계산이 우수한 PR 상태방정식 자동 적용',
    alternatives: ['SRK', 'NRTL'],
  };
}

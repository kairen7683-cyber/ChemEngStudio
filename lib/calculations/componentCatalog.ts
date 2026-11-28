import type { SimCompKey } from './flowsheetSolver';

export type SimPropertyMethod = 'AUTO' | 'ENRTL' | 'NRTL' | 'UNIFAC' | 'PR' | 'SRK' | 'STEAM_IF97' | 'IDEAL';
export type ResolvedPropertyMethod = 'ENRTL' | 'NRTL' | 'UNIFAC' | 'PR' | 'SRK' | 'STEAM_IF97' | 'IDEAL';

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
  UNIFAC: {
    code: 'UNIFAC',
    labelKo: 'UNIFAC (Hansen 1991 그룹기여 활동도 예측)',
    shortKo: 'BIP 미지 극성 유기물 예측',
    formulaDesc: 'ln γ_i = ln γ_i^C (Combinatorial) + ln γ_i^R (Residual), 25-그룹 Hansen UNIFAC + PR 기상 퓨개시티',
    bestForKo: '실험 이성분 파라미터(NRTL BIP)가 없는 신규 유기용제·에스터·케톤·가상성분 혼합물의 기액/액액 평형 예측',
    accent: '#9333EA',
    bg: '#FAF5FF',
    border: '#D8B4FE',
  },
  STEAM_IF97: {
    code: 'STEAM_IF97',
    labelKo: 'STEAM-IF97 (IAPWS-IF97 정밀 스팀 테이블)',
    shortKo: '고압 스팀 · 보일러 · 발전 사이클',
    formulaDesc: 'IAPWS-IF97 Region 4 정밀 포화방정식(10-계수) + 압축수/과열증기 엔탈피·밀도 (ASME 스팀 테이블 기준)',
    bestForKo: '스팀 터빈(Rankine), HRSG 보일러, 고압 스팀 헤더, 응축수 회수 등 순수 H₂O·스팀 유틸리티 공정',
    accent: '#0284C7',
    bg: '#F0F9FF',
    border: '#38BDF8',
  },
  IDEAL: {
    code: 'IDEAL',
    labelKo: 'IDEAL (이상 기체 · Raoult 법칙)',
    shortKo: '기초 검증 · 비공비 근사',
    formulaDesc: 'K_i = P_sat,i(T) / P (γ_i = 1.0, φ_i^V = 1.0, Z = 1.0), 저압 이상 혼합물 및 교과서 기준 비교',
    bestForKo: '저압 비극성 유사 이성분계(벤젠-톨루엔 등), 학부/교과서 Raoult 기준선 검증, 초기 감도 스크리닝',
    accent: '#475569',
    bg: '#F8FAFC',
    border: '#CBD5E1',
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
  CH3Cl: {
    cas: '74-87-3',
    tbC: -24.2,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isPolarOrganic: true,
    noteKo: '메틸클로라이드/MC (CMS 염소화 핵심 원료·미반응 순환 가스/가압액)',
  },
  CH2Cl2: {
    cas: '75-09-2',
    tbC: 39.8,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '염화메틸렌/MCL (CMS 주력 제품 · 비인화성 극성 유기용제)',
  },
  CCl4: {
    cas: '56-23-5',
    tbC: 76.7,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: false,
    noteKo: '사염화탄소/CTC (CMS 과염소화 부산물 · 소각 폐기 대상)',
  },
  C2Cl4: {
    cas: '127-18-4',
    tbC: 121.1,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: false,
    noteKo: '퍼클로로에틸렌/Heavies (C₂ 염소화 고비점 헤비 잔류 폐유분)',
  },
  COCl2: {
    cas: '75-44-5',
    tbC: 8.2,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    isPolarOrganic: false,
    noteKo: '포스겐 (CO + Cl₂ 합성 중간체 · MDI 포스겐화 시약)',
  },
  HCHO: {
    cas: '50-00-0',
    tbC: -19.1,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '포름알데히드 (Formalin 37% 수용액 · MDA 축합 원료)',
  },
  MCB: {
    cas: '108-90-7',
    tbC: 131.7,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: false,
    noteKo: '모노클로로벤젠 (MDI 포스겐화 반응/진공 회수용 주용매)',
  },
  Aniline: {
    cas: '62-53-3',
    tbC: 184.1,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '아닐린 (MDA 합성 주원료 · 감압 탑정 순환 회수)',
  },
  MDA: {
    cas: '101-77-9',
    tbC: 398.0,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '4,4\'-메틸렌디아닐린 (Aniline-HCHO 축합 중간체 · 포스겐화 원료)',
  },
  MDI: {
    cas: '101-68-8',
    tbC: 314.0,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: true,
    noteKo: '4,4\'-Pure MDI 모노머 (고진공 증류 탑정/측류 제품)',
  },
  PMDI: {
    cas: '9016-87-9',
    tbC: 435.0,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR', 'SRK'],
    isPolarOrganic: false,
    noteKo: '폴리머릭 MDI (Crude MDI 고비점 올리고머 · 진공탑 탑저 제품)',
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
  // 6) 국내 중견/중소 전자소재 · 이차전지 · 수처리 핵심 11종
  H2O2: {
    cas: '7722-84-1',
    tbC: 150.2,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '과산화수소 (반도체 SC-1/SPM 세정 · 30~50 wt% 산화제 수용액)',
  },
  H3PO4: {
    cas: '7664-38-2',
    tbC: 213.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL'],
    isElectrolyte: true,
    noteKo: '인산 (반도체 질화막 식각 · 85 wt% 고점도 무기산 전해질)',
  },
  HF: {
    cas: '7664-39-3',
    tbC: 19.5,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL'],
    isElectrolyte: true,
    noteKo: '불산/불화수소 (실리콘 산화막 습식 식각 · DHF/BOE 핵심 약산)',
  },
  KOH: {
    cas: '1310-58-3',
    tbC: 1327.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '수산화칼륨 (실리콘 이방성 식각 · 알칼라인 수전해 강염기 전해질)',
  },
  NH4OH: {
    cas: '1336-21-6',
    tbC: 37.7,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL'],
    isElectrolyte: true,
    noteKo: '암모니아수 (반도체 SC-1 세정 · 약염기 수용액 전해질)',
  },
  TMAH: {
    cas: '75-59-2',
    tbC: 110.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL', 'NRTL'],
    isElectrolyte: true,
    noteKo: '테트라메틸암모늄하이드록사이드 (포토레지스트 현상액 2.38 wt% · 전자급 유기강염기)',
  },
  NMP: {
    cas: '872-50-4',
    tbC: 202.0,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: 'N-메틸-2-피롤리돈 (이차전지 양극재 슬러리 · 반도체 박리액 회수용 고비점 극성용매)',
  },
  BCS: {
    cas: '111-76-2',
    tbC: 171.2,
    family: 'polar_solvent',
    familyLabelKo: COMP_FAMILY_LABELS.polar_solvent,
    reliableMethods: ['NRTL', 'ENRTL'],
    isPolarOrganic: true,
    noteKo: '부틸셀로솔브/2-부톡시에탄올 (도료·코팅·디스플레이 세정용 글리콜에테르 용제)',
  },
  Na2CO3: {
    cas: '497-19-8',
    tbC: 1600.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '탄산나트륨/소다회 (브라인 정제 Ca²⁺ 침전 · 산성폐수 중화 무기염)',
  },
  NaHSO3: {
    cas: '7631-90-5',
    tbC: 315.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '중아황산소다/SBS (잔류염소·과산화수소 환원 탈염소 수처리 약품)',
  },
  CaOH2: {
    cas: '1305-62-0',
    tbC: 580.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['ENRTL'],
    isElectrolyte: true,
    noteKo: '소석회/수산화칼슘 (불산·황산 폐수 중화 및 CaF₂ 침전용 알칼리 슬러리)',
  },
  HCPX: {
    cas: '68-36-0',
    tbC: 315.0,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '헥사클로로-p-자일렌 (p-자일렌 광염소화 중간체 · 아라미드 TPC 원료)',
  },
  TPA: {
    cas: '100-21-0',
    tbC: 402.0,
    family: 'aromatic',
    familyLabelKo: COMP_FAMILY_LABELS.aromatic,
    reliableMethods: ['NRTL', 'PR'],
    noteKo: '테레프탈산 (비휘발성 고체/슬러리 · HCPX와 FeCl₃ 촉매 반응하여 TPC 생성)',
  },
  TPC: {
    cas: '100-20-9',
    tbC: 266.0,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['NRTL', 'PR'],
    isPolarOrganic: true,
    noteKo: '테레프탈로일 클로라이드 (아라미드 단량체 · 진공 증류 정제 제품, 25 mmHg @ 165°C)',
  },
  Si: {
    cas: '7440-21-3',
    tbC: 3265.0,
    family: 'electrolyte_inorg',
    familyLabelKo: COMP_FAMILY_LABELS.electrolyte_inorg,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    noteKo: '야금급 금속 실리콘 (MG-Si · 비휘발성 고체 원료, 유동층 염산수소화 반응 원료)',
  },
  DCS: {
    cas: '4109-96-0',
    tbC: 8.3,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    noteKo: '디클로로실란 (SiH₂Cl₂ · 경질 클로로실란 부산물/에피택시 가스, 끓는점 8.3°C)',
  },
  TCS: {
    cas: '10025-78-2',
    tbC: 31.8,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    noteKo: '트리클로로실란 (SiHCl₃ · 폴리실리콘/반도체 지멘스 CVD 핵심 원료, 끓는점 31.8°C)',
  },
  STC: {
    cas: '10026-04-7',
    tbC: 57.65,
    family: 'chlor_ech',
    familyLabelKo: COMP_FAMILY_LABELS.chlor_ech,
    reliableMethods: ['PR', 'SRK', 'NRTL'],
    noteKo: '사염화규소 (SiCl₄ · 중질 클로로실란 부산물/광섬유·흄드실리카 원료, 끓는점 57.65°C)',
  },
};

export interface PlantComponentPreset {
  plantId: 'clorsim' | 'clorsim_sim' | 'hcl_synth' | 'ech_gte' | 'cms_plant' | 'mdi_plant' | 'green_h2';
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
  {
    plantId: 'cms_plant',
    code: 'PLANT 04',
    labelKo: '클로로메탄(CMS) 공정 (MCL 120 · CFM 80 T/D)',
    descKo: '액체염소 기화, MC + Cl₂ 고압 AIBN 액상 라디칼 염소화(24kG·120°C), 무수 HCl 탈거, MC 순환 및 MCL/CFM/CTC 분리 10종',
    components: ['Cl2', 'HCl', 'CH3Cl', 'CH2Cl2', 'CHCl3', 'CCl4', 'C2Cl4', 'N2', 'NaOH', 'H2O'],
    defaultMethod: 'PR',
  },
  {
    plantId: 'mdi_plant',
    code: 'PLANT 05',
    labelKo: 'MDI 10만톤 통합 공정 (MDA · 포스겐화 · Pure/PMDI)',
    descKo: '아닐린·포르말린 축합, CO+Cl₂ 포스겐 합성, MCB 용매 포스겐화, MCB 회수 및 고진공 MDI/PMDI 정밀분별 13종',
    components: ['Aniline', 'HCHO', 'HCl', 'NaOH', 'NaCl', 'H2O', 'CO', 'Cl2', 'COCl2', 'MCB', 'MDA', 'MDI', 'PMDI'],
    defaultMethod: 'NRTL',
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
  if (plantKey === 'cms_plant' || plantKey === 'cms_plant_mode') {
    return [...PLANT_COMPONENT_PRESETS[3].components];
  }
  if (plantKey === 'mdi_plant') {
    return [...PLANT_COMPONENT_PRESETS[4].components];
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
    labelKo: '염소계 용제 · 클로로메탄(CMS) · 클로로히드린 정제',
    badge: 'NRTL / PR',
    descKo: '메틸클로라이드(MC), MCL, 클로로포름(CFM), 사염화탄소(CTC), PCE, ECH 및 수층 분리',
    components: ['CH3Cl', 'CH2Cl2', 'CHCl3', 'CCl4', 'C2Cl4', 'HCl', 'Cl2', 'ECH', 'DCH', 'H2O'],
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
  {
    id: 'electronic_battery_water',
    labelKo: '전자소재 · 이차전지 · 수처리 (중견/중소)',
    badge: 'ENRTL / NRTL',
    descKo: '반도체·디스플레이 습식 식각/세정(H₂O₂·H₃PO₄·HF·KOH·NH₄OH·TMAH), 이차전지 용매(NMP·BCS) 및 폐수 중화·탈염소(Na₂CO₃·NaHSO₃·Ca(OH)₂)',
    components: ['H2O', 'H2O2', 'H3PO4', 'HF', 'KOH', 'NH4OH', 'TMAH', 'NMP', 'BCS', 'Na2CO3', 'NaHSO3', 'CaOH2'],
  },
  {
    id: 'aramid_tpc_chlorination',
    labelKo: '아라미드 TPC 광염소화 · 촉매 합성 공정',
    badge: 'NRTL / PR',
    descKo: 'p-자일렌 광염소화(→HCPX), TPA+HCPX FeCl₃ 촉매 합성(→TPC), 진공 증류 정제 및 HCl 배가스 가성소다 흡수',
    components: ['pXylene', 'Cl2', 'HCl', 'HCPX', 'TPA', 'TPC', 'FeCl3', 'N2', 'NaOH', 'H2O'],
  },
  {
    id: 'polysilicon_tcs_chlorosilane',
    labelKo: '반도체·폴리실리콘 TCS 염산수소화 · 증류 정제 공정',
    badge: 'PR / SRK',
    descKo: 'MG-Si 유동층 염산수소화(Si + HCl → TCS/STC/DCS + H₂), 급랭 응축, 저비점(DCS) 및 고비점(STC) 다단 증류 정제',
    components: ['Si', 'HCl', 'H2', 'DCS', 'TCS', 'STC', 'N2'],
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

  // 0) 순수 물/스팀 단일 성분 계 (H2O >= 99.5 wt%) -> STEAM_IF97
  if (hasH2O && present.length === 1) {
    return {
      method: 'STEAM_IF97',
      reasonKo: '순수 H₂O / Steam 공정 → IAPWS-IF97 정밀 스팀 테이블 자동 적용',
      alternatives: ['PR', 'IDEAL'],
    };
  }
  if (hasH2O && feedFlowsKgH && !hasElectrolyte && !hasPolarOrg && !hasHydrocarbon) {
    const totF = present.reduce((s, k) => s + (feedFlowsKgH[k] ?? 0), 0);
    if (totF > 0 && (feedFlowsKgH.H2O ?? 0) / totF >= 0.995) {
      return {
        method: 'STEAM_IF97',
        reasonKo: '순수 H₂O / Steam (≥99.5 wt%) → IAPWS-IF97 정밀 스팀 테이블 자동 적용',
        alternatives: ['PR', 'IDEAL'],
      };
    }
  }

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

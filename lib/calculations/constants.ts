// ============================================================
// 염소-알칼리 전해 공정 물성 상수
// Chlor-Alkali Process Physical Constants
// ============================================================

export const FARADAY = 96485; // C/mol (패러데이 상수)

// 분자량 (g/mol) — 전해 코어 + 1A(초고순도·무수 HCl) + 1B(무기염소·에칭재생) + 2순위(ECH·클로로히드린)
export const MW = {
  Cl2: 70.906,
  NaOH: 39.997,
  H2: 2.016,
  NaCl: 58.44,
  H2O: 18.015,
  HCl: 36.461,
  O2: 32.0,
  H2SO4: 98.079,
  N2: 28.014,
  NaOCl: 74.442,
  NaClO3: 106.44,
  FeCl2: 126.751,
  FeCl3: 162.204,
  PAC: 211.34,
  Glycerol: 92.094,
  MCH: 110.54,
  DCH: 128.985,
  ECH: 92.525,
  DCP: 112.986,
  // 범용 화학공학 확장 성분 (산업가스·탄화수소·방향족·극성용제 21종)
  CH4: 16.043,
  CO: 28.010,
  CO2: 44.010,
  NH3: 17.031,
  C2H4: 28.054,
  C2H6: 30.070,
  C3H6: 42.081,
  C3H8: 44.097,
  nC4H10: 58.123,
  nC6H14: 86.177,
  nC7H16: 100.204,
  Benzene: 78.114,
  Toluene: 92.141,
  pXylene: 106.167,
  MeOH: 32.042,
  EtOH: 46.069,
  IPA: 60.096,
  Acetone: 58.080,
  AceticAcid: 60.052,
  EtOAc: 88.106,
  CHCl3: 119.378,
  // 2차 확장 범용 산업물질 24종 + 사용자 정의/UNIFAC 슬롯 2종
  Ar: 39.948,
  H2S: 34.081,
  SO2: 64.064,
  SO3: 80.063,
  iC4H10: 58.123,
  C4H8_1: 56.107,
  nC5H12: 72.150,
  nC8H18: 114.231,
  Cyclohexane: 84.161,
  Ethylbenzene: 106.167,
  Styrene: 104.152,
  Cumene: 120.194,
  Phenol: 94.113,
  THF: 72.107,
  DMF: 73.095,
  DMSO: 78.133,
  MTBE: 88.150,
  MEK: 72.107,
  DMC: 90.078,
  EG: 62.068,
  MEA: 61.084,
  MDEA: 119.163,
  FormicAcid: 46.025,
  HNO3: 63.012,
  CH3Cl: 50.488,
  CH2Cl2: 84.933,
  CCl4: 153.823,
  C2Cl4: 165.834,
  COCl2: 98.916,
  HCHO: 30.026,
  MCB: 112.558,
  Aniline: 93.128,
  MDA: 198.268,
  MDI: 250.256,
  PMDI: 381.400,
  CUSTOM_1: 74.122,
  CUSTOM_2: 93.128,
  // 3차 확장: 국내 중견/중소 전자소재 · 이차전지 · 수처리 핵심 11종
  H2O2: 34.0147,
  H3PO4: 97.9952,
  HF: 20.0063,
  KOH: 56.1056,
  NH4OH: 35.0458,
  TMAH: 91.152,
  NMP: 99.131,
  BCS: 118.174,
  Na2CO3: 105.9888,
  NaHSO3: 104.061,
  CaOH2: 74.093,
  // 4차 확장: 아라미드 TPC 염소화 공정 핵심 3종
  HCPX: 312.833,
  TPA: 166.132,
  TPC: 203.022,
};

// 표준 운전 조건 (엑셀 원본 기준)
export const DEFAULT_CONDITIONS = {
  numElectrolyzers: 5,          // 전해조 수량 (기)
  cellsPerElectrolyzer: 190,    // 셀수/전해조
  operatingCurrentKA: 16.2,     // 운전전류 (kA)
  currentEfficiency: 0.94,      // 전류효율 (94%)
  // 엑셀 원본: Cl2 468 ton/일 @ 5기 × 190셀 × 16.2kA × 94%
};

// 브라인 조건
export const BRINE = {
  feedConcentration_wt: 25.6,   // 피드 NaCl 농도 (wt%)
  feedDensity: 1172,            // kg/m³
  feedTemp: 60,                 // ℃
  anolyteDepleted_wt: 17.45,   // 양극액 출구 NaCl 농도 (wt%)
  anolyteDensity: 1093,         // kg/m³
  anolyteTemp: 90,              // ℃
};

// NaOH 조건
export const NAOH = {
  catholyteConc_wt: 32.3,      // 음극액 NaOH 농도 (wt%) — 제품
  density32: 1304,              // kg/m³ @ 32%
  density50: 1524,              // kg/m³ @ 50%
  temp: 90,                     // ℃
  evapConc50_wt: 50.0,         // 증발농축 후 50% NaOH
};

// Cl2 조건
export const CL2 = {
  anodeTemp: 87,               // 양극 출구 온도 (℃)
  anodePressure: 0.4,          // 양극 압력 (kg/cm².G)
  purity: 99.9,                // % (건조 후)
  liquidTemp: -22,             // ℃ (액화 후)
  liquidPressure: 3.0,         // kg/cm².G
};

// H2 조건
export const H2_COND = {
  cathodeTemp: 90,             // 음극 출구 온도 (℃)
  cathodePressure: 0.45,       // 음극 압력 (kg/cm².G)
};

// 스트림 번호 정의 (엑셀 원본 매핑)
export const STREAM_NUMBERS = {
  // 100 Sec (브라인 정제)
  s001: '001',  // 브라인 피드 (FCV-080)
  s002: '002',  // 
  s004: '004',  // 
  s013: '013',  // 
  s017: '017',  // 
  s022: '022',  // 
  s102: '102',  // 브라인 필터 출구
  s104: '104',  // 브라인 전해 피드
  s105: '105',  // BaCl2
  // 200 Sec (전해조)
  s201: '201',  // 전해조 브라인 피드
  s202: '202',  // 양극액 출구 (묽은 NaCl)
  s203: '203',  // Cl2 가스 (양극)
  s204: '204',  // HCl (피드)
  s208: '208',  // 음극액 피드 (희박 NaOH)
  s209: '209',  // SPW
  s211: '211',  // NaOH 음극액 출구
  s212: '212',  // H2 가스
  s213: '213',  // NaOH (희박액)
  s217: '217',  // NaOH 제품
  s218: '218',  // 양극액 (농축)
  s219: '219',  // NaOH 19%
  s220: '220',  // Cl2 헤더
  s221: '221',  // H2 헤더
  s224: '224',  // 탈염소 브라인 (묽은 NaCl)
  s250: '250',  // 브라인 반환
  s256: '256',  // 브라인 반환
  s259: '259',  // 
  // 300 Sec (NaOH 농축)
  // 400 Sec (Cl2 처리/액화)
  s401: '401',  // Cl2 가스 (습)
  s402: '402',  // Cl2 세정수
  s403: '403',  // Cl2 (건조 후)
};

// ============================================================
// 열역학 코어 (Thermo Core) — 생성열 기준(Formation-basis) 총엔탈피 · 상변화 · PH 플래시
// ------------------------------------------------------------
// 기준 상태 (Reference state)
//   · 원소(Elements) 표준상태 298.15 K, 1 atm 에서 H = 0
//   · 성분 엔탈피 H_i(T) = ΔHf°(298.15 K, 기준상) + ∫ Cp dT (+ 상변화 잠열)
//   → 반응열·전해 흡열·흡수열·중화열·용해열·희석열이 각 장치의 엔탈피 수지(H_out − H_in)에서
//     별도 상수 없이 자동으로 산출된다.
//
// 상(Phase) 모델
//   · 기상 (V): 이상기체 ΔHf°(g) + ∫Cp_ig(T) dT        (Cp_ig = a + bT + cT² + dT³, J/mol·K, T[K])
//   · 액상 분자성 성분 (L): H_V(T) − ΔHvap(T)          (Watson: ΔHvap(T) = ΔHvap,ref·[(Tc−T)/(Tc−Tref)]^n)
//       → 액상 Cp(T) = Cp_ig(T) + n·ΔHvap(T)/(Tc − T)  (Watson 지수 n 은 25 °C 액상 Cp 문헌값에 맞춰 산정)
//   · 수용성 전해질 (AQ): ΔHf°(aq, ∞ 무한희석) + Cp_app·(T − 25)
//       - HCl / NaOH / H₂SO₄ 는 적분 용해열 표 ΔHs(n) [n = mol H₂O / mol 용질] 로 농도 의존성 반영
//         (H = ΔHf°(순수 기준상) + ΔHs(n)), n → ∞ 에서 ΔHf°(aq,∞) 로 수렴
//       - NaCl 은 용해도(35.65 + 0.0035·T + 3.12e-4·T² g/100 g H₂O) 초과분을 고체(s) 로 취급 → 원염 용해 흡열 자동 반영
//   · 영구가스(H₂·O₂·N₂)는 액상(용존) 에서도 기상 엔탈피 사용 (용해열 무시)
//   · PAC 는 반응에 참여하지 않는 불활성 성분 (ΔHf = 0, 현열만)
//
// 출처 (Sources)
//   · ΔHf°: NBS Tables of Chemical Thermodynamic Properties (1982), NIST Chemistry WebBook
//   · Cp_ig 계수: Reid–Prausnitz–Poling "Properties of Gases & Liquids" 부록 (DIPPR 형 다항식과 동일 형식)
//     유기물(Glycerol·MCH·DCH·ECH·DCP)은 Joback 기여군법 추산값 [추산]
//   · 적분 용해열 ΔHs(n): Felder & Rousseau Table B.11 (NBS 기반), NaOH n<5 구간은 가성소다 핸드북
//     희석열(50 → 32 wt%: 약 −6 kJ/mol NaOH) 에 맞춰 보정 [보정]
//   · 증발잠열 기준값: NIST WebBook (ΔHf(g) − ΔHf(l)), Perry's Handbook
//
// 증기상 고압 실제기체 이탈엔탈피(PR-EOS departure)는 본 단계에서 미포함 (이상기체 가정).
//   후속 단계에서 vaporDepartureKJkmol 훅을 통해 확장 가능.
// ============================================================

import { MW } from './constants';
import type { SimCompKey } from './flowsheetSolver';
import { calcVaporDepartureDeltaJmol, calcRackettLiquidVolumeLmol } from './eosDeparture';
import { pureDipprOrAntoineBarA } from './rigorousThermo';

export const KJ_PER_KCAL = 4.1868;
export const T_REF_K = 298.15;
export const FARADAY_C_MOL = 96485.33;

export type ThermoPhase = 'V' | 'L' | 'AQ' | 'S';
export type CompFlows = Record<SimCompKey, number>;

type CompKind = 'molecular' | 'permanent_gas' | 'electrolyte' | 'inert';

export interface ThermoCompData {
  mw: number;
  kind: CompKind;
  /** 이상기체 표준생성열 ΔHf°(g, 298.15 K), kJ/mol (= kJ/kmol × 1e-3) */
  dHfIg: number;
  /** 이상기체 Cp 다항식 [a, b, c, d] — Cp = a + bT + cT² + dT³ (J/mol·K, T in K) */
  cpIg: [number, number, number, number];
  /** 임계온도 K (Watson 상관식) */
  Tc?: number;
  /** 증발잠열 기준점 (K, kJ/mol) */
  TvapRef?: number;
  dHvapRef?: number;
  /** 25 °C 액상 Cp 문헌값 (J/mol·K) — Watson 지수 n 산정용 */
  cpLiq298?: number;
  /** Watson 지수 직접 지정 (미지정 시 cpLiq298 로부터 산정, 기본 0.38) */
  watsonN?: number;
  /** 액상 Cp DIPPR-100 다항식 [A,B,C,D,E] (J/kmol·K, T[K]) — 지정 시 액상은 ΔHf(l)+∫Cp_L 경로, 기상은 이상기체 (잠열은 차이로 산출) */
  cpLiqPoly?: [number, number, number, number, number];
  /** cpLiqPoly 유효 온도범위 (K) */
  cpLiqRangeK?: [number, number];
  /** 전해질: 무한희석 수용액 표준생성열 ΔHf°(aq, ∞), kJ/mol */
  dHfAq?: number;
  /** 전해질: 고체 표준생성열 ΔHf°(s), kJ/mol */
  dHfSolid?: number;
  /** 전해질: 수용액 중 겉보기 질량비열 (kcal/kg·K) — 용액 Cp = Σ w_i·cp_i 가 문헌 용액 Cp 와 맞도록 설정 */
  cpAqKcalKgK?: number;
}

/**
 * 성분별 열역학 물성 (40 성분: 전해/클로르알칼리·ECH 19종 + 범용 가스·탄화수소·용매 21종)
 * 값은 문헌 대표값(NIST WebBook, DIPPR, Reid–Prausnitz–Poling)이며, [추산] 표시는 기여군법 또는 유사물질 기반 추정치임.
 */
export const THERMO_DATA: Record<SimCompKey, ThermoCompData> = {
  // NBS: H2O(l) −285.83, H2O(g) −241.826 → ΔHvap(298) = 44.00 kJ/mol.
  // 액상 Cp: DIPPR-100 (Perry 표 2-153, 273–533 K). 잠열은 H_ig − H_L 로 산출 (100 °C 40.9, 150 °C 38.7 kJ/mol; 증기표 40.65 / 38.08)
  H2O:        { mw: MW.H2O, kind: 'molecular', dHfIg: -241.826, cpIg: [32.24, 1.924e-3, 1.055e-5, -3.596e-9], Tc: 647.1, TvapRef: 298.15, dHvapRef: 44.004, watsonN: 0.325, cpLiqPoly: [276370, -2090.1, 8.125, -0.014116, 9.3701e-6], cpLiqRangeK: [273.16, 533.15] },
  // NBS: NaCl(s) −411.15, NaCl(aq,∞) −407.27 → 용해열 +3.88 kJ/mol (흡열)
  NaCl:       { mw: MW.NaCl, kind: 'electrolyte', dHfIg: -181.4, cpIg: [37.0, 0, 0, 0], dHfAq: -407.27, dHfSolid: -411.15, cpAqKcalKgK: 0.21 },
  // NaOH(s) −425.61; 무한희석 ΔHs = −42.89 (Felder B.11) → ΔHf(aq) = −468.50. 용액 Cp 32 % ≈ 0.84, 50 % ≈ 0.78 kcal/kg·K
  NaOH:       { mw: MW.NaOH, kind: 'electrolyte', dHfIg: -197.8, cpIg: [48.0, 0, 0, 0], dHfAq: -468.50, dHfSolid: -425.61, cpAqKcalKgK: 0.50 },
  // Cl2: ΔHvap(239.1 K) = 20.41 kJ/mol, Tc 416.9 K
  Cl2:        { mw: MW.Cl2, kind: 'molecular', dHfIg: 0.0, cpIg: [26.93, 3.384e-2, -3.869e-5, 1.547e-8], Tc: 416.9, TvapRef: 239.1, dHvapRef: 20.41, watsonN: 0.30 },
  H2:         { mw: MW.H2, kind: 'permanent_gas', dHfIg: 0.0, cpIg: [27.14, 9.274e-3, -1.381e-5, 7.645e-9] },
  // HCl(g) −92.31, HCl(aq,∞) −167.16 (흡수열 −74.85 kJ/mol). 무수 액화: ΔHvap(188.1 K) = 16.15, Tc 324.65 K
  HCl:        { mw: MW.HCl, kind: 'electrolyte', dHfIg: -92.31, cpIg: [30.67, -7.201e-3, 1.246e-5, -3.898e-9], Tc: 324.65, TvapRef: 188.1, dHvapRef: 16.15, watsonN: 0.38, dHfAq: -167.16, cpAqKcalKgK: 0.0 },
  // H2SO4(l) −813.99, H2SO4(g) −735.13; 무한희석 ΔHs = −96.19 (Felder) → ΔHf(aq) = −910.18
  H2SO4:      { mw: MW.H2SO4, kind: 'electrolyte', dHfIg: -735.13, cpIg: [47.3, 0.161, -1.12e-4, 3.0e-8], Tc: 924.0, TvapRef: 298.15, dHvapRef: 78.86, dHfAq: -910.18, dHfSolid: -813.99, cpAqKcalKgK: 0.34 },
  O2:         { mw: MW.O2, kind: 'permanent_gas', dHfIg: 0.0, cpIg: [28.11, -3.680e-6, 1.746e-5, -1.065e-8] },
  // NBS: NaClO(aq) −347.2
  NaOCl:      { mw: MW.NaOCl, kind: 'electrolyte', dHfIg: -347.2, cpIg: [50.0, 0, 0, 0], dHfAq: -347.2, cpAqKcalKgK: 0.82 },
  N2:         { mw: MW.N2, kind: 'permanent_gas', dHfIg: 0.0, cpIg: [31.15, -1.357e-2, 2.680e-5, -1.168e-8] },
  // NBS: NaClO3(s) −365.77, NaClO3(aq) −344.09
  NaClO3:     { mw: MW.NaClO3, kind: 'electrolyte', dHfIg: -344.09, cpIg: [80.0, 0, 0, 0], dHfAq: -344.09, dHfSolid: -365.77, cpAqKcalKgK: 0.28 },
  // NBS: FeCl2(aq) −423.4 (Fe²⁺ + 2Cl⁻), FeCl2(s) −341.79
  FeCl2:      { mw: MW.FeCl2, kind: 'electrolyte', dHfIg: -423.4, cpIg: [76.7, 0, 0, 0], dHfAq: -423.4, dHfSolid: -341.79, cpAqKcalKgK: 0.19 },
  // NBS: FeCl3(aq) −550.2 (Fe³⁺ + 3Cl⁻), FeCl3(s) −399.49
  FeCl3:      { mw: MW.FeCl3, kind: 'electrolyte', dHfIg: -550.2, cpIg: [96.7, 0, 0, 0], dHfAq: -550.2, dHfSolid: -399.49, cpAqKcalKgK: 0.18 },
  // PAC (폴리염화알루미늄): 비반응 불활성 응집제 — 생성열 0 기준, 현열만 [가정]
  PAC:        { mw: MW.PAC, kind: 'inert', dHfIg: 0.0, cpIg: [200.0, 0, 0, 0], dHfAq: 0.0, cpAqKcalKgK: 0.24 },
  // Glycerol: NIST ΔHf(l) −668.6, ΔHf(g) −588.0; Cp_l 221.9 J/mol·K; Cp_ig Joback [추산]
  Glycerol:   { mw: MW.Glycerol, kind: 'molecular', dHfIg: -588.0, cpIg: [14.352, 0.3967, -2.338e-4, 5.34e-8], Tc: 850.0, TvapRef: 298.15, dHvapRef: 80.6, cpLiq298: 221.9 },
  // 3-Chloro-1,2-propanediol (MCH): NIST/Bjellerup ΔHf(l) −525.1, ΔHf(g) −458.5; Cp_l ≈ 212 (Chueh–Swanson) [추산]; Cp_ig Joback [추산]
  MCH:        { mw: MW.MCH, kind: 'molecular', dHfIg: -458.5, cpIg: [21.952, 0.3695, -2.238e-4, 5.34e-8], Tc: 715.0, TvapRef: 298.15, dHvapRef: 66.6, cpLiq298: 212.0 },
  // 1,3-Dichloro-2-propanol (DCH): ΔHf(l) −385.0, ΔHf(g) −330.2; Cp_l ≈ 193 [추산]; Cp_ig Joback [추산]
  DCH:        { mw: MW.DCH, kind: 'molecular', dHfIg: -330.2, cpIg: [29.552, 0.3423, -2.138e-4, 5.2e-8], Tc: 668.0, TvapRef: 298.15, dHvapRef: 54.8, cpLiq298: 193.0 },
  // Epichlorohydrin (ECH): NIST ΔHf(l) −148.4, ΔHf(g) −107.8; Cp_l 131.9 (Perry); Cp_ig Joback [추산]
  ECH:        { mw: MW.ECH, kind: 'molecular', dHfIg: -107.8, cpIg: [-19.869, 0.4435, -3.661e-4, 1.241e-7], Tc: 610.0, TvapRef: 298.15, dHvapRef: 40.6, cpLiq298: 131.9 },
  // 1,2-Dichloropropane (DCP): NIST ΔHf(l) −198.3, ΔHf(g) −162.8; Cp_l 154.4 (NIST); Cp_ig Joback [추산]
  DCP:        { mw: MW.DCP, kind: 'molecular', dHfIg: -162.8, cpIg: [24.261, 0.3083, -1.834e-4, 4.2e-8], Tc: 572.0, TvapRef: 298.15, dHvapRef: 35.5, cpLiq298: 154.4 },

  // ── 범용 화공 성분 21종 (가스·경질 탄화수소·방향족·알코올·케톤·산·에스터·염소화용매) ──
  CH4:        { mw: MW.CH4, kind: 'permanent_gas', dHfIg: -74.87, cpIg: [19.25, 5.213e-2, 1.197e-5, -1.132e-8] },
  CO:         { mw: MW.CO, kind: 'permanent_gas', dHfIg: -110.53, cpIg: [30.87, -1.285e-2, 2.789e-5, -1.272e-8] },
  CO2:        { mw: MW.CO2, kind: 'molecular', dHfIg: -393.51, cpIg: [19.80, 7.344e-2, -5.602e-5, 1.715e-8], Tc: 304.13, TvapRef: 216.55, dHvapRef: 16.70, watsonN: 0.38 },
  NH3:        { mw: MW.NH3, kind: 'molecular', dHfIg: -45.94, cpIg: [27.31, 2.383e-2, 1.707e-5, -1.185e-8], Tc: 405.40, TvapRef: 239.82, dHvapRef: 23.35, watsonN: 0.35 },
  C2H4:       { mw: MW.C2H4, kind: 'molecular', dHfIg: 52.47, cpIg: [3.806, 1.566e-1, -8.348e-5, 1.755e-8], Tc: 282.34, TvapRef: 169.42, dHvapRef: 13.54, watsonN: 0.36 },
  C2H6:       { mw: MW.C2H6, kind: 'molecular', dHfIg: -83.82, cpIg: [5.409, 1.781e-1, -6.938e-5, 8.713e-9], Tc: 305.32, TvapRef: 184.55, dHvapRef: 14.70, watsonN: 0.36 },
  C3H6:       { mw: MW.C3H6, kind: 'molecular', dHfIg: 20.42, cpIg: [3.710, 2.345e-1, -1.160e-4, 2.205e-8], Tc: 364.90, TvapRef: 225.46, dHvapRef: 18.42, watsonN: 0.37 },
  C3H8:       { mw: MW.C3H8, kind: 'molecular', dHfIg: -104.68, cpIg: [-4.224, 3.063e-1, -1.586e-4, 3.215e-8], Tc: 369.83, TvapRef: 231.02, dHvapRef: 18.77, watsonN: 0.37 },
  nC4H10:     { mw: MW.nC4H10, kind: 'molecular', dHfIg: -125.79, cpIg: [9.487, 3.313e-1, -1.108e-4, -2.822e-9], Tc: 425.12, TvapRef: 298.15, dHvapRef: 21.02, cpLiq298: 140.5 },
  nC6H14:     { mw: MW.nC6H14, kind: 'molecular', dHfIg: -166.92, cpIg: [-4.413, 5.820e-1, -3.119e-4, 6.494e-8], Tc: 507.60, TvapRef: 298.15, dHvapRef: 31.56, cpLiq298: 195.6 },
  nC7H16:     { mw: MW.nC7H16, kind: 'molecular', dHfIg: -187.78, cpIg: [-5.146, 6.762e-1, -3.651e-4, 7.658e-8], Tc: 540.20, TvapRef: 298.15, dHvapRef: 36.57, cpLiq298: 224.6 },
  Benzene:    { mw: MW.Benzene, kind: 'molecular', dHfIg: 82.93, cpIg: [-33.92, 4.744e-1, -3.017e-4, 7.130e-8], Tc: 562.05, TvapRef: 298.15, dHvapRef: 33.83, cpLiq298: 136.0 },
  Toluene:    { mw: MW.Toluene, kind: 'molecular', dHfIg: 50.17, cpIg: [-24.35, 5.125e-1, -2.765e-4, 4.911e-8], Tc: 591.75, TvapRef: 298.15, dHvapRef: 38.01, cpLiq298: 157.3 },
  pXylene:    { mw: MW.pXylene, kind: 'molecular', dHfIg: 17.95, cpIg: [-25.09, 6.042e-1, -3.374e-4, 6.820e-8], Tc: 616.20, TvapRef: 298.15, dHvapRef: 42.40, cpLiq298: 181.7 },
  MeOH:       { mw: MW.MeOH, kind: 'molecular', dHfIg: -200.94, cpIg: [21.15, 7.092e-2, 2.587e-5, -2.852e-8], Tc: 512.64, TvapRef: 298.15, dHvapRef: 37.43, cpLiq298: 81.2 },
  EtOH:       { mw: MW.EtOH, kind: 'molecular', dHfIg: -234.95, cpIg: [9.014, 2.141e-1, -8.390e-5, 1.373e-9], Tc: 513.92, TvapRef: 298.15, dHvapRef: 42.32, cpLiq298: 112.4 },
  IPA:        { mw: MW.IPA, kind: 'molecular', dHfIg: -272.70, cpIg: [32.43, 1.885e-1, 6.406e-5, -9.261e-8], Tc: 508.30, TvapRef: 298.15, dHvapRef: 45.39, cpLiq298: 154.4 },
  Acetone:    { mw: MW.Acetone, kind: 'molecular', dHfIg: -217.15, cpIg: [6.301, 2.606e-1, -1.253e-4, 2.038e-8], Tc: 508.20, TvapRef: 298.15, dHvapRef: 30.99, cpLiq298: 126.3 },
  AceticAcid: { mw: MW.AceticAcid, kind: 'molecular', dHfIg: -432.25, cpIg: [4.840, 2.549e-1, -1.753e-4, 4.949e-8], Tc: 592.71, TvapRef: 298.15, dHvapRef: 39.00, cpLiq298: 123.3 },
  EtOAc:      { mw: MW.EtOAc, kind: 'molecular', dHfIg: -444.10, cpIg: [7.234, 4.072e-1, -2.092e-4, 2.855e-8], Tc: 523.30, TvapRef: 298.15, dHvapRef: 35.60, cpLiq298: 170.7 },
  CHCl3:      { mw: MW.CHCl3, kind: 'molecular', dHfIg: -103.18, cpIg: [24.00, 1.893e-1, -1.841e-4, 6.657e-8], Tc: 536.40, TvapRef: 298.15, dHvapRef: 31.28, cpLiq298: 114.2 },
  Ar:         { mw: MW.Ar, kind: 'permanent_gas', dHfIg: 0.0, cpIg: [20.786, 0, 0, 0] },
  H2S: { mw: MW.H2S, kind: 'molecular', dHfIg: -20.63, cpIg: [31.94, 0.001436, 2.432e-05, -1.176e-08], Tc: 373.53, TvapRef: 212.8, dHvapRef: 18.67, watsonN: 0.38 },
  SO2: { mw: MW.SO2, kind: 'molecular', dHfIg: -296.81, cpIg: [23.85, 0.06699, -4.961e-05, 1.328e-08], Tc: 430.75, TvapRef: 263.1, dHvapRef: 24.94, watsonN: 0.38 },
  SO3: { mw: MW.SO3, kind: 'molecular', dHfIg: -395.72, cpIg: [16.37, 0.1459, -0.000112, 3.242e-08], Tc: 490.85, TvapRef: 317.9, dHvapRef: 40.69, watsonN: 0.38 },
  iC4H10: { mw: MW.iC4H10, kind: 'molecular', dHfIg: -134.52, cpIg: [-1.39, 0.3847, -0.0001846, 2.895e-08], Tc: 407.85, TvapRef: 261.4, dHvapRef: 21.3, watsonN: 0.38 },
  C4H8_1: { mw: MW.C4H8_1, kind: 'molecular', dHfIg: -0.13, cpIg: [-2.994, 0.3532, -0.000199, 4.463e-08], Tc: 419.5, TvapRef: 266.9, dHvapRef: 21.92, watsonN: 0.38 },
  nC5H12: { mw: MW.nC5H12, kind: 'molecular', dHfIg: -146.44, cpIg: [-3.626, 0.4873, -0.000258, 5.305e-08], Tc: 469.7, TvapRef: 309.2, dHvapRef: 25.79, watsonN: 0.38 },
  nC8H18: { mw: MW.nC8H18, kind: 'molecular', dHfIg: -208.45, cpIg: [-6.096, 0.7712, -0.0004195, 8.855e-08], Tc: 568.7, TvapRef: 398.8, dHvapRef: 34.41, watsonN: 0.38 },
  Cyclohexane: { mw: MW.Cyclohexane, kind: 'molecular', dHfIg: -123.14, cpIg: [-54.54, 0.6113, -0.0002523, 1.321e-08], Tc: 553.8, TvapRef: 353.9, dHvapRef: 29.97, watsonN: 0.38 },
  Ethylbenzene: { mw: MW.Ethylbenzene, kind: 'molecular', dHfIg: 29.92, cpIg: [-43.1, 0.7072, -0.0004811, 1.301e-07], Tc: 617.15, TvapRef: 409.3, dHvapRef: 35.57, watsonN: 0.38 },
  Styrene: { mw: MW.Styrene, kind: 'molecular', dHfIg: 147.36, cpIg: [-28.25, 0.6159, -0.0004023, 9.935e-08], Tc: 636.0, TvapRef: 418.3, dHvapRef: 36.8, watsonN: 0.38 },
  Cumene: { mw: MW.Cumene, kind: 'molecular', dHfIg: 3.93, cpIg: [-48.96, 0.815, -0.000542, 1.42e-07], Tc: 631.0, TvapRef: 425.6, dHvapRef: 37.53, watsonN: 0.38 },
  Phenol: { mw: MW.Phenol, kind: 'molecular', dHfIg: -96.4, cpIg: [-35.84, 0.5983, -0.0004827, 1.526e-07], Tc: 694.25, TvapRef: 455.0, dHvapRef: 45.69, watsonN: 0.38 },
  THF: { mw: MW.THF, kind: 'molecular', dHfIg: -184.2, cpIg: [-19.41, 0.425, -0.000251, 5.95e-08], Tc: 540.15, TvapRef: 339.1, dHvapRef: 29.81, watsonN: 0.38 },
  DMF: { mw: MW.DMF, kind: 'molecular', dHfIg: -191.7, cpIg: [11.2, 0.342, -0.000192, 4.2e-08], Tc: 649.6, TvapRef: 426.2, dHvapRef: 42.3, watsonN: 0.38 },
  DMSO: { mw: MW.DMSO, kind: 'molecular', dHfIg: -151.3, cpIg: [14.8, 0.312, -0.000178, 3.9e-08], Tc: 729.0, TvapRef: 462.2, dHvapRef: 43.1, watsonN: 0.38 },
  MTBE: { mw: MW.MTBE, kind: 'molecular', dHfIg: -283.5, cpIg: [2.53, 0.5136, -0.0002596, 4.303e-08], Tc: 497.1, TvapRef: 328.4, dHvapRef: 27.94, watsonN: 0.38 },
  MEK: { mw: MW.MEK, kind: 'molecular', dHfIg: -238.7, cpIg: [10.94, 0.3559, -0.00019, 3.92e-08], Tc: 535.5, TvapRef: 352.8, dHvapRef: 31.3, watsonN: 0.38 },
  DMC: { mw: MW.DMC, kind: 'molecular', dHfIg: -571.0, cpIg: [18.5, 0.335, -0.000185, 3.8e-08], Tc: 557.0, TvapRef: 363.5, dHvapRef: 33.2, watsonN: 0.38 },
  EG: { mw: MW.EG, kind: 'molecular', dHfIg: -389.3, cpIg: [35.7, 0.2483, -0.0001497, 3.01e-08], Tc: 720.0, TvapRef: 470.5, dHvapRef: 50.5, watsonN: 0.38 },
  MEA: { mw: MW.MEA, kind: 'molecular', dHfIg: -210.2, cpIg: [9.31, 0.332, -0.000181, 3.65e-08], Tc: 671.0, TvapRef: 443.6, dHvapRef: 49.8, watsonN: 0.38 },
  MDEA: { mw: MW.MDEA, kind: 'molecular', dHfIg: -372.0, cpIg: [18.2, 0.585, -0.000312, 6.4e-08], Tc: 677.8, TvapRef: 520.3, dHvapRef: 62.5, watsonN: 0.38 },
  FormicAcid: { mw: MW.FormicAcid, kind: 'molecular', dHfIg: -378.6, cpIg: [11.71, 0.1358, -8.411e-05, 2.017e-08], Tc: 588.0, TvapRef: 373.9, dHvapRef: 22.7, watsonN: 0.38 },
  HNO3:       { mw: MW.HNO3, kind: 'electrolyte', dHfIg: -134.30, cpIg: [19.63, 0.1539, -0.0001158, 3.288e-08], Tc: 520.0, TvapRef: 356.2, dHvapRef: 39.1, dHfAq: -207.36, cpAqKcalKgK: 0.42 },
  CUSTOM_1: { mw: MW.CUSTOM_1, kind: 'molecular', dHfIg: -274.6, cpIg: [3.266, 0.418, -0.0002242, 4.685e-08], Tc: 563.05, TvapRef: 390.9, dHvapRef: 43.29, watsonN: 0.38 },
  CUSTOM_2: { mw: MW.CUSTOM_2, kind: 'molecular', dHfIg: 87.03, cpIg: [-40.5, 0.638, -0.000513, 1.63e-07], Tc: 699.0, TvapRef: 457.3, dHvapRef: 42.4, watsonN: 0.38 },
};

const COMP_KEYS = Object.keys(THERMO_DATA) as SimCompKey[];

/** 비휘발성(수용액·고체로만 존재) 성분 — 기상에 실려 있어도(미스트) 액상 엔탈피로 계산 */
const NONVOLATILE: ReadonlySet<SimCompKey> = new Set<SimCompKey>(['NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC']);

// ── 적분 용해열 표 ΔHs(n) (kJ/mol 용질, 25 °C) ── [n, ΔHs]
// 기준 순수상: HCl(g), NaOH(s), H2SO4(l). n=0 은 순수상(ΔHs=0).
const DHS_TABLE: Partial<Record<SimCompKey, { pts: [number, number][]; inf: number }>> = {
  // Felder & Rousseau Table B.11 (HCl(g)); ∞ 값은 NBS ΔHf(aq) − ΔHf(g) = −74.85
  HCl: {
    pts: [[0, 0], [1, -26.22], [2, -48.82], [3, -56.85], [4, -61.20], [5, -64.05], [10, -69.49], [20, -71.78], [25, -72.03], [50, -73.10], [100, -73.59], [200, -73.85], [500, -74.04], [1000, -74.13]],
    inf: -74.85,
  },
  // NaOH(s): n ≥ 10 Felder B.11; n < 10 은 가성소다 핸드북 희석열(50→32 wt% ≈ −6 kJ/mol) 재현하도록 보정 [보정]
  NaOH: {
    pts: [[0, 0], [1, -22.0], [2, -30.0], [3, -33.6], [4, -35.6], [5, -37.74], [10, -42.51], [20, -42.84], [25, -42.72], [50, -42.59], [100, -42.51], [200, -42.34], [500, -42.26]],
    inf: -42.89,
  },
  // H2SO4(l): Felder & Rousseau Table B.11
  H2SO4: {
    pts: [[0, 0], [0.5, -15.73], [1, -28.07], [1.5, -36.90], [2, -41.92], [3, -48.99], [4, -54.06], [5, -58.03], [10, -67.03], [25, -72.30], [50, -73.34], [100, -73.97], [200, -74.86], [500, -76.73], [1000, -78.57], [5000, -84.43], [10000, -87.07], [100000, -93.64]],
    inf: -96.19,
  },
};

/** 적분 용해열 ΔHs(n), kJ/mol 용질 (순수 기준상 → n mol H₂O 용액) */
export function integralHeatOfSolutionKJmol(comp: SimCompKey, nWaterPerSolute: number): number {
  const tb = DHS_TABLE[comp];
  if (!tb) return 0;
  const n = Math.max(0, nWaterPerSolute);
  const pts = tb.pts;
  const last = pts[pts.length - 1];
  if (n >= last[0]) {
    // n_max 이후: 1/n 선형으로 ∞ 값에 점근
    return last[1] + (tb.inf - last[1]) * (1 - last[0] / Math.max(n, 1e-12));
  }
  for (let i = 1; i < pts.length; i++) {
    if (n <= pts[i][0]) {
      const [n0, h0] = pts[i - 1];
      const [n1, h1] = pts[i];
      return h0 + ((h1 - h0) * (n - n0)) / Math.max(1e-12, n1 - n0);
    }
  }
  return tb.inf;
}

// ── 순수성분 물성 함수 ────────────────────────────────────────

/** 이상기체 정압비열 Cp_ig(T), J/mol·K (= kJ/kmol·K) */
export function idealGasCpJmolK(comp: SimCompKey, T_K: number): number {
  const [a, b, c, d] = THERMO_DATA[comp].cpIg;
  const T = Math.max(150, Math.min(1500, T_K));
  return a + b * T + c * T * T + d * T * T * T;
}

/** ∫_{298.15}^{T} Cp_ig dT, kJ/kmol */
export function idealGasSensibleKJkmol(comp: SimCompKey, T_K: number): number {
  const [a, b, c, d] = THERMO_DATA[comp].cpIg;
  const T = Math.max(150, Math.min(1500, T_K));
  const T0 = T_REF_K;
  return (
    a * (T - T0) +
    (b / 2) * (T * T - T0 * T0) +
    (c / 3) * (T * T * T - T0 * T0 * T0) +
    (d / 4) * (T * T * T * T - T0 * T0 * T0 * T0)
  );
}

/** 이상기체 총엔탈피 (생성열 기준), kJ/kmol */
export function idealGasEnthalpyKJkmol(comp: SimCompKey, T_K: number): number {
  return THERMO_DATA[comp].dHfIg * 1000 + idealGasSensibleKJkmol(comp, T_K);
}

function watsonExponent(comp: SimCompKey): number {
  const d = THERMO_DATA[comp];
  if (d.watsonN !== undefined) return d.watsonN;
  if (d.cpLiq298 !== undefined && d.Tc && d.Tc > T_REF_K + 2 && d.dHvapRef && d.TvapRef !== undefined) {
    // n = (Cp_L − Cp_ig)·(Tc − T)/ΔHvap(T) @ 298.15 K (Watson 미분 관계) — 액상 Cp 문헌값과 일관되게 산정
    const dHv298 = d.dHvapRef * 1000 * Math.pow(Math.max(0, (d.Tc - T_REF_K) / Math.max(1, d.Tc - d.TvapRef)), 0.38);
    const n = ((d.cpLiq298 - idealGasCpJmolK(comp, T_REF_K)) * (d.Tc - T_REF_K)) / Math.max(1, dHv298);
    return Math.max(0.2, Math.min(0.8, n));
  }
  return 0.38;
}

const WATSON_N_CACHE = new Map<SimCompKey, number>();
export function invalidateThermoCache(comp?: SimCompKey): void {
  if (comp) WATSON_N_CACHE.delete(comp);
  else WATSON_N_CACHE.clear();
}
function watsonN(comp: SimCompKey): number {
  let n = WATSON_N_CACHE.get(comp);
  if (n === undefined) {
    n = watsonExponent(comp);
    WATSON_N_CACHE.set(comp, n);
  }
  return n;
}

/** DIPPR-100 액상 Cp 적분 ∫_{298.15}^{T} Cp_L dT (kJ/kmol), 유효범위 밖은 경계 Cp 로 선형 외삽 */
function liquidPolySensibleKJkmol(d: ThermoCompData, T_K: number): number {
  const p = d.cpLiqPoly!;
  const [lo, hi] = d.cpLiqRangeK ?? [200, 600];
  const cpAt = (T: number) => (p[0] + p[1] * T + p[2] * T * T + p[3] * T ** 3 + p[4] * T ** 4) / 1000;
  const integ = (T: number) => (p[0] * T + (p[1] / 2) * T * T + (p[2] / 3) * T ** 3 + (p[3] / 4) * T ** 4 + (p[4] / 5) * T ** 5) / 1000;
  const T0 = T_REF_K;
  const Tc = Math.max(lo, Math.min(hi, T_K));
  let h = integ(Tc) - integ(T0);
  if (T_K > hi) h += cpAt(hi) * (T_K - hi);
  else if (T_K < lo) h += cpAt(lo) * (T_K - lo);
  return h;
}

/** 증발잠열 ΔHvap(T), kJ/kmol — Watson 상관식 (T_K ≥ Tc − 2 이면 0 으로 연속 수렴, 초임계 NaN 방지) */
export function heatOfVaporizationKJkmol(comp: SimCompKey, T_K: number): number {
  const d = THERMO_DATA[comp];
  if (!d.Tc || d.dHvapRef === undefined || d.TvapRef === undefined) return 0;
  if (T_K >= d.Tc - 2) return 0;
  if (d.cpLiqPoly) {
    const raw = Math.max(0, d.dHvapRef * 1000 + idealGasSensibleKJkmol(comp, T_K) - liquidPolySensibleKJkmol(d, T_K));
    return T_K > d.Tc - 15 ? raw * ((d.Tc - 2 - T_K) / 13) : raw;
  }
  const ratio = (d.Tc - T_K) / Math.max(1e-6, d.Tc - d.TvapRef);
  if (ratio <= 0) return 0;
  const dHv = d.dHvapRef * 1000 * Math.pow(ratio, watsonN(comp));
  return T_K > d.Tc - 10 ? dHv * ((d.Tc - 2 - T_K) / 8) : dHv;
}

/** 액상 정압비열 Cp_L(T), J/mol·K — 이상기체 경로와 열역학적으로 일관 (Cp_ig + n·ΔHvap/(Tc−T)), H₂O 는 DIPPR-100 */
export function liquidCpJmolK(comp: SimCompKey, T_K: number): number {
  const d = THERMO_DATA[comp];
  // 전해질·불활성: 수용액 겉보기 비열 (무수 액화 HCl 은 아래 Watson 경로)
  if ((d.kind === 'electrolyte' && comp !== 'HCl') || d.kind === 'inert') {
    return (d.cpAqKcalKgK ?? 0.3) * d.mw * KJ_PER_KCAL;
  }
  if (d.cpLiqPoly) {
    if (d.Tc && T_K >= d.Tc - 2) return idealGasCpJmolK(comp, T_K);
    const p = d.cpLiqPoly;
    const [lo, hi] = d.cpLiqRangeK ?? [200, 600];
    const T = Math.max(lo, Math.min(hi, T_K));
    return (p[0] + p[1] * T + p[2] * T * T + p[3] * T ** 3 + p[4] * T ** 4) / 1000;
  }
  if (!d.Tc || d.kind === 'permanent_gas' || T_K >= d.Tc - 2) return idealGasCpJmolK(comp, T_K);
  const T = Math.min(T_K, d.Tc - 2);
  return idealGasCpJmolK(comp, T) + (watsonN(comp) * heatOfVaporizationKJkmol(comp, T)) / Math.max(2, d.Tc - T);
}

/**
 * 성분 몰엔탈피 (생성열 기준), kJ/kmol
 * @param phase 'V' 이상기체 · 'L' 순수 액체(분자성; 전해질은 무한희석 수용액) · 'AQ' 무한희석 수용액 · 'S' 고체
 *   (MESH 단 에너지수지 등 후속 모듈은 이 함수로 단별 h_L, h_V 를 구하면 된다)
 */
export function componentMolarEnthalpy(comp: SimCompKey, T_C: number, phase: ThermoPhase): number {
  const d = THERMO_DATA[comp];
  const T_K = T_C + 273.15;
  const dT = T_C - 25.0;
  if (d.kind === 'permanent_gas') return idealGasEnthalpyKJkmol(comp, T_K);
  if (d.kind === 'inert') return (d.dHfAq ?? 0) * 1000 + (d.cpAqKcalKgK ?? 0.24) * d.mw * KJ_PER_KCAL * dT;

  if (d.kind === 'electrolyte') {
    if (phase === 'V' && comp === 'HCl') return idealGasEnthalpyKJkmol(comp, T_K);
    if (phase === 'L' && comp === 'HCl') {
      // 무수 액화 HCl (물 없음) — T_K ≥ Tc − 2 이면 ΔHvap = 0 으로 이상기체 엔탈피에 연속 수렴
      return idealGasEnthalpyKJkmol(comp, T_K) - heatOfVaporizationKJkmol(comp, T_K);
    }
    if (phase === 'S' && d.dHfSolid !== undefined) return d.dHfSolid * 1000 + (d.cpAqKcalKgK ?? 0.2) * d.mw * KJ_PER_KCAL * dT;
    return (d.dHfAq ?? d.dHfIg) * 1000 + (d.cpAqKcalKgK ?? 0.3) * d.mw * KJ_PER_KCAL * dT;
  }

  // 분자성 (H2O, Cl2, 유기물, 액화가스): 기상 = 이상기체, 액상 = 기상 − ΔHvap(T) (T_K ≥ Tc − 2 초임계 시 ΔHvap = 0 → hV 수렴)
  const hV = idealGasEnthalpyKJkmol(comp, T_K);
  if (phase === 'V') return hV;
  if (d.Tc && T_K >= d.Tc - 2) return hV;
  if (d.cpLiqPoly && d.dHvapRef !== undefined) {
    const hLPoly = (d.dHfIg - d.dHvapRef) * 1000 + liquidPolySensibleKJkmol(d, T_K);
    if (d.Tc && T_K > d.Tc - 15) {
      const w = (T_K - (d.Tc - 15)) / 13;
      return hLPoly * (1 - w) + hV * w;
    }
    return hLPoly;
  }
  return hV - heatOfVaporizationKJkmol(comp, T_K);
}

// ── 혼합물 엔탈피 ─────────────────────────────────────────────

/** NaCl 용해도 (kg NaCl / kg H₂O), 0–100 °C 문헌값 적합 */
export function naclSolubilityKgPerKgWater(T_C: number): number {
  const T = Math.max(0, Math.min(110, T_C));
  return (35.65 + 0.0035 * T + 3.12e-4 * T * T) / 100;
}

export interface LiquidEnthalpyDetail {
  totalKJH: number;
  /** 농도 의존 용해/희석 과잉엔탈피 (∞ 희석 기준 대비), kJ/h */
  excessKJH: number;
  /** 용해도 초과 고체 NaCl, kg/h */
  solidNaClKgH: number;
}

/** 액상(수용액·유기액·액화가스) 총엔탈피, kJ/h */
export function liquidMixtureEnthalpy(liqKgH: Partial<CompFlows>, T_C: number, P_kgcm2g = 0): LiquidEnthalpyDetail {
  const P_barA = Math.max(1e-4, (P_kgcm2g + 1.033227) * 0.980665);
  const T_K = T_C + 273.15;
  const nW = Math.max(0, liqKgH.H2O ?? 0) / MW.H2O;
  let total = 0;
  let excess = 0;
  let solidNaCl = 0;
  for (const k of COMP_KEYS) {
    const m = Math.max(0, liqKgH[k] ?? 0);
    if (m <= 0) continue;
    const n = m / THERMO_DATA[k].mw;
    if (k === 'NaCl') {
      const dissolvable = naclSolubilityKgPerKgWater(T_C) * Math.max(0, liqKgH.H2O ?? 0);
      const mSolid = Math.max(0, m - dissolvable);
      solidNaCl = mSolid;
      const nS = mSolid / MW.NaCl;
      total += (n - nS) * componentMolarEnthalpy('NaCl', T_C, 'AQ') + nS * componentMolarEnthalpy('NaCl', T_C, 'S');
      continue;
    }
    const tb = DHS_TABLE[k];
    if (tb) {
      const d = THERMO_DATA[k];
      const ratio = nW / n;
      const sens = (d.cpAqKcalKgK ?? 0.3) * d.mw * KJ_PER_KCAL * (T_C - 25.0);
      const hInf = (d.dHfAq ?? 0) * 1000 + sens;
      let h: number;
      if (k === 'HCl') {
        const pureRef = d.dHfIg * 1000;
        if (ratio >= 1) {
          h = pureRef + integralHeatOfSolutionKJmol(k, ratio) * 1000 + sens;
        } else {
          // 물 부족 (n<1): 무수 액화 HCl ↔ n=1 수화물 사이 선형 연결
          const hAnh = componentMolarEnthalpy('HCl', T_C, 'L');
          const h1 = pureRef + integralHeatOfSolutionKJmol(k, 1) * 1000 + sens;
          h = hAnh + (h1 - hAnh) * ratio;
        }
      } else {
        const pureRef = (d.dHfSolid ?? d.dHfIg) * 1000;
        h = pureRef + integralHeatOfSolutionKJmol(k, ratio) * 1000 + sens;
      }
      total += n * h;
      excess += n * (h - hInf);
      continue;
    }
    let hLiq = componentMolarEnthalpy(k, T_C, 'L');
    const dComp = THERMO_DATA[k];
    if (P_barA > 1.01325 && dComp.kind === 'molecular' && (!dComp.Tc || T_K < dComp.Tc - 2)) {
      const pRef = Math.max(1.01325, pureDipprOrAntoineBarA(k, T_C));
      if (P_barA > pRef) {
        // Poynting 압축액체 부피 보정: v_L [m³/kmol] · (P − P_sat) [bar] · 100 [kJ/(m³·bar)] = kJ/kmol
        hLiq += calcRackettLiquidVolumeLmol(k, T_C) * (P_barA - pRef) * 100.0;
      }
    }
    total += n * hLiq;
  }
  return { totalKJH: total, excessKJH: excess, solidNaClKgH: solidNaCl };
}

/** 기상 총엔탈피 (이상기체), kJ/h — 비휘발성 미스트는 제외(액상으로 이관하여 계산) */
export function vaporMixtureEnthalpyKJH(vapKgH: Partial<CompFlows>, T_C: number, P_kgcm2g = 0): number {
  const T_K = T_C + 273.15;
  let total = 0;
  let nTot = 0;
  const nMol: Partial<Record<SimCompKey, number>> = {};
  for (const k of COMP_KEYS) {
    if (NONVOLATILE.has(k)) continue;
    const m = Math.max(0, vapKgH[k] ?? 0);
    if (m <= 0) continue;
    const nk = m / THERMO_DATA[k].mw;
    nMol[k] = nk;
    nTot += nk;
    total += nk * idealGasEnthalpyKJkmol(k, T_K);
  }
  if (nTot > 1e-12) {
    const P_barA = Math.max(1e-4, (P_kgcm2g + 1.033227) * 0.980665);
    total += nTot * calcVaporDepartureDeltaJmol(nMol, T_C, P_barA, 'PR');
  }
  return total;
}

/**
 * 다단 증류 MESH 내부 루프용 무할당(Zero-Allocation) 액상 혼합 몰엔탈피, kJ/kmol
 * - liquidMixtureEnthalpy 와 100% 동일한 생성열·적분용해열·용해도 수식을 활성 성분(activeComps)만 순회하여 고속 산출
 */
export function liquidMolarEnthalpyKJkmol(
  xMol: Partial<Record<SimCompKey, number>>,
  activeComps: readonly SimCompKey[],
  T_C: number
): number {
  const nW = Math.max(0, xMol.H2O ?? 0);
  let total = 0;
  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    const n = Math.max(0, xMol[k] ?? 0);
    if (n <= 0) continue;
    if (k === 'NaCl') {
      const dissolvableKg = naclSolubilityKgPerKgWater(T_C) * (nW * MW.H2O);
      const m = n * MW.NaCl;
      const mSolid = Math.max(0, m - dissolvableKg);
      const nS = mSolid / MW.NaCl;
      total += (n - nS) * componentMolarEnthalpy('NaCl', T_C, 'AQ') + nS * componentMolarEnthalpy('NaCl', T_C, 'S');
      continue;
    }
    const tb = DHS_TABLE[k];
    if (tb) {
      const d = THERMO_DATA[k];
      const ratio = nW / n;
      const sens = (d.cpAqKcalKgK ?? 0.3) * d.mw * KJ_PER_KCAL * (T_C - 25.0);
      let h: number;
      if (k === 'HCl') {
        const pureRef = d.dHfIg * 1000;
        if (ratio >= 1) {
          h = pureRef + integralHeatOfSolutionKJmol(k, ratio) * 1000 + sens;
        } else {
          const hAnh = componentMolarEnthalpy('HCl', T_C, 'L');
          const h1 = pureRef + integralHeatOfSolutionKJmol(k, 1) * 1000 + sens;
          h = hAnh + (h1 - hAnh) * ratio;
        }
      } else {
        const pureRef = (d.dHfSolid ?? d.dHfIg) * 1000;
        h = pureRef + integralHeatOfSolutionKJmol(k, ratio) * 1000 + sens;
      }
      total += n * h;
      continue;
    }
    total += n * componentMolarEnthalpy(k, T_C, 'L');
  }
  return total;
}

/**
 * 다단 증류 MESH 내부 루프용 무할당(Zero-Allocation) 기상 혼합 몰엔탈피, kJ/kmol
 */
export function vaporMolarEnthalpyKJkmol(
  yMol: Partial<Record<SimCompKey, number>>,
  activeComps: readonly SimCompKey[],
  T_C: number
): number {
  const T_K = T_C + 273.15;
  let total = 0;
  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    if (NONVOLATILE.has(k)) continue;
    const n = Math.max(0, yMol[k] ?? 0);
    if (n <= 0) continue;
    total += n * idealGasEnthalpyKJkmol(k, T_K);
  }
  return total;
}

export interface StreamEnthalpyResult {
  kJH: number;
  kcalH: number;
  vaporKJH: number;
  liquidKJH: number;
  excessKJH: number;
  solidNaClKgH: number;
}

/**
 * 스트림 총엔탈피 (생성열 기준)
 * @param vapKgH 기상 성분 유량 (kg/h)
 * @param liqKgH 액상 성분 유량 (kg/h)
 */
export function streamEnthalpy(vapKgH: Partial<CompFlows>, liqKgH: Partial<CompFlows>, T_C: number, P_kgcm2g = 0): StreamEnthalpyResult {
  // 기상 비휘발성(미스트) 성분은 액상으로 이관
  let liq: Partial<CompFlows> = liqKgH;
  let moved = false;
  for (const k of NONVOLATILE) {
    if ((vapKgH[k] ?? 0) > 0) { moved = true; break; }
  }
  if (moved) {
    const l: Partial<CompFlows> = { ...liqKgH };
    for (const k of NONVOLATILE) l[k] = (l[k] ?? 0) + Math.max(0, vapKgH[k] ?? 0);
    liq = l;
  }
  const hv = vaporMixtureEnthalpyKJH(vapKgH, T_C, P_kgcm2g);
  const hl = liquidMixtureEnthalpy(liq, T_C, P_kgcm2g);
  const kJH = hv + hl.totalKJH;
  return { kJH, kcalH: kJH / KJ_PER_KCAL, vaporKJH: hv, liquidKJH: hl.totalKJH, excessKJH: hl.excessKJH, solidNaClKgH: hl.solidNaClKgH };
}

/** 스트림 총엔탈피 (kcal/h) 단축 함수 */
export function streamEnthalpyKcalH(vapKgH: Partial<CompFlows>, liqKgH: Partial<CompFlows>, T_C: number, P_kgcm2g = 0): number {
  return streamEnthalpy(vapKgH, liqKgH, T_C, P_kgcm2g).kcalH;
}

/** 25 °C 표준 반응엔탈피 (kJ/kmol 반응), stoich: 생성물 +, 반응물 − 계수, 상 지정 */
export function standardReactionEnthalpyKJ(stoich: { comp: SimCompKey; nu: number; phase: ThermoPhase }[], T_C = 25): number {
  return stoich.reduce((s, t) => s + t.nu * componentMolarEnthalpy(t.comp, T_C, t.phase), 0);
}

/**
 * 염수 전해 열중립전압 V_tn (V)
 *   2NaCl(aq) + 2H₂O(l) → 2NaOH(aq) + Cl₂(g) + H₂(g),  V_tn = ΔH / (2F)
 *   NaOH 농도 효과(적분 용해열) 포함 — 기본 32 wt% 가성소다 기준
 */
export function chlorAlkaliThermoneutralVoltage(T_C = 25, caNaohWtPct = 32): number {
  const w = Math.min(0.6, Math.max(0.01, caNaohWtPct / 100));
  const nRatio = ((1 - w) / MW.H2O) / (w / MW.NaOH);
  const hNaOH = (THERMO_DATA.NaOH.dHfSolid! + integralHeatOfSolutionKJmol('NaOH', nRatio)) * 1000 +
    (THERMO_DATA.NaOH.cpAqKcalKgK ?? 0.5) * MW.NaOH * KJ_PER_KCAL * (T_C - 25);
  const dH =
    2 * hNaOH +
    componentMolarEnthalpy('Cl2', T_C, 'V') +
    componentMolarEnthalpy('H2', T_C, 'V') -
    2 * componentMolarEnthalpy('NaCl', T_C, 'AQ') -
    2 * componentMolarEnthalpy('H2O', T_C, 'L');
  return (dH * 1000) / (2 * FARADAY_C_MOL * 1000);
}

// ── PH (등압·등엔탈피) 플래시 ──────────────────────────────────

export interface PhFlashResult {
  T_C: number;
  vap: CompFlows;
  liq: CompFlows;
  converged: boolean;
  iterations: number;
  /** 수용액 비점 상한에서 추가 증발로 에너지를 흡수한 경우 true */
  atBoilingCap: boolean;
}

export interface PhFlashOptions {
  T_guess?: number;
  T_min?: number;
  T_max?: number;
  /** 액상 물이 존재하는 동안의 온도 상한 (수용액 비점, °C). 상한 초과 에너지는 물 증발로 흡수 */
  boilingCapC?: number | null;
  /** 허용 엔탈피 오차 (kcal/h) */
  tolKcalH?: number;
}

type Split = { vap: CompFlows; liq: CompFlows };

function lerpSplit(a: Split, b: Split, f: number): Split {
  const vap = { ...a.vap };
  const liq = { ...a.liq };
  for (const k of COMP_KEYS) {
    vap[k] = Math.max(0, a.vap[k] + (b.vap[k] - a.vap[k]) * f);
    liq[k] = Math.max(0, a.liq[k] + (b.liq[k] - a.liq[k]) * f);
  }
  return { vap, liq };
}

/**
 * PH 플래시: 주어진 총엔탈피(H_target, kcal/h)·압력에서 온도와 기액 분배를 구한다.
 *   - tpFlash(T) 콜백(등온 TP 플래시)을 이용한 Illinois(수정 Regula-Falsi) 온도 탐색
 *   - 불연속(단일 휘발성분 비등·Cl₂ 응축 등) 구간에서는 두 상태 사이 기액 분배를 선형 보간하여 에너지 정확 일치
 *   - boilingCapC 지정 시: 수용액 비점에서 추가 에너지는 물 증발로 흡수 (진공 단열 플래시·증발)
 */
export function phFlash(
  flows: CompFlows,
  P_kgcm2g: number,
  targetKcalH: number,
  tpFlash: (T_C: number) => Split,
  opts: PhFlashOptions = {}
): PhFlashResult {
  const tol = opts.tolKcalH ?? 0.5;
  const Tmin = opts.T_min ?? -120;
  const TmaxAbs = opts.T_max ?? 600;
  const cap = opts.boilingCapC ?? null;
  let iters = 0;

  const evalAt = (T: number, forceWaterVap = false): Split & { H: number } => {
    iters++;
    const s = tpFlash(T);
    let vap = s.vap;
    let liq = s.liq;
    if (forceWaterVap && liq.H2O > 0) {
      vap = { ...vap, H2O: vap.H2O + liq.H2O };
      liq = { ...liq, H2O: 0 };
    }
    return { vap, liq, H: streamEnthalpyKcalH(vap, liq, T, P_kgcm2g) };
  };

  const solveBracket = (Ta: number, Tb: number, forceWaterVap: boolean): PhFlashResult => {
    let a = evalAt(Ta, forceWaterVap);
    let b = evalAt(Tb, forceWaterVap);
    if (targetKcalH <= a.H) return { T_C: Ta, vap: a.vap, liq: a.liq, converged: Math.abs(targetKcalH - a.H) <= tol, iterations: iters, atBoilingCap: false };
    if (targetKcalH >= b.H) return { T_C: Tb, vap: b.vap, liq: b.liq, converged: Math.abs(targetKcalH - b.H) <= tol, iterations: iters, atBoilingCap: false };
    let side = 0;
    let fa = a.H - targetKcalH;
    let fb = b.H - targetKcalH;
    for (let it = 0; it < 80; it++) {
      if (Tb - Ta < 2e-4) break;
      let Tm = (Ta * fb - Tb * fa) / (fb - fa);
      if (!Number.isFinite(Tm) || Tm <= Ta || Tm >= Tb) Tm = 0.5 * (Ta + Tb);
      // 불연속 구간 대비: 브래킷 폭이 줄지 않으면 이분법 혼용
      if (it % 4 === 3) Tm = 0.5 * (Ta + Tb);
      const m = evalAt(Tm, forceWaterVap);
      const fm = m.H - targetKcalH;
      if (Math.abs(fm) <= tol) return { T_C: Tm, vap: m.vap, liq: m.liq, converged: true, iterations: iters, atBoilingCap: false };
      if (fm < 0) {
        Ta = Tm; a = m; fa = fm;
        if (side === -1) fb /= 2;
        side = -1;
      } else {
        Tb = Tm; b = m; fb = fm;
        if (side === 1) fa /= 2;
        side = 1;
      }
    }
    // 최종: 두 상태 사이 선형 보간 (불연속 상변화 흡수)
    const fa0 = a.H - targetKcalH;
    const fb0 = b.H - targetKcalH;
    const f = Math.max(0, Math.min(1, -fa0 / Math.max(1e-12, fb0 - fa0)));
    const sp = lerpSplit(a, b, f);
    return { T_C: Ta + (Tb - Ta) * f, vap: sp.vap, liq: sp.liq, converged: true, iterations: iters, atBoilingCap: false };
  };

  if (cap !== null && Number.isFinite(cap) && flows.H2O > 0) {
    const capT = Math.max(Tmin + 1, Math.min(TmaxAbs, cap));
    const atCap = evalAt(capT);
    if (targetKcalH > atCap.H && atCap.liq.H2O > 1e-9) {
      const allVap = evalAt(capT, true);
      if (targetKcalH <= allVap.H) {
        // 비점에서 물 증발로 에너지 흡수: 분배 보간 후 과잉엔탈피 비선형성 보정 (2회)
        let lo: Split & { H: number } = atCap;
        let hi: Split & { H: number } = allVap;
        let sp: Split = atCap;
        for (let k = 0; k < 3; k++) {
          const f = Math.max(0, Math.min(1, (targetKcalH - lo.H) / Math.max(1e-12, hi.H - lo.H)));
          sp = lerpSplit(lo, hi, f);
          const H = streamEnthalpyKcalH(sp.vap, sp.liq, capT, P_kgcm2g);
          if (Math.abs(H - targetKcalH) <= tol) break;
          if (H < targetKcalH) lo = { ...sp, H };
          else hi = { ...sp, H };
        }
        return { T_C: capT, vap: sp.vap, liq: sp.liq, converged: true, iterations: iters, atBoilingCap: true };
      }
      // 물 전량 증발 후 과열
      return solveBracket(capT, TmaxAbs, true);
    }
    return solveBracket(Tmin, capT, false);
  }
  if (opts.T_guess !== undefined && Number.isFinite(opts.T_guess)) {
    // 초기 추정 주변 브래킷 축소 (속도 향상)
    const g = opts.T_guess;
    let lo = Math.max(Tmin, g - 15);
    let hi = Math.min(TmaxAbs, g + 15);
    let hLo = evalAt(lo).H;
    let hHi = evalAt(hi).H;
    let grow = 0;
    while ((targetKcalH < hLo && lo > Tmin) || (targetKcalH > hHi && hi < TmaxAbs)) {
      if (targetKcalH < hLo) { hi = lo; lo = Math.max(Tmin, lo - 40 * (grow + 1)); hHi = hLo; hLo = evalAt(lo).H; }
      else { lo = hi; hi = Math.min(TmaxAbs, hi + 40 * (grow + 1)); hLo = hHi; hHi = evalAt(hi).H; }
      if (++grow > 12) break;
    }
    return solveBracket(lo, hi, false);
  }
  return solveBracket(Tmin, TmaxAbs, false);
}

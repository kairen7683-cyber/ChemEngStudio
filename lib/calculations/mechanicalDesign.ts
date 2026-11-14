/**
 * mechanicalDesign.ts — 압력용기·탑조 기계설계 (ASME Sec. VIII Div.1 기반 예비설계, 재사용 모듈)
 *
 * 포함 범위
 *  - UG-27 동체 내압 두께, UG-32 경판(2:1 반타원 / 토리구형 / 반구형) 내압 두께
 *  - UG-28 외압(진공) 허용압력: Factor A(기하 차트 근사식) + Factor B(재질 곡선 CS-2 / HA-1 / HA-4 등 온도별 디지타이즈 근사)
 *  - UG-29 보강링 최대 간격 및 필요 관성모멘트 Is
 *  - UG-33 경판 외압
 *  - 탑조 조합하중: 풍하중(ASCE 7형 속도압 qz = 0.613·Kz·Kzt·Kd·V², 고도계수·형상계수·거스트계수),
 *    지진(등가정적 밑면전단 V = Cs·W, 캔틸레버 1차 고유주기), 자중(공탑/운전/수압시험),
 *    기부(base) 종방향 응력 조합 검토 및 편심하중 모멘트
 *  - 스커트 두께, 베이스링 두께, 앵커볼트 개수·규격
 *  - UG-37 노즐 보강(면적치환법 단순화), UG-99(b) 수압시험 압력
 *
 * 단위: 내부 SI (MPa, mm, m, kN, kN·m). 모든 결과는 예비(개념)설계 수준이며 상세설계는 코드 전문 검토가 필요하다.
 * Factor B 곡선은 ASME II-D 차트를 수치 근사한 것으로 ±5~8% 오차를 가질 수 있다.
 */

export type MechMaterialKey = 'CS_SA516_70' | 'SS304' | 'SS316L' | 'DUPLEX_2205' | 'ALLOY_C276';
export type HeadType = 'ellipsoidal_2_1' | 'torispherical' | 'hemispherical';
export type WindExposure = 'B' | 'C' | 'D';
export type ExternalPressureChart = 'CS-2' | 'HA-1' | 'HA-4' | 'HA-5' | 'NFN-X';

const G = 9.80665;
const PSI_TO_MPA = 0.00689476;

interface MaterialData {
  label: string;
  /** [T °C, S MPa] 허용응력 표 (ASME II-D 근사) */
  allowTable: [number, number][];
  yieldMpa: number;
  densityKgM3: number;
  chart: ExternalPressureChart;
  /** E(T) = e0 − e1·T  (GPa) */
  e0Gpa: number;
  e1GpaPerC: number;
}

export const MECH_MATERIALS: Record<MechMaterialKey, MaterialData> = {
  CS_SA516_70: {
    label: 'SA-516 Gr.70 (탄소강)',
    allowTable: [[-29, 138], [343, 138], [371, 125], [399, 101], [427, 83]],
    yieldMpa: 260, densityKgM3: 7850, chart: 'CS-2', e0Gpa: 203, e1GpaPerC: 0.065,
  },
  SS304: {
    label: 'SA-240 304 (오스테나이트계)',
    allowTable: [[-29, 138], [150, 138], [200, 129], [300, 118], [400, 110]],
    yieldMpa: 205, densityKgM3: 8000, chart: 'HA-1', e0Gpa: 195, e1GpaPerC: 0.075,
  },
  SS316L: {
    label: 'SA-240 316L (오스테나이트계 저탄소)',
    allowTable: [[-29, 115], [100, 115], [150, 110], [200, 101], [300, 90], [400, 84]],
    yieldMpa: 170, densityKgM3: 8000, chart: 'HA-4', e0Gpa: 195, e1GpaPerC: 0.075,
  },
  DUPLEX_2205: {
    label: 'SA-240 S32205 (듀플렉스)',
    allowTable: [[-29, 184], [100, 184], [200, 172], [315, 165]],
    yieldMpa: 450, densityKgM3: 7800, chart: 'HA-5', e0Gpa: 200, e1GpaPerC: 0.070,
  },
  ALLOY_C276: {
    label: 'SB-575 N10276 (니켈합금)',
    allowTable: [[-29, 197], [200, 197], [300, 186], [400, 175]],
    yieldMpa: 283, densityKgM3: 8890, chart: 'NFN-X', e0Gpa: 205, e1GpaPerC: 0.060,
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function interpTable(tbl: [number, number][], x: number): number {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1];
      const [x1, y1] = tbl[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tbl[tbl.length - 1][1];
}

export function allowableStressMpa(mat: MechMaterialKey, tempC: number): number {
  return interpTable(MECH_MATERIALS[mat].allowTable, tempC);
}

export function elasticModulusMpa(mat: MechMaterialKey, tempC: number): number {
  const m = MECH_MATERIALS[mat];
  return Math.max(120, m.e0Gpa - m.e1GpaPerC * Math.max(20, tempC)) * 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// UG-28 Factor A / Factor B
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factor A (ASME II-D Fig. G 근사)
 *  - 중간 길이 원통 (von Mises/Windenburg–Trilling 근사): A = 1.30 (t/Do)^1.5 / (L/Do − 0.45 (t/Do)^0.5)
 *  - 긴 원통 하한 (Bresse 좌굴):                      A = 1.10 (t/Do)²
 *  - 차트 상한 A ≤ 0.1, L/Do 는 0.05 ~ 50 범위로 제한
 */
export function factorA(LoverDo: number, DoOverT: number): number {
  const tD = 1 / Math.max(4, DoOverT);
  const LD = clamp(LoverDo, 0.05, 50);
  const denom = LD - 0.45 * Math.sqrt(tD);
  const aInter = denom > 1e-6 ? (1.3 * Math.pow(tD, 1.5)) / denom : 0.1;
  const aLong = 1.1 * tD * tD;
  return clamp(Math.max(aInter, aLong), 1e-6, 0.1);
}

/**
 * 재질 곡선(소성 영역) 디지타이즈 근사 — [A, B(psi)] (온도°F 별)
 * 탄성 영역은 B = A·E/2 로 자동 처리 (min 연산).
 */
const CHART_CURVES: Record<ExternalPressureChart, { tempF: number; eKsi: number; pts: [number, number][] }[]> = {
  'CS-2': [
    { tempF: 300, eKsi: 29000, pts: [[1e-3, 12500], [2e-3, 15000], [3e-3, 16000], [5e-3, 17000], [1e-2, 18000], [0.1, 19000]] },
    { tempF: 500, eKsi: 27000, pts: [[1e-3, 11000], [2e-3, 13000], [3e-3, 13900], [5e-3, 14600], [1e-2, 15500], [0.1, 16300]] },
    { tempF: 700, eKsi: 24500, pts: [[1e-3, 9500], [2e-3, 11000], [3e-3, 11600], [5e-3, 12200], [1e-2, 13000], [0.1, 13600]] },
  ],
  'HA-1': [
    { tempF: 100, eKsi: 28000, pts: [[1e-3, 9000], [2e-3, 10500], [5e-3, 12500], [1e-2, 14000], [0.1, 17000]] },
    { tempF: 400, eKsi: 27000, pts: [[1e-3, 7500], [2e-3, 8800], [5e-3, 10200], [1e-2, 11300], [0.1, 13500]] },
    { tempF: 700, eKsi: 25000, pts: [[1e-3, 6700], [2e-3, 7800], [5e-3, 9000], [1e-2, 10000], [0.1, 12000]] },
  ],
  'HA-4': [
    { tempF: 100, eKsi: 28000, pts: [[1e-3, 7800], [2e-3, 9200], [5e-3, 10900], [1e-2, 12200], [0.1, 15000]] },
    { tempF: 400, eKsi: 27000, pts: [[1e-3, 6400], [2e-3, 7500], [5e-3, 8800], [1e-2, 9800], [0.1, 12000]] },
    { tempF: 700, eKsi: 25000, pts: [[1e-3, 5700], [2e-3, 6600], [5e-3, 7700], [1e-2, 8500], [0.1, 10500]] },
  ],
  'HA-5': [
    { tempF: 100, eKsi: 28800, pts: [[1e-3, 12000], [2e-3, 15500], [5e-3, 19000], [1e-2, 21000], [0.1, 24000]] },
    { tempF: 600, eKsi: 26500, pts: [[1e-3, 10500], [2e-3, 13500], [5e-3, 16000], [1e-2, 17500], [0.1, 20000]] },
  ],
  'NFN-X': [
    { tempF: 100, eKsi: 29800, pts: [[1e-3, 11000], [2e-3, 13500], [5e-3, 16500], [1e-2, 18500], [0.1, 22000]] },
    { tempF: 700, eKsi: 27000, pts: [[1e-3, 9000], [2e-3, 11000], [5e-3, 13500], [1e-2, 15000], [0.1, 18000]] },
  ],
};

function curveAt(pts: [number, number][], A: number): number {
  // log-log 보간 / 외삽
  const la = Math.log(A);
  let i = 1;
  while (i < pts.length - 1 && A > pts[i][0]) i++;
  const [a0, b0] = pts[i - 1];
  const [a1, b1] = pts[i];
  const s = (Math.log(b1) - Math.log(b0)) / (Math.log(a1) - Math.log(a0));
  return Math.exp(Math.log(b0) + s * (la - Math.log(a0)));
}

/** Factor B (MPa) — 재질 차트 + 설계온도 보간. 탄성영역 B = A·E/2 */
export function factorB(chart: ExternalPressureChart, A: number, tempC: number): { bMpa: number; elastic: boolean } {
  const tempF = tempC * 1.8 + 32;
  const curves = CHART_CURVES[chart];
  const evalCurve = (c: (typeof curves)[number]) => {
    const elasticPsi = (A * c.eKsi * 1000) / 2;
    const plastic = curveAt(c.pts, A);
    return { b: Math.min(elasticPsi, plastic), elastic: elasticPsi <= plastic };
  };
  let res: { b: number; elastic: boolean };
  if (tempF <= curves[0].tempF) res = evalCurve(curves[0]);
  else if (tempF >= curves[curves.length - 1].tempF) res = evalCurve(curves[curves.length - 1]);
  else {
    let k = 1;
    while (tempF > curves[k].tempF) k++;
    const lo = evalCurve(curves[k - 1]);
    const hi = evalCurve(curves[k]);
    const w = (tempF - curves[k - 1].tempF) / (curves[k].tempF - curves[k - 1].tempF);
    res = { b: lo.b + (hi.b - lo.b) * w, elastic: lo.elastic && hi.elastic };
  }
  return { bMpa: res.b * PSI_TO_MPA, elastic: res.elastic };
}

export interface ExternalPressureCylResult {
  factorA: number;
  factorBMpa: number;
  elastic: boolean;
  allowableExtPressMpa: number;
  DoOverT: number;
  LoverDo: number;
}

/** UG-28(c) 원통 외압 최대허용압력 Pa (MPa). tMm = 부식 후 유효두께 */
export function ug28CylinderAllowable(
  DoMm: number,
  tMm: number,
  LMm: number,
  mat: MechMaterialKey,
  tempC: number
): ExternalPressureCylResult {
  const DoT = DoMm / Math.max(0.5, tMm);
  const LDo = LMm / Math.max(1, DoMm);
  const A = factorA(LDo, DoT);
  const { bMpa, elastic } = factorB(MECH_MATERIALS[mat].chart, A, tempC);
  let Pa: number;
  if (DoT >= 10) {
    Pa = (4 * bMpa) / (3 * DoT);
  } else {
    // UG-28(c)(2): Do/t < 10
    const Aeff = DoT < 4 ? 1.1 / (DoT * DoT) : A;
    const bEff = factorB(MECH_MATERIALS[mat].chart, Aeff, tempC).bMpa;
    const Pa1 = (2.167 / DoT - 0.0833) * bEff;
    const S = allowableStressMpa(mat, tempC);
    const S2 = Math.min(2 * S, 0.9 * MECH_MATERIALS[mat].yieldMpa);
    const Pa2 = ((2 * S2) / DoT) * (1 - 1 / DoT);
    Pa = Math.min(Pa1, Pa2);
  }
  return { factorA: A, factorBMpa: bMpa, elastic, allowableExtPressMpa: Pa, DoOverT: DoT, LoverDo: LDo };
}

/** 외압 Pext 만족 최대 무보강 길이(보강링 간격) L (mm) — 이분법 */
export function maxStiffenerSpacingMm(
  DoMm: number,
  tMm: number,
  pExtMpa: number,
  mat: MechMaterialKey,
  tempC: number
): number {
  let lo = 0.05 * DoMm;
  let hi = 50 * DoMm;
  if (ug28CylinderAllowable(DoMm, tMm, hi, mat, tempC).allowableExtPressMpa >= pExtMpa) return hi;
  if (ug28CylinderAllowable(DoMm, tMm, lo, mat, tempC).allowableExtPressMpa < pExtMpa) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (ug28CylinderAllowable(DoMm, tMm, mid, mat, tempC).allowableExtPressMpa >= pExtMpa) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** UG-29 보강링 필요 관성모멘트 Is (mm⁴): Is = Do²·Ls·(t + As/Ls)·A / 14 */
export function ug29RequiredInertiaMm4(
  DoMm: number,
  tMm: number,
  LsMm: number,
  asMm2: number,
  pExtMpa: number,
  mat: MechMaterialKey,
  tempC: number
): { isReqMm4: number; factorA: number } {
  const teff = tMm + asMm2 / Math.max(1, LsMm);
  const Bmpa = 0.75 * (pExtMpa * DoMm) / teff;
  // B → A 역산 (탄성 / 소성 곡선 이분법)
  const chart = MECH_MATERIALS[mat].chart;
  let lo = 1e-6;
  let hi = 0.1;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (factorB(chart, mid, tempC).bMpa < Bmpa) lo = mid;
    else hi = mid;
  }
  const A = Math.sqrt(lo * hi);
  return { isReqMm4: (DoMm * DoMm * LsMm * teff * A) / 14, factorA: A };
}

const FLAT_BAR_RINGS: { label: string; hMm: number; bMm: number }[] = [
  { label: 'FB 65×9', hMm: 65, bMm: 9 },
  { label: 'FB 75×10', hMm: 75, bMm: 10 },
  { label: 'FB 100×12', hMm: 100, bMm: 12 },
  { label: 'FB 125×12', hMm: 125, bMm: 12 },
  { label: 'FB 150×16', hMm: 150, bMm: 16 },
  { label: 'FB 200×20', hMm: 200, bMm: 20 },
  { label: 'FB 250×25', hMm: 250, bMm: 25 },
  { label: 'FB 300×30', hMm: 300, bMm: 30 },
];

// ─────────────────────────────────────────────────────────────────────────────
// UG-27 / UG-32 / UG-33 내압·외압 두께
// ─────────────────────────────────────────────────────────────────────────────

/** UG-27(c)(1) 원주방향 응력 기준 필요두께 (mm, 부식여유 제외). R = 부식 후 내반경 */
export function ug27ShellThicknessMm(pMpa: number, innerRadiusMm: number, sMpa: number, E: number): number {
  return (pMpa * innerRadiusMm) / Math.max(1e-6, sMpa * E - 0.6 * pMpa);
}

/** UG-32 경판 필요두께 (mm). D = 부식 후 내경 */
export function ug32HeadThicknessMm(head: HeadType, pMpa: number, innerDiamMm: number, sMpa: number, E: number): number {
  switch (head) {
    case 'ellipsoidal_2_1':
      return (pMpa * innerDiamMm) / Math.max(1e-6, 2 * sMpa * E - 0.2 * pMpa);
    case 'torispherical':
      // L = D (크라운 반경), r = 0.06L (6% 너클) 표준 토리구형: t = 0.885 P L / (S E − 0.1 P)
      return (0.885 * pMpa * innerDiamMm) / Math.max(1e-6, sMpa * E - 0.1 * pMpa);
    case 'hemispherical':
      return (pMpa * innerDiamMm * 0.5) / Math.max(1e-6, 2 * sMpa * E - 0.2 * pMpa);
  }
}

/** UG-33 경판 외압 허용압력 (MPa). tMm = 부식 후 두께 */
export function ug33HeadAllowableExtMpa(head: HeadType, DoMm: number, tMm: number, mat: MechMaterialKey, tempC: number): number {
  const Ro = head === 'ellipsoidal_2_1' ? 0.9 * DoMm : head === 'torispherical' ? DoMm : 0.5 * DoMm;
  const RoT = Ro / Math.max(0.5, tMm);
  const A = 0.125 / RoT;
  const { bMpa } = factorB(MECH_MATERIALS[mat].chart, A, tempC);
  return bMpa / RoT;
}

/** 경판 표면적 (m², 직선 플랜지 제외) */
function headSurfaceM2(head: HeadType, Dm: number): number {
  if (head === 'hemispherical') return (Math.PI * Dm * Dm) / 2;
  if (head === 'torispherical') return 0.931 * Dm * Dm;
  return 1.084 * Dm * Dm;
}

/** 경판 내용적 (m³) */
function headVolumeM3(head: HeadType, Dm: number): number {
  if (head === 'hemispherical') return (Math.PI * Dm * Dm * Dm) / 12;
  if (head === 'torispherical') return 0.0809 * Dm * Dm * Dm;
  return (Math.PI * Dm * Dm * Dm) / 24;
}

// ─────────────────────────────────────────────────────────────────────────────
// 풍하중 / 지진
// ─────────────────────────────────────────────────────────────────────────────

/** ASCE 7 속도압 노출계수 Kz */
export function velocityPressureKz(zM: number, exposure: WindExposure): number {
  const p = exposure === 'B' ? { a: 7.0, zg: 365.76 } : exposure === 'D' ? { a: 11.5, zg: 213.36 } : { a: 9.5, zg: 274.32 };
  const z = Math.max(4.57, zM);
  return 2.01 * Math.pow(z / p.zg, 2 / p.a);
}

/** 원통 형상계수 Cf (ASCE 7 Fig. 29.4-1, 중간 거칠기 원형 단면 근사) */
export function cylinderForceCoefficient(heightOverDiam: number, DmTimesSqrtQz: number): number {
  const hd = clamp(heightOverDiam, 1, 25);
  // D√qz > 2.5 (SI: D[m]·√qz[kPa]... 근사) 일 때 Re 초임계 → Cf 감소
  const base = DmTimesSqrtQz > 5.3 ? 0.5 + (0.7 - 0.5) * ((hd - 1) / 24) : 0.7 + (0.9 - 0.7) * ((hd - 1) / 24);
  return clamp(base, 0.5, 0.9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 앵커볼트 규격
// ─────────────────────────────────────────────────────────────────────────────

const ANCHOR_BOLTS: { label: string; rootAreaMm2: number }[] = [
  { label: 'M20', rootAreaMm2: 225 },
  { label: 'M24', rootAreaMm2: 324 },
  { label: 'M30', rootAreaMm2: 519 },
  { label: 'M36', rootAreaMm2: 759 },
  { label: 'M42', rootAreaMm2: 1050 },
  { label: 'M48', rootAreaMm2: 1380 },
  { label: 'M56', rootAreaMm2: 1910 },
  { label: 'M64', rootAreaMm2: 2520 },
  { label: 'M72', rootAreaMm2: 3220 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 통합 탑조 기계설계
// ─────────────────────────────────────────────────────────────────────────────

export interface NozzleReinfInput {
  tag: string;
  /** 노즐 내경 d (mm) */
  idMm: number;
  /** 노즐관 두께 tn (mm), 미지정 시 Sch.40 근사 */
  wallMm?: number;
}

export interface TowerMechanicalInput {
  innerDiamM: number;
  tangentHeightM: number;
  /** 설계 내압 (MPa g) — 진공탑도 최소 0.1 MPa g 또는 FV 표기 */
  designPressMpaG: number;
  /** 설계 외압 (MPa, 완전진공 = 0.101) — 0 이면 외압 검토 생략 */
  externalPressMpa?: number;
  designTempC: number;
  material: MechMaterialKey;
  corrosionAllowanceMm?: number;    // 기본 3.0
  jointEfficiency?: number;         // 기본 0.85 (Spot RT)
  headType?: HeadType;              // 기본 2:1 반타원
  skirtHeightM?: number;            // 기본 3.0
  skirtMaterial?: MechMaterialKey;  // 기본 CS
  insulationMm?: number;            // 보온 두께, 기본 75
  /** 내부물 건조중량 (kN) — 트레이/충진물/분배기 */
  internalsWeightKN?: number;
  /** 운전 액 보유량 중량 (kN) — 트레이 액·섬프 */
  operatingLiquidKN?: number;
  /** 플랫폼·사다리·배관 부착물 자중 (kN/m, 높이당), 기본 1.5 */
  attachmentsKNPerM?: number;
  /** 수직 편심하중 (kN) 및 편심거리 (m) — 탑정 응축기 등 */
  eccentricLoadKN?: number;
  eccentricityM?: number;
  // 풍하중
  windSpeedMS?: number;             // 기본풍속 V (3초 거스트, m/s) 기본 38
  exposure?: WindExposure;          // 기본 C
  importanceKd?: number;            // 풍향계수 Kd, 기본 0.95
  gustFactor?: number;              // G, 기본 0.85 (강체)
  // 지진
  sds?: number;                     // 단주기 설계 스펙트럼 가속도 (g), 기본 0.50
  sd1?: number;                     // 1초 설계 스펙트럼 가속도 (g), 기본 0.20
  responseR?: number;               // 응답수정계수 R, 기본 2.0 (스커트 지지 수직용기)
  importanceIe?: number;            // 기본 1.25
  // 보강링 (외압)
  stiffenerSpacingM?: number;       // 지정 시 해당 간격 기준 검토
  /** 노즐 보강 검토 대상 */
  nozzles?: NozzleReinfInput[];
}

export interface NozzleReinfResult {
  tag: string;
  idMm: number;
  areaRequiredMm2: number;
  areaAvailableMm2: number;
  padRequired: boolean;
  padWidthMm: number;
  padThicknessMm: number;
}

export interface LoadCaseCheck {
  label: string;
  windwardTensileMpa: number;
  leewardCompressiveMpa: number;
  allowTensileMpa: number;
  allowCompressiveMpa: number;
  ok: boolean;
}

export interface TowerMechanicalResult {
  materialLabel: string;
  allowStressMpa: number;
  elasticModulusMpa: number;
  corrosionAllowanceMm: number;
  jointEfficiency: number;
  // 두께
  shellInternalReqMm: number;          // UG-27 (CA 포함)
  headType: HeadType;
  headInternalReqMm: number;           // UG-32 (CA 포함)
  shellExternalReqMm: number;          // UG-28 (CA 포함, 보강링 간격 기준)
  headExternalReqMm: number;           // UG-33
  combinedLoadReqMm: number;           // 풍·지진 기부 조합응력 필요두께 (CA 포함)
  governingCase: 'internal' | 'external' | 'wind' | 'seismic' | 'minimum';
  selectedShellMm: number;             // 공칭 채택 (판 규격 올림)
  selectedHeadMm: number;
  // 외압
  externalPressMpa: number;
  stiffenerSpacingM: number;           // 0 = 불필요
  stiffenerCount: number;
  stiffenerIsReqCm4: number;
  stiffenerSection: string;
  ug28FactorA: number;
  ug28FactorBMpa: number;
  ug28AllowableMpa: number;
  // 하중
  windBaseShearKN: number;
  windBaseMomentKNm: number;
  seismicPeriodS: number;
  seismicCs: number;
  seismicBaseShearKN: number;
  seismicBaseMomentKNm: number;
  eccentricMomentKNm: number;
  governingLateral: 'wind' | 'seismic';
  // 중량
  shellWeightKN: number;
  headsWeightKN: number;
  skirtWeightKN: number;
  emptyWeightKN: number;
  operatingWeightKN: number;
  hydrotestWeightKN: number;
  // 기부 응력 검토
  loadCases: LoadCaseCheck[];
  // 스커트·베이스
  skirtThicknessMm: number;
  baseRingOdMm: number;
  baseRingIdMm: number;
  baseRingThicknessMm: number;
  concreteBearingMpa: number;
  anchorBoltCount: number;
  anchorBoltSize: string;
  anchorBoltCircleMm: number;
  anchorTensionPerBoltKN: number;
  // 수압시험
  hydrotestPressMpaG: number;          // UG-99(b) at top
  hydrotestPressBottomMpaG: number;    // + 정수두
  mawpMpaG: number;
  nozzleReinforcement: NozzleReinfResult[];
  warnings: string[];
}

const PLATE_MM = [5, 6, 8, 9, 10, 12, 14, 16, 18, 19, 20, 22, 25, 28, 30, 32, 34, 36, 38, 40, 45, 50, 55, 60, 65, 70, 75, 80];
function roundPlate(tMm: number): number {
  for (const p of PLATE_MM) if (p >= tMm - 1e-6) return p;
  return Math.ceil(tMm / 5) * 5;
}

/**
 * 탑조(수직 원통 용기) 통합 기계설계 — ASME VIII-1 + ASCE 7형 풍/지진 하중
 */
export function designTowerMechanical(inp: TowerMechanicalInput): TowerMechanicalResult {
  const warnings: string[] = [];
  const mat = inp.material;
  const md = MECH_MATERIALS[mat];
  const T = inp.designTempC;
  const S = allowableStressMpa(mat, T);
  const Emod = elasticModulusMpa(mat, T);
  const CA = Math.max(0, inp.corrosionAllowanceMm ?? 3.0);
  const Ej = clamp(inp.jointEfficiency ?? 0.85, 0.45, 1.0);
  const head: HeadType = inp.headType ?? 'ellipsoidal_2_1';
  const Di = Math.max(0.2, inp.innerDiamM) * 1000; // mm
  const H = Math.max(1, inp.tangentHeightM);
  const P = Math.max(0, inp.designPressMpaG);
  const Pext = Math.max(0, inp.externalPressMpa ?? 0);
  const skirtH = Math.max(0.5, inp.skirtHeightM ?? 3.0);
  const insul = Math.max(0, inp.insulationMm ?? 75);

  // 1) 내압 (부식 후 반경)
  const Rcorr = Di / 2 + CA;
  const tShellInt = ug27ShellThicknessMm(P, Rcorr, S, Ej) + CA;
  const tHeadInt = ug32HeadThicknessMm(head, P, Di + 2 * CA, S, 1.0) + CA; // 이음매 없는 경판 E=1.0
  // 최소두께 UG-16(b): 1.5 mm + CA, 대형 탑 운반·설치 강성 기준 (D/1000 + 2.5 mm)
  const tMin = Math.max(1.5 + CA, Di / 1000 + 2.5 + CA * 0.5, 6);

  // 2) 외압 UG-28 (보강링 간격 결정)
  let tShellExt = 0;
  let stiffenerSpacingM = 0;
  let stiffenerCount = 0;
  let stiffenerIsReqCm4 = 0;
  let stiffenerSection = '-';
  let ugA = 0;
  let ugB = 0;
  let ugPa = 0;
  let tHeadExt = 0;
  // 설계 길이 L: 탄젠트 길이 + 경판 깊이의 1/3 (UG-28(b))
  const headDepthMm = head === 'hemispherical' ? Di / 2 : head === 'torispherical' ? 0.194 * Di : Di / 4;
  const Lunstiff = H * 1000 + (2 * headDepthMm) / 3;
  if (Pext > 0) {
    // (a) 무보강 두께 vs (b) 보강링 적용 경제두께 — 무보강 필요두께가 1.5배 이상이면 보강링 적용
    const reqThk = (Lmm: number) => {
      for (let t = 3; t <= 120; t += 0.5) {
        const Do = Di + 2 * (t + CA);
        if (ug28CylinderAllowable(Do, t, Lmm, mat, T).allowableExtPressMpa >= Pext) return t;
      }
      return 120;
    };
    const tUnstiff = reqThk(Lunstiff);
    let Ldesign = Lunstiff;
    let tEff = tUnstiff;
    const tBase = Math.max(tShellInt, tMin) - CA;
    if (inp.stiffenerSpacingM && inp.stiffenerSpacingM > 0.2) {
      Ldesign = Math.min(Lunstiff, inp.stiffenerSpacingM * 1000);
      tEff = reqThk(Ldesign);
    } else if (tUnstiff > 1.25 * tBase) {
      // 기존(내압/최소) 두께로 허용되는 최대 링 간격
      const tTry = roundPlate(tBase + CA) - CA;
      const Do = Di + 2 * (tTry + CA);
      const Lmax = maxStiffenerSpacingMm(Do, tTry, Pext, mat, T);
      if (Lmax > 0.25 * Di) {
        const nSeg = Math.ceil(Lunstiff / Lmax);
        Ldesign = Lunstiff / nSeg;
        tEff = reqThk(Ldesign);
      }
    }
    tShellExt = tEff + CA;
    const DoE = Di + 2 * tShellExt;
    const chk = ug28CylinderAllowable(DoE, tEff, Ldesign, mat, T);
    ugA = chk.factorA;
    ugB = chk.factorBMpa;
    ugPa = chk.allowableExtPressMpa;
    if (Ldesign < Lunstiff - 1) {
      stiffenerSpacingM = Ldesign / 1000;
      stiffenerCount = Math.max(0, Math.round(Lunstiff / Ldesign) - 1);
      for (const fb of FLAT_BAR_RINGS) {
        const As = fb.hMm * fb.bMm;
        const req = ug29RequiredInertiaMm4(DoE, tEff, Ldesign, As, Pext, mat, T).isReqMm4;
        // 링+유효 동체폭(1.1√(Do t)) 조합 관성모멘트 (UG-29 I's 근사)
        const wEff = 1.1 * Math.sqrt(DoE * tEff);
        const aShell = wEff * tEff;
        const yRing = tEff / 2 + fb.hMm / 2;
        const yBar = (As * yRing) / (As + aShell);
        const Icomb =
          (fb.bMm * Math.pow(fb.hMm, 3)) / 12 + As * Math.pow(yRing - yBar, 2) + (wEff * Math.pow(tEff, 3)) / 12 + aShell * yBar * yBar;
        stiffenerIsReqCm4 = req / 1e4;
        stiffenerSection = fb.label;
        if (Icomb >= req * 1.1) break; // I's 사용 시 1.1 배 여유
      }
    }
    // 경판 외압 UG-33: (i) 1.67·Pext 내압 두께, (ii) Factor B 방법 중 큰 값
    const tHeadA = ug32HeadThicknessMm(head, 1.67 * Pext, Di + 2 * CA, S, 1.0);
    let tHeadB = 3;
    for (; tHeadB <= 120; tHeadB += 0.5) {
      if (ug33HeadAllowableExtMpa(head, Di + 2 * (tHeadB + CA), tHeadB, mat, T) >= Pext) break;
    }
    tHeadExt = Math.max(tHeadA, tHeadB) + CA;
  }

  // 3) 중량 산정 (임시 두께 → 반복)
  const rhoS = md.densityKgM3;
  const skirtMat: MechMaterialKey = inp.skirtMaterial ?? 'CS_SA516_70';
  const internalsKN = Math.max(0, inp.internalsWeightKN ?? 0);
  const opLiqKN = Math.max(0, inp.operatingLiquidKN ?? 0);
  const attachKNm = Math.max(0, inp.attachmentsKNPerM ?? 1.5);
  const eccKN = Math.max(0, inp.eccentricLoadKN ?? 0);
  const eccM = Math.max(0, inp.eccentricityM ?? 0);
  const totalHeight = H + skirtH + headDepthMm / 1000;

  // 풍하중 (두께 무관, 외경만 의존) — 1 m 세그먼트 적분
  const V = Math.max(10, inp.windSpeedMS ?? 38);
  const exposure: WindExposure = inp.exposure ?? 'C';
  const Kd = inp.importanceKd ?? 0.95;
  const Gf = inp.gustFactor ?? 0.85;
  const DoApprox = (Di + 2 * Math.max(tShellInt, tMin)) / 1000;
  // 유효 풍압폭: 외경 + 2×보온 + 사다리/배관 여유 (0.3 m 또는 15%)
  const Deff = DoApprox + (2 * insul) / 1000 + Math.max(0.3, 0.15 * DoApprox);
  const qzTop = 0.613 * velocityPressureKz(totalHeight, exposure) * Kd * V * V;
  const Cf = cylinderForceCoefficient(totalHeight / Deff, Deff * Math.sqrt(qzTop / 1000) * 3.28);
  let windShearN = 0;
  let windMomentNm = 0;
  let windMomentTanNm = 0; // 하부 탄젠트선(스커트 상단) 기준 모멘트
  const nSeg = Math.max(10, Math.ceil(totalHeight));
  const dz = totalHeight / nSeg;
  for (let i = 0; i < nSeg; i++) {
    const zc = (i + 0.5) * dz;
    const qz = 0.613 * velocityPressureKz(zc, exposure) * Kd * V * V;
    const F = qz * Gf * Cf * Deff * dz;
    windShearN += F;
    windMomentNm += F * zc;
    if (zc > skirtH) windMomentTanNm += F * (zc - skirtH);
  }

  // 기부 응력 검토 함수 (두께 t, 부식 후)
  const sigmaAllowComp = (tCorr: number, DoMm: number) => {
    const Ro = DoMm / 2;
    const A = 0.125 / (Ro / Math.max(0.5, tCorr));
    const B = factorB(md.chart, A, T).bMpa;
    return Math.min(S, B);
  };

  const computeWeights = (tShell: number, tHead: number, tSkirt: number) => {
    const Dm = (Di + tShell) / 1000;
    const shellKN = (Math.PI * Dm * H * (tShell / 1000) * rhoS * G) / 1000;
    const headKN = (2 * headSurfaceM2(head, (Di + tHead) / 1000) * (tHead / 1000) * rhoS * G) / 1000;
    const skirtKN = (Math.PI * ((Di + 2 * tShell + tSkirt) / 1000) * skirtH * (tSkirt / 1000) * MECH_MATERIALS[skirtMat].densityKgM3 * G) / 1000;
    const insulKN = (Math.PI * (Di / 1000 + 2 * tShell / 1000 + insul / 1000) * H * (insul / 1000) * 160 * G) / 1000;
    const attachKN = attachKNm * H;
    const nozzleAllowKN = 0.08 * (shellKN + headKN);
    const empty = shellKN + headKN + skirtKN + insulKN + attachKN + nozzleAllowKN + internalsKN + eccKN;
    const operating = empty + opLiqKN;
    const volM3 = (Math.PI * (Di / 1000) ** 2 / 4) * H + 2 * headVolumeM3(head, Di / 1000);
    const hydro = empty + (volM3 * 1000 * G) / 1000 - 0; // 충수(물) — 운전 액 대체
    return { shellKN, headKN, skirtKN, empty, operating, hydro, volM3 };
  };

  // 지진 주기 (균일 캔틸레버, 운전중량, 부식 전 두께)
  const seismicCalc = (tShell: number, operatingKN: number) => {
    const Do = (Di + 2 * tShell) / 1000;
    const I = (Math.PI / 64) * (Math.pow(Do, 4) - Math.pow(Di / 1000, 4)); // m⁴
    const mPerM = (operatingKN * 1000) / G / totalHeight; // kg/m
    const Epa = Emod * 1e6;
    const Tn = ((2 * Math.PI) / (1.875 * 1.875)) * Math.sqrt((mPerM * Math.pow(totalHeight, 4)) / (Epa * I));
    const SDS = inp.sds ?? 0.5;
    const SD1 = inp.sd1 ?? 0.2;
    const R = inp.responseR ?? 2.0;
    const Ie = inp.importanceIe ?? 1.25;
    let Cs = SDS / (R / Ie);
    Cs = Math.min(Cs, SD1 / (Math.max(0.05, Tn) * (R / Ie)));
    Cs = Math.max(Cs, 0.044 * SDS * Ie, 0.01);
    const Vb = Cs * operatingKN;
    // 분포지수 k (ASCE 12.8.3), 균일질량 → 모멘트 팔 = H·(k+1)/(k+2)
    const k = Tn <= 0.5 ? 1 : Tn >= 2.5 ? 2 : 1 + (Tn - 0.5) / 2;
    const arm = (totalHeight * (k + 1)) / (k + 2);
    const armTan = Math.max(0, (totalHeight - skirtH) * (k + 1) / (k + 2));
    return { Tn, Cs, Vb, Mb: Vb * arm, MbTan: Vb * armTan * ((totalHeight - skirtH) / totalHeight) };
  };

  // 4) 반복: 조합하중 기준 기부 필요두께
  let tComb = Math.max(tShellInt, tMin, tShellExt);
  let weights = computeWeights(tComb, Math.max(tHeadInt, tHeadExt, tMin), 8);
  let seis = seismicCalc(tComb, weights.operating);
  const eccMomentKNm = eccKN * eccM;
  const loadCaseEval = (tTotal: number) => {
    const tc = tTotal - CA;
    const Dm = Di + 2 * CA + tc; // 부식 후 평균경 (mm)
    const DoMm = Di + 2 * tTotal;
    const w = computeWeights(tTotal, Math.max(tHeadInt, tHeadExt, tMin), 8);
    const s = seismicCalc(tTotal, w.operating);
    const Mwind = windMomentTanNm / 1000; // kN·m (탄젠트선)
    const Mseis = s.MbTan;
    const Mlat = Math.max(Mwind, Mseis);
    const sigBend = (M_kNm: number) => (4 * M_kNm * 1e6) / (Math.PI * Dm * Dm * tc); // MPa
    const sigW = (W_kN: number) => (W_kN * 1000) / (Math.PI * Dm * tc);
    const sigP = (P * (Di + 2 * CA)) / (4 * tc);
    const sigPext = (Pext * DoMm) / (4 * tc);
    const allowT = S * Ej;
    const allowC = sigmaAllowComp(tc, DoMm);
    // 기부(탄젠트선 위) 지지 중량: 스커트 제외
    const wAboveOp = w.operating - w.skirtKN;
    const wAboveEmpty = w.empty - w.skirtKN;
    const cases: LoadCaseCheck[] = [];
    // (1) 운전 + 내압 + 횡하중
    {
      const ten = sigP - sigW(wAboveOp) + sigBend(Mlat + eccMomentKNm);
      const comp = -sigP + sigW(wAboveOp) + sigBend(Mlat + eccMomentKNm);
      cases.push({ label: '운전 + 내압 + 풍/지진', windwardTensileMpa: ten, leewardCompressiveMpa: Math.max(0, comp), allowTensileMpa: allowT, allowCompressiveMpa: allowC, ok: ten <= allowT && comp <= allowC });
    }
    // (2) 운전 + 외압(진공) + 횡하중
    if (Pext > 0) {
      const ten = -sigPext - sigW(wAboveOp) + sigBend(Mlat + eccMomentKNm);
      const comp = sigPext + sigW(wAboveOp) + sigBend(Mlat + eccMomentKNm);
      cases.push({ label: '운전 + 진공 + 풍/지진', windwardTensileMpa: ten, leewardCompressiveMpa: comp, allowTensileMpa: allowT, allowCompressiveMpa: allowC, ok: ten <= allowT && comp <= allowC });
    }
    // (3) 공탑(설치/정지) + 풍하중, 무압
    {
      const ten = -sigW(wAboveEmpty) + sigBend(Mwind + eccMomentKNm);
      const comp = sigW(wAboveEmpty) + sigBend(Mwind + eccMomentKNm);
      cases.push({ label: '공탑(정지) + 풍하중', windwardTensileMpa: ten, leewardCompressiveMpa: comp, allowTensileMpa: allowT, allowCompressiveMpa: allowC, ok: ten <= allowT && comp <= allowC });
    }
    // (4) 수압시험 (+25% 풍하중), 시험 시 허용 0.9Sy (UG-99 관행)
    {
      const Pt = 1.3 * P;
      const sigPt = (Pt * (Di + 2 * CA)) / (4 * tc);
      const wAboveHydro = w.hydro - w.skirtKN;
      const ten = sigPt - sigW(wAboveHydro) + sigBend(0.25 * Mwind);
      const comp = -sigPt + sigW(wAboveHydro) + sigBend(0.25 * Mwind);
      const allowTest = 0.9 * md.yieldMpa;
      cases.push({ label: '수압시험 + 25% 풍하중', windwardTensileMpa: ten, leewardCompressiveMpa: Math.max(0, comp), allowTensileMpa: allowTest, allowCompressiveMpa: Math.min(allowTest, allowC * 1.33), ok: ten <= allowTest && comp <= Math.min(allowTest, allowC * 1.33) });
    }
    return { cases, w, s, Mwind, Mseis };
  };

  let evalRes = loadCaseEval(tComb);
  for (let it = 0; it < 200 && !evalRes.cases.every((c) => c.ok); it++) {
    tComb += 0.5;
    evalRes = loadCaseEval(tComb);
  }
  const tBase = Math.max(tShellInt, tMin, tShellExt);
  const combinedLoadReqMm = tComb > tBase + 1e-6 ? tComb : 0;
  weights = evalRes.w;
  seis = evalRes.s;

  const candidates: { c: TowerMechanicalResult['governingCase']; t: number }[] = [
    { c: 'internal', t: tShellInt },
    { c: 'external', t: tShellExt },
    { c: 'minimum', t: tMin },
    { c: evalRes.Mseis > evalRes.Mwind ? 'seismic' : 'wind', t: combinedLoadReqMm },
  ];
  const gov = candidates.reduce((a, b) => (b.t > a.t ? b : a));
  const selectedShellMm = roundPlate(Math.max(tShellInt, tShellExt, tMin, combinedLoadReqMm));
  const selectedHeadMm = roundPlate(Math.max(tHeadInt, tHeadExt, tMin) + 1.0); // 성형 감육 여유 1 mm
  weights = computeWeights(selectedShellMm, selectedHeadMm, 8);
  seis = seismicCalc(selectedShellMm, weights.operating);

  // 5) 스커트 두께 (기부 전체 모멘트, 용접이음 효율 0.7)
  const Mbase = Math.max(windMomentNm / 1000, seis.Mb) + eccMomentKNm;
  const Ssk = allowableStressMpa(skirtMat, Math.min(T, 200));
  const Ds = Di + 2 * selectedShellMm; // 스커트 외경 ≈ 동체 외경 (mm)
  let tSkirt = 6;
  for (; tSkirt <= 80; tSkirt += 1) {
    const tc = tSkirt - 1.5; // 스커트 외부 부식여유 1.5 mm
    const DsM = Ds - tc;
    const sigma = (weights.operating * 1000) / (Math.PI * DsM * tc) + (4 * Mbase * 1e6) / (Math.PI * DsM * DsM * tc);
    const sigmaH = (weights.hydro * 1000) / (Math.PI * DsM * tc);
    const allowC = Math.min(0.7 * Ssk, sigmaAllowComp(tc, Ds));
    if (sigma <= allowC && sigmaH <= allowC * 1.33) break;
  }
  tSkirt = roundPlate(tSkirt);
  weights = computeWeights(selectedShellMm, selectedHeadMm, tSkirt);

  // 6) 앵커볼트 & 베이스링 (Brownell–Young / Megyesy 방법)
  const boltOffset = Math.max(100, 0.05 * Ds); // 스커트 외면 → 볼트 중심 (mm)
  const Db = Ds + 2 * boltOffset; // 볼트원 직경
  let nBolts = Math.max(8, Math.ceil((Math.PI * Db) / 600 / 4) * 4);
  const Sbolt = 138; // SA-193 B7 / SA-307 고장력 앵커 허용인장 (MPa)
  const tensionPerBolt = (Mbase_kNm: number, Wmin_kN: number, n: number) =>
    Math.max(0, ((4 * Mbase_kNm) / (Db / 1000) - Wmin_kN) / n); // kN
  let Tb = tensionPerBolt(Mbase, 0.9 * weights.empty, nBolts);
  let boltSize = ANCHOR_BOLTS[1].label;
  for (let pass = 0; pass < 6; pass++) {
    const areaReq = (Tb * 1000) / Sbolt + 0; // mm² (root)
    const pick = ANCHOR_BOLTS.find((b) => b.rootAreaMm2 >= areaReq);
    if (pick) {
      boltSize = pick.label;
      break;
    }
    nBolts += 4;
    Tb = tensionPerBolt(Mbase, 0.9 * weights.empty, nBolts);
    boltSize = ANCHOR_BOLTS[ANCHOR_BOLTS.length - 1].label;
  }
  // 베이스링: 콘크리트 지압 fc = W/Ar + M/Zr ≤ 4.8 MPa (f'c 24 MPa 기준)
  const fcAllow = 4.8;
  let ringWidth = Math.max(150, 2 * boltOffset + 50);
  let fc = 0;
  let ringOd = Ds + ringWidth;
  let ringId = Ds - ringWidth * 0.35;
  for (let it = 0; it < 60; it++) {
    ringOd = Ds + 2 * (boltOffset + 75);
    ringId = Math.max(0.3 * Ds, ringOd - 2 * ringWidth);
    const Ar = (Math.PI / 4) * (ringOd * ringOd - ringId * ringId); // mm²
    const Zr = (Math.PI / 32) * ((Math.pow(ringOd, 4) - Math.pow(ringId, 4)) / ringOd); // mm³
    fc = (Math.max(weights.operating, weights.hydro) * 1000) / Ar + (Mbase * 1e6) / Zr;
    if (fc <= fcAllow) break;
    ringWidth += 25;
  }
  const lOverhang = Math.max(50, (ringOd - Ds) / 2); // 스커트 외면 → 링 외단
  const Sring = allowableStressMpa('CS_SA516_70', 40);
  const baseRingThicknessMm = roundPlate(Math.max(16, lOverhang * Math.sqrt((3 * fc) / Sring)));

  // 7) 수압시험 UG-99(b), MAWP (부식 후, 동체 지배)
  const tcSel = selectedShellMm - CA;
  const mawpShell = (S * Ej * tcSel) / (Rcorr + 0.6 * tcSel);
  const tcHead = selectedHeadMm - CA - 1.0;
  const mawpHead = head === 'ellipsoidal_2_1'
    ? (2 * S * tcHead) / ((Di + 2 * CA) + 0.2 * tcHead)
    : head === 'torispherical'
    ? (S * tcHead) / (0.885 * (Di + 2 * CA) + 0.1 * tcHead)
    : (2 * S * tcHead) / ((Di + 2 * CA) / 2 + 0.2 * tcHead);
  const mawp = Math.max(P, Math.min(mawpShell, mawpHead));
  const Sambient = allowableStressMpa(mat, 20);
  const hydrotestTop = 1.3 * mawp * (Sambient / S);
  const hydrotestBottom = hydrotestTop + (1000 * G * (H + (2 * headDepthMm) / 1000)) / 1e6;

  // 8) 노즐 보강 UG-37 (단순화: A = d·tr, A1 = d(t−tr), A2 = 5(tn−trn)·t; 보강판 소요)
  const trShell = ug27ShellThicknessMm(P, Rcorr, S, 1.0);
  const nozzleReinforcement: NozzleReinfResult[] = (inp.nozzles ?? []).map((nz) => {
    const d = nz.idMm + 2 * CA;
    const tn = Math.max(3, (nz.wallMm ?? Math.max(3.9, 0.035 * nz.idMm + 2.5)) - CA);
    const trn = (P * (d / 2)) / (S * 1.0 - 0.6 * P);
    const tEffShell = selectedShellMm - CA;
    // 외압 시 UG-37(d): A = 0.5·d·tr(외압)
    const trExt = Pext > 0 ? (tShellExt - CA) * 0.5 : 0;
    const Areq = Math.max(d * trShell, d * trExt);
    const A1 = Math.max(0, d * (tEffShell - trShell));
    const A2 = Math.max(0, 5 * (tn - trn) * tEffShell);
    const Aweld = 2 * 0.5 * Math.pow(Math.min(tn, tEffShell) * 0.7, 2);
    const avail = A1 + A2 + Aweld;
    const padReq = avail < Areq;
    const padT = padReq ? roundPlate(Math.max(6, tEffShell)) : 0;
    const padW = padReq ? Math.ceil(((Areq - avail) / padT) / 2 / 5) * 5 : 0;
    return {
      tag: nz.tag,
      idMm: nz.idMm,
      areaRequiredMm2: Math.round(Areq),
      areaAvailableMm2: Math.round(avail),
      padRequired: padReq,
      padWidthMm: padW,
      padThicknessMm: padT,
    };
  });

  const finalEval = loadCaseEval(selectedShellMm);
  if (!finalEval.cases.every((c) => c.ok)) warnings.push('조합하중 기부 응력 검토 불합격 — 동체 하부 두께 증가 또는 단계별(graded) 두께 적용 필요');
  if (Pext > 0 && stiffenerSpacingM > 0) warnings.push(`외압(진공) 좌굴 방지 보강링 ${stiffenerCount}개 @ ${stiffenerSpacingM.toFixed(2)} m (${stiffenerSection}) 필요`);
  if (totalHeight / (Ds / 1000) > 15) warnings.push('세장비 H/D > 15 — 와류진동(vortex shedding) 동적 검토 권장');
  if (seis.Tn > 0.4 && totalHeight / (Ds / 1000) > 15) warnings.push(`1차 고유주기 ${seis.Tn.toFixed(2)} s — 풍방향 동적 증폭 검토 권장`);
  if (T > 343 && mat === 'CS_SA516_70') warnings.push('탄소강 343°C 초과 — 크리프 영역 허용응력 저감 적용됨');

  return {
    materialLabel: md.label,
    allowStressMpa: Number(S.toFixed(1)),
    elasticModulusMpa: Math.round(Emod),
    corrosionAllowanceMm: CA,
    jointEfficiency: Ej,
    shellInternalReqMm: Number(tShellInt.toFixed(2)),
    headType: head,
    headInternalReqMm: Number(tHeadInt.toFixed(2)),
    shellExternalReqMm: Number(tShellExt.toFixed(2)),
    headExternalReqMm: Number(tHeadExt.toFixed(2)),
    combinedLoadReqMm: Number(combinedLoadReqMm.toFixed(2)),
    governingCase: gov.c,
    selectedShellMm,
    selectedHeadMm,
    externalPressMpa: Pext,
    stiffenerSpacingM: Number(stiffenerSpacingM.toFixed(2)),
    stiffenerCount,
    stiffenerIsReqCm4: Number(stiffenerIsReqCm4.toFixed(1)),
    stiffenerSection,
    ug28FactorA: ugA,
    ug28FactorBMpa: Number(ugB.toFixed(2)),
    ug28AllowableMpa: Number(ugPa.toFixed(4)),
    windBaseShearKN: Number((windShearN / 1000).toFixed(1)),
    windBaseMomentKNm: Number((windMomentNm / 1000).toFixed(1)),
    seismicPeriodS: Number(seis.Tn.toFixed(3)),
    seismicCs: Number(seis.Cs.toFixed(4)),
    seismicBaseShearKN: Number(seis.Vb.toFixed(1)),
    seismicBaseMomentKNm: Number(seis.Mb.toFixed(1)),
    eccentricMomentKNm: Number(eccMomentKNm.toFixed(1)),
    governingLateral: windMomentNm / 1000 >= seis.Mb ? 'wind' : 'seismic',
    shellWeightKN: Number(weights.shellKN.toFixed(1)),
    headsWeightKN: Number(weights.headKN.toFixed(1)),
    skirtWeightKN: Number(weights.skirtKN.toFixed(1)),
    emptyWeightKN: Number(weights.empty.toFixed(1)),
    operatingWeightKN: Number(weights.operating.toFixed(1)),
    hydrotestWeightKN: Number(weights.hydro.toFixed(1)),
    loadCases: finalEval.cases.map((c) => ({
      ...c,
      windwardTensileMpa: Number(c.windwardTensileMpa.toFixed(2)),
      leewardCompressiveMpa: Number(c.leewardCompressiveMpa.toFixed(2)),
      allowTensileMpa: Number(c.allowTensileMpa.toFixed(1)),
      allowCompressiveMpa: Number(c.allowCompressiveMpa.toFixed(1)),
    })),
    skirtThicknessMm: tSkirt,
    baseRingOdMm: Math.round(ringOd),
    baseRingIdMm: Math.round(ringId),
    baseRingThicknessMm,
    concreteBearingMpa: Number(fc.toFixed(2)),
    anchorBoltCount: nBolts,
    anchorBoltSize: boltSize,
    anchorBoltCircleMm: Math.round(Db),
    anchorTensionPerBoltKN: Number(Tb.toFixed(1)),
    hydrotestPressMpaG: Number(hydrotestTop.toFixed(3)),
    hydrotestPressBottomMpaG: Number(hydrotestBottom.toFixed(3)),
    mawpMpaG: Number(mawp.toFixed(3)),
    nozzleReinforcement,
    warnings,
  };
}

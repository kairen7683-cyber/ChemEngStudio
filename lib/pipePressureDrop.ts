// =====================================================================
// 배관 차압 계산 엔진 (Pipe Pressure Drop Engine)
// Darcy-Weisbach + Churchill friction factor + K-factor fittings
// =====================================================================

import { FluidProps, densityAtT, viscosityAtT } from './physicalProperties';

// ─────────────────────────────────────────────────────────────────────
// Churchill (1977) 마찰계수 상관식 — 층류/전이/난류 통합
// ─────────────────────────────────────────────────────────────────────
export function churchillFrictionFactor(Re: number, eps: number, D: number): number {
  if (Re < 1) return 64;  // 극저속 방지
  const eps_D = eps / D;
  const A = (-2.457 * Math.log(Math.pow(7 / Re, 0.9) + 0.27 * eps_D)) ** 16;
  const B = Math.pow(37530 / Re, 16);
  const f = 8 * Math.pow(
    Math.pow(8 / Re, 12) + 1 / Math.pow(A + B, 1.5),
    1 / 12
  );
  return f;  // Darcy friction factor
}

/** 레이놀즈수 */
export function reynoldsNumber(rho: number, v: number, D_m: number, mu_mPas: number): number {
  const mu_Pas = mu_mPas / 1000;
  return (rho * v * D_m) / mu_Pas;
}

/** 단면적 (m²) */
export function pipeArea(D_mm: number): number {
  const D_m = D_mm / 1000;
  return Math.PI * D_m * D_m / 4;
}

/** 유속 (m/s) */
export function flowVelocity(flowRate_m3h: number, D_mm: number): number {
  const A = pipeArea(D_mm);
  return (flowRate_m3h / 3600) / A;
}

// ─────────────────────────────────────────────────────────────────────
// 이음쇠 K-factor 데이터
// ─────────────────────────────────────────────────────────────────────
export interface FittingType {
  key: string;
  name: string;
  nameKo: string;
  /** K-factor (고정값이면 숫자, 변동이면 fn(Re)) */
  K: number;
}

export const FITTING_TYPES: FittingType[] = [
  { key: 'elbow_90_std',  name: '90° std elbow',       nameKo: '90° 엘보 (표준)',   K: 0.75 },
  { key: 'elbow_90_lr',   name: '90° LR elbow',        nameKo: '90° 엘보 (LR)',     K: 0.45 },
  { key: 'elbow_45',      name: '45° elbow',            nameKo: '45° 엘보',          K: 0.35 },
  { key: 'tee_flow',      name: 'Tee (through)',        nameKo: '티 (직류)',          K: 0.20 },
  { key: 'tee_branch',    name: 'Tee (branch)',         nameKo: '티 (분기)',          K: 1.00 },
  { key: 'gate_open',     name: 'Gate valve (open)',    nameKo: '게이트 밸브 (전개)', K: 0.13 },
  { key: 'globe_open',    name: 'Globe valve (open)',   nameKo: '글로브 밸브 (전개)', K: 4.50 },
  { key: 'ball_open',     name: 'Ball valve (open)',    nameKo: '볼 밸브 (전개)',     K: 0.05 },
  { key: 'butterfly',     name: 'Butterfly valve',     nameKo: '버터플라이 밸브',    K: 0.60 },
  { key: 'check_swing',   name: 'Check valve (swing)', nameKo: '체크 밸브 (스윙)',   K: 2.50 },
  { key: 'check_lift',    name: 'Check valve (lift)',  nameKo: '체크 밸브 (리프트)', K: 5.00 },
  { key: 'reducer',       name: 'Reducer',             nameKo: '리듀서',             K: 0.05 },
  { key: 'entrance',      name: 'Entrance (sharp)',    nameKo: '입구 (직각)',         K: 0.50 },
  { key: 'exit',          name: 'Exit',                nameKo: '출구',               K: 1.00 },
  { key: 'strainer_y',    name: 'Y-Strainer',          nameKo: 'Y형 스트레이너',     K: 1.50 },
  { key: 'orifice',       name: 'Orifice plate',       nameKo: '오리피스',           K: 3.00 },
  { key: 'control_valve', name: 'Control valve',       nameKo: '컨트롤 밸브',        K: 8.00 },
];

// ─────────────────────────────────────────────────────────────────────
// 배관 구간 정의
// ─────────────────────────────────────────────────────────────────────
export interface PipeFitting {
  fittingKey: string;
  count: number;
}

export interface PipeSegment {
  id: string;
  label: string;
  D_mm: number;          // 내경 (mm)
  length_m: number;      // 직관 길이 (m)
  roughness_mm: number;  // 조도 ε (mm)
  fittings: PipeFitting[];
  /** 높이차 (m), 양수=상승, 음수=하강 */
  elevation_m: number;
}

export interface PipeSegmentResult {
  segment: PipeSegment;
  velocity_ms: number;
  Re: number;
  frictionFactor: number;    // Darcy f
  dP_friction_kPa: number;   // 직관 마찰 손실
  dP_fittings_kPa: number;   // 이음쇠 손실
  dP_elevation_kPa: number;  // 위치수두 손실 (양수=손실)
  dP_total_kPa: number;      // 구간 합계
  K_total: number;           // 이음쇠 K 합계
}

export interface PipeCalcResult {
  flowRate_m3h: number;
  segments: PipeSegmentResult[];
  dP_friction_total_kPa: number;
  dP_fittings_total_kPa: number;
  dP_elevation_total_kPa: number;
  dP_total_kPa: number;
  dP_total_mH2O: number;
  dP_total_bar: number;
}

// ─────────────────────────────────────────────────────────────────────
// 배관 차압 계산 메인 함수
// ─────────────────────────────────────────────────────────────────────
export function calcPipePressureDrop(
  fluid: FluidProps,
  T_C: number,
  flowRate_m3h: number,
  segments: PipeSegment[],
): PipeCalcResult {
  const rho = densityAtT(fluid, T_C);  // kg/m³
  const mu  = viscosityAtT(fluid, T_C); // mPa·s
  const g   = 9.81;

  const segResults: PipeSegmentResult[] = segments.map(seg => {
    const D_m = seg.D_mm / 1000;
    const A   = Math.PI * D_m * D_m / 4;
    const v   = (flowRate_m3h / 3600) / A;
    const Re  = reynoldsNumber(rho, v, D_m, mu);
    const f   = churchillFrictionFactor(Re, seg.roughness_mm, seg.D_mm);

    // 직관 마찰 손실
    const dP_friction_Pa = f * (seg.length_m / D_m) * 0.5 * rho * v * v;
    const dP_friction_kPa = dP_friction_Pa / 1000;

    // 이음쇠 K 합계
    const K_total = seg.fittings.reduce((sum, ft) => {
      const ftype = FITTING_TYPES.find(x => x.key === ft.fittingKey);
      return sum + (ftype?.K ?? 0) * ft.count;
    }, 0);
    const dP_fittings_Pa  = K_total * 0.5 * rho * v * v;
    const dP_fittings_kPa = dP_fittings_Pa / 1000;

    // 위치수두 (elevation loss)
    const dP_elevation_kPa = rho * g * seg.elevation_m / 1000;

    const dP_total_kPa = dP_friction_kPa + dP_fittings_kPa + dP_elevation_kPa;

    return {
      segment: seg,
      velocity_ms: v,
      Re,
      frictionFactor: f,
      dP_friction_kPa,
      dP_fittings_kPa,
      dP_elevation_kPa,
      dP_total_kPa,
      K_total,
    };
  });

  const dP_friction_total  = segResults.reduce((s, r) => s + r.dP_friction_kPa,   0);
  const dP_fittings_total  = segResults.reduce((s, r) => s + r.dP_fittings_kPa,  0);
  const dP_elevation_total = segResults.reduce((s, r) => s + r.dP_elevation_kPa, 0);
  const dP_total           = dP_friction_total + dP_fittings_total + dP_elevation_total;

  return {
    flowRate_m3h,
    segments: segResults,
    dP_friction_total_kPa:  dP_friction_total,
    dP_fittings_total_kPa:  dP_fittings_total,
    dP_elevation_total_kPa: dP_elevation_total,
    dP_total_kPa:   dP_total,
    dP_total_mH2O:  dP_total * 1000 / (rho * g),
    dP_total_bar:   dP_total / 100,
  };
}

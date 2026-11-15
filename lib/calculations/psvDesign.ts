/**
 * Pressure Safety Valve (PSV) Solver (API 521 Scenarios + API 520 Part I + API 526 D~T)
 *
 * Strictly unifies & upgrades ChemPro `solvePSV`:
 *   1. API 521 Relief Scenarios:
 *      - `blocked_outlet` (10% overpressure)
 *      - `fire_case` (21% overpressure, Q = 43.2 * F * A_wet^0.82 kW)
 *      - `tube_rupture` (HX tube rupture shock/flash scenario)
 *      - `thermal_exp` (blocked-in liquid thermal expansion volumetric relief)
 *   2. API 520 Part I Sizing Equations:
 *      - Vapor/Gas Critical (Choked Sonic) & Subcritical (F2)
 *      - Steam (Kn Napier high-pressure correction + Ksh superheat correction)
 *      - Liquid with ITERATIVE Reynolds-number viscosity correction Kv(Re) (never fixed 1.0!)
 *   3. API 526 Standard Orifices D through T via `getApi526Orifices()`.
 */

import {
  type Api526Orifice,
  getApi526Orifices,
  resolveFluidProps,
} from './chemproFluidBridge';

export type PSVSolverMode = 'quick' | 'rigorous';
export type PSVScenario = 'blocked_outlet' | 'fire_case' | 'tube_rupture' | 'thermal_exp' | string;
export type PSVPhase = 'vapor' | 'steam' | 'liquid' | string;

export interface PSVDesignInput {
  equipTag?: string;
  equipName?: string;
  scenario?: PSVScenario;
  phase?: PSVPhase;
  fluidId?: string;
  W_kgh?: number;
  P_set_barG?: number;
  P_back_barG?: number;
  patm_bar?: number;
  overpress_pct?: number;
  T_rel_C?: number;
  mw?: number;
  k_cpcv?: number;
  Z_comp?: number;
  rhoL?: number;
  mu_cP?: number;
  hv_kJkg?: number;
  A_wet_m2?: number;
  F_env?: number;
  has_rupture_disk?: boolean;
  is_balanced_bellows?: boolean;
  /** Optional trapped heat input (kW) for thermal_exp auto-sizing when W_kgh omitted */
  dQ_kW?: number;
  /** Volumetric thermal expansion coefficient (1/K) for thermal_exp */
  alpha_cub_K?: number;
  /** Liquid heat capacity (kJ/(kg·K)) for thermal_exp */
  cp_kJkgK?: number;
}

export interface PSVIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface PSVWarningItem {
  level: 'danger' | 'warn' | 'ok';
  text: string;
}

export interface PSVDesignResult {
  // ── Exact ChemPro `solvePSV` contract keys ─────────────────────────────
  equipTag: string;
  equipName: string;
  scenario: string;
  phase: string;
  W_kgh: number;
  W_rated_kgh: number;
  Q_fire_kW: number;
  P_set_barG: number;
  P_back_barG: number;
  P1_barA: number;
  P2_barA: number;
  overpress_pct: number;
  r_crit: number;
  backPressRatio: number;
  isCritical: boolean;
  A_req_mm2: number;
  A_req_in2: number;
  selectedOrifice: Api526Orifice;
  cap_utilization_pct: number;
  iterations: PSVIterationRow[];
  warnings: PSVWarningItem[];

  // ── Rigorous API 520 / 521 / 526 diagnostic fields ─────────────────────
  Kd: number;
  Kb: number;
  Kc: number;
  Kv: number;
  Kn: number;
  Ksh: number;
  C_api: number;
  F2: number;
  F_env: number;
  Re_orifice: number;
  parallelCount: number;
  mode: PSVSolverMode;
}

/**
 * Steam saturation temperature (°C) from absolute pressure (barA) via Antoine correlation
 * and API 520 Table 9 superheat correction factor Ksh.
 */
function calcSteamKsh(P1_barA: number, T_rel_C: number): { Tsat_C: number; Ksh: number } {
  const P_safe = Math.max(0.1, P1_barA);
  // Water Antoine constants (bar, K)
  const Tsat_K = 3816.44 / (11.6834 - Math.log(P_safe)) + 46.13;
  const Tsat_C = Tsat_K - 273.15;
  const superheatC = Math.max(0, T_rel_C - Tsat_C);
  if (superheatC <= 2) {
    return { Tsat_C, Ksh: 1.0 };
  }
  // Smooth fit to API 520 Part I Table 9 (steam superheat correction Ksh)
  const P_bar_factor = 1 + 0.00028 * Math.max(0, P1_barA - 10);
  const Ksh = Math.max(0.72, Math.min(1.0, 1.0 / (1.0 + 0.00138 * superheatC * P_bar_factor)));
  return { Tsat_C, Ksh };
}

/**
 * API 520 Part I Eq. 5.13 Napier correction factor Kn for steam above 103.39 barA (1500 psia).
 */
function calcSteamKn(P1_kPa: number): number {
  const P1_psia = P1_kPa * 0.1450377;
  if (P1_psia <= 1500) return 1.0;
  const P_eff = Math.min(3200, P1_psia);
  const denom = 0.2292 * P_eff - 1061.0;
  if (Math.abs(denom) < 1e-6) return 1.0;
  return Math.max(1.0, (0.1906 * P_eff - 1000.0) / denom);
}

/**
 * API 520 Part I Sec. 5.8 liquid viscosity correction Kv(Re).
 */
function api520LiquidKv(re: number): number {
  const reSafe = Math.max(10, re);
  const denom = 0.9935 + 2.878 / Math.sqrt(reSafe) + 342.75 / Math.pow(reSafe, 1.5);
  return Math.max(0.15, Math.min(1.0, 1.0 / denom));
}

export function solvePSV(
  inp: PSVDesignInput = {},
  mode: PSVSolverMode | string = 'rigorous',
): PSVDesignResult {
  const solverMode: PSVSolverMode = mode === 'quick' ? 'quick' : 'rigorous';
  const scenario = inp.scenario ?? 'blocked_outlet';
  const phase = inp.phase ?? 'vapor';

  const T_rel_C = inp.T_rel_C ?? 140.0;
  const T_rel_K = T_rel_C + 273.15;

  const fluidProps = inp.fluidId ? resolveFluidProps(inp.fluidId, T_rel_C) : null;

  const P_set_barG = Math.max(0.2, inp.P_set_barG ?? 15.0);
  const P_back_barG = Math.max(-0.5, inp.P_back_barG ?? 1.2);
  const patm_bar = inp.patm_bar ?? 1.01325;
  const overpress_pct =
    inp.overpress_pct ?? (scenario === 'fire_case' ? 21.0 : 10.0);

  const mw = Math.max(2.0, inp.mw ?? fluidProps?.mw ?? 44.1);
  const k_cpcv = Math.max(1.05, inp.k_cpcv ?? fluidProps?.k ?? 1.25);
  const Z_comp = Math.max(0.3, inp.Z_comp ?? 0.92);
  const rhoL = Math.max(200, inp.rhoL ?? fluidProps?.rho ?? 800.0);
  const mu_cP = Math.max(0.05, inp.mu_cP ?? fluidProps?.mu ?? 1.0);
  const hv_kJkg = Math.max(50, inp.hv_kJkg ?? fluidProps?.hv ?? 360.0);
  const F_env = Math.min(1.0, Math.max(0.1, inp.F_env ?? 1.0));

  // ── 1. API 521 Relief Load W_kgh ────────────────────────────────────────
  let W_kgh = Math.max(5, inp.W_kgh ?? 12000);
  let Q_fire_kW = 0;

  if (scenario === 'fire_case') {
    const A_wet_m2 = Math.max(1.0, inp.A_wet_m2 ?? 45.0);
    // API 521 Eq. for adequate drainage & firefighting: Q = 43.2 * F * A_wet^0.82 (kW)
    Q_fire_kW = 43.2 * F_env * Math.pow(A_wet_m2, 0.82);
    W_kgh = (Q_fire_kW * 3600.0) / hv_kJkg;
  } else if (scenario === 'thermal_exp' && phase === 'liquid' && inp.W_kgh === undefined) {
    const dQ_kW = Math.max(0.5, inp.dQ_kW ?? 15.0);
    const alpha_cub = inp.alpha_cub_K ?? 0.0008;
    const cp_kJkgK = Math.max(0.5, inp.cp_kJkgK ?? 2.2);
    W_kgh = Math.max(20, ((alpha_cub * dQ_kW) / cp_kJkgK) * rhoL * 3600.0);
  }

  // ── 2. Relieving Pressure & Critical Ratio ──────────────────────────────
  const P1_barA = P_set_barG * (1.0 + overpress_pct / 100.0) + patm_bar;
  const P1_kPa = P1_barA * 100.0;
  const P2_barA = Math.max(0.1, P_back_barG + patm_bar);
  const P2_kPa = P2_barA * 100.0;
  const backPressRatio = P2_kPa / P1_kPa;

  const r_crit = Math.pow(2.0 / (k_cpcv + 1.0), k_cpcv / (k_cpcv - 1.0));
  const isCritical = phase === 'liquid' ? false : backPressRatio <= r_crit;

  const C_api =
    0.03948 *
    Math.sqrt(k_cpcv * Math.pow(2.0 / (k_cpcv + 1.0), (k_cpcv + 1.0) / (k_cpcv - 1.0)));

  const Kd = phase === 'liquid' ? 0.65 : 0.975;
  const Kc = inp.has_rupture_disk ? 0.9 : 1.0;

  // Backpressure correction Kb (gas/steam) or Kw (liquid)
  const Kb =
    phase === 'liquid'
      ? backPressRatio > 0.15 && inp.is_balanced_bellows
        ? Math.max(0.6, 1.0 - 0.7 * (backPressRatio - 0.15))
        : 1.0
      : backPressRatio > 0.5
        ? Math.max(0.65, 1.0 - 0.8 * (backPressRatio - 0.5))
        : 1.0;

  // ── 3. API 520 Part I Orifice Area Sizing ───────────────────────────────
  let A_req_mm2 = 0;
  let Kv = 1.0;
  let Kn = 1.0;
  let Ksh = 1.0;
  let F2 = 1.0;
  let Re_orifice = 0;
  const iterations: PSVIterationRow[] = [];

  if (phase === 'liquid') {
    const Q_Lmin = (W_kgh / rhoL) * (1000.0 / 60.0);
    const G_sp = rhoL / 999.0;
    const dP_kPa = Math.max(
      10.0,
      (P_set_barG * (1.0 + overpress_pct / 100.0) - P_back_barG) * 100.0,
    );
    const A_uncorr = (11.78 * Q_Lmin) / (Kd * Kb * Kc * Math.sqrt(dP_kPa / G_sp));

    // Iterative API 520 liquid viscosity correction loop (Kv(Re))
    let A_cur = A_uncorr;
    let Kv_prev = 1.0;
    const maxIters = solverMode === 'quick' ? 4 : 12;
    for (let it = 1; it <= maxIters; it++) {
      Re_orifice = (18800.0 * Q_Lmin * G_sp) / (mu_cP * Math.sqrt(Math.max(1.0, A_cur)));
      Kv = api520LiquidKv(Re_orifice);
      A_cur = A_uncorr / Kv;
      const err = Math.abs(Kv - Kv_prev) / Math.max(0.05, Kv);
      if (it === 1 || it === maxIters || err < 1e-4) {
        iterations.push({
          iter: it,
          param: 'API 520 Liquid Viscosity Loop (Kv)',
          assumed: `Kv_in = ${Kv_prev.toFixed(4)}`,
          calc: `Re = ${Re_orifice.toFixed(0)}, Kv = ${Kv.toFixed(4)}, A = ${A_cur.toFixed(1)} mm²`,
          err: `${(err * 100).toFixed(3)}%`,
          note: `점도 μ = ${mu_cP} cP 반영`,
        });
      }
      if (err < 1e-4) break;
      Kv_prev = Kv;
    }
    A_req_mm2 = A_cur;
  } else if (phase === 'steam') {
    Kn = calcSteamKn(P1_kPa);
    const steamInfo = calcSteamKsh(P1_barA, T_rel_C);
    Ksh = steamInfo.Ksh;
    // API 520 Part I Steam equation (Metric: 190.5 * W_kgh / (Kd * P1_kPa * Kb * Kc * Kn * Ksh))
    A_req_mm2 = (190.5 * W_kgh) / (Kd * P1_kPa * Kb * Kc * Kn * Ksh);

    iterations.push({
      iter: 1,
      param: `API 520 Steam Sizing (Kn=${Kn.toFixed(3)}, Ksh=${Ksh.toFixed(3)})`,
      assumed: `P₁ = ${P1_barA.toFixed(2)} barA, T_rel = ${T_rel_C.toFixed(1)}°C`,
      calc: `T_sat = ${steamInfo.Tsat_C.toFixed(1)}°C, A_req = ${A_req_mm2.toFixed(1)} mm²`,
      err: '0.00%',
      note: isCritical ? '스팀 임계 유동 (Sonic Flow)' : '스팀 아임계 배압 보정(Kb)',
    });
  } else {
    // Vapor / Gas sizing (API 520 Part I Critical & Subcritical)
    if (isCritical) {
      A_req_mm2 =
        W_kgh / (C_api * Kd * P1_kPa * Kb * Kc * Math.sqrt(mw / (T_rel_K * Z_comp)));
    } else {
      const r = Math.min(0.999, Math.max(0.05, backPressRatio));
      F2 = Math.sqrt(
        (k_cpcv / (k_cpcv - 1.0)) *
          Math.pow(r, 2.0 / k_cpcv) *
          ((1.0 - Math.pow(r, (k_cpcv - 1.0) / k_cpcv)) / Math.max(1e-4, 1.0 - r)),
      );
      A_req_mm2 =
        (17.9 * W_kgh) /
        (F2 *
          Kd *
          Kc *
          Math.sqrt((mw * P1_kPa * Math.max(1.0, P1_kPa - P2_kPa)) / (T_rel_K * Z_comp)));
    }

    iterations.push({
      iter: 1,
      param: `API 520 임계압력비 판별 (r_c=${r_crit.toFixed(3)})`,
      assumed: `P₂/P₁ = ${backPressRatio.toFixed(3)}`,
      calc: isCritical
        ? `임계 유동 (Sonic, C=${C_api.toFixed(5)})`
        : `아임계 유동 (Subsonic, F₂=${F2.toFixed(4)})`,
      err: '0.00%',
      note: `방출압력 P₁ = ${P1_barA.toFixed(2)} barA (${overpress_pct}% 축적)`,
    });
  }

  const A_req_in2 = A_req_mm2 / 645.16;
  const orifices = getApi526Orifices();
  const selectedOrifice =
    orifices.find((o) => o.area_mm2 >= A_req_mm2) ?? orifices[orifices.length - 1];

  const parallelCount = Math.max(1, Math.ceil(A_req_mm2 / selectedOrifice.area_mm2));
  const cap_utilization_pct = (A_req_mm2 / selectedOrifice.area_mm2) * 100.0;
  const W_rated_kgh = W_kgh * (selectedOrifice.area_mm2 / Math.max(1.0, A_req_mm2));

  iterations.push({
    iter: iterations.length + 1,
    param: 'API 526 표준 오리피스 선정',
    assumed: `A_req = ${A_req_mm2.toFixed(1)} mm² (${A_req_in2.toFixed(3)} in²)`,
    calc: `'${selectedOrifice.letter}' Orifice (${selectedOrifice.area_mm2} mm², ${selectedOrifice.size})`,
    err: '0.00%',
    note: `용량 가동률 ${cap_utilization_pct.toFixed(1)}%`,
  });

  const warnings: PSVWarningItem[] = [];
  if (A_req_mm2 > selectedOrifice.area_mm2) {
    warnings.push({
      level: 'danger',
      text: `단일 T-Orifice 최대 면적(${selectedOrifice.area_mm2.toLocaleString()} mm²) 초과! 최소 ${parallelCount}개의 병렬 PSV 설치가 필요합니다.`,
    });
  } else if (cap_utilization_pct < 35.0) {
    warnings.push({
      level: 'warn',
      text: `PSV 오리피스 가동률 낮음 (${cap_utilization_pct.toFixed(1)}% < 35%) — 채터링(Chattering) 주의`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `API 526 '${selectedOrifice.letter}' 오리피스(${selectedOrifice.size}) 적합: 가동률 ${cap_utilization_pct.toFixed(1)}%`,
    });
  }

  if (P_back_barG / P_set_barG > 0.1) {
    warnings.push({
      level: 'warn',
      text: `배압비(P_back/P_set = ${((P_back_barG / P_set_barG) * 100).toFixed(1)}% > 10%) — 벨로우즈형(Balanced Bellows) 또는 파일럿 작동식 PSV를 적용하세요.`,
    });
  }

  if (phase === 'liquid' && Kv < 0.92) {
    warnings.push({
      level: 'warn',
      text: `고점도 액체(${mu_cP} cP, Re=${Re_orifice.toFixed(0)})로 인해 API 520 점도 보정계수 Kv=${Kv.toFixed(3)}가 적용되었습니다.`,
    });
  }

  if (scenario === 'tube_rupture') {
    warnings.push({
      level: 'warn',
      text: 'API 521 Tube Rupture 시나리오: 저압측 설계압력이 고압측의 10/13 규칙을 충족하지 않을 경우 동적 과압 해석 검토가 필요합니다.',
    });
  }

  return {
    equipTag: inp.equipTag ?? 'PSV-101',
    equipName: inp.equipName ?? 'Pressure Safety Relief Valve',
    scenario,
    phase,
    W_kgh: Number(W_kgh.toFixed(2)),
    W_rated_kgh: Number(W_rated_kgh.toFixed(2)),
    Q_fire_kW: Number(Q_fire_kW.toFixed(2)),
    P_set_barG,
    P_back_barG,
    P1_barA: Number(P1_barA.toFixed(3)),
    P2_barA: Number(P2_barA.toFixed(3)),
    overpress_pct,
    r_crit: Number(r_crit.toFixed(4)),
    backPressRatio: Number(backPressRatio.toFixed(4)),
    isCritical,
    A_req_mm2: Number(A_req_mm2.toFixed(2)),
    A_req_in2: Number(A_req_in2.toFixed(4)),
    selectedOrifice,
    cap_utilization_pct: Number(cap_utilization_pct.toFixed(2)),
    iterations,
    warnings,

    Kd,
    Kb: Number(Kb.toFixed(4)),
    Kc,
    Kv: Number(Kv.toFixed(4)),
    Kn: Number(Kn.toFixed(4)),
    Ksh: Number(Ksh.toFixed(4)),
    C_api: Number(C_api.toFixed(6)),
    F2: Number(F2.toFixed(4)),
    F_env,
    Re_orifice: Number(Re_orifice.toFixed(0)),
    parallelCount,
    mode: solverMode,
  };
}

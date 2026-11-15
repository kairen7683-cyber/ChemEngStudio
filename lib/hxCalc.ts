// =====================================================================
// 전해공장(Chlor-Alkali) 전용 열교환기 설계 계산 모듈 (Bell-Delaware & Kern)
// + PFD 장치(열교환기·패킹컬럼·펌프) 실시간 물질수지(Stream) 조건 매핑
// + ChemEngStudio CAD 블루프린트 & T-Q 프로파일 렌더링 엔진
// =====================================================================

import type { StreamData } from '@/lib/calculations/streams';
import type { TowerMode } from '@/lib/packingCalc';
import {
  type FluidState,
  type LayoutDeg,
  type ShellTubeGeometry,
  type TwoPhaseFluid,
  bellDelawareShellSide,
  gungorWintertonBoilingH,
  shahCondensationH,
  shellBoilingH,
  shellCondensationH,
  shellSideTwoPhaseDP,
  temaVibrationCheck,
  tubeSideSinglePhase,
  tubeSideTwoPhaseDP,
} from '@/lib/calculations/shellTubeRating';

// ─── 1. 열교환기 유체 물성 DB (전해공장 특화) ─────────────────────────
export interface HXFluidSpec {
  key: string;
  nameKo: string;
  nameEn: string;
  phase: 'L' | 'G' | 'condensing' | 'boiling';
  rho_kgm3: number;       // 기준 밀도 (kg/m³)
  cp_kJkgK: number;       // 비열 (kJ/kg·K)
  mu_mPas: number;        // 점도 (mPa·s = cP)
  k_WmK: number;          // 열전도도 (W/m·K)
  latent_kJkg?: number;   // 상변화 잠열 (kJ/kg, 스팀/응축성 가스용)
  defaultFouling: number; // 표준 오염계수 Rf (m²·K/W)
}

export const HX_FLUIDS: HXFluidSpec[] = [
  { key: 'naoh_32',       nameKo: '가성소다 32 wt%',         nameEn: '32% NaOH Solution',    phase: 'L',          rho_kgm3: 1310, cp_kJkgK: 3.30, mu_mPas: 3.20,  k_WmK: 0.58, defaultFouling: 0.00018 },
  { key: 'naoh_42',       nameKo: '가성소다 42 wt% (중간효)',nameEn: '42% NaOH Solution',    phase: 'L',          rho_kgm3: 1394, cp_kJkgK: 3.12, mu_mPas: 5.80,  k_WmK: 0.56, defaultFouling: 0.00020 },
  { key: 'naoh_50',       nameKo: '가성소다 50 wt%',         nameEn: '50% NaOH Product',     phase: 'L',          rho_kgm3: 1480, cp_kJkgK: 2.95, mu_mPas: 12.0,  k_WmK: 0.54, defaultFouling: 0.00020 },
  { key: 'brine_25',      nameKo: '포화 브라인 (25% NaCl)',  nameEn: 'Saturated Brine',      phase: 'L',          rho_kgm3: 1170, cp_kJkgK: 3.35, mu_mPas: 0.85,  k_WmK: 0.57, defaultFouling: 0.00018 },
  { key: 'anolyte',       nameKo: '양극액 (탈염 브라인)',    nameEn: 'Depleted Brine',       phase: 'L',          rho_kgm3: 1090, cp_kJkgK: 3.52, mu_mPas: 0.55,  k_WmK: 0.61, defaultFouling: 0.00018 },
  { key: 'cl2_wet',       nameKo: '습염소가스 (수분응축 동반)',nameEn: 'Wet Cl₂ Gas',        phase: 'condensing', rho_kgm3: 3.45, cp_kJkgK: 0.52, mu_mPas: 0.014, k_WmK: 0.010, latent_kJkg: 185, defaultFouling: 0.00018 },
  { key: 'cl2_gas',       nameKo: '건조 염소가스 (Dry Cl₂)', nameEn: 'Dry Cl₂ Gas',          phase: 'G',          rho_kgm3: 3.35, cp_kJkgK: 0.48, mu_mPas: 0.014, k_WmK: 0.009, defaultFouling: 0.00015 },
  { key: 'cl2_liq',       nameKo: '액화 염소 (Cl₂ 응축)',    nameEn: 'Condensing Cl₂',       phase: 'condensing', rho_kgm3: 1516, cp_kJkgK: 0.96, mu_mPas: 0.45,  k_WmK: 0.15,  latent_kJkg: 288, defaultFouling: 0.00015 },
  { key: 'h2_wet',        nameKo: '습수소가스 (수분응축 동반)',nameEn: 'Wet H₂ Gas',         phase: 'condensing', rho_kgm3: 0.22, cp_kJkgK: 14.3, mu_mPas: 0.009, k_WmK: 0.18,  latent_kJkg: 420, defaultFouling: 0.00010 },
  { key: 'h2_gas',        nameKo: '수소가스 (H₂ Gas)',       nameEn: 'Compressed H₂ Gas',    phase: 'G',          rho_kgm3: 1.85, cp_kJkgK: 14.4, mu_mPas: 0.009, k_WmK: 0.19, defaultFouling: 0.00009 },
  { key: 'h2so4_98',      nameKo: '황산 98 wt%',             nameEn: '98% H₂SO₄',            phase: 'L',          rho_kgm3: 1830, cp_kJkgK: 1.38, mu_mPas: 21.0,  k_WmK: 0.36, defaultFouling: 0.00018 },
  { key: 'cooling_water', nameKo: '냉각탑수 (CW 30→38°C)',   nameEn: 'Cooling Water (CW)',   phase: 'L',          rho_kgm3: 995,  cp_kJkgK: 4.18, mu_mPas: 0.76,  k_WmK: 0.62, defaultFouling: 0.00018 },
  { key: 'chilled_water', nameKo: '칠러 냉수 (CCW 7→14°C)',  nameEn: 'Chilled Water (CCW)',  phase: 'L',          rho_kgm3: 999,  cp_kJkgK: 4.19, mu_mPas: 1.30,  k_WmK: 0.58, defaultFouling: 0.00010 },
  { key: 'steam_mp',      nameKo: '13K 중압 스팀 (191°C)',   nameEn: '13K MP Steam',         phase: 'condensing', rho_kgm3: 6.80, cp_kJkgK: 2.10, mu_mPas: 0.015, k_WmK: 0.032, latent_kJkg: 1975, defaultFouling: 0.00009 },
  { key: 'steam_lp',      nameKo: '효용 증기 / 저압 스팀',   nameEn: 'Effect Vapor / LP Steam',phase: 'condensing',rho_kgm3: 1.80, cp_kJkgK: 2.02, mu_mPas: 0.013, k_WmK: 0.026, latent_kJkg: 2180, defaultFouling: 0.00009 },
  { key: 'condensate',    nameKo: '고온 스팀 응축수',        nameEn: 'Steam Condensate',     phase: 'L',          rho_kgm3: 940,  cp_kJkgK: 4.24, mu_mPas: 0.24,  k_WmK: 0.68, defaultFouling: 0.00009 },
  { key: 'refrigerant',   nameKo: '냉매 브라인 (-35→-28°C)', nameEn: 'Refrigerant Brine',    phase: 'L',          rho_kgm3: 1240, cp_kJkgK: 2.85, mu_mPas: 4.50,  k_WmK: 0.45, defaultFouling: 0.00010 },
  { key: 'r134a',         nameKo: '냉매 R-134a (증발 -15°C)', nameEn: 'R-134a Boiling Refrig',phase: 'boiling',    rho_kgm3: 1295, cp_kJkgK: 1.34, mu_mPas: 0.28,  k_WmK: 0.092, latent_kJkg: 209, defaultFouling: 0.00009 },
  { key: 'r404a',         nameKo: '냉매 R-404A (증발 -35°C)', nameEn: 'R-404A Boiling Refrig',phase: 'boiling',    rho_kgm3: 1255, cp_kJkgK: 1.38, mu_mPas: 0.25,  k_WmK: 0.078, latent_kJkg: 192, defaultFouling: 0.00009 },
  { key: 'r507a',         nameKo: '냉매 R-507A (증발 -38°C)', nameEn: 'R-507A Azeotropic',    phase: 'boiling',    rho_kgm3: 1272, cp_kJkgK: 1.36, mu_mPas: 0.26,  k_WmK: 0.080, latent_kJkg: 196, defaultFouling: 0.00009 },
  { key: 'r22',           nameKo: '냉매 R-22 (증발 -33°C)',   nameEn: 'HCFC-22 Refrigerant',  phase: 'boiling',    rho_kgm3: 1385, cp_kJkgK: 1.18, mu_mPas: 0.30,  k_WmK: 0.105, latent_kJkg: 230, defaultFouling: 0.00009 },
  { key: 'r717',          nameKo: '암모니아 R-717 (증발 -33°C)',nameEn: 'Ammonia R-717',      phase: 'boiling',    rho_kgm3: 682,  cp_kJkgK: 4.60, mu_mPas: 0.25,  k_WmK: 0.540, latent_kJkg: 1369, defaultFouling: 0.00009 },
  { key: 'brine_eg40',    nameKo: '에틸렌글리콜 40% 브라인',  nameEn: '40% MEG Brine',        phase: 'L',          rho_kgm3: 1068, cp_kJkgK: 3.48, mu_mPas: 4.80,  k_WmK: 0.43, defaultFouling: 0.00012 },
  { key: 'brine_cacl2_25',nameKo: '염화칼슘 25% 심냉브라인',  nameEn: '25% CaCl₂ Brine',      phase: 'L',          rho_kgm3: 1242, cp_kJkgK: 2.86, mu_mPas: 5.20,  k_WmK: 0.51, defaultFouling: 0.00015 },
  { key: 'dch_13',        nameKo: '조 1,3-DCH 반응 혼합액',    nameEn: 'Crude 1,3-DCH Mix',    phase: 'L',          rho_kgm3: 1295, cp_kJkgK: 1.85, mu_mPas: 2.60,  k_WmK: 0.16, defaultFouling: 0.00022 },
  { key: 'ech_pure',      nameKo: '고순도 ECH (에피클로로히드린)', nameEn: 'Epichlorohydrin 99.9%', phase: 'L',       rho_kgm3: 1181, cp_kJkgK: 1.48, mu_mPas: 1.03,  k_WmK: 0.14, defaultFouling: 0.00012 },
  { key: 'glycerol',      nameKo: '정제 글리세린 (GTE 원료)',  nameEn: 'Refined Glycerol',     phase: 'L',          rho_kgm3: 1238, cp_kJkgK: 2.52, mu_mPas: 81.0,  k_WmK: 0.29, defaultFouling: 0.00025 },
];

export const HX_MATERIALS = [
  { key: 'Titanium Gr.2',   label: 'Titanium Gr.2 (습염소/브라인 표준)',       kw_WmK: 21.9 },
  { key: 'Nickel 200',      label: 'Nickel 200 (고온/고농도 가성소다 표준)',    kw_WmK: 70.2 },
  { key: 'Hastelloy C-276', label: 'Hastelloy C-276 (염소/강산 내부식)',        kw_WmK: 10.2 },
  { key: 'SS 316L',         label: '316L SS (수소/저온 NaOH/냉각수)',           kw_WmK: 16.3 },
  { key: 'Ni+SS',           label: 'Nickel 200 Tube + SS316L Shell (증발/농축)',kw_WmK: 65.0 },
  { key: 'CS (LTCS)',       label: 'LTCS 저온탄소강 (건조/액화 염소)',          kw_WmK: 48.0 },
];

// ─── 2. 열교환기 설계 입출력 인터페이스 ───────────────────────────────
export type HXDofMode = 'calc_mc' | 'calc_mh' | 'calc_Tc_out' | 'calc_Th_out' | 'manual_both';

export interface HXDesignInputs {
  tag?: string;
  serviceName?: string;
  section?: string;
  dofMode: HXDofMode;

  // 고온측 (Hot Side)
  hotFluidKey: string;
  mh_kgh: number;
  Th_in_C: number;
  Th_out_C: number;
  Ph_kgcm2g: number;
  hotCondensingFrac: number; // 0~1 (스팀 응축 또는 습가스 수분응축 비율)

  // 저온측 (Cold Side)
  coldFluidKey: string;
  mc_kgh: number;
  Tc_in_C: number;
  Tc_out_C: number;
  Pc_kgcm2g: number;

  // TEMA 기하구조 및 설계 파라미터
  n_shell: number;           // 직렬 쉘 수 (1~4)
  n_passes: number;          // 튜브 패스 수 (1, 2, 4, 6)
  do_mm: number;             // 튜브 외경 (19.05 또는 25.4 mm)
  tw_mm: number;             // 튜브 두께 (1.24 ~ 2.11 mm)
  L_m: number;               // 튜브 길이 (2.44 ~ 6.10 m)
  layoutAngle: 30 | 45 | 90; // 튜브 배열 각도
  baffleCutPct: number;      // 배플 컷 비율 (15~45%, 표준 25%)
  overdesignPct: number;     // 설계 여유율 (표준 15%)
  rft: number;               // 관측 오염계수 (m²·K/W)
  rfs: number;               // 쉘측 오염계수 (m²·K/W)
  material: string;          // 재질명
}

export interface HXDesignResults {
  Q_kW: number;
  Q_Mcalh: number;
  mh_kgh: number;
  mc_kgh: number;
  Th_in_C: number;
  Th_out_C: number;
  Tc_in_C: number;
  Tc_out_C: number;
  lmtd_C: number;
  Ft: number;
  CMTD_C: number;
  U_calc_Wm2K: number;
  U_req_Wm2K: number;
  A_req_m2: number;
  A_prov_m2: number;
  overdesign_pct: number;
  N_tubes: number;
  D_bundle_mm: number;
  D_shell_mm: number;
  N_baffles: number;
  B_spacing_mm: number;
  hi_Wm2K: number;
  ho_Wm2K: number;
  vt_ms: number;
  vs_ms: number;
  Ret: number;
  Res: number;
  dPt_bar: number;
  dPs_bar: number;
  f_vs_Hz: number;
  f_nat_Hz: number;
  vibRatio: number;
  warnings: string[];
}

// ─── 3. Bell-Delaware & Kern 열교환기 솔버 ────────────────────────────
function calcTemaFt(Th_in: number, Th_out: number, Tc_in: number, Tc_out: number, nShell: number): number {
  const dT_hot = Math.abs(Th_in - Th_out);
  const dT_cold = Math.abs(Tc_out - Tc_in);
  if (dT_hot < 0.5 || dT_cold < 0.5) return 1.0; // 등온 상변화(스팀 응축 등)는 Ft = 1.0

  const P = Math.min(0.98, Math.max(0.01, (Tc_out - Tc_in) / Math.max(1, Th_in - Tc_in)));
  const R = Math.min(10.0, Math.max(0.05, (Th_in - Th_out) / Math.max(0.5, Tc_out - Tc_in)));

  if (Math.abs(R - 1.0) < 1e-3) {
    const P1 = P / (nShell - nShell * P + P);
    const num = P1 * Math.sqrt(2);
    const den = (1 - P1) * Math.log((2 - P1 * (2 - Math.sqrt(2))) / Math.max(1e-4, 2 - P1 * (2 + Math.sqrt(2))));
    return Math.max(0.5, Math.min(1.0, num / Math.max(1e-4, den)));
  }

  const S = Math.sqrt(R * R + 1);
  const ratio = (1 - P * R) / Math.max(1e-4, 1 - P);
  const pz = (1 - Math.pow(ratio, 1 / nShell)) / Math.max(1e-4, R - Math.pow(ratio, 1 / nShell));
  const num = S * Math.log(Math.max(1.0001, (1 - pz) / Math.max(1e-4, 1 - R * pz)));
  const den = (R - 1) * Math.log(Math.max(1.0001, (2 - pz * (R + 1 - S)) / Math.max(1e-4, 2 - pz * (R + 1 + S))));
  const ft = num / Math.max(1e-4, den);
  return isNaN(ft) ? 0.85 : Math.max(0.55, Math.min(1.0, ft));
}

function hxFluidToState(fl: HXFluidSpec, massFlowKgH: number): FluidState {
  return {
    massFlowKgS: Math.max(1e-4, massFlowKgH / 3600),
    rho: Math.max(0.15, fl.rho_kgm3),
    mu: Math.max(5e-6, fl.mu_mPas * 1e-3),
    cp: Math.max(300, fl.cp_kJkgK * 1000),
    k: Math.max(0.008, fl.k_WmK),
  };
}

function hxFluidToTwoPhase(
  fl: HXFluidSpec,
  massFlowKgH: number,
  tempC: number,
  pressKgcm2g: number,
): TwoPhaseFluid {
  const isSteam = fl.key.startsWith('steam');
  const isCl2 = fl.key.startsWith('cl2');
  const pAbsBar = Math.max(0.08, (pressKgcm2g + 1.03323) * 0.980665);
  const T_K = Math.max(180, tempC + 273.15);

  const liquidLike = fl.rho_kgm3 > 250;
  const rhoL = liquidLike ? fl.rho_kgm3 : isSteam ? 915 : isCl2 ? 1450 : 1000;
  const mwEst = isSteam ? 18.015 : isCl2 ? 70.9 : fl.key === 'r717' ? 17.03 : 95;
  const rhoG = !liquidLike
    ? Math.max(0.1, fl.rho_kgm3)
    : Math.min(rhoL * 0.45, Math.max(0.4, (pAbsBar * 1e5 * mwEst) / (8314.46 * T_K)));

  const muL = liquidLike ? Math.max(1e-4, fl.mu_mPas * 1e-3) : isSteam ? 1.8e-4 : 3.5e-4;
  const muG = !liquidLike ? Math.max(6e-6, fl.mu_mPas * 1e-3) : isSteam ? 1.4e-5 : 1.1e-5;
  const cpL = liquidLike ? Math.max(800, fl.cp_kJkgK * 1000) : isSteam ? 4280 : 3800;
  const kL = liquidLike ? Math.max(0.06, fl.k_WmK) : isSteam ? 0.67 : 0.45;
  const pCritBar = isSteam ? 220.6 : isCl2 ? 79.9 : fl.key === 'r717' ? 113.3 : 42;

  return {
    massFlowKgS: Math.max(1e-4, massFlowKgH / 3600),
    rhoL,
    rhoG: Math.min(rhoG, rhoL * 0.48),
    muL,
    muG,
    cpL,
    kL,
    sigma: isSteam ? 0.048 : isCl2 ? 0.022 : 0.025,
    hfg: Math.max(5e4, (fl.latent_kJkg ?? 350) * 1000),
    pCritBar,
    pReduced: Math.min(0.88, pAbsBar / pCritBar),
  };
}

export function calcHeatExchanger(inp: HXDesignInputs): HXDesignResults {
  const hotFluid = HX_FLUIDS.find(f => f.key === inp.hotFluidKey) ?? HX_FLUIDS[0];
  const coldFluid = HX_FLUIDS.find(f => f.key === inp.coldFluidKey) ?? HX_FLUIDS[11];
  const matObj = HX_MATERIALS.find(m => m.key === inp.material) ?? HX_MATERIALS[0];

  let mh = Math.max(10, inp.mh_kgh);
  let mc = Math.max(10, inp.mc_kgh);
  const Th_in = inp.Th_in_C;
  let Th_out = inp.Th_out_C;
  const Tc_in = inp.Tc_in_C;
  let Tc_out = inp.Tc_out_C;

  // 고온측 단위질량당 엔탈피 변화 (kJ/kg): 현열 + 잠열(응축 분율)
  const hotCondFrac = Math.max(0, Math.min(1, inp.hotCondensingFrac ?? 0));
  const dH_hot_kJkg = Math.max(1.0,
    hotFluid.cp_kJkgK * Math.abs(Th_in - Th_out) +
    (hotFluid.latent_kJkg ?? 0) * hotCondFrac
  );
  const coldBoilFrac = coldFluid.phase === 'boiling' ? 1.0 : 0.0;
  const dH_cold_kJkg = Math.max(1.0,
    coldFluid.cp_kJkgK * Math.abs(Tc_out - Tc_in) + (coldFluid.latent_kJkg ?? 0) * coldBoilFrac
  );

  let Q_kW = 0;
  if (inp.dofMode === 'calc_mc') {
    Q_kW = (mh * dH_hot_kJkg) / 3600;
    mc = (Q_kW * 3600) / dH_cold_kJkg;
  } else if (inp.dofMode === 'calc_mh') {
    Q_kW = (mc * dH_cold_kJkg) / 3600;
    mh = (Q_kW * 3600) / dH_hot_kJkg;
  } else if (inp.dofMode === 'calc_Tc_out') {
    Q_kW = (mh * dH_hot_kJkg) / 3600;
    Tc_out = Tc_in + (Q_kW * 3600) / Math.max(1, mc * coldFluid.cp_kJkgK);
  } else if (inp.dofMode === 'calc_Th_out') {
    Q_kW = (mc * dH_cold_kJkg) / 3600;
    const sensKJ = Math.max(0, Q_kW * 3600 - mh * (hotFluid.latent_kJkg ?? 0) * hotCondFrac);
    Th_out = Th_in - sensKJ / Math.max(1, mh * hotFluid.cp_kJkgK);
  } else {
    Q_kW = (mh * dH_hot_kJkg) / 3600;
  }

  Q_kW = Math.max(5, Q_kW);
  const Q_Mcalh = Q_kW * 0.859845;

  // LMTD & Ft
  const dT1 = Math.max(1.5, Th_in - Tc_out);
  const dT2 = Math.max(1.5, Th_out - Tc_in);
  const lmtd_C = Math.abs(dT1 - dT2) < 0.05
    ? (dT1 + dT2) / 2
    : (dT1 - dT2) / Math.log(dT1 / dT2);

  const nShell = Math.max(1, inp.n_shell);
  const Ft = calcTemaFt(Th_in, Th_out, Tc_in, Tc_out, nShell);
  const CMTD_C = Math.max(1.5, lmtd_C * Ft);

  // 기하구조 기본값
  const do_m = Math.max(0.012, inp.do_mm / 1000);
  const tw_m = Math.max(0.001, inp.tw_mm / 1000);
  const di_m = Math.max(0.008, do_m - 2 * tw_m);
  const L_m  = Math.max(1.2, inp.L_m);
  const nPasses = Math.max(1, inp.n_passes);
  const pitchRatio = 1.25;
  const pt_m = do_m * pitchRatio;
  const kw = matObj.kw_WmK;
  const layoutDeg: LayoutDeg = inp.layoutAngle === 45 ? 45 : inp.layoutAngle === 90 ? 90 : 30;
  const baffleCutFrac = Math.min(0.45, Math.max(0.15, inp.baffleCutPct / 100));

  // 부식성/고압 유체를 튜브측에 배치 (전해공장 표준)
  const tubeFluid = coldFluid;
  const shellFluid = hotFluid;
  const m_tube_kgh = mc;
  const m_shell_kgh = mh;

  const flTube = hxFluidToState(tubeFluid, m_tube_kgh);
  const flShell = hxFluidToState(shellFluid, m_shell_kgh);
  const tpTube = hxFluidToTwoPhase(tubeFluid, m_tube_kgh, 0.5 * (Tc_in + Tc_out), inp.Pc_kgcm2g);
  const tpShell = hxFluidToTwoPhase(shellFluid, m_shell_kgh, 0.5 * (Th_in + Th_out), inp.Ph_kgcm2g);

  // Rigorous Bell-Delaware (5-factor Taborek) + Gnielinski/Shah/Gungor-Winterton Loop
  let U_calc = 650;
  let N_tubes = 60;
  let D_bundle_m = 0.4;
  let D_shell_m = 0.45;
  let B_spacing_m = 0.25;
  let N_baffles = 8;
  let hi = 1500, ho = 1200;
  let vt = 1.2, vs = 0.8;
  let Ret = 15000, Res = 12000;
  let dPt_Pa_perShell = 15000;
  let dPs_Pa_perShell = 12000;

  const overFrac = 1 + Math.max(0, inp.overdesignPct) / 100;
  const R_wall = (do_m * Math.log(do_m / di_m)) / (2 * kw);

  let finalGeom: ShellTubeGeometry = {
    shellIdM: D_shell_m,
    tubeOdM: do_m,
    tubeIdM: di_m,
    tubePitchM: pt_m,
    layoutDeg,
    tubeCount: N_tubes,
    tubePasses: nPasses,
    tubeLengthM: L_m,
    baffleSpacingM: B_spacing_m,
    baffleCutFrac,
    sealingStripPairs: 1,
    baffleCount: N_baffles,
  };

  for (let iter = 0; iter < 10; iter++) {
    const A_req = (Q_kW * 1000) / Math.max(10, U_calc * CMTD_C);
    const A_target_per_shell = (A_req * overFrac) / nShell;
    const areaPerTube = Math.PI * do_m * L_m;
    N_tubes = Math.max(16, Math.ceil(A_target_per_shell / areaPerTube / nPasses) * nPasses);

    // 튜브 번들 및 쉘 내경 (Kern-TEMA bundle empirical)
    const K1 = nPasses === 1 ? 0.319 : nPasses === 2 ? 0.249 : nPasses === 4 ? 0.175 : 0.0743;
    const n1 = nPasses === 1 ? 2.142 : nPasses === 2 ? 2.207 : nPasses === 4 ? 2.285 : 2.499;
    D_bundle_m = do_m * Math.pow(N_tubes / K1, 1 / n1);
    const clearance_m = 0.018 + 0.04 * D_bundle_m;
    D_shell_m = Math.max(0.15, D_bundle_m + clearance_m);

    // 배플 간격 (0.40 * D_shell)
    B_spacing_m = Math.max(0.12, Math.min(D_shell_m * 0.85, D_shell_m * 0.40));
    N_baffles = Math.max(2, Math.floor(L_m / B_spacing_m) - 1);

    finalGeom = {
      shellIdM: D_shell_m,
      tubeOdM: do_m,
      tubeIdM: di_m,
      tubePitchM: pt_m,
      layoutDeg,
      tubeCount: N_tubes,
      tubePasses: nPasses,
      tubeLengthM: L_m,
      baffleSpacingM: B_spacing_m,
      baffleCutFrac,
      sealingStripPairs: 1,
      baffleCount: N_baffles,
    };

    const currentAreaM2 = Math.max(0.5, N_tubes * areaPerTube * nShell);
    const qFluxWm2 = (Q_kW * 1000) / currentAreaM2;

    // 튜브측 열전달 & 차압 (Gnielinski/Churchill 또는 Gungor-Winterton/Friedel)
    if (tubeFluid.phase === 'boiling') {
      const nPerPass = N_tubes / nPasses;
      const G_t = tpTube.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * di_m * di_m);
      hi = Math.max(150, gungorWintertonBoilingH(tpTube, G_t, di_m, 0.45, qFluxWm2));
      const tdp = tubeSideTwoPhaseDP(finalGeom, tpTube, 0.0, 0.85);
      dPt_Pa_perShell = tdp.totalPa;
      vt = G_t / tpTube.rhoL;
      Ret = (G_t * di_m) / tpTube.muL;
    } else if (tubeFluid.phase === 'condensing') {
      const nPerPass = N_tubes / nPasses;
      const G_t = tpTube.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * di_m * di_m);
      hi = Math.max(150, shahCondensationH(tpTube, G_t, di_m, 0.5));
      const tdp = tubeSideTwoPhaseDP(finalGeom, tpTube, 1.0, 0.0);
      dPt_Pa_perShell = tdp.totalPa;
      vt = G_t / tpTube.rhoL;
      Ret = (G_t * di_m) / tpTube.muL;
    } else {
      const tRes = tubeSideSinglePhase(finalGeom, flTube);
      hi = Math.max(80, tRes.h);
      vt = tRes.velMs;
      Ret = tRes.Re;
      dPt_Pa_perShell = tRes.dpTotalPa;
    }

    // 쉘측 열전달 & 차압 (Taborek 5-factor Bell-Delaware + Shah/Nusselt 응축 / Mostinski 비등)
    const bd = bellDelawareShellSide(finalGeom, flShell);
    vs = bd.crossVelMs;
    Res = bd.Re;

    if (hotCondFrac > 0.01) {
      const ho_cond = shellCondensationH(tpShell, finalGeom);
      if (shellFluid.phase === 'condensing' && hotCondFrac >= 0.85) {
        ho = Math.max(150, ho_cond);
        const sdp = shellSideTwoPhaseDP(finalGeom, tpShell, 1.0, Math.max(0, 1 - hotCondFrac));
        dPs_Pa_perShell = sdp.dpPa;
      } else {
        // 습가스 부분 응축 (Silver-Bell-Ghaly 가중)
        ho = Math.max(60, bd.h * (1 - hotCondFrac) + ho_cond * hotCondFrac);
        const sdp = shellSideTwoPhaseDP(finalGeom, tpShell, 1.0, Math.max(0.1, 1 - hotCondFrac));
        dPs_Pa_perShell = bd.dpTotalPa * (1 - hotCondFrac) + sdp.dpPa * hotCondFrac;
      }
    } else if (shellFluid.phase === 'boiling') {
      ho = Math.max(150, shellBoilingH(tpShell, qFluxWm2));
      const sdp = shellSideTwoPhaseDP(finalGeom, tpShell, 0.0, 0.85);
      dPs_Pa_perShell = sdp.dpPa;
    } else {
      ho = Math.max(60, bd.h);
      dPs_Pa_perShell = bd.dpTotalPa;
    }

    const invU = (1 / ho) + inp.rfs + R_wall + inp.rft * (do_m / di_m) + (do_m / (di_m * hi));
    const U_new = 1 / Math.max(1e-5, invU);
    U_calc = iter === 0 ? U_new : 0.35 * U_calc + 0.65 * U_new;
  }

  const A_req_m2 = (Q_kW * 1000) / Math.max(10, U_calc * CMTD_C);
  const A_prov_m2 = N_tubes * Math.PI * do_m * L_m * nShell;
  const U_req_Wm2K = (Q_kW * 1000) / Math.max(0.1, A_prov_m2 * CMTD_C);
  const overdesign_pct = ((A_prov_m2 - A_req_m2) / Math.max(0.01, A_req_m2)) * 100;

  const dPt_bar = Math.min(2.5, (dPt_Pa_perShell * nShell) / 1e5);
  const dPs_bar = Math.min(2.5, (dPs_Pa_perShell * nShell) / 1e5);

  // 유체유발진동(FIV) 검토 (TEMA RCB-4.6 + Connors Fluidelastic Instability)
  const vibRes = temaVibrationCheck({
    g: finalGeom,
    crossVelMs: vs,
    shellRho: Math.max(0.25, shellFluid.rho_kgm3),
    tubeRhoInside: Math.max(0.25, tubeFluid.rho_kgm3),
    shellPhase: shellFluid.phase === 'G' ? 'gas' : shellFluid.phase === 'L' ? 'liquid' : 'twophase',
    soundSpeedMs: shellFluid.phase === 'G' ? 320 : undefined,
  });
  const f_vs_Hz = vibRes.vortexFreqHz;
  const f_nat_Hz = vibRes.naturalFreqHz;
  const vibRatio = Math.max(vibRes.vortexRatio, vibRes.fluidelasticRatio);

  const warnings: string[] = [];
  if (Th_in <= Tc_out || Th_out <= Tc_in) {
    warnings.push('온도 교차(Temperature Cross) 주의: 직렬 쉘 수를 늘리거나 출구 온도를 확인하세요.');
  }
  if (Ft < 0.75) {
    warnings.push(`TEMA 온도보정계수 Ft(${Ft.toFixed(2)}) < 0.75: 직렬 쉘 수(n_shell) 증가를 권장합니다.`);
  }
  if (dPt_bar > 0.70) {
    warnings.push(`튜브측 차압(${dPt_bar.toFixed(2)} bar)이 높습니다. 패스 수를 줄이거나 튜브경을 키우세요.`);
  }
  if (dPs_bar > 0.70) {
    warnings.push(`쉘측 차압(${dPs_bar.toFixed(2)} bar)이 높습니다. 배플 간격을 넓히세요.`);
  }
  if (vibRatio > 0.80) {
    warnings.push(
      `유체유발진동(FIV) 비율(${vibRatio.toFixed(2)}, 와류=${vibRes.vortexRatio.toFixed(2)}, 유체탄성=${vibRes.fluidelasticRatio.toFixed(2)})이 0.80을 초과하여 배플 보강이 필요합니다.`,
    );
  }

  return {
    Q_kW,
    Q_Mcalh,
    mh_kgh: mh,
    mc_kgh: mc,
    Th_in_C: Th_in,
    Th_out_C: Th_out,
    Tc_in_C: Tc_in,
    Tc_out_C: Tc_out,
    lmtd_C,
    Ft,
    CMTD_C,
    U_calc_Wm2K: U_calc,
    U_req_Wm2K,
    A_req_m2,
    A_prov_m2,
    overdesign_pct,
    N_tubes,
    D_bundle_mm: D_bundle_m * 1000,
    D_shell_mm: Math.ceil((D_bundle_m * 1000 + 35) / 10) * 10,
    N_baffles,
    B_spacing_mm: B_spacing_m * 1000,
    hi_Wm2K: hi,
    ho_Wm2K: ho,
    vt_ms: vt,
    vs_ms: vs,
    Ret,
    Res,
    dPt_bar,
    dPs_bar,
    f_vs_Hz,
    f_nat_Hz,
    vibRatio,
    warnings,
  };
}

// ─── 4. PFD 열교환기 공정조건 자동 매핑 (Material Balance 연동) ───────
export function getHXProcessPreset(tag: string, streams: StreamData[]): Partial<HXDesignInputs> & {
  designTemp_C: number;
  designPress_kgcm2g: number;
  streamInfo: string;
} {
  const findStream = (id: string) => streams.find(s => s.id === id);
  const sL1  = findStream('L1');
  const sL2  = findStream('L2');
  const sL3  = findStream('L3');
  const sL4  = findStream('L4');
  const sL5  = findStream('L5');
  const sL7  = findStream('L7');
  const sL8  = findStream('L8');
  const sL9  = findStream('L9');
  const sL11 = findStream('L11');
  const sL12 = findStream('L12');
  const sL13 = findStream('L13');
  const sC1  = findStream('C1');
  const sC2  = findStream('C2');
  const sV3  = findStream('V3');
  const s401 = findStream('401');
  const s403 = findStream('403');
  const s405 = findStream('405');
  const s415 = findStream('415');
  const s221 = findStream('221');
  const s602 = findStream('602');
  const s608 = findStream('608');
  const s609 = findStream('609');
  const s610 = findStream('610');

  const normTag = tag.toUpperCase().trim();

  switch (normTag) {
    case 'E-332':
    case 'E-5332':
      return {
        tag: 'E-332', serviceName: '1st Preheater - NaOH (1효 가성소다 열회수 예열기 E-5332)', section: '300',
        dofMode: 'calc_mh',
        hotFluidKey: 'naoh_50', mh_kgh: Math.round(sL11?.total_kgh ?? 42824), Th_in_C: 164.8, Th_out_C: 120.0, Ph_kgcm2g: 2.5, hotCondensingFrac: 0,
        coldFluidKey: 'naoh_42', mc_kgh: Math.round(sL8?.total_kgh ?? (sL7?.total_kgh ?? 50896) * 0.755), Tc_in_C: 108.5, Tc_out_C: 156.2, Pc_kgcm2g: 2.8,
        n_shell: 1, n_passes: 4, do_mm: 19.05, tw_mm: 1.65, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00015, material: 'Nickel 200',
        designTemp_C: 190, designPress_kgcm2g: 6.0,
        streamInfo: `Hot [L11→L12] 50% NaOH (${Math.round(sL11?.total_kgh ?? 42824).toLocaleString()} kg/h, 164.8→120.0°C) | Cold [L8→L10] 42.1% NaOH (75.5% 분기, 108.5→156.2°C, Q=1,443,303 kcal/h, A=54 m²)`,
      };
    case 'E-333':
    case 'E-5333':
      return {
        tag: 'E-333', serviceName: '1st Preheater - Cond. (1효 응축수 열회수 예열기 E-5333)', section: '300',
        dofMode: 'calc_mh',
        hotFluidKey: 'condensate', mh_kgh: Math.round(sC1?.total_kgh ?? 10356), Th_in_C: 175.4, Th_out_C: 126.6, Ph_kgcm2g: 3.0, hotCondensingFrac: 0,
        coldFluidKey: 'naoh_42', mc_kgh: Math.round(sL9?.total_kgh ?? (sL7?.total_kgh ?? 50896) * 0.245), Tc_in_C: 108.5, Tc_out_C: 160.0, Pc_kgcm2g: 2.8,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00009, material: 'Nickel 200',
        designTemp_C: 200, designPress_kgcm2g: 6.0,
        streamInfo: `Hot [C1→C2] 1효 응축수 (${Math.round(sC1?.total_kgh ?? 10356).toLocaleString()} kg/h, 175.4→126.6°C) | Cold [L9→L10] 42.1% NaOH (24.5% 분기, 108.5→160.0°C, Q=505,327 kcal/h, A=14 m²)`,
      };
    case 'E-342':
    case 'E-5342':
      return {
        tag: 'E-342', serviceName: '2nd Preheater - NaOH (2효 가성소다 열회수 예열기 E-5342)', section: '300',
        dofMode: 'calc_mh',
        hotFluidKey: 'naoh_50', mh_kgh: Math.round(sL12?.total_kgh ?? 42824), Th_in_C: 120.0, Th_out_C: 75.0, Ph_kgcm2g: 2.2, hotCondensingFrac: 0,
        coldFluidKey: 'naoh_32', mc_kgh: Math.round(sL3?.total_kgh ?? (sL2?.total_kgh ?? 58866) * 0.755), Tc_in_C: 68.4, Tc_out_C: 108.2, Pc_kgcm2g: 2.5,
        n_shell: 1, n_passes: 4, do_mm: 19.05, tw_mm: 1.65, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00015, material: 'Nickel 200',
        designTemp_C: 150, designPress_kgcm2g: 5.0,
        streamInfo: `Hot [L12→L13] 50% NaOH (${Math.round(sL12?.total_kgh ?? 42824).toLocaleString()} kg/h, 120.0→75.0°C) | Cold [L3→L5] 36.4% NaOH (75.5% 분기, 68.4→108.2°C, Q=1,447,151 kcal/h, A=54 m²)`,
      };
    case 'E-343':
    case 'E-5343':
      return {
        tag: 'E-343', serviceName: '2nd Preheater - Cond. (2효 응축수 열회수 예열기 E-5343)', section: '300',
        dofMode: 'calc_mh',
        hotFluidKey: 'condensate', mh_kgh: Math.round(sC2?.total_kgh ?? 10356), Th_in_C: 126.6, Th_out_C: 74.7, Ph_kgcm2g: 2.5, hotCondensingFrac: 0,
        coldFluidKey: 'naoh_32', mc_kgh: Math.round(sL4?.total_kgh ?? (sL2?.total_kgh ?? 58866) * 0.245), Tc_in_C: 68.4, Tc_out_C: 114.0, Pc_kgcm2g: 2.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00009, material: 'Nickel 200',
        designTemp_C: 150, designPress_kgcm2g: 5.0,
        streamInfo: `Hot [C2→C3] 스팀 응축수 (${Math.round(sC2?.total_kgh ?? 10356).toLocaleString()} kg/h, 126.6→74.7°C) | Cold [L4→L5] 36.4% NaOH (24.5% 분기, 68.4→114.0°C, Q=537,525 kcal/h, A=20 m²)`,
      };
    case 'E-352':
    case 'E-5352':
      return {
        tag: 'E-352', serviceName: '50% NaOH Product Cooler (50% 가성소다 제품 냉각기 E-5352)', section: '300',
        dofMode: 'calc_mc',
        hotFluidKey: 'naoh_50', mh_kgh: Math.round(sL13?.total_kgh ?? sL12?.total_kgh ?? 42824), Th_in_C: 75.0, Th_out_C: 42.0, Ph_kgcm2g: 1.8, hotCondensingFrac: 0,
        coldFluidKey: 'cooling_water', mc_kgh: 132293, Tc_in_C: 32.0, Tc_out_C: 40.0, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00018, material: 'Nickel 200',
        designTemp_C: 100, designPress_kgcm2g: 5.0,
        streamInfo: `Hot [L13→L14] 50% NaOH (${Math.round(sL13?.total_kgh ?? 42824).toLocaleString()} kg/h, 75.0→42.0°C) | Cold CW (132,293 kg/h, 32→40°C, Q=1,058,342 kcal/h, A=20 m²)`,
      };
    case 'E-350':
    case 'E-5350':
    case 'E-360':
      return {
        tag: 'E-350', serviceName: 'Surface Condenser (3효 진공 표면응축기 E-5350)', section: '300',
        dofMode: 'calc_mc',
        hotFluidKey: 'steam_lp', mh_kgh: Math.round(sV3?.total_kgh ?? 8797), Th_in_C: 68.4, Th_out_C: 42.9, Ph_kgcm2g: -0.94, hotCondensingFrac: 0.98,
        coldFluidKey: 'cooling_water', mc_kgh: 626493, Tc_in_C: 32.0, Tc_out_C: 40.0, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.24, L_m: 6.0, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00009, material: 'SS 316L',
        designTemp_C: 90, designPress_kgcm2g: 4.0,
        streamInfo: `Vapor [V3] 3효 수증기 (${Math.round(sV3?.total_kgh ?? 8797).toLocaleString()} kg/h, 32"-V-316L, -0.94 kg/cm²G) | CW 626,493 kg/h (Q=5,011,944 kcal/h = 5,829 kW)`,
      };
    case 'E-413':
      return {
        tag: 'E-413', serviceName: 'Cl₂ Cooler 1 (염소 1차 냉각기 - CW)', section: '400',
        dofMode: 'calc_mc',
        hotFluidKey: 'cl2_wet', mh_kgh: Math.round(s401?.total_kgh ?? 19828), Th_in_C: 65, Th_out_C: 38, Ph_kgcm2g: 0.27, hotCondensingFrac: 0.45,
        coldFluidKey: 'cooling_water', mc_kgh: 145000, Tc_in_C: 30, Tc_out_C: 38, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.24, L_m: 5.0, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00018, rfs: 0.00018, material: 'Titanium Gr.2',
        designTemp_C: 85, designPress_kgcm2g: 3.0,
        streamInfo: `Stream [401→403] Wet Cl₂ (${Math.round(s401?.total_kgh ?? 19828).toLocaleString()} kg/h)`,
      };
    case 'E-423':
      return {
        tag: 'E-423', serviceName: 'Cl₂ Cooler 2 (염소 2차 냉각기 - 냉수)', section: '400',
        dofMode: 'calc_mc',
        hotFluidKey: 'cl2_wet', mh_kgh: Math.round(s403?.total_kgh ?? 19812), Th_in_C: 38, Th_out_C: 22, Ph_kgcm2g: 0.27, hotCondensingFrac: 0.25,
        coldFluidKey: 'chilled_water', mc_kgh: 85000, Tc_in_C: 10, Tc_out_C: 18, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.24, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00010, rfs: 0.00018, material: 'Titanium Gr.2',
        designTemp_C: 60, designPress_kgcm2g: 3.0,
        streamInfo: `Stream [403→405] Wet Cl₂ (${Math.round(s403?.total_kgh ?? 19812).toLocaleString()} kg/h, 38→22°C)`,
      };
    case 'E-433':
      return {
        tag: 'E-433', serviceName: 'Cl₂ Cooler 3 (염소 3차 냉각기 - 칠러)', section: '400',
        dofMode: 'calc_mc',
        hotFluidKey: 'cl2_wet', mh_kgh: Math.round(s405?.total_kgh ?? 19602), Th_in_C: 22, Th_out_C: 13, Ph_kgcm2g: 0.25, hotCondensingFrac: 0.12,
        coldFluidKey: 'chilled_water', mc_kgh: 48000, Tc_in_C: 5, Tc_out_C: 11, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.24, L_m: 4.0, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00010, rfs: 0.00015, material: 'Titanium Gr.2',
        designTemp_C: 50, designPress_kgcm2g: 3.0,
        streamInfo: `Stream [405] Wet Cl₂ 칠러냉각 (${Math.round(s405?.total_kgh ?? 19602).toLocaleString()} kg/h, 22→13°C)`,
      };
    case 'D-484':
      return {
        tag: 'D-484', serviceName: 'Cl₂ Liquefier (염소 냉동 액화기)', section: '400',
        dofMode: 'calc_mc',
        hotFluidKey: 'cl2_liq', mh_kgh: Math.round(s415?.total_kgh ?? 19510), Th_in_C: 40, Th_out_C: -22, Ph_kgcm2g: 3.0, hotCondensingFrac: 0.95,
        coldFluidKey: 'refrigerant', mc_kgh: 260000, Tc_in_C: -35, Tc_out_C: -27, Pc_kgcm2g: 4.0,
        n_shell: 1, n_passes: 4, do_mm: 19.05, tw_mm: 2.11, L_m: 6.0, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00010, rfs: 0.00015, material: 'CS (LTCS)',
        designTemp_C: 60, designPress_kgcm2g: 6.0,
        streamInfo: `Stream [415→418] Dry Cl₂ 액화 (${Math.round(s415?.total_kgh ?? 19510).toLocaleString()} kg/h, 40→-22°C)`,
      };
    case 'E-5613':
      return {
        tag: 'E-5613', serviceName: 'H₂ 1st Cooler - CW (수소 1차 냉각기)', section: '600',
        dofMode: 'calc_mc',
        hotFluidKey: 'h2_wet', mh_kgh: Math.round(s221?.total_kgh ?? 2024), Th_in_C: 90, Th_out_C: 41, Ph_kgcm2g: 0.21, hotCondensingFrac: 0.65,
        coldFluidKey: 'cooling_water', mc_kgh: 85000, Tc_in_C: 30, Tc_out_C: 38, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00018, rfs: 0.00010, material: 'SS 316L',
        designTemp_C: 110, designPress_kgcm2g: 3.0,
        streamInfo: `Stream [221→602] Wet H₂ (${Math.round(s221?.total_kgh ?? 2024).toLocaleString()} kg/h, 90→41°C)`,
      };
    case 'E-5630':
      return {
        tag: 'E-5630', serviceName: 'H₂ 2nd Cooler - CCW (수소 2차 냉각기)', section: '600',
        dofMode: 'calc_mc',
        hotFluidKey: 'h2_wet', mh_kgh: Math.round(s602?.total_kgh ?? 888), Th_in_C: 41, Th_out_C: 10, Ph_kgcm2g: 0.21, hotCondensingFrac: 0.35,
        coldFluidKey: 'chilled_water', mc_kgh: 25732, Tc_in_C: 7, Tc_out_C: 14, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00010, rfs: 0.00010, material: 'SS 316L',
        designTemp_C: 65, designPress_kgcm2g: 3.0,
        streamInfo: `Stream [602→603 / 612] H₂ 칠러냉각 (${Math.round(s602?.total_kgh ?? 888).toLocaleString()} kg/h, 41→10°C)`,
      };
    case 'E-5680':
      return {
        tag: 'E-5680', serviceName: 'H₂ Purif Cooler (고압 수소 정제 냉각기)', section: '600',
        dofMode: 'calc_mc',
        hotFluidKey: 'h2_gas', mh_kgh: Math.round(s608?.total_kgh ?? 565), Th_in_C: 95, Th_out_C: 10, Ph_kgcm2g: 23.0, hotCondensingFrac: 0,
        coldFluidKey: 'chilled_water', mc_kgh: 22000, Tc_in_C: 7, Tc_out_C: 15, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 2.11, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00010, rfs: 0.00009, material: 'SS 316L',
        designTemp_C: 120, designPress_kgcm2g: 28.0,
        streamInfo: `Stream [608→609] 고압 H₂ (${Math.round(s608?.total_kgh ?? 565).toLocaleString()} kg/h, 23 barG)`,
      };
    case 'E-5682':
      return {
        tag: 'E-5682', serviceName: 'H₂ After-cooler (수소 최종 후단 냉각기)', section: '600',
        dofMode: 'calc_mc',
        hotFluidKey: 'h2_gas', mh_kgh: Math.round(s610?.total_kgh ?? 550), Th_in_C: 80, Th_out_C: 40, Ph_kgcm2g: 23.0, hotCondensingFrac: 0,
        coldFluidKey: 'cooling_water', mc_kgh: 12000, Tc_in_C: 30, Tc_out_C: 36, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 2.11, L_m: 3.0, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00018, rfs: 0.00009, material: 'SS 316L',
        designTemp_C: 110, designPress_kgcm2g: 28.0,
        streamInfo: `Stream [610→611] 건조 H₂ 제품 (${Math.round(s610?.total_kgh ?? s609?.total_kgh ?? 550).toLocaleString()} kg/h, 80→40°C)`,
      };
    case 'E-102':
      return {
        tag: 'E-102', serviceName: 'DCH Reaction Effluent Cooler (글리세린 염소화 반응물 냉각기)', section: '100',
        dofMode: 'calc_mc',
        hotFluidKey: 'dch_13', mh_kgh: 16517, Th_in_C: 112, Th_out_C: 55, Ph_kgcm2g: 1.8, hotCondensingFrac: 0,
        coldFluidKey: 'cooling_water', mc_kgh: 48000, Tc_in_C: 30, Tc_out_C: 38, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 2.11, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00018, rfs: 0.00022, material: 'Hastelloy C-276',
        designTemp_C: 150, designPress_kgcm2g: 6.0,
        streamInfo: 'PLANT 04 [R-101→E-102] 글리세린 염소화 조 DCH 반응액 냉각 (16,517 kg/h, 112→55°C · CW)',
      };
    case 'E-301':
      return {
        tag: 'E-301', serviceName: 'Purified ECH Product Cooler (고순도 ECH 제품 냉각기)', section: '300',
        dofMode: 'calc_mc',
        hotFluidKey: 'ech_pure', mh_kgh: 8650, Th_in_C: 62, Th_out_C: 35, Ph_kgcm2g: 0.3, hotCondensingFrac: 0,
        coldFluidKey: 'cooling_water', mc_kgh: 16000, Tc_in_C: 28, Tc_out_C: 33, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 2.11, L_m: 3.6, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00015, rfs: 0.00012, material: 'SS 316L',
        designTemp_C: 110, designPress_kgcm2g: 4.5,
        streamInfo: 'PLANT 04 [C-102→E-301] 99.9% 에폭시급 ECH 제품 냉각 (8,650 kg/h, 62→35°C · CW)',
      };
    default:
      return {
        tag, serviceName: `${tag} 열교환기`, section: '300',
        dofMode: 'calc_mc',
        hotFluidKey: 'naoh_32', mh_kgh: Math.round(sL1?.total_kgh ?? 50000), Th_in_C: 85, Th_out_C: 45, Ph_kgcm2g: 3.0, hotCondensingFrac: 0,
        coldFluidKey: 'cooling_water', mc_kgh: 80000, Tc_in_C: 30, Tc_out_C: 38, Pc_kgcm2g: 3.5,
        n_shell: 1, n_passes: 2, do_mm: 19.05, tw_mm: 1.65, L_m: 4.5, layoutAngle: 30, baffleCutPct: 25, overdesignPct: 15,
        rft: 0.00018, rfs: 0.00018, material: 'Titanium Gr.2',
        designTemp_C: 110, designPress_kgcm2g: 5.0,
        streamInfo: '현재 공정 조건 기본값',
      };
  }
}

// ─── 5. PFD 패킹컬럼 공정조건 자동 매핑 (Material Balance 연동) ──────
export interface TowerProcessPreset {
  tag: string;
  serviceName: string;
  section: string;
  mode: TowerMode;
  temp_C: number;
  pressure_kPa: number;
  operPress_kgcm2g: string;
  designTemp_C: string;
  designPress_kgcm2g: string;
  material: string;
  gasFluidKey: string;
  gasFlow_kgh: number;
  liqFluidKey: string;
  liqFlow_kgh: number;
  packingKey: string;
  floodFrac: number;
  separationMode: 'stages' | 'kremser' | 'hog';
  stages: number;
  yIn: number;
  yOut: number;
  yEq?: number;
  absA: number;
  targetU_ms?: number;
  fixedZ_m?: number;
  streamInfo: string;
}

export function getTowerProcessPreset(tag: string, streams: StreamData[]): TowerProcessPreset {
  const findStream = (id: string) => streams.find(s => s.id === id);
  const s102 = findStream('102');
  const s218 = findStream('218');
  const s220 = findStream('220');
  const s221 = findStream('221');
  const s252 = findStream('252');
  const s401 = findStream('401');
  const s403 = findStream('403');
  const s405 = findStream('405');
  const s409 = findStream('409');
  const s411 = findStream('411');
  const s420 = findStream('420');

  const normTag = tag.toUpperCase().trim();

  switch (normTag) {
    case 'C-110':
    case 'C-110A':
    case 'C-110B': {
      return {
        tag: normTag, serviceName: 'Graphite Falling-Film HCl Absorber (흑연 강하막 염산 흡수탑 · 35% HCl)', section: '100',
        mode: 'absorption', temp_C: 45, pressure_kPa: 121.3,
        operPress_kgcm2g: '0.20', designTemp_C: '110', designPress_kgcm2g: '1.5',
        material: 'Impervious Graphite (함침 흑연 블록)',
        gasFluidKey: 'hcl_gas', gasFlow_kgh: 4200,
        liqFluidKey: 'hcl_31', liqFlow_kgh: 12000,
        packingKey: 'pall_50', floodFrac: 0.68,
        separationMode: 'stages', stages: 6, yIn: 0.96, yOut: 0.002, absA: 2.1,
        streamInfo: '합성 HCl 가스 (4,200 kg/h) + UPW/희박염산 (12,000 kg/h) → 35% 전자급 염산 흡수',
      };
    }
    case 'T-130': {
      return {
        tag: 'T-130', serviceName: 'Tail-Gas Alkali Scrubber (테일가스 알칼리 제해탑 · 20% NaOH)', section: '100',
        mode: 'scrubbing', temp_C: 35, pressure_kPa: 103.3,
        operPress_kgcm2g: '0.02', designTemp_C: '80', designPress_kgcm2g: '0.5',
        material: 'FRP + PVDF lining',
        gasFluidKey: 'hcl_gas', gasFlow_kgh: 1250,
        liqFluidKey: 'naoh_20', liqFlow_kgh: 8500,
        packingKey: 'tellerette_1b', floodFrac: 0.65,
        separationMode: 'stages', stages: 5, yIn: 0.035, yOut: 0.00001, absA: 2.5,
        streamInfo: '흡수탑 미응축 테일가스 (HCl/Cl₂ 미량) + 20 wt% NaOH 순환 세정액 (대기배출 <1 ppm)',
      };
    }
    case 'T-210':
    case 'T-210A': {
      return {
        tag: normTag, serviceName: '98% H₂SO₄ Dehydration Tower (황산 초정밀 제습탑 · 수분 <1 ppm)', section: '200',
        mode: 'absorption', temp_C: 25, pressure_kPa: 350.0,
        operPress_kgcm2g: '2.50', designTemp_C: '85', designPress_kgcm2g: '5.0',
        material: 'CS + PTFE lining',
        gasFluidKey: 'hcl_gas', gasFlow_kgh: 3800,
        liqFluidKey: 'h2so4_98', liqFlow_kgh: 2400,
        packingKey: 'pall_25', floodFrac: 0.65,
        separationMode: 'stages', stages: 6, yIn: 0.008, yOut: 0.000001, absA: 2.2,
        streamInfo: '습윤 HCl 가스 + 98 wt% 진한 황산 향류 제습 (출구 수분 < 1 ppmwt)',
      };
    }
    case 'C-220':
    case 'C-230':
    case 'C-230A': {
      return {
        tag: normTag, serviceName: '5N AHCl Stripping & Purification Column (5N 무수염산 정제탑)', section: '200',
        mode: 'stripping', temp_C: -22, pressure_kPa: 1860.0,
        operPress_kgcm2g: '17.6', designTemp_C: '40', designPress_kgcm2g: '25.0',
        material: 'SS316L / Monel 400 (저온 고압)',
        gasFluidKey: 'hcl_gas', gasFlow_kgh: 3600,
        liqFluidKey: 'hcl_31', liqFlow_kgh: 5200,
        packingKey: 'mellapak_250y', floodFrac: 0.72,
        separationMode: 'stages', stages: 23, yIn: 0.015, yOut: 0.00001, absA: 1.6,
        streamInfo: '17.6 kG 고압 저온 증류 · 탑정 경질분(O₂/N₂) 탈기 및 탑저 5N AHCl (99.999%) 생산',
      };
    }
    case 'C-310':
    case 'C-310A':
    case 'C-320':
    case 'C-320A': {
      const isVac = normTag.startsWith('C-310');
      return {
        tag: normTag,
        serviceName: isVac
          ? 'Spent HCl Vacuum Concentrator (폐염산 진공 농축탑 · 0.15 barA)'
          : 'Pressurized Azeotropic Stripper (가압 공비탈기 증류탑 · 7.0 barA)',
        section: '300',
        mode: 'stripping',
        temp_C: isVac ? 68 : 138,
        pressure_kPa: isVac ? 15.0 : 700.0,
        operPress_kgcm2g: isVac ? '-0.85' : '6.0',
        designTemp_C: isVac ? '110' : '180',
        designPress_kgcm2g: isVac ? '1.0' : '10.0',
        material: 'Impervious Graphite / PTFE-lined CS',
        gasFluidKey: 'hcl_gas', gasFlow_kgh: 2800,
        liqFluidKey: 'hcl_31', liqFlow_kgh: 9500,
        packingKey: 'pall_38', floodFrac: 0.70,
        separationMode: 'stages', stages: isVac ? 12 : 16, yIn: 0.18, yOut: 0.005, absA: 1.5,
        streamInfo: isVac
          ? '0.15 barA 진공 농축 (공비점 22.9% HCl) · 탑정 회수수 및 탑저 농축염산'
          : '7.0 barA 가압 공비깨기 (공비점 17.5% HCl) · 고순도 HCl 가스 회수',
      };
    }
    case 'T-410': {
      const gFlow = Math.round(s220?.total_kgh ?? 23496);
      const lFlow = Math.round(gFlow * 2.2); // L/G ≈ 2.2 수세 순환수
      return {
        tag: 'T-410', serviceName: '1st Cl₂ Wash Tower (염소가스 1차 수세/직접냉각탑)', section: '400',
        mode: 'scrubbing', temp_C: 58, pressure_kPa: 127.8,
        operPress_kgcm2g: '0.27', designTemp_C: '95', designPress_kgcm2g: '0.5',
        material: 'FRP+PVDF lining',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'process_water', liqFlow_kgh: lFlow,
        packingKey: 'pall_50', floodFrac: 0.70,
        separationMode: 'stages', stages: 4, yIn: 0.048, yOut: 0.005, absA: 1.8,
        streamInfo: `Gas [220→401] Wet Cl₂ (${gFlow.toLocaleString()} kg/h, 87→55°C) + 1차 순환 세정수 (${lFlow.toLocaleString()} kg/h, 브라인 미스트 제거)`,
      };
    }
    case 'T-420': {
      const gFlow = Math.round(s403?.total_kgh ?? 20100);
      const lFlow = Math.round(gFlow * 1.9); // 냉수 직접세정/냉각 순환유량
      return {
        tag: 'T-420', serviceName: '2nd Cl₂ Chilled Wash Tower (염소가스 2차 냉수세정/냉각탑)', section: '400',
        mode: 'scrubbing', temp_C: 24, pressure_kPa: 125.0,
        operPress_kgcm2g: '0.24', designTemp_C: '70', designPress_kgcm2g: '0.5',
        material: 'FRP+PVDF lining',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'process_water', liqFlow_kgh: lFlow,
        packingKey: 'pall_50', floodFrac: 0.70,
        separationMode: 'stages', stages: 4, yIn: 0.015, yOut: 0.0025, absA: 1.9,
        streamInfo: `Gas [403→405] Cl₂ (${gFlow.toLocaleString()} kg/h, 42→18°C) + 냉수 순환 세정액 (${lFlow.toLocaleString()} kg/h, 황산탑 유입 전 수분 응축)`,
      };
    }
    case 'T-430': {
      // 식염전해 프로세스 기술 표 1.39 No.1 건조탑 기준:
      // 60 wt% H2SO4 (14°C), Cl2 입구 21°C, 수분 20 -> 2 mg/L (y1=0.025 -> y2=0.00243, yi=0.00145)
      // L/G = 15.9 (L' = 41,160 kg/m²·h, G' = 2,620 kg/m²·h), U = 0.24 m/s, Z = 3.65 m, 1B 테라렛 (45×19mm)
      // N_OG = 3.18, H_OG = 1.1 m, K_Ga = 32 kmol-Cl2/m³·h
      const gFlow = Math.round(s405?.total_kgh ?? 19650);
      const lFlow = Math.round(gFlow * 15.71); // 표 1.39 기준 L/G = 41,160 / 2,620 = 15.71 (약 15.9)
      return {
        tag: 'T-430', serviceName: 'No.1 H₂SO₄ Drying Tower (황산 1차 건조탑 - 60wt% H₂SO₄ · 1B 테라렛)', section: '400',
        mode: 'absorption', temp_C: 14, pressure_kPa: 101.3,
        operPress_kgcm2g: '0.00 (대기압)', designTemp_C: '50', designPress_kgcm2g: '0.5',
        material: 'FRP+PVC/PVDF lining (1B Tellerette 45×19mm)',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'h2so4_60', liqFlow_kgh: lFlow,
        packingKey: 'tellerette_1b', floodFrac: 0.68,
        separationMode: 'hog', stages: 3.2,
        yIn: 0.025, yOut: 0.00243, yEq: 0.00145, absA: 2.2,
        targetU_ms: 0.24, fixedZ_m: 3.65,
        streamInfo: `[표 1.39 No.1 건조탑 기준] Cl₂ 입구 21°C (수분 20→2 mg/L, y₁=0.025→y₂=0.00243) + 60wt% H₂SO₄ (14°C, L/G=15.9) | U=0.24 m/s, Z=3.65 m, N_OG=3.18, H_OG=1.1 m, K_Ga=32`,
      };
    }
    case 'T-440': {
      // 식염전해 프로세스 기술 표 1.39 No.2 건조탑 기준:
      // 91 wt% H2SO4 (19°C), 수분 2 -> 0.9 mg/L (y1=0.00243 -> y2=0.0011, yi=6.3×10⁻⁵)
      // L/G = 7.7 (L' = 20,070 kg/m²·h, G' = 2,620 kg/m²·h), U = 0.24 m/s, Z = 3.65 m, 2B 라시히링 (50×50mm)
      // N_OG = 0.83, H_OG = 4.4 m, K_Ga = 8.4 kmol-Cl2/m³·h
      const gFlow = Math.round(s409?.total_kgh ?? 19530);
      const lFlow = Math.round(gFlow * 7.66); // 표 1.39 기준 L/G = 20,070 / 2,620 = 7.66 (약 7.7)
      return {
        tag: 'T-440', serviceName: 'No.2 H₂SO₄ Drying Tower (황산 2차 건조탑 - 91wt% H₂SO₄ · 2B 라시히링)', section: '400',
        mode: 'absorption', temp_C: 19, pressure_kPa: 101.3,
        operPress_kgcm2g: '0.00 (대기압)', designTemp_C: '50', designPress_kgcm2g: '0.5',
        material: 'FRP+PVDF lining (2B Raschig Ring 50×50mm)',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'h2so4_91', liqFlow_kgh: lFlow,
        packingKey: 'raschig_50', floodFrac: 0.68,
        separationMode: 'hog', stages: 0.83,
        yIn: 0.00243, yOut: 0.0011, yEq: 0.000063, absA: 2.4,
        targetU_ms: 0.24, fixedZ_m: 3.65,
        streamInfo: `[표 1.39 No.2 건조탑 기준] Cl₂ 수분 2→0.9 mg/L (y₁=0.00243→y₂=0.0011) + 91wt% H₂SO₄ (19°C, L/G=7.7) | U=0.24 m/s, Z=3.65 m, N_OG=0.83, H_OG=4.4 m, K_Ga=8.4`,
      };
    }
    case 'T-450': {
      // 식염전해 프로세스 기술 표 1.39 No.3 건조탑 기준:
      // 94~98 wt% H2SO4 (21°C), 수분 0.9 -> 0.06 mg/L (y1=0.0011 -> y2=7.8×10⁻⁵, yi=7×10⁻⁷)
      // L/G = 7.8 (L' = 20,410 kg/m²·h, G' = 2,620 kg/m²·h), U = 0.24 m/s, Z = 3.65 m, 1B 테라렛 (45×19mm)
      // N_OG = 2.64, H_OG = 1.4 m, K_Ga = 27 kmol-Cl2/m³·h
      const gFlow = Math.round(s411?.total_kgh ?? 19510);
      const lFlow = Math.round(gFlow * 7.79); // 표 1.39 기준 L/G = 20,410 / 2,620 = 7.79 (약 7.8)
      return {
        tag: 'T-450', serviceName: 'No.3 H₂SO₄ Drying Tower (황산 3차 최종 건조탑 - 94wt% H₂SO₄ · 1B 테라렛)', section: '400',
        mode: 'absorption', temp_C: 21, pressure_kPa: 101.3,
        operPress_kgcm2g: '0.00 (대기압)', designTemp_C: '50', designPress_kgcm2g: '0.5',
        material: 'CS+PTFE lining (1B Tellerette 45×19mm)',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'h2so4_94', liqFlow_kgh: lFlow,
        packingKey: 'tellerette_1b', floodFrac: 0.65,
        separationMode: 'hog', stages: 2.64,
        yIn: 0.0011, yOut: 0.000078, yEq: 0.0000007, absA: 2.8,
        targetU_ms: 0.24, fixedZ_m: 3.65,
        streamInfo: `[표 1.39 No.3 건조탑 기준] Cl₂ 수분 0.9→0.06 mg/L (y₁=0.0011→y₂=7.8×10⁻⁵) + 94wt% H₂SO₄ (21°C, L/G=7.8) | U=0.24 m/s, Z=3.65 m, N_OG=2.64, H_OG=1.4 m, K_Ga=27`,
      };
    }
    case 'T-610': {
      const gFlow = Math.round(s221?.total_kgh ?? 2024);
      const lFlow = 18500; // 수소가스 가성소다 미스트 제거 세정수 유량
      return {
        tag: 'T-610', serviceName: 'H₂ Caustic Removal Tower (수소가스 가성소다 제거 세정탑)', section: '600',
        mode: 'scrubbing', temp_C: 45, pressure_kPa: 125.0,
        operPress_kgcm2g: '0.24', designTemp_C: '110', designPress_kgcm2g: '2.0',
        material: 'SS 304L / SS 316L',
        gasFluidKey: 'h2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'process_water', liqFlow_kgh: lFlow,
        packingKey: 'pall_38', floodFrac: 0.65,
        separationMode: 'kremser', stages: 5, yIn: 0.0035, yOut: 0.000005, absA: 3.5,
        streamInfo: `Gas [221→601] Wet H₂ (${gFlow.toLocaleString()} kg/h, 88→38°C) + 순수 세정액 (${lFlow.toLocaleString()} kg/h, NaOH 미스트 3,500→<5 ppm 제거)`,
      };
    }
    case 'T-730': {
      const gFlow = Math.max(2500, Math.round((s420?.total_kgh ?? 450) * 6)); // Vent Cl2 / Hypo 제조 1차 타워
      const lFlow = Math.round(gFlow * 8.5);
      return {
        tag: 'T-730', serviceName: 'Hypo / Vent Cl₂ Tower 1단 (폐염소 제해 / 차아염소산 제조 1차 타워)', section: '400',
        mode: 'scrubbing', temp_C: 32, pressure_kPa: 105.0,
        operPress_kgcm2g: '0.04', designTemp_C: '75', designPress_kgcm2g: '1.0',
        material: 'FRP+PVC/PVDF lining (Titanium/CPVC Internals)',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'naoh_32', liqFlow_kgh: lFlow,
        packingKey: 'pall_50', floodFrac: 0.68,
        separationMode: 'kremser', stages: 6, yIn: 0.085, yOut: 0.0012, absA: 3.2,
        streamInfo: `Vent Cl₂ [420] (${gFlow.toLocaleString()} kg/h) + 18~20% NaOH 순환액 (${lFlow.toLocaleString()} kg/h) → 12% NaOCl(차아염소산소다) 제조 1단`,
      };
    }
    case 'T-760':
    case 'D-940': {
      const gFlow = Math.max(2200, Math.round((s420?.total_kgh ?? 411) * 5.5)); // Vent Cl2 / Hypo 제조 2차 테일가스 타워
      const lFlow = Math.round(gFlow * 7.5);
      return {
        tag: 'T-760', serviceName: 'Hypo / Vent Cl₂ Tower 2단 (폐염소 제해 / 차아염소산 제조 2차 최종 흡수탑)', section: '400',
        mode: 'scrubbing', temp_C: 28, pressure_kPa: 103.0,
        operPress_kgcm2g: '0.02', designTemp_C: '75', designPress_kgcm2g: '1.0',
        material: 'FRP+PVC/PVDF lining',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'naoh_32', liqFlow_kgh: lFlow,
        packingKey: 'pall_50', floodFrac: 0.65,
        separationMode: 'kremser', stages: 6, yIn: 0.0012, yOut: 0.000001, absA: 4.0,
        streamInfo: `Tail Gas [T-730→T-760] 잔류 Cl₂ (${gFlow.toLocaleString()} kg/h, 1,200→<1 ppm 대기배출 보증) + NaOH 순환 흡수액 (${lFlow.toLocaleString()} kg/h)`,
      };
    }
    case 'T-280': {
      const lFlow = Math.round(s218?.total_kgh ?? 165116);
      const gFlow = Math.max(450, Math.round((s252?.total_kgh ?? 142) * 4.5)); // 진공 수증기+Cl2 스트리핑 기상 유량
      return {
        tag: 'T-280', serviceName: 'Vacuum Dechlorination Tower (감압 탈염소탑)', section: '200',
        mode: 'stripping', temp_C: 86, pressure_kPa: 45.0,
        operPress_kgcm2g: '-0.55', designTemp_C: '95', designPress_kgcm2g: 'FV/1.0',
        material: 'Titanium Gr.2 / FRP+PVDF',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'anolyte', liqFlow_kgh: lFlow,
        packingKey: 'pall_50', floodFrac: 0.70,
        separationMode: 'stages', stages: 5, yIn: 0.005, yOut: 0.0001, absA: 1.6,
        streamInfo: `Liq [218→250] 탈염 브라인 (${lFlow.toLocaleString()} kg/h) → 진공 탈염소 Gas [252]`,
      };
    }
    case 'T-160': {
      const lFlow = Math.round((s102?.total_kgh ?? 238867) / 2); // 2기 병렬 운전 기준 1기당 유량
      return {
        tag: 'T-160', serviceName: 'Ion Exchange Resin Tower (이온교환수지탑)', section: '100',
        mode: 'absorption', temp_C: 65, pressure_kPa: 493.6,
        operPress_kgcm2g: '4.0', designTemp_C: '80', designPress_kgcm2g: '8.0',
        material: 'FRP+Rubber lining',
        gasFluidKey: 'n2_gas', gasFlow_kgh: 1200,
        liqFluidKey: 'brine_25', liqFlow_kgh: lFlow,
        packingKey: 'berl_25', floodFrac: 0.65,
        separationMode: 'stages', stages: 4, yIn: 0.001, yOut: 0.00001, absA: 2.0,
        streamInfo: `Stream [102→104] 정제 브라인 (${lFlow.toLocaleString()} kg/h per tower, SV 15 BV/h)`,
      };
    }
    case 'C-101': {
      return {
        tag: 'C-101',
        serviceName: 'ECH Light-Ends & Azeotropic Dehydration Column (저비점·수분 공비탈수탑)',
        section: '300',
        mode: 'stripping',
        temp_C: 68,
        pressure_kPa: 36.3,
        operPress_kgcm2g: '-0.65',
        designTemp_C: '130',
        designPress_kgcm2g: 'FV/3.5',
        material: 'SS 316L',
        gasFluidKey: 'cl2_gas',
        gasFlow_kgh: 2070,
        liqFluidKey: 'ech_pure',
        liqFlow_kgh: 8860,
        packingKey: 'mellapak_250y',
        floodFrac: 0.72,
        separationMode: 'stages',
        stages: 20,
        yIn: 0.032,
        yOut: 0.0005,
        absA: 1.5,
        streamInfo: 'PLANT 04 진공 -0.65 kG (36.3 kPa) · 20단 · R=2.2 · 탑정 DCP/H₂O 공비탈수 (디캔터)',
      };
    }
    case 'C-102': {
      return {
        tag: 'C-102',
        serviceName: 'ECH Final Vacuum Fractionator (ECH 제품 정제 진공증류탑 · 99.9%)',
        section: '300',
        mode: 'stripping',
        temp_C: 62,
        pressure_kPa: 11.1,
        operPress_kgcm2g: '-0.92',
        designTemp_C: '150',
        designPress_kgcm2g: 'FV/3.5',
        material: 'SS 316L',
        gasFluidKey: 'cl2_gas',
        gasFlow_kgh: 29450,
        liqFluidKey: 'ech_pure',
        liqFlow_kgh: 20800,
        packingKey: 'mellapak_250y',
        floodFrac: 0.72,
        separationMode: 'stages',
        stages: 26,
        yIn: 0.955,
        yOut: 0.001,
        absA: 1.4,
        streamInfo: 'PLANT 04 고진공 -0.92 kG (11.1 kPa / 85 Torr) · 26단 · R=2.4 · 탑정 99.9% 에폭시급 ECH',
      };
    }
    default: {
      const gFlow = Math.round(s401?.total_kgh ?? 15000);
      return {
        tag, serviceName: `${tag} 패킹컬럼`, section: '400',
        mode: 'absorption', temp_C: 30, pressure_kPa: 120.0,
        operPress_kgcm2g: '0.20', designTemp_C: '60', designPress_kgcm2g: '1.0',
        material: 'FRP+PVDF lining',
        gasFluidKey: 'cl2_gas', gasFlow_kgh: gFlow,
        liqFluidKey: 'process_water', liqFlow_kgh: Math.round(gFlow * 2.0),
        packingKey: 'pall_50', floodFrac: 0.70,
        separationMode: 'stages', stages: 5, yIn: 0.01, yOut: 0.0001, absA: 1.5,
        streamInfo: '현재 공정 조건 기본값',
      };
    }
  }
}

// ─── 6. PFD 펌프 공정조건 자동 매핑 (Material Balance 연동) ──────────
export interface PumpProcessPreset {
  tag: string;
  serviceName: string;
  section: string;
  fluidKey: string;
  temp_C: number;
  flow_m3h: number;
  flow_kgh: number;
  Ps_kPaG: number;
  Pd_kPaG: number;
  Hs_m: number;
  Hd_m: number;
  dnSuction: number;
  dnDischarge: number;
  material: string;
  streamInfo: string;
}

export function getPumpProcessPreset(tag: string, streams: StreamData[]): PumpProcessPreset {
  const findStream = (id: string) => streams.find(s => s.id === id);
  const norm = tag.toUpperCase().replace(/A\/B|C\/D/g, '').trim();

  const streamMap: Record<string, {
    streamId: string; fluidKey: string; Ps_kPaG: number; Pd_kPaG: number; Hs_m: number; Hd_m: number;
    dnSuc: number; dnDis: number; mat: string; name: string; sec: string;
    defaultFlowKgh?: number; defaultTempC?: number; defaultRho?: number; defaultStreamInfo?: string;
  }> = {
    'P-044': { streamId: '004', fluidKey: 'brine_25', Ps_kPaG: 10, Pd_kPaG: 340, Hs_m: 3.5, Hd_m: 12, dnSuc: 200, dnDis: 150, mat: '316L SS', name: '포화염수 이송펌프', sec: '100' },
    'P-033': { streamId: '013', fluidKey: 'brine_25', Ps_kPaG: 10, Pd_kPaG: 350, Hs_m: 3.5, Hd_m: 14, dnSuc: 200, dnDis: 150, mat: '316L SS', name: '반응 전 브라인 이송펌프', sec: '100' },
    'P-014': { streamId: '022', fluidKey: 'brine_25', Ps_kPaG: 10, Pd_kPaG: 350, Hs_m: 3.5, Hd_m: 15, dnSuc: 200, dnDis: 150, mat: '316L SS', name: '반응 후 브라인 이송펌프', sec: '100' },
    'P-154': { streamId: '102', fluidKey: 'brine_25', Ps_kPaG: 10, Pd_kPaG: 390, Hs_m: 3.0, Hd_m: 18, dnSuc: 200, dnDis: 150, mat: '316L SS', name: '침전 후 여과공급 펌프', sec: '100' },
    'P-084': { streamId: '104', fluidKey: 'brine_fed',Ps_kPaG: 15, Pd_kPaG: 440, Hs_m: 4.0, Hd_m: 20, dnSuc: 200, dnDis: 150, mat: 'Titanium Gr.2', name: '정제 브라인 전해조 공급펌프', sec: '100' },
    'P-244': { streamId: '201', fluidKey: 'brine_fed',Ps_kPaG: 20, Pd_kPaG: 390, Hs_m: 4.0, Hd_m: 16, dnSuc: 200, dnDis: 150, mat: 'Titanium Gr.2', name: '양극액 순환 펌프', sec: '200' },
    'P-254': { streamId: '217', fluidKey: 'naoh_32',  Ps_kPaG: 15, Pd_kPaG: 390, Hs_m: 4.0, Hd_m: 16, dnSuc: 250, dnDis: 200, mat: '316L SS / Ni', name: '음극액(32% NaOH) 순환펌프', sec: '200' },
    'P-284': { streamId: '219', fluidKey: 'naoh_32',  Ps_kPaG: 15, Pd_kPaG: 350, Hs_m: 3.5, Hd_m: 15, dnSuc: 125, dnDis: 100, mat: '316L SS', name: '32% NaOH 제품 이송펌프', sec: '200' },
    'P-264': { streamId: '218', fluidKey: 'anolyte',  Ps_kPaG: 20, Pd_kPaG: 320, Hs_m: 3.5, Hd_m: 14, dnSuc: 200, dnDis: 150, mat: 'Titanium Gr.2', name: '탈염소탑 공급 펌프', sec: '200' },
    'P-314': { streamId: '250', fluidKey: 'anolyte',  Ps_kPaG: 10, Pd_kPaG: 330, Hs_m: 3.5, Hd_m: 15, dnSuc: 200, dnDis: 150, mat: 'Titanium Gr.2', name: '탈염소 브라인 반송펌프', sec: '200' },
    'P-374': { streamId: '256', fluidKey: 'anolyte',  Ps_kPaG: 15, Pd_kPaG: 380, Hs_m: 4.0, Hd_m: 16, dnSuc: 200, dnDis: 150, mat: 'Titanium Gr.2', name: '희박 브라인 이송펌프', sec: '200' },
    'P-321': { streamId: 'L11', fluidKey: 'naoh_50',  Ps_kPaG: 70, Pd_kPaG: 380, Hs_m: 3.5, Hd_m: 16, dnSuc: 150, dnDis: 100, mat: 'Nickel 200', name: '1효 50% NaOH 배출/순환펌프 (4"-NA-B74)', sec: '300' },
    'P-331': { streamId: 'L7',  fluidKey: 'naoh_50',  Ps_kPaG: -65,Pd_kPaG: 320, Hs_m: 4.0, Hd_m: 18, dnSuc: 150, dnDis: 100, mat: 'Nickel 200', name: '2효 42.1% NaOH 이송/순환펌프 (4"-NA-B74)', sec: '300' },
    'P-341': { streamId: 'L2',  fluidKey: 'naoh_32',  Ps_kPaG: -92,Pd_kPaG: 280, Hs_m: 4.5, Hd_m: 18, dnSuc: 200, dnDis: 150, mat: 'Ni / 316L SS', name: '3효 36.4% NaOH 이송/순환펌프 (6"-NA-B74)', sec: '300' },
    'P-413': { streamId: '402', fluidKey: 'process_water', Ps_kPaG: 10, Pd_kPaG: 280, Hs_m: 3.0, Hd_m: 12, dnSuc: 100, dnDis: 80, mat: 'PVDF / Ti', name: '수세탑/건조탑 순환펌프', sec: '400' },
    'P-450': { streamId: '416', fluidKey: 'h2so4_98', Ps_kPaG: 15, Pd_kPaG: 370, Hs_m: 3.0, Hd_m: 15, dnSuc: 80,  dnDis: 65, mat: 'Alloy 20 / PTFE', name: '98% 황산 순환/공급펌프', sec: '400' },
    'P-494': { streamId: '421', fluidKey: 'cl2_gas',  Ps_kPaG: 290,Pd_kPaG: 650, Hs_m: 3.0, Hd_m: 12, dnSuc: 80,  dnDis: 50, mat: 'LTCS / Hast. C', name: '액화염소 이송펌프', sec: '400' },
    'P-496': { streamId: '425', fluidKey: 'cl2_gas',  Ps_kPaG: 290,Pd_kPaG: 1200,Hs_m: 3.0, Hd_m: 15, dnSuc: 80,  dnDis: 50, mat: 'LTCS / Hast. C', name: '액화염소 출하펌프', sec: '400' },
    'P-613': { streamId: '604', fluidKey: 'process_water', Ps_kPaG: 10, Pd_kPaG: 250, Hs_m: 2.5, Hd_m: 10, dnSuc: 50, dnDis: 40, mat: '316L SS', name: '수소 응축수 드레인펌프', sec: '600' },
    'P-101': {
      streamId: 'E-105', fluidKey: 'dch_13', Ps_kPaG: 160, Pd_kPaG: 320, Hs_m: 3.5, Hd_m: 14,
      dnSuc: 80, dnDis: 65, mat: 'Hastelloy C-276', name: 'DCH 반응액 이송 펌프 (100→200 Sec)', sec: '100',
      defaultFlowKgh: 16114, defaultTempC: 55, defaultRho: 1295,
      defaultStreamInfo: 'PLANT 04 [100→200 Sec] 조 DCH 반응액 이송 (16,114 kg/h = 12.4 m³/h @ 55°C)',
    },
    'P-301': {
      streamId: 'E-303', fluidKey: 'ech_pure', Ps_kPaG: -80, Pd_kPaG: 450, Hs_m: 3.0, Hd_m: 18,
      dnSuc: 65, dnDis: 50, mat: '316L SS', name: '고순도 ECH 제품 이송 펌프 (99.9%)', sec: '300',
      defaultFlowKgh: 8650, defaultTempC: 35, defaultRho: 1170,
      defaultStreamInfo: 'PLANT 04 [300 Sec] 99.9% 에폭시급 ECH 제품 이송 (8,650 kg/h = 7.4 m³/h @ 35°C)',
    },
  };

  const cfg = streamMap[norm];
  const st = cfg ? findStream(cfg.streamId) : undefined;
  const rho = st?.density_kgm3 && st.density_kgm3 > 100 ? st.density_kgm3 : (cfg?.defaultRho ?? 1170);
  const kgh = st?.total_kgh ?? cfg?.defaultFlowKgh ?? 180000;
  const m3h = Math.max(5, +(kgh / rho).toFixed(1));
  const temp = st?.temperature_C ?? cfg?.defaultTempC ?? 65;

  return {
    tag,
    serviceName: cfg?.name ?? `${tag} 펌프`,
    section: cfg?.sec ?? '100',
    fluidKey: cfg?.fluidKey ?? 'brine_25',
    temp_C: temp,
    flow_m3h: m3h,
    flow_kgh: Math.round(kgh),
    Ps_kPaG: cfg?.Ps_kPaG ?? 15,
    Pd_kPaG: cfg?.Pd_kPaG ?? 350,
    Hs_m: cfg?.Hs_m ?? 3.5,
    Hd_m: cfg?.Hd_m ?? 15,
    dnSuction: cfg?.dnSuc ?? 150,
    dnDischarge: cfg?.dnDis ?? 125,
    material: cfg?.mat ?? '316L SS',
    streamInfo: st
      ? `Stream [${st.id}] ${st.name} (${Math.round(kgh).toLocaleString()} kg/h = ${m3h} m³/h @ ${temp}°C)`
      : (cfg?.defaultStreamInfo ?? '공정 기본 유량 적용'),
  };
}

// ─── 7. ChemEngStudio Canvas 렌더러 (T-Q 프로파일 & CAD 블루프린트) ────
export function drawHXTQCanvas(canvas: HTMLCanvasElement | null, res: HXDesignResults) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#070d19';
  ctx.fillRect(0, 0, W, H);

  const pad = { l: 48, r: 28, t: 28, b: 34 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  // Grid
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    const x = pad.l + (pw * i) / 4;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
  }

  const Tmin = Math.min(res.Th_in_C, res.Th_out_C, res.Tc_in_C, res.Tc_out_C) - 8;
  const Tmax = Math.max(res.Th_in_C, res.Th_out_C, res.Tc_in_C, res.Tc_out_C) + 8;
  const mapY = (T: number) => pad.t + ph * (1 - (T - Tmin) / Math.max(1, Tmax - Tmin));

  const x0 = pad.l;
  const x1 = pad.l + pw;
  const yh0 = mapY(res.Th_in_C);
  const yh1 = mapY(res.Th_out_C);
  const yc0 = mapY(res.Tc_out_C); // 향류(Counter-current) 기준 좌측 = Tc_out
  const yc1 = mapY(res.Tc_in_C);  // 우측 = Tc_in

  // Driving force fill
  ctx.fillStyle = 'rgba(56,189,248,0.10)';
  ctx.beginPath();
  ctx.moveTo(x0, yh0); ctx.lineTo(x1, yh1);
  ctx.lineTo(x1, yc1); ctx.lineTo(x0, yc0);
  ctx.closePath(); ctx.fill();

  // Hot line
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x0, yh0); ctx.lineTo(x1, yh1); ctx.stroke();

  // Cold line
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x0, yc0); ctx.lineTo(x1, yc1); ctx.stroke();

  // Endpoints + Labels
  ctx.font = 'bold 11px Inter, monospace';
  ctx.fillStyle = '#fb7185';
  ctx.beginPath(); ctx.arc(x0, yh0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x1, yh1, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(`Th,in ${res.Th_in_C.toFixed(1)}°C`, x0 + 6, yh0 - 6);
  ctx.fillText(`Th,out ${res.Th_out_C.toFixed(1)}°C`, x1 - 85, yh1 - 6);

  ctx.fillStyle = '#38bdf8';
  ctx.beginPath(); ctx.arc(x0, yc0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x1, yc1, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(`Tc,out ${res.Tc_out_C.toFixed(1)}°C`, x0 + 6, yc0 + 14);
  ctx.fillText(`Tc,in ${res.Tc_in_C.toFixed(1)}°C`, x1 - 80, yc1 + 14);

  // Title & CMTD badge
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 10px Inter, sans-serif';
  ctx.fillText(`Q = ${res.Q_kW.toFixed(0)} kW  |  LMTD = ${res.lmtd_C.toFixed(1)}°C  |  Ft = ${res.Ft.toFixed(3)}  |  CMTD = ${res.CMTD_C.toFixed(1)}°C`, pad.l, 17);
  ctx.fillText('전열 진행률 (Q / Q_total) →', pad.l + pw / 2 - 55, H - 10);
}

export function drawHXBlueprintCanvas(canvas: HTMLCanvasElement | null, inp: HXDesignInputs, res: HXDesignResults) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Blueprint background & grid
  ctx.fillStyle = '#040a18';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(56,189,248,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Outer CAD frame
  ctx.strokeStyle = 'rgba(56,189,248,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  // Shell & Tube Elevation View (Left)
  const sx = 65, sy = 72, sw = 270, sh = 96;
  const cy = sy + sh / 2;

  // Front & Rear Heads
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.fillStyle = 'rgba(56,189,248,0.06)';
  ctx.fillRect(sx, sy, sw, sh);
  ctx.strokeRect(sx, sy, sw, sh);

  // Left Bonnet
  ctx.beginPath();
  ctx.arc(sx, cy, sh / 2, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill(); ctx.stroke();

  // Right Bonnet
  ctx.beginPath();
  ctx.arc(sx + sw, cy, sh / 2, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.fill(); ctx.stroke();

  // Tubesheets
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx + 10, sy - 5); ctx.lineTo(sx + 10, sy + sh + 5);
  ctx.moveTo(sx + sw - 10, sy - 5); ctx.lineTo(sx + sw - 10, sy + sh + 5);
  ctx.stroke();

  // Tube bundle lines
  ctx.strokeStyle = 'rgba(148,163,184,0.45)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 7; i++) {
    const ty = sy + (sh * i) / 8;
    ctx.beginPath(); ctx.moveTo(sx + 10, ty); ctx.lineTo(sx + sw - 10, ty); ctx.stroke();
  }

  // Segmental Baffles
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.6;
  const nBafDraw = Math.min(9, Math.max(3, res.N_baffles));
  for (let i = 1; i <= nBafDraw; i++) {
    const bx = sx + 18 + ((sw - 36) * i) / (nBafDraw + 1);
    ctx.beginPath();
    if (i % 2 === 1) {
      ctx.moveTo(bx, sy); ctx.lineTo(bx, sy + sh * 0.75);
    } else {
      ctx.moveTo(bx, sy + sh * 0.25); ctx.lineTo(bx, sy + sh);
    }
    ctx.stroke();
  }

  // Shell & Tube Nozzles
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  // N1 Shell In (Top Left)
  ctx.strokeRect(sx + 32, sy - 22, 14, 22);
  // N2 Shell Out (Bottom Right)
  ctx.strokeRect(sx + sw - 46, sy + sh, 14, 22);
  // N3 Tube In (Bottom Left Head)
  ctx.strokeRect(sx - 18, sy + sh - 6, 12, 20);
  // N4 Tube Out (Top Left Head)
  ctx.strokeRect(sx - 18, sy - 14, 12, 20);

  // Dimension Lines
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(`L = ${(inp.L_m * 1000).toFixed(0)} mm (${inp.n_passes} Pass)`, sx + sw / 2 - 55, sy + sh + 38);
  ctx.fillText(`Shell ID = ${res.D_shell_mm} mm`, sx + sw / 2 - 48, sy - 28);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(`Baffle B = ${res.B_spacing_mm.toFixed(0)} mm (${res.N_baffles}EA, Cut ${inp.baffleCutPct}%)`, sx + 30, sy + sh + 52);

  // Cross-Section A-A (Right)
  const cx = W - 95, rShell = 46;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, rShell, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(56,189,248,0.4)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(cx, cy, rShell - 6, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Tube pattern dots in Section A-A
  ctx.fillStyle = '#94a3b8';
  for (let dx = -30; dx <= 30; dx += 10) {
    for (let dy = -30; dy <= 30; dy += 10) {
      if (dx * dx + dy * dy <= 34 * 34) {
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 10px monospace';
  ctx.fillText('SECTION A-A', cx - 34, cy - rShell - 10);
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${res.N_tubes} Tubes (${inp.do_mm}mm)`, cx - 48, cy + rShell + 16);
  ctx.fillText(`Pitch ${inp.layoutAngle}° / ${inp.material}`, cx - 52, cy + rShell + 30);

  // Header Stamp
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`TEMA DWG: ${inp.tag || 'HX-001'}  |  A = ${res.A_prov_m2.toFixed(1)} m²  |  U = ${res.U_calc_Wm2K.toFixed(0)} W/m²K`, 18, 26);
}

export function drawTowerBlueprintCanvas(
  canvas: HTMLCanvasElement | null,
  info: {
    tag: string;
    D_m: number;
    Z_m: number;
    H_total_m: number;
    stages: number;
    HETP_m: number;
    packingName: string;
    floodPct: number;
    dP_mmH2O_m: number;
    material: string;
  }
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = 600;
  const H = 260;
  const dpr = typeof window !== 'undefined' ? Math.max(2, window.devicePixelRatio || 2) : 2;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#EFECE5';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  // Tower vertical body
  const tx = 110, ty = 45, tw = 74, th = 165;
  ctx.fillStyle = 'rgba(167,139,250,0.06)';
  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 2;
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeRect(tx, ty, tw, th);

  // Top & Bottom Ellipsoidal Heads
  ctx.beginPath(); ctx.arc(tx + tw / 2, ty, tw / 2, Math.PI, 0); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(tx + tw / 2, ty + th, tw / 2, 0, Math.PI); ctx.fill(); ctx.stroke();

  // Skirt Support
  ctx.beginPath();
  ctx.moveTo(tx + 6, ty + th + 12); ctx.lineTo(tx - 4, ty + th + 34);
  ctx.moveTo(tx + tw - 6, ty + th + 12); ctx.lineTo(tx + tw + 4, ty + th + 34);
  ctx.moveTo(tx - 12, ty + th + 34); ctx.lineTo(tx + tw + 12, ty + th + 34);
  ctx.stroke();

  // Cross-hatch Packing Bed inside tower
  const bx = tx + 6, by = ty + 28, bw = tw - 12, bh = th - 56;
  ctx.strokeStyle = 'rgba(56,189,248,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.save();
  ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  for (let d = -bh; d < bw + bh; d += 12) {
    ctx.beginPath(); ctx.moveTo(bx + d, by); ctx.lineTo(bx + d - bh, by + bh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + d, by); ctx.lineTo(bx + d + bh, by + bh); ctx.stroke();
  }
  ctx.restore();

  // Liquid distributor at top of packing
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tx - 24, by - 8); ctx.lineTo(tx + tw - 10, by - 8); ctx.stroke();

  // Gas inlet nozzle at bottom & Gas outlet at top
  ctx.strokeStyle = '#fbbf24';
  ctx.beginPath(); ctx.moveTo(tx - 24, ty + th - 14); ctx.lineTo(tx, ty + th - 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx + tw / 2, ty - tw / 2); ctx.lineTo(tx + tw / 2, ty - tw / 2 - 14); ctx.stroke();

  // Spec Callouts on Right
  const rx = 225;
  ctx.fillStyle = '#1A2F44';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`PACKED COLUMN CAD: ${info.tag || 'T-410'}`, rx, 42);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  const lines = [
    `• 탑 내경 (ID)     : ${(info.D_m * 1000).toFixed(0)} mm (${info.D_m.toFixed(2)} m)`,
    `• 패킹 충전 높이 Z : ${info.Z_m.toFixed(2)} m (N = ${info.stages.toFixed(1)} 단)`,
    `• 탑 총 높이 H_tot : ${info.H_total_m.toFixed(2)} m (HETP = ${info.HETP_m.toFixed(2)} m)`,
    `• 선정 패킹        : ${info.packingName}`,
    `• 운전 홍수율      : ${info.floodPct.toFixed(1)}% Flooding`,
    `• 단위 차압 ΔP/Z   : ${info.dP_mmH2O_m.toFixed(1)} mmH₂O/m`,
    `• 본체/라이닝 재질 : ${info.material}`,
  ];
  lines.forEach((ln, idx) => {
    ctx.fillStyle = idx < 3 ? '#1A2F44' : '#18181B';
    ctx.fillText(ln, rx, 70 + idx * 22);
  });
}

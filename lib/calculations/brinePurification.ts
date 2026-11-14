// =====================================================================
// 100 SEC — 브라인 정제 공정 핵심 3대 특화 장치 설계 엔진
//   1) T-030 (및 D-010) : 원염 용해 포화조 & 침전정제조 (Brine Saturator & Clarifier)
//   2) F-140 (구 F-150) : 캔들 타입 SS 제거용 카본/셀룰로오스 프리코트 브라인 필터 (Candle Precoat Brine Filter)
//   3) T-160            : 킬레이트 이온교환수지탑 (Chelating Ion Exchange Resin Tower — 2차 정제 & 재생 스케줄러)
//      * 제조사 기준: Lanxess Lewatit® MonoPlus TP 208 / TP 260, DuPont AmberLite™ IRC747 / IRC748, Purolite S930Plus
// =====================================================================

import type { StreamData } from './streams';

// ─────────────────────────────────────────────────────────────────────
// 1. T-030 / D-010 브라인 포화조 (Upflow Salt-Bed Brine Saturator & Clarifier)
// ─────────────────────────────────────────────────────────────────────

export interface SaturatorDesignInputs {
  tag: string;                    // 'T-030' | 'D-010'
  mode: 'upflow_saturator' | 'clarifier_settler';
  brineFlow_kgh: number;          // 정제/포화 브라인 유량 (kg/h, 기본 238,867 kg/h)
  brineDensity_kgm3: number;      // 포화 브라인 밀도 (kg/m³, 기본 1,195 kg/m³ @ 65~70°C)
  temp_C: number;                 // 운전 온도 (°C, 기본 68°C)
  inletNaCl_gL: number;           // 유입 희박염수 농도 (g/L, 기본 205 g/L)
  targetNaCl_gL: number;          // 목표 포화염수 농도 (g/L, 기본 310 g/L)
  upflowVel_mh: number;           // 상향류 설계 유속 LV (m/h, 포화조 7.5 m/h / 침전조 SLR 0.65 m/h)
  saltRetention_hr: number;       // 유효 원염 적재 체류시간 (hr, 기본 8.0 hr 원염 버퍼 / 액 체류시간 1.5 hr)
  saltBulkDensity_tm3: number;    // 원염 겉보기 밀도 (ton/m³, 기본 1.15 t/m³)
  coneAngle_deg: number;          // 하부 콘 각도 (°C, 기본 60° 포화조 / 15° 침전조)
  freeboard_m: number;            // 상부 여유고 및 위어 높이 (m, 기본 1.2 m)
  material: string;               // 'FRP (Vinyl Ester)' | 'CS + Epoxy/Rubber Lining' | 'Titanium Clad'
}

export interface SaturatorDesignResults {
  volFlow_m3h: number;            // 부피 유량 (m³/h)
  saltDissolveRate_th: number;    // 시간당 원염 용해 소비량 (ton/h)
  saltDissolveRate_td: number;    // 일일 원염 용해 소비량 (ton/day)
  crossArea_m2: number;           // 요구 단면적 A = Q / LV (m²)
  D_vessel_m: number;             // 포화조/침전조 내경 D (m)
  D_vessel_mm: number;            // 내경 (mm, 100mm 단위 표준화)
  actualUpflowVel_mh: number;     // 실제 상향류 유속 (m/h)
  saltBedVol_m3: number;          // 원염 충진층 부피 (m³)
  saltHoldup_ton: number;         // 탱크 내 원염 보유량 (ton)
  H_saltBed_m: number;            // 원염 충진층 높이 (m)
  H_clarification_m: number;      // 상부 청징(Clarification) 구간 높이 (m)
  H_cylinder_m: number;           // 직동부(Straight Shell) 높이 (m)
  H_cone_m: number;               // 하부 원추부(Cone) 높이 (m)
  H_total_m: number;              // 총 높이 (m)
  V_total_m3: number;             // 총 유효 용량 (m³)
  liquidRT_min: number;           // 액상 총 체류시간 (min)
  rakeMotor_kW: number;           // 교반/레이크 구동 모터 (kW, 침전조 모드 시)
  nozzleInlet_NPS: string;        // 하부 유입 배관 (ANSI NPS)
  nozzleOutlet_NPS: string;       // 상부 오버플로우 배관 (ANSI NPS)
  warnings: string[];
}

function selectAnsiPipeNPS(volFlow_m3h: number, targetVel_ms: number): string {
  const q_m3s = Math.max(1e-4, volFlow_m3h / 3600);
  const d_mm = Math.sqrt((4 * q_m3s) / (Math.PI * Math.max(0.3, targetVel_ms))) * 1000;
  const std = [
    { nps: '2"', id: 52.5 },
    { nps: '3"', id: 77.9 },
    { nps: '4"', id: 102.3 },
    { nps: '6"', id: 154.1 },
    { nps: '8"', id: 202.7 },
    { nps: '10"', id: 254.5 },
    { nps: '12"', id: 304.8 },
    { nps: '14"', id: 333.4 },
    { nps: '16"', id: 381.0 },
  ];
  const hit = std.find(s => s.id >= d_mm) ?? std[std.length - 1];
  return `NPS ${hit.nps} Sch 40`;
}

export function calcBrineSaturator(inp: SaturatorDesignInputs): SaturatorDesignResults {
  const rho = Math.max(1050, inp.brineDensity_kgm3 || 1195);
  const volFlow_m3h = +(inp.brineFlow_kgh / rho).toFixed(1);

  // 원염 용해량 (ton/h): (C_out - C_in) [g/L = kg/m³] * Q [m³/h] / 1000
  const dC_kgm3 = Math.max(5, inp.targetNaCl_gL - inp.inletNaCl_gL);
  const saltDissolveRate_th = +((volFlow_m3h * dC_kgm3) / 1000).toFixed(2);
  const saltDissolveRate_td = +(saltDissolveRate_th * 24).toFixed(1);

  const lv = Math.max(0.3, inp.upflowVel_mh || (inp.mode === 'upflow_saturator' ? 7.5 : 0.65));
  const crossArea_m2 = +(volFlow_m3h / lv).toFixed(2);
  const d_calc_m = Math.sqrt((4 * crossArea_m2) / Math.PI);
  const D_vessel_mm = Math.max(2400, Math.ceil((d_calc_m * 1000) / 200) * 200);
  const D_vessel_m = +(D_vessel_mm / 1000).toFixed(2);
  const actualArea_m2 = (Math.PI * D_vessel_m * D_vessel_m) / 4;
  const actualUpflowVel_mh = +(volFlow_m3h / actualArea_m2).toFixed(2);

  let saltBedVol_m3 = 0;
  let saltHoldup_ton = 0;
  let H_saltBed_m = 0;
  let H_clarification_m = 0;
  let rakeMotor_kW = 0;

  if (inp.mode === 'upflow_saturator') {
    saltHoldup_ton = +(saltDissolveRate_th * Math.max(2.0, inp.saltRetention_hr)).toFixed(1);
    saltBedVol_m3 = +(saltHoldup_ton / Math.max(0.9, inp.saltBulkDensity_tm3)).toFixed(1);
    H_saltBed_m = +Math.max(2.2, saltBedVol_m3 / actualArea_m2).toFixed(2);
    H_clarification_m = 2.4; // 상부 포화염수 청징 영역
    rakeMotor_kW = 0;
  } else {
    // 중력 침전조(Clarifier) 모드
    saltHoldup_ton = +(volFlow_m3h * 0.0015 * Math.max(2.0, inp.saltRetention_hr)).toFixed(2);
    H_saltBed_m = 1.2; // 하부 슬러지 농축층
    H_clarification_m = +Math.max(3.2, (volFlow_m3h * 2.5) / actualArea_m2).toFixed(2);
    rakeMotor_kW = D_vessel_m >= 18 ? 5.5 : D_vessel_m >= 12 ? 3.7 : 2.2;
  }

  const H_cylinder_m = +(H_saltBed_m + H_clarification_m + Math.max(0.6, inp.freeboard_m)).toFixed(2);
  const coneRad = (Math.max(10, Math.min(70, inp.coneAngle_deg)) * Math.PI) / 180;
  const H_cone_m = inp.mode === 'upflow_saturator'
    ? +((D_vessel_m / 2) * Math.tan(coneRad) * 0.65).toFixed(2)
    : +((D_vessel_m / 2) * Math.tan((15 * Math.PI) / 180)).toFixed(2);
  const H_total_m = +(H_cylinder_m + H_cone_m).toFixed(2);

  const V_cyl = actualArea_m2 * (H_saltBed_m + H_clarification_m);
  const V_cone = (actualArea_m2 * H_cone_m) / 3;
  const V_total_m3 = +(V_cyl + V_cone).toFixed(1);
  const liquidRT_min = +((V_total_m3 / Math.max(1, volFlow_m3h)) * 60).toFixed(1);

  const nozzleInlet_NPS = selectAnsiPipeNPS(volFlow_m3h, 1.8);
  const nozzleOutlet_NPS = selectAnsiPipeNPS(volFlow_m3h, 1.1);

  const warnings: string[] = [];
  if (inp.mode === 'upflow_saturator' && actualUpflowVel_mh > 12.0) {
    warnings.push(`[주의] 상향류 유속(${actualUpflowVel_mh} m/h)이 12 m/h를 초과하여 미세 원염 입자(Crystal Carry-over)가 오버플로우될 수 있습니다.`);
  }
  if (inp.mode === 'upflow_saturator' && H_saltBed_m < 2.0) {
    warnings.push(`[권고] 포화도(305~310 g/L) 달성을 위해 최소 원염 충진층 높이(H_bed ≥ 2.2 m) 확보를 권장합니다.`);
  }
  if (inp.mode === 'clarifier_settler' && actualUpflowVel_mh > 1.2) {
    warnings.push(`[주의] 침전조 표면부하율(SLR=${actualUpflowVel_mh} m³/m²·h)이 높아 CaCO₃/Mg(OH)₂ 플록 월류 위험이 있습니다. (권장 0.5~1.0 m/h)`);
  }

  return {
    volFlow_m3h,
    saltDissolveRate_th,
    saltDissolveRate_td,
    crossArea_m2,
    D_vessel_m,
    D_vessel_mm,
    actualUpflowVel_mh,
    saltBedVol_m3,
    saltHoldup_ton,
    H_saltBed_m,
    H_clarification_m,
    H_cylinder_m,
    H_cone_m,
    H_total_m,
    V_total_m3,
    liquidRT_min,
    rakeMotor_kW,
    nozzleInlet_NPS,
    nozzleOutlet_NPS,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. F-140 (구 F-150) 캔들 타입 프리코트 카본 브라인 필터 (Candle Precoat Filter)
// ─────────────────────────────────────────────────────────────────────

export interface CandleFilterDesignInputs {
  tag: string;                    // 'F-140'
  brineFlow_kgh: number;          // 여과 브라인 총 유량 (kg/h, 기본 238,867 kg/h)
  brineDensity_kgm3: number;      // 브라인 밀도 (kg/m³, 기본 1,195 kg/m³)
  temp_C: number;                 // 운전 온도 (°C, 기본 65°C)
  inletSS_ppm: number;            // 유입 부유물(SS) 농도 (ppm, 침전조 상등액 기본 15~25 ppm)
  outletSS_ppm: number;           // 목표 여과 후 SS 농도 (ppm, 기본 0.3 ppm 이하)
  filtrationFlux_mh: number;      // 설계 여과 유속 Flux (m³/m²·h, 캔들 프리코트 표준 1.0 ~ 1.6 m/h)
  candleOD_mm: number;            // 캔들 엘리먼트 외경 (60 | 70 | 89 mm)
  candleLength_mm: number;        // 캔들 유효 길이 (1200 | 1500 | 1800 mm)
  candlePitch_mm: number;         // 캔들 간 중심 피치 (표준 115 ~ 135 mm)
  nOperatingUnits: number;        // 상시 운전 기수 (기본 2기)
  nStandbyUnits: number;          // 예비/재생 대기 기수 (기본 1기 -> 2+1 구성)
  precoatDosage_kgm2: number;     // α-Cellulose + 분말활성탄(PAC) 프리코트 도포량 (kg/m², 표준 0.8 kg/m²)
  bodyFeedRatio_ppm: number;      // 연속 바디피드(Body-feed) 주입율 (ppm, 표준 10 ppm)
  maxCakeThickness_mm: number;    // 허용 최대 케이크 두께 (mm, 표준 18 mm)
  material: string;               // 'CS + ePTFE/Rubber Lining (Candle: PVDF/PP)' | 'Titanium Gr.2'
}

export interface CandleFilterDesignResults {
  volFlowTotal_m3h: number;       // 전체 브라인 유량 (m³/h)
  volFlowPerUnit_m3h: number;     // 운전 1기당 처리 유량 (m³/h)
  totalAreaReq_m2: number;        // 전체 요구 여과면적 (m²)
  areaPerCandle_m2: number;       // 캔들 1본당 여과면적 (m²)
  candlesPerUnit: number;         // 베셀 1기당 캔들 수량 (EA, 6각 대칭 배열 표준화)
  areaPerUnit_m2: number;         // 베셀 1기당 실제 여과면적 (m²)
  totalAreaProv_m2: number;       // 상시 운전 기수 총 제공 여과면적 (m²)
  actualFlux_mh: number;          // 실제 운전 여과 유속 (m³/m²·h)
  D_vessel_mm: number;            // 필터 베셀 내경 (mm)
  H_vessel_mm: number;            // 필터 베셀 직동부+콘 총 높이 (mm)
  ssRemoved_kgh: number;          // 시간당 포집 SS 질량 (kg/h)
  precoatPerCycle_kg: number;     // 1기 1회 코팅당 프리코트제(Cellulose+Carbon) 소요량 (kg/batch)
  precoatPumpFlow_m3h: number;    // 프리코트 순환 펌프 요구 유량 (m³/h @ 2.8 m/h)
  filtrationCycle_hr: number;     // 케이크 한계 두께/차압 도달 여과 주기 (hr)
  dP_initial_bar: number;         // 초기 청정 프리코트 차압 (bar)
  dP_terminal_bar: number;        // 말기 역세 시점 최대 차압 (bar)
  backwashWater_m3: number;       // 1회 역세(Cake Discharge & Flush) 소요 수량 (m³/batch)
  nozzleInOut_NPS: string;        // 브라인 입출구 배관 규격 (ANSI NPS)
  warnings: string[];
}

export function calcCandleBrineFilter(inp: CandleFilterDesignInputs): CandleFilterDesignResults {
  const rho = Math.max(1050, inp.brineDensity_kgm3 || 1195);
  const volFlowTotal_m3h = +(inp.brineFlow_kgh / rho).toFixed(1);
  const nOp = Math.max(1, Math.round(inp.nOperatingUnits || 2));
  const volFlowPerUnit_m3h = +(volFlowTotal_m3h / nOp).toFixed(1);

  const flux = Math.max(0.5, inp.filtrationFlux_mh || 1.25);
  const totalAreaReq_m2 = +(volFlowTotal_m3h / flux).toFixed(1);
  const areaReqPerUnit = totalAreaReq_m2 / nOp;

  const do_m = Math.max(0.05, (inp.candleOD_mm || 70) / 1000);
  const L_m = Math.max(1.0, (inp.candleLength_mm || 1500) / 1000);
  const areaPerCandle_m2 = +(Math.PI * do_m * L_m).toFixed(3);

  // 캔들 수량 산출 (6배수 대칭 튜브시트 배열)
  const rawCandles = Math.ceil(areaReqPerUnit / areaPerCandle_m2);
  const candlesPerUnit = Math.max(18, Math.ceil(rawCandles / 6) * 6);
  const areaPerUnit_m2 = +(candlesPerUnit * areaPerCandle_m2).toFixed(1);
  const totalAreaProv_m2 = +(areaPerUnit_m2 * nOp).toFixed(1);
  const actualFlux_mh = +(volFlowTotal_m3h / totalAreaProv_m2).toFixed(2);

  // 베셀 내경 산출 (삼각 배열 피치 기준: D_bundle ≈ pitch * sqrt(N / 0.78) + 여유 250mm)
  const pitch_m = Math.max(do_m + 0.035, (inp.candlePitch_mm || 120) / 1000);
  const D_bundle_m = pitch_m * Math.sqrt(candlesPerUnit / 0.75);
  const D_vessel_mm = Math.max(900, Math.ceil(((D_bundle_m + 0.26) * 1000) / 100) * 100);
  const H_vessel_mm = Math.round((L_m + 1.65) * 1000); // 상부 헤드(플레넘) + 캔들 길이 + 하부 슬러지 배출 콘

  // SS 포집량 및 여과 주기 계산
  const dSS_ppm = Math.max(1.0, inp.inletSS_ppm - inp.outletSS_ppm);
  const ssRemoved_kgh = +((inp.brineFlow_kgh * dSS_ppm) / 1e6).toFixed(2);
  const bodyFeed_kgh = +((inp.brineFlow_kgh * Math.max(0, inp.bodyFeedRatio_ppm)) / 1e6).toFixed(2);
  const totalSolidsRate_kgh = ssRemoved_kgh + bodyFeed_kgh;

  // 습윤 케이크 밀도 ~ 420 kg-dry/m³ 기준 케이크 성장 속도
  const rhoCakeDry_kgm3 = 420;
  const maxCake_m = Math.max(0.008, (inp.maxCakeThickness_mm || 18) / 1000);
  const maxCakeVol_m3 = totalAreaProv_m2 * maxCake_m;
  const maxCakeMass_kg = maxCakeVol_m3 * rhoCakeDry_kgm3;
  const filtrationCycle_hr = +Math.min(96, Math.max(8, maxCakeMass_kg / Math.max(0.2, totalSolidsRate_kgh))).toFixed(1);

  const precoatPerCycle_kg = +(areaPerUnit_m2 * Math.max(0.4, inp.precoatDosage_kgm2 || 0.8)).toFixed(1);
  const precoatPumpFlow_m3h = +(areaPerUnit_m2 * 2.8).toFixed(1); // 프리코트 시 2.8 m³/m²·h 순환 권장

  const dP_initial_bar = +(0.18 + 0.08 * actualFlux_mh).toFixed(2);
  const dP_terminal_bar = +(dP_initial_bar + 1.65 * (inp.maxCakeThickness_mm / 18)).toFixed(2);
  const backwashWater_m3 = +(areaPerUnit_m2 * 0.065).toFixed(2);
  const nozzleInOut_NPS = selectAnsiPipeNPS(volFlowPerUnit_m3h, 1.6);

  const warnings: string[] = [];
  if (actualFlux_mh > 1.8) {
    warnings.push(`[주의] 실제 여과 유속(${actualFlux_mh} m/h)이 1.8 m/h를 초과하여 미세 Ca/Mg 플록이 프리코트층을 관통(Breakthrough)할 수 있습니다.`);
  }
  if (inp.candlePitch_mm - inp.candleOD_mm < 2 * inp.maxCakeThickness_mm + 10) {
    warnings.push(`[경고] 캔들 간격(${inp.candlePitch_mm - inp.candleOD_mm} mm)이 양면 최대 케이크 두께(${2 * inp.maxCakeThickness_mm} mm)보다 좁아 케이크 브리징(Cake Bridging) 위험이 있습니다!`);
  }

  return {
    volFlowTotal_m3h,
    volFlowPerUnit_m3h,
    totalAreaReq_m2,
    areaPerCandle_m2,
    candlesPerUnit,
    areaPerUnit_m2,
    totalAreaProv_m2,
    actualFlux_mh,
    D_vessel_mm,
    H_vessel_mm,
    ssRemoved_kgh,
    precoatPerCycle_kg,
    precoatPumpFlow_m3h,
    filtrationCycle_hr,
    dP_initial_bar,
    dP_terminal_bar,
    backwashWater_m3,
    nozzleInOut_NPS,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 3. T-160 킬레이트 이온교환수지탑 (Chelating Ion Exchange Resin Tower)
//    • 제조사 카탈로그 DB + 재생 주기(Regeneration Cycle)별 유량·시간 스케줄러
// ─────────────────────────────────────────────────────────────────────

export interface ChelatingResinSpec {
  key: string;
  maker: string;
  model: string;
  functionalGroup: 'IDA (Iminodiacetic)' | 'AMPA (Aminomethylphosphonic)';
  totalCapacity_eqL: number;      // 제조사 총 교환용량 (eq/L, Na-form)
  operCapacity_eqL: number;       // 300 g/L 염수 내 실운전 유효 교환용량 (eq/L, Ca/Mg/Sr 합산 기준)
  recSV_min_bvh: number;          // 권장 최소 공간속도 (BV/h)
  recSV_max_bvh: number;          // 권장 최대 공간속도 (BV/h)
  maxLV_mh: number;               // 최대 허용 선속도 (m/h)
  minBedDepth_m: number;          // 최소 권장 수지층 높이 (m)
  swellingNaPct: number;          // H+ → Na+ 전환 시 부피 팽창률 (%)
  hclDosage_gL: number;           // 100% HCl 기준 권장 재생제량 (g/L-resin)
  hclConc_wtPct: number;          // 재생 HCl 농도 (wt%)
  hclSV_bvh: number;              // HCl 주입 공간속도 (BV/h)
  naohDosage_gL: number;          // 100% NaOH 기준 컨디셔닝 약품량 (g/L-resin)
  naohConc_wtPct: number;         // 컨디셔닝 NaOH 농도 (wt%)
  naohSV_bvh: number;             // NaOH 주입 공간속도 (BV/h)
  notes: string;
}

export const CHELATING_RESIN_DB: ChelatingResinSpec[] = [
  {
    key: 'lewatit_tp208',
    maker: 'Lanxess (독일)',
    model: 'Lewatit® MonoPlus TP 208',
    functionalGroup: 'IDA (Iminodiacetic)',
    totalCapacity_eqL: 2.20,
    operCapacity_eqL: 0.52,
    recSV_min_bvh: 15,
    recSV_max_bvh: 30,
    maxLV_mh: 35,
    minBedDepth_m: 1.5,
    swellingNaPct: 28,
    hclDosage_gL: 120,
    hclConc_wtPct: 4.5,
    hclSV_bvh: 3.0,
    naohDosage_gL: 110,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    notes: '단분산(Monodisperse) IDA 수지 — Ca/Mg/Ba 제거 표준, 압력손실 낮음',
  },
  {
    key: 'lewatit_tp260',
    maker: 'Lanxess (독일)',
    model: 'Lewatit® MonoPlus TP 260',
    functionalGroup: 'AMPA (Aminomethylphosphonic)',
    totalCapacity_eqL: 1.80,
    operCapacity_eqL: 0.45,
    recSV_min_bvh: 15,
    recSV_max_bvh: 28,
    maxLV_mh: 35,
    minBedDepth_m: 1.5,
    swellingNaPct: 25,
    hclDosage_gL: 135,
    hclConc_wtPct: 5.0,
    hclSV_bvh: 2.5,
    naohDosage_gL: 115,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    notes: '단분산 AMPA 수지 — Sr²⁺(스트론튬) 및 Ca²⁺ 선택성이 극대화됨',
  },
  {
    key: 'amberlite_irc747',
    maker: 'DuPont (구 Rohm & Haas)',
    model: 'AmberLite™ IRC747 UPS',
    functionalGroup: 'AMPA (Aminomethylphosphonic)',
    totalCapacity_eqL: 1.75,
    operCapacity_eqL: 0.44,
    recSV_min_bvh: 15,
    recSV_max_bvh: 30,
    maxLV_mh: 32,
    minBedDepth_m: 1.4,
    swellingNaPct: 26,
    hclDosage_gL: 130,
    hclConc_wtPct: 4.5,
    hclSV_bvh: 3.0,
    naohDosage_gL: 110,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    notes: '균일입도(UPS) AMPA 킬레이트 수지 — 전해조 멤브레인 보호용 초저농도(<15 ppb) 달성',
  },
  {
    key: 'amberlite_irc748',
    maker: 'DuPont (구 Rohm & Haas)',
    model: 'AmberLite™ IRC748',
    functionalGroup: 'IDA (Iminodiacetic)',
    totalCapacity_eqL: 1.95,
    operCapacity_eqL: 0.48,
    recSV_min_bvh: 15,
    recSV_max_bvh: 25,
    maxLV_mh: 30,
    minBedDepth_m: 1.4,
    swellingNaPct: 30,
    hclDosage_gL: 115,
    hclConc_wtPct: 4.0,
    hclSV_bvh: 3.0,
    naohDosage_gL: 105,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    notes: '고용량 IDA 킬레이트 수지 — 범용 클로르알칼리 2차 정제 표준',
  },
  {
    key: 'purolite_s930',
    maker: 'Purolite (Ecolab)',
    model: 'Purolite® S930Plus',
    functionalGroup: 'IDA (Iminodiacetic)',
    totalCapacity_eqL: 2.00,
    operCapacity_eqL: 0.48,
    recSV_min_bvh: 12,
    recSV_max_bvh: 25,
    maxLV_mh: 30,
    minBedDepth_m: 1.4,
    swellingNaPct: 28,
    hclDosage_gL: 120,
    hclConc_wtPct: 4.5,
    hclSV_bvh: 3.0,
    naohDosage_gL: 110,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    notes: '거대기공(Macroporous) IDA 수지 — 삼투압 충격 저항성 우수',
  },
];

export interface RegenerationStep {
  stepNo: number;
  stepName: string;
  fluidName: string;
  sv_bvh: number;                 // 공간속도 (BV/h)
  bedVolumes_BV: number;          // 총 주입 Bed Volume (BV)
  flowRate_m3h: number;           // 재생 유량 (m³/h)
  duration_min: number;           // 단계 소요 시간 (min)
  totalVolume_m3: number;         // 본 단계 총 유체 소비량 (m³/회)
  chemPureMass_kg: number;        // 100% 기준 순수 약품 질량 (kg/회, 해당 시)
  chemCommercial_kg: number;      // 공업용 원액(35% HCl / 32% NaOH) 소비량 (kg/회)
  notes: string;
}

export interface IonExchangeDesignInputs {
  tag: string;                    // 'T-160'
  resinKey: string;               // CHELATING_RESIN_DB.key
  configMode: 'lead_lag_2' | 'carousel_3'; // '1+1 (Lead-Lag 2탑)' | '2+1 (Lead-Lag + 1 재생대기 = 3탑)'
  brineFlow_kgh: number;          // 정제 브라인 총 유량 (kg/h, 기본 238,867 kg/h)
  brineDensity_kgm3: number;      // 브라인 밀도 (kg/m³, 기본 1,195 kg/m³)
  temp_C: number;                 // 운전 온도 (°C, 표준 60 ~ 65°C)
  pH_in: number;                  // 유입 브라인 pH (표준 9.5 ~ 10.5)
  // 유입 2가 양이온 불순물 농도 (mg/L = ppm)
  inletCa_ppm: number;            // Ca²⁺ (기본 2.5 ppm)
  inletMg_ppm: number;            // Mg²⁺ (기본 0.5 ppm)
  inletSr_ppm: number;            // Sr²⁺ (기본 0.8 ppm)
  inletBa_ppm: number;            // Ba²⁺ (기본 0.3 ppm)
  targetOutletTotal_ppb: number;  // 목표 출구 Ca+Mg 합계 농도 (ppb, 기본 < 20 ppb)
  // 운전 및 재생 주기 설정
  designSV_bvh: number;           // 설계 공간속도 SV (BV/h, 제조사 표준 18 ~ 24 BV/h)
  targetCycleHours: number;       // 목표 재생 주기 (hr, 기본 24 또는 36 hr)
  designLV_mh: number;            // 목표 선속도 LV (m/h, 기본 22 ~ 28 m/h)
  freeboardPct: number;           // 역세 팽창 여유율 (%, 제조사 권장 60 ~ 75%)
  // 재생 파라미터 커스텀 가능
  hclDosage_gL: number;           // 100% HCl 재생제량 (g/L-resin, 기본 120)
  hclConc_wtPct: number;          // 희석 HCl 농도 (wt%, 기본 4.5%)
  hclSV_bvh: number;              // HCl 주입 SV (BV/h, 기본 3.0)
  naohDosage_gL: number;          // 100% NaOH 컨디셔닝량 (g/L-resin, 기본 110)
  naohConc_wtPct: number;         // 희석 NaOH 농도 (wt%, 기본 4.0%)
  naohSV_bvh: number;             // NaOH 주입 SV (BV/h, 기본 3.0)
  backwashLV_mh: number;          // 역세 유속 (m/h, 기본 8.0 m/h)
  backwashMin: number;            // 역세 시간 (min, 기본 25 min)
  rinseBV: number;                // 1차/2차 각각 세정수량 (BV, 기본 4.0 BV)
  rinseSV_bvh: number;            // 세정 공간속도 (BV/h, 기본 6.0 BV/h)
}

export interface IonExchangeDesignResults {
  resinSpec: ChelatingResinSpec;
  volFlow_m3h: number;            // 브라인 부피 유량 (m³/h)
  // 이온 당량 부하 계산
  eqLoad_Ca_eqh: number;
  eqLoad_Mg_eqh: number;
  eqLoad_Sr_eqh: number;
  eqLoad_Ba_eqh: number;
  totalIonLoad_eqh: number;       // 시간당 총 유입 2가 이온 당량 (eq/h)
  totalIonLoad_eqd: number;       // 일일 총 유입 2가 이온 당량 (eq/day)
  // 수지량 및 탑 치수 (Lead 1탑 기준)
  resinVolBySV_m3: number;        // 공간속도(SV) 기준 요구 수지 부피 (m³) = Q / SV
  resinVolByCap_m3: number;       // 재생주기(targetCycleHours) 이온부하 기준 요구 수지 부피 (m³)
  adoptedResinVol_m3: number;     // 채택된 1탑당 수지 충진 부피 BV (m³, Na-form 기준)
  actualSV_bvh: number;           // 실제 운전 공간속도 SV (BV/h)
  maxBreakthroughHours: number;   // 이론적 최대 파과 도달 시간 (hr) = V_resin * Cap_op / totalIonLoad_eqh
  operatingCycleHours: number;    // 실제 운전 재생 주기 (hr)
  regenerationsPerDay: number;    // 일일 재생 횟수 (회/day)
  // 탑 기하 치수
  D_tower_mm: number;             // 수지탑 내경 (mm)
  D_tower_m: number;              // 수지탑 내경 (m)
  crossArea_m2: number;           // 탑 단면적 (m²)
  actualLV_mh: number;            // 실제 선속도 LV (m/h)
  H_resinBed_m: number;           // Na-form 수지 충진 층고 Z_bed (m)
  H_freeboard_m: number;          // 역세 팽창 여유고 (m)
  H_shell_m: number;              // 직동부 총 높이 H_shell (m)
  dP_bed_bar: number;             // 수지층 운전 차압 (bar)
  nTotalTowers: number;           // 총 설치 탑 수 (2탑 또는 3탑)
  // 재생 스케줄 (5단계)
  regSteps: RegenerationStep[];
  totalRegenTime_min: number;     // 1회 재생 총 소요 시간 (min)
  totalRegenTime_hr: number;      // 1회 재생 총 소요 시간 (hr)
  totalRegenWater_m3: number;     // 1회 재생당 총 순수(PW) 소비량 (m³/회)
  hcl35Commercial_kg: number;     // 1회 재생당 35% HCl 원액 소요량 (kg/회)
  naoh32Commercial_kg: number;    // 1회 재생당 32% NaOH 원액 소요량 (kg/회)
  dailyPW_m3d: number;            // 일일 재생용 순수 소요량 (m³/day)
  dailyHCl35_kgd: number;         // 일일 35% HCl 소요량 (kg/day)
  dailyNaOH32_kgd: number;        // 일일 32% NaOH 소요량 (kg/day)
  nozzleBrine_NPS: string;        // 브라인 주배관 규격 (ANSI NPS)
  nozzleRegen_NPS: string;        // 재생 약품/역세 배관 규격 (ANSI NPS)
  warnings: string[];
}

export function calcChelatingIonExchange(inp: IonExchangeDesignInputs): IonExchangeDesignResults {
  const resinSpec = CHELATING_RESIN_DB.find(r => r.key === inp.resinKey) ?? CHELATING_RESIN_DB[0];
  const rho = Math.max(1050, inp.brineDensity_kgm3 || 1195);
  const volFlow_m3h = +(inp.brineFlow_kgh / rho).toFixed(1);

  // 1. 유입 2가 이온 당량 부하 (eq/h)
  // 당량중량 EW (mg/meq): Ca²⁺ = 20.04, Mg²⁺ = 12.15, Sr²⁺ = 43.81, Ba²⁺ = 68.67
  // C [mg/L = g/m³] / EW [g/eq] = eq/m³ -> * volFlow_m3h = eq/h
  const eqLoad_Ca_eqh = +((Math.max(0, inp.inletCa_ppm) / 20.04) * volFlow_m3h).toFixed(3);
  const eqLoad_Mg_eqh = +((Math.max(0, inp.inletMg_ppm) / 12.15) * volFlow_m3h).toFixed(3);
  const eqLoad_Sr_eqh = +((Math.max(0, inp.inletSr_ppm) / 43.81) * volFlow_m3h).toFixed(3);
  const eqLoad_Ba_eqh = +((Math.max(0, inp.inletBa_ppm) / 68.67) * volFlow_m3h).toFixed(3);
  const totalIonLoad_eqh = +(eqLoad_Ca_eqh + eqLoad_Mg_eqh + eqLoad_Sr_eqh + eqLoad_Ba_eqh).toFixed(3);
  const totalIonLoad_eqd = +(totalIonLoad_eqh * 24).toFixed(2);

  // 2. 1탑당 필요 수지 부피 산출 (SV 조건 vs 재생주기 이온부하 조건 중 큰 값 + 표준화)
  const targetSV = Math.max(8, Math.min(40, inp.designSV_bvh || 20));
  const resinVolBySV_m3 = +(volFlow_m3h / targetSV).toFixed(2);

  // 실운전 교환용량 (eq/L = keq/m³): 온도와 pH 보정, 파과 안전여유율 85% 적용
  const effOpCap_keqm3 = resinSpec.operCapacity_eqL * 0.85;
  const targetCycle = Math.max(8, inp.targetCycleHours || 24);
  const resinVolByCap_m3 = +((totalIonLoad_eqh * targetCycle) / (effOpCap_keqm3 * 1000)).toFixed(2);

  const rawResinVol = Math.max(resinVolBySV_m3, resinVolByCap_m3);
  const adoptedResinVol_m3 = +(Math.ceil(rawResinVol * 2) / 2).toFixed(1); // 0.5 m³ 단위 표준화
  const actualSV_bvh = +(volFlow_m3h / adoptedResinVol_m3).toFixed(1);

  // 실제 파과 도달 한계 시간 및 운전 주기
  const totalTowerCap_eq = adoptedResinVol_m3 * 1000 * effOpCap_keqm3;
  const maxBreakthroughHours = +(totalTowerCap_eq / Math.max(0.01, totalIonLoad_eqh)).toFixed(1);
  const operatingCycleHours = +Math.min(targetCycle, maxBreakthroughHours).toFixed(1);
  const regenerationsPerDay = +(24 / Math.max(4, operatingCycleHours)).toFixed(2);

  // 3. 수지탑 직경 D 및 수지층 높이 H_bed 산출
  const targetLV = Math.max(12, Math.min(40, inp.designLV_mh || 24));
  const reqArea_m2 = volFlow_m3h / targetLV;
  const d_calc_m = Math.sqrt((4 * reqArea_m2) / Math.PI);
  const D_tower_mm = Math.max(1200, Math.ceil((d_calc_m * 1000) / 100) * 100);
  const D_tower_m = +(D_tower_mm / 1000).toFixed(2);
  const crossArea_m2 = +((Math.PI * D_tower_m * D_tower_m) / 4).toFixed(2);
  const actualLV_mh = +(volFlow_m3h / crossArea_m2).toFixed(1);

  const H_resinBed_m = +(adoptedResinVol_m3 / crossArea_m2).toFixed(2);
  const freeFrac = Math.max(0.45, (inp.freeboardPct || 65) / 100);
  const H_freeboard_m = +(H_resinBed_m * freeFrac).toFixed(2);
  const H_shell_m = +(H_resinBed_m + H_freeboard_m + 0.45).toFixed(2); // 상하부 스트레이너 노즐 플레이트 여유 0.45m 포함

  // 수지층 차압 (65°C 포화염수 점도 ~1.4 cP 기준 약 0.08 bar/m @ LV 25 m/h)
  const dP_bed_bar = +(H_resinBed_m * (0.0032 * actualLV_mh)).toFixed(2);
  const nTotalTowers = inp.configMode === 'carousel_3' ? 3 : 2;

  // 4. 제조사 표준 5단계 재생 시퀀스 (Regeneration Schedule)
  const BV = adoptedResinVol_m3; // 1 BV = adoptedResinVol_m3 (m³)

  // Step 1: 역세 (Backwash — 순수 PW)
  const bwLV = Math.max(4.0, inp.backwashLV_mh || 8.0);
  const bwFlow_m3h = +(crossArea_m2 * bwLV).toFixed(1);
  const bwSV_bvh = +(bwFlow_m3h / BV).toFixed(1);
  const bwMin = Math.max(15, inp.backwashMin || 25);
  const bwVol_m3 = +((bwFlow_m3h * bwMin) / 60).toFixed(2);
  const bwBV = +(bwVol_m3 / BV).toFixed(2);

  // Step 2: 산 재생 (HCl Elution — Ca/Mg/Sr/Ba 탈착 및 H-form 전환)
  const hclDosage_gL = Math.max(80, inp.hclDosage_gL || resinSpec.hclDosage_gL);
  const hclPure_kg = +((BV * 1000 * hclDosage_gL) / 1000).toFixed(1); // kg 100% HCl
  const hcl35Commercial_kg = +(hclPure_kg / 0.35).toFixed(1);
  const hclConc = Math.max(2.0, Math.min(10.0, inp.hclConc_wtPct || resinSpec.hclConc_wtPct));
  const hclSolMass_kg = hclPure_kg / (hclConc / 100);
  const hclSolVol_m3 = +(hclSolMass_kg / 1020).toFixed(2);
  const hclBV = +(hclSolVol_m3 / BV).toFixed(2);
  const hclSV = Math.max(1.5, inp.hclSV_bvh || resinSpec.hclSV_bvh);
  const hclFlow_m3h = +(BV * hclSV).toFixed(1);
  const hclMin = Math.round((hclSolVol_m3 / hclFlow_m3h) * 60);

  // Step 3: 1차 압출 및 세정 (Slow + Fast Rinse after Acid — 순수 PW)
  const rinse1BV = Math.max(2.5, inp.rinseBV || 4.0);
  const rinse1Vol_m3 = +(BV * rinse1BV).toFixed(2);
  const rinse1SV = Math.max(2.5, inp.rinseSV_bvh || 5.0);
  const rinse1Flow_m3h = +(BV * rinse1SV).toFixed(1);
  const rinse1Min = Math.round((rinse1Vol_m3 / rinse1Flow_m3h) * 60);

  // Step 4: 가성소다 컨디셔닝 (NaOH Conditioning — H-form → Na-form 전환)
  const naohDosage_gL = Math.max(70, inp.naohDosage_gL || resinSpec.naohDosage_gL);
  const naohPure_kg = +((BV * 1000 * naohDosage_gL) / 1000).toFixed(1); // kg 100% NaOH
  const naoh32Commercial_kg = +(naohPure_kg / 0.32).toFixed(1);
  const naohConc = Math.max(2.0, Math.min(10.0, inp.naohConc_wtPct || resinSpec.naohConc_wtPct));
  const naohSolMass_kg = naohPure_kg / (naohConc / 100);
  const naohSolVol_m3 = +(naohSolMass_kg / 1042).toFixed(2);
  const naohBV = +(naohSolVol_m3 / BV).toFixed(2);
  const naohSV = Math.max(1.5, inp.naohSV_bvh || resinSpec.naohSV_bvh);
  const naohFlow_m3h = +(BV * naohSV).toFixed(1);
  const naohMin = Math.round((naohSolVol_m3 / naohFlow_m3h) * 60);

  // Step 5: 2차 최종 세정 (Final Rinse — 순수 PW)
  const rinse2BV = Math.max(2.5, inp.rinseBV || 4.0);
  const rinse2Vol_m3 = +(BV * rinse2BV).toFixed(2);
  const rinse2SV = Math.max(3.0, (inp.rinseSV_bvh || 5.0) * 1.2);
  const rinse2Flow_m3h = +(BV * rinse2SV).toFixed(1);
  const rinse2Min = Math.round((rinse2Vol_m3 / rinse2Flow_m3h) * 60);

  const regSteps: RegenerationStep[] = [
    {
      stepNo: 1,
      stepName: '역세 (Backwash — 수지층 팽창·분류)',
      fluidName: '순수 (PW / DI Water)',
      sv_bvh: bwSV_bvh,
      bedVolumes_BV: bwBV,
      flowRate_m3h: bwFlow_m3h,
      duration_min: bwMin,
      totalVolume_m3: bwVol_m3,
      chemPureMass_kg: 0,
      chemCommercial_kg: 0,
      notes: `상향류 유속 ${bwLV.toFixed(1)} m/h (수지층 50% 팽창, 미세 파쇄수지 및 SS 제거)`,
    },
    {
      stepNo: 2,
      stepName: `산 재생 (Acid Elution — ${hclConc}% HCl)`,
      fluidName: `${hclConc}% HCl 수용액`,
      sv_bvh: hclSV,
      bedVolumes_BV: hclBV,
      flowRate_m3h: hclFlow_m3h,
      duration_min: hclMin,
      totalVolume_m3: hclSolVol_m3,
      chemPureMass_kg: hclPure_kg,
      chemCommercial_kg: hcl35Commercial_kg,
      notes: `Ca²⁺/Mg²⁺/Sr²⁺ 탈착 및 H⁺형 전환 (${hclDosage_gL} g HCl/L-resin, 35% HCl ${hcl35Commercial_kg} kg)`,
    },
    {
      stepNo: 3,
      stepName: '1차 압출 및 세정 (Acid Displacement & Rinse)',
      fluidName: '순수 (PW / DI Water)',
      sv_bvh: rinse1SV,
      bedVolumes_BV: rinse1BV,
      flowRate_m3h: rinse1Flow_m3h,
      duration_min: rinse1Min,
      totalVolume_m3: rinse1Vol_m3,
      chemPureMass_kg: 0,
      chemCommercial_kg: 0,
      notes: '잔류 HCl 및 탈착 경도성분(CaCl₂/MgCl₂) 압출 세정 (pH ≥ 3.5 확인)',
    },
    {
      stepNo: 4,
      stepName: `Na형 전환 컨디셔닝 (Conditioning — ${naohConc}% NaOH)`,
      fluidName: `${naohConc}% NaOH 수용액`,
      sv_bvh: naohSV,
      bedVolumes_BV: naohBV,
      flowRate_m3h: naohFlow_m3h,
      duration_min: naohMin,
      totalVolume_m3: naohSolVol_m3,
      chemPureMass_kg: naohPure_kg,
      chemCommercial_kg: naoh32Commercial_kg,
      notes: `H⁺형 → Na⁺형 전환 (수지 부피 +${resinSpec.swellingNaPct}% 팽창, 32% NaOH ${naoh32Commercial_kg} kg)`,
    },
    {
      stepNo: 5,
      stepName: '2차 최종 세정 (Final Rinse & Brine Displacement)',
      fluidName: '순수 (PW) → 정제 염수 치환',
      sv_bvh: +rinse2SV.toFixed(1),
      bedVolumes_BV: rinse2BV,
      flowRate_m3h: rinse2Flow_m3h,
      duration_min: rinse2Min,
      totalVolume_m3: rinse2Vol_m3,
      chemPureMass_kg: 0,
      chemCommercial_kg: 0,
      notes: '잔류 가성소다 세정 후 정제 브라인 치환 → Lag(후단) 탑으로 운전 투입',
    },
  ];

  const totalRegenTime_min = regSteps.reduce((acc, s) => acc + s.duration_min, 0);
  const totalRegenTime_hr = +(totalRegenTime_min / 60).toFixed(2);
  const totalRegenWater_m3 = +(bwVol_m3 + hclSolVol_m3 + rinse1Vol_m3 + naohSolVol_m3 + rinse2Vol_m3).toFixed(1);

  const dailyPW_m3d = +(totalRegenWater_m3 * regenerationsPerDay).toFixed(1);
  const dailyHCl35_kgd = +(hcl35Commercial_kg * regenerationsPerDay).toFixed(1);
  const dailyNaOH32_kgd = +(naoh32Commercial_kg * regenerationsPerDay).toFixed(1);

  const nozzleBrine_NPS = selectAnsiPipeNPS(volFlow_m3h, 1.8);
  const maxRegenFlow = Math.max(bwFlow_m3h, rinse2Flow_m3h, hclFlow_m3h);
  const nozzleRegen_NPS = selectAnsiPipeNPS(maxRegenFlow, 1.6);

  const warnings: string[] = [];
  if (actualSV_bvh > resinSpec.recSV_max_bvh) {
    warnings.push(`[주의] 실제 공간속도(${actualSV_bvh} BV/h)가 ${resinSpec.model} 권장 최대치(${resinSpec.recSV_max_bvh} BV/h)를 초과하여 이온 누출(Leakage > 20 ppb) 위험이 있습니다.`);
  }
  if (H_resinBed_m < resinSpec.minBedDepth_m) {
    warnings.push(`[권고] 수지층 높이(${H_resinBed_m} m)가 제조사 최소 권장 층고(${resinSpec.minBedDepth_m} m)보다 낮습니다. 선속도(LV)를 높이거나 수지량을 늘리세요.`);
  }
  if (inp.targetCycleHours > maxBreakthroughHours) {
    warnings.push(`[경고] 설정한 재생주기(${inp.targetCycleHours} hr)가 수지 이온교환 파과 한계(${maxBreakthroughHours} hr)를 초과합니다! 재생주기를 ${Math.floor(maxBreakthroughHours)} hr 이하로 단축하거나 수지량을 늘려야 합니다.`);
  }

  return {
    resinSpec,
    volFlow_m3h,
    eqLoad_Ca_eqh,
    eqLoad_Mg_eqh,
    eqLoad_Sr_eqh,
    eqLoad_Ba_eqh,
    totalIonLoad_eqh,
    totalIonLoad_eqd,
    resinVolBySV_m3,
    resinVolByCap_m3,
    adoptedResinVol_m3,
    actualSV_bvh,
    maxBreakthroughHours,
    operatingCycleHours,
    regenerationsPerDay,
    D_tower_mm,
    D_tower_m,
    crossArea_m2,
    actualLV_mh,
    H_resinBed_m,
    H_freeboard_m,
    H_shell_m,
    dP_bed_bar,
    nTotalTowers,
    regSteps,
    totalRegenTime_min,
    totalRegenTime_hr,
    totalRegenWater_m3,
    hcl35Commercial_kg,
    naoh32Commercial_kg,
    dailyPW_m3d,
    dailyHCl35_kgd,
    dailyNaOH32_kgd,
    nozzleBrine_NPS,
    nozzleRegen_NPS,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 4. Material Balance 스트림 연동 기본 프리셋 생성기
// ─────────────────────────────────────────────────────────────────────

export function getBrinePurifPresets(streams: StreamData[]) {
  const s004 = streams.find(s => s.id === '004');
  const s022 = streams.find(s => s.id === '022');
  const s102 = streams.find(s => s.id === '102');
  const flowBrine = Math.round(s102?.total_kgh ?? s022?.total_kgh ?? s004?.total_kgh ?? 238867);

  const saturatorPreset: SaturatorDesignInputs = {
    tag: 'T-030',
    mode: 'upflow_saturator',
    brineFlow_kgh: flowBrine,
    brineDensity_kgm3: 1195,
    temp_C: 68,
    inletNaCl_gL: 205,
    targetNaCl_gL: 310,
    upflowVel_mh: 7.5,
    saltRetention_hr: 8.0,
    saltBulkDensity_tm3: 1.15,
    coneAngle_deg: 55,
    freeboard_m: 1.2,
    material: 'FRP (Vinyl Ester) / CS+Rubber Lining',
  };

  const candleFilterPreset: CandleFilterDesignInputs = {
    tag: 'F-140',
    brineFlow_kgh: flowBrine,
    brineDensity_kgm3: 1195,
    temp_C: 65,
    inletSS_ppm: 20.0,
    outletSS_ppm: 0.2,
    filtrationFlux_mh: 1.25,
    candleOD_mm: 70,
    candleLength_mm: 1500,
    candlePitch_mm: 120,
    nOperatingUnits: 2,
    nStandbyUnits: 1,
    precoatDosage_kgm2: 0.8,
    bodyFeedRatio_ppm: 8.0,
    maxCakeThickness_mm: 18,
    material: 'CS + ePTFE/Rubber Lining (Candle: PVDF)',
  };

  const ionExchangePreset: IonExchangeDesignInputs = {
    tag: 'T-160',
    resinKey: 'lewatit_tp208',
    configMode: 'carousel_3',
    brineFlow_kgh: flowBrine,
    brineDensity_kgm3: 1195,
    temp_C: 65,
    pH_in: 10.0,
    inletCa_ppm: 2.5,
    inletMg_ppm: 0.5,
    inletSr_ppm: 0.8,
    inletBa_ppm: 0.3,
    targetOutletTotal_ppb: 15,
    designSV_bvh: 20,
    targetCycleHours: 24,
    designLV_mh: 25,
    freeboardPct: 65,
    hclDosage_gL: 120,
    hclConc_wtPct: 4.5,
    hclSV_bvh: 3.0,
    naohDosage_gL: 110,
    naohConc_wtPct: 4.0,
    naohSV_bvh: 3.0,
    backwashLV_mh: 8.0,
    backwashMin: 25,
    rinseBV: 4.0,
    rinseSV_bvh: 5.0,
  };

  return { saturatorPreset, candleFilterPreset, ionExchangePreset };
}

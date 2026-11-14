// =====================================================================
// 펌프 설계 계산 엔진 (Pump Design Calculation Engine)
// =====================================================================

import {
  FluidProps, densityAtT, viscosityAtT, vaporPressure_kPa,
  pipeID,
} from './physicalProperties';
import {
  calcPipePressureDrop, PipeSegment, PipeCalcResult,
} from './pipePressureDrop';

// ─────────────────────────────────────────────────────────────────────
// 입력 인터페이스
// ─────────────────────────────────────────────────────────────────────
export interface PumpInputs {
  // ── 유체 ────────────────────────────────────────────────────────
  fluid: FluidProps;
  temperature_C: number;
  /** 유량 (m³/h) */
  flowRate_m3h: number;

  // ── 흡입측 조건 ─────────────────────────────────────────────────
  /** 흡입측 정압 (kPa gauge) */
  P_suction_kPaG: number;
  /** 흡입 액면과 펌프 중심의 높이차 (m), 정압두(흡상)=양수, 부두(압상)=음수 */
  suction_head_m: number;
  /** 흡입 배관 구간들 */
  suctionPipe: PipeSegment[];

  // ── 토출측 조건 ─────────────────────────────────────────────────
  /** 토출측 정압 (kPa gauge) */
  P_discharge_kPaG: number;
  /** 토출 액면과 펌프 중심의 높이차 (m), 양수=상승 */
  discharge_head_m: number;
  /** 토출 배관 구간들 */
  dischargePipe: PipeSegment[];

  // ── 펌프 성능 ────────────────────────────────────────────────────
  /** 펌프 효율 (0~1) */
  pumpEfficiency: number;
  /** 전동기 효율 (0~1) */
  motorEfficiency: number;
  /** 펌프 제조사 NPSH required (m) — 미입력 시 NPSHa만 표시 */
  NPSHr_m?: number;
  /** 회전속도 (rpm, 기본 1750 rpm) */
  pumpSpeed_rpm?: number;
  /** 흡입비속도 설계 기준치 (US gpm/ft 단위, 기본 9000; NPSHr 미입력 시 역산) */
  suctionSpecificSpeed_Nss?: number;
  /** 최고효율점(BEP) 유량 (m³/h, 기본 = 운전유량 × 1.05) */
  Q_BEP_m3h?: number;
  /** 점도 보정 적용 여부 (기본 true, HI 9.6.7 표준) */
  applyViscosityCorrection?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// 결과 인터페이스
// ─────────────────────────────────────────────────────────────────────
export interface PumpResults {
  // ── 유체 물성 ────────────────────────────────────────────────────
  density_kgm3: number;
  viscosity_mPas: number;
  vaporPressure_kPa: number;

  // ── 흡입측 ───────────────────────────────────────────────────────
  suctionPipeCalc: PipeCalcResult;
  /** 흡입 배관 마찰수두 (m) */
  hf_suction_m: number;
  /** 흡입 NPSH available (m) */
  NPSHa_m: number;
  NPSHr_m?: number;
  NPSH_margin_m?: number;
  NPSH_ok?: boolean;

  // ── 수력학적 한계 및 정격 진단 ─────────────────────────────────────
  /** 흡입비속도 N_ss (US 단위: rpm·gpm^0.5 / ft^0.75) */
  Nss_US: number;
  /** 흡입비속도 N_ss (SI 단위: rad/s·(m³/s)^0.5 / (m·g)^0.75) */
  Nss_SI: number;
  /** Nss 한계 진단 알림 (11,000 초과 시 흡입 재순환 주의) */
  Nss_warning?: string;
  /** Nss로부터 역산 추정된 NPSHr (m) */
  estimated_NPSHr_m?: number;

  /** 운전 영역 (API 610 POR 70~120%, AOR) */
  operatingRange: {
    Q_BEP_m3h: number;
    POR_min_m3h: number;
    POR_max_m3h: number;
    AOR_min_m3h: number;
    AOR_max_m3h: number;
    currentRatioBEP: number;
    status: 'in_POR' | 'in_AOR' | 'outside_AOR';
    statusLabel: string;
  };

  /** 최소 연속 유량 (MCSF & MCTF) */
  minContinuousFlow: {
    /** 최소 연속 안정 유량 MCSF (m³/h) */
    MCSF_m3h: number;
    /** 최소 연속 열적 유량 MCTF (m³/h) */
    MCTF_m3h: number;
    mcsfRatioBEP: number;
    description: string;
  };

  /** Hydraulic Institute (HI 9.6.7) 고점도 보정 결과 */
  viscosityCorrection?: {
    kinematicViscosity_cSt: number;
    B_parameter: number;
    C_H: number;
    C_Q: number;
    C_eta: number;
    correctedTDH_m: number;
    correctedEfficiency: number;
    correctedShaftPower_kW: number;
    isCorrected: boolean;
  };

  /** API 610 전동기 사이징 여유율 상세 */
  motorSizingDetail: {
    apiMarginPct: number;
    targetMotorPower_kW: number;
    motorNominal_kW: number;
  };

  // ── 토출측 ───────────────────────────────────────────────────────
  dischargePipeCalc: PipeCalcResult;
  /** 토출 배관 마찰수두 (m) */
  hf_discharge_m: number;

  // ── 전양정 ───────────────────────────────────────────────────────
  /** 정적 수두 차 (m) */
  staticHead_m: number;
  /** 마찰수두 합계 (m) */
  frictionHead_m: number;
  /** 압력 수두 차 (m) */
  pressureHead_m: number;
  /** 전양정 TDH (m) */
  TDH_m: number;

  // ── 소요 동력 ────────────────────────────────────────────────────
  /** 수동력 (kW) */
  waterPower_kW: number;
  /** 펌프 축동력 (kW) */
  shaftPower_kW: number;
  /** 전동기 소요 출력 (kW) */
  motorPower_kW: number;
  /** 전동기 선정 출력 (kW) — 표준 모터 사이즈 */
  motorNominal_kW: number;
}

// ─────────────────────────────────────────────────────────────────────
// 표준 전동기 출력 사이즈
// ─────────────────────────────────────────────────────────────────────
const MOTOR_SIZES_kW = [
  0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5,
  11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315,
];

export function selectMotorSize(required_kW: number): number {
  // 10% 마진 추가 후 다음 표준 사이즈 선택
  const target = required_kW * 1.10;
  return MOTOR_SIZES_kW.find(s => s >= target) ?? MOTOR_SIZES_kW[MOTOR_SIZES_kW.length - 1];
}

/** API 610 (Table 7) 권장 모터 여유율 적용 사이징 */
export function selectMotorSizeAPI610(shaftPower_kW: number, motorEfficiency: number): {
  nominal_kW: number;
  marginPct: number;
  target_kW: number;
} {
  // API 610 규격 여유율:
  // <= 22 kW: +25%
  // 22 ~ 55 kW: +15%
  // > 55 kW: +10%
  const marginPct = shaftPower_kW <= 22 ? 25 : shaftPower_kW <= 55 ? 15 : 10;
  const target = (shaftPower_kW * (1 + marginPct / 100)) / Math.max(0.5, motorEfficiency);
  const nominal = MOTOR_SIZES_kW.find(s => s >= target) ?? MOTOR_SIZES_kW[MOTOR_SIZES_kW.length - 1];
  return { nominal_kW: nominal, marginPct, target_kW: target };
}

/** Hydraulic Institute (HI 9.6.7) 원심펌프 고점도 유체 보정 (B 파라미터 기반) */
export function calcHIViscosityCorrection(
  Q_m3h: number,
  H_m: number,
  eta_water: number,
  rpm: number,
  viscosity_cSt: number
): {
  B: number;
  CH: number;
  CQ: number;
  Ceta: number;
  H_corr: number;
  eta_corr: number;
  isCorrected: boolean;
} {
  if (viscosity_cSt <= 1.0) {
    return { B: 0, CH: 1.0, CQ: 1.0, Ceta: 1.0, H_corr: H_m, eta_corr: eta_water, isCorrected: false };
  }
  const Q_BEP = Math.max(1, Q_m3h);
  const H_BEP = Math.max(1, H_m);
  const N = Math.max(100, rpm);
  // B = 16.5 * (nu^0.5 * H_BEP^0.0625) / (Q_BEP^0.25 * N^0.25)
  const B = 16.5 * (Math.sqrt(viscosity_cSt) * Math.pow(H_BEP, 0.0625)) / (Math.pow(Q_BEP, 0.25) * Math.pow(N, 0.25));
  if (B < 1.0) {
    return { B: Number(B.toFixed(3)), CH: 1.0, CQ: 1.0, Ceta: 1.0, H_corr: H_m, eta_corr: eta_water, isCorrected: false };
  }
  const CH = Math.max(0.40, Math.min(1.0, 1.0 - 0.054 * Math.pow(B - 1, 0.6)));
  const CQ = CH;
  const Ceta = Math.max(0.20, Math.min(1.0, 1.0 - (1.0 - eta_water) * Math.pow(viscosity_cSt, 0.05) * (1.0 + 0.08 * Math.pow(B - 1, 0.7))));
  return {
    B: Number(B.toFixed(3)),
    CH: Number(CH.toFixed(3)),
    CQ: Number(CQ.toFixed(3)),
    Ceta: Number(Ceta.toFixed(3)),
    H_corr: Number((H_m * CH).toFixed(2)),
    eta_corr: Number((eta_water * Ceta).toFixed(3)),
    isCorrected: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 펌프 설계 계산 메인 함수
// ─────────────────────────────────────────────────────────────────────
export function calcPump(inputs: PumpInputs): PumpResults {
  const { fluid, temperature_C: T, flowRate_m3h: Q } = inputs;
  const rho  = densityAtT(fluid, T);   // kg/m³
  const mu   = viscosityAtT(fluid, T); // mPa·s
  const Pv   = vaporPressure_kPa(fluid, T);  // kPa abs
  const g    = 9.81;
  const rpm  = inputs.pumpSpeed_rpm ?? 1750;

  // 동점도 (cSt = mm²/s)
  const kinematicVisc_cSt = Math.max(0.1, (mu / (rho / 1000)));

  // ── 흡입 배관 차압 계산 ──────────────────────────────────────────
  const suctionCalc = calcPipePressureDrop(fluid, T, Q, inputs.suctionPipe);
  const hf_suction  = suctionCalc.dP_total_mH2O;

  // ── 토출 배관 차압 계산 ──────────────────────────────────────────
  const dischargeCalc   = calcPipePressureDrop(fluid, T, Q, inputs.dischargePipe);
  const hf_discharge    = dischargeCalc.dP_total_mH2O;

  // ── NPSHa 계산 ───────────────────────────────────────────────────
  // NPSHa = (P_s_abs - Pv) / (ρg) + Hs - hf_suction
  const P_atm_kPa = 101.325;
  const P_suction_abs = inputs.P_suction_kPaG + P_atm_kPa;  // kPa abs
  const NPSHa = (P_suction_abs - Pv) * 1000 / (rho * g)
                + inputs.suction_head_m
                - Math.abs(hf_suction);  // hf_suction은 항상 손실

  // ── 흡입비속도 N_ss & NPSHr 역산 ──────────────────────────────────
  const Qgpm = Q * 4.40285;
  let NPSHr = inputs.NPSHr_m;
  let estimated_NPSHr_m: number | undefined;

  const targetNss = inputs.suctionSpecificSpeed_Nss ?? 9000;
  if (NPSHr == null || NPSHr <= 0) {
    // NPSHr 미입력 시 Nss = 9000 기준 역산 추정
    const npshFt = Math.pow((rpm * Math.sqrt(Math.max(1, Qgpm))) / targetNss, 4 / 3);
    estimated_NPSHr_m = Number((npshFt * 0.3048).toFixed(2));
    NPSHr = estimated_NPSHr_m;
  }

  const npshrFt = Math.max(0.2, NPSHr * 3.28084);
  const Nss_US = Math.round((rpm * Math.sqrt(Math.max(1, Qgpm))) / Math.pow(npshrFt, 0.75));
  const omegaRadS = (rpm * 2 * Math.PI) / 60;
  const Qm3s = Q / 3600;
  const Nss_SI = Number(((omegaRadS * Math.sqrt(Qm3s)) / Math.pow(g * Math.max(0.05, NPSHr), 0.75)).toFixed(3));

  let Nss_warning: string | undefined;
  if (Nss_US > 11000) {
    Nss_warning = `Nss = ${Nss_US.toLocaleString()} (US gpm/ft) > 11,000 한계: 저유량(Q < 70% BEP) 흡입 재순환(Suction Recirculation) 및 캐비테이션 진동 발생 위험이 높습니다.`;
  }

  const NPSH_margin  = NPSHa - NPSHr;
  const NPSH_ok      = NPSH_margin > 0.5; // NEMA / API: NPSHa > NPSHr + 0.5m

  // ── 전양정 TDH ───────────────────────────────────────────────────
  const P_discharge_abs = inputs.P_discharge_kPaG + P_atm_kPa;
  // 압력 수두 차: (Pd - Ps) / (ρg)
  const pressureHead = (P_discharge_abs - P_suction_abs) * 1000 / (rho * g);
  // 정적 수두 차: 토출 액면 - 흡입 액면
  const staticHead   = inputs.discharge_head_m - inputs.suction_head_m;
  // 마찰 수두 합계 (흡입 + 토출)
  const frictionHead = Math.abs(hf_suction) + Math.abs(hf_discharge);
  const TDH = pressureHead + staticHead + frictionHead;

  // ── 소요 동력 및 점도 보정 (HI 9.6.7) ─────────────────────────────
  let effectiveEff = inputs.pumpEfficiency;
  let effectiveTDH = TDH;
  let viscResult: PumpResults['viscosityCorrection'] | undefined;

  if (inputs.applyViscosityCorrection !== false && kinematicVisc_cSt > 1.0) {
    const vc = calcHIViscosityCorrection(Q, TDH, inputs.pumpEfficiency, rpm, kinematicVisc_cSt);
    if (vc.isCorrected) {
      effectiveEff = vc.eta_corr;
      effectiveTDH = vc.H_corr;
      const shaftPowerVisc = (rho * g * Qm3s * effectiveTDH) / (1000 * effectiveEff);
      viscResult = {
        kinematicViscosity_cSt: Number(kinematicVisc_cSt.toFixed(2)),
        B_parameter: vc.B,
        C_H: vc.CH,
        C_Q: vc.CQ,
        C_eta: vc.Ceta,
        correctedTDH_m: effectiveTDH,
        correctedEfficiency: effectiveEff,
        correctedShaftPower_kW: Number(shaftPowerVisc.toFixed(2)),
        isCorrected: true,
      };
    }
  }

  const waterPower  = (rho * g * Qm3s * TDH) / 1000;  // kW (청수 기준)
  const shaftPower  = (rho * g * Qm3s * effectiveTDH) / (1000 * effectiveEff); // 실제 점도 반영 축동력
  const motorPower  = shaftPower / inputs.motorEfficiency;

  // API 610 모터 사이징
  const motorDetail = selectMotorSizeAPI610(shaftPower, inputs.motorEfficiency);
  const motorNominal = motorDetail.nominal_kW;

  // ── 운전 영역 (POR / AOR) ─────────────────────────────────────────
  const Q_BEP = inputs.Q_BEP_m3h ?? (Q * 1.05);
  const qRatio = Q / Math.max(1e-4, Q_BEP);
  const porMin = Q_BEP * 0.70;
  const porMax = Q_BEP * 1.20;
  const aorMin = Nss_US > 11000 ? Q_BEP * 0.75 : Q_BEP * 0.60;
  const aorMax = Nss_US > 11000 ? Q_BEP * 1.15 : Q_BEP * 1.25;

  let opStatus: 'in_POR' | 'in_AOR' | 'outside_AOR' = 'outside_AOR';
  let opStatusLabel = '허용운전영역(AOR) 이탈';
  if (Q >= porMin && Q <= porMax) {
    opStatus = 'in_POR';
    opStatusLabel = '최적운전영역(POR: 70~120% BEP) 정상';
  } else if (Q >= aorMin && Q <= aorMax) {
    opStatus = 'in_AOR';
    opStatusLabel = '허용운전영역(AOR) 이내';
  }

  // ── 최소 연속 유량 (MCSF & MCTF) ──────────────────────────────────
  const mcsfFraction = Nss_US <= 8000 ? 0.25 : Nss_US <= 10000 ? 0.35 : Nss_US <= 12000 ? 0.50 : 0.65;
  const MCSF_m3h = Number((Q_BEP * mcsfFraction).toFixed(2));
  // MCTF (허용 온도상승 ΔT ~ 8°C 기준)
  const P_shutoff_kW = shaftPower * 0.45;
  const MCTF_m3h = Number(Math.max(0.1, (3600 * P_shutoff_kW) / ((rho * 4.184 * 8))).toFixed(2));

  return {
    density_kgm3:     rho,
    viscosity_mPas:   mu,
    vaporPressure_kPa: Pv,

    suctionPipeCalc:  suctionCalc,
    hf_suction_m:     hf_suction,
    NPSHa_m:          NPSHa,
    NPSHr_m:          NPSHr,
    NPSH_margin_m:    NPSH_margin,
    NPSH_ok,

    Nss_US,
    Nss_SI,
    Nss_warning,
    estimated_NPSHr_m,

    operatingRange: {
      Q_BEP_m3h: Number(Q_BEP.toFixed(2)),
      POR_min_m3h: Number(porMin.toFixed(2)),
      POR_max_m3h: Number(porMax.toFixed(2)),
      AOR_min_m3h: Number(aorMin.toFixed(2)),
      AOR_max_m3h: Number(aorMax.toFixed(2)),
      currentRatioBEP: Number(qRatio.toFixed(3)),
      status: opStatus,
      statusLabel: opStatusLabel,
    },

    minContinuousFlow: {
      MCSF_m3h,
      MCTF_m3h,
      mcsfRatioBEP: Number(mcsfFraction.toFixed(2)),
      description: `MCSF: 안정 운전 한계 (${(mcsfFraction * 100).toFixed(0)}% BEP), MCTF: 열적 증발 한계 (${MCTF_m3h} m³/h)`,
    },

    viscosityCorrection: viscResult,

    dischargePipeCalc: dischargeCalc,
    hf_discharge_m:    hf_discharge,

    staticHead_m:      staticHead,
    frictionHead_m:    frictionHead,
    pressureHead_m:    pressureHead,
    TDH_m:             TDH,

    waterPower_kW:    waterPower,
    shaftPower_kW:    shaftPower,
    motorPower_kW:    motorPower,
    motorNominal_kW:  motorNominal,
    motorSizingDetail: {
      apiMarginPct: motorDetail.marginPct,
      targetMotorPower_kW: Number(motorDetail.target_kW.toFixed(2)),
      motorNominal_kW: motorDetail.nominal_kW,
    },
  };
}

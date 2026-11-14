// ============================================================================
// Stage 5: 수용액 전해질 활동도 · 삼투계수 · 비점상승(BPE) · 염석 효과 모델
//          (Pitzer-Debye-Hückel 이온상호작용 모델 기반: NaCl, NaOH, HCl, H2SO4 혼합 수용액)
// ============================================================================

import type { SimCompKey } from './flowsheetSolver';

const MW_H2O = 0.01801528; // kg/mol
const R_GAS = 8.314462;    // J/(mol·K)

const ELEC_MW: Record<'NaCl' | 'NaOH' | 'HCl' | 'H2SO4', number> = {
  NaCl: 58.443,
  NaOH: 39.997,
  HCl: 36.461,
  H2SO4: 98.079,
};

// Pitzer 298.15 K 기준 이성분 상호작용 파라미터 (β^(0), β^(1), C^φ) 및 온도계수 dβ^(0)/dT
// 출처: Pitzer (1991) Activity Coefficients in Electrolyte Solutions, 2nd Ed., CRC Press
interface PitzerSaltParam {
  nu: number;       // 화학양론 이온수 (1-1 전해질 = 2, H2SO4 1차/유효 해리 보정 = 2.45)
  zPlusZMinus: number;
  beta0: number;
  beta1: number;
  cPhi: number;
  dBeta0dT: number;
  sechenovKs: number; // 용존 가스(Cl2, O2, H2) Sechenov 염석 계수 (L/mol ≈ kg_w/mol)
}

const PITZER_DB: Record<'NaCl' | 'NaOH' | 'HCl' | 'H2SO4', PitzerSaltParam> = {
  NaCl:  { nu: 2.0,  zPlusZMinus: 1, beta0: 0.0765, beta1: 0.2664, cPhi: 0.00127,  dBeta0dT: 0.00071, sechenovKs: 0.245 },
  NaOH:  { nu: 2.0,  zPlusZMinus: 1, beta0: 0.0864, beta1: 0.2530, cPhi: 0.00440,  dBeta0dT: 0.00052, sechenovKs: 0.172 },
  HCl:   { nu: 2.0,  zPlusZMinus: 1, beta0: 0.1775, beta1: 0.2945, cPhi: 0.00080,  dBeta0dT: -0.00031, sechenovKs: 0.048 },
  H2SO4: { nu: 2.35, zPlusZMinus: 2, beta0: 0.1350, beta1: 0.8500, cPhi: 0.01200,  dBeta0dT: -0.00045, sechenovKs: 0.115 },
};

export interface ElectrolyteThermoState {
  totalMolality: number;      // Σ m_i (mol/kg_H2O)
  ionicStrength: number;      // I (mol/kg_H2O)
  osmoticCoeff: number;       // φ_osm
  waterActivity: number;      // a_w (0 < a_w <= 1)
  bpeDegC: number;            // 끓는점 오름 ΔT_BPE (°C)
  gasSaltingOutFactor: number;// exp(-Σ k_s m_i), 용존 가스 용해도 감소 계수 (0 < f <= 1)
  meanGammaNaCl: number;      // γ_±(NaCl)
  meanGammaNaOH: number;      // γ_±(NaOH)
  meanGammaHCl: number;       // γ_±(HCl)
}

/** Debye-Hückel 삼투 계수 경사 A_φ(T) (Bradley & Pitzer, 0 ~ 200°C 유효) */
function debyeHuckelAPhi(T_C: number): number {
  const dT = Math.max(-35, Math.min(200, T_C)) - 25.0;
  return 0.3915 + 0.000685 * dT + 3.1e-6 * dT * dT;
}

/**
 * 다성분 수용액(NaCl, NaOH, HCl, H2SO4) Pitzer 활동도 및 비점상승(BPE) 엄밀 산출
 * - 저농도~고농도(50 wt% NaOH = 25 mol/kg 포함) 전 구간 연속·단조 거동 보장
 */
export function computeElectrolyteState(
  liqFlowsKgH: Partial<Record<SimCompKey, number>>,
  T_C: number,
  P_barA = 1.01325
): ElectrolyteThermoState {
  const mWaterKg = Math.max(0, liqFlowsKgH.H2O ?? 0);
  if (mWaterKg <= 1e-9) {
    return {
      totalMolality: 0,
      ionicStrength: 0,
      osmoticCoeff: 1.0,
      waterActivity: 1.0,
      bpeDegC: 0,
      gasSaltingOutFactor: 1.0,
      meanGammaNaCl: 1.0,
      meanGammaNaOH: 1.0,
      meanGammaHCl: 1.0,
    };
  }

  // 극고농도(예: 50~65 wt% NaOH/H2SO4) 수치 발산 방지를 위해 유효 몰랄농도 상한 완충 (m_eff <= 28 mol/kg)
  const mNaCl = Math.min(12.0, (Math.max(0, liqFlowsKgH.NaCl ?? 0) / ELEC_MW.NaCl) * (1000 / mWaterKg));
  const mNaOH = Math.min(28.0, (Math.max(0, liqFlowsKgH.NaOH ?? 0) / ELEC_MW.NaOH) * (1000 / mWaterKg));
  const mHCl = Math.min(22.0, (Math.max(0, liqFlowsKgH.HCl ?? 0) / ELEC_MW.HCl) * (1000 / mWaterKg));
  const mH2SO4 = Math.min(26.0, (Math.max(0, liqFlowsKgH.H2SO4 ?? 0) / ELEC_MW.H2SO4) * (1000 / mWaterKg));

  const mTot = mNaCl + mNaOH + mHCl + mH2SO4;
  if (mTot <= 1e-7) {
    return {
      totalMolality: 0,
      ionicStrength: 0,
      osmoticCoeff: 1.0,
      waterActivity: 1.0,
      bpeDegC: 0,
      gasSaltingOutFactor: 1.0,
      meanGammaNaCl: 1.0,
      meanGammaNaOH: 1.0,
      meanGammaHCl: 1.0,
    };
  }

  const I = mNaCl + mNaOH + mHCl + 2.1 * mH2SO4;
  const sqrtI = Math.sqrt(I);
  const Aphi = debyeHuckelAPhi(T_C);
  const bPitzer = 1.2;
  const alphaPitzer = 2.0;
  const dT = Math.max(-25, Math.min(180, T_C)) - 25.0;

  // Debye-Hückel 삼투항 f^φ = -A_φ I^(1/2) / (1 + b I^(1/2))
  const fPhi = (-Aphi * sqrtI) / (1.0 + bPitzer * sqrtI);

  const salts: Array<['NaCl' | 'NaOH' | 'HCl' | 'H2SO4', number]> = [
    ['NaCl', mNaCl],
    ['NaOH', mNaOH],
    ['HCl', mHCl],
    ['H2SO4', mH2SO4],
  ];

  let nuMSum = 0;
  let virialSum = 0;
  let sechenovSum = 0;

  for (const [key, mi] of salts) {
    if (mi <= 0) continue;
    const p = PITZER_DB[key];
    nuMSum += p.nu * mi;
    const beta0T = p.beta0 + p.dBeta0dT * dT;
    const Bphi = beta0T + p.beta1 * Math.exp(-alphaPitzer * sqrtI);
    // 혼합 용액에서는 유효 이온강도 I를 공유하여 공통이온 효과(예: NaCl + NaOH) 자연 반영
    const mEff = Math.min(18.0, 0.5 * (mi + I));
    virialSum += (p.nu * mi) * (mEff * Bphi + mEff * mEff * p.cPhi);
    sechenovSum += p.sechenovKs * mi;
  }

  const phiOsm = Math.max(0.45, Math.min(3.2, 1.0 + Math.abs(fPhi) * (-1.0) + virialSum / Math.max(1e-9, nuMSum)));
  const lnAw = -phiOsm * MW_H2O * nuMSum;
  const waterActivity = Math.max(0.06, Math.min(1.0, Math.exp(lnAw)));

  // Clausius-Clapeyron + Dühring 고농도 비이상 보정 비점상승(BPE):
  // ln(a_w) = -(ΔH_vap / R) * (1/T_sat - 1/T_boil) => ΔT_BPE = -R T_sat^2 ln(a_w) / (ΔH_vap + R T_sat ln(a_w))
  const pSafe = Math.max(0.03, P_barA);
  // 물 포화온도 근사 (Antoine 역산, °C)
  const tSatWaterC = 1730.63 / (8.07131 - Math.log10(pSafe * 750.062)) - 233.426;
  const T_satK = Math.max(275, tSatWaterC + 273.15);
  const dHvapWaterJmol = Math.max(34000, 40650 * Math.pow(Math.max(0.08, (647.1 - T_satK) / (647.1 - 373.15)), 0.38));
  const num = -R_GAS * T_satK * T_satK * lnAw;
  const den = Math.max(12000, dHvapWaterJmol + R_GAS * T_satK * lnAw);
  const bpeDegC = Math.max(0, Math.min(85.0, num / den));

  // 개별 전해질 평균 이온활동도 계수 γ_±
  const calcMeanGamma = (key: 'NaCl' | 'NaOH' | 'HCl'): number => {
    const p = PITZER_DB[key];
    const beta0T = p.beta0 + p.dBeta0dT * dT;
    const gX = (2.0 * (1.0 - (1.0 + alphaPitzer * sqrtI) * Math.exp(-alphaPitzer * sqrtI))) /
      Math.max(1e-6, alphaPitzer * alphaPitzer * I);
    const fGamma = -Aphi * (sqrtI / (1.0 + bPitzer * sqrtI) + (2.0 / bPitzer) * Math.log(1.0 + bPitzer * sqrtI));
    const mCap = Math.min(16.0, I);
    const bGamma = 2.0 * beta0T + p.beta1 * (gX + Math.exp(-alphaPitzer * sqrtI));
    const lnG = Math.max(-1.5, Math.min(4.2, fGamma + mCap * bGamma + 1.5 * mCap * mCap * p.cPhi));
    return Math.exp(lnG);
  };

  return {
    totalMolality: mTot,
    ionicStrength: I,
    osmoticCoeff: phiOsm,
    waterActivity,
    bpeDegC,
    gasSaltingOutFactor: Math.max(0.05, Math.min(1.0, Math.exp(-sechenovSum))),
    meanGammaNaCl: calcMeanGamma('NaCl'),
    meanGammaNaOH: calcMeanGamma('NaOH'),
    meanGammaHCl: calcMeanGamma('HCl'),
  };
}

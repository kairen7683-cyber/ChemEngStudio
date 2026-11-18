// ============================================================================
// 범용 화학 반응기 엔진 검증 스위트 (Universal Chemical Reactor Validation — W6)
// 실행: npx.cmd tsx scripts/validation/reactorValidation.ts
// ============================================================================

import {
  solveChemicalReactor,
  checkStoichiometryBalance,
  calcReactionStdThermo,
  INDUSTRIAL_REACTION_TEMPLATES,
  ALL_REACTOR_COMPS,
  type ReactorConfig,
} from '../../lib/calculations/chemicalReactor';
import { MW } from '../../lib/calculations/constants';
import { streamEnthalpyKcalH } from '../../lib/calculations/thermoCore';
import { RIGOROUS_CRIT, calcPengRobinsonMixture } from '../../lib/calculations/rigorousThermo';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';

interface CheckRecord {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckRecord[] = [];

function recordCheck(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name} — ${detail}`);
}

function sumMass(flows: Partial<Record<SimCompKey, number>>): number {
  let s = 0;
  for (const k of ALL_REACTOR_COMPS) s += flows[k] ?? 0;
  return s;
}

// ── Test 1: 산업 반응 템플릿 및 양론 원소 균형 검증 ──────────────────────
{
  const countOk = INDUSTRIAL_REACTION_TEMPLATES.length >= 14;
  let allBalanced = true;
  const badIds: string[] = [];

  for (const tpl of INDUSTRIAL_REACTION_TEMPLATES) {
    for (const rxn of tpl.defaultConfig.reactions ?? []) {
      const bal = checkStoichiometryBalance(rxn.stoic);
      if (!bal.balanced) {
        allBalanced = false;
        badIds.push(`${tpl.id}:${rxn.id}(dMW=${bal.mwResidualGmol})`);
      }
    }
  }

  const unbal = checkStoichiometryBalance({ CH4: -1, O2: -1, CO2: 1, H2O: 2 });
  const detectUnbal = !unbal.balanced && Math.abs(unbal.elementResiduals.O ?? 0) === 2;

  recordCheck(
    `1. ${INDUSTRIAL_REACTION_TEMPLATES.length} Industrial Reaction Templates & Elemental Balance Check`,
    countOk && allBalanced && detectUnbal,
    `templates=${INDUSTRIAL_REACTION_TEMPLATES.length}, allBalanced=${allBalanced}${
      badIds.length ? ' [' + badIds.join(', ') + ']' : ''
    }, unbalancedDetection=${detectUnbal}`
  );
}

// ── Test 2: NIST Water-Gas Shift Keq(700 K) 검증 (<8% 오차) ───────────────────
{
  const T_C = 700 - 273.15; // 426.85 °C
  const P_1bar_kgcm2g = 1.0 / 0.980665 - 1.03323;
  const wgsRxn = {
    id: 'WGS',
    stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 } as Partial<Record<SimCompKey, number>>,
    keyComp: 'CO' as SimCompKey,
  };
  const std700 = calcReactionStdThermo(wgsRxn, T_C, 'vapor');
  // NIST WebBook / Moe 상관식 기준 WGS Keq(700 K) ≈ 9.02
  const nistKeq700 = 9.02;
  const relErrPct = (Math.abs(std700.Keq - nistKeq700) / nistKeq700) * 100;

  const eqRes = solveChemicalReactor(
    { CO: 100 * MW.CO, H2O: 100 * MW.H2O },
    T_C,
    P_1bar_kgcm2g,
    {
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: T_C,
      operPressKgcm2g: P_1bar_kgcm2g,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [wgsRxn],
    }
  );
  const xSim = eqRes.keyConversions.CO ?? 0;
  const xExact = Math.sqrt(std700.Keq) / (1 + Math.sqrt(std700.Keq));
  const convDiffPct = Math.abs(xSim - xExact) * 100;

  recordCheck(
    '2. WGS NIST Keq(700 K) & Equimolar Conversion',
    relErrPct < 8.0 && convDiffPct < 0.5 && eqRes.converged,
    `Keq_sim=${std700.Keq.toFixed(4)} vs NIST=${nistKeq700} (err=${relErrPct.toFixed(2)}%), X_CO=${xSim.toFixed(4)} vs ideal=${xExact.toFixed(4)}`
  );
}

// ── Test 3: WGS Gibbs 최소화 vs 화학평형 일치도 (<0.5%) ────────────────────────
{
  const feed: Partial<Record<SimCompKey, number>> = {
    CO: 100 * MW.CO,
    H2O: 150 * MW.H2O,
    N2: 50 * MW.N2,
  };
  const T_C = 450;
  const P_g = 20;

  const resEq = solveChemicalReactor(feed, T_C, P_g, {
    model: 'equilibrium',
    thermalMode: 'isothermal',
    operTempC: T_C,
    operPressKgcm2g: P_g,
    phaseMode: 'vapor',
    propertyMethod: 'PR',
    reactions: [{ id: 'WGS', stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 }, keyComp: 'CO' }],
  });

  const resGibbs = solveChemicalReactor(feed, T_C, P_g, {
    model: 'gibbs',
    thermalMode: 'isothermal',
    operTempC: T_C,
    operPressKgcm2g: P_g,
    phaseMode: 'vapor',
    propertyMethod: 'PR',
    gibbsSpeciesPool: ['CO', 'H2O', 'CO2', 'H2'],
    gibbsInertSet: ['N2'],
  });

  const xEq = resEq.keyConversions.CO ?? 0;
  const xGb = resGibbs.keyConversions.CO ?? 0;
  const relDiffPct = (Math.abs(xEq - xGb) / Math.max(1e-9, xEq)) * 100;

  recordCheck(
    '3. Gibbs vs Equilibrium Agreement on WGS (with Inert N2)',
    resEq.converged && resGibbs.converged && relDiffPct < 0.5,
    `X_CO(Equil)=${xEq.toFixed(6)}, X_CO(Gibbs)=${xGb.toFixed(6)}, relDiff=${relDiffPct.toFixed(4)}%`
  );
}

// ── Test 4: SMR + WGS 다중 반응 평형 vs Gibbs 자유에너지 최소화 일치도 (<0.5%) ─
{
  const feed: Partial<Record<SimCompKey, number>> = {
    CH4: 100 * MW.CH4,
    H2O: 300 * MW.H2O,
  };
  const T_C = 850;
  const P_g = 20;

  const resEq = solveChemicalReactor(feed, T_C, P_g, {
    model: 'equilibrium',
    thermalMode: 'isothermal',
    operTempC: T_C,
    operPressKgcm2g: P_g,
    phaseMode: 'vapor',
    propertyMethod: 'SRK',
    reactions: [
      { id: 'SMR', stoic: { CH4: -1, H2O: -1, CO: 1, H2: 3 }, keyComp: 'CH4' },
      { id: 'WGS', stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 }, keyComp: 'CO' },
    ],
  });

  const resGibbs = solveChemicalReactor(feed, T_C, P_g, {
    model: 'gibbs',
    thermalMode: 'isothermal',
    operTempC: T_C,
    operPressKgcm2g: P_g,
    phaseMode: 'vapor',
    propertyMethod: 'SRK',
    gibbsSpeciesPool: ['CH4', 'H2O', 'CO', 'CO2', 'H2'],
  });

  const h2Eq = resEq.outletFlowsKgH.H2 / MW.H2;
  const h2Gb = resGibbs.outletFlowsKgH.H2 / MW.H2;
  const ch4ConvEq = resEq.keyConversions.CH4 ?? 0;
  const ch4ConvGb = resGibbs.keyConversions.CH4 ?? 0;
  const h2RelDiffPct = (Math.abs(h2Eq - h2Gb) / Math.max(1e-9, h2Eq)) * 100;
  const convDiffPct = (Math.abs(ch4ConvEq - ch4ConvGb) / Math.max(1e-9, ch4ConvEq)) * 100;

  recordCheck(
    '4. Multi-Reaction SMR+WGS Equilibrium vs Gibbs Agreement',
    resEq.converged && resGibbs.converged && h2RelDiffPct < 0.5 && convDiffPct < 0.5,
    `X_CH4(Eq=${ch4ConvEq.toFixed(5)}, Gibbs=${ch4ConvGb.toFixed(5)}), H2_kmolH(Eq=${h2Eq.toFixed(3)}, Gibbs=${h2Gb.toFixed(3)}, diff=${h2RelDiffPct.toFixed(4)}%)`
  );
}

// ── Test 5: 고압 암모니아 합성 압력/퓨개시티 효과 (SRK EOS) ────────────────────
{
  const feed: Partial<Record<SimCompKey, number>> = {
    N2: 100 * MW.N2,
    H2: 300 * MW.H2,
  };
  const baseCfg: ReactorConfig = {
    model: 'equilibrium',
    thermalMode: 'isothermal',
    operTempC: 450,
    phaseMode: 'vapor',
    propertyMethod: 'SRK',
    reactions: [{ id: 'NH3', stoic: { N2: -1, H2: -3, NH3: 2 }, keyComp: 'N2' }],
  };
  const lowP = solveChemicalReactor(feed, 450, 30, { ...baseCfg, operPressKgcm2g: 30 });
  const highP = solveChemicalReactor(feed, 450, 200, { ...baseCfg, operPressKgcm2g: 200 });

  const xLow = lowP.keyConversions.N2 ?? 0;
  const xHigh = highP.keyConversions.N2 ?? 0;

  recordCheck(
    '5. High-Pressure NH3 Synthesis SRK Fugacity & Le Chatelier Response',
    lowP.converged && highP.converged && xHigh > xLow * 2.2 && xHigh > 0.25 && xHigh < 0.65,
    `X_N2(30 kg/cm2g)=${(xLow * 100).toFixed(2)}% -> X_N2(200 kg/cm2g)=${(xHigh * 100).toFixed(2)}%`
  );
}

// ── Test 6: 초산에틸 비이상 액상 에스테르화 평형 (NRTL γ_i) ──────────────────
{
  const feed: Partial<Record<SimCompKey, number>> = {
    AceticAcid: 100 * MW.AceticAcid,
    EtOH: 100 * MW.EtOH,
  };
  const res = solveChemicalReactor(feed, 75, 1.0, {
    model: 'equilibrium',
    thermalMode: 'isothermal',
    operTempC: 75,
    operPressKgcm2g: 1.0,
    phaseMode: 'liquid',
    propertyMethod: 'NRTL',
    reactions: [
      {
        id: 'ETOAC',
        stoic: { AceticAcid: -1, EtOH: -1, EtOAc: 1, H2O: 1 },
        keyComp: 'AceticAcid',
      },
    ],
  });

  const xConv = res.keyConversions.AceticAcid ?? 0;
  const nEtOAc = res.outletFlowsKgH.EtOAc / MW.EtOAc;
  const nHOAc = res.outletFlowsKgH.AceticAcid / MW.AceticAcid;
  const Kx = (nEtOAc * nEtOAc) / Math.max(1e-9, nHOAc * nHOAc);

  recordCheck(
    '6. Liquid-Phase EtOAc Esterification NRTL Activity Equilibrium',
    res.converged && xConv > 0.55 && xConv < 0.80 && Kx > 1.5 && Kx < 16.0,
    `X_AceticAcid=${(xConv * 100).toFixed(2)}%, apparent Kx=${Kx.toFixed(3)}, Ka=${(res.equilibriumConstants?.ETOAC ?? 0).toFixed(3)}`
  );
}

// ── Test 7: 무수 염산 단열 합성 버너 열수지 정밀 검증 (<0.05% 잔차) ───────────
{
  const feed: Partial<Record<SimCompKey, number>> = {
    H2: 120 * MW.H2,
    Cl2: 100 * MW.Cl2,
    N2: 330 * MW.N2, // 출구 온도를 <1200°C 내로 유지하여 streamEnthalpyKcalH 와 직접 대조
  };
  const T_in = 40;
  const P_in = 1.5;

  const res = solveChemicalReactor(feed, T_in, P_in, {
    model: 'stoic',
    thermalMode: 'adiabatic',
    operPressKgcm2g: P_in,
    phaseMode: 'vapor',
    propertyMethod: 'PR',
    reactions: [{ id: 'HCL', stoic: { H2: -1, Cl2: -1, HCl: 2 }, keyComp: 'Cl2', conversion: 1.0 }],
  });

  const H_in = streamEnthalpyKcalH(feed, {}, T_in, P_in);
  const H_out = streamEnthalpyKcalH(res.vapFlowsKgH, res.liqFlowsKgH, res.outletTempC, res.outletPressKgcm2g);
  const rxnHeatKcal = (100 * 184620) / 4.1868;
  const relEnthalpyErrPct = (Math.abs(H_out - H_in) / rxnHeatKcal) * 100;
  const dH298 = res.reactionEnthalpy298KJmol[0];

  recordCheck(
    '7. Adiabatic HCl Synthesis Burner Enthalpy Conservation (<0.05%)',
    res.converged &&
      Math.abs(dH298 - -184.62) < 0.2 &&
      res.outletTempC > 850 &&
      res.outletTempC < 1220 &&
      relEnthalpyErrPct < 0.05,
    `dH298=${dH298.toFixed(2)} kJ/mol, T_out=${res.outletTempC.toFixed(2)} °C, |H_out-H_in|/Q_rxn=${relEnthalpyErrPct.toFixed(5)}%`
  );
}

// ── Test 8: 해석해 CSTR 1차 등온 반응 X = Da / (1 + Da) (<0.2% 오차) ──────────
{
  const T_C = 400 - 273.15; // 126.85 °C
  const P_barA = 1.0;
  const P_g = P_barA / 0.980665 - 1.03323;
  const F_A0 = 50; // kmol/h nC4H10 (희석 N2 950 kmol/h 로 Z -> 1.0 보장)
  const F_N2 = 950;
  const feed: Partial<Record<SimCompKey, number>> = {
    nC4H10: F_A0 * MW.nC4H10,
    N2: F_N2 * MW.N2,
  };

  // 실제 Z 보정 포함 정확한 체류시간 τ 산출
  const yMix = { nC4H10: 0.05, N2: 0.95 } as Record<SimCompKey, number>;
  const Z = calcPengRobinsonMixture(yMix, T_C, P_g, P_barA).Z_vap;
  const volFlowM3S = ((F_A0 + F_N2) * Z * 0.08314462618 * 400) / P_barA / 3600;
  const V_m3 = 5.0;
  const tauS = V_m3 / volFlowM3S;

  let maxRelPct = 0;
  const details: string[] = [];
  for (const Da of [0.5, 1.5, 4.0]) {
    const k = Da / tauS; // 1/s
    const res = solveChemicalReactor(feed, T_C, P_g, {
      model: 'cstr',
      thermalMode: 'isothermal',
      operTempC: T_C,
      operPressKgcm2g: P_g,
      volumeM3: V_m3,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'ISOM',
          stoic: { nC4H10: -1, iC4H10: 1 },
          keyComp: 'nC4H10',
          k0Forward: k,
          EaForwardKJmol: 0,
        },
      ],
    });
    const xSim = res.keyConversions.nC4H10 ?? 0;
    const xExact = Da / (1 + Da);
    const errPct = (Math.abs(xSim - xExact) / xExact) * 100;
    if (errPct > maxRelPct) maxRelPct = errPct;
    details.push(`Da=${Da}: sim=${xSim.toFixed(5)} vs exact=${xExact.toFixed(5)}`);
  }

  recordCheck(
    '8. Analytical CSTR Conversion X = Da/(1+Da) (<0.2%)',
    maxRelPct < 0.2,
    `maxErr=${maxRelPct.toFixed(5)}% (${details.join(' | ')})`
  );
}

// ── Test 9: 해석해 PFR 1차 등온 반응 X = 1 - exp(-Da) (<0.2% 오차) ────────────
{
  const T_C = 400 - 273.15;
  const P_barA = 1.0;
  const P_g = P_barA / 0.980665 - 1.03323;
  const F_A0 = 50;
  const F_N2 = 950;
  const feed: Partial<Record<SimCompKey, number>> = {
    nC4H10: F_A0 * MW.nC4H10,
    N2: F_N2 * MW.N2,
  };
  const yMix = { nC4H10: 0.05, N2: 0.95 } as Record<SimCompKey, number>;
  const Z = calcPengRobinsonMixture(yMix, T_C, P_g, P_barA).Z_vap;
  const volFlowM3S = ((F_A0 + F_N2) * Z * 0.08314462618 * 400) / P_barA / 3600;
  const V_m3 = 5.0;
  const tauS = V_m3 / volFlowM3S;

  let maxRelPct = 0;
  let profileLen = 0;
  for (const Da of [0.5, 1.5, 3.0]) {
    const k = Da / tauS;
    const res = solveChemicalReactor(feed, T_C, P_g, {
      model: 'pfr',
      thermalMode: 'isothermal',
      operTempC: T_C,
      operPressKgcm2g: P_g,
      volumeM3: V_m3,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'ISOM_PFR',
          stoic: { nC4H10: -1, iC4H10: 1 },
          keyComp: 'nC4H10',
          k0Forward: k,
          EaForwardKJmol: 0,
        },
      ],
    });
    profileLen = res.axialProfile?.length ?? 0;
    const xSim = res.keyConversions.nC4H10 ?? 0;
    const xExact = 1 - Math.exp(-Da);
    const errPct = (Math.abs(xSim - xExact) / xExact) * 100;
    if (errPct > maxRelPct) maxRelPct = errPct;
  }

  recordCheck(
    '9. Analytical PFR 60-Step RK4 Conversion X = 1 - exp(-Da) (<0.2%)',
    maxRelPct < 0.2 && profileLen === 61,
    `maxErr=${maxRelPct.toFixed(5)}%, axialNodes=${profileLen}`
  );
}

// ── Test 10: 충전층 Ergun 방정식 압력강하 교과서 해석해 대조 ──────────────────
{
  const T_C = 226.85; // 500 K
  const T_K = 500;
  const P_barA = 30.0;
  const P_g = P_barA / 0.980665 - 1.03323;
  const nN2_kmolH = 200;
  const feed: Partial<Record<SimCompKey, number>> = { N2: nN2_kmolH * MW.N2 };

  const D = 0.50; // m (ΔP << P_in 조건 & 압축성 Ergun 적분해 동시 대조)
  const L = 4.0; // m
  const dp = 0.005; // 5 mm
  const eps = 0.4;

  const res = solveChemicalReactor(feed, T_C, P_g, {
    model: 'pfr',
    thermalMode: 'isothermal',
    operTempC: T_C,
    operPressKgcm2g: P_g,
    tubeCount: 1,
    tubeDiamM: D,
    tubeLengthM: L,
    catalystVoidage: eps,
    particleDiamMm: 5.0,
    phaseMode: 'vapor',
    propertyMethod: 'PR',
    reactions: [],
  });

  // 교과서 압축성 기체 Ergun 엄밀 적분해: P_in^2 - P_out^2 = 2 * P_in * ΔP_incomp(P_in)
  const yN2 = { N2: 1 } as Record<SimCompKey, number>;
  const Z = calcPengRobinsonMixture(yN2, T_C, P_g, P_barA).Z_vap;
  const Ac = (Math.PI / 4) * D * D;
  const volM3S = (nN2_kmolH * Z * 0.08314462618 * T_K) / P_barA / 3600;
  const us = volM3S / Ac;
  const rho = (nN2_kmolH * MW.N2) / 3600 / volM3S;

  const crit = RIGOROUS_CRIT.N2;
  const Tr = T_K / crit.Tc_K;
  const xi = 0.176 * Math.pow(crit.Tc_K / (Math.pow(MW.N2, 3) * Math.pow(crit.Pc_bar, 4)), 1 / 6);
  const fp0 =
    0.807 * Math.pow(Tr, 0.618) - 0.357 * Math.exp(-0.449 * Tr) + 0.34 * Math.exp(-4.058 * Tr) + 0.018;
  const mu = (fp0 / xi) * 1e-7;

  const dP_incomp_bar =
    (((150 * mu * (1 - eps) ** 2 * us) / (dp ** 2 * eps ** 3) +
      (1.75 * rho * (1 - eps) * us ** 2) / (dp * eps ** 3)) *
      L) *
    1e-5;
  const dP_bar_exact = P_barA - Math.sqrt(Math.max(0, P_barA * P_barA - 2 * P_barA * dP_incomp_bar));
  const relErrPct = (Math.abs(res.pressureDropBar - dP_bar_exact) / dP_bar_exact) * 100;

  recordCheck(
    '10. Packed-Bed Ergun Pressure Drop Textbook Verification',
    res.pressureDropBar > 0.02 && relErrPct < 1.5,
    `dP_sim=${res.pressureDropBar.toFixed(5)} bar vs dP_Ergun=${dP_bar_exact.toFixed(5)} bar (err=${relErrPct.toFixed(3)}%)`
  );
}

// ── Test 11: 다관식 냉각 PFR 발열 Hotspot 형성 및 열전달 검증 ─────────────────
{
  const cumeneTpl = INDUSTRIAL_REACTION_TEMPLATES.find((t) => t.id === 'cumene_alkylation')!;
  const feed: Partial<Record<SimCompKey, number>> = {
    Benzene: 180 * MW.Benzene,
    C3H6: 60 * MW.C3H6,
  };
  const res = solveChemicalReactor(feed, 320, 24, cumeneTpl.defaultConfig);
  const hot = res.hotspotTempC ?? 0;

  recordCheck(
    '11. Jacketed Multi-Tube PFR Hotspot & Cooling Duty',
    res.converged &&
      hot > 320.5 &&
      hot >= res.outletTempC &&
      res.heatDutyKcalH < 0 &&
      res.pressureDropBar > 0,
    `T_in=320 °C -> T_hotspot=${hot.toFixed(2)} °C -> T_out=${res.outletTempC.toFixed(2)} °C, Q=${res.heatDutyKcalH.toFixed(0)} kcal/h, dP=${res.pressureDropBar.toFixed(3)} bar`
  );
}

// ── Test 12: 5종 전체 반응기 모델 질량 및 원소 보존 (<1e-8) ──────────────────
{
  const feed: Partial<Record<SimCompKey, number>> = {
    CO: 80 * MW.CO,
    H2O: 120 * MW.H2O,
    CH4: 40 * MW.CH4,
    N2: 30 * MW.N2,
  };
  const configs: ReactorConfig[] = [
    {
      model: 'stoic',
      thermalMode: 'adiabatic',
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [{ id: 'R1', stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 }, keyComp: 'CO', conversion: 0.7 }],
    },
    {
      model: 'equilibrium',
      thermalMode: 'adiabatic',
      phaseMode: 'vapor',
      propertyMethod: 'SRK',
      reactions: [
        { id: 'SMR', stoic: { CH4: -1, H2O: -1, CO: 1, H2: 3 }, keyComp: 'CH4' },
        { id: 'WGS', stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 }, keyComp: 'CO' },
      ],
    },
    {
      model: 'gibbs',
      thermalMode: 'adiabatic',
      phaseMode: 'vapor',
      propertyMethod: 'SRK',
      gibbsSpeciesPool: ['CH4', 'H2O', 'CO', 'CO2', 'H2'],
      gibbsInertSet: ['N2'],
    },
    {
      model: 'cstr',
      thermalMode: 'jacket_ua',
      volumeM3: 3.0,
      jacketTempC: 400,
      overallU_KcalM2HC: 200,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'WGS_KIN',
          stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
          k0Forward: 1.2e3,
          EaForwardKJmol: 55,
          reversible: true,
        },
      ],
    },
    {
      model: 'pfr',
      thermalMode: 'jacket_ua',
      tubeCount: 40,
      tubeDiamM: 0.06,
      tubeLengthM: 4.0,
      jacketTempC: 380,
      overallU_KcalM2HC: 180,
      particleDiamMm: 5.0,
      catalystVoidage: 0.42,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'WGS_PFR',
          stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
          k0Forward: 1.5e3,
          EaForwardKJmol: 55,
          reversible: true,
        },
      ],
    },
  ];

  let maxAtomErr = 0;
  let maxMassErr = 0;
  let maxExtMassErr = 0;
  let allConv = true;
  const massIn = sumMass(feed);

  for (const cfg of configs) {
    const r = solveChemicalReactor(feed, 520, 15, cfg);
    if (!r.converged) allConv = false;
    if (r.atomBalanceMaxRelErr > maxAtomErr) maxAtomErr = r.atomBalanceMaxRelErr;
    if (r.massBalanceRelErr > maxMassErr) maxMassErr = r.massBalanceRelErr;
    const extErr = Math.abs(sumMass(r.outletFlowsKgH) - massIn) / massIn;
    if (extErr > maxExtMassErr) maxExtMassErr = extErr;
  }

  recordCheck(
    '12. Mass & Elemental Conservation Across All 5 Models (<1e-8)',
    allConv && maxAtomErr < 1e-8 && maxMassErr < 1e-8 && maxExtMassErr < 1e-8,
    `allConverged=${allConv}, maxAtomRelErr=${maxAtomErr.toExponential(3)}, maxMassRelErr=${maxMassErr.toExponential(3)}`
  );
}

// ── 최종 결과 요약 및 종료 코드 ───────────────────────────────────────────────
const passedCount = results.filter((r) => r.passed).length;
console.log(`\n============================================================`);
console.log(`Universal Chemical Reactor Validation: ${passedCount}/${results.length} PASSED`);
console.log(`============================================================`);

if (passedCount !== results.length) {
  process.exit(1);
}
process.exit(0);

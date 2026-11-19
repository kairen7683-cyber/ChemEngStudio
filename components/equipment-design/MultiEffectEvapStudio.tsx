'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  waterSatTemp_C,
  calcNaOHBPR_C,
  naohDensity_kgm3,
  naohSpecificHeat_kJkgK,
  FallingFilmDesignInputs,
  FallingFilmDesignResults,
  calcFallingFilmEvaporator,
  drawFallingFilmBlueprintCanvas,
} from '@/lib/calculations/evaporator';
import { usePFDStore } from '@/lib/stores/pfdStore';
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';

export type EffectCount = 1 | 2 | 3;

interface EvapStageCalc {
  effectNo: number;          // 1, 2, 3
  evapTag: string;           // E-320, E-330, E-340
  bcplTag: string;           // E-5320, E-5330, E-5340
  sepTag: string;            // D-321, D-331, D-341
  pumpTag: string;           // P-321A/B, P-331A/B, P-341A/B
  preheaterTag: string;      // E-332, E-342, -
  serviceName: string;
  wtIn_pct: number;
  wtOut_pct: number;
  feedFlow_kgh: number;
  outFlow_kgh: number;
  evapWater_kgh: number;
  heatingSteam_kgh: number;
  P_shell_kgcm2g: number;
  T_steam_C: number;
  P_tube_kgcm2g: number;
  P_tube_barA: number;
  T_sat_water_C: number;
  BPR_C: number;
  T_boil_C: number;
  dT_eff_C: number;
  T_feed_C: number;
  Q_duty_kW: number;
  Q_duty_Mcalh: number;
  material: 'Nickel 200' | 'SS 310S / 316L';
  designInputs: FallingFilmDesignInputs;
  designResults: FallingFilmDesignResults;
}

interface EvapStreamRow {
  id: string;
  name: string;
  phase: 'L' | 'V';
  total_kgh: number;
  naoh_kgh: number;
  h2o_kgh: number;
  wt_pct: number;
  temp_C: number;
  press_kgcm2g: number;
  density_kgm3: number;
  enthalpy_Mcalh: number;
  lineSize_NPS: string;
  serviceDesc: string;
}

interface EvapEquipRow {
  tag: string;
  name: string;
  category: 'EVAP' | 'SEP' | 'HEX' | 'COND' | 'PUMP' | 'VAC';
  effectNo?: number;
  fluid: string;
  dutyOrFlow: string;
  areaOrPower: string;
  dimensions: string;
  operTemp_C: string;
  operPress: string;
  designTemp_C: string;
  designPress: string;
  material: string;
  nozzles: string;
  remarks: string;
}

function selectPipeNPS(flow_kgh: number, rho_kgm3: number, isVapor: boolean): string {
  const Q_m3s = Math.max(1e-5, flow_kgh / (Math.max(0.05, rho_kgm3) * 3600));
  const v_target = isVapor ? (rho_kgm3 < 0.3 ? 38.0 : 25.0) : 1.65;
  const d_mm = Math.sqrt((4 * Q_m3s) / (Math.PI * v_target)) * 1000;
  const std = [
    { nps: '1-1/2"', id: 40.9 },
    { nps: '2"', id: 52.5 },
    { nps: '2-1/2"', id: 62.7 },
    { nps: '3"', id: 77.9 },
    { nps: '4"', id: 102.3 },
    { nps: '6"', id: 154.1 },
    { nps: '8"', id: 202.7 },
    { nps: '10"', id: 254.5 },
    { nps: '12"', id: 304.8 },
    { nps: '14"', id: 333.4 },
    { nps: '16"', id: 381.0 },
    { nps: '18"', id: 428.6 },
    { nps: '20"', id: 477.8 },
    { nps: '24"', id: 574.6 },
    { nps: '28"', id: 685.8 },
    { nps: '32"', id: 787.4 },
    { nps: '36"', id: 889.0 },
  ];
  const hit = std.find(s => s.id >= d_mm) ?? std[std.length - 1];
  return `NPS ${hit.nps}`;
}

export default function MultiEffectEvapStudio() {
  const setEquipmentSpecOverride = usePFDStore(s => s.setEquipmentSpecOverride);

  // ─── 1. 운전 캐파 및 공정 조건 State ─────────────────────────
  const [capacityMTPD, setCapacityMTPD] = useState<number>(514.3); // 100% Dry NaOH 기준 일산 톤수 (MTPD)
  const [effectCount, setEffectCount] = useState<EffectCount>(3);  // 1중 / 2중 / 3중 효용관 선택
  const [wtIn, setWtIn] = useState<number>(32.0);                  // 입구 NaOH 농도 (wt%)
  const [wtOut, setWtOut] = useState<number>(50.0);                // 제품 목표 NaOH 농도 (wt%)
  const [feedTempC, setFeedTempC] = useState<number>(90.0);        // 급액 입구 온도 (°C)
  const [steamPressG, setSteamPressG] = useState<number>(8.35);    // 가열 스팀 압력 (kg/cm²G)
  const [vacPressG, setVacPressG] = useState<number>(-0.94);       // 최종 효용 진공 압력 (kg/cm²G)
  const [cwInTempC, setCwInTempC] = useState<number>(32.0);        // 냉각수 입구 온도 (°C)
  const [cwOutTempC, setCwOutTempC] = useState<number>(40.0);      // 냉각수 출구 온도 (°C)

  // ─── 2. 뷰 탭 및 선택 장치 State ──────────────────────────────
  const [activeSection, setActiveSection] = useState<'all' | 'pfd' | 'streams' | 'equip' | 'datasheet'>('all');
  const [selectedEquipTag, setSelectedEquipTag] = useState<string>('E-320');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [flowUnit, setFlowUnit] = useLocalUnit('massFlow');
  const [tempUnit, setTempUnit] = useLocalUnit('temp');
  const [pressUnit, setPressUnit] = useLocalUnit('pressG');
  const [densUnit, setDensUnit] = useLocalUnit('density');
  const [dutyUnit, setDutyUnit] = useLocalUnit('heatDuty');
  const [areaUnit, setAreaUnit] = useLocalUnit('area');

  const pfdCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dwgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ─── 3. 1·2·3중 효용 통합 물질·열수지 및 장치 사이징 엔진 ─────────
  const simData = useMemo(() => {
    const capTonDay = Math.max(10, Math.min(5000, capacityMTPD));
    const naohPure_kgh = +(capTonDay * 1000 / 24).toFixed(2);
    const wIn = Math.max(10, Math.min(45, wtIn));
    const wOut = Math.max(wIn + 2, Math.min(55, wtOut));

    const feedFlow_kgh = +(naohPure_kgh / (wIn / 100)).toFixed(2);
    const prodFlow_kgh = +(naohPure_kgh / (wOut / 100)).toFixed(2);
    const totalEvap_kgh = +(feedFlow_kgh - prodFlow_kgh).toFixed(2);

    const P_steam_barA = Math.max(2.0, (steamPressG + 1.0332) * 0.980665);
    const T_steam_sat_C = +waterSatTemp_C(P_steam_barA).toFixed(1);
    const P_vac_barA = Math.max(0.06, Math.min(1.0, (vacPressG + 1.0332) * 0.980665));

    const stages: EvapStageCalc[] = [];

    if (effectCount === 1) {
      // ── 1중 효용관 (Single-Effect: E-320 단독) ──
      // 진공 또는 저압 운전으로 32% -> 50% 직접 농축
      const P_tube_barA = Math.max(0.15, P_vac_barA * 1.8);
      const P_tube_kgcm2g = +(P_tube_barA / 0.980665 - 1.0332).toFixed(2);
      const T_sat_w = waterSatTemp_C(P_tube_barA);
      const BPR = calcNaOHBPR_C(wOut, T_sat_w);
      const T_boil = +(T_sat_w + BPR).toFixed(1);
      const dT_eff = Math.max(6.0, +(T_steam_sat_C - T_boil).toFixed(1));
      const T_feed_preheated = Math.min(T_boil - 3, +(feedTempC + (T_boil - feedTempC) * 0.55).toFixed(1));

      const dIn: FallingFilmDesignInputs = {
        tag: 'E-320',
        bcplItemNo: 'E-5320 (1-MEE)',
        docNo: 'SPE-300-1MEE-01',
        effectNo: 1,
        serviceName: 'Single-Effect Falling Film Evaporator (단일효용 강하막 증발관)',
        feedFlow_kgh,
        evapWater_kgh: totalEvap_kgh,
        wtIn_pct: wIn,
        wtOut_pct: wOut,
        P_shell_kgcm2g: steamPressG,
        P_shell_barA: P_steam_barA,
        T_steam_in_C: T_steam_sat_C,
        T_steam_C: T_steam_sat_C,
        P_tube_kgcm2g,
        P_tube_barA_spec: P_tube_barA,
        T_feed_C: T_feed_preheated,
        do_mm: 48.3,
        tw_mm: 2.11,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: 0, // 캐파 비례 자동 산출
        targetWettingRate_kgms: 0.95,
        overdesignPct: 15,
        fouling_m2KW: 0.00018,
        material: 'Nickel 200',
        designTempTube_C: 180,
        designTempShell_C: 200,
        designPressTube_bar: '-1.0/+3.5',
        designPressShell_bar: '-1.0/+10.0',
        matTubeSpec: 'Low-Carbon Nickel 201 (UNS N02201)',
        matTubesheetSpec: 'CS + LC-Ni 201 Clad',
        matShellSpec: 'SA-516 Gr.70',
        matChannelSpec: 'LC-Nickel 201',
        matSeparatorSpec: 'LC-Nickel 201 Clad',
        matDemisterSpec: 'Nickel 200 Wire Mesh (150 mm)',
      };
      const dRes = calcFallingFilmEvaporator(dIn);
      stages.push({
        effectNo: 1,
        evapTag: 'E-320',
        bcplTag: 'E-5320',
        sepTag: 'D-321',
        pumpTag: 'P-321A/B',
        preheaterTag: 'E-332',
        serviceName: dIn.serviceName,
        wtIn_pct: wIn,
        wtOut_pct: wOut,
        feedFlow_kgh,
        outFlow_kgh: prodFlow_kgh,
        evapWater_kgh: totalEvap_kgh,
        heatingSteam_kgh: dRes.heatingSteamReq_kgh,
        P_shell_kgcm2g: steamPressG,
        T_steam_C: T_steam_sat_C,
        P_tube_kgcm2g,
        P_tube_barA,
        T_sat_water_C: +T_sat_w.toFixed(1),
        BPR_C: BPR,
        T_boil_C: T_boil,
        dT_eff_C: dT_eff,
        T_feed_C: T_feed_preheated,
        Q_duty_kW: dRes.Q_total_kW,
        Q_duty_Mcalh: dRes.Q_total_Mcalh,
        material: 'Nickel 200',
        designInputs: dIn,
        designResults: dRes,
      });
    } else if (effectCount === 2) {
      // ── 2중 효용관 (Double-Effect Backward-Feed: 2효 E-330 -> 1효 E-320) ──
      const V2_kgh = +(totalEvap_kgh * 0.51).toFixed(2);
      const V1_kgh = +(totalEvap_kgh - V2_kgh).toFixed(2);
      const L_mid_kgh = +(feedFlow_kgh - V2_kgh).toFixed(2);
      const wt_mid = +(naohPure_kgh / L_mid_kgh * 100).toFixed(2);

      // 2효 (진공측)
      const P2_barA = P_vac_barA;
      const P2_kgcm2g = vacPressG;
      const T2_sat_w = waterSatTemp_C(P2_barA);
      const BPR2 = calcNaOHBPR_C(wt_mid, T2_sat_w);
      const T2_boil = +(T2_sat_w + BPR2).toFixed(1);

      // 1효 (중간압력: 1효 발생증기 V1 포화온도가 2효 가열원이 됨)
      const P1_barA = Math.max(P2_barA + 0.5, 1.15);
      const P1_kgcm2g = +(P1_barA / 0.980665 - 1.0332).toFixed(2);
      const T1_sat_w = waterSatTemp_C(P1_barA);
      const BPR1 = calcNaOHBPR_C(wOut, T1_sat_w);
      const T1_boil = +(T1_sat_w + BPR1).toFixed(1);
      const T1_feed = +(T2_boil + (T1_boil - T2_boil) * 0.78).toFixed(1);

      const dIn1: FallingFilmDesignInputs = {
        tag: 'E-320',
        bcplItemNo: 'E-5320 (1st Eff)',
        docNo: 'SPE-300-2MEE-01',
        effectNo: 1,
        serviceName: '1st Effect Falling Film Evaporator (제1효용 강하막 증발관)',
        feedFlow_kgh: L_mid_kgh,
        evapWater_kgh: V1_kgh,
        wtIn_pct: wt_mid,
        wtOut_pct: wOut,
        P_shell_kgcm2g: steamPressG,
        P_shell_barA: P_steam_barA,
        T_steam_in_C: T_steam_sat_C,
        T_steam_C: T_steam_sat_C,
        P_tube_kgcm2g: P1_kgcm2g,
        P_tube_barA_spec: P1_barA,
        T_feed_C: T1_feed,
        do_mm: 48.3,
        tw_mm: 2.11,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: 0,
        targetWettingRate_kgms: 1.05,
        overdesignPct: 15,
        fouling_m2KW: 0.00018,
        material: 'Nickel 200',
        designTempTube_C: 180,
        designTempShell_C: 200,
        designPressTube_bar: '-1.0/+3.5',
        designPressShell_bar: '-1.0/+10.0',
        matTubeSpec: 'Low-Carbon Nickel 201 (UNS N02201)',
        matTubesheetSpec: 'CS + LC-Ni 201 Clad',
        matShellSpec: 'SA-516 Gr.70',
        matChannelSpec: 'LC-Nickel 201',
        matSeparatorSpec: 'LC-Nickel 201 Clad',
        matDemisterSpec: 'Nickel 200 Wire Mesh',
      };
      const dRes1 = calcFallingFilmEvaporator(dIn1);

      const dIn2: FallingFilmDesignInputs = {
        tag: 'E-330',
        bcplItemNo: 'E-5330 (2nd Eff)',
        docNo: 'SPE-300-2MEE-02',
        effectNo: 2,
        serviceName: '2nd Effect Falling Film Evaporator (제2효용 강하막 증발관)',
        feedFlow_kgh,
        evapWater_kgh: V2_kgh,
        wtIn_pct: wIn,
        wtOut_pct: wt_mid,
        P_shell_kgcm2g: P1_kgcm2g,
        P_shell_barA: P1_barA,
        T_steam_in_C: +T1_sat_w.toFixed(1),
        T_steam_C: +T1_sat_w.toFixed(1),
        P_tube_kgcm2g: P2_kgcm2g,
        P_tube_barA_spec: P2_barA,
        T_feed_C: feedTempC,
        do_mm: 48.3,
        tw_mm: 1.65,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: 0,
        targetWettingRate_kgms: 0.65,
        overdesignPct: 15,
        fouling_m2KW: 0.00015,
        material: 'Nickel 200',
        designTempTube_C: 150,
        designTempShell_C: 170,
        designPressTube_bar: '-1.0/+2.0',
        designPressShell_bar: '-1.0/+3.5',
        matTubeSpec: 'Low-Carbon Nickel 201 (UNS N02201)',
        matTubesheetSpec: 'CS + LC-Ni 201 Clad',
        matShellSpec: 'SA-516 Gr.70',
        matChannelSpec: 'LC-Nickel 201',
        matSeparatorSpec: 'SS 316L / LC-Ni 201',
        matDemisterSpec: 'SS 316L Wire Mesh',
      };
      const dRes2 = calcFallingFilmEvaporator(dIn2);

      stages.push(
        {
          effectNo: 1,
          evapTag: 'E-320',
          bcplTag: 'E-5320',
          sepTag: 'D-321',
          pumpTag: 'P-321A/B',
          preheaterTag: 'E-332',
          serviceName: dIn1.serviceName,
          wtIn_pct: wt_mid,
          wtOut_pct: wOut,
          feedFlow_kgh: L_mid_kgh,
          outFlow_kgh: prodFlow_kgh,
          evapWater_kgh: V1_kgh,
          heatingSteam_kgh: dRes1.heatingSteamReq_kgh,
          P_shell_kgcm2g: steamPressG,
          T_steam_C: T_steam_sat_C,
          P_tube_kgcm2g: P1_kgcm2g,
          P_tube_barA: P1_barA,
          T_sat_water_C: +T1_sat_w.toFixed(1),
          BPR_C: BPR1,
          T_boil_C: T1_boil,
          dT_eff_C: dRes1.dT_eff_C,
          T_feed_C: T1_feed,
          Q_duty_kW: dRes1.Q_total_kW,
          Q_duty_Mcalh: dRes1.Q_total_Mcalh,
          material: 'Nickel 200',
          designInputs: dIn1,
          designResults: dRes1,
        },
        {
          effectNo: 2,
          evapTag: 'E-330',
          bcplTag: 'E-5330',
          sepTag: 'D-331',
          pumpTag: 'P-331A/B',
          preheaterTag: 'E-333',
          serviceName: dIn2.serviceName,
          wtIn_pct: wIn,
          wtOut_pct: wt_mid,
          feedFlow_kgh,
          outFlow_kgh: L_mid_kgh,
          evapWater_kgh: V2_kgh,
          heatingSteam_kgh: V1_kgh,
          P_shell_kgcm2g: P1_kgcm2g,
          T_steam_C: +T1_sat_w.toFixed(1),
          P_tube_kgcm2g: P2_kgcm2g,
          P_tube_barA: P2_barA,
          T_sat_water_C: +T2_sat_w.toFixed(1),
          BPR_C: BPR2,
          T_boil_C: T2_boil,
          dT_eff_C: dRes2.dT_eff_C,
          T_feed_C: feedTempC,
          Q_duty_kW: dRes2.Q_total_kW,
          Q_duty_Mcalh: dRes2.Q_total_Mcalh,
          material: 'Nickel 200',
          designInputs: dIn2,
          designResults: dRes2,
        }
      );
    } else {
      // ── 3중 효용관 (Triple-Effect Backward-Feed: 3효 E-340 -> 2효 E-330 -> 1효 E-320) ──
      const sf = capTonDay / 514.2538;
      const V3_kgh = +(totalEvap_kgh * 0.3353).toFixed(2);
      const V2_kgh = +(totalEvap_kgh * 0.3302).toFixed(2);
      const V1_kgh = +(totalEvap_kgh - V3_kgh - V2_kgh).toFixed(2);

      const L2_kgh = +(feedFlow_kgh - V3_kgh).toFixed(2); // 3효 출구 -> 2효 입구
      const wt3_out = +(naohPure_kgh / L2_kgh * 100).toFixed(2);

      const L7_kgh = +(L2_kgh - V2_kgh).toFixed(2);       // 2효 출구 -> 1효 입구
      const wt2_out = +(naohPure_kgh / L7_kgh * 100).toFixed(2);

      const P3_barA = P_vac_barA;
      const P3_kgcm2g = vacPressG;
      const T3_sat_w = waterSatTemp_C(P3_barA);
      const BPR3 = calcNaOHBPR_C(wt3_out, T3_sat_w);
      const T3_boil = +(T3_sat_w + BPR3).toFixed(1);

      const P2_barA = 0.346;
      const P2_kgcm2g = -0.68;
      const T2_sat_w = waterSatTemp_C(P2_barA);
      const BPR2 = calcNaOHBPR_C(wt2_out, T2_sat_w);
      const T2_boil = +(T2_sat_w + BPR2).toFixed(1);

      const P1_barA = 1.72;
      const P1_kgcm2g = 0.72;
      const T1_sat_w = waterSatTemp_C(P1_barA);
      const BPR1 = calcNaOHBPR_C(wOut, T1_sat_w);
      const T1_boil = +(T1_sat_w + BPR1).toFixed(1);

      const isBaseCap = Math.abs(sf - 1.0) < 0.03;

      const dIn1: FallingFilmDesignInputs = {
        tag: 'E-320',
        bcplItemNo: 'E-5320 (1st Eff)',
        docNo: '821106-03-023-A4',
        effectNo: 1,
        serviceName: '1st Effect Falling Film Evaporator (제1효용 강하막 증발관)',
        feedFlow_kgh: L7_kgh,
        evapWater_kgh: V1_kgh,
        wtIn_pct: wt2_out,
        wtOut_pct: wOut,
        P_shell_kgcm2g: steamPressG,
        P_shell_barA: P_steam_barA,
        T_steam_in_C: T_steam_sat_C,
        T_steam_C: T_steam_sat_C,
        P_tube_kgcm2g: P1_kgcm2g,
        P_tube_barA_spec: P1_barA,
        T_feed_C: 157.2,
        do_mm: 48.3,
        tw_mm: 2.11,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: isBaseCap ? 70 : Math.max(18, Math.round(70 * sf)),
        targetWettingRate_kgms: 1.34,
        overdesignPct: 12,
        fouling_m2KW: 0.00015,
        material: 'Nickel 200',
        designTempTube_C: 180,
        designTempShell_C: 200,
        designPressTube_bar: '-1.0/+3.5',
        designPressShell_bar: '-1.0/+10.0',
        matTubeSpec: 'Low-Carbon Nickel 201 (UNS N02201)',
        matTubesheetSpec: 'CS + LC-Ni 201 Clad',
        matShellSpec: 'SA-516 Gr.70',
        matChannelSpec: 'LC-Nickel 201',
        matSeparatorSpec: 'LC-Nickel 201 Clad',
        matDemisterSpec: 'Nickel 200 Wire Mesh',
      };
      const dRes1 = calcFallingFilmEvaporator(dIn1);

      const dIn2: FallingFilmDesignInputs = {
        tag: 'E-330',
        bcplItemNo: 'E-5330 (2nd Eff)',
        docNo: '821106-03-017-A4',
        effectNo: 2,
        serviceName: '2nd Effect Falling Film Evaporator (제2효용 강하막 증발관)',
        feedFlow_kgh: L2_kgh,
        evapWater_kgh: V2_kgh,
        wtIn_pct: wt3_out,
        wtOut_pct: wt2_out,
        P_shell_kgcm2g: P1_kgcm2g,
        P_shell_barA: P1_barA,
        T_steam_in_C: +T1_sat_w.toFixed(1),
        T_steam_C: +T1_sat_w.toFixed(1),
        P_tube_kgcm2g: P2_kgcm2g,
        P_tube_barA_spec: P2_barA,
        T_feed_C: 109.6,
        do_mm: 48.3,
        tw_mm: 1.65,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: isBaseCap ? 164 : Math.max(36, Math.round(164 * sf)),
        targetWettingRate_kgms: 1.03,
        overdesignPct: 12,
        fouling_m2KW: 0.00015,
        material: 'Nickel 200',
        designTempTube_C: 160,
        designTempShell_C: 175,
        designPressTube_bar: '-1.0/+2.0',
        designPressShell_bar: '-1.0/+3.5',
        matTubeSpec: 'Low-Carbon Nickel 201 (UNS N02201)',
        matTubesheetSpec: 'CS + LC-Ni 201 Clad',
        matShellSpec: 'SA-516 Gr.70',
        matChannelSpec: 'LC-Nickel 201',
        matSeparatorSpec: 'LC-Nickel 201 Clad',
        matDemisterSpec: 'Nickel 200 Wire Mesh',
      };
      const dRes2 = calcFallingFilmEvaporator(dIn2);

      const dIn3: FallingFilmDesignInputs = {
        tag: 'E-340',
        bcplItemNo: 'E-5340 (3rd Eff)',
        docNo: '821106-03-012-A4',
        effectNo: 3,
        serviceName: '3rd Effect Falling Film Evaporator (제3효용 강하막 증발관)',
        feedFlow_kgh,
        evapWater_kgh: V3_kgh,
        wtIn_pct: wIn,
        wtOut_pct: wt3_out,
        P_shell_kgcm2g: P2_kgcm2g,
        P_shell_barA: P2_barA,
        T_steam_in_C: +T2_sat_w.toFixed(1),
        T_steam_C: +T2_sat_w.toFixed(1),
        P_tube_kgcm2g: P3_kgcm2g,
        P_tube_barA_spec: P3_barA,
        T_feed_C: feedTempC,
        do_mm: 48.3,
        tw_mm: 1.65,
        L_m: 6.8,
        pitch_mm: 60,
        pitchRatio: 60 / 48.3,
        customTubeCount: isBaseCap ? 423 : Math.max(80, Math.round(423 * sf)),
        targetWettingRate_kgms: 0.35,
        overdesignPct: 12,
        fouling_m2KW: 0.00015,
        material: 'SS 310S / 316L',
        designTempTube_C: 120,
        designTempShell_C: 140,
        designPressTube_bar: '-1.0/+1.5',
        designPressShell_bar: '-1.0/+2.0',
        matTubeSpec: 'SS 310S / 316L Dual Grade',
        matTubesheetSpec: 'SA-240 316L',
        matShellSpec: 'SA-240 316L',
        matChannelSpec: 'SA-240 316L',
        matSeparatorSpec: 'SA-240 316L',
        matDemisterSpec: 'SS 316L Wire Mesh',
      };
      const dRes3 = calcFallingFilmEvaporator(dIn3);

      const liveSteam3 = +(10713.12 * sf * (totalEvap_kgh / Math.max(1, 24135.74 * sf))).toFixed(1);

      stages.push(
        {
          effectNo: 1,
          evapTag: 'E-320',
          bcplTag: 'E-5320',
          sepTag: 'D-321',
          pumpTag: 'P-321A/B',
          preheaterTag: 'E-332',
          serviceName: dIn1.serviceName,
          wtIn_pct: wt2_out,
          wtOut_pct: wOut,
          feedFlow_kgh: L7_kgh,
          outFlow_kgh: prodFlow_kgh,
          evapWater_kgh: V1_kgh,
          heatingSteam_kgh: liveSteam3,
          P_shell_kgcm2g: steamPressG,
          T_steam_C: T_steam_sat_C,
          P_tube_kgcm2g: P1_kgcm2g,
          P_tube_barA: P1_barA,
          T_sat_water_C: +T1_sat_w.toFixed(1),
          BPR_C: BPR1,
          T_boil_C: T1_boil,
          dT_eff_C: dRes1.dT_eff_C,
          T_feed_C: 157.2,
          Q_duty_kW: dRes1.Q_total_kW,
          Q_duty_Mcalh: dRes1.Q_total_Mcalh,
          material: 'Nickel 200',
          designInputs: dIn1,
          designResults: dRes1,
        },
        {
          effectNo: 2,
          evapTag: 'E-330',
          bcplTag: 'E-5330',
          sepTag: 'D-331',
          pumpTag: 'P-331A/B',
          preheaterTag: 'E-342',
          serviceName: dIn2.serviceName,
          wtIn_pct: wt3_out,
          wtOut_pct: wt2_out,
          feedFlow_kgh: L2_kgh,
          outFlow_kgh: L7_kgh,
          evapWater_kgh: V2_kgh,
          heatingSteam_kgh: +(V1_kgh * 1.044).toFixed(1),
          P_shell_kgcm2g: P1_kgcm2g,
          T_steam_C: +T1_sat_w.toFixed(1),
          P_tube_kgcm2g: P2_kgcm2g,
          P_tube_barA: P2_barA,
          T_sat_water_C: +T2_sat_w.toFixed(1),
          BPR_C: BPR2,
          T_boil_C: T2_boil,
          dT_eff_C: dRes2.dT_eff_C,
          T_feed_C: 109.6,
          Q_duty_kW: dRes2.Q_total_kW,
          Q_duty_Mcalh: dRes2.Q_total_Mcalh,
          material: 'Nickel 200',
          designInputs: dIn2,
          designResults: dRes2,
        },
        {
          effectNo: 3,
          evapTag: 'E-340',
          bcplTag: 'E-5340',
          sepTag: 'D-341',
          pumpTag: 'P-341A/B',
          preheaterTag: 'E-343',
          serviceName: dIn3.serviceName,
          wtIn_pct: wIn,
          wtOut_pct: wt3_out,
          feedFlow_kgh,
          outFlow_kgh: L2_kgh,
          evapWater_kgh: V3_kgh,
          heatingSteam_kgh: +(V2_kgh * 1.088).toFixed(1),
          P_shell_kgcm2g: P2_kgcm2g,
          T_steam_C: +T2_sat_w.toFixed(1),
          P_tube_kgcm2g: P3_kgcm2g,
          P_tube_barA: P3_barA,
          T_sat_water_C: +T3_sat_w.toFixed(1),
          BPR_C: BPR3,
          T_boil_C: T3_boil,
          dT_eff_C: dRes3.dT_eff_C,
          T_feed_C: feedTempC,
          Q_duty_kW: dRes3.Q_total_kW,
          Q_duty_Mcalh: dRes3.Q_total_Mcalh,
          material: 'SS 310S / 316L',
          designInputs: dIn3,
          designResults: dRes3,
        }
      );
    }

    const eff1 = stages[0];
    const lastEff = stages[stages.length - 1];
    const liveSteam_kgh = eff1.heatingSteam_kgh;
    const steamEconomy = +(totalEvap_kgh / Math.max(1, liveSteam_kgh)).toFixed(2);

    // 최종 효용 증기 응축열 및 냉각수 유량 (E-350 Surface Condenser)
    const finalVapor_kgh = +(lastEff.evapWater_kgh * (effectCount === 3 ? 1.086 : 1.0)).toFixed(1);
    const Q_cond_Mcalh = +(finalVapor_kgh * 0.570).toFixed(0); // ~570 kcal/kg
    const Q_cond_kW = +(Q_cond_Mcalh * 1.163).toFixed(1);
    const dT_cw = Math.max(3, cwOutTempC - cwInTempC);
    const cwCond_kgh = +(Q_cond_Mcalh * 1000 / dT_cw).toFixed(0);
    const cwCond_m3h = +(cwCond_kgh / 995).toFixed(1);
    const A_cond_m2 = +(Q_cond_kW * 1000 / (1650 * Math.max(6, lastEff.T_sat_water_C - (cwInTempC + cwOutTempC) / 2))).toFixed(1);

    // ─── 4. 물질 및 열수지 스트림 테이블 생성 (1/2/3효 맞춤형) ─────────
    const streamRows: EvapStreamRow[] = [];
    const addLiqStream = (
      id: string,
      name: string,
      flow_kgh: number,
      wt: number,
      T: number,
      P: number,
      desc: string
    ) => {
      const naoh = +(flow_kgh * (wt / 100)).toFixed(1);
      const h2o = +(flow_kgh - naoh).toFixed(1);
      const rho = naohDensity_kgm3(wt, T);
      const cp = naohSpecificHeat_kJkgK(wt, T);
      const H_Mcalh = +((flow_kgh * cp * T) / 4184).toFixed(1);
      streamRows.push({
        id,
        name,
        phase: 'L',
        total_kgh: +flow_kgh.toFixed(1),
        naoh_kgh: naoh,
        h2o_kgh: h2o,
        wt_pct: +wt.toFixed(2),
        temp_C: +T.toFixed(1),
        press_kgcm2g: +P.toFixed(2),
        density_kgm3: rho,
        enthalpy_Mcalh: H_Mcalh,
        lineSize_NPS: selectPipeNPS(flow_kgh, rho, false),
        serviceDesc: desc,
      });
    };

    const addVapStream = (
      id: string,
      name: string,
      flow_kgh: number,
      T: number,
      P: number,
      rho: number,
      isCondensate: boolean,
      desc: string
    ) => {
      const H_Mcalh = isCondensate
        ? +((flow_kgh * 1.0 * T) / 1000).toFixed(1)
        : +((flow_kgh * (600 + 0.45 * T)) / 1000).toFixed(1);
      streamRows.push({
        id,
        name,
        phase: isCondensate ? 'L' : 'V',
        total_kgh: +flow_kgh.toFixed(1),
        naoh_kgh: 0,
        h2o_kgh: +flow_kgh.toFixed(1),
        wt_pct: 0,
        temp_C: +T.toFixed(1),
        press_kgcm2g: +P.toFixed(2),
        density_kgm3: rho,
        enthalpy_Mcalh: H_Mcalh,
        lineSize_NPS: selectPipeNPS(flow_kgh, rho, !isCondensate),
        serviceDesc: desc,
      });
    };

    // 급액 스트림 (L1) 및 75.5%(가성소다 열회수 E-332/342) / 24.5%(13K 스팀응축수 열회수 E-333/343) 병렬 분기
    const capRatio = capTonDay / 514.2538;
    const C1_cond_kgh = +(liveSteam_kgh * 0.967).toFixed(1);
    const C5_flash_kgh = +(liveSteam_kgh - C1_cond_kgh).toFixed(1);

    addLiqStream('L1', `${wIn.toFixed(1)}% NaOH 원료 급액`, feedFlow_kgh, wIn, feedTempC, 2.5, `전해조 출구 → ${lastEff.evapTag} (${lastEff.effectNo}효) 상부 급액`);

    // 역류 효용별 액 흐름 (75.5% 가성소다 열회수 분기 + 24.5% 스팀응축수 열회수 분기 포함)
    for (let i = stages.length - 1; i >= 0; i--) {
      const st = stages[i];
      if (st.effectNo === 3) {
        const L3_kgh = +(st.outFlow_kgh * 0.755).toFixed(1);
        const L4_kgh = +(st.outFlow_kgh - L3_kgh).toFixed(1);
        addLiqStream('L2', `3효(${st.evapTag}) 출구 농축액`, st.outFlow_kgh, st.wtOut_pct, st.T_boil_C, st.P_tube_kgcm2g, `D-341 하부 → P-341A/B 토출 → L3(75.5%) / L4(24.5%) 병렬 분기`);
        addLiqStream('L3', `E-342 저온측 입구 (75.5% 분기)`, L3_kgh, st.wtOut_pct, st.T_boil_C, 2.5, `E-342 저온측 (${st.T_boil_C.toFixed(1)}→108.2°C) — Hot: L12 50% 가성소다`);
        addLiqStream('L4', `E-343 저온측 입구 (24.5% 분기)`, L4_kgh, st.wtOut_pct, st.T_boil_C, 2.5, `E-343 저온측 (${st.T_boil_C.toFixed(1)}→114.0°C) — Hot: C2 13K 스팀 응축수`);
        addLiqStream('L5', `2효(E-330) 예열 급액 (E-342+343 합류)`, st.outFlow_kgh, st.wtOut_pct, 109.6, 1.8, `E-342(108.2°C) + E-343(114.0°C) 합류 → 2효 E-330 상부 급액`);
      } else if (st.effectNo === 2) {
        const L8_kgh = +(st.outFlow_kgh * 0.755).toFixed(1);
        const L9_kgh = +(st.outFlow_kgh - L8_kgh).toFixed(1);
        addLiqStream('L7', `2효(${st.evapTag}) 출구 농축액`, st.outFlow_kgh, st.wtOut_pct, st.T_boil_C, st.P_tube_kgcm2g, `D-331 하부 → P-331A/B 토출 → L8(75.5%) / L9(24.5%) 병렬 분기`);
        addLiqStream('L8', `E-332 저온측 입구 (75.5% 분기)`, L8_kgh, st.wtOut_pct, st.T_boil_C, 2.8, `E-332 저온측 (${st.T_boil_C.toFixed(1)}→156.2°C) — Hot: L11 50% 가성소다`);
        addLiqStream('L9', `E-333 저온측 입구 (24.5% 분기)`, L9_kgh, st.wtOut_pct, st.T_boil_C, 2.8, `E-333 저온측 (${st.T_boil_C.toFixed(1)}→160.0°C) — Hot: C1 13K 스팀 응축수`);
        addLiqStream('L10', `1효(E-320) 예열 급액 (E-332+333 합류)`, st.outFlow_kgh, st.wtOut_pct, stages[0].T_feed_C, 2.2, `E-332(156.2°C) + E-333(160.0°C) 합류 → 1효 E-320 상부 급액`);
      } else if (st.effectNo === 1) {
        if (effectCount === 1) {
          const L8_1_kgh = +(st.feedFlow_kgh * 0.755).toFixed(1);
          const L9_1_kgh = +(st.feedFlow_kgh - L8_1_kgh).toFixed(1);
          addLiqStream('L8', `E-332 저온측 입구 (75.5% 분기)`, L8_1_kgh, st.wtIn_pct, feedTempC, 2.5, `E-332 저온측 — Hot: L11 50% 가성소다`);
          addLiqStream('L9', `E-333 저온측 입구 (24.5% 분기)`, L9_1_kgh, st.wtIn_pct, feedTempC, 2.5, `E-333 저온측 — Hot: C1 13K 스팀 응축수`);
          addLiqStream('L10', `1효(E-320) 예열 급액 (E-332+333 합류)`, st.feedFlow_kgh, st.wtIn_pct, st.T_feed_C, 2.2, `E-332 + E-333 예열 합류 → 1효 E-320 상부 급액`);
        }
        addLiqStream('L11', `1효(${st.evapTag}) 출구 ${wOut.toFixed(1)}% 가성소다 (E-332 Hot 입구)`, st.outFlow_kgh, st.wtOut_pct, st.T_boil_C, st.P_tube_kgcm2g, `D-321 하부 → P-321A/B 토출 → E-332 고온측(Hot) 입구`);
      }
    }

    // 50% 가성소다 Hot Stream 열회수 & 제품 냉각 라인 (L11 -> E-332 -> L12 -> E-342 -> L13 -> E-352 -> L14)
    addLiqStream('L12', `${wOut.toFixed(1)}% NaOH E-332 고온측 출구`, prodFlow_kgh, wOut, 120.0, 2.2, `E-332 고온측(Hot) 출구 (164.8→120.0°C) → ${effectCount === 3 ? 'E-342 고온측(Hot) 입구' : 'E-352 제품 냉각기 입구'}`);
    if (effectCount === 3) {
      addLiqStream('L13', `${wOut.toFixed(1)}% NaOH E-342 고온측 출구`, prodFlow_kgh, wOut, 75.0, 1.8, `E-342 고온측(Hot) 출구 (120.0→75.0°C) → E-352 제품 냉각기 고온측 입구`);
    }
    addLiqStream('L14', `${wOut.toFixed(1)}% NaOH 최종 제품 (E-352 출구)`, prodFlow_kgh, wOut, 42.0, 1.5, `E-352 고온측 출구 (CW 냉각 후 42.0°C) → 50% 가성소다 저장탱크`);

    // 13K 생증기 및 13K 스팀 응축수 Hot Stream 열회수 라인 (S1 -> E-320 -> D-5321 -> C1 -> E-333 -> C2 -> E-343 -> C3)
    addVapStream('S1', `13K 생증기 (1효 E-320 쉘측 가열원)`, liveSteam_kgh, T_steam_sat_C, steamPressG, 4.81, false, `13K Steam Header (${steamPressG} kg/cm²G, ${T_steam_sat_C}°C) → 1효 E-320 쉘측`);
    addVapStream('C1', `13K 스팀 응축수 (D-5321 → E-333 Hot 입구)`, C1_cond_kgh, T_steam_sat_C, 3.0, 892, true, `D-5321 하부 13K 응축수 (${T_steam_sat_C}°C) → E-333 고온측(Hot) 입구`);
    addVapStream('C2', `13K 스팀 응축수 (E-333 Hot 출구${effectCount === 3 ? ' → E-343 Hot 입구' : ''})`, C1_cond_kgh, 126.6, 2.5, 938, true, `E-333 고온측(Hot) 출구 (126.6°C) → ${effectCount === 3 ? 'E-343 고온측(Hot) 입구' : '보일러 응축수 회수'}`);
    if (effectCount === 3) {
      addVapStream('C3', `13K 스팀 응축수 최종 회수 (E-343 Hot 출구)`, C1_cond_kgh, 74.7, 2.0, 975, true, `E-343 고온측(Hot) 출구 (126.6→74.7°C) → 보일러 순수/응축수 탱크 회수`);
    }
    if (effectCount >= 2) {
      addVapStream('C5', `D-5321 플래시 스팀 (→ 2효 E-330 가열 합류)`, C5_flash_kgh, 116.0, 0.72, 0.99, false, `D-5321 상부 Flash Steam → V1 합류 후 2효 E-330 쉘측 가열`);
    }

    stages.forEach(st => {
      const vRho = st.effectNo === 1 ? 0.99 : st.effectNo === 2 ? 0.23 : 0.06;
      const nextTarget = st.effectNo < effectCount ? `${st.effectNo + 1}효 E-3${st.effectNo + 2}0 쉘측 가열원` : `표면응축기 E-350 유입 응축`;
      addVapStream(
        `V${st.effectNo}`,
        `${st.effectNo}효 발생 수증기 (${st.sepTag} 상부)`,
        st.evapWater_kgh,
        st.T_sat_water_C,
        st.P_tube_kgcm2g,
        vRho,
        false,
        `${st.sepTag} 상부 증기 → ${nextTarget}`
      );
    });

    addVapStream('C4', `효용 증기 응축수 통합 배출 (D-5341 출구)`, totalEvap_kgh, lastEff.T_sat_water_C, 1.5, 985, true, `효용 증발 수증기 통합 응축수 → 공정수/세정수 회수`);
    addVapStream('CW', `냉각수 공급 (E-350 표면응축기 + E-352 냉각기)`, +(cwCond_kgh * 1.21).toFixed(0), cwInTempC, 3.5, 995, true, `Cooling Tower Supply (${cwInTempC}→${cwOutTempC}°C)`);

    // ─── 5. 공정 장치 목록 (Equipment List) 자동 생성 ────────────────
    const equipRows: EvapEquipRow[] = [];

    // (A) 강하막 증발관 (E-320, E-330, E-340) 및 일체형 기액분리기 (D-321, D-331, D-341)
    stages.forEach(st => {
      const r = st.designResults;
      const inp = st.designInputs;
      equipRows.push({
        tag: st.evapTag,
        name: `${st.effectNo}효 강하막 증발관 (${st.effectNo}st/nd/rd Effect Falling Film Evaporator)`,
        category: 'EVAP',
        effectNo: st.effectNo,
        fluid: `Tube: NaOH ${st.wtIn_pct.toFixed(1)}→${st.wtOut_pct.toFixed(1)}% / Shell: Steam ${st.T_steam_C.toFixed(1)}°C`,
        dutyOrFlow: `Q = ${r.Q_total_kW.toFixed(0)} kW (${(r.Q_total_Mcalh / 1000).toFixed(2)} Gcal/h)`,
        areaOrPower: `전열면적 ${r.A_prov_m2.toFixed(1)} m² (U=${r.U_service_Wm2K.toFixed(0)} W/m²K)`,
        dimensions: `Calandria Ø${r.D_calandria_mm} × Tube Ø${inp.do_mm}×${inp.tw_mm}t×${(inp.L_m * 1000).toFixed(0)}L (${r.N_tubes} Tubes)`,
        operTemp_C: `Tube ${st.T_boil_C.toFixed(1)} / Shell ${st.T_steam_C.toFixed(1)}`,
        operPress: `Tube ${st.P_tube_kgcm2g.toFixed(2)} / Shell ${st.P_shell_kgcm2g.toFixed(2)} kg/cm²G`,
        designTemp_C: `${inp.designTempTube_C ?? 180} / ${inp.designTempShell_C ?? 200}`,
        designPress: `${inp.designPressTube_bar ?? 'FV/+3.5'} / ${inp.designPressShell_bar ?? 'FV/+10'} barG`,
        material: inp.matTubeSpec ?? st.material,
        nozzles: `Liq In ${r.nozzleLiquorIn_NPS} / Out ${r.nozzleLiquorOut_NPS} / Steam ${r.nozzleSteamIn_NPS}`,
        remarks: `BPR +${st.BPR_C.toFixed(1)}°C, 적심율 Γ=${r.actualWettingRate_kgms.toFixed(2)} kg/m·s (TEMA R)`,
      });

      equipRows.push({
        tag: st.sepTag,
        name: `${st.effectNo}효 기액분리기 (${st.effectNo}효 Integral Vapor-Liquid Separator)`,
        category: 'SEP',
        effectNo: st.effectNo,
        fluid: `NaOH ${st.wtOut_pct.toFixed(1)}% + Vapor ${st.evapWater_kgh.toLocaleString()} kg/h`,
        dutyOrFlow: `증기량 ${st.evapWater_kgh.toLocaleString()} kg/h / 액량 ${st.outFlow_kgh.toLocaleString()} kg/h`,
        areaOrPower: `증기유속 ${r.v_sep_vapor_ms.toFixed(2)} m/s (허용 ${r.v_soudersBrown_ms.toFixed(2)} m/s)`,
        dimensions: `ID Ø${r.D_separator_mm} mm × Total H ${r.totalVesselLength_mm} mm (150t Demister)`,
        operTemp_C: `${st.T_boil_C.toFixed(1)}`,
        operPress: `${st.P_tube_kgcm2g.toFixed(2)} kg/cm²G (${st.P_tube_barA.toFixed(3)} barA)`,
        designTemp_C: `${inp.designTempTube_C ?? 180}`,
        designPress: `${inp.designPressTube_bar ?? 'FV/+3.5'} barG`,
        material: inp.matSeparatorSpec ?? st.material,
        nozzles: `Vapor Out ${r.nozzleVaporOut_NPS} / Liq Bottom ${r.nozzleLiquorOut_NPS}`,
        remarks: `Souders-Brown 기액분리 + 메쉬 데미스터 내장 (NaOH 비말동반 < 10 ppm)`,
      });
    });

    // (B) 1효 스팀 응축수 플래시 팟 (D-5321)
    equipRows.push({
      tag: 'D-5321',
      name: `1효 13K 스팀 응축수 플래시 팟 (1st Effect Steam Condensate Flash Pot)`,
      category: 'SEP',
      fluid: `13K Steam Condensate (C1: ${C1_cond_kgh.toLocaleString()} kg/h) + Flash Steam (C5: ${C5_flash_kgh} kg/h)`,
      dutyOrFlow: `유입 ${liveSteam_kgh.toLocaleString()} kg/h → 응축수 C1 ${C1_cond_kgh.toLocaleString()} kg/h (E-333 Hot 공급)`,
      areaOrPower: `플래시 증기 회수 ${C5_flash_kgh} kg/h`,
      dimensions: `Vertical Vessel ID Ø${Math.round(550 * Math.sqrt(capRatio))} × 1,650H mm`,
      operTemp_C: `${T_steam_sat_C.toFixed(1)} → 116.0`,
      operPress: `0.72 ~ 3.0 kg/cm²G`,
      designTemp_C: `200`,
      designPress: `10.0 barG`,
      material: `SA-516 Gr.70 / SA-240 304`,
      nozzles: `In NPS 3" / Cond Out (C1) NPS 3" / Flash (C5) NPS 2"`,
      remarks: `1효 쉘측 13K 스팀 응축수를 수집하여 E-333/E-343 고온측(Hot) 열원으로 공급`,
    });

    // (C) 열회수 예열기 Train A (Hot = 50% 가성소다: E-332, E-342) + 제품 냉각기 (E-352)
    //     열회수 예열기 Train B (Hot = 13K 스팀 응축수: E-333, E-343)
    equipRows.push({
      tag: 'E-332',
      name: `1효 가성소다 열회수 예열기 (1st Effect NaOH Preheater — Hot: 50% 가성소다)`,
      category: 'HEX',
      fluid: `Hot: 50% NaOH (L11→L12, ${stages[0].T_boil_C.toFixed(1)}→120.0°C) / Cold: L8 (75.5% 분기 급액, 108.5→156.2°C)`,
      dutyOrFlow: `Q = ${(1678 * capRatio).toFixed(0)} kW (${(1443 * capRatio).toFixed(0)} Mcal/h)`,
      areaOrPower: `전열면적 ${(54.0 * capRatio).toFixed(1)} m² (판형 PHE)`,
      dimensions: `Plate Pack 0.6t Chevron × ${(54.0 * capRatio).toFixed(1)} m²`,
      operTemp_C: `Hot ${stages[0].T_boil_C.toFixed(1)}→120.0 / Cold 108.5→156.2`,
      operPress: `3.0 / 2.8 kg/cm²G`,
      designTemp_C: `180 / 180`,
      designPress: `6.0 / 6.0 barG`,
      material: `Plates: Low-Carbon Nickel 200 / Gasket: EPDM Peroxide`,
      nozzles: `Hot NPS 4" (L11/L12) / Cold NPS 3" (L8)`,
      remarks: `[Hot=50% NaOH] 1효 출구 50% 가성소다 현열로 1효 급액의 75.5%(L8)를 예열`,
    });

    equipRows.push({
      tag: 'E-333',
      name: `1효 스팀응축수 열회수 예열기 (1st Effect Condensate Preheater — Hot: 13K 스팀 응축수)`,
      category: 'HEX',
      fluid: `Hot: 13K 스팀 응축수 (C1→C2, ${T_steam_sat_C.toFixed(1)}→126.6°C) / Cold: L9 (24.5% 분기 급액, 108.5→160.0°C)`,
      dutyOrFlow: `Q = ${(588 * capRatio).toFixed(0)} kW (${(505 * capRatio).toFixed(0)} Mcal/h)`,
      areaOrPower: `전열면적 ${(14.0 * capRatio).toFixed(1)} m² (판형 PHE)`,
      dimensions: `Plate Pack 0.6t Chevron × ${(14.0 * capRatio).toFixed(1)} m²`,
      operTemp_C: `Hot ${T_steam_sat_C.toFixed(1)}→126.6 / Cold 108.5→160.0`,
      operPress: `3.0 / 2.8 kg/cm²G`,
      designTemp_C: `185 / 180`,
      designPress: `6.0 / 6.0 barG`,
      material: `Plates: Low-Carbon Nickel 200 / SS 316L`,
      nozzles: `Hot NPS 3" (C1/C2) / Cold NPS 2" (L9)`,
      remarks: `[Hot=13K 스팀응축수] D-5321 13K 응축수(C1) 현열로 1효 급액의 24.5%(L9)를 예열`,
    });

    if (effectCount === 3) {
      equipRows.push({
        tag: 'E-342',
        name: `2효 가성소다 열회수 예열기 (2nd Effect NaOH Preheater — Hot: 50% 가성소다)`,
        category: 'HEX',
        fluid: `Hot: 50% NaOH (L12→L13, 120.0→75.0°C) / Cold: L3 (75.5% 분기 36.4% NaOH, 68.4→108.2°C)`,
        dutyOrFlow: `Q = ${(1683 * capRatio).toFixed(0)} kW (${(1447 * capRatio).toFixed(0)} Mcal/h)`,
        areaOrPower: `전열면적 ${(54.0 * capRatio).toFixed(1)} m² (판형 PHE)`,
        dimensions: `Plate Pack 0.6t Chevron × ${(54.0 * capRatio).toFixed(1)} m²`,
        operTemp_C: `Hot 120.0→75.0 / Cold 68.4→108.2`,
        operPress: `2.5 / 2.5 kg/cm²G`,
        designTemp_C: `150 / 150`,
        designPress: `6.0 / 6.0 barG`,
        material: `Plates: Nickel 200 / SS 316L`,
        nozzles: `Hot NPS 4" (L12/L13) / Cold NPS 4" (L3)`,
        remarks: `[Hot=50% NaOH] E-332 통과 후 50% 가성소다(L12) 현열로 2효 급액의 75.5%(L3)를 2차 예열`,
      });

      equipRows.push({
        tag: 'E-343',
        name: `2효 스팀응축수 열회수 예열기 (2nd Effect Condensate Preheater — Hot: 13K 스팀 응축수)`,
        category: 'HEX',
        fluid: `Hot: 13K 스팀 응축수 (C2→C3, 126.6→74.7°C) / Cold: L4 (24.5% 분기 36.4% NaOH, 68.4→114.0°C)`,
        dutyOrFlow: `Q = ${(625 * capRatio).toFixed(0)} kW (${(538 * capRatio).toFixed(0)} Mcal/h)`,
        areaOrPower: `전열면적 ${(20.0 * capRatio).toFixed(1)} m² (판형 PHE)`,
        dimensions: `Plate Pack 0.6t Chevron × ${(20.0 * capRatio).toFixed(1)} m²`,
        operTemp_C: `Hot 126.6→74.7 / Cold 68.4→114.0`,
        operPress: `2.5 / 2.5 kg/cm²G`,
        designTemp_C: `150 / 150`,
        designPress: `6.0 / 6.0 barG`,
        material: `Plates: Nickel 200 / SS 316L`,
        nozzles: `Hot NPS 3" (C2/C3) / Cold NPS 2" (L4)`,
        remarks: `[Hot=13K 스팀응축수] E-333 통과 후 13K 응축수(C2) 현열로 2효 급액의 24.5%(L4)를 2차 예열`,
      });
    }

    equipRows.push({
      tag: 'E-352',
      name: `50% 가성소다 제품 최종 냉각기 (Product NaOH Cooler — Hot: 50% 가성소다 / Cold: CW)`,
      category: 'HEX',
      fluid: `Hot: ${wOut.toFixed(1)}% NaOH (${effectCount === 3 ? 'L13' : 'L12'}→L14, 75.0→42.0°C) / Cold: CW (${cwInTempC}→${cwOutTempC}°C)`,
      dutyOrFlow: `Q = ${(1230 * capRatio).toFixed(0)} kW (${(1058 * capRatio).toFixed(0)} Mcal/h)`,
      areaOrPower: `전열면적 ${(20.0 * capRatio).toFixed(1)} m² (판형 PHE)`,
      dimensions: `Plate Pack 0.6t × ${(20.0 * capRatio).toFixed(1)} m²`,
      operTemp_C: `Hot 75.0→42.0 / Cold ${cwInTempC.toFixed(1)}→${cwOutTempC.toFixed(1)}`,
      operPress: `2.0 / 3.5 kg/cm²G`,
      designTemp_C: `110 / 80`,
      designPress: `6.0 / 6.0 barG`,
      material: `Plates: Nickel 200 or Titanium Gr.1`,
      nozzles: `Hot NaOH NPS 4" / Cold CW NPS 6"`,
      remarks: `[Hot=50% NaOH] 열회수 완료된 50% 가성소다를 저장탱크 이송 온도(42°C)로 최종 냉각`,
    });

    // (D) 진공 표면응축기 (E-350) 및 진공 시스템 (VP-360A/B)
    equipRows.push({
      tag: 'E-350',
      name: `진공 표면응축기 (Vacuum Surface Condenser — TEMA BEM)`,
      category: 'COND',
      fluid: `Shell: ${lastEff.effectNo}효 증기 (${finalVapor_kgh.toLocaleString()} kg/h) / Tube: CW (${cwCond_m3h} m³/h)`,
      dutyOrFlow: `Q = ${Q_cond_kW.toLocaleString()} kW (${(Q_cond_Mcalh / 1000).toFixed(2)} Gcal/h)`,
      areaOrPower: `전열면적 ${A_cond_m2} m² (S&T TEMA BEM)`,
      dimensions: `Shell Ø${Math.round(950 * Math.sqrt(capRatio))} × 4,800L mm (OD 19.05t Tubes)`,
      operTemp_C: `Shell ${lastEff.T_sat_water_C.toFixed(1)} / Tube ${cwInTempC.toFixed(1)}→${cwOutTempC.toFixed(1)}`,
      operPress: `Shell ${lastEff.P_tube_kgcm2g.toFixed(2)} / Tube 3.5 kg/cm²G`,
      designTemp_C: `100 / 80`,
      designPress: `FV/+2.0 / 6.0 barG`,
      material: `Shell/Tube: SA-240 316L / SA-213 TP316L`,
      nozzles: `Vapor In ${lastEff.designResults.nozzleVaporOut_NPS} / CW ${selectPipeNPS(cwCond_kgh, 995, false)}`,
      remarks: `최종 효용 진공 유지 (${lastEff.P_tube_barA.toFixed(3)} barA) 및 수증기 전량 응축`,
    });

    equipRows.push({
      tag: 'VP-360A/B',
      name: `수봉식 진공펌프 및 이젝터 패키지 (Liquid Ring Vacuum System — 1 Op + 1 Stby)`,
      category: 'VAC',
      fluid: `비응축성 가스 (Air Leakage + 포화 수증기)`,
      dutyOrFlow: `흡입 용량 ${Math.round(420 * Math.pow(capRatio, 0.7))} Nm³/h @ ${lastEff.P_tube_barA.toFixed(3)} barA`,
      areaOrPower: `모터 ${(22 * Math.pow(capRatio, 0.7)).toFixed(1)} kW × 2대 (1운전 1대기)`,
      dimensions: `Skid Package ${Math.round(2400 * Math.pow(capRatio, 0.25))} × 1,600 mm`,
      operTemp_C: `35.0 ~ ${lastEff.T_sat_water_C.toFixed(1)}`,
      operPress: `Suction ${lastEff.P_tube_kgcm2g.toFixed(2)} → Atm`,
      designTemp_C: `90`,
      designPress: `FV / +2.0 barG`,
      material: `Casing & Impeller: SS 316L`,
      nozzles: `Suction NPS 4" / Seal Water NPS 1-1/2"`,
      remarks: `시동 시 초기 진공 형성 스팀 이젝터 포함`,
    });

    // (E) 효용별 이송 및 순환 펌프 (P-321, P-331, P-341)
    stages.forEach(st => {
      const r = st.designResults;
      const Q_m3h = +(r.recircFlow_kgh / Math.max(1000, r.rhoL_kgm3)).toFixed(1);
      const head_m = st.effectNo === 1 ? 38 : 34;
      const hyd_kW = (Q_m3h * head_m * (r.rhoL_kgm3 / 1000) * 9.81) / (3600 * 0.68);
      const motor_kW = Math.max(5.5, +(hyd_kW * 1.25).toFixed(1));
      equipRows.push({
        tag: st.pumpTag,
        name: `${st.effectNo}효 가성소다 순환·이송 펌프 (${st.effectNo}효 Liquor Circulation & Transfer Pump)`,
        category: 'PUMP',
        effectNo: st.effectNo,
        fluid: `NaOH ${st.wtOut_pct.toFixed(1)} wt% (${st.T_boil_C.toFixed(1)}°C, ρ=${r.rhoL_kgm3} kg/m³)`,
        dutyOrFlow: `유량 ${Q_m3h} m³/h × 양정 ${head_m} m`,
        areaOrPower: `모터 ${motor_kW} kW × 2대 (1 Op + 1 Stby)`,
        dimensions: `ASME B73.1 Horizontal Centrifugal (Double Mechanical Seal)`,
        operTemp_C: `${st.T_boil_C.toFixed(1)}`,
        operPress: `Suction ${st.P_tube_kgcm2g.toFixed(2)} → Disch +3.2 kg/cm²G`,
        designTemp_C: `${st.designInputs.designTempTube_C ?? 180}`,
        designPress: `6.0 barG`,
        material: st.effectNo <= 2 ? `Nickel 200 (ASTM A494 CZ-100)` : `Alloy 20 (CN7M) / Duplex 2205`,
        nozzles: `Suc ${r.nozzleLiquorOut_NPS} / Disch ${r.nozzleLiquorIn_NPS}`,
        remarks: `강하막 최소 적심율(Γ ≥ ${r.minWettingRate_kgms} kg/m·s) 유지 및 다음 효용/제품 이송 겸용`,
      });
    });

    return {
      capTonDay,
      naohPure_kgh,
      feedFlow_kgh,
      prodFlow_kgh,
      totalEvap_kgh,
      liveSteam_kgh,
      C1_cond_kgh,
      C5_flash_kgh,
      steamEconomy,
      cwCond_m3h,
      Q_cond_kW,
      A_cond_m2,
      stages,
      streamRows,
      equipRows,
    };
  }, [capacityMTPD, effectCount, wtIn, wtOut, feedTempC, steamPressG, vacPressG, cwInTempC, cwOutTempC]);

  // 효용수가 바뀔 때 선택된 태그가 현재 효용에 없으면 E-320으로 복귀
  useEffect(() => {
    const exists = simData.equipRows.some(e => e.tag === selectedEquipTag);
    if (!exists) {
      setSelectedEquipTag('E-320');
    }
  }, [simData, selectedEquipTag]);

  const selectedStage = useMemo(() => {
    return simData.stages.find(
      s => s.evapTag === selectedEquipTag || s.sepTag === selectedEquipTag || s.pumpTag === selectedEquipTag
    ) ?? simData.stages[0];
  }, [simData, selectedEquipTag]);

  const selectedEquipRow = useMemo(() => {
    return simData.equipRows.find(e => e.tag === selectedEquipTag) ?? simData.equipRows[0];
  }, [simData, selectedEquipTag]);

  // ─── 6. 동적 1·2·3중 효용 PFD 고해상도 캔버스 렌더링 (컴팩트 심볼 + 2열 열회수 트레인) ───
  useEffect(() => {
    const cvs = pfdCanvasRef.current;
    if (!cvs) return;
    const dpr = Math.max(2.2, typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2);
    const W = 1240;
    const H = 530;
    if (cvs.width !== Math.round(W * dpr) || cvs.height !== Math.round(H * dpr)) {
      cvs.width = Math.round(W * dpr);
      cvs.height = Math.round(H * dpr);
    }
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. 순백색 엔지니어링 CAD 도면 배경
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // 은은한 도면 그리드
    ctx.strokeStyle = '#F3F2EE';
    ctx.lineWidth = 1;
    for (let x = 24; x < W; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 24; y < H; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // 도면 외곽 테두리
    ctx.strokeStyle = '#1A2F44';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // 상단 타이틀 바
    ctx.fillStyle = '#F6F7F2';
    ctx.fillRect(9, 9, W - 18, 34);
    ctx.strokeStyle = '#DFDCD4';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, 43); ctx.lineTo(W - 8, 43); ctx.stroke();

    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 12px "Inter", "Malgun Gothic", sans-serif';
    ctx.fillText(
      `PFD — ${effectCount}중 효용 강하막 증발·농축 공정 (${simData.capTonDay.toFixed(1)} MTPD NaOH | E-332·342·352 Hot=가성소다 / E-333·343 Hot=13K 스팀응축수)`,
      18,
      30
    );
    ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#0F766E';
    ctx.textAlign = 'right';
    ctx.fillText(
      `L1: ${simData.feedFlow_kgh.toLocaleString()} kg/h (${wtIn}%) → L14: ${simData.prodFlow_kgh.toLocaleString()} kg/h (${wtOut}%) | Economy: ${simData.steamEconomy.toFixed(2)}`,
      W - 18,
      30
    );
    ctx.textAlign = 'left';

    // 화살표 및 컴팩트 스트림 배지 헬퍼
    const drawArrow = (x1: number, y1: number, x2: number, y2: number, color: string, dashed = false, lw = 1.6) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lw;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = 5.5;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawBadge = (x: number, y: number, id: string, txt: string, color = '#1A2F44') => {
      ctx.save();
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      const wId = Math.max(20, ctx.measureText(id).width + 7);
      const wTxt = txt ? ctx.measureText(txt).width + 8 : 0;
      const totalW = wId + wTxt;
      const rx = x - totalW / 2;
      const ry = y - 7.5;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.fillRect(rx, ry, totalW, 15);
      ctx.strokeRect(rx, ry, totalW, 15);
      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, wId, 15);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(id, rx + wId / 2, ry + 10.5);
      if (txt) {
        ctx.fillStyle = '#1A2F44';
        ctx.textAlign = 'left';
        ctx.fillText(txt, rx + wId + 4, ry + 10.5);
      }
      ctx.restore();
    };

    // 컴팩트 판형 열교환기(PHE) 심볼 헬퍼
    const drawCompactPHE = (
      cx: number,
      cy: number,
      tag: string,
      hotLabel: string,
      coldLabel: string,
      borderColor: string,
      bgTint: string
    ) => {
      const w = 88;
      const h = 38;
      const rx = cx - w / 2;
      const ry = cy - h / 2;
      const isSel = selectedEquipTag === tag;

      ctx.save();
      ctx.fillStyle = isSel ? '#EFECE5' : bgTint;
      ctx.strokeStyle = isSel ? '#1A2F44' : borderColor;
      ctx.lineWidth = isSel ? 2.2 : 1.4;
      ctx.fillRect(rx, ry, w, h);
      ctx.strokeRect(rx, ry, w, h);

      // 우측 미니 지그재그 전열판 심볼
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx + 6, ry + 6);
      ctx.lineTo(rx + 6, ry + h - 6);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#1A2F44';
      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillText(tag, cx + 2, ry + 12);
      ctx.fillStyle = borderColor;
      ctx.font = 'bold 8px "Inter", sans-serif';
      ctx.fillText(hotLabel, cx + 2, ry + 23);
      ctx.fillStyle = '#475569';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(coldLabel, cx + 2, ry + 33);
      ctx.restore();
    };

    // ─── 상단 레인 (Y = 82 ~ 245): 13K 스팀 & 강하막 증발관(E-320/330/340) & 표면응축기(E-350) ───
    const stageXs = effectCount === 1
      ? [360]
      : effectCount === 2
        ? [300, 620]
        : [255, 545, 835];

    // 좌측 13K Live Steam 공급 블록 + D-5321 응축수 플래시 팟
    ctx.fillStyle = '#FEF2F2';
    ctx.strokeStyle = '#B91C1C';
    ctx.lineWidth = 1.4;
    ctx.fillRect(20, 92, 102, 42);
    ctx.strokeRect(20, 92, 102, 42);
    ctx.fillStyle = '#B91C1C';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText('13K LIVE STEAM', 28, 108);
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText(`${simData.liveSteam_kgh.toLocaleString()} kg/h`, 28, 121);
    ctx.fillText(`${steamPressG}K (${simData.stages[0].T_steam_C}°C)`, 28, 131);

    // S1 -> 1효 E-320 쉘측
    drawArrow(122, 113, stageXs[0] - 21, 113, '#B91C1C', true);
    drawBadge((122 + stageXs[0] - 21) / 2, 98, 'S1', `${simData.liveSteam_kgh.toFixed(0)} kg/h`, '#B91C1C');

    // D-5321 (1효 13K 스팀 응축수 플래시 팟 — 컴팩트 심볼)
    const d5321X = 158;
    const d5321Y = 162;
    ctx.fillStyle = '#FFFBEB';
    ctx.strokeStyle = '#B45309';
    ctx.lineWidth = 1.3;
    ctx.fillRect(d5321X - 20, d5321Y, 40, 44);
    ctx.strokeRect(d5321X - 20, d5321Y, 40, 44);
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('D-5321', d5321X, d5321Y + 16);
    ctx.fillStyle = '#B45309';
    ctx.font = '7.5px "Inter", sans-serif';
    ctx.fillText('13K응축수팟', d5321X, d5321Y + 29);
    ctx.textAlign = 'left';

    // E-320 쉘측 하부 -> D-5321 연결
    drawArrow(stageXs[0] - 21, 145, d5321X + 20, 175, '#B45309');

    // 각 효용 강하막 증발관 (크기 40% 축소: 폭 42px × 높이 82px) + 하부 분리기 (폭 54px × 높이 44px) + 펌프 (반지름 8.5px)
    simData.stages.forEach((st, idx) => {
      const cx = stageXs[idx];
      const isSelected = selectedEquipTag === st.evapTag || selectedEquipTag === st.sepTag;

      const calW = 42;
      const calH = 82;
      const calX = cx - calW / 2;
      const calY = 84;

      ctx.fillStyle = isSelected ? '#EFECE5' : '#F8FAFC';
      ctx.strokeStyle = '#1A2F44';
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.fillRect(calX, calY, calW, calH);
      ctx.strokeRect(calX, calY, calW, calH);

      // 상부 돔 헤드
      ctx.beginPath();
      ctx.arc(cx, calY, calW / 2, Math.PI, 0);
      ctx.fill();
      ctx.stroke();

      // 내부 세로 튜브선 (컴팩트)
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 0.8;
      for (let tx = calX + 8; tx <= calX + calW - 8; tx += 6.5) {
        ctx.beginPath();
        ctx.moveTo(tx, calY + 5);
        ctx.lineTo(tx, calY + calH - 4);
        ctx.stroke();
      }

      // 하부 일체형 기액분리기 (D-321/331/341 — 컴팩트)
      const sepW = 54;
      const sepH = 44;
      const sepX = cx - sepW / 2;
      const sepY = calY + calH;

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1A2F44';
      ctx.lineWidth = 1.5;
      ctx.fillRect(sepX, sepY, sepW, sepH);
      ctx.strokeRect(sepX, sepY, sepW, sepH);

      // 데미스터 점선
      ctx.strokeStyle = '#64748B';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(sepX + 3, sepY + 10);
      ctx.lineTo(sepX + sepW - 3, sepY + 10);
      ctx.stroke();
      ctx.setLineDash([]);

      // 하부 액위 표시
      ctx.fillStyle = 'rgba(15, 118, 110, 0.13)';
      ctx.fillRect(sepX + 2, sepY + 26, sepW - 4, sepH - 28);

      // 상단 효용 태그 및 사양
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1A2F44';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`${st.evapTag} (${st.effectNo}효)`, cx, calY - 16);
      ctx.fillStyle = '#0F766E';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillText(`${st.designResults.A_prov_m2.toFixed(1)}m²·${st.designResults.N_tubes}T`, cx, calY - 5);

      // 분리기 태그 및 농도·온도
      ctx.fillStyle = '#1A2F44';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillText(st.sepTag, cx, sepY + 21);
      ctx.fillStyle = '#B45309';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.fillText(`${st.wtOut_pct.toFixed(1)}%·${st.T_boil_C.toFixed(0)}°C`, cx, sepY + 34);

      // 하부 컴팩트 순환/이송 펌프 (P-321/331/341)
      const pmpY = sepY + sepH + 26;
      ctx.beginPath();
      ctx.arc(cx, pmpY, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = '#EFECE5';
      ctx.fill();
      ctx.strokeStyle = '#1A2F44';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#1A2F44';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.fillText(st.pumpTag.replace('A/B', ''), cx + 22, pmpY + 3);

      drawArrow(cx, sepY + sepH, cx, pmpY - 8.5, '#0F766E', false, 1.4);

      // 강하막 적심율 유지용 내부 재순환 점선 (컴팩트)
      ctx.save();
      ctx.strokeStyle = '#0F766E';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx - 8.5, pmpY);
      ctx.lineTo(cx - 34, pmpY);
      ctx.lineTo(cx - 34, calY - 4);
      ctx.lineTo(cx - 10, calY - 4);
      ctx.stroke();
      ctx.restore();

      // 발생 수증기 V_i 라인 -> 다음 효용 쉘측 또는 표면응축기 E-350
      const nextX = idx < simData.stages.length - 1 ? stageXs[idx + 1] - calW / 2 : 1015;
      const vapY = sepY + 12;
      ctx.save();
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(sepX + sepW, vapY);
      ctx.lineTo(cx + 42, vapY);
      ctx.lineTo(cx + 42, 113);
      ctx.lineTo(nextX, 113);
      ctx.stroke();
      ctx.restore();
      drawArrow(nextX - 8, 113, nextX, 113, '#D97706');
      drawBadge(
        (cx + 42 + nextX) / 2,
        98,
        `V${st.effectNo}`,
        `${st.evapWater_kgh.toFixed(0)} kg/h (${st.T_sat_water_C}°C)`,
        '#D97706'
      );
      ctx.textAlign = 'left';
    });

    // 우측 상단: 진공 표면응축기 (E-350) & 진공펌프 (VP-360) & 원료 급액 (L1)
    const condX = 1015;
    const condY = 88;
    ctx.fillStyle = '#F0FDFA';
    ctx.strokeStyle = '#0F766E';
    ctx.lineWidth = 1.5;
    ctx.fillRect(condX, condY, 82, 50);
    ctx.strokeRect(condX, condY, 82, 50);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillText('E-350 응축기', condX + 41, condY + 17);
    ctx.fillStyle = '#0F766E';
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillText(`${simData.Q_cond_kW.toFixed(0)} kW`, condX + 41, condY + 31);
    ctx.fillText(`CW ${simData.cwCond_m3h}m³/h`, condX + 41, condY + 43);

    const vpX = 1122;
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#1A2F44';
    ctx.lineWidth = 1.3;
    ctx.fillRect(vpX, condY + 6, 88, 38);
    ctx.strokeRect(vpX, condY + 6, 88, 38);
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText('VP-360A/B', vpX + 44, condY + 22);
    ctx.fillStyle = '#64748B';
    ctx.font = '8px "Inter", sans-serif';
    ctx.fillText('진공시스템', vpX + 44, condY + 35);
    drawArrow(condX + 82, condY + 25, vpX, condY + 25, '#64748B', true, 1.3);

    // 우측 중단: 32% NaOH 원료 급액 (L1) -> 최종 효용 상부 공급
    const lastStageX = stageXs[stageXs.length - 1];
    ctx.fillStyle = '#EFF6FF';
    ctx.strokeStyle = '#1D4ED8';
    ctx.lineWidth = 1.4;
    ctx.fillRect(1015, 162, 195, 42);
    ctx.strokeRect(1015, 162, 195, 42);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1D4ED8';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText(`원료 급액 L1 (${wtIn.toFixed(1)}% NaOH, ${feedTempC}°C)`, 1023, 179);
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText(`${simData.feedFlow_kgh.toLocaleString()} kg/h → ${simData.stages[simData.stages.length - 1].evapTag} 상부`, 1023, 195);

    ctx.save();
    ctx.strokeStyle = '#1D4ED8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(1015, 183);
    ctx.lineTo(lastStageX + 32, 183);
    ctx.lineTo(lastStageX + 32, 58);
    ctx.lineTo(lastStageX, 58);
    ctx.stroke();
    ctx.restore();
    drawArrow(lastStageX, 58, lastStageX, 68, '#1D4ED8', false, 1.6);
    drawBadge((1015 + lastStageX + 32) / 2, 183, 'L1', `${simData.feedFlow_kgh.toFixed(0)} kg/h`, '#1D4ED8');

    // ─── 중단 & 하단 2열 열회수 레인 (Train A: 가성소다 Hot / Train B: 13K 스팀응축수 Hot) ───
    const yTrainA = 328; // Train A: E-332 -> E-342 -> E-352 (Hot = 50% NaOH L11->L12->L13->L14)
    const yTrainB = 438; // Train B: E-333 -> E-343 (Hot = 13K 스팀 응축수 C1->C2->C3)

    // 레인 구분 배경 박스
    ctx.fillStyle = 'rgba(234, 88, 12, 0.04)';
    ctx.strokeStyle = 'rgba(234, 88, 12, 0.25)';
    ctx.lineWidth = 1;
    ctx.fillRect(20, yTrainA - 36, W - 40, 68);
    ctx.strokeRect(20, yTrainA - 36, W - 40, 68);
    ctx.fillStyle = '#C2410C';
    ctx.font = 'bold 9px "Inter", sans-serif';
    ctx.fillText('열회수 TRAIN A — Hot Stream: 1효 출구 50% 가성소다 (L11 → E-332 → L12 → E-342 → L13 → E-352 냉각 → L14 제품) / Cold: 급액 75.5% 분기 (L8, L3)', 28, yTrainA - 23);

    ctx.fillStyle = 'rgba(2, 132, 199, 0.04)';
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.25)';
    ctx.fillRect(20, yTrainB - 36, W - 40, 68);
    ctx.strokeRect(20, yTrainB - 36, W - 40, 68);
    ctx.fillStyle = '#0369A1';
    ctx.font = 'bold 9px "Inter", sans-serif';
    ctx.fillText('열회수 TRAIN B — Hot Stream: 13K 스팀 응축수 (D-5321 → C1 → E-333 → C2 → E-343 → C3 회수) / Cold: 급액 24.5% 분기 (L9, L4)', 28, yTrainB - 23);

    // E-332 / E-333 배치 X좌표
    const xHex1 = effectCount === 1 ? 520 : (stageXs[0] + stageXs[1]) / 2;
    const xHex2 = effectCount === 3 ? (stageXs[1] + stageXs[2]) / 2 : 760;
    const xE352 = 955;

    // 1. E-332 (Hot: 50% NaOH L11->L12 / Cold: L8 75.5%) & E-333 (Hot: 13K 응축수 C1->C2 / Cold: L9 24.5%)
    drawCompactPHE(xHex1, yTrainA, 'E-332', 'Hot: 50% 가성소다', 'Cold: L8 (75.5%)', '#C2410C', '#FFF7ED');
    drawCompactPHE(xHex1, yTrainB, 'E-333', 'Hot: 13K 스팀응축수', 'Cold: L9 (24.5%)', '#0369A1', '#F0F9FF');

    // 1효 P-321 토출(L11: 50% NaOH) -> E-332 Hot 입구
    ctx.save();
    ctx.strokeStyle = '#C2410C';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(stageXs[0], 244);
    ctx.lineTo(stageXs[0], yTrainA);
    ctx.lineTo(xHex1 - 44, yTrainA);
    ctx.stroke();
    ctx.restore();
    drawArrow(xHex1 - 52, yTrainA, xHex1 - 44, yTrainA, '#C2410C');
    drawBadge((stageXs[0] + xHex1 - 44) / 2, yTrainA, 'L11', `50% NaOH (${simData.stages[0].T_boil_C.toFixed(0)}°C)`, '#C2410C');

    // D-5321 하부(C1: 13K 스팀 응축수) -> E-333 Hot 입구
    ctx.save();
    ctx.strokeStyle = '#0369A1';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(d5321X, d5321Y + 44);
    ctx.lineTo(d5321X, yTrainB);
    ctx.lineTo(xHex1 - 44, yTrainB);
    ctx.stroke();
    ctx.restore();
    drawArrow(xHex1 - 52, yTrainB, xHex1 - 44, yTrainB, '#0369A1');
    drawBadge((d5321X + xHex1 - 44) / 2, yTrainB, 'C1', `13K응축수 ${simData.C1_cond_kgh.toFixed(0)}kg/h`, '#0369A1');

    if (effectCount === 3) {
      // 3효일 때 E-342 (Hot: 50% NaOH L12->L13 / Cold: L3 75.5%) & E-343 (Hot: 13K 응축수 C2->C3 / Cold: L4 24.5%)
      drawCompactPHE(xHex2, yTrainA, 'E-342', 'Hot: 50% 가성소다', 'Cold: L3 (75.5%)', '#C2410C', '#FFF7ED');
      drawCompactPHE(xHex2, yTrainB, 'E-343', 'Hot: 13K 스팀응축수', 'Cold: L4 (24.5%)', '#0369A1', '#F0F9FF');

      // E-332 -> L12 -> E-342 -> L13 -> E-352
      drawArrow(xHex1 + 44, yTrainA, xHex2 - 44, yTrainA, '#C2410C');
      drawBadge((xHex1 + xHex2) / 2, yTrainA, 'L12', '120°C', '#C2410C');

      drawArrow(xHex2 + 44, yTrainA, xE352 - 44, yTrainA, '#C2410C');
      drawBadge((xHex2 + xE352) / 2, yTrainA, 'L13', '75°C', '#C2410C');

      // E-333 -> C2 -> E-343 -> C3 (보일러 응축수 회수)
      drawArrow(xHex1 + 44, yTrainB, xHex2 - 44, yTrainB, '#0369A1');
      drawBadge((xHex1 + xHex2) / 2, yTrainB, 'C2', '126.6°C', '#0369A1');

      drawArrow(xHex2 + 44, yTrainB, 1045, yTrainB, '#0369A1');
      drawBadge(945, yTrainB, 'C3', '74.7°C 회수', '#0369A1');

      // 3효 P-341(L2) -> L3(75.5% to E-342) & L4(24.5% to E-343) -> 합류 L5 -> 2효 E-330 상부
      drawArrow(stageXs[2], 244, xHex2, yTrainA - 19, '#0F766E', true, 1.3);
      drawArrow(stageXs[2], 244, xHex2, yTrainB - 19, '#0F766E', true, 1.3);
      ctx.save();
      ctx.strokeStyle = '#0F766E';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(xHex2 - 18, yTrainA - 19);
      ctx.lineTo(stageXs[1] + 28, 58);
      ctx.lineTo(stageXs[1], 58);
      ctx.stroke();
      ctx.restore();
      drawArrow(stageXs[1], 58, stageXs[1], 68, '#0F766E', false, 1.4);
      drawBadge(stageXs[1] + 55, 70, 'L5', '109.6°C (L3+L4 합류)', '#0F766E');
    } else {
      // 1효 또는 2효일 때 E-332 -> L12 -> E-352 직결, E-333 -> C2 회수
      drawArrow(xHex1 + 44, yTrainA, xE352 - 44, yTrainA, '#C2410C');
      drawBadge((xHex1 + xE352) / 2, yTrainA, 'L12', '118°C', '#C2410C');

      drawArrow(xHex1 + 44, yTrainB, 1045, yTrainB, '#0369A1');
      drawBadge((xHex1 + 1045) / 2, yTrainB, 'C2', '78°C 응축수 회수', '#0369A1');
    }

    // 2효 P-331(L7) -> L8(75.5% to E-332) & L9(24.5% to E-333) -> 합류 L10 -> 1효 E-320 상부
    const feedSourceX = effectCount >= 2 ? stageXs[1] : 980;
    if (effectCount >= 2) {
      drawArrow(feedSourceX, 244, xHex1, yTrainA - 19, '#0F766E', true, 1.3);
      drawArrow(feedSourceX, 244, xHex1, yTrainB - 19, '#0F766E', true, 1.3);
    }
    ctx.save();
    ctx.strokeStyle = '#0F766E';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(xHex1 - 18, yTrainA - 19);
    ctx.lineTo(stageXs[0] + 28, 58);
    ctx.lineTo(stageXs[0], 58);
    ctx.stroke();
    ctx.restore();
    drawArrow(stageXs[0], 58, stageXs[0], 68, '#0F766E', false, 1.4);
    drawBadge(stageXs[0] + 55, 70, 'L10', `${simData.stages[0].T_feed_C.toFixed(0)}°C (L8+L9 합류)`, '#0F766E');

    // E-352 (50% 가성소다 제품 최종 냉각기: Hot = 50% NaOH, Cold = CW)
    drawCompactPHE(xE352, yTrainA, 'E-352', 'Hot: 50% 가성소다', 'Cold: 냉각수(CW)', '#1A2F44', '#F8FAFC');
    drawArrow(xE352 + 44, yTrainA, 1055, yTrainA, '#1A2F44');

    // 우측 Train A 끝단: L14 50% NaOH 최종 제품 박스
    ctx.fillStyle = '#1A2F44';
    ctx.fillRect(1055, yTrainA - 20, 155, 40);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText(`L14: ${wtOut.toFixed(0)}% NaOH 제품 (42°C)`, 1063, yTrainA - 4);
    ctx.fillStyle = '#A7F3D0';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText(`${simData.prodFlow_kgh.toLocaleString()} kg/h`, 1063, yTrainA + 12);

    // 우측 Train B 끝단: C3/C2 13K 스팀 응축수 회수 박스
    ctx.fillStyle = '#F0F9FF';
    ctx.strokeStyle = '#0369A1';
    ctx.lineWidth = 1.4;
    ctx.fillRect(1045, yTrainB - 20, 165, 40);
    ctx.strokeRect(1045, yTrainB - 20, 165, 40);
    ctx.fillStyle = '#0369A1';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText(`${effectCount === 3 ? 'C3' : 'C2'}: 13K 스팀응축수 회수`, 1053, yTrainB - 4);
    ctx.fillStyle = '#1A2F44';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText(`${simData.C1_cond_kgh.toLocaleString()} kg/h (74.7°C)`, 1053, yTrainB + 12);
    ctx.restore();
  }, [simData, effectCount, wtIn, wtOut, feedTempC, steamPressG, selectedEquipTag]);

  // ─── 7. 선택된 효용 증발관 상세 CAD 도면 렌더링 ────────────────────
  useEffect(() => {
    if (dwgCanvasRef.current && selectedStage) {
      drawFallingFilmBlueprintCanvas(dwgCanvasRef.current, selectedStage.designInputs, selectedStage.designResults);
    }
  }, [selectedStage, activeSection, selectedEquipTag]);

  // 전체 기기 사양을 메인 플랫폼 장치 목록(pfdStore)에 일괄 동기화
  const handleSyncAllToPlantEquipList = () => {
    const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    simData.equipRows.forEach(eq => {
      setEquipmentSpecOverride(eq.tag, {
        name: eq.name,
        fluid: eq.fluid,
        operTemp: eq.operTemp_C,
        operPress: eq.operPress,
        designTemp: eq.designTemp_C,
        designPress: eq.designPress,
        material: eq.material,
        capacity: `${eq.dutyOrFlow} / ${eq.areaOrPower} (${eq.dimensions})`,
        motor: eq.category === 'PUMP' || eq.category === 'VAC' ? eq.areaOrPower : '-',
        remarks: `[${effectCount}중 효용 · ${simData.capTonDay.toFixed(1)} MTPD 설계완료] ${eq.remarks}`,
        designedAt: nowStr,
      });
    });
    setSavedNotice(
      `${effectCount}중 효용 농축공정 (${simData.capTonDay.toFixed(1)} MTPD) 전체 장치 ${simData.equipRows.length}종의 설계 사양이 플랜트 통합 장치 목록(Equipment List)에 반영되었습니다!`
    );
  };

  // CSV 다운로드 헬퍼 (물질흐름표 / 장치목록)
  const handleDownloadCSV = (type: 'streams' | 'equip') => {
    let csv = '\uFEFF';
    if (type === 'streams') {
      csv += 'Stream ID,스트림 명칭,상(Phase),총 유량(kg/h),NaOH 유량(kg/h),H2O 유량(kg/h),NaOH 농도(wt%),온도(°C),압력(kg/cm2G),밀도(kg/m3),열량(Mcal/h),배관 규격(NPS),비고\n';
      simData.streamRows.forEach(s => {
        csv += `"${s.id}","${s.name}","${s.phase}",${s.total_kgh},${s.naoh_kgh},${s.h2o_kgh},${s.wt_pct},${s.temp_C},${s.press_kgcm2g},${s.density_kgm3},${s.enthalpy_Mcalh},"${s.lineSize_NPS}","${s.serviceDesc}"\n`;
      });
    } else {
      csv += 'Tag No,기기 명칭,구분,취급 유체,열부하/유량,전열면적/동력,주요 치수,운전온도(°C),운전압력,설계온도(°C),설계압력,재질(Material),노즐 규격,비고\n';
      simData.equipRows.forEach(e => {
        csv += `"${e.tag}","${e.name}","${e.category}","${e.fluid}","${e.dutyOrFlow}","${e.areaOrPower}","${e.dimensions}","${e.operTemp_C}","${e.operPress}","${e.designTemp_C}","${e.designPress}","${e.material}","${e.nozzles}","${e.remarks}"\n`;
      });
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ChemPlant_${effectCount}Effect_Evap_${type}_${simData.capTonDay.toFixed(0)}MTPD.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      {/* ─── 1. 상단 운전 캐파(Capacity) 입력 & 1·2·3중 효용관 선택 마스터 패널 ─── */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E5E2DC',
        borderRadius: 16,
        padding: '14px 18px',
        boxShadow: '0 2px 8px rgba(26, 47, 68, 0.05)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1A2F44', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>농축공정 통합 설계 워크스테이션 (1·2·3중 효용 강하막 증발관)</span>
              <span style={{
                fontSize: 10,
                padding: '3px 10px',
                borderRadius: 14,
                background: '#1A2F44',
                color: '#FFFFFF',
                fontWeight: 700,
              }}>
                캐파 입력 → 1·2·3효 선택 → PFD · 물질수지 · 장치목록 · Datasheet 자동 생성
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#5A6570', marginTop: 3 }}>
              플랜트 목표 생산 캐파(MTPD)와 효용관 단수(1중/2중/3중)를 선택하면 Dühring 비점오름(BPR), 열·물질수지, 전열면적 및 부속기기가 즉시 재설계됩니다.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSyncAllToPlantEquipList}
              style={{
                padding: '7px 14px',
                borderRadius: 18,
                background: '#1A2F44',
                color: '#FFFFFF',
                border: '1px solid #1A2F44',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✓ 전공정 기기목록에 설계사양 일괄 반영
            </button>
          </div>
        </div>

        {savedNotice && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 10,
            background: '#EFECE5',
            border: '1px solid #1A2F44',
            color: '#1A2F44',
            fontSize: 11.5,
            fontWeight: 700,
            marginBottom: 12,
          }}>
            {savedNotice}
          </div>
        )}

        {/* 캐파 입력 + 1/2/3중 효용 선택 + 농도/압력 설정 그리드 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 12,
          background: '#F6F7F2',
          padding: '12px 14px',
          borderRadius: 12,
          border: '1px solid #E5E2DC',
        }}>
          {/* (1) 플랜트 생산 캐파 입력 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#1A2F44', display: 'flex', justifyContent: 'space-between' }}>
              <span>① 생산 캐파 (100% Dry NaOH 기준)</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F766E' }}>
                급액 {simData.feedFlow_kgh.toLocaleString()} kg/h
              </span>
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min={20}
                max={3000}
                step={10}
                value={capacityMTPD}
                onChange={e => setCapacityMTPD(Math.max(10, Number(e.target.value) || 100))}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: 800,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>MTPD (톤/일)</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[100, 250, 514.3, 750, 1000].map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCapacityMTPD(preset)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: Math.abs(capacityMTPD - preset) < 0.5 ? '#1A2F44' : '#FFFFFF',
                    color: Math.abs(capacityMTPD - preset) < 0.5 ? '#FFFFFF' : '#2C353E',
                    border: '1px solid #DFDCD4',
                  }}
                >
                  {preset === 514.3 ? '514.3 (기준공장)' : `${preset} T/D`}
                </button>
              ))}
            </div>
          </div>

          {/* (2) 효용관 단수 선택 (1중 / 2중 / 3중 효용관) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#1A2F44', display: 'flex', justifyContent: 'space-between' }}>
              <span>② 효용관 단수 선택 (1·2·3중 효용)</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#B45309' }}>
                Economy: {simData.steamEconomy.toFixed(2)} kg/kg
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {([
                { n: 1 as EffectCount, title: '1중 효용관', sub: 'Single (E-320)' },
                { n: 2 as EffectCount, title: '2중 효용관', sub: 'Double (E-320·330)' },
                { n: 3 as EffectCount, title: '3중 효용관', sub: 'Triple (E-320~340)' },
              ]).map(opt => {
                const active = effectCount === opt.n;
                return (
                  <button
                    key={opt.n}
                    type="button"
                    onClick={() => setEffectCount(opt.n)}
                    style={{
                      padding: '7px 6px',
                      borderRadius: 10,
                      border: active ? '1.5px solid #1A2F44' : '1px solid #DFDCD4',
                      background: active ? '#1A2F44' : '#FFFFFF',
                      color: active ? '#FFFFFF' : '#1A2F44',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      boxShadow: active ? '0 2px 6px rgba(26, 47, 68, 0.18)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 800 }}>{opt.title}</span>
                    <span style={{ fontSize: 9, color: active ? '#CBD5E1' : '#7A7872', fontFamily: 'JetBrains Mono, monospace' }}>
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* (3) 농도 및 급액 온도 조건 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, alignItems: 'start' }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#2C353E', display: 'block', marginBottom: 4 }}>
                입구 농도 (wt%)
              </label>
              <input
                type="number"
                step={0.5}
                value={wtIn}
                onChange={e => setWtIn(Number(e.target.value) || 32)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#2C353E', display: 'block', marginBottom: 4 }}>
                제품 농도 (wt%)
              </label>
              <input
                type="number"
                step={0.5}
                value={wtOut}
                onChange={e => setWtOut(Number(e.target.value) || 50)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#2C353E', display: 'block', marginBottom: 4 }}>
                급액 온도
              </label>
              <UnitNumberInput
                quantity="temp"
                value={feedTempC}
                onValueChange={v => setFeedTempC(v)}
                inputStyle={{ padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
              />
            </div>
          </div>

          {/* (4) 가열 스팀 및 최종 진공 조건 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, alignItems: 'start' }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#2C353E', display: 'block', marginBottom: 4 }}>
                13K 스팀압
              </label>
              <UnitNumberInput
                quantity="pressG"
                value={steamPressG}
                onValueChange={v => setSteamPressG(v)}
                inputStyle={{ padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#2C353E', display: 'block', marginBottom: 4 }}>
                최종 진공압
              </label>
              <UnitNumberInput
                quantity="pressG"
                value={vacPressG}
                onValueChange={v => setVacPressG(v)}
                inputStyle={{ padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
              />
            </div>
          </div>
        </div>

        {/* 실시간 핵심 KPI 요약 타일 */}
        {(() => {
          const totalEvapDuty_Mcalh = simData.stages.reduce((acc, st) => acc + st.Q_duty_Mcalh, 0);
          const totalEvapArea_m2 = simData.stages.reduce((acc, st) => acc + st.designResults.A_prov_m2, 0);
          const kpiCards: Array<{
            lbl: string;
            val: string;
            sub: string;
            highlight?: boolean;
            unitControl?: React.ReactNode;
          }> = [
            {
              lbl: '원료 급액 유량 (L1)',
              val: `${formatCanonicalValue('massFlow', simData.feedFlow_kgh, flowUnit)} ${getUnitLabel('massFlow', flowUnit)}`,
              sub: `${wtIn.toFixed(1)} wt% NaOH (${formatCanonicalValue('temp', feedTempC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)})`,
            },
            {
              lbl: '50% 농축 제품량 (L14)',
              val: `${formatCanonicalValue('massFlow', simData.prodFlow_kgh, flowUnit)} ${getUnitLabel('massFlow', flowUnit)}`,
              sub: `Dry ${formatCanonicalValue('massFlow', simData.naohPure_kgh, flowUnit)} ${getUnitLabel('massFlow', flowUnit)} (${simData.capTonDay.toFixed(1)} T/D)`,
            },
            {
              lbl: '총 수분 증발량 (V_tot)',
              val: `${formatCanonicalValue('massFlow', simData.totalEvap_kgh, flowUnit)} ${getUnitLabel('massFlow', flowUnit)}`,
              sub: `${effectCount}단 분할 증발`,
            },
            {
              lbl: '13K 생증기 소비량 (S1)',
              val: `${formatCanonicalValue('massFlow', simData.liveSteam_kgh, flowUnit)} ${getUnitLabel('massFlow', flowUnit)}`,
              sub: `스팀 원단위 ${(simData.liveSteam_kgh / simData.naohPure_kgh).toFixed(2)} t-S/t-NaOH`,
            },
            {
              lbl: '스팀 경제성 (Economy)',
              val: `${simData.steamEconomy.toFixed(2)} kg-V/kg-S`,
              sub: effectCount === 3 ? '3중 효용 최적 에너지 회수' : effectCount === 2 ? '2중 효용 열회수' : '단일 효용 운전',
              highlight: true,
            },
            {
              lbl: '총 증발 열부하 (Heat Duty)',
              val: `${formatCanonicalValue('heatDuty', totalEvapDuty_Mcalh, dutyUnit, 1)} ${getUnitLabel('heatDuty', dutyUnit)}`,
              sub: `${effectCount}효 증발관 합계`,
              unitControl: <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} size="xs" />,
            },
            {
              lbl: '총 증발 전열면적 (Area)',
              val: `${formatCanonicalValue('area', totalEvapArea_m2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)}`,
              sub: `증발관 ${effectCount} · 총 ${simData.equipRows.length}기`,
              unitControl: <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} size="xs" />,
            },
          ];
          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
              gap: 8,
              marginTop: 10,
            }}>
              {kpiCards.map((k, idx) => (
                <div
                  key={idx}
                  style={{
                    background: k.highlight ? '#EFECE5' : '#FFFFFF',
                    border: k.highlight ? '1.5px solid #1A2F44' : '1px solid #E5E2DC',
                    borderRadius: 10,
                    padding: '8px 11px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#5A6570' }}>{k.lbl}</span>
                    {k.unitControl}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1A2F44', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                    {k.val}
                  </div>
                  <div style={{ fontSize: 9.5, color: '#7A7872', marginTop: 1 }}>{k.sub}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* 섹션 표시 필터 바 (한눈에 통합 보기 / 개별 섹션 집중 보기) */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid #ECEAE4' }}>
          {([
            { key: 'all', label: '★ 전체 통합 화면 (PFD + 물질흐름표 + 장치목록 + Datasheet)' },
            { key: 'pfd', label: '① 공정도 (PFD)' },
            { key: 'streams', label: '② 물질 및 열수지 흐름표 (Stream Table)' },
            { key: 'equip', label: '③ 장치 목록 (Equipment List)' },
            { key: 'datasheet', label: '④ 장치별 상세 Datasheet & CAD 도면' },
          ] as const).map(tab => {
            const active = activeSection === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSection(tab.key)}
                style={{
                  padding: '6px 13px',
                  borderRadius: 16,
                  border: active ? '1px solid #1A2F44' : '1px solid #DFDCD4',
                  background: active ? '#1A2F44' : '#F6F7F2',
                  color: active ? '#FFFFFF' : '#2C353E',
                  fontSize: 11,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 2. ① 공정도 (Dynamic 1/2/3-Effect Process Flow Diagram) ─── */}
      {(activeSection === 'all' || activeSection === 'pfd') && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E2DC',
          borderRadius: 16,
          padding: '14px 18px',
          boxShadow: '0 2px 8px rgba(26, 47, 68, 0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1A2F44' }}>
                ① {effectCount}중 효용 강하막 증발·농축 공정도 (Process Flow Diagram — {simData.capTonDay.toFixed(1)} MTPD)
              </div>
              <div style={{ fontSize: 11, color: '#5A6570' }}>
                하단 효용 카드를 클릭하면 해당 효용 증발관·분리기·펌프의 상세 Datasheet와 CAD 도면이 즉시 연동됩니다.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {simData.stages.map(st => (
                <button
                  key={st.evapTag}
                  type="button"
                  onClick={() => setSelectedEquipTag(st.evapTag)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 14,
                    border: selectedEquipTag === st.evapTag ? '1.5px solid #1A2F44' : '1px solid #DFDCD4',
                    background: selectedEquipTag === st.evapTag ? '#1A2F44' : '#EFECE5',
                    color: selectedEquipTag === st.evapTag ? '#FFFFFF' : '#1A2F44',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {st.evapTag} ({st.effectNo}효: {st.wtIn_pct.toFixed(1)}→{st.wtOut_pct.toFixed(1)}%, {formatCanonicalValue('area', st.designResults.A_prov_m2, areaUnit, 1)}{getUnitLabel('area', areaUnit)})
                </button>
              ))}
            </div>
          </div>

          <div style={{
            width: '100%',
            overflowX: 'auto',
            borderRadius: 10,
            border: '1px solid #DFDCD4',
            background: '#FFFFFF',
          }}>
            <canvas
              ref={pfdCanvasRef}
              style={{ width: '100%', minWidth: 780, height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      )}

      {/* ─── 3. ② 물질 및 열수지 흐름표 (Material & Energy Stream Table) ─── */}
      {(activeSection === 'all' || activeSection === 'streams') && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E2DC',
          borderRadius: 16,
          padding: '14px 18px',
          boxShadow: '0 2px 8px rgba(26, 47, 68, 0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1A2F44' }}>
                ② 물질 및 열수지 흐름표 (Material &amp; Energy Balance Stream Table — {effectCount}중 효용 · {simData.capTonDay.toFixed(1)} MTPD)
              </div>
              <div style={{ fontSize: 11, color: '#5A6570' }}>
                총 {simData.streamRows.length}개 스트림 (급액, 효용별 농축액, 가열 스팀, 발생 수증기, 응축수, 냉각수 및 ANSI 배관 규격)
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDownloadCSV('streams')}
              style={{
                padding: '6px 12px',
                borderRadius: 14,
                background: '#EFECE5',
                border: '1px solid #1A2F44',
                color: '#1A2F44',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⬇ 물질흐름표 CSV/Excel 다운로드
            </button>
          </div>

          <div style={{ width: '100%', overflowX: 'auto', border: '1px solid #E5E2DC', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: '#EFECE5' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>Stream</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>스트림 명칭</th>
                  <th style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>상</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span>총 유량</span>
                      <UnitSelect quantity="massFlow" value={flowUnit} onChange={setFlowUnit} size="xs" />
                    </div>
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>NaOH ({getUnitLabel('massFlow', flowUnit)})</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>H₂O ({getUnitLabel('massFlow', flowUnit)})</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>농도 (wt%)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span>온도</span>
                      <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} size="xs" />
                    </div>
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span>압력</span>
                      <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} size="xs" />
                    </div>
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span>밀도</span>
                      <UnitSelect quantity="density" value={densUnit} onChange={setDensUnit} size="xs" />
                    </div>
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span>열량</span>
                      <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} size="xs" />
                    </div>
                  </th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>배관 (ANSI)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>흐름 경로 및 설명</th>
                </tr>
              </thead>
              <tbody>
                {simData.streamRows.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #ECEAE4' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#1A2F44', whiteSpace: 'nowrap' }}>
                      {s.id}
                    </td>
                    <td style={{ padding: '6px 10px', fontWeight: 700, color: '#1A2F44', whiteSpace: 'nowrap' }}>{s.name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                      <span style={{
                        padding: '1px 6px',
                        borderRadius: 8,
                        fontSize: 10,
                        background: s.phase === 'V' ? '#FEF3C7' : '#EFECE5',
                        color: '#1A2F44',
                      }}>
                        {s.phase}
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44' }}>
                      {formatCanonicalValue('massFlow', s.total_kgh, flowUnit)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {s.naoh_kgh > 0 ? formatCanonicalValue('massFlow', s.naoh_kgh, flowUnit) : '-'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {formatCanonicalValue('massFlow', s.h2o_kgh, flowUnit)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                      {s.wt_pct > 0 ? `${s.wt_pct.toFixed(2)}%` : '-'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                      {formatCanonicalValue('temp', s.temp_C, tempUnit, 1)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {formatCanonicalValue('pressG', s.press_kgcm2g, pressUnit)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {formatCanonicalValue('density', s.density_kgm3, densUnit)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {formatCanonicalValue('heatDuty', s.enthalpy_Mcalh, dutyUnit)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {s.lineSize_NPS}
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 11, color: '#5A6570', whiteSpace: 'nowrap' }}>{s.serviceDesc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 4. ③ 공정 장치 목록 (Equipment List) ─── */}
      {(activeSection === 'all' || activeSection === 'equip') && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E2DC',
          borderRadius: 16,
          padding: '14px 18px',
          boxShadow: '0 2px 8px rgba(26, 47, 68, 0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1A2F44' }}>
                ③ 농축공정 장치 목록 (Equipment List — {effectCount}중 효용 · 총 {simData.equipRows.length}종 기기 자동 사이징)
              </div>
              <div style={{ fontSize: 11, color: '#5A6570' }}>
                각 기기의 <strong>[Datasheet 보기]</strong> 버튼을 클릭하면 하단에서 TEMA / ASME / API 표준 데이터시트와 CAD 도면을 바로 출력할 수 있습니다.
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDownloadCSV('equip')}
              style={{
                padding: '6px 12px',
                borderRadius: 14,
                background: '#EFECE5',
                border: '1px solid #1A2F44',
                color: '#1A2F44',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⬇ 장치목록 CSV/Excel 다운로드
            </button>
          </div>

          <div style={{ width: '100%', overflowX: 'auto', border: '1px solid #E5E2DC', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: '#EFECE5' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>Tag No.</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>기기 명칭 (Equipment Name)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>열부하 / 유량</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>전열면적 / 동력</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>주요 규격 및 치수</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>운전 온도/압력</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>선정 재질 (Material)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>Datasheet</th>
                </tr>
              </thead>
              <tbody>
                {simData.equipRows.map(eq => {
                  const isSel = eq.tag === selectedEquipTag;
                  return (
                    <tr
                      key={eq.tag}
                      onClick={() => setSelectedEquipTag(eq.tag)}
                      style={{
                        borderBottom: '1px solid #ECEAE4',
                        background: isSel ? '#EFECE5' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '7px 10px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#1A2F44', whiteSpace: 'nowrap' }}>
                        {eq.tag}
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1A2F44' }}>
                        <div>{eq.name}</div>
                        <div style={{ fontSize: 10, color: '#5A6570', fontWeight: 500 }}>{eq.fluid}</div>
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {eq.dutyOrFlow}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                        {eq.areaOrPower}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                        <div>{eq.dimensions}</div>
                        <div style={{ fontSize: 10, color: '#5A6570' }}>Nozzles: {eq.nozzles}</div>
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, whiteSpace: 'nowrap' }}>
                        <div>{eq.operTemp_C} °C</div>
                        <div style={{ color: '#5A6570' }}>{eq.operPress}</div>
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, color: '#1A2F44' }}>
                        {eq.material}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={ev => {
                            ev.stopPropagation();
                            setSelectedEquipTag(eq.tag);
                            if (activeSection === 'equip') setActiveSection('datasheet');
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 12,
                            background: isSel ? '#1A2F44' : '#F6F7F2',
                            color: isSel ? '#FFFFFF' : '#1A2F44',
                            border: '1px solid #1A2F44',
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          시트/도면
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 5. ④ 장치별 상세 Engineering Datasheet & CAD Blueprint 도면 ─── */}
      {(activeSection === 'all' || activeSection === 'datasheet') && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E2DC',
          borderRadius: 16,
          padding: '14px 18px',
          boxShadow: '0 2px 8px rgba(26, 47, 68, 0.04)',
        }}>
          {/* 장치 선택 캡슐 바 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1A2F44' }}>
                ④ 장치별 상세 Engineering Datasheet &amp; CAD 도면 ({selectedEquipRow.tag} — {selectedEquipRow.name})
              </div>
              <div style={{ fontSize: 11, color: '#5A6570' }}>
                아래 기기 태그를 클릭하면 각 증발관·분리기·열교환기·응축기·펌프의 상세 사양서(Datasheet)가 즉시 전환됩니다.
              </div>
            </div>
            <button
              type="button"
              onClick={() => typeof window !== 'undefined' && window.print()}
              style={{
                padding: '6px 13px',
                borderRadius: 14,
                background: '#1A2F44',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🖨 Datasheet 인쇄 / PDF 저장
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {simData.equipRows.map(eq => {
              const active = eq.tag === selectedEquipTag;
              return (
                <button
                  key={eq.tag}
                  type="button"
                  onClick={() => setSelectedEquipTag(eq.tag)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 14,
                    border: active ? '1.5px solid #1A2F44' : '1px solid #DFDCD4',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    color: active ? '#FFFFFF' : '#2C353E',
                    fontSize: 11,
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {eq.tag} ({eq.category})
                </button>
              );
            })}
          </div>

          {/* 2-Column Layout: Left = Formal Engineering Datasheet Table, Right = High-Res CAD Blueprint */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 14,
            alignItems: 'start',
          }}>
            {/* 좌측: 공식 TEMA-R / ASME / API Engineering Specification Datasheet */}
            <div style={{
              border: '1.5px solid #1A2F44',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#FFFFFF',
            }}>
              <div style={{
                background: '#1A2F44',
                color: '#FFFFFF',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#FFFFFF' }}>
                    ENGINEERING SPECIFICATION DATASHEET — {selectedEquipRow.tag}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#CBD5E1', marginTop: 1 }}>
                    {selectedEquipRow.name}
                  </div>
                </div>
                <span style={{
                  fontSize: 10,
                  fontFamily: 'JetBrains Mono, monospace',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.16)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                }}>
                  {selectedEquipRow.category === 'EVAP' || selectedEquipRow.category === 'HEX' || selectedEquipRow.category === 'COND'
                    ? 'ASME VIII Div.1 · TEMA R'
                    : selectedEquipRow.category === 'SEP'
                      ? 'ASME Sect. VIII Div. 1'
                      : 'ASME B73.1 / API 610'}
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <tbody>
                  <tr style={{ background: '#EFECE5' }}>
                    <td colSpan={3} style={{ padding: '6px 12px', fontWeight: 800, color: '#1A2F44' }}>
                      1. GENERAL &amp; PROCESS DESIGN BASIS (일반 및 공정 설계 기준)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, width: '36%', borderBottom: '1px solid #ECEAE4' }}>Plant Capacity Basis</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>
                      {simData.capTonDay.toFixed(1)} MTPD (100% Dry NaOH) · {effectCount}-Effect Backward-Feed MEE
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Item Tag / Service</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.tag} — {selectedEquipRow.name}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Fluid Handled</td>
                    <td colSpan={2} style={{ padding: '6px 12px', borderBottom: '1px solid #ECEAE4' }}>{selectedEquipRow.fluid}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Thermal Duty / Flow Capacity</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.dutyOrFlow}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Surface Area / Rated Power</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#0F766E', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.areaOrPower}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Operating Temp / Pressure</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.operTemp_C} °C  |  {selectedEquipRow.operPress}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Design Temp / Pressure</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.designTemp_C} °C  |  {selectedEquipRow.designPress}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Dimensions &amp; Geometry</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.dimensions}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Materials of Construction</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontWeight: 800, color: '#1A2F44', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.material}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>Nozzle Schedule (ANSI CL150)</td>
                    <td colSpan={2} style={{ padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      {selectedEquipRow.nozzles}
                    </td>
                  </tr>

                  {/* 선택된 효용 증발관/분리기 상세 열수력학 데이터 */}
                  <tr style={{ background: '#EFECE5' }}>
                    <td colSpan={3} style={{ padding: '6px 12px', fontWeight: 800, color: '#1A2F44' }}>
                      2. FALLING-FILM THERMAL &amp; HYDRAULIC DETAILS ({selectedStage.evapTag} / {selectedStage.sepTag} 연동)
                    </td>
                  </tr>
                  <tr style={{ background: '#F6F7F2', fontWeight: 700 }}>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Parameter (설계 항목)</td>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Tube Side (NaOH Liquor Film)</td>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Shell Side (Heating Steam/Vapor)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Flow Rate (유량)</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      In {selectedStage.feedFlow_kgh.toLocaleString()} → Out {selectedStage.outFlow_kgh.toLocaleString()} kg/h (Recirc {selectedStage.designResults.recircFlow_kgh.toLocaleString()} kg/h)
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      Steam {selectedStage.heatingSteam_kgh.toLocaleString()} kg/h (Evap V={selectedStage.evapWater_kgh.toLocaleString()} kg/h)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>NaOH Concentration &amp; BPR</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, borderBottom: '1px solid #ECEAE4' }}>
                      {selectedStage.wtIn_pct.toFixed(2)}% → {selectedStage.wtOut_pct.toFixed(2)}% (BPR +{selectedStage.BPR_C.toFixed(1)} °C)
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      Pure Water Vapor / Condensate (ΔT_eff = {selectedStage.dT_eff_C.toFixed(1)} °C)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Film Wetting Rate (적심율 Γ)</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#0F766E', borderBottom: '1px solid #ECEAE4' }}>
                      Γ = {selectedStage.designResults.actualWettingRate_kgms.toFixed(2)} kg/m·s (Min Γ_min ≥ {selectedStage.designResults.minWettingRate_kgms} kg/m·s)
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      Re_film = {selectedStage.designResults.Re_film.toFixed(0)} · 액막두께 δ = {selectedStage.designResults.filmThickness_mm.toFixed(2)} mm
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Heat Transfer Coeff (열전달계수)</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      h_film = {selectedStage.designResults.h_film_Wm2K.toFixed(0)} W/m²·K (Chun-Seban)
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      h_cond = {selectedStage.designResults.h_cond_Wm2K.toFixed(0)} W/m²·K | U_dirty = {selectedStage.designResults.U_dirty_Wm2K.toFixed(0)} W/m²·K
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 12px', borderBottom: '1px solid #ECEAE4' }}>Vapor Exit &amp; Separator Hydraulics</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      Tube Exit v_vap = {selectedStage.designResults.vaporExitVel_ms.toFixed(1)} m/s (Limit {selectedStage.designResults.floodingVelLimit_ms.toFixed(1)} m/s)
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid #ECEAE4' }}>
                      Separator {selectedStage.sepTag} Ø{selectedStage.designResults.D_separator_mm} mm (v_sep = {selectedStage.designResults.v_sep_vapor_ms.toFixed(2)} m/s)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 700 }}>Engineering Notes</td>
                    <td colSpan={2} style={{ padding: '6px 12px', color: '#2C353E' }}>{selectedEquipRow.remarks}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 우측: 강하막 증발관 & 일체형 기액분리기 고해상도 CAD 도면 */}
            <div style={{
              border: '1px solid #DFDCD4',
              borderRadius: 10,
              padding: 12,
              background: '#FFFFFF',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44', fontFamily: 'JetBrains Mono, monospace' }}>
                  CAD BLUEPRINT — {selectedStage.evapTag} &amp; {selectedStage.sepTag} ({selectedStage.effectNo}효 강하막 증발관 · 기액분리기)
                </span>
                <span style={{ fontSize: 10, color: '#0F766E', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                  Ø{selectedStage.designResults.D_calandria_mm} / Ø{selectedStage.designResults.D_separator_mm} × {selectedStage.designResults.totalVesselLength_mm}H mm
                </span>
              </div>
              <canvas
                ref={dwgCanvasRef}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid #E5E2DC' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

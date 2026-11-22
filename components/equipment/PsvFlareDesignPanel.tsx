'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ENGINEERING_DISCLAIMER_ROWS } from '@/lib/legal/engineeringDisclaimer';
import {
  solvePSV,
  estimateFireEnvFactor,
  calcFireWettedAreaM2,
  calcTubeRuptureRelief,
  solvePSVGoverningScenarios,
  type PSVDesignInput,
  type PSVDesignResult,
  type PSVScenarioCaseInput,
  type PSVValveType,
  type PSVPhase,
  type PSVScenario,
} from '@/lib/calculations/psvDesign';
import {
  solveFlareNetwork,
  FLARE_PLANT_PRESETS,
  type FlareNetworkInput,
  type FlareNetworkResult,
  type FlareSourceBranch,
  type FlareValveType,
} from '@/lib/calculations/flareDesign';
import {
  UnitNumberInput,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  fromCanonical,
  getUnitLabel,
  toCanonical,
} from '@/lib/units/unitSystem';
import {
  PlusSquareIcon,
  SpecControlIcon,
  StreamFlowIcon,
  VesselEquipIcon,
} from '@/components/ui/EngIcons';

type SubTabKey = 'psv' | 'flare_net' | 'flare_rad';

const SCENARIO_OPTIONS: ReadonlyArray<{ value: PSVScenario; label: string; defaultOp: number }> = [
  { value: 'blocked_outlet', label: '출구 차단 (Blocked Outlet, 10%)', defaultOp: 10 },
  { value: 'fire_case', label: '외부 풀파이어 (Fire Case, 21%)', defaultOp: 21 },
  { value: 'tube_rupture', label: '열교환기 튜브 파열 (Tube Rupture, 10%)', defaultOp: 10 },
  { value: 'thermal_exp', label: '액체 열팽창 (Thermal Expansion, 10%)', defaultOp: 10 },
  { value: 'power_failure', label: '전력 상실 (Power Failure, 10%)', defaultOp: 10 },
  { value: 'cw_failure', label: '냉각수 중단 (CW Failure, 10%)', defaultOp: 10 },
  { value: 'reflux_failure', label: '환류 중단 (Reflux Failure, 10%)', defaultOp: 10 },
];

const PHASE_OPTIONS: ReadonlyArray<{ value: PSVPhase; label: string }> = [
  { value: 'vapor', label: '기상 / 가스 (Gas / Vapor)' },
  { value: 'steam', label: '수증기 (Steam · Kn/Ksh)' },
  { value: 'liquid', label: '액상 (Liquid · Iterative Kv/Kp)' },
  { value: 'twophase', label: '2상 플래싱 (API 520 Annex C Omega)' },
];

const VALVE_TYPE_OPTIONS: ReadonlyArray<{ value: PSVValveType; label: string; limitNote: string }> = [
  { value: 'conventional', label: 'Conventional (일반형)', limitNote: '배압 ≤ 10% (화재 21%)' },
  { value: 'balanced_bellows', label: 'Balanced Bellows (벨로우즈형)', limitNote: '배압 ≤ 50% (Kb/Kw 보정)' },
  { value: 'pilot', label: 'Pilot-Operated (파일럿형)', limitNote: '배압 ≤ 70% (Kb=1.0)' },
];

// Canonical pressG in unitSystem is kgcm2g; psvDesign & flareDesign use barG
const barGToCan = (barG: number): number => toCanonical('pressG', barG, 'barG');
const canToBarG = (canVal: number): number => fromCanonical('pressG', canVal, 'barG');

const INITIAL_PSV_INPUT: PSVDesignInput = {
  equipTag: 'PSV-101',
  equipName: 'Distillation Column Overhead Safety Valve',
  scenario: 'blocked_outlet',
  phase: 'vapor',
  valve_type: 'balanced_bellows',
  has_rupture_disk: false,
  W_kgh: 18500,
  P_set_barG: 16.0,
  superimposed_backpress_barG: 0.4,
  builtup_backpress_barG: 1.6,
  overpress_pct: 10.0,
  T_rel_C: 115.0,
  mw: 44.1,
  k_cpcv: 1.18,
  Z_comp: 0.90,
  rhoL: 580.0,
  mu_cP: 0.85,
  hv_kJkg: 355.0,
  A_wet_m2: 48.0,
  F_env: 1.0,
  vapor_mass_frac: 0.15,
  rhoL_kgm3: 580.0,
  cpL_kJkgK: 2.35,
  inlet_pipe_id_mm: 102.3,
  inlet_pipe_len_m: 1.8,
  inlet_k_fittings: 1.5,
  outlet_pipe_id_mm: 154.1,
};

interface ScenarioRowState {
  caseId: string;
  caseLabel: string;
  scenario: PSVScenario;
  phase: PSVPhase;
  W_kgh: number;
  overpress_pct: number;
  T_rel_C: number;
  A_wet_m2: number;
}

const INITIAL_SCENARIOS: ScenarioRowState[] = [
  {
    caseId: 'sc_1',
    caseLabel: '출구 차단 (Blocked Outlet)',
    scenario: 'blocked_outlet',
    phase: 'vapor',
    W_kgh: 18500,
    overpress_pct: 10,
    T_rel_C: 115,
    A_wet_m2: 48,
  },
  {
    caseId: 'sc_2',
    caseLabel: '외부 화재 (Pool Fire)',
    scenario: 'fire_case',
    phase: 'vapor',
    W_kgh: 10400,
    overpress_pct: 21,
    T_rel_C: 135,
    A_wet_m2: 48,
  },
  {
    caseId: 'sc_3',
    caseLabel: '냉각수 중단 (CW Failure)',
    scenario: 'cw_failure',
    phase: 'vapor',
    W_kgh: 24200,
    overpress_pct: 10,
    T_rel_C: 120,
    A_wet_m2: 48,
  },
  {
    caseId: 'sc_4',
    caseLabel: '열팽창 (Thermal Expansion)',
    scenario: 'thermal_exp',
    phase: 'liquid',
    W_kgh: 650,
    overpress_pct: 10,
    T_rel_C: 85,
    A_wet_m2: 48,
  },
];

// Shared Monochrome Engineering Styles
const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: '14px',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 13.5,
  fontWeight: 700,
  color: '#0F172A',
  borderBottom: '1px solid #F1F5F9',
  paddingBottom: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 3,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #CBD5E1',
  fontSize: 12,
  color: '#0F172A',
  background: '#FFFFFF',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const tableInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '3px 5px',
  borderRadius: 3,
  border: '1px solid #CBD5E1',
  fontSize: 11.5,
  color: '#0F172A',
  background: '#FFFFFF',
  boxSizing: 'border-box',
};

function StatusBadge({ level, text }: { level: 'ok' | 'warn' | 'fail'; text: string }) {
  const styles: Record<'ok' | 'warn' | 'fail', React.CSSProperties> = {
    ok: { background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0' },
    warn: { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' },
    fail: { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' },
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        ...styles[level],
      }}
    >
      {text}
    </span>
  );
}

export default function PsvFlareDesignPanel() {
  const [subTab, setSubTab] = useState<SubTabKey>('psv');

  // ── PSV Tab State ────────────────────────────────────────────────────────
  const [psvInput, setPsvInput] = useState<PSVDesignInput>(INITIAL_PSV_INPUT);
  const [scenarios, setScenarios] = useState<ScenarioRowState[]>(INITIAL_SCENARIOS);
  const [showFireHelper, setShowFireHelper] = useState<boolean>(false);
  const [showTubeHelper, setShowTubeHelper] = useState<boolean>(false);

  // Fire Helper State
  const [fireVesselDiaM, setFireVesselDiaM] = useState<number>(2.4);
  const [fireVesselTanM, setFireVesselTanM] = useState<number>(8.0);
  const [fireOrientation, setFireOrientation] = useState<'horizontal' | 'vertical' | 'sphere'>('horizontal');
  const [fireLiqFrac, setFireLiqFrac] = useState<number>(0.55);
  const [fireElevM, setFireElevM] = useState<number>(1.5);
  const [fireInsulMm, setFireInsulMm] = useState<number>(0);

  // Tube Rupture Helper State
  const [trHighBarG, setTrHighBarG] = useState<number>(42.0);
  const [trLowDesignBarG, setTrLowDesignBarG] = useState<number>(18.0);
  const [trTubeIdMm, setTrTubeIdMm] = useState<number>(15.75);
  const [trPhase, setTrPhase] = useState<'liquid' | 'vapor'>('liquid');
  const [trRho, setTrRho] = useState<number>(820);

  // Local display units
  const [pressUnit, setPressUnit] = useLocalUnit('pressG', 'barG');
  const [flowUnit, setFlowUnit] = useLocalUnit('massFlow', 'kgh');
  const [tempUnit, setTempUnit] = useLocalUnit('temp', 'C');

  // ── Flare Network & Radiation State ─────────────────────────────────────
  const [selectedFlarePreset, setSelectedFlarePreset] = useState<string>('total_power_failure');
  const [flareInput, setFlareInput] = useState<FlareNetworkInput>(
    () => structuredClone(FLARE_PLANT_PRESETS.total_power_failure.input)
  );
  const [customEmissivity, setCustomEmissivity] = useState<string>('');
  const [customLhv, setCustomLhv] = useState<string>('');

  // ── Live Calculations ───────────────────────────────────────────────────
  const psvResult: PSVDesignResult = useMemo(() => solvePSV(psvInput, 'rigorous'), [psvInput]);

  const fireHelperRes = useMemo(
    () =>
      calcFireWettedAreaM2({
        vesselDiaM: fireVesselDiaM,
        vesselTanToTanM: fireVesselTanM,
        orientation: fireOrientation,
        liquidLevelFrac: fireLiqFrac,
        elevationAboveGradeM: fireElevM,
        insulationThicknessMm: fireInsulMm,
      }),
    [fireVesselDiaM, fireVesselTanM, fireOrientation, fireLiqFrac, fireElevM, fireInsulMm]
  );

  const tubeHelperRes = useMemo(
    () =>
      calcTubeRuptureRelief({
        P_high_barG: trHighBarG,
        P_low_design_barG: trLowDesignBarG,
        tubeIdMm: trTubeIdMm,
        phase: trPhase,
        rho_kgm3: trRho,
        mw: psvInput.mw,
        T_C: psvInput.T_rel_C,
        k_cpcv: psvInput.k_cpcv,
        Z_comp: psvInput.Z_comp,
      }),
    [trHighBarG, trLowDesignBarG, trTubeIdMm, trPhase, trRho, psvInput.mw, psvInput.T_rel_C, psvInput.k_cpcv, psvInput.Z_comp]
  );

  const governingRes = useMemo(() => {
    const cases: PSVScenarioCaseInput[] = scenarios.map(sc => ({
      ...psvInput,
      caseId: sc.caseId,
      caseLabel: sc.caseLabel,
      scenario: sc.scenario,
      phase: sc.phase,
      W_kgh: sc.W_kgh,
      overpress_pct: sc.overpress_pct,
      T_rel_C: sc.T_rel_C,
      A_wet_m2: sc.A_wet_m2,
    }));
    return solvePSVGoverningScenarios(cases, 'rigorous');
  }, [scenarios, psvInput]);

  const effectiveFlareInput: FlareNetworkInput = useMemo(() => {
    const parsedF = customEmissivity.trim() === '' ? undefined : Number(customEmissivity);
    const parsedLhv = customLhv.trim() === '' ? undefined : Number(customLhv);
    return {
      ...flareInput,
      emissivityF: parsedF !== undefined && Number.isFinite(parsedF) && parsedF > 0 ? parsedF : undefined,
      lhvKJkg: parsedLhv !== undefined && Number.isFinite(parsedLhv) && parsedLhv > 0 ? parsedLhv : undefined,
    };
  }, [flareInput, customEmissivity, customLhv]);

  const flareResult: FlareNetworkResult = useMemo(
    () => solveFlareNetwork(effectiveFlareInput),
    [effectiveFlareInput]
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const updatePsv = <K extends keyof PSVDesignInput>(key: K, val: PSVDesignInput[K]) => {
    setPsvInput(prev => ({ ...prev, [key]: val }));
  };

  const handleApplyFireHelper = () => {
    const fEnv = estimateFireEnvFactor(fireInsulMm);
    setPsvInput(prev => ({
      ...prev,
      scenario: 'fire_case',
      overpress_pct: 21.0,
      A_wet_m2: fireHelperRes.wettedAreaM2,
      F_env: fEnv,
    }));
  };

  const handleApplyTubeHelper = () => {
    setPsvInput(prev => ({
      ...prev,
      scenario: 'tube_rupture',
      phase: trPhase,
      overpress_pct: 10.0,
      W_kgh: Math.max(10, Math.round(tubeHelperRes.reliefRate_kgh)),
      ...(trPhase === 'liquid' ? { rhoL: trRho } : {}),
    }));
  };

  const handleAddScenario = () => {
    const idx = scenarios.length + 1;
    setScenarios(prev => [
      ...prev,
      {
        caseId: `sc_${Date.now()}`,
        caseLabel: `시나리오 #${idx}`,
        scenario: 'power_failure',
        phase: 'vapor',
        W_kgh: 15000,
        overpress_pct: 10,
        T_rel_C: psvInput.T_rel_C ?? 115,
        A_wet_m2: psvInput.A_wet_m2 ?? 48,
      },
    ]);
  };

  const handleRemoveScenario = (caseId: string) => {
    setScenarios(prev => (prev.length > 1 ? prev.filter(s => s.caseId !== caseId) : prev));
  };

  const handleUpdateScenario = <K extends keyof ScenarioRowState>(
    caseId: string,
    key: K,
    val: ScenarioRowState[K]
  ) => {
    setScenarios(prev =>
      prev.map(s => {
        if (s.caseId !== caseId) return s;
        if (key === 'scenario') {
          const opt = SCENARIO_OPTIONS.find(o => o.value === val);
          return { ...s, scenario: val as PSVScenario, overpress_pct: opt?.defaultOp ?? s.overpress_pct };
        }
        return { ...s, [key]: val };
      })
    );
  };

  const handleSelectFlarePreset = (presetId: string) => {
    const preset = FLARE_PLANT_PRESETS[presetId];
    if (!preset) return;
    setSelectedFlarePreset(presetId);
    setFlareInput(structuredClone(preset.input));
    setCustomEmissivity('');
    setCustomLhv('');
  };

  const handleAddBranch = () => {
    const nextNum = flareInput.branches.length + 1;
    const newBranch: FlareSourceBranch = {
      id: `br_${Date.now()}`,
      tag: `PSV-${500 + nextNum}`,
      scenario: 'Contingency Relief',
      massFlowKgH: 12000,
      mw: 36.0,
      tempC: 95,
      k: 1.2,
      z: 0.92,
      psvSetBarG: 12.0,
      valveType: 'balanced_bellows',
      branchPipeIdMm: 154.1,
      branchLenM: 35,
      branchKFittings: 4.5,
    };
    setFlareInput(prev => ({ ...prev, branches: [...prev.branches, newBranch] }));
  };

  const handleRemoveBranch = (id: string) => {
    setFlareInput(prev => ({
      ...prev,
      branches: prev.branches.length > 1 ? prev.branches.filter(b => b.id !== id) : prev.branches,
    }));
  };

  const handleUpdateBranch = <K extends keyof FlareSourceBranch>(
    id: string,
    key: K,
    val: FlareSourceBranch[K]
  ) => {
    setFlareInput(prev => ({
      ...prev,
      branches: prev.branches.map(b => (b.id === id ? { ...b, [key]: val } : b)),
    }));
  };

  // ── Excel Exporters ─────────────────────────────────────────────────────
  const exportPsvExcel = () => {
    const wb = XLSX.utils.book_new();
    const pc = psvResult.pipingCheck;

    const sheet1Data: (string | number)[][] = [
      ['API 520 / 521 / 526 PRESSURE SAFETY VALVE (PSV) ENGINEERING DATASHEET'],
      ['Generated Date', new Date().toISOString().slice(0, 19).replace('T', ' '), 'Standard', 'API 520 Part I & II / API 521 / API 526'],
      [],
      ['1. EQUIPMENT & VALVE SPECIFICATION', '', '', ''],
      ['Tag Number', psvResult.equipTag, 'Service Name', psvResult.equipName],
      ['Relief Scenario', psvResult.scenario, 'Fluid Phase', psvResult.phase],
      ['Valve Type', psvResult.valve_type, 'Rupture Disk Combination', psvInput.has_rupture_disk ? 'Yes (Kc = 0.90)' : 'No (Kc = 1.00)'],
      [],
      ['2. PROCESS & RELIEF CONDITIONS', '', '', ''],
      ['Required Relief Rate W (kg/h)', psvResult.W_kgh, 'Rated Capacity W_rated (kg/h)', psvResult.W_rated_kgh],
      ['Set Pressure P_set (barG)', psvResult.P_set_barG, 'Allowable Overpressure (%)', psvResult.overpress_pct],
      ['Relieving Pressure P1 (barA)', psvResult.P1_barA, 'Total Backpressure P2 (barA)', psvResult.P2_barA],
      ['Superimposed Backpressure (barG)', psvResult.superimposed_backpress_barG, 'Built-up Backpressure (barG)', psvResult.builtup_backpress_barG],
      ['Total Backpressure (barG)', psvResult.P_back_barG, 'Backpressure Ratio (P2/P1)', psvResult.backPressRatio],
      ['Relieving Temperature (°C)', psvInput.T_rel_C ?? 115, 'Critical Pressure Ratio r_c', psvResult.r_crit],
      ['Molecular Weight MW (g/mol)', psvInput.mw ?? 44.1, 'Flow Regime', psvResult.isCritical ? 'Critical (Choked Sonic)' : 'Subcritical'],
      ['Cp/Cv (k)', psvInput.k_cpcv ?? 1.2, 'Compressibility Z', psvInput.Z_comp ?? 0.9],
      ...(psvResult.Q_fire_kW > 0 ? [['Fire Heat Absorption Q_fire (kW)', psvResult.Q_fire_kW, 'Insulation Factor F_env', psvResult.F_env]] : []),
      [],
      ['3. API 520 PART I CORRECTION FACTORS & ORIFICE SELECTION', '', '', ''],
      ['Kd (Discharge Coeff)', psvResult.Kd, 'Kb (Vapor Backpressure)', psvResult.Kb],
      ['Kw (Liquid Backpressure)', psvResult.Kw, 'Kc (Combination RD)', psvResult.Kc],
      ['Kp (Liquid Overpressure)', psvResult.Kp, 'Kv (Liquid Viscosity)', psvResult.Kv],
      ['Kn (Steam Napier)', psvResult.Kn, 'Ksh (Steam Superheat)', psvResult.Ksh],
      ['Required Orifice Area (mm²)', psvResult.A_req_mm2, 'Required Orifice Area (in²)', psvResult.A_req_in2],
      ['Selected API 526 Orifice', `${psvResult.selectedOrifice.letter} (${psvResult.selectedOrifice.size})`, 'Effective Area (mm²)', psvResult.selectedOrifice.area_mm2],
      ['Parallel Valve Count', psvResult.parallelCount, 'Orifice Utilization (%)', psvResult.cap_utilization_pct],
      ...(psvResult.phase === 'twophase'
        ? [
            ['Leung Omega Parameter (ω)', psvResult.omega ?? 0, 'Critical Ratio (η_c)', psvResult.eta_crit ?? 0],
            ['Two-Phase Mass Flux G (kg/m²·s)', psvResult.massFlux_kgm2s ?? 0, 'Flashing Regime', psvResult.isSubcooledFlashing ? 'Subcooled Flashing' : 'Saturated Two-Phase'],
          ]
        : []),
      [],
      ['4. API 520 PART II PIPING & INSTALLATION CHECK', '', '', ''],
      ['Inlet Pipe ID (mm)', pc.inlet_pipe_id_mm, 'Inlet Pipe Length (m)', pc.inlet_pipe_len_m],
      ['Inlet Velocity (m/s)', pc.inlet_vel_ms, 'Inlet ΔP (bar)', pc.inlet_dp_bar],
      ['Inlet ΔP (% of P_set)', pc.inlet_dp_pct_pset, '3% Inlet Rule Status', pc.inlet_3pct_pass ? 'PASS (<= 3.0%)' : 'FAIL (> 3.0%)'],
      ['Outlet Pipe ID (mm)', pc.outlet_pipe_id_mm, 'Outlet Exit Mach', pc.outlet_mach],
      ['Discharge Reaction Force (N)', pc.reaction_force_N, 'Discharge Reaction Force (kgf)', pc.reaction_force_kgf],
      ['Acoustic Noise @ 30 m (dBA)', pc.noise_dBA_30m, 'Geometry Source', pc.is_inferred_geometry ? 'Flange Inferred' : 'User Specified'],
      ...ENGINEERING_DISCLAIMER_ROWS,
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    ws1['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 30 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'API 520 PSV Datasheet');

    const sheet2Data: (string | number)[][] = [
      ['API 521 MULTI-SCENARIO GOVERNING CASE MATRIX'],
      ['Tag', psvResult.equipTag, 'Governing Case', governingRes.governing.caseLabel, 'Selected Orifice', `${governingRes.selectedOrifice.letter} (${governingRes.selectedOrifice.size})`],
      [],
      ['Case Label', 'Scenario', 'Phase', 'W (kg/h)', 'P_set (barG)', 'Overpress (%)', 'A_req (mm²)', 'API 526 Orifice', 'Utilization (%)', 'Governing'],
      ...governingRes.cases.map(c => [
        c.caseLabel,
        c.scenario,
        c.phase,
        c.W_kgh,
        c.P_set_barG,
        c.overpress_pct,
        c.A_req_mm2,
        `${c.selectedOrifice.letter} (${c.selectedOrifice.size})`,
        c.cap_utilization_pct,
        c.isGoverning ? 'GOVERNING' : '',
      ]),
    ];

    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
    ws2['!cols'] = [
      { wch: 26 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 13 },
      { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Multi-Scenario Matrix');

    const safeTag = (psvResult.equipTag || 'PSV-101').replace(/[^A-Za-z0-9_-]/g, '_');
    XLSX.writeFile(wb, `${safeTag}_API520_Datasheet.xlsx`);
  };

  const exportFlareExcel = () => {
    const wb = XLSX.utils.book_new();
    const { tip, header, koDrum, radiation } = flareResult;

    const s1: (string | number)[][] = [
      ['API 521 FLARE HEADER NETWORK, KO DRUM & THERMAL RADIATION REPORT'],
      ['Contingency Case', flareResult.caseName, 'Generated Date', new Date().toISOString().slice(0, 19).replace('T', ' ')],
      [],
      ['1. COINCIDENT RELIEF MIXTURE', '', '', ''],
      ['Total Coincident Mass Flow (kg/h)', flareResult.totalMassFlowKgH, 'Mixture Molecular Weight (g/mol)', flareResult.mixMw],
      ['Mixture Temperature (°C)', flareResult.mixTempC, 'Mixture Cp/Cv (k) / Z', `${flareResult.mixK} / ${flareResult.mixZ}`],
      [],
      ['2. MAIN FLARE HEADER HYDRAULICS', '', '', ''],
      ['Header Pipe ID (mm)', header.headerPipeIdMm, 'Header Length (m)', header.headerLenM],
      ['Header Inlet Pressure (barG)', header.headerInletPressBarG, 'Header Pressure Drop (bar)', header.headerDpBar],
      ['Header Exit Velocity (m/s)', header.headerExitVelMs, 'Header Exit Mach (<= 0.70)', `${header.headerExitMach} (${header.headerMachPass ? 'PASS' : 'FAIL'})`],
      ['All PSV Branches Compliant', flareResult.allBranchesCompliant ? 'PASS' : 'FAIL', 'Tip Backpressure (barG)', header.tipBackpressBarG],
      [],
      ['3. FLARE TIP & PURGE GAS', '', '', ''],
      ['Required Tip Diameter (mm)', tip.reqTipDiaMm, 'Selected Tip NPS / ID (mm)', `${tip.selectedTipNps} (${tip.selectedTipDiaMm} mm)`],
      ['Tip Exit Velocity (m/s)', tip.exitVelMs, 'Sonic Velocity (m/s)', tip.sonicVelMs],
      ['Tip Exit Mach', tip.tipMach, 'Mach Status', tip.machStatus.toUpperCase()],
      ['Purge Gas (No Seal, Nm³/h)', tip.purgeGasNm3H, 'Purge Gas (With Seal, Nm³/h)', tip.purgeGasWithSealNm3H],
      [],
      ['4. HORIZONTAL FLARE KO DRUM (API 521)', '', '', ''],
      ['KO Drum Diameter ID (m)', koDrum.koDrumDiaM, 'KO Drum T/T Length (m)', koDrum.koDrumLenM],
      ['L/D Ratio', koDrum.ldRatio, 'Target Droplet Size (µm)', koDrum.dropletDiaUm],
      ['Droplet Settling Velocity (m/s)', koDrum.settlingVelMs, 'Vapor Horizontal Velocity (m/s)', koDrum.vaporVelMs],
      ['Liquid Holdup Volume (m³)', koDrum.liquidHoldupM3, 'Holdup Time (min)', koDrum.holdupMin],
      [],
      ['5. API 521 THERMAL RADIATION & SAFE DISTANCES', '', '', ''],
      ['Heat Release (MW)', radiation.heatReleaseMW, 'LHV (kJ/kg) / Emissivity F', `${radiation.lhvKJkg} / ${radiation.emissivityF}`],
      ['Stack Height (m)', effectiveFlareInput.stackHeightM, 'Wind Speed (m/s)', effectiveFlareInput.windSpeedMs ?? 9.0],
      ['Flame Length (m)', radiation.flameLengthM, 'Flame Tilt (deg)', radiation.flameTiltDeg],
      ['Peak Ground Radiation (kW/m²)', radiation.peakGroundRadKwM2, 'Peak Distance Downwind (m)', radiation.peakGroundDistM],
      ['Safe Dist @ 1.58 kW/m² (Boundary, m)', radiation.safeDist_1_58_m, 'Safe Dist @ 4.73 kW/m² (Emergency, m)', radiation.safeDist_4_73_m],
      ['Safe Dist @ 6.31 kW/m² (Short Exp, m)', radiation.safeDist_6_31_m, 'Safe Dist @ 9.46 kW/m² (Structure, m)', radiation.safeDist_9_46_m],
      ...ENGINEERING_DISCLAIMER_ROWS,
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 34 }, { wch: 24 }, { wch: 32 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Flare Summary');

    const s2: (string | number)[][] = [
      ['PSV DISCHARGE BRANCH HYDRAULICS & BACKPRESSURE COMPLIANCE'],
      [],
      ['PSV Tag', 'Scenario', 'Valve Type', 'Mass Flow (kg/h)', 'P_set (barG)', 'Branch ID (mm)', 'Length (m)', 'Branch ΔP (bar)', 'PSV Backpress (barG)', '% of P_set', 'Limit (%)', 'Branch Mach', 'Status', 'Note'],
      ...flareResult.branches.map(b => [
        b.tag,
        b.scenario,
        b.valveType,
        b.massFlowKgH,
        b.psvSetBarG,
        b.branchPipeIdMm,
        b.branchLenM,
        b.branchDpBar,
        b.psvBackpressBarG,
        b.backpressPctPset,
        b.allowableBackpressPct,
        b.branchMach,
        b.backpressStatus.toUpperCase(),
        b.statusNote,
      ]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [
      { wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 10 }, { wch: 13 }, { wch: 16 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'PSV Branch Hydraulics');

    const s3: (string | number)[][] = [
      ['API 521 DOWNWIND THERMAL RADIATION PROFILE'],
      [],
      ['Downwind Distance r (m)', 'Radiation Intensity I(r) (kW/m²)', 'Slant Distance D (m)', 'Atmospheric Transmissivity τ'],
      ...radiation.profile.map(pt => [pt.distanceM, pt.radiationKwM2, pt.slantDistanceM, pt.transmissivity]),
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(s3);
    ws3['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 22 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Radiation Profile');

    XLSX.writeFile(wb, `API521_Flare_Network_Radiation_Report.xlsx`);
  };

  // ── SVG Radiation Profile Chart Helper ──────────────────────────────────
  const renderRadiationChart = () => {
    const profile = flareResult.radiation.profile;
    const W = 720;
    const H = 290;
    const pad = { l: 56, r: 105, t: 20, b: 42 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;

    const maxR = 250;
    const maxI = Math.max(12, Math.ceil((flareResult.radiation.peakGroundRadKwM2 * 1.15) / 2) * 2);

    const xOf = (r: number) => pad.l + (Math.min(maxR, Math.max(0, r)) / maxR) * pw;
    const yOf = (rad: number) => pad.t + ph - (Math.min(maxI, Math.max(0, rad)) / maxI) * ph;

    const polylinePoints = profile.map(pt => `${xOf(pt.distanceM).toFixed(1)},${yOf(pt.radiationKwM2).toFixed(1)}`).join(' ');
    const areaPoints = `${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} ${polylinePoints} ${xOf(maxR).toFixed(1)},${yOf(0).toFixed(1)}`;

    const thresholds = [
      { val: 9.46, label: '9.46 kW/m² (구조물)', dash: '5 3' },
      { val: 6.31, label: '6.31 kW/m² (단기노출)', dash: '4 3' },
      { val: 4.73, label: '4.73 kW/m² (비상작업)', dash: '6 3' },
      { val: 1.58, label: '1.58 kW/m² (부지경계)', dash: '2 3' },
    ];

    const xTicks = [0, 50, 100, 150, 200, 250];
    const yStep = maxI <= 16 ? 2 : maxI <= 30 ? 5 : 10;
    const yTicks: number[] = [];
    for (let y = 0; y <= maxI; y += yStep) yTicks.push(y);

    const peakX = xOf(flareResult.radiation.peakGroundDistM);
    const peakY = yOf(flareResult.radiation.peakGroundRadKwM2);

    return (
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', minWidth: 520, maxHeight: 310, display: 'block', background: '#FFFFFF' }}
          role="img"
          aria-label="API 521 Flare Thermal Radiation Profile"
        >
          {/* Grid lines */}
          {yTicks.map(yt => (
            <g key={`yg-${yt}`}>
              <line x1={pad.l} y1={yOf(yt)} x2={W - pad.r} y2={yOf(yt)} stroke="#F1F5F9" strokeWidth={1} />
              <text x={pad.l - 8} y={yOf(yt) + 3.5} textAnchor="end" fontSize={10} fill="#64748B" fontFamily="JetBrains Mono, monospace">
                {yt}
              </text>
            </g>
          ))}
          {xTicks.map(xt => (
            <g key={`xg-${xt}`}>
              <line x1={xOf(xt)} y1={pad.t} x2={xOf(xt)} y2={H - pad.b} stroke="#F1F5F9" strokeWidth={1} />
              <text x={xOf(xt)} y={H - pad.b + 16} textAnchor="middle" fontSize={10} fill="#64748B" fontFamily="JetBrains Mono, monospace">
                {xt} m
              </text>
            </g>
          ))}

          {/* Axes */}
          <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#94A3B8" strokeWidth={1.2} />
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#94A3B8" strokeWidth={1.2} />

          {/* Area fill */}
          <polygon points={areaPoints} fill="#E2E8F0" fillOpacity={0.45} />

          {/* Threshold reference lines */}
          {thresholds
            .filter(th => th.val <= maxI)
            .map(th => {
              const ty = yOf(th.val);
              return (
                <g key={th.val}>
                  <line
                    x1={pad.l}
                    y1={ty}
                    x2={W - pad.r}
                    y2={ty}
                    stroke={th.val === 4.73 ? '#334155' : '#64748B'}
                    strokeWidth={th.val === 4.73 ? 1.3 : 1}
                    strokeDasharray={th.dash}
                  />
                  <text
                    x={W - pad.r + 6}
                    y={ty + 3.5}
                    fontSize={9.5}
                    fontWeight={th.val === 4.73 ? 700 : 600}
                    fill={th.val === 4.73 ? '#0F172A' : '#475569'}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {th.label}
                  </text>
                </g>
              );
            })}

          {/* Radiation Intensity Curve */}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#0F172A"
            strokeWidth={2.2}
            strokeLinejoin="round"
          />

          {/* Peak Ground Radiation Marker */}
          <line x1={peakX} y1={peakY} x2={peakX} y2={H - pad.b} stroke="#94A3B8" strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={peakX} cy={peakY} r={4} fill="#0F172A" stroke="#FFFFFF" strokeWidth={1.5} />
          <text
            x={Math.min(W - pad.r - 85, peakX + 7)}
            y={Math.max(pad.t + 12, peakY - 6)}
            fontSize={10}
            fontWeight={700}
            fill="#0F172A"
            fontFamily="JetBrains Mono, monospace"
          >
            Peak {flareResult.radiation.peakGroundRadKwM2.toFixed(2)} kW/m² @ {flareResult.radiation.peakGroundDistM.toFixed(0)}m
          </text>

          {/* Axis Labels */}
          <text x={pad.l + pw / 2} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#334155">
            풍하 거리 Downwind Distance r (m)
          </text>
          <text
            x={14}
            y={pad.t + ph / 2}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="#334155"
            transform={`rotate(-90 14 ${pad.t + ph / 2})`}
          >
            복사열 강도 I(r) (kW/m²)
          </text>
        </svg>
      </div>
    );
  };

  return (
    <div
      style={{
        width: '100%',
        padding: '16px',
        background: '#F8FAFC',
        color: '#1E293B',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 19, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 7 }}>
            <SpecControlIcon size={18} style={{ color: '#0F172A' }} />
            안전밸브(PSV) · 플레어 네트워크 &amp; 복사열 안전설계 워크벤치
          </h2>
          <p style={{ margin: 0, fontSize: 12.5, color: '#64748B' }}>
            API 520 Part I/II · API 521 Multi-Scenario &amp; Thermal Radiation · API 526 Standard Orifices (D–T) · Leung Omega 2-Phase Flashing
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={exportPsvExcel}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #0F172A',
              background: '#FFFFFF',
              color: '#0F172A',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            PSV API 520 Datasheet (.xlsx)
          </button>
          <button
            type="button"
            onClick={exportFlareExcel}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #0F172A',
              background: '#0F172A',
              color: '#FFFFFF',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Flare API 521 Report (.xlsx)
          </button>
        </div>
      </div>

      {/* 3 Sub-tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 14,
          borderBottom: '1px solid #CBD5E1',
          paddingBottom: 8,
          overflowX: 'auto',
        }}
      >
        {[
          { key: 'psv' as SubTabKey, label: '1. PSV 정밀 사이징 & 다중 시나리오 (API 520/521/526)', icon: <SpecControlIcon size={13} /> },
          { key: 'flare_net' as SubTabKey, label: '2. 플레어 헤더 네트워크 & KO 드럼 (API 521)', icon: <StreamFlowIcon size={13} /> },
          { key: 'flare_rad' as SubTabKey, label: '3. 플레어 팁 & 복사열 안전거리 (API 521)', icon: <VesselEquipIcon size={13} /> },
        ].map(t => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 6,
                border: active ? '1.5px solid #0F172A' : '1px solid #CBD5E1',
                background: active ? '#0F172A' : '#FFFFFF',
                color: active ? '#FFFFFF' : '#334155',
                fontSize: 12,
                fontWeight: active ? 800 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ===================================================================
          SUB-TAB 1: PSV SIZING & MULTI-SCENARIO (API 520/521/526)
         =================================================================== */}
      {subTab === 'psv' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
            {/* Left: Single PSV Inputs */}
            <div style={cardStyle}>
              <h3 style={sectionTitleStyle}>
                <span>단일 PSV 정밀 설계 입력 (API 520 Part I &amp; II)</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button
                    type="button"
                    onClick={() => setShowFireHelper(v => !v)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid #CBD5E1',
                      background: showFireHelper ? '#0F172A' : '#F8FAFC',
                      color: showFireHelper ? '#FFFFFF' : '#334155',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    화재 접액면적 도우미
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTubeHelper(v => !v)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid #CBD5E1',
                      background: showTubeHelper ? '#0F172A' : '#F8FAFC',
                      color: showTubeHelper ? '#FFFFFF' : '#334155',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    튜브파열 10/13 도우미
                  </button>
                </div>
              </h3>

              {/* Core Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                <div>
                  <label style={labelStyle}>장치 태그 (PSV Tag)</label>
                  <input
                    type="text"
                    value={psvInput.equipTag ?? ''}
                    onChange={e => updatePsv('equipTag', e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>방출 상상태 (Phase)</label>
                  <select
                    value={psvInput.phase ?? 'vapor'}
                    onChange={e => updatePsv('phase', e.target.value as PSVPhase)}
                    style={inputStyle}
                  >
                    {PHASE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>비상 시나리오 (API 521)</label>
                  <select
                    value={psvInput.scenario ?? 'blocked_outlet'}
                    onChange={e => {
                      const sc = e.target.value as PSVScenario;
                      const opt = SCENARIO_OPTIONS.find(o => o.value === sc);
                      setPsvInput(prev => ({
                        ...prev,
                        scenario: sc,
                        overpress_pct: opt?.defaultOp ?? prev.overpress_pct,
                      }));
                    }}
                    style={inputStyle}
                  >
                    {SCENARIO_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>밸브 형식 (Valve Type)</label>
                  <select
                    value={psvInput.valve_type ?? 'balanced_bellows'}
                    onChange={e => updatePsv('valve_type', e.target.value as PSVValveType)}
                    style={inputStyle}
                  >
                    {VALVE_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>설정 압력 (P_set)</label>
                  <UnitNumberInput
                    quantity="pressG"
                    value={barGToCan(psvInput.P_set_barG ?? 16.0)}
                    unitId={pressUnit}
                    onUnitChange={setPressUnit}
                    minCanonical={barGToCan(0.2)}
                    onValueChange={v => updatePsv('P_set_barG', Math.max(0.2, Number(canToBarG(v).toFixed(4))))}
                    inputStyle={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>허용 과압 (Overpressure, %)</label>
                  <input
                    type="number"
                    step="1"
                    min="5"
                    max="25"
                    value={psvInput.overpress_pct ?? 10}
                    onChange={e => updatePsv('overpress_pct', Number(e.target.value))}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>중첩 배압 (Superimposed BP)</label>
                  <UnitNumberInput
                    quantity="pressG"
                    value={barGToCan(psvInput.superimposed_backpress_barG ?? 0)}
                    unitId={pressUnit}
                    onUnitChange={setPressUnit}
                    minCanonical={barGToCan(0)}
                    onValueChange={v => updatePsv('superimposed_backpress_barG', Math.max(0, Number(canToBarG(v).toFixed(4))))}
                    inputStyle={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>축적 배압 (Built-up BP)</label>
                  <UnitNumberInput
                    quantity="pressG"
                    value={barGToCan(psvInput.builtup_backpress_barG ?? 0)}
                    unitId={pressUnit}
                    onUnitChange={setPressUnit}
                    minCanonical={barGToCan(0)}
                    onValueChange={v => updatePsv('builtup_backpress_barG', Math.max(0, Number(canToBarG(v).toFixed(4))))}
                    inputStyle={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>
                    요구 방출량 (W) {psvInput.scenario === 'fire_case' ? '[화재 자동산출]' : ''}
                  </label>
                  <UnitNumberInput
                    quantity="massFlow"
                    value={psvInput.scenario === 'fire_case' ? psvResult.W_kgh : (psvInput.W_kgh ?? 18500)}
                    unitId={flowUnit}
                    onUnitChange={setFlowUnit}
                    minCanonical={5}
                    disabled={psvInput.scenario === 'fire_case'}
                    onValueChange={v => updatePsv('W_kgh', Math.max(5, Number(v.toFixed(2))))}
                    inputStyle={{
                      ...inputStyle,
                      background: psvInput.scenario === 'fire_case' ? '#F1F5F9' : '#FFFFFF',
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>방출 온도 (T_rel)</label>
                  <UnitNumberInput
                    quantity="temp"
                    value={psvInput.T_rel_C ?? 115}
                    unitId={tempUnit}
                    onUnitChange={setTempUnit}
                    onValueChange={v => updatePsv('T_rel_C', Number(v.toFixed(2)))}
                    inputStyle={inputStyle}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={labelStyle}>분자량 MW (g/mol)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="2"
                      value={psvInput.mw ?? 44.1}
                      onChange={e => updatePsv('mw', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>비열비 k (Cp/Cv)</label>
                    <input
                      type="number"
                      step="0.02"
                      min="1.05"
                      max="1.67"
                      value={psvInput.k_cpcv ?? 1.18}
                      onChange={e => updatePsv('k_cpcv', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>압축인자 Z</label>
                    <input
                      type="number"
                      step="0.02"
                      min="0.3"
                      max="1.2"
                      value={psvInput.Z_comp ?? 0.9}
                      onChange={e => updatePsv('Z_comp', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Rupture Disk Checkbox */}
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#F8FAFC', borderRadius: 4, border: '1px solid #E2E8F0' }}>
                  <input
                    id="psv_rd_chk"
                    type="checkbox"
                    checked={Boolean(psvInput.has_rupture_disk)}
                    onChange={e => updatePsv('has_rupture_disk', e.target.checked)}
                  />
                  <label htmlFor="psv_rd_chk" style={{ fontSize: 11.5, fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    파열판 직렬 조합 설치 (Rupture Disk Combination · API 520 Kc = 0.90)
                  </label>
                </div>

                {/* Conditional: Fire Case */}
                {psvInput.scenario === 'fire_case' && (
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '8px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div>
                      <label style={labelStyle}>접액면적 A_wet (m²)</label>
                      <input type="number" step="1" min="1" value={psvInput.A_wet_m2 ?? 48} onChange={e => updatePsv('A_wet_m2', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>단열계수 F_env</label>
                      <input type="number" step="0.05" min="0.05" max="1" value={psvInput.F_env ?? 1.0} onChange={e => updatePsv('F_env', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>기화잠열 ΔH_v (kJ/kg)</label>
                      <input type="number" step="5" min="50" value={psvInput.hv_kJkg ?? 355} onChange={e => updatePsv('hv_kJkg', Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                )}

                {/* Conditional: Liquid */}
                {psvInput.phase === 'liquid' && (
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '8px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div>
                      <label style={labelStyle}>액체 밀도 ρ_L (kg/m³)</label>
                      <input type="number" step="10" min="200" value={psvInput.rhoL ?? 800} onChange={e => updatePsv('rhoL', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>액체 점도 μ (cP · Kv 반복보정)</label>
                      <input type="number" step="0.5" min="0.05" value={psvInput.mu_cP ?? 1.0} onChange={e => updatePsv('mu_cP', Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                )}

                {/* Conditional: Two-Phase Leung Omega */}
                {psvInput.phase === 'twophase' && (
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '8px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div>
                      <label style={labelStyle}>입구 기상분율 x₀ (0–1)</label>
                      <input type="number" step="0.02" min="0" max="1" value={psvInput.vapor_mass_frac ?? 0.15} onChange={e => updatePsv('vapor_mass_frac', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>액체 밀도 ρ_L (kg/m³)</label>
                      <input type="number" step="10" min="200" value={psvInput.rhoL_kgm3 ?? psvInput.rhoL ?? 580} onChange={e => updatePsv('rhoL_kgm3', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>기체 밀도 ρ_V (kg/m³, 자동=공란)</label>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="EOS 자동추정"
                        value={psvInput.rhoV_kgm3 ?? ''}
                        onChange={e => updatePsv('rhoV_kgm3', e.target.value === '' ? undefined : Number(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>액체 비열 Cp_L (kJ/kg·K)</label>
                      <input type="number" step="0.1" min="0.5" value={psvInput.cpL_kJkgK ?? 2.35} onChange={e => updatePsv('cpL_kJkgK', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>기화잠열 ΔH_v (kJ/kg)</label>
                      <input type="number" step="5" min="50" value={psvInput.hv_kJkg ?? 355} onChange={e => updatePsv('hv_kJkg', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>포화압력 Ps (barA, 과냉=입력)</label>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="포화(P1)"
                        value={psvInput.sat_press_barA ?? ''}
                        onChange={e => updatePsv('sat_press_barA', e.target.value === '' ? undefined : Number(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                )}

                {/* API 520 Part II Piping Geometry */}
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #E2E8F0', paddingTop: 8, marginTop: 2 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    API 520 Part II 입·출구 배관 기하구조 (3% 규칙 · 반력 · 소음)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
                    <div>
                      <label style={labelStyle}>입구 내경 (mm)</label>
                      <input type="number" step="1" min="15" value={psvInput.inlet_pipe_id_mm ?? 102.3} onChange={e => updatePsv('inlet_pipe_id_mm', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>입구 길이 (m)</label>
                      <input type="number" step="0.2" min="0.2" value={psvInput.inlet_pipe_len_m ?? 1.8} onChange={e => updatePsv('inlet_pipe_len_m', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>입구 K-계수</label>
                      <input type="number" step="0.1" min="0.5" value={psvInput.inlet_k_fittings ?? 1.5} onChange={e => updatePsv('inlet_k_fittings', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>출구 내경 (mm)</label>
                      <input type="number" step="1" min="20" value={psvInput.outlet_pipe_id_mm ?? 154.1} onChange={e => updatePsv('outlet_pipe_id_mm', Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Fire Wetted Area Helper Drawer */}
              {showFireHelper && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: '#F8FAFC', border: '1px solid #94A3B8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                      API 521 Sec. 4.4.13 Pool Fire 접액면적 계산기 (7.6 m 고도 컷오프 적용)
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyFireHelper}
                      style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#0F172A', color: '#FFFFFF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      A_wet &amp; F_env 자동반영
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                    <div>
                      <label style={labelStyle}>용기 형식</label>
                      <select value={fireOrientation} onChange={e => setFireOrientation(e.target.value as 'horizontal' | 'vertical' | 'sphere')} style={inputStyle}>
                        <option value="horizontal">수평 드럼 (Horizontal)</option>
                        <option value="vertical">수직 탑/드럼 (Vertical)</option>
                        <option value="sphere">구형 탱크 (Sphere)</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>용기 직경 D (m)</label>
                      <input type="number" step="0.1" min="0.3" value={fireVesselDiaM} onChange={e => setFireVesselDiaM(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>T/T 길이 L (m)</label>
                      <input type="number" step="0.5" min="0.5" value={fireVesselTanM} onChange={e => setFireVesselTanM(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>액위 분율 (0–1)</label>
                      <input type="number" step="0.05" min="0.05" max="1" value={fireLiqFrac} onChange={e => setFireLiqFrac(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>지면 고도 (m)</label>
                      <input type="number" step="0.5" min="0" value={fireElevM} onChange={e => setFireElevM(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>단열 두께 (mm)</label>
                      <input type="number" step="25" min="0" max="150" value={fireInsulMm} onChange={e => setFireInsulMm(Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#334155', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <span>유효 접액면적: <strong>{fireHelperRes.wettedAreaM2.toFixed(2)} m²</strong> (전체 {fireHelperRes.totalLiquidWettedAreaM2.toFixed(2)} m²)</span>
                    <span>단열계수 F_env: <strong>{fireHelperRes.F_env}</strong></span>
                    <span>화재 입열 Q_fire: <strong>{fireHelperRes.Q_fire_kW.toFixed(1)} kW</strong></span>
                    {fireHelperRes.elevationCutoffApplied && <StatusBadge level="warn" text="7.6 m 컷오프 적용" />}
                  </div>
                </div>
              )}

              {/* Tube Rupture 10/13 Helper Drawer */}
              {showTubeHelper && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: '#F8FAFC', border: '1px solid #94A3B8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                      API 521 Sec. 4.4.14 열교환기 튜브 파열 (10/13 규칙 &amp; 양단 파단)
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyTubeHelper}
                      style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#0F172A', color: '#FFFFFF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      방출량 W 적용
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7 }}>
                    <div>
                      <label style={labelStyle}>고압측 P_high (barG)</label>
                      <input type="number" step="1" value={trHighBarG} onChange={e => setTrHighBarG(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>저압측 설계압 (barG)</label>
                      <input type="number" step="1" value={trLowDesignBarG} onChange={e => setTrLowDesignBarG(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>튜브 내경 (mm)</label>
                      <input type="number" step="0.5" value={trTubeIdMm} onChange={e => setTrTubeIdMm(Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>고압 유체 상</label>
                      <select value={trPhase} onChange={e => setTrPhase(e.target.value as 'liquid' | 'vapor')} style={inputStyle}>
                        <option value="liquid">액체 (Liquid)</option>
                        <option value="vapor">기체 (Vapor)</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>밀도 ρ (kg/m³)</label>
                      <input type="number" step="10" value={trRho} onChange={e => setTrRho(Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#334155', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <StatusBadge level={tubeHelperRes.passes10_13Rule ? 'ok' : 'fail'} text={tubeHelperRes.passes10_13Rule ? '10/13 RULE PASS' : '10/13 RULE FAIL'} />
                    <span>양단 파단면적: <strong>{tubeHelperRes.doubleBreakArea_mm2.toFixed(1)} mm²</strong></span>
                    <span>예측 방출량: <strong>{tubeHelperRes.reliefRate_kgh.toLocaleString()} kg/h</strong></span>
                    <div style={{ width: '100%', fontSize: 11, color: '#475569' }}>{tubeHelperRes.recommendation}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Right: PSV Results & KPIs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Top KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ ...cardStyle, borderLeft: '4px solid #0F172A' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    선정 API 526 오리피스 ({psvResult.parallelCount}대 병렬)
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {psvResult.parallelCount > 1 ? `${psvResult.parallelCount} × ` : ''}&apos;{psvResult.selectedOrifice.letter}&apos; ({psvResult.selectedOrifice.size})
                  </div>
                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                    A_req <strong>{psvResult.A_req_mm2.toFixed(1)} mm²</strong> / A_eff <strong>{psvResult.selectedOrifice.area_mm2.toLocaleString()} mm²</strong> ({psvResult.cap_utilization_pct.toFixed(1)}%)
                  </div>
                </div>

                <div style={{ ...cardStyle, borderLeft: '4px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>방출 유동 &amp; 정격 용량</span>
                    <StatusBadge level={psvResult.isCritical ? 'ok' : 'warn'} text={psvResult.isCritical ? 'CRITICAL (SONIC)' : 'SUBCRITICAL'} />
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatCanonicalValue('massFlow', psvResult.W_kgh, flowUnit, 1)} {getUnitLabel('massFlow', flowUnit)}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                    P₁ <strong>{psvResult.P1_barA.toFixed(2)} barA</strong> · P₂/P₁ <strong>{psvResult.backPressRatio.toFixed(3)}</strong> (r_c={psvResult.r_crit.toFixed(3)})
                  </div>
                </div>
              </div>

              {/* Correction Factors Strip */}
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
                  API 520 Part I 보정계수 (Correction Factors)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                  {[
                    { k: 'Kd', v: psvResult.Kd.toFixed(3) },
                    { k: 'Kb', v: psvResult.Kb.toFixed(3) },
                    { k: 'Kw', v: psvResult.Kw.toFixed(3) },
                    { k: 'Kc', v: psvResult.Kc.toFixed(2) },
                    { k: 'Kp', v: psvResult.Kp.toFixed(3) },
                    { k: 'Kv', v: psvResult.Kv.toFixed(3) },
                    { k: 'Kn', v: psvResult.Kn.toFixed(3) },
                    { k: 'Ksh', v: psvResult.Ksh.toFixed(3) },
                  ].map(item => (
                    <div
                      key={item.k}
                      style={{
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: 5,
                        padding: '6px 4px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>{item.k}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Two-Phase Omega Metrics Card */}
              {psvResult.phase === 'twophase' && (
                <div style={{ ...cardStyle, borderLeft: '4px solid #475569' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                      API 520 Annex C — Leung Omega 2상 플래싱 해석 지표
                    </span>
                    <StatusBadge level="ok" text={psvResult.isSubcooledFlashing ? 'SUBCOOLED FLASHING' : 'SATURATED TWO-PHASE'} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                      <div style={{ fontSize: 10.5, color: '#64748B' }}>Leung Omega (ω)</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                        {psvResult.omega?.toFixed(3) ?? '-'}
                      </div>
                    </div>
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                      <div style={{ fontSize: 10.5, color: '#64748B' }}>임계 압력비 (η_c)</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                        {psvResult.eta_crit?.toFixed(3) ?? '-'}
                      </div>
                    </div>
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                      <div style={{ fontSize: 10.5, color: '#64748B' }}>질량유속 G (kg/m²·s)</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                        {psvResult.massFlux_kgm2s?.toLocaleString() ?? '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* API 520 Part II Piping Check Card */}
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>
                  <span>API 520 Part II 입·출구 배관 수력 및 기계적 건전성 검증</span>
                  <StatusBadge
                    level={psvResult.pipingCheck.inlet_3pct_pass ? 'ok' : 'fail'}
                    text={psvResult.pipingCheck.inlet_3pct_pass ? '3% INLET RULE PASS' : '3% INLET RULE FAIL'}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748B' }}>입구 ΔP (% of P_set)</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: psvResult.pipingCheck.inlet_3pct_pass ? '#0F172A' : '#991B1B', fontFamily: 'JetBrains Mono, monospace' }}>
                      {psvResult.pipingCheck.inlet_dp_pct_pset.toFixed(2)}%
                    </div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>
                      {psvResult.pipingCheck.inlet_dp_bar.toFixed(3)} bar (한계 ≤ 3.0%)
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748B' }}>방출 반력 F_R</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                      {psvResult.pipingCheck.reaction_force_N.toLocaleString()} N
                    </div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>
                      {psvResult.pipingCheck.reaction_force_kgf.toLocaleString()} kgf
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748B' }}>출구 마하수 (Exit Ma)</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: psvResult.pipingCheck.outlet_mach > 0.7 ? '#92400E' : '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                      Ma {psvResult.pipingCheck.outlet_mach.toFixed(3)}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>
                      유속 {psvResult.pipingCheck.outlet_vel_ms.toFixed(1)} m/s
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748B' }}>방출 소음 (@ 30m)</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                      {psvResult.pipingCheck.noise_dBA_30m.toFixed(1)} dBA
                    </div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>API 521 Sec. 5.4.3</div>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>엔지니어링 코드 적합성 진단</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {psvResult.warnings.map((w, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#334155' }}>
                      <StatusBadge
                        level={w.level === 'danger' ? 'fail' : w.level === 'warn' ? 'warn' : 'ok'}
                        text={w.level === 'danger' ? 'CRIT' : w.level === 'warn' ? 'WARN' : 'PASS'}
                      />
                      <span>{w.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Scenario Governing Case Matrix */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>
              <span>API 521 다중 비상 시나리오 지배 케이스 매트릭스 (Multi-Scenario Governing Matrix)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0F172A' }}>
                  지배 케이스: {governingRes.governing.caseLabel} → &apos;{governingRes.selectedOrifice.letter}&apos; ({governingRes.selectedOrifice.size})
                </span>
                <button
                  type="button"
                  onClick={handleAddScenario}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 4,
                    border: '1px solid #0F172A',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <PlusSquareIcon size={12} /> 시나리오 추가
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', color: '#334155', borderBottom: '1.5px solid #CBD5E1' }}>
                    <th style={{ padding: '7px 6px', textAlign: 'left' }}>케이스 명칭</th>
                    <th style={{ padding: '7px 6px', textAlign: 'left' }}>시나리오 (API 521)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'left' }}>상상태</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right' }}>방출량 W (kg/h)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right' }}>과압 (%)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right' }}>온도 (°C)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right' }}>요구면적 A_req (mm²)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'center' }}>선정 오리피스</th>
                    <th style={{ padding: '7px 6px', textAlign: 'right' }}>가동률 (%)</th>
                    <th style={{ padding: '7px 6px', textAlign: 'center' }}>판정</th>
                    <th style={{ padding: '7px 6px', textAlign: 'center' }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((sc, idx) => {
                    const evalCase = governingRes.cases[idx];
                    const isGov = Boolean(evalCase?.isGoverning);
                    return (
                      <tr
                        key={sc.caseId}
                        style={{
                          borderBottom: '1px solid #E2E8F0',
                          background: isGov ? '#F1F5F9' : '#FFFFFF',
                          boxShadow: isGov ? 'inset 3px 0 0 #0F172A' : 'none',
                        }}
                      >
                        <td style={{ padding: '6px' }}>
                          <input
                            type="text"
                            value={sc.caseLabel}
                            onChange={e => handleUpdateScenario(sc.caseId, 'caseLabel', e.target.value)}
                            style={tableInputStyle}
                          />
                        </td>
                        <td style={{ padding: '6px' }}>
                          <select
                            value={sc.scenario}
                            onChange={e => handleUpdateScenario(sc.caseId, 'scenario', e.target.value as PSVScenario)}
                            style={tableInputStyle}
                          >
                            {SCENARIO_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.value}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '6px' }}>
                          <select
                            value={sc.phase}
                            onChange={e => handleUpdateScenario(sc.caseId, 'phase', e.target.value as PSVPhase)}
                            style={tableInputStyle}
                          >
                            <option value="vapor">vapor</option>
                            <option value="steam">steam</option>
                            <option value="liquid">liquid</option>
                            <option value="twophase">twophase</option>
                          </select>
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right' }}>
                          {sc.scenario === 'fire_case' ? (
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#475569' }}>
                              {evalCase?.W_kgh.toLocaleString()} (자동)
                            </span>
                          ) : (
                            <input
                              type="number"
                              step="500"
                              value={sc.W_kgh}
                              onChange={e => handleUpdateScenario(sc.caseId, 'W_kgh', Number(e.target.value))}
                              style={{ ...tableInputStyle, textAlign: 'right', width: 92 }}
                            />
                          )}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right' }}>
                          <input
                            type="number"
                            step="1"
                            value={sc.overpress_pct}
                            onChange={e => handleUpdateScenario(sc.caseId, 'overpress_pct', Number(e.target.value))}
                            style={{ ...tableInputStyle, textAlign: 'right', width: 58 }}
                          />
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right' }}>
                          <input
                            type="number"
                            step="5"
                            value={sc.T_rel_C}
                            onChange={e => handleUpdateScenario(sc.caseId, 'T_rel_C', Number(e.target.value))}
                            style={{ ...tableInputStyle, textAlign: 'right', width: 64 }}
                          />
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right', fontWeight: isGov ? 800 : 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          {evalCase?.A_req_mm2.toFixed(1)}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                          {evalCase ? `'${evalCase.selectedOrifice.letter}' (${evalCase.selectedOrifice.size})` : '-'}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                          {evalCase?.cap_utilization_pct.toFixed(1)}%
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>
                          {isGov ? (
                            <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, background: '#0F172A', color: '#FFFFFF', fontSize: 10, fontWeight: 800 }}>
                              GOVERNING
                            </span>
                          ) : (
                            <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Sub-case</span>
                          )}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveScenario(sc.caseId)}
                            disabled={scenarios.length <= 1}
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: scenarios.length <= 1 ? '#CBD5E1' : '#64748B',
                              fontSize: 11,
                              cursor: scenarios.length <= 1 ? 'default' : 'pointer',
                            }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          SUB-TAB 2: FLARE HEADER NETWORK & KO DRUM (API 521)
         =================================================================== */}
      {subTab === 'flare_net' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Preset Loader Strip */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {Object.values(FLARE_PLANT_PRESETS).map(preset => {
              const active = selectedFlarePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectFlarePreset(preset.id)}
                  style={{
                    flex: '0 0 auto',
                    padding: '8px 14px',
                    borderRadius: 7,
                    border: active ? '1.5px solid #0F172A' : '1px solid #CBD5E1',
                    background: active ? '#F1F5F9' : '#FFFFFF',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>{preset.name}</div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{preset.description}</div>
                </button>
              );
            })}
          </div>

          {/* KPI Summary Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
            <div style={{ ...cardStyle, borderLeft: '4px solid #0F172A' }}>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>동시 총 방출 부하 (Coincident Load)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                {flareResult.totalMassFlowKgH.toLocaleString()} kg/h
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                혼합 MW <strong>{flareResult.mixMw}</strong> · T_mix <strong>{flareResult.mixTempC} °C</strong> (k={flareResult.mixK})
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: `4px solid ${flareResult.header.headerMachPass ? '#0F172A' : '#991B1B'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>메인 헤더 출구 마하수</span>
                <StatusBadge level={flareResult.header.headerMachPass ? 'ok' : 'fail'} text={flareResult.header.headerMachPass ? 'Ma ≤ 0.70 PASS' : 'Ma > 0.70 FAIL'} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                Ma {flareResult.header.headerExitMach.toFixed(3)}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                출구 유속 <strong>{flareResult.header.headerExitVelMs} m/s</strong> · ΔP <strong>{flareResult.header.headerDpBar.toFixed(3)} bar</strong>
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: `4px solid ${flareResult.allBranchesCompliant ? '#0F172A' : '#991B1B'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>PSV 지관 배압 적합성</span>
                <StatusBadge level={flareResult.allBranchesCompliant ? 'ok' : 'fail'} text={flareResult.allBranchesCompliant ? 'ALL COMPLIANT' : 'BACKPRESS FAIL'} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                {flareResult.header.headerInletPressBarG.toFixed(2)} barG
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                헤더 입구 압력 (팁 배압 {flareResult.header.tipBackpressBarG} barG)
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: '4px solid #475569' }}>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>수평 플레어 KO 드럼 규격</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                Ø{flareResult.koDrum.koDrumDiaM.toFixed(1)} × {flareResult.koDrum.koDrumLenM.toFixed(1)} m
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                L/D = <strong>{flareResult.koDrum.ldRatio}</strong> · 액체 체류 <strong>{flareResult.koDrum.liquidHoldupM3} m³</strong>
              </div>
            </div>
          </div>

          {/* Main Flare Header & KO Drum Parameters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
            <div style={cardStyle}>
              <h3 style={sectionTitleStyle}>
                <span>메인 플레어 헤더 및 KO 드럼 설계 변수</span>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Isothermal / Fanno Backward March</span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
                <div>
                  <label style={labelStyle}>메인 헤더 내경 (mm)</label>
                  <input
                    type="number"
                    step="10"
                    min="100"
                    value={flareInput.headerPipeIdMm}
                    onChange={e => setFlareInput(prev => ({ ...prev, headerPipeIdMm: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>메인 헤더 길이 (m)</label>
                  <input
                    type="number"
                    step="10"
                    min="10"
                    value={flareInput.headerLenM}
                    onChange={e => setFlareInput(prev => ({ ...prev, headerLenM: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>헤더 K-피팅 합계</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={flareInput.headerKFittings ?? 8}
                    onChange={e => setFlareInput(prev => ({ ...prev, headerKFittings: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>팁 배압 (barG)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={flareInput.tipBackpressBarG ?? 0.05}
                    onChange={e => setFlareInput(prev => ({ ...prev, tipBackpressBarG: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>KO 액적 직경 (µm, 300–600)</label>
                  <input
                    type="number"
                    step="50"
                    min="150"
                    max="800"
                    value={flareInput.dropletDiaUm ?? 300}
                    onChange={e => setFlareInput(prev => ({ ...prev, dropletDiaUm: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>KO 액체 체류시간 (min)</label>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    max="60"
                    value={flareInput.koHoldupMin ?? 25}
                    onChange={e => setFlareInput(prev => ({ ...prev, koHoldupMin: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            {/* API 521 Horizontal Flare KO Drum Sizing Card */}
            <div style={cardStyle}>
              <h3 style={sectionTitleStyle}>
                <span>API 521 수평 플레어 KO 드럼 사이징 상세 (Horizontal KO Drum)</span>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Sec. 5.4.2.1</span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                  <div style={{ fontSize: 10.5, color: '#64748B' }}>드럼 치수 (ID × T/T)</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {flareResult.koDrum.koDrumDiaM.toFixed(1)} m × {flareResult.koDrum.koDrumLenM.toFixed(1)} m
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>L/D = {flareResult.koDrum.ldRatio}</div>
                </div>
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                  <div style={{ fontSize: 10.5, color: '#64748B' }}>액적 침강속도 v_t</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {flareResult.koDrum.settlingVelMs.toFixed(3)} m/s
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>제거 기준 {flareResult.koDrum.dropletDiaUm} µm</div>
                </div>
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 5, padding: '8px' }}>
                  <div style={{ fontSize: 10.5, color: '#64748B' }}>기상 수평유속 v_g</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {flareResult.koDrum.vaporVelMs.toFixed(2)} m/s
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>가스유량 {flareResult.koDrum.gasVolFlowM3s} m³/s</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#475569' }}>
                액체 Rainout 체류부피: <strong>{flareResult.koDrum.liquidHoldupM3} m³</strong> ({flareResult.koDrum.holdupMin}분 기준, 기상 단면적 분율 {(flareResult.koDrum.vaporAreaFrac * 100).toFixed(0)}%)
              </div>
            </div>
          </div>

          {/* Editable PSV Source Branches Table */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>
              <span>PSV 방출 지관 네트워크 입력 및 배압·마하수 적합성 테이블</span>
              <button
                type="button"
                onClick={handleAddBranch}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: '1px solid #0F172A',
                  background: '#FFFFFF',
                  color: '#0F172A',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <PlusSquareIcon size={12} /> PSV 지관 추가
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', color: '#334155', borderBottom: '1.5px solid #CBD5E1' }}>
                    <th style={{ padding: '7px 5px', textAlign: 'left' }}>PSV Tag</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>유량 (kg/h)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>MW</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>T (°C)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>P_set (barG)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'left' }}>밸브 형식</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>지관 ID (mm)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>길이 (m)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>총 배압 (barG)</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>배압비 / 한계</th>
                    <th style={{ padding: '7px 5px', textAlign: 'right' }}>지관 Ma</th>
                    <th style={{ padding: '7px 5px', textAlign: 'center' }}>적합성</th>
                    <th style={{ padding: '7px 5px', textAlign: 'center' }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {flareInput.branches.map((br, idx) => {
                    const resBr = flareResult.branches[idx];
                    return (
                      <tr key={br.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '5px' }}>
                          <input type="text" value={br.tag} onChange={e => handleUpdateBranch(br.id, 'tag', e.target.value)} style={{ ...tableInputStyle, width: 78, fontWeight: 700 }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="500" value={br.massFlowKgH} onChange={e => handleUpdateBranch(br.id, 'massFlowKgH', Number(e.target.value))} style={{ ...tableInputStyle, width: 76, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="1" value={br.mw} onChange={e => handleUpdateBranch(br.id, 'mw', Number(e.target.value))} style={{ ...tableInputStyle, width: 52, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="5" value={br.tempC} onChange={e => handleUpdateBranch(br.id, 'tempC', Number(e.target.value))} style={{ ...tableInputStyle, width: 52, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="0.5" value={br.psvSetBarG} onChange={e => handleUpdateBranch(br.id, 'psvSetBarG', Number(e.target.value))} style={{ ...tableInputStyle, width: 56, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px' }}>
                          <select value={br.valveType} onChange={e => handleUpdateBranch(br.id, 'valveType', e.target.value as FlareValveType)} style={{ ...tableInputStyle, width: 118 }}>
                            <option value="conventional">conventional</option>
                            <option value="balanced_bellows">balanced_bellows</option>
                            <option value="pilot">pilot</option>
                          </select>
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="5" value={br.branchPipeIdMm} onChange={e => handleUpdateBranch(br.id, 'branchPipeIdMm', Number(e.target.value))} style={{ ...tableInputStyle, width: 62, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <input type="number" step="5" value={br.branchLenM} onChange={e => handleUpdateBranch(br.id, 'branchLenM', Number(e.target.value))} style={{ ...tableInputStyle, width: 52, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                          {resBr?.psvBackpressBarG.toFixed(2)}
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                          <strong>{resBr?.backpressPctPset.toFixed(1)}%</strong> / {resBr?.allowableBackpressPct}%
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                          {resBr?.branchMach.toFixed(3)}
                        </td>
                        <td style={{ padding: '5px', textAlign: 'center' }} title={resBr?.statusNote}>
                          <StatusBadge
                            level={resBr?.backpressStatus ?? 'ok'}
                            text={(resBr?.backpressStatus ?? 'ok').toUpperCase()}
                          />
                        </td>
                        <td style={{ padding: '5px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveBranch(br.id)}
                            disabled={flareInput.branches.length <= 1}
                            style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#64748B', fontSize: 11, cursor: 'pointer' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Flare Warnings */}
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {flareResult.warnings.map((w, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#334155' }}>
                  <StatusBadge
                    level={w.level === 'danger' ? 'fail' : w.level === 'warn' ? 'warn' : 'ok'}
                    text={w.level === 'danger' ? 'CRIT' : w.level === 'warn' ? 'WARN' : 'PASS'}
                  />
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          SUB-TAB 3: FLARE TIP & THERMAL RADIATION (API 521)
         =================================================================== */}
      {subTab === 'flare_rad' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Flare Tip & Radiation Inputs */}
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>
              <span>플레어 스택 · 팁 및 복사열 해석 조건 (API 521 Hajek-Ludwig / Brzustowski-Sommer)</span>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
                활성 부하: {flareResult.caseName} ({flareResult.totalMassFlowKgH.toLocaleString()} kg/h, MW={flareResult.mixMw})
              </span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div>
                <label style={labelStyle}>스택 높이 Stack Height (m)</label>
                <input
                  type="number"
                  step="5"
                  min="10"
                  max="200"
                  value={flareInput.stackHeightM}
                  onChange={e => setFlareInput(prev => ({ ...prev, stackHeightM: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>설계 풍속 Wind Speed (m/s)</label>
                <input
                  type="number"
                  step="1"
                  min="0.5"
                  max="40"
                  value={flareInput.windSpeedMs ?? 9.0}
                  onChange={e => setFlareInput(prev => ({ ...prev, windSpeedMs: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>복사율 F (자동={flareResult.radiation.emissivityF})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  max="0.45"
                  placeholder={`자동 (${flareResult.radiation.emissivityF})`}
                  value={customEmissivity}
                  onChange={e => setCustomEmissivity(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>저위발열량 LHV (kJ/kg)</label>
                <input
                  type="number"
                  step="500"
                  placeholder={`자동 (${flareResult.radiation.lhvKJkg})`}
                  value={customLhv}
                  onChange={e => setCustomLhv(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>팁 설계 마하수 (0.20–0.80)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.2"
                  max="0.8"
                  value={flareInput.tipDesignMach ?? 0.5}
                  onChange={e => setFlareInput(prev => ({ ...prev, tipDesignMach: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* Flare Tip KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
            <div style={{ ...cardStyle, borderLeft: '4px solid #0F172A' }}>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>선정 플레어 팁 규격 (Flare Tip)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                {flareResult.tip.selectedTipNps} ({flareResult.tip.selectedTipDiaMm} mm)
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                요구 내경 <strong>{flareResult.tip.reqTipDiaMm} mm</strong>
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: `4px solid ${flareResult.tip.machStatus === 'danger' ? '#991B1B' : '#0F172A'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>팁 출구 유속 &amp; 마하수</span>
                <StatusBadge
                  level={flareResult.tip.machStatus === 'danger' ? 'fail' : flareResult.tip.machStatus === 'warn' ? 'warn' : 'ok'}
                  text={flareResult.tip.machStatus === 'ok' ? '≤ 0.50 NORMAL' : flareResult.tip.machStatus === 'warn' ? '≤ 0.80 EMERG' : '> 0.80 LIFT-OFF'}
                />
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                Ma {flareResult.tip.tipMach.toFixed(3)} ({flareResult.tip.exitVelMs} m/s)
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                음속 c = <strong>{flareResult.tip.sonicVelMs} m/s</strong>
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: '4px solid #334155' }}>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>퍼지 가스 유량 (N₂ / Fuel Purge)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                {flareResult.tip.purgeGasNm3H.toFixed(1)} Nm³/h
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                Molecular Seal 적용 시 <strong>{flareResult.tip.purgeGasWithSealNm3H.toFixed(1)} Nm³/h</strong>
              </div>
            </div>

            <div style={{ ...cardStyle, borderLeft: '4px solid #475569' }}>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>화염 길이 · 기울기 &amp; 발열량</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                {flareResult.radiation.flameLengthM.toFixed(1)} m / {flareResult.radiation.flameTiltDeg.toFixed(1)}°
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                총 발열량 <strong>{flareResult.radiation.heatReleaseMW.toFixed(1)} MW</strong> · 중심 ({flareResult.radiation.flameCenterX_m}m, {flareResult.radiation.flameCenterY_m}m)
              </div>
            </div>
          </div>

          {/* Monochrome SVG Radiation Profile Chart */}
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>
              <span>지표면 복사열 프로파일 I(r) vs 풍하 거리 (0–250 m · API 521)</span>
              <span style={{ fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', color: '#334155' }}>
                Peak {flareResult.radiation.peakGroundRadKwM2.toFixed(2)} kW/m² @ r = {flareResult.radiation.peakGroundDistM.toFixed(1)} m
              </span>
            </div>
            {renderRadiationChart()}
          </div>

          {/* Safe Distance Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
            {[
              { thr: '1.58 kW/m²', title: '연속 노출 / 부지 경계 (Plant Boundary)', dist: flareResult.radiation.safeDist_1_58_m, desc: '보호구 없이 장시간 상주 가능 한계' },
              { thr: '4.73 kW/m²', title: '비상 조치 한계 (Sterile Zone)', dist: flareResult.radiation.safeDist_4_73_m, desc: '방염복 착용 시 2–3분 비상 조작 허용' },
              { thr: '6.31 kW/m²', title: '단기 노출 / 운전구역 (Short Exposure)', dist: flareResult.radiation.safeDist_6_31_m, desc: '30초 이내 긴급 대피 구역 기준' },
              { thr: '9.46 kW/m²', title: '구조물 / 철골 한계 (Structure Limit)', dist: flareResult.radiation.safeDist_9_46_m, desc: '설비 외벽·철골 구조물 허용 복사열' },
            ].map(item => (
              <div key={item.thr} style={{ ...cardStyle, borderTop: '3px solid #0F172A' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>{item.thr}</span>
                  <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>API 521</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {item.dist > 0 ? `${item.dist.toFixed(1)} m` : '안전 (0 m)'}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', marginTop: 3 }}>{item.title}</div>
                <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

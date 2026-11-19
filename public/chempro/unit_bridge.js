/**
 * ChemPro Suite — Unit Dropdown & Global Default Unit Sync Bridge
 * Mirrors lib/units/unitSystem.ts (17 quantities, 4 presets) and syncs with
 * Header global unit store via localStorage ('chemeng_unit_prefs_v1'),
 * storage events, and parent postMessage ({ type: 'CHEMENG_UNITS_SYNC', units }).
 *
 * Solver & Handoff Safety:
 * Installs a transparent HTMLInputElement `value` property bridge on every mapped
 * physical-quantity <input> BEFORE App's DOMContentLoaded init() runs:
 *  - Reads by app.js (`el.value`) always return the exact `internalUnitId` value.
 *  - Writes by app.js (`el.value = ...` from presets, simulator handoffs, fluid
 *    property updaters, and auto-DOF calculations) are automatically converted from
 *    `internalUnitId` into the input's currently selected display unit.
 *  - User edits and dropdown changes convert immediately in-place with zero flicker.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'chemeng_unit_prefs_v1';

  // Exact constants mirrored from lib/units/unitSystem.ts
  const ATM_KGF_CM2 = 1.03322745;
  const BAR_PER_KGF_CM2 = 0.980665;
  const ATM_BAR = 1.01325;
  const KPA_PER_KGF_CM2 = 98.0665;
  const ATM_KPA = 101.325;
  const PSI_PER_KGF_CM2 = 14.2233433;
  const ATM_PSI = 14.6959488;
  const MMHG_PER_BAR = 750.061683;

  const UNIT_QUANTITIES = {
    temp: {
      key: 'temp',
      labelKo: '온도',
      canonicalId: 'C',
      options: [
        { id: 'C', label: '°C', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
        { id: 'K', label: 'K', fromCanonical: v => v + 273.15, toCanonical: v => v - 273.15, decimals: 1 },
        { id: 'F', label: '°F', fromCanonical: v => (v * 9) / 5 + 32, toCanonical: v => ((v - 32) * 5) / 9, decimals: 1 },
      ],
    },
    pressG: {
      key: 'pressG',
      labelKo: '압력',
      canonicalId: 'kgcm2g',
      options: [
        { id: 'kgcm2g', label: 'kg/cm²G', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'kgcm2a', label: 'kg/cm²A', fromCanonical: v => v + ATM_KGF_CM2, toCanonical: v => v - ATM_KGF_CM2, decimals: 2 },
        { id: 'barG', label: 'barG', fromCanonical: v => v * BAR_PER_KGF_CM2, toCanonical: v => v / BAR_PER_KGF_CM2, decimals: 2 },
        { id: 'barA', label: 'barA', fromCanonical: v => v * BAR_PER_KGF_CM2 + ATM_BAR, toCanonical: v => (v - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 2 },
        { id: 'kPaG', label: 'kPaG', fromCanonical: v => v * KPA_PER_KGF_CM2, toCanonical: v => v / KPA_PER_KGF_CM2, decimals: 1 },
        { id: 'kPaA', label: 'kPaA', fromCanonical: v => v * KPA_PER_KGF_CM2 + ATM_KPA, toCanonical: v => (v - ATM_KPA) / KPA_PER_KGF_CM2, decimals: 1 },
        { id: 'atm', label: 'atm', fromCanonical: v => (v * BAR_PER_KGF_CM2 + ATM_BAR) / ATM_BAR, toCanonical: v => (v * ATM_BAR - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 3 },
        { id: 'mmHgA', label: 'mmHgA', fromCanonical: v => (v * BAR_PER_KGF_CM2 + ATM_BAR) * MMHG_PER_BAR, toCanonical: v => (v / MMHG_PER_BAR - ATM_BAR) / BAR_PER_KGF_CM2, decimals: 1 },
        { id: 'psig', label: 'psig', fromCanonical: v => v * PSI_PER_KGF_CM2, toCanonical: v => v / PSI_PER_KGF_CM2, decimals: 1 },
        { id: 'psia', label: 'psia', fromCanonical: v => v * PSI_PER_KGF_CM2 + ATM_PSI, toCanonical: v => (v - ATM_PSI) / PSI_PER_KGF_CM2, decimals: 1 },
      ],
    },
    deltaP: {
      key: 'deltaP',
      labelKo: '차압',
      canonicalId: 'kgcm2',
      options: [
        { id: 'kgcm2', label: 'kg/cm²', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
        { id: 'bar', label: 'bar', fromCanonical: v => v * BAR_PER_KGF_CM2, toCanonical: v => v / BAR_PER_KGF_CM2, decimals: 3 },
        { id: 'kPa', label: 'kPa', fromCanonical: v => v * KPA_PER_KGF_CM2, toCanonical: v => v / KPA_PER_KGF_CM2, decimals: 2 },
        { id: 'mmH2O', label: 'mmH₂O', fromCanonical: v => v * 10000, toCanonical: v => v / 10000, decimals: 0 },
        { id: 'mmHg', label: 'mmHg', fromCanonical: v => v * 735.55924, toCanonical: v => v / 735.55924, decimals: 1 },
        { id: 'psi', label: 'psi', fromCanonical: v => v * PSI_PER_KGF_CM2, toCanonical: v => v / PSI_PER_KGF_CM2, decimals: 2 },
      ],
    },
    massFlow: {
      key: 'massFlow',
      labelKo: '질량유량',
      canonicalId: 'kgh',
      options: [
        { id: 'kgh', label: 'kg/h', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
        { id: 'th', label: 't/h', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 3 },
        { id: 'td', label: 't/d', fromCanonical: v => (v * 24) / 1000, toCanonical: v => (v * 1000) / 24, decimals: 2 },
        { id: 'kgs', label: 'kg/s', fromCanonical: v => v / 3600, toCanonical: v => v * 3600, decimals: 3 },
        { id: 'kgmin', label: 'kg/min', fromCanonical: v => v / 60, toCanonical: v => v * 60, decimals: 2 },
        { id: 'lbh', label: 'lb/h', fromCanonical: v => v * 2.20462262, toCanonical: v => v / 2.20462262, decimals: 1 },
      ],
    },
    molarFlow: {
      key: 'molarFlow',
      labelKo: '몰유량',
      canonicalId: 'kmolh',
      options: [
        { id: 'kmolh', label: 'kmol/h', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'mols', label: 'mol/s', fromCanonical: v => v / 3.6, toCanonical: v => v * 3.6, decimals: 2 },
        { id: 'kmold', label: 'kmol/d', fromCanonical: v => v * 24, toCanonical: v => v / 24, decimals: 1 },
        { id: 'lbmolh', label: 'lbmol/h', fromCanonical: v => v * 2.20462262, toCanonical: v => v / 2.20462262, decimals: 2 },
      ],
    },
    volFlow: {
      key: 'volFlow',
      labelKo: '부피유량',
      canonicalId: 'm3h',
      options: [
        { id: 'm3h', label: 'm³/h', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'm3min', label: 'm³/min', fromCanonical: v => v / 60, toCanonical: v => v * 60, decimals: 3 },
        { id: 'Lmin', label: 'L/min', fromCanonical: v => (v * 1000) / 60, toCanonical: v => (v * 60) / 1000, decimals: 1 },
        { id: 'm3d', label: 'm³/d', fromCanonical: v => v * 24, toCanonical: v => v / 24, decimals: 1 },
        { id: 'gpm', label: 'gpm', fromCanonical: v => v * 4.4028675, toCanonical: v => v / 4.4028675, decimals: 2 },
        { id: 'ft3h', label: 'ft³/h', fromCanonical: v => v * 35.3146667, toCanonical: v => v / 35.3146667, decimals: 1 },
      ],
    },
    density: {
      key: 'density',
      labelKo: '밀도',
      canonicalId: 'kgm3',
      options: [
        { id: 'kgm3', label: 'kg/m³', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'gcm3', label: 'g/cm³', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 4 },
        { id: 'lbft3', label: 'lb/ft³', fromCanonical: v => v * 0.06242796, toCanonical: v => v / 0.06242796, decimals: 3 },
      ],
    },
    cp: {
      key: 'cp',
      labelKo: '비열',
      canonicalId: 'kcalkgC',
      options: [
        { id: 'kcalkgC', label: 'kcal/kg°C', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
        { id: 'kJkgK', label: 'kJ/kg·K', fromCanonical: v => v * 4.1868, toCanonical: v => v / 4.1868, decimals: 3 },
        { id: 'BtulbF', label: 'Btu/lb·°F', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
      ],
    },
    heatDuty: {
      key: 'heatDuty',
      labelKo: '열부하',
      canonicalId: 'Mcalh',
      options: [
        { id: 'Mcalh', label: 'Mcal/h', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
        { id: 'kcalh', label: 'kcal/h', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 0 },
        { id: 'kW', label: 'kW', fromCanonical: v => v * 1.163, toCanonical: v => v / 1.163, decimals: 1 },
        { id: 'MW', label: 'MW', fromCanonical: v => v * 0.001163, toCanonical: v => v / 0.001163, decimals: 3 },
        { id: 'GJh', label: 'GJ/h', fromCanonical: v => v * 0.0041868, toCanonical: v => v / 0.0041868, decimals: 3 },
        { id: 'MMBtuh', label: 'MMBtu/h', fromCanonical: v => v * 0.00396832, toCanonical: v => v / 0.00396832, decimals: 3 },
      ],
    },
    power: {
      key: 'power',
      labelKo: '동력',
      canonicalId: 'kW',
      options: [
        { id: 'kW', label: 'kW', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
        { id: 'MW', label: 'MW', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 3 },
        { id: 'HP', label: 'HP', fromCanonical: v => v * 1.34102209, toCanonical: v => v / 1.34102209, decimals: 1 },
        { id: 'kcalh', label: 'kcal/h', fromCanonical: v => v * 859.8452, toCanonical: v => v / 859.8452, decimals: 0 },
      ],
    },
    htc: {
      key: 'htc',
      labelKo: '열전달계수',
      canonicalId: 'kcalm2hC',
      options: [
        { id: 'kcalm2hC', label: 'kcal/m²h°C', fromCanonical: v => v, toCanonical: v => v, decimals: 1 },
        { id: 'Wm2K', label: 'W/m²·K', fromCanonical: v => v * 1.163, toCanonical: v => v / 1.163, decimals: 1 },
        { id: 'Btuhft2F', label: 'Btu/h·ft²·°F', fromCanonical: v => v * 0.204816, toCanonical: v => v / 0.204816, decimals: 2 },
      ],
    },
    fouling: {
      key: 'fouling',
      labelKo: '오염계수',
      canonicalId: 'm2hCkcal',
      options: [
        { id: 'm2hCkcal', label: 'm²h°C/kcal', fromCanonical: v => v, toCanonical: v => v, decimals: 5 },
        { id: 'm2KW', label: 'm²·K/W', fromCanonical: v => v / 1.163, toCanonical: v => v * 1.163, decimals: 5 },
        { id: 'hft2FBtu', label: 'h·ft²·°F/Btu', fromCanonical: v => v / 0.204816, toCanonical: v => v * 0.204816, decimals: 5 },
      ],
    },
    area: {
      key: 'area',
      labelKo: '면적',
      canonicalId: 'm2',
      options: [
        { id: 'm2', label: 'm²', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'ft2', label: 'ft²', fromCanonical: v => v * 10.7639104, toCanonical: v => v / 10.7639104, decimals: 1 },
      ],
    },
    volume: {
      key: 'volume',
      labelKo: '용적',
      canonicalId: 'm3',
      options: [
        { id: 'm3', label: 'm³', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'L', label: 'L', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 0 },
        { id: 'ft3', label: 'ft³', fromCanonical: v => v * 35.3146667, toCanonical: v => v / 35.3146667, decimals: 1 },
        { id: 'gal', label: 'gal', fromCanonical: v => v * 264.172052, toCanonical: v => v / 264.172052, decimals: 1 },
      ],
    },
    length: {
      key: 'length',
      labelKo: '길이/직경',
      canonicalId: 'm',
      options: [
        { id: 'm', label: 'm', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
        { id: 'mm', label: 'mm', fromCanonical: v => v * 1000, toCanonical: v => v / 1000, decimals: 1 },
        { id: 'cm', label: 'cm', fromCanonical: v => v * 100, toCanonical: v => v / 100, decimals: 2 },
        { id: 'in', label: 'in', fromCanonical: v => v * 39.3700787, toCanonical: v => v / 39.3700787, decimals: 2 },
        { id: 'ft', label: 'ft', fromCanonical: v => v * 3.2808399, toCanonical: v => v / 3.2808399, decimals: 2 },
      ],
    },
    velocity: {
      key: 'velocity',
      labelKo: '유속',
      canonicalId: 'ms',
      options: [
        { id: 'ms', label: 'm/s', fromCanonical: v => v, toCanonical: v => v, decimals: 2 },
        { id: 'fts', label: 'ft/s', fromCanonical: v => v * 3.2808399, toCanonical: v => v / 3.2808399, decimals: 2 },
      ],
    },
    viscosity: {
      key: 'viscosity',
      labelKo: '점도',
      canonicalId: 'cP',
      options: [
        { id: 'cP', label: 'cP', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
        { id: 'mPas', label: 'mPa·s', fromCanonical: v => v, toCanonical: v => v, decimals: 3 },
        { id: 'Pas', label: 'Pa·s', fromCanonical: v => v / 1000, toCanonical: v => v * 1000, decimals: 5 },
      ],
    },
  };

  const UNIT_PRESETS = [
    {
      id: 'METRIC_ENG',
      shortName: 'MKS',
      units: {
        temp: 'C', pressG: 'kgcm2g', deltaP: 'kgcm2', massFlow: 'kgh', molarFlow: 'kmolh',
        volFlow: 'm3h', density: 'kgm3', cp: 'kcalkgC', heatDuty: 'Mcalh', power: 'kW',
        htc: 'kcalm2hC', fouling: 'm2hCkcal', area: 'm2', volume: 'm3', length: 'm',
        velocity: 'ms', viscosity: 'cP',
      },
    },
    {
      id: 'SI',
      shortName: 'SI',
      units: {
        temp: 'C', pressG: 'barA', deltaP: 'kPa', massFlow: 'kgh', molarFlow: 'kmolh',
        volFlow: 'm3h', density: 'kgm3', cp: 'kJkgK', heatDuty: 'kW', power: 'kW',
        htc: 'Wm2K', fouling: 'm2KW', area: 'm2', volume: 'm3', length: 'm',
        velocity: 'ms', viscosity: 'mPas',
      },
    },
    {
      id: 'SI_BARG',
      shortName: 'SI-P',
      units: {
        temp: 'C', pressG: 'barG', deltaP: 'bar', massFlow: 'th', molarFlow: 'kmolh',
        volFlow: 'm3h', density: 'kgm3', cp: 'kJkgK', heatDuty: 'MW', power: 'kW',
        htc: 'Wm2K', fouling: 'm2KW', area: 'm2', volume: 'm3', length: 'm',
        velocity: 'ms', viscosity: 'cP',
      },
    },
    {
      id: 'US_FIELD',
      shortName: 'US',
      units: {
        temp: 'F', pressG: 'psig', deltaP: 'psi', massFlow: 'lbh', molarFlow: 'lbmolh',
        volFlow: 'gpm', density: 'lbft3', cp: 'BtulbF', heatDuty: 'MMBtuh', power: 'HP',
        htc: 'Btuhft2F', fouling: 'hft2FBtu', area: 'ft2', volume: 'ft3', length: 'ft',
        velocity: 'fts', viscosity: 'cP',
      },
    },
  ];

  const DEFAULT_UNIT_PREFS = Object.assign({}, UNIT_PRESETS[0].units);

  // All 49 physical-quantity <input> elements across all 6 ChemPro tabs
  const INPUT_SPECS = [
    // 1. Heat Exchanger (hx) — 9 inputs
    { id: 'hx_mh', tab: 'hx', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'hx_Thi', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_Tho', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_mc', tab: 'hx', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'hx_Tci', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_Tco', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_Th_sat', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_Tc_sat', tab: 'hx', quantity: 'temp', internalUnitId: 'C' },
    { id: 'hx_U_assumed', tab: 'hx', quantity: 'htc', internalUnitId: 'Wm2K' },

    // 2. Centrifugal Pump (pump) — 12 inputs
    { id: 'pump_T', tab: 'pump', quantity: 'temp', internalUnitId: 'C' },
    { id: 'pump_Q', tab: 'pump', quantity: 'volFlow', internalUnitId: 'm3h' },
    { id: 'pump_rho', tab: 'pump', quantity: 'density', internalUnitId: 'kgm3' },
    { id: 'pump_mu', tab: 'pump', quantity: 'viscosity', internalUnitId: 'cP' },
    { id: 'pump_pv', tab: 'pump', quantity: 'pressG', internalUnitId: 'barA' },
    { id: 'pump_P1', tab: 'pump', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'pump_P2', tab: 'pump', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'pump_z1', tab: 'pump', quantity: 'length', internalUnitId: 'm' },
    { id: 'pump_z2', tab: 'pump', quantity: 'length', internalUnitId: 'm' },
    { id: 'pump_Lsuc', tab: 'pump', quantity: 'length', internalUnitId: 'm' },
    { id: 'pump_Ldis', tab: 'pump', quantity: 'length', internalUnitId: 'm' },
    { id: 'pump_cv', tab: 'pump', quantity: 'deltaP', internalUnitId: 'bar' },

    // 3. Distillation / Absorption Column (column) — 6 inputs
    { id: 'col_P', tab: 'column', quantity: 'pressG', internalUnitId: 'barA' },
    { id: 'col_gas_kgh', tab: 'column', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'col_liq_kgh', tab: 'column', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'col_T_gas_in', tab: 'column', quantity: 'temp', internalUnitId: 'C' },
    { id: 'col_T_liq_in', tab: 'column', quantity: 'temp', internalUnitId: 'C' },
    { id: 'col_F', tab: 'column', quantity: 'molarFlow', internalUnitId: 'kmolh' },

    // 4. Process Piping (piping) — 9 inputs
    { id: 'pipe_T', tab: 'piping', quantity: 'temp', internalUnitId: 'C' },
    { id: 'pipe_P1', tab: 'piping', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'pipe_Q', tab: 'piping', quantity: 'volFlow', internalUnitId: 'm3h' },
    { id: 'pipe_rho', tab: 'piping', quantity: 'density', internalUnitId: 'kgm3' },
    { id: 'pipe_mu', tab: 'piping', quantity: 'viscosity', internalUnitId: 'cP' },
    { id: 'pipe_L', tab: 'piping', quantity: 'length', internalUnitId: 'm' },
    { id: 'pipe_dZ', tab: 'piping', quantity: 'length', internalUnitId: 'm' },
    {
      id: 'pipe_target_dp',
      tab: 'piping',
      quantity: 'deltaP',
      internalUnitId: 'bar',
      bypassWhen: () => {
        const fm = document.getElementById('pipe_flow_mode');
        return Boolean(fm && fm.value === 'twophase');
      },
    },
    { id: 'pipe_rough', tab: 'piping', quantity: 'length', internalUnitId: 'mm' },

    // 5. Pressure Vessel & KO Drum (vessel) — 8 inputs
    { id: 'ves_T_op', tab: 'vessel', quantity: 'temp', internalUnitId: 'C' },
    { id: 'ves_Wg', tab: 'vessel', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'ves_Wl', tab: 'vessel', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'ves_rhoG', tab: 'vessel', quantity: 'density', internalUnitId: 'kgm3' },
    { id: 'ves_rhoL', tab: 'vessel', quantity: 'density', internalUnitId: 'kgm3' },
    { id: 'ves_Pop', tab: 'vessel', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'ves_Pdes', tab: 'vessel', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'ves_CA', tab: 'vessel', quantity: 'length', internalUnitId: 'mm' },

    // 6. Pressure Safety Valve (psv) — 5 inputs
    { id: 'psv_W', tab: 'psv', quantity: 'massFlow', internalUnitId: 'kgh' },
    { id: 'psv_Pset', tab: 'psv', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'psv_Pback', tab: 'psv', quantity: 'pressG', internalUnitId: 'barG' },
    { id: 'psv_T', tab: 'psv', quantity: 'temp', internalUnitId: 'C' },
    { id: 'psv_Awet', tab: 'psv', quantity: 'area', internalUnitId: 'm2' },
  ];

  // 10 key quantities shown in the compact Display Units bar
  const BAR_QUANTITIES = [
    'temp', 'pressG', 'deltaP', 'massFlow', 'volFlow',
    'heatDuty', 'power', 'length', 'area', 'velocity',
  ];

  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!nativeValueDesc || !nativeValueDesc.get || !nativeValueDesc.set) {
    return;
  }

  function getRawVal(el) {
    return nativeValueDesc.get.call(el);
  }

  function setRawVal(el, val) {
    nativeValueDesc.set.call(el, val == null ? '' : String(val));
  }

  function getUnitOption(quantity, unitId) {
    const meta = UNIT_QUANTITIES[quantity];
    if (!meta) return null;
    if (!unitId) return meta.options[0];
    return meta.options.find(o => o.id === unitId) || meta.options[0];
  }

  function convertUnit(quantity, value, fromUnitId, toUnitId) {
    if (!Number.isFinite(value)) return value;
    if (fromUnitId === toUnitId) return value;
    const fromOpt = getUnitOption(quantity, fromUnitId);
    const toOpt = getUnitOption(quantity, toUnitId);
    if (!fromOpt || !toOpt) return value;
    return toOpt.fromCanonical(fromOpt.toCanonical(value));
  }

  function formatInputNumber(val, decimals) {
    if (!Number.isFinite(val)) return '';
    if (Object.is(val, -0) || val === 0) return '0';
    const abs = Math.abs(val);
    if (abs < 0.01) {
      return Number(val.toPrecision(4)).toString();
    }
    if (abs < 1) {
      return Number(val.toFixed(Math.max(decimals || 2, 3))).toString();
    }
    const d = decimals !== undefined ? decimals : 2;
    return Number(val.toFixed(d)).toString();
  }

  function formatDisplayNumber(quantity, val, fromUnitId, toUnitId, overrideDecimals) {
    if (!Number.isFinite(val)) return '—';
    const converted = convertUnit(quantity, val, fromUnitId, toUnitId);
    const opt = getUnitOption(quantity, toUnitId);
    const decimals = overrideDecimals !== undefined ? overrideDecimals : (opt && opt.decimals !== undefined ? opt.decimals : 2);
    if (Math.abs(converted) >= 1000 && decimals <= 1) {
      return converted.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    return converted.toFixed(decimals);
  }

  function getUnitLabel(quantity, unitId) {
    const opt = getUnitOption(quantity, unitId);
    return opt ? opt.label : '';
  }

  function sanitizeUnits(raw) {
    const merged = Object.assign({}, DEFAULT_UNIT_PREFS);
    if (raw && typeof raw === 'object') {
      Object.keys(UNIT_QUANTITIES).forEach(q => {
        const cand = raw[q];
        if (cand && UNIT_QUANTITIES[q].options.some(o => o.id === cand)) {
          merged[q] = cand;
        }
      });
    }
    return merged;
  }

  function loadStoredUnits() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_UNIT_PREFS);
      return sanitizeUnits(JSON.parse(raw));
    } catch (_) {
      return Object.assign({}, DEFAULT_UNIT_PREFS);
    }
  }

  function detectPresetId(units) {
    for (let i = 0; i < UNIT_PRESETS.length; i++) {
      const p = UNIT_PRESETS[i];
      const match = Object.keys(p.units).every(k => units[k] === p.units[k]);
      if (match) return p.id;
    }
    return 'CUSTOM';
  }

  // Runtime state
  let globalUnits = loadStoredUnits();
  const fieldBindings = new Map(); // id -> { spec, el, sel, currentUnitId, labelUnitEl }
  const barSelects = new Map();    // quantity -> <select>
  const lastSolverResults = {};    // tab -> result object
  let kpiUpdateScheduled = false;

  function syncLabelUnit(binding) {
    const { spec, currentUnitId, labelUnitEl } = binding;
    if (!labelUnitEl) return;
    const bypassed = typeof spec.bypassWhen === 'function' && spec.bypassWhen();
    const unitTxt = bypassed ? '%' : getUnitLabel(spec.quantity, currentUnitId);
    const hasAuto = Boolean(labelUnitEl.querySelector('.auto-tag'));
    if (hasAuto) {
      labelUnitEl.innerHTML = `<span class="auto-tag">AUTO</span> ${unitTxt}`;
    } else {
      labelUnitEl.textContent = unitTxt;
    }
  }

  function updateBypassState(binding) {
    if (typeof binding.spec.bypassWhen !== 'function') return;
    const bypassed = binding.spec.bypassWhen();
    binding.sel.style.display = bypassed ? 'none' : '';
    syncLabelUnit(binding);
  }

  function installInputBridge(spec) {
    const el = document.getElementById(spec.id);
    if (!el || fieldBindings.has(spec.id)) return;

    const meta = UNIT_QUANTITIES[spec.quantity];
    if (!meta) return;

    const initialDisplayUnit = globalUnits[spec.quantity] || spec.internalUnitId;
    const initialRaw = parseFloat(getRawVal(el));

    // Create wrapper & inline unit dropdown (NO id so App's syncAllCustomSelects never hijacks it)
    const wrap = document.createElement('div');
    wrap.className = 'cp-unit-wrap';
    wrap.setAttribute('data-cp-unit-wrap', spec.id);

    const sel = document.createElement('select');
    sel.className = 'cp-unit-sel';
    sel.setAttribute('data-unit-for', spec.id);
    sel.setAttribute('aria-label', `${spec.id} unit`);

    meta.options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      if (opt.id === initialDisplayUnit) o.selected = true;
      sel.appendChild(o);
    });

    const parent = el.parentNode;
    if (parent) {
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
      wrap.appendChild(sel);
    }

    // Allow arbitrary decimals when converted across units
    if (el.type === 'number') {
      el.setAttribute('step', 'any');
    }

    // Locate sibling <label><span class="unit">...</span></label>
    const fieldBox = wrap.closest('.field');
    const labelUnitEl = fieldBox ? fieldBox.querySelector('label .unit') : null;

    const binding = {
      spec,
      el,
      sel,
      currentUnitId: initialDisplayUnit,
      labelUnitEl,
    };

    // Convert initial HTML canonical value into initialDisplayUnit
    const bypassedInit = typeof spec.bypassWhen === 'function' && spec.bypassWhen();
    if (!bypassedInit && Number.isFinite(initialRaw) && initialDisplayUnit !== spec.internalUnitId) {
      const converted = convertUnit(spec.quantity, initialRaw, spec.internalUnitId, initialDisplayUnit);
      const opt = getUnitOption(spec.quantity, initialDisplayUnit);
      setRawVal(el, formatInputNumber(converted, opt ? opt.decimals : 2));
    }

    // Install transparent value getter/setter so app.js always sees internal units
    Object.defineProperty(el, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        const raw = getRawVal(el);
        if (raw === '' || raw === null || raw === undefined) return raw;
        if (typeof spec.bypassWhen === 'function' && spec.bypassWhen()) return raw;
        const num = parseFloat(raw);
        if (!Number.isFinite(num)) return raw;
        if (binding.currentUnitId === spec.internalUnitId) return raw;
        const internal = convertUnit(spec.quantity, num, binding.currentUnitId, spec.internalUnitId);
        return String(internal);
      },
      set(val) {
        if (val === '' || val === null || val === undefined) {
          setRawVal(el, val);
          return;
        }
        if (typeof spec.bypassWhen === 'function' && spec.bypassWhen()) {
          setRawVal(el, val);
          return;
        }
        const num = parseFloat(val);
        if (!Number.isFinite(num)) {
          setRawVal(el, val);
          return;
        }
        if (binding.currentUnitId === spec.internalUnitId) {
          setRawVal(el, val);
          return;
        }
        const displayVal = convertUnit(spec.quantity, num, spec.internalUnitId, binding.currentUnitId);
        const opt = getUnitOption(spec.quantity, binding.currentUnitId);
        setRawVal(el, formatInputNumber(displayVal, opt ? opt.decimals : 2));
      },
    });

    // Individual dropdown change: convert ONLY this input immediately in-place
    sel.addEventListener('change', () => {
      const newUnitId = sel.value;
      const oldUnitId = binding.currentUnitId;
      if (newUnitId === oldUnitId) return;
      const bypassed = typeof spec.bypassWhen === 'function' && spec.bypassWhen();
      if (!bypassed) {
        const curRaw = parseFloat(getRawVal(el));
        if (Number.isFinite(curRaw)) {
          const converted = convertUnit(spec.quantity, curRaw, oldUnitId, newUnitId);
          const opt = getUnitOption(spec.quantity, newUnitId);
          setRawVal(el, formatInputNumber(converted, opt ? opt.decimals : 2));
        }
      }
      binding.currentUnitId = newUnitId;
      syncLabelUnit(binding);
    });

    fieldBindings.set(spec.id, binding);
    updateBypassState(binding);
    syncLabelUnit(binding);
  }

  function applyGlobalUnits(nextUnits, opts) {
    const sanitized = sanitizeUnits(nextUnits);
    const persist = Boolean(opts && opts.persist);
    globalUnits = sanitized;

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(globalUnits));
      } catch (_) {}
    }

    // Update all mapped input dropdowns and convert visible numbers in-place
    fieldBindings.forEach(binding => {
      const targetUnitId = globalUnits[binding.spec.quantity];
      if (!targetUnitId) return;
      const oldUnitId = binding.currentUnitId;
      const bypassed = typeof binding.spec.bypassWhen === 'function' && binding.spec.bypassWhen();
      if (!bypassed && targetUnitId !== oldUnitId) {
        const curRaw = parseFloat(getRawVal(binding.el));
        if (Number.isFinite(curRaw)) {
          const converted = convertUnit(binding.spec.quantity, curRaw, oldUnitId, targetUnitId);
          const opt = getUnitOption(binding.spec.quantity, targetUnitId);
          setRawVal(binding.el, formatInputNumber(converted, opt ? opt.decimals : 2));
        }
      }
      binding.currentUnitId = targetUnitId;
      if (binding.sel.value !== targetUnitId) {
        binding.sel.value = targetUnitId;
      }
      syncLabelUnit(binding);
    });

    // Update Display Units bar controls & preset pills
    syncDisplayUnitBar();

    // Refresh converted KPI readouts
    scheduleKpiUpdate();
  }

  function syncDisplayUnitBar() {
    BAR_QUANTITIES.forEach(q => {
      const sel = barSelects.get(q);
      if (sel && globalUnits[q] && sel.value !== globalUnits[q]) {
        sel.value = globalUnits[q];
      }
    });
    const activePreset = detectPresetId(globalUnits);
    document.querySelectorAll('.cp-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === activePreset);
    });
  }

  function buildDisplayUnitBar() {
    const workspace = document.querySelector('main.workspace');
    if (!workspace || document.getElementById('cp_display_unit_bar')) return;

    const bar = document.createElement('div');
    bar.id = 'cp_display_unit_bar';
    bar.className = 'cp-unit-bar';

    const left = document.createElement('div');
    left.className = 'cp-unit-bar-head';

    const title = document.createElement('span');
    title.className = 'cp-unit-bar-title';
    title.textContent = '표시 단위 (Display Units)';
    left.appendChild(title);

    const presetWrap = document.createElement('div');
    presetWrap.className = 'cp-preset-group';
    UNIT_PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cp-preset-btn';
      btn.setAttribute('data-preset', p.id);
      btn.textContent = p.shortName;
      btn.title = `${p.shortName} 단위 프리셋 적용`;
      btn.addEventListener('click', () => {
        applyGlobalUnits(p.units, { persist: true });
      });
      presetWrap.appendChild(btn);
    });
    left.appendChild(presetWrap);
    bar.appendChild(left);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'cp-unit-bar-items';

    BAR_QUANTITIES.forEach(q => {
      const meta = UNIT_QUANTITIES[q];
      if (!meta) return;

      const chip = document.createElement('label');
      chip.className = 'cp-bar-chip';

      const lbl = document.createElement('span');
      lbl.className = 'cp-bar-lbl';
      lbl.textContent = meta.labelKo;

      // NO id attribute so App's syncAllCustomSelects never replaces it
      const sel = document.createElement('select');
      sel.className = 'cp-bar-sel';
      sel.setAttribute('data-bar-qty', q);

      meta.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        if (opt.id === globalUnits[q]) o.selected = true;
        sel.appendChild(o);
      });

      sel.addEventListener('change', () => {
        const next = Object.assign({}, globalUnits, { [q]: sel.value });
        applyGlobalUnits(next, { persist: true });
      });

      chip.appendChild(lbl);
      chip.appendChild(sel);
      itemsWrap.appendChild(chip);
      barSelects.set(q, sel);
    });

    bar.appendChild(itemsWrap);
    workspace.insertBefore(bar, workspace.firstChild);
    syncDisplayUnitBar();
  }

  // =========================================================================
  // KPI & TELEMETRY OUTPUT CONVERSION
  // =========================================================================
  function setKpiConvLine(boxEl, text) {
    if (!boxEl) return;
    let convEl = boxEl.querySelector('.cp-kpi-conv');
    if (!text) {
      if (convEl) convEl.remove();
      return;
    }
    if (!convEl) {
      convEl = document.createElement('div');
      convEl.className = 'cp-kpi-conv';
      boxEl.appendChild(convEl);
    }
    convEl.textContent = text;
  }

  function fmtDeltaT(dT_C) {
    const tUnit = globalUnits.temp || 'C';
    if (tUnit === 'F') return `${(dT_C * 1.8).toFixed(1)} °F`;
    if (tUnit === 'K') return `${dT_C.toFixed(1)} K`;
    return `${dT_C.toFixed(1)} °C`;
  }

  function updateHxOutputs() {
    const r = lastSolverResults.hx;
    if (!r) return;
    const boxes = document.querySelectorAll('#hx_kpis .kpi-box');
    const qUnit = globalUnits.heatDuty || 'Mcalh';
    const aUnit = globalUnits.area || 'm2';
    const uUnit = globalUnits.htc || 'kcalm2hC';
    const lUnit = globalUnits.length || 'm';
    const dpUnit = globalUnits.deltaP || 'kgcm2';
    const vUnit = globalUnits.velocity || 'ms';

    // Update energy balance badge with selected heatDuty unit
    const qBadge = document.getElementById('hx_q_badge');
    if (qBadge && Number.isFinite(r.Q_kW)) {
      const qDisp = formatDisplayNumber('heatDuty', r.Q_kW, 'kW', qUnit);
      const qLbl = getUnitLabel('heatDuty', qUnit);
      const qKwStr = r.Q_kW.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      qBadge.textContent = qUnit === 'kW'
        ? `${qKwStr} kW | ${formatDisplayNumber('heatDuty', r.Q_kW, 'kW', 'Mcalh')} Mcal/h`
        : `${qDisp} ${qLbl} | ${qKwStr} kW`;
    }

    if (boxes[0]) {
      const qStr = `${formatDisplayNumber('heatDuty', r.Q_kW, 'kW', qUnit)} ${getUnitLabel('heatDuty', qUnit)}`;
      setKpiConvLine(boxes[0], `표시단위: Q = ${qStr} · CMTD = ${fmtDeltaT(r.CMTD)}`);
    }
    if (boxes[1]) {
      const aProv = formatDisplayNumber('area', r.A_prov_m2, 'm2', aUnit);
      const aReq = formatDisplayNumber('area', r.A_req_m2, 'm2', aUnit);
      setKpiConvLine(boxes[1], `표시단위: A_prov = ${aProv} / A_req = ${aReq} ${getUnitLabel('area', aUnit)}`);
    }
    if (boxes[2]) {
      const uVal = formatDisplayNumber('htc', r.U_calc, 'Wm2K', uUnit);
      setKpiConvLine(boxes[2], `표시단위: U_calc = ${uVal} ${getUnitLabel('htc', uUnit)}`);
    }
    if (boxes[3]) {
      const isPHE = r.hxType === 'plate_phe';
      if (isPHE && Number.isFinite(r.L_pack_mm)) {
        const lPack = formatDisplayNumber('length', r.L_pack_mm, 'mm', lUnit);
        setKpiConvLine(boxes[3], `표시단위: 판팩 L = ${lPack} ${getUnitLabel('length', lUnit)}`);
      } else if (Number.isFinite(r.D_shell_mm)) {
        const dShell = formatDisplayNumber('length', r.D_shell_mm, 'mm', lUnit);
        const lTube = formatDisplayNumber('length', r.L_m, 'm', lUnit);
        setKpiConvLine(boxes[3], `표시단위: Ø${dShell} × L ${lTube} ${getUnitLabel('length', lUnit)}`);
      }
    }

    // Hydraulic ΔP gauges conversion
    const gaugeCards = document.querySelectorAll('#hx_dp_gauges .dp-gauge-card');
    if (gaugeCards[0] && Number.isFinite(r.dPs_bar)) {
      const dpS = formatDisplayNumber('deltaP', r.dPs_bar, 'bar', dpUnit);
      const vS = formatDisplayNumber('velocity', r.vs, 'ms', vUnit);
      setKpiConvLine(gaugeCards[0], `표시단위: ΔP = ${dpS} ${getUnitLabel('deltaP', dpUnit)} · v = ${vS} ${getUnitLabel('velocity', vUnit)}`);
    }
    if (gaugeCards[1] && Number.isFinite(r.dPt_bar)) {
      const dpT = formatDisplayNumber('deltaP', r.dPt_bar, 'bar', dpUnit);
      const vT = formatDisplayNumber('velocity', r.vt, 'ms', vUnit);
      setKpiConvLine(gaugeCards[1], `표시단위: ΔP = ${dpT} ${getUnitLabel('deltaP', dpUnit)} · v = ${vT} ${getUnitLabel('velocity', vUnit)}`);
    }
  }

  function updatePumpOutputs() {
    const r = lastSolverResults.pump;
    if (!r) return;
    const boxes = document.querySelectorAll('#pump_kpis .kpi-box');
    const lUnit = globalUnits.length || 'm';
    const pUnit = globalUnits.power || 'kW';
    const qUnit = globalUnits.volFlow || 'm3h';

    if (boxes[0]) {
      const tdh = formatDisplayNumber('length', r.H_total_m, 'm', lUnit, 2);
      setKpiConvLine(boxes[0], `표시단위: TDH = ${tdh} ${getUnitLabel('length', lUnit)}`);
    }
    if (boxes[1]) {
      const pMot = formatDisplayNumber('power', r.P_motor_std_kW, 'kW', pUnit);
      const pSh = formatDisplayNumber('power', r.P_shaft_kW, 'kW', pUnit, 2);
      setKpiConvLine(boxes[1], `표시단위: Motor ${pMot} / Shaft ${pSh} ${getUnitLabel('power', pUnit)}`);
    }
    if (boxes[2]) {
      const nA = formatDisplayNumber('length', r.NPSHa_m, 'm', lUnit, 2);
      const nR = formatDisplayNumber('length', r.NPSHr_m, 'm', lUnit, 2);
      setKpiConvLine(boxes[2], `표시단위: NPSHa ${nA} / NPSHr ${nR} ${getUnitLabel('length', lUnit)}`);
    }
    if (boxes[3]) {
      const qM = formatDisplayNumber('volFlow', r.Q_mcsf_m3h, 'm3h', qUnit);
      setKpiConvLine(boxes[3], `표시단위: MCSF = ${qM} ${getUnitLabel('volFlow', qUnit)}`);
    }
  }

  function updateColumnOutputs() {
    const r = lastSolverResults.column;
    if (!r) return;
    const boxes = document.querySelectorAll('#col_kpis .kpi-box');
    const lUnit = globalUnits.length || 'm';
    const dpUnit = globalUnits.deltaP || 'kgcm2';
    const qUnit = globalUnits.heatDuty || 'Mcalh';
    const tUnit = globalUnits.temp || 'C';
    const vUnit = globalUnits.velocity || 'ms';
    const isAbs = r.colMode === 'absorption';
    const isPacked = isAbs || r.internals === 'packed';

    if (boxes[0] && isPacked && Number.isFinite(r.H_pack_total_m)) {
      const hPack = formatDisplayNumber('length', r.H_pack_total_m, 'm', lUnit, 2);
      setKpiConvLine(boxes[0], `표시단위: 충전 높이 Z = ${hPack} ${getUnitLabel('length', lUnit)}`);
    } else if (boxes[0] && Number.isFinite(r.T_top_C) && Number.isFinite(r.T_bot_C)) {
      const tTop = formatDisplayNumber('temp', r.T_top_C, 'C', tUnit);
      const tBot = formatDisplayNumber('temp', r.T_bot_C, 'C', tUnit);
      setKpiConvLine(boxes[0], `표시단위: T_top ${tTop} / T_bot ${tBot} ${getUnitLabel('temp', tUnit)}`);
    }

    if (boxes[1]) {
      const dCol = formatDisplayNumber('length', r.D_col_m, 'm', lUnit, 2);
      const hTan = formatDisplayNumber('length', r.H_tangent_m, 'm', lUnit, 2);
      const dpTot = formatDisplayNumber('deltaP', (r.dP_total_mbar || 0) / 1000, 'bar', dpUnit);
      setKpiConvLine(boxes[1], `표시단위: Ø${dCol} × ${hTan} ${getUnitLabel('length', lUnit)} · ΔP ${dpTot} ${getUnitLabel('deltaP', dpUnit)}`);
    }

    if (boxes[2] && isAbs && Number.isFinite(r.u_op)) {
      const uOp = formatDisplayNumber('velocity', r.u_op, 'ms', vUnit);
      setKpiConvLine(boxes[2], `표시단위: 가스유속 u_op = ${uOp} ${getUnitLabel('velocity', vUnit)}`);
    }

    if (boxes[3]) {
      if (isAbs) {
        const qC = formatDisplayNumber('heatDuty', r.Qc_kW, 'kW', qUnit);
        setKpiConvLine(boxes[3], `표시단위: 열부하 = ${qC} ${getUnitLabel('heatDuty', qUnit)}`);
      } else {
        const qC = formatDisplayNumber('heatDuty', r.Qc_kW, 'kW', qUnit);
        const qR = formatDisplayNumber('heatDuty', r.Qr_kW, 'kW', qUnit);
        setKpiConvLine(boxes[3], `표시단위: Qc ${qC} / Qr ${qR} ${getUnitLabel('heatDuty', qUnit)}`);
      }
    }
  }

  function updatePipingOutputs() {
    const r = lastSolverResults.piping;
    if (!r || !r.selected) return;
    const sel = r.selected;
    const boxes = document.querySelectorAll('#pipe_kpis .kpi-box');
    const lUnit = globalUnits.length || 'm';
    const vUnit = globalUnits.velocity || 'ms';
    const dpUnit = globalUnits.deltaP || 'kgcm2';
    const qUnit = globalUnits.volFlow || 'm3h';

    if (boxes[0]) {
      const idStr = formatDisplayNumber('length', sel.id_mm, 'mm', lUnit);
      const odStr = formatDisplayNumber('length', sel.od_mm, 'mm', lUnit);
      setKpiConvLine(boxes[0], `표시단위: ID ${idStr} / OD ${odStr} ${getUnitLabel('length', lUnit)}`);
    }
    if (boxes[1]) {
      const vStr = formatDisplayNumber('velocity', sel.v, 'ms', vUnit);
      const veStr = formatDisplayNumber('velocity', sel.v_erode_ms, 'ms', vUnit);
      setKpiConvLine(boxes[1], `표시단위: v = ${vStr} (한계 ${veStr}) ${getUnitLabel('velocity', vUnit)}`);
    }
    if (boxes[2]) {
      const dpTot = formatDisplayNumber('deltaP', sel.dP_total_bar, 'bar', dpUnit);
      const dp100 = formatDisplayNumber('deltaP', sel.dP_100m_bar, 'bar', dpUnit);
      setKpiConvLine(boxes[2], `표시단위: ΔP = ${dpTot} (100m당 ${dp100}) ${getUnitLabel('deltaP', dpUnit)}`);
    }
    if (boxes[3] && Number.isFinite(r.Q_m3h)) {
      const qStr = formatDisplayNumber('volFlow', r.Q_m3h, 'm3h', qUnit);
      setKpiConvLine(boxes[3], `표시단위: Q = ${qStr} ${getUnitLabel('volFlow', qUnit)}`);
    }
  }

  function updateVesselOutputs() {
    const r = lastSolverResults.vessel;
    if (!r) return;
    const boxes = document.querySelectorAll('#ves_kpis .kpi-box');
    const lUnit = globalUnits.length || 'm';
    const volUnit = globalUnits.volume || 'm3';
    const pUnit = globalUnits.pressG || 'kgcm2g';
    const vUnit = globalUnits.velocity || 'ms';

    if (boxes[0]) {
      const dStr = formatDisplayNumber('length', r.D_m, 'm', lUnit, 2);
      const lStr = formatDisplayNumber('length', r.L_m, 'm', lUnit, 2);
      const vStr = formatDisplayNumber('volume', r.V_total_m3, 'm3', volUnit);
      setKpiConvLine(boxes[0], `표시단위: Ø${dStr} × ${lStr} ${getUnitLabel('length', lUnit)} · V = ${vStr} ${getUnitLabel('volume', volUnit)}`);
    }
    if (boxes[1]) {
      const tStr = formatDisplayNumber('length', r.t_nom_mm, 'mm', lUnit);
      const mawpStr = formatDisplayNumber('pressG', r.MAWP_barG, 'barG', pUnit);
      setKpiConvLine(boxes[1], `표시단위: t = ${tStr} ${getUnitLabel('length', lUnit)} · MAWP ${mawpStr} ${getUnitLabel('pressG', pUnit)}`);
    }
    if (boxes[2]) {
      const vgStr = formatDisplayNumber('velocity', r.Vg_des_ms, 'ms', vUnit);
      const vtStr = formatDisplayNumber('velocity', r.Vt_max_ms, 'ms', vUnit);
      setKpiConvLine(boxes[2], `표시단위: Vg ${vgStr} / Vt,max ${vtStr} ${getUnitLabel('velocity', vUnit)}`);
    }
    if (boxes[3] && Number.isFinite(r.W_empty_kg)) {
      if (globalUnits.massFlow === 'lbh') {
        const wE = (r.W_empty_kg * 2.20462262).toLocaleString('en-US', { maximumFractionDigits: 0 });
        const wO = (r.W_oper_kg * 2.20462262).toLocaleString('en-US', { maximumFractionDigits: 0 });
        setKpiConvLine(boxes[3], `표시단위: Empty ${wE} / Oper ${wO} lb`);
      } else {
        setKpiConvLine(boxes[3], `표시단위: Empty ${Math.round(r.W_empty_kg).toLocaleString()} / Oper ${Math.round(r.W_oper_kg).toLocaleString()} kg`);
      }
    }
  }

  function updatePsvOutputs() {
    const r = lastSolverResults.psv;
    if (!r) return;
    const boxes = document.querySelectorAll('#psv_kpis .kpi-box');
    const mUnit = globalUnits.massFlow || 'kgh';
    const pUnit = globalUnits.pressG || 'kgcm2g';
    const qUnit = globalUnits.heatDuty || 'Mcalh';
    const aUnit = globalUnits.area || 'm2';

    if (boxes[1] && Number.isFinite(r.A_req_mm2)) {
      if (aUnit === 'ft2') {
        setKpiConvLine(boxes[1], `표시단위: A_req = ${r.A_req_in2.toFixed(3)} in² (${(r.A_req_mm2 / 1e6 * 10.7639104).toFixed(4)} ft²)`);
      } else {
        setKpiConvLine(boxes[1], `표시단위: A_req = ${r.A_req_mm2.toFixed(1)} mm² (${(r.A_req_mm2 / 100).toFixed(2)} cm²)`);
      }
    }
    if (boxes[2]) {
      const wReq = formatDisplayNumber('massFlow', r.W_kgh, 'kgh', mUnit);
      const wRat = formatDisplayNumber('massFlow', r.W_rated_kgh, 'kgh', mUnit);
      const qFireTxt = r.Q_fire_kW > 0
        ? ` · Q_fire ${formatDisplayNumber('heatDuty', r.Q_fire_kW, 'kW', qUnit)} ${getUnitLabel('heatDuty', qUnit)}`
        : '';
      setKpiConvLine(boxes[2], `표시단위: W ${wReq} / Rated ${wRat} ${getUnitLabel('massFlow', mUnit)}${qFireTxt}`);
    }
    if (boxes[3] && Number.isFinite(r.P1_barA)) {
      const p1 = formatDisplayNumber('pressG', r.P1_barA, 'barA', pUnit);
      setKpiConvLine(boxes[3], `표시단위: P1 = ${p1} ${getUnitLabel('pressG', pUnit)}`);
    }
  }

  function updateAllKpiOutputs() {
    kpiUpdateScheduled = false;
    updateHxOutputs();
    updatePumpOutputs();
    updateColumnOutputs();
    updatePipingOutputs();
    updateVesselOutputs();
    updatePsvOutputs();

    // Keep dynamic label tags (like HX AUTO tags) & bypass states synced
    fieldBindings.forEach(binding => {
      updateBypassState(binding);
      syncLabelUnit(binding);
    });
  }

  function scheduleKpiUpdate() {
    if (kpiUpdateScheduled) return;
    kpiUpdateScheduled = true;
    Promise.resolve().then(updateAllKpiOutputs);
  }

  // Wrap ChemEngSolvers.solve* to capture every solver run (including internal closure calls in app.js)
  function wrapSolvers() {
    const solvers = window.ChemEngSolvers;
    if (!solvers) return;

    const map = [
      ['solvePump', 'pump'],
      ['solveHX', 'hx'],
      ['solveColumn', 'column'],
      ['solvePiping', 'piping'],
      ['solveVessel', 'vessel'],
      ['solvePSV', 'psv'],
    ];

    map.forEach(([fnName, tabKey]) => {
      const orig = solvers[fnName];
      if (typeof orig !== 'function' || orig.__cpUnitWrapped) return;
      const wrapped = function () {
        const res = orig.apply(this, arguments);
        lastSolverResults[tabKey] = res;
        scheduleKpiUpdate();
        return res;
      };
      wrapped.__cpUnitWrapped = true;
      solvers[fnName] = wrapped;
    });
  }

  // Wrap App.setHXDof so AUTO label unit text stays synced
  function wrapAppHooks() {
    if (!window.App) return;
    if (typeof window.App.setHXDof === 'function' && !window.App.setHXDof.__cpUnitWrapped) {
      const origDof = window.App.setHXDof;
      const wrappedDof = function () {
        const res = origDof.apply(this, arguments);
        scheduleKpiUpdate();
        return res;
      };
      wrappedDof.__cpUnitWrapped = true;
      window.App.setHXDof = wrappedDof;
    }
  }

  // Listen to pipe_flow_mode change to toggle pipe_target_dp bypass (bar vs %)
  function watchPipeFlowMode() {
    const fm = document.getElementById('pipe_flow_mode');
    if (!fm) return;
    fm.addEventListener('change', () => {
      const binding = fieldBindings.get('pipe_target_dp');
      if (binding) updateBypassState(binding);
    });
  }

  // Listen to storage events (cross-tab) and parent postMessage ('CHEMENG_UNITS_SYNC')
  function installSyncListeners() {
    window.addEventListener('storage', e => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          applyGlobalUnits(JSON.parse(e.newValue), { persist: false });
        } catch (_) {}
      }
    });

    window.addEventListener('message', e => {
      const d = e && e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'CHEMENG_UNITS_SYNC' && d.units && typeof d.units === 'object') {
        applyGlobalUnits(d.units, { persist: false });
      }
    });
  }

  // Bootstrap synchronously BEFORE App's DOMContentLoaded init() fires
  function bootstrap() {
    INPUT_SPECS.forEach(installInputBridge);
    buildDisplayUnitBar();
    wrapSolvers();
    wrapAppHooks();
    watchPipeFlowMode();
    installSyncListeners();
  }

  bootstrap();

  // Expose debugging / inspection helper
  window.ChemProUnitBridge = {
    getUnits: () => Object.assign({}, globalUnits),
    applyGlobalUnits: units => applyGlobalUnits(units, { persist: false }),
    getMappedInputIds: () => INPUT_SPECS.map(s => s.id),
    refreshOutputs: updateAllKpiOutputs,
  };
})();

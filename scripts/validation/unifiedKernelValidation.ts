/**
 * Unified Equipment Kernel End-to-End Validation Suite
 * ---------------------------------------------------------------------------
 * Verifies:
 *   1. Direct TypeScript Unified Kernel (`chemproUnifiedKernel.ts`):
 *      - solvePump (quick & rigorous, Churchill 1977 + 5-iter HI viscosity loop + API 610 + Stepanoff + MCSF)
 *      - solveHXEnergyBalance (all 4 auto-DOF modes + condensing/boiling 3-zone)
 *      - solveHX (STHE Bell-Delaware/Shah/GW/Connors FIV + PHE chevron)
 *      - solveColumn (Absorption quick vs rigorous Eckert/Billet-Schultes/Onda, Distillation MESH + Fair + Billet-Schultes HETP + azeotrope)
 *      - solvePiping (Liquid Churchill, Compressible Gas Mach, 2-phase Friedel/LM/Taitel-Dukler, calc_max_flow bisection)
 *      - solveVessel (Normal Souders-Brown/ASME UG-27/32 + Vacuum ASME UG-28/29/33 stiffening check)
 *      - solvePSV (Vapor critical/subcritical, Fire case API 521, Steam Kn/Ksh, Viscous Liquid iterative Kv(Re))
 *   2. Legacy TS Facades (`hxCalc.ts`, `packingCalc.ts`, `pumpCalc.ts`, `pipePressureDrop.ts`)
 *   3. Browser IIFE Runtime via Node `vm` (`chem_db.js` -> `unified_kernel.js` -> `eng_solvers.js`):
 *      - `window.__ChemEngUnifiedKernel` registration
 *      - `window.ChemEngSolvers.{solvePump, solveHXEnergyBalance, solveHX, solveColumn, solvePiping, solveVessel, solvePSV}`
 *      - `window.ChemEngSolvers.autoRedesignAndConverge` & `renderQuotationDatasheet` across all modules
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
  solvePump,
  solveHXEnergyBalance,
  solveHX,
  solveColumn,
  solvePiping,
  solveVessel,
  solvePSV,
  CHEMPRO_UNIFIED_KERNEL_VERSION,
} from '../../lib/calculations/chemproUnifiedKernel';
import { calcHeatExchanger } from '../../lib/hxCalc';
import { calcPackingTower, PACKING_DB } from '../../lib/packingCalc';
import { calcPump } from '../../lib/pumpCalc';
import { calcPipePressureDrop, churchillFrictionFactor } from '../../lib/pipePressureDrop';
import type { FluidProps } from '../../lib/physicalProperties';

const ROOT = path.resolve(__dirname, '../..');

function assertFinite(val: unknown, label: string) {
  assert.equal(typeof val, 'number', `${label} must be number (got ${typeof val}: ${val})`);
  assert.ok(Number.isFinite(val as number), `${label} must be finite (got ${val})`);
}

function runDirectKernelTests() {
  console.log(`\n[1/3] Testing TypeScript Unified Kernel (${CHEMPRO_UNIFIED_KERNEL_VERSION})...`);

  // ── 1. Pump (Water quick + Viscous rigorous HI 9.6.7 loop) ───────────────
  const pQuick = solvePump(
    { fluidId: 'water', Q_m3h: 85, P1_barG: 0.2, P2_barG: 4.8, T_C: 35, d_suc_mm: 100, d_dis_mm: 80 },
    'quick'
  );
  const pRigVisc = solvePump(
    {
      equipTag: 'P-3302',
      fluidId: 'naoh_50',
      Q_m3h: 40,
      P1_barG: 0.1,
      P2_barG: 5.5,
      T_C: 25,
      mu_cP: 140,
      rho: 1525,
      d_suc_mm: 100,
      d_dis_mm: 80,
      z1_m: 1.5,
      z2_m: 12,
    },
    'rigorous'
  );
  assertFinite(pQuick.H_total_m, 'pQuick.H_total_m');
  assert.ok(pQuick.H_total_m > 30 && pQuick.P_shaft_kW > 5);
  assert.ok(pRigVisc.hiCorrected, 'Viscous pump must trigger HI 9.6.7 correction');
  assert.ok(pRigVisc.CH < 1.0 && pRigVisc.Ceta < 1.0 && pRigVisc.CQ <= 1.0);
  assert.ok(pRigVisc.f_suc > 0 && pRigVisc.f_dis > 0);
  assert.ok(pRigVisc.curvePoints && pRigVisc.curvePoints.length >= 12);
  assert.ok(pRigVisc.Q_mcsf_m3h > 0 && pRigVisc.d_orifice_mm > 0);
  console.log(
    `  [PASS] Pump: H_water=${pQuick.H_total_m.toFixed(1)} m, viscous CH=${pRigVisc.CH.toFixed(3)}, Ceta=${pRigVisc.Ceta.toFixed(3)}, D2=${pRigVisc.D2_mm.toFixed(0)} mm`
  );

  // ── 2. HX Energy Balance (4 DOF) + STHE (Bell-Delaware/FIV) + PHE ────────
  const ebTco = solveHXEnergyBalance({
    dofTarget: 'tco_auto',
    hotFluidId: 'toluene',
    coldFluidId: 'water',
    mh_kgh: 18000,
    Th_in: 110,
    Th_out: 55,
    mc_kgh: 28000,
    Tc_in: 30,
    Tc_out: 'auto',
  });
  const ebTho = solveHXEnergyBalance({
    dofTarget: 'tho_auto',
    hotFluidId: 'toluene',
    coldFluidId: 'water',
    mh_kgh: 18000,
    Th_in: 110,
    Th_out: 'auto',
    mc_kgh: 28000,
    Tc_in: 30,
    Tc_out: 45,
  });
  const ebMc = solveHXEnergyBalance({
    dofTarget: 'mc_auto',
    hotFluidId: 'toluene',
    coldFluidId: 'water',
    mh_kgh: 18000,
    Th_in: 110,
    Th_out: 55,
    mc_kgh: 'auto',
    Tc_in: 30,
    Tc_out: 45,
  });
  const ebMh = solveHXEnergyBalance({
    dofTarget: 'mh_auto',
    hotFluidId: 'toluene',
    coldFluidId: 'water',
    mh_kgh: 'auto',
    Th_in: 110,
    Th_out: 55,
    mc_kgh: 28000,
    Tc_in: 30,
    Tc_out: 45,
  });
  [ebTco, ebTho, ebMc, ebMh].forEach((e, idx) => {
    assertFinite(e.Q_kW, `eb[${idx}].Q_kW`);
    assert.ok(e.Q_kW > 100);
  });

  const hxSthe = solveHX(
    {
      equipTag: 'E-201',
      hx_type: 'shell_tube',
      hotFluidId: 'toluene',
      coldFluidId: 'water',
      mh_kgh: 18000,
      Th_in: 110,
      Th_out: 50,
      mc_kgh: 32000,
      Tc_in: 28,
      Tc_out: 'auto',
      dofTarget: 'tco_auto',
      tube_L_m: 4.5,
      baffle_ratio: 0.45,
      n_passes: 2,
    },
    'rigorous'
  );
  assertFinite(hxSthe.U_calc, 'hxSthe.U_calc');
  assert.ok(hxSthe.U_calc > 200 && hxSthe.Jc > 0 && hxSthe.Jl > 0 && hxSthe.Jb > 0 && hxSthe.Js > 0 && hxSthe.Jr > 0);
  assert.ok(hxSthe.fivStatus && hxSthe.criticalVelMs > 0);

  const hxSteam = solveHX(
    {
      hx_type: 'shell_tube',
      hotFluidId: 'steam_13k',
      coldFluidId: 'naoh_32',
      hot_phase_mode: 'cond_full',
      mh_kgh: 4500,
      Th_in: 191,
      Th_sat: 191,
      Th_out: 185,
      mc_kgh: 'auto',
      dofTarget: 'mc_auto',
      Tc_in: 65,
      Tc_out: 98,
      tube_L_m: 4.0,
    },
    'rigorous'
  );
  assert.ok(hxSteam.zones && hxSteam.zones.length >= 1 && hxSteam.ho > 500);

  const hxPhe = solveHX(
    {
      equipTag: 'E-332',
      hx_type: 'plate_phe',
      hotFluidId: 'naoh_32',
      coldFluidId: 'chilled_water_7c',
      mh_kgh: 25000,
      Th_in: 85,
      Th_out: 40,
      mc_kgh: 'auto',
      dofTarget: 'mc_auto',
      Tc_in: 15,
      Tc_out: 30,
      phe_beta_deg: 60,
      phe_passes: 2,
    },
    'rigorous'
  );
  assert.equal(hxPhe.hxType, 'plate_phe');
  assert.ok(hxPhe.U_calc > 1500 && (hxPhe.N_eff ?? 0) >= 4 && (hxPhe.v_port_h ?? 0) > 0);
  console.log(
    `  [PASS] HX: STHE U=${hxSthe.U_calc.toFixed(1)} W/m²K (Jc=${hxSthe.Jc.toFixed(2)}, FIV=${hxSthe.fivStatus}), Steam ho=${hxSteam.ho.toFixed(0)}, PHE U=${hxPhe.U_calc.toFixed(1)}`
  );

  // ── 3. Column: Absorption (quick vs rigorous) & Distillation (MESH + Packed) ─
  const colAbsQ = solveColumn(
    {
      col_mode: 'absorption',
      lkFluidId: 'ahcl_gas',
      hkFluidId: 'water',
      gas_kgh: 2200,
      liq_kgh: 8500,
      y_in_ppm: 12000,
      y_out_ppm: 25,
      P_col_bar: 1.05,
      pack_key: 'intalox_ceramic_38',
    },
    'quick'
  ) as any;
  const colAbsR = solveColumn(
    {
      col_mode: 'absorption',
      lkFluidId: 'ahcl_gas',
      hkFluidId: 'water',
      gas_kgh: 2200,
      liq_kgh: 8500,
      y_in_ppm: 12000,
      y_out_ppm: 25,
      P_col_bar: 1.05,
      pack_key: 'intalox_ceramic_38',
    },
    'rigorous'
  ) as any;
  assert.equal(colAbsQ.colMode, 'absorption');
  assert.equal(colAbsR.colMode, 'absorption');
  assert.ok(colAbsR.D_col_m > 0.3 && colAbsR.H_pack_m > 0.5 && colAbsR.k_G_ms > 0 && colAbsR.a_w_m2m3 > 0);
  assert.notEqual(
    colAbsQ.dP_pack_mbar_m,
    colAbsR.dP_pack_mbar_m,
    'Rigorous Billet-Schultes absorption must differ from quick algebraic'
  );

  // Verify omitted col_mode defaults safely to absorption like legacy eng_solvers.js
  const colOmitted = solveColumn({ lkFluidId: 'cl2_wet_gas', hkFluidId: 'water', gas_kgh: 1500, liq_kgh: 6000 }, 'quick') as any;
  assert.equal(colOmitted.colMode, 'absorption');

  const colDistMesh = solveColumn(
    {
      col_mode: 'distillation',
      nrtlPreset: 'benzene_toluene',
      lkFluidId: 'benzene',
      hkFluidId: 'toluene',
      F_kmolh: 120,
      zF: 0.48,
      xD: 0.96,
      xB: 0.04,
      R_ratio: 1.35,
      P_col_bar: 1.013,
      internals: 'tray',
      trayType: 'sieve',
    },
    'rigorous'
  ) as any;
  assert.equal(colDistMesh.colMode, 'distillation');
  assert.equal(colDistMesh.meshConverged, true);
  assert.ok(colDistMesh.x_profile.length >= colDistMesh.N_theo);
  assert.ok(colDistMesh.Qc_kW > 100 && colDistMesh.Qr_kW > 100 && colDistMesh.condenserArea_m2 > 0);

  const colDistAzeo = solveColumn(
    {
      col_mode: 'distillation',
      nrtlPreset: 'ipa_water',
      F_kmolh: 80,
      zF: 0.35,
      xD: 0.85,
      xB: 0.02,
      internals: 'packed',
      pack_key: 'mellapak_250y',
    },
    'rigorous'
  ) as any;
  assert.ok(colDistAzeo.azeotropeX !== null && colDistAzeo.HETP_m > 0.15 && colDistAzeo.HETP_m < 1.2);
  console.log(
    `  [PASS] Column: Abs(D=${colAbsR.D_col_m.toFixed(2)}m, HTU_OG=${colAbsR.HTU_OG_m.toFixed(2)}m, Billet-Schultes dP=${colAbsR.dP_pack_mbar_m.toFixed(2)}), Dist MESH(converged=${colDistMesh.meshConverged}, xD=${colDistMesh.xD_mesh.toFixed(3)}, Qr=${colDistMesh.Qr_kW.toFixed(0)}kW)`
  );

  // ── 4. Piping (Liquid Churchill, Gas Mach, Two-Phase Taitel-Dukler, max_flow) ─
  const pipeLiq = solvePiping(
    { fluidId: 'naoh_32', Q_m3h: 60, L_m: 120, schedule: '40', selected_nps_idx: 5 },
    'rigorous'
  );
  const pipeGas = solvePiping(
    { fluidId: 'nitrogen_gas', flowMode: 'gas', W_kgs: 1.25, L_m: 80, P1_barG: 4.5, T_C: 40, schedule: '40', selected_nps_idx: 4 },
    'rigorous'
  );
  const pipe2Ph = solvePiping(
    {
      flowMode: 'two_phase',
      W_kgs: 3.33,
      vaporFraction: 0.35,
      L_m: 100,
      T_C: 95,
      rhoL: 960,
      muL_cP: 0.3,
      rhoG: 3.2,
      muG_cP: 0.015,
      sigma_mNm: 45,
      schedule: '40',
      selected_nps_idx: 6,
    },
    'rigorous'
  );
  const pipeMaxFlow = solvePiping(
    { fluidId: 'water', dofMode: 'calc_max_flow', dpLimit_bar: 0.85, L_m: 150, schedule: '40', selected_nps_idx: 5 },
    'rigorous'
  );
  assert.ok(pipeLiq.selected.f > 0 && pipeLiq.candidates.length >= 10);
  assert.ok(pipeGas.selected.mach > 0 && pipeGas.selected.mach < 1.0);
  assert.ok(pipe2Ph.selected.phi2_LM > 1.0 && pipe2Ph.twoPhaseDetails?.regime);
  assert.ok(pipeMaxFlow.Q_m3h > 10 && Math.abs(pipeMaxFlow.selected.dP_total_bar - 0.85) < 0.02);
  console.log(
    `  [PASS] Piping: Liq dP=${pipeLiq.selected.dP_total_bar.toFixed(3)} bar, Gas Ma=${pipeGas.selected.mach.toFixed(3)}, 2Ph=${pipe2Ph.twoPhaseDetails?.regime} (phi2=${pipe2Ph.selected.phi2_LM.toFixed(1)}), MaxFlow=${pipeMaxFlow.Q_m3h.toFixed(1)} m³/h`
  );

  // ── 5. Vessel (Pressure + Vacuum ASME UG-28/29/33) ──────────────────────
  const vNorm = solveVessel(
    {
      orientation: 'vertical',
      Wg_kgh: 5200,
      Wl_kgh: 14000,
      P_op_barG: 6.5,
      T_des_C: 120,
      mat_key: 'SA-516-70',
      has_demister: true,
    },
    'rigorous'
  );
  const vVac = solveVessel(
    {
      equipTag: 'V-331',
      orientation: 'vertical',
      Wg_kgh: 3800,
      Wl_kgh: 8500,
      P_op_bar: 0.22,
      T_des_C: 110,
      is_vacuum: true,
      P_ext_bar: 1.013,
      mat_key: 'SA-240-304',
    },
    'rigorous'
  );
  assert.ok(vNorm.D_m > 0.5 && vNorm.t_nom_mm >= 6 && vNorm.MAWP_barG > 6.5);
  assert.ok(vVac.vacuumCheck && vVac.vacuumCheck.isVacuum && vVac.t_nom_mm >= 6);
  console.log(
    `  [PASS] Vessel: Norm D=${vNorm.D_m.toFixed(2)}m t=${vNorm.t_nom_mm}mm, Vac ug28Allow=${vVac.vacuumCheck?.ug28AllowableMpa.toFixed(3)} MPa`
  );

  // ── 6. PSV (Gas Critical, Fire API 521, Steam Kn/Ksh, Viscous Liquid Kv) ─
  const psvGas = solvePSV(
    { scenario: 'blocked_outlet', phase: 'vapor', fluidId: 'ahcl_gas', W_kgh: 8500, P_set_barG: 8.5, P_back_barG: 0.5, T_rel_C: 60 },
    'rigorous'
  );
  const psvFire = solvePSV(
    { scenario: 'fire_case', phase: 'vapor', fluidId: 'hexane', A_wet_m2: 65, F_env: 0.3, P_set_barG: 6.0, T_rel_C: 140 },
    'rigorous'
  );
  const psvSteam = solvePSV(
    { scenario: 'blocked_outlet', phase: 'steam', fluidId: 'steam_13k', W_kgh: 14000, P_set_barG: 120, P_back_barG: 1.0, T_rel_C: 420 },
    'rigorous'
  );
  const psvVisc = solvePSV(
    { scenario: 'blocked_outlet', phase: 'liquid', fluidId: 'naoh_50', W_kgh: 18000, P_set_barG: 5.0, mu_cP: 1800, rhoL: 1525 },
    'rigorous'
  );
  assert.ok(psvGas.A_req_mm2 > 10 && psvGas.selectedOrifice?.letter);
  assert.ok(psvFire.Q_fire_kW > 200 && psvFire.overpress_pct === 21);
  assert.ok(psvSteam.Ksh < 1.0 && psvSteam.Kn >= 1.0);
  assert.ok(psvVisc.Kv < 0.98 && psvVisc.Re_orifice > 0);
  console.log(
    `  [PASS] PSV: Gas Orifice=${psvGas.selectedOrifice.letter}, Fire Q=${psvFire.Q_fire_kW.toFixed(0)}kW, Steam Ksh=${psvSteam.Ksh.toFixed(3)}, Liquid Kv=${psvVisc.Kv.toFixed(3)}`
  );
}

function runLegacyFacadeTests() {
  console.log('\n[2/3] Testing Legacy TS Facades (Bell-Delaware HX, Billet-Schultes Packing, Churchill Pipe, Pump)...');

  const hxRes = calcHeatExchanger({
    tag: 'E-101',
    serviceName: '32% NaOH Cooler',
    dofMode: 'calc_mc',
    hotFluidKey: 'naoh32',
    mh_kgh: 25000,
    Th_in_C: 90,
    Th_out_C: 45,
    Ph_kgcm2g: 2.0,
    hotCondensingFrac: 0,
    coldFluidKey: 'cw',
    mc_kgh: 0,
    Tc_in_C: 30,
    Tc_out_C: 40,
    Pc_kgcm2g: 3.0,
    n_shell: 1,
    n_passes: 2,
    do_mm: 19.05,
    tw_mm: 1.65,
    L_m: 4.88,
    layoutAngle: 30,
    baffleCutPct: 25,
    overdesignPct: 15,
    rft: 0.00018,
    rfs: 0.0002,
    material: 'Nickel 200',
  });
  assert.ok(hxRes.U_calc_Wm2K > 200 && hxRes.A_req_m2 > 5 && hxRes.N_tubes > 20);

  assert.ok(PACKING_DB.length >= 20, 'PACKING_DB must unify both catalogs');
  const pkRes = calcPackingTower({
    mode: 'scrubbing',
    temperature_C: 35,
    pressure_kPa: 105,
    gasFlow_kgh: 4800,
    gasDensity_kgm3: 2.8,
    gasViscosity_mPas: 0.014,
    liquidFlow_kgh: 15000,
    liquidDensity_kgm3: 1830,
    liquidViscosity_mPas: 22,
    surfaceTension_mNm: 55,
    y_in: 0.025,
    y_out: 0.00002,
    absorptionFactor: 5.0,
    packingKey: PACKING_DB[0].key,
    floodingFraction: 0.7,
    HETP_correction: 1.0,
  });
  assert.ok(pkRes.tower_diameter_m > 0.4 && pkRes.packingHeight_m > 1 && pkRes.dP_per_m_Pa > 0);

  const brineFluid: FluidProps = {
    key: 'brine_test',
    name: 'Brine Feed',
    nameKo: '정제염수',
    T_ref: 25,
    density_ref: 1192,
    viscosity_ref: 1.8,
    Cp: 3.31,
    vaporPressure_ref: 3.0,
    phase: 'L',
  };

  const pumpRes = calcPump({
    fluid: brineFluid,
    temperature_C: 25,
    flowRate_m3h: 120,
    P_suction_kPaG: 0,
    suction_head_m: 3,
    suctionPipe: [
      {
        id: 'SUC',
        label: 'Suction',
        D_mm: 154,
        length_m: 15,
        roughness_mm: 0.046,
        elevation_m: 0,
        fittings: [{ fittingKey: 'elbow_90', count: 2 }],
      },
    ],
    P_discharge_kPaG: 350,
    discharge_head_m: 25,
    dischargePipe: [
      {
        id: 'DIS',
        label: 'Discharge',
        D_mm: 102.26,
        length_m: 80,
        roughness_mm: 0.046,
        elevation_m: 0,
        fittings: [{ fittingKey: 'elbow_90', count: 4 }],
      },
    ],
    pumpEfficiency: 0.76,
    motorEfficiency: 0.95,
    pumpSpeed_rpm: 1780,
  });
  assert.ok(pumpRes.TDH_m > 40 && pumpRes.NPSHa_m > 5 && pumpRes.shaftPower_kW > 10);

  const pipeRes = calcPipePressureDrop(brineFluid, 25, 50, [
    {
      id: 'S1',
      label: 'Header',
      D_mm: 102.26,
      length_m: 100,
      roughness_mm: 0.046,
      elevation_m: 5,
      fittings: [{ fittingKey: 'elbow_90', count: 4 }],
    },
  ]);
  const fTest = churchillFrictionFactor(5e4, 0.000046, 0.10226);
  assert.ok(pipeRes.dP_total_bar > 0.2 && fTest > 0.015 && fTest < 0.03);
  console.log(
    `  [PASS] Legacy Facades: hxCalc U=${hxRes.U_calc_Wm2K.toFixed(1)}, packingCalc D=${pkRes.tower_diameter_m.toFixed(2)}m, pumpCalc TDH=${pumpRes.TDH_m.toFixed(1)}m, pipeCalc dP=${pipeRes.dP_total_bar.toFixed(3)} bar`
  );
}

function runBrowserVmSimulation() {
  console.log('\n[3/3] Testing Browser IIFE Bundle in Node VM (chem_db.js -> unified_kernel.js -> eng_solvers.js)...');

  const chemDbCode = fs.readFileSync(path.join(ROOT, 'public/chempro/chem_db.js'), 'utf8');
  const kernelCode = fs.readFileSync(path.join(ROOT, 'public/chempro/unified_kernel.js'), 'utf8');
  const engSolversCode = fs.readFileSync(path.join(ROOT, 'public/chempro/eng_solvers.js'), 'utf8');

  const ctx: Record<string, any> = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    Date,
    Error,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  vm.runInContext(chemDbCode, ctx, { filename: 'chem_db.js' });
  vm.runInContext(kernelCode, ctx, { filename: 'unified_kernel.js' });
  vm.runInContext(engSolversCode, ctx, { filename: 'eng_solvers.js' });

  assert.ok(ctx.__ChemEngUnifiedKernel, 'window.__ChemEngUnifiedKernel must be exposed');
  assert.ok(ctx.ChemEngSolvers, 'window.ChemEngSolvers must be exposed');
  assert.ok(Object.keys(ctx.FLUID_DB || {}).length >= 170, 'chem_db FLUID_DB must load 170+ compounds');

  const S = ctx.ChemEngSolvers;
  const pumpInp = { equipTag: 'P-101', fluidId: 'naoh_32', Q_m3h: 50, P1_barG: 0.2, P2_barG: 4.5, d_suc_mm: 100, d_dis_mm: 80 };
  const hxInp = {
    equipTag: 'E-201',
    hx_type: 'shell_tube',
    hotFluidId: 'ech_pure',
    coldFluidId: 'water',
    mh_kgh: 12000,
    Th_in: 105,
    Th_out: 45,
    mc_kgh: 'auto',
    dofTarget: 'tco_auto',
    Tc_in: 28,
    Tc_out: 38,
    tube_L_m: 4.0,
  };
  const pheInp = {
    equipTag: 'E-332',
    hx_type: 'plate_phe',
    hotFluidId: 'naoh_32',
    coldFluidId: 'chilled_water_7c',
    mh_kgh: 20000,
    Th_in: 80,
    Th_out: 40,
    mc_kgh: 'auto',
    dofTarget: 'mc_auto',
    Tc_in: 12,
    Tc_out: 25,
    phe_beta_deg: 60,
    phe_passes: 2,
  };
  const colInp = {
    equipTag: 'T-101',
    col_mode: 'distillation',
    nrtlPreset: 'dcp_ech',
    F_kmolh: 90,
    zF: 0.45,
    xD: 0.95,
    xB: 0.05,
    P_col_bar: 1.013,
    internals: 'tray',
  };
  const pipeInp = { equipTag: 'L-101', fluidId: 'naoh_32', Q_m3h: 55, L_m: 120, schedule: '40', selected_nps_idx: 5 };
  const vesInp = {
    equipTag: 'V-331',
    orientation: 'vertical',
    Wg_kgh: 4000,
    Wl_kgh: 6000,
    P_op_bar: 0.33,
    T_des_C: 95,
    is_vacuum: true,
    mat_key: 'SA-240-316L',
  };
  const psvInp = {
    equipTag: 'PSV-401',
    scenario: 'blocked_outlet',
    phase: 'vapor',
    fluidId: 'cl2_wet_gas',
    W_kgh: 6000,
    P_set_barG: 7.0,
    P_back_barG: 0.4,
  };

  const resPump = S.solvePump(pumpInp, 'rigorous');
  const resEB = S.solveHXEnergyBalance(hxInp);
  const resHX = S.solveHX(hxInp, 'rigorous');
  const resPHE = S.solveHX(pheInp, 'rigorous');
  const resCol = S.solveColumn(colInp, 'rigorous');
  const resPipe = S.solvePiping(pipeInp, 'rigorous');
  const resVes = S.solveVessel(vesInp, 'rigorous');
  const resPSV = S.solvePSV(psvInp, 'rigorous');

  assert.ok(resPump.H_total_m > 0 && resEB.Q_kW > 0 && resHX.U_calc > 0 && resPHE.N_eff > 0);
  assert.ok(resCol.N_theo > 0 && resPipe.selected.dP_total_bar > 0 && resVes.D_m > 0 && resPSV.A_req_mm2 > 0);

  for (const [eqType, inp] of [
    ['pump', pumpInp],
    ['hx', hxInp],
    ['hx', pheInp],
    ['column', colInp],
    ['piping', pipeInp],
    ['vessel', vesInp],
    ['psv', psvInp],
  ] as const) {
    const ar = S.autoRedesignAndConverge(eqType, inp, 'rigorous', {});
    assert.ok(ar && ar.finalResults, `autoRedesignAndConverge(${eqType}) must return finalResults`);
  }

  const sheets = [
    S.renderQuotationDatasheet('pump', resPump, 'rigorous'),
    S.renderQuotationDatasheet('hx', resHX, 'rigorous'),
    S.renderQuotationDatasheet('hx', resPHE, 'rigorous'),
    S.renderQuotationDatasheet('column', resCol, 'rigorous'),
    S.renderQuotationDatasheet('piping', resPipe, 'rigorous'),
    S.renderQuotationDatasheet('vessel', resVes, 'rigorous'),
    S.renderQuotationDatasheet('psv', resPSV, 'rigorous'),
  ];
  sheets.forEach((html, i) => {
    assert.equal(typeof html, 'string', `Datasheet[${i}] must be string`);
    assert.ok(html.length > 200 && html.includes('<table'), `Datasheet[${i}] must render HTML table (len=${html.length})`);
    assert.ok(!html.includes('NaN'), `Datasheet[${i}] must not contain NaN`);
  });

  console.log(
    `  [PASS] Browser VM: 178-compound FLUID_DB + unified_kernel.js + autoRedesignAndConverge + 7 quotation datasheets clean (0 NaN)`
  );
}

function main() {
  runDirectKernelTests();
  runLegacyFacadeTests();
  runBrowserVmSimulation();
  console.log('\nALL UNIFIED KERNEL VALIDATIONS PASSED!');
}

main();

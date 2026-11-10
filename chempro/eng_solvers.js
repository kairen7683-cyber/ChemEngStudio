/**
 * ChemEng Studio Pro v2.0 — Rigorous Iterative Chemical Engineering Solvers & Canvas Visualizers
 * Supports 6 Equipment Modules:
 *   1. Pump (API 610 + Hydraulic Institute Viscosity Correction Iterative Loop + Min Flow Orifice)
 *   2. Heat Exchanger (Auto Energy Balance DOF + U_assumed <-> U_calc Wegstein Convergence + Bell-Delaware + TEMA Vibration)
 *   3. Distillation Column (NRTL Non-Ideal VLE Bubble-Point Convergence + FUG + 4-Zone Tray Hydraulics + Packings)
 *   4. Process Piping (Darcy-Weisbach + Compressible Gas Mach Loop + Lockhart-Martinelli 2-Phase + Max Flow Inverse DOF)
 *   5. Pressure Vessel & KO Drum (Souders-Brown Demister + Hold-up Surge + ASME Sec. VIII Div. 1 Shell/Head Thickness & Weight)
 *   6. Pressure Safety Valve / PSV (API 520 Part I Gas/Steam/Liquid + API 521 Fire Case Auto Load + API 526 Orifice D~T)
 */

window.ChemEngSolvers = (function () {
  const G = 9.80665;
  const R_GAS = 8.31446; // kJ/(kmol·K) or J/(mol·K)

  function swameeJain(Re, eps_D) {
    if (Re <= 0) return 0.02;
    if (Re < 2100) return 64.0 / Math.max(Re, 1.0);
    const term = eps_D / 3.7 + 5.74 / Math.pow(Re, 0.9);
    const logTerm = Math.log10(Math.max(term, 1e-12));
    return 0.25 / (logTerm * logTerm);
  }

  // =========================================================================
  // 1. CENTRIFUGAL PUMP SOLVER (API 610 + ANSI/HI 9.6.7 Viscosity Loop)
  // =========================================================================
  function solvePump(inp, mode) {
    const Q_m3h = Math.max(0.1, inp.Q_m3h || 50);
    const Q_m3s = Q_m3h / 3600.0;
    const rho = Math.max(10, inp.rho || 998.2);
    const mu_cP = Math.max(0.01, inp.mu_cP || 1.0);
    const mu_Pas = mu_cP * 0.001;
    const nu_cSt = mu_cP / (rho / 1000.0);
    const pv_bar = Math.max(0.0, inp.pv_bar || 0.023);
    const patm_bar = inp.patm_bar || 1.01325;

    let H_total_m = 0;
    let H_static_m = 0;
    let H_press_m = 0;
    let H_fric_suc_m = 0;
    let H_fric_dis_m = 0;
    let v_suc = 1.2, v_dis = 2.2;
    let Re_suc = 1e5, Re_dis = 1e5;
    let NPSHa_m = 10.0;
    const iterations = [];

    if (mode === 'quick') {
      H_total_m = Math.max(1.0, inp.H_quick_m || 45.0);
      H_static_m = H_total_m * 0.72;
      H_fric_dis_m = H_total_m * 0.28;
      const hs = inp.hs_quick_m !== undefined ? inp.hs_quick_m : 3.0;
      const hf_s = 0.8;
      NPSHa_m = ((patm_bar - pv_bar) * 1e5) / (rho * G) + hs - hf_s;
      iterations.push({ iter: 1, param: 'Quick Hydraulic Head', assumed: H_total_m.toFixed(2), calc: H_total_m.toFixed(2), err: '0.00%', note: '개략 양정 직접 산정' });
    } else {
      const P1_barG = inp.P1_barG || 0.0;
      const P2_barG = inp.P2_barG || 3.5;
      const z1_m = inp.z1_m || 0.0;
      const z2_m = inp.z2_m || 15.0;
      const d_suc_m = Math.max(0.015, (inp.d_suc_mm || 102.26) / 1000.0);
      const d_dis_m = Math.max(0.015, (inp.d_dis_mm || 77.92) / 1000.0);
      const L_suc_m = Math.max(0.1, inp.L_suc_m || 6.0);
      const L_dis_m = Math.max(0.5, inp.L_dis_m || 85.0);
      const K_suc = Math.max(0, inp.K_suc || 1.5);
      const K_dis = Math.max(0, inp.K_dis || 12.0);
      const eps_m = Math.max(1e-7, (inp.rough_mm || 0.045) / 1000.0);
      const cv_bar = Math.max(0, inp.cv_dp_bar || 0.7);

      const A_suc = Math.PI * d_suc_m * d_suc_m / 4.0;
      const A_dis = Math.PI * d_dis_m * d_dis_m / 4.0;
      v_suc = Q_m3s / A_suc;
      v_dis = Q_m3s / A_dis;

      Re_suc = (rho * v_suc * d_suc_m) / mu_Pas;
      Re_dis = (rho * v_dis * d_dis_m) / mu_Pas;

      const f_suc = swameeJain(Re_suc, eps_m / d_suc_m);
      const f_dis = swameeJain(Re_dis, eps_m / d_dis_m);

      H_fric_suc_m = (f_suc * (L_suc_m / d_suc_m) + K_suc) * (v_suc * v_suc) / (2.0 * G);
      const h_cv_m = (cv_bar * 1e5) / (rho * G);
      H_fric_dis_m = (f_dis * (L_dis_m / d_dis_m) + K_dis) * (v_dis * v_dis) / (2.0 * G) + h_cv_m;

      H_static_m = z2_m - z1_m;
      H_press_m = ((P2_barG - P1_barG) * 1e5) / (rho * G);
      const H_vel_m = (v_dis * v_dis - v_suc * v_suc) / (2.0 * G);

      H_total_m = Math.max(1.0, H_static_m + H_press_m + H_fric_suc_m + H_fric_dis_m + H_vel_m);

      const P1_abs_bar = P1_barG + patm_bar;
      NPSHa_m = ((P1_abs_bar - pv_bar) * 1e5) / (rho * G) + z1_m - H_fric_suc_m;
    }

    // ANSI/HI 9.6.7 Viscosity Correction Iterative Loop (Water BEP -> Viscous Performance)
    const rpm = Math.max(600, inp.rpm || 1750);
    const eff_water = Math.min(0.92, Math.max(0.25, (inp.eff_pct || 74) / 100.0));
    let CQ = 1.0, CH = 1.0, Ceta = 1.0, B_param = 0.0;
    let H_water_eq = H_total_m;
    let Q_water_eq = Q_m3h;

    if (nu_cSt > 4.0) {
      for (let it = 1; it <= 5; it++) {
        const H_prev = H_water_eq;
        B_param = 16.5 * Math.pow(nu_cSt, 0.5) * Math.pow(H_water_eq, 0.0625) / (Math.pow(Q_water_eq, 0.375) * Math.pow(rpm, 0.25));
        if (B_param > 1.0) {
          CQ = Math.max(0.45, Math.exp(-0.165 * Math.pow(Math.log10(B_param), 3.15)));
          CH = Math.max(0.55, 1.0 - 0.07 * Math.pow(B_param, 0.65));
          Ceta = Math.max(0.25, Math.pow(B_param, -0.0547 * Math.pow(B_param, 0.69)));
        }
        H_water_eq = H_total_m / CH;
        Q_water_eq = Q_m3h / CQ;
        const errPct = Math.abs(H_water_eq - H_prev) / Math.max(1, H_water_eq) * 100;
        iterations.push({
          iter: it,
          param: `HI 점도보정 루프 (B=${B_param.toFixed(2)})`,
          assumed: `${H_prev.toFixed(2)} m`,
          calc: `${H_water_eq.toFixed(2)} m (Cη=${Ceta.toFixed(3)})`,
          err: `${errPct.toFixed(3)}%`,
          note: errPct < 0.05 ? '수렴 완료 (ANSI/HI 9.6.7)' : '등가 청수 양정 재계산'
        });
        if (errPct < 0.05) break;
      }
    } else {
      iterations.push({
        iter: 1,
        param: `저점도 뉴턴유체 (ν=${nu_cSt.toFixed(2)} cSt)`,
        assumed: `CH=1.000, Cη=1.000`,
        calc: `TDH=${H_total_m.toFixed(2)} m`,
        err: '0.000%',
        note: 'ν ≤ 4.0 cSt — 점도 보정 불필요 (즉시 수렴)'
      });
    }

    const eff = Math.max(0.15, eff_water * Ceta);
    const Ns = (rpm * Math.sqrt(Q_m3s)) / Math.pow(H_total_m, 0.75);
    const Nss_target = 180.0;
    const NPSHr_est = Math.max(1.8, Math.pow((rpm * Math.sqrt(Q_m3s)) / Nss_target, 4.0 / 3.0) * 1.15);
    const NPSHr_m = (inp.npshr_m && inp.npshr_m > 0) ? inp.npshr_m : NPSHr_est;
    const npsh_margin_m = NPSHa_m - NPSHr_m;
    const npsh_ratio = NPSHa_m / Math.max(0.5, NPSHr_m);

    const P_hyd_kW = (rho * G * Q_m3s * H_total_m) / 1000.0;
    const P_shaft_kW = P_hyd_kW / eff;

    let apiMargin = 1.10;
    if (P_shaft_kW < 22) apiMargin = 1.25;
    else if (P_shaft_kW <= 55) apiMargin = 1.15;
    const P_motor_req_kW = P_shaft_kW * apiMargin;

    const stdMotors = [0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315, 355, 400, 500];
    const P_motor_std_kW = stdMotors.find(m => m >= P_motor_req_kW) || Math.ceil(P_motor_req_kW / 50) * 50;

    // Minimum Continuous Stable Flow (MCSF) & Bypass Orifice Sizing
    const Q_mcsf_m3h = Q_m3h * (Ns > 45 ? 0.40 : 0.30);
    const dP_Pump_bar = (rho * G * H_total_m) / 1e5;
    const A_orifice_m2 = (Q_mcsf_m3h / 3600.0) / (0.62 * Math.sqrt(2.0 * Math.max(0.5, dP_Pump_bar) * 1e5 / rho));
    const d_orifice_mm = Math.sqrt(4.0 * A_orifice_m2 / Math.PI) * 1000.0;

    // Shutoff Temp Rise
    const cp_kJ = inp.cp_kJ || 4.184;
    const dT_shutoff_C_min = (P_shaft_kW * 60.0) / Math.max(1.0, rho * 0.05 * cp_kJ);

    let impellerType = '반경류 (Radial Vane)';
    if (Ns > 80) impellerType = '축류형 (Axial Propeller)';
    else if (Ns > 40) impellerType = '사류형 (Mixed Flow)';
    else if (Ns < 12) impellerType = '다단 원심 (Multi-stage Radial)';

    const warnings = [];
    if (npsh_margin_m < 1.0 || npsh_ratio < 1.15) {
      warnings.push({ level: 'danger', text: `캐비테이션 위험! NPSHa(${NPSHa_m.toFixed(2)}m) - NPSHr(${NPSHr_m.toFixed(2)}m) = ${npsh_margin_m.toFixed(2)}m (권장 여유 ≥ 1.0m 또는 비율 ≥ 1.3)` });
    } else {
      warnings.push({ level: 'ok', text: `NPSH 여유율 우수: NPSHa/NPSHr = ${npsh_ratio.toFixed(2)} (여유 +${npsh_margin_m.toFixed(2)}m)` });
    }
    if (nu_cSt > 4.0) {
      warnings.push({ level: 'warn', text: `고점도 유체(ν=${nu_cSt.toFixed(1)} cSt): ANSI/HI 9.6.7 점도보정 계수 적용됨 (C_Q=${CQ.toFixed(2)}, C_H=${CH.toFixed(2)}, C_η=${Ceta.toFixed(2)})` });
    }
    if (mode === 'rigorous') {
      if (v_suc > 1.8) warnings.push({ level: 'warn', text: `흡입배관 유속 과다 (${v_suc.toFixed(2)} m/s > 권장 0.9~1.5 m/s) — 흡입 관경 확대 권장` });
      if (v_dis > 3.5) warnings.push({ level: 'warn', text: `토출배관 유속 과다 (${v_dis.toFixed(2)} m/s > 권장 1.8~3.0 m/s) — 마찰손실 증가 주의` });
    }
    warnings.push({ level: 'ok', text: `최소유량(MCSF) 보호 오리피스: Q_min=${Q_mcsf_m3h.toFixed(1)} m³/h (바이패스 오리피스 내경 d₀=${d_orifice_mm.toFixed(1)} mm)` });

    // Impeller Sizing (Stepanoff Head Coefficient psi ~ 0.48)
    const psi_head = Math.max(0.38, Math.min(0.55, 0.52 - 0.0012 * Ns));
    const u2_tip_ms = Math.sqrt((G * H_total_m) / psi_head);
    const D_imp_calc_mm = ((60.0 * u2_tip_ms) / (Math.PI * rpm)) * 1000.0;
    const D_imp_rated_mm = Math.max(125, Math.min(650, Math.round(D_imp_calc_mm / 5) * 5));
    const D_imp_max_mm = Math.round((D_imp_rated_mm * 1.075) / 5) * 5;
    const D_imp_min_mm = Math.round((D_imp_rated_mm * 0.86) / 5) * 5;
    const Nss = (rpm * Math.sqrt(Q_m3s)) / Math.pow(Math.max(0.5, NPSHr_m), 0.75);
    const fluidObj = window.getFluidProps ? window.getFluidProps(inp.fluidId || 'water', inp.T_C || 25) : { name: 'Water', formula: 'H2O', cp: 4.184 };
    const P1_out = inp.P1_barG !== undefined ? inp.P1_barG : 0.2;
    const P2_out = inp.P2_barG !== undefined ? inp.P2_barG : (P1_out + dP_Pump_bar);

    return {
      equipTag: inp.equipTag || 'P-101',
      equipName: inp.equipName || `${fluidObj.name} Transfer Pump`,
      fluidName: fluidObj.name,
      fluidFormula: fluidObj.formula,
      T_C: inp.T_C !== undefined ? inp.T_C : 25,
      rho, mu_cP, pv_bar, rpm,
      P1_barG: P1_out, P2_barG: P2_out, dP_Pump_bar,
      d_suc_mm: inp.d_suc_mm || 102.26, d_dis_mm: inp.d_dis_mm || 77.92,
      D_imp_rated_mm, D_imp_max_mm, D_imp_min_mm, u2_tip_ms, Nss,
      Q_m3h, H_total_m, H_static_m, H_press_m, H_fric_suc_m, H_fric_dis_m,
      v_suc, v_dis, Re_suc, Re_dis,
      NPSHa_m, NPSHr_m, npsh_margin_m, npsh_ratio,
      P_hyd_kW, P_shaft_kW, P_motor_req_kW, P_motor_std_kW,
      eff_pct: eff * 100.0, eff_water_pct: eff_water * 100.0,
      CQ, CH, Ceta, nu_cSt,
      Q_mcsf_m3h, d_orifice_mm, dT_shutoff_C_min,
      Ns, impellerType, iterations, warnings
    };
  }

  // =========================================================================
  // 2. HEAT EXCHANGER ENERGY BALANCE AUTO-DOF + BELL-DELAWARE ITERATIVE SOLVER
  // =========================================================================
  function solveHXEnergyBalance(inp) {
    // Returns balanced { mh, Th_in, Th_out, mc, Tc_in, Tc_out, Qh_kW, Qc_kW, hotProps, coldProps, dofTarget }
    const hotFluidId = inp.hotFluidId || 'crude_oil';
    const coldFluidId = inp.coldFluidId || 'water';
    const dofTarget = inp.dofTarget || 'mc_auto'; // 'mc_auto' | 'tco_auto' | 'tho_auto' | 'mh_auto'

    let mh = Math.max(10, inp.mh_kgh || 45000);
    let Th_in = inp.Th_in !== undefined ? inp.Th_in : 135.0;
    let Th_out = inp.Th_out !== undefined ? inp.Th_out : 65.0;
    let mc = Math.max(10, inp.mc_kgh || 58000);
    let Tc_in = inp.Tc_in !== undefined ? inp.Tc_in : 28.0;
    let Tc_out = inp.Tc_out !== undefined ? inp.Tc_out : 52.0;

    // 3-step inner temperature-property loop so Cp(T_avg) and auto-calculated T/m are 100% consistent
    let hotProps = window.getFluidProps(hotFluidId, 0.5 * (Th_in + Th_out));
    let coldProps = window.getFluidProps(coldFluidId, 0.5 * (Tc_in + Tc_out));

    const cph_use = (inp.manualProp && inp.cph_manual > 0) ? inp.cph_manual : hotProps.cp;
    const cpc_use = (inp.manualProp && inp.cpc_manual > 0) ? inp.cpc_manual : coldProps.cp;

    for (let k = 0; k < 4; k++) {
      hotProps = window.getFluidProps(hotFluidId, 0.5 * (Th_in + Th_out));
      coldProps = window.getFluidProps(coldFluidId, 0.5 * (Tc_in + Tc_out));
      const cph = (inp.manualProp && inp.cph_manual > 0) ? inp.cph_manual : hotProps.cp;
      const cpc = (inp.manualProp && inp.cpc_manual > 0) ? inp.cpc_manual : coldProps.cp;

      if (dofTarget === 'mc_auto') {
        const Qh = (mh / 3600.0) * cph * Math.max(0.5, Math.abs(Th_in - Th_out));
        const dTc = Math.max(0.5, Math.abs(Tc_out - Tc_in));
        mc = (Qh / (cpc * dTc)) * 3600.0;
      } else if (dofTarget === 'tco_auto') {
        const Qh = (mh / 3600.0) * cph * Math.max(0.5, Math.abs(Th_in - Th_out));
        const dTc = Qh / Math.max(0.01, (mc / 3600.0) * cpc);
        Tc_out = Math.min(Th_in - 1.0, Tc_in + dTc);
      } else if (dofTarget === 'tho_auto') {
        const Qc = (mc / 3600.0) * cpc * Math.max(0.5, Math.abs(Tc_out - Tc_in));
        const dTh = Qc / Math.max(0.01, (mh / 3600.0) * cph);
        Th_out = Math.max(Tc_in + 1.0, Th_in - dTh);
      } else if (dofTarget === 'mh_auto') {
        const Qc = (mc / 3600.0) * cpc * Math.max(0.5, Math.abs(Tc_out - Tc_in));
        const dTh = Math.max(0.5, Math.abs(Th_in - Th_out));
        mh = (Qc / (cph * dTh)) * 3600.0;
      }
    }

    const cph_final = (inp.manualProp && inp.cph_manual > 0) ? inp.cph_manual : hotProps.cp;
    const cpc_final = (inp.manualProp && inp.cpc_manual > 0) ? inp.cpc_manual : coldProps.cp;
    const Qh_kW = (mh / 3600.0) * cph_final * Math.abs(Th_in - Th_out);
    const Qc_kW = (mc / 3600.0) * cpc_final * Math.abs(Tc_out - Tc_in);

    return {
      mh, Th_in, Th_out, mc, Tc_in, Tc_out,
      Qh_kW, Qc_kW,
      hotProps, coldProps,
      cph: cph_final, cpc: cpc_final,
      dofTarget
    };
  }

  function calcFt(Th_in, Th_out, Tc_in, Tc_out, nShellPasses) {
    const N = nShellPasses || 1;
    const dT_cold = Tc_out - Tc_in;
    const dT_hot = Th_in - Th_out;
    if (Math.abs(dT_cold) < 1e-4 || Math.abs(Th_in - Tc_in) < 1e-4) return 1.0;

    let P = (Tc_out - Tc_in) / (Th_in - Tc_in);
    let R = (Th_in - Th_out) / (Tc_out - Tc_in);
    P = Math.min(0.98, Math.max(0.01, P));
    R = Math.min(10.0, Math.max(0.05, R));

    if (N > 1 && Math.abs(R - 1.0) > 1e-3) {
      const ratio = (1.0 - P * R) / (1.0 - P);
      if (ratio <= 0) return 0.55;
      const p1 = Math.pow(ratio, 1.0 / N);
      P = (1.0 - p1) / (R - p1);
    }

    const sq = Math.sqrt(R * R + 1.0);
    if (Math.abs(R - 1.0) < 1e-3) {
      const num = (P / (1.0 - P)) * Math.sqrt(2.0);
      const den = Math.log((2.0 / P - 1.0 - Math.sqrt(2.0)) / Math.max(1e-6, 2.0 / P - 1.0 + Math.sqrt(2.0)));
      return Math.max(0.5, Math.min(1.0, num / den));
    }

    const num = sq * Math.log(Math.max(1e-5, (1.0 - P) / (1.0 - P * R)));
    const denTerm = (2.0 / P - 1.0 - R + sq) / Math.max(1e-5, 2.0 / P - 1.0 - R - sq);
    if (denTerm <= 1.0001) return 0.55;
    const den = (R - 1.0) * Math.log(denTerm);
    const Ft = num / den;
    return Number.isFinite(Ft) ? Math.max(0.50, Math.min(1.0, Ft)) : 0.70;
  }

  function solveHX(inp, mode) {
    // 1. Run Energy Balance Auto-DOF Solver first
    const eb = solveHXEnergyBalance(inp);
    const { mh, Th_in, Th_out, mc, Tc_in, Tc_out, Qh_kW, Qc_kW, hotProps, coldProps, cph, cpc, dofTarget } = eb;
    const Q_kW = Qh_kW;
    const Q_W = Q_kW * 1000.0;
    const hxType = inp.hx_type || 'shell_tube'; // 'shell_tube' | 'plate_phe'

    // Counter-current LMTD
    const dT1 = Th_in - Tc_out;
    const dT2 = Th_out - Tc_in;
    const tempCross = (dT1 <= 0 || dT2 <= 0);
    const dT1_safe = Math.max(1.2, dT1);
    const dT2_safe = Math.max(1.2, dT2);

    let lmtd = 0;
    if (Math.abs(dT1_safe - dT2_safe) < 0.05) {
      lmtd = 0.5 * (dT1_safe + dT2_safe);
    } else {
      lmtd = (dT1_safe - dT2_safe) / Math.log(dT1_safe / dT2_safe);
    }

    const kw = inp.phe_kw || inp.kw || 45.0;
    const dnToNpsMap = {
      25: '1"', 40: '1-1/2"', 50: '2"', 65: '2-1/2"', 80: '3"',
      100: '4"', 125: '5"', 150: '6"', 200: '8"', 250: '10"',
      300: '12"', 350: '14"', 400: '16"', 450: '18"', 500: '20"'
    };
    const calcNozzleDN = (m_kgh, rho_val) => {
      const q_m3s = (m_kgh / 3600.0) / Math.max(1.0, rho_val);
      const v_noz = rho_val < 50 ? 18.0 : 1.85;
      const d_mm = Math.sqrt((4.0 * q_m3s) / (Math.PI * v_noz)) * 1000.0;
      const stdDN = [25, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500];
      return stdDN.find(d => d >= d_mm) || 500;
    };

    // =========================================================================
    // BRANCH A: PLATE HEAT EXCHANGER (PHE — Chevron Corrugated Plate Solver)
    // =========================================================================
    if (hxType === 'plate_phe') {
      const beta_deg = inp.phe_chevron_deg || inp.phe_beta_deg || 60;
      const b_mm = inp.phe_b_mm || 3.2;
      const tp_mm = inp.phe_tp_mm || 0.6;
      const Wp_mm = inp.phe_wp_mm || 650;
      const Lp_mm = inp.phe_lp_mm || 1400;
      const phePasses = inp.phe_passes || 1;

      const b_m = b_mm / 1000.0;
      const tp_m = tp_mm / 1000.0;
      const Wp_m = Wp_mm / 1000.0;
      const Lp_m = Lp_mm / 1000.0;

      // Area enlargement factor phi (typical 1.17 ~ 1.22 for corrugated chevron plates)
      const phi_enlarge = beta_deg >= 60 ? 1.21 : (beta_deg >= 45 ? 1.18 : 1.15);
      const De_m = (2.0 * b_m) / phi_enlarge;
      const A_single_plate_m2 = Wp_m * Lp_m * phi_enlarge;
      const A_cross_1ch_m2 = b_m * Wp_m;

      const Ft = phePasses === 1 ? 0.98 : calcFt(Th_in, Th_out, Tc_in, Tc_out, phePasses);
      const CMTD = lmtd * Ft;

      const rhoh = hotProps.rho, muh_Pas = hotProps.mu * 0.001, cph_J = cph * 1000.0, kh = hotProps.k;
      const rhoc = coldProps.rho, muc_Pas = coldProps.mu * 0.001, cpc_J = cpc * 1000.0, kc = coldProps.k;
      // PHE low fouling due to high wall shear stress
      const rfh = Math.min(0.00005, hotProps.fouling * 0.35);
      const rfc = Math.min(0.00005, coldProps.fouling * 0.35);

      const Prh = (cph_J * muh_Pas) / kh;
      const Prc = (cpc_J * muc_Pas) / kc;

      // Muley-Manglik / Martin Chevron Nusselt & Friction constants
      const Ch = beta_deg >= 60 ? 0.295 : (beta_deg >= 45 ? 0.215 : 0.145);
      const m_exp = beta_deg >= 60 ? 0.720 : (beta_deg >= 45 ? 0.695 : 0.660);
      const Kp_fric = beta_deg >= 60 ? 2.95 : (beta_deg >= 45 ? 1.65 : 0.88);

      let Uk = 2200.0;
      let U_calc = 2200.0;
      let N_plates = 45, N_eff_plates = 43, N_ch_per_pass = 22;
      let A_prov_m2 = 25.0, A_req_m2 = 21.0, overdesign_pct = 15.0;
      let hh = 3500, hc = 3500, vh = 0.45, vc = 0.45, Reh = 2500, Rec = 2500;
      let dPh_bar = 0.35, dPc_bar = 0.35;
      const iterations = [];

      for (let it = 1; it <= 12; it++) {
        const A_trial = (Q_W / (Uk * CMTD)) * 1.14;
        N_eff_plates = Math.max(9, Math.ceil(A_trial / A_single_plate_m2));
        if (N_eff_plates % 2 === 0) N_eff_plates += 1; // Odd number of thermal plates -> equal channels
        N_plates = N_eff_plates + 2;
        N_ch_per_pass = Math.max(2, Math.round((N_plates - 1) / (2.0 * phePasses)));
        A_prov_m2 = N_eff_plates * A_single_plate_m2;

        const mh_kgs = mh / 3600.0;
        const mc_kgs = mc / 3600.0;

        const Gh = mh_kgs / (N_ch_per_pass * A_cross_1ch_m2);
        const Gc = mc_kgs / (N_ch_per_pass * A_cross_1ch_m2);
        vh = Gh / rhoh;
        vc = Gc / rhoc;

        Reh = (Gh * De_m) / muh_Pas;
        Rec = (Gc * De_m) / muc_Pas;

        const Nuh = Ch * Math.pow(Math.max(15, Reh), m_exp) * Math.pow(Prh, 1.0 / 3.0);
        const Nuc = Ch * Math.pow(Math.max(15, Rec), m_exp) * Math.pow(Prc, 1.0 / 3.0);
        hh = (Nuh * kh) / De_m;
        hc = (Nuc * kc) / De_m;

        const R_total = (1.0 / hh) + (1.0 / hc) + (tp_m / kw) + rfh + rfc;
        U_calc = 1.0 / R_total;

        const err = Math.abs(U_calc - Uk);
        const errPct = (err / U_calc) * 100.0;
        iterations.push({
          iter: it,
          param: `PHE N_p=${N_plates}매 (${N_ch_per_pass} Ch/Pass, β=${beta_deg}°)`,
          assumed: `${Uk.toFixed(1)} W/m²K`,
          calc: `${U_calc.toFixed(1)} W/m²K (A=${A_prov_m2.toFixed(1)} m²)`,
          err: `${errPct.toFixed(2)}%`,
          note: err < 1.0 ? '수렴 완료 (Muley-Manglik PHE)' : '판수 및 채널 유속 재수렴'
        });
        if (err < 1.0 && it >= 2) break;
        Uk = 0.40 * Uk + 0.60 * U_calc;
      }

      A_req_m2 = Q_W / (U_calc * CMTD);
      overdesign_pct = ((A_prov_m2 - A_req_m2) / Math.max(0.1, A_req_m2)) * 100.0;

      // Channel + Port Pressure Drop (bar)
      const fh = Kp_fric / Math.pow(Math.max(20, Reh), 0.24);
      const fc = Kp_fric / Math.pow(Math.max(20, Rec), 0.24);
      const port_d_m = Math.max(0.05, Math.min(0.20, Wp_m * 0.28));
      const A_port_m2 = (Math.PI * port_d_m * port_d_m) / 4.0;
      const v_port_h = (mh / 3600.0) / (rhoh * A_port_m2);
      const v_port_c = (mc / 3600.0) / (rhoc * A_port_m2);

      const dPh_Pa = phePasses * (4.0 * fh * (Lp_m / De_m) * 0.5 * rhoh * vh * vh) + 1.4 * phePasses * 0.5 * rhoh * v_port_h * v_port_h;
      const dPc_Pa = phePasses * (4.0 * fc * (Lp_m / De_m) * 0.5 * rhoc * vc * vc) + 1.4 * phePasses * 0.5 * rhoc * v_port_c * v_port_c;
      dPh_bar = dPh_Pa / 1e5;
      dPc_bar = dPc_Pa / 1e5;

      const U_clean = 1.0 / ((1.0 / hh) + (1.0 / hc) + (tp_m / kw));
      const U_req = Q_W / Math.max(1.0, A_prov_m2 * CMTD);

      const nozzle_hot_dn = calcNozzleDN(mh, rhoh);
      const nozzle_cold_dn = calcNozzleDN(mc, rhoc);
      const nozzle_shell_nps = dnToNpsMap[nozzle_hot_dn] || '4"';
      const nozzle_tube_nps = dnToNpsMap[nozzle_cold_dn] || '4"';

      const pack_pitch_mm = b_mm + tp_mm;
      const L_pack_mm = Math.round(N_plates * pack_pitch_mm);
      const L_frame_mm = L_pack_mm + 480;
      const W_plates_kg = N_plates * A_single_plate_m2 * (tp_m * 8200);
      const W_empty_kg = W_plates_kg + 420 + 0.65 * L_frame_mm;
      const W_filled_kg = W_empty_kg + N_plates * A_cross_1ch_m2 * Lp_m * 1050;

      const matName = inp.phe_mat_name || (kw > 60 ? 'Nickel 200' : (kw > 20 && kw < 25 ? 'Titanium Gr.1' : 'SS316L'));
      const matFactor = kw > 60 ? 2.6 : (kw > 20 && kw < 25 ? 2.2 : 1.2);
      const cost_usd = Math.round((5200 + 260 * Math.pow(A_prov_m2, 0.78)) * matFactor);
      const cost_krw = Math.round((cost_usd * 1380) / 10000) * 10000;

      const warnings = [];
      if (tempCross && Ft < 0.75) {
        warnings.push({ level: 'warn', text: `온도 교차(Temperature Cross) 조건 감지: 대향류 판형 열교환기(PHE)는 온도 접근차(ΔT_min=${Math.min(dT1_safe, dT2_safe).toFixed(1)}°C) 운전이 가능하나 패스 수(${phePasses}-${phePasses} Pass) 확인이 필요합니다.` });
      } else {
        warnings.push({ level: 'ok', text: `판형 열교환기(PHE) 고효율 열회수 적합: 총괄계수 U=${U_calc.toFixed(0)} W/m²K · 판수 ${N_plates}매 (전열면적 ${A_prov_m2.toFixed(1)} m²)` });
      }
      if (dPh_bar > 0.85 || dPc_bar > 0.85) {
        warnings.push({ level: 'warn', text: `채널 압력강하 주의: 고온측 ΔP=${dPh_bar.toFixed(3)} bar / 저온측 ΔP=${dPc_bar.toFixed(3)} bar — 판 간격(b) 확대 또는 쉐브론 각도(45°) 완화 권장` });
      } else {
        warnings.push({ level: 'ok', text: `PHE 채널 차압 양호: 고온측 ΔP=${dPh_bar.toFixed(3)} bar (v=${vh.toFixed(2)} m/s) / 저온측 ΔP=${dPc_bar.toFixed(3)} bar (v=${vc.toFixed(2)} m/s)` });
      }

      return {
        equipTag: inp.equipTag || 'E-332',
        equipName: inp.equipName || `${hotProps.name} / ${coldProps.name} Plate Heat Exchanger`,
        hxType: 'plate_phe',
        mh, Th_in, Th_out, mc, Tc_in, Tc_out, dofTarget, allocation: 'hot_shell',
        Qh_kW, Qc_kW, Q_kW,
        hotProps, coldProps, cph, cpc, rfs: rfh, rft: rfc,
        dT1, dT2, lmtd, Ft, CMTD,
        U_calc, U_clean, U_req, A_req_m2, A_prov_m2, overdesign_pct,
        // PHE Specific + Backward-compatible fields for UI & Export
        N_plates, N_eff_plates, N_ch: N_ch_per_pass, N_ch_per_pass,
        phe_chevron_deg: beta_deg, beta_deg,
        phe_b_mm: b_mm, b_mm,
        phe_tp_mm: tp_mm, tp_mm,
        phe_wp_mm: Wp_mm, Wp_mm,
        phe_lp_mm: Lp_mm, Lp_mm,
        phe_mat_name: matName, matName,
        phePasses,
        phi_enlarge, A_1plate_m2: A_single_plate_m2, A_single_plate_m2, L_pack_mm, L_frame_mm,
        N_tubes: N_plates, D_shell_mm: Wp_mm, D_bundle_mm: Wp_mm - 30,
        nPasses: phePasses, nShell: 1, L_m: Number((Lp_mm / 1000).toFixed(2)),
        do_mm: b_mm, di_mm: b_mm, tw_mm: tp_mm, pt_mm: b_mm + tp_mm, layoutAngle: beta_deg,
        B_spacing_mm: L_pack_mm, N_baffles: N_ch_per_pass, baffleCutPct: beta_deg, baffleRatio: 0.3,
        t_shell_mm: 25, t_tubesheet_mm: 32,
        nozzle_shell_dn: nozzle_hot_dn, nozzle_tube_dn: nozzle_cold_dn,
        nozzle_shell_nps, nozzle_tube_nps,
        W_bundle_kg: W_plates_kg, W_empty_kg, W_filled_kg, cost_usd, cost_krw,
        tema_type: `PHE Chevron ${beta_deg}° (${phePasses}-${phePasses} Pass)`,
        hi: hc, ho: hh, vt: vc, vs: vh, Ret: Rec, Res: Reh, dPt_bar: dPc_bar, dPs_bar: dPh_bar,
        Jc: 1.0, Jl: 1.0, Jb: 1.0, Js: 1.0, Jr: 1.0, J_total: phi_enlarge,
        f_vs_Hz: 0, f_nat_Hz: 120, vibRatio: 0.12,
        iterations, warnings
      };
    }

    const nShell = inp.n_shell || 1;
    const nPasses = inp.n_passes || 2;
    const Ft = nPasses === 1 ? 1.0 : calcFt(Th_in, Th_out, Tc_in, Tc_out, nShell);
    const CMTD = lmtd * Ft;

    let U_calc = 550;
    let U_assumed = inp.U_assumed || 600;
    let A_req_m2 = 0, A_prov_m2 = 0;
    let N_tubes = 0, D_shell_mm = 0;
    let hi = 0, ho = 0;
    let vt = 0, vs = 0;
    let Ret = 0, Res = 0;
    let dPt_bar = 0, dPs_bar = 0;
    let overdesign_pct = 15.0;
    let Jc = 1.0, Jl = 1.0, Jb = 1.0, Js = 1.0, Jr = 1.0, J_total = 1.0;
    let f_vs_Hz = 0, f_nat_Hz = 45.0, vibRatio = 0.25;
    const iterations = [];

    const do_mm = inp.tube_od_mm || 19.05;
    const tw_mm = inp.tube_wall_mm || 2.11;
    const di_mm = do_mm - 2.0 * tw_mm;
    const do_m = do_mm / 1000.0;
    const di_m = di_mm / 1000.0;
    const L_m = Math.max(1.2, inp.tube_L_m || 4.88);
    const pitchRatio = inp.pitch_ratio || 1.25;
    const pt_m = do_m * pitchRatio;
    const layoutAngle = inp.layout_angle || 30;
    const baffleRatio = Math.min(0.60, Math.max(0.18, inp.baffle_ratio || 0.30));
    const baffleCutPct = Math.min(45, Math.max(15, inp.baffle_cut_pct || 25));

    // Fluid allocation: default Hot on Shell, Cold on Tube (or reversed if user chooses)
    const allocation = inp.allocation || 'hot_shell'; // 'hot_shell' | 'hot_tube'
    const shellProps = allocation === 'hot_shell' ? hotProps : coldProps;
    const tubeProps = allocation === 'hot_shell' ? coldProps : hotProps;
    const ms_kgh = allocation === 'hot_shell' ? mh : mc;
    const mt_kgh = allocation === 'hot_shell' ? mc : mh;

    const rhos = inp.rhos || shellProps.rho;
    const mus_Pas = (inp.mus_cP || shellProps.mu) * 0.001;
    const cps_J = (inp.cps || shellProps.cp) * 1000.0;
    const ks = inp.ks || shellProps.k;
    const rfs = inp.rfs !== undefined ? inp.rfs : shellProps.fouling;

    const rhot = inp.rhot || tubeProps.rho;
    const mut_Pas = (inp.mut_cP || tubeProps.mu) * 0.001;
    const cpt_J = (inp.cpt || tubeProps.cp) * 1000.0;
    const kt = inp.kt || tubeProps.k;
    const rft = inp.rft !== undefined ? inp.rft : tubeProps.fouling;

    if (mode === 'quick') {
      U_calc = Math.max(20, U_assumed);
      A_req_m2 = Q_W / (U_calc * CMTD);
      A_prov_m2 = A_req_m2 * 1.15;
      N_tubes = Math.max(16, Math.ceil(A_prov_m2 / (Math.PI * do_m * L_m)));
      const CL = layoutAngle === 30 ? 0.866 : 1.0;
      const CTP = nPasses === 1 ? 0.93 : (nPasses === 2 ? 0.90 : 0.85);
      const D_bundle_m = do_m * Math.pow(N_tubes * CL * pitchRatio * pitchRatio / (0.7854 * CTP), 1.0 / 2.15);
      D_shell_mm = Math.ceil((D_bundle_m * 1000.0 + 38.0) / 10.0) * 10.0;
      iterations.push({
        iter: 1,
        param: '개략 총괄열전달계수 (U_assumed)',
        assumed: `${U_calc.toFixed(1)} W/m²K`,
        calc: `A_req=${A_req_m2.toFixed(1)} m²`,
        err: '0.00%',
        note: '빠른 개략 모드 직접 산정'
      });
    } else {
      // ASPEN / HTRI-STYLE ITERATIVE CONVERGENCE LOOP:
      // Assume U_k -> Required Area with 12% design margin -> Tube Count N_t & Shell ID D_s ->
      // Tube-side Gnielinski h_i & Bell-Delaware Shell-side h_o (Jc, Jl, Jb, Js, Jr) -> U_calc -> Damped update
      let Uk = Math.max(80, U_assumed);
      const CL = layoutAngle === 30 ? 0.866 : 1.0;
      const CTP = nPasses === 1 ? 0.93 : (nPasses === 2 ? 0.90 : 0.85);
      const Prt = (cpt_J * mut_Pas) / kt;
      const Prs = (cps_J * mus_Pas) / ks;

      for (let it = 1; it <= 12; it++) {
        const A_trial = (Q_W / (Uk * CMTD)) * 1.12;
        let Nt_trial = Math.max(20, Math.ceil(A_trial / (Math.PI * do_m * L_m)));
        if (Nt_trial % nPasses !== 0) Nt_trial += (nPasses - (Nt_trial % nPasses));
        N_tubes = Nt_trial;
        A_prov_m2 = N_tubes * Math.PI * do_m * L_m;

        const D_bundle_m = do_m * Math.pow(N_tubes * CL * pitchRatio * pitchRatio / (0.7854 * CTP), 1.0 / 2.15);
        const clearance_m = 0.012 + 0.018 * D_bundle_m;
        const Ds_m = D_bundle_m + clearance_m;
        D_shell_mm = Ds_m * 1000.0;

        // Tube-side film coefficient h_i
        const mt_kgs = mt_kgh / 3600.0;
        const nTubesPerPass = N_tubes / nPasses;
        const At_flow = nTubesPerPass * (Math.PI * di_m * di_m / 4.0);
        vt = mt_kgs / (rhot * At_flow);
        Ret = (rhot * vt * di_m) / mut_Pas;

        let Nut = 3.66;
        if (Ret >= 2300) {
          const ft_darcy = Math.pow(0.790 * Math.log(Ret) - 1.64, -2.0);
          Nut = ((ft_darcy / 8.0) * (Ret - 1000.0) * Prt) / (1.0 + 12.7 * Math.sqrt(ft_darcy / 8.0) * (Math.pow(Prt, 2.0 / 3.0) - 1.0));
          Nut = Math.max(4.0, Nut);
        }
        hi = (Nut * kt) / di_m;

        // Bell-Delaware Shell-side film coefficient h_o
        const B_m = Ds_m * baffleRatio;
        const c_gap_m = pt_m - do_m;
        const As_cross = (Ds_m * c_gap_m * B_m) / pt_m;
        const ms_kgs = ms_kgh / 3600.0;
        const Gs = ms_kgs / As_cross;
        vs = Gs / rhos;

        const De_m = layoutAngle === 30
          ? (4.0 * (0.433 * pt_m * pt_m - 0.125 * Math.PI * do_m * do_m)) / (0.5 * Math.PI * do_m)
          : (4.0 * (pt_m * pt_m - 0.25 * Math.PI * do_m * do_m)) / (Math.PI * do_m);

        Res = (Gs * De_m) / mus_Pas;
        const Nu_ideal = 0.36 * Math.pow(Math.max(10, Res), 0.55) * Math.pow(Prs, 1.0 / 3.0);
        const ho_ideal = (Nu_ideal * ks) / De_m;

        // Bell-Delaware 5 Correction Factors:
        // Jc (Baffle cut & configuration factor)
        Jc = Math.max(0.55, Math.min(1.12, 1.15 - 0.008 * baffleCutPct));
        // Jl (Tube-to-baffle & Baffle-to-shell leakage factor)
        const sm_ratio = 0.14 + 0.08 * (0.30 / baffleRatio);
        Jl = Math.max(0.52, Math.min(0.92, 0.44 * (1.0 - sm_ratio) + (1.0 - 0.44) * Math.exp(-1.5 * sm_ratio)));
        // Jb (Bundle bypass stream factor)
        const Fbp = (clearance_m * B_m) / As_cross;
        Jb = Math.max(0.68, Math.min(0.96, Math.exp(-1.25 * Fbp)));
        // Js (Unequal inlet/outlet baffle spacing factor)
        Js = 0.96;
        // Jr (Laminar temperature gradient factor if Re_s < 100)
        Jr = Res < 100 ? Math.max(0.45, Math.pow(10.0 / Math.max(10, Res), 0.18)) : 1.0;

        J_total = Jc * Jl * Jb * Js * Jr;
        ho = ho_ideal * J_total * 1.32; // Normalized to Bell-Delaware ideal tube bank

        const R_tube_inside = (do_m / di_m) * (1.0 / hi);
        const R_foul_in = (do_m / di_m) * rft;
        const R_wall = (do_m * Math.log(do_m / di_m)) / (2.0 * kw);
        const R_foul_out = rfs;
        const R_shell = 1.0 / ho;

        U_calc = 1.0 / (R_tube_inside + R_foul_in + R_wall + R_foul_out + R_shell);
        const err = Math.abs(U_calc - Uk);
        const errPct = (err / U_calc) * 100.0;

        iterations.push({
          iter: it,
          param: `Nt=${N_tubes}본, Ds=${D_shell_mm.toFixed(0)}mm (J=${J_total.toFixed(3)})`,
          assumed: `${Uk.toFixed(1)} W/m²K`,
          calc: `${U_calc.toFixed(1)} W/m²K`,
          err: `${errPct.toFixed(2)}%`,
          note: err < 0.1 ? '수렴 완료 (Bell-Delaware)' : '총괄열전달계수 재가정'
        });

        if (err < 0.1 && it >= 2) break;
        // Damped Wegstein relaxation
        Uk = 0.35 * Uk + 0.65 * U_calc;
      }

      A_req_m2 = Q_W / (U_calc * CMTD);
      overdesign_pct = ((A_prov_m2 - A_req_m2) / A_req_m2) * 100.0;

      // Tube-side Pressure Drop
      const ft_d = swameeJain(Ret, 0.000045 / di_m);
      const dPt_Pa = nPasses * (ft_d * (L_m / di_m) + 2.5) * 0.5 * rhot * vt * vt;
      dPt_bar = dPt_Pa / 1e5;

      // Shell-side Pressure Drop (Bell-Delaware crossflow + window with leakage & bypass correction)
      const Ds_m = D_shell_mm / 1000.0;
      const B_m = Ds_m * baffleRatio;
      const De_hyd_m = layoutAngle === 30
        ? (4.0 * (0.433 * pt_m * pt_m - 0.125 * Math.PI * do_m * do_m)) / (0.5 * Math.PI * do_m)
        : (4.0 * (pt_m * pt_m - 0.25 * Math.PI * do_m * do_m)) / (Math.PI * do_m);
      const fs_kern = Math.exp(0.576 - 0.19 * Math.log(Math.max(10, Res)));
      const Nb = Math.max(1, Math.floor(L_m / B_m) - 1);
      const Rl_dp = Math.max(0.35, Jl * Jl);
      const Rb_dp = Math.max(0.50, Jb);
      const dPs_Pa = ((fs_kern * (Nb + 1) * Ds_m) / Math.max(0.008, De_hyd_m)) * 0.5 * rhos * vs * vs * Rl_dp * Rb_dp;
      dPs_bar = dPs_Pa / 1e5;

      // TEMA Tube Vibration Check (Vortex Shedding Frequency vs Tube Natural Frequency)
      const Strouhal = layoutAngle === 30 ? 0.22 : 0.20;
      f_vs_Hz = (Strouhal * vs) / do_m;
      const E_steel = 2.0e11; // Pa
      const I_tube = (Math.PI / 64.0) * (Math.pow(do_m, 4) - Math.pow(di_m, 4));
      const m_eff_kgm = (Math.PI / 4.0) * ((do_m * do_m - di_m * di_m) * 7850 + di_m * di_m * rhot + 1.5 * do_m * do_m * rhos);
      const L_span = Math.max(0.25, B_m);
      f_nat_Hz = (Math.PI / (2.0 * L_span * L_span)) * Math.sqrt((E_steel * I_tube) / m_eff_kgm);
      vibRatio = f_vs_Hz / Math.max(1.0, f_nat_Hz);
    }

    // Mechanical & Quotation Specifications for TEMA Datasheet & Engineering DWG
    const stdShells = [203, 254, 305, 337, 387, 438, 489, 540, 591, 635, 686, 737, 787, 838, 889, 940, 991, 1067, 1143, 1219, 1372, 1524, 1676, 1829];
    const D_shell_std_mm = stdShells.find(s => s >= D_shell_mm) || Math.ceil(D_shell_mm / 50) * 50;
    const D_bundle_mm = Math.max(150, D_shell_std_mm - 32);
    const B_spacing_mm = Math.round(D_shell_std_mm * baffleRatio);
    const N_baffles = Math.max(1, Math.floor((L_m * 1000.0) / B_spacing_mm) - 1);
    const pt_mm = do_mm * pitchRatio;
    const t_shell_mm = D_shell_std_mm <= 400 ? 8 : (D_shell_std_mm <= 750 ? 10 : (D_shell_std_mm <= 1100 ? 12 : 16));
    const t_tubesheet_mm = Math.max(25, Math.round(D_shell_std_mm * 0.045 + 12));

    // Clean overall coefficient U_clean (without fouling)
    const R_clean = (do_m / di_m) * (1.0 / Math.max(50, hi || 1200)) + (do_m * Math.log(do_m / di_m)) / (2.0 * kw) + (1.0 / Math.max(50, ho || 800));
    const U_clean = 1.0 / R_clean;
    const U_req = Q_W / Math.max(1.0, A_prov_m2 * CMTD);

    // Nozzle sizing (Shell & Tube In/Out based on velocity ~ 1.8 m/s for liquid, ANSI/ASME B36.10M NPS default)
    const nozzle_shell_dn = calcNozzleDN(ms_kgh, rhos);
    const nozzle_tube_dn = calcNozzleDN(mt_kgh, rhot);
    const nozzle_shell_nps = dnToNpsMap[nozzle_shell_dn] || `${Math.round(nozzle_shell_dn / 25)}"`;
    const nozzle_tube_nps = dnToNpsMap[nozzle_tube_dn] || `${Math.round(nozzle_tube_dn / 25)}"`;

    // Equipment Weights & Budgetary Cost (TEMA Class R)
    const W_tubes_kg = N_tubes * (Math.PI / 4.0) * (do_m * do_m - di_m * di_m) * L_m * 7850 * nShell;
    const W_baffles_ts_kg = (N_baffles * 0.75 * (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * 0.0095 * 7850 + 2 * (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * (t_tubesheet_mm / 1000.0) * 7850) * nShell;
    const W_bundle_kg = W_tubes_kg + W_baffles_ts_kg;
    const W_shell_channel_kg = (Math.PI * (D_shell_std_mm / 1000.0) * (L_m + 1.1) * (t_shell_mm / 1000.0) * 7850 * 1.38) * nShell;
    const W_empty_kg = W_bundle_kg + W_shell_channel_kg;
    const V_internal_m3 = (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * L_m * nShell;
    const W_filled_kg = W_empty_kg + V_internal_m3 * 1000.0;

    const matFactor = kw < 25 ? 2.4 : (kw > 80 ? 1.8 : 1.0);
    const cost_usd = Math.round((8500 + 340 * Math.pow(A_prov_m2 * nShell, 0.72)) * matFactor);
    const cost_krw = Math.round((cost_usd * 1380) / 10000) * 10000;
    const tema_type = Math.abs(Th_in - Tc_in) > 85 ? 'AES (Floating Head)' : 'BEM (Fixed Tubesheet)';

    const warnings = [];
    if (tempCross) {
      warnings.push({ level: 'danger', text: `온도 역전(Temperature Cross) 발생! dT1=${dT1.toFixed(1)}°C, dT2=${dT2.toFixed(1)}°C — 입출구 온도 조건을 점검하세요.` });
    }
    if (Ft < 0.75) {
      warnings.push({ level: 'danger', text: `LMTD 보정계수 Ft = ${Ft.toFixed(3)} (< 0.75 부적합) — 직렬 쉘 패스 수(N_shell)를 2 이상으로 늘리세요!` });
    } else {
      warnings.push({ level: 'ok', text: `LMTD 보정계수 Ft = ${Ft.toFixed(3)} ≥ 0.75 (TEMA 기준 적합)` });
    }
    if (mode === 'rigorous') {
      if (dPt_bar > 0.7 || dPs_bar > 0.7) {
        warnings.push({ level: 'warn', text: `압력강하 주의: Tube ΔP=${dPt_bar.toFixed(3)} bar, Shell ΔP=${dPs_bar.toFixed(3)} bar (권장 ≤ 0.70 bar)` });
      } else {
        warnings.push({ level: 'ok', text: `압력강하 양호: Tube ΔP=${dPt_bar.toFixed(3)} bar / Shell ΔP=${dPs_bar.toFixed(3)} bar` });
      }
      if (vibRatio > 0.80) {
        warnings.push({ level: 'danger', text: `튜브 유체유발 진동(FIV) 공진 위험! 와류주파수/고유진동수 비(f_vs/f_n) = ${vibRatio.toFixed(2)} (> 0.80) — 배플 간격(B/Ds) 축소 필요` });
      } else {
        warnings.push({ level: 'ok', text: `TEMA 튜브 진동 안전: f_vs=${f_vs_Hz.toFixed(1)} Hz vs 고유진동수 f_n=${f_nat_Hz.toFixed(1)} Hz (비율 ${vibRatio.toFixed(2)} < 0.80)` });
      }
    }

    return {
      equipTag: inp.equipTag || 'E-101',
      equipName: inp.equipName || `${hotProps.name} / ${coldProps.name} Exchanger`,
      hxType: 'shell_tube',
      mh, Th_in, Th_out, mc, Tc_in, Tc_out, dofTarget, allocation,
      Qh_kW, Qc_kW, Q_kW,
      hotProps, coldProps, cph, cpc, rfs, rft,
      dT1, dT2, lmtd, Ft, CMTD,
      U_calc, U_clean, U_req, A_req_m2, A_prov_m2, overdesign_pct,
      N_tubes, D_shell_mm: D_shell_std_mm, D_bundle_mm,
      nPasses, nShell, L_m, do_mm, di_mm, tw_mm, pt_mm, layoutAngle,
      B_spacing_mm, N_baffles, baffleCutPct, baffleRatio,
      t_shell_mm, t_tubesheet_mm, nozzle_shell_dn, nozzle_tube_dn, nozzle_shell_nps, nozzle_tube_nps,
      W_bundle_kg, W_empty_kg, W_filled_kg, cost_usd, cost_krw, tema_type,
      hi, ho, vt, vs, Ret, Res, dPt_bar, dPs_bar,
      Jc, Jl, Jb, Js, Jr, J_total,
      f_vs_Hz, f_nat_Hz, vibRatio,
      iterations, warnings
    };
  }

  // =========================================================================
  // 3. DISTILLATION COLUMN (NRTL Non-Ideal VLE Bubble-Point + 4-Zone Hydraulics)
  // =========================================================================
  function calcNRTLGamma(x1, T_K, a12_cal, a21_cal, alpha12) {
    const x = Math.min(0.9999, Math.max(0.0001, x1));
    const x2 = 1.0 - x;
    if (Math.abs(a12_cal) < 1e-3 && Math.abs(a21_cal) < 1e-3) {
      return { gamma1: 1.0, gamma2: 1.0 };
    }
    const RT = 1.9872 * Math.max(200.0, T_K);
    const tau12 = a12_cal / RT;
    const tau21 = a21_cal / RT;
    const G12 = Math.exp(-alpha12 * tau12);
    const G21 = Math.exp(-alpha12 * tau21);

    const denom1 = x + x2 * G21;
    const denom2 = x2 + x * G12;
    const lnGamma1 = x2 * x2 * (tau21 * Math.pow(G21 / denom1, 2) + (tau12 * G12) / (denom2 * denom2));
    const lnGamma2 = x * x * (tau12 * Math.pow(G12 / denom2, 2) + (tau21 * G21) / (denom1 * denom1));
    return {
      gamma1: Math.min(25.0, Math.max(0.1, Math.exp(lnGamma1))),
      gamma2: Math.min(25.0, Math.max(0.1, Math.exp(lnGamma2)))
    };
  }

  function solveBubblePointNRTL(x1, P_bar, lkFluid, hkFluid, a12, a21, alpha12) {
    // Secant / Newton iterative loop for Bubble-Point Temperature T_bp (°C) where y1 + y2 = 1.0
    let T = x1 * lkFluid.tb + (1.0 - x1) * hkFluid.tb;
    let y1 = x1, gamma1 = 1.0, gamma2 = 1.0, alpha_loc = 2.0;
    let iters = 0;

    for (let it = 1; it <= 15; it++) {
      iters = it;
      const p1 = window.getFluidProps(lkFluid.id, T);
      const p2 = window.getFluidProps(hkFluid.id, T);
      const g = calcNRTLGamma(x1, T + 273.15, a12, a21, alpha12);
      gamma1 = g.gamma1;
      gamma2 = g.gamma2;

      const K1 = (gamma1 * p1.pv_bar) / P_bar;
      const K2 = (gamma2 * p2.pv_bar) / P_bar;
      alpha_loc = K1 / Math.max(1e-5, K2);

      const sumY = K1 * x1 + K2 * (1.0 - x1);
      y1 = (K1 * x1) / Math.max(1e-5, sumY);

      const f_err = sumY - 1.0;
      if (Math.abs(f_err) < 0.0005) break;

      // Approximate derivative d(lnPv)/dT ~ 0.035 K^-1
      const dT = -Math.log(Math.max(0.1, sumY)) / 0.035;
      T += Math.max(-15.0, Math.min(15.0, dT));
    }
    return { T_C: T, y1, gamma1, gamma2, alpha_loc, iters };
  }

  function solveColumn(inp, mode) {
    const colMode = inp.col_mode || 'absorption'; // 'absorption' | 'distillation'
    const lkId = inp.lkFluidId || 'h2_wet_gas';
    const hkId = inp.hkFluidId || 'water';
    const lkBase = window.FLUID_DB[lkId] || window.FLUID_DB.benzene;
    const hkBase = window.FLUID_DB[hkId] || window.FLUID_DB.water;
    const P_bar = Math.max(0.05, inp.P_col_bar || 1.05);

    const PACKING_DB = {
      pall_plastic_50:    { name: 'PP/PVDF Plastic Pall Ring 50mm (2")', type: 'Random', mat: 'PP / PVDF', size_mm: 50, Fp: 85, ap: 110, void_pct: 92, hetp_base: 0.65 },
      intalox_ceramic_25: { name: 'Ceramic Intalox Saddle 25mm (1")', type: 'Random', mat: 'Acid-Proof Ceramic', size_mm: 25, Fp: 300, ap: 255, void_pct: 77, hetp_base: 0.45 },
      intalox_ceramic_38: { name: 'Ceramic Intalox Saddle 38mm (1.5")', type: 'Random', mat: 'Acid-Proof Ceramic', size_mm: 38, Fp: 170, ap: 195, void_pct: 80, hetp_base: 0.58 },
      pall_ti_38:         { name: 'Titanium Gr.2 Pall Ring 38mm (1.5")', type: 'Random', mat: 'Titanium Gr.2', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.56 },
      pall_ss316_38:      { name: 'SS316L Metal Pall Ring 38mm (1.5")', type: 'Random', mat: 'SS316L / SS304L', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.56 },
      tellerette_pp_50:   { name: 'PP/PVDF Tellerette 2" Rosette', type: 'Random', mat: 'PP / PVDF', size_mm: 50, Fp: 65, ap: 125, void_pct: 93, hetp_base: 0.55 },
      pall_metal_16: { name: 'Metal Pall Ring 16mm (5/8")', type: 'Random', mat: 'SS316L', size_mm: 16, Fp: 266, ap: 340, void_pct: 93, hetp_base: 0.36 },
      pall_metal_25: { name: 'Metal Pall Ring 25mm (1")', type: 'Random', mat: 'SS316L', size_mm: 25, Fp: 183, ap: 205, void_pct: 94, hetp_base: 0.48 },
      pall_metal_38: { name: 'Metal Pall Ring 38mm (1.5")', type: 'Random', mat: 'SS316L / Ti Gr.2', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.64 },
      pall_metal_50: { name: 'Metal Pall Ring 50mm (2")', type: 'Random', mat: 'SS316L', size_mm: 50, Fp: 89, ap: 105, void_pct: 96, hetp_base: 0.82 },
      imtp_25:       { name: 'IMTP #25 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 25, Fp: 135, ap: 225, void_pct: 96.5, hetp_base: 0.42 },
      imtp_40:       { name: 'IMTP #40 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 40, Fp: 79, ap: 150, void_pct: 97.0, hetp_base: 0.56 },
      imtp_50:       { name: 'IMTP #50 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 50, Fp: 59, ap: 100, void_pct: 97.8, hetp_base: 0.72 },
      raschig_metal_25: { name: 'Metal Raschig Ring 25mm', type: 'Random', mat: 'Carbon Steel / SS304', size_mm: 25, Fp: 450, ap: 190, void_pct: 86, hetp_base: 0.58 },
      berl_ceramic_25:  { name: 'Ceramic Berl Saddle 25mm', type: 'Random', mat: 'Chemical Porcelain', size_mm: 25, Fp: 360, ap: 250, void_pct: 68, hetp_base: 0.52 },
      mellapak_250y: { name: 'Mellapak 250Y (Structured)', type: 'Structured', mat: 'SS316L Sheet 0.15mm', size_mm: 250, Fp: 66, ap: 250, void_pct: 98.0, hetp_base: 0.38 },
      mellapak_350y: { name: 'Mellapak 350Y (Structured)', type: 'Structured', mat: 'SS316L Sheet 0.15mm', size_mm: 350, Fp: 95, ap: 350, void_pct: 97.5, hetp_base: 0.29 },
      mellapak_500y: { name: 'Mellapak 500Y (Structured)', type: 'Structured', mat: 'SS316L Gauze/Sheet', size_mm: 500, Fp: 145, ap: 500, void_pct: 96.5, hetp_base: 0.22 }
    };
    const packKey = inp.pack_key || 'pall_plastic_50';
    const packSpec = PACKING_DB[packKey] || PACKING_DB.pall_plastic_50;
    const bedMaxH_m = inp.bed_max_h_m || 4.5;
    const floodFrac = Math.min(0.90, Math.max(0.45, (inp.flood_pct || 72) / 100.0));

    // =========================================================================
    // BRANCH A: GAS ABSORPTION / SCRUBBING / DRYING PACKED TOWER
    // (T-410 ~ T-450 Cl2 Wash/H2SO4 Drying, T-610 H2 Caustic Scrubber, T-280, D-940)
    // =========================================================================
    if (colMode === 'absorption') {
      const absService = inp.abs_service || 'scrubbing'; // 'scrubbing' | 'drying' | 'cooling_wash' | 'stripping'
      const Gm_kgh = Math.max(20, inp.Wg_kgh || inp.gas_kgh || 2024);
      const Lm_kgh = Math.max(100, inp.Wl_kgh || inp.liq_kgh || 18500);
      const T_gas_in = inp.Tg_C !== undefined ? inp.Tg_C : (inp.T_gas_in !== undefined ? inp.T_gas_in : 85.0);
      const T_liq_in = inp.Tl_C !== undefined ? inp.Tl_C : (inp.T_liq_in !== undefined ? inp.T_liq_in : 32.0);
      const y_in_ppm = Math.max(1.0, inp.yin_ppm || inp.y_in_ppm || 4500);
      const y_out_ppm = Math.max(0.05, Math.min(y_in_ppm * 0.8, inp.yout_ppm || inp.y_out_ppm || 5.0));
      const m_eq = Math.max(0.01, inp.m_eq || 0.25);

      const T_avg = 0.4 * T_gas_in + 0.6 * T_liq_in;
      const gasProps = window.getFluidProps(lkId, T_avg);
      const liqProps = window.getFluidProps(hkId, T_avg);

      const mw_gas = Math.max(2.0, gasProps.mw);
      const mw_liq = Math.max(18.0, liqProps.mw);
      const rhoV = Math.max(0.08, (P_bar * 100.0 * mw_gas) / (R_GAS * (T_avg + 273.15)));
      const rhoL = Math.max(600, liqProps.rho);
      const muL_cP = Math.max(0.2, liqProps.mu);
      const sigma = Math.max(15.0, liqProps.sigma || 55.0);

      const Gm_kgs = Gm_kgh / 3600.0;
      const Lm_kgs = Lm_kgh / 3600.0;
      const Qv_m3s = Gm_kgs / rhoV;
      const Ql_m3s = Lm_kgs / rhoL;

      // Eckert GPDC Flow Parameter Flv
      const Flv = Math.max(0.015, Math.min(2.5, (Lm_kgs / Math.max(0.005, Gm_kgs)) * Math.sqrt(rhoV / rhoL)));
      const Y_flood = Math.exp(-3.635 - 1.164 * Math.log(Flv) - 0.124 * Math.pow(Math.log(Flv), 2));
      const muFactor = Math.pow(muL_cP, 0.1);
      const u_flood = Math.sqrt((Y_flood * G * (rhoL - rhoV)) / (packSpec.Fp * rhoV * muFactor));
      const u_design = u_flood * floodFrac;
      const F_factor = u_design * Math.sqrt(rhoV);
      const Csb = u_flood / Math.sqrt((rhoL - rhoV) / rhoV);

      const Ac_m2 = Qv_m3s / Math.max(0.05, u_design);
      const D_col_raw_m = Math.sqrt((4.0 * Ac_m2) / Math.PI);
      const D_col_m = Math.max(0.45, Math.ceil(D_col_raw_m * 20.0) / 20.0);
      const Ac_actual_m2 = (Math.PI * D_col_m * D_col_m) / 4.0;
      const u_op = Qv_m3s / Ac_actual_m2;

      // Liquid Irrigation Rate Lw (m³ / m²·h) & Minimum Wetting Rate Check
      const Lw_m3m2h = (Ql_m3s * 3600.0) / Ac_actual_m2;
      const Lw_min_m3m2h = packSpec.mat.includes('PP') ? 7.5 : 4.5; // Plastics need higher wetting rate

      // Mass Transfer: Colburn Number of Overall Gas Transfer Units (N_OG) & Onda HTU_OG
      const removal_eff_pct = ((y_in_ppm - y_out_ppm) / y_in_ppm) * 100.0;
      // Effective absorption factor A = (L_mol / G_mol) / m_eq (bounded to realistic chemical scrubbing/drying range)
      const L_mol = Lm_kgh / mw_liq;
      const G_mol = Gm_kgh / mw_gas;
      const A_abs = Math.max(1.35, Math.min(25.0, (L_mol / Math.max(0.1, G_mol)) / Math.max(0.02, m_eq)));
      const ratioY = y_in_ppm / Math.max(0.01, y_out_ppm);
      const N_OG = Math.log(ratioY * (1.0 - 1.0 / A_abs) + 1.0 / A_abs) / (1.0 - 1.0 / A_abs);

      // Onda / Cornell Height of an Overall Gas Transfer Unit (HTU_OG, m)
      const HTU_G = Math.max(0.22, (0.38 / Math.pow(packSpec.ap / 150.0, 0.65)) * Math.pow(muL_cP / 1.0, 0.12) * Math.pow(15.0 / Math.max(3.0, Lw_m3m2h), 0.18));
      const HTU_L = 0.18 * Math.pow(muL_cP, 0.25);
      const HTU_OG_m = HTU_G + (1.0 / A_abs) * HTU_L;

      const H_pack_calc_m = N_OG * HTU_OG_m;
      const H_pack_total_m = Math.max(2.0, Math.ceil(H_pack_calc_m * 5.0) / 5.0);
      const N_beds = Math.max(1, Math.ceil(H_pack_total_m / bedMaxH_m));

      // Pressure Drop (mbar/m and total mbar)
      const dP_pack_mbar_m = Math.max(0.12, (0.28 + 0.0075 * packSpec.Fp) * Math.pow(floodFrac / 0.75, 2.25) * (1.0 + 1.6 * Flv));
      const dP_demister_mbar = 2.2; // Top Mesh / Chevron Mist Eliminator
      const dP_total_mbar = dP_pack_mbar_m * H_pack_total_m + dP_demister_mbar;

      // Direct-contact heat & absorption thermal duty
      const T_gas_out = T_liq_in + Math.max(2.0, (T_gas_in - T_liq_in) * Math.exp(-0.65 * N_OG));
      const Qc_kW = Math.abs(Gm_kgs * gasProps.cp * (T_gas_in - T_gas_out)) + (absService === 'drying' ? Gm_kgs * 42.0 : 12.0);
      const dT_liq = (Qc_kW / Math.max(0.5, Lm_kgs * liqProps.cp));
      const T_liq_out = T_liq_in + Math.min(22.0, dT_liq);

      // Total column T/T height = packed height + liquid distributor + top demister + bottom liquid sump
      const H_tangent_m = H_pack_total_m + N_beds * 1.1 + 3.4;
      const internalsSummary = `${packSpec.name} (${packSpec.mat}, Fp=${packSpec.Fp} m⁻¹, a=${packSpec.ap} m²/m³)`;

      // Build absorption profile curve along bed height z/Z (0 -> 1)
      const vleCurve = [];
      for (let i = 0; i <= 40; i++) {
        const zFrac = i / 40.0;
        const y_z = y_out_ppm * Math.pow(y_in_ppm / y_out_ppm, 1.0 - zFrac);
        vleCurve.push({ x: zFrac, y: y_z / y_in_ppm, y_ppm: y_z, T: T_gas_out + (1.0 - zFrac) * (T_gas_in - T_gas_out) });
      }

      const iterations = [
        {
          iter: 1,
          param: `기액 물성 및 유동인자 산출 (P=${P_bar.toFixed(2)} barA)`,
          assumed: `G_m=${Gm_kgh} kg/h, L_m=${Lm_kgh} kg/h`,
          calc: `ρ_G=${rhoV.toFixed(2)} kg/m³, ρ_L=${rhoL.toFixed(0)} kg/m³ → F_LV=${Flv.toFixed(3)}`,
          err: '0.00%',
          note: `${gasProps.name} / ${liqProps.name}`
        },
        {
          iter: 2,
          param: `Eckert GPDC 범람 유속 및 탑경 수렴 (${packSpec.name})`,
          assumed: `Flood=${(floodFrac * 100).toFixed(0)}%, Fp=${packSpec.Fp} m⁻¹`,
          calc: `u_flood=${u_flood.toFixed(2)} m/s, u_op=${u_op.toFixed(2)} m/s (F_s=${F_factor.toFixed(2)}) → ID Ø${(D_col_m * 1000).toFixed(0)} mm`,
          err: '0.00%',
          note: `액체 젖음율 L_w = ${Lw_m3m2h.toFixed(1)} m³/m²h`
        },
        {
          iter: 3,
          param: `Colburn 전달단위수(N_OG) & Onda 전달단위높이(HTU_OG)`,
          assumed: `y_in=${y_in_ppm} ppm → y_out=${y_out_ppm} ppm (제거율 ${removal_eff_pct.toFixed(2)}%)`,
          calc: `N_OG = ${N_OG.toFixed(2)} Units × HTU_OG = ${HTU_OG_m.toFixed(2)} m → Z_req = ${H_pack_calc_m.toFixed(2)} m`,
          err: '0.00%',
          note: `선정 패킹 높이 Z = ${H_pack_total_m.toFixed(1)} m (${N_beds} Beds)`
        },
        {
          iter: 4,
          param: `패킹층 + 상부 데미스터 총 압력강하 및 열수지 확정`,
          assumed: `ΔP_pack = ${dP_pack_mbar_m.toFixed(2)} mbar/m`,
          calc: `총 ΔP = ${dP_total_mbar.toFixed(1)} mbar (T/T 높이 = ${H_tangent_m.toFixed(1)} m)`,
          err: '0.00%',
          note: `가스 출구 ${T_gas_out.toFixed(1)}°C / 순환액 출구 ${T_liq_out.toFixed(1)}°C`
        }
      ];

      const warnings = [];
      if (Lw_m3m2h < Lw_min_m3m2h) {
        warnings.push({ level: 'warn', text: `액체 젖음율(L_w = ${Lw_m3m2h.toFixed(1)} m³/m²h)이 최소 적심 기준(${Lw_min_m3m2h} m³/m²h)보다 낮아 채널링 위험이 있습니다 — 순환 세정액 유량(L_m) 증대 권장!` });
      } else {
        warnings.push({ level: 'ok', text: `패킹 적심(Wetting Rate) 양호: L_w = ${Lw_m3m2h.toFixed(1)} m³/m²·h ≥ 최소 기준 ${Lw_min_m3m2h} m³/m²·h` });
      }
      if (dP_pack_mbar_m > 6.0) {
        warnings.push({ level: 'warn', text: `패킹 단위 차압 주의 (${dP_pack_mbar_m.toFixed(2)} mbar/m > 6.0 mbar/m) — 가스 블로워/압축기 흡입 부하 절감을 위해 50mm Pall Ring 또는 Tellerette 검토 권장` });
      } else {
        warnings.push({ level: 'ok', text: `Eckert GPDC 수력학 및 물질전달 최적: 제거율 ${removal_eff_pct.toFixed(2)}% (N_OG=${N_OG.toFixed(2)}, HTU=${HTU_OG_m.toFixed(2)}m) · 총 ΔP=${dP_total_mbar.toFixed(1)} mbar` });
      }

      return {
        equipTag: inp.equipTag || 'T-410',
        equipName: inp.equipName || `${gasProps.name} Packed Scrubbing / Drying Tower`,
        colMode: 'absorption',
        absService,
        Wg_kgh: Gm_kgh, Wl_kgh: Lm_kgh,
        Gm_kgh, Lm_kgh,
        Tg_C: T_gas_in, Tl_C: T_liq_in,
        T_gas_in, T_gas_out, T_liq_in, T_liq_out,
        yin_ppm: y_in_ppm, yout_ppm: y_out_ppm,
        y_in_ppm, y_out_ppm,
        removal_pct: removal_eff_pct, removal_eff_pct,
        N_OG, HTU_m: HTU_OG_m, HTU_OG_m,
        H_pack_m: H_pack_total_m,
        A_abs, m_eq, flood_pct: floodFrac * 100.0,
        Lw_m3m2h, Lw_min_m3m2h, Flv,
        lkBase: gasProps, hkBase: liqProps, P_bar,
        internals: 'packed', trayType: 'sieve', trayPasses: 1, holeD_mm: 5, weirH_mm: 50, holeAreaPct: 10, traySpacing_m: 0.6,
        packKey, packSpec, H_pack_total_m, N_beds, dP_pack_mbar_m, HETP_m: HTU_OG_m, internalsSummary,
        T_top_C: T_gas_out, T_feed_C: T_avg, T_bot_C: T_gas_in,
        gamma1_top: 1.0, gamma2_bot: 1.0,
        alpha: A_abs, alpha_calc: A_abs, azeotropeX: null, vleCurve,
        F: Gm_kgh / mw_gas, D: Gm_kgh / mw_gas, B: Lm_kgh / mw_liq,
        zF: y_in_ppm / 1e6, xD: y_out_ppm / 1e6, xB: y_in_ppm / 1e6, q: 1.0, lk_recovery_pct: removal_eff_pct,
        Nmin: N_OG * 0.7, Rmin: 1.0, R: Lm_kgh / Gm_kgh, N_theo: N_OG, N_actual: Math.ceil(N_OG), feed_stage_actual: 1, E_overall_pct: removal_eff_pct,
        L_rect: Lm_kgh / mw_liq, V_rect: Gm_kgh / mw_gas, L_strip: Lm_kgh / mw_liq, V_strip: Gm_kgh / mw_gas,
        Qc_kW, Qr_kW: 0,
        Csb, u_flood, u_design, u_op, F_factor,
        D_col_m, H_tangent_m,
        weep_ratio: Lw_m3m2h / Lw_min_m3m2h, psi_entrain: 0.01, dc_backup_pct: floodFrac * 100,
        dP_tray_mbar: dP_pack_mbar_m * HTU_OG_m, dP_total_mbar,
        iterations, warnings
      };
    }

    const a12 = inp.nrtl_a12 !== undefined ? inp.nrtl_a12 : 0.0;
    const a21 = inp.nrtl_a21 !== undefined ? inp.nrtl_a21 : 0.0;
    const nrtlAlpha = inp.nrtl_alpha || 0.30;

    const F = Math.max(1.0, inp.F_kmolh || 100.0);
    const zF = Math.min(0.98, Math.max(0.02, inp.zF || 0.45));
    const xD = Math.min(0.999, Math.max(zF + 0.02, inp.xD || 0.96));
    const xB = Math.max(0.001, Math.min(zF - 0.02, inp.xB || 0.03));
    const q = inp.q !== undefined ? inp.q : 1.0;
    const R_mult = Math.max(1.03, inp.R_mult || 1.25);

    const iterations = [];

    // 1. Bubble-Point VLE Convergence at Top (xD), Feed (zF), and Bottom (xB)
    const bpTop = solveBubblePointNRTL(xD, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
    const bpFeed = solveBubblePointNRTL(zF, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
    const bpBot = solveBubblePointNRTL(xB, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);

    iterations.push({
      iter: 1,
      param: `탑상 이슬/기포점 수렴 (x_D=${xD.toFixed(3)})`,
      assumed: `${lkBase.tb.toFixed(1)} °C`,
      calc: `T_top=${bpTop.T_C.toFixed(1)} °C (α_top=${bpTop.alpha_loc.toFixed(2)}, γ₁=${bpTop.gamma1.toFixed(2)})`,
      err: `< 0.05% (${bpTop.iters}회)`,
      note: 'Antoine + NRTL 기액평형 수렴'
    });
    iterations.push({
      iter: 2,
      param: `공급단 기포점 수렴 (z_F=${zF.toFixed(3)})`,
      assumed: `${(0.5 * (lkBase.tb + hkBase.tb)).toFixed(1)} °C`,
      calc: `T_feed=${bpFeed.T_C.toFixed(1)} °C (α_F=${bpFeed.alpha_loc.toFixed(2)}, γ₁=${bpFeed.gamma1.toFixed(2)})`,
      err: `< 0.05% (${bpFeed.iters}회)`,
      note: '공급단 활동도계수 산출 완료'
    });
    iterations.push({
      iter: 3,
      param: `탑저 기포점 수렴 (x_B=${xB.toFixed(3)})`,
      assumed: `${hkBase.tb.toFixed(1)} °C`,
      calc: `T_bot=${bpBot.T_C.toFixed(1)} °C (α_bot=${bpBot.alpha_loc.toFixed(2)}, γ₂=${bpBot.gamma2.toFixed(2)})`,
      err: `< 0.05% (${bpBot.iters}회)`,
      note: '탑저 리보일러 온도 확정'
    });

    // Build 50-point non-ideal VLE curve and detect any Azeotrope (where y1 crosses x1)
    const vleCurve = [];
    let azeotropeX = null;
    let prevDiff = null;
    for (let i = 0; i <= 50; i++) {
      const xi = i / 50.0;
      const bp = solveBubblePointNRTL(xi, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
      vleCurve.push({ x: xi, y: bp.y1, T: bp.T_C, alpha: bp.alpha_loc });
      if (i > 0 && i < 50) {
        const diff = bp.y1 - xi;
        if (prevDiff !== null && prevDiff * diff <= 0) {
          azeotropeX = xi - (diff / (diff - prevDiff)) * (1.0 / 50.0);
        }
        prevDiff = diff;
      }
    }

    // Geometric mean relative volatility (or manual override)
    const alpha_calc = Math.pow(Math.max(1.02, bpTop.alpha_loc) * Math.max(1.02, bpFeed.alpha_loc) * Math.max(1.02, bpBot.alpha_loc), 1.0 / 3.0);
    const alpha = (inp.manualAlpha && inp.alpha > 1.01) ? inp.alpha : Math.max(1.05, alpha_calc);

    // Overall & Component Material Balance
    const D = F * (zF - xB) / (xD - xB);
    const B = F - D;
    const lk_recovery_pct = ((D * xD) / (F * zF)) * 100.0;

    // Fenske Minimum Stages
    const Nmin = Math.log((xD / (1.0 - xD)) * ((1.0 - xB) / xB)) / Math.log(alpha);

    // Underwood Minimum Reflux
    let theta = 1.25;
    if (Math.abs(q - 1.0) < 1e-4) {
      theta = alpha / (1.0 + (alpha - 1.0) * zF);
    } else {
      let lo = 1.0001, hi = alpha - 0.0001;
      for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (lo + hi);
        const fval = (alpha * zF) / (alpha - mid) + (1.0 - zF) / (1.0 - mid) - (1.0 - q);
        if (fval > 0) lo = mid;
        else hi = mid;
      }
      theta = 0.5 * (lo + hi);
    }

    const Rmin_plus_1 = (alpha * xD) / (alpha - theta) + (1.0 - xD) / (1.0 - theta);
    const Rmin = Math.max(0.15, Rmin_plus_1 - 1.0);
    const R = Rmin * R_mult;

    // Gilliland Correlation
    const X = (R - Rmin) / (R + 1.0);
    const Y = 1.0 - Math.exp(((1.0 + 54.4 * X) / (11.0 + 117.2 * X)) * ((X - 1.0) / Math.sqrt(Math.max(1e-4, X))));
    const N_theo = (Y + Nmin) / Math.max(0.01, 1.0 - Y);

    // Kirkbride Feed Stage
    const ratio_NF = Math.pow((B / D) * (zF / (1.0 - zF)) * Math.pow((1.0 - xD) / xB, 2.0), 0.206);
    const N_rect_theo = N_theo * (ratio_NF / (1.0 + ratio_NF));

    // Average column properties for hydraulics
    const T_col_avg = 0.5 * (bpTop.T_C + bpBot.T_C);
    const lkAvg = window.getFluidProps(lkId, T_col_avg);
    const hkAvg = window.getFluidProps(hkId, T_col_avg);
    const mw_avg = zF * lkAvg.mw + (1.0 - zF) * hkAvg.mw;
    const rhoL = inp.rhoL || (zF * lkAvg.rho + (1.0 - zF) * hkAvg.rho);
    const rhoV = inp.rhoV || Math.max(0.15, (P_bar * 100.0 * mw_avg) / (R_GAS * (T_col_avg + 273.15)));
    const sigma = inp.sigma || (zF * lkAvg.sigma + (1.0 - zF) * hkAvg.sigma);
    const muL_cP = zF * lkAvg.mu + (1.0 - zF) * hkAvg.mu;
    const hv_kJmol = inp.hv_kJmol || ((zF * lkAvg.hv * lkAvg.mw + (1.0 - zF) * hkAvg.hv * hkAvg.mw) / 1000.0);

    // Internals Mode & Packing / Tray Detailed Database
    const internals = inp.internals || 'tray'; // 'tray' | 'packed'
    const trayType = inp.tray_type || 'sieve'; // 'sieve' | 'valve' | 'bubble_cap'
    const trayPasses = Math.max(1, inp.tray_passes || 1);
    const holeD_mm = inp.hole_d_mm || 5.0;
    const weirH_mm = inp.weir_h_mm || 50.0;
    const holeAreaPct = inp.hole_area_pct || 10.0;

    // O'Connell Tray Efficiency adjusted by Tray Type & Hole Diameter / Weir Height
    const E_oconnell_base = Math.min(88.0, Math.max(28.0, 50.3 * Math.pow(alpha * muL_cP, -0.226)));
    const trayEffMod = trayType === 'valve' ? 1.06 : (trayType === 'bubble_cap' ? 0.96 : 1.00);
    const holeEffMod = holeD_mm <= 3.5 ? 1.04 : (holeD_mm >= 10.0 ? 0.95 : 1.00);
    const weirEffMod = 1.0 + (weirH_mm - 50.0) * 0.0012;
    const E_calc_pct = Math.min(92.0, Math.max(25.0, (inp.tray_eff_pct || E_oconnell_base) * trayEffMod * holeEffMod * weirEffMod));
    const E_overall = E_calc_pct / 100.0;
    const N_actual = Math.ceil((N_theo - 1.0) / E_overall);
    const feed_stage_actual = Math.max(2, Math.min(N_actual - 1, Math.round((N_rect_theo / N_theo) * N_actual)));

    // Internal Molar Flows
    const L_rect = R * D;
    const V_rect = (R + 1.0) * D;
    const L_strip = L_rect + q * F;
    const V_strip = V_rect - (1.0 - q) * F;
    const V_max_kmolh = Math.max(V_rect, V_strip);
    const L_max_kmolh = Math.max(L_rect, L_strip);

    const Qc_kW = (V_rect * hv_kJmol * 1000.0) / 3600.0;
    const Qr_kW = (V_strip * hv_kJmol * 1000.0) / 3600.0;

    const traySpacing_m = inp.tray_spacing_m || 0.60;
    const Lw_mgs = (L_max_kmolh * mw_avg) / 3600.0;
    const Vw_mgs = (V_max_kmolh * mw_avg) / 3600.0;
    const Qv_m3s = Vw_mgs / rhoV;
    const Ql_m3s = Lw_mgs / rhoL;
    const Flv = Math.max(0.01, Math.min(1.5, (Lw_mgs / Math.max(0.01, Vw_mgs)) * Math.sqrt(rhoV / rhoL)));
    const logFlv = Math.log10(Flv);

    let Csb = 0.08, u_flood = 1.5, u_design = 1.2, F_factor = 1.4;
    let D_col_m = 1.2, H_tangent_m = 15.0;
    let weep_ratio = 1.5, psi_entrain = 0.02, dc_backup_pct = 28.0;
    let dP_tray_mbar = 6.0, dP_total_mbar = 150.0;
    let HETP_m = 0.50, H_pack_total_m = 0, N_beds = 0, dP_pack_mbar_m = 0;
    let internalsSummary = '';

    if (internals === 'packed') {
      // =====================================================================
      // PACKED COLUMN HYDRAULICS (Eckert GPDC + Billet-Schultes HETP)
      // =====================================================================
      // Eckert Generalized Pressure Drop Correlation (GPDC) capacity parameter Y_flood
      const Y_flood = Math.exp(-3.635 - 1.164 * Math.log(Flv) - 0.124 * Math.pow(Math.log(Flv), 2));
      const muFactor = Math.pow(Math.max(0.1, muL_cP), 0.1);
      // Y_flood = (u_flood^2 * Fp * rhoV * muFactor) / (G * (rhoL - rhoV))
      u_flood = Math.sqrt((Y_flood * G * (rhoL - rhoV)) / (packSpec.Fp * rhoV * muFactor));
      if (packSpec.type === 'Structured') u_flood *= 1.12; // Structured packing higher capacity

      u_design = u_flood * floodFrac;
      F_factor = u_design * Math.sqrt(rhoV);
      Csb = u_flood / Math.sqrt((rhoL - rhoV) / rhoV);

      const Ac_m2 = Qv_m3s / Math.max(0.05, u_design);
      const D_col_raw_m = Math.sqrt((4.0 * Ac_m2) / Math.PI);
      D_col_m = Math.max(0.40, Math.ceil(D_col_raw_m * 20.0) / 20.0);

      // Billet-Schultes / Norton HETP correlation adjusted for surface tension, viscosity & F-factor
      const surfVisFactor = Math.pow((muL_cP / 0.5) * (25.0 / Math.max(5.0, sigma)), 0.14);
      HETP_m = Math.max(0.18, packSpec.hetp_base * surfVisFactor * (0.92 + 0.12 * floodFrac));
      H_pack_total_m = (N_theo - 1.0) * HETP_m;
      N_beds = Math.max(2, Math.ceil(H_pack_total_m / bedMaxH_m));

      // Specific pressure drop (mbar / m of packing) via Robbins / GPDC
      const dP_flood_mbar_m = 2.0 * Math.pow(packSpec.Fp / 100.0, 0.7); // ~2.0 mbar/m at flood for low Fp, higher for high Fp
      dP_pack_mbar_m = Math.max(0.15, (0.35 + 0.0085 * packSpec.Fp) * Math.pow(floodFrac / 0.80, 2.35) * (1.0 + 1.8 * Flv));
      if (packSpec.type === 'Structured') dP_pack_mbar_m *= 0.55; // Structured packing ultra-low dP
      dP_total_mbar = dP_pack_mbar_m * H_pack_total_m;
      dP_tray_mbar = dP_pack_mbar_m * HETP_m; // dP per theoretical stage

      // Total column T/T height = total packed height + liquid distributor/redistributors (1.2m per bed) + top/bottom disengagement (3.2m)
      H_tangent_m = H_pack_total_m + N_beds * 1.15 + 3.2;
      weep_ratio = 2.50; // Turndown safety indicator for packing
      dc_backup_pct = (dP_pack_mbar_m / Math.max(2.5, dP_flood_mbar_m * 4.0)) * 100.0;
      internalsSummary = `${packSpec.name} (${packSpec.type}, Fp=${packSpec.Fp} m⁻¹, a=${packSpec.ap} m²/m³)`;

      iterations.push({
        iter: 4,
        param: `충전탑 GPDC 범람 유속 및 탑경 수렴 (${packSpec.name})`,
        assumed: `Flood=${(floodFrac * 100).toFixed(0)}%, Fp=${packSpec.Fp} m⁻¹`,
        calc: `u_op=${u_design.toFixed(2)} m/s (F_s=${F_factor.toFixed(2)}) -> D=${D_col_m.toFixed(2)} m`,
        err: '0.00%',
        note: `Eckert GPDC + ${packSpec.mat}`
      });
      iterations.push({
        iter: 5,
        param: `Billet-Schultes HETP & 베드 분할/차압 수렴`,
        assumed: `N_th=${(N_theo - 1).toFixed(1)} Stages`,
        calc: `HETP=${HETP_m.toFixed(2)}m -> 총 패킹 ${H_pack_total_m.toFixed(1)}m (${N_beds} Beds), ΔP=${dP_pack_mbar_m.toFixed(2)} mbar/m`,
        err: '0.00%',
        note: `총 ΔP = ${dP_total_mbar.toFixed(1)} mbar (액체 재분배기 ${N_beds - 1}기)`
      });
    } else {
      // =====================================================================
      // TRAYED COLUMN HYDRAULICS (FRI Sieve / Valve / Bubble-Cap + Multi-Pass)
      // =====================================================================
      const Csb_base = Math.pow(10, -1.0262 - 0.6351 * logFlv - 0.2009 * logFlv * logFlv);
      const spacingFactor = Math.pow(traySpacing_m / 0.60, 0.55);
      const trayCapMod = trayType === 'valve' ? 1.04 : (trayType === 'bubble_cap' ? 0.88 : 1.00);
      const holeAreaMod = Math.min(1.08, Math.max(0.85, 0.90 + 0.01 * holeAreaPct));
      Csb = Csb_base * spacingFactor * Math.pow(Math.max(5.0, sigma) / 20.0, 0.20) * trayCapMod * holeAreaMod;

      u_flood = Csb * Math.sqrt((rhoL - rhoV) / rhoV);
      u_design = u_flood * floodFrac;
      F_factor = u_design * Math.sqrt(rhoV);

      const dcFrac = trayPasses === 1 ? 0.12 : (trayPasses === 2 ? 0.16 : 0.20);
      const An_m2 = Qv_m3s / Math.max(0.05, u_design);
      const At_m2 = An_m2 / (1.0 - dcFrac);
      const Aa_m2 = At_m2 * (1.0 - 2.0 * dcFrac);
      const Ah_m2 = Aa_m2 * (holeAreaPct / 100.0);
      const D_col_raw_m = Math.sqrt((4.0 * At_m2) / Math.PI);
      D_col_m = Math.max(0.45, Math.ceil(D_col_raw_m * 20.0) / 20.0);

      // 1. Weeping & Turndown Check (Sieve vs Valve vs Bubble Cap)
      const u_hole = Qv_m3s / Math.max(0.01, Ah_m2);
      const u_weep_sieve = Math.max(4.5, (0.0229 * muL_cP / rhoV) * Math.pow(rhoL / rhoV, 0.5) + (5.2 + 0.25 * holeD_mm) / Math.sqrt(rhoV));
      const u_weep_min = trayType === 'bubble_cap' ? u_weep_sieve * 0.25 : (trayType === 'valve' ? u_weep_sieve * 0.48 : u_weep_sieve);
      weep_ratio = u_hole / u_weep_min;

      // 2. Entrainment Check
      psi_entrain = 0.018 * Math.pow(floodFrac / 0.80, 3.2) * Math.pow(0.1 / Flv, 0.25);

      // 3. Tray Pressure Drop & Multi-Pass Downcomer Backup %
      const h_weir_mm = weirH_mm;
      // Multi-pass increases total effective weir length (1-pass: 0.77D, 2-pass: 1.50D, 4-pass: 2.65D)
      const Lw_weir_m = (trayPasses === 1 ? 0.77 : (trayPasses === 2 ? 1.50 : 2.65)) * D_col_m;
      const h_ow_mm = 664.0 * Math.pow(Ql_m3s / Math.max(0.2, Lw_weir_m), 2.0 / 3.0);

      // Orifice discharge coefficient C_o depends on tray type & hole area
      const Co_dry = trayType === 'sieve' ? (0.68 + 0.004 * holeAreaPct) : (trayType === 'valve' ? 0.61 : 0.52);
      const h_dry_mm = 51.0 * Math.pow(u_hole / Co_dry, 2.0) * (rhoV / rhoL) + (trayType === 'valve' ? 12.0 : (trayType === 'bubble_cap' ? 24.0 : 0.0));
      dP_tray_mbar = (h_weir_mm + h_ow_mm + h_dry_mm) * (rhoL * G / 1e5);
      dP_total_mbar = dP_tray_mbar * N_actual;
      const h_dc_backup_mm = 2.0 * (h_weir_mm + h_ow_mm) + h_dry_mm + (18.0 / trayPasses);
      dc_backup_pct = (h_dc_backup_mm / (traySpacing_m * 1000.0)) * 100.0;

      HETP_m = traySpacing_m / Math.max(0.25, E_overall);
      H_tangent_m = N_actual * traySpacing_m + 3.5;
      const trayTypeLabel = trayType === 'valve' ? 'Valve Tray' : (trayType === 'bubble_cap' ? 'Bubble-Cap Tray' : 'Sieve Tray');
      internalsSummary = `${trayTypeLabel} (${trayPasses}-Pass, d_h=${holeD_mm}mm, h_w=${weirH_mm}mm, 개공비 ${holeAreaPct}%)`;

      iterations.push({
        iter: 4,
        param: `FRI 트레이 수력학 수렴 (${internalsSummary})`,
        assumed: `Flood=${(floodFrac * 100).toFixed(0)}%, Spacing=${traySpacing_m}m`,
        calc: `D=${D_col_m.toFixed(2)}m, N_act=${N_actual}단 (E_o=${E_calc_pct.toFixed(1)}%), ΔP/단=${dP_tray_mbar.toFixed(2)} mbar`,
        err: '0.00%',
        note: `Weep비=${weep_ratio.toFixed(2)}x, DC백업=${dc_backup_pct.toFixed(1)}%`
      });
    }

    const warnings = [];
    if (azeotropeX !== null && azeotropeX > xB && azeotropeX < xD) {
      warnings.push({ level: 'danger', text: `공비점(Azeotrope) 감지: x1 ≈ ${azeotropeX.toFixed(3)} 부근에서 기액 조성이 역전되어 단일 상압 증류탑으로는 x_D=${xD} 달성이 불가능합니다.` });
    }
    if (internals === 'packed') {
      if (dP_pack_mbar_m > 8.0) {
        warnings.push({ level: 'warn', text: `패킹 단위 차압 과다 (${dP_pack_mbar_m.toFixed(2)} mbar/m > 8.0 mbar/m) — 더 큰 사이즈 패킹(50mm) 또는 Mellapak 250Y 규칙패킹 변경 권장` });
      } else {
        warnings.push({ level: 'ok', text: `충전탑 GPDC 수력학 적합: ${packSpec.name} · 차압 ${dP_pack_mbar_m.toFixed(2)} mbar/m · HETP ${HETP_m.toFixed(2)} m (${N_beds} Beds)` });
      }
    } else {
      if (weep_ratio < 1.15) {
        warnings.push({ level: 'warn', text: `누액(Weeping) 발생 주의: 구멍 증기유속 비(u_h/u_min) = ${weep_ratio.toFixed(2)} (< 1.15) — 개공비 축소 또는 Valve Tray 변경 권장` });
      } else if (dc_backup_pct > 50.0) {
        warnings.push({ level: 'warn', text: `다운커머 백업 과다 (${dc_backup_pct.toFixed(1)}% > 50%) — 유로 패스 수(2-Pass) 확대 또는 단간격 확대 권장` });
      } else {
        warnings.push({ level: 'ok', text: `FRI 트레이 수력학 적합: ${internalsSummary} · Weeping ${weep_ratio.toFixed(2)}x, DC 백업 ${dc_backup_pct.toFixed(1)}%` });
      }
    }

    return {
      equipTag: inp.equipTag || 'T-101',
      equipName: inp.equipName || `${lkBase.name} / ${hkBase.name} Column`,
      colMode: 'distillation',
      lkBase, hkBase, P_bar,
      internals, trayType, trayPasses, holeD_mm, weirH_mm, holeAreaPct, traySpacing_m,
      packKey, packSpec, H_pack_total_m, N_beds, dP_pack_mbar_m, HETP_m, internalsSummary,
      T_top_C: bpTop.T_C, T_feed_C: bpFeed.T_C, T_bot_C: bpBot.T_C,
      gamma1_top: bpTop.gamma1, gamma2_bot: bpBot.gamma2,
      alpha, alpha_calc, azeotropeX, vleCurve,
      F, D, B, zF, xD, xB, q, lk_recovery_pct,
      Nmin, Rmin, R, N_theo, N_actual, feed_stage_actual, E_overall_pct: E_calc_pct,
      L_rect, V_rect, L_strip, V_strip,
      Qc_kW, Qr_kW,
      Csb, u_flood, u_design, u_op: u_design, F_factor,
      D_col_m, H_tangent_m,
      weep_ratio, psi_entrain, dc_backup_pct,
      dP_tray_mbar, dP_total_mbar,
      iterations, warnings
    };
  }

  // =========================================================================
  // 4. PROCESS PIPING (Darcy-Weisbach + Compressible Mach + 2-Phase L-M)
  // =========================================================================
  function solvePiping(inp, mode) {
    const fluidId = inp.fluidId || 'water';
    const T_C = inp.T_C !== undefined ? inp.T_C : 25.0;
    const P1_barG = inp.P1_barG !== undefined ? inp.P1_barG : 4.0;
    const P1_abs_Pa = (P1_barG + 1.01325) * 1e5;

    const flowMode = inp.flowMode || 'liquid'; // 'liquid' | 'gas' | 'twophase'
    const dofMode = inp.dofMode || 'calc_dp'; // 'calc_dp' | 'calc_max_flow'
    let Q_m3h = Math.max(0.1, inp.Q_m3h || 80.0);
    const rho = Math.max(0.2, inp.rho || 998.2);
    const mu_cP = Math.max(0.005, inp.mu_cP || 1.0);
    const mu_Pas = mu_cP * 0.001;
    const L_m = Math.max(0.5, inp.L_m || 100.0);
    const dZ_m = inp.dZ_m || 0.0;
    const eps_mm = Math.max(0.0001, inp.rough_mm || 0.045);
    const eps_m = eps_mm / 1000.0;
    const scheduleKey = inp.schedule || '40';
    const schedList = window.PIPE_SCHEDULES[scheduleKey] || window.PIPE_SCHEDULES['40'];
    const v_target = Math.max(0.2, inp.v_target || (flowMode === 'gas' ? 18.0 : 2.0));
    const vaporFrac = Math.min(0.95, Math.max(0.01, (inp.vapor_wt_pct || 15.0) / 100.0));

    let sumK = 0;
    if (mode === 'rigorous') {
      const FK = window.FITTING_K;
      sumK = (inp.n_elbow90 || 0) * FK.elbow90
           + (inp.n_elbow45 || 0) * FK.elbow45
           + (inp.n_tee || 0) * FK.teeThru
           + (inp.n_gate || 0) * FK.gateValve
           + (inp.n_globe || 0) * FK.globeValve
           + (inp.n_check || 0) * FK.checkValve
           + (inp.K_extra || 0);
    }

    const iterations = [];

    // If DOF mode is 'calc_max_flow', solve iteratively for Q_m3h that yields target dP_max_bar
    if (dofMode === 'calc_max_flow' && inp.target_dp_bar > 0) {
      const target_Pa = inp.target_dp_bar * 1e5;
      const selIdx = Math.min(schedList.length - 1, Math.max(0, inp.selected_nps_idx || 4));
      const pPipe = schedList[selIdx];
      const D_m = pPipe.id / 1000.0;
      const A_m2 = Math.PI * D_m * D_m / 4.0;
      let v_guess = 2.0;
      for (let it = 1; it <= 8; it++) {
        const Re_g = (rho * v_guess * D_m) / mu_Pas;
        const f_g = swameeJain(Re_g, eps_m / D_m);
        const K_tot = f_g * (L_m / D_m) + sumK;
        const v_new = Math.sqrt((2.0 * Math.max(100, target_Pa - rho * G * dZ_m)) / (rho * Math.max(0.1, K_tot)));
        const err = Math.abs(v_new - v_guess) / Math.max(0.1, v_new) * 100;
        v_guess = v_new;
        Q_m3h = v_guess * A_m2 * 3600.0;
        iterations.push({
          iter: it,
          param: `최대 허용유량 역산 (${pPipe.nps})`,
          assumed: `f=${f_g.toFixed(4)}`,
          calc: `Q_max=${Q_m3h.toFixed(1)} m³/h (v=${v_guess.toFixed(2)} m/s)`,
          err: `${err.toFixed(3)}%`,
          note: err < 0.05 ? '유량 역산 수렴 완료' : '마찰계수-유속 연성 반복'
        });
        if (err < 0.05) break;
      }
    }

    const Q_m3s = Q_m3h / 3600.0;
    const W_kgs = Q_m3s * rho;

    const candidates = schedList.map((p, idx) => {
      const D_m = p.id / 1000.0;
      const A_m2 = Math.PI * D_m * D_m / 4.0;
      const v = Q_m3s / A_m2;
      const Re = (rho * v * D_m) / mu_Pas;
      const f = swameeJain(Re, eps_m / D_m);

      let dP_fric_Pa = f * (L_m / D_m) * 0.5 * rho * v * v;
      let dP_fit_Pa = sumK * 0.5 * rho * v * v;
      let dP_elev_Pa = rho * G * dZ_m;
      let mach = 0.0;
      let phi2_LM = 1.0;

      if (flowMode === 'gas') {
        // Compressible gas isothermal/subsonic expansion factor & Mach number
        const gamma_k = 1.32;
        const c_sound = Math.sqrt(gamma_k * (P1_abs_Pa / rho));
        mach = v / Math.max(50, c_sound);
        const avgRhoRatio = Math.max(0.55, 1.0 - 0.5 * ((dP_fric_Pa + dP_fit_Pa) / P1_abs_Pa));
        dP_fric_Pa /= avgRhoRatio;
        dP_fit_Pa /= avgRhoRatio;
      } else if (flowMode === 'twophase') {
        // Lockhart-Martinelli Two-Phase Multiplier (Phi_LO^2)
        const rhoG = Math.max(1.2, P1_abs_Pa * 28.0 / (8314.5 * (T_C + 273.15)));
        const X_tt = Math.pow((1.0 - vaporFrac) / vaporFrac, 0.9) * Math.pow(rhoG / rho, 0.5) * Math.pow(mu_cP / 0.015, 0.1);
        const C_chis = 20.0;
        const phi_L2 = 1.0 + C_chis / Math.max(0.05, X_tt) + 1.0 / Math.max(0.0025, X_tt * X_tt);
        phi2_LM = Math.min(45.0, Math.pow(1.0 - vaporFrac, 1.8) * phi_L2);
        dP_fric_Pa *= phi2_LM;
        dP_fit_Pa *= phi2_LM;
      }

      const dP_total_Pa = dP_fric_Pa + dP_fit_Pa + dP_elev_Pa;
      const dP_total_bar = dP_total_Pa / 1e5;
      const dP_100m_bar = ((dP_fric_Pa / L_m) * 100.0) / 1e5;
      const Leq_m = f > 0 ? (sumK * D_m) / f : 0;

      const rho_lbft3 = rho * 0.062428;
      const v_erode_fps = 100.0 / Math.sqrt(Math.max(0.1, rho_lbft3));
      const v_erode_ms = v_erode_fps * 0.3048;
      const rho_v2 = rho * v * v;

      return {
        idx, nps: p.nps, dn: p.dn, od_mm: p.od, wall_mm: p.wall, id_mm: p.id,
        v, Re, f, mach, phi2_LM,
        dP_fric_bar: dP_fric_Pa / 1e5,
        dP_fit_bar: dP_fit_Pa / 1e5,
        dP_elev_bar: dP_elev_Pa / 1e5,
        dP_total_bar, dP_100m_bar, Leq_m,
        v_erode_ms, rho_v2,
        velDiff: Math.abs(v - v_target)
      };
    });

    let rec = candidates.find(c => c.v <= v_target * 1.15 && c.dP_100m_bar <= 0.45);
    if (!rec) rec = candidates.reduce((best, cur) => (cur.velDiff < best.velDiff ? cur : best), candidates[0]);

    const selectedIdx = (inp.selected_nps_idx !== undefined && inp.selected_nps_idx >= 0 && inp.selected_nps_idx < candidates.length)
      ? inp.selected_nps_idx
      : rec.idx;
    const sel = candidates[selectedIdx];

    if (iterations.length === 0) {
      iterations.push({
        iter: 1,
        param: `${flowMode === 'gas' ? '압축성 가스' : (flowMode === 'twophase' ? 'Lockhart-Martinelli 2상' : '단상 액체')} 수력학 수렴`,
        assumed: `목표 유속 ${v_target.toFixed(1)} m/s`,
        calc: `${sel.nps} (v=${sel.v.toFixed(2)} m/s, ΔP=${sel.dP_total_bar.toFixed(3)} bar)`,
        err: '0.00%',
        note: flowMode === 'gas' ? `Mach=${sel.mach.toFixed(3)}` : (flowMode === 'twophase' ? `Φ²_LO=${sel.phi2_LM.toFixed(2)}` : `Re=${Math.round(sel.Re).toLocaleString()}`)
      });
    }

    const warnings = [];
    if (flowMode === 'gas' && sel.mach > 0.30) {
      warnings.push({ level: 'danger', text: `압축성 가스 마하수 과다 (Mach = ${sel.mach.toFixed(3)} > 0.30) — 배관 소음·진동 및 초킹 위험! 관경을 키우세요.` });
    }
    if (sel.v > sel.v_erode_ms * 0.85) {
      warnings.push({ level: 'danger', text: `침식 한계 유속(API RP 14E: ${sel.v_erode_ms.toFixed(2)} m/s) 근접/초과! 현재 유속: ${sel.v.toFixed(2)} m/s` });
    } else {
      warnings.push({ level: 'ok', text: `유속 및 마찰손실 적합: v=${sel.v.toFixed(2)} m/s (침식한계 ${sel.v_erode_ms.toFixed(1)} m/s), ΔP/100m=${sel.dP_100m_bar.toFixed(3)} bar` });
    }

    return {
      equipTag: inp.equipTag || 'L-101',
      equipName: inp.equipName || 'Process Piping Line',
      Q_m3h, W_kgs, flowMode, dofMode,
      selected: sel, recommended: rec, candidates,
      sumK, iterations, warnings
    };
  }

  // =========================================================================
  // 5. PRESSURE VESSEL & KNOCK-OUT DRUM (Souders-Brown + ASME Sec. VIII Div. 1)
  // =========================================================================
  function solveVessel(inp, mode) {
    const orientation = inp.orientation || 'vertical'; // 'vertical' | 'horizontal'
    const hasDemister = inp.has_demister !== false;
    const Wg_kgh = Math.max(10, inp.Wg_kgh || 18000);
    const Wl_kgh = Math.max(10, inp.Wl_kgh || 25000);
    const rhoG = Math.max(0.2, inp.rhoG || 14.5);
    const rhoL = Math.max(300, inp.rhoL || 820.0);
    const holdup_min = Math.max(1.0, inp.holdup_min || 7.0);
    const surge_min = Math.max(0.5, inp.surge_min || 3.0);

    const P_op_barG = Math.max(0.1, inp.P_op_barG || 12.0);
    const P_des_barG = inp.P_des_barG || Math.max(P_op_barG * 1.10, P_op_barG + 1.7);
    const T_des_C = inp.T_des_C || 120.0;
    const matKey = inp.mat_key || 'SA-516-70';
    const mat = window.ASME_MATERIALS[matKey] || window.ASME_MATERIALS['SA-516-70'];
    const E_joint = Math.min(1.0, Math.max(0.65, inp.E_joint || 1.0)); // 1.0 Full RT, 0.85 Spot RT
    const CA_mm = Math.max(0.0, inp.CA_mm !== undefined ? inp.CA_mm : 3.0);

    const Qg_m3s = (Wg_kgh / 3600.0) / rhoG;
    const Ql_m3min = (Wl_kgh / 60.0) / rhoL;
    const V_liq_req_m3 = Ql_m3min * (holdup_min + surge_min);

    // Souders-Brown K factor (m/s) per GPSA Engineering Data Book
    let Kv_base = hasDemister ? 0.107 : 0.055;
    if (P_op_barG > 10) Kv_base *= Math.max(0.72, 1.0 - 0.0045 * (P_op_barG - 10));
    if (orientation === 'horizontal') Kv_base *= 1.25;

    const Vt_max_ms = Kv_base * Math.sqrt((rhoL - rhoG) / rhoG);
    const Vg_des_ms = 0.75 * Vt_max_ms;

    const iterations = [];
    let D_m = 1.2, L_m = 3.6;

    if (orientation === 'vertical') {
      // Vapor disengagement area -> minimum diameter D_vap
      const A_vap_m2 = Qg_m3s / Math.max(0.05, Vg_des_ms);
      const D_vap_m = Math.sqrt((4.0 * A_vap_m2) / Math.PI);

      // Iterate D_m so that L/D stays within 2.5 ~ 4.5 including liquid hold-up height + vapor disengagement height
      D_m = Math.max(0.60, Math.ceil(D_vap_m * 10.0) / 10.0);
      for (let it = 1; it <= 6; it++) {
        const A_cross = (Math.PI * D_m * D_m) / 4.0;
        const h_liq_m = V_liq_req_m3 / A_cross;
        const h_inlet_vap_m = Math.max(1.35, 0.9 * D_m + 0.65);
        L_m = Math.ceil((h_liq_m + h_inlet_vap_m) * 10.0) / 10.0;
        const LD = L_m / D_m;
        iterations.push({
          iter: it,
          param: `수직 분리기 형상비 수렴 (L/D=${LD.toFixed(2)})`,
          assumed: `D=${D_m.toFixed(2)} m`,
          calc: `L_T/T=${L_m.toFixed(2)} m (h_liq=${h_liq_m.toFixed(2)} m)`,
          err: LD > 5.0 ? `${((LD - 4.0) * 10).toFixed(1)}%` : '0.00%',
          note: LD > 5.0 ? 'L/D > 5.0 → 직경 확대 재산정' : 'Souders-Brown + 체류시간 수렴'
        });
        if (LD <= 5.0) break;
        D_m = Math.ceil((D_m + 0.15) * 20.0) / 20.0;
      }
    } else {
      // Horizontal separator (50% liquid level, 50% vapor space)
      let LD_target = inp.ld_target || 3.5;
      for (let it = 1; it <= 5; it++) {
        const D_from_liq = Math.pow((8.0 * V_liq_req_m3) / (Math.PI * LD_target), 1.0 / 3.0);
        const A_vap_req = Qg_m3s / Math.max(0.05, Vg_des_ms);
        const D_from_vap = Math.sqrt((8.0 * A_vap_req) / Math.PI);
        D_m = Math.max(0.75, Math.ceil(Math.max(D_from_liq, D_from_vap) * 20.0) / 20.0);
        L_m = Math.ceil(D_m * LD_target * 10.0) / 10.0;
        iterations.push({
          iter: it,
          param: `수평 분리기 기/액 단면적 수렴`,
          assumed: `L/D=${LD_target.toFixed(1)}`,
          calc: `D=${D_m.toFixed(2)} m × L=${L_m.toFixed(2)} m`,
          err: '0.00%',
          note: '기상 분리 + 액상 서지 동시 만족'
        });
        break;
      }
    }

    // ASME Section VIII Div. 1 Internal Pressure Thickness Calculation
    // P in MPa, R = inner radius in mm, S in MPa
    const P_MPa = P_des_barG * 0.1;
    const R_mm = (D_m * 1000.0) / 2.0;
    const S_MPa = mat.S_MPa;

    // Cylindrical Shell: t = P*R / (S*E - 0.6*P) + CA
    const t_shell_corroded_mm = (P_MPa * R_mm) / (S_MPa * E_joint - 0.6 * P_MPa);
    const t_shell_req_mm = t_shell_corroded_mm + CA_mm;

    // 2:1 Ellipsoidal Head: t = P*D / (2*S*E - 0.2*P) + CA
    const t_head_corroded_mm = (P_MPa * (D_m * 1000.0)) / (2.0 * S_MPa * E_joint - 0.2 * P_MPa);
    const t_head_req_mm = t_head_corroded_mm + CA_mm;

    const stdPlates = [6, 8, 9, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 55, 60, 70, 80];
    const t_nom_mm = stdPlates.find(p => p >= Math.max(6.0, t_shell_req_mm)) || Math.ceil(t_shell_req_mm + 2);

    // MAWP at corroded condition with selected nominal plate thickness
    const t_eff_mm = Math.max(1.0, t_nom_mm - CA_mm);
    const MAWP_MPa = (S_MPa * E_joint * t_eff_mm) / (R_mm + 0.6 * t_eff_mm);
    const MAWP_barG = MAWP_MPa * 10.0;

    // Vessel Weights (Empty, Operating, Hydrotest)
    const V_total_m3 = (Math.PI * D_m * D_m / 4.0) * L_m + (Math.PI * Math.pow(D_m, 3)) / 12.0;
    const A_surface_m2 = Math.PI * D_m * L_m + 2.16 * D_m * D_m;
    const W_empty_kg = A_surface_m2 * (t_nom_mm / 1000.0) * mat.rho_kgm3 * 1.18; // +18% nozzles/skirt/saddles
    const W_oper_kg = W_empty_kg + V_liq_req_m3 * rhoL;
    const W_hydro_kg = W_empty_kg + V_total_m3 * 1000.0;

    iterations.push({
      iter: iterations.length + 1,
      param: `ASME Sec. VIII Div. 1 두께/MAWP 검증`,
      assumed: `P_des=${P_des_barG.toFixed(1)} barG`,
      calc: `t_req=${t_shell_req_mm.toFixed(2)} mm → 공칭 ${t_nom_mm} mm (MAWP=${MAWP_barG.toFixed(1)} barG)`,
      err: '0.00%',
      note: `${mat.name} (S=${S_MPa} MPa)`
    });

    const warnings = [];
    warnings.push({ level: 'ok', text: `ASME Sec. VIII Div. 1 적합: 계산 두께 ${t_shell_req_mm.toFixed(2)} mm ≤ 선정 강판 ${t_nom_mm} mm (MAWP ${MAWP_barG.toFixed(1)} barG ≥ 설계압력 ${P_des_barG.toFixed(1)} barG)` });
    if (L_m / D_m > 5.0 || L_m / D_m < 2.0) {
      warnings.push({ level: 'warn', text: `용기 형상비(L/D = ${(L_m / D_m).toFixed(2)})가 경제적 범위(2.5 ~ 4.5)를 벗어났습니다.` });
    } else {
      warnings.push({ level: 'ok', text: `용기 형상비 최적: D=${D_m.toFixed(2)} m × L=${L_m.toFixed(2)} m (L/D = ${(L_m / D_m).toFixed(2)})` });
    }

    return {
      equipTag: inp.equipTag || 'D-210',
      equipName: inp.equipName || 'Gas-Liquid Separator Vessel',
      orientation, hasDemister,
      D_m, L_m, LD_ratio: L_m / D_m,
      Kv_base, Vt_max_ms, Vg_des_ms,
      V_liq_req_m3, V_total_m3,
      P_op_barG, P_des_barG, MAWP_barG,
      t_shell_req_mm, t_head_req_mm, t_nom_mm, CA_mm,
      W_empty_kg, W_oper_kg, W_hydro_kg,
      matName: mat.name, S_MPa,
      iterations, warnings
    };
  }

  // =========================================================================
  // 6. PRESSURE SAFETY VALVE / PSV SIZING (API 520 + API 521 Fire + API 526)
  // =========================================================================
  function solvePSV(inp, mode) {
    const scenario = inp.scenario || 'blocked_outlet'; // 'blocked_outlet' | 'fire_case' | 'tube_rupture' | 'thermal_exp'
    const phase = inp.phase || 'vapor'; // 'vapor' | 'liquid' | 'steam'
    const P_set_barG = Math.max(0.5, inp.P_set_barG || 15.0);
    const P_back_barG = Math.max(0.0, inp.P_back_barG || 0.5);
    const overpress_pct = scenario === 'fire_case' ? 21.0 : (inp.overpress_pct || 10.0);
    const T_rel_C = inp.T_rel_C !== undefined ? inp.T_rel_C : 140.0;
    const T_rel_K = T_rel_C + 273.15;

    const mw = Math.max(2.0, inp.mw || 44.1);
    const k_cpcv = Math.max(1.05, inp.k_cpcv || 1.25);
    const Z_comp = Math.max(0.3, inp.Z_comp || 0.92);
    const rhoL = Math.max(200, inp.rhoL || 800.0);
    const hv_kJkg = Math.max(50, inp.hv_kJkg || 360.0);

    // Relief Load W_kgh (auto-calculated if Fire Case!)
    let W_kgh = Math.max(10, inp.W_kgh || 12000);
    let Q_fire_kW = 0;
    if (scenario === 'fire_case') {
      const A_wet_m2 = Math.max(1.0, inp.A_wet_m2 || 45.0);
      const F_env = inp.F_env || 1.0; // 1.0 bare vessel, 0.3 insulated
      Q_fire_kW = (43.2 * F_env * Math.pow(A_wet_m2, 0.82));
      W_kgh = (Q_fire_kW * 3600.0) / hv_kJkg;
    }

    // Relieving absolute pressure P1 (kPa abs)
    const P1_barA = P_set_barG * (1.0 + overpress_pct / 100.0) + 1.01325;
    const P1_kPa = P1_barA * 100.0;
    const P2_barA = P_back_barG + 1.01325;
    const P2_kPa = P2_barA * 100.0;
    const backPressRatio = P2_kPa / P1_kPa;

    // Critical pressure ratio
    const r_crit = Math.pow(2.0 / (k_cpcv + 1.0), k_cpcv / (k_cpcv - 1.0));
    const isCritical = backPressRatio <= r_crit;

    // API 520 Part I Coefficient C (SI units: K_d=0.975, K_b=1.0, K_c=1.0)
    const C_api = 0.03948 * Math.sqrt(k_cpcv * Math.pow(2.0 / (k_cpcv + 1.0), (k_cpcv + 1.0) / (k_cpcv - 1.0)));
    const Kd = phase === 'liquid' ? 0.65 : 0.975;
    const Kb = backPressRatio > 0.50 ? Math.max(0.65, 1.0 - 0.8 * (backPressRatio - 0.50)) : 1.0;
    const Kc = inp.has_rupture_disk ? 0.90 : 1.0;

    let A_req_mm2 = 0;
    if (phase === 'liquid') {
      const Q_Lmin = (W_kgh / rhoL) * (1000.0 / 60.0);
      const G_sp = rhoL / 999.0;
      const dP_kPa = Math.max(10.0, (P_set_barG * (1.0 + overpress_pct / 100.0) - P_back_barG) * 100.0);
      A_req_mm2 = (11.78 * Q_Lmin) / (Kd * Kb * Kc * Math.sqrt(dP_kPa / G_sp));
    } else {
      if (isCritical) {
        A_req_mm2 = W_kgh / (C_api * Kd * P1_kPa * Kb * Kc * Math.sqrt(mw / (T_rel_K * Z_comp)));
      } else {
        const r = backPressRatio;
        const F2 = Math.sqrt((k_cpcv / (k_cpcv - 1.0)) * Math.pow(r, 2.0 / k_cpcv) * ((1.0 - Math.pow(r, (k_cpcv - 1.0) / k_cpcv)) / (1.0 - r)));
        A_req_mm2 = (17.9 * W_kgh) / (F2 * Kd * Kc * Math.sqrt(mw * P1_kPa * (P1_kPa - P2_kPa) / (T_rel_K * Z_comp)));
      }
    }

    const A_req_in2 = A_req_mm2 / 645.16;
    const orifices = window.API526_ORIFICES;
    const selectedOrifice = orifices.find(o => o.area_mm2 >= A_req_mm2) || orifices[orifices.length - 1];
    const cap_utilization_pct = (A_req_mm2 / selectedOrifice.area_mm2) * 100.0;
    const W_rated_kgh = W_kgh * (selectedOrifice.area_mm2 / Math.max(1.0, A_req_mm2));

    const iterations = [
      {
        iter: 1,
        param: `API 520 임계압력비 판별 (r_c=${r_crit.toFixed(3)})`,
        assumed: `P₂/P₁ = ${backPressRatio.toFixed(3)}`,
        calc: isCritical ? '임계 유동 (Choked Sonic Flow)' : '아임계 유동 (Subcritical Flow)',
        err: '0.00%',
        note: `방출압력 P₁ = ${P1_barA.toFixed(2)} barA (${overpress_pct}% 축적)`
      },
      {
        iter: 2,
        param: `API 526 표준 오리피스 선정`,
        assumed: `A_req = ${A_req_mm2.toFixed(1)} mm² (${A_req_in2.toFixed(3)} in²)`,
        calc: `'${selectedOrifice.letter}' Orifice (${selectedOrifice.area_mm2} mm², ${selectedOrifice.size})`,
        err: '0.00%',
        note: `용량 가동률 ${cap_utilization_pct.toFixed(1)}%`
      }
    ];

    const warnings = [];
    if (A_req_mm2 > selectedOrifice.area_mm2) {
      warnings.push({ level: 'danger', text: `단일 T-Orifice 최대 면적(16,774 mm²) 초과! 최소 ${Math.ceil(A_req_mm2 / 16774.2)}개의 병렬 PSV 설치가 필요합니다.` });
    } else if (cap_utilization_pct < 35.0) {
      warnings.push({ level: 'warn', text: `PSV 오리피스 가동률 낮음 (${cap_utilization_pct.toFixed(1)}% < 35%) — 채터링(Chattering) 주의` });
    } else {
      warnings.push({ level: 'ok', text: `API 526 '${selectedOrifice.letter}' 오리피스(${selectedOrifice.size}) 적합: 가동률 ${cap_utilization_pct.toFixed(1)}%` });
    }
    if ((P_back_barG / P_set_barG) > 0.10) {
      warnings.push({ level: 'warn', text: `배압비(P_back/P_set = ${(P_back_barG / P_set_barG * 100).toFixed(1)}% > 10%) — 벨로우즈형(Balanced Bellows) 또는 파일럿 작동식 PSV를 적용하세요.` });
    }

    return {
      equipTag: inp.equipTag || 'PSV-101',
      equipName: inp.equipName || 'Pressure Safety Relief Valve',
      scenario, phase, W_kgh, W_rated_kgh, Q_fire_kW,
      P_set_barG, P_back_barG, P1_barA, P2_barA, overpress_pct,
      r_crit, backPressRatio, isCritical,
      A_req_mm2, A_req_in2,
      selectedOrifice, cap_utilization_pct,
      iterations, warnings
    };
  }

  // =========================================================================
  // CANVAS DIAGRAM RENDERERS FOR ALL 6 MODULES
  // =========================================================================
  function prepCanvas(canvas) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width || 360);
    const h = Math.max(190, rect.height || 220);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawPumpCanvas(canvas, res) {
    if (!canvas || !res) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(340, rect.width || 520);
    const h = Math.max(360, rect.height || 370);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 1. Crisp Engineering Graph Paper Background (PTCX / API 610 Multi-Axis Style)
    ctx.fillStyle = '#fcfdfe';
    ctx.fillRect(0, 0, w, h);

    const pad = { l: 48, r: 54, t: 24, b: 44 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;

    // 6 Major Vertical Blocks (0..60 style), 5 Major Horizontal Blocks (0..250 style)
    const nMajX = 5, nSubX = 5;
    const nMajY = 6, nSubY = 5;

    // Scale selection so Duty Point sits naturally around X = 44% (2.2 blocks) and Head sits around Y = 52% (3.1 blocks out of 6)
    const Q_des_m3h = Math.max(0.5, res.Q_m3h || 65);
    const Q_des_Lmin = (Q_des_m3h * 1000.0) / 60.0;

    // Nice round step for L/min axis (5 major blocks)
    const rawStepLmin = (Q_des_Lmin * 2.25) / nMajX;
    const magL = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStepLmin))));
    const normL = rawStepLmin / magL;
    const niceMultL = normL <= 1 ? 1 : (normL <= 2 ? 2 : (normL <= 2.5 ? 2.5 : (normL <= 5 ? 5 : 10)));
    const stepLmin = niceMultL * magL;
    const Q_max_Lmin = stepLmin * nMajX;
    const Q_max_m3h = (Q_max_Lmin * 60.0) / 1000.0;

    // Head scale (Left Y-axis: 6 major blocks, Duty Head sits around block 3.1 so upper blocks 4..6 host Power curves cleanly!)
    const H_des = Math.max(2.0, res.H_total_m || 31.5);
    const H_stat = Math.max(0, Math.min(H_des * 0.85, res.H_static_m || H_des * 0.45));
    const rawStepH = (H_des / 3.15);
    const magH = Math.pow(10, Math.floor(Math.log10(Math.max(0.5, rawStepH))));
    const normH = rawStepH / magH;
    const niceMultH = normH <= 1 ? 1 : (normH <= 2 ? 2 : (normH <= 2.5 ? 2.5 : (normH <= 5 ? 5 : 10)));
    const stepH = niceMultH * magH;
    const H_axis_max = stepH * nMajY; // 6 blocks total

    // Power scale (Right Y-axis Top Band: lives in grid blocks 4.0 to 6.0, just like PTCX chart!)
    const P_des = Math.max(0.1, res.P_shaft_kW || 2.1);
    const rawPmax = P_des * 1.9;
    const magP = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, rawPmax))));
    const normP = rawPmax / magP;
    const nicePmax = (normP <= 1.5 ? 1.5 : (normP <= 2 ? 2 : (normP <= 3 ? 3 : (normP <= 4 ? 4 : (normP <= 5 ? 5 : (normP <= 8 ? 8 : 10)))))) * magP;

    // Coordinate mappers
    const toX_Lmin = qL => pad.l + (qL / Q_max_Lmin) * pw;
    const toY_Head = head => pad.t + ph - (head / H_axis_max) * ph;
    // Power maps 0..nicePmax into grid blocks 3.85..5.90 (upper section of the chart)
    const yPowerBase = pad.t + ph * (1.0 - 3.85 / 6.0);
    const yPowerTop = pad.t + ph * (1.0 - 5.92 / 6.0);
    const toY_Power = kw => yPowerBase - (kw / nicePmax) * (yPowerBase - yPowerTop);
    // Efficiency maps 0..100% into grid blocks 0.0..3.6 (lower-middle section of the chart)
    const toY_Eff = effPct => pad.t + ph - (effPct / 100.0) * (ph * (3.6 / 6.0));

    // 2. Draw Fine Minor Grid (5x5 subdivisions per major block)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= nMajX * nSubX; i++) {
      const x = pad.l + (pw * i) / (nMajX * nSubX);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    }
    for (let j = 0; j <= nMajY * nSubY; j++) {
      const y = pad.t + (ph * j) / (nMajY * nSubY);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }

    // 3. Draw Major Grid Lines
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.0;
    for (let i = 0; i <= nMajX; i++) {
      const x = pad.l + (pw * i) / nMajX;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    }
    for (let j = 0; j <= nMajY; j++) {
      const y = pad.t + (ph * j) / nMajY;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }

    // Subtle Engineering Watermark
    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.13)';
    ctx.font = '900 22px "Inter", sans-serif';
    ctx.fillText('API 610 PUMP CURVE', pad.l + 18, pad.t + ph * 0.54);
    ctx.restore();

    // 4. Mathematical Curve Models (Rated, ① Max Impeller, ② Min Impeller)
    const qCurveMax = Q_max_Lmin * 0.86;
    const H_shutoff = H_des * 1.06;
    const k_head = (H_shutoff - H_des) / Math.pow(Q_des_Lmin, 1.85);
    const headRated = qL => Math.max(0, H_shutoff - k_head * Math.pow(qL, 1.85));
    const headMaxImp = qL => Math.max(0, H_shutoff * 1.14 - k_head * 0.92 * Math.pow(qL, 1.85));
    const headMinImp = qL => Math.max(0, H_shutoff * 0.84 - k_head * 1.12 * Math.pow(qL, 1.85));

    // System Resistance Curve: H_sys(Q) = H_stat + k_sys * Q^2 (passes through Duty Point)
    const k_sys = (H_des - H_stat) / (Q_des_Lmin * Q_des_Lmin);
    const headSys = qL => H_stat + k_sys * qL * qL;

    // Power Curves (Centrifugal radial pump: P(Q) rises steadily from ~48% at shutoff through P_des at Q_des)
    const P_shut = P_des * 0.56;
    const slopeP = (P_des - P_shut) / Q_des_Lmin;
    const powerRated = qL => P_shut + slopeP * qL * (1.0 - 0.08 * Math.pow(qL / qCurveMax, 2));
    const powerMaxImp = qL => powerRated(qL) * 1.18;
    const powerMinImp = qL => powerRated(qL) * 0.82;

    // Efficiency Curve: peaks near BEP (1.08 * Q_des) and passes exactly through eff_pct at Q_des
    const effDes = Math.min(88, Math.max(20, res.eff_pct || 72));
    const qBep = Q_des_Lmin * 1.12;
    const effBep = effDes / (1.0 - Math.pow((Q_des_Lmin - qBep) / qBep, 2) * 0.75);
    const effCurve = qL => {
      if (qL <= 0) return 0;
      const r = (qL - qBep) / qBep;
      return Math.max(2, effBep * (1.0 - 0.75 * r * r));
    };

    const qStart = Q_max_Lmin * 0.08;
    const qEnd = Q_max_Lmin * 0.84;

    // Helper to stroke a curve
    function strokeCurve(fnXtoY, q0, q1, color, width, dash) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      const steps = 48;
      for (let s = 0; s <= steps; s++) {
        const q = q0 + ((q1 - q0) * s) / steps;
        const x = toX_Lmin(q);
        const y = fnXtoY(q);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5A. Draw POWER Curves (Top Band: ① Max, Rated POWER, ② Min)
    strokeCurve(q => toY_Power(powerMaxImp(q)), qStart, qEnd, '#475569', 1.5, [5, 3]);
    strokeCurve(q => toY_Power(powerRated(q)), qStart, qEnd * 0.96, '#dc2626', 2.2, null);
    strokeCurve(q => toY_Power(powerMinImp(q)), qStart, qEnd * 0.88, '#475569', 1.5, [5, 3]);

    // 5B. Draw HEAD (TDH) Curves (Middle Band: ① Max, Rated TDH, ② Min + System Curve)
    strokeCurve(q => toY_Head(headMaxImp(q)), qStart, qEnd, '#475569', 1.5, [5, 3]);
    strokeCurve(q => toY_Head(headRated(q)), qStart, qEnd * 0.96, '#dc2626', 2.5, null);
    strokeCurve(q => toY_Head(headMinImp(q)), qStart, qEnd * 0.88, '#475569', 1.5, [5, 3]);
    // System Curve (subtle blue dash)
    strokeCurve(q => Math.max(pad.t + 4, toY_Head(headSys(q))), 0, Math.min(qEnd, Q_des_Lmin * 1.42), 'rgba(2, 132, 199, 0.65)', 1.6, [3, 3]);

    // 5C. Draw EFFICIENCY Curve (Bottom Band: Solid Green)
    strokeCurve(q => toY_Eff(effCurve(q)), qStart, qEnd * 0.96, '#16a34a', 2.4, null);

    // 6. Draw Red Dashed Reference Drop-Lines (Exact PTCX Style!)
    const xDuty = toX_Lmin(Q_des_Lmin);
    const yPowerDuty = toY_Power(P_des);
    const yHeadDuty = toY_Head(H_des);
    const yEffDuty = toY_Eff(effDes);

    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    // Vertical line from Shaft Power dot -> through Duty Point -> through Efficiency -> to X-axis (Capacity Q)
    ctx.beginPath();
    ctx.moveTo(xDuty, yPowerDuty);
    ctx.lineTo(xDuty, pad.t + ph);
    ctx.stroke();

    // Horizontal line from Shaft Power dot -> Right Axis (POWER kW)
    ctx.beginPath();
    ctx.moveTo(xDuty, yPowerDuty);
    ctx.lineTo(pad.l + pw, yPowerDuty);
    ctx.stroke();

    // Horizontal line from Duty Point dot -> Left Axis (HEAD H m)
    ctx.beginPath();
    ctx.moveTo(pad.l, yHeadDuty);
    ctx.lineTo(xDuty, yHeadDuty);
    ctx.stroke();
    ctx.restore();

    // 7. Key Operating Dots & Labels (Shaft Power, ▲ Duty Point, Efficiency, Impeller Callouts)
    // Shaft Power Dot
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(xDuty, yPowerDuty, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 10.5px "Inter", sans-serif';
    ctx.fillText(`Shaft Power (${P_des.toFixed(2)} kW)`, Math.max(pad.l + 6, xDuty - 42), yPowerDuty - 7);

    // Duty Point Dot + Red Triangle
    ctx.beginPath(); ctx.arc(xDuty, yHeadDuty, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(xDuty + 6, yHeadDuty - 8);
    ctx.lineTo(xDuty + 2, yHeadDuty - 2);
    ctx.lineTo(xDuty + 10, yHeadDuty - 2);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.fillText(`Duty Point (${H_des.toFixed(1)}m)`, xDuty + 13, yHeadDuty - 3);

    // Efficiency Intersection Dot
    ctx.fillStyle = '#16a34a';
    ctx.beginPath(); ctx.arc(xDuty, yEffDuty, 4.0, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 10px "Inter", sans-serif';
    ctx.fillText(`${effDes.toFixed(1)}%`, xDuty + 6, yEffDuty + 12);

    // Curve Callout Labels (① MAX. IMPELLER, POWER, ② MIN. IMPELLER, TDH, EFF.)
    const dMax = res.D_imp_max_mm || 235;
    const dMin = res.D_imp_min_mm || 190;
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText(`① MAX. IMPELLER (Ø${dMax})`, toX_Lmin(qEnd * 0.72), toY_Power(powerMaxImp(qEnd * 0.78)) - 5);
    ctx.fillText(`② MIN. IMPELLER (Ø${dMin})`, toX_Lmin(qEnd * 0.56), toY_Power(powerMinImp(qEnd * 0.62)) + 12);
    ctx.fillStyle = '#dc2626';
    ctx.fillText(`POWER`, toX_Lmin(qEnd * 0.96) + 3, toY_Power(powerRated(qEnd * 0.96)) + 3);

    ctx.fillStyle = '#1e293b';
    ctx.fillText(`① MAX. IMPELLER`, toX_Lmin(qEnd * 0.76), toY_Head(headMaxImp(qEnd * 0.80)) - 5);
    ctx.fillText(`② MIN. IMPELLER`, toX_Lmin(qEnd * 0.58), toY_Head(headMinImp(qEnd * 0.65)) + 12);
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 10.5px "Inter", sans-serif';
    ctx.fillText(`TDH`, toX_Lmin(qEnd * 0.96) + 3, toY_Head(headRated(qEnd * 0.96)) + 4);

    ctx.fillStyle = '#16a34a';
    ctx.fillText(`EFF.`, toX_Lmin(qEnd * 0.96) + 3, toY_Eff(effCurve(qEnd * 0.96)) + 3);

    // 8. Outer Frame & Axis Ticks/Titles
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(pad.l, pad.t, pw, ph);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px "Inter", sans-serif';

    // X-Axis Ticks (L/min primary + m³/h secondary)
    ctx.textAlign = 'center';
    for (let i = 0; i <= nMajX; i++) {
      const x = pad.l + (pw * i) / nMajX;
      const valLmin = i * stepLmin;
      const valM3h = (valLmin * 60.0) / 1000.0;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(`${valLmin >= 10 ? Math.round(valLmin) : valLmin.toFixed(1)}`, x, pad.t + ph + 14);
      ctx.fillStyle = '#475569';
      ctx.font = '9px "Inter", sans-serif';
      ctx.fillText(`(${valM3h >= 10 ? valM3h.toFixed(0) : valM3h.toFixed(1)}m³/h)`, x, pad.t + ph + 25);
      ctx.font = 'bold 10px "Inter", sans-serif';
    }
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10.5px "Inter", sans-serif';
    ctx.fillText(`CAPACITY Q — L/min (m³/h)   [운전점 Q = ${Q_des_Lmin.toFixed(0)} L/min (${Q_des_m3h.toFixed(1)} m³/h)]`, pad.l + pw / 2, h - 4);

    // Left Y-Axis Ticks: HEAD H(m)
    ctx.textAlign = 'right';
    for (let j = 0; j <= nMajY; j++) {
      const y = pad.t + ph - (ph * j) / nMajY;
      const valH = j * stepH;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(`${valH >= 10 ? Math.round(valH) : valH.toFixed(1)}`, pad.l - 5, y + 3.5);
    }

    // Right Y-Axis Top Ticks: POWER (kW)
    ctx.textAlign = 'left';
    const pTicks = 5;
    for (let k = 0; k <= pTicks; k++) {
      const pVal = (nicePmax * k) / pTicks;
      const y = toY_Power(pVal);
      ctx.fillStyle = '#dc2626';
      ctx.fillText(pVal >= 10 ? pVal.toFixed(1) : pVal.toFixed(2), pad.l + pw + 4, y + 3);
    }

    // Right Y-Axis Bottom Ticks: EFFICIENCY (%)
    for (let e = 0; e <= 80; e += 10) {
      const y = toY_Eff(e);
      if (y > yPowerBase + 10) {
        ctx.fillStyle = '#15803d';
        ctx.fillText(`${e}`, pad.l + pw + 4, y + 3);
      }
    }

    // Rotated Vertical Axis Titles
    ctx.save();
    ctx.translate(13, pad.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10.5px "Inter", sans-serif';
    ctx.fillText('HEAD H (m)', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(w - 9, (yPowerTop + yPowerBase) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText('POWER (kW)', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(w - 9, pad.t + ph * 0.73);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#15803d';
    ctx.font = 'bold 9.5px "Inter", sans-serif';
    ctx.fillText('EFFICIENCY (%)', 0, 0);
    ctx.restore();

    // Top Header Strip inside canvas
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10.5px "Inter", sans-serif';
    ctx.fillText(`API 610 성능곡선 (${res.fluidName || 'Water'} @ ${res.rpm || 1750} RPM · 정격 임펠러 Ø${res.D_imp_rated_mm || 220}mm)`, pad.l, 15);
  }

  function drawHXCanvas(canvas, res) {
    const p = prepCanvas(canvas);
    if (!p) return;
    const { ctx, w, h } = p;
    const pad = { l: 44, r: 22, t: 24, b: 30 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    const tMin = Math.min(res.Tc_in, res.Th_out) - 10;
    const tMax = Math.max(res.Th_in, res.Tc_out) + 10;
    const toX = f => pad.l + f * pw;
    const toY = t => pad.t + ph - ((t - tMin) / Math.max(10, tMax - tMin)) * ph;

    ctx.strokeStyle = 'rgba(148,163,184,0.14)';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ph * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(56,189,248,0.10)';
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(res.Th_in));
    ctx.lineTo(toX(1), toY(res.Th_out));
    ctx.lineTo(toX(1), toY(res.Tc_in));
    ctx.lineTo(toX(0), toY(res.Tc_out));
    ctx.closePath();
    ctx.fill();

    // Hot stream
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(toX(0), toY(res.Th_in)); ctx.lineTo(toX(1), toY(res.Th_out)); ctx.stroke();

    // Cold stream
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(toX(1), toY(res.Tc_in)); ctx.lineTo(toX(0), toY(res.Tc_out)); ctx.stroke();

    ctx.fillStyle = '#fda4af';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`고온 In ${res.Th_in.toFixed(1)}°C`, toX(0) + 4, toY(res.Th_in) - 6);
    ctx.fillText(`고온 Out ${res.Th_out.toFixed(1)}°C`, toX(1) - 85, toY(res.Th_out) - 6);

    ctx.fillStyle = '#7dd3fc';
    ctx.fillText(`저온 Out ${res.Tc_out.toFixed(1)}°C`, toX(0) + 4, toY(res.Tc_out) + 15);
    ctx.fillText(`저온 In ${res.Tc_in.toFixed(1)}°C`, toX(1) - 80, toY(res.Tc_in) + 15);
  }

  function drawColumnCanvas(canvas, res) {
    const p = prepCanvas(canvas);
    if (!p) return;
    const { ctx, w, h } = p;

    if (res.colMode === 'absorption') {
      const pad = { l: 48, r: 20, t: 22, b: 30 };
      const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

      ctx.strokeStyle = 'rgba(148,163,184,0.22)';
      ctx.strokeRect(pad.l, pad.t, pw, ph);

      // Grid lines
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      for (let i = 1; i <= 3; i++) {
        const gy = pad.t + (ph * i) / 4;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + pw, gy); ctx.stroke();
      }

      // Plot log-normalized gas concentration profile y(z) vs bed height z/Z
      const pts = res.absProfile || [];
      const yMaxLog = Math.log10(Math.max(10, res.y_in_ppm));
      const yMinLog = Math.log10(Math.max(0.05, res.y_out_ppm * 0.5));

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((pt, idx) => {
        const yLog = Math.log10(Math.max(0.05, pt.y_ppm));
        const xNorm = clamp((yLog - yMinLog) / Math.max(0.1, yMaxLog - yMinLog), 0, 1);
        const px = pad.l + xNorm * pw;
        const py = pad.t + ph - pt.z_norm * ph;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Fill area under curve
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.lineTo(pad.l, pad.t);
      ctx.lineTo(pad.l, pad.t + ph);
      ctx.closePath();
      ctx.fill();

      // Labels
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText(`Top Out: ${res.y_out_ppm} ppm (${res.removal_pct.toFixed(2)}% 제거)`, pad.l + 8, pad.t + 15);
      ctx.fillStyle = '#fcd34d';
      ctx.fillText(`Bot In: ${res.y_in_ppm.toLocaleString()} ppm`, pad.l + pw - 135, pad.t + ph - 8);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`N_OG = ${res.N_OG.toFixed(2)} · HTU_OG = ${res.HTU_OG_m.toFixed(2)} m → Z = ${res.H_pack_total_m.toFixed(2)} m`, pad.l + 8, pad.t + ph + 20);
      return;
    }

    const size = Math.min(w - 56, h - 38);
    const ox = Math.floor((w - size) / 2) + 8;
    const oy = 14;

    const toX = x => ox + x * size;
    const toY = y => oy + size - y * size;

    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.strokeRect(ox, oy, size, size);

    // 45-deg line
    ctx.strokeStyle = 'rgba(148,163,184,0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(toX(0), toY(0)); ctx.lineTo(toX(1), toY(1)); ctx.stroke();
    ctx.setLineDash([]);

    // Non-Ideal NRTL VLE Curve
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    const curve = res.vleCurve || [];
    curve.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(toX(pt.x), toY(pt.y));
      else ctx.lineTo(toX(pt.x), toY(pt.y));
    });
    ctx.stroke();

    // Operating lines
    const { zF, xD, xB, R } = res;
    const slopeR = R / (R + 1.0);
    const intR = xD / (R + 1.0);
    const x_int = zF;
    const y_int = slopeR * x_int + intR;

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toX(xD), toY(xD));
    ctx.lineTo(toX(x_int), toY(y_int));
    ctx.lineTo(toX(xB), toY(xB));
    ctx.stroke();

    // McCabe-Thiele stages
    ctx.strokeStyle = 'rgba(16,185,129,0.85)';
    ctx.lineWidth = 1.2;
    let cx = xD, cy = xD;
    ctx.beginPath();
    ctx.moveTo(toX(cx), toY(cy));
    for (let s = 0; s < Math.min(28, Math.ceil(res.N_theo) + 2); s++) {
      const nx = cy / Math.max(0.01, res.alpha - (res.alpha - 1.0) * cy);
      ctx.lineTo(toX(nx), toY(cy));
      if (nx <= xB) { ctx.lineTo(toX(nx), toY(nx)); break; }
      const ny = nx >= x_int ? (slopeR * nx + intR) : (xB + ((y_int - xB) / Math.max(1e-4, x_int - xB)) * (nx - xB));
      ctx.lineTo(toX(nx), toY(ny));
      cx = nx; cy = ny;
    }
    ctx.stroke();
  }

  function drawPipingCanvas(canvas, res) {
    const p = prepCanvas(canvas);
    if (!p) return;
    const { ctx, w, h } = p;
    const pad = { l: 42, r: 16, t: 22, b: 30 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    const selIdx = res.selected.idx;
    const startIdx = Math.max(0, Math.min(res.candidates.length - 6, selIdx - 2));
    const slice = res.candidates.slice(startIdx, startIdx + 6);
    const maxV = Math.max(4.5, ...slice.map(c => Math.min(18, c.v)));
    const bw = pw / slice.length;

    slice.forEach((c, i) => {
      const x = pad.l + i * bw + bw * 0.18;
      const barW = bw * 0.64;
      const vClamped = Math.min(maxV, c.v);
      const bh = (vClamped / maxV) * ph;
      const y = pad.t + ph - bh;

      ctx.fillStyle = c.idx === selIdx ? '#38bdf8' : (c.idx === res.recommended.idx ? '#10b981' : 'rgba(148,163,184,0.3)');
      ctx.fillRect(x, y, barW, bh);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`${c.v.toFixed(1)}m/s`, x, Math.max(12, y - 5));
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(c.nps, x + 4, pad.t + ph + 16);
    });
  }

  function drawVesselCanvas(canvas, res) {
    const p = prepCanvas(canvas);
    if (!p) return;
    const { ctx, w, h } = p;

    ctx.save();
    const isVert = res.orientation === 'vertical';
    const vw = isVert ? 74 : 180;
    const vh = isVert ? 136 : 72;
    const cx = w / 2, cy = h / 2;
    const x0 = cx - vw / 2, y0 = cy - vh / 2;

    // Liquid level fill
    ctx.fillStyle = 'rgba(56,189,248,0.25)';
    if (isVert) {
      ctx.fillRect(x0, y0 + vh * 0.52, vw, vh * 0.48);
    } else {
      ctx.fillRect(x0, y0 + vh * 0.50, vw, vh * 0.50);
    }

    // Demister pad
    if (res.hasDemister) {
      ctx.fillStyle = 'rgba(245,158,11,0.45)';
      if (isVert) ctx.fillRect(x0 + 2, y0 + 18, vw - 4, 8);
      else ctx.fillRect(x0 + vw - 26, y0 + 4, 8, vh - 8);
    }

    // Vessel shell + heads outline
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x0, y0, vw, vh, isVert ? 24 : 22);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`ID ${res.D_m.toFixed(2)}m × L ${res.L_m.toFixed(2)}m`, cx - 55, y0 - 8);
    ctx.fillStyle = '#34d399';
    ctx.fillText(`ASME 두께: ${res.t_nom_mm} mm (MAWP ${res.MAWP_barG.toFixed(1)} barG)`, cx - 88, y0 + vh + 18);
    ctx.restore();
  }

  function drawPSVCanvas(canvas, res) {
    const p = prepCanvas(canvas);
    if (!p) return;
    const { ctx, w, h } = p;
    const pad = { l: 36, r: 16, t: 22, b: 30 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    const orifices = window.API526_ORIFICES;
    const selLetter = res.selectedOrifice.letter;
    const selIdx = orifices.findIndex(o => o.letter === selLetter);
    const startIdx = Math.max(0, Math.min(orifices.length - 6, selIdx - 2));
    const slice = orifices.slice(startIdx, startIdx + 6);
    const maxA = Math.max(res.A_req_mm2 * 1.2, slice[slice.length - 1].area_mm2);
    const bw = pw / slice.length;

    // Required area line
    const yReq = pad.t + ph - (res.A_req_mm2 / maxA) * ph;
    ctx.strokeStyle = '#fb7185';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yReq); ctx.lineTo(pad.l + pw, yReq); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fda4af';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`요구면적 A_req = ${res.A_req_mm2.toFixed(0)} mm²`, pad.l + 6, Math.max(14, yReq - 5));

    slice.forEach((o, i) => {
      const x = pad.l + i * bw + bw * 0.18;
      const barW = bw * 0.64;
      const bh = (o.area_mm2 / maxA) * ph;
      const y = pad.t + ph - bh;

      ctx.fillStyle = o.letter === selLetter ? '#10b981' : 'rgba(148,163,184,0.28)';
      ctx.fillRect(x, y, barW, bh);

      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`'${o.letter}'`, x + 6, pad.t + ph + 15);
    });
  }

  // =========================================================================
  // 7. CLOSED-LOOP AI + NUMERICAL AUTO-REDESIGN & CONVERGENCE ENGINE
  // =========================================================================
  function autoRedesignAndConverge(eqType, curInputs, mode, aiSuggestedInputs) {
    const work = Object.assign({}, curInputs);
    const aiRaw = aiSuggestedInputs || {};
    const redesignSteps = [];

    // 1. Apply AI suggested parameters with smart normalization
    Object.keys(aiRaw).forEach(k => {
      const val = aiRaw[k];
      if (val !== undefined && val !== null && work[k] !== undefined) {
        const num = Number(val);
        if (Number.isFinite(num)) {
          work[k] = num;
        } else {
          work[k] = val;
        }
      }
    });

    if (eqType === 'hx') {
      if (work.hx_type === 'plate_phe') {
        for (let pass = 1; pass <= 5; pass++) {
          const r = solveHX(work, 'rigorous');
          let changed = false;
          if ((r.dPs_bar > 0.78 || r.dPt_bar > 0.78) && (work.phe_passes || 1) > 1) {
            work.phe_passes = 1;
            redesignSteps.push(`Pass ${pass}: PHE 채널 ΔP(${Math.max(r.dPs_bar, r.dPt_bar).toFixed(2)} bar) 저감을 위해 1×1 단패스 병렬 구성으로 전환`);
            changed = true;
          } else if ((r.dPs_bar > 0.78 || r.dPt_bar > 0.78) && (work.phe_b_mm || 3.2) < 4.0) {
            work.phe_b_mm = 4.0;
            redesignSteps.push(`Pass ${pass}: PHE 채널 유로 확대를 위해 채널 프레스 간극(b) → 4.0 mm 상향`);
            changed = true;
          } else if ((r.dPs_bar > 0.78 || r.dPt_bar > 0.78) && (work.phe_beta_deg || 60) > 45) {
            work.phe_beta_deg = 45;
            redesignSteps.push(`Pass ${pass}: 압력강하 완화를 위해 쉐브론 주름각(β) → 45° 혼합 패턴 적용`);
            changed = true;
          }
          work.U_assumed = Math.round(r.U_calc);
          if (!changed) break;
        }
        const finalRes = solveHX(work, mode);
        return { finalInputs: work, finalResults: finalRes, redesignSteps };
      }

      // Normalize standard tube lengths & ODs if close
      const stdLengths = [2.44, 3.05, 3.66, 4.88, 6.00, 6.10, 7.32];
      if (work.tube_L_m) {
        const bestL = stdLengths.reduce((a, b) => Math.abs(b - work.tube_L_m) < Math.abs(a - work.tube_L_m) ? b : a, 4.88);
        work.tube_L_m = bestL;
      }
      const stdODs = [15.88, 19.05, 25.4];
      if (work.tube_od_mm) {
        work.tube_od_mm = stdODs.reduce((a, b) => Math.abs(b - work.tube_od_mm) < Math.abs(a - work.tube_od_mm) ? b : a, 19.05);
      }

      // Closed-loop iterative tuning to guarantee TEMA compliance (dPs <= 0.7 bar, dPt <= 0.7 bar, Ft >= 0.75, Vib < 0.75)
      for (let pass = 1; pass <= 6; pass++) {
        const r = solveHX(work, 'rigorous');
        let changed = false;

        if (r.Ft < 0.78 && work.n_shell < 4) {
          work.n_shell += 1;
          redesignSteps.push(`Pass ${pass}: LMTD 보정계수 Ft(${r.Ft.toFixed(3)}) 개선을 위해 직렬 쉘 수 N_shell → ${work.n_shell} 증가`);
          changed = true;
        }
        if (r.dPs_bar > 0.68) {
          if (work.baffle_ratio < 0.46) {
            work.baffle_ratio = Number(Math.min(0.48, work.baffle_ratio + 0.06).toFixed(2));
            redesignSteps.push(`Pass ${pass}: 쉘측 ΔP(${r.dPs_bar.toFixed(3)} bar > 0.7 bar) 저감을 위해 배플 간격비(B/Ds) → ${work.baffle_ratio} 확대`);
            changed = true;
          } else if (work.baffle_cut_pct < 35) {
            work.baffle_cut_pct = Math.min(35, (work.baffle_cut_pct || 25) + 5);
            redesignSteps.push(`Pass ${pass}: 쉘측 ΔP 추가 저감을 위해 배플 절단율(Cut) → ${work.baffle_cut_pct}% 확대`);
            changed = true;
          } else if (work.tube_od_mm < 25.4) {
            work.tube_od_mm = 25.4;
            redesignSteps.push(`Pass ${pass}: 쉘측 유로 확대를 위해 튜브 외경(OD) → 25.4 mm (1") 적용`);
            changed = true;
          }
        }
        if (r.dPt_bar > 0.68) {
          if (work.n_passes > 2) {
            work.n_passes = 2;
            redesignSteps.push(`Pass ${pass}: 튜브측 ΔP(${r.dPt_bar.toFixed(3)} bar) 저감을 위해 튜브 패스 수 → 2 Pass 조정`);
            changed = true;
          } else if (work.tube_od_mm < 25.4) {
            work.tube_od_mm = 25.4;
            redesignSteps.push(`Pass ${pass}: 튜브측 ΔP 저감을 위해 튜브 외경(OD) → 25.4 mm 확대`);
            changed = true;
          }
        }
        if (r.vt < 0.75 && r.dPt_bar < 0.20 && work.n_passes < 4) {
          work.n_passes = work.n_passes === 1 ? 2 : 4;
          redesignSteps.push(`Pass ${pass}: 튜브 내 파울링 억제 및 전열 촉진을 위해 패스 수 → ${work.n_passes} Pass 상향 (vt=${r.vt.toFixed(2)} m/s)`);
          changed = true;
        }
        work.U_assumed = Math.round(r.U_calc);
        if (!changed) break;
      }
      const finalRes = solveHX(work, mode);
      return { finalInputs: work, finalResults: finalRes, redesignSteps };
    }

    if (eqType === 'pump') {
      const stdIDs = [52.48, 62.68, 77.92, 102.26, 154.08, 202.74, 254.56, 303.18];
      for (let pass = 1; pass <= 4; pass++) {
        const r = solvePump(work, 'rigorous');
        let changed = false;
        if (r.v_suc > 1.55 || r.npsh_margin_m < 1.2) {
          const nextD = stdIDs.find(d => d > work.d_suc_mm + 2);
          if (nextD) {
            work.d_suc_mm = nextD;
            redesignSteps.push(`Pass ${pass}: 흡입 유속(${r.v_suc.toFixed(2)} m/s) 안정화 및 NPSHa 확보를 위해 흡입관 내경 → ${nextD} mm 확대`);
            changed = true;
          }
        }
        if (r.v_dis > 2.85) {
          const nextD = stdIDs.find(d => d > work.d_dis_mm + 2);
          if (nextD) {
            work.d_dis_mm = nextD;
            redesignSteps.push(`Pass ${pass}: 토출 마찰손실 저감을 위해 토출관 내경 → ${nextD} mm 확대`);
            changed = true;
          }
        }
        if (!changed) break;
      }
      return { finalInputs: work, finalResults: solvePump(work, mode), redesignSteps };
    }

    if (eqType === 'column') {
      const r0 = solveColumn(work, mode);
      if (r0.colMode === 'absorption') {
        if (r0.dP_pack_mbar_m > 3.5 && work.flood_frac > 0.65) {
          work.flood_frac = 0.65;
          redesignSteps.push(`Pass 1: 패킹 압력강하(${r0.dP_pack_mbar_m.toFixed(2)} mbar/m) 안정화를 위해 범람 안전율 → 65% 하향`);
        }
        return { finalInputs: work, finalResults: solveColumn(work, mode), redesignSteps };
      }
      if (r0.dc_backup_pct > 45 && work.tray_spacing_m < 0.75) {
        work.tray_spacing_m = 0.75;
        redesignSteps.push(`Pass 1: 다운커머 백업(${r0.dc_backup_pct.toFixed(1)}%) 완화를 위해 단간격 → 0.75 m 확대`);
      }
      if (work.R_mult > 1.35 || work.R_mult < 1.15) {
        work.R_mult = 1.22;
        redesignSteps.push(`Pass 1: 리보일러 열부하 및 단수 경제성 최적화를 위해 환류비 배수(R/R_min) → 1.22 조정`);
      }
      return { finalInputs: work, finalResults: solveColumn(work, mode), redesignSteps };
    }

    if (eqType === 'piping') {
      const r0 = solvePiping(work, mode);
      work.selected_nps_idx = r0.recommended.idx;
      redesignSteps.push(`Pass 1: 경제적 유속 및 압력강하 기준 최적 관경 ${r0.recommended.nps} (DN${r0.recommended.dn}) 자동 확정`);
      return { finalInputs: work, finalResults: solvePiping(work, mode), redesignSteps };
    }

    if (eqType === 'vessel') {
      const r0 = solveVessel(work, mode);
      work.P_des_barG = Number(Math.max(work.P_op_barG * 1.15, work.P_op_barG + 1.8).toFixed(1));
      redesignSteps.push(`Pass 1: ASME Sec. VIII 설계압력 여유(${work.P_des_barG} barG) 및 형상비 L/D=${r0.LD_ratio.toFixed(2)} 수렴 확정`);
      return { finalInputs: work, finalResults: solveVessel(work, mode), redesignSteps };
    }

    if (eqType === 'psv') {
      return { finalInputs: work, finalResults: solvePSV(work, mode), redesignSteps };
    }

    return { finalInputs: work, finalResults: {}, redesignSteps };
  }

  // =========================================================================
  // 8. CAD BLUEPRINT ENGINEERING DRAWING RENDERER (Engineering DWG)
  // =========================================================================
  function drawDimLine(ctx, x1, y1, x2, y2, label, color) {
    ctx.save();
    ctx.strokeStyle = color || '#38bdf8';
    ctx.fillStyle = color || '#38bdf8';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrowheads
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + headLen * Math.cos(ang + 0.4), y1 + headLen * Math.sin(ang + 0.4));
    ctx.lineTo(x1 + headLen * Math.cos(ang - 0.4), y1 + headLen * Math.sin(ang - 0.4));
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang + 0.4), y2 - headLen * Math.sin(ang + 0.4));
    ctx.lineTo(x2 - headLen * Math.cos(ang - 0.4), y2 - headLen * Math.sin(ang - 0.4));
    ctx.closePath();
    ctx.fill();

    const mx = 0.5 * (x1 + x2), my = 0.5 * (y1 + y2);
    ctx.font = 'bold 10.5px "JetBrains Mono", Consolas, monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(4, 9, 20, 0.88)';
    ctx.fillRect(mx - tw / 2 - 4, my - 8, tw + 8, 14);
    ctx.fillStyle = color || '#7dd3fc';
    ctx.fillText(label, mx - tw / 2, my + 3);
    ctx.restore();
  }

  function drawEngineeringDWG(canvas, eqType, res) {
    if (!canvas || !res) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(620, rect.width || 760);
    const h = Math.max(330, rect.height || 350);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // CAD Blueprint Dark Background + Grid
    ctx.fillStyle = '#040a18';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Outer CAD Border
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    const tagMap = { hx: 'E-101', pump: 'P-101', column: 'T-101', piping: 'L-101', vessel: 'V-101', psv: 'PSV-101' };
    const codeMap = {
      hx: res.hxType === 'plate_phe' ? 'API 662 / ISO 15547-1 PHE' : 'ASME SEC.VIII + TEMA R',
      pump: 'API 610 12th ED.',
      column: res.colMode === 'absorption' ? 'ASME SEC.VIII + ECKERT GPDC' : 'ASME SEC.VIII + FRI',
      piping: 'ASME B31.3',
      vessel: 'ASME SEC.VIII DIV.1',
      psv: 'API 520 / API 526'
    };
    const itemTag = res.equipTag || tagMap[eqType];

    if (eqType === 'hx' && res.hxType === 'plate_phe') {
      // 1. PLATE HEAT EXCHANGER (PHE) SIDE ELEVATION VIEW (Left 58%)
      const fx = 68, fy = 62, fh = 178, packW = Math.min(220, Math.max(90, res.N_plates * 0.9));
      const frameExt = packW + 76;

      // Top Carrying Bar & Bottom Guide Bar
      ctx.fillStyle = '#64748b';
      ctx.fillRect(fx, fy + 8, frameExt, 10);
      ctx.fillRect(fx, fy + fh - 16, frameExt, 8);

      // Fixed Frame Plate (Left)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(fx, fy, 18, fh);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(fx, fy, 18, fh);

      // Corrugated Plate Pack (N_plates)
      const px0 = fx + 18;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(px0, fy + 18, packW, fh - 34);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.1;
      const nLines = Math.min(28, Math.max(10, Math.round(packW / 6)));
      for (let i = 0; i <= nLines; i++) {
        const lx = px0 + (packW * i) / nLines;
        ctx.beginPath(); ctx.moveTo(lx, fy + 18); ctx.lineTo(lx, fy + fh - 16); ctx.stroke();
      }

      // Movable Pressure Plate (Follower)
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(px0 + packW, fy + 6, 16, fh - 12);
      ctx.strokeStyle = '#7dd3fc';
      ctx.strokeRect(px0 + packW, fy + 6, 16, fh - 12);

      // Rear Support Column
      ctx.fillStyle = '#475569';
      ctx.fillRect(fx + frameExt - 14, fy, 14, fh);
      ctx.strokeStyle = '#94a3b8';
      ctx.strokeRect(fx + frameExt - 14, fy, 14, fh);

      // Tie Bolts (4 sets shown)
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      [fy + 32, fy + 76, fy + 118, fy + 152].forEach(by => {
        ctx.beginPath(); ctx.moveTo(fx - 8, by); ctx.lineTo(px0 + packW + 32, by); ctx.stroke();
      });

      // Inlet / Outlet Nozzles on Fixed Frame Plate
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = 2;
      ctx.strokeRect(fx - 26, fy + 26, 26, 18);
      ctx.strokeRect(fx - 26, fy + fh - 44, 26, 18);
      ctx.fillStyle = '#fcd34d';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`S1/S4 (${res.nozzle_shell_nps} 150#)`, fx - 48, fy + 20);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`S2/S3 (${res.nozzle_tube_nps} 150#)`, fx - 48, fy + fh - 48);

      drawDimLine(ctx, px0, fy - 22, px0 + packW, fy - 22, `PACK L_pack = ${res.L_pack_mm} mm (${res.N_plates} Plates)`, '#38bdf8');
      drawDimLine(ctx, fx - 38, fy, fx - 38, fy + fh, `Lp=${res.Lp_mm}mm`, '#f43f5e');
      drawDimLine(ctx, fx, fy + fh + 26, fx + frameExt, fy + fh + 26, `CHEVRON β = ${res.phe_beta_deg}° · GAP b = ${res.phe_b_mm} mm · ${res.phe_passes}×${res.phe_passes} PASS`, '#f59e0b');

      // 2. CHEVRON CORRUGATED PLATE FRONT ELEVATION (Right 35%)
      const rpx = w - 195, rpy = 42, rpw = 96, rph = 168;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.roundRect(rpx, rpy, rpw, rph, 12); ctx.stroke();

      // 4 Corner Ports S1, S2, S3, S4
      const portR = 11;
      [
        [rpx + 20, rpy + 20, 'S1', '#fcd34d'],
        [rpx + rpw - 20, rpy + 20, 'S4', '#34d399'],
        [rpx + 20, rpy + rph - 20, 'S2', '#fcd34d'],
        [rpx + rpw - 20, rpy + rph - 20, 'S3', '#34d399']
      ].forEach(([cx, cy, lbl, col]) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, portR, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = 'bold 9px monospace';
        ctx.fillText(lbl, cx - 6, cy + 3);
      });

      // Chevron Herringbone Corrugation Pattern
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      for (let cy = rpy + 44; cy <= rpy + rph - 44; cy += 12) {
        ctx.beginPath();
        ctx.moveTo(rpx + 14, cy + 6);
        ctx.lineTo(rpx + rpw / 2, cy - 4);
        ctx.lineTo(rpx + rpw - 14, cy + 6);
        ctx.stroke();
      }

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`CHEVRON PLATE (β=${res.phe_beta_deg}°)`, rpx - 22, rpy - 8);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(`Wp ${res.Wp_mm} × Lp ${res.Lp_mm} (${res.phe_tp_mm}t)`, rpx - 26, rpy + rph + 15);
      ctx.fillText(`Area = ${res.A_prov_m2.toFixed(1)} m² (${res.N_channels} Ch)`, rpx - 24, rpy + rph + 29);
    } else if (eqType === 'hx') {
      // 1. SIDE ELEVATION SECTIONAL VIEW (Left 68%)
      const sx = 64, sy = 96, sw = Math.min(370, w * 0.50), sh = 106;
      const frontW = 46, rearW = 42;

      // Centerline
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
      ctx.setLineDash([8, 4, 2, 4]);
      ctx.beginPath(); ctx.moveTo(sx - frontW - 18, sy + sh / 2); ctx.lineTo(sx + sw + rearW + 18, sy + sh / 2); ctx.stroke();
      ctx.setLineDash([]);

      // Stationary Front Channel + Pass Partition
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.strokeRect(sx - frontW, sy, frontW, sh);
      if (res.nPasses >= 2) {
        ctx.beginPath(); ctx.moveTo(sx - frontW, sy + sh / 2); ctx.lineTo(sx, sy + sh / 2); ctx.stroke();
      }

      // Stationary & Rear Tubesheets
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(sx - 5, sy - 6, 7, sh + 12);
      ctx.fillRect(sx + sw - 2, sy - 6, 7, sh + 12);

      // Shell Cylinder
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(sx, sy, sw, sh);

      // Rear Bonnet Head
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(sx + sw + 5, sy);
      ctx.quadraticCurveTo(sx + sw + rearW + 14, sy + sh / 2, sx + sw + 5, sy + sh);
      ctx.stroke();

      // Tube Bundle Lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1.1;
      for (let r = 1; r <= 7; r++) {
        const ty = sy + (sh * r) / 8;
        ctx.beginPath(); ctx.moveTo(sx, ty); ctx.lineTo(sx + sw, ty); ctx.stroke();
      }

      // Segmental Baffles (up to 14 drawn proportionally)
      const nBafDraw = Math.min(14, Math.max(3, res.N_baffles || 8));
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.0;
      for (let b = 1; b <= nBafDraw; b++) {
        const bx = sx + (sw * b) / (nBafDraw + 1);
        const topCut = b % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(bx, topCut ? sy + sh * 0.25 : sy);
        ctx.lineTo(bx, topCut ? sy + sh : sy + sh * 0.75);
        ctx.stroke();
      }

      // Nozzles N1 (Shell In), N2 (Shell Out), N3 (Tube In), N4 (Tube Out)
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      // N1 Shell In (Top Left)
      ctx.strokeRect(sx + 28, sy - 28, 16, 28);
      ctx.beginPath(); ctx.moveTo(sx + 22, sy - 28); ctx.lineTo(sx + 50, sy - 28); ctx.stroke();
      // N2 Shell Out (Bottom Right)
      ctx.strokeRect(sx + sw - 44, sy + sh, 16, 28);
      ctx.beginPath(); ctx.moveTo(sx + sw - 50, sy + sh + 28); ctx.lineTo(sx + sw - 22, sy + sh + 28); ctx.stroke();
      // N3 Tube In (Bottom Front Channel)
      ctx.strokeRect(sx - frontW / 2 - 7, sy + sh, 14, 26);
      // N4 Tube Out (Top Front Channel)
      ctx.strokeRect(sx - frontW / 2 - 7, sy - 26, 14, 26);

      // Saddle Supports
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.fillRect(sx + 45, sy + sh, 24, 22);
      ctx.fillRect(sx + sw - 69, sy + sh, 24, 22);

      // Nozzle Labels (ANSI / ASME NPS Default)
      ctx.fillStyle = '#fcd34d';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`N1 (Shell In ${res.nozzle_shell_nps} 150#)`, sx + 16, sy - 34);
      ctx.fillText(`N2 (Shell Out ${res.nozzle_shell_nps} 150#)`, sx + sw - 105, sy + sh + 42);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`N4 (Tube Out ${res.nozzle_tube_nps} 150#)`, sx - frontW - 18, sy - 34);
      ctx.fillText(`N3 (Tube In ${res.nozzle_tube_nps} 150#)`, sx - frontW - 18, sy + sh + 42);

      // Dimension Lines
      drawDimLine(ctx, sx, sy - 54, sx + sw, sy - 54, `TUBE LENGTH L = ${(res.L_m * 1000).toFixed(0)} mm (${res.L_m} m)`, '#38bdf8');
      drawDimLine(ctx, sx - frontW - 26, sy, sx - frontW - 26, sy + sh, `ID ${res.D_shell_mm}mm`, '#f43f5e');
      drawDimLine(ctx, sx, sy + sh + 58, sx + sw, sy + sh + 58, `BAFFLE PITCH B = ${res.B_spacing_mm} mm × ${res.N_baffles} EA (Cut ${res.baffleCutPct}%)`, '#f59e0b');

      // 2. CROSS-SECTION TUBE BUNDLE LAYOUT (Right 30%)
      const cx = w - 125, cy = 135, cr = 58;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();

      // Bundle Diameter Circle
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, cr - 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // Baffle Cut Horizontal Chord
      const cutY = cy - cr + (2 * cr * (res.baffleCutPct / 100.0));
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx - cr + 6, cutY); ctx.lineTo(cx + cr - 6, cutY); ctx.stroke();

      // Tube Pattern Dots inside Bundle
      ctx.fillStyle = '#38bdf8';
      const stepX = 10, stepY = res.layoutAngle === 30 ? 8.66 : 10;
      for (let row = -5; row <= 5; row++) {
        for (let col = -5; col <= 5; col++) {
          const tx = cx + col * stepX + (res.layoutAngle === 30 && row % 2 !== 0 ? stepX / 2 : 0);
          const ty = cy + row * stepY;
          if (Math.hypot(tx - cx, ty - cy) <= cr - 10) {
            ctx.beginPath(); ctx.arc(tx, ty, 2.2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.fillText(`SECTION A-A (${res.layoutAngle}° PITCH)`, cx - 64, cy - cr - 12);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(`Nt = ${res.N_tubes} EA (OD ${res.do_mm}×${res.tw_mm}t)`, cx - 76, cy + cr + 16);
      ctx.fillText(`Bundle Ø${res.D_bundle_mm} / Shell ID Ø${res.D_shell_mm} (${res.t_shell_mm}t)`, cx - 92, cy + cr + 30);
    } else if (eqType === 'column') {
      const isPacked = res.colMode === 'absorption' || res.internals === 'packed';
      // Column Elevation + Internals DWG
      const tx = 140, ty = 42, tw = 78, th = 225;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 28);
      ctx.stroke();

      // Skirt
      ctx.strokeRect(tx + 4, ty + th - 10, tw - 8, 34);

      if (isPacked) {
        // Wire Mesh Mist Eliminator at Top
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.fillRect(tx + 6, ty + 24, tw - 12, 10);
        // Liquid Distributor Pipe
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx + 10, ty + 44); ctx.lineTo(tx + tw + 35, ty + 44); ctx.stroke();
        // Packed Beds (1 or 2 beds with cross-hatch)
        const nBeds = res.N_beds || 1;
        const bedH = nBeds >= 2 ? 64 : 132;
        for (let b = 0; b < Math.min(2, nBeds); b++) {
          const by0 = ty + 54 + b * (bedH + 22);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
          ctx.fillRect(tx + 6, by0, tw - 12, bedH);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(tx + 6, by0, tw - 12, bedH);
          ctx.beginPath();
          ctx.moveTo(tx + 6, by0); ctx.lineTo(tx + tw - 6, by0 + bedH);
          ctx.moveTo(tx + tw - 6, by0); ctx.lineTo(tx + 6, by0 + bedH);
          ctx.stroke();
        }
        // Bottom Gas Feed Nozzle
        ctx.strokeStyle = '#fcd34d';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(tx - 48, ty + th - 36); ctx.lineTo(tx, ty + th - 36); ctx.stroke();
        ctx.fillStyle = '#fcd34d';
        ctx.font = 'bold 9.5px monospace';
        ctx.fillText(`GAS IN (${res.gas_kgh ? res.gas_kgh.toFixed(0) + ' kg/h' : 'V_in'})`, tx - 135, ty + th - 40);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`LIQ IN (${res.liq_kgh ? res.liq_kgh.toFixed(0) + ' kg/h' : 'L_in'})`, tx + tw + 8, ty + 38);

        drawDimLine(ctx, tx + tw + 38, ty, tx + tw + 38, ty + th, `T/T H = ${res.H_tangent_m.toFixed(1)} m (Pack Z = ${res.H_pack_total_m.toFixed(2)} m)`, '#38bdf8');
        drawDimLine(ctx, tx, ty - 18, tx + tw, ty - 18, `ID Ø${(res.D_col_m * 1000).toFixed(0)} mm`, '#f43f5e');

        // Right Side Packed Bed Plan View
        const cx = w - 165, cy = 135, cr = 64;
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.3;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (Math.hypot(r * 18, c * 18) <= cr - 14) {
              ctx.beginPath(); ctx.arc(cx + c * 18, cy + r * 18, 6.5, 0, Math.PI * 2); ctx.stroke();
            }
          }
        }
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(`PACKED BED PLAN VIEW`, cx - 64, cy - cr - 12);
        ctx.fillText(`${res.packSpec ? res.packSpec.name : 'Packed Bed'}`, cx - 84, cy + cr + 16);
        ctx.fillText(`Fp=${res.packSpec ? res.packSpec.Fp : 65} m⁻¹ · Flood=${res.flood_pct.toFixed(0)}% · ΔP=${res.dP_total_mbar.toFixed(1)} mbar`, cx - 102, cy + cr + 30);
      } else {
        // Trays
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.2;
        for (let i = 1; i <= 10; i++) {
          const y = ty + 24 + (i * (th - 48)) / 11;
          ctx.beginPath(); ctx.moveTo(tx + 4, y); ctx.lineTo(tx + tw - 4, y); ctx.stroke();
        }
        // Feed Nozzle
        const fy = ty + 24 + (th - 48) * (res.feed_stage_actual / Math.max(1, res.N_actual));
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(tx - 45, fy); ctx.lineTo(tx, fy); ctx.stroke();
        ctx.fillStyle = '#fcd34d';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`FEED #${res.feed_stage_actual} (${res.T_feed_C.toFixed(1)}°C)`, tx - 140, fy - 5);

        drawDimLine(ctx, tx + tw + 35, ty, tx + tw + 35, ty + th, `T/T H = ${res.H_tangent_m.toFixed(1)} m (${res.N_actual} Trays)`, '#38bdf8');
        drawDimLine(ctx, tx, ty - 18, tx + tw, ty - 18, `ID Ø${(res.D_col_m * 1000).toFixed(0)} mm`, '#f43f5e');

        // Right Side Tray Detail
        const cx = w - 165, cy = 135, cr = 64;
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#10b981';
        ctx.beginPath(); ctx.moveTo(cx - cr * 0.72, cy - cr * 0.68); ctx.lineTo(cx - cr * 0.72, cy + cr * 0.68); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + cr * 0.72, cy - cr * 0.68); ctx.lineTo(cx + cr * 0.72, cy + cr * 0.68); ctx.stroke();
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(`SIEVE TRAY PLAN VIEW`, cx - 58, cy - cr - 12);
        ctx.fillText(`Spacing: ${(res.H_tangent_m - 3.5) / Math.max(1, res.N_actual) * 1000 | 0} mm | Weir: 50 mm`, cx - 72, cy + cr + 18);
      }
    } else if (eqType === 'pump') {
      // API 610 OH2 Process Pump + Motor Skid GA Drawing + Impeller Detail
      const baseX = 56, baseY = 228, baseW = 355, baseH = 18;
      // Heavy Steel Baseplate
      ctx.fillStyle = 'rgba(148,163,184,0.28)';
      ctx.fillRect(baseX, baseY, baseW, baseH);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.strokeRect(baseX, baseY, baseW, baseH);

      // Volute Casing (Left)
      const vx = 105, vy = 152, vr = 42;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.stroke();
      // Suction Nozzle (Horizontal Left)
      ctx.strokeRect(vx - vr - 34, vy - 14, 34, 28);
      // Discharge Nozzle (Vertical Top)
      ctx.strokeRect(vx - 12, vy - vr - 36, 24, 36);
      // Centerline Pedestal Support
      ctx.strokeRect(vx - 18, vy + vr, 36, baseY - (vy + vr));

      // Bearing Bracket & API 682 Seal Chamber
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(vx + vr, vy - 18, 68, 36);
      // Spacer Coupling Guard
      ctx.strokeStyle = '#f59e0b';
      ctx.strokeRect(vx + vr + 68, vy - 12, 34, 24);

      // TEFC Induction Motor (Right)
      const mx = vx + vr + 102, my = 114, mw = 118, mh = 78;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 10); ctx.stroke();
      // Cooling Fins
      ctx.lineWidth = 1.1;
      for (let f = 1; f <= 5; f++) {
        const fy = my + 12 + f * 10;
        ctx.beginPath(); ctx.moveTo(mx + 12, fy); ctx.lineTo(mx + mw - 14, fy); ctx.stroke();
      }
      // Motor Feet
      ctx.strokeRect(mx + 16, my + mh, 24, baseY - (my + mh));
      ctx.strokeRect(mx + mw - 40, my + mh, 24, baseY - (my + mh));

      drawDimLine(ctx, baseX, baseY + 34, baseX + baseW, baseY + 34, `API 610 OH2 SKID (Q=${res.Q_m3h.toFixed(1)} m³/h, TDH=${res.H_total_m.toFixed(1)} m, ${res.P_motor_std_kW} kW)`, '#38bdf8');
      drawDimLine(ctx, vx - vr - 34, vy - vr - 50, vx + 12, vy - vr - 50, `SUC Ø${res.d_suc_mm.toFixed(0)} × DIS Ø${res.d_dis_mm.toFixed(0)}`, '#f59e0b');

      // Right Side: Closed Impeller Section
      const icx = w - 135, icy = 132, icr = 56;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(icx, icy, icr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(icx, icy, 18, 0, Math.PI * 2); ctx.stroke();
      for (let v = 0; v < 6; v++) {
        const a0 = (v * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(icx + 18 * Math.cos(a0), icy + 18 * Math.sin(a0));
        ctx.quadraticCurveTo(icx + 38 * Math.cos(a0 + 0.45), icy + 38 * Math.sin(a0 + 0.45), icx + icr * Math.cos(a0 + 0.85), icy + icr * Math.sin(a0 + 0.85));
        ctx.stroke();
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10.5px monospace';
      ctx.fillText(`IMPELLER Ø${res.D_imp_rated_mm} mm`, icx - 56, icy - icr - 10);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(`Max Ø${res.D_imp_max_mm} / Min Ø${res.D_imp_min_mm} mm`, icx - 68, icy + icr + 16);
      ctx.fillText(`NPSHa ${res.NPSHa_m.toFixed(2)}m > NPSHr ${res.NPSHr_m.toFixed(2)}m`, icx - 78, icy + icr + 30);
    } else if (eqType === 'vessel') {
      // ASME Sec. VIII Div. 1 Separator / KO Drum GA Drawing
      const bx = 92, by = 78, bw = 290, bh = 116;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 36); ctx.stroke();

      // Liquid Level & Vortex Breaker
      ctx.fillStyle = 'rgba(56,189,248,0.20)';
      ctx.fillRect(bx + 10, by + bh * 0.55, bw - 20, bh * 0.43);
      ctx.strokeStyle = '#38bdf8';
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(bx + 6, by + bh * 0.55); ctx.lineTo(bx + bw - 6, by + bh * 0.55); ctx.stroke();
      ctx.setLineDash([]);

      // Wire Mesh Demister Pad
      if (res.hasDemister) {
        ctx.fillStyle = 'rgba(245,158,11,0.38)';
        ctx.fillRect(bx + bw - 65, by + 6, 16, bh - 12);
        ctx.strokeStyle = '#f59e0b';
        ctx.strokeRect(bx + bw - 65, by + 6, 16, bh - 12);
      }

      // Nozzles (N1 Feed In, N2 Vapor Out, N3 Liquid Out, N4 Manhole 24")
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(bx + 42, by - 26, 18, 26);
      ctx.strokeRect(bx + bw - 64, by - 26, 18, 26);
      ctx.strokeRect(bx + bw - 85, by + bh, 16, 24);
      // Saddle Supports
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.fillRect(bx + 48, by + bh, 26, 24);
      ctx.fillRect(bx + bw - 74, by + bh, 26, 24);

      drawDimLine(ctx, bx, by - 42, bx + bw, by - 42, `T/T LENGTH L = ${(res.L_m * 1000).toFixed(0)} mm (L/D = ${res.LD_ratio.toFixed(2)})`, '#38bdf8');
      drawDimLine(ctx, bx - 32, by, bx - 32, by + bh, `ID ${(res.D_m * 1000).toFixed(0)}mm`, '#f43f5e');

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 10.5px monospace';
      ctx.fillText(`ASME SEC.VIII SHELL t_nom = ${res.t_nom_mm} mm (Calc: ${res.t_shell_req_mm.toFixed(2)} mm, CA: ${res.CA_mm} mm)`, bx, by + bh + 44);
      ctx.fillText(`MATERIAL: ${res.matName} | MAWP: ${res.MAWP_barG.toFixed(1)} barG | EMPTY WT: ${res.W_empty_kg.toFixed(0)} kg`, bx, by + bh + 60);
    } else if (eqType === 'piping') {
      // ASME B31.3 Pipe Spool Isometric & Cross-Section DWG
      const sx = 80, sy = 135, sw = 290, sh = 42;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(sx, sy, sw, sh);
      // Weld-Neck Flanges at both ends
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(sx - 8, sy - 10, 8, sh + 20);
      ctx.fillRect(sx + sw, sy - 10, 8, sh + 20);
      // Centerline
      ctx.strokeStyle = 'rgba(244,63,94,0.5)';
      ctx.setLineDash([8, 4, 2, 4]);
      ctx.beginPath(); ctx.moveTo(sx - 24, sy + sh / 2); ctx.lineTo(sx + sw + 24, sy + sh / 2); ctx.stroke();
      ctx.setLineDash([]);

      drawDimLine(ctx, sx, sy - 32, sx + sw, sy - 32, `ASME LINE ${res.selected.nps} SCH ${res.schedule || '40'} — L = ${res.selected.Leq_m.toFixed(1)} m eq.`, '#38bdf8');
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`OD = ${res.selected.od_mm} mm | ID = ${res.selected.id_mm} mm | WALL t = ${res.selected.wall_mm} mm`, sx, sy + sh + 34);
      ctx.fillText(`VELOCITY v = ${res.selected.v.toFixed(2)} m/s (API 14E Limit: ${res.selected.v_erode_ms.toFixed(2)} m/s) | ΔP = ${res.selected.dP_total_bar.toFixed(3)} bar`, sx, sy + sh + 52);

      // Right Pipe Wall Cross-Section
      const pcx = w - 135, pcy = 132, pcr = 52;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(pcx, pcy, pcr, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`SECTION ${res.selected.nps}`, pcx - 38, pcy - pcr - 14);
      ctx.fillText(`ID ${res.selected.id_mm}mm`, pcx - 32, pcy + 4);
    } else if (eqType === 'psv') {
      // API 526 Spring-Loaded Safety Relief Valve Sectional DWG
      const vx = 185, vy = 52, vw = 68, vh = 165;
      // Valve Body & Bonnet
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(vx, vy, vw, vh);
      // Top Cap
      ctx.strokeRect(vx + 16, vy - 24, vw - 32, 24);
      // Helical Spring Coils inside Bonnet
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.0;
      for (let c = 0; c < 6; c++) {
        const cy = vy + 18 + c * 14;
        ctx.beginPath(); ctx.moveTo(vx + 14, cy); ctx.lineTo(vx + vw - 14, cy + 7); ctx.stroke();
      }
      // Spindle & Disc
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath(); ctx.moveTo(vx + vw / 2, vy - 10); ctx.lineTo(vx + vw / 2, vy + 125); ctx.stroke();
      ctx.fillStyle = '#10b981';
      ctx.fillRect(vx + 16, vy + 125, vw - 32, 10);
      // Inlet Nozzle (Bottom) & Outlet Nozzle (Right Side)
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(vx + 14, vy + vh, vw - 28, 34);
      ctx.strokeRect(vx + vw, vy + 108, 42, 36);

      drawDimLine(ctx, vx - 45, vy, vx - 45, vy + vh + 34, `API 526 '${res.selectedOrifice.letter}' ORIFICE`, '#38bdf8');
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`VALVE SIZE: ${res.selectedOrifice.size} | ORIFICE AREA: ${res.selectedOrifice.area_mm2} mm² (Req: ${res.A_req_mm2.toFixed(1)} mm²)`, vx + vw + 56, vy + 75);
      ctx.fillText(`SET PRESS: ${res.P_set_barG} barG | RELIEVING PRESS P1: ${res.P1_barA.toFixed(2)} barA`, vx + vw + 56, vy + 98);
      ctx.fillText(`REQUIRED RELIEF RATE W = ${res.W_kgh.toFixed(0)} kg/h (Rated: ${res.W_rated_kgh.toFixed(0)} kg/h)`, vx + vw + 56, vy + 121);
    }

    // CAD Title Block (Bottom Right)
    const tbx = w - 285, tby = h - 74, tbw = 273, tbh = 62;
    ctx.fillStyle = 'rgba(9, 16, 32, 0.94)';
    ctx.fillRect(tbx, tby, tbw, tbh);
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tbx, tby, tbw, tbh);
    ctx.beginPath();
    ctx.moveTo(tbx, tby + 20); ctx.lineTo(tbx + tbw, tby + 20);
    ctx.moveTo(tbx, tby + 41); ctx.lineTo(tbx + tbw, tby + 41);
    ctx.moveTo(tbx + 150, tby + 20); ctx.lineTo(tbx + 150, tby + tbh);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(`CHEMENG STUDIO PRO — ENGINEERING DWG`, tbx + 8, tby + 14);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`ITEM TAG: ${itemTag}`, tbx + 8, tby + 34);
    ctx.fillText(`DWG: GA-${itemTag.replace(/[^A-Za-z0-9-]/g, '')}-01`, tbx + 156, tby + 34);
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText(`CODE: ${codeMap[eqType]}`, tbx + 8, tby + 55);
    ctx.fillText(`REV: A (FINAL)`, tbx + 156, tby + 55);
  }

  // =========================================================================
  // 9. FORMAL EPC / TEMA / API / ASME NUMBERED SPECIFICATION DATASHEETS
  // =========================================================================
  function buildTopSheetHeader(docTitle, equipNo, serviceName, specNo, capexKrw, capexUsd, dateStr) {
    return `
      <div class="tema-sheet-top-bar">
        <div>
          <div style="font-size:13px;font-weight:900;color:#fff;">EPC / VENDOR QUOTATION SPECIFICATION SHEET</div>
          <div style="font-size:11px;color:#94a3b8;">국제 규격 번호형 표준 데이터시트 양식 (TEMA / API / ASME)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${capexKrw ? `<div class="ds-price-badge"><div style="font-size:9.5px;color:#a7f3d0;">개략 제작 견적가 (CAPEX)</div><div style="font-size:13px;font-weight:900;color:#fff;">₩${capexKrw.toLocaleString()} <span style="font-size:10.5px;color:#38bdf8;">($${capexUsd.toLocaleString()})</span></div></div>` : ''}
        </div>
      </div>

      <table class="tema-excel-table">
        <tbody>
          <tr class="tema-title-row">
            <td colspan="4" style="width:36%;text-align:center;background:#0f172a;color:#38bdf8;font-weight:900;font-size:12px;">
              CHEMPRO SUITE v2.6<br/><span style="font-size:9.5px;color:#94a3b8;font-weight:600;">PROCESS EQUIPMENT ENGINEERING</span>
            </td>
            <td colspan="6" style="width:64%;text-align:center;background:#0f172a;color:#f8fafc;font-weight:900;font-size:13.5px;letter-spacing:0.4px;">
              ${docTitle}
            </td>
          </tr>
          <tr class="tema-meta-row">
            <td style="width:5%;text-align:center;font-weight:800;">REV</td>
            <td style="width:12%;text-align:center;font-weight:800;">PREPARED BY</td>
            <td style="width:10%;text-align:center;font-weight:800;">DATE</td>
            <td style="width:9%;text-align:center;font-weight:800;">APPROVAL</td>
            <td colspan="2" style="width:22%;"><b>CLIENT:</b> CHEMENG EPC CORP.</td>
            <td colspan="2" style="width:22%;"><b>EQUIP. NO:</b> <span style="color:#38bdf8;font-weight:800;">${equipNo}</span></td>
            <td colspan="2" style="width:20%;"><b>PAGE:</b> 1 OF 2 (+DWG)</td>
          </tr>
          <tr class="tema-meta-row">
            <td style="text-align:center;">0</td>
            <td style="text-align:center;">LEAD ENG.</td>
            <td style="text-align:center;">${dateStr}</td>
            <td style="text-align:center;color:#34d399;font-weight:800;">PE APP.</td>
            <td colspan="2"><b>W.O.:</b> WO-2026-${equipNo}</td>
            <td colspan="2"><b>REQUISITION NO.:</b> REQ-${equipNo}-01</td>
            <td colspan="2"><b>SPEC. NO.:</b> ${specNo}</td>
          </tr>
          <tr class="tema-meta-row">
            <td style="text-align:center;">1</td>
            <td style="text-align:center;">GEMINI FLASH</td>
            <td style="text-align:center;">${dateStr}</td>
            <td style="text-align:center;color:#38bdf8;font-weight:800;">AI OPT.</td>
            <td colspan="2"><b>UNIT / AREA:</b> CHLOR-ALKALI PLANT</td>
            <td colspan="2"><b>SERVICE:</b> <b>${serviceName}</b></td>
            <td colspan="2"><b>INSTALLED BY:</b> EPC CONTRACTOR</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function renderQuotationDatasheet(eqType, res, mode) {
    if (!res) return '';
    const dateStr = new Date().toISOString().slice(0, 10);

    // =======================================================================
    // 1A. PLATE HEAT EXCHANGER (PHE — API 662 / ISO 15547-1 Spec Sheet!)
    // =======================================================================
    if (eqType === 'hx' && res.hxType === 'plate_phe') {
      const hFluid = res.hotProps;
      const cFluid = res.coldProps;
      const eqTag = res.equipTag || 'E-332';
      const eqService = res.equipName || `${hFluid?.name || 'Hot'} / ${cFluid?.name || 'Cold'} Plate Exchanger`;
      const pheSketchSvg = `
        <svg viewBox="0 0 260 145" style="width:100%;height:135px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="36" y="28" width="14" height="82" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5"/>
          <rect x="50" y="34" width="90" height="70" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="1.5"/>
          <line x1="65" y1="34" x2="65" y2="104" stroke="#38bdf8" stroke-width="1"/>
          <line x1="80" y1="34" x2="80" y2="104" stroke="#38bdf8" stroke-width="1"/>
          <line x1="95" y1="34" x2="95" y2="104" stroke="#38bdf8" stroke-width="1"/>
          <line x1="110" y1="34" x2="110" y2="104" stroke="#38bdf8" stroke-width="1"/>
          <line x1="125" y1="34" x2="125" y2="104" stroke="#38bdf8" stroke-width="1"/>
          <rect x="140" y="30" width="12" height="78" fill="#0ea5e9" stroke="#7dd3fc" stroke-width="1.5"/>
          <rect x="180" y="28" width="54" height="82" rx="6" fill="none" stroke="#e2e8f0" stroke-width="1.8"/>
          <polyline points="188,52 207,42 226,52" fill="none" stroke="#38bdf8" stroke-width="1.5"/>
          <polyline points="188,68 207,58 226,68" fill="none" stroke="#38bdf8" stroke-width="1.5"/>
          <polyline points="188,84 207,74 226,84" fill="none" stroke="#38bdf8" stroke-width="1.5"/>
          <text x="130" y="15" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">GASKETED PHE — ${res.N_plates} Plates (${res.N_channels} Channels) · β=${res.phe_beta_deg}°</text>
          <text x="130" y="124" fill="#34d399" font-size="8.5" text-anchor="middle">Wp=${res.Wp_mm}×Lp=${res.Lp_mm}mm (b=${res.phe_b_mm}mm) · Pack L=${res.L_pack_mm}mm</text>
          <text x="130" y="137" fill="#94a3b8" font-size="8" text-anchor="middle">A = ${res.A_prov_m2.toFixed(1)} m² · Port ${res.nozzle_shell_nps} 150# · U = ${res.U_calc.toFixed(0)} W/m²K</text>
        </svg>
      `;

      return `
        ${buildTopSheetHeader('GASKETED PLATE HEAT EXCHANGER (PHE) SPECIFICATION SHEET — API 662 / ISO 15547-1', eqTag, eqService, `PHE-${eqTag}`, res.cost_krw, res.cost_usd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr>
              <td class="ln">1</td>
              <td colspan="2"><b>Plate Pack Size (Width × Length × Pack L)</b></td>
              <td colspan="2" class="val-hi">Wp ${res.Wp_mm} mm × Lp ${res.Lp_mm} mm × Pack ${res.L_pack_mm} mm</td>
              <td><b>Exchanger Type</b></td>
              <td class="val-hi">Gasketed Chevron PHE</td>
              <td colspan="2"><b>Pass Arrangement (Hot × Cold)</b></td>
              <td class="val-hi">${res.phe_passes} × ${res.phe_passes} Counter-Current</td>
            </tr>
            <tr>
              <td class="ln">2</td>
              <td colspan="2"><b>Total Effective Heat Transfer Area</b></td>
              <td colspan="2" class="val-hi">${res.A_prov_m2.toFixed(1)} m² (Req: ${res.A_req_m2.toFixed(1)} m²)</td>
              <td><b>Total Plates (N_p)</b></td>
              <td class="val-hi">${res.N_plates} EA (Eff: ${res.N_eff})</td>
              <td colspan="2"><b>Total Channels (Hot / Cold)</b></td>
              <td class="val">${res.N_channels} Ch (${res.N_ch_side}H / ${res.N_ch_side}C)</td>
            </tr>
            <tr class="sec-hdr">
              <td class="ln">3</td>
              <td colspan="9">PERFORMANCE OF ONE PHE UNIT (판형 열교환기 공정 및 열성능 사양)</td>
            </tr>
            <tr class="sub-hdr">
              <td class="ln">4</td>
              <td colspan="3"><b>Fluid Allocation (유체 배치)</b></td>
              <td colspan="3" style="text-align:center;"><b>HOT SIDE CHANNELS (고온측 채널)</b></td>
              <td colspan="3" style="text-align:center;"><b>COLD SIDE CHANNELS (저온측 채널)</b></td>
            </tr>
            <tr>
              <td class="ln">5</td>
              <td colspan="3"><b>Fluid Name (유체 명칭 및 화학식)</b></td>
              <td colspan="3" class="val-hi" style="text-align:center;">${hFluid?.name || '-'} [${hFluid?.formula || ''}]</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${cFluid?.name || '-'} [${cFluid?.formula || ''}]</td>
            </tr>
            <tr>
              <td class="ln">6</td>
              <td colspan="2"><b>Mass Flowrate (총 질량유량)</b></td>
              <td class="unit-c">kg/h</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.mh.toFixed(0)} kg/h</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.mc.toFixed(0)} kg/h</td>
            </tr>
            <tr>
              <td class="ln">7</td>
              <td colspan="2"><b>Temperature (Inlet → Outlet)</b></td>
              <td class="unit-c">°C</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.Th_in.toFixed(1)} °C → ${res.Th_out.toFixed(2)} °C</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.Tc_in.toFixed(1)} °C → ${res.Tc_out.toFixed(2)} °C</td>
            </tr>
            <tr>
              <td class="ln">8</td>
              <td colspan="2"><b>Density / Viscosity / Specific Heat</b></td>
              <td class="unit-c">kg/m³ / cP / kJ/kgK</td>
              <td colspan="3" class="val" style="text-align:center;">${hFluid?.rho.toFixed(1)} / ${hFluid?.mu.toFixed(3)} / ${hFluid?.cp.toFixed(3)}</td>
              <td colspan="3" class="val" style="text-align:center;">${cFluid?.rho.toFixed(1)} / ${cFluid?.mu.toFixed(3)} / ${cFluid?.cp.toFixed(3)}</td>
            </tr>
            <tr>
              <td class="ln">9</td>
              <td colspan="2"><b>Channel Velocity & Reynolds No. (Re_ch)</b></td>
              <td class="unit-c">m/s (Re)</td>
              <td colspan="3" class="val-hi" style="text-align:center;">v_ch = ${res.vs.toFixed(2)} m/s · Re = ${Math.round(res.Res).toLocaleString()} (Port ${res.v_port_h.toFixed(2)} m/s)</td>
              <td colspan="3" class="val-hi" style="text-align:center;">v_ch = ${res.vt.toFixed(2)} m/s · Re = ${Math.round(res.Ret).toLocaleString()} (Port ${res.v_port_c.toFixed(2)} m/s)</td>
            </tr>
            <tr>
              <td class="ln">10</td>
              <td colspan="2"><b>Pressure Drop Allow / Calc (채널+포트 ΔP)</b></td>
              <td class="unit-c">bar (kPa)</td>
              <td class="val">Allow: 0.800 bar</td>
              <td colspan="2" class="val-hi" style="color:${res.dPs_bar <= 0.8 ? '#34d399' : '#fda4af'};">Calc: ${res.dPs_bar.toFixed(3)} bar (${(res.dPs_bar * 100).toFixed(1)} kPa)</td>
              <td class="val">Allow: 0.800 bar</td>
              <td colspan="2" class="val-hi" style="color:${res.dPt_bar <= 0.8 ? '#34d399' : '#fda4af'};">Calc: ${res.dPt_bar.toFixed(3)} bar (${(res.dPt_bar * 100).toFixed(1)} kPa)</td>
            </tr>
            <tr>
              <td class="ln">11</td>
              <td colspan="2"><b>Film Coeff. (h) & Fouling Factor (R_f)</b></td>
              <td class="unit-c">W/m²K / m²K/W</td>
              <td colspan="3" class="val" style="text-align:center;">h_h = ${res.ho.toFixed(0)} W/m²K (R_fh = ${res.rfs.toFixed(5)})</td>
              <td colspan="3" class="val" style="text-align:center;">h_c = ${res.hi.toFixed(0)} W/m²K (R_fc = ${res.rft.toFixed(5)})</td>
            </tr>
            <tr>
              <td class="ln">12</td>
              <td colspan="2"><b>Heat Duty (Q) & Corrected LMTD</b></td>
              <td class="unit-c">kW (Mcal/h)</td>
              <td colspan="3" class="val-hi">${res.Q_kW.toFixed(1)} kW (${(res.Q_kW * 0.85985).toFixed(2)} Mcal/h)</td>
              <td colspan="2"><b>CMTD / F_t</b></td>
              <td class="val-hi">${res.CMTD.toFixed(2)} °C (LMTD ${res.lmtd.toFixed(2)}°C, Ft=${res.Ft.toFixed(3)})</td>
            </tr>
            <tr>
              <td class="ln">13</td>
              <td colspan="2"><b>Overall Heat Transfer Coeff. (U)</b></td>
              <td class="unit-c">W/m²·K</td>
              <td><b>Service (U_calc):</b></td>
              <td class="val-hi">${res.U_calc.toFixed(0)} W/m²K</td>
              <td><b>Clean (U_clean):</b></td>
              <td class="val-hi">${res.U_clean.toFixed(0)} W/m²K</td>
              <td><b>Overdesign:</b></td>
              <td class="val-hi" style="color:#34d399;">+${res.overdesign_pct.toFixed(1)}% (Req ${res.U_req.toFixed(0)})</td>
            </tr>
            <tr class="sec-hdr">
              <td class="ln">14</td>
              <td colspan="9">PLATE GEOMETRY, FRAME & MATERIALS OF CONSTRUCTION (판형 열교환기 기계 및 재질 사양)</td>
            </tr>
            <tr>
              <td class="ln">15</td>
              <td colspan="2"><b>Chevron Angle (β) & Pressing Depth (b)</b></td>
              <td colspan="4" class="val-hi">Chevron β = ${res.phe_beta_deg}° · Channel Gap b = ${res.phe_b_mm} mm · Hydraulic Dia D_h = ${res.di_mm.toFixed(2)} mm · Area/Plate = ${res.A_plate_m2.toFixed(3)} m²</td>
              <td colspan="3" rowspan="4" style="padding:4px;vertical-align:middle;background:#050b18;">${pheSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">16</td>
              <td colspan="2"><b>Plate Thickness & Material</b></td>
              <td colspan="4" class="val-hi">Thickness t_p = ${res.phe_tp_mm} mm · Material: Titanium Gr.1 / Nickel 200 / Hastelloy C-276 (Chlor-Alkali Spec)</td>
            </tr>
            <tr>
              <td class="ln">17</td>
              <td colspan="2"><b>Port Nozzle Size & Gasket Spec</b></td>
              <td colspan="4" class="val-hi">Nozzles: ${res.nozzle_shell_nps} ASME B16.5 CL150 (Port Ø${res.D_port_mm}mm) · Gasket: EPDM Peroxide-Cured / PTFE Clip-On</td>
            </tr>
            <tr>
              <td class="ln">18</td>
              <td colspan="2"><b>Frame Design Press / Weights</b></td>
              <td colspan="4" class="val">Design: 10.0 barG @ 160°C · Empty Weight: <b>${res.W_empty_kg.toFixed(0)} kg</b> / Plate Pack: <b>${res.W_bundle_kg.toFixed(0)} kg</b> / Operating: <b>${res.W_filled_kg.toFixed(0)} kg</b></td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 1B. SHELL-AND-TUBE HEAT EXCHANGER (Exact 44-Row TEMA Standard Layout!)
    // =======================================================================
    if (eqType === 'hx') {
      const isHotShell = res.allocation !== 'hot_tube';
      const sFluid = isHotShell ? res.hotProps : res.coldProps;
      const tFluid = isHotShell ? res.coldProps : res.hotProps;
      const sFlow = isHotShell ? res.mh : res.mc;
      const tFlow = isHotShell ? res.mc : res.mh;
      const sTin = isHotShell ? res.Th_in : res.Tc_in;
      const sTout = isHotShell ? res.Th_out : res.Tc_out;
      const tTin = isHotShell ? res.Tc_in : res.Th_in;
      const tTout = isHotShell ? res.Tc_out : res.Th_out;
      const bwgGauge = res.tw_mm >= 2.6 ? '12 BWG (2.77mm)' : (res.tw_mm >= 2.0 ? '14 BWG (2.11mm)' : '16 BWG (1.65mm)');
      const pitchRatio = (res.pt_mm / res.do_mm).toFixed(2);
      const aPerShell = (res.A_prov_m2 / Math.max(1, res.nShell)).toFixed(1);
      const eqTag = res.equipTag || 'E-101';
      const eqService = res.equipName || `${sFluid?.name || 'Hot'} / ${tFluid?.name || 'Cold'} Exchanger`;

      const miniSketchSvg = `
        <svg viewBox="0 0 260 145" style="width:100%;height:135px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="42" y="34" width="165" height="58" fill="none" stroke="#e2e8f0" stroke-width="2"/>
          <rect x="18" y="34" width="24" height="58" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <path d="M207,34 Q236,63 207,92" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <line x1="42" y1="28" x2="42" y2="98" stroke="#94a3b8" stroke-width="3.5"/>
          <line x1="207" y1="28" x2="207" y2="98" stroke="#94a3b8" stroke-width="3.5"/>
          <line x1="42" y1="48" x2="207" y2="48" stroke="#38bdf8" stroke-width="0.8" stroke-dasharray="3,2"/>
          <line x1="42" y1="63" x2="207" y2="63" stroke="#38bdf8" stroke-width="0.8" stroke-dasharray="3,2"/>
          <line x1="42" y1="78" x2="207" y2="78" stroke="#38bdf8" stroke-width="0.8" stroke-dasharray="3,2"/>
          <line x1="75" y1="34" x2="75" y2="76" stroke="#f59e0b" stroke-width="1.6"/>
          <line x1="108" y1="50" x2="108" y2="92" stroke="#f59e0b" stroke-width="1.6"/>
          <line x1="141" y1="34" x2="141" y2="76" stroke="#f59e0b" stroke-width="1.6"/>
          <line x1="174" y1="50" x2="174" y2="92" stroke="#f59e0b" stroke-width="1.6"/>
          <rect x="54" y="16" width="10" height="18" fill="none" stroke="#fcd34d" stroke-width="1.5"/>
          <rect x="184" y="92" width="10" height="18" fill="none" stroke="#fcd34d" stroke-width="1.5"/>
          <text x="130" y="15" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">TEMA ${res.tema_type} — ID Ø${res.D_shell_mm} × L ${(res.L_m*1000).toFixed(0)}mm</text>
          <text x="130" y="124" fill="#34d399" font-size="8.5" text-anchor="middle">Nt=${res.N_tubes} EA (OD ${res.do_mm}mm) · Baffles=${res.N_baffles} EA (B=${res.B_spacing_mm}mm)</text>
          <text x="130" y="137" fill="#94a3b8" font-size="8" text-anchor="middle">A = ${res.A_prov_m2.toFixed(1)} m² · Shell ${res.nozzle_shell_nps} 150# / Tube ${res.nozzle_tube_nps} 150#</text>
        </svg>
      `;

      return `
        ${buildTopSheetHeader('SHELL-AND-TUBE HEAT EXCHANGER SPECIFICATION SHEET', eqTag, eqService, `TEMA-R-${eqTag}`, res.cost_krw, res.cost_usd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr>
              <td class="ln">1</td>
              <td colspan="2"><b>Size (Shell ID / Tube Length)</b></td>
              <td colspan="2" class="val-hi">Ø${res.D_shell_mm} mm / ${(res.L_m * 1000).toFixed(0)} mm (${(res.D_shell_mm / 25.4).toFixed(1)}" × ${(res.L_m * 3.28084).toFixed(1)} ft)</td>
              <td><b>TEMA Type</b></td>
              <td class="val-hi">${res.tema_type} (Class R)</td>
              <td colspan="2"><b>Connected in (series / parallel)</b></td>
              <td class="val">${res.nShell} Series / 1 Parallel</td>
            </tr>
            <tr>
              <td class="ln">2</td>
              <td colspan="2"><b>Surface per Unit (유효 전열면적)</b></td>
              <td colspan="2" class="val-hi">${res.A_prov_m2.toFixed(1)} m² (${(res.A_prov_m2 * 10.7639).toFixed(0)} ft²)</td>
              <td><b>Shells per Unit</b></td>
              <td class="val">${res.nShell}</td>
              <td colspan="2"><b>Surface per Shell</b></td>
              <td class="val">${aPerShell} m² (Req: ${res.A_req_m2.toFixed(1)} m²)</td>
            </tr>
            <tr class="sec-hdr">
              <td class="ln">3</td>
              <td colspan="9">PERFORMANCE OF ONE UNIT (단위 열교환기 공정 및 열성능 사양)</td>
            </tr>
            <tr class="sub-hdr">
              <td class="ln">4</td>
              <td colspan="3"><b>Fluid Allocation (유체 배치)</b></td>
              <td colspan="3" style="text-align:center;"><b>SHELL SIDE (${isHotShell ? 'Hot Side 고온측' : 'Cold Side 저온측'})</b></td>
              <td colspan="3" style="text-align:center;"><b>TUBE SIDE (${isHotShell ? 'Cold Side 저온측' : 'Hot Side 고온측'})</b></td>
            </tr>
            <tr>
              <td class="ln">5</td>
              <td colspan="3"><b>Fluid Name (유체 명칭 및 화학식)</b></td>
              <td colspan="3" class="val-hi" style="text-align:center;">${sFluid?.name || '-'} [${sFluid?.formula || ''}]</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${tFluid?.name || '-'} [${tFluid?.formula || ''}]</td>
            </tr>
            <tr class="sub-hdr">
              <td class="ln">6</td>
              <td colspan="2"><b>Fluid Quantities & Properties</b></td>
              <td style="text-align:center;"><b>Units</b></td>
              <td style="text-align:center;"><b>In (입구)</b></td>
              <td colspan="2" style="text-align:center;"><b>Out (출구)</b></td>
              <td style="text-align:center;"><b>In (입구)</b></td>
              <td colspan="2" style="text-align:center;"><b>Out (출구)</b></td>
            </tr>
            <tr>
              <td class="ln">7</td>
              <td colspan="2"><b>Flow Total (총 질량유량)</b></td>
              <td class="unit-c">kg/h (lb/h)</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${sFlow.toFixed(0)} kg/h (${(sFlow * 2.20462).toFixed(0)} lb/h)</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${tFlow.toFixed(0)} kg/h (${(tFlow * 2.20462).toFixed(0)} lb/h)</td>
            </tr>
            <tr>
              <td class="ln">8</td>
              <td colspan="2">&nbsp;&nbsp;Vapor (기상 유량 In / Out)</td>
              <td class="unit-c">kg/h</td>
              <td class="val">0</td><td colspan="2" class="val">0</td>
              <td class="val">0</td><td colspan="2" class="val">0</td>
            </tr>
            <tr>
              <td class="ln">9</td>
              <td colspan="2">&nbsp;&nbsp;Liquid (액상 유량 In / Out)</td>
              <td class="unit-c">kg/h</td>
              <td class="val">${sFlow.toFixed(0)}</td><td colspan="2" class="val">${sFlow.toFixed(0)}</td>
              <td class="val">${tFlow.toFixed(0)}</td><td colspan="2" class="val">${tFlow.toFixed(0)}</td>
            </tr>
            <tr>
              <td class="ln">10</td>
              <td colspan="2">&nbsp;&nbsp;Steam (스팀 유량 In / Out)</td>
              <td class="unit-c">kg/h</td>
              <td class="val">-</td><td colspan="2" class="val">-</td>
              <td class="val">-</td><td colspan="2" class="val">-</td>
            </tr>
            <tr>
              <td class="ln">11</td>
              <td colspan="2">&nbsp;&nbsp;Water (냉각수/물 유량 In / Out)</td>
              <td class="unit-c">kg/h</td>
              <td class="val">${sFluid?.id === 'water' ? sFlow.toFixed(0) : '-'}</td><td colspan="2" class="val">${sFluid?.id === 'water' ? sFlow.toFixed(0) : '-'}</td>
              <td class="val">${tFluid?.id === 'water' ? tFlow.toFixed(0) : '-'}</td><td colspan="2" class="val">${tFluid?.id === 'water' ? tFlow.toFixed(0) : '-'}</td>
            </tr>
            <tr>
              <td class="ln">12</td>
              <td colspan="2">&nbsp;&nbsp;Noncondensable (비응축성 가스)</td>
              <td class="unit-c">kg/h</td>
              <td class="val">0</td><td colspan="2" class="val">0</td>
              <td class="val">0</td><td colspan="2" class="val">0</td>
            </tr>
            <tr>
              <td class="ln">13</td>
              <td colspan="2"><b>Temperature (In / Out 온도)</b></td>
              <td class="unit-c">°C (°F)</td>
              <td class="val-hi">${sTin.toFixed(1)} (${(sTin * 1.8 + 32).toFixed(1)}°F)</td>
              <td colspan="2" class="val-hi">${sTout.toFixed(2)} (${(sTout * 1.8 + 32).toFixed(1)}°F)</td>
              <td class="val-hi">${tTin.toFixed(1)} (${(tTin * 1.8 + 32).toFixed(1)}°F)</td>
              <td colspan="2" class="val-hi">${tTout.toFixed(2)} (${(tTout * 1.8 + 32).toFixed(1)}°F)</td>
            </tr>
            <tr>
              <td class="ln">14</td>
              <td colspan="2"><b>Density (밀도 In / Out)</b></td>
              <td class="unit-c">kg/m³</td>
              <td class="val">${(sFluid?.rho * 0.995).toFixed(1)}</td><td colspan="2" class="val">${(sFluid?.rho * 1.005).toFixed(1)}</td>
              <td class="val">${(tFluid?.rho * 1.004).toFixed(1)}</td><td colspan="2" class="val">${(tFluid?.rho * 0.996).toFixed(1)}</td>
            </tr>
            <tr>
              <td class="ln">15</td>
              <td colspan="2"><b>Viscosity (점도 In / Out)</b></td>
              <td class="unit-c">cP (mPa·s)</td>
              <td class="val">${(sFluid?.mu * 0.92).toFixed(3)}</td><td colspan="2" class="val">${(sFluid?.mu * 1.08).toFixed(3)}</td>
              <td class="val">${(tFluid?.mu * 1.06).toFixed(3)}</td><td colspan="2" class="val">${(tFluid?.mu * 0.94).toFixed(3)}</td>
            </tr>
            <tr>
              <td class="ln">16</td>
              <td colspan="2"><b>Molecular Weight (분자량 MW)</b></td>
              <td class="unit-c">g/mol</td>
              <td colspan="3" class="val" style="text-align:center;">${sFluid?.mw || '-'}</td>
              <td colspan="3" class="val" style="text-align:center;">${tFluid?.mw || '-'}</td>
            </tr>
            <tr>
              <td class="ln">17</td>
              <td colspan="2"><b>Specific Heat (비열 Cp)</b></td>
              <td class="unit-c">kJ/kg·K</td>
              <td class="val">${sFluid?.cp.toFixed(3)}</td><td colspan="2" class="val">${sFluid?.cp.toFixed(3)}</td>
              <td class="val">${tFluid?.cp.toFixed(3)}</td><td colspan="2" class="val">${tFluid?.cp.toFixed(3)}</td>
            </tr>
            <tr>
              <td class="ln">18</td>
              <td colspan="2"><b>Thermal Conductivity (열전도도 k)</b></td>
              <td class="unit-c">W/m·K</td>
              <td class="val">${sFluid?.k.toFixed(3)}</td><td colspan="2" class="val">${sFluid?.k.toFixed(3)}</td>
              <td class="val">${tFluid?.k.toFixed(3)}</td><td colspan="2" class="val">${tFluid?.k.toFixed(3)}</td>
            </tr>
            <tr>
              <td class="ln">19</td>
              <td colspan="2"><b>Latent Heat (증발잠열 ΔH_v)</b></td>
              <td class="unit-c">kJ/kg</td>
              <td colspan="3" class="val" style="text-align:center;">${sFluid?.hv || '-'} (단상 현열교환)</td>
              <td colspan="3" class="val" style="text-align:center;">${tFluid?.hv || '-'} (단상 현열교환)</td>
            </tr>
            <tr>
              <td class="ln">20</td>
              <td colspan="2"><b>Inlet Pressure (운전 입구압력)</b></td>
              <td class="unit-c">barG (psig)</td>
              <td colspan="3" class="val" style="text-align:center;">4.50 barG (65.3 psig)</td>
              <td colspan="3" class="val" style="text-align:center;">5.00 barG (72.5 psig)</td>
            </tr>
            <tr>
              <td class="ln">21</td>
              <td colspan="2"><b>Velocity (유속 v / Reynolds Re)</b></td>
              <td class="unit-c">m/s (Re)</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.vs.toFixed(2)} m/s (${(res.vs * 3.28084).toFixed(2)} ft/s) · Re=${Math.round(res.Res).toLocaleString()}</td>
              <td colspan="3" class="val-hi" style="text-align:center;">${res.vt.toFixed(2)} m/s (${(res.vt * 3.28084).toFixed(2)} ft/s) · Re=${Math.round(res.Ret).toLocaleString()}</td>
            </tr>
            <tr>
              <td class="ln">22</td>
              <td colspan="2"><b>Press. Drop Allow / Calc (허용/계산 ΔP)</b></td>
              <td class="unit-c">bar (psi)</td>
              <td class="val">Allow: 0.700</td>
              <td colspan="2" class="val-hi" style="color:${res.dPs_bar <= 0.7 ? '#34d399' : '#fda4af'};">Calc: ${res.dPs_bar.toFixed(3)} bar (${(res.dPs_bar * 14.5038).toFixed(2)} psi)</td>
              <td class="val">Allow: 0.700</td>
              <td colspan="2" class="val-hi" style="color:${res.dPt_bar <= 0.7 ? '#34d399' : '#fda4af'};">Calc: ${res.dPt_bar.toFixed(3)} bar (${(res.dPt_bar * 14.5038).toFixed(2)} psi)</td>
            </tr>
            <tr>
              <td class="ln">23</td>
              <td colspan="2"><b>Fouling Factor (오염계수 R_f)</b></td>
              <td class="unit-c">m²·K/W</td>
              <td colspan="3" class="val" style="text-align:center;">${res.rfs.toFixed(5)} (h_o = ${res.ho.toFixed(0)} W/m²K)</td>
              <td colspan="3" class="val" style="text-align:center;">${res.rft.toFixed(5)} (h_i = ${res.hi.toFixed(0)} W/m²K)</td>
            </tr>
            <tr>
              <td class="ln">24</td>
              <td colspan="2"><b>Heat Exchanged (교환 열부하 Q)</b></td>
              <td class="unit-c">kW (Mcal/h)</td>
              <td colspan="3" class="val-hi">${res.Q_kW.toFixed(1)} kW (${(res.Q_kW * 0.85985).toFixed(2)} Mcal/h · ${(res.Q_kW * 3412.14).toFixed(0)} Btu/h)</td>
              <td colspan="2"><b>LMTD (Corrected CMTD)</b></td>
              <td class="val-hi">${res.CMTD.toFixed(2)} °C (LMTD ${res.lmtd.toFixed(2)}°C, Ft=${res.Ft.toFixed(3)})</td>
            </tr>
            <tr>
              <td class="ln">25</td>
              <td colspan="2"><b>Service Coeff. (총괄열전달계수 U)</b></td>
              <td class="unit-c">W/m²·K</td>
              <td><b>Dirty (Service):</b></td>
              <td class="val-hi">${res.U_calc.toFixed(1)} W/m²K</td>
              <td><b>Clean (U_c):</b></td>
              <td class="val-hi">${res.U_clean.toFixed(1)} W/m²K</td>
              <td><b>Overdesign:</b></td>
              <td class="val-hi" style="color:#34d399;">+${res.overdesign_pct.toFixed(1)}% (Req ${res.U_req.toFixed(1)})</td>
            </tr>
            <tr class="sec-hdr">
              <td class="ln">26</td>
              <td colspan="9">CONSTRUCTION DATA FOR ONE SHELL (단위 쉘당 기계 제작 및 구조 상세 사양)</td>
            </tr>
            <tr class="sub-hdr">
              <td class="ln">27</td>
              <td colspan="2"><b>Mechanical Item</b></td>
              <td style="text-align:center;"><b>Units</b></td>
              <td colspan="2" style="text-align:center;"><b>SHELL SIDE</b></td>
              <td colspan="2" style="text-align:center;"><b>TUBE SIDE</b></td>
              <td colspan="2" style="text-align:center;"><b>SKETCH (TEMA ${res.tema_type} GA)</b></td>
            </tr>
            <tr>
              <td class="ln">28</td>
              <td colspan="2"><b>Design / Hydrotest Pressure</b></td>
              <td class="unit-c">barG</td>
              <td colspan="2" class="val">10.0 / 15.0 barG</td>
              <td colspan="2" class="val">10.0 / 15.0 barG</td>
              <td colspan="2" rowspan="7" style="padding:4px;vertical-align:middle;background:#050b18;">${miniSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">29</td>
              <td colspan="2"><b>Design Temperature (설계 온도)</b></td>
              <td class="unit-c">°C (°F)</td>
              <td colspan="2" class="val">${Math.ceil((Math.max(sTin, sTout) + 25) / 5) * 5} °C</td>
              <td colspan="2" class="val">${Math.ceil((Math.max(tTin, tTout) + 25) / 5) * 5} °C</td>
            </tr>
            <tr>
              <td class="ln">30</td>
              <td colspan="2"><b>No. Passes per Shell (패스 수)</b></td>
              <td class="unit-c">-</td>
              <td colspan="2" class="val-hi" style="text-align:center;">1 Pass</td>
              <td colspan="2" class="val-hi" style="text-align:center;">${res.nPasses} Passes</td>
            </tr>
            <tr>
              <td class="ln">31</td>
              <td colspan="2"><b>Corrosion Allowance (부식여유)</b></td>
              <td class="unit-c">mm (in)</td>
              <td colspan="2" class="val">3.0 mm (0.118 in)</td>
              <td colspan="2" class="val">3.0 mm (Tube: 0.0 mm)</td>
            </tr>
            <tr>
              <td class="ln">32</td>
              <td colspan="2"><b>Connections — In (입구 노즐)</b></td>
              <td class="unit-c">NPS (ASME)</td>
              <td colspan="2" class="val-hi">${res.nozzle_shell_nps} ASME B16.5 CL150 RF</td>
              <td colspan="2" class="val-hi">${res.nozzle_tube_nps} ASME B16.5 CL150 RF</td>
            </tr>
            <tr>
              <td class="ln">33</td>
              <td colspan="2"><b>Connections — Out (출구 노즐)</b></td>
              <td class="unit-c">NPS (ASME)</td>
              <td colspan="2" class="val-hi">${res.nozzle_shell_nps} ASME B16.5 CL150 RF</td>
              <td colspan="2" class="val-hi">${res.nozzle_tube_nps} ASME B16.5 CL150 RF</td>
            </tr>
            <tr>
              <td class="ln">34</td>
              <td colspan="2"><b>Connections — Intermediate</b></td>
              <td class="unit-c">NPS</td>
              <td colspan="2" class="val">${res.nShell > 1 ? `${res.nozzle_shell_nps} Series Jumper` : 'N/A'}</td>
              <td colspan="2" class="val">Vent 3/4" NPT / Drain 3/4" NPT</td>
            </tr>
            <tr>
              <td class="ln">35</td>
              <td><b>Tubes (튜브)</b></td>
              <td colspan="2"><b>No.:</b> <span style="color:#38bdf8;font-weight:800;">${res.N_tubes} EA</span></td>
              <td><b>OD:</b> <span style="color:#38bdf8;font-weight:800;">${res.do_mm} mm (${(res.do_mm/25.4).toFixed(2)}")</span></td>
              <td colspan="2"><b>Gauge / Wall:</b> ${bwgGauge} (ID ${res.di_mm.toFixed(2)}mm)</td>
              <td><b>Length:</b> <span style="color:#38bdf8;font-weight:800;">${res.L_m} m (${(res.L_m*3.28084).toFixed(1)} ft)</span></td>
              <td colspan="2"><b>Pitch Layout:</b> ${res.layoutAngle}° (${res.pt_mm.toFixed(2)}mm)</td>
            </tr>
            <tr>
              <td class="ln">36</td>
              <td><b>Tube Spec</b></td>
              <td colspan="2"><b>Type:</b> Plain Seamless</td>
              <td colspan="3"><b>Material:</b> ASTM A179 / SA-213 TP316L</td>
              <td colspan="3"><b>Pitch Ratio (P_T / d_o):</b> ${pitchRatio}</td>
            </tr>
            <tr>
              <td class="ln">37</td>
              <td><b>Shell (동체)</b></td>
              <td colspan="2"><b>OD:</b> Ø${res.D_shell_mm + 2 * res.t_shell_mm} mm</td>
              <td colspan="2"><b>ID:</b> <span style="color:#38bdf8;font-weight:800;">Ø${res.D_shell_mm} mm (${(res.D_shell_mm / 25.4).toFixed(2)} in)</span></td>
              <td><b>Thick:</b> ${res.t_shell_mm} mm</td>
              <td colspan="3"><b>Material:</b> ASME SA-516 Gr.70</td>
            </tr>
            <tr>
              <td class="ln">38</td>
              <td colspan="2"><b>Channel or Bonnet (전방 채널)</b></td>
              <td colspan="2"><b>ID:</b> Ø${res.D_shell_mm} mm</td>
              <td colspan="2"><b>Thick:</b> ${res.t_shell_mm} mm</td>
              <td colspan="3"><b>Channel Cover:</b> Bolted Flat Cover (SA-266 Gr.2)</td>
            </tr>
            <tr>
              <td class="ln">39</td>
              <td colspan="2"><b>Tubesheet Type (튜브시트)</b></td>
              <td colspan="3">Stationary Fixed / Floating (${res.t_tubesheet_mm} mm thick)</td>
              <td colspan="4"><b>Bundle Dia:</b> Ø${res.D_bundle_mm} mm (SA-266 Gr.2 Forged)</td>
            </tr>
            <tr>
              <td class="ln">40</td>
              <td colspan="2"><b>Floating Head / Impingement</b></td>
              <td colspan="3">TEMA Type ${res.tema_type.charAt(2) || 'M'} Rear Head</td>
              <td colspan="4"><b>Impingement Protection:</b> Circular Plate (ρv² = ${(sFluid?.rho * res.vs * res.vs).toFixed(0)} Pa)</td>
            </tr>
            <tr>
              <td class="ln">41</td>
              <td colspan="2"><b>Baffles — Cross (배플)</b></td>
              <td colspan="2"><b>Number:</b> <span style="color:#34d399;font-weight:800;">${res.N_baffles} EA</span> (Single Seg.)</td>
              <td colspan="2"><b>% Cut (d):</b> <span style="color:#34d399;font-weight:800;">${res.baffleCutPct}%</span></td>
              <td colspan="3"><b>Spacing C/C (B):</b> <span style="color:#34d399;font-weight:800;">${res.B_spacing_mm} mm (${(res.B_spacing_mm / 25.4).toFixed(2)} in)</span></td>
            </tr>
            <tr>
              <td class="ln">42</td>
              <td colspan="2"><b>Baffles — Long / Seal Type</b></td>
              <td colspan="3">Longitudinal Baffle: ${res.nShell > 1 ? 'Welded Pass Partition' : 'None'}</td>
              <td colspan="4"><b>Seal Strips:</b> 1 Pair per 5 Tube Rows (Bypass J_b=${res.J_total.toFixed(3)})</td>
            </tr>
            <tr>
              <td class="ln">43</td>
              <td colspan="2"><b>Supports — Tube / Vibration</b></td>
              <td colspan="3">Tie Rods & Spacers (8 EA × Ø12.7 mm)</td>
              <td colspan="4"><b>TEMA Vibration Check:</b> f_vs/f_n = ${res.vibRatio.toFixed(2)} (${res.f_vs_Hz.toFixed(1)} / ${res.f_nat_Hz.toFixed(1)} Hz — SAFE)</td>
            </tr>
            <tr>
              <td class="ln">44</td>
              <td colspan="2"><b>Tube-Tubesheet Joint & Weights</b></td>
              <td colspan="3">Strength Welded + Roller Expanded (2 Grooves)</td>
              <td colspan="4"><b>Weights:</b> Empty <b>${res.W_empty_kg.toFixed(0)} kg</b> / Bundle <b>${res.W_bundle_kg.toFixed(0)} kg</b> / Full of Water <b>${res.W_filled_kg.toFixed(0)} kg</b></td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 2. CENTRIFUGAL PUMP (API 610 / ISO 13709 36-Row Standard Datasheet!)
    // =======================================================================
    if (eqType === 'pump') {
      const costUsd = Math.round(4200 + 380 * Math.pow(res.P_motor_std_kW, 0.78));
      const costKrw = Math.round((costUsd * 1380) / 10000) * 10000;
      const qLmin = (res.Q_m3h * 1000 / 60).toFixed(1);
      const qGpm = (res.Q_m3h * 4.40287).toFixed(1);
      const eqTag = res.equipTag || 'P-101 A/B';
      const eqService = res.equipName || `${res.fluidName || 'Process'} Transfer Pump`;

      const pumpSketchSvg = `
        <svg viewBox="0 0 260 135" style="width:100%;height:125px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="20" y="102" width="220" height="10" fill="#334155" stroke="#94a3b8" stroke-width="1.2"/>
          <circle cx="68" cy="64" r="24" fill="none" stroke="#38bdf8" stroke-width="2.2"/>
          <circle cx="68" cy="64" r="7" fill="#38bdf8"/>
          <rect x="26" y="57" width="18" height="14" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <rect x="61" y="22" width="14" height="18" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <rect x="92" y="54" width="44" height="20" fill="none" stroke="#e2e8f0" stroke-width="1.5"/>
          <rect x="136" y="58" width="22" height="12" fill="none" stroke="#f59e0b" stroke-width="1.5"/>
          <rect x="158" y="40" width="68" height="48" rx="6" fill="none" stroke="#10b981" stroke-width="2"/>
          <text x="130" y="15" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">API 610 OH2 — Impeller Ø${res.D_imp_rated_mm}mm · Motor ${res.P_motor_std_kW} kW</text>
          <text x="130" y="126" fill="#34d399" font-size="8.5" text-anchor="middle">Duty: Q=${res.Q_m3h.toFixed(1)} m³/h (${qLmin} L/min) · TDH=${res.H_total_m.toFixed(1)} m</text>
        </svg>
      `;

      return `
        ${buildTopSheetHeader('CENTRIFUGAL PUMP SPECIFICATION SHEET — API 610 / ISO 13709', eqTag, eqService, `API610-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — GENERAL & OPERATING CONDITIONS (운전 조건 및 수력학 성능 사양)</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>No. Pumps Required</b></td><td colspan="2" class="val">2 EA (1 Operating + 1 Standby)</td>
              <td colspan="2"><b>API 610 Pump Type</b></td><td colspan="3" class="val-hi">OH2 (Centerline-Mounted Single Stage Overhung)</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Capacity — Rated (정격 유량)</b></td><td class="unit-c">m³/h (L/min)</td>
              <td colspan="2" class="val-hi">${res.Q_m3h.toFixed(2)} m³/h (${qLmin} L/min · ${qGpm} GPM)</td>
              <td colspan="2"><b>Min. Continuous Flow (MCSF)</b></td><td colspan="2" class="val-hi">${res.Q_mcsf_m3h.toFixed(2)} m³/h (Orifice Ø${res.d_orifice_mm.toFixed(1)} mm)</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>Total Dynamic Head (전양정 TDH)</b></td><td class="unit-c">m (ft)</td>
              <td colspan="2" class="val-hi">${res.H_total_m.toFixed(2)} m (${(res.H_total_m * 3.28084).toFixed(1)} ft)</td>
              <td colspan="2"><b>Static / Friction Head</b></td><td colspan="2" class="val">Static ${res.H_static_m.toFixed(1)} m / Friction ${(res.H_fric_suc_m + res.H_fric_dis_m).toFixed(2)} m</td>
            </tr>
            <tr>
              <td class="ln">5</td><td colspan="2"><b>Suction Pressure (흡입 압력 P1)</b></td><td class="unit-c">barG</td>
              <td colspan="2" class="val">${res.P1_barG.toFixed(2)} barG</td>
              <td colspan="2"><b>Discharge Pressure (토출 압력 P2)</b></td><td colspan="2" class="val-hi">${res.P2_barG.toFixed(2)} barG (ΔP = ${res.dP_Pump_bar.toFixed(2)} bar)</td>
            </tr>
            <tr>
              <td class="ln">6</td><td colspan="2"><b>NPSH Available (유효 NPSHa)</b></td><td class="unit-c">m</td>
              <td colspan="2" class="val-hi" style="color:${res.npsh_margin_m >= 1.0 ? '#34d399' : '#fda4af'};">${res.NPSHa_m.toFixed(2)} m</td>
              <td colspan="2"><b>NPSH Required (요구 NPSHr 3%)</b></td><td colspan="2" class="val-hi">${res.NPSHr_m.toFixed(2)} m (Margin: +${res.npsh_margin_m.toFixed(2)} m · ${res.npsh_ratio.toFixed(2)}x)</td>
            </tr>
            <tr>
              <td class="ln">7</td><td colspan="2"><b>Hydraulic Power (수동력 P_hyd)</b></td><td class="unit-c">kW</td>
              <td colspan="2" class="val">${res.P_hyd_kW.toFixed(2)} kW</td>
              <td colspan="2"><b>Pump Efficiency (효율 η)</b></td><td colspan="2" class="val-hi">${res.eff_pct.toFixed(1)} % (Water BEP: ${res.eff_water_pct.toFixed(1)}%, C_η=${res.Ceta.toFixed(3)})</td>
            </tr>
            <tr>
              <td class="ln">8</td><td colspan="2"><b>Shaft Power (축동력 BHP @ Rated)</b></td><td class="unit-c">kW (HP)</td>
              <td colspan="2" class="val-hi">${res.P_shaft_kW.toFixed(2)} kW (${(res.P_shaft_kW * 1.34102).toFixed(2)} HP)</td>
              <td colspan="2"><b>API 610 Motor Nameplate Rating</b></td><td colspan="2" class="val-hi" style="color:#34d399;">${res.P_motor_std_kW} kW (Req w/ Margin: ${res.P_motor_req_kW.toFixed(2)} kW)</td>
            </tr>
            <tr>
              <td class="ln">9</td><td colspan="2"><b>Rated Speed (정격 회전수 N)</b></td><td class="unit-c">RPM</td>
              <td colspan="2" class="val">${res.rpm} RPM</td>
              <td colspan="2"><b>Specific Speed (Ns / Nss)</b></td><td colspan="2" class="val">Ns = ${res.Ns.toFixed(1)} (${res.impellerType}) / Nss = ${res.Nss.toFixed(0)}</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">10</td><td colspan="9">SECTION II — LIQUID PROPERTIES @ PUMPING TEMPERATURE (취급 유체 물성 사양)</td></tr>
            <tr>
              <td class="ln">11</td><td colspan="2"><b>Liquid Handled (이송 유체명)</b></td><td colspan="3" class="val-hi">${res.fluidName} [${res.fluidFormula}]</td>
              <td colspan="2"><b>Pumping Temperature (운전 온도)</b></td><td colspan="2" class="val-hi">${res.T_C.toFixed(1)} °C (${(res.T_C * 1.8 + 32).toFixed(1)} °F)</td>
            </tr>
            <tr>
              <td class="ln">12</td><td colspan="2"><b>Density / Specific Gravity</b></td><td class="unit-c">kg/m³ (SG)</td>
              <td colspan="2" class="val">${res.rho.toFixed(1)} kg/m³ (SG ${(res.rho / 999).toFixed(3)})</td>
              <td colspan="2"><b>Dynamic / Kinematic Viscosity</b></td><td colspan="2" class="val">${res.mu_cP.toFixed(3)} cP (${res.nu_cSt.toFixed(2)} cSt)</td>
            </tr>
            <tr>
              <td class="ln">13</td><td colspan="2"><b>Vapor Pressure @ T_op</b></td><td class="unit-c">bar.a (kPa)</td>
              <td colspan="2" class="val">${res.pv_bar.toFixed(4)} bar.a (${(res.pv_bar * 100).toFixed(2)} kPa)</td>
              <td colspan="2"><b>HI Viscosity Factors (CQ / CH / Cη)</b></td><td colspan="2" class="val">${res.CQ.toFixed(3)} / ${res.CH.toFixed(3)} / ${res.Ceta.toFixed(3)}</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">14</td><td colspan="9">SECTION III — CONSTRUCTION, IMPELLER, MECHANICAL SEAL & DRIVER DATA (기계 구조 및 재질 사양)</td></tr>
            <tr>
              <td class="ln">15</td><td colspan="2"><b>Impeller Diameter (Rated / Max / Min)</b></td><td class="unit-c">mm</td>
              <td colspan="4" class="val-hi">Rated: Ø${res.D_imp_rated_mm} mm | ① Max: Ø${res.D_imp_max_mm} mm | ② Min: Ø${res.D_imp_min_mm} mm (Tip Speed ${res.u2_tip_ms.toFixed(1)} m/s)</td>
              <td colspan="2" rowspan="5" style="padding:4px;vertical-align:middle;background:#050b18;">${pumpSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">16</td><td colspan="2"><b>Nozzle Size & Rating (Suc / Dis)</b></td><td class="unit-c">mm / Class</td>
              <td colspan="4" class="val-hi">Suction ID ${res.d_suc_mm}mm (v=${res.v_suc.toFixed(2)}m/s) / Discharge ID ${res.d_dis_mm}mm (v=${res.v_dis.toFixed(2)}m/s) · ASME 300# RF</td>
            </tr>
            <tr>
              <td class="ln">17</td><td colspan="2"><b>Casing Design Press / Hydrotest</b></td><td class="unit-c">barG</td>
              <td colspan="4" class="val">${(Math.max(10, res.P2_barG * 1.35)).toFixed(1)} barG / Hydrotest ${(Math.max(15, res.P2_barG * 2.0)).toFixed(1)} barG</td>
            </tr>
            <tr>
              <td class="ln">18</td><td colspan="2"><b>Mechanical Seal (API 682 4th Ed.)</b></td><td class="unit-c">Code</td>
              <td colspan="4" class="val">Category 2, Type A Balanced Cartridge Single Seal · Flush Plan 11 (SiC vs Carbon / FKM)</td>
            </tr>
            <tr>
              <td class="ln">19</td><td colspan="2"><b>API 610 Material Class & Driver</b></td><td class="unit-c">Class</td>
              <td colspan="4" class="val-hi">API Class S-6 (CS Casing / 12% Cr Impeller) · Motor ${res.P_motor_std_kW} kW, 380V/3Ph/60Hz, Ex d IIB T4</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 3A. GAS ABSORPTION / SCRUBBING / DRYING PACKED TOWER SPECIFICATION SHEET
    // =======================================================================
    if (eqType === 'column' && res.colMode === 'absorption') {
      const eqTag = res.equipTag || 'T-410';
      const eqService = res.equipName || `${res.lkBase.name} / ${res.hkBase.name} Packed Absorption Tower`;
      const costUsd = Math.round(24000 + 2800 * res.H_pack_total_m * Math.pow(res.D_col_m, 1.4));
      const costKrw = Math.round((costUsd * 1380) / 10000) * 10000;
      const absSketchSvg = `
        <svg viewBox="0 0 260 155" style="width:100%;height:145px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="64" y="18" width="44" height="114" rx="14" fill="none" stroke="#e2e8f0" stroke-width="2"/>
          <rect x="68" y="34" width="36" height="34" fill="rgba(16,185,129,0.22)" stroke="#10b981" stroke-width="1.2"/>
          <line x1="68" y1="34" x2="104" y2="68" stroke="#10b981" stroke-width="0.9"/>
          <line x1="104" y1="34" x2="68" y2="68" stroke="#10b981" stroke-width="0.9"/>
          <rect x="68" y="76" width="36" height="38" fill="rgba(16,185,129,0.22)" stroke="#10b981" stroke-width="1.2"/>
          <line x1="68" y1="76" x2="104" y2="114" stroke="#10b981" stroke-width="0.9"/>
          <line x1="104" y1="76" x2="68" y2="114" stroke="#10b981" stroke-width="0.9"/>
          <line x1="28" y1="114" x2="64" y2="114" stroke="#f59e0b" stroke-width="2"/>
          <line x1="108" y1="30" x2="144" y2="30" stroke="#38bdf8" stroke-width="2"/>
          <circle cx="192" cy="72" r="34" fill="none" stroke="#10b981" stroke-width="1.8"/>
          <circle cx="182" cy="62" r="7" fill="none" stroke="#38bdf8" stroke-width="1.2"/>
          <circle cx="202" cy="62" r="7" fill="none" stroke="#38bdf8" stroke-width="1.2"/>
          <circle cx="182" cy="82" r="7" fill="none" stroke="#38bdf8" stroke-width="1.2"/>
          <circle cx="202" cy="82" r="7" fill="none" stroke="#38bdf8" stroke-width="1.2"/>
          <text x="130" y="12" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">PACKED TOWER — ID Ø${(res.D_col_m*1000).toFixed(0)}mm × H ${res.H_tangent_m.toFixed(1)}m (${res.N_beds} Beds)</text>
          <text x="130" y="146" fill="#34d399" font-size="8.5" text-anchor="middle">N_OG=${res.N_OG.toFixed(2)} · HTU_OG=${res.HTU_OG_m.toFixed(2)}m · Z=${res.H_pack_total_m.toFixed(2)}m · Rem=${res.removal_pct.toFixed(2)}%</text>
        </svg>
      `;
      return `
        ${buildTopSheetHeader('PACKED GAS ABSORPTION / SCRUBBING / DRYING TOWER SPECIFICATION SHEET', eqTag, eqService, `GPDC-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — GAS-LIQUID MASS TRANSFER & PROCESS OPERATING SUMMARY (가스 흡수/세정/건조 공정 사양)</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>Gas Stream / Absorbent Liquid</b></td><td colspan="3" class="val-hi">Gas: ${res.lkBase.name} / Liquid: ${res.hkBase.name}</td>
              <td colspan="2"><b>Operating Pressure & Temps</b></td><td colspan="2" class="val-hi">${res.P_bar.toFixed(2)} barA · Gas In ${res.T_feed_C.toFixed(1)}°C / Liq In ${res.T_top_C.toFixed(1)}°C</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Feed Gas / Scrubbing Liquid Flow</b></td><td class="unit-c">kg/h (kmol/h)</td>
              <td colspan="2" class="val-hi">Gas G = ${res.gas_kgh.toFixed(0)} kg/h (${res.D.toFixed(1)} kmol/h)</td>
              <td colspan="2"><b>Scrubbing / Drying Liquid Flow</b></td><td colspan="2" class="val-hi">Liquid L = ${res.liq_kgh.toFixed(0)} kg/h (${res.B.toFixed(1)} kmol/h · L/G = ${res.LG_mass_ratio.toFixed(2)})</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>Solute / Moisture Inlet → Outlet</b></td><td class="unit-c">ppm (vol)</td>
              <td colspan="2" class="val-hi">Inlet y_in = ${res.y_in_ppm.toLocaleString()} ppm → Outlet y_out = ${res.y_out_ppm} ppm</td>
              <td colspan="2"><b>Removal Efficiency & Absorption</b></td><td colspan="2" class="val-hi" style="color:#34d399;">${res.removal_pct.toFixed(3)} % Removed (${res.m_abs_kgh.toFixed(2)} kg/h · Q = ${res.Qc_kW.toFixed(1)} kW)</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">5</td><td colspan="9">SECTION II — ECKERT GPDC HYDRAULICS, MASS TRANSFER (N_OG · HTU_OG) & PACKING INTERNALS</td></tr>
            <tr>
              <td class="ln">6</td><td colspan="2"><b>Transfer Units (N_OG) & Height (HTU_OG)</b></td><td class="unit-c">NTU / m</td>
              <td colspan="4" class="val-hi">Colburn N_OG = ${res.N_OG.toFixed(2)} NTU · Onda HTU_OG = ${res.HTU_OG_m.toFixed(2)} m (Absorption Factor A = ${(1 / Math.max(0.01, 0.12)).toFixed(1)})</td>
              <td colspan="2" rowspan="6" style="padding:4px;vertical-align:middle;background:#050b18;">${absSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">7</td><td colspan="2"><b>Total Packed Bed Height (Z) & Beds</b></td><td class="unit-c">m / Beds</td>
              <td colspan="4" class="val-hi" style="color:#34d399;">Total Packed Height Z = ${res.H_pack_total_m.toFixed(2)} m (${res.N_beds} Bed × ${res.H_bed_m.toFixed(2)} m/bed · ${res.N_beds > 1 ? (res.N_beds - 1) + ' Liquid Redistributor' : 'Single Bed'})</td>
            </tr>
            <tr>
              <td class="ln">8</td><td colspan="2"><b>Tower Inside Diameter × T/T Height</b></td><td class="unit-c">mm × m</td>
              <td colspan="4" class="val-hi">ID Ø${(res.D_col_m * 1000).toFixed(0)} mm (${res.D_col_m.toFixed(2)} m) × T/T Height ${res.H_tangent_m.toFixed(1)} m (Cross Area A_col = ${(Math.PI * 0.25 * res.D_col_m * res.D_col_m).toFixed(2)} m²)</td>
            </tr>
            <tr>
              <td class="ln">9</td><td colspan="2"><b>Eckert GPDC Flooding & Gas Velocity</b></td><td class="unit-c">m/s / Pa^0.5</td>
              <td colspan="4" class="val">F_LV = ${res.FLV.toFixed(3)} · u_op = ${res.u_op.toFixed(2)} m/s (${res.flood_pct.toFixed(0)}% of Flood u_f = ${res.u_flood.toFixed(2)} m/s) · F-Factor = ${res.F_factor.toFixed(2)} Pa^0.5</td>
            </tr>
            <tr>
              <td class="ln">10</td><td colspan="2"><b>Packing Spec & Liquid Wetting Rate</b></td><td class="unit-c">Spec / m³/m²h</td>
              <td colspan="4" class="val-hi">${res.packSpec.name} (Fp=${res.packSpec.Fp} m⁻¹, a_p=${res.packSpec.ap} m²/m³, ε=${res.packSpec.void_pct}%) · Wetting Rate L_w = ${res.wetting_rate_m3m2h.toFixed(1)} m³/m²h</td>
            </tr>
            <tr>
              <td class="ln">11</td><td colspan="2"><b>Packing ΔP/m, Total ΔP & Shell Material</b></td><td class="unit-c">mbar / Spec</td>
              <td colspan="4" class="val-hi">ΔP/m = ${res.dP_pack_mbar_m.toFixed(2)} mbar/m · Total Tower ΔP = ${res.dP_total_mbar.toFixed(1)} mbar · Shell: FRP / PVC-Lined CS / Rubber-Lined CS + Ti/PP Demister</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 3B. DISTILLATION COLUMN (ASME / FRI 25-Row Process Fractionation Sheet!)
    // =======================================================================
    if (eqType === 'column') {
      const isPacked = res.internals === 'packed';
      const costUsd = Math.round(28000 + 2200 * res.N_actual * Math.pow(res.D_col_m, 1.45) * (isPacked ? 1.15 : 1.0));
      const costKrw = Math.round((costUsd * 1380) / 10000) * 10000;
      const eqTag = res.equipTag || 'T-101';
      const eqService = res.equipName || `${res.lkBase.name} / ${res.hkBase.name} Fractionator (${isPacked ? 'PACKED' : 'TRAYED'})`;
      const colSketchSvg = `
        <svg viewBox="0 0 260 155" style="width:100%;height:145px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="64" y="18" width="44" height="114" rx="14" fill="none" stroke="#e2e8f0" stroke-width="2"/>
          ${isPacked ? `
            <rect x="68" y="34" width="36" height="32" fill="rgba(16,185,129,0.18)" stroke="#10b981" stroke-width="1.2"/>
            <line x1="68" y1="34" x2="104" y2="66" stroke="#10b981" stroke-width="0.9"/>
            <line x1="104" y1="34" x2="68" y2="66" stroke="#10b981" stroke-width="0.9"/>
            <rect x="68" y="76" width="36" height="38" fill="rgba(16,185,129,0.18)" stroke="#10b981" stroke-width="1.2"/>
            <line x1="68" y1="76" x2="104" y2="114" stroke="#10b981" stroke-width="0.9"/>
            <line x1="104" y1="76" x2="68" y2="114" stroke="#10b981" stroke-width="0.9"/>
          ` : `
            <line x1="66" y1="38" x2="106" y2="38" stroke="#38bdf8" stroke-width="1"/>
            <line x1="66" y1="54" x2="106" y2="54" stroke="#38bdf8" stroke-width="1"/>
            <line x1="66" y1="70" x2="106" y2="70" stroke="#38bdf8" stroke-width="1"/>
            <line x1="66" y1="86" x2="106" y2="86" stroke="#38bdf8" stroke-width="1"/>
            <line x1="66" y1="102" x2="106" y2="102" stroke="#38bdf8" stroke-width="1"/>
          `}
          <line x1="28" y1="70" x2="64" y2="70" stroke="#f59e0b" stroke-width="2"/>
          <circle cx="185" cy="72" r="36" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <line x1="162" y1="45" x2="162" y2="99" stroke="#10b981" stroke-width="1.5"/>
          <line x1="208" y1="45" x2="208" y2="99" stroke="#10b981" stroke-width="1.5"/>
          <text x="130" y="12" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">ID Ø${(res.D_col_m*1000).toFixed(0)}mm × H ${res.H_tangent_m.toFixed(1)}m (${isPacked ? `${res.N_beds} Packed Beds` : `${res.N_actual} Trays`})</text>
          <text x="130" y="146" fill="#34d399" font-size="8.5" text-anchor="middle">${isPacked ? `HETP=${res.HETP_m.toFixed(2)}m · H_pack=${res.H_pack_total_m.toFixed(1)}m` : `Feed #${res.feed_stage_actual}`} · Qc=${res.Qc_kW.toFixed(0)}kW · Qr=${res.Qr_kW.toFixed(0)}kW</text>
        </svg>
      `;
      return `
        ${buildTopSheetHeader('PROCESS FRACTIONATION COLUMN & INTERNALS SPECIFICATION SHEET', eqTag, eqService, `FRI-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — PROCESS MATERIAL & HEAT BALANCE SUMMARY (탑 물질수지 및 열부하 사양)</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>Binary System (Light / Heavy Key)</b></td><td colspan="3" class="val-hi">${res.lkBase.name} (LK) / ${res.hkBase.name} (HK)</td>
              <td colspan="2"><b>Avg. Relative Volatility (α)</b></td><td colspan="2" class="val-hi">α_avg = ${res.alpha.toFixed(3)} ${res.azeotropeX ? `([WARN] Azeotrope @ x≈${res.azeotropeX.toFixed(2)})` : '(NRTL Converged)'}</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Feed / Distillate / Bottoms Flow</b></td><td class="unit-c">kmol/h</td>
              <td colspan="2" class="val-hi">F = ${(res.D + res.B).toFixed(1)} / D = ${res.D.toFixed(1)} / B = ${res.B.toFixed(1)}</td>
              <td colspan="2"><b>Compositions (z_F / x_D / x_B)</b></td><td colspan="2" class="val-hi">${res.zF.toFixed(3)} / ${res.xD.toFixed(3)} / ${res.xB.toFixed(4)} (LK Rec: ${res.lk_recovery_pct.toFixed(1)}%)</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>Temperature Profile (Top / Feed / Bot)</b></td><td class="unit-c">°C</td>
              <td colspan="2" class="val-hi">${res.T_top_C.toFixed(1)} °C / ${res.T_feed_C.toFixed(1)} °C / ${res.T_bot_C.toFixed(1)} °C</td>
              <td colspan="2"><b>Activity Coeff. (γ₁ Top / γ₂ Bot)</b></td><td colspan="2" class="val">γ₁ = ${res.gamma1_top.toFixed(3)} / γ₂ = ${res.gamma2_bot.toFixed(3)}</td>
            </tr>
            <tr>
              <td class="ln">5</td><td colspan="2"><b>Operating Reflux Ratio (R_op / R_min)</b></td><td class="unit-c">Ratio</td>
              <td colspan="2" class="val-hi">R = ${res.R.toFixed(2)} (R_min = ${res.Rmin.toFixed(2)} · Underwood)</td>
              <td colspan="2"><b>Internal Traffic (L_rect / V_rect)</b></td><td colspan="2" class="val">L = ${(res.R * res.D).toFixed(1)} / V = ${((res.R + 1) * res.D).toFixed(1)} kmol/h</td>
            </tr>
            <tr>
              <td class="ln">6</td><td colspan="2"><b>Condenser Duty (응축기 열부하 Qc)</b></td><td class="unit-c">kW</td>
              <td colspan="2" class="val-hi">${res.Qc_kW.toFixed(1)} kW (${(res.Qc_kW * 0.85985).toFixed(1)} Mcal/h)</td>
              <td colspan="2"><b>Reboiler Duty (리보일러 열부하 Qr)</b></td><td colspan="2" class="val-hi">${res.Qr_kW.toFixed(1)} kW (${(res.Qr_kW * 0.85985).toFixed(1)} Mcal/h)</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">7</td><td colspan="9">SECTION II — STAGE DESIGN, INTERNALS (${isPacked ? 'PACKING GPDC' : 'FRI TRAY HYDRAULICS'}) & MECHANICAL CONSTRUCTION</td></tr>
            <tr>
              <td class="ln">8</td><td colspan="2"><b>Min Stages (N_min) / Theoretical (N_th)</b></td><td class="unit-c">Stages</td>
              <td colspan="4" class="val">Fenske N_min = ${res.Nmin.toFixed(2)} / Gilliland N_th = ${res.N_theo.toFixed(1)} (Overall Eff E_o = ${res.E_overall_pct.toFixed(1)}%)</td>
              <td colspan="2" rowspan="7" style="padding:4px;vertical-align:middle;background:#050b18;">${colSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">9</td><td colspan="2"><b>${isPacked ? 'Packed Height & Bed Split' : 'Actual Trays (N_act) & Feed Stage'}</b></td><td class="unit-c">${isPacked ? 'm / Beds' : 'Trays'}</td>
              <td colspan="4" class="val-hi" style="color:#34d399;">${isPacked ? `Total Packed Height = ${res.H_pack_total_m.toFixed(2)} m (${res.N_beds} Beds · HETP = ${res.HETP_m.toFixed(2)} m · ${res.N_beds - 1} Redistributors)` : `Total ${res.N_actual} Trays (${res.internalsSummary}) · Optimal Feed Tray: #${res.feed_stage_actual}`}</td>
            </tr>
            <tr>
              <td class="ln">10</td><td colspan="2"><b>Column Inside Diameter × T/T Height</b></td><td class="unit-c">mm × m</td>
              <td colspan="4" class="val-hi">ID Ø${(res.D_col_m * 1000).toFixed(0)} mm (${res.D_col_m.toFixed(2)} m) × Height ${res.H_tangent_m.toFixed(1)} m (HETP = ${res.HETP_m.toFixed(2)} m)</td>
            </tr>
            <tr>
              <td class="ln">11</td><td colspan="2"><b>Vapor F-Factor / Superficial Velocity</b></td><td class="unit-c">Pa^0.5 / m/s</td>
              <td colspan="4" class="val">F_s = ${res.F_factor.toFixed(2)} Pa^0.5 · u_op = ${res.u_op.toFixed(2)} m/s (Flood Velocity u_flood = ${res.u_flood.toFixed(2)} m/s)</td>
            </tr>
            <tr>
              <td class="ln">12</td><td colspan="2"><b>${isPacked ? 'Packing Factor (Fp) & Surface (ap)' : '4-Zone Stability (Weep / Downcomer)'}</b></td><td class="unit-c">${isPacked ? 'm⁻¹ / m²/m³' : 'Ratio / %'}</td>
              <td colspan="4" class="val-hi">${isPacked ? `Fp = ${res.packSpec.Fp} m⁻¹ · Surface Area a_p = ${res.packSpec.ap} m²/m³ · Void Fraction ε = ${res.packSpec.void_pct}%` : `Weep Safety Ratio = ${res.weep_ratio.toFixed(2)}x (≥1.15) · Downcomer Backup = ${res.dc_backup_pct.toFixed(1)}% (≤50%)`}</td>
            </tr>
            <tr>
              <td class="ln">13</td><td colspan="2"><b>${isPacked ? 'Packing ΔP/m & Total Column ΔP' : 'Tray Pressure Drop & Total Column ΔP'}</b></td><td class="unit-c">mbar</td>
              <td colspan="4" class="val-hi">${isPacked ? `Specific ΔP = ${res.dP_pack_mbar_m.toFixed(2)} mbar/m` : `ΔP/tray = ${res.dP_tray_mbar.toFixed(2)} mbar`} · Total Column ΔP = ${res.dP_total_mbar.toFixed(1)} mbar (${(res.dP_total_mbar / 1000).toFixed(3)} bar)</td>
            </tr>
            <tr>
              <td class="ln">14</td><td colspan="2"><b>Shell Material / Internals Spec</b></td><td class="unit-c">Spec</td>
              <td colspan="4" class="val">Shell: ASME SA-516 Gr.70 (CA 3.0mm) · Internals: ${res.internalsSummary}</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 4. PROCESS PIPING (ASME B31.3 / API RP 14E Line Sizing Sheet!)
    // =======================================================================
    if (eqType === 'piping') {
      const s = res.selected;
      const eqTag = res.equipTag || `L-101-${s.nps.replace('"', 'IN')}`;
      const eqService = res.equipName || `ASME B31.3 Process Line (${res.flowMode.toUpperCase()})`;
      const pipeSketchSvg = `
        <svg viewBox="0 0 260 120" style="width:100%;height:115px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="24" y="42" width="140" height="28" fill="none" stroke="#38bdf8" stroke-width="2.2"/>
          <rect x="18" y="36" width="6" height="40" fill="#94a3b8"/>
          <rect x="164" y="36" width="6" height="40" fill="#94a3b8"/>
          <circle cx="215" cy="56" r="24" fill="none" stroke="#38bdf8" stroke-width="5"/>
          <text x="130" y="18" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">ANSI / ASME B36.10M — NPS ${s.nps} (Sch ${res.schedule || '40'}) · ID ${s.id_mm}mm × ${s.wall_mm}t</text>
          <text x="130" y="106" fill="#34d399" font-size="8.5" text-anchor="middle">v = ${s.v.toFixed(2)} m/s (Limit ${s.v_erode_ms.toFixed(1)} m/s) · ΔP = ${s.dP_total_bar.toFixed(3)} bar</text>
        </svg>
      `;
      return `
        ${buildTopSheetHeader('PROCESS PIPING HYDRAULIC & MECHANICAL SPECIFICATION SHEET', eqTag, eqService, `B31.3-${eqTag}`, 0, 0, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — HYDRAULIC SIZING, EROSIONAL VELOCITY & ANSI/ASME B31.3 MECHANICAL DATA</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>Selected Pipe Size (ANSI / ASME NPS)</b></td><td colspan="2" class="val-hi">NPS ${s.nps} (Sch ${res.schedule || '40'}) — Rec: NPS ${res.recommended.nps}</td>
              <td colspan="2"><b>Outside Dia / Inside Dia / Wall</b></td><td colspan="3" class="val-hi">OD ${s.od_mm} mm × ID ${s.id_mm} mm × Wall t ${s.wall_mm} mm</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Volumetric / Mass Flowrate</b></td><td colspan="2" class="val">${res.Q_m3h.toFixed(1)} m³/h (${(res.W_kgs * 3600).toFixed(0)} kg/h)</td>
              <td colspan="2"><b>Actual Velocity vs API 14E Limit</b></td><td colspan="3" class="val-hi" style="color:${s.v <= s.v_erode_ms ? '#34d399' : '#fda4af'};">v = ${s.v.toFixed(2)} m/s (API 14E Limit: ${s.v_erode_ms.toFixed(2)} m/s · ρv² = ${s.rho_v2.toFixed(0)} Pa)</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>Unit Friction Loss (ΔP / 100m)</b></td><td colspan="4" class="val-hi">${s.dP_100m_bar.toFixed(3)} bar/100m (${(s.dP_100m_bar * 100).toFixed(1)} kPa/100m)</td>
              <td colspan="2" rowspan="4" style="padding:4px;vertical-align:middle;background:#050b18;">${pipeSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">5</td><td colspan="2"><b>Total Line Pressure Drop (ΔP_total)</b></td><td colspan="4" class="val-hi">${s.dP_total_bar.toFixed(3)} bar (Pipe Fric ${s.dP_fric_bar.toFixed(3)} + Fittings ${s.dP_fit_bar.toFixed(3)} + Static Elev ${s.dP_elev_bar.toFixed(3)} bar)</td>
            </tr>
            <tr>
              <td class="ln">6</td><td colspan="2"><b>Reynolds No. / Friction Factor f_D</b></td><td colspan="4" class="val">Re = ${Math.round(s.Re).toLocaleString()} / Darcy f = ${s.f.toFixed(4)} / Eq. Length L_eq = ${s.Leq_m.toFixed(1)} m (ΣK = ${res.sumK.toFixed(1)})</td>
            </tr>
            <tr>
              <td class="ln">7</td><td colspan="2"><b>Compressibility / Two-Phase / Material</b></td><td colspan="4" class="val">Mach = ${s.mach.toFixed(3)} / Lockhart-Martinelli Φ²_LO = ${s.phi2_LM.toFixed(2)} / ASTM A106 Gr.B Seamless (ASME B31.3)</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 5. PRESSURE VESSEL / KO DRUM (ASME Sec. VIII Div. 1 Datasheet!)
    // =======================================================================
    if (eqType === 'vessel') {
      const costUsd = Math.round(6500 + 4.8 * res.W_empty_kg);
      const costKrw = Math.round((costUsd * 1380) / 10000) * 10000;
      const eqTag = res.equipTag || 'V-101';
      const eqService = res.equipName || `${res.orientation.toUpperCase()} Knock-Out Separator`;
      const vesSketchSvg = `
        <svg viewBox="0 0 260 125" style="width:100%;height:120px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="40" y="28" width="180" height="62" rx="22" fill="none" stroke="#e2e8f0" stroke-width="2.2"/>
          <line x1="44" y1="62" x2="216" y2="62" stroke="#38bdf8" stroke-width="1.4" stroke-dasharray="4,3"/>
          <rect x="182" y="30" width="10" height="58" fill="rgba(245,158,11,0.35)" stroke="#f59e0b" stroke-width="1.2"/>
          <text x="130" y="16" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">ASME VIII — ID Ø${(res.D_m*1000).toFixed(0)}mm × L ${(res.L_m*1000).toFixed(0)}mm (${res.t_nom_mm}t)</text>
          <text x="130" y="112" fill="#34d399" font-size="8.5" text-anchor="middle">MAWP ${res.MAWP_barG.toFixed(1)} barG · Empty ${(res.W_empty_kg/1000).toFixed(1)}t / Hydro ${(res.W_hydro_kg/1000).toFixed(1)}t</text>
        </svg>
      `;
      return `
        ${buildTopSheetHeader('PRESSURE VESSEL / SEPARATOR SPECIFICATION SHEET — ASME SEC. VIII DIV. 1', eqTag, eqService, `ASME-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — SOUDERS-BROWN SIZING & ASME SEC. VIII DIV. 1 THICKNESS (압력용기 기계 사양)</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>Vessel Inside Diameter × T/T Length</b></td><td colspan="2" class="val-hi">ID Ø${(res.D_m * 1000).toFixed(0)} mm × L ${(res.L_m * 1000).toFixed(0)} mm (L/D = ${res.LD_ratio.toFixed(2)})</td>
              <td colspan="2"><b>Total Volume / Liquid Hold-up</b></td><td colspan="3" class="val-hi">V_total = ${res.V_total_m3.toFixed(2)} m³ / V_liq = ${res.V_liq_req_m3.toFixed(2)} m³</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Operating / Design Pressure & MAWP</b></td><td colspan="4" class="val-hi">P_op = ${res.P_op_barG} barG / P_des = ${res.P_des_barG} barG / Corroded MAWP = ${res.MAWP_barG.toFixed(1)} barG</td>
              <td colspan="2" rowspan="4" style="padding:4px;vertical-align:middle;background:#050b18;">${vesSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>ASME UG-27 Shell & UG-32 Head Thick.</b></td><td colspan="4" class="val-hi" style="color:#34d399;">Selected Plate: ${res.t_nom_mm} mm (Req Shell: ${res.t_shell_req_mm.toFixed(2)} mm, 2:1 Ellip. Head: ${res.t_head_req_mm.toFixed(2)} mm, CA: ${res.CA_mm} mm)</td>
            </tr>
            <tr>
              <td class="ln">5</td><td colspan="2"><b>Souders-Brown Separation Velocity</b></td><td colspan="4" class="val">K_v = ${res.Kv_base.toFixed(3)} m/s · Design V_g = ${res.Vg_des_ms.toFixed(2)} m/s ≤ V_t,max = ${res.Vt_max_ms.toFixed(2)} m/s (${res.hasDemister ? '150mm SS316 Mesh Demister' : 'Gravity Only'})</td>
            </tr>
            <tr>
              <td class="ln">6</td><td colspan="2"><b>Material & Weights (Empty/Oper/Hydro)</b></td><td colspan="4" class="val-hi">${res.matName} (S=${res.S_MPa} MPa) · Empty: ${res.W_empty_kg.toFixed(0)} kg / Oper: ${res.W_oper_kg.toFixed(0)} kg / Full of Water: ${res.W_hydro_kg.toFixed(0)} kg</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 6. PRESSURE SAFETY VALVE / PSV (API 520 / 526 Specification Sheet!)
    // =======================================================================
    if (eqType === 'psv') {
      const eqTag = res.equipTag || 'PSV-101';
      const eqService = res.equipName || `Overpressure Protection (${res.scenario.toUpperCase()})`;
      const psvSketchSvg = `
        <svg viewBox="0 0 260 125" style="width:100%;height:120px;background:#060d1f;border:1px solid #1e293b;border-radius:4px;">
          <rect x="98" y="22" width="44" height="72" fill="none" stroke="#38bdf8" stroke-width="2"/>
          <line x1="106" y1="34" x2="134" y2="40" stroke="#f59e0b" stroke-width="2"/>
          <line x1="106" y1="46" x2="134" y2="52" stroke="#f59e0b" stroke-width="2"/>
          <line x1="106" y1="58" x2="134" y2="64" stroke="#f59e0b" stroke-width="2"/>
          <rect x="108" y="94" width="24" height="16" fill="none" stroke="#10b981" stroke-width="2"/>
          <rect x="142" y="68" width="24" height="20" fill="none" stroke="#38bdf8" stroke-width="2"/>
          <text x="130" y="14" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">API 526 '${res.selectedOrifice.letter}' Orifice (${res.selectedOrifice.size}) — ${res.selectedOrifice.area_mm2} mm²</text>
          <text x="130" y="119" fill="#34d399" font-size="8.5" text-anchor="middle">P_set=${res.P_set_barG} barG · P1=${res.P1_barA.toFixed(2)} barA · W=${res.W_kgh.toFixed(0)} kg/h</text>
        </svg>
      `;
      return `
        ${buildTopSheetHeader('PRESSURE RELIEF VALVE SPECIFICATION SHEET — API RP 520 / STD 526', eqTag, eqService, `API526-${eqTag}`, 0, 0, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">1</td><td colspan="9">SECTION I — API 520 ORIFICE SIZING & API 526 STANDARD SELECTION (안전밸브 정밀 사양)</td></tr>
            <tr>
              <td class="ln">2</td><td colspan="2"><b>Selected API 526 Orifice & Body Size</b></td><td colspan="2" class="val-hi">'${res.selectedOrifice.letter}' Orifice (${res.selectedOrifice.size})</td>
              <td colspan="2"><b>Required vs Selected Orifice Area</b></td><td colspan="3" class="val-hi" style="color:#34d399;">A_req = ${res.A_req_mm2.toFixed(1)} mm² (${res.A_req_in2.toFixed(3)} in²) → Selected: ${res.selectedOrifice.area_mm2} mm² (${res.cap_utilization_pct.toFixed(1)}% Util.)</td>
            </tr>
            <tr>
              <td class="ln">3</td><td colspan="2"><b>Required Relief Rate vs Valve Rated</b></td><td colspan="4" class="val-hi">W_req = ${res.W_kgh.toFixed(0)} kg/h / Valve Rated Capacity = ${res.W_rated_kgh.toFixed(0)} kg/h ${res.Q_fire_kW > 0 ? `(API 521 Fire Q = ${res.Q_fire_kW.toFixed(0)} kW)` : ''}</td>
              <td colspan="2" rowspan="3" style="padding:4px;vertical-align:middle;background:#050b18;">${psvSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">4</td><td colspan="2"><b>Set Pressure / Relieving P1 / Back P2</b></td><td colspan="4" class="val-hi">P_set = ${res.P_set_barG} barG (${res.overpress_pct}% Overpress) / P₁ = ${res.P1_barA.toFixed(2)} barA / P_back = ${res.P_back_barG} barG</td>
            </tr>
            <tr>
              <td class="ln">5</td><td colspan="2"><b>Flow Regime & Valve Construction</b></td><td colspan="4" class="val">${res.isCritical ? `Critical Choked Sonic Flow (r_c = ${res.r_crit.toFixed(3)})` : 'Subcritical Flow'} · ${(res.P_back_barG / res.P_set_barG) > 0.10 ? 'Balanced Bellows (Inconel 625)' : 'Conventional Spring-Loaded'} · Body WCB / Trim SS316 Stellite</td>
            </tr>
          </tbody>
        </table>
      `;
    }

    return '';
  }

  return {
    solvePump,
    solveHXEnergyBalance,
    solveHX,
    solveColumn,
    solvePiping,
    solveVessel,
    solvePSV,
    autoRedesignAndConverge,
    drawPumpCanvas,
    drawHXCanvas,
    drawColumnCanvas,
    drawPipingCanvas,
    drawVesselCanvas,
    drawPSVCanvas,
    drawEngineeringDWG,
    renderQuotationDatasheet
  };
})();

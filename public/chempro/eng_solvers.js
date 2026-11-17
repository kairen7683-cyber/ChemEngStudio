/**
 * ChemEng Studio Pro v2.0 — Unified Solver Adapter, Auto-Redesign, Canvas Visualizers & CAD DWG
 * NOTE: Core engineering calculation kernels (Pump, HX, Column, Piping, Vessel, PSV)
 * now delegate directly to window.__ChemEngUnifiedKernel (bundled from lib/calculations/).
 * Canvas diagram renderers, autoRedesignAndConverge, drawEngineeringDWG, and
 * renderQuotationDatasheet remain intact below.
 */

window.ChemEngSolvers = (function () {
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  function getUnifiedKernel() {
    return (typeof window !== "undefined" && window.__ChemEngUnifiedKernel) ||
      (typeof globalThis !== "undefined" && globalThis.__ChemEngUnifiedKernel) ||
      null;
  }
  function requireKernel(name) {
    const k = getUnifiedKernel();
    if (!k || typeof k[name] !== "function") {
      throw new Error("ChemEng Unified Kernel missing solver: " + name);
    }
    return k[name];
  }
  function solvePump(inp, mode) { return requireKernel("solvePump")(inp, mode); }
  function solveHXEnergyBalance(inp) { return requireKernel("solveHXEnergyBalance")(inp); }
  function solveHX(inp, mode) { return requireKernel("solveHX")(inp, mode); }
  function solveColumn(inp, mode) { return requireKernel("solveColumn")(inp, mode); }
  function solvePiping(inp, mode) { return requireKernel("solvePiping")(inp, mode); }
  function solveVessel(inp, mode) { return requireKernel("solveVessel")(inp, mode); }
  function solvePSV(inp, mode) { return requireKernel("solvePSV")(inp, mode); }

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
    const pad = { l: 46, r: 24, t: 26, b: 32 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    const hNodes = (res.hotNodes && res.hotNodes.length >= 2)
      ? res.hotNodes
      : [{ f: 0, T: res.Th_in }, { f: 1, T: res.Th_out }];
    const cNodes = (res.coldNodes && res.coldNodes.length >= 2)
      ? res.coldNodes
      : [{ f: 0, T: res.Tc_out }, { f: 1, T: res.Tc_in }];

    const allT = [...hNodes.map(n => n.T), ...cNodes.map(n => n.T)];
    const tMin = Math.min(...allT) - 10;
    const tMax = Math.max(...allT) + 12;
    const toX = f => pad.l + f * pw;
    const toY = t => pad.t + ph - ((t - tMin) / Math.max(8, tMax - tMin)) * ph;

    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ph * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
      const tVal = tMax - ((tMax - tMin) * i) / 4;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText(`${tVal.toFixed(0)}°`, 6, y + 3);
    }

    // Zone vertical boundary dashed lines if multi-zone phase change is active
    if (res.zones && res.zones.length > 1) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(99,102,241,0.32)';
      res.zones.forEach((z, idx) => {
        if (idx > 0) {
          const x = toX(z.fa);
          ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
        }
        const xm = toX(0.5 * (z.fa + z.fb));
        if ((z.fb - z.fa) * pw > 54) {
          ctx.fillStyle = '#4338ca';
          ctx.font = 'bold 9.5px sans-serif';
          ctx.fillText(`Z${z.idx} (${z.qSharePct.toFixed(0)}%)`, xm - 22, pad.t + ph + 14);
        }
      });
      ctx.restore();
    }

    // Shaded driving-force polygon between piecewise hot & cold curves
    ctx.fillStyle = 'rgba(56,189,248,0.11)';
    ctx.beginPath();
    hNodes.forEach((n, i) => {
      if (i === 0) ctx.moveTo(toX(n.f), toY(n.T));
      else ctx.lineTo(toX(n.f), toY(n.T));
    });
    for (let i = cNodes.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(cNodes[i].f), toY(cNodes[i].T));
    }
    ctx.closePath();
    ctx.fill();

    // Hot stream piecewise curve (Desuperheat -> Condense Plateau -> Subcool)
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 3;
    ctx.beginPath();
    hNodes.forEach((n, i) => {
      if (i === 0) ctx.moveTo(toX(n.f), toY(n.T));
      else ctx.lineTo(toX(n.f), toY(n.T));
    });
    ctx.stroke();

    // Knee dots on hot stream
    hNodes.forEach((n, i) => {
      if (i > 0 && i < hNodes.length - 1) {
        ctx.fillStyle = '#e11d48';
        ctx.beginPath(); ctx.arc(toX(n.f), toY(n.T), 4, 0, Math.PI * 2); ctx.fill();
        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillText(`Tsat ${n.T.toFixed(1)}°C`, toX(n.f) - 24, toY(n.T) - 8);
      }
    });

    // Cold stream piecewise curve (Preheat -> Boiling Plateau -> Superheat)
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    cNodes.forEach((n, i) => {
      if (i === 0) ctx.moveTo(toX(n.f), toY(n.T));
      else ctx.lineTo(toX(n.f), toY(n.T));
    });
    ctx.stroke();

    // Knee dots on cold stream
    cNodes.forEach((n, i) => {
      if (i > 0 && i < cNodes.length - 1) {
        ctx.fillStyle = '#0284c7';
        ctx.beginPath(); ctx.arc(toX(n.f), toY(n.T), 4, 0, Math.PI * 2); ctx.fill();
        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillText(`Tsat ${n.T.toFixed(1)}°C`, toX(n.f) - 24, toY(n.T) + 14);
      }
    });

    ctx.fillStyle = '#e11d48';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`고온 In ${res.Th_in.toFixed(1)}°C`, toX(0) + 4, toY(res.Th_in) - 6);
    ctx.fillText(`고온 Out ${res.Th_out.toFixed(1)}°C`, toX(1) - 92, toY(res.Th_out) - 6);

    ctx.fillStyle = '#0369a1';
    ctx.fillText(`저온 Out ${res.Tc_out.toFixed(1)}°C`, toX(0) + 4, toY(res.Tc_out) + 15);
    ctx.fillText(`저온 In ${res.Tc_in.toFixed(1)}°C`, toX(1) - 88, toY(res.Tc_in) + 15);

    if (res.minPinchDT !== undefined && Number.isFinite(res.minPinchDT)) {
      ctx.fillStyle = res.minPinchDT < 3.0 ? '#dc2626' : '#0f766e';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`Pinch ΔT_min = ${res.minPinchDT.toFixed(1)}°C`, pad.l + pw - 142, pad.t + 12);
    }
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

    // Operating lines (with intermediate segment when Side-Cut S > 0)
    const { zF, xD, xB, R } = res;
    const slopeR = R / (R + 1.0);
    const intR = xD / (R + 1.0);
    const x_int = zF;
    const y_int = slopeR * x_int + intR;

    const hasSideCut = (res.S || 0) > 0;
    let x_hi = x_int, y_hi = y_int;
    let x_lo = x_int, y_lo = y_int;
    let scMarkX = x_int, scMarkY = y_int;

    if (hasSideCut) {
      const xS = clamp(res.xS_mol ?? zF, Math.min(xB + 0.01, xD - 0.02), xD - 0.01);
      const isAboveFeed =
        (res.sideCutStage && res.feed_stage_actual && res.sideCutStage < res.feed_stage_actual) ||
        xS >= x_int;

      if (isAboveFeed) {
        const x_sc = clamp(xS, x_int + 0.01, xD - 0.01);
        const y_sc = clamp(slopeR * x_sc + intR, x_sc, 0.999);
        const L_mid = res.sideCutPhase === 'vapor'
          ? R * res.D
          : Math.max(0.05 * res.D, R * res.D - res.S);
        const V_mid = res.sideCutPhase === 'vapor'
          ? (R + 1.0) * res.D + res.S
          : (R + 1.0) * res.D;
        const slopeMid = clamp(L_mid / Math.max(1e-4, V_mid), 0.05, slopeR);
        const y_int_eff = clamp(y_sc - slopeMid * (x_sc - x_int), xB + 0.01, y_sc - 0.004);
        x_hi = x_sc; y_hi = y_sc;
        x_lo = x_int; y_lo = y_int_eff;
        scMarkX = x_sc; scMarkY = y_sc;
      } else {
        const x_sc = clamp(xS, xB + 0.01, x_int - 0.01);
        const y_int_eff = clamp(y_int, x_int + 0.005, 0.999);
        const L_mid = R * res.D + (res.q ?? 1.0) * res.F;
        const V_mid = Math.max(0.1 * res.F, (R + 1.0) * res.D - (1.0 - (res.q ?? 1.0)) * res.F);
        const slopeMid = clamp(L_mid / Math.max(1e-4, V_mid), 1.0, 5.0);
        const y_sc = clamp(y_int_eff - slopeMid * (x_int - x_sc), x_sc + 0.004, y_int_eff - 0.004);
        x_hi = x_int; y_hi = y_int_eff;
        x_lo = x_sc; y_lo = y_sc;
        scMarkX = x_sc; scMarkY = y_sc;
      }

      // Upper Rectifying + Lower Stripping in amber
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toX(xD), toY(xD));
      ctx.lineTo(toX(x_hi), toY(y_hi));
      ctx.moveTo(toX(x_lo), toY(y_lo));
      ctx.lineTo(toX(xB), toY(xB));
      ctx.stroke();

      // Intermediate Operating Line Segment in violet
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(toX(x_hi), toY(y_hi));
      ctx.lineTo(toX(x_lo), toY(y_lo));
      ctx.stroke();

      // Violet Side-Cut 'S' Marker
      ctx.fillStyle = '#7c3aed';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(scMarkX), toY(scMarkY), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c4b5fd';
      ctx.font = 'bold 10px sans-serif';
      const lblX = Math.min(toX(0.95) - 54, toX(scMarkX) + 7);
      const lblY = Math.max(oy + 12, toY(scMarkY) + 12);
      ctx.fillText(`S (xS=${scMarkX.toFixed(2)})`, lblX, lblY);
    } else {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toX(xD), toY(xD));
      ctx.lineTo(toX(x_int), toY(y_int));
      ctx.lineTo(toX(xB), toY(xB));
      ctx.stroke();
    }

    const opLineY = (nx) => {
      if (!hasSideCut) {
        return nx >= x_int
          ? (slopeR * nx + intR)
          : (xB + ((y_int - xB) / Math.max(1e-4, x_int - xB)) * (nx - xB));
      }
      if (nx >= x_hi) {
        return y_hi + ((xD - y_hi) / Math.max(1e-4, xD - x_hi)) * (nx - x_hi);
      }
      if (nx >= x_lo) {
        return y_lo + ((y_hi - y_lo) / Math.max(1e-4, x_hi - x_lo)) * (nx - x_lo);
      }
      return xB + ((y_lo - xB) / Math.max(1e-4, x_lo - xB)) * (nx - xB);
    };

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
      const ny = opLineY(nx);
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
      const isAbs = res.colMode === 'absorption';
      const isPacked = isAbs || res.internals === 'packed';
      const vs = res.vesselSpec || {};
      const idMm = vs.idMm || Math.round((res.D_col_m || 1.0) * 1000);
      const btlMm = vs.btlElMm || (isAbs ? 2800 : 3200);
      const ttlMm = vs.ttlElMm || (btlMm + Math.round((res.H_tangent_m || 12.0) * 1000));
      const oalMm = vs.oalElMm || (ttlMm + Math.round(0.25 * idMm) + 450);
      const hllMm = vs.hllElMm || (btlMm + 1100);
      const nllMm = vs.nllElMm || (btlMm + 750);
      const lllMm = vs.lllElMm || (btlMm + 350);

      const tx = 138, tw = 74, gradeY = h - 38, topCrownY = 38;
      const spanPx = gradeY - topCrownY;
      const yAtEl = (elMm) => gradeY - (Math.max(0, Math.min(oalMm, elMm)) / Math.max(1000, oalMm)) * spanPx;
      const btlY = yAtEl(btlMm);
      const ttlY = yAtEl(ttlMm);
      const hllY = yAtEl(hllMm);
      const nllY = yAtEl(nllMm);
      const lllY = yAtEl(lllMm);
      const colCx = tx + tw / 2;
      const headRx = tw / 2;
      const headRy = Math.max(11, Math.round(tw * 0.24));

      // Centerline
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
      ctx.setLineDash([7, 3, 2, 3]);
      ctx.beginPath(); ctx.moveTo(colCx, topCrownY - 10); ctx.lineTo(colCx, gradeY + 8); ctx.stroke();
      ctx.setLineDash([]);

      // Grade Line & Skirt (EL 0 -> B.T.L.)
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(tx - 12, gradeY); ctx.lineTo(tx + tw + 12, gradeY); ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(tx + 2, btlY); ctx.lineTo(tx - 3, gradeY);
      ctx.moveTo(tx + tw - 2, btlY); ctx.lineTo(tx + tw + 3, gradeY);
      ctx.stroke();

      // Vessel Shell + 2:1 Semi-Ellipsoidal Heads
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tx, ttlY);
      ctx.quadraticCurveTo(colCx, ttlY - headRy * 1.45, tx + tw, ttlY);
      ctx.lineTo(tx + tw, btlY);
      ctx.quadraticCurveTo(colCx, btlY + headRy * 1.45, tx, btlY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
      ctx.fill();
      ctx.stroke();

      // Sump LLL/NLL/HLL Levels
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.fillRect(tx + 2, hllY, tw - 4, Math.max(3, btlY - hllY));
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(tx + 2, hllY); ctx.lineTo(tx + tw - 2, hllY); ctx.stroke();
      ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(tx + 2, nllY); ctx.lineTo(tx + tw - 2, nllY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx + 2, lllY); ctx.lineTo(tx + tw - 2, lllY); ctx.stroke();
      ctx.setLineDash([]);

      // Left EL Datum Ticks
      ctx.font = '8.5px "JetBrains Mono", monospace';
      [
        ['O.A.L.', oalMm, '#e2e8f0'],
        ['T.T.L.', ttlMm, '#7dd3fc'],
        ['HLL', hllMm, '#38bdf8'],
        ['B.T.L.', btlMm, '#7dd3fc'],
        ['BASE', 0, '#94a3b8']
      ].forEach(([lbl, em, clr]) => {
        const yy = yAtEl(em);
        ctx.strokeStyle = 'rgba(148,163,184,0.38)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(54, yy); ctx.lineTo(tx - 4, yy); ctx.stroke();
        ctx.fillStyle = clr;
        ctx.fillText(`${lbl} +${em}`, 8, yy + 3);
      });

      if (isPacked) {
        const pk = res.packingDetail;
        const beds = pk?.beds?.length ? pk.beds : [
          { bedNo: 1, botElMm: btlMm + Math.round((ttlMm - btlMm) * 0.24), topElMm: ttlMm - 950, heightMm: Math.round((res.H_pack_total_m || 4) * 1000) }
        ];
        beds.forEach((b) => {
          const byTop = yAtEl(b.topElMm);
          const byBot = yAtEl(b.botElMm);
          const bh = Math.max(12, byBot - byTop);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
          ctx.fillRect(tx + 5, byTop, tw - 10, bh);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1.3;
          ctx.strokeRect(tx + 5, byTop, tw - 10, bh);
          ctx.beginPath();
          ctx.moveTo(tx + 5, byTop); ctx.lineTo(tx + tw - 5, byBot);
          ctx.moveTo(tx + tw - 5, byTop); ctx.lineTo(tx + 5, byBot);
          ctx.stroke();
          // Support Plate (bot) & Hold-Down Grid (top)
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(tx + 3, byBot); ctx.lineTo(tx + tw - 3, byBot); ctx.stroke();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(tx + 3, byTop); ctx.lineTo(tx + tw - 3, byTop); ctx.stroke();
        });
        // Demister ME-1 & Top Liquid Distributor LD-1
        const demEl = pk?.demister?.elevationMm || (ttlMm - 240);
        const ldEl = pk?.topDistributor?.elevationMm || (beds[0].topElMm + 280);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(tx + 5, yAtEl(demEl) - 3, tw - 10, 6);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(tx + 6, yAtEl(ldEl) - 2, tw - 12, 4);
        if (pk?.redistributors?.items?.length) {
          pk.redistributors.items.forEach((rd) => {
            ctx.fillStyle = '#a855f7';
            ctx.fillRect(tx + 5, yAtEl(rd.elevationMm) - 2, tw - 10, 4);
          });
        }
      } else {
        // Tray Decks + Alternating Downcomers & Outlet Weirs
        const trBotEl = hllMm + 900;
        const trTopEl = ttlMm - 950;
        const nShow = Math.min(18, Math.max(4, res.N_actual || 10));
        for (let i = 0; i < nShow; i++) {
          const frac = nShow === 1 ? 0.5 : i / (nShow - 1);
          const yy = yAtEl(trTopEl - frac * (trTopEl - trBotEl));
          const dcL = i % 2 === 0;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(dcL ? tx + 11 : tx + 3, yy);
          ctx.lineTo(dcL ? tx + tw - 3 : tx + tw - 11, yy);
          ctx.stroke();
          if (i < nShow - 1) {
            ctx.strokeStyle = '#94a3b8';
            ctx.beginPath();
            ctx.moveTo(dcL ? tx + 11 : tx + tw - 11, yy);
            ctx.lineTo(dcL ? tx + 11 : tx + tw - 11, yy + Math.max(3, (yAtEl(trBotEl) - yAtEl(trTopEl)) / nShow - 2));
            ctx.stroke();
          }
        }
      }

      // Exact Nozzles N1..N6 from nozzleSchedule
      const nzList = res.nozzleSchedule || [];
      nzList.forEach((nz) => {
        const ny = yAtEl(nz.elevationMm);
        if (nz.tag === 'N1') {
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(colCx, ttlY - headRy); ctx.lineTo(colCx, ny - 4); ctx.stroke();
          ctx.fillStyle = '#7dd3fc';
          ctx.font = 'bold 8.5px monospace';
          ctx.fillText(`${nz.tag} ${nz.selectedDn.split(' ')[0]} (+${nz.elevationMm})`, colCx + 10, ny);
        } else if (nz.tag === 'N4') {
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(colCx, btlY + headRy); ctx.lineTo(colCx, gradeY + 6); ctx.stroke();
          ctx.fillStyle = '#cbd5e1';
          ctx.font = 'bold 8.5px monospace';
          ctx.fillText(`${nz.tag} ${nz.selectedDn.split(' ')[0]}`, colCx + 10, gradeY + 12);
        } else if (nz.orientationDeg === 270) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(tx - 24, ny); ctx.lineTo(tx, ny); ctx.stroke();
          ctx.fillStyle = '#fcd34d';
          ctx.font = 'bold 8.5px monospace';
          ctx.fillText(`${nz.tag} ${nz.selectedDn.split(' ')[0]} (+${nz.elevationMm})`, tx - 112, ny - 4);
        } else {
          const isSideNz = nz.tag === 'N7';
          ctx.strokeStyle = isSideNz ? '#a855f7' : '#38bdf8';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(tx + tw, ny); ctx.lineTo(tx + tw + 22, ny); ctx.stroke();
          ctx.fillStyle = isSideNz ? '#c4b5fd' : '#7dd3fc';
          ctx.font = 'bold 8.5px monospace';
          ctx.fillText(`${nz.tag} ${nz.selectedDn.split(' ')[0]} (+${nz.elevationMm})`, tx + tw + 26, ny + 3);
        }
      });

      drawDimLine(ctx, tx + tw + 130, ttlY, tx + tw + 130, btlY, `T/T ${(ttlMm - btlMm)}mm`, '#38bdf8');
      drawDimLine(ctx, tx, topCrownY - 12, tx + tw, topCrownY - 12, `ID Ø${idMm}mm (${vs.wallThicknessMm || 12}t)`, '#f43f5e');

      // Right Side Section A-A Plan View + Engineering Spec Block
      const cx = w - 165, cy = 122, cr = 58;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();

      if (isPacked) {
        const pk = res.packingDetail;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.2;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (Math.hypot(r * 16, c * 16) <= cr - 12) {
              ctx.beginPath(); ctx.arc(cx + c * 16, cy + r * 16, 5.5, 0, Math.PI * 2); ctx.stroke();
            }
          }
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(`SECTION A-A: DISTRIBUTOR & PACKING`, cx - 96, cy - cr - 12);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 9.2px monospace';
        ctx.fillText(`${pk?.nominalSize || res.packSpec?.name || 'Packed Bed'}`, cx - 104, cy + cr + 16);
        ctx.fillText(`Beds: ${res.N_beds}EA (${Math.round((res.H_pack_total_m || 4) * 1000)}mm) | HETP: ${Math.round((res.HETP_m || 0.5) * 1000)}mm`, cx - 104, cy + cr + 30);
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(`LD-1: ${pk?.topDistributor?.dripPointsPerM2 || 80} pts/m² | RD: ${pk?.redistributors?.count || 0}EA | SP/HD: ${res.N_beds}EA`, cx - 104, cy + cr + 44);
        ctx.fillText(`Range: ${pk?.opMinPct || 40}~${pk?.opMaxPct || 110}% | Flood=${res.flood_pct.toFixed(0)}% | ΔP=${res.dP_total_mbar.toFixed(1)}mbar`, cx - 104, cy + cr + 58);
      } else {
        const td = res.trayDetail;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(cx - cr * 0.72, cy - cr * 0.68); ctx.lineTo(cx - cr * 0.72, cy + cr * 0.68); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + cr * 0.72, cy - cr * 0.68); ctx.lineTo(cx + cr * 0.72, cy + cr * 0.68); ctx.stroke();
        if ((td?.passes || res.trayPasses) >= 2) {
          ctx.beginPath(); ctx.moveTo(cx - 5, cy - cr * 0.96); ctx.lineTo(cx - 5, cy + cr * 0.96); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + 5, cy - cr * 0.96); ctx.lineTo(cx + 5, cy + cr * 0.96); ctx.stroke();
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(`SECTION A-A: ${td?.passes || res.trayPasses}-PASS TRAY PLAN`, cx - 86, cy - cr - 12);
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 9.2px monospace';
        ctx.fillText(`Spacing: ${td?.spacingMm || Math.round((res.traySpacing_m || 0.5) * 1000)}mm | Øh=${td?.holeD_mm || res.holeD_mm}mm | Open=${td?.openAreaPct || res.holeAreaPct}%`, cx - 104, cy + cr + 16);
        ctx.fillText(`Weir hw=${td?.weirH_mm || res.weirH_mm}mm (Lw=${td?.weirL_mm || 600}mm) | DC=${td?.dcWidthTopMm || 140}/${td?.dcWidthBotMm || 110}mm`, cx - 104, cy + cr + 30);
        ctx.fillText(`Clearance hap=${td?.dcClearanceMm || 38}mm | ${res.N_actual} Trays (Feed #${res.feed_stage_actual})`, cx - 104, cy + cr + 44);
        ctx.fillStyle = '#34d399';
        ctx.fillText(`Range: ${td?.opMinPct || 45}~${td?.opMaxPct || 112}% (${td?.turndownRatio || 2.2}:1) | ΔP=${res.dP_total_mbar.toFixed(1)}mbar`, cx - 104, cy + cr + 58);
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
      const vs = res.vesselSpec || {};
      const pk = res.packingDetail || {};
      const beds = pk.beds || [];
      const nzList = res.nozzleSchedule || [];
      const mhList = res.manholeSchedule || [];
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
      let lnA = 1;
      const bedSummary = beds.length
        ? beds.map((b) => `Bed#${b.bedNo}: ${b.heightMm}mm (EL+${b.botElMm}~+${b.topElMm})`).join(' | ')
        : `${res.N_beds} Bed(s) × ${(res.H_bed_m * 1000).toFixed(0)}mm`;
      const rdSummary = (pk.redistributors?.count || 0) > 0
        ? `${pk.redistributors.count} EA (${pk.redistributors.items.map((x) => `${x.tag}@+${x.elevationMm}`).join(', ')})`
        : 'None Required (Single Bed)';
      const nozHtmlAbs = [...nzList, ...mhList.map((m) => ({
        tag: m.tag, service: m.service, phase: 'Manway', selectedDn: m.sizeDn, flangeRating: m.flangeRating,
        flowKgH: '-', velMS: '-', elevationMm: m.elevationMm, orientationDeg: m.orientationDeg
      }))].map((nz) => `
        <tr>
          <td class="ln">${lnA++}</td><td class="val-hi">${nz.tag}</td><td colspan="2">${nz.service}</td>
          <td class="val-hi" colspan="2">${nz.selectedDn} (${nz.flangeRating})</td>
          <td class="val" style="text-align:center;">${nz.orientationDeg}°</td>
          <td class="val-hi" colspan="2">EL +${nz.elevationMm} mm</td>
          <td class="val">${nz.flowKgH !== '-' ? `${nz.flowKgH} kg/h (${nz.velMS} m/s)` : 'Hinged Manway'}</td>
        </tr>
      `).join('');

      return `
        ${buildTopSheetHeader('PACKED ABSORPTION / SCRUBBING COLUMN SPECIFICATION DATASHEET (본체 + 패킹 분리 양식)', eqTag, eqService, `GPDC-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">${lnA++}</td><td colspan="9">PART I — COLUMN VESSEL & PROCESS SHELL SPECIFICATION (본체 데이터시트 · PACKED ABSORBER)</td></tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Gas Stream / Absorbent Liquid</b></td><td colspan="3" class="val-hi">Gas: ${res.lkBase.name} / Liq: ${res.hkBase.name}</td>
              <td colspan="2"><b>Operating Pressure & Temps</b></td><td colspan="2" class="val-hi">${res.P_bar.toFixed(2)} barA · Gas In ${res.T_feed_C.toFixed(1)}°C / Liq In ${res.T_top_C.toFixed(1)}°C</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Feed Gas / Liquid Flowrate</b></td><td class="unit-c">kg/h (kmol/h)</td>
              <td colspan="2" class="val-hi">G = ${res.gas_kgh.toFixed(0)} kg/h (${res.D.toFixed(1)} kmol/h)</td>
              <td colspan="2"><b>Liquid Flowrate & L/G Ratio</b></td><td colspan="2" class="val-hi">L = ${res.liq_kgh.toFixed(0)} kg/h (${res.B.toFixed(1)} kmol/h · L/G=${res.LG_mass_ratio.toFixed(2)})</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Solute Inlet → Outlet & Removal</b></td><td class="unit-c">ppm / %</td>
              <td colspan="2" class="val-hi">${res.y_in_ppm.toLocaleString()} → ${res.y_out_ppm} ppm</td>
              <td colspan="2"><b>Removal Efficiency & Duty</b></td><td colspan="2" class="val-hi" style="color:#34d399;">${res.removal_pct.toFixed(3)}% (${res.m_abs_kgh.toFixed(2)} kg/h · ${res.Qc_kW.toFixed(1)} kW)</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Shell ID × T/T Height × Skirt × O.A.L.</b></td><td class="unit-c">mm</td>
              <td colspan="4" class="val-hi">ID Ø${vs.idMm || Math.round(res.D_col_m * 1000)} × H_T/T ${vs.hTangentMm || Math.round(res.H_tangent_m * 1000)} × Skirt ${vs.skirtHeightMm || 2800} × O.A.L. ${vs.oalElMm || Math.round((res.H_tangent_m + 3.5) * 1000)} mm</td>
              <td colspan="2" rowspan="5" style="padding:4px;vertical-align:middle;background:#050b18;">${absSketchSvg}</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>ASME Design P / T & Wall Thickness</b></td><td class="unit-c">barG / °C / mm</td>
              <td colspan="4" class="val">${vs.designP_barG || 3.5} barG / ${vs.designT_C || 120}°C · Shell ${vs.wallThicknessMm || 10}t / 2:1 Head ${vs.headThicknessMm || 10}t (CA ${vs.corrAllowanceMm || 2.0}mm)</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Sump Levels (LLL / NLL / HLL EL) & Weight</b></td><td class="unit-c">EL mm / kg</td>
              <td colspan="4" class="val">LLL +${vs.lllElMm || 3100} / NLL +${vs.nllElMm || 3550} / HLL +${vs.hllElMm || 4000} · Empty ${vs.emptyWeightKg?.toLocaleString() || '-'} / Oper ${vs.operWeightKg?.toLocaleString() || '-'} kg</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">${lnA++}</td><td colspan="9">PART II-B — PACKED COLUMN INTERNALS & HARDWARE DATASHEET (패킹 컬럼 데이터시트)</td></tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Packing Category, Model & Size (종류/크기)</b></td><td class="unit-c">Spec</td>
              <td colspan="4" class="val-hi">${pk.modelName || res.packSpec.name} · Size: ${pk.nominalSize || `${res.packSpec.size_mm} mm`} (${pk.material || res.packSpec.mat})</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Surface Area (a_p), Void (ε) & Factor (F_p)</b></td><td class="unit-c">m²/m³ / % / m⁻¹</td>
              <td colspan="2" class="val-hi">a_p = ${res.packSpec.ap} m²/m³ · ε = ${res.packSpec.void_pct}% · F_p = ${res.packSpec.Fp} m⁻¹</td>
              <td colspan="2"><b>Mass Transfer (N_OG · HTU_OG · HETP)</b></td><td colspan="2" class="val-hi">N_OG = ${res.N_OG.toFixed(2)} · HTU_OG = ${res.HTU_OG_m.toFixed(2)} m · HETP = ${res.HETP_m.toFixed(2)} m</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Packed Bed Heights & EL (배드높이)</b></td><td class="unit-c">mm / Beds</td>
              <td colspan="6" class="val-hi" style="color:#34d399;">Total Z = ${(res.H_pack_total_m * 1000).toFixed(0)} mm (${res.H_pack_total_m.toFixed(2)} m, ${res.N_beds} Bed) · ${bedSummary}</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Top Distributor (상부 분배기 LD-1)</b></td><td class="unit-c">pts/m²</td>
              <td colspan="2" class="val-hi">${pk.topDistributor?.type || 'Gravity Trough Distributor'}</td>
              <td colspan="2"><b>Drip Density & Elevation</b></td><td colspan="2" class="val-hi">${pk.topDistributor?.dripPointsPerM2 || 80} pts/m² (${pk.topDistributor?.totalDripPoints || '-'} pts) @ EL +${pk.topDistributor?.elevationMm || '-'} mm</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Liquid Redistributor (재분배기 RD)</b></td><td class="unit-c">EA / EL</td>
              <td colspan="2" class="val">${rdSummary}</td>
              <td colspan="2"><b>Mist Eliminator (ME-1)</b></td><td colspan="2" class="val">${pk.demister?.type || 'Wire-Mesh Pad'} (${pk.demister?.thicknessMm || 150}t) @ EL +${pk.demister?.elevationMm || '-'} mm</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Packing Support Plate (지지판 SP)</b></td><td class="unit-c">EA / % Open</td>
              <td colspan="2" class="val">${pk.supportPlate?.count || res.N_beds} EA · ${pk.supportPlate?.type || 'Gas-Injection Support Plate'}</td>
              <td colspan="2"><b>Hold-Down Grid (홀드다운 HD)</b></td><td colspan="2" class="val">${pk.holdDownGrid?.count || res.N_beds} EA · ${pk.holdDownGrid?.type || 'Weighted Hold-Down Grid'}</td>
            </tr>
            <tr>
              <td class="ln">${lnA++}</td><td colspan="2"><b>Operating Window & Wetting (운전범위/적심)</b></td><td class="unit-c">% / m³/m²h</td>
              <td colspan="2" class="val-hi" style="color:#34d399;">${pk.opMinPct || 40}% ~ ${pk.opMaxPct || 115}% (TD ${pk.turndownRatio || 2.5}:1) · L_w=${res.wetting_rate_m3m2h.toFixed(1)} (MWR ${pk.mwrM3M2H || 1.5})</td>
              <td colspan="2"><b>GPDC Flood, Dry/Irrig & Total ΔP</b></td><td colspan="2" class="val-hi">Flood ${res.flood_pct.toFixed(1)}% · ΔP=${res.dP_pack_mbar_m.toFixed(2)} mbar/m · Total ${res.dP_total_mbar.toFixed(1)} mbar</td>
            </tr>
            <tr class="sec-hdr"><td class="ln">${lnA++}</td><td colspan="9">PART III — NOZZLE & MANHOLE ELEVATION SCHEDULE (노즐·맨홀 규격 및 EL 위치)</td></tr>
            <tr><td class="ln">-</td><td><b>Tag</b></td><td colspan="2"><b>Service</b></td><td colspan="2"><b>Size & Rating</b></td><td><b>Orient</b></td><td colspan="2"><b>Elevation (Base EL 0)</b></td><td><b>Flow / Vel</b></td></tr>
            ${nozHtmlAbs}
          </tbody>
        </table>
      `;
    }

    // =======================================================================
    // 3B. DISTILLATION COLUMN — VESSEL + STRICTLY SEPARATED TRAY / PACKING DATASHEET
    // =======================================================================
    if (eqType === 'column') {
      const isPacked = res.internals === 'packed';
      const costUsd = Math.round(28000 + 2200 * res.N_actual * Math.pow(res.D_col_m, 1.45) * (isPacked ? 1.15 : 1.0));
      const costKrw = Math.round((costUsd * 1380) / 10000) * 10000;
      const eqTag = res.equipTag || 'T-101';
      const eqService = res.equipName || `${res.lkBase.name} / ${res.hkBase.name} Fractionator (${isPacked ? 'PACKED COLUMN' : 'TRAYED COLUMN'})`;
      const vs = res.vesselSpec || {};
      const td = res.trayDetail || {};
      const pk = res.packingDetail || {};
      const nzList = res.nozzleSchedule || [];
      const mhList = res.manholeSchedule || [];
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
          ${(res.S || 0) > 0 ? `<line x1="108" y1="56" x2="132" y2="56" stroke="#a855f7" stroke-width="2"/><text x="134" y="59" fill="#c4b5fd" font-size="8" font-weight="bold">N7 S</text>` : ''}
          <circle cx="185" cy="72" r="36" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
          <line x1="162" y1="45" x2="162" y2="99" stroke="#10b981" stroke-width="1.5"/>
          <line x1="208" y1="45" x2="208" y2="99" stroke="#10b981" stroke-width="1.5"/>
          <text x="130" y="12" fill="#38bdf8" font-size="9" text-anchor="middle" font-weight="bold">ID Ø${(res.D_col_m*1000).toFixed(0)}mm × H ${res.H_tangent_m.toFixed(1)}m (${isPacked ? `${res.N_beds} Packed Beds` : `${res.N_actual} Trays`})</text>
          <text x="130" y="146" fill="#34d399" font-size="8.5" text-anchor="middle">${isPacked ? `HETP=${res.HETP_m.toFixed(2)}m · H_pack=${res.H_pack_total_m.toFixed(1)}m` : `Feed #${res.feed_stage_actual} · ${td.passes || res.trayPasses}-Pass`} · Qc=${res.Qc_kW.toFixed(0)}kW · Qr=${res.Qr_kW.toFixed(0)}kW</text>
        </svg>
      `;
      let lnC = 1;
      const bedSummary = (pk.beds || []).length
        ? pk.beds.map((b) => `Bed#${b.bedNo} (${b.section}): ${b.heightMm}mm @ EL+${b.botElMm}~+${b.topElMm}`).join(' | ')
        : `${res.N_beds} Beds · H_pack = ${res.H_pack_total_m.toFixed(2)} m`;
      const rdSummary = (pk.redistributors?.count || 0) > 0
        ? `${pk.redistributors.count} EA (${pk.redistributors.items.map((x) => `${x.tag}@+${x.elevationMm}`).join(', ')})`
        : 'None Required';
      const nozHtmlDist = [...nzList, ...mhList.map((m) => ({
        tag: m.tag, service: m.service, phase: 'Manway', selectedDn: m.sizeDn, flangeRating: m.flangeRating,
        flowKgH: '-', velMS: '-', elevationMm: m.elevationMm, orientationDeg: m.orientationDeg
      }))].map((nz) => `
        <tr>
          <td class="ln">${lnC++}</td><td class="val-hi">${nz.tag}</td><td colspan="2">${nz.service}</td>
          <td class="val-hi" colspan="2">${nz.selectedDn} (${nz.flangeRating})</td>
          <td class="val" style="text-align:center;">${nz.orientationDeg}°</td>
          <td class="val-hi" colspan="2">EL +${nz.elevationMm} mm</td>
          <td class="val">${nz.flowKgH !== '-' ? `${nz.flowKgH} kg/h (${nz.velMS} m/s)` : 'Hinged Manway'}</td>
        </tr>
      `).join('');

      const part2Html = isPacked ? `
        <tr class="sec-hdr"><td class="ln">${lnC++}</td><td colspan="9">PART II-B — PACKED COLUMN INTERNALS & HARDWARE DATASHEET (패킹 컬럼 데이터시트)</td></tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Packing Category, Model & Size (패킹 종류·크기)</b></td><td class="unit-c">Spec</td>
          <td colspan="4" class="val-hi">${pk.modelName || res.packSpec.name} · Size: ${pk.nominalSize || `${res.packSpec.size_mm} mm`} (${pk.categoryLabel || res.packSpec.type})</td>
          <td colspan="2" rowspan="6" style="padding:4px;vertical-align:middle;background:#050b18;">${colSketchSvg}</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Specific Surface (a_p), Void (ε) & F_p</b></td><td class="unit-c">m²/m³ / % / m⁻¹</td>
          <td colspan="4" class="val">a_p = ${res.packSpec.ap} m²/m³ · ε = ${res.packSpec.void_pct}% · F_p = ${res.packSpec.Fp} m⁻¹ · Mat: ${pk.material || res.packSpec.mat}</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Total Packed Bed Height & HETP (배드높이/HETP)</b></td><td class="unit-c">mm / m</td>
          <td colspan="4" class="val-hi" style="color:#34d399;">Total Z = ${(res.H_pack_total_m * 1000).toFixed(0)} mm (${res.N_beds} Beds) · Avg HETP = ${(res.HETP_m * 1000).toFixed(0)} mm (${res.HETP_m.toFixed(2)} m) · ${bedSummary}</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Top Liquid Distributor (분배기 LD-1) & Demister</b></td><td class="unit-c">pts/m² / EL</td>
          <td colspan="4" class="val-hi">${pk.topDistributor?.type || 'Gravity Trough'} (${pk.topDistributor?.dripPointsPerM2 || 100} pts/m², ${pk.topDistributor?.totalDripPoints || '-'} pts @ EL +${pk.topDistributor?.elevationMm || '-'}) · Demister ${pk.demister?.thicknessMm || 150}t @ +${pk.demister?.elevationMm || '-'}</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Redistributors (재분배기), Support & Hold-Down</b></td><td class="unit-c">EA / EL</td>
          <td colspan="4" class="val">RD: ${rdSummary} · Support Plate: ${pk.supportPlate?.count || res.N_beds}EA (${pk.supportPlate?.freeAreaPct || 86}%) · Hold-Down: ${pk.holdDownGrid?.count || res.N_beds}EA (${pk.holdDownGrid?.freeAreaPct || 92}%)</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Operating Window, Wetting Rate & Pressure Drop</b></td><td class="unit-c">% / mbar</td>
          <td colspan="4" class="val-hi">${pk.opMinPct || 40}% ~ ${pk.opMaxPct || 115}% (TD ${pk.turndownRatio || 2.5}:1) · L_w=${pk.wettingRateM3M2H || '-'} (MWR ${pk.mwrM3M2H || 0.8}) · Flood ${res.flood_pct.toFixed(1)}% · ΔP=${res.dP_pack_mbar_m.toFixed(2)} mbar/m (Tot ${res.dP_total_mbar.toFixed(1)})</td>
        </tr>
      ` : `
        <tr class="sec-hdr"><td class="ln">${lnC++}</td><td colspan="9">PART II-A — FRACTIONATION TRAY INTERNALS DATASHEET (트레이 컬럼 데이터시트)</td></tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Tray Type & Deck Material / Thickness</b></td><td class="unit-c">Spec / mm</td>
          <td colspan="4" class="val-hi">${td.trayTypeLabel || res.trayType} · Deck ${td.deckThicknessMm || 3.0} mmt · Stages: N_theo=${res.N_theo.toFixed(1)} → N_act=${res.N_actual} (Feed #${res.feed_stage_actual})</td>
          <td colspan="2" rowspan="6" style="padding:4px;vertical-align:middle;background:#050b18;">${colSketchSvg}</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Flow Passes (패스 수) & Tray Spacing (단간격)</b></td><td class="unit-c">Pass / mm</td>
          <td colspan="4" class="val-hi" style="color:#34d399;">${td.passes || res.trayPasses}-Pass Cross-Flow · Tray Spacing = ${td.spacingMm || Math.round(res.traySpacing_m * 1000)} mm · Active Area A_a = ${td.activeAreaM2 || '-'} m² (${td.activeAreaPct || '-'}%)</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Hole / Valve Diameter (홀지름) & Open Area (개공비)</b></td><td class="unit-c">mm / %</td>
          <td colspan="4" class="val-hi">Ø_h = ${td.holeD_mm || res.holeD_mm} mm · Pitch = ${td.holePitchMm || 15.1} mm (60° Δ) · Open Area = ${td.openAreaPct || res.holeAreaPct}% of A_a (${td.openAreaTowerPct || '-'}% of A_T)</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Outlet Weir Geometry (위어 높이·길이·월류수두)</b></td><td class="unit-c">mm</td>
          <td colspan="4" class="val">Weir Height h_w = ${td.weirH_mm || res.weirH_mm} mm · Weir Length L_w = ${td.weirL_mm || '-'} mm · Weir Crest h_ow = ${td.weirCrestMm || '-'} mm</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Downcomer Geometry (다운커머 폭·면적·틈새)</b></td><td class="unit-c">mm / %</td>
          <td colspan="4" class="val-hi">DC Top / Bot Width = ${td.dcWidthTopMm || '-'} / ${td.dcWidthBotMm || '-'} mm · DC Area = ${td.dcAreaPct || 12}% A_T · Apron Clearance h_ap = ${td.dcClearanceMm || 38} mm (Seal +${(td.weirH_mm || 50) - (td.dcClearanceMm || 38)}mm)</td>
        </tr>
        <tr>
          <td class="ln">${lnC++}</td><td colspan="2"><b>Operating Window (운전범위), Flood, Weep & ΔP</b></td><td class="unit-c">% / mbar</td>
          <td colspan="4" class="val-hi">${td.opMinPct || 45}% ~ ${td.opMaxPct || 112}% (TD ${td.turndownRatio || 2.2}:1) · Flood ${res.flood_pct.toFixed(1)}% · Weep ${res.weep_ratio.toFixed(2)}x · DC Backup ${res.dc_backup_pct.toFixed(1)}% · ΔP/tray ${res.dP_tray_mbar.toFixed(2)} mbar (Tot ${res.dP_total_mbar.toFixed(1)})</td>
        </tr>
      `;

      return `
        ${buildTopSheetHeader(`PROCESS COLUMN EPC DATASHEET (본체 + ${isPacked ? '패킹' : '트레이'} 엄격 분리)`, eqTag, eqService, `FRI-${eqTag}`, costKrw, costUsd, dateStr)}
        <table class="tema-excel-table">
          <tbody>
            <tr class="sec-hdr"><td class="ln">${lnC++}</td><td colspan="9">PART I — COLUMN VESSEL & PROCESS SHELL SPECIFICATION (본체 데이터시트 · ${isPacked ? 'PACKED' : 'TRAYED'})</td></tr>
            <tr>
              <td class="ln">${lnC++}</td><td colspan="2"><b>Binary System (LK / HK) & α_avg</b></td><td colspan="3" class="val-hi">${res.lkBase.name} / ${res.hkBase.name} (α = ${res.alpha.toFixed(3)})</td>
              <td colspan="2"><b>Process Flows (${res.S > 0 ? 'F / D / S / B' : 'F / D / B'})</b></td><td colspan="2" class="val-hi">F=${(res.F || (res.D + (res.S || 0) + res.B)).toFixed(1)} / D=${res.D.toFixed(1)}${res.S > 0 ? ` / S=${res.S.toFixed(1)}` : ''} / B=${res.B.toFixed(1)} kmol/h (xD ${res.xD.toFixed(3)}${res.S > 0 ? `, xS ${(res.xS_mol ?? 0).toFixed(3)}` : ''}, xB ${res.xB.toFixed(4)})</td>
            </tr>
            ${res.S > 0 ? `
            <tr>
              <td class="ln">${lnC++}</td><td colspan="2"><b>Side-Cut Product Draw (S · 측류 인출)</b></td><td class="unit-c">kmol/h / mol</td>
              <td colspan="6" class="val-hi" style="color:#c4b5fd;">S = ${res.S.toFixed(1)} kmol/h (S/F = ${((res.S / Math.max(1e-6, res.F)) * 100).toFixed(1)}%) · x_S = ${(res.xS_mol ?? 0).toFixed(3)} · Stage #${res.sideCutStage || '-'} (${res.sideCutPhase === 'vapor' ? 'Vapor' : 'Liquid'}) · T = ${(res.sideCutTempC ?? res.T_feed_C).toFixed(1)} °C</td>
            </tr>
            ` : ''}
            <tr>
              <td class="ln">${lnC++}</td><td colspan="2"><b>Temperatures & Reflux Ratio</b></td><td class="unit-c">°C / Ratio</td>
              <td colspan="2" class="val-hi">${res.T_top_C.toFixed(1)} / ${res.T_feed_C.toFixed(1)} / ${res.T_bot_C.toFixed(1)} °C</td>
              <td colspan="2"><b>R_op & Duties (Qc / Qr)</b></td><td colspan="2" class="val-hi">R=${res.R.toFixed(2)} (Rmin ${res.Rmin.toFixed(2)}) · Qc=${res.Qc_kW.toFixed(1)} / Qr=${res.Qr_kW.toFixed(1)} kW</td>
            </tr>
            <tr>
              <td class="ln">${lnC++}</td><td colspan="2"><b>Shell ID × T/T Height × Skirt × O.A.L.</b></td><td class="unit-c">mm</td>
              <td colspan="6" class="val-hi">ID Ø${vs.idMm || Math.round(res.D_col_m * 1000)} × H_T/T ${vs.hTangentMm || Math.round(res.H_tangent_m * 1000)} × Skirt ${vs.skirtHeightMm || 3200} × O.A.L. ${vs.oalElMm || Math.round((res.H_tangent_m + 3.8) * 1000)} mm (E_o = ${res.E_overall_pct.toFixed(1)}%)</td>
            </tr>
            <tr>
              <td class="ln">${lnC++}</td><td colspan="2"><b>ASME Design P / T, Wall t & Sump Levels</b></td><td class="unit-c">barG / EL mm</td>
              <td colspan="6" class="val">${vs.designP_barG || 3.5} barG / ${vs.designT_C || 140}°C · Shell ${vs.wallThicknessMm || 12}t / Head ${vs.headThicknessMm || 12}t · LLL +${vs.lllElMm || 3500} / NLL +${vs.nllElMm || 3950} / HLL +${vs.hllElMm || 4400} · Empty ${vs.emptyWeightKg?.toLocaleString() || '-'} / Oper ${vs.operWeightKg?.toLocaleString() || '-'} kg</td>
            </tr>
            ${part2Html}
            <tr class="sec-hdr"><td class="ln">${lnC++}</td><td colspan="9">PART III — NOZZLE & MANHOLE ELEVATION SCHEDULE (노즐·맨홀 규격 및 EL 위치)</td></tr>
            <tr><td class="ln">-</td><td><b>Tag</b></td><td colspan="2"><b>Service</b></td><td colspan="2"><b>Size & Rating</b></td><td><b>Orient</b></td><td colspan="2"><b>Elevation (Base EL 0)</b></td><td><b>Flow / Vel</b></td></tr>
            ${nozHtmlDist}
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

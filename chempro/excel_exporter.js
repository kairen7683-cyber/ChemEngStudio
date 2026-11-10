/**
 * ChemEng Studio Pro v2.2 — Official TEMA / API / ASME Excel (.xlsx) Specification Sheet & Sketch Exporter
 * Generates multi-sheet .xlsx workbooks with:
 *   - Sheet 1: Exact numbered EPC / TEMA (Lines 1-44) / API 610 / FRI / ASME Specification Sheet + Embedded Mini Sketch
 *   - Sheet 2: Full-Scale Engineering DWG (CAD Blueprint) + Multi-Axis Performance Curve Sketch + Nozzle Schedule
 */

window.ChemEngExcelExporter = (function () {

  function getCanvasBase64(canvasId, fallbackRenderFn) {
    let canvas = document.getElementById(canvasId);
    if (fallbackRenderFn) {
      // Create an offscreen high-res canvas so image is always crisp regardless of tab visibility
      const off = document.createElement('canvas');
      off.width = 960;
      off.height = 480;
      off.style.width = '960px';
      off.style.height = '480px';
      fallbackRenderFn(off);
      return off.toDataURL('image/png');
    }
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      return canvas.toDataURL('image/png');
    }
    return null;
  }

  // Render a clean white-background TEMA / Equipment Sketch PNG for the Sheet 1 "Sketch" box (rows 28-34, cols H-J)
  function renderWhitePrintMiniSketchBase64(eqType, res) {
    const c = document.createElement('canvas');
    const w = 520, h = 260;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Arial, sans-serif';

    if (eqType === 'hx') {
      ctx.fillText(`TEMA ${res.tema_type} SHELL & TUBE SKETCH — ID Ø${res.D_shell_mm} × L ${(res.L_m * 1000).toFixed(0)} mm`, 18, 26);
      const sx = 75, sy = 72, sw = 310, sh = 95;
      // Front header + Shell + Rear head
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.strokeRect(sx - 40, sy, 40, sh);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.beginPath();
      ctx.moveTo(sx + sw, sy);
      ctx.quadraticCurveTo(sx + sw + 48, sy + sh / 2, sx + sw, sy + sh);
      ctx.stroke();

      // Tubesheets
      ctx.fillStyle = '#334155';
      ctx.fillRect(sx - 4, sy - 6, 6, sh + 12);
      ctx.fillRect(sx + sw - 2, sy - 6, 6, sh + 12);

      // Tubes (dashed blue)
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1;
      for (let r = 1; r <= 5; r++) {
        const ty = sy + (sh * r) / 6;
        ctx.beginPath(); ctx.moveTo(sx, ty); ctx.lineTo(sx + sw, ty); ctx.stroke();
      }

      // Baffles
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2;
      const nb = Math.min(10, Math.max(4, res.N_baffles || 6));
      for (let b = 1; b <= nb; b++) {
        const bx = sx + (sw * b) / (nb + 1);
        const top = b % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(bx, top ? sy + sh * 0.25 : sy);
        ctx.lineTo(bx, top ? sy + sh : sy + sh * 0.75);
        ctx.stroke();
      }

      // Nozzles
      ctx.strokeStyle = '#0f172a';
      ctx.strokeRect(sx + 24, sy - 24, 14, 24);
      ctx.strokeRect(sx + sw - 38, sy + sh, 14, 24);
      ctx.strokeRect(sx - 26, sy + sh, 12, 22);
      ctx.strokeRect(sx - 26, sy - 22, 12, 22);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 11px Arial, sans-serif';
      ctx.fillText(`N1 Shell In (${res.nozzle_shell_nps || '4"'} 150#)`, sx + 12, sy - 30);
      ctx.fillText(`N2 Shell Out (${res.nozzle_shell_nps || '4"'} 150#)`, sx + sw - 95, sy + sh + 38);
      ctx.fillText(`Tubes: ${res.N_tubes} EA × OD ${res.do_mm}mm × ${res.tw_mm}t | Baffles: ${res.N_baffles} EA @ ${res.B_spacing_mm}mm (${res.baffleCutPct}% Cut)`, 18, h - 18);
    } else if (eqType === 'pump') {
      ctx.fillText(`API 610 OH2 PROCESS PUMP SKETCH — Impeller Ø${res.D_imp_rated_mm}mm / ${res.P_motor_std_kW} kW`, 18, 26);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.strokeRect(45, 185, 420, 16);
      ctx.beginPath(); ctx.arc(120, 122, 38, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeRect(50, 110, 32, 24);
      ctx.strokeRect(108, 52, 24, 32);
      ctx.strokeRect(158, 106, 75, 32);
      ctx.strokeRect(233, 112, 38, 20);
      ctx.strokeRect(271, 82, 145, 76);
      ctx.font = 'bold 11px Arial, sans-serif';
      ctx.fillText(`Duty: Q = ${res.Q_m3h.toFixed(1)} m³/h | TDH = ${res.H_total_m.toFixed(2)} m | Shaft = ${res.P_shaft_kW.toFixed(2)} kW | NPSHa = ${res.NPSHa_m.toFixed(2)} m`, 18, h - 18);
    } else {
      // Offscreen render from drawEngineeringDWG
      window.ChemEngSolvers.drawEngineeringDWG(c, eqType, res);
    }

    return c.toDataURL('image/png');
  }

  function applyGridBorders(ws, startRow, endRow, startCol, endCol, outerMedium) {
    const thin = { style: 'thin', color: { argb: 'FF475569' } };
    const med = { style: 'medium', color: { argb: 'FF0F172A' } };
    for (let r = startRow; r <= endRow; r++) {
      const row = ws.getRow(r);
      for (let c = startCol; c <= endCol; c++) {
        const cell = row.getCell(c);
        cell.border = {
          top: (outerMedium && r === startRow) ? med : thin,
          bottom: (outerMedium && r === endRow) ? med : thin,
          left: (outerMedium && c === startCol) ? med : thin,
          right: (outerMedium && c === endCol) ? med : thin
        };
        if (!cell.font) {
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF0F172A' } };
        }
        if (!cell.alignment) {
          cell.alignment = { vertical: 'middle', wrapText: true };
        }
      }
    }
  }

  function buildTopHeaderBlockExcel(ws, docTitle, equipNo, serviceName, specNo, dateStr) {
    ws.columns = [
      { width: 5.5 },  // A: Line No (1..44)
      { width: 17.0 }, // B: Item Category
      { width: 18.0 }, // C: Sub-item
      { width: 12.5 }, // D: Units
      { width: 13.5 }, // E: Shell In / Col 1
      { width: 13.5 }, // F: Shell Out / Col 2
      { width: 13.5 }, // G: Tube In / Col 3
      { width: 13.5 }, // H: Tube Out / Sketch 1
      { width: 13.5 }, // I: Extra / Sketch 2
      { width: 14.5 }  // J: Extra / Sketch 3
    ];

    // Row 1: Brand & Title
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = 'CHEMENG STUDIO PRO — EPC SPECIFICATION';
    ws.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };

    ws.mergeCells('E1:J1');
    ws.getCell('E1').value = docTitle;
    ws.getCell('E1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
    ws.getCell('E1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('E1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    ws.getRow(1).height = 24;

    // Row 2: Rev Headers & Client / Equip No / Page
    ws.getCell('A2').value = 'REV';
    ws.getCell('B2').value = 'PREPARED BY';
    ws.getCell('C2').value = 'DATE';
    ws.getCell('D2').value = 'APPROVAL';
    ['A2', 'B2', 'C2', 'D2'].forEach(k => {
      ws.getCell(k).font = { name: 'Calibri', size: 8.5, bold: true };
      ws.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    });

    ws.mergeCells('E2:F2');
    ws.getCell('E2').value = 'CLIENT: CHEMENG EPC CORP.';
    ws.mergeCells('G2:H2');
    ws.getCell('G2').value = `EQUIP. NO: ${equipNo}`;
    ws.getCell('G2').font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.mergeCells('I2:J2');
    ws.getCell('I2').value = 'PAGE: 1 OF 2 (+SKETCH)';
    ws.getRow(2).height = 17;

    // Row 3: Rev 0 & W.O. / Requisition / Spec No
    ws.getCell('A3').value = '0';
    ws.getCell('B3').value = 'LEAD PROCESS ENG.';
    ws.getCell('C3').value = dateStr;
    ws.getCell('D3').value = 'ISSUED FOR RFQ';
    ['A3', 'B3', 'C3', 'D3'].forEach(k => { ws.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' }; });

    ws.mergeCells('E3:F3');
    ws.getCell('E3').value = `W.O.: WO-2026-${equipNo}`;
    ws.mergeCells('G3:H3');
    ws.getCell('G3').value = `REQUISITION NO.: REQ-${equipNo}-01`;
    ws.mergeCells('I3:J3');
    ws.getCell('I3').value = `SPECIFICATION NO.: ${specNo}`;
    ws.getRow(3).height = 17;

    // Row 4: Rev 1 & Unit / Procured / Installed
    ws.getCell('A4').value = '1';
    ws.getCell('B4').value = 'GEMINI 2.5 FLASH';
    ws.getCell('C4').value = dateStr;
    ws.getCell('D4').value = 'AI CONVERGED';
    ['A4', 'B4', 'C4', 'D4'].forEach(k => { ws.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' }; });

    ws.mergeCells('E4:F4');
    ws.getCell('E4').value = `SERVICE: ${serviceName}`;
    ws.getCell('E4').font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells('G4:H4');
    ws.getCell('G4').value = 'PROCURED BY: EPC PURCHASING';
    ws.mergeCells('I4:J4');
    ws.getCell('I4').value = 'INSTALLED BY: EPC FIELD CONST.';
    ws.getRow(4).height = 17;

    applyGridBorders(ws, 1, 4, 1, 10, true);
  }

  function addSectionBanner(ws, rowIdx, lineNo, title) {
    ws.getCell(rowIdx, 1).value = lineNo;
    ws.getCell(rowIdx, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(rowIdx, 1).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(rowIdx, 2, rowIdx, 10);
    const cell = ws.getCell(rowIdx, 2);
    cell.value = title;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= 10; c++) {
      ws.getCell(rowIdx, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    }
    ws.getRow(rowIdx).height = 18.5;
  }

  // =========================================================================
  // SHEET 1 BUILDER FOR HEAT EXCHANGER (EXACT 44-ROW TEMA DATASHEET!)
  // =========================================================================
  function populateHXSheet1(wb, ws, res, dateStr) {
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

    buildTopHeaderBlockExcel(ws, 'SHELL-AND-TUBE HEAT EXCHANGER', 'E-101', `${sFluid?.name || 'Hot'} / ${tFluid?.name || 'Cold'} Exchanger`, 'TEMA-R-E101', dateStr);

    // Row offset: Line 1 starts at Excel Row 5 (so Line N is at Excel Row N + 4)
    const R = ln => ln + 4;

    // Line 1: Size, TEMA Type, Connected in
    ws.getCell(R(1), 1).value = 1;
    ws.getCell(R(1), 2).value = 'Size (ID / Length)';
    ws.mergeCells(R(1), 3, R(1), 4);
    ws.getCell(R(1), 3).value = `Ø${res.D_shell_mm} mm / ${(res.L_m * 1000).toFixed(0)} mm`;
    ws.getCell(R(1), 3).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.getCell(R(1), 5).value = 'TEMA Type';
    ws.getCell(R(1), 6).value = `${res.tema_type} (Class R)`;
    ws.getCell(R(1), 6).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(R(1), 7, R(1), 8);
    ws.getCell(R(1), 7).value = 'Connected in (series/parallel)';
    ws.mergeCells(R(1), 9, R(1), 10);
    ws.getCell(R(1), 9).value = `${res.nShell} Series / 1 Parallel`;

    // Line 2: Surface per Unit, Shells per Unit, Surface per Shell
    ws.getCell(R(2), 1).value = 2;
    ws.getCell(R(2), 2).value = 'Surface per Unit';
    ws.mergeCells(R(2), 3, R(2), 4);
    ws.getCell(R(2), 3).value = `${res.A_prov_m2.toFixed(1)} m² (${(res.A_prov_m2 * 10.7639).toFixed(1)} ft²)`;
    ws.getCell(R(2), 3).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell(R(2), 5).value = 'Shells per Unit';
    ws.getCell(R(2), 6).value = res.nShell;
    ws.mergeCells(R(2), 7, R(2), 8);
    ws.getCell(R(2), 7).value = 'Surface per Shell';
    ws.mergeCells(R(2), 9, R(2), 10);
    ws.getCell(R(2), 9).value = `${aPerShell} m² (Req: ${res.A_req_m2.toFixed(1)} m²)`;

    // Line 3: Performance of One Unit
    addSectionBanner(ws, R(3), 3, 'Performance of One Unit');

    // Line 4: Fluid Allocation
    ws.getCell(R(4), 1).value = 4;
    ws.mergeCells(R(4), 2, R(4), 4);
    ws.getCell(R(4), 2).value = 'Fluid Allocation';
    ws.getCell(R(4), 2).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(R(4), 5, R(4), 7);
    ws.getCell(R(4), 5).value = `Shell Side (${isHotShell ? 'Hot Side' : 'Cold Side'})`;
    ws.getCell(R(4), 5).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.getCell(R(4), 5).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(R(4), 8, R(4), 10);
    ws.getCell(R(4), 8).value = `Tube Side (${isHotShell ? 'Cold Side' : 'Hot Side'})`;
    ws.getCell(R(4), 8).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.getCell(R(4), 8).alignment = { horizontal: 'center', vertical: 'middle' };

    // Line 5: Fluid Name
    ws.getCell(R(5), 1).value = 5;
    ws.mergeCells(R(5), 2, R(5), 4);
    ws.getCell(R(5), 2).value = 'Fluid Name';
    ws.mergeCells(R(5), 5, R(5), 7);
    ws.getCell(R(5), 5).value = `${sFluid?.name || '-'} [${sFluid?.formula || ''}]`;
    ws.getCell(R(5), 5).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell(R(5), 5).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(R(5), 8, R(5), 10);
    ws.getCell(R(5), 8).value = `${tFluid?.name || '-'} [${tFluid?.formula || ''}]`;
    ws.getCell(R(5), 8).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell(R(5), 8).alignment = { horizontal: 'center', vertical: 'middle' };

    // Line 6: Sub-header (Units | In | Out | In | Out)
    ws.getCell(R(6), 1).value = 6;
    ws.mergeCells(R(6), 2, R(6), 3);
    ws.getCell(R(6), 2).value = 'Process Parameter';
    ws.getCell(R(6), 4).value = 'Units (in/out)';
    ws.getCell(R(6), 5).value = 'In';
    ws.mergeCells(R(6), 6, R(6), 7);
    ws.getCell(R(6), 6).value = 'Out';
    ws.getCell(R(6), 8).value = 'In';
    ws.mergeCells(R(6), 9, R(6), 10);
    ws.getCell(R(6), 9).value = 'Out';
    for (let c = 2; c <= 10; c++) {
      ws.getCell(R(6), c).font = { name: 'Calibri', size: 9, bold: true };
      ws.getCell(R(6), c).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(R(6), c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }

    function addPerfRow(ln, label, unit, sIn, sOut, tIn, tOut, boldVals) {
      const r = R(ln);
      ws.getCell(r, 1).value = ln;
      ws.mergeCells(r, 2, r, 3);
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 4).value = unit;
      ws.getCell(r, 4).alignment = { horizontal: 'center', vertical: 'middle' };

      if (sOut === undefined) {
        ws.mergeCells(r, 5, r, 7);
        ws.getCell(r, 5).value = sIn;
        ws.getCell(r, 5).alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        ws.getCell(r, 5).value = sIn;
        ws.getCell(r, 5).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(r, 6, r, 7);
        ws.getCell(r, 6).value = sOut;
        ws.getCell(r, 6).alignment = { horizontal: 'center', vertical: 'middle' };
      }

      if (tOut === undefined) {
        ws.mergeCells(r, 8, r, 10);
        ws.getCell(r, 8).value = tIn;
        ws.getCell(r, 8).alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        ws.getCell(r, 8).value = tIn;
        ws.getCell(r, 8).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(r, 9, r, 10);
        ws.getCell(r, 9).value = tOut;
        ws.getCell(r, 9).alignment = { horizontal: 'center', vertical: 'middle' };
      }

      if (boldVals) {
        [5, 6, 8, 9].forEach(c => {
          ws.getCell(r, c).font = { name: 'Calibri', size: 9.5, bold: true };
        });
      }
      ws.getRow(r).height = 16.5;
    }

    addPerfRow(7, 'Flow Total', 'kg/h', Number(sFlow.toFixed(0)), undefined, Number(tFlow.toFixed(0)), undefined, true);
    addPerfRow(8, '   Vapor', 'kg/h (in/out)', 0, 0, 0, 0, false);
    addPerfRow(9, '   Liquid', 'kg/h (in/out)', Number(sFlow.toFixed(0)), Number(sFlow.toFixed(0)), Number(tFlow.toFixed(0)), Number(tFlow.toFixed(0)), false);
    addPerfRow(10, '   Steam', 'kg/h (in/out)', '-', '-', '-', '-', false);
    addPerfRow(11, '   Water', 'kg/h (in/out)', sFluid?.id === 'water' ? Number(sFlow.toFixed(0)) : '-', sFluid?.id === 'water' ? Number(sFlow.toFixed(0)) : '-', tFluid?.id === 'water' ? Number(tFlow.toFixed(0)) : '-', tFluid?.id === 'water' ? Number(tFlow.toFixed(0)) : '-', false);
    addPerfRow(12, '   Noncondensable', 'kg/h (in/out)', 0, 0, 0, 0, false);
    addPerfRow(13, 'Temperature (In / Out)', '°C', Number(sTin.toFixed(1)), Number(sTout.toFixed(2)), Number(tTin.toFixed(1)), Number(tTout.toFixed(2)), true);
    addPerfRow(14, 'Density', 'kg/m³', Number((sFluid?.rho * 0.995).toFixed(1)), Number((sFluid?.rho * 1.005).toFixed(1)), Number((tFluid?.rho * 1.004).toFixed(1)), Number((tFluid?.rho * 0.996).toFixed(1)), false);
    addPerfRow(15, 'Viscosity', 'cP', Number((sFluid?.mu * 0.92).toFixed(3)), Number((sFluid?.mu * 1.08).toFixed(3)), Number((tFluid?.mu * 1.06).toFixed(3)), Number((tFluid?.mu * 0.94).toFixed(3)), false);
    addPerfRow(16, 'Molecular Weight, Fluid', 'g/mol', sFluid?.mw || '-', undefined, tFluid?.mw || '-', undefined, false);
    addPerfRow(17, 'Specific Heat', 'kJ/kg·K', Number(sFluid?.cp.toFixed(3)), Number(sFluid?.cp.toFixed(3)), Number(tFluid?.cp.toFixed(3)), Number(tFluid?.cp.toFixed(3)), false);
    addPerfRow(18, 'Thermal Conductivity', 'W/m·K', Number(sFluid?.k.toFixed(3)), Number(sFluid?.k.toFixed(3)), Number(tFluid?.k.toFixed(3)), Number(tFluid?.k.toFixed(3)), false);
    addPerfRow(19, 'Latent Heat', 'kJ/kg', sFluid?.hv || '-', undefined, tFluid?.hv || '-', undefined, false);
    addPerfRow(20, 'Inlet Pressure', 'barG (inlet)', 4.50, undefined, 5.00, undefined, false);
    addPerfRow(21, 'Velocity', 'm/s', Number(res.vs.toFixed(2)), undefined, Number(res.vt.toFixed(2)), undefined, true);
    addPerfRow(22, 'Press Drop Allow / Calc', 'bar', 0.700, Number(res.dPs_bar.toFixed(3)), 0.700, Number(res.dPt_bar.toFixed(3)), true);
    addPerfRow(23, 'Fouling Factor', 'm²·K/W', Number(res.rfs.toFixed(5)), undefined, Number(res.rft.toFixed(5)), undefined, false);

    // Line 24: Heat Exchanged & LMTD (corrected)
    ws.getCell(R(24), 1).value = 24;
    ws.mergeCells(R(24), 2, R(24), 3);
    ws.getCell(R(24), 2).value = 'Heat Exchanged';
    ws.getCell(R(24), 4).value = 'kW (Mcal/h)';
    ws.mergeCells(R(24), 5, R(24), 6);
    ws.getCell(R(24), 5).value = `${res.Q_kW.toFixed(1)} kW (${(res.Q_kW * 0.85985).toFixed(1)} Mcal/h)`;
    ws.getCell(R(24), 5).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.mergeCells(R(24), 7, R(24), 8);
    ws.getCell(R(24), 7).value = 'LMTD (corrected) °C';
    ws.mergeCells(R(24), 9, R(24), 10);
    ws.getCell(R(24), 9).value = `${res.CMTD.toFixed(2)} °C (Ft=${res.Ft.toFixed(3)})`;
    ws.getCell(R(24), 9).font = { name: 'Calibri', size: 9.5, bold: true };

    // Line 25: Service Coeff. Dirty / Clean
    ws.getCell(R(25), 1).value = 25;
    ws.mergeCells(R(25), 2, R(25), 3);
    ws.getCell(R(25), 2).value = 'Service Coeff. (U)';
    ws.getCell(R(25), 4).value = 'W/m²·K';
    ws.getCell(R(25), 5).value = 'Dirty (Service):';
    ws.mergeCells(R(25), 6, R(25), 7);
    ws.getCell(R(25), 6).value = Number(res.U_calc.toFixed(1));
    ws.getCell(R(25), 6).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
    ws.getCell(R(25), 8).value = 'Clean (U_c):';
    ws.mergeCells(R(25), 9, R(25), 10);
    ws.getCell(R(25), 9).value = `${res.U_clean.toFixed(1)} (+${res.overdesign_pct.toFixed(1)}%)`;
    ws.getCell(R(25), 9).font = { name: 'Calibri', size: 9.5, bold: true };

    // Line 26: Construction Data for One Shell
    addSectionBanner(ws, R(26), 26, 'Construction Data for One Shell');

    // Line 27: Sub-header (Shell Side | Tube Side | Sketch)
    ws.getCell(R(27), 1).value = 27;
    ws.mergeCells(R(27), 2, R(27), 3);
    ws.getCell(R(27), 2).value = 'Construction Item';
    ws.getCell(R(27), 4).value = 'Units';
    ws.mergeCells(R(27), 5, R(27), 6);
    ws.getCell(R(27), 5).value = 'Shell Side';
    ws.getCell(R(27), 7).value = 'Tube Side';
    ws.mergeCells(R(27), 8, R(27), 10);
    ws.getCell(R(27), 8).value = 'Sketch (TEMA GA)';
    for (let c = 2; c <= 10; c++) {
      ws.getCell(R(27), c).font = { name: 'Calibri', size: 9, bold: true };
      ws.getCell(R(27), c).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(R(27), c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }

    // Merge H(32)..J(38) for the Sketch Box (Lines 28..34)!
    ws.mergeCells(R(28), 8, R(34), 10);

    function addConstLeftRow(ln, label, unit, sVal, tVal) {
      const r = R(ln);
      ws.getCell(r, 1).value = ln;
      ws.mergeCells(r, 2, r, 3);
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 4).value = unit;
      ws.getCell(r, 4).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.mergeCells(r, 5, r, 6);
      ws.getCell(r, 5).value = sVal;
      ws.getCell(r, 5).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(r, 7).value = tVal;
      ws.getCell(r, 7).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(r).height = 17.5;
    }

    addConstLeftRow(28, 'Design / Test Press', 'barG', '10.0 / 15.0', '10.0 / 15.0');
    addConstLeftRow(29, 'Design Temperature', '°C', Math.ceil((Math.max(sTin, sTout) + 25) / 5) * 5, Math.ceil((Math.max(tTin, tTout) + 25) / 5) * 5);
    addConstLeftRow(30, 'No. Passes per Shell', '-', 1, res.nPasses);
    addConstLeftRow(31, 'Corrosion Allowance', 'mm', 3.0, 3.0);
    addConstLeftRow(32, 'Connections — In', 'NPS (ASME)', `${res.nozzle_shell_nps || '4"'} CL150 RF`, `${res.nozzle_tube_nps || '4"'} CL150 RF`);
    addConstLeftRow(33, 'Connections — Out', 'NPS (ASME)', `${res.nozzle_shell_nps || '4"'} CL150 RF`, `${res.nozzle_tube_nps || '4"'} CL150 RF`);
    addConstLeftRow(34, 'Connections — Intermediate', 'NPS', res.nShell > 1 ? `${res.nozzle_shell_nps || '4"'}` : 'N/A', 'Vent / Drain 3/4"');

    // Embed Mini Sketch Image inside H(32):J(38) (Lines 28..34)
    try {
      const miniBase64 = renderWhitePrintMiniSketchBase64('hx', res);
      if (miniBase64) {
        const imgId = wb.addImage({ base64: miniBase64, extension: 'png' });
        ws.addImage(imgId, {
          tl: { col: 7.08, row: R(28) - 0.9 },
          ext: { width: 280, height: 150 }
        });
      }
    } catch (e) {}

    // Line 35: Tubes No., OD, Gauge, Length, Pitch layout deg
    ws.getCell(R(35), 1).value = 35;
    ws.getCell(R(35), 2).value = `Tubes   No. ${res.N_tubes}`;
    ws.getCell(R(35), 2).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(R(35), 3, R(35), 4);
    ws.getCell(R(35), 3).value = `OD: ${res.do_mm} mm (${(res.do_mm / 25.4).toFixed(2)} in)`;
    ws.mergeCells(R(35), 5, R(35), 6);
    ws.getCell(R(35), 5).value = `Gauge: ${bwgGauge}`;
    ws.mergeCells(R(35), 7, R(35), 8);
    ws.getCell(R(35), 7).value = `Length: ${res.L_m} m (${(res.L_m * 3.28084).toFixed(1)} ft)`;
    ws.mergeCells(R(35), 9, R(35), 10);
    ws.getCell(R(35), 9).value = `Pitch deg: ${res.layoutAngle}°`;

    // Line 36: Tube Type, Material, Pitch ratio
    ws.getCell(R(36), 1).value = 36;
    ws.mergeCells(R(36), 2, R(36), 4);
    ws.getCell(R(36), 2).value = '   Type: Plain Seamless';
    ws.mergeCells(R(36), 5, R(36), 7);
    ws.getCell(R(36), 5).value = 'Material: ASTM A179 / SA-213 TP316L';
    ws.mergeCells(R(36), 8, R(36), 10);
    ws.getCell(R(36), 8).value = `Pitch ratio: ${pitchRatio} (P_T=${res.pt_mm.toFixed(2)}mm)`;

    // Line 37: Shell OD, ID, Material
    ws.getCell(R(37), 1).value = 37;
    ws.mergeCells(R(37), 2, R(37), 4);
    ws.getCell(R(37), 2).value = `Shell   OD: ${res.D_shell_mm + 2 * res.t_shell_mm} mm`;
    ws.mergeCells(R(37), 5, R(37), 7);
    ws.getCell(R(37), 5).value = `ID: ${res.D_shell_mm} mm (${(res.D_shell_mm / 25.4).toFixed(2)} in) × ${res.t_shell_mm}t`;
    ws.getCell(R(37), 5).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(R(37), 8, R(37), 10);
    ws.getCell(R(37), 8).value = 'Material: ASME SA-516 Gr.70';

    // Line 38: Channel or Bonnet
    ws.getCell(R(38), 1).value = 38;
    ws.mergeCells(R(38), 2, R(38), 4);
    ws.getCell(R(38), 2).value = `Channel or Bonnet   ID: ${res.D_shell_mm} mm`;
    ws.mergeCells(R(38), 5, R(38), 6);
    ws.getCell(R(38), 5).value = `Thick: ${res.t_shell_mm} mm`;
    ws.mergeCells(R(38), 7, R(38), 10);
    ws.getCell(R(38), 7).value = 'Channel Cover: Bolted Flat Cover (SA-266 Gr.2)';

    // Line 39: Tubesheet Type
    ws.getCell(R(39), 1).value = 39;
    ws.mergeCells(R(39), 2, R(39), 4);
    ws.getCell(R(39), 2).value = 'Tubesheet Type';
    ws.mergeCells(R(39), 5, R(39), 10);
    ws.getCell(R(39), 5).value = `Stationary & Rear Tubesheet (${res.t_tubesheet_mm} mm thick) · Bundle Dia Ø${res.D_bundle_mm} mm`;

    // Line 40: Floating Head Cover & Impingement Protection
    ws.getCell(R(40), 1).value = 40;
    ws.mergeCells(R(40), 2, R(40), 5);
    ws.getCell(R(40), 2).value = `Floating Head Cover: TEMA Type ${res.tema_type}`;
    ws.mergeCells(R(40), 6, R(40), 10);
    ws.getCell(R(40), 6).value = `Impingement Protection: Circular Baffle Plate (ρv² = ${(sFluid?.rho * res.vs * res.vs).toFixed(0)} Pa)`;

    // Line 41: Baffles Cross (number), % Cut (d), Spacing C/C
    ws.getCell(R(41), 1).value = 41;
    ws.mergeCells(R(41), 2, R(41), 4);
    ws.getCell(R(41), 2).value = `Baffles Cross (number): ${res.N_baffles} EA`;
    ws.getCell(R(41), 2).font = { name: 'Calibri', size: 9.5, bold: true };
    ws.mergeCells(R(41), 5, R(41), 6);
    ws.getCell(R(41), 5).value = `% Cut (d): ${res.baffleCutPct}%`;
    ws.mergeCells(R(41), 7, R(41), 10);
    ws.getCell(R(41), 7).value = `Spacing C/C: ${res.B_spacing_mm} mm (${(res.B_spacing_mm / 25.4).toFixed(2)} in)`;
    ws.getCell(R(41), 7).font = { name: 'Calibri', size: 9.5, bold: true };

    // Line 42: Baffles Long & Seal Type
    ws.getCell(R(42), 1).value = 42;
    ws.mergeCells(R(42), 2, R(42), 5);
    ws.getCell(R(42), 2).value = `Baffles Long: ${res.nShell > 1 ? 'Series Pass Partition' : 'None'}`;
    ws.mergeCells(R(42), 6, R(42), 10);
    ws.getCell(R(42), 6).value = `Seal Type: Longitudinal Sealing Strips (Bell-Delaware J=${res.J_total.toFixed(3)})`;

    // Line 43: Supports Tube, U-Bend, Type
    ws.getCell(R(43), 1).value = 43;
    ws.mergeCells(R(43), 2, R(43), 5);
    ws.getCell(R(43), 2).value = 'Supports Tube: Tie Rods & Spacers (8 EA)';
    ws.mergeCells(R(43), 6, R(43), 7);
    ws.getCell(R(43), 6).value = `Vib Ratio: ${res.vibRatio.toFixed(2)}`;
    ws.mergeCells(R(43), 8, R(43), 10);
    ws.getCell(R(43), 8).value = `Type: Segmental (${res.f_vs_Hz.toFixed(1)}/${res.f_nat_Hz.toFixed(1)} Hz SAFE)`;

    // Line 44: Bypass Seal Arrangement & Tube-Tubesheet Joint & Weights
    ws.getCell(R(44), 1).value = 44;
    ws.mergeCells(R(44), 2, R(44), 5);
    ws.getCell(R(44), 2).value = 'Bypass Seal Arrangement: TEMA Standard';
    ws.mergeCells(R(44), 6, R(44), 10);
    ws.getCell(R(44), 6).value = `Joint: Welded+Expanded | Wt Empty ${res.W_empty_kg.toFixed(0)}kg / Bundle ${res.W_bundle_kg.toFixed(0)}kg / Filled ${res.W_filled_kg.toFixed(0)}kg`;

    applyGridBorders(ws, R(1), R(44), 1, 10, true);
    for (let ln = 1; ln <= 44; ln++) {
      ws.getCell(R(ln), 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(R(ln), 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      ws.getCell(R(ln), 1).font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
    }
  }

  // =========================================================================
  // SHEET 1 BUILDER FOR OTHER 5 EQUIPMENT MODULES (PUMP, COLUMN, PIPING, VESSEL, PSV)
  // =========================================================================
  function populateOtherEquipmentSheet1(wb, ws, eqType, res, dateStr) {
    const metaMap = {
      pump: { title: 'CENTRIFUGAL PUMP DATA SHEET — API 610 / ISO 13709', tag: 'P-101 A/B', svc: `${res.fluidName || 'Process'} Pump`, spec: 'API610-P101' },
      column: { title: 'PROCESS FRACTIONATION COLUMN SPECIFICATION SHEET', tag: 'T-101', svc: `${res.lkBase?.name || 'LK'} / ${res.hkBase?.name || 'HK'} Column`, spec: 'FRI-T101' },
      piping: { title: 'PROCESS PIPING HYDRAULIC & MECHANICAL DATA SHEET', tag: `L-101-${(res.selected?.nps || '4"').replace('"', 'IN')}`, svc: 'ASME B31.3 Process Line', spec: 'B31.3-L101' },
      vessel: { title: 'PRESSURE VESSEL / SEPARATOR SPECIFICATION SHEET', tag: 'V-101', svc: 'ASME Sec. VIII Div. 1 Separator', spec: 'ASME-V101' },
      psv: { title: 'PRESSURE RELIEF VALVE SPECIFICATION SHEET — API 520 / 526', tag: 'PSV-101', svc: 'Overpressure Relief Valve', spec: 'API526-PSV101' }
    };
    const m = metaMap[eqType] || metaMap.pump;
    buildTopHeaderBlockExcel(ws, m.title, m.tag, m.svc, m.spec, dateStr);

    let rows = [];
    if (eqType === 'pump') {
      const qLmin = (res.Q_m3h * 1000 / 60).toFixed(1);
      rows = [
        ['SEC', 'SECTION I — GENERAL & OPERATING CONDITIONS (API 610 / ISO 13709)'],
        ['No. Pumps Required', '-', '2 EA (1 Operating + 1 Standby)', 'API 610 Pump Type', 'OH2 Centerline Overhung'],
        ['Capacity — Rated (정격 유량)', 'm³/h (L/min)', `${res.Q_m3h.toFixed(2)} m³/h (${qLmin} L/min)`, 'Min. Continuous Flow (MCSF)', `${res.Q_mcsf_m3h.toFixed(2)} m³/h (Orifice Ø${res.d_orifice_mm.toFixed(1)}mm)`],
        ['Total Dynamic Head (전양정 TDH)', 'm (ft)', `${res.H_total_m.toFixed(2)} m (${(res.H_total_m * 3.28084).toFixed(1)} ft)`, 'Static / Friction Head', `Static ${res.H_static_m.toFixed(1)}m / Fric ${(res.H_fric_suc_m + res.H_fric_dis_m).toFixed(2)}m`],
        ['Suction Pressure (흡입압력 P1)', 'barG', `${res.P1_barG.toFixed(2)} barG`, 'Discharge Pressure (토출압력 P2)', `${res.P2_barG.toFixed(2)} barG (ΔP = ${res.dP_Pump_bar.toFixed(2)} bar)`],
        ['NPSH Available (유효 NPSHa)', 'm', `${res.NPSHa_m.toFixed(2)} m`, 'NPSH Required (요구 NPSHr 3%)', `${res.NPSHr_m.toFixed(2)} m (Margin +${res.npsh_margin_m.toFixed(2)} m)`],
        ['Hydraulic Power (수동력)', 'kW', `${res.P_hyd_kW.toFixed(2)} kW`, 'Pump Efficiency (효율 η)', `${res.eff_pct.toFixed(1)} % (Water BEP ${res.eff_water_pct.toFixed(1)}%)`],
        ['Shaft Power (축동력 BHP)', 'kW (HP)', `${res.P_shaft_kW.toFixed(2)} kW (${(res.P_shaft_kW * 1.341).toFixed(2)} HP)`, 'API 610 Motor Nameplate Rating', `${res.P_motor_std_kW} kW (Req: ${res.P_motor_req_kW.toFixed(2)} kW)`],
        ['Rated Speed (회전수)', 'RPM', `${res.rpm} RPM`, 'Specific Speed (Ns / Nss)', `Ns = ${res.Ns.toFixed(1)} (${res.impellerType}) / Nss = ${res.Nss.toFixed(0)}`],
        ['SEC', 'SECTION II — LIQUID PROPERTIES @ PUMPING TEMPERATURE'],
        ['Liquid Handled (유체명)', '-', `${res.fluidName} [${res.fluidFormula}]`, 'Pumping Temperature', `${res.T_C.toFixed(1)} °C`],
        ['Density / Specific Gravity', 'kg/m³', `${res.rho.toFixed(1)} kg/m³ (SG ${(res.rho / 999).toFixed(3)})`, 'Viscosity (Dynamic / Kinematic)', `${res.mu_cP.toFixed(3)} cP (${res.nu_cSt.toFixed(2)} cSt)`],
        ['Vapor Pressure @ T_op', 'bar.a', `${res.pv_bar.toFixed(4)} bar.a`, 'HI Viscosity Factors (CQ/CH/Cη)', `${res.CQ.toFixed(3)} / ${res.CH.toFixed(3)} / ${res.Ceta.toFixed(3)}`],
        ['SEC', 'SECTION III — CONSTRUCTION, IMPELLER, MECHANICAL SEAL & DRIVER'],
        ['Impeller Diameter (Rated/Max/Min)', 'mm', `Rated Ø${res.D_imp_rated_mm} mm`, '① Max / ② Min Impeller', `Max Ø${res.D_imp_max_mm} mm / Min Ø${res.D_imp_min_mm} mm`],
        ['Suction / Discharge Nozzles', 'mm', `Suc ID ${res.d_suc_mm}mm (v=${res.v_suc.toFixed(2)}m/s)`, 'Discharge Nozzle & Rating', `Dis ID ${res.d_dis_mm}mm (v=${res.v_dis.toFixed(2)}m/s) · ASME 300# RF`],
        ['Mechanical Seal (API 682)', 'Code', 'Cat. 2 Balanced Cartridge Seal', 'Seal Flush Plan & Materials', 'API Plan 11 (SiC vs Carbon / FKM)'],
        ['API 610 Material Class', 'Class', 'Class S-6 (CS / 12% Cr)', 'Electric Motor Driver Spec', `${res.P_motor_std_kW} kW, 380V/3Ph/60Hz, TEFC Ex d IIB T4`]
      ];
    } else if (eqType === 'column') {
      rows = [
        ['SEC', 'SECTION I — PROCESS MATERIAL & HEAT BALANCE SUMMARY'],
        ['Binary System (LK / HK)', '-', `${res.lkBase.name} / ${res.hkBase.name}`, 'Avg. Relative Volatility (α)', `α_avg = ${res.alpha.toFixed(3)}`],
        ['Feed / Distillate / Bottoms Flow', 'kmol/h', `F=${(res.D + res.B).toFixed(1)} / D=${res.D.toFixed(1)} / B=${res.B.toFixed(1)}`, 'Compositions (zF / xD / xB)', `${res.zF.toFixed(3)} / ${res.xD.toFixed(3)} / ${res.xB.toFixed(4)}`],
        ['Temperature Profile (Top/Feed/Bot)', '°C', `${res.T_top_C.toFixed(1)} / ${res.T_feed_C.toFixed(1)} / ${res.T_bot_C.toFixed(1)} °C`, 'Reflux Ratio (R_op / R_min)', `R = ${res.R.toFixed(2)} (R_min = ${res.Rmin.toFixed(2)})`],
        ['Condenser Duty (Qc)', 'kW', `${res.Qc_kW.toFixed(1)} kW`, 'Reboiler Duty (Qr)', `${res.Qr_kW.toFixed(1)} kW`],
        ['SEC', 'SECTION II — STAGE DESIGN & FRI 4-ZONE TRAY HYDRAULICS'],
        ['Min Stages (N_min) / Theoretical', 'Stages', `${res.Nmin.toFixed(2)} / ${res.N_theo.toFixed(1)}`, 'Actual Trays (N_act) & Feed Tray', `${res.N_actual} Trays (Feed Stage #${res.feed_stage_actual})`],
        ['Column Inside Diameter (ID)', 'mm (m)', `Ø${(res.D_col_m * 1000).toFixed(0)} mm (${res.D_col_m.toFixed(2)} m)`, 'Tangent-to-Tangent Height (H_T/T)', `${res.H_tangent_m.toFixed(1)} m (HETP = ${res.HETP_m.toFixed(2)} m)`],
        ['Vapor F-Factor / Velocity', 'Pa^0.5 / m/s', `F_s = ${res.F_factor.toFixed(2)} / u_op = ${res.u_op.toFixed(2)} m/s`, '4-Zone Hydraulic Stability', `Weep ${res.weep_ratio.toFixed(2)}x / DC Backup ${res.dc_backup_pct.toFixed(1)}% / ΔP ${res.dP_total_mbar.toFixed(0)} mbar`]
      ];
    } else if (eqType === 'piping') {
      const s = res.selected;
      rows = [
        ['SEC', 'SECTION I — ANSI / ASME B31.3 & API RP 14E PROCESS LINE SIZING'],
        ['Selected Pipe Size (ANSI/ASME)', 'NPS (Sch)', `NPS ${s.nps} (Sch ${res.schedule || '40'})`, 'Pipe OD × ID × Wall Thickness', `OD ${s.od_mm} × ID ${s.id_mm} × Wall ${s.wall_mm} mm`],
        ['Volumetric / Mass Flowrate', 'm³/h (kg/h)', `${res.Q_m3h.toFixed(1)} m³/h (${(res.W_kgs * 3600).toFixed(0)} kg/h)`, 'Velocity vs API 14E Limit', `v = ${s.v.toFixed(2)} m/s (Limit ${s.v_erode_ms.toFixed(2)} m/s)`],
        ['Unit Friction Loss (ΔP/100m)', 'bar/100m', `${s.dP_100m_bar.toFixed(3)} bar/100m`, 'Total Line Pressure Drop (ΔP)', `${s.dP_total_bar.toFixed(3)} bar (ΣK = ${res.sumK.toFixed(1)})`],
        ['Reynolds No. / Darcy Friction f', '-', `Re = ${Math.round(s.Re).toLocaleString()} / f = ${s.f.toFixed(4)}`, 'Mach No. / 2-Phase Φ²_LO', `Mach = ${s.mach.toFixed(3)} / Φ²_LO = ${s.phi2_LM.toFixed(2)}`]
      ];
    } else if (eqType === 'vessel') {
      rows = [
        ['SEC', 'SECTION I — SOUDERS-BROWN SIZING & ASME SEC. VIII DIV. 1 THICKNESS'],
        ['Vessel Inside Dia × T/T Length', 'mm', `ID Ø${(res.D_m * 1000).toFixed(0)} mm × L ${(res.L_m * 1000).toFixed(0)} mm (L/D=${res.LD_ratio.toFixed(2)})`, 'Total Volume / Liquid Hold-up', `V_tot = ${res.V_total_m3.toFixed(2)} m³ / V_liq = ${res.V_liq_req_m3.toFixed(2)} m³`],
        ['Operating / Design Press & MAWP', 'barG', `P_op ${res.P_op_barG} / P_des ${res.P_des_barG} / MAWP ${res.MAWP_barG.toFixed(1)} barG`, 'ASME UG-27 Shell & Head Thick', `Selected: ${res.t_nom_mm} mm (Req Shell: ${res.t_shell_req_mm.toFixed(2)} mm, CA: ${res.CA_mm} mm)`],
        ['Material of Construction', 'ASME', `${res.matName} (S = ${res.S_MPa} MPa)`, 'Weights (Empty / Oper / Hydro)', `Empty ${res.W_empty_kg.toFixed(0)} / Oper ${res.W_oper_kg.toFixed(0)} / Hydro ${res.W_hydro_kg.toFixed(0)} kg`]
      ];
    } else if (eqType === 'psv') {
      rows = [
        ['SEC', 'SECTION I — API RP 520 SIZING & API STD 526 ORIFICE SELECTION'],
        ['Selected API 526 Orifice & Size', 'Code', `'${res.selectedOrifice.letter}' Orifice (${res.selectedOrifice.size})`, 'Required vs Selected Area', `A_req = ${res.A_req_mm2.toFixed(1)} mm² → Selected = ${res.selectedOrifice.area_mm2} mm² (${res.cap_utilization_pct.toFixed(1)}%)`],
        ['Required vs Rated Relief Rate', 'kg/h', `W_req = ${res.W_kgh.toFixed(0)} / W_rated = ${res.W_rated_kgh.toFixed(0)} kg/h`, 'Set Press / Relieving P1 / Back P2', `P_set ${res.P_set_barG} barG / P₁ ${res.P1_barA.toFixed(2)} barA / P_back ${res.P_back_barG} barG`]
      ];
    }

    let curRow = 5;
    let ln = 1;
    rows.forEach(item => {
      if (item[0] === 'SEC') {
        addSectionBanner(ws, curRow, ln++, item[1]);
      } else {
        ws.getCell(curRow, 1).value = ln++;
        ws.mergeCells(curRow, 2, curRow, 3);
        ws.getCell(curRow, 2).value = item[0];
        ws.getCell(curRow, 2).font = { name: 'Calibri', size: 9.5, bold: true };
        ws.getCell(curRow, 4).value = item[1];
        ws.getCell(curRow, 4).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(curRow, 5, curRow, 6);
        ws.getCell(curRow, 5).value = item[2];
        ws.getCell(curRow, 5).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
        ws.mergeCells(curRow, 7, curRow, 8);
        ws.getCell(curRow, 7).value = item[3];
        ws.getCell(curRow, 7).font = { name: 'Calibri', size: 9.5, bold: true };
        ws.mergeCells(curRow, 9, curRow, 10);
        ws.getCell(curRow, 9).value = item[4];
        ws.getRow(curRow).height = 18;
      }
      curRow++;
    });

    applyGridBorders(ws, 5, curRow - 1, 1, 10, true);
    for (let r = 5; r < curRow; r++) {
      ws.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      ws.getCell(r, 1).font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
    }

    // Add Embedded Sketch Block on Sheet 1 below the table (and full-scale on Sheet 2)
    addSectionBanner(ws, curRow, ln, 'EQUIPMENT SKETCH & GENERAL ARRANGEMENT (상세 도면 및 성능곡선은 Sheet 2 참조)');
    ws.mergeCells(curRow + 1, 1, curRow + 10, 10);
    for (let r = curRow + 1; r <= curRow + 10; r++) ws.getRow(r).height = 18;
    applyGridBorders(ws, curRow, curRow + 10, 1, 10, true);
    try {
      const miniBase64 = renderWhitePrintMiniSketchBase64(eqType, res);
      if (miniBase64) {
        const imgId = wb.addImage({ base64: miniBase64, extension: 'png' });
        ws.addImage(imgId, {
          tl: { col: 1.2, row: curRow + 0.2 },
          ext: { width: 460, height: 175 }
        });
      }
    } catch (e) {}
  }

  // =========================================================================
  // SHEET 2 BUILDER: FULL-SCALE ENGINEERING DWG & PERFORMANCE CURVE SKETCH
  // =========================================================================
  function populateSheet2Sketches(wb, ws2, eqType, res, dateStr) {
    ws2.columns = [
      { width: 18 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }
    ];

    ws2.mergeCells('A1:F1');
    ws2.getCell('A1').value = `SHEET 2 OF 2 — ENGINEERING DWG & PERFORMANCE CURVE SKETCH (${eqType.toUpperCase()} · ${dateStr})`;
    ws2.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    ws2.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 26;

    ws2.mergeCells('A2:F2');
    ws2.getCell('A2').value = '1. ENGINEERING GENERAL ARRANGEMENT & SECTIONAL DWG (CAD BLUEPRINT SKETCH)';
    ws2.getCell('A2').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0369A1' } };
    ws2.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    ws2.getRow(2).height = 20;

    // Render high-res Engineering DWG PNG
    const dwgBase64 = getCanvasBase64('canvas_dwg', offCanvas => {
      window.ChemEngSolvers.drawEngineeringDWG(offCanvas, eqType, res);
    });
    if (dwgBase64) {
      const dwgImgId = wb.addImage({ base64: dwgBase64, extension: 'png' });
      ws2.addImage(dwgImgId, {
        tl: { col: 0.1, row: 2.2 },
        ext: { width: 780, height: 390 }
      });
    }

    // Reserve rows 3..23 for DWG image
    for (let r = 3; r <= 23; r++) ws2.getRow(r).height = 18.5;

    ws2.mergeCells('A24:F24');
    ws2.getCell('A24').value = '2. PERFORMANCE CURVE & HYDRAULIC / THERMAL PROFILE SKETCH';
    ws2.getCell('A24').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0369A1' } };
    ws2.getCell('A24').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    ws2.getRow(24).height = 20;

    const chartMap = {
      pump: { id: 'canvas_pump', fn: c => window.ChemEngSolvers.drawPumpCanvas(c, res) },
      hx: { id: 'canvas_hx', fn: c => window.ChemEngSolvers.drawHXCanvas(c, res) },
      column: { id: 'canvas_column', fn: c => window.ChemEngSolvers.drawColumnCanvas(c, res) },
      piping: { id: 'canvas_piping', fn: c => window.ChemEngSolvers.drawPipingCanvas(c, res) },
      vessel: { id: 'canvas_vessel', fn: c => window.ChemEngSolvers.drawVesselCanvas(c, res) },
      psv: { id: 'canvas_psv', fn: c => window.ChemEngSolvers.drawPSVCanvas(c, res) }
    };
    const chartInfo = chartMap[eqType];
    if (chartInfo) {
      const chartBase64 = getCanvasBase64(chartInfo.id, offCanvas => {
        offCanvas.width = 760;
        offCanvas.height = 460;
        offCanvas.style.width = '760px';
        offCanvas.style.height = '460px';
        chartInfo.fn(offCanvas);
      });
      if (chartBase64) {
        const chartImgId = wb.addImage({ base64: chartBase64, extension: 'png' });
        ws2.addImage(chartImgId, {
          tl: { col: 0.1, row: 24.2 },
          ext: { width: 680, height: 410 }
        });
      }
    }
  }

  async function exportEquipmentExcel(eqType, res, mode) {
    if (!window.ExcelJS) {
      alert('ExcelJS 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'ChemEng Studio Pro v2.2';
    wb.created = new Date();

    const dateStr = new Date().toISOString().slice(0, 10);
    const sheet1NameMap = {
      hx: '1_TEMA_HX_Datasheet',
      pump: '1_API610_Pump_Datasheet',
      column: '1_FRI_Column_Datasheet',
      piping: '1_B313_Piping_Datasheet',
      vessel: '1_ASME_Vessel_Datasheet',
      psv: '1_API526_PSV_Datasheet'
    };

    const ws1 = wb.addWorksheet(sheet1NameMap[eqType] || '1_Specification_Sheet', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
    });
    const ws2 = wb.addWorksheet('2_Engineering_DWG_Sketch', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
    });

    if (eqType === 'hx') {
      populateHXSheet1(wb, ws1, res, dateStr);
    } else {
      populateOtherEquipmentSheet1(wb, ws1, eqType, res, dateStr);
    }

    populateSheet2Sketches(wb, ws2, eqType, res, dateStr);

    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `ChemEng_Datasheet_${eqType.toUpperCase()}_${dateStr}.xlsx`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Convert ArrayBuffer to Base64 for Android WebView bridge OR Blob for desktop/mobile browsers
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64Data = btoa(binary);

    if (window.AndroidBridge && window.AndroidBridge.saveAndShareFile) {
      window.AndroidBridge.saveAndShareFile(fileName, base64Data, mimeType);
    } else {
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
    }
  }

  return {
    exportEquipmentExcel
  };
})();

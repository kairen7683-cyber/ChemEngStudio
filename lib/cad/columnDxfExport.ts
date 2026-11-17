/**
 * Precision 1:1 Millimeter AutoCAD DXF Generator for Trayed & Packed Distillation Columns
 * - Generates valid AC1009 (R12/R2000) ASCII DXF with multi-layer geometry
 * - GA Elevation is drawn in true 1:1 millimeter coordinates (Y = EL +xxxx mm from Base Ring EL 0)
 * - Strictly distinguishes Trayed Internals (Trays, Alternating Downcomers, Weirs, 1/2/4-Pass Plan)
 *   vs Packed Internals (Cross-Hatched Beds, Support Plates, Hold-Down Grids, Chimney Redistributors, Liquid Distributor)
 */

import type {
  ColumnInternalsSolveResult,
  SectionGeometrySummary,
} from '@/lib/calculations/columnInternalsDesign';
import type {
  DistillColumnParams,
  DistillSolveResult,
} from '@/lib/calculations/rigorousDistillation';

export interface ColumnCadExportParams {
  unitTag: string;
  unitLabel: string;
  colConfig: DistillColumnParams;
  simResult: DistillSolveResult;
  design: ColumnInternalsSolveResult;
}

function asciiSafe(raw: string): string {
  return String(raw ?? '')
    .replace(/Ø/g, 'DIA ')
    .replace(/Δ/g, 'd')
    .replace(/×/g, 'x')
    .replace(/°/g, ' deg')
    .replace(/±/g, '+/-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/↔/g, '<->')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmt(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toFixed(2);
}

function pickDetailLabel(sec: SectionGeometrySummary, isTray: boolean): string {
  if (isTray) {
    return `${sec.flowPasses}-PASS | SP=${Math.round(sec.sectionHeightM * 1000)}mm`;
  }
  return `${sec.actualTraysOrBeds} BED(S) | HETP=${Math.round(sec.hetpAvgM * 1000)}mm`;
}

export function buildColumnCadDxf(params: ColumnCadExportParams): string {
  const { unitTag, unitLabel, colConfig, simResult, design } = params;
  const isTray = design.internalsKind === 'tray';
  const el = design.elevations;
  const mech = design.mechanical;

  const rectIdMm = Math.round(design.rectifying.selectedNominalDiamM * 1000);
  const stripIdMm = Math.round(design.stripping.selectedNominalDiamM * 1000);
  const govIdMm = Math.max(rectIdMm, stripIdMm);
  const wallT = Math.max(6, Math.round(design.shellWallThicknessMm));
  const skirtT = Math.max(8, Math.round(mech.skirtThicknessMm || wallT));

  // Drawing canvas metrics in true mm (GA Elevation at 1:1 mm on left; Detail & Schedules scaled proportionally on right)
  const totalH = Math.max(6000, el.oalElMm);
  const scaleFactor = totalH / 20000.0; // Normalizes right-hand details cleanly relative to tower height
  const padX = Math.max(3500, govIdMm * 2.4);
  const colCx = padX + Math.max(4200, govIdMm * 1.4);

  const rightStartX = colCx + Math.max(5500, govIdMm * 2.8);
  const detailColW = Math.max(9500, Math.round(11500 * scaleFactor));
  const sheetLeft = -Math.max(1200, Math.round(1400 * scaleFactor));
  const sheetBottom = -Math.max(2400, Math.round(2800 * scaleFactor));
  const sheetRight = rightStartX + detailColW + Math.max(1800, Math.round(2200 * scaleFactor));
  const sheetTop = totalH + Math.max(2600, Math.round(3200 * scaleFactor));

  const lines: string[] = [];
  const add = (code: number, val: string | number) => {
    lines.push(String(code), String(val));
  };

  // ── HEADER ──
  add(0, 'SECTION');
  add(2, 'HEADER');
  add(9, '$ACADVER');
  add(1, 'AC1009');
  add(9, '$INSUNITS');
  add(70, 4); // Millimeters
  add(9, '$EXTMIN');
  add(10, fmt(sheetLeft));
  add(20, fmt(sheetBottom));
  add(30, '0.00');
  add(9, '$EXTMAX');
  add(10, fmt(sheetRight));
  add(20, fmt(sheetTop));
  add(30, '0.00');
  add(0, 'ENDSEC');

  // ── TABLES (Layers) ──
  const layers: Array<{ name: string; color: number }> = [
    { name: 'BORDER', color: 7 },
    { name: 'TITLEBLOCK', color: 4 },
    { name: 'CENTER', color: 2 },
    { name: 'SHELL', color: 7 },
    { name: 'SKIRT', color: 8 },
    { name: 'NOZZLE', color: 3 },
    { name: 'INTERNAL_TRAY', color: 4 },
    { name: 'INTERNAL_PACKING', color: 3 },
    { name: 'HARDWARE', color: 6 },
    { name: 'LIQ_LEVEL', color: 5 },
    { name: 'DIM', color: 1 },
    { name: 'ELEV', color: 2 },
    { name: 'TEXT', color: 7 },
  ];

  add(0, 'SECTION');
  add(2, 'TABLES');
  add(0, 'TABLE');
  add(2, 'LAYER');
  add(70, layers.length);
  for (const lyr of layers) {
    add(0, 'LAYER');
    add(2, lyr.name);
    add(70, 0);
    add(62, lyr.color);
    add(6, 'CONTINUOUS');
  }
  add(0, 'ENDTAB');
  add(0, 'ENDSEC');

  // ── ENTITIES HELPERS ──
  add(0, 'SECTION');
  add(2, 'ENTITIES');

  const dxfLine = (x1: number, y1: number, x2: number, y2: number, layer = 'SHELL') => {
    add(0, 'LINE');
    add(8, layer);
    add(10, fmt(x1));
    add(20, fmt(y1));
    add(30, '0.00');
    add(11, fmt(x2));
    add(21, fmt(y2));
    add(31, '0.00');
  };

  const dxfRect = (x: number, y: number, w: number, h: number, layer = 'SHELL') => {
    dxfLine(x, y, x + w, y, layer);
    dxfLine(x + w, y, x + w, y + h, layer);
    dxfLine(x + w, y + h, x, y + h, layer);
    dxfLine(x, y + h, x, y, layer);
  };

  const dxfCircle = (cx: number, cy: number, r: number, layer = 'SHELL') => {
    add(0, 'CIRCLE');
    add(8, layer);
    add(10, fmt(cx));
    add(20, fmt(cy));
    add(30, '0.00');
    add(40, fmt(Math.max(1, r)));
  };

  const dxfEllipHead = (cx: number, yTan: number, idMm: number, dir: 1 | -1, layer = 'SHELL') => {
    const rx = idMm / 2.0;
    const ry = idMm / 4.0; // ASME 2:1 Semi-Ellipsoidal Head
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI;
      const t1 = ((i + 1) / segs) * Math.PI;
      const x0 = cx - rx * Math.cos(t0);
      const y0 = yTan + dir * ry * Math.sin(t0);
      const x1 = cx - rx * Math.cos(t1);
      const y1 = yTan + dir * ry * Math.sin(t1);
      dxfLine(x0, y0, x1, y1, layer);
    }
    // Outer wall head profile
    const rxO = rx + wallT;
    const ryO = ry + wallT;
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI;
      const t1 = ((i + 1) / segs) * Math.PI;
      const x0 = cx - rxO * Math.cos(t0);
      const y0 = yTan + dir * ryO * Math.sin(t0);
      const x1 = cx - rxO * Math.cos(t1);
      const y1 = yTan + dir * ryO * Math.sin(t1);
      dxfLine(x0, y0, x1, y1, layer);
    }
  };

  const dxfText = (x: number, y: number, h: number, txt: string, layer = 'TEXT') => {
    const clean = asciiSafe(txt);
    if (!clean) return;
    add(0, 'TEXT');
    add(8, layer);
    add(10, fmt(x));
    add(20, fmt(y));
    add(30, '0.00');
    add(40, fmt(Math.max(12, h)));
    add(1, clean);
  };

  const txtH = Math.max(150, Math.round(210 * scaleFactor));
  const smH = Math.max(115, Math.round(155 * scaleFactor));

  // ── 1. DRAWING BORDER & SHEET HEADER ──
  const sheetW = sheetRight - sheetLeft;
  const sheetH = sheetTop - sheetBottom;
  const margin = Math.max(250, Math.round(300 * scaleFactor));
  dxfRect(sheetLeft, sheetBottom, sheetW, sheetH, 'BORDER');
  dxfRect(sheetLeft + margin, sheetBottom + margin, sheetW - 2 * margin, sheetH - 2 * margin, 'BORDER');

  dxfText(
    sheetLeft + margin + 400,
    sheetTop - margin - txtH * 2.2,
    txtH * 1.45,
    `CHEMENG STUDIO EPC CAD - [${unitTag}] ${isTray ? 'TRAYED' : 'PACKED'} COLUMN GA & INTERNALS DRAWING (UNIT: MM)`,
    'TITLEBLOCK'
  );
  dxfText(
    sheetLeft + margin + 400,
    sheetTop - margin - txtH * 4.0,
    smH * 1.05,
    `${unitLabel} | SHELL: ${design.recommendedMaterialCode} (${wallT}mmt) | DES.P=${design.designPressBarG.toFixed(1)} barG / DES.T=${design.designTempC.toFixed(0)} C | H_TT=${Math.round(design.tangentToTangentHeightM * 1000)}mm`,
    'TEXT'
  );

  // ── 2. LEFT HALF: TRUE 1:1 MM GENERAL ARRANGEMENT (GA) ELEVATION ──
  const rStrip = stripIdMm / 2.0;
  const rRect = rectIdMm / 2.0;

  // Grade / Foundation Line (EL +0)
  dxfLine(colCx - govIdMm * 1.15, 0, colCx + govIdMm * 1.15, 0, 'SKIRT');
  // Base Ring & Anchor Chair
  dxfRect(colCx - rStrip - skirtT - 120, 0, stripIdMm + 2 * skirtT + 240, 80, 'SKIRT');
  // Support Skirt (EL 0 -> B.T.L.)
  dxfLine(colCx - rStrip, 0, colCx - rStrip, el.btlElMm, 'SKIRT');
  dxfLine(colCx + rStrip, 0, colCx + rStrip, el.btlElMm, 'SKIRT');
  dxfLine(colCx - rStrip - skirtT, 0, colCx - rStrip - skirtT, el.btlElMm, 'SKIRT');
  dxfLine(colCx + rStrip + skirtT, 0, colCx + rStrip + skirtT, el.btlElMm, 'SKIRT');

  // Column Centerline
  dxfLine(colCx, -Math.round(600 * scaleFactor), colCx, el.oalElMm + Math.round(500 * scaleFactor), 'CENTER');

  // Vessel Cylindrical Shell (Uniform vs Swaged)
  const isSwaged = design.shellSectionMode === 'swaged' && Math.abs(rectIdMm - stripIdMm) >= 80;
  if (isSwaged) {
    // Stripping shell: B.T.L. -> stripTopElMm
    dxfLine(colCx - rStrip, el.btlElMm, colCx - rStrip, el.stripTopElMm, 'SHELL');
    dxfLine(colCx + rStrip, el.btlElMm, colCx + rStrip, el.stripTopElMm, 'SHELL');
    dxfLine(colCx - rStrip - wallT, el.btlElMm, colCx - rStrip - wallT, el.stripTopElMm, 'SHELL');
    dxfLine(colCx + rStrip + wallT, el.btlElMm, colCx + rStrip + wallT, el.stripTopElMm, 'SHELL');
    // Conical transition cone: stripTopElMm -> rectBotElMm
    dxfLine(colCx - rStrip, el.stripTopElMm, colCx - rRect, el.rectBotElMm, 'SHELL');
    dxfLine(colCx + rStrip, el.stripTopElMm, colCx + rRect, el.rectBotElMm, 'SHELL');
    dxfLine(colCx - rStrip - wallT, el.stripTopElMm, colCx - rRect - wallT, el.rectBotElMm, 'SHELL');
    dxfLine(colCx + rStrip + wallT, el.stripTopElMm, colCx + rRect + wallT, el.rectBotElMm, 'SHELL');
    // Rectifying shell: rectBotElMm -> T.T.L.
    dxfLine(colCx - rRect, el.rectBotElMm, colCx - rRect, el.ttlElMm, 'SHELL');
    dxfLine(colCx + rRect, el.rectBotElMm, colCx + rRect, el.ttlElMm, 'SHELL');
    dxfLine(colCx - rRect - wallT, el.rectBotElMm, colCx - rRect - wallT, el.ttlElMm, 'SHELL');
    dxfLine(colCx + rRect + wallT, el.rectBotElMm, colCx + rRect + wallT, el.ttlElMm, 'SHELL');
  } else {
    dxfLine(colCx - rRect, el.btlElMm, colCx - rRect, el.ttlElMm, 'SHELL');
    dxfLine(colCx + rRect, el.btlElMm, colCx + rRect, el.ttlElMm, 'SHELL');
    dxfLine(colCx - rRect - wallT, el.btlElMm, colCx - rRect - wallT, el.ttlElMm, 'SHELL');
    dxfLine(colCx + rRect + wallT, el.btlElMm, colCx + rRect + wallT, el.ttlElMm, 'SHELL');
  }

  // 2:1 Semi-Ellipsoidal Heads & Tangent Lines
  dxfEllipHead(colCx, el.ttlElMm, rectIdMm, 1, 'SHELL');
  dxfEllipHead(colCx, el.btlElMm, stripIdMm, -1, 'SHELL');
  dxfLine(colCx - rRect - 160, el.ttlElMm, colCx + rRect + 160, el.ttlElMm, 'ELEV');
  dxfLine(colCx - rStrip - 160, el.btlElMm, colCx + rStrip + 160, el.btlElMm, 'ELEV');

  // Vacuum Stiffener Rings (if required)
  if (design.vacuumStiffenerRequired && mech.stiffenerCount > 0) {
    const step = (el.ttlElMm - el.btlElMm) / (mech.stiffenerCount + 1);
    for (let s = 1; s <= mech.stiffenerCount; s++) {
      const sy = el.btlElMm + s * step;
      const rCur = sy >= el.rectBotElMm ? rRect : rStrip;
      dxfRect(colCx - rCur - wallT - 90, sy - 20, 90, 40, 'HARDWARE');
      dxfRect(colCx + rCur + wallT, sy - 20, 90, 40, 'HARDWARE');
    }
  }

  // Sump Liquid Levels (LLL / NLL / HLL)
  const drawLevelLine = (y: number, label: string) => {
    dxfLine(colCx - rStrip + 30, y, colCx + rStrip - 30, y, 'LIQ_LEVEL');
    dxfText(colCx - rStrip + 60, y + 35, smH * 0.72, `${label} EL +${y}`, 'LIQ_LEVEL');
  };
  drawLevelLine(el.hllElMm, 'HLL');
  drawLevelLine(el.nllElMm, 'NLL');
  drawLevelLine(el.lllElMm, 'LLL');

  // Internals inside GA Elevation
  if (isTray) {
    const drawTrayStack = (
      botEl: number,
      topEl: number,
      nTrays: number,
      rHalf: number,
      sec: SectionGeometrySummary,
      startNum: number
    ) => {
      const count = Math.max(1, nTrays);
      const span = Math.max(200, topEl - botEl);
      const dcW = Math.min(rHalf * 0.42, Math.max(120, sec.dcWidthTopMm));
      const hwDraw = Math.min(span / Math.max(1, count) * 0.28, Math.max(40, sec.weirHeightMm));
      for (let i = 0; i < count; i++) {
        const y = count === 1 ? (botEl + topEl) * 0.5 : topEl - i * (span / (count - 1));
        const dcLeft = (i % 2) === 0;
        const xStart = dcLeft ? colCx - rHalf + dcW : colCx - rHalf + 15;
        const xEnd = dcLeft ? colCx + rHalf - 15 : colCx + rHalf - dcW;
        dxfLine(xStart, y, xEnd, y, 'INTERNAL_TRAY');
        // Weir & Downcomer Apron
        const weirX = dcLeft ? xEnd : xStart;
        dxfLine(weirX, y, weirX, y + hwDraw, 'INTERNAL_TRAY');
        if (i < count - 1) {
          const dropY = y - (span / Math.max(1, count - 1)) + Math.max(25, sec.dcClearanceMm);
          dxfLine(weirX, y, weirX, dropY, 'INTERNAL_TRAY');
        }
        if (i === 0 || i === count - 1) {
          dxfText(colCx + rHalf + wallT + 140, y - smH * 0.3, smH * 0.7, `TRAY #${startNum + i}`, 'INTERNAL_TRAY');
        }
      }
    };
    const rectCount = Math.max(1, design.rectifying.actualTraysOrBeds);
    const stripCount = Math.max(1, design.stripping.actualTraysOrBeds);
    drawTrayStack(el.rectBotElMm, el.rectTopElMm, rectCount, rRect, design.rectifying, 1);
    drawTrayStack(el.stripBotElMm, el.stripTopElMm, stripCount, rStrip, design.stripping, rectCount + 1);
  } else {
    // Packed Beds + Support Plate + Hold-Down Grid + Redistributors + Top Distributor + Demister
    const hw = design.packingHardware;
    for (const bed of design.packedBeds) {
      const rB = bed.section === 'rectifying' ? rRect : rStrip;
      const xL = colCx - rB + 25;
      const xR = colCx + rB - 25;
      const wB = xR - xL;
      const hB = Math.max(120, bed.topElMm - bed.botElMm);
      dxfRect(xL, bed.botElMm, wB, hB, 'INTERNAL_PACKING');
      // Diagonal Cross-Hatching inside packed bed
      dxfLine(xL, bed.botElMm, xR, bed.topElMm, 'INTERNAL_PACKING');
      dxfLine(xL, bed.topElMm, xR, bed.botElMm, 'INTERNAL_PACKING');
      const nDiag = Math.max(2, Math.floor(hB / Math.max(350, wB * 0.65)));
      for (let d = 1; d < nDiag; d++) {
        const yy = bed.botElMm + (d * hB) / nDiag;
        dxfLine(xL, yy, xR, Math.min(bed.topElMm, yy + hB / nDiag), 'INTERNAL_PACKING');
        dxfLine(xR, yy, xL, Math.min(bed.topElMm, yy + hB / nDiag), 'INTERNAL_PACKING');
      }
      // Support Plate (at botElMm) & Hold-down Grid (at topElMm)
      dxfRect(xL - 10, bed.botElMm - 60, wB + 20, 60, 'HARDWARE');
      dxfLine(xL - 10, bed.topElMm + 25, xR + 10, bed.topElMm + 25, 'HARDWARE');
      dxfText(
        colCx - wB * 0.42,
        (bed.botElMm + bed.topElMm) * 0.5,
        smH * 0.8,
        `BED #${bed.bedNumber} H=${bed.bedHeightMm}mm`,
        'TEXT'
      );
    }
    // Primary Liquid Distributor LD-1
    dxfRect(colCx - rRect + 80, hw.topDistributor.elevationMm - 45, rectIdMm - 160, 90, 'HARDWARE');
    dxfText(
      colCx + rRect + wallT + 140,
      hw.topDistributor.elevationMm - smH * 0.3,
      smH * 0.72,
      `${hw.topDistributor.tag} DISTRIBUTOR (${hw.topDistributor.dripPointsPerM2} pts/m^2)`,
      'HARDWARE'
    );
    // Intermediate Chimney Collectors & Liquid Redistributors RD-1..
    for (const rd of hw.redistributors.items) {
      dxfRect(colCx - rRect + 70, rd.elevationMm - 55, rectIdMm - 140, 110, 'HARDWARE');
      dxfLine(colCx - rRect * 0.6, rd.elevationMm + 55, colCx - rRect * 0.6, rd.elevationMm + 155, 'HARDWARE');
      dxfLine(colCx + rRect * 0.6, rd.elevationMm + 55, colCx + rRect * 0.6, rd.elevationMm + 155, 'HARDWARE');
      dxfText(
        colCx + rRect + wallT + 140,
        rd.elevationMm - smH * 0.3,
        smH * 0.72,
        `${rd.tag} CHIMNEY REDISTRIBUTOR`,
        'HARDWARE'
      );
    }
    // Demister Pad ME-1
    dxfRect(colCx - rRect + 100, hw.demister.elevationMm - 75, rectIdMm - 200, 150, 'HARDWARE');
    dxfText(
      colCx + rRect + wallT + 140,
      hw.demister.elevationMm - smH * 0.3,
      smH * 0.72,
      `${hw.demister.tag} DEMISTER PAD (150mmt)`,
      'HARDWARE'
    );
  }

  // Side-Cut Chimney Draw-Off Collector (if active)
  if (design.sideCutSummary) {
    const scEl = design.sideCutSummary.elevationMm;
    const rSc = scEl >= el.rectBotElMm ? rRect : rStrip;
    const xL = colCx - rSc + 40;
    const xR = colCx + rSc - 40;
    const wSc = xR - xL;
    dxfRect(xL, scEl - 45, wSc, 90, 'HARDWARE');
    dxfRect(colCx + rSc * 0.25, scEl - 140, rSc * 0.65, 95, 'HARDWARE');
    dxfLine(colCx - rSc * 0.45, scEl + 45, colCx - rSc * 0.45, scEl + 185, 'HARDWARE');
    dxfLine(colCx - rSc * 0.45 - 60, scEl + 195, colCx - rSc * 0.45 + 60, scEl + 195, 'HARDWARE');
    dxfLine(colCx + rSc * 0.05, scEl + 45, colCx + rSc * 0.05, scEl + 185, 'HARDWARE');
    dxfLine(colCx + rSc * 0.05 - 60, scEl + 195, colCx + rSc * 0.05 + 60, scEl + 195, 'HARDWARE');
    dxfText(
      colCx - wSc * 0.42,
      scEl + 230,
      smH * 0.68,
      `CHIMNEY DRAW-OFF (STG #${design.sideCutSummary.stage})`,
      'HARDWARE'
    );
  }

  // Nozzles N1..N6 at EXACT elevationMm & Orientation
  for (const nz of design.nozzles) {
    const isTopArea = nz.elevationMm >= el.rectBotElMm;
    const rCur = isTopArea ? rRect : rStrip;
    const neckLen = Math.max(250, Math.round(0.22 * govIdMm));
    const boreMm = Math.max(80, Math.min(450, Math.round(nz.calcIdMm)));
    if (nz.nozzleTag === 'N1') {
      const yBase = el.ttlElMm + Math.round(rRect * 0.5);
      dxfRect(colCx - boreMm / 2, yBase, boreMm, neckLen, 'NOZZLE');
      dxfLine(colCx - boreMm * 0.85, yBase + neckLen, colCx + boreMm * 0.85, yBase + neckLen, 'NOZZLE');
      dxfText(colCx + boreMm + 120, yBase + neckLen - smH * 0.4, smH * 0.8, `${nz.nozzleTag} ${nz.selectedDn} @ EL +${nz.elevationMm}`, 'NOZZLE');
    } else if (nz.nozzleTag === 'N4') {
      const yTop = el.btlElMm - Math.round(rStrip * 0.5);
      dxfRect(colCx - boreMm / 2, yTop - neckLen, boreMm, neckLen, 'NOZZLE');
      dxfLine(colCx - boreMm * 0.85, yTop - neckLen, colCx + boreMm * 0.85, yTop - neckLen, 'NOZZLE');
      dxfText(colCx + boreMm + 120, yTop - neckLen, smH * 0.8, `${nz.nozzleTag} ${nz.selectedDn} @ EL +${nz.elevationMm}`, 'NOZZLE');
    } else if (nz.orientationDeg === 270) {
      const xShell = colCx - rCur - wallT;
      dxfRect(xShell - neckLen, nz.elevationMm - boreMm / 2, neckLen, boreMm, 'NOZZLE');
      dxfLine(xShell - neckLen, nz.elevationMm - boreMm * 0.85, xShell - neckLen, nz.elevationMm + boreMm * 0.85, 'NOZZLE');
      dxfText(xShell - neckLen - Math.max(1600, Math.round(2100 * scaleFactor)), nz.elevationMm + smH * 0.4, smH * 0.8, `${nz.nozzleTag} ${nz.selectedDn} (EL +${nz.elevationMm})`, 'NOZZLE');
    } else {
      const xShell = colCx + rCur + wallT;
      dxfRect(xShell, nz.elevationMm - boreMm / 2, neckLen, boreMm, 'NOZZLE');
      dxfLine(xShell + neckLen, nz.elevationMm - boreMm * 0.85, xShell + neckLen, nz.elevationMm + boreMm * 0.85, 'NOZZLE');
      dxfText(xShell + neckLen + 140, nz.elevationMm - smH * 0.35, smH * 0.8, `${nz.nozzleTag} ${nz.selectedDn} (EL +${nz.elevationMm})`, 'NOZZLE');
    }
  }

  // Manholes M1..M3
  for (const mh of design.manholes) {
    dxfCircle(colCx, mh.elevationMm, 225, 'HARDWARE');
    dxfText(colCx + 270, mh.elevationMm - smH * 0.3, smH * 0.68, `${mh.tag} ${mh.sizeDn}`, 'HARDWARE');
  }

  // ── 3. LEFT ELEVATION DATUM LADDER & RIGHT DIMENSION CHAINS ──
  const elevX = colCx - govIdMm * 0.5 - Math.max(2400, govIdMm * 1.1);
  dxfLine(elevX, 0, elevX, el.ttlElMm, 'ELEV');
  const datumTicks: Array<[string, number]> = [
    ['O.A.L.', el.oalElMm],
    ['T.T.L.', el.ttlElMm],
    ['RECT TOP', el.rectTopElMm],
    ['RECT BOT', el.rectBotElMm],
    ['FEED N3', el.feedNozzleElMm],
    ...(design.sideCutSummary && Math.abs(design.sideCutSummary.elevationMm - el.feedNozzleElMm) >= 450
      ? [['SIDE N7', design.sideCutSummary.elevationMm] as [string, number]]
      : []),
    ['STRIP TOP', el.stripTopElMm],
    ['STRIP BOT', el.stripBotElMm],
    ['HLL', el.hllElMm],
    ['B.T.L.', el.btlElMm],
    ['BASE RING', 0],
  ];
  for (const [tag, y] of datumTicks) {
    dxfLine(elevX - 180, y, colCx - govIdMm * 0.5 - wallT - 80, y, 'ELEV');
    dxfText(elevX - Math.max(1950, Math.round(2300 * scaleFactor)), y + 35, smH * 0.72, `EL +${y} (${tag})`, 'ELEV');
  }

  // Right Vertical Dimension Chains (Overall T/T, Skirt, OAL)
  const dimX1 = colCx + govIdMm * 0.5 + wallT + Math.max(1500, govIdMm * 0.9);
  const dimX2 = dimX1 + Math.max(850, Math.round(950 * scaleFactor));
  const drawVertDim = (x: number, y1: number, y2: number, label: string) => {
    dxfLine(x, y1, x, y2, 'DIM');
    dxfLine(x - 140, y1, x + 140, y1, 'DIM');
    dxfLine(x - 140, y2, x + 140, y2, 'DIM');
    dxfText(x + 90, (y1 + y2) * 0.5, smH * 0.85, label, 'DIM');
  };
  drawVertDim(dimX1, 0, el.btlElMm, `SKIRT=${el.btlElMm}mm`);
  drawVertDim(dimX1, el.btlElMm, el.ttlElMm, `T/T=${el.ttlElMm - el.btlElMm}mm`);
  drawVertDim(dimX2, 0, el.oalElMm, `O.A.L.=${el.oalElMm}mm`);

  // Diameter Horizontal Dimension
  const diamDimY = -Math.round(700 * scaleFactor);
  dxfLine(colCx - rStrip, 0, colCx - rStrip, diamDimY - 120, 'DIM');
  dxfLine(colCx + rStrip, 0, colCx + rStrip, diamDimY - 120, 'DIM');
  dxfLine(colCx - rStrip, diamDimY, colCx + rStrip, diamDimY, 'DIM');
  dxfText(
    colCx - govIdMm * 0.35,
    diamDimY - smH * 1.3,
    smH * 0.9,
    isSwaged ? `ID RECT DIA ${rectIdMm}mm / STRIP DIA ${stripIdMm}mm` : `SHELL ID DIA ${govIdMm}mm (${wallT}mmt)`,
    'DIM'
  );

  // ── 4. RIGHT SIDE: SECTION A-A PLAN VIEW + DETAIL B + SCHEDULES ──
  const boxTopY = totalH - Math.max(700, Math.round(900 * scaleFactor));
  const planBoxH = Math.max(4200, Math.round(sheetH * 0.28));
  const planR = Math.min(Math.round(planBoxH * 0.36), Math.round(detailColW * 0.24));
  const planCx = rightStartX + planR + Math.round(900 * scaleFactor);
  const planCy = boxTopY - Math.round(planBoxH * 0.55);

  dxfText(
    rightStartX,
    boxTopY,
    txtH,
    isTray
      ? `SECTION A-A: ${design.stripping.flowPasses}-PASS TRAY DECK PLAN (${design.trayType.toUpperCase()})`
      : `SECTION A-A: TOP LIQUID DISTRIBUTOR PLAN (${design.packingHardware.topDistributor.tag})`,
    'TITLEBLOCK'
  );
  dxfCircle(planCx, planCy, planR, 'SHELL');
  dxfCircle(planCx, planCy, planR + Math.max(12, wallT * 1.4), 'SHELL');

  if (isTray) {
    const passes = design.stripping.flowPasses;
    const sideW = Math.max(planR * 0.18, planR * (design.stripping.dcWidthTopMm / Math.max(300, stripIdMm)) * 2.0);
    const xL = planCx - planR + sideW;
    const xR = planCx + planR - sideW;
    const chordHL = Math.sqrt(Math.max(100, planR * planR - (planR - sideW) * (planR - sideW)));
    dxfLine(xL, planCy - chordHL, xL, planCy + chordHL, 'INTERNAL_TRAY');
    dxfLine(xR, planCy - chordHL, xR, planCy + chordHL, 'INTERNAL_TRAY');
    if (passes >= 2) {
      const cHalf = Math.max(planR * 0.08, sideW * 0.45);
      dxfLine(planCx - cHalf, planCy - planR * 0.98, planCx - cHalf, planCy + planR * 0.98, 'INTERNAL_TRAY');
      dxfLine(planCx + cHalf, planCy - planR * 0.98, planCx + cHalf, planCy + planR * 0.98, 'INTERNAL_TRAY');
    }
    // Perforations / Valve Symbols inside Active Deck
    const stepP = planR * 0.24;
    for (let gy = -planR * 0.65; gy <= planR * 0.65; gy += stepP) {
      for (let gx = -planR * 0.65; gx <= planR * 0.65; gx += stepP) {
        if (Math.hypot(gx, gy) < planR * 0.72 && Math.abs(gx) < planR - sideW * 1.15) {
          if (passes >= 2 && Math.abs(gx) < planR * 0.12) continue;
          dxfCircle(planCx + gx, planCy + gy, Math.max(25, stepP * 0.14), 'INTERNAL_TRAY');
        }
      }
    }
    const specX = planCx + planR + Math.round(700 * scaleFactor);
    const sec = design.stripping;
    const trayMetaLines = [
      `DESIGN ID: DIA ${govIdMm} mm`,
      `PASSES: ${sec.flowPasses}-PASS | SPACING: ${design.traySpacingMm} mm`,
      `HOLE DIA: ${sec.holeDiameterMm} mm | PITCH: ${sec.holePitchMm} mm`,
      `OPEN AREA: ${sec.openAreaPctOfActive}% Aa (${sec.openAreaPctOfTower}% AT)`,
      `WEIR: h_w=${sec.weirHeightMm} mm | L_w=${sec.weirLengthMm} mm | h_ow=${sec.avgWeirCrestMm} mm`,
      `DOWNCOMER TOP/BOT: ${sec.dcWidthTopMm} / ${sec.dcWidthBotMm} mm (Ad=${sec.dcAreaPctOfTower}%)`,
      `APRON CLEARANCE h_ap: ${sec.dcClearanceMm} mm`,
      `OPER RANGE: ${design.operatingLoadMinPct}% ~ ${design.operatingLoadMaxPct}% (TD ${design.minTurndownRatio}:1)`,
      `MAX FLOOD: ${design.maxFloodPct}% | TOTAL dP: ${design.totalInternalsDpMbar} mbar`,
    ];
    trayMetaLines.forEach((line, idx) => {
      dxfText(specX, boxTopY - Math.round(420 * scaleFactor) - idx * Math.round(smH * 1.55), smH * 0.9, line, 'TEXT');
    });
  } else {
    const hw = design.packingHardware;
    // Narrow-trough distributor bars in Plan View
    const numTroughs = 5;
    for (let i = -2; i <= 2; i++) {
      const ty = planCy + i * (planR * 0.34);
      const halfSpan = Math.sqrt(Math.max(0, planR * planR - (i * planR * 0.34) ** 2)) * 0.9;
      if (halfSpan > 50) {
        dxfRect(planCx - halfSpan, ty - planR * 0.04, halfSpan * 2, planR * 0.08, 'HARDWARE');
      }
    }
    dxfRect(planCx - planR * 0.07, planCy - planR * 0.85, planR * 0.14, planR * 1.7, 'HARDWARE');
    const specX = planCx + planR + Math.round(700 * scaleFactor);
    const pkLines = [
      `PACKING: ${design.packingSpec.key.toUpperCase()} (${design.packingSpec.category.toUpperCase()})`,
      `SIZE: ${design.packingSpec.nominalSizeLabel || '-'}`,
      `a_p=${design.packingSpec.surfaceAreaM2M3} m^2/m^3 | VOID=${(design.packingSpec.voidFraction * 100).toFixed(1)}% | F_p=${design.packingSpec.packingFactorFpM1} 1/m`,
      `TOTAL PACKED H=${Math.round(design.totalPackedHeightM * 1000)} mm (${design.packedBedCount} BEDS)`,
      `HETP: RECT=${design.rectifying.hetpAvgM}m | STRIP=${design.stripping.hetpAvgM}m`,
      `TOP DIST (${hw.topDistributor.tag}): ${hw.topDistributor.dripPointsPerM2} pts/m^2 (${hw.topDistributor.totalDripPoints} pts)`,
      `REDISTRIBUTORS: ${hw.redistributors.count} EA | SUPPORT PLATES: ${hw.supportPlates.count} EA (${hw.supportPlates.freeAreaPct}% open)`,
      `HOLD-DOWN GRIDS: ${hw.holdDownGrids.count} EA | DEMISTER ${hw.demister.tag}: ${hw.demister.thicknessMm}mmt`,
      `OPER RANGE: ${design.operatingLoadMinPct}% ~ ${design.operatingLoadMaxPct}% | FLOOD=${design.maxFloodPct}% | dP=${design.totalInternalsDpMbar} mbar`,
    ];
    pkLines.forEach((line, idx) => {
      dxfText(specX, boxTopY - Math.round(420 * scaleFactor) - idx * Math.round(smH * 1.55), smH * 0.88, line, 'TEXT');
    });
  }

  // ── 5. DETAIL B: ENLARGED TRAY HYDRAULICS OR PACKED BED STACK ──
  const detTopY = boxTopY - planBoxH - Math.round(600 * scaleFactor);
  const detH = Math.max(3600, Math.round(sheetH * 0.24));
  const detW = Math.round(detailColW * 0.42);
  dxfText(
    rightStartX,
    detTopY,
    txtH,
    isTray ? 'DETAIL B: TRAY HYDRAULIC GEOMETRY & WEIR/DC' : 'DETAIL B: PACKED BED & INTERNALS STACK',
    'TITLEBLOCK'
  );
  dxfRect(rightStartX, detTopY - detH, detailColW, detH - Math.round(350 * scaleFactor), 'BORDER');

  if (isTray) {
    const sec = design.stripping;
    const xA = rightStartX + Math.round(800 * scaleFactor);
    const xB = xA + detW;
    const yUp = detTopY - Math.round(detH * 0.34);
    const yDn = detTopY - Math.round(detH * 0.78);
    // Upper & Lower Tray Decks + Sloped Downcomer Apron + Weir + Clearance h_ap
    dxfLine(xA, yUp, xB, yUp, 'INTERNAL_TRAY');
    dxfLine(xA, yDn, xB, yDn, 'INTERNAL_TRAY');
    const dcX = xA + Math.round(detW * 0.28);
    const apronW = Math.round(detW * 0.08);
    dxfLine(dcX, yUp + Math.round(detH * 0.10), dcX, yUp, 'INTERNAL_TRAY'); // upper outlet weir h_w
    dxfLine(dcX, yUp, dcX + apronW, yDn + Math.round(detH * 0.09), 'INTERNAL_TRAY'); // sloped DC
    dxfLine(xB - Math.round(detW * 0.14), yDn, xB - Math.round(detW * 0.14), yDn + Math.round(detH * 0.10), 'INTERNAL_TRAY');
    dxfText(xB + Math.round(450 * scaleFactor), yUp + Math.round(detH * 0.06), smH * 0.9, `TRAY SPACING = ${design.traySpacingMm} mm`, 'DIM');
    dxfText(xB + Math.round(450 * scaleFactor), (yUp + yDn) * 0.5, smH * 0.9, `WEIR HEIGHT h_w = ${sec.weirHeightMm} mm (h_ow=${sec.avgWeirCrestMm} mm)`, 'TEXT');
    dxfText(xB + Math.round(450 * scaleFactor), yDn + Math.round(detH * 0.08), smH * 0.9, `DC CLEARANCE h_ap = ${sec.dcClearanceMm} mm (SEAL +${sec.weirHeightMm - sec.dcClearanceMm} mm)`, 'TEXT');
    dxfText(xB + Math.round(450 * scaleFactor), yDn - Math.round(detH * 0.08), smH * 0.9, `DC TOP/BOT = ${sec.dcWidthTopMm} / ${sec.dcWidthBotMm} mm | d_h=${sec.holeDiameterMm}mm`, 'TEXT');
  } else {
    const hw = design.packingHardware;
    const xA = rightStartX + Math.round(700 * scaleFactor);
    const xB = xA + detW;
    const rowStep = (detH - Math.round(700 * scaleFactor)) / 4.2;
    const items: Array<[string, string]> = [
      ['HOLD-DOWN GRID (HD)', `${hw.holdDownGrids.type} (${hw.holdDownGrids.freeAreaPct}% Open)`],
      ['PACKING BED LAYER', `${design.packingSpec.nominalSizeLabel || design.packingSpec.name}`],
      ['SUPPORT PLATE (SP)', `${hw.supportPlates.type} (${hw.supportPlates.freeAreaPct}% Open)`],
      ['CHIMNEY REDISTRIBUTOR', `${hw.redistributors.count} EA | 35% Gas Free Area | ${hw.topDistributor.dripPointsPerM2} pts/m^2`],
    ];
    items.forEach(([title, desc], idx) => {
      const yy = detTopY - Math.round(520 * scaleFactor) - idx * rowStep;
      dxfRect(xA, yy - rowStep * 0.65, xB - xA, rowStep * 0.52, idx === 1 ? 'INTERNAL_PACKING' : 'HARDWARE');
      dxfText(xA + 120, yy - rowStep * 0.44, smH * 0.82, title, 'HARDWARE');
      dxfText(xB + Math.round(350 * scaleFactor), yy - rowStep * 0.44, smH * 0.82, desc, 'TEXT');
    });
  }

  // ── 6. NOZZLE & MANHOLE SCHEDULE TABLE ──
  const schTopY = detTopY - detH - Math.round(450 * scaleFactor);
  dxfText(rightStartX, schTopY, txtH, 'NOZZLE & MANHOLE ELEVATION SCHEDULE (EL +MM FROM BASE)', 'TITLEBLOCK');
  const rowH = Math.max(240, Math.round(310 * scaleFactor));
  dxfText(
    rightStartX,
    schTopY - rowH * 1.1,
    smH * 0.85,
    'TAG   | SIZE            | RATING           | ORIENT | EL (FROM BASE) | SERVICE',
    'DIM'
  );
  dxfLine(rightStartX, schTopY - rowH * 1.35, rightStartX + detailColW, schTopY - rowH * 1.35, 'BORDER');

  const allSchedRows = [
    ...design.nozzles.map((n) => ({
      tag: n.nozzleTag,
      size: n.selectedDn,
      rating: n.flangeRating,
      orient: `${n.orientationDeg} deg`,
      el: `EL +${n.elevationMm}`,
      svc: n.service,
    })),
    ...design.manholes.map((m) => ({
      tag: m.tag,
      size: m.sizeDn,
      rating: m.flangeRating,
      orient: `${m.orientationDeg} deg`,
      el: `EL +${m.elevationMm}`,
      svc: m.service,
    })),
  ];

  allSchedRows.forEach((row, idx) => {
    const yy = schTopY - rowH * (2.2 + idx * 1.0);
    const rowTxt = `${row.tag.padEnd(5)} | ${row.size.padEnd(15)} | ${row.rating.padEnd(16)} | ${row.orient.padEnd(7)} | ${row.el.padEnd(14)} | ${asciiSafe(row.svc).slice(0, 42)}`;
    dxfText(rightStartX, yy, smH * 0.78, rowTxt, 'TEXT');
  });

  // ── 7. EPC TITLE BLOCK ──
  const tbW = Math.min(detailColW, Math.max(9000, Math.round(10500 * scaleFactor)));
  const tbH = Math.max(1900, Math.round(2300 * scaleFactor));
  const tbX = sheetRight - margin - tbW;
  const tbY = sheetBottom + margin;
  dxfRect(tbX, tbY, tbW, tbH, 'TITLEBLOCK');
  dxfLine(tbX, tbY + tbH * 0.66, tbX + tbW, tbY + tbH * 0.66, 'TITLEBLOCK');
  dxfLine(tbX, tbY + tbH * 0.33, tbX + tbW, tbY + tbH * 0.33, 'TITLEBLOCK');
  dxfText(
    tbX + 200,
    tbY + tbH * 0.76,
    txtH * 0.95,
    `CHEMENG STUDIO ENGINEERING - PROCESS COLUMN GA & INTERNALS (${isTray ? 'TRAYED' : 'PACKED'})`,
    'TITLEBLOCK'
  );
  dxfText(
    tbX + 200,
    tbY + tbH * 0.43,
    smH * 0.95,
    `TAG: ${unitTag} | ${asciiSafe(unitLabel).slice(0, 36)} | RECT: ${pickDetailLabel(design.rectifying, isTray)} | STRIP: ${pickDetailLabel(design.stripping, isTray)}`,
    'TEXT'
  );
  dxfText(
    tbX + 200,
    tbY + tbH * 0.11,
    smH * 0.88,
    `ASME VIII DIV.1 | CORR ALLOW=${mech.corrosionAllowanceMm}mm | N=${simResult.totalStagesUsed} (FEED #${simResult.feedStageUsed}) | UNITS: MM | SCALE: 1:1 GA`,
    'TEXT'
  );

  add(0, 'ENDSEC');
  add(0, 'EOF');
  return lines.join('\r\n');
}

export function downloadColumnCadDxf(params: ColumnCadExportParams): void {
  const dxfContent = buildColumnCadDxf(params);
  const kind = params.design.internalsKind === 'tray' ? 'TRAY' : 'PACKED';
  const safeTag = asciiSafe(params.unitTag || 'COL').replace(/[^A-Za-z0-9_-]/g, '_');
  const blob = new Blob([dxfContent], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CAD_${safeTag}_${kind}_GA_1to1mm.dxf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
}

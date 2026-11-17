import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import {
  solveRigorousDistillation,
  type DistillColumnParams,
  type DistillFeedInput,
} from '../../lib/calculations/rigorousDistillation';
import { solveColumnInternalsDesign } from '../../lib/calculations/columnInternalsDesign';
import { exportColumnEpcDatasheet } from '../../lib/excel/datasheetExport';
import { buildColumnCadDxf } from '../../lib/cad/columnDxfExport';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';

const ROOT = path.resolve(__dirname, '../..');

function zeroFlows(partial: Partial<Record<SimCompKey, number>>): Record<SimCompKey, number> {
  return {
    H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
    N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
    CH4: 0, CO: 0, CO2: 0, NH3: 0,
    C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
    Benzene: 0, Toluene: 0, pXylene: 0,
    MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
    Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
    Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0,
    THF: 0, DMF: 0, DMSO: 0, MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0,
    FormicAcid: 0, HNO3: 0, CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0, CUSTOM_1: 0, CUSTOM_2: 0,
    ...partial,
  };
}

function assertMonotonicElevations(el: {
  baseElMm: number; btlElMm: number; lllElMm: number; nllElMm: number; hllElMm: number;
  stripBotElMm: number; stripTopElMm: number; feedNozzleElMm: number; rectBotElMm: number;
  rectTopElMm: number; demisterElMm: number; ttlElMm: number; oalElMm: number;
}, tangentToTangentHeightM: number, label: string) {
  assert.equal(el.baseElMm, 0, `${label}: baseElMm must be 0`);
  assert.ok(el.btlElMm > el.baseElMm, `${label}: BTL > base`);
  assert.ok(el.lllElMm > el.btlElMm, `${label}: LLL > BTL`);
  assert.ok(el.nllElMm > el.lllElMm, `${label}: NLL > LLL`);
  assert.ok(el.hllElMm > el.nllElMm, `${label}: HLL > NLL`);
  assert.ok(el.stripBotElMm > el.hllElMm, `${label}: stripBot > HLL`);
  assert.ok(el.stripTopElMm > el.stripBotElMm, `${label}: stripTop > stripBot`);
  assert.ok(el.feedNozzleElMm > el.stripTopElMm, `${label}: feed > stripTop`);
  assert.ok(el.rectBotElMm > el.feedNozzleElMm, `${label}: rectBot > feed`);
  assert.ok(el.rectTopElMm > el.rectBotElMm, `${label}: rectTop > rectBot`);
  assert.ok(el.demisterElMm > el.rectTopElMm, `${label}: demister > rectTop`);
  assert.ok(el.ttlElMm > el.demisterElMm, `${label}: TTL > demister`);
  assert.ok(el.oalElMm > el.ttlElMm, `${label}: OAL > TTL`);
  assert.equal(
    el.ttlElMm,
    el.btlElMm + Math.round(tangentToTangentHeightM * 1000),
    `${label}: TTL - BTL must match T-T height (mm)`
  );
}

function sheetAllText(ws: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined) {
        parts.push(String(cell.value));
      }
    });
  });
  return parts.join('\n');
}

async function testFlowsheetEpcTrayed() {
  console.log('\n[1/3] Testing Flowsheet/Workbench Trayed Column EPC Datasheet + Excel + DXF...');
  const feeds1: DistillFeedInput[] = [
    {
      edgeId: 'f1',
      streamNo: 'S1',
      stage: 10,
      flowsKgH: zeroFlows({ Benzene: 4500, Toluene: 5500 }),
      tempC: 92,
      pressKgcm2g: 0.3,
    },
  ];
  const cfg1: DistillColumnParams = {
    thermoModel: 'NRTL',
    totalStages: 20,
    feedStage: 10,
    condenserType: 'total',
    reboilerType: 'kettle',
    topPressKgcm2g: 0.1,
    stageDeltaPKgcm2: 0.004,
    murphreeEffPct: 75,
    topSpecType: 'reflux_ratio',
    topSpecValue: 2.6,
    splitSpecType: 'd_over_f_mass',
    splitSpecValue: 0.45,
    internalsConfig: {
      internalsKind: 'tray',
      trayType: 'valve',
      traySpacingMm: 500,
      flowPasses: 'auto',
      weirHeightMm: 50,
      holeDiameterMm: 38,
      holeAreaPct: 10,
      downcomerAreaPct: 12,
    },
  };
  const sim1 = solveRigorousDistillation(feeds1, cfg1);
  assert.ok(sim1.converged, 'Benzene/Toluene MESH must converge');
  const des1 = solveColumnInternalsDesign(cfg1, feeds1, sim1);

  assert.equal(des1.internalsKind, 'tray');
  assert.ok(des1.stripping.flowPasses === 1 || des1.stripping.flowPasses === 2 || des1.stripping.flowPasses === 4);
  assert.equal(des1.traySpacingMm, 500);
  assert.equal(des1.stripping.holeDiameterMm, 38);
  assert.ok(des1.stripping.holePitchMm > 30);
  assert.equal(des1.stripping.openAreaPctOfActive, 10);
  assert.equal(des1.stripping.weirHeightMm, 50);
  assert.ok(des1.stripping.weirLengthMm > 200);
  assert.ok(des1.stripping.dcWidthTopMm >= des1.stripping.dcWidthBotMm);
  assert.ok(des1.stripping.dcClearanceMm < des1.stripping.weirHeightMm, 'DC clearance h_ap < h_w required for seal');
  assert.ok(des1.operatingLoadMinPct < 100 && des1.operatingLoadMaxPct > 100, `Expected operating window bracketing 100%, got ${des1.operatingLoadMinPct}~${des1.operatingLoadMaxPct}`);
  assertMonotonicElevations(des1.elevations, des1.tangentToTangentHeightM, 'Tray 1-Pass');

  // Check 2-Pass large-throughput column
  const feedsLarge: DistillFeedInput[] = [
    {
      edgeId: 'f2',
      streamNo: 'S2',
      stage: 12,
      flowsKgH: zeroFlows({ Benzene: 36000, Toluene: 44000 }),
      tempC: 92,
      pressKgcm2g: 0.3,
    },
  ];
  const cfgLarge: DistillColumnParams = {
    ...cfg1,
    totalStages: 22,
    feedStage: 12,
    internalsConfig: {
      internalsKind: 'tray',
      trayType: 'sieve',
      traySpacingMm: 600,
      flowPasses: 2,
      weirHeightMm: 55,
      holeDiameterMm: 5.0,
      holeAreaPct: 11,
      downcomerAreaPct: 14,
    },
  };
  const simLarge = solveRigorousDistillation(feedsLarge, cfgLarge);
  assert.ok(simLarge.converged);
  const desLarge = solveColumnInternalsDesign(cfgLarge, feedsLarge, simLarge);
  assert.equal(desLarge.stripping.flowPasses, 2);
  assert.equal(desLarge.traySpacingMm, 600);
  assert.equal(desLarge.stripping.holeDiameterMm, 5.0);
  assert.ok(desLarge.stripping.dcClearanceMm < desLarge.stripping.weirHeightMm);
  assertMonotonicElevations(desLarge.elevations, desLarge.tangentToTangentHeightM, 'Tray 2-Pass');

  // Verify Excel workbook separation (2_TRAY_INTERNALS_DS present, NO 2_PACKING_INTERNALS_DS)
  const buf = await exportColumnEpcDatasheet({
    unitTag: 'T-201',
    unitLabel: 'Benzene-Toluene Fractionator',
    colConfig: cfgLarge,
    feeds: feedsLarge,
    simResult: simLarge,
    design: desLarge,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf) as any);
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names, ['1_VESSEL_SHELL_DS', '2_TRAY_INTERNALS_DS', '3_STAGE_HYDRAULICS']);
  const wsTrayTxt = sheetAllText(wb.getWorksheet('2_TRAY_INTERNALS_DS')!);
  assert.ok(wsTrayTxt.includes('Outlet Weir Height'), 'Tray sheet missing weir height');
  assert.ok(wsTrayTxt.includes('Downcomer Width'), 'Tray sheet missing downcomer width');
  assert.ok(wsTrayTxt.includes('Open Area Ratio'), 'Tray sheet missing open area');
  assert.ok(wsTrayTxt.includes('Operating Window'), 'Tray sheet missing operating range');
  assert.ok(!wsTrayTxt.includes('Hold-Down Grid'), 'Tray sheet must not contain packing hardware');
  assert.ok(!wsTrayTxt.includes('Redistributor'), 'Tray sheet must not contain packing redistributors');

  // Verify AutoCAD DXF output
  const dxf = buildColumnCadDxf({
    unitTag: 'T-201',
    unitLabel: 'Benzene-Toluene Fractionator',
    colConfig: cfgLarge,
    simResult: simLarge,
    design: desLarge,
  });
  assert.ok(!dxf.includes('NaN') && !dxf.includes('undefined'), 'DXF contains NaN/undefined');
  assert.ok(dxf.includes('INTERNAL_TRAY'), 'Tray DXF missing INTERNAL_TRAY layer entities');
  assert.ok(dxf.includes('2-PASS TRAY DECK PLAN'), 'Tray DXF missing pass plan label');
  console.log(
    `[PASS] Trayed EPC: 1-Pass/2-Pass OK, DC=${desLarge.stripping.dcWidthTopMm}/${desLarge.stripping.dcWidthBotMm}mm, hap=${desLarge.stripping.dcClearanceMm}mm, Window=${desLarge.operatingLoadMinPct}~${desLarge.operatingLoadMaxPct}%, DXF=${(dxf.length / 1024).toFixed(1)}KB`
  );
}

async function testFlowsheetEpcPacked() {
  console.log('\n[2/3] Testing Flowsheet/Workbench Packed Column EPC Datasheet + Excel + DXF...');
  const feedsPk: DistillFeedInput[] = [
    {
      edgeId: 'fp1',
      streamNo: 'SP1',
      stage: 14,
      flowsKgH: zeroFlows({ MeOH: 6000, H2O: 4000 }),
      tempC: 72,
      pressKgcm2g: 0.2,
    },
  ];
  const cfgPk: DistillColumnParams = {
    thermoModel: 'NRTL',
    totalStages: 28,
    feedStage: 14,
    condenserType: 'total',
    reboilerType: 'thermosyphon',
    topPressKgcm2g: 0.05,
    stageDeltaPKgcm2: 0.002,
    murphreeEffPct: 80,
    topSpecType: 'reflux_ratio',
    topSpecValue: 2.0,
    splitSpecType: 'd_over_f_mass',
    splitSpecValue: 0.60,
    internalsConfig: {
      internalsKind: 'packed',
      packingKey: 'mellapak_250y',
      maxBedHeightM: 3.0,
    },
  };
  const simPk = solveRigorousDistillation(feedsPk, cfgPk);
  assert.ok(simPk.converged, 'MeOH/H2O MESH must converge');
  const desPk = solveColumnInternalsDesign(cfgPk, feedsPk, simPk);

  assert.equal(desPk.internalsKind, 'packed');
  assert.ok(desPk.packedBeds.length >= 2, `Expected >=2 packed beds, got ${desPk.packedBeds.length}`);
  assert.ok((desPk.packingSpec.nominalSizeLabel || '').length > 4);
  assert.ok(desPk.packingHardware.topDistributor.dripPointsPerM2 >= 80);
  assert.ok(desPk.packingHardware.redistributors.count >= 1, 'Expected at least 1 redistributor');
  assert.equal(desPk.packingHardware.supportPlates.count, desPk.packedBeds.length);
  assert.equal(desPk.packingHardware.holdDownGrids.count, desPk.packedBeds.length);
  assert.equal(desPk.packingHardware.demister.thicknessMm, 150);
  assert.ok(desPk.operatingLoadMinPct < desPk.operatingLoadMaxPct);
  assertMonotonicElevations(desPk.elevations, desPk.tangentToTangentHeightM, 'Packed 250Y');
  for (const b of desPk.packedBeds) {
    assert.ok(b.topElMm > b.botElMm && b.bedHeightMm > 200 && b.hetpMm > 150);
  }

  // Also test random packing (Pall Ring 38mm)
  const cfgRnd: DistillColumnParams = {
    ...cfgPk,
    internalsConfig: { internalsKind: 'packed', packingKey: 'pall_ring_38_ss', maxBedHeightM: 3.5 },
  };
  const desRnd = solveColumnInternalsDesign(cfgRnd, feedsPk, simPk);
  assert.ok(desRnd.packingHardware.supportPlates.type.includes('Gas-Injection'));
  assert.ok(desRnd.packingHardware.holdDownGrids.type.includes('Weighted Hold-Down'));
  assertMonotonicElevations(desRnd.elevations, desRnd.tangentToTangentHeightM, 'Packed Pall Ring 38');

  const bufPk = await exportColumnEpcDatasheet({
    unitTag: 'T-301',
    unitLabel: 'Methanol-Water Packed Column',
    colConfig: cfgPk,
    feeds: feedsPk,
    simResult: simPk,
    design: desPk,
  });
  const wbPk = new ExcelJS.Workbook();
  await wbPk.xlsx.load(Buffer.from(bufPk) as any);
  const namesPk = wbPk.worksheets.map((w) => w.name);
  assert.deepEqual(namesPk, ['1_VESSEL_SHELL_DS', '2_PACKING_INTERNALS_DS', '3_STAGE_HYDRAULICS']);
  const wsPkTxt = sheetAllText(wbPk.getWorksheet('2_PACKING_INTERNALS_DS')!);
  assert.ok(wsPkTxt.includes('Packing Support Plates'), 'Packing sheet missing support plates');
  assert.ok(wsPkTxt.includes('Hold-Down Grids'), 'Packing sheet missing hold-down grids');
  assert.ok(wsPkTxt.includes('Liquid Redistributor'), 'Packing sheet missing redistributor');
  assert.ok(wsPkTxt.includes('HETP'), 'Packing sheet missing HETP');
  assert.ok(!wsPkTxt.includes('Downcomer Width'), 'Packing sheet must not contain tray downcomers');
  assert.ok(!wsPkTxt.includes('Outlet Weir Height'), 'Packing sheet must not contain tray weirs');

  const dxfPk = buildColumnCadDxf({
    unitTag: 'T-301',
    unitLabel: 'Methanol-Water Packed Column',
    colConfig: cfgPk,
    simResult: simPk,
    design: desPk,
  });
  assert.ok(!dxfPk.includes('NaN') && !dxfPk.includes('undefined'), 'Packed DXF contains NaN/undefined');
  assert.ok(dxfPk.includes('INTERNAL_PACKING') && dxfPk.includes('HARDWARE'), 'Packed DXF missing layers');
  assert.ok(dxfPk.includes('CHIMNEY REDISTRIBUTOR'), 'Packed DXF missing redistributor entity');
  assert.ok(!dxfPk.includes('TRAY #1'), 'Packed DXF must not contain tray callouts');

  console.log(
    `[PASS] Packed EPC: ${desPk.packedBeds.length} Beds, HETP=${desPk.stripping.hetpAvgM}m, RD=${desPk.packingHardware.redistributors.count}EA, LD-1=${desPk.packingHardware.topDistributor.dripPointsPerM2}pts/m2, DXF=${(dxfPk.length / 1024).toFixed(1)}KB`
  );
}

async function testChemproVmColumns() {
  console.log('\n[3/3] Testing ChemPro Suite VM (Trayed Dist, Packed Dist, Packed Absorber Datasheet + Excel + DXF)...');
  const chemDbCode = fs.readFileSync(path.join(ROOT, 'public/chempro/chem_db.js'), 'utf8');
  const kernelCode = fs.readFileSync(path.join(ROOT, 'public/chempro/unified_kernel.js'), 'utf8');
  const engSolversCode = fs.readFileSync(path.join(ROOT, 'public/chempro/eng_solvers.js'), 'utf8');
  const excelExporterCode = fs.readFileSync(path.join(ROOT, 'public/chempro/excel_exporter.js'), 'utf8');
  const appJsCode = fs.readFileSync(path.join(ROOT, 'public/chempro/app.js'), 'utf8');

  const noopCtx: Record<string, any> = new Proxy({
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    measureText: (t: string) => ({ width: (t || '').length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      return () => {};
    },
  });

  let capturedFileName = '';
  let capturedWorkbookBytes: Uint8Array | null = null;

  const ctx: Record<string, any> = {
    console, Math, Number, String, Array, Object, JSON, Date, Error, isFinite, isNaN, parseFloat, parseInt,
    setTimeout, clearTimeout,
    devicePixelRatio: 1,
    btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    ExcelJS,
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    alert() {},
    document: {
      addEventListener() {},
      getElementById: () => null,
      createElement: () => ({
        width: 960, height: 480, style: {},
        getBoundingClientRect: () => ({ width: 960, height: 480 }),
        getContext: () => noopCtx,
        toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      }),
    },
    AndroidBridge: {
      saveAndShareFile: (name: string, b64: string) => {
        capturedFileName = name;
        capturedWorkbookBytes = Uint8Array.from(Buffer.from(b64, 'base64'));
      },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  vm.runInContext(chemDbCode, ctx, { filename: 'chem_db.js' });
  vm.runInContext(kernelCode, ctx, { filename: 'unified_kernel.js' });
  vm.runInContext(engSolversCode, ctx, { filename: 'eng_solvers.js' });
  vm.runInContext(excelExporterCode, ctx, { filename: 'excel_exporter.js' });
  vm.runInContext(appJsCode, ctx, { filename: 'app.js' });

  const S = ctx.ChemEngSolvers;
  const EX = ctx.ChemEngExcelExporter;
  const APP = ctx.App;

  const resTray = S.solveColumn({
    equipTag: 'T-501',
    col_mode: 'distillation',
    nrtlPreset: 'dcp_ech',
    F_kmolh: 90,
    zF: 0.45,
    xD: 0.96,
    xB: 0.04,
    P_col_bar: 1.013,
    internals: 'tray',
    tray_type: 'sieve',
    tray_passes: 2,
    hole_d_mm: 5.0,
    weir_h_mm: 50,
    hole_area_pct: 10,
  }, 'rigorous');

  const resPacked = S.solveColumn({
    equipTag: 'T-502',
    col_mode: 'distillation',
    nrtlPreset: 'dcp_ech',
    F_kmolh: 90,
    zF: 0.45,
    xD: 0.96,
    xB: 0.04,
    P_col_bar: 0.35,
    internals: 'packed',
    pack_key: 'mellapak_250y',
    bed_max_h_m: 3.5,
  }, 'rigorous');

  const resAbs = S.solveColumn({
    equipTag: 'T-503',
    col_mode: 'absorption',
    abs_service: 'scrubbing',
    lkFluidId: 'h2_wet_gas',
    hkFluidId: 'water',
    Wg_kgh: 2500,
    Wl_kgh: 18000,
    P_col_bar: 1.05,
    pack_key: 'pall_plastic_50',
    yin_ppm: 4500,
    yout_ppm: 5,
  }, 'rigorous');

  assert.ok(resTray.trayDetail && !resTray.packingDetail && resTray.nozzleSchedule.length === 6);
  assert.ok(resPacked.packingDetail && !resPacked.trayDetail && resPacked.packingDetail.beds.length >= 2);
  assert.ok(resAbs.packingDetail && resAbs.nozzleSchedule.length === 4);

  // Check on-screen HTML datasheets & Canvas DWG calls
  for (const [label, resObj, mustHave, mustNotHave, expectedSheet] of [
    ['ChemPro Tray', resTray, ['PART I —', 'PART II-A — FRACTIONATION TRAY', 'PART III — NOZZLE'], ['PART II-B — PACKED'], '1_Tray_Column_DS'],
    ['ChemPro Packed Dist', resPacked, ['PART I —', 'PART II-B — PACKED COLUMN', 'PART III — NOZZLE'], ['PART II-A — FRACTIONATION TRAY'], '1_Packed_Column_DS'],
    ['ChemPro Absorber', resAbs, ['PART I —', 'PART II-B — PACKED COLUMN', 'PART III — NOZZLE'], ['PART II-A — FRACTIONATION TRAY'], '1_Packed_Absorber_DS'],
  ] as const) {
    const html: string = S.renderQuotationDatasheet('column', resObj, 'rigorous');
    for (const s of mustHave) assert.ok(html.includes(s), `${label} HTML missing ${s}`);
    for (const s of mustNotHave) assert.ok(!html.includes(s), `${label} HTML leaked ${s}`);

    // Canvas DWG test
    S.drawEngineeringDWG(
      { width: 920, height: 340, style: {}, getBoundingClientRect: () => ({ width: 920, height: 340 }), getContext: () => noopCtx },
      'column',
      resObj
    );

    // Excel export test
    capturedWorkbookBytes = null;
    await EX.exportEquipmentExcel('column', resObj, 'rigorous');
    assert.ok(capturedWorkbookBytes, `${label}: Excel bytes not emitted`);
    const wbCheck = new ExcelJS.Workbook();
    await wbCheck.xlsx.load(Buffer.from(capturedWorkbookBytes!) as any);
    assert.equal(wbCheck.worksheets[0].name, expectedSheet, `${label} sheet name mismatch`);
    assert.equal(wbCheck.worksheets[1].name, '2_Engineering_DWG_Sketch');

    // AutoCAD DXF generation test
    const dxfStr: string = APP.buildCADcraftDXFString('column', resObj);
    assert.ok(!dxfStr.includes('NaN') && !dxfStr.includes('undefined'), `${label} DXF has NaN/undefined`);
    assert.ok(dxfStr.includes('ASME VIII-1'), `${label} DXF missing titleblock`);
    if (resObj.internals === 'packed' || resObj.colMode === 'absorption') {
      assert.ok(dxfStr.includes('INTERNAL_PACKING'), `${label} DXF missing INTERNAL_PACKING`);
    } else {
      assert.ok(dxfStr.includes('INTERNAL_TRAY'), `${label} DXF missing INTERNAL_TRAY`);
    }
    console.log(`[PASS] ${label}: HTML separated OK, Excel=${expectedSheet} (${capturedFileName}), DXF=${(dxfStr.length / 1024).toFixed(1)}KB`);
  }
}

async function main() {
  await testFlowsheetEpcTrayed();
  await testFlowsheetEpcPacked();
  await testChemproVmColumns();
  console.log('\n[SUCCESS] All Column Datasheet (Vessel + Tray vs Packing), Excel & CAD/DXF Validation Checks Passed!');
}

main().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});

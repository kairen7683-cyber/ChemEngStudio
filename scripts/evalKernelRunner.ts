/**
 * Isolated Headless Evaluation Kernel for ChemPlant Studio.
 * SECURITY: Imports ONLY pure thermodynamic & unit-operation calculation engines.
 * ZERO imports of commercial plants (PLANT 01~06), user workspaces, auth, or DB.
 */
import { SIM_COMPS, solveFlowsheet, type FlowEdgeDef, type FlowNodeDef, type SimCompKey } from '../lib/calculations/flowsheetSolver';
import { bubbleTemperatureC, solveRigorousFlashVLE } from '../lib/calculations/rigorousThermo';
import { solveRigorousDistillation } from '../lib/calculations/rigorousDistillation';
import { solveHeatExchangerDesign } from '../lib/calculations/heatExchangerDesign';
import { solveColumnInternalsDesign } from '../lib/calculations/columnInternalsDesign';

interface EvalRequest {
  action: 'list_components' | 'vle' | 'distillation' | 'flowsheet' | 'hex' | 'column_internals';
  payload?: any;
}

function runAction(req: EvalRequest): any {
  const p = req.payload || {};

  if (req.action === 'list_components') {
    const comps = Object.entries(SIM_COMPS).map(([key, info]) => ({
      key,
      formula: info.formula,
      mw: info.mw,
      isGasAtStd: info.isGasAtStd,
    }));
    return { count: comps.length, components: comps };
  }

  if (req.action === 'vle') {
    const method = p.propertyMethod || 'PR';
    if (p.mode === 'bubble') {
      const pBarA = Number(p.pressBarA ?? 1.01325);
      const res = bubbleTemperatureC(p.xMole || {}, pBarA, method);
      return {
        mode: 'bubble',
        propertyMethod: method,
        pressBarA: pBarA,
        T_bubble_C: +res.T_C.toFixed(4),
        y: res.y,
        K: res.K,
      };
    }
    const tempC = Number(p.tempC ?? 95.0);
    const pressKgcm2g = p.pressKgcm2g !== undefined
      ? Number(p.pressKgcm2g)
      : (Number(p.pressBarA ?? 1.01325) / 0.980665 - 1.03323);
    const fl = solveRigorousFlashVLE(p.flowsKgH || {}, tempC, pressKgcm2g, 1.0, undefined, undefined, method);
    const nonZero = (rec: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(rec || {})) {
        if (Math.abs(v) > 1e-6) out[k] = +v.toFixed(4);
      }
      return out;
    };
    return {
      mode: 'flash',
      propertyMethod: method,
      tempC,
      pressKgcm2g: +pressKgcm2g.toFixed(4),
      betaVapMole: +fl.betaVapMole.toFixed(6),
      Z_vap: +fl.Z_vap.toFixed(5),
      converged: fl.converged,
      vapKgH: nonZero(fl.vap),
      liqKgH: nonZero(fl.liq),
    };
  }

  if (req.action === 'distillation') {
    const feeds = (p.feeds || []).map((f: any, idx: number) => ({
      edgeId: f.edgeId || `f${idx + 1}`,
      streamNo: f.streamNo || `F${idx + 1}`,
      stage: Number(f.stage ?? p.config?.feedStage ?? 10),
      flowsKgH: f.flowsKgH || {},
      tempC: Number(f.tempC ?? 80),
      pressKgcm2g: Number(f.pressKgcm2g ?? p.config?.topPressKgcm2g ?? 0),
    }));
    const res = solveRigorousDistillation(feeds, p.config || {});
    const nonZero = (rec: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(rec || {})) {
        if (Math.abs(v) > 1e-6) out[k] = +v.toFixed(4);
      }
      return out;
    };
    const n = (v: any, d = 4) => +Number(v ?? 0).toFixed(d);
    return {
      converged: Boolean(res.converged),
      iterations: Number(res.iterations ?? 0),
      topTempC: n(res.topTempC, 3),
      bottomTempC: n(res.bottomTempC, 3),
      condenserDutyMW: n((res.condenserDutyKcalH ?? 0) * 4.184 / 3.6e6, 5),
      reboilerDutyMW: n((res.reboilerDutyKcalH ?? 0) * 4.184 / 3.6e6, 5),
      condenserDutyKcalH: n(res.condenserDutyKcalH, 1),
      reboilerDutyKcalH: n(res.reboilerDutyKcalH, 1),
      refluxRatioActual: n((res as any).refluxRatioActual ?? (res as any).refluxRatio ?? p.config?.topSpecValue, 4),
      distillateFlowsKgH: nonZero(res.distillateFlowsKgH),
      bottomsFlowsKgH: nonZero(res.bottomsFlowsKgH),
      stages: (res.stages || []).map((st: any) => ({
        stage: st.stage,
        tempC: n(st.tempC, 2),
        pressKgcm2g: n(st.pressKgcm2g, 4),
        V_kmolH: n(st.V_kmolH ?? st.vaporKmolH, 3),
        L_kmolH: n(st.L_kmolH ?? st.liquidKmolH, 3),
      })),
    };
  }

  if (req.action === 'flowsheet') {
    const nodes: FlowNodeDef[] = Array.isArray(p.nodes) ? p.nodes : [];
    const edges: FlowEdgeDef[] = Array.isArray(p.edges) ? p.edges : [];
    if (nodes.length === 0 || nodes.length > 40) {
      throw new Error('nodes must contain between 1 and 40 unit blocks');
    }
    const res = solveFlowsheet(nodes, edges, {
      propertyMethod: p.propertyMethod || 'PR',
      activeComponents: p.activeComponents as SimCompKey[] | undefined,
    });
    const nonZero = (rec: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(rec || {})) {
        if (Math.abs(v) > 1e-6) out[k] = +v.toFixed(4);
      }
      return out;
    };
    return {
      convergence: res.convergence,
      balance: {
        feedInKgH: +res.balance.feedInKgH.toFixed(3),
        productOutKgH: +res.balance.productOutKgH.toFixed(3),
        massImbalancePct: +res.balance.massImbalancePct.toFixed(5),
        energyResidualPct: +res.balance.energyResidualPct.toFixed(4),
      },
      units: res.units.map(u => ({
        tag: u.tag,
        unitType: u.unitType,
        inletMassKgH: +u.inletMassKgH.toFixed(3),
        outletMassKgH: +u.outletMassKgH.toFixed(3),
        heatDutyKcalH: +u.heatDutyKcalH.toFixed(2),
        heatDutyMW: +(u.heatDutyKcalH * 4.184 / 3.6e6).toFixed(5),
        shaftPowerKW: +u.shaftPowerKW.toFixed(4),
        statusNote: u.statusNote,
      })),
      streams: res.streams.map(s => ({
        streamNo: s.streamNo,
        fromTag: s.fromTag,
        toTag: s.toTag,
        tempC: +s.tempC.toFixed(3),
        pressKgcm2g: +s.pressKgcm2g.toFixed(4),
        vaporFraction: +s.vaporFraction.toFixed(5),
        totalMassKgH: +s.totalMassKgH.toFixed(3),
        totalMolarKmolH: +s.totalMolarKmolH.toFixed(4),
        flowsKgH: nonZero(s.flowsKgH),
      })),
    };
  }

  if (req.action === 'hex') {
    const procFlowsKgH = p.procFlowsKgH || { Toluene: 10000 };
    const procTinC = Number(p.procTinC ?? 110);
    const procToutC = Number(p.procToutC ?? 40);
    const procPressKgcm2g = Number(p.procPressKgcm2g ?? 3.0);
    const method = p.propertyMethod || 'PR';
    const refPreset = p.refrigerantPreset || 'cw';
    const activeComps = Array.from(new Set([...Object.keys(procFlowsKgH), 'H2O'])) as SimCompKey[];
    const hxFlow = solveFlowsheet(
      [
        { id: 'f1', tag: 'F-HX', name: 'Process In', unitType: 'feed', params: { feedTempC: procTinC, feedPressKgcm2g: procPressKgcm2g, feedFlowsKgH: procFlowsKgH } },
        { id: 'e1', tag: 'E-101', name: 'HEX', unitType: 'hex', params: { hexSpecMode: 'proc_temp', refrigerantPreset: refPreset, operTempC: procToutC, overallU: Number(p.overallU ?? 450) } },
        { id: 'o1', tag: 'O-HX', name: 'Process Out', unitType: 'product', params: {} },
      ],
      [
        { id: 's1', streamNo: 'H1', source: 'f1', target: 'e1', sourcePort: 'out', targetPort: 'in' },
        { id: 's2', streamNo: 'H2', source: 'e1', target: 'o1', sourcePort: 'out', targetPort: 'in' },
      ],
      { propertyMethod: method, activeComponents: activeComps }
    );
    const hxUnit = hxFlow.units.find(u => u.tag === 'E-101')!;
    const hxIn = hxFlow.streams.filter(s => s.streamNo === 'H1');
    const hxOut = hxFlow.streams.filter(s => s.streamNo === 'H2');
    const hxRes = solveHeatExchangerDesign(
      'hex',
      { hexSpecMode: 'proc_temp', refrigerantPreset: refPreset, operTempC: procToutC, overallU: Number(p.overallU ?? 450) },
      {
        hxKind: 'shell_tube',
        temaType: 'BEM',
        tubeOdMm: 19.05,
        tubeLengthM: 4.88,
        tubePasses: 2,
        shellCount: 1,
        baffleCutPct: 25,
        ...(p.hxConfig || {}),
      } as any,
      hxIn,
      hxOut,
      [],
      [],
      hxUnit
    );
    return {
      allocation: hxRes.allocation,
      temaType: hxRes.temaType,
      dutyKW: +hxRes.dutyKW.toFixed(3),
      utilFlowKgH: +((hxRes.utilitySide as any).massFlowKgH ?? 0).toFixed(2),
      lmtdCounterC: +hxRes.lmtdCounterC.toFixed(3),
      ftFactor: +hxRes.ftFactor.toFixed(4),
      cmtdC: +hxRes.cmtdC.toFixed(3),
      hTubeWm2K: +hxRes.hTubeWm2K.toFixed(2),
      hShellWm2K: +hxRes.hShellWm2K.toFixed(2),
      uCleanWm2K: +hxRes.uCleanWm2K.toFixed(2),
      uServiceWm2K: +hxRes.uCalcWm2K.toFixed(2),
      areaReqM2: +hxRes.areaReqM2.toFixed(3),
      areaProvM2: +hxRes.areaProvM2.toFixed(3),
      tubeCountPerShell: hxRes.tubeCountPerShell,
      shellIdMm: hxRes.shellIdMm,
      baffleSpacingMm: hxRes.baffleSpacingMm,
      velTubeMs: +hxRes.velTubeMs.toFixed(4),
      velShellMs: +hxRes.velShellMs.toFixed(4),
      dpTubeBar: +hxRes.dpTubeBar.toFixed(5),
      dpShellBar: +hxRes.dpShellBar.toFixed(5),
    };
  }

  if (req.action === 'column_internals') {
    const feeds = (p.feeds || []).map((f: any, idx: number) => ({
      edgeId: f.edgeId || `f${idx + 1}`,
      streamNo: f.streamNo || `F${idx + 1}`,
      stage: Number(f.stage ?? p.config?.feedStage ?? 10),
      flowsKgH: f.flowsKgH || {},
      tempC: Number(f.tempC ?? 80),
      pressKgcm2g: Number(f.pressKgcm2g ?? p.config?.topPressKgcm2g ?? 0),
    }));
    const cfg = { ...(p.config || {}), internalsConfig: p.internalsConfig || { internalsKind: 'tray', trayType: 'sieve', traySpacingMm: 500, designFloodTargetPct: 80, foamingFactor: 1.0 } };
    const sim = solveRigorousDistillation(feeds, cfg);
    const col = solveColumnInternalsDesign(cfg, feeds, sim);
    return {
      distillationConverged: sim.converged,
      topTempC: +sim.topTempC.toFixed(3),
      bottomTempC: +sim.bottomTempC.toFixed(3),
      reboilerDutyMW: +(sim.reboilerDutyKcalH * 4.184 / 3.6e6).toFixed(5),
      internalsKind: col.internalsKind,
      governingDiamM: +col.governingDiamM.toFixed(4),
      maxFloodPct: +col.maxFloodPct.toFixed(2),
      maxJetFloodPct: +col.maxJetFloodPct.toFixed(2),
      maxDcChokeFloodPct: +col.maxDcChokeFloodPct.toFixed(2),
      minDcResidenceTimeSec: +col.minDcResidenceTimeSec.toFixed(2),
      totalInternalsDpMbar: +col.totalInternalsDpMbar.toFixed(2),
      totalPackedHeightM: +col.totalPackedHeightM.toFixed(3),
      avgPackedHogM: +(col.avgPackedHogM || 0).toFixed(4),
      tangentToTangentHeightM: +col.tangentToTangentHeightM.toFixed(2),
      shellWallThicknessMm: +col.shellWallThicknessMm.toFixed(2),
    };
  }

  throw new Error(`Unsupported action: ${String(req.action)}`);
}

// Read JSON from stdin and write JSON to stdout
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(raw || '{}') as EvalRequest;
    const result = runAction(req);
    process.stdout.write(JSON.stringify({ ok: true, data: result }));
  } catch (err: any) {
    process.stdout.write(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exitCode = 1;
  }
});

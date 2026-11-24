'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { ENGINEERING_DISCLAIMER_ROWS } from '@/lib/legal/engineeringDisclaimer';
import { useUnitStore } from '@/lib/stores/unitStore';
import type { FlowUnitParams } from '@/lib/calculations/flowsheetSolver';

export interface PurificationWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  unitType: 'saturator' | 'chelate_tower' | 'candle_filter';
  tag: string;
  name: string;
  inletMassKgH: number;
  inletVolM3H: number;
  inletTempC: number;
  inletPressKgcm2g: number;
  inletDensityKgM3: number;
  params: FlowUnitParams;
  onApplyParams: (patch: Partial<FlowUnitParams>) => void;
}

const MONO = 'JetBrains Mono, monospace';

const cardBox: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '10px 12px',
};

const lblStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 800,
  color: '#334155',
  marginBottom: 4,
};

const inpStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 8px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11.5,
  fontWeight: 800,
  fontFamily: MONO,
  boxSizing: 'border-box',
};

const selStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11,
  fontWeight: 800,
  boxSizing: 'border-box',
  cursor: 'pointer',
};

type SatType = 'conventional_bed' | 'vertical_cyl' | 'agitated_dissolver';
type SatMetallurgy = 'Acid-Proof Concrete / Tile' | 'Rubber-Lined CS' | 'FRP' | 'Titanium Gr.2';
type ChelateConfig = '2-Tower Lead-Lag' | '3-Tower Merry-Go-Round';
type ChelateResinType = 'Iminodiacetic (IDA)' | 'Aminophosphonic';
type ChelateMetallurgy = 'Rubber-Lined CS' | 'FRP';
type FilterMetallurgy = 'Rubber-Lined CS' | 'FRP' | 'Ti Gr.2' | 'SS316L';

function clampNum(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export default function PurificationWorkbenchModal({
  open,
  onClose,
  unitType,
  tag,
  name,
  inletMassKgH,
  inletVolM3H,
  inletTempC,
  inletPressKgcm2g,
  inletDensityKgM3,
  params,
  onApplyParams,
}: PurificationWorkbenchModalProps) {
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';

  // ── 1) Saturator & Clarifier state ──
  const [satType, setSatType] = useState<SatType>('conventional_bed');
  const [targetBrineWtPct, setTargetBrineWtPct] = useState<number>(params.targetBrineWtPct ?? 25.6);
  const [upflowVelMh, setUpflowVelMh] = useState<number>(1.8);
  const [saltBedHeightM, setSaltBedHeightM] = useState<number>(3.0);
  const [clearZoneM, setClearZoneM] = useState<number>(1.5);
  const [satParallelCount, setSatParallelCount] = useState<number>(1);
  const [residenceTimeMin, setResidenceTimeMin] = useState<number>(45);
  const [hdRatio, setHdRatio] = useState<number>(1.4);
  const [coneAngleDeg, setConeAngleDeg] = useState<number>(60);
  const [agitSpecPower, setAgitSpecPower] = useState<number>(0.35);
  const [satMetallurgy, setSatMetallurgy] = useState<SatMetallurgy>('Acid-Proof Concrete / Tile');

  const handleChangeSatType = (next: SatType) => {
    setSatType(next);
    if (next === 'conventional_bed') {
      setUpflowVelMh(1.8);
      setSaltBedHeightM(3.0);
      setClearZoneM(1.5);
      setSatMetallurgy('Acid-Proof Concrete / Tile');
    } else if (next === 'vertical_cyl') {
      setUpflowVelMh(4.5);
      setSaltBedHeightM(3.5);
      setClearZoneM(1.5);
      setSatMetallurgy('FRP');
    } else {
      setResidenceTimeMin(45);
      setHdRatio(1.4);
      setConeAngleDeg(60);
      setSatMetallurgy('Rubber-Lined CS');
    }
  };

  // ── 2) Chelate Resin Tower state ──
  const [svBvh, setSvBvh] = useState<number>(18);
  const [lvMh, setLvMh] = useState<number>(20);
  const [resinBedHeightM, setResinBedHeightM] = useState<number>(1.35);
  const [regenCycleH, setRegenCycleH] = useState<number>(48);
  const [chelateConfig, setChelateConfig] = useState<ChelateConfig>('2-Tower Lead-Lag');
  const [resinType, setResinType] = useState<ChelateResinType>('Iminodiacetic (IDA)');
  const [chelateMetallurgy, setChelateMetallurgy] = useState<ChelateMetallurgy>('Rubber-Lined CS');

  // ── 3) Candle / Activated Carbon Filter state ──
  const [filterMode, setFilterMode] = useState<'candle' | 'carbon'>(
    params.filterMode === 'carbon' ? 'carbon' : 'candle',
  );
  // Candle mode
  const [candleFlux, setCandleFlux] = useState<number>(params.filterFluxM3M2H ?? 1.2);
  const [candleOdMm, setCandleOdMm] = useState<number>(60);
  const [candleLenM, setCandleLenM] = useState<number>(1.5);
  const [candleCycleH, setCandleCycleH] = useState<number>(8);
  const [candleDeltaPBar, setCandleDeltaPBar] = useState<number>(
    params.filterMode === 'carbon' ? 0.5 : (params.filterDeltaPBar ?? 0.5),
  );
  const [candleMaterial, setCandleMaterial] = useState<FilterMetallurgy>('Rubber-Lined CS');
  // Carbon mode
  const [ebctMin, setEbctMin] = useState<number>(15);
  const [carbonLvMh, setCarbonLvMh] = useState<number>(12);
  const [carbonBedDepthM, setCarbonBedDepthM] = useState<number>(2.0);
  const [carbonBulkDensity, setCarbonBulkDensity] = useState<number>(480);
  const [carbonDeltaPBar, setCarbonDeltaPBar] = useState<number>(
    params.filterMode === 'carbon' ? (params.filterDeltaPBar ?? 0.4) : 0.4,
  );
  const [carbonMaterial, setCarbonMaterial] = useState<FilterMetallurgy>('Rubber-Lined CS');

  const [exporting, setExporting] = useState(false);

  // Sync incoming params when modal opens
  useEffect(() => {
    if (!open) return;
    if (params.targetBrineWtPct !== undefined) setTargetBrineWtPct(params.targetBrineWtPct);
    if (params.filterMode) setFilterMode(params.filterMode);
    if (params.filterFluxM3M2H !== undefined) setCandleFlux(params.filterFluxM3M2H);
    if (params.filterDeltaPBar !== undefined) {
      if (params.filterMode === 'carbon') setCarbonDeltaPBar(params.filterDeltaPBar);
      else setCandleDeltaPBar(params.filterDeltaPBar);
    }
  }, [open, params.targetBrineWtPct, params.filterMode, params.filterFluxM3M2H, params.filterDeltaPBar]);

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const safeQ = Math.max(0.5, Number.isFinite(inletVolM3H) && inletVolM3H > 0 ? inletVolM3H : 120);
  const safeRho = Math.max(500, Number.isFinite(inletDensityKgM3) && inletDensityKgM3 > 0 ? inletDensityKgM3 : 1190);
  const safeM = Math.max(50, Number.isFinite(inletMassKgH) && inletMassKgH > 0 ? inletMassKgH : safeQ * safeRho);
  const safeT = Number.isFinite(inletTempC) ? inletTempC : 60;
  const safeP = Number.isFinite(inletPressKgcm2g) ? inletPressKgcm2g : 2.5;

  // ── Engineering Calculations ──
  const satCalc = useMemo(() => {
    const wt = clampNum(targetBrineWtPct, 15, 26.5, 25.6);
    const nUnits = Math.round(clampNum(satParallelCount, 1, 6, 1));
    const qPerUnit = safeQ / nUnits;

    // Resaturation from typical depleted brine (17.5 wt% NaCl) to targetBrineWtPct
    const wIn = 0.175;
    const wOut = wt / 100;
    const waterMass = safeM * (1 - wIn);
    const saltDissolutionKgH = Math.max(0, waterMass * (wOut / (1 - wOut)) - safeM * wIn);
    const sludgePct = clampNum(params.sludgePurgePct ?? 0.35, 0.05, 5, 0.35);
    const sludgeBlowdownKgH = safeM * (sludgePct / 100);

    if (satType === 'conventional_bed' || satType === 'vertical_cyl') {
      const vUp = clampNum(upflowVelMh, 0.5, 12, satType === 'conventional_bed' ? 1.8 : 4.5);
      const hBed = clampNum(saltBedHeightM, 1.0, 6.0, satType === 'conventional_bed' ? 3.0 : 3.5);
      const hClear = clampNum(clearZoneM, 0.6, 3.5, 1.5);
      const freeboard = 0.6;

      const areaPerUnitM2 = qPerUnit / vUp;
      const tankIdM = Math.sqrt((4 * areaPerUnitM2) / Math.PI);
      const straightSideM = hBed + hClear + freeboard;
      const coneHeightM = satType === 'vertical_cyl' ? (tankIdM / 2) * Math.tan((45 * Math.PI) / 180) * 0.4 : 0;
      const totalHeightM = straightSideM + coneHeightM;
      const activeVolM3 = areaPerUnitM2 * (hBed + hClear);
      const totalVolM3 = areaPerUnitM2 * straightSideM;
      const saltInventoryTon = (areaPerUnitM2 * hBed * 1150 * nUnits) / 1000;
      const autonomyH = saltDissolutionKgH > 1 ? (saltInventoryTon * 1000) / saltDissolutionKgH : 24;
      const tau = (activeVolM3 / Math.max(0.1, qPerUnit)) * 60;

      return {
        satType,
        nUnits,
        wt,
        tau,
        hd: straightSideM / Math.max(0.1, tankIdM),
        coneDeg: coneHeightM > 0 ? 45 : 0,
        specKw: 0,
        activeVolM3,
        totalVolM3,
        tankIdM,
        straightSideM,
        coneHeightM,
        totalHeightM,
        agitatorKw: 0,
        saltDissolutionKgH,
        sludgeBlowdownKgH,
        riseVelMh: vUp,
        saltBedHeightM: hBed,
        clearZoneM: hClear,
        saltInventoryTon,
        autonomyH,
      };
    }

    // Agitated Brine Dissolver Tank
    const tau = clampNum(residenceTimeMin, 5, 240, 45);
    const hd = clampNum(hdRatio, 0.7, 3.0, 1.4);
    const coneDeg = clampNum(coneAngleDeg, 30, 75, 60);
    const specKw = clampNum(agitSpecPower, 0.05, 2.5, 0.35);

    const activeVolM3 = qPerUnit * (tau / 60);
    const totalVolM3 = activeVolM3 / 0.82; // 18% freeboard
    const tanCone = Math.tan((coneDeg * Math.PI) / 180);
    const tankIdM = Math.cbrt((4 * totalVolM3) / (Math.PI * (hd + tanCone / 6)));
    const straightSideM = hd * tankIdM;
    const coneHeightM = (tankIdM / 2) * tanCone;
    const totalHeightM = straightSideM + coneHeightM;
    const agitatorKw = activeVolM3 * specKw;
    const riseVelMh = qPerUnit / ((Math.PI / 4) * tankIdM * tankIdM);

    return {
      satType,
      nUnits,
      wt,
      tau,
      hd,
      coneDeg,
      specKw,
      activeVolM3,
      totalVolM3,
      tankIdM,
      straightSideM,
      coneHeightM,
      totalHeightM,
      agitatorKw,
      saltDissolutionKgH,
      sludgeBlowdownKgH,
      riseVelMh,
      saltBedHeightM: 0,
      clearZoneM: 0,
      saltInventoryTon: 0,
      autonomyH: tau / 60,
    };
  }, [
    satType,
    satParallelCount,
    targetBrineWtPct,
    upflowVelMh,
    saltBedHeightM,
    clearZoneM,
    residenceTimeMin,
    hdRatio,
    coneAngleDeg,
    agitSpecPower,
    safeQ,
    safeM,
    params.sludgePurgePct,
  ]);

  const chelateCalc = useMemo(() => {
    const sv = clampNum(svBvh, 4, 40, 18);
    const lv = clampNum(lvMh, 5, 40, 20);
    const hBed = clampNum(resinBedHeightM, 0.6, 3.0, 1.35);
    const cycleH = clampNum(regenCycleH, 8, 168, 48);

    const volFromSv = safeQ / sv;
    const areaFromLv = safeQ / lv;
    const areaFromSv = volFromSv / hBed;
    const govAreaM2 = Math.max(areaFromLv, areaFromSv);
    const towerIdM = Math.sqrt((4 * govAreaM2) / Math.PI);
    const resinVolM3 = govAreaM2 * hBed;
    const actualSv = safeQ / Math.max(0.01, resinVolM3);
    const actualLv = safeQ / Math.max(0.01, govAreaM2);
    const freeboardM = hBed * 0.5; // 50% backwash expansion
    const vesselTTH = hBed + freeboardM + 0.65; // distributor + underdrain allowance
    const deltaPBar = 0.012 * actualLv * hBed + 0.08;

    // Daily regeneration chemical consumption (32% HCl @ 120 kg pure/m³·regen, 32% NaOH @ 100 kg pure/m³·regen)
    const regensPerDay = 24 / cycleH;
    const hcl32KgDay = resinVolM3 * (120 / 0.32) * regensPerDay;
    const naoh32KgDay = resinVolM3 * (100 / 0.32) * regensPerDay;
    const towerCount = chelateConfig === '3-Tower Merry-Go-Round' ? 3 : 2;
    const svOk = actualSv <= 22;

    return {
      sv,
      lv,
      hBed,
      cycleH,
      towerIdM,
      resinVolM3,
      actualSv,
      actualLv,
      freeboardM,
      vesselTTH,
      deltaPBar,
      hcl32KgDay,
      naoh32KgDay,
      towerCount,
      svOk,
    };
  }, [svBvh, lvMh, resinBedHeightM, regenCycleH, chelateConfig, safeQ]);

  const filterCalc = useMemo(() => {
    // Candle mode
    const flux = clampNum(candleFlux, 0.2, 6.0, 1.2);
    const odMm = clampNum(candleOdMm, 25, 150, 60);
    const cLenM = clampNum(candleLenM, 0.5, 3.0, 1.5);
    const cCycleH = clampNum(candleCycleH, 1, 72, 8);
    const cDpBar = clampNum(candleDeltaPBar, 0.05, 3.0, 0.5);

    const reqAreaM2 = safeQ / flux;
    const singleCandleAreaM2 = Math.PI * (odMm / 1000) * cLenM;
    const candleCount = Math.max(7, Math.ceil(reqAreaM2 / Math.max(0.01, singleCandleAreaM2)));
    const actualAreaM2 = candleCount * singleCandleAreaM2;
    const actualFlux = safeQ / Math.max(0.01, actualAreaM2);
    const pitchM = (odMm / 1000) * 1.65;
    const bundleDiaM = Math.sqrt(candleCount / 0.72) * pitchM;
    const candleVesselIdM = Math.max(0.6, bundleDiaM + 0.26);
    const candleVesselHM = cLenM + 0.85 + (candleVesselIdM / 2) * 0.866;
    const backwashVolM3 = 1.25 * ((Math.PI / 4) * candleVesselIdM * candleVesselIdM * cLenM);

    // Carbon mode
    const ebct = clampNum(ebctMin, 3, 60, 15);
    const carbLv = clampNum(carbonLvMh, 3, 30, 12);
    const carbDepth = clampNum(carbonBedDepthM, 0.8, 4.5, 2.0);
    const carbRho = clampNum(carbonBulkDensity, 300, 700, 480);
    const carbDpBar = clampNum(carbonDeltaPBar, 0.05, 2.5, 0.4);

    const volEbct = safeQ * (ebct / 60);
    const areaLv = safeQ / carbLv;
    const areaEbct = volEbct / carbDepth;
    const carbGovAreaM2 = Math.max(areaLv, areaEbct);
    const carbonBedVolM3 = carbGovAreaM2 * carbDepth;
    const carbonChargeKg = carbonBedVolM3 * carbRho;
    const carbonVesselIdM = Math.sqrt((4 * carbGovAreaM2) / Math.PI);
    const carbonFreeboardM = carbDepth * 0.4;
    const carbonVesselHM = carbDepth + carbonFreeboardM + 0.35 + 0.55;
    const actualEbctMin = (carbonBedVolM3 / safeQ) * 60;
    const actualCarbLv = safeQ / Math.max(0.01, carbGovAreaM2);

    return {
      candle: {
        flux,
        odMm,
        cLenM,
        cCycleH,
        cDpBar,
        reqAreaM2,
        actualAreaM2,
        actualFlux,
        candleCount,
        vesselIdM: candleVesselIdM,
        vesselHM: candleVesselHM,
        backwashVolM3,
      },
      carbon: {
        ebct,
        carbLv,
        carbDepth,
        carbRho,
        carbDpBar,
        carbonBedVolM3,
        carbonChargeKg,
        vesselIdM: carbonVesselIdM,
        vesselHM: carbonVesselHM,
        freeboardM: carbonFreeboardM,
        actualEbctMin,
        actualCarbLv,
      },
    };
  }, [
    candleFlux,
    candleOdMm,
    candleLenM,
    candleCycleH,
    candleDeltaPBar,
    ebctMin,
    carbonLvMh,
    carbonBedDepthM,
    carbonBulkDensity,
    carbonDeltaPBar,
    safeQ,
  ]);

  if (!open) return null;

  const unitTitleMeta = (() => {
    if (unitType === 'saturator') {
      return {
        badge: isEn ? 'SATURATOR & CLARIFIER' : '포화조 · 1차 침전정제',
        badgeBg: 'rgba(14, 165, 233, 0.18)',
        badgeFg: '#7DD3FC',
        badgeBd: 'rgba(56, 189, 248, 0.45)',
      };
    }
    if (unitType === 'chelate_tower') {
      return {
        badge: isEn ? 'CHELATE RESIN IX TOWER' : '2차 킬레이트 수지탑',
        badgeBg: 'rgba(16, 185, 129, 0.18)',
        badgeFg: '#6EE7B7',
        badgeBd: 'rgba(52, 211, 153, 0.45)',
      };
    }
    return {
      badge:
        filterMode === 'carbon'
          ? isEn
            ? 'ACTIVATED CARBON FILTER'
            : '활성탄 카본 필터'
          : isEn
            ? 'PRE-COAT CANDLE FILTER'
            : '프리코트 캔들 필터',
      badgeBg: 'rgba(139, 92, 246, 0.22)',
      badgeFg: '#DDD6FE',
      badgeBd: 'rgba(167, 139, 250, 0.48)',
    };
  })();

  const handleApply = () => {
    if (unitType === 'saturator') {
      onApplyParams({
        targetBrineWtPct: Number(satCalc.wt.toFixed(2)),
      });
    } else if (unitType === 'chelate_tower') {
      onApplyParams({
        resinVolM3: Number(chelateCalc.resinVolM3.toFixed(2)),
        columnDeltaPKgcm2: Number((chelateCalc.deltaPBar * 1.01972).toFixed(3)),
      });
    } else {
      if (filterMode === 'carbon') {
        onApplyParams({
          filterMode: 'carbon',
          filterDeltaPBar: Number(filterCalc.carbon.carbDpBar.toFixed(2)),
        });
      } else {
        onApplyParams({
          filterMode: 'candle',
          filterDeltaPBar: Number(filterCalc.candle.cDpBar.toFixed(2)),
          filterFluxM3M2H: Number(filterCalc.candle.flux.toFixed(2)),
        });
      }
    }
    onClose();
  };

  // ── ExcelJS Datasheet Export ──
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ChemPlant Studio';
      wb.created = new Date();

      const sheetName =
        unitType === 'saturator'
          ? 'Saturator_Datasheet'
          : unitType === 'chelate_tower'
            ? 'Chelate_Tower_Datasheet'
            : filterMode === 'carbon'
              ? 'Carbon_Filter_Datasheet'
              : 'Candle_Filter_Datasheet';

      const ws = wb.addWorksheet(sheetName, {
        pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', ySplit: 3 }],
      });

      ws.columns = [
        { width: 8 },
        { width: 34 },
        { width: 16 },
        { width: 22 },
        { width: 28 },
      ];

      const rows: (string | number)[][] = [];
      const docTitle =
        unitType === 'saturator'
          ? `BRINE SATURATOR & CLARIFIER ENGINEERING DATASHEET — [${tag}] ${name}`
          : unitType === 'chelate_tower'
            ? `CHELATE ION-EXCHANGE RESIN TOWER DATASHEET — [${tag}] ${name}`
            : filterMode === 'carbon'
              ? `ACTIVATED CARBON BED FILTER DATASHEET — [${tag}] ${name}`
              : `PRE-COAT CANDLE FILTER ENGINEERING DATASHEET — [${tag}] ${name}`;

      rows.push([docTitle]);
      rows.push(['No.', 'Specification Item', 'Unit', 'Design Value', 'Basis / Notes']);
      rows.push(['', '1. PROCESS & INLET STREAM CONDITIONS']);
      rows.push([1, 'Equipment Tag / Service', '-', `${tag} / ${name}`, unitTitleMeta.badge]);
      rows.push([2, 'Inlet Mass Flowrate', 'kg/h', Number(safeM.toFixed(1)), 'From Flowsheet Solver']);
      rows.push([3, 'Inlet Volumetric Flowrate', 'm³/h', Number(safeQ.toFixed(2)), 'Operating condition']);
      rows.push([4, 'Operating Temperature', '°C', Number(safeT.toFixed(1)), 'Design T = Oper T + 20°C']);
      rows.push([5, 'Operating Pressure', 'kg/cm²G', Number(safeP.toFixed(2)), 'Design P = max(3.5, Oper P + 1.5)']);
      rows.push([6, 'Fluid Density', 'kg/m³', Number(safeRho.toFixed(1)), 'Operating fluid density']);

      rows.push(['']);
      rows.push(['', '2. EQUIPMENT SIZING & MECHANICAL SPECIFICATION']);

      if (unitType === 'saturator') {
        rows.push([7, 'Target Brine Concentration', 'wt% NaCl', Number(satCalc.wt.toFixed(2)), 'Saturated brine target']);
        rows.push([8, 'Hydraulic Residence Time (τ)', 'min', satCalc.tau, 'Active dissolution & settling']);
        rows.push([9, 'Active Liquid Volume', 'm³', Number(satCalc.activeVolM3.toFixed(2)), 'Q × τ / 60']);
        rows.push([10, 'Total Vessel Volume (incl. 18% FB)', 'm³', Number(satCalc.totalVolM3.toFixed(2)), 'Flat-top conical bottom']);
        rows.push([11, 'Tank Inner Diameter (ØD)', 'm', Number(satCalc.tankIdM.toFixed(2)), `H/D = ${satCalc.hd.toFixed(2)}`]);
        rows.push([12, 'Straight Side Height (H_ss)', 'm', Number(satCalc.straightSideM.toFixed(2)), 'Cylindrical shell']);
        rows.push([13, 'Cone Bottom Height (H_cone)', 'm', Number(satCalc.coneHeightM.toFixed(2)), `Cone angle ${satCalc.coneDeg}°`]);
        rows.push([14, 'Overall Vessel Height', 'm', Number(satCalc.totalHeightM.toFixed(2)), 'H_ss + H_cone']);
        rows.push([15, 'Agitator Shaft Power', 'kW', Number(satCalc.agitatorKw.toFixed(2)), `${satCalc.specKw.toFixed(2)} kW/m³`]);
        rows.push([16, 'Salt Dissolution Rate (Est.)', 'kg/h', Number(satCalc.saltDissolutionKgH.toFixed(1)), 'From 17.5 wt% depleted brine']);
        rows.push([17, 'Sludge Blowdown Rate', 'kg/h', Number(satCalc.sludgeBlowdownKgH.toFixed(1)), 'CaCO₃ / Mg(OH)₂ precipitate']);
        rows.push([18, 'Vessel Metallurgy', '-', satMetallurgy, 'Brine corrosion-resistant']);
      } else if (unitType === 'chelate_tower') {
        rows.push([7, 'Tower Configuration', '-', chelateConfig, `${chelateCalc.towerCount} vessels total`]);
        rows.push([8, 'Chelating Resin Type', '-', resinType, 'Macroporous selective resin']);
        rows.push([9, 'Space Velocity (Actual / Design)', 'BV/h', `${chelateCalc.actualSv.toFixed(1)} / ${chelateCalc.sv}`, 'Target ≤ 20 BV/h']);
        rows.push([10, 'Linear Velocity (Actual / Design)', 'm/h', `${chelateCalc.actualLv.toFixed(1)} / ${chelateCalc.lv}`, 'Superficial downward velocity']);
        rows.push([11, 'Resin Volume per Tower', 'm³/tower', Number(chelateCalc.resinVolM3.toFixed(2)), 'Governing SV/LV basis']);
        rows.push([12, 'Resin Bed Height', 'm', Number(chelateCalc.hBed.toFixed(2)), 'Static bed depth']);
        rows.push([13, 'Tower Inner Diameter (ØD)', 'm', Number(chelateCalc.towerIdM.toFixed(2)), 'Vertical pressure vessel']);
        rows.push([14, 'Vessel T-T Height (H_TT)', 'm', Number(chelateCalc.vesselTTH.toFixed(2)), 'Incl. 50% backwash freeboard']);
        rows.push([15, 'Clean Bed Pressure Drop (ΔP)', 'bar', Number(chelateCalc.deltaPBar.toFixed(2)), 'Across resin + underdrain']);
        rows.push([16, 'Regeneration Cycle', 'h', chelateCalc.cycleH, 'Acid-Caustic regeneration']);
        rows.push([17, '32% HCl Consumption', 'kg/day', Number(chelateCalc.hcl32KgDay.toFixed(1)), '120 kg 100% HCl/m³·cycle']);
        rows.push([18, '32% NaOH Consumption', 'kg/day', Number(chelateCalc.naoh32KgDay.toFixed(1)), '100 kg 100% NaOH/m³·cycle']);
        rows.push([19, 'Vessel Metallurgy', '-', chelateMetallurgy, 'Acid/brine lined']);
        rows.push([20, 'Outlet Hardness Guarantee', 'ppb', 'Ca+Mg < 20 ppb', chelateCalc.svOk ? 'Membrane protection PASS' : 'Check SV limit']);
      } else if (filterMode === 'candle') {
        rows.push([7, 'Filtration Mode', '-', 'Pre-coat Candle Filter', 'α-cellulose / diatomite pre-coat']);
        rows.push([8, 'Design / Actual Flux', 'm³/m²·h', `${filterCalc.candle.flux.toFixed(2)} / ${filterCalc.candle.actualFlux.toFixed(2)}`, 'Surface filtration flux']);
        rows.push([9, 'Required / Installed Area', 'm²', `${filterCalc.candle.reqAreaM2.toFixed(1)} / ${filterCalc.candle.actualAreaM2.toFixed(1)}`, 'Active cloth area']);
        rows.push([10, 'Candle Element Dimensions', 'mm × m', `Ø${filterCalc.candle.odMm} × ${filterCalc.candle.cLenM.toFixed(2)} m`, 'PP / PVDF cloth sock']);
        rows.push([11, 'Number of Candle Elements', 'EA', filterCalc.candle.candleCount, 'Triangular pitch bundle']);
        rows.push([12, 'Vessel Dimensions (ØD × H)', 'm', `Ø${filterCalc.candle.vesselIdM.toFixed(2)} × ${filterCalc.candle.vesselHM.toFixed(2)} m`, 'Tube sheet + cone bottom']);
        rows.push([13, 'Filtration Cycle', 'h', filterCalc.candle.cCycleH, 'Before cake discharge']);
        rows.push([14, 'Design Pressure Drop (ΔP)', 'bar', Number(filterCalc.candle.cDpBar.toFixed(2)), 'End-of-cycle ΔP']);
        rows.push([15, 'Backwash / Heel Volume', 'm³/cycle', Number(filterCalc.candle.backwashVolM3.toFixed(2)), 'Per regeneration cycle']);
        rows.push([16, 'Vessel Metallurgy', '-', candleMaterial, 'Corrosion-resistant shell']);
        rows.push([17, 'Outlet Clarity Guarantee', 'ppm', 'TSS < 1 ppm', 'Polished brine clarity']);
      } else {
        rows.push([7, 'Filtration Mode', '-', 'Activated Carbon Bed', 'Granular activated carbon (GAC)']);
        rows.push([8, 'EBCT (Design / Actual)', 'min', `${filterCalc.carbon.ebct} / ${filterCalc.carbon.actualEbctMin.toFixed(1)}`, 'Empty Bed Contact Time']);
        rows.push([9, 'Superficial Velocity (LV)', 'm/h', `${filterCalc.carbon.actualCarbLv.toFixed(1)} (max ${filterCalc.carbon.carbLv})`, 'Downflow filtration']);
        rows.push([10, 'Carbon Bed Depth', 'm', Number(filterCalc.carbon.carbDepth.toFixed(2)), 'Plus 0.35 m support gravel']);
        rows.push([11, 'Carbon Bed Volume', 'm³', Number(filterCalc.carbon.carbonBedVolM3.toFixed(2)), 'Governing EBCT/LV basis']);
        rows.push([12, 'Carbon Charge Mass', 'kg', Number(filterCalc.carbon.carbonChargeKg.toFixed(0)), `Bulk density ${filterCalc.carbon.carbRho} kg/m³`]);
        rows.push([13, 'Vessel Dimensions (ØD × H)', 'm', `Ø${filterCalc.carbon.vesselIdM.toFixed(2)} × ${filterCalc.carbon.vesselHM.toFixed(2)} m`, 'Incl. 40% backwash expansion']);
        rows.push([14, 'Design Pressure Drop (ΔP)', 'bar', Number(filterCalc.carbon.carbDpBar.toFixed(2)), 'Clean-to-fouled bed ΔP']);
        rows.push([15, 'Vessel Metallurgy', '-', carbonMaterial, 'Corrosion-resistant shell']);
        rows.push([16, 'Outlet Guarantee', 'ppm', 'Free Cl₂ < 0.1 ppm', 'Dechlorination / organic removal']);
      }

      rows.push(...ENGINEERING_DISCLAIMER_ROWS);

      const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };

      const disclaimerStartIdx = rows.length - ENGINEERING_DISCLAIMER_ROWS.length;

      rows.forEach((rawRow, rIdx) => {
        const padded = Array.from({ length: 5 }, (_, ci) => rawRow[ci] ?? '');
        const row = ws.addRow(padded);
        const c1 = String(padded[0] ?? '').trim();
        const c2 = String(padded[1] ?? '').trim();

        if (rIdx === 0) {
          row.height = 28;
          ws.mergeCells(row.number, 1, row.number, 5);
          const c = row.getCell(1);
          c.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = thinBorder;
        } else if (rIdx === 1) {
          row.height = 22;
          row.eachCell((cell, colNum) => {
            cell.font = { name: 'Arial', bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            cell.alignment = { horizontal: colNum === 2 || colNum === 5 ? 'left' : 'center', vertical: 'middle' };
            cell.border = thinBorder;
          });
        } else if (c1 === '' && (c2.startsWith('1.') || c2.startsWith('2.'))) {
          row.height = 20;
          ws.mergeCells(row.number, 1, row.number, 5);
          const c = row.getCell(1);
          c.value = c2;
          c.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF1E3A8A' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
          c.alignment = { horizontal: 'left', vertical: 'middle' };
          c.border = thinBorder;
        } else if (padded.every((v) => String(v).trim() === '')) {
          row.height = 8;
        } else if (rIdx >= disclaimerStartIdx) {
          row.height = 19;
          ws.mergeCells(row.number, 1, row.number, 5);
          const c = row.getCell(1);
          c.value = padded.filter((v) => String(v).trim() !== '').join(' ');
          c.font = { name: 'Arial', italic: true, size: 8.5, color: { argb: 'FF78350F' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
          c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          c.border = thinBorder;
        } else {
          row.height = 19;
          const isZebra = rIdx % 2 === 1;
          row.eachCell((cell, colNum) => {
            cell.font = {
              name: colNum === 4 ? 'Consolas' : 'Arial',
              bold: colNum === 2 || colNum === 4,
              size: 9.5,
              color: { argb: colNum === 1 ? 'FF475569' : 'FF0F172A' },
            };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isZebra ? 'FFF8FAFC' : 'FFFFFFFF' } };
            cell.alignment = {
              horizontal: colNum === 1 || colNum === 3 ? 'center' : colNum === 4 ? 'right' : 'left',
              vertical: 'middle',
            };
            cell.border = thinBorder;
          });
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tag.replace(/[^a-zA-Z0-9_-]/g, '_')}_${sheetName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // ── KPI Cards Data ──
  const kpiCards = (() => {
    if (unitType === 'saturator') {
      return [
        {
          label: isEn ? 'Active Volume' : '유효 용적',
          value: `${satCalc.activeVolM3.toFixed(1)} m³`,
          sub: `${isEn ? 'Total' : '전체'} ${satCalc.totalVolM3.toFixed(1)} m³`,
          accent: '#0284C7',
        },
        {
          label: isEn ? 'Tank Dimensions' : '탱크 규격 (ØD × H)',
          value: `Ø${satCalc.tankIdM.toFixed(2)} × ${satCalc.totalHeightM.toFixed(2)} m`,
          sub: `Hss ${satCalc.straightSideM.toFixed(2)} + Cone ${satCalc.coneHeightM.toFixed(2)} m`,
          accent: '#1D4ED8',
        },
        {
          label: isEn ? 'Agitator Power' : '교반기 동력',
          value: `${satCalc.agitatorKw.toFixed(1)} kW`,
          sub: `${satCalc.specKw.toFixed(2)} kW/m³ · ${satMetallurgy}`,
          accent: '#D97706',
        },
        {
          label: isEn ? 'Salt Dissolution' : '원염 용해량',
          value: `${(satCalc.saltDissolutionKgH / 1000).toFixed(2)} t/h`,
          sub: `${isEn ? 'Sludge' : '슬러지'} ${satCalc.sludgeBlowdownKgH.toFixed(0)} kg/h`,
          accent: '#059669',
        },
      ];
    }
    if (unitType === 'chelate_tower') {
      return [
        {
          label: isEn ? 'Resin Volume / Tower' : '수지 충진량 / 탑',
          value: `${chelateCalc.resinVolM3.toFixed(2)} m³`,
          sub: `SV ${chelateCalc.actualSv.toFixed(1)} BV/h · LV ${chelateCalc.actualLv.toFixed(1)} m/h`,
          accent: '#059669',
        },
        {
          label: isEn ? 'Tower Size (ØD × T-T)' : '수지탑 규격 (ØD × H)',
          value: `Ø${chelateCalc.towerIdM.toFixed(2)} × ${chelateCalc.vesselTTH.toFixed(2)} m`,
          sub: `${chelateConfig} (${chelateCalc.towerCount} EA)`,
          accent: '#1D4ED8',
        },
        {
          label: isEn ? 'Regen Chemicals / Day' : '일일 재생약품 (32%)',
          value: `HCl ${chelateCalc.hcl32KgDay.toFixed(0)} kg`,
          sub: `NaOH ${chelateCalc.naoh32KgDay.toFixed(0)} kg/d · ΔP ${chelateCalc.deltaPBar.toFixed(2)} bar`,
          accent: '#D97706',
        },
        {
          label: isEn ? 'Outlet Hardness' : '출구 경도 보증',
          value: 'Ca+Mg < 20 ppb',
          sub: chelateCalc.svOk
            ? isEn
              ? 'Membrane protection OK ✓'
              : '이온교환막 보호 기준 합격 ✓'
            : isEn
              ? 'Warning: High SV (>22 BV/h)'
              : '주의: 공간속도 과다 (>22 BV/h)',
          accent: chelateCalc.svOk ? '#0D9488' : '#DC2626',
        },
      ];
    }
    if (filterMode === 'candle') {
      return [
        {
          label: isEn ? 'Filtration Area' : '필요 여과면적',
          value: `${filterCalc.candle.reqAreaM2.toFixed(1)} m²`,
          sub: `${isEn ? 'Installed' : '설계'} ${filterCalc.candle.actualAreaM2.toFixed(1)} m² (${filterCalc.candle.actualFlux.toFixed(2)} m³/m²·h)`,
          accent: '#7C3AED',
        },
        {
          label: isEn ? 'Candle Elements' : '캔들 소자 수량',
          value: `${filterCalc.candle.candleCount} EA`,
          sub: `Ø${filterCalc.candle.odMm} mm × ${filterCalc.candle.cLenM.toFixed(2)} m`,
          accent: '#1D4ED8',
        },
        {
          label: isEn ? 'Vessel Size (ØD × H)' : '필터 용기 (ØD × H)',
          value: `Ø${filterCalc.candle.vesselIdM.toFixed(2)} × ${filterCalc.candle.vesselHM.toFixed(2)} m`,
          sub: `${isEn ? 'Backwash' : '역세수'} ${filterCalc.candle.backwashVolM3.toFixed(1)} m³/cyc`,
          accent: '#0284C7',
        },
        {
          label: isEn ? 'Outlet Clarity' : '출구 청정도',
          value: 'TSS < 1 ppm',
          sub: `ΔP ${filterCalc.candle.cDpBar.toFixed(2)} bar · ${candleMaterial}`,
          accent: '#059669',
        },
      ];
    }
    return [
      {
        label: isEn ? 'Carbon Bed Volume' : '활성탄 충진 부피',
        value: `${filterCalc.carbon.carbonBedVolM3.toFixed(2)} m³`,
        sub: `EBCT ${filterCalc.carbon.actualEbctMin.toFixed(1)} min · LV ${filterCalc.carbon.actualCarbLv.toFixed(1)} m/h`,
        accent: '#7C3AED',
      },
      {
        label: isEn ? 'Carbon Charge' : '활성탄 충진 중량',
        value: `${filterCalc.carbon.carbonChargeKg.toFixed(0)} kg`,
        sub: `${(filterCalc.carbon.carbonChargeKg / 1000).toFixed(2)} ton (${filterCalc.carbon.carbRho} kg/m³)`,
        accent: '#334155',
      },
      {
        label: isEn ? 'Vessel Size (ØD × H)' : '베드 용기 (ØD × H)',
        value: `Ø${filterCalc.carbon.vesselIdM.toFixed(2)} × ${filterCalc.carbon.vesselHM.toFixed(2)} m`,
        sub: `${isEn ? 'Bed' : '층고'} ${filterCalc.carbon.carbDepth.toFixed(2)} m + 40% FB`,
        accent: '#0284C7',
      },
      {
        label: isEn ? 'Outlet Guarantee' : '출구 탈염소 보증',
        value: 'Free Cl₂ < 0.1 ppm',
        sub: `ΔP ${filterCalc.carbon.carbDpBar.toFixed(2)} bar · ${carbonMaterial}`,
        accent: '#059669',
      },
    ];
  })();

  // ── CAD SVG Renderers ──
  const renderCadSvg = () => {
    const svgStyle: React.CSSProperties = {
      width: '100%',
      height: 310,
      background: '#FFFFFF',
      border: '1px solid #CBD5E1',
      borderRadius: 8,
      display: 'block',
    };

    if (unitType === 'saturator') {
      return (
        <svg viewBox="0 0 560 320" style={svgStyle}>
          <defs>
            <pattern id="purGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F1F5F9" strokeWidth="1" />
            </pattern>
            <linearGradient id="brineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          <rect width="560" height="320" fill="url(#purGrid)" />

          {/* Title block */}
          <text x="16" y="22" fontSize="11" fontWeight="800" fill="#0F172A">
            {satType === 'agitated_dissolver'
              ? isEn
                ? `CAD ELEVATION — [${tag}] AGITATED BRINE DISSOLVER`
                : `CAD 입면도 — [${tag}] 교반식 원염 용해조`
              : satType === 'vertical_cyl'
                ? isEn
                  ? `CAD ELEVATION — [${tag}] VERTICAL SALT-BED SATURATOR`
                  : `CAD 입면도 — [${tag}] 수직 원통형 염상 포화조`
                : isEn
                  ? `CAD ELEVATION — [${tag}] CONVENTIONAL UPFLOW SALT-BED SATURATOR`
                  : `CAD 입면도 — [${tag}] 컨벤셔널 상향류 염상 포화조`}
          </text>
          <text x="16" y="36" fontSize="9.5" fill="#64748B" fontFamily={MONO}>
            {satType === 'agitated_dissolver'
              ? `${satMetallurgy} | ${satCalc.nUnits} EA | Ø${satCalc.tankIdM.toFixed(2)}m × Hss ${satCalc.straightSideM.toFixed(2)}m + Cone ${satCalc.coneHeightM.toFixed(2)}m`
              : `${satMetallurgy} | ${satCalc.nUnits} EA | Ø${satCalc.tankIdM.toFixed(2)}m × H ${satCalc.straightSideM.toFixed(2)}m | v_up=${satCalc.riseVelMh.toFixed(1)} m/h | Salt ${satCalc.saltInventoryTon.toFixed(0)}t`}
          </text>

          {satType !== 'agitated_dissolver' ? (
            <>
              {/* Wide upflow salt-bed saturator basin */}
              <rect x="135" y="102" width="270" height="58" fill="url(#brineGrad)" />
              <rect x="135" y="160" width="270" height="108" fill="#FEF3C7" />
              {/* Salt bed crystals texture */}
              <line x1="135" y1="160" x2="405" y2="160" stroke="#D97706" strokeWidth="1.5" strokeDasharray="5 3" />
              <text x="270" y="210" textAnchor="middle" fontSize="10" fontWeight="800" fill="#92400E" fontFamily={MONO}>
                {isEn ? `SALT BED (${satCalc.saltBedHeightM.toFixed(1)} m · ${satCalc.saltInventoryTon.toFixed(0)} t)` : `원염층 Salt Bed (${satCalc.saltBedHeightM.toFixed(1)} m · ${satCalc.saltInventoryTon.toFixed(0)} t)`}
              </text>
              <text x="270" y="135" textAnchor="middle" fontSize="9.2" fontWeight="800" fill="#0369A1" fontFamily={MONO}>
                {isEn ? `CLEAR BRINE ZONE (${satCalc.clearZoneM.toFixed(1)} m · v=${satCalc.riseVelMh.toFixed(1)} m/h)` : `상부 정징층 (${satCalc.clearZoneM.toFixed(1)} m · 상승유속 ${satCalc.riseVelMh.toFixed(1)} m/h)`}
              </text>
              {/* Vessel shell */}
              <rect x="135" y="82" width="270" height="186" fill="none" stroke="#0F172A" strokeWidth="2.3" />
              {/* Bottom sparger distributor header */}
              <line x1="150" y1="256" x2="390" y2="256" stroke="#1D4ED8" strokeWidth="3" strokeDasharray="6 4" />
              {/* Upflow arrows */}
              {[180, 240, 300, 360].map((ax) => (
                <g key={ax}>
                  <line x1={ax} y1="248" x2={ax} y2="226" stroke="#1D4ED8" strokeWidth="1.4" />
                  <polygon points={`${ax},222 ${ax - 3.5},229 ${ax + 3.5},229`} fill="#1D4ED8" />
                </g>
              ))}
              {/* N1 Depleted Brine Bottom Inlet */}
              <line x1="78" y1="256" x2="135" y2="256" stroke="#1D4ED8" strokeWidth="2.2" />
              <polygon points="133,256 125,252 125,260" fill="#1D4ED8" />
              <text x="16" y="251" fontSize="8.8" fontWeight="800" fill="#1D4ED8">N1: {isEn ? 'Depleted Brine' : '희박염수 유입'}</text>
              <text x="16" y="263" fontSize="8.2" fill="#475569" fontFamily={MONO}>{safeQ.toFixed(1)} m³/h</text>
              {/* Top Raw Salt Feed */}
              <line x1="270" y1="48" x2="270" y2="80" stroke="#B45309" strokeWidth="2.2" />
              <polygon points="270,82 266,74 274,74" fill="#B45309" />
              <text x="278" y="61" fontSize="8.8" fontWeight="800" fill="#B45309">
                {isEn ? `Raw Salt Feed (${satCalc.saltDissolutionKgH.toFixed(0)} kg/h)` : `원염 투입 (${satCalc.saltDissolutionKgH.toFixed(0)} kg/h)`}
              </text>
              {/* N2 Saturated Brine Overflow */}
              <line x1="405" y1="115" x2="452" y2="115" stroke="#059669" strokeWidth="2.2" />
              <polygon points="454,115 446,111 446,119" fill="#059669" />
              <text x="458" y="112" fontSize="8.8" fontWeight="800" fill="#059669">N2: {isEn ? 'Sat. Brine' : '포화염수'}</text>
              <text x="458" y="124" fontSize="8.2" fill="#475569" fontFamily={MONO}>{satCalc.wt.toFixed(1)} wt%</text>
              {/* Dimensions */}
              <line x1="135" y1="286" x2="405" y2="286" stroke="#334155" strokeWidth="1.1" />
              <text x="270" y="301" textAnchor="middle" fontSize="10" fontWeight="900" fill="#0F172A" fontFamily={MONO}>
                ØD = {satCalc.tankIdM.toFixed(2)} m ({satCalc.nUnits} EA)
              </text>
              <line x1="422" y1="82" x2="422" y2="268" stroke="#334155" strokeWidth="1.1" />
              <text x="430" y="182" fontSize="9.2" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
                H = {satCalc.straightSideM.toFixed(2)} m
              </text>
            </>
          ) : (
            <>
          {/* Liquid fill inside cylinder + cone */}
          <path d="M 185 112 L 355 112 L 355 215 L 285 280 L 255 280 L 185 215 Z" fill="url(#brineGrad)" />
          {/* Sludge layer at cone bottom */}
          <path d="M 232 258 L 308 258 L 285 280 L 255 280 Z" fill="#CBD5E1" />
          {/* Liquid level line */}
          <line x1="185" y1="112" x2="355" y2="112" stroke="#0284C7" strokeWidth="1.5" strokeDasharray="6 3" />
          <text x="360" y="115" fontSize="8.5" fontWeight="700" fill="#0284C7" fontFamily={MONO}>
            NLL 82%
          </text>

          {/* Flat-top cylindrical + conical vessel outline */}
          <path
            d="M 185 82 L 355 82 L 355 215 L 285 280 L 255 280 L 185 215 Z"
            fill="none"
            stroke="#0F172A"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Wall baffles */}
          <rect x="186" y="105" width="9" height="102" fill="#94A3B8" opacity="0.55" />
          <rect x="345" y="105" width="9" height="102" fill="#94A3B8" opacity="0.55" />

          {/* Agitator motor + gearbox + shaft + PBT impeller */}
          <rect x="255" y="42" width="30" height="22" rx="3" fill="#1E293B" />
          <rect x="261" y="64" width="18" height="18" fill="#475569" />
          <text x="292" y="57" fontSize="9" fontWeight="800" fill="#D97706" fontFamily={MONO}>
            M {satCalc.agitatorKw.toFixed(1)} kW
          </text>
          <line x1="270" y1="82" x2="270" y2="215" stroke="#1E293B" strokeWidth="2.4" />
          {/* Upper & lower impeller blades */}
          <path d="M 236 155 L 304 163 M 236 163 L 304 155" stroke="#0F172A" strokeWidth="2.8" />
          <path d="M 232 206 L 308 214 M 232 214 L 308 206" stroke="#0F172A" strokeWidth="3.2" />

          {/* Nozzles N1-N4 */}
          {/* N1 Feed */}
          <line x1="140" y1="98" x2="185" y2="98" stroke="#1D4ED8" strokeWidth="2.2" />
          <polygon points="183,98 175,94 175,102" fill="#1D4ED8" />
          <text x="58" y="95" fontSize="9" fontWeight="800" fill="#1D4ED8">N1: {isEn ? 'Brine + Salt' : '희박염수+원염'}</text>
          <text x="58" y="107" fontSize="8.5" fill="#475569" fontFamily={MONO}>{safeQ.toFixed(1)} m³/h</text>

          {/* N3 Reagent */}
          <line x1="215" y1="58" x2="215" y2="82" stroke="#0D9488" strokeWidth="2" />
          <text x="155" y="54" fontSize="8.5" fontWeight="800" fill="#0D9488">N3: Na₂CO₃/NaOH</text>

          {/* N2 Overflow Outlet */}
          <line x1="355" y1="126" x2="412" y2="126" stroke="#059669" strokeWidth="2.2" />
          <polygon points="414,126 406,122 406,130" fill="#059669" />
          <text x="418" y="123" fontSize="9" fontWeight="800" fill="#059669">N2: {isEn ? 'Sat. Brine Out' : '포화염수 출구'}</text>
          <text x="418" y="135" fontSize="8.5" fill="#475569" fontFamily={MONO}>{satCalc.wt.toFixed(1)} wt% NaCl</text>

          {/* N4 Sludge Blowdown */}
          <line x1="270" y1="280" x2="270" y2="306" stroke="#64748B" strokeWidth="2.2" />
          <polygon points="270,308 266,300 274,300" fill="#64748B" />
          <text x="282" y="304" fontSize="8.8" fontWeight="800" fill="#475569">
            N4: {isEn ? 'Sludge Blowdown' : '슬러지 배출'} ({satCalc.sludgeBlowdownKgH.toFixed(0)} kg/h)
          </text>

          {/* Dimensions */}
          {/* ØD */}
          <line x1="185" y1="295" x2="250" y2="295" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 2" />
          <line x1="185" y1="70" x2="355" y2="70" stroke="#334155" strokeWidth="1" />
          <text x="270" y="66" textAnchor="middle" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            ØD = {satCalc.tankIdM.toFixed(2)} m
          </text>

          {/* H_ss */}
          <line x1="395" y1="82" x2="395" y2="215" stroke="#334155" strokeWidth="1.1" />
          <line x1="390" y1="82" x2="400" y2="82" stroke="#334155" strokeWidth="1.1" />
          <line x1="390" y1="215" x2="400" y2="215" stroke="#334155" strokeWidth="1.1" />
          <text x="404" y="168" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            Hss {satCalc.straightSideM.toFixed(2)} m
          </text>

          {/* H_cone */}
          <line x1="395" y1="215" x2="395" y2="280" stroke="#334155" strokeWidth="1.1" />
          <line x1="390" y1="280" x2="400" y2="280" stroke="#334155" strokeWidth="1.1" />
          <text x="404" y="252" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            Hcone {satCalc.coneHeightM.toFixed(2)} m ({satCalc.coneDeg}°)
          </text>
            </>
          )}
        </svg>
      );
    }

    if (unitType === 'chelate_tower') {
      return (
        <svg viewBox="0 0 560 320" style={svgStyle}>
          <defs>
            <pattern id="ixGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F1F5F9" strokeWidth="1" />
            </pattern>
            <pattern id="resinDots" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2.5" cy="2.5" r="1.3" fill="#D97706" opacity="0.55" />
              <circle cx="6.5" cy="6.5" r="1.2" fill="#B45309" opacity="0.45" />
            </pattern>
            <pattern id="fbHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="#93C5FD" strokeWidth="1.5" opacity="0.55" />
            </pattern>
          </defs>
          <rect width="560" height="320" fill="url(#ixGrid)" />

          <text x="16" y="22" fontSize="11" fontWeight="800" fill="#0F172A">
            {isEn ? `CAD ELEVATION — [${tag}] CHELATE ION-EXCHANGE TOWER` : `CAD 입면도 — [${tag}] 2차 킬레이트 이온교환수지탑`}
          </text>
          <text x="16" y="36" fontSize="9.5" fill="#64748B" fontFamily={MONO}>
            {`${chelateConfig} | ${chelateMetallurgy} | Ø${chelateCalc.towerIdM.toFixed(2)}m × T-T ${chelateCalc.vesselTTH.toFixed(2)}m`}
          </text>

          {/* 50% Backwash freeboard zone */}
          <rect x="215" y="102" width="120" height="58" fill="url(#fbHatch)" />
          <text x="275" y="135" textAnchor="middle" fontSize="8.8" fontWeight="800" fill="#1D4ED8" fontFamily={MONO}>
            50% FREEBOARD ({chelateCalc.freeboardM.toFixed(2)} m)
          </text>

          {/* Resin bed layer */}
          <rect x="215" y="160" width="120" height="92" fill="#FEF3C7" />
          <rect x="215" y="160" width="120" height="92" fill="url(#resinDots)" />
          <line x1="215" y1="160" x2="335" y2="160" stroke="#B45309" strokeWidth="1.5" />
          <text x="275" y="203" textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#92400E">
            {resinType}
          </text>
          <text x="275" y="218" textAnchor="middle" fontSize="8.8" fontWeight="700" fill="#78350F" fontFamily={MONO}>
            {chelateCalc.resinVolM3.toFixed(2)} m³ · H={chelateCalc.hBed.toFixed(2)}m
          </text>

          {/* Top distributor & bottom collector */}
          <line x1="230" y1="92" x2="320" y2="92" stroke="#0284C7" strokeWidth="2.5" />
          <line x1="216" y1="252" x2="334" y2="252" stroke="#0F172A" strokeWidth="2.5" strokeDasharray="4 2" />
          <text x="275" y="264" textAnchor="middle" fontSize="8" fontWeight="700" fill="#475569">
            {isEn ? 'Underdrain Collector Plate' : '하부 집수 노즐 플레이트'}
          </text>

          {/* Elliptical heads + cylindrical shell */}
          <path
            d="M 215 84 C 215 54, 335 54, 335 84 L 335 258 C 335 288, 215 288, 215 258 Z"
            fill="none"
            stroke="#0F172A"
            strokeWidth="2.3"
          />
          {/* Support legs */}
          <line x1="226" y1="274" x2="226" y2="304" stroke="#334155" strokeWidth="3.5" />
          <line x1="324" y1="274" x2="324" y2="304" stroke="#334155" strokeWidth="3.5" />

          {/* Nozzles */}
          {/* N1 Top Feed */}
          <line x1="275" y1="42" x2="275" y2="62" stroke="#1D4ED8" strokeWidth="2.2" />
          <line x1="165" y1="42" x2="275" y2="42" stroke="#1D4ED8" strokeWidth="2.2" />
          <text x="48" y="45" fontSize="9" fontWeight="800" fill="#1D4ED8">
            N1: {isEn ? 'Brine Feed' : '1차 정제염수 유입'} ({safeQ.toFixed(1)} m³/h)
          </text>

          {/* N3 Regen HCl/NaOH */}
          <line x1="158" y1="152" x2="215" y2="152" stroke="#D97706" strokeWidth="2" />
          <text x="36" y="150" fontSize="8.8" fontWeight="800" fill="#B45309">N3: 32% HCl / NaOH</text>
          <text x="36" y="162" fontSize="8.2" fill="#64748B" fontFamily={MONO}>
            {isEn ? `Regen ${chelateCalc.cycleH}h cyc` : `재생주기 ${chelateCalc.cycleH}h`}
          </text>

          {/* N2 Bottom Outlet */}
          <line x1="275" y1="280" x2="275" y2="304" stroke="#059669" strokeWidth="2.2" />
          <line x1="275" y1="304" x2="380" y2="304" stroke="#059669" strokeWidth="2.2" />
          <polygon points="382,304 374,300 374,308" fill="#059669" />
          <text x="388" y="302" fontSize="9" fontWeight="800" fill="#059669">
            N2: {isEn ? 'Ultrapure Brine' : '초순수 브라인'}
          </text>
          <text x="388" y="313" fontSize="8.5" fill="#0F172A" fontFamily={MONO}>Ca+Mg &lt; 20 ppb</text>

          {/* Dimensions */}
          <line x1="215" y1="74" x2="335" y2="74" stroke="#334155" strokeWidth="1" />
          <text x="275" y="70" textAnchor="middle" fontSize="8.8" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            ØD = {chelateCalc.towerIdM.toFixed(2)} m
          </text>

          <line x1="376" y1="84" x2="376" y2="258" stroke="#334155" strokeWidth="1.1" />
          <line x1="371" y1="84" x2="381" y2="84" stroke="#334155" strokeWidth="1.1" />
          <line x1="371" y1="258" x2="381" y2="258" stroke="#334155" strokeWidth="1.1" />
          <text x="386" y="174" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            T-T {chelateCalc.vesselTTH.toFixed(2)} m
          </text>
          <text x="386" y="188" fontSize="8.5" fill="#475569" fontFamily={MONO}>
            SV {chelateCalc.actualSv.toFixed(1)} BV/h
          </text>
          <text x="386" y="201" fontSize="8.5" fill="#475569" fontFamily={MONO}>
            ΔP {chelateCalc.deltaPBar.toFixed(2)} bar
          </text>
        </svg>
      );
    }

    // ── Candle Filter vs Activated Carbon Filter CAD SVG ──
    if (filterMode === 'candle') {
      const candleXs = [232, 248, 264, 280, 296, 312];
      return (
        <svg viewBox="0 0 560 320" style={svgStyle}>
          <defs>
            <pattern id="cfGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F1F5F9" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="320" fill="url(#cfGrid)" />

          <text x="16" y="22" fontSize="11" fontWeight="800" fill="#0F172A">
            {isEn ? `CAD ELEVATION — [${tag}] PRE-COAT CANDLE FILTER` : `CAD 입면도 — [${tag}] 프리코트 캔들 필터`}
          </text>
          <text x="16" y="36" fontSize="9.5" fill="#64748B" fontFamily={MONO}>
            {`${candleMaterial} | Ø${filterCalc.candle.vesselIdM.toFixed(2)}m × H ${filterCalc.candle.vesselHM.toFixed(2)}m | ${filterCalc.candle.candleCount} Candles`}
          </text>

          {/* Liquid chamber */}
          <path d="M 212 104 L 332 104 L 332 224 L 284 276 L 260 276 L 212 224 Z" fill="#EDE9FE" opacity="0.65" />

          {/* Tube sheet plate */}
          <rect x="212" y="98" width="120" height="7" fill="#334155" />
          <text x="342" y="104" fontSize="8.3" fontWeight="800" fill="#334155">
            {isEn ? 'Tube Sheet' : '튜브시트'}
          </text>

          {/* Hanging candle elements */}
          {candleXs.map((cx) => (
            <g key={cx}>
              <rect x={cx - 4} y="105" width="8" height="108" rx="3" fill="#FFFFFF" stroke="#7C3AED" strokeWidth="1.6" />
              <line x1={cx} y1="108" x2={cx} y2="210" stroke="#C4B5FD" strokeWidth="1" strokeDasharray="3 2" />
            </g>
          ))}
          <text x="272" y="232" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#5B21B6" fontFamily={MONO}>
            {filterCalc.candle.candleCount} EA × Ø{filterCalc.candle.odMm}mm × {filterCalc.candle.cLenM.toFixed(2)}m
          </text>

          {/* Vessel shell: elliptical dome + cylinder + cone bottom */}
          <path
            d="M 212 88 C 212 56, 332 56, 332 88 L 332 224 L 284 276 L 260 276 L 212 224 Z"
            fill="none"
            stroke="#0F172A"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />

          {/* Nozzles */}
          {/* N1 Feed */}
          <line x1="152" y1="210" x2="212" y2="210" stroke="#1D4ED8" strokeWidth="2.2" />
          <polygon points="210,210 202,206 202,214" fill="#1D4ED8" />
          <text x="42" y="207" fontSize="9" fontWeight="800" fill="#1D4ED8">N1: {isEn ? 'Unfiltered Feed' : '원수/염수 유입'}</text>
          <text x="42" y="219" fontSize="8.5" fill="#475569" fontFamily={MONO}>{safeQ.toFixed(1)} m³/h</text>

          {/* N2 Filtrate Out */}
          <line x1="272" y1="44" x2="272" y2="64" stroke="#059669" strokeWidth="2.2" />
          <line x1="272" y1="44" x2="395" y2="44" stroke="#059669" strokeWidth="2.2" />
          <polygon points="397,44 389,40 389,48" fill="#059669" />
          <text x="403" y="47" fontSize="9" fontWeight="800" fill="#059669">N2: TSS &lt; 1 ppm</text>

          {/* N3 Backpulse Air */}
          <line x1="158" y1="78" x2="215" y2="78" stroke="#D97706" strokeWidth="1.9" />
          <text x="46" y="81" fontSize="8.5" fontWeight="800" fill="#B45309">N3: {isEn ? 'Air Backpulse' : '역세 압축공기'}</text>

          {/* N4 Cake Discharge */}
          <line x1="272" y1="276" x2="272" y2="305" stroke="#64748B" strokeWidth="2.2" />
          <text x="284" y="302" fontSize="8.8" fontWeight="800" fill="#475569">
            N4: {isEn ? 'Cake Discharge' : '케이크 배출'} ({filterCalc.candle.cCycleH}h cyc)
          </text>

          {/* Dimensions */}
          <line x1="395" y1="88" x2="395" y2="276" stroke="#334155" strokeWidth="1.1" />
          <line x1="390" y1="88" x2="400" y2="88" stroke="#334155" strokeWidth="1.1" />
          <line x1="390" y1="276" x2="400" y2="276" stroke="#334155" strokeWidth="1.1" />
          <text x="405" y="176" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
            H = {filterCalc.candle.vesselHM.toFixed(2)} m
          </text>
          <text x="405" y="191" fontSize="8.5" fill="#475569" fontFamily={MONO}>
            ØD = {filterCalc.candle.vesselIdM.toFixed(2)} m
          </text>
          <text x="405" y="205" fontSize="8.5" fill="#7C3AED" fontFamily={MONO}>
            Area {filterCalc.candle.actualAreaM2.toFixed(1)} m²
          </text>
        </svg>
      );
    }

    // Activated Carbon Bed CAD SVG
    return (
      <svg viewBox="0 0 560 320" style={svgStyle}>
        <defs>
          <pattern id="acGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F1F5F9" strokeWidth="1" />
          </pattern>
          <pattern id="carbonDots" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="#334155" opacity="0.7" />
            <circle cx="5.5" cy="5.5" r="1.2" fill="#0F172A" opacity="0.65" />
          </pattern>
        </defs>
        <rect width="560" height="320" fill="url(#acGrid)" />

        <text x="16" y="22" fontSize="11" fontWeight="800" fill="#0F172A">
          {isEn ? `CAD ELEVATION — [${tag}] ACTIVATED CARBON FILTER` : `CAD 입면도 — [${tag}] 활성탄 카본 필터`}
        </text>
        <text x="16" y="36" fontSize="9.5" fill="#64748B" fontFamily={MONO}>
          {`${carbonMaterial} | Ø${filterCalc.carbon.vesselIdM.toFixed(2)}m × H ${filterCalc.carbon.vesselHM.toFixed(2)}m | GAC ${filterCalc.carbon.carbonChargeKg.toFixed(0)} kg`}
        </text>

        {/* Freeboard 40% */}
        <rect x="212" y="96" width="124" height="44" fill="#E0F2FE" opacity="0.55" />
        <text x="274" y="122" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#0369A1" fontFamily={MONO}>
          40% BACKWASH FB ({filterCalc.carbon.freeboardM.toFixed(2)} m)
        </text>

        {/* Granular Activated Carbon Bed */}
        <rect x="212" y="140" width="124" height="96" fill="#CBD5E1" />
        <rect x="212" y="140" width="124" height="96" fill="url(#carbonDots)" />
        <rect x="226" y="176" width="96" height="26" rx="4" fill="rgba(15,23,42,0.82)" />
        <text x="274" y="192" textAnchor="middle" fontSize="8.8" fontWeight="800" fill="#FFFFFF" fontFamily={MONO}>
          GAC {filterCalc.carbon.carbonBedVolM3.toFixed(1)} m³
        </text>

        {/* Support Gravel Layer */}
        <rect x="212" y="236" width="124" height="20" fill="#94A3B8" opacity="0.7" />
        <text x="274" y="249" textAnchor="middle" fontSize="8" fontWeight="800" fill="#0F172A">
          {isEn ? 'Support Gravel (0.35 m)' : '지지 자갈층 (0.35 m)'}
        </text>

        {/* Top header + bottom underdrain */}
        <line x1="226" y1="88" x2="322" y2="88" stroke="#0284C7" strokeWidth="2.5" />
        <line x1="214" y1="256" x2="334" y2="256" stroke="#0F172A" strokeWidth="2.2" strokeDasharray="4 2" />

        {/* Vessel shell */}
        <path
          d="M 212 84 C 212 54, 336 54, 336 84 L 336 258 C 336 288, 212 288, 212 258 Z"
          fill="none"
          stroke="#0F172A"
          strokeWidth="2.3"
        />
        <line x1="224" y1="274" x2="224" y2="304" stroke="#334155" strokeWidth="3.5" />
        <line x1="324" y1="274" x2="324" y2="304" stroke="#334155" strokeWidth="3.5" />

        {/* Nozzles */}
        <line x1="160" y1="44" x2="274" y2="44" stroke="#1D4ED8" strokeWidth="2.2" />
        <line x1="274" y1="44" x2="274" y2="62" stroke="#1D4ED8" strokeWidth="2.2" />
        <text x="42" y="47" fontSize="9" fontWeight="800" fill="#1D4ED8">
          N1: {isEn ? 'Process Feed' : '공정 유입'} ({safeQ.toFixed(1)} m³/h)
        </text>

        <line x1="158" y1="112" x2="212" y2="112" stroke="#0284C7" strokeWidth="1.8" />
        <text x="42" y="115" fontSize="8.5" fontWeight="800" fill="#0369A1">
          N3: {isEn ? 'Backwash Out' : '역세 배출'}
        </text>

        <line x1="274" y1="280" x2="274" y2="304" stroke="#059669" strokeWidth="2.2" />
        <line x1="274" y1="304" x2="386" y2="304" stroke="#059669" strokeWidth="2.2" />
        <polygon points="388,304 380,300 380,308" fill="#059669" />
        <text x="394" y="302" fontSize="9" fontWeight="800" fill="#059669">
          N2: Free Cl₂ &lt; 0.1 ppm
        </text>

        {/* Dimensions */}
        <line x1="378" y1="84" x2="378" y2="258" stroke="#334155" strokeWidth="1.1" />
        <line x1="373" y1="84" x2="383" y2="84" stroke="#334155" strokeWidth="1.1" />
        <line x1="373" y1="258" x2="383" y2="258" stroke="#334155" strokeWidth="1.1" />
        <text x="388" y="166" fontSize="9" fontWeight="800" fill="#0F172A" fontFamily={MONO}>
          H = {filterCalc.carbon.vesselHM.toFixed(2)} m
        </text>
        <text x="388" y="180" fontSize="8.5" fill="#475569" fontFamily={MONO}>
          ØD = {filterCalc.carbon.vesselIdM.toFixed(2)} m
        </text>
        <text x="388" y="194" fontSize="8.5" fill="#475569" fontFamily={MONO}>
          Bed {filterCalc.carbon.carbDepth.toFixed(2)} m · EBCT {filterCalc.carbon.actualEbctMin.toFixed(1)}m
        </text>
      </svg>
    );
  };

  // ── Spec Summary Rows ──
  const specSummaryRows: Array<[string, string]> = (() => {
    if (unitType === 'saturator') {
      return [
        [isEn ? 'Target Brine Conc.' : '목표 포화 브라인 농도', `${satCalc.wt.toFixed(2)} wt% NaCl (${(satCalc.wt * 12.1).toFixed(0)} g/L)`],
        [isEn ? 'Active / Total Volume' : '유효 / 전체 용적', `${satCalc.activeVolM3.toFixed(1)} / ${satCalc.totalVolM3.toFixed(1)} m³ (τ = ${satCalc.tau} min)`],
        [isEn ? 'Vessel Geometry' : '탱크 규격 (ØD × Hss + Cone)', `Ø${satCalc.tankIdM.toFixed(2)} m × ${satCalc.straightSideM.toFixed(2)} m + ${satCalc.coneHeightM.toFixed(2)} m (${satCalc.coneDeg}°)`],
        [isEn ? 'Upflow Rise Velocity' : '상승 유속', `${satCalc.riseVelMh.toFixed(2)} m/h`],
        [isEn ? 'Agitator Power' : '교반기 동력', `${satCalc.agitatorKw.toFixed(2)} kW (${satCalc.specKw.toFixed(2)} kW/m³)`],
        [isEn ? 'Salt Dissolution / Sludge' : '원염 용해량 / 슬러지 배출', `${satCalc.saltDissolutionKgH.toFixed(0)} kg/h · ${satCalc.sludgeBlowdownKgH.toFixed(1)} kg/h`],
        [isEn ? 'Metallurgy' : '재질 사양', satMetallurgy],
      ];
    }
    if (unitType === 'chelate_tower') {
      return [
        [isEn ? 'Configuration / Resin' : '운전 구성 / 수지 종류', `${chelateConfig} · ${resinType}`],
        [isEn ? 'Resin Volume / Tower' : '탑당 수지 충진량', `${chelateCalc.resinVolM3.toFixed(2)} m³/tower (Bed ${chelateCalc.hBed.toFixed(2)} m)`],
        [isEn ? 'Tower Geometry (ØD × T-T)' : '수지탑 규격 (ØD × T-T)', `Ø${chelateCalc.towerIdM.toFixed(2)} m × ${chelateCalc.vesselTTH.toFixed(2)} m (+50% Freeboard)`],
        [isEn ? 'Actual SV / LV' : '실운전 SV / LV', `${chelateCalc.actualSv.toFixed(1)} BV/h · ${chelateCalc.actualLv.toFixed(1)} m/h`],
        [isEn ? 'Bed Pressure Drop (ΔP)' : '설계 차압 (ΔP)', `${chelateCalc.deltaPBar.toFixed(2)} bar (${(chelateCalc.deltaPBar * 1.01972).toFixed(2)} kg/cm²)`],
        [isEn ? 'Daily Regen (32% HCl / NaOH)' : '일일 재생약품 (32% HCl / NaOH)', `${chelateCalc.hcl32KgDay.toFixed(0)} / ${chelateCalc.naoh32KgDay.toFixed(0)} kg/day (${chelateCalc.cycleH}h cyc)`],
        [isEn ? 'Metallurgy / Outlet Spec' : '재질 / 출구 수질 보증', `${chelateMetallurgy} · Ca+Mg < 20 ppb`],
      ];
    }
    if (filterMode === 'candle') {
      return [
        [isEn ? 'Filter Mode' : '여과 방식', isEn ? 'Pre-coat Candle Filter' : '프리코트 캔들 필터'],
        [isEn ? 'Required / Installed Area' : '필요 / 설치 여과면적', `${filterCalc.candle.reqAreaM2.toFixed(1)} / ${filterCalc.candle.actualAreaM2.toFixed(1)} m² (Flux ${filterCalc.candle.actualFlux.toFixed(2)} m³/m²·h)`],
        [isEn ? 'Candle Elements' : '캔들 소자 사양', `${filterCalc.candle.candleCount} EA (Ø${filterCalc.candle.odMm} mm × ${filterCalc.candle.cLenM.toFixed(2)} m)`],
        [isEn ? 'Vessel Size (ØD × H)' : '용기 규격 (ØD × H)', `Ø${filterCalc.candle.vesselIdM.toFixed(2)} m × ${filterCalc.candle.vesselHM.toFixed(2)} m`],
        [isEn ? 'Backwash / Cycle / ΔP' : '역세수량 / 주기 / 차압', `${filterCalc.candle.backwashVolM3.toFixed(1)} m³/cyc · ${filterCalc.candle.cCycleH} h · ΔP ${filterCalc.candle.cDpBar.toFixed(2)} bar`],
        [isEn ? 'Metallurgy / Outlet Clarity' : '재질 / 출구 청정도', `${candleMaterial} · TSS < 1 ppm`],
      ];
    }
    return [
      [isEn ? 'Filter Mode' : '여과 방식', isEn ? 'Activated Carbon Bed (GAC)' : '활성탄 카본 베드 (GAC)'],
      [isEn ? 'Carbon Bed Volume / Charge' : '활성탄 부피 / 충진량', `${filterCalc.carbon.carbonBedVolM3.toFixed(2)} m³ · ${filterCalc.carbon.carbonChargeKg.toFixed(0)} kg (${filterCalc.carbon.carbRho} kg/m³)`],
      [isEn ? 'EBCT / Superficial Velocity' : '접촉시간 (EBCT) / 선속도', `${filterCalc.carbon.actualEbctMin.toFixed(1)} min · ${filterCalc.carbon.actualCarbLv.toFixed(1)} m/h`],
      [isEn ? 'Vessel Size (ØD × H)' : '용기 규격 (ØD × H)', `Ø${filterCalc.carbon.vesselIdM.toFixed(2)} m × ${filterCalc.carbon.vesselHM.toFixed(2)} m (Bed ${filterCalc.carbon.carbDepth.toFixed(2)} m)`],
      [isEn ? 'Design Pressure Drop (ΔP)' : '설계 차압 (ΔP)', `${filterCalc.carbon.carbDpBar.toFixed(2)} bar (${(filterCalc.carbon.carbDpBar * 1.01972).toFixed(2)} kg/cm²)`],
      [isEn ? 'Metallurgy / Outlet Spec' : '재질 / 출구 보증', `${carbonMaterial} · Free Cl₂ < 0.1 ppm`],
    ];
  })();

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.56)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: 'min(1160px, 96vw)',
          height: 'min(820px, 92vh)',
          background: '#F8FAFC',
          borderRadius: 12,
          border: '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.30)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Single-row Dark Navy Desktop Header ── */}
        <div
          style={{
            padding: '10px 14px',
            background: '#0F172A',
            color: '#F8FAFC',
            borderBottom: '1px solid #1E293B',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  color: '#FFFFFF',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                [{tag}] {name}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: unitTitleMeta.badgeBg,
                  color: unitTitleMeta.badgeFg,
                  border: `1px solid ${unitTitleMeta.badgeBd}`,
                  fontSize: 10,
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                }}
              >
                {unitTitleMeta.badge}
              </span>
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: '#CBD5E1',
                fontFamily: MONO,
                fontWeight: 600,
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {`Inlet: ${safeM.toFixed(0)} kg/h (${safeQ.toFixed(1)} m³/h) · ${safeT.toFixed(1)} °C · ${safeP.toFixed(2)} kg/cm²G · ρ ${safeRho.toFixed(0)} kg/m³`}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              style={{
                padding: '6px 11px',
                borderRadius: 6,
                border: '1px solid #334155',
                background: '#1E293B',
                color: '#E2E8F0',
                fontSize: 11,
                fontWeight: 800,
                cursor: exporting ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {exporting
                ? isEn
                  ? 'Exporting...'
                  : '생성 중...'
                : isEn
                  ? '📊 Excel Datasheet (.xlsx)'
                  : '📊 엑셀 데이터시트 (.xlsx)'}
            </button>
            <button
              type="button"
              onClick={handleApply}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #2563EB',
                background: '#2563EB',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isEn ? '✓ Apply to Simulation' : '✓ 시뮬레이션 반영'}
            </button>
            <button
              type="button"
              onClick={onClose}
              title={isEn ? 'Close (Esc)' : '닫기 (Esc)'}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #475569',
                background: 'rgba(255,255,255,0.10)',
                color: '#FFFFFF',
                fontSize: 11.5,
                fontWeight: 900,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isEn ? '✕ Close' : '✕ 닫기'}
            </button>
          </div>
        </div>

        {/* ── KPI Strip ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
            padding: '10px 14px 6px',
            flexShrink: 0,
          }}
        >
          {kpiCards.map((k) => (
            <div
              key={k.label}
              style={{
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderLeft: `3.5px solid ${k.accent}`,
                borderRadius: 7,
                padding: '7px 10px',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B' }}>{k.label}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  color: '#0F172A',
                  fontFamily: MONO,
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {k.value}
              </div>
              <div
                style={{
                  fontSize: 9.8,
                  color: '#475569',
                  fontFamily: MONO,
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {k.sub}
              </div>
            </div>
          ))}
        </div>

        {/* ── Main Split Body: Left Parameter Inputs | Right CAD SVG + Spec Summary ── */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: '8px 14px 14px',
            display: 'grid',
            gridTemplateColumns: 'minmax(290px, 355px) minmax(0, 1fr)',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {/* Left Panel: Engineering Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unitType === 'candle_filter' && (
              <div style={cardBox}>
                <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                  {isEn ? 'Filtration Technology Mode' : '여과 방식 선택 (시뮬레이션 연동)'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setFilterMode('candle')}
                    style={{
                      padding: '8px 6px',
                      borderRadius: 6,
                      border: filterMode === 'candle' ? '1.5px solid #7C3AED' : '1px solid #CBD5E1',
                      background: filterMode === 'candle' ? '#F5F3FF' : '#FFFFFF',
                      color: filterMode === 'candle' ? '#5B21B6' : '#475569',
                      fontSize: 10.8,
                      fontWeight: 900,
                      cursor: 'pointer',
                      lineHeight: 1.25,
                    }}
                  >
                    {isEn ? 'Pre-coat Candle' : '캔들 필터'}
                    <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.85, marginTop: 2 }}>
                      TSS &lt; 1 ppm
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('carbon')}
                    style={{
                      padding: '8px 6px',
                      borderRadius: 6,
                      border: filterMode === 'carbon' ? '1.5px solid #0F172A' : '1px solid #CBD5E1',
                      background: filterMode === 'carbon' ? '#F1F5F9' : '#FFFFFF',
                      color: filterMode === 'carbon' ? '#0F172A' : '#475569',
                      fontSize: 10.8,
                      fontWeight: 900,
                      cursor: 'pointer',
                      lineHeight: 1.25,
                    }}
                  >
                    {isEn ? 'Activated Carbon' : '활성탄 카본 필터'}
                    <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.85, marginTop: 2 }}>
                      Free Cl₂ &lt; 0.1 ppm
                    </div>
                  </button>
                </div>
              </div>
            )}

            <div style={cardBox}>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 9 }}>
                {isEn ? 'Design Parameters' : '설계 변수 입력'}
              </div>

              {unitType === 'saturator' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Saturator Type' : '포화조 형식'}</label>
                    <select
                      value={satType}
                      onChange={(e) => handleChangeSatType(e.target.value as SatType)}
                      style={selStyle}
                    >
                      <option value="conventional_bed">
                        {isEn
                          ? 'Conventional Upflow Salt-Bed (Ø8–15 m)'
                          : '컨벤셔널 염상 포화조 (상향류 대형, Ø8~15 m)'}
                      </option>
                      <option value="vertical_cyl">
                        {isEn
                          ? 'Vertical Cylindrical Salt-Bed (Ø3–6 m)'
                          : '수직 원통형 염상 포화조 (FRP/RLCS, Ø3~6 m)'}
                      </option>
                      <option value="agitated_dissolver">
                        {isEn
                          ? 'Agitated Brine Dissolver Tank (Ø2.5–5 m)'
                          : '교반 용해조 (Agitated Dissolver, Ø2.5~5 m)'}
                      </option>
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                    <div>
                      <label style={lblStyle}>{isEn ? 'Target Brine (wt%)' : '목표 브라인 (wt%)'}</label>
                      <input
                        type="number"
                        step="0.1"
                        value={targetBrineWtPct}
                        onChange={(e) => setTargetBrineWtPct(parseFloat(e.target.value) || 0)}
                        style={inpStyle}
                      />
                    </div>
                    <div>
                      <label style={lblStyle}>{isEn ? 'Parallel Units (EA)' : '병렬 기수 (기)'}</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="6"
                        value={satParallelCount}
                        onChange={(e) => setSatParallelCount(parseInt(e.target.value, 10) || 1)}
                        style={inpStyle}
                      />
                    </div>

                    {satType === 'agitated_dissolver' ? (
                      <>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Residence Time (min)' : '체류시간 τ (min)'}</label>
                          <input
                            type="number"
                            step="5"
                            value={residenceTimeMin}
                            onChange={(e) => setResidenceTimeMin(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'H / D Ratio' : '형상비 (H/D)'}</label>
                          <input
                            type="number"
                            step="0.1"
                            value={hdRatio}
                            onChange={(e) => setHdRatio(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Cone Angle (°)' : '원추각 (°)'}</label>
                          <input
                            type="number"
                            step="5"
                            value={coneAngleDeg}
                            onChange={(e) => setConeAngleDeg(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Agitator Power (kW/m³)' : '교반 비동력 (kW/m³)'}</label>
                          <input
                            type="number"
                            step="0.05"
                            value={agitSpecPower}
                            onChange={(e) => setAgitSpecPower(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Upflow Velocity (m/h)' : '상승 유속 (m/h)'}</label>
                          <input
                            type="number"
                            step="0.2"
                            value={upflowVelMh}
                            onChange={(e) => setUpflowVelMh(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Salt Bed Depth (m)' : '원염층 높이 (m)'}</label>
                          <input
                            type="number"
                            step="0.2"
                            value={saltBedHeightM}
                            onChange={(e) => setSaltBedHeightM(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Clear Brine Zone (m)' : '상부 정징층 (m)'}</label>
                          <input
                            type="number"
                            step="0.2"
                            value={clearZoneM}
                            onChange={(e) => setClearZoneM(parseFloat(e.target.value) || 0)}
                            style={inpStyle}
                          />
                        </div>
                        <div>
                          <label style={lblStyle}>{isEn ? 'Salt Inventory' : '원염 재고량'}</label>
                          <div
                            style={{
                              ...inpStyle,
                              display: 'flex',
                              alignItems: 'center',
                              background: '#F8FAFC',
                              color: '#0369A1',
                            }}
                          >
                            {satCalc.saltInventoryTon.toFixed(0)} t ({satCalc.autonomyH.toFixed(1)} h)
                          </div>
                        </div>
                      </>
                    )}

                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lblStyle}>{isEn ? 'Metallurgy / Lining' : '용기 재질 / 라이닝'}</label>
                      <select
                        value={satMetallurgy}
                        onChange={(e) => setSatMetallurgy(e.target.value as SatMetallurgy)}
                        style={selStyle}
                      >
                        <option value="Acid-Proof Concrete / Tile">
                          {isEn ? 'Acid-Proof Concrete / Tile (Conventional Pit)' : '내산 타일 콘크리트 (컨벤셔널 대형조)'}
                        </option>
                        <option value="Rubber-Lined CS">Rubber-Lined CS</option>
                        <option value="FRP">FRP</option>
                        <option value="Titanium Gr.2">Titanium Gr.2</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {unitType === 'chelate_tower' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Space Velocity (BV/h)' : '공간속도 SV (BV/h)'}</label>
                    <input
                      type="number"
                      step="1"
                      value={svBvh}
                      onChange={(e) => setSvBvh(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Linear Velocity (m/h)' : '선속도 LV (m/h)'}</label>
                    <input
                      type="number"
                      step="1"
                      value={lvMh}
                      onChange={(e) => setLvMh(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Resin Bed Height (m)' : '수지 충진층고 (m)'}</label>
                    <input
                      type="number"
                      step="0.05"
                      value={resinBedHeightM}
                      onChange={(e) => setResinBedHeightM(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Regen Cycle (h)' : '재생 주기 (h)'}</label>
                    <input
                      type="number"
                      step="4"
                      value={regenCycleH}
                      onChange={(e) => setRegenCycleH(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lblStyle}>{isEn ? 'Tower Configuration' : '수지탑 운전 구성'}</label>
                    <select
                      value={chelateConfig}
                      onChange={(e) => setChelateConfig(e.target.value as ChelateConfig)}
                      style={selStyle}
                    >
                      <option value="2-Tower Lead-Lag">2-Tower Lead-Lag</option>
                      <option value="3-Tower Merry-Go-Round">3-Tower Merry-Go-Round</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lblStyle}>{isEn ? 'Chelating Resin Type' : '킬레이트 수지 종류'}</label>
                    <select
                      value={resinType}
                      onChange={(e) => setResinType(e.target.value as ChelateResinType)}
                      style={selStyle}
                    >
                      <option value="Iminodiacetic (IDA)">Iminodiacetic (IDA)</option>
                      <option value="Aminophosphonic">Aminophosphonic</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lblStyle}>{isEn ? 'Vessel Metallurgy' : '탑체 재질'}</label>
                    <select
                      value={chelateMetallurgy}
                      onChange={(e) => setChelateMetallurgy(e.target.value as ChelateMetallurgy)}
                      style={selStyle}
                    >
                      <option value="Rubber-Lined CS">Rubber-Lined CS</option>
                      <option value="FRP">FRP</option>
                    </select>
                  </div>
                </div>
              )}

              {unitType === 'candle_filter' && filterMode === 'candle' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Design Flux (m³/m²·h)' : '설계 플럭스 (m³/m²·h)'}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={candleFlux}
                      onChange={(e) => setCandleFlux(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Candle OD (mm)' : '캔들 외경 (mm)'}</label>
                    <input
                      type="number"
                      step="5"
                      value={candleOdMm}
                      onChange={(e) => setCandleOdMm(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Candle Length (m)' : '캔들 길이 (m)'}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={candleLenM}
                      onChange={(e) => setCandleLenM(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Filtration Cycle (h)' : '여과 주기 (h)'}</label>
                    <input
                      type="number"
                      step="1"
                      value={candleCycleH}
                      onChange={(e) => setCandleCycleH(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Design ΔP (bar)' : '설계 차압 ΔP (bar)'}</label>
                    <input
                      type="number"
                      step="0.05"
                      value={candleDeltaPBar}
                      onChange={(e) => setCandleDeltaPBar(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Material' : '용기 재질'}</label>
                    <select
                      value={candleMaterial}
                      onChange={(e) => setCandleMaterial(e.target.value as FilterMetallurgy)}
                      style={selStyle}
                    >
                      <option value="Rubber-Lined CS">Rubber-Lined CS</option>
                      <option value="FRP">FRP</option>
                      <option value="Ti Gr.2">Ti Gr.2</option>
                      <option value="SS316L">SS316L</option>
                    </select>
                  </div>
                </div>
              )}

              {unitType === 'candle_filter' && filterMode === 'carbon' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <div>
                    <label style={lblStyle}>{isEn ? 'EBCT (min)' : '공탑접촉시간 EBCT (min)'}</label>
                    <input
                      type="number"
                      step="1"
                      value={ebctMin}
                      onChange={(e) => setEbctMin(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Superficial Vel. LV (m/h)' : '공탑선속도 LV (m/h)'}</label>
                    <input
                      type="number"
                      step="1"
                      value={carbonLvMh}
                      onChange={(e) => setCarbonLvMh(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Bed Depth (m)' : '활성탄 층고 (m)'}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={carbonBedDepthM}
                      onChange={(e) => setCarbonBedDepthM(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Bulk Density (kg/m³)' : '겉보기 밀도 (kg/m³)'}</label>
                    <input
                      type="number"
                      step="10"
                      value={carbonBulkDensity}
                      onChange={(e) => setCarbonBulkDensity(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Design ΔP (bar)' : '설계 차압 ΔP (bar)'}</label>
                    <input
                      type="number"
                      step="0.05"
                      value={carbonDeltaPBar}
                      onChange={(e) => setCarbonDeltaPBar(parseFloat(e.target.value) || 0)}
                      style={inpStyle}
                    />
                  </div>
                  <div>
                    <label style={lblStyle}>{isEn ? 'Material' : '용기 재질'}</label>
                    <select
                      value={carbonMaterial}
                      onChange={(e) => setCarbonMaterial(e.target.value as FilterMetallurgy)}
                      style={selStyle}
                    >
                      <option value="Rubber-Lined CS">Rubber-Lined CS</option>
                      <option value="FRP">FRP</option>
                      <option value="Ti Gr.2">Ti Gr.2</option>
                      <option value="SS316L">SS316L</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Process Inlet Summary Box */}
            <div style={{ ...cardBox, background: '#F8FAFC' }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, color: '#475569', marginBottom: 6 }}>
                {isEn ? 'Linked Flowsheet Inlet Conditions' : '플로우시트 유입 스트림 조건'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, fontSize: 10.5, fontFamily: MONO }}>
                <div style={{ color: '#64748B' }}>{isEn ? 'Mass Flow' : '질량유량'}</div>
                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{safeM.toFixed(1)} kg/h</div>
                <div style={{ color: '#64748B' }}>{isEn ? 'Vol. Flow' : '부피유량'}</div>
                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{safeQ.toFixed(2)} m³/h</div>
                <div style={{ color: '#64748B' }}>{isEn ? 'Temp / Press' : '온도 / 압력'}</div>
                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>
                  {safeT.toFixed(1)}°C / {safeP.toFixed(2)} kG
                </div>
                <div style={{ color: '#64748B' }}>{isEn ? 'Density' : '유체 밀도'}</div>
                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{safeRho.toFixed(1)} kg/m³</div>
              </div>
            </div>
          </div>

          {/* Right Panel: CAD SVG + Spec Summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            {renderCadSvg()}

            <div style={cardBox}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                  {isEn ? 'Engineering Specification Summary' : '장치 설계 사양 요약 (Datasheet Summary)'}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', fontFamily: MONO }}>
                  {isEn ? 'ASME Sec. VIII Div.1 Basis' : 'ASME Sec. VIII 기본설계 기준'}
                </span>
              </div>

              <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden' }}>
                {specSummaryRows.map(([k, v], idx) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '6px 10px',
                      background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                      borderTop: idx === 0 ? 'none' : '1px solid #E2E8F0',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ fontWeight: 800, color: '#334155' }}>{k}</span>
                    <span style={{ fontWeight: 800, color: '#0F172A', fontFamily: MONO, textAlign: 'right' }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

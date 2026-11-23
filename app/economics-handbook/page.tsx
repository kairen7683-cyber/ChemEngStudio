'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  HANDBOOK_CATEGORIES,
  PROCESS_ECONOMICS_HANDBOOK,
  BASE_CEPCI,
  DEFAULT_FX_KRW_PER_USD,
  calculateHandbookEconomics,
  getComparableRoutes,
  type HandbookCategory,
  type HandbookProcessEntry,
  type HandbookCalcOverrides,
} from '@/lib/economics/processEconomicsHandbook';
import {
  ENGINEERING_DISCLAIMER_KO,
  ENGINEERING_DISCLAIMER_EN,
  ENGINEERING_DISCLAIMER_ROWS,
} from '@/lib/legal/engineeringDisclaimer';
import { useUnitStore } from '@/lib/stores/unitStore';

type CategoryFilter = 'all' | HandbookCategory;

const SHORT_CATEGORY_LABELS: Record<HandbookCategory, { ko: string; en: string }> = {
  petrochem: { ko: '석유화학', en: 'Petrochem' },
  inorganic: { ko: '무기·전해', en: 'Inorganic' },
  fine_polymer: { ko: '정밀·우레탄', en: 'Fine·Polymer' },
  battery_green: { ko: '배터리·수소·CCUS', en: 'Battery·H₂·CCUS' },
};

function fmtNum(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtKrwPerT(usdPerT: number, fx: number): string {
  if (!Number.isFinite(usdPerT) || !Number.isFinite(fx)) return '-';
  const krw = usdPerT * fx;
  const sign = krw < 0 ? '-' : '';
  return `${sign}₩${fmtNum(Math.abs(krw), 0)}`;
}

function fmtUsd(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '-';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${fmtNum(Math.abs(v), digits)}`;
}

function getDefaultUtilityPrice(
  entry: HandbookProcessEntry,
  kind: 'power' | 'steam',
  fallback: number
): number {
  const item = entry.utilities.find((u) => u.kind === kind);
  return item ? item.defaultPriceUsd : fallback;
}

export default function EconomicsHandbookPage() {
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';

  const [isNarrow, setIsNarrow] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string>(
    PROCESS_ECONOMICS_HANDBOOK[0]?.id ?? 'ethylene_ncc'
  );

  // Macro & sensitivity overrides
  const [cepci, setCepci] = useState<number>(BASE_CEPCI);
  const [fxKrwPerUsd, setFxKrwPerUsd] = useState<number>(DEFAULT_FX_KRW_PER_USD);
  const [capacityOverride, setCapacityOverride] = useState<number | undefined>(undefined);
  const [productPriceOverride, setProductPriceOverride] = useState<number | undefined>(undefined);
  const [powerPriceOverride, setPowerPriceOverride] = useState<number | undefined>(undefined);
  const [steamPriceOverride, setSteamPriceOverride] = useState<number | undefined>(undefined);

  // Inline line-item price overrides
  const [feedPriceOverrides, setFeedPriceOverrides] = useState<Record<string, number>>({});
  const [utilPriceOverrides, setUtilPriceOverrides] = useState<Record<string, number>>({});
  const [byproductPriceOverrides, setByproductPriceOverrides] = useState<Record<string, number>>({});

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const syncViewport = () => {
      if (typeof window !== 'undefined') {
        setIsNarrow(window.innerWidth <= 960);
      }
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const selectedEntry = useMemo<HandbookProcessEntry>(() => {
    return (
      PROCESS_ECONOMICS_HANDBOOK.find((p) => p.id === selectedId) ??
      PROCESS_ECONOMICS_HANDBOOK[0]
    );
  }, [selectedId]);

  const handleSelectProcess = useCallback((nextEntry: HandbookProcessEntry) => {
    setSelectedId(nextEntry.id);
    setCapacityOverride(undefined);
    setProductPriceOverride(undefined);
    setPowerPriceOverride(undefined);
    setSteamPriceOverride(undefined);
    setFeedPriceOverrides({});
    setUtilPriceOverrides({});
    setByproductPriceOverrides({});
  }, []);

  const handleResetDefaults = useCallback(() => {
    setCepci(BASE_CEPCI);
    setFxKrwPerUsd(DEFAULT_FX_KRW_PER_USD);
    setCapacityOverride(undefined);
    setProductPriceOverride(undefined);
    setPowerPriceOverride(undefined);
    setSteamPriceOverride(undefined);
    setFeedPriceOverrides({});
    setUtilPriceOverrides({});
    setByproductPriceOverrides({});
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: PROCESS_ECONOMICS_HANDBOOK.length,
      petrochem: 0,
      inorganic: 0,
      fine_polymer: 0,
      battery_green: 0,
    };
    for (const item of PROCESS_ECONOMICS_HANDBOOK) {
      counts[item.category] += 1;
    }
    return counts;
  }, []);

  const filteredProcesses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return PROCESS_ECONOMICS_HANDBOOK.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.nameKo,
        item.nameEn,
        item.formula,
        item.routeNameKo,
        item.routeNameEn,
        item.productGroup,
        ...item.keywords,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [searchQuery, activeCategory]);

  const effectiveCapacity = capacityOverride ?? selectedEntry.baseCapacityTpa;
  const effectiveProductPrice =
    productPriceOverride ?? selectedEntry.referenceProductPriceUsdPerT;
  const defaultPowerPrice = getDefaultUtilityPrice(selectedEntry, 'power', 0.08);
  const defaultSteamPrice = getDefaultUtilityPrice(selectedEntry, 'steam', 28);
  const effectivePowerPrice = powerPriceOverride ?? defaultPowerPrice;
  const effectiveSteamPrice = steamPriceOverride ?? defaultSteamPrice;

  const currentOverrides = useMemo<HandbookCalcOverrides>(
    () => ({
      capacityTpa: effectiveCapacity,
      cepci,
      fxKrwPerUsd,
      productPriceUsd: effectiveProductPrice,
      powerPriceUsdPerKwh: powerPriceOverride,
      steamPriceUsdPerT: steamPriceOverride,
      feedPriceOverrides,
      utilPriceOverrides,
      byproductPriceOverrides,
    }),
    [
      effectiveCapacity,
      cepci,
      fxKrwPerUsd,
      effectiveProductPrice,
      powerPriceOverride,
      steamPriceOverride,
      feedPriceOverrides,
      utilPriceOverrides,
      byproductPriceOverrides,
    ]
  );

  const calc = useMemo(
    () => calculateHandbookEconomics(selectedEntry, currentOverrides),
    [selectedEntry, currentOverrides]
  );

  const comparableRoutes = useMemo(
    () => getComparableRoutes(selectedEntry),
    [selectedEntry]
  );

  const comparableResults = useMemo(() => {
    if (comparableRoutes.length <= 1) return [];
    const sharedOverrides: HandbookCalcOverrides = {
      capacityTpa: effectiveCapacity,
      cepci,
      fxKrwPerUsd,
      powerPriceUsdPerKwh: powerPriceOverride,
      steamPriceUsdPerT: steamPriceOverride,
    };
    return comparableRoutes.map((route) => ({
      entry: route,
      result: calculateHandbookEconomics(route, sharedOverrides),
    }));
  }, [
    comparableRoutes,
    effectiveCapacity,
    cepci,
    fxKrwPerUsd,
    powerPriceOverride,
    steamPriceOverride,
  ]);

  const lowestCostRouteId = useMemo(() => {
    if (comparableResults.length <= 1) return null;
    let best = comparableResults[0];
    for (const r of comparableResults) {
      if (r.result.totalProdCostUsdPerT < best.result.totalProdCostUsdPerT) {
        best = r;
      }
    }
    return best.entry.id;
  }, [comparableResults]);

  // Cost structure shares (clamped >= 0 for stacked visual bar)
  const netRawMaterialUsdPerT = calc.rawMaterialUsdPerT - calc.byproductCreditUsdPerT;
  const costBarSegments = useMemo(() => {
    const rawVal = Math.max(0, netRawMaterialUsdPerT);
    const utilVal = Math.max(0, calc.utilityUsdPerT);
    const fixedVal = Math.max(0, calc.fixedCostUsdPerT);
    const deprVal = Math.max(0, calc.depreciationUsdPerT);
    const sum = rawVal + utilVal + fixedVal + deprVal || 1;
    return [
      {
        key: 'raw',
        label: isEn ? 'Net Raw Materials' : '순 원료비',
        usdPerT: netRawMaterialUsdPerT,
        pct: (rawVal / sum) * 100,
        color: '#1E3A8A',
      },
      {
        key: 'util',
        label: isEn ? 'Utilities' : '유틸리티',
        usdPerT: calc.utilityUsdPerT,
        pct: (utilVal / sum) * 100,
        color: '#0284C7',
      },
      {
        key: 'fixed',
        label: isEn ? 'Fixed OPEX' : '고정비',
        usdPerT: calc.fixedCostUsdPerT,
        pct: (fixedVal / sum) * 100,
        color: '#D97706',
      },
      {
        key: 'depr',
        label: isEn ? 'Depreciation' : '감가상각',
        usdPerT: calc.depreciationUsdPerT,
        pct: (deprVal / sum) * 100,
        color: '#64748B',
      },
    ];
  }, [
    netRawMaterialUsdPerT,
    calc.utilityUsdPerT,
    calc.fixedCostUsdPerT,
    calc.depreciationUsdPerT,
    isEn,
  ]);

  const hasCustomOverrides =
    cepci !== BASE_CEPCI ||
    fxKrwPerUsd !== DEFAULT_FX_KRW_PER_USD ||
    capacityOverride !== undefined ||
    productPriceOverride !== undefined ||
    powerPriceOverride !== undefined ||
    steamPriceOverride !== undefined ||
    Object.keys(feedPriceOverrides).length > 0 ||
    Object.keys(utilPriceOverrides).length > 0 ||
    Object.keys(byproductPriceOverrides).length > 0;

  const handleDownloadExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ChemPlant Studio';
      wb.created = new Date();

      const NAVY_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FF0F172A' },
      };
      const SUBHEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FF1E3A8A' },
      };
      const SECTION_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFE2E8F0' },
      };
      const ZEBRA_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFF8FAFC' },
      };
      const THIN_BORDER = {
        top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
      };

      // ── Sheet 1: Process_Economics_Summary ──
      const ws1 = wb.addWorksheet('Process_Economics_Summary');
      ws1.columns = [
        { width: 32 },
        { width: 26 },
        { width: 22 },
        { width: 24 },
        { width: 30 },
      ];

      ws1.mergeCells('A1:E1');
      const titleCell = ws1.getCell('A1');
      titleCell.value = `Process Economics & Unit Consumption Report — ${selectedEntry.nameKo} (${selectedEntry.nameEn})`;
      titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = NAVY_FILL;
      titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
      ws1.getRow(1).height = 28;

      ws1.mergeCells('A2:E2');
      const subCell = ws1.getCell('A2');
      subCell.value = `Route: ${selectedEntry.routeNameKo} (${selectedEntry.routeNameEn}) | Formula: ${selectedEntry.formula} | Generated: ${new Date().toISOString().slice(0, 10)}`;
      subCell.font = { size: 10, color: { argb: 'FFE2E8F0' } };
      subCell.fill = SUBHEADER_FILL;
      subCell.alignment = { vertical: 'middle', horizontal: 'left' };
      ws1.getRow(2).height = 22;

      ws1.addRow([]);

      const addSectionBanner = (ws: typeof ws1, text: string, cols = 5) => {
        const row = ws.addRow([text]);
        const rNum = row.number;
        ws.mergeCells(rNum, 1, rNum, cols);
        const c = ws.getCell(rNum, 1);
        c.font = { bold: true, size: 10.5, color: { argb: 'FF0F172A' } };
        c.fill = SECTION_FILL;
        c.alignment = { vertical: 'middle' };
        row.height = 22;
      };

      addSectionBanner(ws1, '1. Process Overview & Technical Basis');
      const overviewRows: [string, string][] = [
        ['Product / Formula', `${selectedEntry.nameKo} / ${selectedEntry.nameEn} (${selectedEntry.formula})`],
        ['Process Route', `${selectedEntry.routeNameKo} (${selectedEntry.routeNameEn})`],
        ['Reaction Stoichiometry', selectedEntry.reactionEq],
        ['Operating Conditions', selectedEntry.operatingSummary],
        ['Block Flow Steps', selectedEntry.blockSteps.join('  →  ')],
        ['Literature Basis', selectedEntry.sourceNote],
      ];
      overviewRows.forEach(([k, v], idx) => {
        const r = ws1.addRow([k, v]);
        ws1.mergeCells(r.number, 2, r.number, 5);
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(2).font = { size: 10 };
        r.getCell(2).alignment = { wrapText: true };
        for (let c = 1; c <= 5; c++) {
          r.getCell(c).border = THIN_BORDER;
          if (idx % 2 === 1) r.getCell(c).fill = ZEBRA_FILL;
        }
      });

      ws1.addRow([]);
      addSectionBanner(ws1, '2. Economic & Scaling Parameters');
      const paramHeader = ws1.addRow(['Parameter', 'Value', 'Unit', 'Base Reference', 'Note']);
      paramHeader.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = SUBHEADER_FILL;
        cell.border = THIN_BORDER;
      });
      const paramRows = [
        ['Design Capacity', calc.capacityTpa, 'TPA', selectedEntry.baseCapacityTpa, `Scale exponent n = ${selectedEntry.scaleExponent}`],
        ['CEPCI Index', calc.cepci, 'Index', BASE_CEPCI, 'Chemical Engineering Plant Cost Index'],
        ['Exchange Rate', calc.fxKrwPerUsd, 'KRW / USD', DEFAULT_FX_KRW_PER_USD, 'Currency conversion'],
        ['Reference Product Price', calc.productPriceUsdPerT, 'USD / t', selectedEntry.referenceProductPriceUsdPerT, fmtKrwPerT(calc.productPriceUsdPerT, calc.fxKrwPerUsd) + ' / t'],
        ['Fixed OPEX Ratio', selectedEntry.fixedCostPctCapex, '% CAPEX / yr', selectedEntry.fixedCostPctCapex, 'Maintenance, labor, overhead'],
        ['Depreciation Life', selectedEntry.depreciationYears, 'years', selectedEntry.depreciationYears, 'Straight-line basis'],
      ];
      paramRows.forEach((vals, idx) => {
        const r = ws1.addRow(vals);
        r.eachCell((cell, colNumber) => {
          cell.font = { size: 10, bold: colNumber === 1 };
          cell.border = THIN_BORDER;
          if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
          if (colNumber === 2 || colNumber === 4) {
            cell.alignment = { horizontal: 'right' };
            cell.numFmt = '#,##0.##';
          }
        });
      });

      ws1.addRow([]);
      addSectionBanner(ws1, '3. CAPEX, Unit Production Cost & Profitability Summary');
      const kpiHeader = ws1.addRow(['KPI Metric', 'USD Basis', 'KRW Basis', 'Share / Detail', 'Remarks']);
      kpiHeader.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = SUBHEADER_FILL;
        cell.border = THIN_BORDER;
      });

      const kpiRows = [
        ['ISBL CAPEX', `$${fmtNum(calc.isblMUsd, 1)}M`, `${fmtNum((calc.isblMUsd * calc.fxKrwPerUsd) / 100, 0)} 억 원`, `${fmtNum((calc.isblMUsd / calc.totalCapexMUsd) * 100, 1)}%`, 'Inside Battery Limits'],
        ['OSBL CAPEX', `$${fmtNum(calc.osblMUsd, 1)}M`, `${fmtNum((calc.osblMUsd * calc.fxKrwPerUsd) / 100, 0)} 억 원`, `${fmtNum(selectedEntry.osblRatio * 100, 0)}% of ISBL`, 'Offsites & Utilities'],
        ['Total CAPEX (TCI)', `$${fmtNum(calc.totalCapexMUsd, 1)}M`, `${fmtNum(calc.totalCapexEokKrw, 0)} 억 원`, '100%', 'Scaled by (Q/Q0)^n × (CEPCI/800)'],
        ['Gross Raw Materials', `${fmtUsd(calc.rawMaterialUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.rawMaterialUsdPerT, calc.fxKrwPerUsd)}/t`, '-', 'Feedstock & catalysts'],
        ['Byproduct Credits', `-${fmtUsd(calc.byproductCreditUsdPerT, 1)}/t`, `-${fmtKrwPerT(calc.byproductCreditUsdPerT, calc.fxKrwPerUsd)}/t`, '-', 'Co-product credit'],
        ['Net Raw Material Cost', `${fmtUsd(netRawMaterialUsdPerT, 1)}/t`, `${fmtKrwPerT(netRawMaterialUsdPerT, calc.fxKrwPerUsd)}/t`, `${fmtNum(costBarSegments[0].pct, 1)}%`, 'Raw materials minus credits'],
        ['Utilities Variable Cost', `${fmtUsd(calc.utilityUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.utilityUsdPerT, calc.fxKrwPerUsd)}/t`, `${fmtNum(costBarSegments[1].pct, 1)}%`, 'Power, steam, CW, fuel'],
        ['Fixed Operating Cost', `${fmtUsd(calc.fixedCostUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.fixedCostUsdPerT, calc.fxKrwPerUsd)}/t`, `${fmtNum(costBarSegments[2].pct, 1)}%`, `${selectedEntry.fixedCostPctCapex}% of CAPEX/yr`],
        ['Depreciation', `${fmtUsd(calc.depreciationUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.depreciationUsdPerT, calc.fxKrwPerUsd)}/t`, `${fmtNum(costBarSegments[3].pct, 1)}%`, `${selectedEntry.depreciationYears}-year straight-line`],
        ['TOTAL PRODUCTION COST', `${fmtUsd(calc.totalProdCostUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.totalProdCostUsdPerT, calc.fxKrwPerUsd)}/t`, '100.0%', 'Full manufacturing cost'],
        ['Gross Margin (EBIT/t)', `${fmtUsd(calc.grossMarginUsdPerT, 1)}/t`, `${fmtKrwPerT(calc.grossMarginUsdPerT, calc.fxKrwPerUsd)}/t`, `ROI ${fmtNum(calc.roiPct, 1)}%`, 'Product price - Total cost'],
        ['Annual Revenue', `$${fmtNum((calc.productPriceUsdPerT * calc.capacityTpa) / 1e6, 1)}M/yr`, `${fmtNum(calc.annualRevenueEokKrw, 0)} 억 원/yr`, '-', `${fmtNum(calc.capacityTpa, 0)} TPA`],
        ['Annual EBITDA', `$${fmtNum((calc.annualEbitdaEokKrw * 100) / calc.fxKrwPerUsd, 1)}M/yr`, `${fmtNum(calc.annualEbitdaEokKrw, 0)} 억 원/yr`, Number.isFinite(calc.paybackYears) ? `Payback ${fmtNum(calc.paybackYears, 1)} yr` : 'Payback N/A', 'Simple payback = CAPEX / EBITDA'],
      ];
      kpiRows.forEach((vals, idx) => {
        const r = ws1.addRow(vals);
        const isTotal = vals[0] === 'TOTAL PRODUCTION COST';
        r.eachCell((cell, colNumber) => {
          cell.font = {
            size: 10,
            bold: isTotal || colNumber === 1,
            color: isTotal ? { argb: 'FFFFFFFF' } : { argb: 'FF0F172A' },
          };
          cell.border = THIN_BORDER;
          if (isTotal) {
            cell.fill = NAVY_FILL;
          } else if (idx % 2 === 1) {
            cell.fill = ZEBRA_FILL;
          }
          if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
            cell.alignment = { horizontal: 'right' };
          }
        });
      });

      ENGINEERING_DISCLAIMER_ROWS.forEach((dRow) => {
        const r = ws1.addRow(dRow);
        if (dRow.length > 1) {
          ws1.mergeCells(r.number, 2, r.number, 5);
          r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475569' } };
          r.getCell(2).font = { size: 9, color: { argb: 'FF475569' } };
          r.getCell(2).alignment = { wrapText: true };
        }
      });

      // ── Sheet 2: Unit_Consumption_Detail ──
      const ws2 = wb.addWorksheet('Unit_Consumption_Detail');
      ws2.columns = [
        { width: 34 },
        { width: 16 },
        { width: 14 },
        { width: 16 },
        { width: 16 },
        { width: 20 },
      ];

      ws2.mergeCells('A1:F1');
      const t2 = ws2.getCell('A1');
      t2.value = `Unit Consumption & Variable Cost Breakdown — ${selectedEntry.nameKo} (${selectedEntry.routeNameKo})`;
      t2.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      t2.fill = NAVY_FILL;
      ws2.getRow(1).height = 26;

      ws2.addRow([]);

      const writeDetailTable = (
        sectionTitle: string,
        headers: string[],
        rows: (string | number)[][],
        subtotalLabel: string,
        subtotalUsd: number
      ) => {
        addSectionBanner(ws2, sectionTitle, 6);
        const h = ws2.addRow(headers);
        h.eachCell((cell) => {
          cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = SUBHEADER_FILL;
          cell.border = THIN_BORDER;
        });
        rows.forEach((vals, idx) => {
          const r = ws2.addRow(vals);
          r.eachCell((cell, col) => {
            cell.font = { size: 10 };
            cell.border = THIN_BORDER;
            if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
            if (col >= 2 && col <= 6 && typeof vals[col - 1] === 'number') {
              cell.alignment = { horizontal: 'right' };
              cell.numFmt = '#,##0.###';
            }
          });
        });
        const sub = ws2.addRow([
          subtotalLabel,
          '',
          '',
          '',
          Number(subtotalUsd.toFixed(2)),
          Math.round(subtotalUsd * calc.fxKrwPerUsd),
        ]);
        sub.eachCell((cell, col) => {
          cell.font = { bold: true, size: 10 };
          cell.fill = SECTION_FILL;
          cell.border = THIN_BORDER;
          if (col === 5) {
            cell.alignment = { horizontal: 'right' };
            cell.numFmt = '$#,##0.0';
          }
          if (col === 6) {
            cell.alignment = { horizontal: 'right' };
            cell.numFmt = '₩#,##0';
          }
        });
        ws2.addRow([]);
      };

      writeDetailTable(
        'A. Raw Materials (원료 원단위)',
        ['Item', 'Unit Consumption', 'Unit / t', 'Unit Price ($/unit)', 'Cost ($/t)', 'Cost (KRW/t)'],
        calc.rawMaterialLines.map((l) => [
          l.note ? `${l.name} (${l.note})` : l.name,
          l.consumptionPerT,
          l.unit,
          l.unitPriceUsd,
          Number(l.costUsdPerT.toFixed(2)),
          Math.round(l.costUsdPerT * calc.fxKrwPerUsd),
        ]),
        'Subtotal — Raw Materials',
        calc.rawMaterialUsdPerT
      );

      writeDetailTable(
        'B. Utilities (유틸리티 원단위)',
        ['Utility', 'Unit Consumption', 'Unit / t', 'Unit Price ($/unit)', 'Cost ($/t)', 'Cost (KRW/t)'],
        calc.utilityLines.map((l) => [
          l.name,
          l.consumptionPerT,
          l.unit,
          l.unitPriceUsd,
          Number(l.costUsdPerT.toFixed(2)),
          Math.round(l.costUsdPerT * calc.fxKrwPerUsd),
        ]),
        'Subtotal — Utilities',
        calc.utilityUsdPerT
      );

      if (calc.byproductLines.length > 0) {
        writeDetailTable(
          'C. Byproduct Credits (부산물 크레딧)',
          ['Byproduct', 'Yield / t', 'Unit / t', 'Credit Price ($/unit)', 'Credit ($/t)', 'Credit (KRW/t)'],
          calc.byproductLines.map((l) => [
            l.name,
            l.yieldPerT,
            l.unit,
            l.creditPriceUsd,
            Number((-l.creditUsdPerT).toFixed(2)),
            Math.round(-l.creditUsdPerT * calc.fxKrwPerUsd),
          ]),
          'Subtotal — Byproduct Credits',
          -calc.byproductCreditUsdPerT
        );
      }

      if (comparableResults.length > 1) {
        addSectionBanner(ws2, `D. 1:1 Route Comparison at ${fmtNum(calc.capacityTpa, 0)} TPA`, 6);
        const ch = ws2.addRow([
          'Process Route',
          'CAPEX ($M)',
          'Net Raw ($/t)',
          'Utilities ($/t)',
          'Total Cost ($/t)',
          'EBITDA (억 원/yr)',
        ]);
        ch.eachCell((cell) => {
          cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = SUBHEADER_FILL;
          cell.border = THIN_BORDER;
        });
        comparableResults.forEach(({ entry, result }, idx) => {
          const r = ws2.addRow([
            `${entry.routeNameKo} (${entry.routeNameEn})`,
            Number(result.totalCapexMUsd.toFixed(1)),
            Number((result.rawMaterialUsdPerT - result.byproductCreditUsdPerT).toFixed(1)),
            Number(result.utilityUsdPerT.toFixed(1)),
            Number(result.totalProdCostUsdPerT.toFixed(1)),
            Number(result.annualEbitdaEokKrw.toFixed(1)),
          ]);
          r.eachCell((cell, col) => {
            cell.font = { size: 10, bold: entry.id === selectedEntry.id };
            cell.border = THIN_BORDER;
            if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
            if (col >= 2) {
              cell.alignment = { horizontal: 'right' };
              cell.numFmt = '#,##0.0';
            }
          });
        });
        ws2.addRow([]);
      }

      ENGINEERING_DISCLAIMER_ROWS.forEach((dRow) => {
        const r = ws2.addRow(dRow);
        if (dRow.length > 1) {
          ws2.mergeCells(r.number, 2, r.number, 6);
          r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475569' } };
          r.getCell(2).font = { size: 9, color: { argb: 'FF475569' } };
          r.getCell(2).alignment = { wrapText: true };
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Process_Economics_${selectedEntry.id}_${Math.round(calc.capacityTpa)}TPA.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed:', err);
      alert(
        isEn
          ? 'Failed to generate the Excel report.'
          : '엑셀 리포트 생성 중 오류가 발생했습니다.'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isNarrow ? 'column' : 'row',
        width: '100%',
        height: isNarrow ? 'auto' : 'calc(100vh - 44px)',
        minHeight: 'calc(100vh - 44px)',
        background: '#F1F5F9',
        color: '#0F172A',
        overflow: isNarrow ? 'visible' : 'hidden',
      }}
    >
      {/* ═══════════════════════════════════════════════════════════
          LEFT PANE: Search, Category Pills, Scrollable Process List
         ═══════════════════════════════════════════════════════════ */}
      <aside
        style={{
          width: isNarrow ? '100%' : 310,
          flexShrink: 0,
          background: '#FFFFFF',
          borderRight: isNarrow ? 'none' : '1px solid #CBD5E1',
          borderBottom: isNarrow ? '1px solid #CBD5E1' : 'none',
          display: 'flex',
          flexDirection: 'column',
          height: isNarrow ? 'auto' : '100%',
          maxHeight: isNarrow ? 390 : '100%',
        }}
      >
        {/* Sidebar Header */}
        <div
          style={{
            padding: '12px 14px 10px',
            borderBottom: '1px solid #E2E8F0',
            background: '#F8FAFC',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 800,
                  color: '#0F172A',
                  letterSpacing: '-0.2px',
                }}
              >
                {isEn ? 'Process Economics Handbook' : '공정 경제성 · 원단위 핸드북'}
              </h1>
              <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 1 }}>
                {isEn
                  ? 'Commercial CAPEX · OPEX · Unit Consumption'
                  : '상용 공정 CAPEX · 제조원가 · 원단위 기준'}
              </div>
            </div>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 999,
                background: '#0F172A',
                color: '#FFFFFF',
                flexShrink: 0,
              }}
            >
              {PROCESS_ECONOMICS_HANDBOOK.length}
              {isEn ? ' Routes' : '종'}
            </span>
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isEn
                  ? 'Search product, formula, route (e.g. ECH, H2, PO, NMP)...'
                  : '제품명 · 화학식 · 공법 검색 (예: ECH, 수소, PO, NMP, 과산화수소)...'
              }
              style={{
                width: '100%',
                padding: '7px 28px 7px 10px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                fontSize: 11.5,
                color: '#0F172A',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  color: '#64748B',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Pills */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
              marginTop: 9,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              style={{
                padding: '3.5px 8px',
                borderRadius: 999,
                border: activeCategory === 'all' ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                background: activeCategory === 'all' ? '#1E3A8A' : '#FFFFFF',
                color: activeCategory === 'all' ? '#FFFFFF' : '#334155',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isEn ? 'All' : '전체'} ({categoryCounts.all})
            </button>
            {HANDBOOK_CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              const shortLabel = SHORT_CATEGORY_LABELS[cat.id];
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  title={isEn ? cat.nameEn : `${cat.nameKo} — ${cat.descriptionKo}`}
                  style={{
                    padding: '3.5px 8px',
                    borderRadius: 999,
                    border: active ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                    background: active ? '#1E3A8A' : '#FFFFFF',
                    color: active ? '#FFFFFF' : '#334155',
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isEn ? shortLabel.en : shortLabel.ko} ({categoryCounts[cat.id]})
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Process List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          {filteredProcesses.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 11.5,
                color: '#64748B',
              }}
            >
              {isEn
                ? 'No matching commercial processes found.'
                : '검색 조건에 일치하는 공정이 없습니다.'}
            </div>
          ) : (
            filteredProcesses.map((item) => {
              const active = item.id === selectedEntry.id;
              const hasComparison = getComparableRoutes(item).length > 1;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectProcess(item)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 10px',
                    borderRadius: 8,
                    border: active ? '1.5px solid #1E3A8A' : '1px solid #E2E8F0',
                    background: active ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    transition: 'border-color 0.12s ease, background 0.12s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.2,
                        fontWeight: 800,
                        color: active ? '#1E3A8A' : '#0F172A',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isEn ? item.nameEn : item.nameKo}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: active ? '#DBEAFE' : '#F1F5F9',
                        color: active ? '#1E40AF' : '#475569',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        flexShrink: 0,
                      }}
                    >
                      {item.formula}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: 10.8,
                      fontWeight: 600,
                      color: '#475569',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isEn ? item.routeNameEn : item.routeNameKo}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                      {isEn ? 'Base' : '기준'} {fmtNum(item.baseCapacityTpa, 0)} TPA
                    </span>
                    {hasComparison && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: '#FEF3C7',
                          border: '1px solid #FDE68A',
                          color: '#92400E',
                          flexShrink: 0,
                        }}
                      >
                        {isEn ? 'Route Compare' : '공법비교'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT PANE: Executive Detail Workspace
         ═══════════════════════════════════════════════════════════ */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: isNarrow ? 'visible' : 'auto',
          padding: isNarrow ? '14px 12px 32px' : '18px 22px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* 1. HEADER CARD */}
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 11,
            padding: '16px 18px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 360px' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    color: '#1E3A8A',
                  }}
                >
                  {isEn ? selectedEntry.routeNameEn : selectedEntry.routeNameKo}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: '#F1F5F9',
                    color: '#334155',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {selectedEntry.formula}
                </span>
                {comparableRoutes.length > 1 && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#FEF3C7',
                      border: '1px solid #FCD34D',
                      color: '#92400E',
                    }}
                  >
                    {isEn
                      ? `${comparableRoutes.length} Comparable Routes`
                      : `동일 제품 ${comparableRoutes.length}개 공법 비교 가능`}
                  </span>
                )}
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 900,
                  color: '#0F172A',
                  letterSpacing: '-0.3px',
                }}
              >
                {selectedEntry.nameKo}{' '}
                <span style={{ fontSize: 14, fontWeight: 600, color: '#64748B' }}>
                  {selectedEntry.nameEn}
                </span>
              </h2>
            </div>

            <button
              type="button"
              onClick={() => void handleDownloadExcel()}
              disabled={exporting}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid #1E3A8A',
                background: exporting ? '#94A3B8' : '#1E3A8A',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 800,
                cursor: exporting ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(30, 58, 138, 0.22)',
              }}
            >
              <span>📊</span>
              <span>
                {exporting
                  ? isEn
                    ? 'Generating .xlsx...'
                    : '엑셀 생성 중...'
                  : isEn
                    ? 'Download Excel (.xlsx) Report'
                    : '엑셀(.xlsx) 리포트 다운로드'}
              </span>
            </button>
          </div>

          {/* Reaction Equation + Operating Summary */}
          <div
            style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: isNarrow ? '1fr' : 'minmax(240px, 1fr) minmax(280px, 1.4fr)',
              gap: 10,
            }}
          >
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                background: '#0F172A',
                color: '#F8FAFC',
              }}
            >
              <div
                style={{
                  fontSize: 9.8,
                  fontWeight: 700,
                  color: '#93C5FD',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  marginBottom: 3,
                }}
              >
                {isEn ? 'Primary Reaction' : '주 반응식 (Stoichiometry)'}
              </div>
              <div
                style={{
                  fontSize: 12.2,
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                }}
              >
                {selectedEntry.reactionEq}
              </div>
            </div>

            <div
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
              }}
            >
              <div
                style={{
                  fontSize: 9.8,
                  fontWeight: 800,
                  color: '#475569',
                  marginBottom: 3,
                }}
              >
                {isEn
                  ? 'Operating Envelope (T / P / Catalyst)'
                  : '대표 운전 조건 (온도 · 압력 · 촉매)'}
              </div>
              <div style={{ fontSize: 11.8, color: '#1E293B', lineHeight: 1.45, fontWeight: 600 }}>
                {selectedEntry.operatingSummary}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 9,
              fontSize: 10.8,
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 800, color: '#475569' }}>
              {isEn ? 'Reference Basis:' : '문헌 기준:'}
            </span>
            <span>{selectedEntry.sourceNote}</span>
          </div>
        </section>

        {/* 2. INTERACTIVE SENSITIVITY BAR */}
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 11,
            padding: '12px 16px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 9,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
              {isEn
                ? 'Interactive Scaling & Economic Sensitivity'
                : '실시간 규모 스케일링 · 경제성 민감도 변수'}
              <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: '#64748B' }}>
                {isEn
                  ? `(Six-tenths exponent n = ${selectedEntry.scaleExponent}, OSBL = ${Math.round(selectedEntry.osblRatio * 100)}% ISBL)`
                  : `(규모 지수 n = ${selectedEntry.scaleExponent}, OSBL = ISBL의 ${Math.round(selectedEntry.osblRatio * 100)}%)`}
              </span>
            </div>

            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={!hasCustomOverrides}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: hasCustomOverrides ? '1px solid #94A3B8' : '1px solid #E2E8F0',
                background: hasCustomOverrides ? '#F8FAFC' : '#F8FAFC',
                color: hasCustomOverrides ? '#0F172A' : '#94A3B8',
                fontSize: 11,
                fontWeight: 700,
                cursor: hasCustomOverrides ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
              }}
            >
              ↺ {isEn ? 'Reset Defaults' : '기본값'}
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
              gap: 10,
            }}
          >
            <SensitivityInput
              label={isEn ? 'Capacity (TPA)' : '연산 규모 (TPA)'}
              value={effectiveCapacity}
              step={Math.max(1000, Math.round(selectedEntry.baseCapacityTpa * 0.1))}
              min={100}
              modified={capacityOverride !== undefined}
              onChange={(v) => setCapacityOverride(v)}
            />
            <SensitivityInput
              label={isEn ? 'CEPCI (Base 800)' : 'CEPCI (기본 800)'}
              value={cepci}
              step={10}
              min={300}
              modified={cepci !== BASE_CEPCI}
              onChange={(v) => setCepci(v)}
            />
            <SensitivityInput
              label={isEn ? 'FX Rate (₩/$)' : '환율 (₩/$)'}
              value={fxKrwPerUsd}
              step={10}
              min={500}
              modified={fxKrwPerUsd !== DEFAULT_FX_KRW_PER_USD}
              onChange={(v) => setFxKrwPerUsd(v)}
            />
            <SensitivityInput
              label={isEn ? 'Power ($/kWh)' : '전력 단가 ($/kWh)'}
              value={effectivePowerPrice}
              step={0.01}
              min={0}
              modified={powerPriceOverride !== undefined}
              onChange={(v) => setPowerPriceOverride(v)}
            />
            <SensitivityInput
              label={isEn ? 'Steam ($/t)' : '스팀 단가 ($/t)'}
              value={effectiveSteamPrice}
              step={1}
              min={0}
              modified={steamPriceOverride !== undefined}
              onChange={(v) => setSteamPriceOverride(v)}
            />
            <SensitivityInput
              label={isEn ? 'Product Price ($/t)' : '기준 판가 ($/t)'}
              value={effectiveProductPrice}
              step={25}
              min={0}
              modified={productPriceOverride !== undefined}
              onChange={(v) => setProductPriceOverride(v)}
            />
          </div>
        </section>

        {/* 3. FIVE KPI SUMMARY CARDS */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrow
              ? 'repeat(auto-fit, minmax(175px, 1fr))'
              : 'repeat(5, minmax(0, 1fr))',
            gap: 10,
          }}
        >
          {/* KPI 1: CAPEX */}
          <KpiCard
            title={isEn ? 'Total CAPEX (TCI)' : '총 설비투자비 (CAPEX)'}
            primary={`${fmtNum(calc.totalCapexEokKrw, 0)} ${isEn ? '×10⁸ ₩' : '억 원'}`}
            secondary={`$${fmtNum(calc.totalCapexMUsd, 1)}M`}
            footer={`ISBL $${fmtNum(calc.isblMUsd, 1)}M · OSBL $${fmtNum(calc.osblMUsd, 1)}M`}
          />

          {/* KPI 2: Net Raw Material Cost */}
          <KpiCard
            title={isEn ? 'Net Raw Materials' : '순 원료비'}
            primary={`${fmtKrwPerT(netRawMaterialUsdPerT, calc.fxKrwPerUsd)}/t`}
            secondary={`${fmtUsd(netRawMaterialUsdPerT, 1)}/t`}
            footer={
              calc.byproductCreditUsdPerT > 0
                ? isEn
                  ? `Byproduct credit -${fmtUsd(calc.byproductCreditUsdPerT, 1)}/t`
                  : `부산물 크레딧 -${fmtUsd(calc.byproductCreditUsdPerT, 1)}/t 반영`
                : isEn
                  ? 'No byproduct credit'
                  : '부산물 크레딧 없음'
            }
          />

          {/* KPI 3: Utility Variable Cost */}
          <KpiCard
            title={isEn ? 'Utilities Variable Cost' : '유틸리티 변동비'}
            primary={`${fmtKrwPerT(calc.utilityUsdPerT, calc.fxKrwPerUsd)}/t`}
            secondary={`${fmtUsd(calc.utilityUsdPerT, 1)}/t`}
            footer={
              isEn
                ? `${calc.utilityLines.length} utility streams`
                : `전력·스팀·냉각수 등 ${calc.utilityLines.length}항목`
            }
          />

          {/* KPI 4: Total Production Cost (Primary Navy Highlight) */}
          <KpiCard
            title={isEn ? 'Total Production Cost' : '총 제조원가'}
            primary={`${fmtKrwPerT(calc.totalProdCostUsdPerT, calc.fxKrwPerUsd)}/t`}
            secondary={`${fmtUsd(calc.totalProdCostUsdPerT, 1)}/t`}
            footer={
              isEn
                ? `Margin ${fmtUsd(calc.grossMarginUsdPerT, 1)}/t vs Price`
                : `판가 대비 마진 ${fmtUsd(calc.grossMarginUsdPerT, 1)}/t`
            }
            highlighted
          />

          {/* KPI 5: Annual EBITDA & Payback */}
          <KpiCard
            title={isEn ? 'Annual EBITDA · Payback' : '연간 EBITDA · 회수기간'}
            primary={`${fmtNum(calc.annualEbitdaEokKrw, 0)} ${isEn ? '×10⁸ ₩/yr' : '억 원/yr'}`}
            secondary={
              Number.isFinite(calc.paybackYears)
                ? `Payback ${fmtNum(calc.paybackYears, 1)} yr`
                : isEn
                  ? 'Payback N/A (Negative)'
                  : '회수불가 (적자)'
            }
            footer={
              isEn
                ? `Revenue ${fmtNum(calc.annualRevenueEokKrw, 0)} · ROI ${fmtNum(calc.roiPct, 1)}%`
                : `매출 ${fmtNum(calc.annualRevenueEokKrw, 0)}억 · ROI ${fmtNum(calc.roiPct, 1)}%`
            }
            accentTone={calc.annualEbitdaEokKrw >= 0 ? 'positive' : 'negative'}
          />
        </section>

        {/* 4. PROCESS BLOCK FLOW STRIP */}
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 11,
            padding: '12px 16px',
          }}
        >
          <div
            style={{
              fontSize: 11.8,
              fontWeight: 800,
              color: '#0F172A',
              marginBottom: 10,
            }}
          >
            {isEn ? 'Process Block Flow Diagram (BFD)' : '주요 공정 블록 흐름도 (Block Flow)'}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {selectedEntry.blockSteps.map((step, idx) => (
              <React.Fragment key={`${selectedEntry.id}-step-${idx}`}>
                <div
                  style={{
                    flex: '1 1 155px',
                    minWidth: 145,
                    padding: '9px 11px',
                    borderRadius: 8,
                    background: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: 10.5,
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span
                    style={{
                      fontSize: 11.4,
                      fontWeight: 700,
                      color: '#1E293B',
                      lineHeight: 1.35,
                    }}
                  >
                    {step}
                  </span>
                </div>
                {idx < selectedEntry.blockSteps.length - 1 && (
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 900,
                      color: '#64748B',
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    →
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* 5. COST STRUCTURE STACKED BAR */}
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 11,
            padding: '13px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 9,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
              {isEn
                ? 'Unit Manufacturing Cost Breakdown'
                : '톤당 제조원가 구성비 (원료 / 유틸리티 / 고정비 / 감가상각)'}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1E3A8A' }}>
              {fmtUsd(calc.totalProdCostUsdPerT, 1)}/t ({fmtKrwPerT(calc.totalProdCostUsdPerT, calc.fxKrwPerUsd)}/t)
            </div>
          </div>

          <div
            style={{
              width: '100%',
              height: 22,
              borderRadius: 7,
              overflow: 'hidden',
              display: 'flex',
              background: '#E2E8F0',
              border: '1px solid #CBD5E1',
            }}
          >
            {costBarSegments.map((seg) => (
              <div
                key={seg.key}
                title={`${seg.label}: ${fmtUsd(seg.usdPerT, 1)}/t (${fmtNum(seg.pct, 1)}%)`}
                style={{
                  width: `${Math.max(seg.pct, 0)}%`,
                  background: seg.color,
                  color: '#FFFFFF',
                  fontSize: 10,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  transition: 'width 0.2s ease',
                }}
              >
                {seg.pct >= 11 ? `${fmtNum(seg.pct, 0)}%` : ''}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
              gap: 8,
              marginTop: 10,
            }}
          >
            {costBarSegments.map((seg) => (
              <div
                key={seg.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '6px 9px',
                  borderRadius: 7,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#334155' }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: seg.color,
                      flexShrink: 0,
                    }}
                  />
                  {seg.label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#0F172A' }}>
                  {fmtUsd(seg.usdPerT, 1)}/t{' '}
                  <span style={{ color: '#64748B', fontWeight: 600 }}>({fmtNum(seg.pct, 1)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 6. UNIT CONSUMPTION & VARIABLE COST TABLES */}
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 11,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#0F172A' }}>
              {isEn
                ? 'Unit Consumption & Variable Cost Schedule (Per Ton Product)'
                : '원단위 및 변동비 상세 명세 (제품 1 ton 생산 기준)'}
            </h3>
            <span style={{ fontSize: 10.8, color: '#64748B', fontWeight: 600 }}>
              {isEn
                ? 'Tip: Click any unit price ($/unit) cell to edit live'
                : '단가($/unit) 입력란을 수정하면 제조원가와 EBITDA가 즉시 재계산됩니다'}
            </span>
          </div>

          {/* 6A. Raw Materials */}
          <div>
            <div style={tableSectionTitleStyle}>
              {isEn ? 'A. Raw Materials & Catalysts' : 'A. 원료 및 촉매 원단위 (Raw Materials)'}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>{isEn ? 'Item' : '항목'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Consumption / t' : '원단위 (/t)'}</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: 132 }}>
                      {isEn ? 'Unit Price ($/unit)' : '단가 ($/unit)'}
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Cost ($/t)' : '원가 ($/t)'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Cost (₩/t)' : '원가 (₩/t)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.rawMaterialLines.map((line) => {
                    const isOverridden = feedPriceOverrides[line.id] !== undefined;
                    return (
                      <tr key={line.id} style={tbodyRowStyle}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{line.name}</div>
                          {line.note && (
                            <div style={{ fontSize: 10.2, color: '#64748B', marginTop: 1 }}>
                              {line.note}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                          {fmtNum(line.consumptionPerT, line.consumptionPerT < 10 ? 3 : 1)}{' '}
                          <span style={{ color: '#64748B' }}>{line.unit}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <InlinePriceInput
                            value={line.unitPriceUsd}
                            modified={isOverridden}
                            onChange={(val) =>
                              setFeedPriceOverrides((prev) => ({ ...prev, [line.id]: val }))
                            }
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          {fmtUsd(line.costUsdPerT, 1)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#334155' }}>
                          {fmtKrwPerT(line.costUsdPerT, calc.fxKrwPerUsd)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={subtotalRowStyle}>
                    <td colSpan={3} style={{ ...tdStyle, fontWeight: 800 }}>
                      {isEn ? 'Subtotal — Raw Materials' : '소계 — 원료비'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#1E3A8A' }}>
                      {fmtUsd(calc.rawMaterialUsdPerT, 1)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#1E3A8A' }}>
                      {fmtKrwPerT(calc.rawMaterialUsdPerT, calc.fxKrwPerUsd)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 6B. Utilities */}
          <div>
            <div style={tableSectionTitleStyle}>
              {isEn ? 'B. Utilities' : 'B. 유틸리티 원단위 (Utilities)'}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>{isEn ? 'Utility' : '유틸리티 항목'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Consumption / t' : '원단위 (/t)'}</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: 132 }}>
                      {isEn ? 'Unit Price ($/unit)' : '단가 ($/unit)'}
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Cost ($/t)' : '원가 ($/t)'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Cost (₩/t)' : '원가 (₩/t)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.utilityLines.map((line) => {
                    const isOverridden =
                      utilPriceOverrides[line.id] !== undefined ||
                      (line.kind === 'power' && powerPriceOverride !== undefined) ||
                      (line.kind === 'steam' && steamPriceOverride !== undefined);
                    return (
                      <tr key={line.id} style={tbodyRowStyle}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: '#0F172A' }}>{line.name}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                          {fmtNum(line.consumptionPerT, line.consumptionPerT < 10 ? 2 : 0)}{' '}
                          <span style={{ color: '#64748B' }}>{line.unit}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <InlinePriceInput
                            value={line.unitPriceUsd}
                            modified={isOverridden}
                            step={line.unitPriceUsd < 1 ? 0.01 : 1}
                            onChange={(val) =>
                              setUtilPriceOverrides((prev) => ({ ...prev, [line.id]: val }))
                            }
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          {fmtUsd(line.costUsdPerT, 1)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#334155' }}>
                          {fmtKrwPerT(line.costUsdPerT, calc.fxKrwPerUsd)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={subtotalRowStyle}>
                    <td colSpan={3} style={{ ...tdStyle, fontWeight: 800 }}>
                      {isEn ? 'Subtotal — Utilities' : '소계 — 유틸리티'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#0284C7' }}>
                      {fmtUsd(calc.utilityUsdPerT, 1)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#0284C7' }}>
                      {fmtKrwPerT(calc.utilityUsdPerT, calc.fxKrwPerUsd)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 6C. Byproduct Credits (if any) */}
          {calc.byproductLines.length > 0 && (
            <div>
              <div style={tableSectionTitleStyle}>
                {isEn ? 'C. Byproduct Credits' : 'C. 부산물 크레딧 (Byproduct Credits)'}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={theadRowStyle}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{isEn ? 'Byproduct' : '부산물'}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Yield / t' : '발생량 (/t)'}</th>
                      <th style={{ ...thStyle, textAlign: 'right', width: 132 }}>
                        {isEn ? 'Credit ($/unit)' : '크레딧 단가 ($/unit)'}
                      </th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Credit ($/t)' : '차감 ($/t)'}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Credit (₩/t)' : '차감 (₩/t)'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.byproductLines.map((line) => {
                      const isOverridden = byproductPriceOverrides[line.id] !== undefined;
                      return (
                        <tr key={line.id} style={tbodyRowStyle}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#0F172A' }}>{line.name}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                            {fmtNum(line.yieldPerT, line.yieldPerT < 10 ? 3 : 1)}{' '}
                            <span style={{ color: '#64748B' }}>{line.unit}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            <InlinePriceInput
                              value={line.creditPriceUsd}
                              modified={isOverridden}
                              onChange={(val) =>
                                setByproductPriceOverrides((prev) => ({
                                  ...prev,
                                  [line.id]: val,
                                }))
                              }
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                            -{fmtUsd(line.creditUsdPerT, 1)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#059669' }}>
                            -{fmtKrwPerT(line.creditUsdPerT, calc.fxKrwPerUsd)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={subtotalRowStyle}>
                      <td colSpan={3} style={{ ...tdStyle, fontWeight: 800 }}>
                        {isEn ? 'Subtotal — Byproduct Credits' : '소계 — 부산물 크레딧'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                        -{fmtUsd(calc.byproductCreditUsdPerT, 1)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                        -{fmtKrwPerT(calc.byproductCreditUsdPerT, calc.fxKrwPerUsd)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* 7. 1:1 ROUTE COMPARISON TABLE */}
        {comparableResults.length > 1 && (
          <section
            style={{
              background: '#FFFFFF',
              border: '1.5px solid #1E3A8A',
              borderRadius: 11,
              padding: '14px 16px',
              boxShadow: '0 2px 8px rgba(30, 58, 138, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#1E3A8A' }}>
                  {isEn
                    ? `1:1 Process Route Comparison — ${selectedEntry.productGroup}`
                    : `동일 제품 1:1 공법 경제성 비교 — ${selectedEntry.nameKo}`}
                </h3>
                <div style={{ fontSize: 10.8, color: '#475569', marginTop: 2 }}>
                  {isEn
                    ? `Normalized at ${fmtNum(effectiveCapacity, 0)} TPA · CEPCI ${cepci} · FX ₩${fmtNum(fxKrwPerUsd, 0)}/$. Click a row to switch route.`
                    : `동일 조건 (${fmtNum(effectiveCapacity, 0)} TPA · CEPCI ${cepci} · 환율 ₩${fmtNum(fxKrwPerUsd, 0)}/$) 기준 비교 · 행을 클릭하면 해당 공법으로 전환됩니다.`}
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>{isEn ? 'Process Route' : '공법 (Route)'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'CAPEX' : '총 CAPEX'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Net Raw ($/t)' : '순 원료비'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Utilities ($/t)' : '유틸리티'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Total Prod. Cost' : '총 제조원가'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Annual EBITDA' : '연간 EBITDA'}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{isEn ? 'Payback' : '회수기간'}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparableResults.map(({ entry, result }) => {
                    const isCurrent = entry.id === selectedEntry.id;
                    const isLowest = entry.id === lowestCostRouteId;
                    const netRaw = result.rawMaterialUsdPerT - result.byproductCreditUsdPerT;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => handleSelectProcess(entry)}
                        style={{
                          ...tbodyRowStyle,
                          background: isCurrent ? '#EFF6FF' : '#FFFFFF',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, color: isCurrent ? '#1E3A8A' : '#0F172A' }}>
                              {isEn ? entry.routeNameEn : entry.routeNameKo}
                            </span>
                            {isCurrent && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: '#1E3A8A',
                                  color: '#FFFFFF',
                                }}
                              >
                                {isEn ? 'Selected' : '현재 선택'}
                              </span>
                            )}
                            {isLowest && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: '#DCFCE7',
                                  color: '#166534',
                                  border: '1px solid #86EFAC',
                                }}
                              >
                                {isEn ? 'Lowest Cost' : '최저 원가'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          <div>{fmtNum(result.totalCapexEokKrw, 0)} {isEn ? '×10⁸₩' : '억'}</div>
                          <div style={{ fontSize: 10, color: '#64748B' }}>
                            ${fmtNum(result.totalCapexMUsd, 1)}M
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {fmtUsd(netRaw, 1)}/t
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {fmtUsd(result.utilityUsdPerT, 1)}/t
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 900, color: '#1E3A8A' }}>
                          <div>{fmtUsd(result.totalProdCostUsdPerT, 1)}/t</div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#475569' }}>
                            {fmtKrwPerT(result.totalProdCostUsdPerT, result.fxKrwPerUsd)}/t
                          </div>
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            fontWeight: 800,
                            color: result.annualEbitdaEokKrw >= 0 ? '#059669' : '#DC2626',
                          }}
                        >
                          {fmtNum(result.annualEbitdaEokKrw, 0)} {isEn ? '×10⁸₩' : '억/yr'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          {Number.isFinite(result.paybackYears)
                            ? `${fmtNum(result.paybackYears, 1)} yr`
                            : 'N/A'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 8. ENGINEERING DISCLAIMER FOOTER */}
        <footer
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#E2E8F0',
            color: '#475569',
            fontSize: 10.5,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: '#334155' }}>
            {isEn ? 'Engineering Disclaimer: ' : '엔지니어링 면책 고지: '}
          </strong>
          {isEn ? ENGINEERING_DISCLAIMER_EN : ENGINEERING_DISCLAIMER_KO}
        </footer>
      </main>
    </div>
  );
}

/* ── Subcomponents ── */

function SensitivityInput({
  label,
  value,
  step,
  min,
  modified,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  modified: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: modified ? '#1E3A8A' : '#475569',
        }}
      >
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && parsed >= min) {
            onChange(parsed);
          }
        }}
        style={{
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          border: modified ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
          background: modified ? '#EFF6FF' : '#F8FAFC',
          color: '#0F172A',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function InlinePriceInput({
  value,
  modified,
  step = 1,
  onChange,
}: {
  value: number;
  modified: boolean;
  step?: number;
  onChange: (next: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={0}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          onChange(parsed);
        }
      }}
      style={{
        width: 96,
        padding: '4px 7px',
        borderRadius: 5,
        border: modified ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
        background: modified ? '#EFF6FF' : '#FFFFFF',
        color: '#0F172A',
        fontSize: 11.5,
        fontWeight: 700,
        textAlign: 'right',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    />
  );
}

function KpiCard({
  title,
  primary,
  secondary,
  footer,
  highlighted = false,
  accentTone,
}: {
  title: string;
  primary: string;
  secondary: string;
  footer: string;
  highlighted?: boolean;
  accentTone?: 'positive' | 'negative';
}) {
  const primaryColor = highlighted
    ? '#FFFFFF'
    : accentTone === 'positive'
      ? '#047857'
      : accentTone === 'negative'
        ? '#DC2626'
        : '#0F172A';

  return (
    <div
      style={{
        background: highlighted
          ? 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)'
          : '#FFFFFF',
        border: highlighted ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
        borderRadius: 10,
        padding: '12px 13px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 4,
        boxShadow: highlighted
          ? '0 4px 12px rgba(30, 58, 138, 0.25)'
          : '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: highlighted ? '#BFDBFE' : '#64748B',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 900,
          color: primaryColor,
          letterSpacing: '-0.3px',
          lineHeight: 1.2,
          marginTop: 2,
        }}
      >
        {primary}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: highlighted ? '#E0E7FF' : '#334155',
        }}
      >
        {secondary}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: highlighted ? '#93C5FD' : '#64748B',
          marginTop: 3,
          borderTop: highlighted ? '1px solid rgba(255,255,255,0.14)' : '1px solid #F1F5F9',
          paddingTop: 5,
        }}
      >
        {footer}
      </div>
    </div>
  );
}

/* ── Shared Table Styles ── */

const tableSectionTitleStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 800,
  color: '#1E3A8A',
  marginBottom: 6,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11.6,
};

const theadRowStyle: React.CSSProperties = {
  background: '#F8FAFC',
  borderTop: '1px solid #CBD5E1',
  borderBottom: '1.5px solid #CBD5E1',
};

const thStyle: React.CSSProperties = {
  padding: '7px 9px',
  fontSize: 10.8,
  fontWeight: 800,
  color: '#475569',
  whiteSpace: 'nowrap',
};

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid #E2E8F0',
};

const subtotalRowStyle: React.CSSProperties = {
  background: '#F8FAFC',
  borderTop: '1.5px solid #CBD5E1',
  borderBottom: '1px solid #CBD5E1',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 9px',
  verticalAlign: 'middle',
};

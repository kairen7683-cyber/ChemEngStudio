import type ExcelJS from 'exceljs';

function colIndexToLetter(colIdx1Based: number): string {
  let n = colIdx1Based;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

/**
 * A4 용지 비율(210 × 297 mm)에 맞춰 엑셀 데이터시트의 행 높이·여백·인쇄 영역을 자동 보정합니다.
 * - 가로가 넓어 fitToWidth=1 축소 시 세로가 지나치게 짧아지는 현상("위아래 짧음")을 방지하기 위해
 *   실제 컬럼 총 너비(pt)에 대응하는 A4 목표 높이(portrait: 1.44×, landscape: 0.69×)를 계산하고
 *   모든 행 높이를 비례 확대하여 A4 한 장을 위아래 꽉 차게 맞춥니다.
 */
export function applyA4PrintFit(
  ws: ExcelJS.Worksheet,
  colWidths: number[],
  totalRows: number,
  options?: {
    orientation?: 'portrait' | 'landscape';
    fitToHeight?: number;
    defaultRowHeight?: number;
    maxRowScale?: number;
    maxRowHeight?: number;
    verticalCentered?: boolean;
  }
): void {
  const orientation = options?.orientation ?? 'portrait';
  const fitToHeight = options?.fitToHeight ?? 1;
  const fallbackH = options?.defaultRowHeight ?? 16;
  const maxRowScale = options?.maxRowScale ?? 1.85;
  const maxRowHeight = options?.maxRowHeight ?? 38;

  const colCount = Math.max(1, colWidths.length);
  const lastCol = colIndexToLetter(colCount);
  const safeRows = Math.max(1, totalRows);

  // Excel 열 너비 1단위 ≈ 5.35 pt (Arial/Calibri 10pt 기준)
  const totalWidthPt = colWidths.reduce((s, w) => s + Math.max(1, w), 0) * 5.35;

  // A4 인쇄 가능 영역 (여백 좌우 0.32in, 상하 0.35in 기준)
  // Portrait: 7.63in × 10.99in (비율 1.440) / Landscape: 10.99in × 7.63in (비율 0.694)
  const targetAspect = orientation === 'portrait' ? 1.43 : 0.685;

  if (fitToHeight === 1) {
    let currentHeightPt = 0;
    const rowHeights: number[] = [];
    for (let r = 1; r <= safeRows; r++) {
      const row = ws.getRow(r);
      const h = typeof row.height === 'number' && row.height > 0 ? row.height : fallbackH;
      rowHeights.push(h);
      currentHeightPt += h;
    }

    const targetHeightPt = totalWidthPt * targetAspect * 0.96;
    if (currentHeightPt > 0 && currentHeightPt < targetHeightPt) {
      const scale = Math.min(maxRowScale, targetHeightPt / currentHeightPt);
      for (let r = 1; r <= safeRows; r++) {
        const baseH = rowHeights[r - 1];
        const nextH = Math.min(maxRowHeight, Number((baseH * scale).toFixed(1)));
        ws.getRow(r).height = nextH;
      }
    }
  }

  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight,
    horizontalCentered: true,
    verticalCentered: options?.verticalCentered ?? (fitToHeight === 1),
    margins: {
      left: 0.32,
      right: 0.32,
      top: 0.35,
      bottom: 0.35,
      header: 0.2,
      footer: 0.2,
    },
    printArea: `A1:${lastCol}${safeRows}`,
  };
}

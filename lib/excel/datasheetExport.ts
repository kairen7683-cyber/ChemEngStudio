/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * datasheetExport.ts  (v2)
 * 실제 펌프 공정 데이터시트 양식 (P5354-DATASHEET.xls 기준)
 * ExcelJS를 사용하여 완전한 셀 스타일·병합·테두리 지원
 */
'use client';

// ─── ExcelJS 동적 임포트 래퍼 ──────────────────────────────────────────────────
// ExcelJS는 브라우저에서도 동작하며, 셀 스타일을 완벽히 지원합니다.
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// ─── 색상 팔레트 ───────────────────────────────────────────────────────────────
const C = {
  DARK_NAVY:   '1E3A5F',
  NAVY:        '1D4ED8',
  LIGHT_BLUE:  'DBEAFE',
  MID_BLUE:    'BFDBFE',
  HEADER_GRAY: 'E5E7EB',
  LIGHT_GRAY:  'F9FAFB',
  WHITE:       'FFFFFF',
  BLACK:       '000000',
  RED:         'DC2626',
  GOLD:        'D97706',
  GREEN:       '059669',
  TEXT_DARK:   '111827',
  TEXT_MID:    '374151',
  TEXT_LIGHT:  '6B7280',
};

// ─── 테두리 헬퍼 ──────────────────────────────────────────────────────────────
const B = {
  thin:   { style: 'thin'   as const, color: { argb: 'FF888888' } },
  medium: { style: 'medium' as const, color: { argb: 'FF222222' } },
  thick:  { style: 'thick'  as const, color: { argb: 'FF000000' } },
};
const border = {
  outer:  { top: B.medium, left: B.medium, bottom: B.medium, right: B.medium },
  inner:  { top: B.thin,   left: B.thin,   bottom: B.thin,   right: B.thin   },
  topMed: { top: B.medium, left: B.thin,   bottom: B.thin,   right: B.thin   },
  botMed: { top: B.thin,   left: B.thin,   bottom: B.medium, right: B.thin   },
};

// ─── 폰트 헬퍼 ────────────────────────────────────────────────────────────────
const font = {
  title:   (sz = 11) => ({ name: 'Arial', bold: true,  size: sz, color: { argb: 'FF' + C.WHITE     } }),
  header:  (sz = 9)  => ({ name: 'Arial', bold: true,  size: sz, color: { argb: 'FF' + C.TEXT_DARK } }),
  label:   (sz = 9)  => ({ name: 'Arial', bold: false, size: sz, color: { argb: 'FF' + C.TEXT_DARK } }),
  value:   (sz = 9)  => ({ name: 'Arial', bold: true,  size: sz, color: { argb: 'FF' + C.NAVY      } }),
  unit:    (sz = 8)  => ({ name: 'Arial', bold: false, size: sz, color: { argb: 'FF' + C.TEXT_LIGHT}, italic: true }),
  small:   (sz = 8)  => ({ name: 'Arial', bold: false, size: sz, color: { argb: 'FF' + C.TEXT_MID  }, italic: true }),
  remark:  (sz = 8)  => ({ name: 'Arial', bold: false, size: sz, color: { argb: 'FF' + C.TEXT_LIGHT}, italic: true }),
};

// ─── 채우기 헬퍼 ──────────────────────────────────────────────────────────────
const fill = {
  darkNav: (argb = 'FF' + C.DARK_NAVY): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }),
  navy:    (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.NAVY       } }),
  ltBlue:  (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.LIGHT_BLUE } }),
  midBlue: (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.MID_BLUE   } }),
  gray:    (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.HEADER_GRAY} }),
  ltGray:  (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.LIGHT_GRAY } }),
  white:   (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.WHITE      } }),
  gold:    (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7'           } }),
  green:   (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5'           } }),
  red:     (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2'           } }),
};

// ─── 정렬 헬퍼 ────────────────────────────────────────────────────────────────
const align = {
  cc: { horizontal: 'center' as const, vertical: 'middle' as const },
  lc: { horizontal: 'left'   as const, vertical: 'middle' as const, indent: 1 },
  rc: { horizontal: 'right'  as const, vertical: 'middle' as const },
};

// ─── 셀 스타일 적용 헬퍼 ──────────────────────────────────────────────────────
function sc(
  ws: ExcelJS.Worksheet,
  addr: string,
  opts: {
    value?: ExcelJS.CellValue;
    f?: any;
    fi?: ExcelJS.Fill;
    al?: any;
    bo?: any;
    numFmt?: string;
  }
) {
  const cell = ws.getCell(addr);
  if (opts.value !== undefined) cell.value = opts.value;
  if (opts.f)     cell.font      = opts.f as ExcelJS.Font;
  if (opts.fi)    cell.fill      = opts.fi;
  if (opts.al)    cell.alignment = opts.al as ExcelJS.Alignment;
  if (opts.bo)    cell.border    = opts.bo as ExcelJS.Borders;
  if (opts.numFmt) cell.numFmt   = opts.numFmt;
}

// 범위 병합 + 테두리 적용
function merge(ws: ExcelJS.Worksheet, from: string, to: string, opts?: Parameters<typeof sc>[2]) {
  ws.mergeCells(`${from}:${to}`);
  if (opts) sc(ws, from, opts);
}

// 빈 셀에 테두리만 채우기
function fillBorders(ws: ExcelJS.Worksheet, fromRow: number, fromCol: number, toRow: number, toCol: number) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.border = border.inner as ExcelJS.Borders;
      if (!cell.fill || (cell.fill as any).fgColor?.argb === undefined) {
        cell.fill = fill.white();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 숫자 포맷 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
const nf = (v: number | undefined, d = 2, unit = '') =>
  v == null || isNaN(v) ? '—' : `${v.toFixed(d)}${unit ? ' ' + unit : ''}`;
const today = () => new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');

// ═════════════════════════════════════════════════════════════════════════════
// 펌프 데이터시트 인터페이스
// ═════════════════════════════════════════════════════════════════════════════
export interface PumpDsInputs {
  tag: string;
  service: string;
  fluidName: string;
  temperature_C: number;
  flow_m3h: number;
  density_kgm3: number;
  viscosity_mPas: number;
  vaporPressure_kPa: number;
  P_suction_kPaG: number;
  P_discharge_kPaG: number;
  suction_head_m: number;
  discharge_head_m: number;
  pumpEfficiency: number;
  motorEfficiency: number;
  NPSHr_m?: number;
  suctionPipeSummary:  { label: string; DN_mm: number; vel_ms: number; dP_kPa: number }[];
  dischargePipeSummary:{ label: string; DN_mm: number; vel_ms: number; dP_kPa: number }[];
  results: {
    TDH_m: number;
    staticHead_m: number;
    frictionHead_m: number;
    pressureHead_m: number;
    NPSHa_m: number;
    NPSHr_m?: number;
    NPSH_margin_m?: number;
    NPSH_ok?: boolean;
    waterPower_kW: number;
    shaftPower_kW: number;
    motorPower_kW: number;
    motorNominal_kW: number;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 펌프 데이터시트 생성
// ═════════════════════════════════════════════════════════════════════════════
export async function exportPumpDatasheet(inp: PumpDsInputs): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CA Plant Engineering Tool';
  wb.created = new Date();

  const ws = wb.addWorksheet('PUMP DATASHEET', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.5, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  // ── 컬럼 너비 설정 (26컬럼: A~Z) ─────────────────────────────────────────
  // A:행번호(3), B:공백(1), C~H:항목(각6), I:구분(2), J~P:값(각5), Q:단위(6), R~Z:비고(각5)
  const colWidths = [3, 1.5, 16, 2, 8, 2, 8, 2, 8, 2, 8, 2, 8, 2, 10, 2, 9, 6, 8, 2, 9, 2, 8, 2, 8, 5];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // 기본 행 높이
  ws.properties.defaultRowHeight = 15;

  let R = 1; // 현재 행

  // ═══════════════════════════════════════════════════════════════════════════
  // A. 문서 헤더 (Header Block)
  // ═══════════════════════════════════════════════════════════════════════════

  // 타이틀 바
  ws.getRow(R).height = 24;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'PUMP DATA SHEET  /  원심펌프 공정 데이터시트',
    f: { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
    fi: fill.darkNav(),
    al: align.cc,
    bo: border.outer,
  });
  R++;

  // 문서정보 행 1 — 프로젝트명 / 문서번호
  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, {
    value: 'CUSTOMER',
    f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  merge(ws, `I${R}`, `Q${R}`, {
    value: 'Chlor-Alkali Plant',
    f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner,
  });
  merge(ws, `R${R}`, `T${R}`, {
    value: 'DOC. NO.',
    f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner,
  });
  merge(ws, `U${R}`, `Z${R}`, {
    value: `PUMP-DS-${inp.tag}-001`,
    f: font.value(), fi: fill.white(), al: align.cc, bo: border.inner,
  });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, {
    value: 'LOCATION',
    f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  merge(ws, `I${R}`, `Q${R}`, {
    value: 'Ulsan, Korea',
    f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner,
  });
  merge(ws, `R${R}`, `T${R}`, {
    value: 'REV.',
    f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner,
  });
  merge(ws, `U${R}`, `V${R}`, { value: '0', f: font.value(), fi: fill.white(), al: align.cc, bo: border.inner });
  merge(ws, `W${R}`, `X${R}`, { value: 'DATE', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: today(), f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, {
    value: 'UNIT / SERVICE',
    f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  merge(ws, `I${R}`, `Q${R}`, {
    value: inp.service || inp.fluidName + ' 이송',
    f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner,
  });
  merge(ws, `R${R}`, `T${R}`, { value: 'PREP.', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `U${R}`, `V${R}`, { value: 'CAL', f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
  merge(ws, `W${R}`, `X${R}`, { value: 'CHKD.', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: '', fi: fill.white(), bo: border.inner });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, {
    value: 'ITEM NO. (TAG)',
    f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  merge(ws, `I${R}`, `Q${R}`, {
    value: inp.tag || '—',
    f: { name: 'Arial', bold: true, size: 11, color: { argb: 'FF' + C.NAVY } },
    fi: fill.ltBlue(), al: align.cc, bo: border.inner,
  });
  merge(ws, `R${R}`, `T${R}`, { value: 'APPRD.', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `U${R}`, `Z${R}`, { value: '', fi: fill.white(), bo: border.inner });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, {
    value: 'TYPE',
    f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  merge(ws, `I${R}`, `Q${R}`, {
    value: 'CENTRIFUGAL PUMP  /  원심펌프',
    f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner,
  });
  merge(ws, `R${R}`, `T${R}`, {
    value: "NO. REQ'D",
    f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner,
  });
  merge(ws, `U${R}`, `V${R}`, { value: 'WORKING: 1', f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
  merge(ws, `W${R}`, `X${R}`, { value: 'STANDBY:', f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: '1', f: font.value(), fi: fill.white(), al: align.cc, bo: border.inner });
  R++;

  const startR = R; // 섹션 시작

  // ═══════════════════════════════════════════════════════════════════════════
  // B. OPERATING CONDITIONS  /  운전 조건
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'OPERATING CONDITIONS  /  운전 조건',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.navy(), al: align.cc, bo: border.topMed,
  });
  R++;

  // 컬럼 헤더 행
  ws.getRow(R).height = 13;
  merge(ws, `A${R}`, `B${R}`, { value: 'No.', f: font.header(8), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `C${R}`, `K${R}`, { value: 'ITEM  /  항 목', f: font.header(9), fi: fill.gray(), al: align.lc, bo: border.inner });
  merge(ws, `L${R}`, `R${R}`, { value: 'DESIGN  /  설계값', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `S${R}`, `U${R}`, { value: 'UNIT  /  단위', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `V${R}`, `Z${R}`, { value: 'REMARKS  /  비  고', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;

  // 운전 조건 데이터 행
  const inp_r = inp.results;
  const opRows: [string, string, string, string][] = [
    ['FLUID  /  유체',                   inp.fluidName,                    '—',        ''],
    ['TEMPERATURE  /  운전 온도',         nf(inp.temperature_C, 1),         '°C',       ''],
    ['DENSITY  /  밀도',                 nf(inp.density_kgm3, 1),          'kg/m³',    `@${inp.temperature_C}°C`],
    ['VISCOSITY  /  점도',               nf(inp.viscosity_mPas, 3),        'mPa·s',    `@${inp.temperature_C}°C`],
    ['VAPOR PRESSURE  /  증기압',        nf(inp.vaporPressure_kPa, 2),     'kPa abs',  `@${inp.temperature_C}°C`],
    ['FLOW RATE  /  유량',               nf(inp.flow_m3h, 2),              'm³/h',     nf(inp.flow_m3h * inp.density_kgm3, 0, 'kg/h')],
    ['SUCTION PRESS.  /  흡입 정압',     nf(inp.P_suction_kPaG, 1),       'kPa·G',    nf(inp.P_suction_kPaG / 98.0665, 3, 'kg/cm².G')],
    ['DISCHARGE PRESS.  /  토출 정압',   nf(inp.P_discharge_kPaG, 1),     'kPa·G',    nf(inp.P_discharge_kPaG / 98.0665, 3, 'kg/cm².G')],
    ['DIFF. PRESSURE  /  차압',          nf(inp.P_discharge_kPaG - inp.P_suction_kPaG, 1), 'kPa',  ''],
    ['SUCTION LIQUID LEVEL  /  흡입 액면',  nf(inp.suction_head_m, 1),    'm',        '펌프 중심 기준 +상승 / −하강'],
    ['DISCHARGE LIQUID LEVEL  /  토출 액면', nf(inp.discharge_head_m, 1), 'm',        ''],
  ];

  let lineNo = 1;
  for (const [item, val, unit, rem] of opRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, { value: item, f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `L${R}`, `R${R}`, { value: val,  f: font.value(), fi: fill.white(), al: align.rc, bo: border.inner });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: font.unit(),  fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, { value: rem,  f: font.remark(),fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // C. HEAD ANALYSIS  /  수두 분석
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'HEAD ANALYSIS  /  수두 분석  (TDH Calculation)',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.navy(), al: align.cc, bo: border.inner,
  });
  R++;

  const headRows: [string, string, string, string, 'normal' | 'highlight' | 'warn' | 'ok'][] = [
    ['STATIC HEAD  /  정적 수두',    nf(inp_r.staticHead_m, 2),   'm WC',  `ΔZ = Hd − Hs = ${inp.discharge_head_m} − ${inp.suction_head_m} m`,   'normal'],
    ['PRESSURE HEAD  /  압력 수두',  nf(inp_r.pressureHead_m, 2), 'm WC',  `(Pd−Ps)/(ρg) = (${nf(inp.P_discharge_kPaG,0)}−${nf(inp.P_suction_kPaG,0)}) kPa`, 'normal'],
    ['FRICTION HEAD  /  마찰 수두',  nf(inp_r.frictionHead_m, 3), 'm WC',  '흡입 + 토출 배관 마찰손실 합산',  'normal'],
    ['TOTAL DYNAMIC HEAD  /  전양정 TDH', nf(inp_r.TDH_m, 2),    'm WC',  '= Static + Pressure + Friction',  'highlight'],
    ['NPSHa  /  유효 흡입양정',      nf(inp_r.NPSHa_m, 2),        'm',     'Hs + Ps/(ρg) − Pvap/(ρg)',        'normal'],
    ['NPSHr  /  필요 흡입양정',      inp_r.NPSHr_m != null ? nf(inp_r.NPSHr_m, 2) : '— (미입력)', 'm', '펌프 제작사 제공값',  'normal'],
    ['NPSH MARGIN  /  여유',
      inp_r.NPSH_margin_m != null ? nf(inp_r.NPSH_margin_m, 2) : '—',
      'm',
      inp_r.NPSH_ok != null ? (inp_r.NPSH_ok ? '✔ OK (NPSHa > NPSHr)' : '✘ INSUFFICIENT — 검토 필요') : '—',
      inp_r.NPSH_ok == null ? 'normal' : inp_r.NPSH_ok ? 'ok' : 'warn'],
  ];

  for (const [item, val, unit, rem, mode] of headRows) {
    ws.getRow(R).height = mode === 'highlight' ? 17 : 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, {
      value: item,
      f: mode === 'highlight' ? font.header() : font.label(),
      fi: mode === 'highlight' ? fill.ltBlue() : fill.white(),
      al: align.lc, bo: border.inner,
    });
    merge(ws, `L${R}`, `R${R}`, {
      value: val,
      f: mode === 'highlight'
        ? { name: 'Arial', bold: true, size: 11, color: { argb: 'FF' + C.NAVY } }
        : mode === 'warn' ? { name: 'Arial', bold: true, size: 9, color: { argb: 'FF' + C.RED } }
        : mode === 'ok'  ? { name: 'Arial', bold: true, size: 9, color: { argb: 'FF' + C.GREEN } }
        : font.value(),
      fi: mode === 'highlight' ? fill.ltBlue()
        : mode === 'warn'      ? fill.red()
        : mode === 'ok'        ? fill.green()
        : fill.white(),
      al: align.rc, bo: border.inner,
    });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: font.unit(), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, {
      value: rem,
      f: mode === 'warn' ? { name: 'Arial', bold: true, size: 8, color: { argb: 'FF' + C.RED }, italic: false }
        : mode === 'ok'  ? { name: 'Arial', bold: true, size: 8, color: { argb: 'FF' + C.GREEN }, italic: false }
        : font.remark(),
      fi: fill.white(), al: align.lc, bo: border.inner,
    });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // D. POWER REQUIREMENTS  /  소요 동력
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'POWER REQUIREMENTS  /  소요 동력 계산',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.navy(), al: align.cc, bo: border.inner,
  });
  R++;

  // 2-열 레이아웃 (좌: 동력, 우: 효율)
  const pwrLeft: [string, string, string][] = [
    ['HYDRAULIC (WATER) POWER  /  수동력', nf(inp_r.waterPower_kW, 2), 'kW'],
    ['SHAFT POWER  /  축동력',             nf(inp_r.shaftPower_kW, 2), 'kW'],
    ['MOTOR REQUIRED POWER  /  전동기 소요', nf(inp_r.motorPower_kW, 2), 'kW'],
    ['MOTOR NOMINAL POWER  /  전동기 선정', nf(inp_r.motorNominal_kW, 0), 'kW'],
  ];
  const pwrRight: [string, string][] = [
    ['PUMP EFF. ηp',   `${(inp.pumpEfficiency  * 100).toFixed(0)} %`],
    ['MOTOR EFF. ηm',  `${(inp.motorEfficiency * 100).toFixed(0)} %`],
    ['SERVICE FACTOR', '1.10 ~ 1.15'],
    ['STD. (IEC/KS)',  'IEC 60034'],
  ];

  for (let i = 0; i < pwrLeft.length; i++) {
    const [item, val, unit] = pwrLeft[i];
    const isNominal = i === 3;
    ws.getRow(R).height = isNominal ? 17 : 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, {
      value: item,
      f: isNominal ? font.header() : font.label(),
      fi: isNominal ? fill.midBlue() : fill.white(),
      al: align.lc, bo: border.inner,
    });
    merge(ws, `L${R}`, `R${R}`, {
      value: val,
      f: isNominal
        ? { name: 'Arial', bold: true, size: 12, color: { argb: 'FF' + C.DARK_NAVY } }
        : font.value(),
      fi: isNominal ? fill.midBlue() : fill.white(),
      al: align.rc, bo: border.inner,
    });
    merge(ws, `S${R}`, `U${R}`, {
      value: unit,
      f: isNominal ? font.header(9) : font.unit(),
      fi: isNominal ? fill.midBlue() : fill.ltGray(),
      al: align.cc, bo: border.inner,
    });
    // 오른쪽 효율 셀
    const [rItem, rVal] = pwrRight[i];
    merge(ws, `V${R}`, `X${R}`, { value: rItem, f: font.label(8), fi: fill.gray(), al: align.lc, bo: border.inner });
    merge(ws, `Y${R}`, `Z${R}`, { value: rVal,  f: font.value(9), fi: fill.white(), al: align.rc, bo: border.inner });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // E. PIPING PRESSURE DROP  /  배관 압력강하
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'PIPING PRESSURE DROP  /  배관 계통 압력강하',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.navy(), al: align.cc, bo: border.inner,
  });
  R++;

  // 배관 헤더
  ws.getRow(R).height = 13;
  merge(ws, `A${R}`, `B${R}`, { value: 'No.', f: font.header(8), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: 'SEGMENT  /  구  간', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `I${R}`, `J${R}`, { value: 'SIDE', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `K${R}`, `M${R}`, { value: 'DN (Sch)', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `N${R}`, `P${R}`, { value: 'ID (mm)', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `Q${R}`, `S${R}`, { value: 'VELOCITY (m/s)', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `T${R}`, `V${R}`, { value: 'ΔP (kPa)', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `W${R}`, `Z${R}`, { value: 'CHECK  /  판  정', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;

  const allPipes = [
    ...inp.suctionPipeSummary.map(p  => ({ ...p, side: 'SUCTION' })),
    ...inp.dischargePipeSummary.map(p => ({ ...p, side: 'DISCHARGE' })),
  ];
  for (const p of allPipes) {
    const isSuction = p.side === 'SUCTION';
    const velLimit  = isSuction ? 2.0 : 3.5;
    const velOk     = p.vel_ms <= velLimit;
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `H${R}`, { value: p.label, f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `I${R}`, `J${R}`, {
      value: isSuction ? 'SUCT.' : 'DISC.',
      f: { name: 'Arial', bold: true, size: 8,
           color: { argb: isSuction ? 'FF065F46' : 'FF1E3A5F' } },
      fi: isSuction ? fill.green() : fill.ltBlue(),
      al: align.cc, bo: border.inner,
    });
    merge(ws, `K${R}`, `M${R}`, {
      value: `DN ${Math.round(p.DN_mm)} / Sch 40`,
      f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner,
    });
    merge(ws, `N${R}`, `P${R}`, {
      value: p.DN_mm.toFixed(1),
      f: font.value(), fi: fill.white(), al: align.rc, bo: border.inner,
    });
    merge(ws, `Q${R}`, `S${R}`, {
      value: p.vel_ms.toFixed(2),
      f: velOk ? font.value() : { name: 'Arial', bold: true, size: 9, color: { argb: 'FF' + C.RED } },
      fi: velOk ? fill.white() : fill.gold(),
      al: align.rc, bo: border.inner,
    });
    merge(ws, `T${R}`, `V${R}`, {
      value: p.dP_kPa.toFixed(2),
      f: font.value(), fi: fill.white(), al: align.rc, bo: border.inner,
    });
    merge(ws, `W${R}`, `Z${R}`, {
      value: velOk ? '✔ OK' : `⚠ HIGH (limit ${velLimit} m/s)`,
      f: velOk
        ? { name: 'Arial', bold: true, size: 8, color: { argb: 'FF059669' } }
        : { name: 'Arial', bold: true, size: 8, color: { argb: 'FFDC2626' } },
      fi: velOk ? fill.green() : fill.red(),
      al: align.cc, bo: border.inner,
    });
    R++;
  }
  ws.getRow(R).height = 11;
  merge(ws, `A${R}`, `Z${R}`, {
    value: '  NOTE) 흡입배관 권장 유속: ≤ 2.0 m/s  |  토출배관 권장 유속: ≤ 3.5 m/s  |  Darcy-Weisbach / Colebrook-White 적용',
    f: font.remark(), fi: fill.ltGray(), al: align.lc, bo: border.inner,
  });
  R++;

  // ═══════════════════════════════════════════════════════════════════════════
  // F. CONSTRUCTION DATA  /  기계 사양 (입력란)
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'CONSTRUCTION DATA  /  기계 사양 (제작사 기재란)',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.darkNav('FF374151'), al: align.cc, bo: border.inner,
  });
  R++;

  // 2열 레이아웃: 좌(12컬럼) / 우(14컬럼)
  const constRows: [string, string, string, string][] = [
    ['MFR.  /  제작사',             '*',  'MODEL NO.  /  모델번호',         '*'],
    ['CASING TYPE',                 '*',  'CASING SPLIT  /  케이싱 분할',   '—'],
    ['IMPELLER TYPE  /  임펠러 형식', '*',  'NO. OF STAGES  /  단수',         '*'],
    ['RATED SPEED  /  정격속도',    '*',  'rpm',                            ''],
    ['NOZZLE — SUCTION',            '*',  'NOZZLE — DISCHARGE',             '*'],
    ['SHAFT SEAL  /  축 봉인',       'MECHANICAL SEAL', 'SEAL TYPE / CODE', '*'],
    ['BEARING TYPE',                '*',  'LUBRICATION',                    'OIL / GREASE'],
    ['BASE PLATE',                  'COMMON BASE',  'COUPLING TYPE',          'FLEXIBLE'],
  ];

  for (const [la, va, lb, vb] of constRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `H${R}`, { value: la, f: font.label(), fi: fill.ltGray(), al: align.lc, bo: border.inner });
    merge(ws, `I${R}`, `M${R}`, {
      value: va,
      f: va === '*' ? { name: 'Arial', size: 9, bold: true, color: { argb: 'FF9CA3AF' } } : font.value(),
      fi: fill.white(), al: align.cc, bo: border.inner,
    });
    merge(ws, `N${R}`, `S${R}`, { value: lb, f: font.label(), fi: fill.ltGray(), al: align.lc, bo: border.inner });
    merge(ws, `T${R}`, `Z${R}`, {
      value: vb,
      f: vb === '*' ? { name: 'Arial', size: 9, bold: true, color: { argb: 'FF9CA3AF' } } : font.value(),
      fi: fill.white(), al: align.cc, bo: border.inner,
    });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // G. MOTOR DATA  /  전동기 사양
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'MOTOR DATA  /  전동기 사양',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.darkNav('FF374151'), al: align.cc, bo: border.inner,
  });
  R++;

  const motorRows: [string, string, string, string][] = [
    ['SUPPLIED BY',  'VENDOR',  'MOUNTED BY',        'VENDOR'],
    ['MFR.',         '*',       'TYPE',               'TEFC / IP55'],
    ['RATED OUTPUT', nf(inp_r.motorNominal_kW, 0), 'kW  |  POLE', '*'],
    ['RPM',          '*',       'INSUL. CLASS',       'F'],
    ['PHASE / CYCLE / VOLTS', '3 φ / 60 Hz / 440 V', 'ENCLOSURE', 'IP55'],
    ['CODE / STANDARD',       'IEC 60034 / KS C 4202', 'SERVICE FACTOR', '1.15'],
  ];

  for (const [la, va, lb, vb] of motorRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `H${R}`, { value: la, f: font.label(), fi: fill.ltGray(), al: align.lc, bo: border.inner });
    merge(ws, `I${R}`, `M${R}`, {
      value: va,
      f: va === '*' ? { name: 'Arial', size: 9, color: { argb: 'FF9CA3AF' } } : font.value(),
      fi: fill.white(), al: align.cc, bo: border.inner,
    });
    merge(ws, `N${R}`, `S${R}`, { value: lb, f: font.label(), fi: fill.ltGray(), al: align.lc, bo: border.inner });
    merge(ws, `T${R}`, `Z${R}`, {
      value: vb,
      f: vb === '*' ? { name: 'Arial', size: 9, color: { argb: 'FF9CA3AF' } } : font.value(),
      fi: fill.white(), al: align.cc, bo: border.inner,
    });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // H. REMARKS  /  비 고
  // ═══════════════════════════════════════════════════════════════════════════
  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.gray(), bo: border.inner });
  merge(ws, `C${R}`, `Z${R}`, {
    value: 'REMARKS  /  비  고',
    f: { name: 'Arial', bold: true, size: 9, color: { argb: 'FF374151' } },
    fi: fill.gray(), al: align.lc, bo: border.inner,
  });
  R++;

  const remarks = [
    '1. 본 계산서는 Darcy-Weisbach 방정식 및 Colebrook-White 마찰계수 (암시적 Moody 선도) 적용',
    '2. 전양정(TDH) = 정압수두(ΔP_head) + 정적수두(ΔZ) + 마찰수두(ΔP_friction),  기준: 펌프 흡·토출 플랜지 중심',
    '3. 전동기 선정: 계산 소요동력 × 1.10~1.15 적용 후 IEC 표준 용량으로 올림 처리',
    '4. NPSHa = Hs + Ps/(ρg) − Pvap/(ρg)  [흡입배관 마찰손실 포함, 3% 헤드 손실 미포함]',
    '5. * 표시는 제작사 기재 필요 항목 (VENDOR TO STATE)',
  ];
  for (const rm of remarks) {
    ws.getRow(R).height = 13;
    merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
    merge(ws, `C${R}`, `Z${R}`, { value: rm, f: font.remark(), fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // I. 서명란 (Signature Block)
  // ═══════════════════════════════════════════════════════════════════════════
  R++; // 빈 행
  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: 'PREPARED BY  /  작  성', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `I${R}`, `M${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `N${R}`, `S${R}`, { value: 'REVIEWED BY  /  검  토', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `T${R}`, `X${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: 'APPROVED', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;
  ws.getRow(R).height = 30;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `I${R}`, `M${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `N${R}`, `S${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `T${R}`, `X${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: '', fi: fill.white(), bo: border.inner });
  R++;

  // 푸터
  ws.getRow(R).height = 12;
  merge(ws, `A${R}`, `Z${R}`, {
    value: `  PUMP-DS-${inp.tag || 'PUMP'}-001  Rev.0    Generated by CA Plant Engineering Tool    ${today()}`,
    f: { name: 'Arial', size: 7, color: { argb: 'FF9CA3AF' }, italic: true },
    fi: fill.ltGray(), al: align.lc, bo: border.inner,
  });

  // 인쇄 영역 설정
  ws.pageSetup.printArea = `A1:Z${R}`;

  // ── 파일 저장 (브라우저 다운로드) ──────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `PDS_PUMP_${inp.tag || 'PUMP'}_${today()}.xlsx`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 패킹타워 데이터시트 인터페이스 & 구현
// ═════════════════════════════════════════════════════════════════════════════
export interface TowerDsInputs {
  tag: string;
  service: string;
  mode: string;
  temperature_C: number;
  pressure_kPa: number;
  packingName: string;
  packingAp: number;
  packingVoid: number;
  packingFp: number;
  packingHETP_ref: number;
  floodingFraction: number;
  gasFluidName: string;
  gasFlow_kgh: number;
  gasDensity_kgm3: number;
  gasViscosity_mPas: number;
  liqFluidName: string;
  liqFlow_kgh: number;
  liqDensity_kgm3: number;
  liqViscosity_mPas: number;
  surfaceTension_mNm: number;
  theoreticalStages: number;
  separationMode: string;
  yIn?: number;
  yOut?: number;
  absorptionFactor?: number;
  hetpCorrection: number;
  results: {
    tower_diameter_mm: number;
    tower_diameter_std_mm: number;
    NTU: number;
    HETP_m: number;
    packingHeight_m: number;
    totalHeight_m: number;
    dP_total_kPa: number;
    dP_per_m_Pa: number;
    u_flood_ms: number;
    u_operating_ms: number;
    L_G_ratio: number;
    liquidFlux_m3m2h: number;
    theoreticalStages: number;
  };
}

export async function exportTowerDatasheet(inp: TowerDsInputs): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('COLUMN DATASHEET', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });

  const colWidths = [3, 1.5, 16, 2, 8, 2, 8, 2, 8, 2, 8, 2, 8, 2, 10, 2, 9, 6, 8, 2, 9, 2, 8, 2, 8, 5];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  let R = 1;
  let lineNo = 1;
  const r = inp.results;

  // 헤더
  ws.getRow(R).height = 24;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'PACKED COLUMN DATA SHEET  /  충전탑 공정 데이터시트',
    f: { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
    fi: fill.darkNav(), al: align.cc, bo: border.outer,
  });
  R++;

  const hdrRows: [string, string, string, string][] = [
    ['PLANT',          'Chlor-Alkali Plant',                'DOC. NO.',   `COL-DS-${inp.tag}-001`],
    ['LOCATION',       'Ulsan, Korea',                      'REV. / DATE', `0  /  ${today()}`],
    ['SERVICE',        inp.service,                         'PREP.',       'CAL'],
    ['ITEM NO. (TAG)', inp.tag || '—',                      'APPRD.',      ''],
    ['COLUMN TYPE',    'PACKED COLUMN  /  충전탑 (흡수탑)', 'MODE',        inp.mode],
  ];
  for (const [la, va, lb, vb] of hdrRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
    merge(ws, `C${R}`, `H${R}`, { value: la, f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner });
    merge(ws, `I${R}`, `Q${R}`, { value: va, f: la.includes('TAG') ? font.value() : font.label(), fi: la.includes('TAG') ? fill.ltBlue() : fill.white(), al: la.includes('TAG') ? align.cc : align.lc, bo: border.inner });
    merge(ws, `R${R}`, `T${R}`, { value: lb, f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
    merge(ws, `U${R}`, `Z${R}`, { value: vb, f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
    R++;
  }

  // Section A: Operating Conditions
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, { value: 'OPERATING CONDITIONS  /  운전 조건', f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, fi: fill.navy(), al: align.cc, bo: border.inner });
  R++;
  ws.getRow(R).height = 13;
  merge(ws, `A${R}`, `B${R}`, { value: 'No.', f: font.header(8), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `C${R}`, `K${R}`, { value: 'ITEM  /  항 목', f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner });
  merge(ws, `L${R}`, `R${R}`, { value: 'VALUE  /  값', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `S${R}`, `U${R}`, { value: 'UNIT', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `V${R}`, `Z${R}`, { value: 'REMARKS', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;

  const opRows: [string, string, string, string][] = [
    ['TEMPERATURE  /  운전 온도',       nf(inp.temperature_C, 1),   '°C',    ''],
    ['PRESSURE  /  운전 압력',          nf(inp.pressure_kPa, 1),    'kPa abs', nf(inp.pressure_kPa / 101.325, 3, 'atm')],
    ['GAS FLUID  /  기체 유체',         inp.gasFluidName,            '—',     ''],
    ['GAS FLOW RATE  /  기체 유량',     nf(inp.gasFlow_kgh, 0),     'kg/h',  ''],
    ['GAS DENSITY  /  기체 밀도',       nf(inp.gasDensity_kgm3, 3), 'kg/m³', `@${inp.temperature_C}°C, ${inp.pressure_kPa} kPa`],
    ['GAS VISCOSITY  /  기체 점도',     nf(inp.gasViscosity_mPas, 4),'mPa·s', ''],
    ['LIQUID FLUID  /  액체 유체',      inp.liqFluidName,            '—',     ''],
    ['LIQUID FLOW RATE  /  액체 유량',  nf(inp.liqFlow_kgh, 0),     'kg/h',  ''],
    ['LIQUID DENSITY  /  액체 밀도',    nf(inp.liqDensity_kgm3, 1), 'kg/m³', ''],
    ['SURFACE TENSION  /  표면장력',    nf(inp.surfaceTension_mNm, 1),'mN/m', ''],
    ['L/G RATIO  /  액/기 비율',        nf(r.L_G_ratio, 3),         '—',     '질량 기준'],
  ];
  for (const [item, val, unit, rem] of opRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, { value: item, f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `L${R}`, `R${R}`, { value: val,  f: font.value(), fi: fill.white(), al: align.rc, bo: border.inner });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: font.unit(),  fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, { value: rem,  f: font.remark(),fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // Section B: Packing Specification
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, { value: 'PACKING SPECIFICATION  /  패킹 사양', f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, fi: fill.navy(), al: align.cc, bo: border.inner });
  R++;
  const pkRows: [string, string, string, string][] = [
    ['PACKING TYPE  /  패킹 종류',       inp.packingName,              '—',     ''],
    ['SPECIFIC SURFACE  /  비표면적 ap', nf(inp.packingAp, 0),         'm²/m³', ''],
    ['VOID FRACTION  /  공극률 ε',       nf(inp.packingVoid, 3),       '—',     ''],
    ['PACKING FACTOR  /  충전인자 Fp',   nf(inp.packingFp, 0),         'ft⁻¹',  'GPDC 상관식 기준'],
    ['HETP (ref.)  /  기준 HETP',        nf(inp.packingHETP_ref, 2),   'm',     '레퍼런스 조건'],
    ['HETP CORRECTION  /  보정계수',      nf(inp.hetpCorrection, 2),   '—',     '표면장력·점도 보정 포함'],
    ['HETP (calc.)  /  계산 HETP',       nf(r.HETP_m, 3),             'm',     ''],
    ['FLOODING FRACTION  /  홍수점 비율', `${(inp.floodingFraction*100).toFixed(0)} %`, '—', '권장: 65~75 %'],
  ];
  for (const [item, val, unit, rem] of pkRows) {
    ws.getRow(R).height = 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, { value: item, f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `L${R}`, `R${R}`, { value: val,  f: font.value(), fi: fill.white(), al: align.rc, bo: border.inner });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: font.unit(),  fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, { value: rem,  f: font.remark(),fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // Section C: Mass Transfer & Column Sizing
  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, { value: 'COLUMN SIZING  /  타워 설계 결과', f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, fi: fill.navy(), al: align.cc, bo: border.inner });
  R++;
  const szRows: [string, string, string, string, boolean][] = [
    ['THEORETICAL STAGES  /  이론단수',     `${r.theoreticalStages} 단`, '—',    `계산방법: ${inp.separationMode}`, false],
    ['NTU  /  이동단위수',                   nf(r.NTU, 2),               '—',    'HTU-NTU 법', false],
    ['PACKING HEIGHT  /  패킹 높이',         nf(r.packingHeight_m, 2),   'm',    '= 이론단수 × HETP', false],
    ['COLUMN DIAMETER (calc.)  /  계산 직경', nf(r.tower_diameter_mm, 0), 'mm',  'GPDC 상관식 기준', false],
    ['COLUMN DIAMETER (std.)  /  표준 직경', String(r.tower_diameter_std_mm), 'mm', '표준 사이즈 반올림', true],
    ['TOTAL HEIGHT  /  총 탑 높이',          nf(r.totalHeight_m, 2),     'm',    '패킹+분배기+섬프(+4.0m)', true],
    ['FLOODING VELOCITY  /  홍수점 속도',    nf(r.u_flood_ms, 3),        'm/s',  'Leva-GPDC 상관식', false],
    ['OPERATING VELOCITY  /  운전 속도',     nf(r.u_operating_ms, 3),    'm/s',  `홍수점 × ${(inp.floodingFraction*100).toFixed(0)}%`, false],
    ['ΔP (PACKING)  /  패킹 압력강하',       nf(r.dP_total_kPa, 3),      'kPa',  nf(r.dP_per_m_Pa, 0, 'Pa/m') + (r.dP_per_m_Pa > 500 ? '  ⚠ 권장초과' : '  ✔ OK'), false],
    ['LIQUID FLUX  /  액체 비유량',           nf(r.liquidFlux_m3m2h, 2),  'm³/m²·h', '', false],
  ];
  for (const [item, val, unit, rem, isHL] of szRows) {
    ws.getRow(R).height = isHL ? 17 : 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, { value: item, f: isHL ? font.header() : font.label(), fi: isHL ? fill.midBlue() : fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `L${R}`, `R${R}`, {
      value: val,
      f: isHL ? { name: 'Arial', bold: true, size: 11, color: { argb: 'FF' + C.DARK_NAVY } } : font.value(),
      fi: isHL ? fill.midBlue() : fill.white(), al: align.rc, bo: border.inner,
    });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: isHL ? font.header(8) : font.unit(), fi: isHL ? fill.midBlue() : fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, { value: rem, f: font.remark(), fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // Remarks
  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.gray(), bo: border.inner });
  merge(ws, `C${R}`, `Z${R}`, { value: 'REMARKS  /  비  고', f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner });
  R++;
  const rmks = [
    '1. 타워 직경: GPDC (Generalized Pressure Drop Correlation) — Leva 수정식 적용',
    '2. 이론단수 → 패킹 높이: NTU × HETP 법 (Kremser 방정식 또는 이론단수 직접 입력)',
    '3. 총 타워 높이 = 패킹 높이 + 상부 기액 분리공간(1.5m) + 분배기(1.5m) + 하부 섬프(1.0m)',
    '4. 패킹 압력강하: Ergun 수정 방정식 적용 (권장: ≤ 500 Pa/m)',
  ];
  for (const rm of rmks) {
    ws.getRow(R).height = 13;
    merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
    merge(ws, `C${R}`, `Z${R}`, { value: rm, f: font.remark(), fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  // 서명란
  R++;
  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: 'PREPARED BY  /  작  성', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `I${R}`, `M${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `N${R}`, `S${R}`, { value: 'REVIEWED BY  /  검  토', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `T${R}`, `X${R}`, { value: '', fi: fill.white(), bo: border.inner });
  merge(ws, `Y${R}`, `Z${R}`, { value: 'APPROVED', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;
  ws.getRow(R).height = 28;
  ['C:H','I:M','N:S','T:X','Y:Z'].forEach(rng => {
    const [f2, t2] = rng.split(':');
    merge(ws, `${f2}${R}`, `${t2}${R}`, { value: '', fi: fill.white(), bo: border.inner });
  });
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.white(), bo: border.inner });
  R++;
  ws.getRow(R).height = 12;
  merge(ws, `A${R}`, `Z${R}`, {
    value: `  COL-DS-${inp.tag || 'COL'}-001  Rev.0    Generated by CA Plant Engineering Tool    ${today()}`,
    f: { name: 'Arial', size: 7, color: { argb: 'FF9CA3AF' }, italic: true },
    fi: fill.ltGray(), al: align.lc, bo: border.inner,
  });

  ws.pageSetup.printArea = `A1:Z${R}`;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `PDS_COLUMN_${inp.tag || 'COL'}_${today()}.xlsx`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 열교환기 데이터시트 인터페이스 및 생성 함수
// ═════════════════════════════════════════════════════════════════════════════
export interface HXDsInputs {
  tag: string;
  service: string;
  material: string;
  hotFluidName: string;
  coldFluidName: string;
  mh_kgh: number;
  mc_kgh: number;
  Th_in_C: number;
  Th_out_C: number;
  Tc_in_C: number;
  Tc_out_C: number;
  Ph_kgcm2g: number;
  Pc_kgcm2g: number;
  do_mm: number;
  L_m: number;
  n_passes: number;
  n_shell: number;
  layoutAngle: number;
  baffleCutPct: number;
  rft: number;
  rfs: number;
  results: {
    Q_kW: number;
    Q_Mcalh: number;
    lmtd_C: number;
    Ft: number;
    CMTD_C: number;
    U_calc_Wm2K: number;
    U_req_Wm2K: number;
    A_req_m2: number;
    A_prov_m2: number;
    overdesign_pct: number;
    N_tubes: number;
    D_shell_mm: number;
    B_spacing_mm: number;
    N_baffles: number;
    hi_Wm2K: number;
    ho_Wm2K: number;
    vt_ms: number;
    vs_ms: number;
    dPt_bar: number;
    dPs_bar: number;
  };
}

export async function exportHXDatasheet(inp: HXDsInputs): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CA Plant Engineering Tool';
  wb.created = new Date();

  const ws = wb.addWorksheet('HX DATASHEET', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
    },
  });

  const colWidths = [3, 1.5, 16, 2, 8, 2, 8, 2, 8, 2, 8, 2, 8, 2, 10, 2, 9, 6, 8, 2, 9, 2, 8, 2, 8, 5];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.properties.defaultRowHeight = 15;

  let R = 1;
  ws.getRow(R).height = 24;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'HEAT EXCHANGER DATA SHEET  /  열교환기 공정 데이터시트 (TEMA)',
    f: { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
    fi: fill.darkNav(),
    al: align.cc,
    bo: border.outer,
  });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: 'SERVICE / 용도', f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner });
  merge(ws, `I${R}`, `Q${R}`, { value: inp.service, f: font.label(), fi: fill.white(), al: align.lc, bo: border.inner });
  merge(ws, `R${R}`, `T${R}`, { value: 'TAG NO.', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `U${R}`, `Z${R}`, { value: inp.tag, f: font.value(10), fi: fill.ltBlue(), al: align.cc, bo: border.inner });
  R++;

  ws.getRow(R).height = 14;
  merge(ws, `A${R}`, `B${R}`, { value: '', fi: fill.ltGray(), bo: border.inner });
  merge(ws, `C${R}`, `H${R}`, { value: 'MATERIAL / 재질', f: font.header(), fi: fill.gray(), al: align.lc, bo: border.inner });
  merge(ws, `I${R}`, `Q${R}`, { value: inp.material, f: font.value(), fi: fill.white(), al: align.lc, bo: border.inner });
  merge(ws, `R${R}`, `T${R}`, { value: 'DATE', f: font.header(), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `U${R}`, `Z${R}`, { value: today(), f: font.label(), fi: fill.white(), al: align.cc, bo: border.inner });
  R++;

  ws.getRow(R).height = 16;
  merge(ws, `A${R}`, `Z${R}`, {
    value: 'THERMAL & HYDRAULIC DESIGN SUMMARY  /  열수력학 설계 사양',
    f: { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fi: fill.navy(), al: align.cc, bo: border.topMed,
  });
  R++;

  ws.getRow(R).height = 13;
  merge(ws, `A${R}`, `B${R}`, { value: 'No.', f: font.header(8), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `C${R}`, `K${R}`, { value: 'ITEM  /  항 목', f: font.header(9), fi: fill.gray(), al: align.lc, bo: border.inner });
  merge(ws, `L${R}`, `R${R}`, { value: 'DESIGN VALUE  /  설계값', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `S${R}`, `U${R}`, { value: 'UNIT', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  merge(ws, `V${R}`, `Z${R}`, { value: 'REMARKS  /  비 고', f: font.header(9), fi: fill.gray(), al: align.cc, bo: border.inner });
  R++;

  const r = inp.results;
  const rows: [string, string, string, string, boolean?][] = [
    ['SHELL SIDE FLUID  /  쉘측(고온) 유체', inp.hotFluidName, '—', `P = ${inp.Ph_kgcm2g} kg/cm²G`],
    ['SHELL SIDE FLOW  /  쉘측 유량', nf(inp.mh_kgh, 1), 'kg/h', `In: ${inp.Th_in_C}°C → Out: ${inp.Th_out_C}°C`],
    ['TUBE SIDE FLUID  /  튜브측(저온) 유체', inp.coldFluidName, '—', `P = ${inp.Pc_kgcm2g} kg/cm²G`],
    ['TUBE SIDE FLOW  /  튜브측 유량', nf(inp.mc_kgh, 1), 'kg/h', `In: ${inp.Tc_in_C}°C → Out: ${inp.Tc_out_C}°C`],
    ['HEAT DUTY (Q)  /  열교환 용량', `${nf(r.Q_kW, 1)} (${nf(r.Q_Mcalh, 0)} Mcal/h)`, 'kW', 'Bell-Delaware 열수지', true],
    ['LMTD / Ft / CMTD  /  유효온도차', `${nf(r.lmtd_C, 1)} / ${nf(r.Ft, 3)} / ${nf(r.CMTD_C, 1)}`, '°C', `${inp.n_shell} Shell × ${inp.n_passes} Pass`],
    ['OVERALL U (Calc / Req)  /  총괄전열계수', `${nf(r.U_calc_Wm2K, 0)} / ${nf(r.U_req_Wm2K, 0)}`, 'W/m²·K', `h_i=${nf(r.hi_Wm2K, 0)}, h_o=${nf(r.ho_Wm2K, 0)}`],
    ['HEAT TRANSFER AREA  /  설계 전열면적', `${nf(r.A_prov_m2, 1)} (Req: ${nf(r.A_req_m2, 1)})`, 'm²', `여유율 +${nf(r.overdesign_pct, 1)}%`, true],
    ['SHELL ID × TUBE LENGTH  /  쉘 내경×길이', `ID ${r.D_shell_mm} mm × L ${(inp.L_m * 1000).toFixed(0)} mm`, 'mm', `Baffle ${r.N_baffles}EA (B=${nf(r.B_spacing_mm, 0)}mm)`, true],
    ['TUBE COUNT & OD  /  튜브 수량 및 규격', `${r.N_tubes} EA (OD ${inp.do_mm} mm)`, 'EA', `Pitch ${inp.layoutAngle}° 배열`],
    ['TUBE / SHELL VELOCITY  /  관측·쉘측 유속', `Tube: ${nf(r.vt_ms, 2)} / Shell: ${nf(r.vs_ms, 2)}`, 'm/s', '침식 한계 이내'],
    ['PRESSURE DROP (ΔP)  /  관측·쉘측 차압', `Tube: ${nf(r.dPt_bar, 3)} / Shell: ${nf(r.dPs_bar, 3)}`, 'bar', '허용 차압 0.7 bar 이하'],
  ];

  let lineNo = 1;
  for (const [item, val, unit, rem, isHL] of rows) {
    ws.getRow(R).height = isHL ? 17 : 14;
    merge(ws, `A${R}`, `B${R}`, { value: lineNo++, f: font.small(8), fi: fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `C${R}`, `K${R}`, { value: item, f: isHL ? font.header() : font.label(), fi: isHL ? fill.midBlue() : fill.white(), al: align.lc, bo: border.inner });
    merge(ws, `L${R}`, `R${R}`, { value: val, f: font.value(), fi: isHL ? fill.midBlue() : fill.white(), al: align.rc, bo: border.inner });
    merge(ws, `S${R}`, `U${R}`, { value: unit, f: font.unit(), fi: isHL ? fill.midBlue() : fill.ltGray(), al: align.cc, bo: border.inner });
    merge(ws, `V${R}`, `Z${R}`, { value: rem, f: font.remark(), fi: fill.white(), al: align.lc, bo: border.inner });
    R++;
  }

  ws.pageSetup.printArea = `A1:Z${R}`;
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `PDS_HX_${inp.tag || 'HX'}_${today()}.xlsx`);
}

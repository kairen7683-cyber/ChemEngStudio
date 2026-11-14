'use client';

import { useBalanceStore } from '@/lib/stores/balanceStore';
import { StreamData } from '@/lib/calculations/streams';

interface StreamTableProps {
  section?: '100' | '200' | '300' | '400' | '600' | 'all';
  tableHeight?: number;
}

const COMPONENT_ROWS = [
  { key: 'NaCl', label: 'NaCl', unit: 'kg/h', color: '#4ade80' },
  { key: 'H2O',  label: 'H₂O',  unit: 'kg/h', color: '#3F3F46' },
  { key: 'NaOH', label: 'NaOH', unit: 'kg/h', color: '#f97316' },
  { key: 'Cl2',  label: 'Cl₂',  unit: 'kg/h', color: '#60a5fa' },
  { key: 'H2',   label: 'H₂',   unit: 'kg/h', color: '#a78bfa' },
  { key: 'HCl',  label: 'HCl',  unit: 'kg/h', color: '#B45309' },
];

const PROPERTY_ROWS = [
  { key: 'total_kgh',        label: '합계 유량', unit: 'kg/h' },
  { key: 'concentration',    label: '주성분 농도', unit: 'wt%' },
  { key: 'temperature_C',    label: '온도', unit: '℃' },
  { key: 'pressure_kgcm2g',  label: '압력', unit: 'kg/cm².G' },
  { key: 'density_kgm3',     label: '밀도', unit: 'kg/m³' },
  { key: 'phase',            label: '상', unit: '' },
];

function fmt(v: number | string | undefined, decimals = 1): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (v === 0) return '0';
  if (Math.abs(v) < 0.01) return v.toExponential(2);
  return v.toLocaleString('ko-KR', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

export default function StreamTable({ section = 'all', tableHeight = 260 }: StreamTableProps) {
  const { balance } = useBalanceStore();
  let streams = balance.streams;

  if (section !== 'all') {
    streams = streams.filter(s => s.section === section);
  }

  // 섹션 순서로 정렬
  const sectionOrder = ['100', '200', '300', '400'];
  streams = [...streams].sort((a, b) => {
    const si = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section);
    if (si !== 0) return si;
    return a.id.localeCompare(b.id);
  });

  if (streams.length === 0) return null;

  const sectionColors: Record<string, string> = {
    '100': '#4ade80',
    '200': '#60a5fa',
    '300': '#f97316',
    '400': '#a78bfa',
  };

  return (
    <div className="stream-table-area">
      <table className="stream-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left', minWidth: 130 }}>항목 / 스트림</th>
            {streams.map(s => (
              <th key={s.id} style={{ color: sectionColors[s.section] }}>
                [{s.id}]
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Inter', fontWeight: 400, marginTop: 2, whiteSpace: 'normal', maxWidth: 80 }}>
                  {s.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 조성 섹션 */}
          <tr>
            <td colSpan={streams.length + 1} className="row-label" style={{ background: 'rgba(0,212,255,0.05)', color: 'var(--accent-primary)', fontSize: 10, fontWeight: 700, padding: '5px 10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              유량 조성 (kg/h)
            </td>
          </tr>
          {COMPONENT_ROWS.map(row => (
            <tr key={row.key}>
              <td className="row-label" style={{ color: row.color }}>
                {row.label}
                <span className="row-label-sub" style={{ marginLeft: 4 }}>{row.unit}</span>
              </td>
              {streams.map(s => {
                const val = s.components[row.key as keyof typeof s.components];
                const isZero = !val || val < 0.001;
                return (
                  <td key={s.id} className={isZero ? 'cell-zero' : val > 10000 ? 'cell-highlight' : ''}>
                    {isZero ? '—' : fmt(val, 1)}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* 합계 행 */}
          <tr style={{ fontWeight: 700 }}>
            <td className="row-label" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
              합  계 <span className="row-label-sub">kg/h</span>
            </td>
            {streams.map(s => (
              <td key={s.id} className="cell-highlight">{fmt(s.total_kgh, 0)}</td>
            ))}
          </tr>

          {/* 운전 조건 섹션 */}
          <tr>
            <td colSpan={streams.length + 1} className="row-label" style={{ background: 'rgba(255,107,53,0.05)', color: 'var(--accent-secondary)', fontSize: 10, fontWeight: 700, padding: '5px 10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              운전 조건
            </td>
          </tr>
          {PROPERTY_ROWS.map(row => (
            <tr key={row.key}>
              <td className="row-label">
                {row.label}
                {row.unit && <span className="row-label-sub" style={{ marginLeft: 4 }}>{row.unit}</span>}
              </td>
              {streams.map(s => {
                const val = s[row.key as keyof StreamData] as number | string | undefined;
                const decimals = row.key === 'concentration' ? 2 : row.key === 'pressure_kgcm2g' ? 2 : 0;
                return (
                  <td key={s.id}>
                    {fmt(val, decimals)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

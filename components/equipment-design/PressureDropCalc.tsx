'use client';
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ALL_FLUIDS, LIQUID_FLUIDS, PIPE_MATERIALS, PIPE_SIZES,
  densityAtT, viscosityAtT, pipeID, pipeNPSFromID,
} from '@/lib/physicalProperties';
import { FITTING_TYPES, PipeSegment, PipeFitting, calcPipePressureDrop, PipeCalcResult } from '@/lib/pipePressureDrop';

// ─── 스타일 ─────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, padding: '16px 20px', marginBottom: 16,
};
const inp: React.CSSProperties = {
  width: '100%', height: 32, background: '#1e293b',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
  color: '#e2e8f0', fontSize: 12, padding: '0 10px',
  outline: 'none', boxSizing: 'border-box',
};
const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };
const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#475569',
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4, display: 'block',
};
const btn = (c: string): React.CSSProperties => ({
  padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 700,
  border: `1px solid ${c}44`, background: `${c}18`,
  color: c, cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif",
  transition: 'all 0.15s',
});
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 12,
  paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex', alignItems: 'center', gap: 6,
};
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };

function n2(v: number | undefined, u = '') { return v == null || isNaN(v) ? '—' : `${v.toFixed(2)} ${u}`.trim(); }

function defaultSegment(id: string, lbl: string): PipeSegment {
  return { id, label: lbl, D_mm: pipeID(80), length_m: 20, roughness_mm: 0.046, fittings: [], elevation_m: 0 };
}

// ─── 이음쇠 에디터 ───────────────────────────────────────────────────
function FittingsEditor({ fittings, onChange }: { fittings: PipeFitting[]; onChange: (f: PipeFitting[]) => void }) {
  const add = () => onChange([...fittings, { fittingKey: 'elbow_90_lr', count: 1 }]);
  const remove = (i: number) => onChange(fittings.filter((_, j) => j !== i));
  const update = (i: number, k: keyof PipeFitting, v: string | number) =>
    onChange(fittings.map((f, j) => j === i ? { ...f, [k]: v } : f));
  return (
    <div>
      {fittings.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <select value={f.fittingKey} onChange={e => update(i, 'fittingKey', e.target.value)} style={{ ...sel, flex: 2 }}>
            {FITTING_TYPES.map(ft => (
              <option key={ft.key} value={ft.key} style={{ background: '#1e293b' }}>{ft.nameKo} (K={ft.K})</option>
            ))}
          </select>
          <input type="number" value={f.count} min={1} onChange={e => update(i, 'count', +e.target.value)}
            style={{ ...inp, width: 60 }} />
          <button onClick={() => remove(i)} style={{ ...btn('#ef4444'), padding: '3px 8px', fontSize: 11 }}>✕</button>
        </div>
      ))}
      <button onClick={add} style={{ ...btn('#38bdf8'), padding: '4px 12px', fontSize: 11 }}>+ 이음쇠 추가</button>
    </div>
  );
}

// ─── 배관 구간 에디터 ────────────────────────────────────────────────
function SegEditor({ seg, onChange, onRemove, canRemove }: {
  seg: PipeSegment; onChange: (s: PipeSegment) => void;
  onRemove: () => void; canRemove: boolean;
}) {
  return (
    <div style={{ ...card, marginBottom: 10, borderColor: 'rgba(56,189,248,0.12)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelSt}>구간명</label>
          <input value={seg.label} onChange={e => onChange({ ...seg, label: e.target.value })} style={inp} />
        </div>
        {canRemove && (
          <button onClick={onRemove} style={{ ...btn('#ef4444'), padding: '4px 12px', fontSize: 11 }}>삭제</button>
        )}
      </div>
      <div style={grid3}>
        <div>
          <label style={labelSt}>ANSI / ASME 배관 규격 (NPS & Sch 40)</label>
          <select value={PIPE_SIZES.find(p => Math.abs(pipeID(p.DN) - seg.D_mm) < 2)?.DN ?? 80}
            onChange={e => onChange({ ...seg, D_mm: pipeID(+e.target.value) })} style={sel}>
            {PIPE_SIZES.map(p => (
              <option key={p.DN} value={p.DN} style={{ background: '#1e293b' }}>
                NPS {p.NPS} Sch 40 (OD {p.OD_mm}mm / ID {pipeID(p.DN).toFixed(1)}mm)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelSt}>직관 길이 (m)</label>
          <input type="number" value={seg.length_m} step={0.5}
            onChange={e => onChange({ ...seg, length_m: +e.target.value })} style={inp} />
        </div>
        <div>
          <label style={labelSt}>높이차 (m, 상승+)</label>
          <input type="number" value={seg.elevation_m} step={0.5}
            onChange={e => onChange({ ...seg, elevation_m: +e.target.value })} style={inp} />
        </div>
      </div>
      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <label style={labelSt}>배관 재질</label>
        <select value={PIPE_MATERIALS.find(m => m.roughness_mm === seg.roughness_mm)?.key ?? 'ss316l'}
          onChange={e => {
            const mat = PIPE_MATERIALS.find(m => m.key === e.target.value);
            onChange({ ...seg, roughness_mm: mat?.roughness_mm ?? 0.046 });
          }} style={{ ...sel, width: '60%' }}>
          {PIPE_MATERIALS.filter(m => m.key !== 'custom').map(m => (
            <option key={m.key} value={m.key} style={{ background: '#1e293b' }}>
              {m.name} (ε={m.roughness_mm}mm)
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelSt}>이음쇠</label>
        <FittingsEditor fittings={seg.fittings} onChange={fittings => onChange({ ...seg, fittings })} />
      </div>
    </div>
  );
}

// ─── 결과 테이블 ─────────────────────────────────────────────────────
function ResultsTable({ result }: { result: PipeCalcResult }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 800 }}>
        <thead>
          <tr style={{ background: 'rgba(56,189,248,0.06)' }}>
            {['구간', 'ANSI/ASME NPS (ID mm)', '유속 (m/s)', 'Re', 'f (Darcy)', 'K 이음쇠', 'ΔP 직관 (kPa)', 'ΔP 이음쇠 (kPa)', 'ΔP 위치 (kPa)', '구간 합계 (kPa)'].map(h => (
              <th key={h} style={{ padding: '7px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.segments.map((r, i) => {
            const hiV = r.velocity_ms > 3;
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{r.segment.label}</td>
                <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{pipeNPSFromID(r.segment.D_mm)} ({r.segment.D_mm.toFixed(1)} mm)</td>
                <td style={{ padding: '5px 8px', color: hiV ? '#fbbf24' : '#4ade80', fontWeight: hiV ? 700 : 400 }}>
                  {r.velocity_ms.toFixed(3)} {hiV ? '⚠' : ''}
                </td>
                <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.Re.toFixed(0)}</td>
                <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.frictionFactor.toFixed(5)}</td>
                <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.K_total.toFixed(2)}</td>
                <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{r.dP_friction_kPa.toFixed(3)}</td>
                <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{r.dP_fittings_kPa.toFixed(3)}</td>
                <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{r.dP_elevation_kPa.toFixed(3)}</td>
                <td style={{ padding: '5px 8px', color: '#38bdf8', fontWeight: 600 }}>{r.dP_total_kPa.toFixed(3)}</td>
              </tr>
            );
          })}
          <tr style={{ background: 'rgba(56,189,248,0.08)', borderTop: '1px solid rgba(56,189,248,0.2)' }}>
            <td colSpan={6} style={{ padding: '6px 8px', color: '#38bdf8', fontWeight: 700 }}>합 계</td>
            <td style={{ padding: '6px 8px', color: '#38bdf8', fontWeight: 700 }}>{result.dP_friction_total_kPa.toFixed(3)}</td>
            <td style={{ padding: '6px 8px', color: '#38bdf8', fontWeight: 700 }}>{result.dP_fittings_total_kPa.toFixed(3)}</td>
            <td style={{ padding: '6px 8px', color: '#38bdf8', fontWeight: 700 }}>{result.dP_elevation_total_kPa.toFixed(3)}</td>
            <td style={{ padding: '6px 8px', color: '#38bdf8', fontWeight: 700, fontSize: 13 }}>{result.dP_total_kPa.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── 메인 ────────────────────────────────────────────────────────────
export default function PressureDropCalc() {
  const [fluidKey, setFluidKey] = useState('process_water');
  const [temp, setTemp]         = useState(25);
  const [flow, setFlow]         = useState(50);
  const [segments, setSegments] = useState<PipeSegment[]>([
    defaultSegment('seg1', '구간 1'),
    defaultSegment('seg2', '구간 2'),
  ]);
  const [results, setResults]   = useState<PipeCalcResult | null>(null);
  const [error, setError]       = useState('');

  const fluid = ALL_FLUIDS.find(f => f.key === fluidKey) ?? ALL_FLUIDS[0];

  const addSegment   = () => setSegments(s => [...s, defaultSegment(`seg${Date.now()}`, `구간 ${s.length + 1}`)]);
  const removeSegment = (i: number) => setSegments(s => s.filter((_, j) => j !== i));
  const updateSegment = (i: number, seg: PipeSegment) => setSegments(s => s.map((x, j) => j === i ? seg : x));

  const calculate = () => {
    try {
      setError('');
      setResults(calcPipePressureDrop(fluid, temp, flow, segments));
    } catch (e: unknown) { setError(String(e)); }
  };

  const exportExcel = () => {
    if (!results) return;
    const wb = XLSX.utils.book_new();
    const header = ['구간', 'DN/ID(mm)', '유속(m/s)', 'Re', 'f', 'K', 'ΔP직관(kPa)', 'ΔP이음쇠(kPa)', 'ΔP위치(kPa)', 'ΔP합계(kPa)'];
    const rows = results.segments.map(r => [
      r.segment.label,
      r.segment.D_mm.toFixed(1),
      r.velocity_ms.toFixed(3),
      r.Re.toFixed(0),
      r.frictionFactor.toFixed(5),
      r.K_total.toFixed(2),
      r.dP_friction_kPa.toFixed(3),
      r.dP_fittings_kPa.toFixed(3),
      r.dP_elevation_kPa.toFixed(3),
      r.dP_total_kPa.toFixed(3),
    ]);
    const totals = ['합계', '', '', '', '', '',
      results.dP_friction_total_kPa.toFixed(3),
      results.dP_fittings_total_kPa.toFixed(3),
      results.dP_elevation_total_kPa.toFixed(3),
      results.dP_total_kPa.toFixed(3),
    ];
    const meta = [
      ['유체', fluid.nameKo],
      ['온도(°C)', temp],
      ['유량(m³/h)', flow],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet([...meta, header, ...rows, totals]);
    XLSX.utils.book_append_sheet(wb, ws, '차압계산');
    XLSX.writeFile(wb, `pressure_drop_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* 유체/유량 */}
      <div style={card}>
        <div style={sectionTitle}>📊 유체 및 유량 설정</div>
        <div style={grid3}>
          <div>
            <label style={labelSt}>유체 선택</label>
            <select value={fluidKey} onChange={e => setFluidKey(e.target.value)} style={sel}>
              {[...LIQUID_FLUIDS, ...([...ALL_FLUIDS].filter(f => f.phase === 'G'))].map(f => (
                <option key={f.key} value={f.key} style={{ background: '#1e293b' }}>
                  [{f.phase}] {f.nameKo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelSt}>온도 (°C)</label>
            <input type="number" value={temp} onChange={e => setTemp(+e.target.value)} style={inp} />
          </div>
          <div>
            <label style={labelSt}>유량 (m³/h)</label>
            <input type="number" value={flow} step={0.5} onChange={e => setFlow(+e.target.value)} style={inp} />
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', display: 'flex', gap: 20 }}>
          <span>밀도: {densityAtT(fluid, temp).toFixed(2)} kg/m³</span>
          <span>점도: {viscosityAtT(fluid, temp).toFixed(3)} mPa·s</span>
          <span>유량: {(flow * densityAtT(fluid, temp)).toFixed(1)} kg/h</span>
        </div>
      </div>

      {/* 배관 구간 */}
      <div style={{ ...card, borderColor: 'rgba(56,189,248,0.12)' }}>
        <div style={sectionTitle}>
          🔧 배관 구간 설정
          <button onClick={addSegment} style={{ ...btn('#38bdf8'), padding: '3px 12px', fontSize: 11, marginLeft: 'auto' }}>
            + 구간 추가
          </button>
        </div>
        {segments.map((seg, i) => (
          <SegEditor key={seg.id} seg={seg} onChange={s => updateSegment(i, s)}
            onRemove={() => removeSegment(i)} canRemove={segments.length > 1} />
        ))}
      </div>

      {/* 계산 버튼 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button onClick={calculate} style={{ ...btn('#38bdf8'), padding: '10px 32px', fontSize: 14 }}>
          🔵 계산 실행
        </button>
        {results && (
          <button onClick={exportExcel} style={{ ...btn('#4ade80'), padding: '10px 24px', fontSize: 13 }}>
            📥 Excel 다운로드
          </button>
        )}
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 12 }}>⚠ {error}</div>}

      {/* 결과 */}
      {results && (
        <div style={{ ...card, borderColor: 'rgba(56,189,248,0.2)', background: 'rgba(56,189,248,0.04)' }}>
          <div style={{ ...sectionTitle, color: '#38bdf8' }}>📊 배관 차압 계산 결과</div>
          <ResultsTable result={results} />

          {/* 요약 카드 */}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: '직관 마찰 손실', value: results.dP_friction_total_kPa, unit: 'kPa' },
              { label: '이음쇠 손실', value: results.dP_fittings_total_kPa, unit: 'kPa' },
              { label: '위치 수두', value: results.dP_elevation_total_kPa, unit: 'kPa' },
              { label: '총 차압', value: results.dP_total_kPa, unit: 'kPa', highlight: true },
              { label: '총 차압 (m H₂O)', value: results.dP_total_mH2O, unit: 'm' },
              { label: '총 차압 (bar)', value: results.dP_total_bar, unit: 'bar' },
            ].map(({ label: lbl, value, unit, highlight }) => (
              <div key={lbl} style={{
                background: highlight ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${highlight ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8, padding: '10px 16px', minWidth: 140,
              }}>
                <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{lbl}</div>
                <div style={{ fontSize: highlight ? 20 : 16, fontWeight: 700, color: highlight ? '#38bdf8' : '#e2e8f0' }}>
                  {value.toFixed(3)}
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{unit}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

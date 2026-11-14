'use client';
import React, { useState, useEffect } from 'react';
import {
  ALL_FLUIDS, LIQUID_FLUIDS, PIPE_MATERIALS, PIPE_SIZES,
  densityAtT, viscosityAtT, vaporPressure_kPa, pipeID, pipeNPSFromID,
} from '@/lib/physicalProperties';
import { FITTING_TYPES, PipeSegment, PipeFitting } from '@/lib/pipePressureDrop';
import { calcPump, PumpInputs, PumpResults } from '@/lib/pumpCalc';
import { getPumpProcessPreset } from '@/lib/hxCalc';
import { useEquipmentList } from '@/lib/hooks/useEquipmentList';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { exportPumpDatasheet } from '@/lib/excel/datasheetExport';

// ─── 스타일 상수 ────────────────────────────────────────────────────
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
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#475569',
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4, display: 'block',
};
const btn = (color: string): React.CSSProperties => ({
  padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 700,
  border: `1px solid ${color}44`, background: `${color}18`,
  color, cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif",
  transition: 'all 0.15s',
});
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#94a3b8',
  marginBottom: 12, paddingBottom: 8,
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex', alignItems: 'center', gap: 6,
};
const grid2: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};
const grid3: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12,
};

// ─── 유틸 ────────────────────────────────────────────────────────────
const n3 = (v: number | undefined, unit = '') =>
  v == null || isNaN(v) ? '—' : `${v.toPrecision(4)} ${unit}`.trim();
const n2 = (v: number | undefined, unit = '') =>
  v == null || isNaN(v) ? '—' : `${v.toFixed(2)} ${unit}`.trim();

// ─── 배관 구간 기본값 ────────────────────────────────────────────────
function defaultSegment(id: string, label: string): PipeSegment {
  return { id, label, D_mm: pipeID(80), length_m: 10, roughness_mm: 0.046, fittings: [], elevation_m: 0 };
}

// ─── 이음쇠 행 편집기 ────────────────────────────────────────────────
function FittingsEditor({
  fittings, onChange,
}: { fittings: PipeFitting[]; onChange: (f: PipeFitting[]) => void }) {
  const add = () => onChange([...fittings, { fittingKey: 'elbow_90_lr', count: 1 }]);
  const remove = (i: number) => onChange(fittings.filter((_, j) => j !== i));
  const update = (i: number, key: keyof PipeFitting, val: string | number) =>
    onChange(fittings.map((f, j) => j === i ? { ...f, [key]: val } : f));

  return (
    <div>
      {fittings.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <select value={f.fittingKey} onChange={e => update(i, 'fittingKey', e.target.value)}
            style={{ ...sel, flex: 2 }}>
            {FITTING_TYPES.map(ft => (
              <option key={ft.key} value={ft.key} style={{ background: '#1e293b' }}>{ft.nameKo}</option>
            ))}
          </select>
          <input type="number" value={f.count} min={1} onChange={e => update(i, 'count', +e.target.value)}
            style={{ ...inp, width: 60 }} placeholder="수량" />
          <button onClick={() => remove(i)}
            style={{ ...btn('#ef4444'), padding: '4px 10px', fontSize: 11 }}>✕</button>
        </div>
      ))}
      <button onClick={add} style={{ ...btn('#60a5fa'), padding: '4px 14px', fontSize: 11 }}>
        + 이음쇠 추가
      </button>
    </div>
  );
}

// ─── 배관 구간 편집기 ────────────────────────────────────────────────
function PipeSegmentEditor({
  seg, onChange,
}: { seg: PipeSegment; onChange: (s: PipeSegment) => void }) {
  const npsOptions = PIPE_SIZES.map(p => ({ DN: p.DN, NPS: p.NPS, OD: p.OD_mm, ID: pipeID(p.DN) }));

  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ marginBottom: 10 }}>
        <label style={label}>구간명</label>
        <input value={seg.label} onChange={e => onChange({ ...seg, label: e.target.value })}
          style={inp} />
      </div>
      <div style={grid3}>
        <div>
          <label style={label}>ANSI / ASME 배관 규격 (NPS & Sch 40)</label>
          <select value={PIPE_SIZES.find(p => Math.abs(pipeID(p.DN) - seg.D_mm) < 2)?.DN ?? 80}
            onChange={e => onChange({ ...seg, D_mm: pipeID(+e.target.value) })}
            style={sel}>
            {npsOptions.map(d => (
              <option key={d.DN} value={d.DN} style={{ background: '#1e293b' }}>
                NPS {d.NPS} Sch 40 (OD {d.OD}mm / ID {d.ID.toFixed(1)}mm)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>직관 길이 (m)</label>
          <input type="number" value={seg.length_m} step={0.5}
            onChange={e => onChange({ ...seg, length_m: +e.target.value })} style={inp} />
        </div>
        <div>
          <label style={label}>높이차 (m, 상승+)</label>
          <input type="number" value={seg.elevation_m} step={0.5}
            onChange={e => onChange({ ...seg, elevation_m: +e.target.value })} style={inp} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={label}>배관 재질 (조도)</label>
        <select value={PIPE_MATERIALS.find(m => m.roughness_mm === seg.roughness_mm)?.key ?? 'ss316l'}
          onChange={e => {
            const mat = PIPE_MATERIALS.find(m => m.key === e.target.value);
            onChange({ ...seg, roughness_mm: mat?.roughness_mm ?? 0.046 });
          }} style={{ ...sel, width: '50%' }}>
          {PIPE_MATERIALS.filter(m => m.key !== 'custom').map(m => (
            <option key={m.key} value={m.key} style={{ background: '#1e293b' }}>{m.name}</option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={label}>이음쇠 목록</label>
        <FittingsEditor fittings={seg.fittings}
          onChange={fittings => onChange({ ...seg, fittings })} />
      </div>
    </div>
  );
}

// ─── 결과 테이블 ─────────────────────────────────────────────────────
function ResultTable({ label: tableLabel, result }: { label: string; result: ReturnType<typeof calcPump>['suctionPipeCalc'] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={sectionTitle}>{tableLabel}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            {['구간', 'ANSI/ASME NPS (ID mm)', '유속 m/s', 'Re', 'f', 'ΔP 직관 kPa', 'ΔP 이음쇠 kPa', 'ΔP 위치 kPa', '합계 kPa'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.segments.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{r.segment.label}</td>
              <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{pipeNPSFromID(r.segment.D_mm)} ({r.segment.D_mm.toFixed(1)})</td>
              <td style={{ padding: '5px 8px', color: r.velocity_ms > 3 ? '#fbbf24' : '#4ade80' }}>{n2(r.velocity_ms)}</td>
              <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.Re.toFixed(0)}</td>
              <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.frictionFactor.toFixed(4)}</td>
              <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{n2(r.dP_friction_kPa)}</td>
              <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{n2(r.dP_fittings_kPa)}</td>
              <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>{n2(r.dP_elevation_kPa)}</td>
              <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 600 }}>{n2(r.dP_total_kPa)}</td>
            </tr>
          ))}
          <tr style={{ background: 'rgba(96,165,250,0.06)', borderTop: '1px solid rgba(96,165,250,0.2)' }}>
            <td colSpan={5} style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 700 }}>합 계</td>
            <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 700 }}>{n2(result.dP_friction_total_kPa)}</td>
            <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 700 }}>{n2(result.dP_fittings_total_kPa)}</td>
            <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 700 }}>{n2(result.dP_elevation_total_kPa)}</td>
            <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 700 }}>{n2(result.dP_total_kPa)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function PumpDesign() {
  const pumps   = useEquipmentList('pump');
  const streams = useBalanceStore(s => s.result.streams);
  const { setEquipmentSpecOverride, activeDesignRequest, setActiveDesignRequest } = usePFDStore();

  const [selectedTag, setSelectedTag]   = useState<string>('P-014A/B');
  const [fluidKey, setFluidKey]         = useState('brine_25');
  const [temp, setTemp]                 = useState(70);
  const [flow, setFlow]                 = useState(204);  // m³/h
  const [flowKgh, setFlowKgh]           = useState<string>('238867');
  const [Ps, setPs]                     = useState(10);   // kPaG suction
  const [Pd, setPd]                     = useState(350);  // kPaG discharge
  const [Hs, setHs]                     = useState(3.5);  // m suction head
  const [Hd, setHd]                     = useState(15);   // m discharge head
  const [etaP, setEtaP]                 = useState(0.75);
  const [etaM, setEtaM]                 = useState(0.92);
  const [NPSHr, setNPSHr]               = useState<string>('3.5');
  const [streamInfo, setStreamInfo]     = useState<string>('');
  const [savedNotice, setSavedNotice]   = useState<string>('');
  const [suctionSegs, setSuctionSegs]   = useState<PipeSegment[]>([
    defaultSegment('s1', '흡입 배관'),
  ]);
  const [dischargeSegs, setDischargeSegs] = useState<PipeSegment[]>([
    defaultSegment('d1', '토출 배관 1단'),
    defaultSegment('d2', '토출 배관 2단'),
  ]);
  const [results, setResults]           = useState<PumpResults | null>(null);
  const [error, setError]               = useState('');

  const fluid = LIQUID_FLUIDS.find(f => f.key === fluidKey) ?? LIQUID_FLUIDS[0];

  // 장치 태그 선택 시 → 연결된 유체 및 현재 공정 유량·온도·압력 자동 설정
  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag);
    setSavedNotice('');
    setError('');
    if (!tag) return;
    const preset = getPumpProcessPreset(tag, streams);
    const matchedFluid = LIQUID_FLUIDS.find(f => f.key === preset.fluidKey) ?? LIQUID_FLUIDS[0];
    setFluidKey(matchedFluid.key);
    setTemp(preset.temp_C);
    setFlow(preset.flow_m3h);
    setFlowKgh(String(preset.flow_kgh));
    setPs(preset.Ps_kPaG);
    setPd(preset.Pd_kPaG);
    setHs(preset.Hs_m);
    setHd(preset.Hd_m);
    setStreamInfo(preset.streamInfo);

    const sucSegs: PipeSegment[] = [
      { id: 's1', label: '흡입 배관', D_mm: pipeID(preset.dnSuction), length_m: 8, roughness_mm: 0.046, fittings: [{ fittingKey: 'elbow_90_lr', count: 2 }, { fittingKey: 'gate_valve', count: 1 }], elevation_m: 0 },
    ];
    const disSegs: PipeSegment[] = [
      { id: 'd1', label: '토출 배관', D_mm: pipeID(preset.dnDischarge), length_m: 35, roughness_mm: 0.046, fittings: [{ fittingKey: 'elbow_90_lr', count: 4 }, { fittingKey: 'check_valve_swing', count: 1 }, { fittingKey: 'globe_valve', count: 1 }], elevation_m: preset.Hd_m },
    ];
    setSuctionSegs(sucSegs);
    setDischargeSegs(disSegs);

    try {
      const inputs: PumpInputs = {
        fluid: matchedFluid,
        temperature_C: preset.temp_C,
        flowRate_m3h: preset.flow_m3h,
        P_suction_kPaG: preset.Ps_kPaG,
        suction_head_m: preset.Hs_m,
        suctionPipe: sucSegs,
        P_discharge_kPaG: preset.Pd_kPaG,
        discharge_head_m: preset.Hd_m,
        dischargePipe: disSegs,
        pumpEfficiency: etaP,
        motorEfficiency: etaM,
        NPSHr_m: NPSHr ? +NPSHr : undefined,
      };
      setResults(calcPump(inputs));
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (activeDesignRequest && activeDesignRequest.tab === 'pump') {
      handleTagSelect(activeDesignRequest.tag);
      setActiveDesignRequest(null);
    } else {
      handleTagSelect(selectedTag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDesignRequest]);

  // 유량 단위 변환
  const handleFlowM3h = (v: string) => {
    setFlow(+v);
    setFlowKgh((+v * densityAtT(fluid, temp)).toFixed(1));
  };
  const handleFlowKgh = (v: string) => {
    setFlowKgh(v);
    setFlow(+(+v / densityAtT(fluid, temp)).toFixed(3));
  };

  const addSuctionSeg   = () => setSuctionSegs(s => [...s, defaultSegment(`s${Date.now()}`, `흡입 구간 ${s.length + 1}`)]);
  const addDischargeSeg = () => setDischargeSegs(s => [...s, defaultSegment(`d${Date.now()}`, `토출 구간 ${s.length + 1}`)]);
  const removeSuctionSeg   = (i: number) => setSuctionSegs(s => s.filter((_, j) => j !== i));
  const removeDischargeSeg = (i: number) => setDischargeSegs(s => s.filter((_, j) => j !== i));

  const calculate = () => {
    try {
      setError('');
      const inputs: PumpInputs = {
        fluid,
        temperature_C: temp,
        flowRate_m3h:  flow,
        P_suction_kPaG:   Ps,
        suction_head_m:    Hs,
        suctionPipe:       suctionSegs,
        P_discharge_kPaG:  Pd,
        discharge_head_m:  Hd,
        dischargePipe:     dischargeSegs,
        pumpEfficiency:    etaP,
        motorEfficiency:   etaM,
        NPSHr_m: NPSHr ? +NPSHr : undefined,
      };
      const res = calcPump(inputs);
      setResults(res);

      if (selectedTag) {
        const capStr = `${flow.toFixed(1)} m³/h × ${res.TDH_m.toFixed(1)} mH`;
        const motorStr = `${res.motorNominal_kW} kW`;
        const opPressStr = (Pd / 98.0665).toFixed(1);
        const remStr = `[설계완료] TDH=${res.TDH_m.toFixed(1)}m, NPSHa=${res.NPSHa_m.toFixed(1)}m, P_shaft=${res.shaftPower_kW.toFixed(1)}kW`;
        const specPayload = {
          operTemp: String(temp),
          operPress: opPressStr,
          capacity: capStr,
          motor: motorStr,
          remarks: remStr,
          designedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        };
        setEquipmentSpecOverride(selectedTag, specPayload);
        const baseTag = selectedTag.replace(/A\/B|C\/D/g, '').trim();
        if (baseTag !== selectedTag) {
          setEquipmentSpecOverride(baseTag, specPayload);
        }
        setSavedNotice(`✅ [${selectedTag}] 펌프 설계 완료! 장치 목록(Equipment List)에 용량(${capStr}) 및 모터(${motorStr})가 업데이트되었습니다.`);
      }
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const exportExcel = async () => {
    if (!results) return;
    const eq = selectedTag ? pumps.find(p => p.tag === selectedTag) : null;

    await exportPumpDatasheet({
      tag:              eq?.tag ?? selectedTag ?? 'PUMP',
      service:          eq?.name ?? `${fluid.nameKo} 이송 펌프`,
      fluidName:        fluid.nameKo,
      temperature_C:    temp,
      flow_m3h:         flow,
      density_kgm3:     results.density_kgm3,
      viscosity_mPas:   results.viscosity_mPas,
      vaporPressure_kPa: results.vaporPressure_kPa,
      P_suction_kPaG:   Ps,
      P_discharge_kPaG: Pd,
      suction_head_m:   Hs,
      discharge_head_m: Hd,
      pumpEfficiency:   etaP,
      motorEfficiency:  etaM,
      NPSHr_m:          NPSHr ? +NPSHr : undefined,
      suctionPipeSummary: results.suctionPipeCalc.segments.map(s => ({
        label:    s.segment.label,
        DN_mm:    s.segment.D_mm,
        vel_ms:   s.velocity_ms,
        dP_kPa:   s.dP_total_kPa,
      })),
      dischargePipeSummary: results.dischargePipeCalc.segments.map(s => ({
        label:    s.segment.label,
        DN_mm:    s.segment.D_mm,
        vel_ms:   s.velocity_ms,
        dP_kPa:   s.dP_total_kPa,
      })),
      results,
    });
  };

  return (
    <div style={{ maxWidth: 1100 }}>

      {/* ── 장치 선택 배너 ─────────────────────────────────────── */}
      <div style={{
        ...card,
        background: 'rgba(96,165,250,0.06)',
        borderColor: 'rgba(96,165,250,0.2)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 18 }}>⚙</span>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ ...label, color: '#60a5fa', marginBottom: 6 }}>PFD 펌프 태그 선택 (선택 시 현재 물질수지 스트림 유량·온도·압력 자동 적용)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedTag}
              onChange={e => handleTagSelect(e.target.value)}
              style={{ ...sel, maxWidth: 420, background: '#1e293b' }}
            >
              <option value="" style={{ background: '#1e293b' }}>— 장치 선택 안 함 (수동 입력) —</option>
              {['100', '200', '300', '400', '600'].map(sec => {
                const secPumps = pumps.filter(p => p.section === sec);
                if (!secPumps.length) return null;
                return (
                  <optgroup key={sec} label={`${sec} Sec`} style={{ background: '#0f172a' }}>
                    {secPumps.map(p => (
                      <option key={p.id} value={p.tag} style={{ background: '#1e293b' }}>
                        {p.tag}  {p.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {selectedTag && (
              <button
                onClick={() => handleTagSelect(selectedTag)}
                style={{ ...btn('#38bdf8'), padding: '6px 12px', fontSize: 11 }}
              >
                🔄 현재 공정조건 동기화
              </button>
            )}
          </div>
          {streamInfo && (
            <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>
              🔗 공정 연동: {streamInfo}
            </div>
          )}
        </div>
        {selectedTag && (() => {
          const eq = pumps.find(p => p.tag === selectedTag);
          return eq ? (
            <div style={{ fontSize: 11, color: '#94a3b8', minWidth: 160 }}>
              <div style={{ color: '#60a5fa', fontWeight: 700, marginBottom: 2 }}>{eq.tag}</div>
              <div>{eq.name}</div>
              <div style={{ color: '#475569', marginTop: 2 }}>Sec. {eq.section}</div>
              {eq.streamIds.length > 0 && (
                <div style={{ color: '#fbbf24', marginTop: 2 }}>스트림: [{eq.streamIds.join(', ')}]</div>
              )}
            </div>
          ) : null;
        })()}
      </div>

      {savedNotice && (
        <div style={{
          ...card,
          background: 'rgba(74,222,128,0.10)',
          borderColor: 'rgba(74,222,128,0.35)',
          color: '#4ade80', fontSize: 12, fontWeight: 600,
          padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{savedNotice}</span>
          <button onClick={() => setSavedNotice('')} style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* ── 입력 왼쪽 패널 ─────────────────────────────────── */}
        <div>
          {/* 유체 / 운전 조건 */}
          <div style={card}>
            <div style={sectionTitle}>💧 유체 및 운전 조건</div>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>유체 선택 {selectedTag && <span style={{ color: '#60a5fa', fontSize: 9 }}>(장치 연동 — 변경 가능)</span>}</label>
              <select value={fluidKey} onChange={e => setFluidKey(e.target.value)} style={sel}>
                {LIQUID_FLUIDS.map(f => (
                  <option key={f.key} value={f.key} style={{ background: '#1e293b' }}>{f.nameKo} ({f.name})</option>
                ))}
              </select>
            </div>
            <div style={grid2}>
              <div>
                <label style={label}>온도 (°C)</label>
                <input type="number" value={temp} onChange={e => setTemp(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>밀도 (참고, kg/m³)</label>
                <input readOnly value={densityAtT(fluid, temp).toFixed(1)} style={{ ...inp, color: '#60a5fa' }} />
              </div>
              <div>
                <label style={label}>유량 (m³/h)</label>
                <input type="number" value={flow} step={0.5} onChange={e => handleFlowM3h(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>유량 (kg/h)</label>
                <input type="number" value={flowKgh || (flow * densityAtT(fluid, temp)).toFixed(1)}
                  step={10} onChange={e => handleFlowKgh(e.target.value)} style={inp} />
              </div>
            </div>
          </div>

          {/* 압력 / 수두 조건 */}
          <div style={card}>
            <div style={sectionTitle}>📐 압력 및 수두 조건</div>
            <div style={grid2}>
              <div>
                <label style={label}>흡입 정압 (kPaG)</label>
                <input type="number" value={Ps} onChange={e => setPs(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>토출 정압 (kPaG)</label>
                <input type="number" value={Pd} onChange={e => setPd(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>흡입 액면 높이 (m)</label>
                <input type="number" value={Hs} step={0.5} onChange={e => setHs(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>토출 액면 높이 (m)</label>
                <input type="number" value={Hd} step={0.5} onChange={e => setHd(+e.target.value)} style={inp} />
              </div>
            </div>
          </div>

          {/* 펌프 효율 */}
          <div style={card}>
            <div style={sectionTitle}>⚙ 펌프 성능</div>
            <div style={grid3}>
              <div>
                <label style={label}>펌프 효율 η</label>
                <input type="number" value={etaP} step={0.01} min={0.3} max={1}
                  onChange={e => setEtaP(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>전동기 효율 η</label>
                <input type="number" value={etaM} step={0.01} min={0.5} max={1}
                  onChange={e => setEtaM(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={label}>NPSHr (m, 선택)</label>
                <input type="number" value={NPSHr} placeholder="—"
                  onChange={e => setNPSHr(e.target.value)} style={inp} />
              </div>
            </div>
          </div>
        </div>

        {/* ── 배관 구간 오른쪽 패널 ──────────────────────────── */}
        <div>
          {/* 흡입 배관 */}
          <div style={card}>
            <div style={sectionTitle}>
              ⬇ 흡입 배관 구간
              <button onClick={addSuctionSeg} style={{ ...btn('#4ade80'), padding: '3px 10px', fontSize: 10, marginLeft: 'auto' }}>
                + 구간 추가
              </button>
            </div>
            {suctionSegs.map((seg, i) => (
              <div key={seg.id} style={{ position: 'relative' }}>
                <PipeSegmentEditor seg={seg} onChange={s => setSuctionSegs(ss => ss.map((x, j) => j === i ? s : x))} />
                {suctionSegs.length > 1 && (
                  <button onClick={() => removeSuctionSeg(i)}
                    style={{ ...btn('#ef4444'), position: 'absolute', top: 16, right: 16, padding: '2px 8px', fontSize: 10 }}>
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 토출 배관 */}
          <div style={card}>
            <div style={sectionTitle}>
              ⬆ 토출 배관 구간
              <button onClick={addDischargeSeg} style={{ ...btn('#4ade80'), padding: '3px 10px', fontSize: 10, marginLeft: 'auto' }}>
                + 구간 추가
              </button>
            </div>
            {dischargeSegs.map((seg, i) => (
              <div key={seg.id} style={{ position: 'relative' }}>
                <PipeSegmentEditor seg={seg} onChange={s => setDischargeSegs(ss => ss.map((x, j) => j === i ? s : x))} />
                {dischargeSegs.length > 1 && (
                  <button onClick={() => removeDischargeSeg(i)}
                    style={{ ...btn('#ef4444'), position: 'absolute', top: 16, right: 16, padding: '2px 8px', fontSize: 10 }}>
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 계산 버튼 ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button onClick={calculate} style={{ ...btn('#60a5fa'), padding: '10px 32px', fontSize: 14 }}>
          🔵 펌프 설계 및 장치목록 업데이트
        </button>
        {results && (
          <button onClick={exportExcel} style={{ ...btn('#4ade80'), padding: '10px 24px', fontSize: 13 }}>
            📥 Excel 다운로드
          </button>
        )}
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 12 }}>⚠ {error}</div>}

      {/* ── 계산 결과 ─────────────────────────────────────────── */}
      {results && (
        <div>
          {/* 공정 데이터시트 Summary */}
          <div style={{ ...card, border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(96,165,250,0.04)' }}>
            <div style={{ ...sectionTitle, color: '#60a5fa' }}>📋 공정 데이터시트 — 펌프 설계 요약</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
              {/* 유체 물성 */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>유체 물성</div>
                <table style={{ fontSize: 11, width: '100%' }}>
                  <tbody>
                    {[
                      ['유체', fluid.nameKo],
                      ['온도', `${temp} °C`],
                      ['밀도', `${results.density_kgm3.toFixed(1)} kg/m³`],
                      ['점도', `${results.viscosity_mPas.toFixed(3)} mPa·s`],
                      ['증기압', `${results.vaporPressure_kPa.toFixed(2)} kPa`],
                      ['유량', `${flow} m³/h`],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: '#64748b', paddingBottom: 4, paddingRight: 8 }}>{k}</td>
                        <td style={{ color: '#e2e8f0', fontWeight: 600 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 수두 분석 */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>수두 분석</div>
                <table style={{ fontSize: 11, width: '100%' }}>
                  <tbody>
                    {[
                      ['정적 수두', `${results.staticHead_m.toFixed(2)} m`],
                      ['압력 수두', `${results.pressureHead_m.toFixed(2)} m`],
                      ['마찰 수두', `${results.frictionHead_m.toFixed(3)} m`],
                      ['전양정 TDH', `${results.TDH_m.toFixed(2)} m`],
                      ['', ''],
                      ['NPSHa', `${results.NPSHa_m.toFixed(2)} m`],
                      results.NPSHr_m != null ? ['NPSHr', `${results.NPSHr_m.toFixed(2)} m`] : ['', ''],
                      results.NPSH_margin_m != null ? [
                        'NPSH 여유',
                        `${results.NPSH_margin_m.toFixed(2)} m ${results.NPSH_ok ? '✓' : '⚠ 부족'}`
                      ] : ['', ''],
                    ].filter(r => r[0]).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: '#64748b', paddingBottom: 4, paddingRight: 8 }}>{k}</td>
                        <td style={{
                          color: k === 'NPSH 여유'
                            ? (results.NPSH_ok ? '#4ade80' : '#ef4444')
                            : k === '전양정 TDH' ? '#60a5fa' : '#e2e8f0',
                          fontWeight: k === '전양정 TDH' ? 700 : 500,
                        }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 소요 동력 */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>소요 동력</div>
                <table style={{ fontSize: 11, width: '100%' }}>
                  <tbody>
                    {[
                      ['수동력', `${results.waterPower_kW.toFixed(2)} kW`],
                      ['축동력', `${results.shaftPower_kW.toFixed(2)} kW`],
                      ['전동기 소요', `${results.motorPower_kW.toFixed(2)} kW`],
                      ['전동기 선정', `${results.motorNominal_kW} kW`],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: '#64748b', paddingBottom: 4, paddingRight: 8 }}>{k}</td>
                        <td style={{
                          color: k === '전동기 선정' ? '#fbbf24' : '#e2e8f0',
                          fontWeight: k === '전동기 선정' ? 700 : 500,
                          fontSize: k === '전동기 선정' ? 13 : 11,
                        }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 배관 구간별 결과 */}
          <div style={card}>
            <ResultTable label="⬇ 흡입 배관 차압 계산" result={results.suctionPipeCalc} />
            <ResultTable label="⬆ 토출 배관 차압 계산" result={results.dischargePipeCalc} />
          </div>
        </div>
      )}
    </div>
  );
}

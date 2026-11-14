'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import {
  FallingFilmDesignInputs,
  calcFallingFilmEvaporator,
  getFallingFilmPreset,
  simulateTripleEffectEvaporator,
  drawFallingFilmBlueprintCanvas,
} from '@/lib/calculations/evaporator';

const EVAP_TAGS = [
  { tag: 'E-320', bcpl: 'E-5320', sepTag: 'D-321', label: 'E-320 (E-5320) — 1효 강하막 증발관 (42%→50% NaOH, 70 Tubes, 70.1 m², LC-Ni 99)' },
  { tag: 'E-330', bcpl: 'E-5330', sepTag: 'D-331', label: 'E-330 (E-5330) — 2효 강하막 증발관 (37%→42% NaOH, 164 Tubes, 168.8 m², LC-Ni 99)' },
  { tag: 'E-340', bcpl: 'E-5340', sepTag: 'D-341', label: 'E-340 (E-5340) — 3효 강하막 증발관 (32%→37% NaOH, 423 Tubes, 430.0 m², SS 310S/316L)' },
];

const TUBE_SPECS = [
  { label: '1효 표준 규격 (Ø48.3 × 2.11 mm, Pitch 60 mm)', od: 48.3, t: 2.11 },
  { label: '2·3효 표준 규격 (Ø48.3 × 1.65 mm, Pitch 60 mm)', od: 48.3, t: 1.65 },
  { label: '1" BWG 16 (OD 25.4 × t 1.65 mm)', od: 25.4, t: 1.65 },
  { label: '1.25" BWG 16 (OD 31.8 × t 1.65 mm)', od: 31.8, t: 1.65 },
  { label: '1.5" BWG 16 (OD 38.1 × t 1.65 mm)', od: 38.1, t: 1.65 },
  { label: '1.5" BWG 14 (OD 38.1 × t 2.11 mm)', od: 38.1, t: 2.11 },
  { label: '2" BWG 14 (OD 50.8 × t 2.11 mm)', od: 50.8, t: 2.11 },
];

export default function FallingFilmDesign() {
  const streams = useBalanceStore(s => s.balance.streams);
  const electrolyzerResult = useBalanceStore(s => s.balance.electrolyzerResult);
  const setEquipmentSpecOverride = usePFDStore(s => s.setEquipmentSpecOverride);
  const activeDesignRequest = usePFDStore(s => s.activeDesignRequest);
  const setActiveDesignRequest = usePFDStore(s => s.setActiveDesignRequest);

  const sf = useMemo(() => {
    return (electrolyzerResult?.cl2ProductionTonD || 467.6) / 467.6112;
  }, [electrolyzerResult]);

  const sim = useMemo(() => simulateTripleEffectEvaporator(sf), [sf]);
  const effectList = useMemo(() => [sim.effects.eff1, sim.effects.eff2, sim.effects.eff3], [sim]);

  const [selectedTag, setSelectedTag] = useState<string>('E-320');
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [inp, setInp] = useState<FallingFilmDesignInputs>(() => getFallingFilmPreset('E-320', streams));
  const [viewMode, setViewMode] = useState<'calc' | 'tema'>('calc');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const applyPreset = (tag: string) => {
    setSelectedTag(tag);
    setInp(getFallingFilmPreset(tag, streams));
    setSavedBanner(null);
  };

  useEffect(() => {
    if (activeDesignRequest && activeDesignRequest.tab === 'evap') {
      const t = activeDesignRequest.tag;
      if (['E-320', 'E-330', 'E-340'].includes(t)) {
        applyPreset(t);
      }
      setActiveDesignRequest(null);
    }
  }, [activeDesignRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const res = useMemo(() => calcFallingFilmEvaporator(inp), [inp]);

  useEffect(() => {
    if (canvasRef.current && viewMode === 'calc') {
      drawFallingFilmBlueprintCanvas(canvasRef.current, inp, res);
    }
  }, [inp, res, viewMode]);

  const handleSaveToEquipmentList = () => {
    const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const specSummary = `Falling Film ${res.A_prov_m2.toFixed(1)} m² (Ø${res.D_calandria_mm}/${res.D_separator_mm}×${res.totalVesselLength_mm}mm, Ø${inp.do_mm}×${inp.tw_mm}t×${(inp.L_m * 1000).toFixed(0)}L × ${res.N_tubes} Tubes)`;
    const remarksSummary = `[TEMA-R 설계완료] Q=${res.Q_total_kW.toFixed(1)} kW (${(res.Q_total_Mcalh / 1000).toFixed(2)} Gcal/h), U=${res.U_service_Wm2K.toFixed(0)} W/m²K, BPR=+${res.BPR_C.toFixed(1)}°C, 적심율 Γ_m=${res.actualWettingRate_kgms.toFixed(2)} kg/m·s (Γ_V=${res.volWettingRateIn_Lms.toFixed(2)} L/m·s)`;
    const recircVol_m3h = res.recircFlow_kgh / Math.max(1000, res.rhoL_kgm3);

    setEquipmentSpecOverride(selectedTag, {
      name: inp.serviceName,
      fluid: `Tube: NaOH (${inp.wtIn_pct.toFixed(1)}→${inp.wtOut_pct.toFixed(1)} wt%) / Shell: Vapour/Steam (${(inp.T_steam_in_C ?? inp.T_steam_C).toFixed(1)}°C)`,
      operTemp: `${inp.T_feed_C.toFixed(1)}→${res.T_boil_C.toFixed(1)} / ${(inp.T_steam_in_C ?? inp.T_steam_C).toFixed(1)}→${inp.T_steam_C.toFixed(1)}`,
      operPress: `${res.P_tube_barA.toFixed(3)} / ${res.P_shell_barA.toFixed(3)} barA`,
      designTemp: `${inp.designTempTube_C ?? 160} / ${inp.designTempShell_C ?? 185}`,
      designPress: `${inp.designPressTube_bar ?? '-1.0/+0.5'} / ${inp.designPressShell_bar ?? '-1.0/+2.0'} bar`,
      material: inp.matTubeSpec ?? inp.material,
      capacity: specSummary,
      motor: `Feed/Recirc ${recircVol_m3h.toFixed(1)} m³/h`,
      remarks: remarksSummary,
      designedAt: nowStr,
    });

    const pairedSep = EVAP_TAGS.find(e => e.tag === selectedTag)?.sepTag;
    if (pairedSep) {
      setEquipmentSpecOverride(pairedSep, {
        name: `${inp.effectNo}효 일체형 기액분리기 (Integral Vapour Separator)`,
        fluid: `NaOH ${inp.wtOut_pct.toFixed(1)} wt% + Vapour (${inp.evapWater_kgh.toFixed(0)} kg/h)`,
        operTemp: `${res.T_boil_C.toFixed(1)}`,
        operPress: `${res.P_tube_barA.toFixed(3)} barA`,
        designTemp: `${inp.designTempTube_C ?? 160}`,
        designPress: `${inp.designPressTube_bar ?? '-1.0/+0.5'} bar`,
        material: inp.matSeparatorSpec ?? inp.material,
        capacity: `OD Ø${res.D_separator_mm} mm (Total H ${res.totalVesselLength_mm} mm, Demister ${inp.matDemisterSpec ?? 'Wire Mesh'})`,
        remarks: `Vapour Nozzle ${res.nozzleVaporOut_NPS} / Liq Out ${(res.outFlow_kgh / 1000).toFixed(1)} t/h [TEMA-R 설계완료]`,
        designedAt: nowStr,
      });
    }

    setSavedBanner(`${selectedTag} (${inp.bcplItemNo ?? selectedTag})${pairedSep ? ` 및 ${pairedSep}` : ''} 강하막 증발관 TEMA-R 설계 사양이 장치 목록(Equipment List)에 업데이트되었습니다! (${specSummary})`);
  };

  const handleDownloadEvapDXF = () => {
    const lines: string[] = [];
    const add = (c: number | string, v: number | string) => { lines.push(String(c), String(v)); };
    add(0, 'SECTION'); add(2, 'HEADER'); add(9, '$ACADVER'); add(1, 'AC1009'); add(0, 'ENDSEC');
    add(0, 'SECTION'); add(2, 'ENTITIES');
    const dxfLine = (x1: number, y1: number, x2: number, y2: number, layer = 'OUTLINE') => {
      add(0, 'LINE'); add(8, layer);
      add(10, x1.toFixed(2)); add(20, y1.toFixed(2)); add(30, '0.0');
      add(11, x2.toFixed(2)); add(21, y2.toFixed(2)); add(31, '0.0');
    };
    const dxfRect = (x: number, y: number, w: number, h: number, layer = 'OUTLINE') => {
      dxfLine(x, y, x + w, y, layer); dxfLine(x + w, y, x + w, y + h, layer);
      dxfLine(x + w, y + h, x, y + h, layer); dxfLine(x, y + h, x, y, layer);
    };
    const dxfCircle = (cx: number, cy: number, r: number, layer = 'OUTLINE') => {
      add(0, 'CIRCLE'); add(8, layer);
      add(10, cx.toFixed(2)); add(20, cy.toFixed(2)); add(30, '0.0'); add(40, r.toFixed(2));
    };
    const dxfText = (x: number, y: number, h: number, txt: string, layer = 'TEXT') => {
      add(0, 'TEXT'); add(8, layer);
      add(10, x.toFixed(2)); add(20, y.toFixed(2)); add(30, '0.0'); add(40, h.toFixed(2));
      add(1, txt.replace(/[^\x20-\x7E]/g, ' '));
    };

    dxfRect(0, 0, 840, 594, 'BORDER');
    dxfRect(12, 12, 816, 570, 'BORDER');
    // Calandria + Integral Lower Separator Geometry
    dxfRect(210, 230, 95, 290, 'CALANDRIA');
    dxfCircle(257.5, 520, 47.5, 'CALANDRIA');
    dxfRect(185, 95, 145, 135, 'SEPARATOR');
    dxfCircle(257.5, 95, 72.5, 'SEPARATOR');
    dxfLine(257.5, 40, 257.5, 570, 'CENTER');
    for (let tx = 225; tx <= 290; tx += 13) dxfLine(tx, 235, tx, 515, 'TUBES');
    // Nozzles
    dxfRect(330, 175, 45, 28, 'NOZZLE');
    dxfText(382, 185, 7, `VAPOR OUT (${res.nozzleVaporOut_NPS} ASME CL150)`, 'DIM');
    dxfText(380, 460, 8.5, `FALLING FILM EVAPORATOR: ${selectedTag} (${inp.bcplItemNo || selectedTag})`, 'DIM');
    dxfText(380, 435, 7.5, `CALANDRIA ID: ${res.D_calandria_mm} mm | SEPARATOR ID: ${res.D_separator_mm} mm`, 'DIM');
    dxfText(380, 412, 7.5, `TOTAL HEIGHT: ${res.totalVesselLength_mm} mm | AREA: ${res.A_prov_m2.toFixed(1)} m2`, 'DIM');
    dxfText(380, 389, 7.5, `TUBES: ${res.N_tubes} EA (OD ${inp.do_mm} x ${inp.tw_mm}t x ${(inp.L_m*1000).toFixed(0)}L)`, 'DIM');
    dxfText(380, 366, 7.5, `DUTY: ${res.Q_total_kW.toFixed(1)} kW | BPR: +${res.BPR_C.toFixed(1)} C | WETTING: ${res.actualWettingRate_kgms.toFixed(2)} kg/m.s`, 'DIM');

    dxfRect(510, 12, 318, 92, 'TITLEBLOCK');
    dxfText(520, 80, 7, 'CADCRAFT ENGINEERING DWG - 300 SEC EVAPORATOR', 'TITLEBLOCK');
    dxfText(520, 52, 6.5, `ITEM: ${selectedTag} | CODE: ASME SEC.VIII DIV.1 UHX + TEMA R`, 'TITLEBLOCK');
    dxfText(520, 22, 6, `MATERIAL: ${inp.matTubeSpec || inp.material} | SCALE: NTS`, 'TITLEBLOCK');

    add(0, 'ENDSEC'); add(0, 'EOF');
    const blob = new Blob([lines.join('\r\n')], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CADcraft_${selectedTag}_FallingFilm_Evaporator.dxf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };

  const recircVol_m3h = res.recircFlow_kgh / Math.max(1000, res.rhoL_kgm3);
  const wettingOk = res.actualWettingRate_kgms >= res.minWettingRate_kgms;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1. 3-Effect Falling Film Simulation Overview Banner */}
      <div className="card" style={{
        padding: '14px 18px',
        background: 'linear-gradient(135deg, #F6F7F2, #FFFFFF)',
        border: '1px solid rgba(249,115,22,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔥 300 SEC — 3중 효용 강하막식 증발 농축 (515 MTPD NaOH)</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'rgba(249,115,22,0.2)', color: '#1A2F44' }}>
                ASME Sect. VIII Div. 1 Part UHX · TEMA R
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              E-5320 (1효: 70 Tubes, 70.1 m², Γ_V=0.98 L/m·s) · E-5330 (2효: 164 Tubes, 168.8 m², Γ_m=1.03 kg/m·s) · E-5340 (3효: 423 Tubes, 430.0 m², Γ_m=0.35 kg/m·s)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            <div style={{ padding: '4px 10px', borderRadius: 6, background: '#FFFFFF', border: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)' }}>총 수분 증발량: </span>
              <strong style={{ color: '#1A2F44' }}>{sim.totalEvapWater_kgh.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} kg/h</strong>
            </div>
            <div style={{ padding: '4px 10px', borderRadius: 6, background: '#FFFFFF', border: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)' }}>13K 스팀(S1): </span>
              <strong style={{ color: '#fb7185' }}>{sim.liveSteam13K_kgh.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} kg/h</strong>
            </div>
            <div style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.35)' }}>
              <span style={{ color: '#1A2F44' }}>스팀 경제성(Economy): </span>
              <strong style={{ color: '#1A2F44' }}>{sim.steamEconomy.toFixed(2)} kg-V/kg-S</strong>
            </div>
          </div>
        </div>

        {/* 3-Effect stage cards (Ordered Left to Right: 1효 E-320 -> 2효 E-330 -> 3효 E-340) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {effectList.map(ef => {
            const isSel = ef.evapTag === selectedTag;
            const bcplMeta = ef.effectNo === 1
              ? { item: 'E-5320', tubes: 70, area: 70.1, wet: 'Γ_V 0.98 L/m·s (Γ_m 1.34)' }
              : ef.effectNo === 2
                ? { item: 'E-5330', tubes: 164, area: 168.8, wet: 'Γ_m 1.03 kg/m·s (Once 0.70)' }
                : { item: 'E-5340', tubes: 423, area: 430.0, wet: 'Γ_m 0.35 kg/m·s (Once 0.31)' };
            return (
              <div
                key={ef.evapTag}
                onClick={() => applyPreset(ef.evapTag)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: isSel ? 'rgba(249,115,22,0.18)' : '#F6F7F2',
                  border: isSel ? '1.5px solid #1A2F44' : '1px solid var(--border-subtle)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: isSel ? '#1A2F44' : 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {ef.evapTag} / {bcplMeta.item} ({ef.effectNo}효)
                  </span>
                  <span style={{ fontSize: 10, color: '#1A2F44', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                    {bcplMeta.tubes} Tubes · {bcplMeta.area} m²
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>농도: <strong>{ef.wtIn_pct.toFixed(1)}% → {ef.wtOut_pct.toFixed(1)}%</strong></span>
                  <span>비등점: <strong>{ef.T_boil_C.toFixed(1)}°C</strong> (BPR +{ef.BPR_C.toFixed(1)}°C)</span>
                </div>
                <div style={{ fontSize: 10, color: '#1A2F44', marginTop: 3, display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>젖음율: {bcplMeta.wet}</span>
                  <span>Q: {ef.Q_duty_kW.toFixed(0)} kW</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Equipment Tag Selector & View Switcher Bar */}
      <div className="card" style={{
        padding: '14px 18px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: 'linear-gradient(90deg, rgba(56,189,248,0.1), #F6F7F2)',
        border: '1px solid rgba(56,189,248,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2F44' }}>🎯 300 SEC 강하막 증발관 선택:</span>
          <select
            value={selectedTag}
            onChange={e => applyPreset(e.target.value)}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              minWidth: 440,
            }}
          >
            {EVAP_TAGS.map(p => (
              <option key={p.tag} value={p.tag}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={() => applyPreset(selectedTag)}
            style={{
              background: '#EFECE5',
              color: '#1A2F44',
              border: '1px solid rgba(56,189,248,0.4)',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⚡ Datasheet 원본 조건 복원
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'inline-flex', background: '#FFFFFF', padding: 3, borderRadius: 7, border: '1px solid #DFDCD4' }}>
            <button
              onClick={() => setViewMode('calc')}
              style={{
                padding: '6px 12px',
                borderRadius: 5,
                border: 'none',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                background: viewMode === 'calc' ? '#1A2F44' : 'transparent',
                color: viewMode === 'calc' ? '#FFFFFF' : '#52525B',
              }}
            >
              📐 열수력학 설계 & CAD 도면
            </button>
            <button
              onClick={() => setViewMode('tema')}
              style={{
                padding: '6px 12px',
                borderRadius: 5,
                border: 'none',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                background: viewMode === 'tema' ? '#1A2F44' : 'transparent',
                color: viewMode === 'tema' ? '#FFFFFF' : '#52525B',
              }}
            >
              📄 TEMA R Datasheet (2-Page 양식)
            </button>
          </div>

          <button
            onClick={handleDownloadEvapDXF}
            style={{
              background: 'rgba(56,189,248,0.16)',
              color: '#1A2F44',
              border: '1px solid #1A2F44',
              borderRadius: 6,
              padding: '8px 13px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            CADcraft 도면(.dxf) 다운로드
          </button>

          <button
            onClick={handleSaveToEquipmentList}
            style={{
              background: 'linear-gradient(135deg, #1A2F44, #1A2F44)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 0 14px rgba(249,115,22,0.4)',
            }}
          >
            💾 설계 실행 및 Equipment List 업데이트
          </button>
        </div>
      </div>

      {savedBanner && (
        <div style={{
          padding: '10px 16px',
          borderRadius: 8,
          background: 'rgba(16,185,129,0.15)',
          border: '1px solid rgba(16,185,129,0.4)',
          color: '#1A2F44',
          fontSize: 12,
          fontWeight: 600,
        }}>
          ✅ {savedBanner}
        </div>
      )}

      {viewMode === 'tema' ? (
        <BCPLTemaDatasheet inp={inp} res={res} />
      ) : (
        /* 3. Main Grid: Left Inputs | Right Detailed Falling Film Results & CAD Blueprint */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18, alignItems: 'start' }}>
          {/* LEFT: Input Parameters */}
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2F44', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
              ⚙️ {inp.tag} ({inp.bcplItemNo ?? inp.tag}) 공정 및 기하 조건
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <NumInput label="유입 NaOH 유량 (kg/h)" value={inp.feedFlow_kgh} step={500}
                onChange={v => setInp({ ...inp, feedFlow_kgh: v })} />
              <NumInput label="증발 수분량 V (kg/h)" value={inp.evapWater_kgh} step={200}
                onChange={v => setInp({ ...inp, evapWater_kgh: v })} />
              <NumInput label="입구 농도 (wt% NaOH)" value={inp.wtIn_pct} step={0.5}
                onChange={v => setInp({ ...inp, wtIn_pct: v })} />
              <NumInput label="출구 목표 농도 (wt% NaOH)" value={inp.wtOut_pct} step={0.5}
                onChange={v => setInp({ ...inp, wtOut_pct: v })} />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2F44', marginTop: 4 }}>
              🌡️ 증발기 운전 압력 및 가열 증기 조건
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <NumInput label="튜브측 절대압력 (bar abs)" value={inp.P_tube_barA_spec ?? res.P_tube_barA} step={0.02}
                onChange={v => setInp({ ...inp, P_tube_barA_spec: Math.max(0.05, v), P_tube_kgcm2g: +((v - 1.01325) / 0.980665).toFixed(2) })} />
              <NumInput label="쉘측 절대압력 (bar abs)" value={inp.P_shell_barA ?? res.P_shell_barA} step={0.05}
                onChange={v => setInp({ ...inp, P_shell_barA: Math.max(0.1, v), P_shell_kgcm2g: +((v - 1.01325) / 0.980665).toFixed(2) })} />
              <NumInput label="쉘측 가열 증기 응축온도 (°C)" value={inp.T_steam_C} step={0.5}
                onChange={v => setInp({ ...inp, T_steam_C: v })} />
              <NumInput label="급액 입구 온도 (°C)" value={inp.T_feed_C} step={0.5}
                onChange={v => setInp({ ...inp, T_feed_C: v })} />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2F44', marginTop: 4 }}>
              🔩 강하막 튜브 갯수 · 치수 · 젖음율(Wetting Rate) 설정
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                튜브 규격 (Ø48.3 × 2.11 / 1.65 mm 또는 ASME BWG)
              </label>
              <select
                value={`${inp.do_mm}-${inp.tw_mm}`}
                onChange={e => {
                  const found = TUBE_SPECS.find(t => `${t.od}-${t.t}` === e.target.value);
                  if (found) {
                    setInp({ ...inp, do_mm: found.od, tw_mm: found.t });
                  }
                }}
                style={selectStyle}
              >
                {TUBE_SPECS.map(t => (
                  <option key={`${t.od}-${t.t}`} value={`${t.od}-${t.t}`}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: '#1A2F44', fontWeight: 700 }}>
                    튜브 갯수 (No. of Tubes)
                  </label>
                  <button
                    type="button"
                    onClick={() => setInp({ ...inp, customTubeCount: 0 })}
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: '1px solid #1A2F44', background: '#EFECE5', color: '#1A2F44', cursor: 'pointer' }}
                    title="열부하 Q/(U·ΔT) 기준으로 튜브 본수를 자동 역산합니다"
                  >
                    자동역산
                  </button>
                </div>
                <input
                  type="number"
                  step={1}
                  min={10}
                  value={inp.customTubeCount && inp.customTubeCount > 0 ? inp.customTubeCount : res.N_tubes}
                  onChange={e => setInp({ ...inp, customTubeCount: Math.max(10, Number(e.target.value) || 0) })}
                  style={{ ...selectStyle, borderColor: '#1A2F44', color: '#1A2F44', fontWeight: 700 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  튜브 길이 L (m)
                </label>
                <select
                  value={inp.L_m}
                  onChange={e => setInp({ ...inp, L_m: Number(e.target.value) })}
                  style={selectStyle}
                >
                  {[6.0, 6.8, 7.5, 8.0, 9.0, 10.0].map(L => (
                    <option key={L} value={L}>{L.toFixed(1)} m ({L === 6.8 ? '6,800 mm 표준' : `${L * 1000} mm`})</option>
                  ))}
                </select>
              </div>

              <NumInput label="튜브 피치 Pitch (mm)" value={inp.pitch_mm ?? 60} step={2}
                onChange={v => setInp({ ...inp, pitch_mm: Math.max(30, v), pitchRatio: v / inp.do_mm })} />

              <NumInput label="외부 순환 추가유량 (kg/h)" value={inp.recycleAdd_kgh ?? 0} step={2000}
                onChange={v => setInp({ ...inp, recycleAdd_kgh: Math.max(0, v) })} />

              <NumInput label="설계 여유율 (%)" value={inp.overdesignPct} step={5}
                onChange={v => setInp({ ...inp, overdesignPct: v })} />

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  튜브/튜브시트 재질 (Material)
                </label>
                <select
                  value={inp.material}
                  onChange={e => setInp({ ...inp, material: e.target.value as FallingFilmDesignInputs['material'] })}
                  style={selectStyle}
                >
                  <option value="Nickel 200">LC-Ni 99 / Nickel 200 (1·2효 표준)</option>
                  <option value="SS 310S / 316L">S.S. 310S / 316L (3효 표준)</option>
                  <option value="Ni+SS">Nickel 200 + SS316L Dual</option>
                  <option value="Duplex 2205">Duplex SS 2205</option>
                  <option value="Titanium Gr.2">Titanium Gr.2</option>
                </select>
              </div>
            </div>
          </div>

          {/* RIGHT: Falling Film Calculation Results & CAD Blueprint */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <KpiCard
                title="전열 면적 & 튜브 본수"
                value={`${res.A_prov_m2.toFixed(1)} m² (${res.N_tubes} EA)`}
                sub={`Ø${inp.do_mm}×${inp.tw_mm}t × ${(inp.L_m * 1000).toFixed(0)}mmL (Pitch ${res.pitch_mm}mm)`}
                color="#1A2F44"
              />
              <KpiCard
                title="튜브 젖음율 (Wetting Rate)"
                value={inp.effectNo === 1 ? `${res.volWettingRateIn_Lms.toFixed(2)} L/m·s` : `${res.actualWettingRate_kgms.toFixed(2)} kg/m·s`}
                sub={`질량 Γ=${res.actualWettingRate_kgms.toFixed(2)} kg/m·s | 체적 Γ_V=${res.volWettingRateIn_Lms.toFixed(2)} L/m·s`}
                color={wettingOk ? '#1A2F44' : '#f43f5e'}
              />
              <KpiCard
                title="열부하 Q & 서비스 U"
                value={`${res.Q_total_kW.toFixed(1)} kW`}
                sub={`U_serv = ${res.U_service_Wm2K.toFixed(0)} / U_calc = ${res.U_dirty_Wm2K.toFixed(0)} W/m²K`}
                color="#1A2F44"
              />
              <KpiCard
                title="쉘 / 분리기 외경 × 총길이"
                value={`Ø${res.D_calandria_mm} / ${res.D_separator_mm} mm`}
                sub={`Total Length ${res.totalVesselLength_mm.toLocaleString()} mm (TEMA R)`}
                color="#202C3C"
              />
            </div>

            {/* Detailed Engineering Table + Blueprint */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2F44', marginBottom: 10 }}>
                  📊 강하막 증발관 ({inp.tag} / {inp.bcplItemNo}) 열수력학 상세 계산서
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <tbody>
                    <Row label="튜브 규격 × 길이 × 본수 (No. of Tubes)" val={`Ø${inp.do_mm} × ${inp.tw_mm}t × ${(inp.L_m * 1000).toFixed(0)}mm × ${res.N_tubes} EA (Pitch ${res.pitch_mm}mm)`} highlight />
                    <Row label="제공 전열면적 (Surface Area)" val={`${res.A_prov_m2.toFixed(1)} m² (전체 튜브 내주 둘레 ${res.wettedPerimeter_m.toFixed(2)} m)`} highlight />
                    <Row label="질량 젖음율 Γ_m (In / Avg / Out)" val={`${res.wettingRateIn_kgms.toFixed(2)} / ${res.actualWettingRate_kgms.toFixed(2)} / ${res.wettingRateOut_kgms.toFixed(2)} kg/(m·s)`} highlight />
                    <Row label="체적 젖음율 Γ_V (In / Out / 시간당)" val={`${res.volWettingRateIn_Lms.toFixed(2)} / ${res.volWettingRateOut_Lms.toFixed(2)} L/(m·s) (${res.volWettingRate_m3hm.toFixed(2)} m³/h·m)`} highlight />
                    <Row label="수분 증발량 / 농축액 유출량" val={`증발 ${inp.evapWater_kgh.toLocaleString()} kg/h / 액출구 ${res.outFlow_kgh.toLocaleString()} kg/h (${inp.wtOut_pct.toFixed(1)}%)`} />
                    <Row label="운전 압력 (Tube / Shell)" val={`Tube ${res.P_tube_barA.toFixed(3)} barA / Shell ${res.P_shell_barA.toFixed(3)} barA`} />
                    <Row label="비등 온도 T_boil (순수 포화 + BPR)" val={`${res.T_boil_C.toFixed(1)} °C (T_sat ${res.T_sat_water_C.toFixed(1)}°C + BPR ${res.BPR_C.toFixed(1)}°C)`} />
                    <Row label="총 교환열량 Q (Heat Exchanged)" val={`${res.Q_total_kW.toFixed(1)} kW (${(res.Q_total_Mcalh / 1000).toFixed(3)} Gcal/h)`} />
                    <Row label="강하 액막 Re_film & 두께 δ" val={`Re = ${res.Re_film.toFixed(0)} | δ = ${res.filmThickness_mm.toFixed(2)} mm | h_film = ${res.h_film_Wm2K} W/m²K`} />
                    <Row label="쉘 외경 (Calandria / Separator) × 총장" val={`Ø${res.D_calandria_mm} / Ø${res.D_separator_mm} mm × L ${res.totalVesselLength_mm.toLocaleString()} mm`} />
                    <Row label="튜브/쉘 재질 (Material of Construction)" val={`${inp.matTubeSpec ?? inp.material}`} />
                    <Row label="ANSI/ASME 노즐 규격 (Liquor / Vapor)" val={`Liq ${res.nozzleLiquorIn_NPS} / Vap ${res.nozzleVaporOut_NPS} / Stm ${res.nozzleSteamIn_NPS}`} />
                  </tbody>
                </table>

                {res.warnings.length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)', color: '#fda4af', fontSize: 11 }}>
                    {res.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                  </div>
                )}
              </div>

              {/* CAD Blueprint Canvas */}
              <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={420}
                  style={{ width: '100%', maxWidth: 520, height: 'auto', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 2-Page TEMA R Technical Specification Datasheet Component ─
function BCPLTemaDatasheet({ inp, res }: { inp: FallingFilmDesignInputs; res: ReturnType<typeof calcFallingFilmEvaporator> }) {
  const bcplNo = inp.bcplItemNo ?? (inp.tag === 'E-320' ? 'E-5320' : inp.tag === 'E-330' ? 'E-5330' : 'E-5340');
  const docNo = inp.docNo ?? (inp.tag === 'E-320' ? 'TS-E-5320-001' : inp.tag === 'E-330' ? 'TS-E-5330-001' : 'TS-E-5340-001');
  const sketchNo = docNo.replace('TS-', 'SK-');

  const thS: React.CSSProperties = {
    border: '1px solid #DFDCD4',
    padding: '5px 8px',
    background: '#F6F7F2',
    color: '#52525B',
    fontSize: 10,
    fontWeight: 700,
    textAlign: 'left',
  };
  const tdS: React.CSSProperties = {
    border: '1px solid #DFDCD4',
    padding: '5px 8px',
    color: '#18181B',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
  };
  const secHdr: React.CSSProperties = {
    border: '1px solid #DFDCD4',
    padding: '6px 10px',
    background: '#EFECE5',
    color: '#1A2F44',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Action bar for Datasheet */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFFFFF', padding: '10px 16px', borderRadius: 8, border: '1px solid rgba(251,146,60,0.35)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2F44' }}>
          📋 표준 TEMA R Technical Specification — {bcplNo} ({inp.tag}, Sheet 1 & 2)
        </div>
        <button
          onClick={() => window.print()}
          style={{ background: '#1A2F44', color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
        >
          🖨️ TEMA R 데이터시트 인쇄 / PDF 저장
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* ================= SHEET 1 OF 2: PROCESS, DESIGN & MATERIALS ================= */}
        <div className="card" style={{ padding: 18, background: '#FFFFFF', border: '1px solid #DFDCD4' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <tbody>
              <tr>
                <td style={{ ...tdS, width: '22%', fontWeight: 700, color: '#52525B' }}>Code: <strong style={{ color: '#18181B' }}>TEMA R / ASME</strong></td>
                <td style={{ ...tdS, width: '48%', textAlign: 'center', fontSize: 14, fontWeight: 800, color: '#1A2F44' }}>
                  Falling Film Evaporator<br />
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#3F3F46' }}>Technical Specification (Sheet 1 of 2)</span>
                </td>
                <td style={{ ...tdS, width: '30%' }}>
                  <div>Plant: <strong>Chlor-Alkali 300 SEC</strong></div>
                  <div>Item No.: <strong style={{ color: '#1A2F44', fontSize: 13 }}>{bcplNo} ({inp.tag})</strong></div>
                  <div style={{ fontSize: 9, color: '#3F3F46' }}>Doc: {docNo}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={thS}>SERVICE</td>
                <td colSpan={3} style={tdS}>{inp.serviceName}</td>
                <td style={thS}>NO. OF UNITS</td>
                <td style={tdS}>1 (OUTDOORS)</td>
              </tr>
              <tr>
                <td style={thS}>TYPE OF HX</td>
                <td colSpan={3} style={tdS}>Falling Film Evaporator with Vapour Separator</td>
                <td style={thS}>SURFACE</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 800 }}>{res.A_prov_m2.toFixed(1)} m²</td>
              </tr>

              <tr><td colSpan={6} style={secHdr}>OPERATING CONDITIONS (PERFORMANCE OF ONE UNIT)</td></tr>
              <tr>
                <th style={thS}>ITEM</th>
                <th style={thS}>UNIT</th>
                <th style={thS}>TUBE SIDE IN</th>
                <th style={thS}>TUBE SIDE OUT</th>
                <th style={thS}>SHELL SIDE IN</th>
                <th style={thS}>SHELL SIDE OUT</th>
              </tr>
              <tr>
                <td style={thS}>FLUID</td>
                <td style={tdS}>-</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center', fontWeight: 700 }}>NaOH ({inp.wtIn_pct.toFixed(1)}% → {inp.wtOut_pct.toFixed(1)}%)</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center', fontWeight: 700 }}>{inp.effectNo === 1 ? '13K Live Steam' : 'Heating Vapour'}</td>
              </tr>
              <tr>
                <td style={thS}>FLUID QUANTITY, TOTAL</td>
                <td style={tdS}>kg/h</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{inp.feedFlow_kgh.toFixed(1)}</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{res.heatingSteamReq_kgh.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={thS}>&nbsp;&nbsp;VAPOUR</td>
                <td style={tdS}>kg/h</td>
                <td style={tdS}>-</td>
                <td style={tdS}>{inp.evapWater_kgh.toFixed(1)}</td>
                <td style={tdS}>{res.heatingSteamReq_kgh.toFixed(1)}</td>
                <td style={tdS}>-</td>
              </tr>
              <tr>
                <td style={thS}>&nbsp;&nbsp;LIQUID</td>
                <td style={tdS}>kg/h</td>
                <td style={tdS}>{inp.feedFlow_kgh.toFixed(1)}</td>
                <td style={tdS}>{res.outFlow_kgh.toFixed(1)}</td>
                <td style={tdS}>-</td>
                <td style={tdS}>{res.heatingSteamReq_kgh.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={thS}>DENSITY (VAP / LIQ)</td>
                <td style={tdS}>kg/m³</td>
                <td style={tdS}>- / {res.rhoL_in_kgm3.toFixed(1)}</td>
                <td style={tdS}>{res.rhoV_kgm3.toFixed(3)} / {res.rhoL_kgm3.toFixed(1)}</td>
                <td style={tdS}>{res.rhoSteam_kgm3.toFixed(3)} / -</td>
                <td style={tdS}>- / {(998 - 0.65 * inp.T_steam_C).toFixed(1)}</td>
              </tr>
              <tr>
                <td style={thS}>OPERATING PRESSURE</td>
                <td style={tdS}>bar abs</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center', color: '#1A2F44' }}>{res.P_tube_barA.toFixed(3)} ({(res.P_tube_barA * 0.1).toFixed(3)} MPa abs)</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center', color: '#1A2F44' }}>{res.P_shell_barA.toFixed(3)} ({(res.P_shell_barA * 0.1).toFixed(3)} MPa abs)</td>
              </tr>
              <tr>
                <td style={thS}>OPERATING TEMP.</td>
                <td style={tdS}>°C</td>
                <td style={tdS}>{inp.T_feed_C.toFixed(1)}</td>
                <td style={tdS}>{res.T_boil_C.toFixed(1)}</td>
                <td style={tdS}>~ {(inp.T_steam_in_C ?? inp.T_steam_C).toFixed(1)}</td>
                <td style={tdS}>{inp.T_steam_C.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={thS}>TUBE WETTING RATE (Γ)</td>
                <td style={tdS}>kg/m·s (L/m·s)</td>
                <td style={{ ...tdS, color: '#1A2F44' }}>{res.wettingRateIn_kgms.toFixed(2)} ({res.volWettingRateIn_Lms.toFixed(2)})</td>
                <td style={{ ...tdS, color: '#1A2F44' }}>{res.wettingRateOut_kgms.toFixed(2)} ({res.volWettingRateOut_Lms.toFixed(2)})</td>
                <td style={thS}>HEAT EXCHANGED</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 800 }}>{res.Q_total_kW.toFixed(1)} kW</td>
              </tr>

              <tr><td colSpan={6} style={secHdr}>DESIGN CONDITIONS & CODE</td></tr>
              <tr>
                <td style={thS}>DESIGN TEMPERATURE</td>
                <td style={tdS}>°C</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{inp.designTempTube_C ?? 160} °C</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{inp.designTempShell_C ?? 185} °C</td>
              </tr>
              <tr>
                <td style={thS}>DESIGN PRESSURE</td>
                <td style={tdS}>barG</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{inp.designPressTube_bar ?? '-1.0 / +0.5'} bar</td>
                <td colSpan={2} style={{ ...tdS, textAlign: 'center' }}>{inp.designPressShell_bar ?? '-1.0 / +2.0'} bar</td>
              </tr>
              <tr>
                <td style={thS}>CODE / CLASS</td>
                <td colSpan={5} style={tdS}>Design: ASME Sect. VIII, Div. 1 Part UHX, TEMA R / Fabrication: DIN / AD2000</td>
              </tr>
              <tr>
                <td style={thS}>CORROSION ALLOWANCE</td>
                <td colSpan={5} style={tdS}>Shell Side: {inp.corrAllowShell_mm ?? 0.5} mm | Tube Side: {inp.corrAllowTube_mm ?? 0.2} mm | Joint Factor: 0.85 / 1.0</td>
              </tr>

              <tr><td colSpan={6} style={secHdr}>MATERIAL OF CONSTRUCTION</td></tr>
              <tr>
                <td style={thS}>TUBES SEAMLESS</td>
                <td colSpan={2} style={{ ...tdS, color: '#B45309' }}>{inp.matTubeSpec ?? inp.material}</td>
                <td style={thS}>TUBESHEET</td>
                <td colSpan={2} style={tdS}>{inp.matTubesheetSpec ?? inp.material}</td>
              </tr>
              <tr>
                <td style={thS}>SHELL</td>
                <td colSpan={2} style={tdS}>{inp.matShellSpec ?? '316L, SA-240'}</td>
                <td style={thS}>CHANNEL / BONNET</td>
                <td colSpan={2} style={tdS}>{inp.matChannelSpec ?? inp.material}</td>
              </tr>
              <tr>
                <td style={thS}>SEPARATOR</td>
                <td colSpan={2} style={tdS}>{inp.matSeparatorSpec ?? inp.material}</td>
                <td style={thS}>DEMISTER</td>
                <td colSpan={2} style={tdS}>{inp.matDemisterSpec ?? 'LC-Ni 99 / 316Ti'}</td>
              </tr>
              <tr>
                <td style={thS}>EXPANSION JOINT</td>
                <td colSpan={2} style={tdS}>{inp.expansionJointSpec ?? 'Multi bellow 316L'}</td>
                <td style={thS}>INSULATION</td>
                <td colSpan={2} style={tdS}>Mineral wool ({inp.insulationThickness_mm ?? 120} mm)</td>
              </tr>
              <tr>
                <td style={thS}>FLANGES & GASKETS</td>
                <td colSpan={5} style={tdS}>ANSI B16.5 150/300 lbs | Product Gasket: PTFE Gore Tex Series 300 | Heating: Graphite w/ SS insert</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ================= SHEET 2 OF 2: CONSTRUCTION, TUBE BUNDLE & INSPECTION ================= */}
        <div className="card" style={{ padding: 18, background: '#FFFFFF', border: '1px solid #DFDCD4' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <tbody>
              <tr>
                <td style={{ ...tdS, width: '22%', fontWeight: 700, color: '#52525B' }}>Code: <strong style={{ color: '#18181B' }}>TEMA R / ASME</strong></td>
                <td style={{ ...tdS, width: '48%', textAlign: 'center', fontSize: 14, fontWeight: 800, color: '#1A2F44' }}>
                  Falling Film Evaporator<br />
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#3F3F46' }}>Construction & Tube Data (Sheet 2 of 2)</span>
                </td>
                <td style={{ ...tdS, width: '30%' }}>
                  <div>Plant: <strong>Chlor-Alkali 300 SEC</strong></div>
                  <div>Item No.: <strong style={{ color: '#1A2F44', fontSize: 13 }}>{bcplNo} ({inp.tag})</strong></div>
                  <div style={{ fontSize: 9, color: '#3F3F46' }}>Doc: {docNo}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td colSpan={4} style={secHdr}>CONSTRUCTION DATA (FIXED TUBE SHEET — VERTICAL FALLING FILM)</td></tr>
              <tr>
                <td style={thS}>TUBE SHEET TYPE</td>
                <td style={tdS}>☑ FIXED TUBE SHEET &nbsp;&nbsp; ☐ FLOATING HEAD</td>
                <td style={thS}>POSITION</td>
                <td style={tdS}>Vertical (Falling Film)</td>
              </tr>
              <tr>
                <td style={thS}>SHELL OUTER DIAMETER</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 800 }}>Ø {res.D_calandria_mm.toLocaleString()} / {res.D_separator_mm.toLocaleString()} mm</td>
                <td style={thS}>TOTAL LENGTH</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 800 }}>{res.totalVesselLength_mm.toLocaleString()} mm</td>
              </tr>
              <tr>
                <td style={thS}>NO. OF PASSES</td>
                <td style={tdS}>1 Pass (Downflow Film)</td>
                <td style={thS}>NO. OF TUBES</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 800, fontSize: 13 }}>{res.N_tubes} EA</td>
              </tr>
              <tr>
                <td style={thS}>LENGTH OF TUBES</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{(inp.L_m * 1000).toLocaleString()} mm ({inp.L_m.toFixed(1)} m)</td>
                <td style={thS}>TUBE SIZE (OD × t)</td>
                <td style={{ ...tdS, color: '#B45309', fontWeight: 700 }}>Ø {inp.do_mm} × {inp.tw_mm} mm</td>
              </tr>
              <tr>
                <td style={thS}>TUBE PITCH</td>
                <td style={tdS}>{res.pitch_mm} mm (Triangular 60°)</td>
                <td style={thS}>TUBE SUPPORT</td>
                <td style={tdS}>2x by grid</td>
              </tr>
              <tr>
                <td style={thS}>TUBE-TO-TUBESHEET JOINT</td>
                <td colSpan={3} style={tdS}>Welded end expanded (5%)</td>
              </tr>

              <tr><td colSpan={4} style={secHdr}>HYDRAULIC & FILM WETTING VERIFICATION</td></tr>
              <tr>
                <td style={thS}>TOTAL WETTED PERIMETER</td>
                <td style={tdS}>{res.wettedPerimeter_m.toFixed(2)} m ({res.N_tubes} tubes)</td>
                <td style={thS}>FILM REYNOLDS NO. (Re)</td>
                <td style={tdS}>{res.Re_film.toFixed(0)} (δ = {res.filmThickness_mm.toFixed(2)} mm)</td>
              </tr>
              <tr>
                <td style={thS}>MASS WETTING RATE (Γ_m)</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 700 }}>In {res.wettingRateIn_kgms.toFixed(2)} / Avg {res.actualWettingRate_kgms.toFixed(2)} / Out {res.wettingRateOut_kgms.toFixed(2)} kg/m·s</td>
                <td style={thS}>VOL. WETTING RATE (Γ_V)</td>
                <td style={{ ...tdS, color: '#1A2F44', fontWeight: 700 }}>In {res.volWettingRateIn_Lms.toFixed(2)} / Out {res.volWettingRateOut_Lms.toFixed(2)} L/m·s</td>
              </tr>
              <tr>
                <td style={thS}>TUBE EXIT VAPOUR VEL.</td>
                <td style={tdS}>{res.vaporExitVel_ms.toFixed(1)} m/s (Limit {res.floodingVelLimit_ms} m/s)</td>
                <td style={thS}>OVERALL U (Service / Calc)</td>
                <td style={tdS}>{res.U_service_Wm2K.toFixed(0)} / {res.U_dirty_Wm2K.toFixed(0)} W/m²·K</td>
              </tr>

              <tr><td colSpan={4} style={secHdr}>SURFACE FINISHING & INSPECTION</td></tr>
              <tr>
                <td style={thS}>SURFACE FINISHING</td>
                <td colSpan={3} style={tdS}>
                  <div>• CS PARTS: 2 Component zinc primer suitable for {inp.designTempShell_C ?? 185}°C in caustic atmosphere</div>
                  <div>• SS PARTS: Pickled and passivated | LC-Ni PARTS: Cleaning</div>
                </td>
              </tr>
              <tr>
                <td style={thS}>HEAT TREATMENT</td>
                <td style={tdS}>Cold formed parts acc. VDTUeV</td>
                <td style={thS}>MEASURE SKETCH</td>
                <td style={tdS}>{sketchNo}</td>
              </tr>
              <tr>
                <td style={thS}>TOLERANCES</td>
                <td colSpan={3} style={tdS}>DIN 28008-E / DIN 28005 / DIN 7168-g/T / DIN EN ISO 13920-C</td>
              </tr>
              <tr>
                <td style={thS}>RADIOGRAPHIC (NDE)</td>
                <td colSpan={3} style={tdS}>
                  <div>• Tube side (LC-Ni / SS): T-Welds 100%, C-Welds 100%, L-Welds 100%</div>
                  <div>• Shell side (SS / CS): T-Welds 100%, C-Welds 20% (CS 2%), L-Welds 20% (CS 2%)</div>
                </td>
              </tr>
              <tr>
                <td style={thS}>P.T. & LEAK DETECTION</td>
                <td colSpan={3} style={tdS}>Tube to tubesheet connection 100%; opening &gt;Ø250 | Leak detection: Flange cladding</td>
              </tr>
              <tr>
                <td style={thS}>ANSI / ASME NOZZLES</td>
                <td colSpan={3} style={tdS}>Liquor In: {res.nozzleLiquorIn_NPS} | Liquor Out: {res.nozzleLiquorOut_NPS} | Vapour Out: {res.nozzleVaporOut_NPS} | Steam In: {res.nozzleSteamIn_NPS}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
};

function NumInput({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: '100%',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          padding: '6px 8px',
          fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace',
        }}
      />
    </div>
  );
}

function KpiCard({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Row({ label, val, highlight }: { label: string; val: string; highlight?: boolean }) {
  return (
    <tr style={{ borderBottom: '1px solid #EFECE5' }}>
      <td style={{ padding: '6px 4px', color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{
        padding: '6px 4px',
        textAlign: 'right',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: highlight ? 700 : 500,
        color: highlight ? '#1A2F44' : 'var(--text-primary)',
      }}>
        {val}
      </td>
    </tr>
  );
}

'use client';
import React, { useState, useEffect, useRef } from 'react';
import {
  HX_FLUIDS, HX_MATERIALS, HXDofMode, HXDesignInputs, HXDesignResults,
  calcHeatExchanger, getHXProcessPreset,
  drawHXTQCanvas, drawHXBlueprintCanvas,
} from '@/lib/hxCalc';
import { useEquipmentList } from '@/lib/hooks/useEquipmentList';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { exportHXDatasheet } from '@/lib/excel/datasheetExport';

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
  fontSize: 10, fontWeight: 600, color: '#64748b',
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

const n1 = (v: number | undefined, u = '') => v == null || isNaN(v) ? '—' : `${v.toFixed(1)} ${u}`.trim();
const n2 = (v: number | undefined, u = '') => v == null || isNaN(v) ? '—' : `${v.toFixed(2)} ${u}`.trim();

export default function HeatExchangerDesign() {
  const hxList = useEquipmentList('heatExchanger');
  const streams = useBalanceStore(s => s.result.streams);
  const { setEquipmentSpecOverride, activeDesignRequest, setActiveDesignRequest } = usePFDStore();

  const [selectedTag, setSelectedTag]         = useState<string>('E-413');
  const [dofMode, setDofMode]                 = useState<HXDofMode>('calc_mc');
  const [hotFluidKey, setHotFluidKey]         = useState<string>('cl2_wet');
  const [mh, setMh]                           = useState<number>(19828);
  const [ThIn, setThIn]                       = useState<number>(65);
  const [ThOut, setThOut]                     = useState<number>(38);
  const [Ph, setPh]                           = useState<number>(0.27);
  const [hotCondFrac, setHotCondFrac]         = useState<number>(0.45);

  const [coldFluidKey, setColdFluidKey]       = useState<string>('cooling_water');
  const [mc, setMc]                           = useState<number>(145000);
  const [TcIn, setTcIn]                       = useState<number>(30);
  const [TcOut, setTcOut]                     = useState<number>(38);
  const [Pc, setPc]                           = useState<number>(3.5);

  const [nShell, setNShell]                   = useState<number>(1);
  const [nPasses, setNPasses]                 = useState<number>(2);
  const [doMm, setDoMm]                       = useState<number>(19.05);
  const [twMm, setTwMm]                       = useState<number>(1.24);
  const [lengthM, setLengthM]                 = useState<number>(5.0);
  const [layoutAngle, setLayoutAngle]         = useState<30 | 45 | 90>(30);
  const [baffleCut, setBaffleCut]             = useState<number>(25);
  const [overdesignPct, setOverdesignPct]     = useState<number>(15);
  const [rft, setRft]                         = useState<number>(0.00018);
  const [rfs, setRfs]                         = useState<number>(0.00018);
  const [material, setMaterial]               = useState<string>('Titanium Gr.2');
  const [designTemp, setDesignTemp]           = useState<number>(85);
  const [designPress, setDesignPress]         = useState<number>(3.0);
  const [streamInfo, setStreamInfo]           = useState<string>('');

  const [results, setResults]                 = useState<HXDesignResults | null>(null);
  const [savedNotice, setSavedNotice]         = useState<string>('');

  const tqCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const dwgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 공정 조건 로드 및 즉시 계산 헬퍼
  const applyTagPreset = (tag: string, autoSaveToList = false) => {
    setSelectedTag(tag);
    setSavedNotice('');
    if (!tag) return;
    const preset = getHXProcessPreset(tag, streams);
    const nextDof = preset.dofMode ?? 'calc_mc';
    const nextHot = preset.hotFluidKey ?? 'cl2_wet';
    const nextMh  = preset.mh_kgh ?? 20000;
    const nextThi = preset.Th_in_C ?? 65;
    const nextTho = preset.Th_out_C ?? 38;
    const nextPh  = preset.Ph_kgcm2g ?? 0.3;
    const nextCond= preset.hotCondensingFrac ?? 0;

    const nextCold= preset.coldFluidKey ?? 'cooling_water';
    const nextMc  = preset.mc_kgh ?? 80000;
    const nextTci = preset.Tc_in_C ?? 30;
    const nextTco = preset.Tc_out_C ?? 38;
    const nextPc  = preset.Pc_kgcm2g ?? 3.5;

    const nextNS  = preset.n_shell ?? 1;
    const nextNP  = preset.n_passes ?? 2;
    const nextDo  = preset.do_mm ?? 19.05;
    const nextTw  = preset.tw_mm ?? 1.65;
    const nextL   = preset.L_m ?? 4.5;
    const nextAng = (preset.layoutAngle ?? 30) as 30 | 45 | 90;
    const nextBaf = preset.baffleCutPct ?? 25;
    const nextOvd = preset.overdesignPct ?? 15;
    const nextRft = preset.rft ?? 0.00018;
    const nextRfs = preset.rfs ?? 0.00018;
    const nextMat = preset.material ?? 'Titanium Gr.2';

    setDofMode(nextDof);
    setHotFluidKey(nextHot);
    setMh(nextMh);
    setThIn(nextThi);
    setThOut(nextTho);
    setPh(nextPh);
    setHotCondFrac(nextCond);
    setColdFluidKey(nextCold);
    setMc(nextMc);
    setTcIn(nextTci);
    setTcOut(nextTco);
    setPc(nextPc);
    setNShell(nextNS);
    setNPasses(nextNP);
    setDoMm(nextDo);
    setTwMm(nextTw);
    setLengthM(nextL);
    setLayoutAngle(nextAng);
    setBaffleCut(nextBaf);
    setOverdesignPct(nextOvd);
    setRft(nextRft);
    setRfs(nextRfs);
    setMaterial(nextMat);
    setDesignTemp(preset.designTemp_C);
    setDesignPress(preset.designPress_kgcm2g);
    setStreamInfo(preset.streamInfo);

    const calcIn: HXDesignInputs = {
      tag,
      serviceName: preset.serviceName,
      section: preset.section,
      dofMode: nextDof,
      hotFluidKey: nextHot,
      mh_kgh: nextMh,
      Th_in_C: nextThi,
      Th_out_C: nextTho,
      Ph_kgcm2g: nextPh,
      hotCondensingFrac: nextCond,
      coldFluidKey: nextCold,
      mc_kgh: nextMc,
      Tc_in_C: nextTci,
      Tc_out_C: nextTco,
      Pc_kgcm2g: nextPc,
      n_shell: nextNS,
      n_passes: nextNP,
      do_mm: nextDo,
      tw_mm: nextTw,
      L_m: nextL,
      layoutAngle: nextAng,
      baffleCutPct: nextBaf,
      overdesignPct: nextOvd,
      rft: nextRft,
      rfs: nextRfs,
      material: nextMat,
    };
    const res = calcHeatExchanger(calcIn);
    setResults(res);
    if (nextDof === 'calc_mc') setMc(Math.round(res.mc_kgh));
    if (nextDof === 'calc_mh') setMh(Math.round(res.mh_kgh));
    if (autoSaveToList) {
      saveToEquipmentList(tag, calcIn, res, preset.designTemp_C, preset.designPress_kgcm2g);
    }
  };

  // 초기 로드 또는 EquipmentList에서 설계 요청 시 자동 선택
  useEffect(() => {
    if (activeDesignRequest && activeDesignRequest.tab === 'hx') {
      applyTagPreset(activeDesignRequest.tag, false);
      setActiveDesignRequest(null);
    } else {
      applyTagPreset(selectedTag, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDesignRequest]);

  // Canvas 도면 업데이트
  useEffect(() => {
    if (!results) return;
    const currentInputs: HXDesignInputs = {
      tag: selectedTag || 'HX',
      dofMode, hotFluidKey, mh_kgh: mh, Th_in_C: ThIn, Th_out_C: ThOut, Ph_kgcm2g: Ph, hotCondensingFrac: hotCondFrac,
      coldFluidKey, mc_kgh: mc, Tc_in_C: TcIn, Tc_out_C: TcOut, Pc_kgcm2g: Pc,
      n_shell: nShell, n_passes: nPasses, do_mm: doMm, tw_mm: twMm, L_m: lengthM,
      layoutAngle, baffleCutPct: baffleCut, overdesignPct, rft, rfs, material,
    };
    drawHXTQCanvas(tqCanvasRef.current, results);
    drawHXBlueprintCanvas(dwgCanvasRef.current, currentInputs, results);
  }, [results, selectedTag, dofMode, hotFluidKey, mh, ThIn, ThOut, Ph, hotCondFrac, coldFluidKey, mc, TcIn, TcOut, Pc, nShell, nPasses, doMm, twMm, lengthM, layoutAngle, baffleCut, overdesignPct, rft, rfs, material]);

  const saveToEquipmentList = (
    tag: string,
    inputs: HXDesignInputs,
    res: HXDesignResults,
    dTemp: number,
    dPress: number
  ) => {
    if (!tag) return;
    const hotFl = HX_FLUIDS.find(f => f.key === inputs.hotFluidKey);
    const coldFl = HX_FLUIDS.find(f => f.key === inputs.coldFluidKey);
    const capStr = `Q=${(res.Q_kW >= 1000 ? (res.Q_kW / 1000).toFixed(2) + ' MW' : res.Q_kW.toFixed(0) + ' kW')}, A=${res.A_prov_m2.toFixed(1)} m² (ID ${res.D_shell_mm}×${inputs.L_m}m)`;
    const opTempStr = `${inputs.Th_in_C}→${inputs.Th_out_C}`;
    const opPressStr = `${inputs.Ph_kgcm2g}`;
    const remStr = `[설계완료] U=${res.U_calc_Wm2K.toFixed(0)} W/m²K, Tube ${res.N_tubes}EA(OD ${inputs.do_mm}), ΔP=${res.dPt_bar.toFixed(2)}/${res.dPs_bar.toFixed(2)} bar`;

    setEquipmentSpecOverride(tag, {
      fluid: `${hotFl?.nameKo.split(' ')[0] ?? inputs.hotFluidKey} / ${coldFl?.nameKo.split(' ')[0] ?? inputs.coldFluidKey}`,
      operTemp: opTempStr,
      operPress: opPressStr,
      designTemp: String(dTemp),
      designPress: String(dPress),
      material: inputs.material,
      capacity: capStr,
      remarks: remStr,
      designedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    });
    setSavedNotice(`✅ [${tag}] 설계 완료! 장치 목록(Equipment List)에 전열면적(${res.A_prov_m2.toFixed(1)} m²) 및 열부하(${res.Q_kW.toFixed(0)} kW) 사양이 업데이트되었습니다.`);
  };

  const handleDesignAndSave = () => {
    const calcIn: HXDesignInputs = {
      tag: selectedTag || 'HX-001',
      dofMode,
      hotFluidKey,
      mh_kgh: mh,
      Th_in_C: ThIn,
      Th_out_C: ThOut,
      Ph_kgcm2g: Ph,
      hotCondensingFrac: hotCondFrac,
      coldFluidKey,
      mc_kgh: mc,
      Tc_in_C: TcIn,
      Tc_out_C: TcOut,
      Pc_kgcm2g: Pc,
      n_shell: nShell,
      n_passes: nPasses,
      do_mm: doMm,
      tw_mm: twMm,
      L_m: lengthM,
      layoutAngle,
      baffleCutPct: baffleCut,
      overdesignPct,
      rft,
      rfs,
      material,
    };
    const res = calcHeatExchanger(calcIn);
    setResults(res);
    if (dofMode === 'calc_mc') setMc(Math.round(res.mc_kgh));
    if (dofMode === 'calc_mh') setMh(Math.round(res.mh_kgh));
    if (dofMode === 'calc_Tc_out') setTcOut(+res.Tc_out_C.toFixed(1));
    if (dofMode === 'calc_Th_out') setThOut(+res.Th_out_C.toFixed(1));

    if (selectedTag) {
      saveToEquipmentList(selectedTag, calcIn, res, designTemp, designPress);
    } else {
      setSavedNotice('✅ 열교환기 설계 계산이 완료되었습니다. (PFD 태그 선택 시 장치목록에 자동 반영됩니다)');
    }
  };

  const handleExportExcel = async () => {
    if (!results) return;
    const eq = hxList.find(h => h.tag === selectedTag);
    const hotFl = HX_FLUIDS.find(f => f.key === hotFluidKey);
    const coldFl = HX_FLUIDS.find(f => f.key === coldFluidKey);

    await exportHXDatasheet({
      tag: selectedTag || 'HX-001',
      service: eq?.name ?? 'Chlor-Alkali Process Heat Exchanger',
      material,
      hotFluidName: hotFl?.nameKo ?? hotFluidKey,
      coldFluidName: coldFl?.nameKo ?? coldFluidKey,
      mh_kgh: results.mh_kgh,
      mc_kgh: results.mc_kgh,
      Th_in_C: results.Th_in_C,
      Th_out_C: results.Th_out_C,
      Tc_in_C: results.Tc_in_C,
      Tc_out_C: results.Tc_out_C,
      Ph_kgcm2g: Ph,
      Pc_kgcm2g: Pc,
      do_mm: doMm,
      L_m: lengthM,
      n_passes: nPasses,
      n_shell: nShell,
      layoutAngle,
      baffleCutPct: baffleCut,
      rft,
      rfs,
      results,
    });
  };

  const selectedEquip = hxList.find(h => h.tag === selectedTag);
  const hotFluidObj = HX_FLUIDS.find(f => f.key === hotFluidKey);
  const coldFluidObj = HX_FLUIDS.find(f => f.key === coldFluidKey);

  return (
    <div style={{ maxWidth: 1180 }}>
      {/* ── PFD 장치 태그 선택 배너 ─────────────────────────────────── */}
      <div style={{
        ...card,
        background: 'rgba(249,115,22,0.07)',
        borderColor: 'rgba(249,115,22,0.28)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 22 }}>🔥</span>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ ...labelSt, color: '#fb923c', marginBottom: 6 }}>
            PFD 열교환기 태그 선택 (선택 시 현재 물질수지 스트림 유량·온도·물성 자동 로드)
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedTag}
              onChange={e => applyTagPreset(e.target.value, false)}
              style={{ ...sel, maxWidth: 420 }}
            >
              <option value="" style={{ background: '#1e293b' }}>— 장치 선택 안 함 (수동 입력) —</option>
              {(['100', '200', '300', '400', '600'] as const).map(sec => {
                const secHXs = hxList.filter(h => h.section === sec);
                if (!secHXs.length) return null;
                return (
                  <optgroup key={sec} label={`${sec} Sec`} style={{ background: '#0f172a' }}>
                    {secHXs.map(h => (
                      <option key={h.id} value={h.tag} style={{ background: '#1e293b' }}>
                        {h.tag}{'  '}{h.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {selectedTag && (
              <button
                onClick={() => applyTagPreset(selectedTag, false)}
                style={{ ...btn('#38bdf8'), padding: '6px 12px', fontSize: 11 }}
                title="현재 운전부하(Material Balance) 기준 스트림 유량과 온도를 다시 불러옵니다"
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

        {selectedEquip && (
          <div style={{ fontSize: 11, color: '#94a3b8', minWidth: 180, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 14 }}>
            <div style={{ color: '#fb923c', fontWeight: 700, fontSize: 13 }}>{selectedEquip.tag}</div>
            <div style={{ color: '#e2e8f0', marginTop: 2 }}>{selectedEquip.name}</div>
            <div style={{ color: '#64748b', marginTop: 2 }}>Section {selectedEquip.section} | 재질: {material}</div>
          </div>
        )}
      </div>

      {/* ── 업데이트 알림 배너 ──────────────────────────────────────── */}
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

      {/* ── 입력 그리드 ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 좌측: 고온측 & 저온측 유체/열수지 */}
        <div>
          <div style={card}>
            <div style={sectionTitle}>⚖ 열수지 자유도 (Energy Balance Mode)</div>
            <select value={dofMode} onChange={e => setDofMode(e.target.value as HXDofMode)} style={sel}>
              <option value="calc_mc" style={{ background: '#1e293b' }}>저온측(냉각수/공정액) 필요 유량 자동 산출 (표준 냉각기)</option>
              <option value="calc_mh" style={{ background: '#1e293b' }}>고온측(가열 스팀/열매) 필요 유량 자동 산출 (표준 예열/가열기)</option>
              <option value="calc_Tc_out" style={{ background: '#1e293b' }}>저온측 출구 온도(Tc,out) 자동 산출</option>
              <option value="calc_Th_out" style={{ background: '#1e293b' }}>고온측 출구 온도(Th,out) 자동 산출</option>
              <option value="manual_both" style={{ background: '#1e293b' }}>양측 유량 및 입출구 온도 직접 지정</option>
            </select>
          </div>

          {/* 고온측 */}
          <div style={card}>
            <div style={sectionTitle}>
              🔴 고온측 스트림 (Hot Side / Shell)
              {selectedTag && <span style={{ fontSize: 9, color: '#fb923c', marginLeft: 6 }}>(공정 연동 — 수정 가능)</span>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>고온측 유체</label>
              <select value={hotFluidKey} onChange={e => setHotFluidKey(e.target.value)} style={sel}>
                {HX_FLUIDS.map(f => (
                  <option key={f.key} value={f.key} style={{ background: '#1e293b' }}>
                    {f.nameKo} (Cp={f.cp_kJkgK}, ρ={f.rho_kgm3})
                  </option>
                ))}
              </select>
            </div>
            <div style={grid2}>
              <div>
                <label style={labelSt}>
                  유량 mh (kg/h) {dofMode === 'calc_mh' && <span style={{ color: '#38bdf8' }}>[자동계산]</span>}
                </label>
                <input type="number" value={mh} step={100} onChange={e => setMh(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>운전 압력 (kg/cm²G)</label>
                <input type="number" value={Ph} step={0.1} onChange={e => setPh(+e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ ...grid3, marginTop: 10 }}>
              <div>
                <label style={labelSt}>입구 온도 Th,in (°C)</label>
                <input type="number" value={ThIn} step={1} onChange={e => setThIn(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>출구 온도 Th,out (°C)</label>
                <input type="number" value={ThOut} step={1} onChange={e => setThOut(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>응축/잠열 분율 (0~1)</label>
                <input type="number" value={hotCondFrac} step={0.05} min={0} max={1}
                  onChange={e => setHotCondFrac(+e.target.value)} style={inp} />
              </div>
            </div>
            {hotFluidObj && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#64748b' }}>
                밀도: {hotFluidObj.rho_kgm3} kg/m³ | 비열: {hotFluidObj.cp_kJkgK} kJ/kg·K | 열전도도: {hotFluidObj.k_WmK} W/m·K
                {hotFluidObj.latent_kJkg ? ` | 잠열: ${hotFluidObj.latent_kJkg} kJ/kg` : ''}
              </div>
            )}
          </div>

          {/* 저온측 */}
          <div style={card}>
            <div style={sectionTitle}>
              🔵 저온측 스트림 (Cold Side / Tube)
              {selectedTag && <span style={{ fontSize: 9, color: '#38bdf8', marginLeft: 6 }}>(공정 연동 — 수정 가능)</span>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>저온측 유체</label>
              <select value={coldFluidKey} onChange={e => setColdFluidKey(e.target.value)} style={sel}>
                {HX_FLUIDS.map(f => (
                  <option key={f.key} value={f.key} style={{ background: '#1e293b' }}>
                    {f.nameKo} (Cp={f.cp_kJkgK}, ρ={f.rho_kgm3})
                  </option>
                ))}
              </select>
            </div>
            <div style={grid2}>
              <div>
                <label style={labelSt}>
                  유량 mc (kg/h) {dofMode === 'calc_mc' && <span style={{ color: '#38bdf8' }}>[자동계산]</span>}
                </label>
                <input type="number" value={mc} step={500} onChange={e => setMc(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>운전 압력 (kg/cm²G)</label>
                <input type="number" value={Pc} step={0.1} onChange={e => setPc(+e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ ...grid2, marginTop: 10 }}>
              <div>
                <label style={labelSt}>입구 온도 Tc,in (°C)</label>
                <input type="number" value={TcIn} step={1} onChange={e => setTcIn(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>출구 온도 Tc,out (°C)</label>
                <input type="number" value={TcOut} step={1} onChange={e => setTcOut(+e.target.value)} style={inp} />
              </div>
            </div>
            {coldFluidObj && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#64748b' }}>
                밀도: {coldFluidObj.rho_kgm3} kg/m³ | 비열: {coldFluidObj.cp_kJkgK} kJ/kg·K | 열전도도: {coldFluidObj.k_WmK} W/m·K
              </div>
            )}
          </div>
        </div>

        {/* 우측: TEMA 기하구조 & 재질 & 설계 버튼 */}
        <div>
          <div style={card}>
            <div style={sectionTitle}>📐 TEMA 기하구조 및 재질 설정 (Bell-Delaware)</div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelSt}>전해공장 특화 재질 (Tube / Shell Material)</label>
              <select value={material} onChange={e => setMaterial(e.target.value)} style={sel}>
                {HX_MATERIALS.map(m => (
                  <option key={m.key} value={m.key} style={{ background: '#1e293b' }}>
                    {m.label} (k={m.kw_WmK} W/m·K)
                  </option>
                ))}
              </select>
            </div>

            <div style={grid3}>
              <div>
                <label style={labelSt}>튜브 외경 OD (mm)</label>
                <select value={doMm} onChange={e => setDoMm(+e.target.value)} style={sel}>
                  <option value={15.88} style={{ background: '#1e293b' }}>15.88 mm (5/8&quot;)</option>
                  <option value={19.05} style={{ background: '#1e293b' }}>19.05 mm (3/4&quot; 표준)</option>
                  <option value={25.4}  style={{ background: '#1e293b' }}>25.40 mm (1&quot; 대형)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>튜브 두께 tw (mm)</label>
                <select value={twMm} onChange={e => setTwMm(+e.target.value)} style={sel}>
                  <option value={1.24} style={{ background: '#1e293b' }}>1.24 mm (BWG 18 Ti)</option>
                  <option value={1.65} style={{ background: '#1e293b' }}>1.65 mm (BWG 16 표준)</option>
                  <option value={2.11} style={{ background: '#1e293b' }}>2.11 mm (BWG 14 고압)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>튜브 길이 L (m)</label>
                <select value={lengthM} onChange={e => setLengthM(+e.target.value)} style={sel}>
                  {[2.44, 3.0, 3.66, 4.5, 5.0, 6.0].map(l => (
                    <option key={l} value={l} style={{ background: '#1e293b' }}>{l.toFixed(2)} m</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ ...grid3, marginTop: 10 }}>
              <div>
                <label style={labelSt}>튜브 패스 수 (Passes)</label>
                <select value={nPasses} onChange={e => setNPasses(+e.target.value)} style={sel}>
                  {[1, 2, 4, 6].map(p => (
                    <option key={p} value={p} style={{ background: '#1e293b' }}>{p} Pass</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>직렬 쉘 수 (Shells)</label>
                <select value={nShell} onChange={e => setNShell(+e.target.value)} style={sel}>
                  {[1, 2, 3, 4].map(s => (
                    <option key={s} value={s} style={{ background: '#1e293b' }}>{s} Shell</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>튜브 피치 배열각</label>
                <select value={layoutAngle} onChange={e => setLayoutAngle(+e.target.value as 30 | 45 | 90)} style={sel}>
                  <option value={30} style={{ background: '#1e293b' }}>30° 삼각 (전열 최우선)</option>
                  <option value={90} style={{ background: '#1e293b' }}>90° 사각 (기계세정용)</option>
                  <option value={45} style={{ background: '#1e293b' }}>45° 회전사각</option>
                </select>
              </div>
            </div>

            <div style={{ ...grid2, marginTop: 10 }}>
              <div>
                <label style={labelSt}>배플 컷 ({baffleCut}%)</label>
                <input type="range" min={18} max={40} step={1} value={baffleCut}
                  onChange={e => setBaffleCut(+e.target.value)} style={{ width: '100%', accentColor: '#fb923c' }} />
              </div>
              <div>
                <label style={labelSt}>전열면적 설계 여유율 ({overdesignPct}%)</label>
                <input type="range" min={10} max={30} step={1} value={overdesignPct}
                  onChange={e => setOverdesignPct(+e.target.value)} style={{ width: '100%', accentColor: '#fb923c' }} />
              </div>
            </div>

            <div style={{ ...grid2, marginTop: 10 }}>
              <div>
                <label style={labelSt}>설계 온도 (°C)</label>
                <input type="number" value={designTemp} onChange={e => setDesignTemp(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>설계 압력 (kg/cm²G)</label>
                <input type="number" value={designPress} step={0.5} onChange={e => setDesignPress(+e.target.value)} style={inp} />
              </div>
            </div>
          </div>

          {/* 실행 버튼 */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={handleDesignAndSave} style={{ ...btn('#fb923c'), padding: '11px 26px', fontSize: 13 }}>
              🔶 열교환기 설계 및 장치목록 업데이트
            </button>
            {results && (
              <button onClick={handleExportExcel} style={{ ...btn('#4ade80'), padding: '11px 20px', fontSize: 12 }}>
                📥 Excel 데이터시트 다운로드
              </button>
            )}
          </div>

          {/* 핵심 KPI 요약 카드 */}
          {results && (
            <div style={card}>
              <div style={sectionTitle}>📊 설계 핵심 결과 (TEMA Datasheet Summary)</div>
              <div style={grid3}>
                {[
                  { label: '열교환 부하 (Q)', val: `${n1(results.Q_kW)} kW`, sub: `${results.Q_Mcalh.toFixed(0)} Mcal/h`, color: '#fb923c' },
                  { label: '설계 전열면적 (A)', val: `${n1(results.A_prov_m2)} m²`, sub: `요구 ${n1(results.A_req_m2)} m² (+${results.overdesign_pct.toFixed(0)}%)`, color: '#4ade80' },
                  { label: '총괄전열계수 (U)', val: `${results.U_calc_Wm2K.toFixed(0)} W/m²K`, sub: `CMTD ${n1(results.CMTD_C)}°C (Ft ${results.Ft.toFixed(2)})`, color: '#38bdf8' },
                  { label: '쉘 내경 × 길이', val: `ID ${results.D_shell_mm} mm`, sub: `L = ${lengthM} m (${nShell} Shell)`, color: '#a78bfa' },
                  { label: '튜브 수량 × 규격', val: `${results.N_tubes} EA`, sub: `OD ${doMm}mm × ${nPasses} Pass`, color: '#fbbf24' },
                  { label: '관측 / 쉘측 차압', val: `${n2(results.dPt_bar)} / ${n2(results.dPs_bar)} bar`, sub: `유속 ${n2(results.vt_ms)} / ${n2(results.vs_ms)} m/s`, color: results.dPt_bar > 0.7 || results.dPs_bar > 0.7 ? '#f87171' : '#34d399' },
                ].map(item => (
                  <div key={item.label} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${item.color}33`,
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.val}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{item.sub}</div>
                  </div>
                ))}
              </div>

              {results.warnings.length > 0 && (
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                  {results.warnings.map((w, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: '#fbbf24' }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 하단: T-Q 프로파일 & TEMA CAD 도면 ───────────────────────── */}
      {results && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20, marginTop: 4 }}>
          <div style={card}>
            <div style={sectionTitle}>📈 T-Q 열교환 온도 구배 선도 (Driving Force Profile)</div>
            <canvas
              ref={tqCanvasRef}
              width={480}
              height={250}
              style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>
          <div style={card}>
            <div style={sectionTitle}>📐 TEMA Shell & Tube 엔지니어링 CAD 블루프린트</div>
            <canvas
              ref={dwgCanvasRef}
              width={560}
              height={250}
              style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid rgba(56,189,248,0.2)' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

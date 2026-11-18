'use client';
import React, { useState, useEffect, useRef } from 'react';
import {
  LIQUID_FLUIDS, GAS_FLUIDS,
  densityAtT, viscosityAtT, gasDensity,
} from '@/lib/physicalProperties';
import { PACKING_DB, calcPackingTower, PackingTowerInputs, TowerMode } from '@/lib/packingCalc';
import { getTowerProcessPreset, drawTowerBlueprintCanvas } from '@/lib/hxCalc';
import { useEquipmentList } from '@/lib/hooks/useEquipmentList';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { exportTowerDatasheet } from '@/lib/excel/datasheetExport';

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E2DC',
  borderRadius: 10, padding: '16px 20px', marginBottom: 16,
};
const inp: React.CSSProperties = {
  width: '100%', height: 32, background: '#F6F7F2',
  border: '1px solid #DFDCD4', borderRadius: 6,
  color: '#27272A', fontSize: 12, padding: '0 10px',
  outline: 'none', boxSizing: 'border-box',
};
const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };
const labelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#2C353E',
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4, display: 'block',
};
const btn = (c: string): React.CSSProperties => ({
  padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 700,
  border: `1px solid ${c}44`, background: `${c}18`,
  color: c, cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif",
  transition: 'all 0.15s',
});
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#52525B', marginBottom: 12,
  paddingBottom: 8, borderBottom: '1px solid #EFECE5',
  display: 'flex', alignItems: 'center', gap: 6,
};
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };

type FluidMode = 'preset' | 'manual';

function getDefaultTowerTagForPlant(plantId?: string): string {
  switch (plantId) {
    case 'hcl_synth':
      return 'C-110';
    case 'ech_gte':
      return 'C-101';
    case 'cms_plant':
      return 'C-201';
    case 'mdi_plant':
      return 'C-101';
    default:
      return 'T-430';
  }
}

export default function PackingTower() {
  const activePlantId = useBalanceStore(s => s.activePlantId);
  const isElectrolysisPlant = activePlantId === 'clorsim' || activePlantId === 'clorsim_sim';
  const towers  = useEquipmentList('tower');
  const streams = useBalanceStore(s => s.result.streams);
  const { setEquipmentSpecOverride, activeDesignRequest, setActiveDesignRequest } = usePFDStore();

  const [selectedTag, setSelectedTag]   = useState<string>(() => getDefaultTowerTagForPlant(activePlantId));
  const [mode, setMode]                 = useState<TowerMode>('absorption');
  const [temp, setTemp]                 = useState(14);
  const [pressure, setPressure]         = useState(101.3);
  const [packingKey, setPackingKey]     = useState('tellerette_1b');
  const [floodFrac, setFloodFrac]       = useState(0.68);
  const [hetpCorr, setHetpCorr]         = useState(1.0);
  const [material, setMaterial]         = useState('FRP+PVC/PVDF lining (1B Tellerette 45×19mm)');
  const [designTemp, setDesignTemp]     = useState('60');
  const [designPress, setDesignPress]   = useState('0.5');
  const [operPressG, setOperPressG]     = useState('0.01');
  const [streamInfo, setStreamInfo]     = useState('');

  const [gasMode, setGasMode]                     = useState<FluidMode>('preset');
  const [gasFluidKey, setGasFluidKey]             = useState('cl2_gas');
  const [gasFlow, setGasFlow]                     = useState(23496);
  const [gasDensityManual, setGasDensityManual]   = useState(2.9);
  const [gasViscManual, setGasViscManual]         = useState(0.013);

  const [liqMode, setLiqMode]                     = useState<FluidMode>('preset');
  const [liqFluidKey, setLiqFluidKey]             = useState('h2so4_60');
  const [liqFlow, setLiqFlow]                     = useState(51691);
  const [liqDensityManual, setLiqDensityManual]   = useState(1498);
  const [liqViscManual, setLiqViscManual]         = useState(7.2);
  const [liqSigmaManual, setLiqSigmaManual]       = useState(76);

  const [separationMode, setSeparationMode] = useState<'stages' | 'kremser' | 'hog'>('hog');
  const [stages, setStages]   = useState(4);
  const [yIn, setYIn]         = useState(0.025);
  const [yOut, setYOut]       = useState(0.00243);
  const [yEq, setYEq]         = useState(0.00145);
  const [absA, setAbsA]       = useState(1.5);
  const [targetU, setTargetU] = useState<number>(0.24);
  const [fixedZ, setFixedZ]   = useState<number>(3.65);

  const [results, setResults]         = useState<ReturnType<typeof calcPackingTower> | null>(null);
  const [error, setError]             = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const dwgCanvasRef                  = useRef<HTMLCanvasElement | null>(null);

  const getGasDensity = (t = temp, p = pressure, gKey = gasFluidKey, gMode = gasMode) => {
    if (gMode === 'manual') return gasDensityManual;
    const gf = GAS_FLUIDS.find(f => f.key === gKey);
    if (!gf) return 2.9;
    if (gf.MW) return gasDensity(gf.MW, t, p);
    return densityAtT(gf, t);
  };
  const getGasVisc = (t = temp, gKey = gasFluidKey, gMode = gasMode) => {
    if (gMode === 'manual') return gasViscManual;
    const gf = GAS_FLUIDS.find(f => f.key === gKey);
    return gf ? viscosityAtT(gf, t) : 0.013;
  };
  const getLiqDensity = (t = temp, lKey = liqFluidKey, lMode = liqMode) => {
    if (lMode === 'manual') return liqDensityManual;
    const lf = LIQUID_FLUIDS.find(f => f.key === lKey);
    return lf ? densityAtT(lf, t) : 998;
  };
  const getLiqVisc = (t = temp, lKey = liqFluidKey, lMode = liqMode) => {
    if (lMode === 'manual') return liqViscManual;
    const lf = LIQUID_FLUIDS.find(f => f.key === lKey);
    return lf ? viscosityAtT(lf, t) : 1.0;
  };
  const getLiqSigma = (lKey = liqFluidKey, lMode = liqMode) => {
    if (lMode === 'manual') return liqSigmaManual;
    const lf = LIQUID_FLUIDS.find(f => f.key === lKey);
    return lf?.surfaceTension ?? 72;
  };

  // 태그 선택 시 현재 Material Balance 공정 조건을 자동으로 로드하고 초기 계산 수행
  const handleTagSelect = (tag: string, plantOverride?: string) => {
    setSelectedTag(tag);
    setSavedNotice('');
    setError('');
    if (!tag) return;

    const preset = getTowerProcessPreset(tag, streams, plantOverride ?? activePlantId);
    const validPacking = PACKING_DB.some(p => p.key === preset.packingKey)
      ? preset.packingKey
      : 'pall_50';

    setMode(preset.mode);
    setTemp(preset.temp_C);
    setPressure(preset.pressure_kPa);
    setOperPressG(preset.operPress_kgcm2g);
    setDesignTemp(preset.designTemp_C);
    setDesignPress(preset.designPress_kgcm2g);
    setMaterial(preset.material);
    setGasMode('preset');
    setGasFluidKey(preset.gasFluidKey);
    setGasFlow(preset.gasFlow_kgh);
    setLiqMode('preset');
    setLiqFluidKey(preset.liqFluidKey);
    setLiqFlow(preset.liqFlow_kgh);
    setPackingKey(validPacking);
    setFloodFrac(preset.floodFrac);
    setSeparationMode(preset.separationMode);
    setStages(preset.stages);
    setYIn(preset.yIn);
    setYOut(preset.yOut);
    setYEq(preset.yEq ?? 0);
    setAbsA(preset.absA);
    setTargetU(preset.targetU_ms ?? 0);
    setFixedZ(preset.fixedZ_m ?? 0);
    setStreamInfo(preset.streamInfo);

    try {
      const inputs: PackingTowerInputs = {
        mode: preset.mode,
        temperature_C: preset.temp_C,
        pressure_kPa: preset.pressure_kPa,
        gasFlow_kgh: preset.gasFlow_kgh,
        gasDensity_kgm3: getGasDensity(preset.temp_C, preset.pressure_kPa, preset.gasFluidKey, 'preset'),
        gasViscosity_mPas: getGasVisc(preset.temp_C, preset.gasFluidKey, 'preset'),
        liquidFlow_kgh: preset.liqFlow_kgh,
        liquidDensity_kgm3: getLiqDensity(preset.temp_C, preset.liqFluidKey, 'preset'),
        liquidViscosity_mPas: getLiqVisc(preset.temp_C, preset.liqFluidKey, 'preset'),
        surfaceTension_mNm: getLiqSigma(preset.liqFluidKey, 'preset'),
        packingKey: validPacking,
        floodingFraction: preset.floodFrac,
        HETP_correction: hetpCorr,
        targetSuperficialVelocity_ms: preset.targetU_ms,
        fixedPackingHeight_m: preset.fixedZ_m,
        ...(preset.separationMode === 'stages'
          ? { theoreticalStages: preset.stages }
          : preset.separationMode === 'hog'
            ? { y_in: preset.yIn, y_out: preset.yOut, y_eq: preset.yEq ?? 0 }
            : { y_in: preset.yIn, y_out: preset.yOut, absorptionFactor: preset.absA }),
      };
      setResults(calcPackingTower(inputs));
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  // 표 1.39 식염전해 황산탈수탑 실측·계산 레퍼런스 (G_M = 40 kmol-Cl2/h = 2,843 kg/h, S = 1.085 m², D = 1,175 mm) 즉시 로드
  const applyRefTable139 = (stageNo: 1 | 2 | 3) => {
    setError('');
    setSavedNotice('');
    if (stageNo === 1) {
      setSelectedTag('T-430');
      setMode('absorption');
      setTemp(14);
      setPressure(101.3);
      setMaterial('FRP+PVC/PVDF lining (1B Tellerette 45×19mm)');
      setGasMode('preset'); setGasFluidKey('cl2_gas'); setGasFlow(2843);
      setLiqMode('preset'); setLiqFluidKey('h2so4_60'); setLiqFlow(44659);
      setPackingKey('tellerette_1b');
      setSeparationMode('hog');
      setYIn(0.025); setYOut(0.00243); setYEq(0.00145);
      setTargetU(0.24); setFixedZ(3.65);
      setStreamInfo('📚 [표 1.39 No.1 건조탑 실측·계산예] 60wt% H₂SO₄ (30 m³/h, 14°C), Cl₂ 20→2 mg/L, 1B 테라렛(45×19), Z=3.65m, U=0.24m/s, S=1.085m², N_OG=3.18, H_OG=1.1m, K_Ga=32');
      setResults(calcPackingTower({
        mode: 'absorption', temperature_C: 14, pressure_kPa: 101.3,
        gasFlow_kgh: 2843, gasDensity_kgm3: getGasDensity(21, 101.3, 'cl2_gas', 'preset'), gasViscosity_mPas: getGasVisc(21, 'cl2_gas', 'preset'),
        liquidFlow_kgh: 44659, liquidDensity_kgm3: getLiqDensity(14, 'h2so4_60', 'preset'), liquidViscosity_mPas: getLiqVisc(14, 'h2so4_60', 'preset'),
        surfaceTension_mNm: getLiqSigma('h2so4_60', 'preset'),
        packingKey: 'tellerette_1b', floodingFraction: 0.68, HETP_correction: 1.0,
        y_in: 0.025, y_out: 0.00243, y_eq: 0.00145,
        targetSuperficialVelocity_ms: 0.24, fixedPackingHeight_m: 3.65,
      }));
    } else if (stageNo === 2) {
      setSelectedTag('T-440');
      setMode('absorption');
      setTemp(19);
      setPressure(101.3);
      setMaterial('FRP+PVDF lining (2B Raschig Ring 50×50mm)');
      setGasMode('preset'); setGasFluidKey('cl2_gas'); setGasFlow(2843);
      setLiqMode('preset'); setLiqFluidKey('h2so4_91'); setLiqFlow(21776);
      setPackingKey('raschig_50');
      setSeparationMode('hog');
      setYIn(0.00243); setYOut(0.0011); setYEq(0.000063);
      setTargetU(0.24); setFixedZ(3.65);
      setStreamInfo('📚 [표 1.39 No.2 건조탑 실측·계산예] 91wt% H₂SO₄ (12 m³/h, 19°C), Cl₂ 2→0.9 mg/L, 2B 라시히링(50×50), Z=3.65m, U=0.24m/s, S=1.085m², N_OG=0.83, H_OG=4.4m, K_Ga=8.4');
      setResults(calcPackingTower({
        mode: 'absorption', temperature_C: 19, pressure_kPa: 101.3,
        gasFlow_kgh: 2843, gasDensity_kgm3: getGasDensity(19, 101.3, 'cl2_gas', 'preset'), gasViscosity_mPas: getGasVisc(19, 'cl2_gas', 'preset'),
        liquidFlow_kgh: 21776, liquidDensity_kgm3: getLiqDensity(19, 'h2so4_91', 'preset'), liquidViscosity_mPas: getLiqVisc(19, 'h2so4_91', 'preset'),
        surfaceTension_mNm: getLiqSigma('h2so4_91', 'preset'),
        packingKey: 'raschig_50', floodingFraction: 0.68, HETP_correction: 1.0,
        y_in: 0.00243, y_out: 0.0011, y_eq: 0.000063,
        targetSuperficialVelocity_ms: 0.24, fixedPackingHeight_m: 3.65,
      }));
    } else {
      setSelectedTag('T-450');
      setMode('absorption');
      setTemp(21);
      setPressure(101.3);
      setMaterial('CS+PTFE lining (1B Tellerette 45×19mm)');
      setGasMode('preset'); setGasFluidKey('cl2_gas'); setGasFlow(2843);
      setLiqMode('preset'); setLiqFluidKey('h2so4_94'); setLiqFlow(22145);
      setPackingKey('tellerette_1b');
      setSeparationMode('hog');
      setYIn(0.0011); setYOut(0.000078); setYEq(0.0000007);
      setTargetU(0.24); setFixedZ(3.65);
      setStreamInfo('📚 [표 1.39 No.3 건조탑 실측·계산예] 94wt% H₂SO₄ (12 m³/h, 21°C), Cl₂ 0.9→0.06 mg/L, 1B 테라렛(45×19), Z=3.65m, U=0.24m/s, S=1.085m², N_OG=2.64, H_OG=1.4m, K_Ga=27');
      setResults(calcPackingTower({
        mode: 'absorption', temperature_C: 21, pressure_kPa: 101.3,
        gasFlow_kgh: 2843, gasDensity_kgm3: getGasDensity(21, 101.3, 'cl2_gas', 'preset'), gasViscosity_mPas: getGasVisc(21, 'cl2_gas', 'preset'),
        liquidFlow_kgh: 22145, liquidDensity_kgm3: getLiqDensity(21, 'h2so4_94', 'preset'), liquidViscosity_mPas: getLiqVisc(21, 'h2so4_94', 'preset'),
        surfaceTension_mNm: getLiqSigma('h2so4_94', 'preset'),
        packingKey: 'tellerette_1b', floodingFraction: 0.65, HETP_correction: 1.0,
        y_in: 0.0011, y_out: 0.000078, y_eq: 0.0000007,
        targetSuperficialVelocity_ms: 0.24, fixedPackingHeight_m: 3.65,
      }));
    }
  };

  useEffect(() => {
    if (activeDesignRequest && activeDesignRequest.tab === 'packing') {
      handleTagSelect(activeDesignRequest.tag, activePlantId);
      setActiveDesignRequest(null);
    } else {
      const validForPlant = towers.some(t => t.tag === selectedTag);
      const targetTag = validForPlant
        ? selectedTag
        : towers[0]?.tag ?? getDefaultTowerTagForPlant(activePlantId);
      handleTagSelect(targetTag, activePlantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDesignRequest, activePlantId, towers]);

  useEffect(() => {
    if (!results) return;
    const pk = PACKING_DB.find(p => p.key === packingKey);
    drawTowerBlueprintCanvas(dwgCanvasRef.current, {
      tag: selectedTag || 'COL-001',
      D_m: results.tower_diameter_std_mm / 1000,
      Z_m: results.packingHeight_m,
      H_total_m: results.totalHeight_m,
      stages: results.theoreticalStages,
      HETP_m: results.HETP_m,
      packingName: pk?.name ?? packingKey,
      floodPct: floodFrac * 100,
      dP_mmH2O_m: (results.dP_total_kPa / Math.max(0.5, results.packingHeight_m)) * 101.97,
      material,
    });
  }, [results, selectedTag, packingKey, floodFrac, material]);

  const calculateAndSave = () => {
    try {
      setError('');
      const inputs: PackingTowerInputs = {
        mode,
        temperature_C: temp,
        pressure_kPa: pressure,
        gasFlow_kgh: gasFlow,
        gasDensity_kgm3: getGasDensity(),
        gasViscosity_mPas: getGasVisc(),
        liquidFlow_kgh: liqFlow,
        liquidDensity_kgm3: getLiqDensity(),
        liquidViscosity_mPas: getLiqVisc(),
        surfaceTension_mNm: getLiqSigma(),
        packingKey,
        floodingFraction: floodFrac,
        HETP_correction: hetpCorr,
        targetSuperficialVelocity_ms: targetU > 0 ? targetU : undefined,
        fixedPackingHeight_m: fixedZ > 0 ? fixedZ : undefined,
        ...(separationMode === 'stages'
          ? { theoreticalStages: stages }
          : separationMode === 'hog'
            ? { y_in: yIn, y_out: yOut, y_eq: yEq }
            : { y_in: yIn, y_out: yOut, absorptionFactor: absA }),
      };
      const res = calcPackingTower(inputs);
      setResults(res);

      if (selectedTag) {
        const pk = PACKING_DB.find(p => p.key === packingKey);
        const dMeters = (res.tower_diameter_std_mm / 1000).toFixed(2);
        const zMeters = res.packingHeight_m.toFixed(2);
        const hMeters = res.totalHeight_m.toFixed(1);
        const capStr = `D=${dMeters} m (S=${res.crossSectionArea_m2.toFixed(2)} m²), Z=${zMeters} m (H=${hMeters} m)`;
        const remStr = `[설계완료] ${pk?.name ?? packingKey}, N_OG=${res.NTU.toFixed(2)} (H_OG=${res.H_OG_m.toFixed(2)}m, K_Ga=${res.K_Ga_kmolm3h.toFixed(1)}), U=${res.u_operating_ms.toFixed(2)}m/s`;

        setEquipmentSpecOverride(selectedTag, {
          operTemp: String(temp),
          operPress: operPressG || ((pressure - 101.325) / 98.0665).toFixed(2),
          designTemp,
          designPress,
          material,
          capacity: capStr,
          remarks: remStr,
          designedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        });
        setSavedNotice(`✅ [${selectedTag}] 패킹컬럼 설계 완료! 장치 목록(Equipment List)에 규격(${capStr})이 반영되었습니다.`);
      } else {
        setSavedNotice('✅ 패킹컬럼 설계 계산이 완료되었습니다.');
      }
    } catch (e: unknown) { setError(String(e)); }
  };

  const exportExcel = async () => {
    if (!results) return;
    const packing = PACKING_DB.find(p => p.key === packingKey);
    const eq = selectedTag ? towers.find(t => t.tag === selectedTag) : null;
    const modeKo: Record<TowerMode, string> = {
      absorption: '흡수 (Absorption)',
      stripping:  '탈거/스트리핑 (Stripping)',
      scrubbing:  '세정 (Scrubbing)',
    };

    await exportTowerDatasheet({
      tag:              eq?.tag ?? selectedTag ?? 'COL',
      service:          eq?.name ?? `${modeKo[mode]} 패킹타워`,
      mode:             modeKo[mode],
      temperature_C:    temp,
      pressure_kPa:     pressure,
      packingName:      packing?.name ?? packingKey,
      packingAp:        packing?.ap ?? 0,
      packingVoid:      packing?.voidFraction ?? 0,
      packingFp:        packing?.packingFactor ?? 0,
      packingHETP_ref:  packing?.HETP_ref ?? 0,
      floodingFraction: floodFrac,
      gasFluidName:     gasMode === 'preset'
                          ? (GAS_FLUIDS.find(f => f.key === gasFluidKey)?.nameKo ?? gasFluidKey)
                          : '직접 입력',
      gasFlow_kgh:      gasFlow,
      gasDensity_kgm3:  getGasDensity(),
      gasViscosity_mPas: getGasVisc(),
      liqFluidName:     liqMode === 'preset'
                          ? (LIQUID_FLUIDS.find(f => f.key === liqFluidKey)?.nameKo ?? liqFluidKey)
                          : '직접 입력',
      liqFlow_kgh:      liqFlow,
      liqDensity_kgm3:  getLiqDensity(),
      liqViscosity_mPas: getLiqVisc(),
      surfaceTension_mNm: getLiqSigma(),
      theoreticalStages: stages,
      separationMode:   separationMode === 'hog' ? 'kremser' : separationMode,
      yIn:              (separationMode === 'kremser' || separationMode === 'hog') ? yIn : undefined,
      yOut:             (separationMode === 'kremser' || separationMode === 'hog') ? yOut : undefined,
      absorptionFactor: separationMode === 'kremser' ? absA : undefined,
      hetpCorrection:   hetpCorr,
      results,
    });
  };

  const modeLabel: Record<TowerMode, string> = {
    absorption: '흡수 (Absorption)',
    stripping:  '탈거/스트리핑 (Stripping)',
    scrubbing:  '세정 (Scrubbing)',
  };

  const selectedEquip = towers.find(t => t.tag === selectedTag);

  return (
    <div style={{ maxWidth: 1180 }}>

      {/* ── 장치 선택 배너 ─────────────────────────────────────── */}
      <div style={{
        ...card,
        background: 'rgba(167,139,250,0.06)',
        borderColor: 'rgba(167,139,250,0.25)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 20 }}>🏗</span>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ ...labelSt, color: '#202C3C', marginBottom: 6 }}>
            PFD 패킹컬럼 태그 선택 (선택 시 현재 물질수지 스트림 유량·온도·압력·패킹 자동 적용)
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedTag}
              onChange={e => handleTagSelect(e.target.value)}
              style={{ ...sel, maxWidth: 420 }}
            >
              <option value="" style={{ background: '#F6F7F2' }}>— 장치 선택 안 함 (수동 입력) —</option>
              {(['100', '200', '300', '400', '600'] as const).map(sec => {
                const secTowers = towers.filter(t => t.section === sec);
                if (!secTowers.length) return null;
                return (
                  <optgroup key={sec} label={`${sec} Sec`} style={{ background: '#FFFFFF' }}>
                    {secTowers.map(t => (
                      <option key={t.id} value={t.tag} style={{ background: '#F6F7F2' }}>
                        {t.tag}{'  '}{t.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {selectedTag && (
              <button
                onClick={() => handleTagSelect(selectedTag)}
                style={{ ...btn('#1A2F44'), padding: '6px 12px', fontSize: 11 }}
                title="현재 운전부하(Material Balance) 기준 스트림 유량과 온도를 다시 불러옵니다"
              >
                🔄 현재 공정조건 동기화
              </button>
            )}
          </div>
          {/* 원클릭 타워 빠른 선택 버튼 (현재 선택된 공장 장치만 표시) */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {(activePlantId === 'hcl_synth'
              ? [
                  { tag: 'C-110', label: 'C-110 흑연 강하막 흡수탑(35% HCl)' },
                  { tag: 'T-130', label: 'T-130 테일가스 알칼리 제해탑' },
                  { tag: 'T-210', label: 'T-210 98% 황산 초정밀 제습탑' },
                  { tag: 'C-220', label: 'C-220 무수염산 액화·분리탑' },
                  { tag: 'C-230', label: 'C-230 5N AHCl 정제탑' },
                  { tag: 'C-310', label: 'C-310 폐염산 진공 농축탑' },
                  { tag: 'C-320', label: 'C-320 가압 공비탈기 증류탑' },
                ]
              : activePlantId === 'ech_gte'
                ? [
                    { tag: 'C-101', label: 'C-101 경질분·수분 공비탈수탑 (20단 · -0.65 kG)' },
                    { tag: 'C-102', label: 'C-102 99.9% ECH 제품 진공 정제탑 (26단 · -0.92 kG)' },
                  ]
                : activePlantId === 'cms_plant'
                  ? [
                      { tag: 'C-201', label: 'C-201 고압 무수 HCl 탈거탑 (60단 · 17.5 kG)' },
                      { tag: 'C-202', label: 'C-202 미반응 MC 순환탑 (50단 · 6.5 kG)' },
                      { tag: 'C-203', label: 'C-203 Azeo 공비·경질 분리탑 (30단)' },
                      { tag: 'C-301', label: 'C-301 고순도 MCL 정제탑 (80단 · 120 T/D)' },
                      { tag: 'C-302', label: 'C-302 CFM 정제·CTC 분리탑 (120단 · 80 T/D)' },
                    ]
                  : activePlantId === 'mdi_plant'
                    ? [
                        { tag: 'C-101', label: 'C-101 아닐린 감압 회수탑 (14단 · -0.88 kG)' },
                        { tag: 'C-301', label: 'C-301 탈포스겐 회수 스트리퍼 (14단 · 2.0 kG)' },
                        { tag: 'C-302', label: 'C-302 MCB 용매 진공 회수탑 (16단 · -0.90 kG)' },
                        { tag: 'C-401', label: "C-401 고진공 Pure 4,4'-MDI / PMDI 분별탑 (16단 · 20 mbar)" },
                      ]
                    : [
                        { tag: 'T-280', label: 'T-280 감압탈염소탑' },
                        { tag: 'T-410', label: 'T-410 Cl₂ 1차 수세탑' },
                        { tag: 'T-420', label: 'T-420 Cl₂ 2차 냉수세정탑' },
                        { tag: 'T-430', label: 'T-430 황산건조 1단(60%·테라렛)' },
                        { tag: 'T-440', label: 'T-440 황산건조 2단(91%·라시히링)' },
                        { tag: 'T-450', label: 'T-450 황산건조 3단(94%·테라렛)' },
                        { tag: 'T-610', label: 'T-610 H₂ 가성소다 제거탑' },
                        { tag: 'T-730', label: 'T-730 Hypo 제조 1차 타워' },
                        { tag: 'T-760', label: 'T-760 Hypo 제조 2차 타워' },
                      ]
            ).map(item => {
              const active = selectedTag === item.tag;
              return (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => handleTagSelect(item.tag)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    border: active ? '1px solid #1A2F44' : '1px solid #DFDCD4',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    color: active ? '#FFFFFF' : '#52525B',
                    transition: 'all 0.15s',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {streamInfo && (
            <div style={{ fontSize: 11, color: '#1A2F44', marginTop: 6 }}>
              🔗 공정 연동: {streamInfo}
            </div>
          )}
        </div>
        {selectedEquip && (
          <div style={{ fontSize: 11, color: '#52525B', minWidth: 180, borderLeft: '1px solid #DFDCD4', paddingLeft: 14 }}>
            <div style={{ color: '#202C3C', fontWeight: 700, marginBottom: 2 }}>{selectedEquip.tag}</div>
            <div style={{ color: '#27272A' }}>{selectedEquip.name}</div>
            <div style={{ color: '#3F3F46', marginTop: 2 }}>Sec. {selectedEquip.section} | {material}</div>
          </div>
        )}
      </div>

      {/* ── 📚 표 1.39 식염전해 황산탈수탑 표준 설계기준 레퍼런스 카드 (전해공장 전용) ── */}
      {isElectrolysisPlant && (
      <div style={{
        ...card,
        background: '#FAFBF8',
        border: '1px solid #CBD5E1',
        padding: '14px 18px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44' }}>
              📚 황산탈수탑 표준 설계기준 (식염전해 프로세스 기술 表 1.39 — 실측 및 계산 기준)
            </div>
            <div style={{ fontSize: 11, color: '#52525B', marginTop: 2 }}>
              Cl₂ 가스 몰유량 G_M = 40 kmol/h (2,843 kg/h), 탑 단면적 S = 1.085 m² (D = 1,175 mm), 공탑유속 U = 0.24 m/s, 충진층고 Z = 3.65 m 기준
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => applyRefTable139(1)}
              style={{ ...btn('#0F766E'), padding: '6px 12px', fontSize: 11 }}>
              ⚡ 표 1.39 No.1 건조탑 정밀예제 적용
            </button>
            <button type="button" onClick={() => applyRefTable139(2)}
              style={{ ...btn('#1D4ED8'), padding: '6px 12px', fontSize: 11 }}>
              ⚡ 표 1.39 No.2 건조탑 정밀예제 적용
            </button>
            <button type="button" onClick={() => applyRefTable139(3)}
              style={{ ...btn('#4338CA'), padding: '6px 12px', fontSize: 11 }}>
              ⚡ 표 1.39 No.3 건조탑 정밀예제 적용
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'center' }}>
            <thead>
              <tr style={{ background: '#E2E8F0', color: '#1E293B', fontWeight: 700 }}>
                <th style={{ padding: '6px 8px', border: '1px solid #CBD5E1', textAlign: 'left' }}>설계 항목 (구분)</th>
                <th style={{ padding: '6px 8px', border: '1px solid #CBD5E1' }}>단위</th>
                <th style={{ padding: '6px 8px', border: '1px solid #CBD5E1', background: '#CCFBF1' }}>No.1 건조탑 (T-430)</th>
                <th style={{ padding: '6px 8px', border: '1px solid #CBD5E1', background: '#DBEAFE' }}>No.2 건조탑 (T-440)</th>
                <th style={{ padding: '6px 8px', border: '1px solid #CBD5E1', background: '#E0E7FF' }}>No.3 건조탑 (T-450)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['[실측] Cl₂ 입구온도 / 입구수분 → 출구수분', '°C / mg/L', '21°C / 20 → 2', '- / 2 → 0.9', '- / 0.9 → 0.06'],
                ['[실측] 순환 황산(H₂SO₄) 농도 / 유량 / 온도', 'wt% / m³/h / °C', '60% / 30 / 14°C', '91% / 12 / 19°C', '94% / 12 / 21°C'],
                ['[실측] 충진재 종류 및 규격', 'mm', '1B 테라렛 (45×19)', '2B 라시히링 (50×50)', '1B 테라렛 (45×19)'],
                ['[실측] 충진층고 Z / 운전압력 P', 'm / kPa', '3.65 / 101.3', '3.65 / 101.3', '3.65 / 101.3'],
                ['[실측] 탑 압력손실 ΔP (충진부 / 다공판 目皿部)', 'mmH₂O (kPa)', '10(0.1) / 8(0.08)', '8(0.08) / 9(0.09)', '10(0.1) / 9(0.09)'],
                ['[계산] 액체 비유량 L\' / 가스 비유량 G\' / L/G', 'kg/m²·h / -', '41,160 / 2,620 (L/G=15.9)', '20,070 / 2,620 (L/G=7.7)', '20,410 / 2,620 (L/G=7.8)'],
                ['[계산] 가스 공탑유속 U / 탑 단면적 S', 'm/s / m²', '0.24 / 1.085', '0.24 / 1.085', '0.24 / 1.085'],
                ['[계산] 입구 수분 몰분율 y₁ → 출구 y₂', 'kmol-H₂O/kmol-Cl₂', '0.025 → 0.00243', '0.00243 → 0.0011', '0.0011 → 7.8×10⁻⁵'],
                ['[계산] H₂SO₄ 상 평형 수분 몰분율 yᵢ', 'kmol-H₂O/kmol-H₂SO₄', '0.00145', '6.3×10⁻⁵', '7×10⁻⁷'],
                ['[계산] 이동단위수 N_OG = ln((y₁-yᵢ)/(y₂-yᵢ))', '-', '3.18', '0.83', '2.64'],
                ['[계산] 이동단위높이 H_OG = Z / N_OG', 'm', '1.1', '4.4', '1.4'],
                ['[계산] 총괄용량계수 K_Ga = (G_M·N_OG)/(S·Z)', 'kmol-Cl₂/m³·h', '32', '8.4', '27'],
              ].map(([item, unit, v1, v2, v3], idx) => (
                <tr key={item} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                  <td style={{ padding: '5px 8px', border: '1px solid #CBD5E1', textAlign: 'left', fontWeight: 600, color: '#1E293B' }}>{item}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #CBD5E1', color: '#475569' }}>{unit}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #CBD5E1', fontWeight: 600, color: '#0F766E' }}>{v1}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #CBD5E1', fontWeight: 600, color: '#1D4ED8' }}>{v2}</td>
                  <td style={{ padding: '5px 8px', border: '1px solid #CBD5E1', fontWeight: 600, color: '#4338CA' }}>{v3}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: '#475569', marginTop: 6 }}>
          💡 <strong>설계 주기(注):</strong> 충진재의 종류(No.1·No.3 탑 <strong>1B 테라렛 H_OG=1.1~1.4m, K_Ga=27~32</strong> vs No.2 탑 <strong>2B 라시히링 H_OG=4.4m, K_Ga=8.4</strong>)에 따른 물질전달 성능 차이가 뚜렷하게 확인됩니다.
        </div>
      </div>
      )}

      {/* ── 업데이트 알림 배너 ──────────────────────────────────────── */}
      {savedNotice && (
        <div style={{
          ...card,
          background: 'rgba(74,222,128,0.10)',
          borderColor: 'rgba(74,222,128,0.35)',
          color: '#1A2F44', fontSize: 12, fontWeight: 600,
          padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{savedNotice}</span>
          <button onClick={() => setSavedNotice('')} style={{ background: 'none', border: 'none', color: '#1A2F44', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* ── 왼쪽 입력 ─────────────────────────────────────────── */}
        <div>
          {/* 운전 조건 */}
          <div style={card}>
            <div style={sectionTitle}>🏗 운전 조건 및 재질</div>
            <div style={grid2}>
              <div>
                <label style={labelSt}>운전 유형</label>
                <select value={mode} onChange={e => setMode(e.target.value as TowerMode)} style={sel}>
                  {(Object.entries(modeLabel) as [TowerMode, string][]).map(([k, v]) => (
                    <option key={k} value={k} style={{ background: '#F6F7F2' }}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>탑 본체 / 라이닝 재질</label>
                <input value={material} onChange={e => setMaterial(e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ ...grid2, marginTop: 10 }}>
              <div>
                <label style={labelSt}>운전 온도 (°C)</label>
                <input type="number" value={temp} onChange={e => setTemp(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>운전 압력 (kPa abs)</label>
                <input type="number" value={pressure} step={5} onChange={e => setPressure(+e.target.value)} style={inp} />
              </div>
            </div>
          </div>

          {/* 기체 스트림 */}
          <div style={card}>
            <div style={sectionTitle}>
              💨 기체 스트림 (Gas)
              {selectedTag && <span style={{ fontSize: 9, color: '#202C3C', marginLeft: 6 }}>(장치 연동 — 변경 가능)</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['preset', 'manual'] as FluidMode[]).map(m => (
                <button key={m} onClick={() => setGasMode(m)}
                  style={{ ...btn(m === gasMode ? '#1A2F44' : '#475569'), padding: '4px 14px', fontSize: 11 }}>
                  {m === 'preset' ? '유체 선택' : '직접 입력'}
                </button>
              ))}
            </div>
            {gasMode === 'preset' ? (
              <div style={{ marginBottom: 10 }}>
                <label style={labelSt}>기체 유체</label>
                <select value={gasFluidKey} onChange={e => setGasFluidKey(e.target.value)} style={sel}>
                  {GAS_FLUIDS.map(f => (
                    <option key={f.key} value={f.key} style={{ background: '#F6F7F2' }}>{f.nameKo} ({f.name})</option>
                  ))}
                </select>
                <div style={{ marginTop: 6, fontSize: 10, color: '#3F3F46' }}>
                  밀도: {getGasDensity().toFixed(3)} kg/m³ | 점도: {getGasVisc().toFixed(4)} mPa·s
                </div>
              </div>
            ) : (
              <div style={grid2}>
                <div>
                  <label style={labelSt}>밀도 (kg/m³)</label>
                  <input type="number" value={gasDensityManual} step={0.01}
                    onChange={e => setGasDensityManual(+e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelSt}>점도 (mPa·s)</label>
                  <input type="number" value={gasViscManual} step={0.001}
                    onChange={e => setGasViscManual(+e.target.value)} style={inp} />
                </div>
              </div>
            )}
            <div>
              <label style={labelSt}>기체 유량 (kg/h)</label>
              <input type="number" value={gasFlow} step={100}
                onChange={e => setGasFlow(+e.target.value)} style={inp} />
            </div>
          </div>

          {/* 액체 스트림 */}
          <div style={card}>
            <div style={sectionTitle}>
              💧 액체 스트림 (Liquid)
              {selectedTag && <span style={{ fontSize: 9, color: '#202C3C', marginLeft: 6 }}>(장치 연동 — 변경 가능)</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['preset', 'manual'] as FluidMode[]).map(m => (
                <button key={m} onClick={() => setLiqMode(m)}
                  style={{ ...btn(m === liqMode ? '#1A2F44' : '#475569'), padding: '4px 14px', fontSize: 11 }}>
                  {m === 'preset' ? '유체 선택' : '직접 입력'}
                </button>
              ))}
            </div>
            {liqMode === 'preset' ? (
              <div style={{ marginBottom: 10 }}>
                <label style={labelSt}>액체 유체</label>
                <select value={liqFluidKey} onChange={e => setLiqFluidKey(e.target.value)} style={sel}>
                  {LIQUID_FLUIDS.map(f => (
                    <option key={f.key} value={f.key} style={{ background: '#F6F7F2' }}>{f.nameKo}</option>
                  ))}
                </select>
                <div style={{ marginTop: 6, fontSize: 10, color: '#3F3F46' }}>
                  밀도: {getLiqDensity().toFixed(1)} kg/m³ | 점도: {getLiqVisc().toFixed(3)} mPa·s | σ: {getLiqSigma()} mN/m
                </div>
              </div>
            ) : (
              <div style={grid3}>
                <div>
                  <label style={labelSt}>밀도 (kg/m³)</label>
                  <input type="number" value={liqDensityManual}
                    onChange={e => setLiqDensityManual(+e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelSt}>점도 (mPa·s)</label>
                  <input type="number" value={liqViscManual} step={0.1}
                    onChange={e => setLiqViscManual(+e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelSt}>표면장력 (mN/m)</label>
                  <input type="number" value={liqSigmaManual}
                    onChange={e => setLiqSigmaManual(+e.target.value)} style={inp} />
                </div>
              </div>
            )}
            <div>
              <label style={labelSt}>액체 순환 유량 (kg/h)</label>
              <input type="number" value={liqFlow} step={100}
                onChange={e => setLiqFlow(+e.target.value)} style={inp} />
            </div>
          </div>
        </div>

        {/* ── 오른쪽 입력 ───────────────────────────────────────── */}
        <div>
          {/* 패킹 선택 */}
          <div style={card}>
            <div style={sectionTitle}>📦 패킹 선택</div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>패킹 종류</label>
              <select value={packingKey} onChange={e => setPackingKey(e.target.value)} style={sel}>
                {PACKING_DB.map(p => (
                  <option key={p.key} value={p.key} style={{ background: '#F6F7F2' }}>
                    {p.name} (HETP≈{p.HETP_ref}m)
                  </option>
                ))}
              </select>
              {(() => {
                const pk = PACKING_DB.find(p => p.key === packingKey);
                if (!pk) return null;
                return (
                  <div style={{ marginTop: 6, fontSize: 10, color: '#3F3F46', display: 'flex', gap: 16 }}>
                    <span>ap: {pk.ap} m²/m³</span>
                    <span>ε: {pk.voidFraction}</span>
                    <span>Fp: {pk.packingFactor} ft⁻¹</span>
                    <span>HETP ref: {pk.HETP_ref} m</span>
                  </div>
                );
              })()}
            </div>
            <div style={grid2}>
              <div>
                <label style={labelSt}>홍수점 비율 ({(floodFrac * 100).toFixed(0)}%)</label>
                <input type="range" min={0.60} max={0.85} step={0.01} value={floodFrac}
                  onChange={e => setFloodFrac(+e.target.value)}
                  style={{ width: '100%', accentColor: '#1A2F44' }} />
                <div style={{ fontSize: 10, color: '#3F3F46', marginTop: 2 }}>권장: 65~75% (표준 70%)</div>
              </div>
              <div>
                <label style={labelSt}>HETP 보정 계수</label>
                <input type="number" value={hetpCorr} step={0.05} min={0.5} max={2.0}
                  onChange={e => setHetpCorr(+e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ ...grid2, marginTop: 10 }}>
              <div>
                <label style={labelSt}>기준 공탑유속 U 지정 (m/s, 0=GPDC 자동)</label>
                <input type="number" value={targetU} step={0.01} min={0} max={3.0}
                  onChange={e => setTargetU(+e.target.value)} style={inp} />
              </div>
              <div>
                <label style={labelSt}>기준 충진층고 Z 지정 (m, 0=HETP 자동)</label>
                <input type="number" value={fixedZ} step={0.05} min={0} max={20.0}
                  onChange={e => setFixedZ(+e.target.value)} style={inp} />
              </div>
            </div>
          </div>

          {/* 분리 요구사항 */}
          <div style={card}>
            <div style={sectionTitle}>🎯 분리 요구사항 (물질전달 모델)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                { key: 'stages', label: '이론단수 직접 입력' },
                { key: 'kremser', label: 'Kremser 방정식 계산' },
                { key: 'hog', label: isElectrolysisPlant ? '표 1.39 황산탈수탑 (N_OG · H_OG · K_Ga)' : '전달단위수 모델 (N_OG · H_OG · K_Ga)' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setSeparationMode(key as 'stages' | 'kremser' | 'hog')}
                  style={{ ...btn(separationMode === key ? '#202C3C' : '#475569'), padding: '5px 12px', fontSize: 11 }}>
                  {label}
                </button>
              ))}
            </div>
            {separationMode === 'stages' && (
              <div>
                <label style={labelSt}>이론단수 (Theoretical Stages)</label>
                <input type="number" value={stages} min={1} max={30}
                  onChange={e => setStages(+e.target.value)} style={{ ...inp, width: 120 }} />
              </div>
            )}
            {separationMode === 'kremser' && (
              <div style={grid3}>
                <div>
                  <label style={labelSt}>y_in (입구 몰분율)</label>
                  <input type="number" value={yIn} step={0.001}
                    onChange={e => setYIn(+e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelSt}>y_out (출구 몰분율)</label>
                  <input type="number" value={yOut} step={0.0001}
                    onChange={e => setYOut(+e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelSt}>흡수 인자 A</label>
                  <input type="number" value={absA} step={0.1}
                    onChange={e => setAbsA(+e.target.value)} style={inp} />
                </div>
              </div>
            )}
            {separationMode === 'hog' && (
              <div>
                <div style={grid3}>
                  <div>
                    <label style={labelSt}>입구 수분 몰분율 y₁</label>
                    <input type="number" value={yIn} step={0.0001}
                      onChange={e => setYIn(+e.target.value)} style={inp} />
                  </div>
                  <div>
                    <label style={labelSt}>출구 수분 몰분율 y₂</label>
                    <input type="number" value={yOut} step={0.00001}
                      onChange={e => setYOut(+e.target.value)} style={inp} />
                  </div>
                  <div>
                    <label style={labelSt}>{isElectrolysisPlant ? '평형 수분 몰분율 yᵢ (H₂SO₄ 상)' : '평형 기상 몰분율 yᵢ*'}</label>
                    <input type="number" value={yEq} step={0.00001}
                      onChange={e => setYEq(+e.target.value)} style={inp} />
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: '#3F3F46', marginTop: 8, background: '#F8FAFC', padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  📐 <strong>{isElectrolysisPlant ? '표 1.39 물질전달 산식:' : '총괄 기상 전달단위 산식:'}</strong>{' '}
                  <code>N_OG = ln((y₁ - yᵢ) / (y₂ - yᵢ))</code> |{' '}
                  <code>H_OG = Z / N_OG</code> |{' '}
                  <code>K_Ga = (G_M · N_OG) / (S · Z) = G_M / (S · H_OG)</code>
                </div>
              </div>
            )}
          </div>

          {/* 설계 실행 및 장치목록 업데이트 버튼 */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={calculateAndSave} style={{ ...btn('#202C3C'), padding: '11px 28px', fontSize: 13 }}>
              🟣 패킹컬럼 설계 및 장치목록 업데이트
            </button>
            {results && (
              <button onClick={exportExcel} style={{ ...btn('#1A2F44'), padding: '11px 22px', fontSize: 12 }}>
                📥 Excel 데이터시트 다운로드
              </button>
            )}
          </div>
          {error && <div style={{ color: '#ef4444', fontSize: 12 }}>⚠ {error}</div>}
        </div>
      </div>

      {/* ── 결과 및 CAD 블루프린트 ────────────────────────────────── */}
      {results && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20, marginTop: 4 }}>
          <div style={{ ...card, border: '1px solid rgba(167,139,250,0.2)', background: 'rgba(167,139,250,0.04)' }}>
            <div style={{ ...sectionTitle, color: '#202C3C' }}>📋 공정 데이터시트 — 패킹타워 설계 결과</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#52525B', marginBottom: 8 }}>타워 치수 (Column Sizing)</div>
                {[
                  ['타워 직경 (계산 / 표준)', `${results.tower_diameter_mm.toFixed(0)} mm / STD ${results.tower_diameter_std_mm} mm`],
                  ['타워 단면적 (S)', `${results.crossSectionArea_m2.toFixed(3)} m²`],
                  ['패킹 충전 높이 (Z)', `${results.packingHeight_m.toFixed(2)} m`],
                  ['총 타워 높이 (H_total)', `${results.totalHeight_m.toFixed(2)} m`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
                    <span style={{ color: '#3F3F46' }}>{k}</span>
                    <span style={{ color: k.includes('표준') || k.includes('총') || k.includes('단면적') ? '#202C3C' : '#27272A', fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={grid2}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#52525B', marginBottom: 8 }}>{isElectrolysisPlant ? '물질전달 (표 1.39 기준 포함)' : '물질전달 해석 결과'}</div>
                  {[
                    ['L/G 질량비', results.L_G_ratio.toFixed(1)],
                    ['액체 비유량 (L\')', `${Math.round(results.liquidMassFlux_kgm2h).toLocaleString()} kg/m²·h`],
                    ['가스 비유량 (G\')', `${Math.round(results.gasMassFlux_kgm2h).toLocaleString()} kg/m²·h`],
                    ['가스 몰유량 (G_M)', `${results.G_M_kmolh.toFixed(1)} kmol/h`],
                    ['이동단위수 (N_OG / NTU)', results.NTU.toFixed(2)],
                    ['이동단위높이 (H_OG = Z/N_OG)', `${results.H_OG_m.toFixed(2)} m`],
                    ['총괄용량계수 (K_Ga)', `${results.K_Ga_kmolm3h.toFixed(1)} kmol/m³·h`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                      <span style={{ color: '#3F3F46' }}>{k}</span>
                      <span style={{ color: k.includes('K_Ga') || k.includes('H_OG') || k.includes('N_OG') ? '#0F766E' : '#27272A', fontWeight: k.includes('K_Ga') || k.includes('H_OG') || k.includes('N_OG') ? 700 : 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#52525B', marginBottom: 8 }}>유체역학 및 압력손실 (ΔP)</div>
                  {[
                    ['홍수점 유속 (U_flood)', `${results.u_flood_ms.toFixed(3)} m/s`],
                    ['운전 공탑유속 (U)', `${results.u_operating_ms.toFixed(2)} m/s`],
                    ['충진부 ΔP', `${results.dP_packing_mmH2O.toFixed(0)} mmH₂O (${(results.dP_packing_mmH2O / 100).toFixed(2)} kPa)`],
                    ['다공판(目皿部) ΔP', `${results.dP_supportPlate_mmH2O.toFixed(0)} mmH₂O (${(results.dP_supportPlate_mmH2O / 100).toFixed(2)} kPa)`],
                    ['탑 총 압력손실 (ΔP_total)', `${results.dP_total_kPa.toFixed(3)} kPa`],
                    ['액체 체적부하', `${results.liquidFlux_m3m2h.toFixed(2)} m³/m²·h`],
                    ['이론단수 / HETP', `${results.theoreticalStages} 단 / ${results.HETP_m.toFixed(2)} m`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                      <span style={{ color: '#3F3F46' }}>{k}</span>
                      <span style={{ color: '#27272A', fontWeight: k.includes('공탑유속') || k.includes('충진부') ? 700 : 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>📐 패킹컬럼 엔지니어링 CAD 블루프린트</div>
            {(() => {
              const pk = PACKING_DB.find(p => p.key === packingKey);
              const pkLabel = (pk?.name ?? packingKey).slice(0, 38);
              const matLabel = (material || 'FRP / PVDF').slice(0, 38);
              const dMm = results.tower_diameter_std_mm;
              const dP_mmH2O_m = (results.dP_total_kPa / Math.max(0.5, results.packingHeight_m)) * 101.97;
              return (
                <svg
                  viewBox="0 0 680 276"
                  style={{
                    width: '100%',
                    height: 'auto',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    display: 'block',
                  }}
                >
                  <defs>
                    <pattern id="ptGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#E2E8F0" strokeWidth="0.6" />
                    </pattern>
                    <pattern id="ptPack" width="12" height="12" patternUnits="userSpaceOnUse">
                      <path d="M 0 0 L 12 12 M 12 0 L 0 12" fill="none" stroke="#0284C7" strokeWidth="0.7" opacity="0.55" />
                    </pattern>
                  </defs>
                  <rect width="680" height="276" fill="url(#ptGrid)" />
                  <rect x="8" y="8" width="664" height="260" fill="none" stroke="#1E293B" strokeWidth="1.4" />

                  {/* 좌측 타워 단면도 */}
                  <ellipse cx="105" cy="54" rx="34" ry="18" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.6" />
                  <ellipse cx="105" cy="222" rx="34" ry="18" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.6" />
                  <rect x="71" y="54" width="68" height="168" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.6" />
                  {/* 패킹 충진층 */}
                  <rect x="74" y="86" width="62" height="104" fill="url(#ptPack)" stroke="#0369A1" strokeWidth="1.1" />
                  {/* 분배기 & 지지판 */}
                  <line x1="72" y1="80" x2="138" y2="80" stroke="#0284C7" strokeWidth="2" strokeDasharray="4 2" />
                  <line x1="72" y1="194" x2="138" y2="194" stroke="#334155" strokeWidth="2.2" />
                  {/* 노즐 (가스 입/출구, 액체 입/출구) */}
                  <line x1="42" y1="74" x2="71" y2="74" stroke="#0284C7" strokeWidth="2.2" />
                  <text x="20" y="77" fontSize="9.5" fontWeight="700" fill="#0369A1">L in</text>
                  <line x1="42" y1="205" x2="71" y2="205" stroke="#D97706" strokeWidth="2.2" />
                  <text x="18" y="208" fontSize="9.5" fontWeight="700" fill="#B45309">G in</text>
                  <line x1="105" y1="22" x2="105" y2="36" stroke="#D97706" strokeWidth="2.2" />
                  <text x="111" y="30" fontSize="9.5" fontWeight="700" fill="#B45309">G out</text>
                  <line x1="105" y1="240" x2="105" y2="255" stroke="#0284C7" strokeWidth="2.2" />
                  <text x="111" y="253" fontSize="9.5" fontWeight="700" fill="#0369A1">L out</text>

                  {/* 치수선 (Z, H_tot) */}
                  <line x1="156" y1="86" x2="156" y2="190" stroke="#475569" strokeWidth="1" />
                  <line x1="151" y1="86" x2="161" y2="86" stroke="#475569" strokeWidth="1" />
                  <line x1="151" y1="190" x2="161" y2="190" stroke="#475569" strokeWidth="1" />
                  <text x="163" y="142" fontSize="9.5" fontWeight="700" fill="#1E293B" fontFamily="JetBrains Mono, monospace">
                    Z={results.packingHeight_m.toFixed(2)}m
                  </text>

                  {/* 우측 설계 사양 타이틀 블록 & 데이터 */}
                  <rect x="232" y="22" width="424" height="232" rx="4" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
                  <rect x="232" y="22" width="424" height="30" rx="4" fill="#1E293B" />
                  <text x="246" y="41" fontSize="12" fontWeight="800" fill="#FFFFFF" fontFamily="JetBrains Mono, monospace">
                    PACKED COLUMN CAD : {selectedTag || 'COL-001'}
                  </text>
                  <text x="644" y="41" textAnchor="end" fontSize="10" fontWeight="700" fill="#93C5FD" fontFamily="JetBrains Mono, monospace">
                    STD Ø{dMm} mm
                  </text>

                  {[
                    ['탑 내경 (ID)', `${dMm} mm (${(dMm / 1000).toFixed(2)} m)`],
                    ['패킹 충진 높이 (Z)', `${results.packingHeight_m.toFixed(2)} m (이론 ${results.theoreticalStages} 단)`],
                    ['총 타워 높이 (H_tot)', `${results.totalHeight_m.toFixed(2)} m (HETP = ${results.HETP_m.toFixed(2)} m)`],
                    ['선정 패킹 규격', pkLabel],
                    ['운전 플러딩율', `${(floodFrac * 100).toFixed(1)}% Flooding`],
                    ['단위 차압 (ΔP/Z)', `${dP_mmH2O_m.toFixed(1)} mmH₂O/m`],
                    ['본체/라이닝 재질', matLabel],
                  ].map(([k, v], idx) => {
                    const y = 76 + idx * 25;
                    return (
                      <g key={k}>
                        {idx > 0 && <line x1="244" y1={y - 16} x2="644" y2={y - 16} stroke="#F1F5F9" strokeWidth="1" />}
                        <text x="246" y={y} fontSize="10.5" fontWeight="700" fill="#475569">
                          {k}
                        </text>
                        <text x="382" y={y} fontSize="10.8" fontWeight="700" fill="#0F172A" fontFamily="JetBrains Mono, monospace">
                          {v}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

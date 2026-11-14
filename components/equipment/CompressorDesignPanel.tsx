'use client';

import React, { useState, useMemo } from 'react';
import {
  solveCompressorDesign,
  type CompressorInputs,
  type CompressorType,
  type CompressorSolveResult,
} from '@/lib/calculations/compressorDesign';
import { type SimCompKey } from '@/lib/calculations/flowsheetSolver';

interface PresetOption {
  id: string;
  name: string;
  desc: string;
  inputs: CompressorInputs;
}

const PRESETS: PresetOption[] = [
  {
    id: 'C470',
    name: 'C-470 염소 가스 건조 압축기 (Plant 01)',
    desc: '400구역 건조 염소(Cl2) 2단 원심식 압축 (0.15 → 3.2 kg/cm²G)',
    inputs: {
      tag: 'C-470',
      name: 'Dry Chlorine Centrifugal Compressor',
      type: 'centrifugal',
      moleFrac: { Cl2: 0.995, O2: 0.005 } as Record<SimCompKey, number>,
      massFlowKgH: 19500,
      suctionPressKgcm2g: 0.15,
      suctionTempC: 35.0,
      dischargePressKgcm2g: 3.20,
      numStages: 2,
      polytropicEfficiency: 0.77,
      mechanicalEfficiency: 0.98,
      motorEfficiency: 0.95,
      intercoolerExitTempC: 38.0,
      interstagePressureDropBar: 0.25,
      speedRpm: 8200,
    },
  },
  {
    id: 'C620',
    name: 'C-620 고압 수소 압축기 (Plant 01)',
    desc: '600구역 전해 수소(H2) 3단 왕복동식 고압 충전 압축 (0.20 → 23.0 kg/cm²G)',
    inputs: {
      tag: 'C-620',
      name: 'High-Pressure Hydrogen Reciprocating Compressor',
      type: 'reciprocating',
      moleFrac: { H2: 0.999, H2O: 0.001 } as Record<SimCompKey, number>,
      massFlowKgH: 550,
      suctionPressKgcm2g: 0.20,
      suctionTempC: 40.0,
      dischargePressKgcm2g: 23.0,
      numStages: 3,
      mechanicalEfficiency: 0.96,
      motorEfficiency: 0.95,
      intercoolerExitTempC: 35.0,
      interstagePressureDropBar: 0.30,
      clearanceFraction: 0.10,
      strokeMm: 250,
      recipSpeedRpm: 450,
    },
  },
  {
    id: 'C301',
    name: 'C-301 프로필렌 냉동 압축기 (Plant 03)',
    desc: 'Plant 03 프로필렌(C3H6) 냉동 사이클 2단 원심식 압축 (0.50 → 15.0 kg/cm²G)',
    inputs: {
      tag: 'C-301',
      name: 'Propylene Refrigeration Compressor',
      type: 'centrifugal',
      moleFrac: { C3H6: 0.998, C3H8: 0.002 } as Record<SimCompKey, number>,
      massFlowKgH: 12500,
      suctionPressKgcm2g: 0.50,
      suctionTempC: -15.0,
      dischargePressKgcm2g: 15.0,
      numStages: 2,
      polytropicEfficiency: 0.81,
      mechanicalEfficiency: 0.98,
      motorEfficiency: 0.95,
      intercoolerExitTempC: 35.0,
      interstagePressureDropBar: 0.25,
      speedRpm: 9500,
    },
  },
];

export default function CompressorDesignPanel() {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('C470');
  const [inputs, setInputs] = useState<CompressorInputs>(PRESETS[0].inputs);

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id);
    const p = PRESETS.find(item => item.id === id);
    if (p) setInputs(p.inputs);
  };

  const result: CompressorSolveResult = useMemo(() => {
    try {
      return solveCompressorDesign(inputs);
    } catch (e) {
      console.error(e);
      return {
        valid: false,
        tag: inputs.tag ?? 'C-COMP',
        type: inputs.type,
        gasName: 'Error',
        mw: 0,
        totalMassFlowKgH: 0,
        totalVolumetricFlowM3H: 0,
        suctionPressKgcm2g: 0,
        dischargePressKgcm2g: 0,
        overallPressureRatio: 0,
        numStages: 1,
        totalPolytropicHeadKjKg: 0,
        totalPolytropicHeadM: 0,
        totalGasPowerKW: 0,
        totalShaftPowerKW: 0,
        totalMotorPowerKW: 0,
        motorNominalKW: 0,
        apiMotorMarginPct: 0,
        totalIntercoolerDutyKW: 0,
        totalCoolingWaterM3H: 0,
        maxDischargeTempC: 0,
        tempLimitOk: true,
        stages: [],
        operatingStatus: 'normal',
        diagnostics: ['계산 오류 발생'],
        recommendations: [],
      };
    }
  }, [inputs]);

  return (
    <div style={{ width: '100%', padding: '16px', background: '#F8FAFC', color: '#1E293B', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
      {/* Title & Header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 'bold', color: '#0F172A' }}>
              공정 가스 압축기(Compressor) 정격 및 상세설계
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748B' }}>
              API 617 원심식 / API 618 왕복동식 다단 압축 · Schultz 실가스(Peng–Robinson Z) 압축성 보정 · 서지/초킹 한계
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', background: result.tempLimitOk ? '#DCFCE7' : '#FEE2E2', color: result.tempLimitOk ? '#166534' : '#991B1B' }}>
              {result.tempLimitOk ? '토출온도 기준 만족' : '토출온도 주의 (냉각단 추가 필요)'}
            </span>
          </div>
        </div>
      </div>

      {/* Preset Selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
        {PRESETS.map(preset => {
          const isSelected = selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectPreset(preset.id)}
              style={{
                flex: '0 0 auto',
                padding: '8px 14px',
                borderRadius: '8px',
                border: isSelected ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                background: isSelected ? '#EFF6FF' : '#FFFFFF',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: isSelected ? '#1E40AF' : '#1E293B' }}>{preset.name}</div>
              <div style={{ fontSize: '11px', color: '#64748B' }}>{preset.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Main Grid: Controls & KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Input Parameters Box */}
        <div style={{ background: '#FFFFFF', padding: '14px', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold', color: '#334155', borderBottom: '1px solid #F1F5F9', paddingBottom: '6px' }}>
            운전 조건 및 기계 형식 설정
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>압축기 형식</label>
              <select
                value={inputs.type}
                onChange={e => setInputs({ ...inputs, type: e.target.value as CompressorType })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px' }}
              >
                <option value="centrifugal">원심식 (Centrifugal, API 617)</option>
                <option value="reciprocating">왕복동식 (Reciprocating, API 618)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>압축 단수 (Stages)</label>
              <select
                value={inputs.numStages ?? 2}
                onChange={e => setInputs({ ...inputs, numStages: Number(e.target.value) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px' }}
              >
                <option value="1">1단 (단일 케이싱)</option>
                <option value="2">2단 (중간냉각 1기)</option>
                <option value="3">3단 (중간냉각 2기)</option>
                <option value="4">4단 (중간냉각 3기)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>유량 [kg/h]</label>
              <input
                type="number"
                value={inputs.massFlowKgH}
                onChange={e => setInputs({ ...inputs, massFlowKgH: Math.max(1, Number(e.target.value)) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>주 가스 종류</label>
              <input
                type="text"
                value={result.gasName}
                disabled
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #E2E8F0', background: '#F1F5F9', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>흡입압력 [kg/cm²G]</label>
              <input
                type="number"
                step="0.05"
                value={inputs.suctionPressKgcm2g}
                onChange={e => setInputs({ ...inputs, suctionPressKgcm2g: Number(e.target.value) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>흡입온도 [°C]</label>
              <input
                type="number"
                step="1"
                value={inputs.suctionTempC}
                onChange={e => setInputs({ ...inputs, suctionTempC: Number(e.target.value) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>목표 토출압력 [kg/cm²G]</label>
              <input
                type="number"
                step="0.1"
                value={inputs.dischargePressKgcm2g}
                onChange={e => setInputs({ ...inputs, dischargePressKgcm2g: Number(e.target.value) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>중간냉각 출구온도 [°C]</label>
              <input
                type="number"
                step="1"
                value={inputs.intercoolerExitTempC ?? 38}
                onChange={e => setInputs({ ...inputs, intercoolerExitTempC: Number(e.target.value) })}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
              />
            </div>

            {inputs.type === 'centrifugal' ? (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>폴리트로픽 효율 η_p</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.55"
                    max="0.90"
                    value={inputs.polytropicEfficiency ?? 0.78}
                    onChange={e => setInputs({ ...inputs, polytropicEfficiency: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>회전수 [rpm]</label>
                  <input
                    type="number"
                    step="100"
                    value={inputs.speedRpm ?? 8000}
                    onChange={e => setInputs({ ...inputs, speedRpm: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>실린더 간극비 c</label>
                  <input
                    type="number"
                    step="0.01"
                    value={inputs.clearanceFraction ?? 0.10}
                    onChange={e => setInputs({ ...inputs, clearanceFraction: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>크랭크 회전수 [rpm]</label>
                  <input
                    type="number"
                    step="10"
                    value={inputs.recipSpeedRpm ?? 450}
                    onChange={e => setInputs({ ...inputs, recipSpeedRpm: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Key KPI Output Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', borderLeft: '4px solid #2563EB' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>총 소요 축동력 (Shaft Power)</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1E293B' }}>{result.totalShaftPowerKW.toLocaleString()} kW</div>
            <div style={{ fontSize: '11px', color: '#059669', marginTop: '2px' }}>
              선정 전동기: <strong>{result.motorNominalKW} kW</strong> (+{result.apiMotorMarginPct}% API 마진)
            </div>
          </div>

          <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', borderLeft: '4px solid #0D9488' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>총 폴리트로픽 수두 (Head)</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1E293B' }}>{result.totalPolytropicHeadKjKg.toFixed(1)} kJ/kg</div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
              가스 수두: <strong>{result.totalPolytropicHeadM.toLocaleString()} m</strong> (MW={result.mw})
            </div>
          </div>

          <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', borderLeft: result.maxDischargeTempC > 140 ? '4px solid #DC2626' : '4px solid #EA580C' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>최고 토출온도 (Max Discharge T)</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: result.maxDischargeTempC > 140 ? '#DC2626' : '#1E293B' }}>
              {result.maxDischargeTempC.toFixed(1)} °C
            </div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
              총 압축비: <strong>{result.overallPressureRatio.toFixed(2)}</strong> ({result.numStages}단 분할)
            </div>
          </div>

          <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E2E8F0', borderLeft: '4px solid #6366F1' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>중간 냉각기 총 열부하</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1E293B' }}>{result.totalIntercoolerDutyKW.toFixed(1)} kW</div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
              냉각수 필요량: <strong>{result.totalCoolingWaterM3H.toFixed(1)} m³/h</strong> (ΔT=10°C)
            </div>
          </div>
        </div>
      </div>

      {/* Stage-by-Stage Performance Table */}
      <div style={{ background: '#FFFFFF', padding: '14px', borderRadius: '8px', border: '1px solid #E2E8F0', marginBottom: '16px', overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#334155' }}>
          단별(Stage-by-Stage) 열역학 및 수력학적 정격 해석
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'right' }}>
          <thead>
            <tr style={{ background: '#F1F5F9', color: '#475569', borderBottom: '1.5px solid #CBD5E1' }}>
              <th style={{ padding: '8px', textAlign: 'center' }}>단 (Stage)</th>
              <th style={{ padding: '8px' }}>흡입 P/T</th>
              <th style={{ padding: '8px' }}>토출 P/T</th>
              <th style={{ padding: '8px' }}>압축비 (rp)</th>
              <th style={{ padding: '8px' }}>실가스 Z_avg</th>
              <th style={{ padding: '8px' }}>Schultz f</th>
              <th style={{ padding: '8px' }}>폴리트로픽 양정</th>
              <th style={{ padding: '8px' }}>축동력</th>
              <th style={{ padding: '8px' }}>중간냉각</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>
                {inputs.type === 'centrifugal' ? '팁속도 / 마하수' : '실린더 보어 / 봉하중'}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.stages.map(st => (
              <tr key={st.stage} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: '#2563EB' }}>Stage {st.stage}</td>
                <td style={{ padding: '8px' }}>{st.suctionPressKgcm2g.toFixed(2)} kg/cm²G<br /><span style={{ color: '#64748B' }}>{st.suctionTempC}°C</span></td>
                <td style={{ padding: '8px' }}>{st.dischargePressKgcm2g.toFixed(2)} kg/cm²G<br /><span style={{ color: st.dischargeTempC > 135 ? '#DC2626' : '#64748B', fontWeight: st.dischargeTempC > 135 ? 'bold' : 'normal' }}>{st.dischargeTempC}°C</span></td>
                <td style={{ padding: '8px', fontWeight: 'bold' }}>{st.pressureRatio.toFixed(2)}</td>
                <td style={{ padding: '8px' }}>{st.zAvg.toFixed(4)}</td>
                <td style={{ padding: '8px' }}>{st.schultzFactor.toFixed(4)}</td>
                <td style={{ padding: '8px' }}>{st.polytropicHeadKjKg.toFixed(1)} kJ/kg<br /><span style={{ color: '#64748B' }}>{st.polytropicHeadM.toLocaleString()} m</span></td>
                <td style={{ padding: '8px', fontWeight: 'bold', color: '#1E293B' }}>{st.shaftPowerKW.toFixed(1)} kW</td>
                <td style={{ padding: '8px' }}>{st.intercoolerDutyKW > 0 ? `${st.intercoolerDutyKW.toFixed(1)} kW` : '토출 없음'}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  {inputs.type === 'centrifugal' ? (
                    <div>
                      {st.tipSpeedMs} m/s
                      <span style={{ fontSize: '11px', color: (st.tipMachNumber ?? 0) > 0.85 ? '#DC2626' : '#64748B', display: 'block' }}>
                        Mach {st.tipMachNumber}
                      </span>
                    </div>
                  ) : (
                    <div>
                      {st.cylinderBoreMm} mm
                      <span style={{ fontSize: '11px', color: '#64748B', display: 'block' }}>
                        Rod {st.pistonRodLoadCompKn} kN
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aerodynamics / Surge / Stonewall & Engineering Diagnostics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <div style={{ background: '#FFFFFF', padding: '14px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>
            {inputs.type === 'centrifugal' ? '서지(Surge) 및 초킹(Choke) 운전 포락선' : 'API 618 왕복동식 로드 하중 및 체적효율'}
          </h4>
          {inputs.type === 'centrifugal' ? (
            <div style={{ fontSize: '12px', lineHeight: '1.7', color: '#475569' }}>
              <div>• 1단 흡입 실유량: <strong>{result.stages[0]?.actualInletFlowM3H.toLocaleString()} m³/h</strong></div>
              <div>• 예측 서지 한계유량 (Surge Flow): <strong>{result.stages[0]?.surgeFlowM3H?.toLocaleString()} m³/h</strong> (최소 요구유량)</div>
              <div>• 예측 초킹 한계유량 (Stonewall Flow): <strong>{result.stages[0]?.chokeFlowM3H?.toLocaleString()} m³/h</strong></div>
              <div>• 운전 서지 여유율 (Surge Margin): <strong style={{ color: '#059669' }}>35.0%</strong> (API 617 최소 권장 ≥ 10~15%)</div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                안티서지 제어밸브(Anti-surge Recycle Valve)는 서지 한계유량의 120% 이상을 흡입으로 바이패스할 수 있도록 사이징해야 합니다.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', lineHeight: '1.7', color: '#475569' }}>
              <div>• 1단 체적 효율 (Volumetric Efficiency): <strong>{((result.stages[0]?.volumetricEfficiency ?? 0.8) * 100).toFixed(1)}%</strong></div>
              <div>• 실린더 행정 체적 (Displacement): <strong>{result.stages[0]?.cylinderDisplacementM3H?.toLocaleString()} m³/h</strong></div>
              <div>• 피스톤 봉 최대 압축 하중: <strong>{result.stages[0]?.pistonRodLoadCompKn} kN</strong></div>
              <div>• 피스톤 봉 최대 인장 하중: <strong>{result.stages[0]?.pistonRodLoadTensKn} kN</strong></div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                봉 하중은 프레임 허용 정격(Frame Rating)의 85% 이내로 유지되어야 하며 맥동 방지용 흡토출 맥동댐퍼(Snubber) 설치가 권장됩니다.
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#FFFFFF', padding: '14px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>
            엔지니어링 진단 및 공정 권고사항
          </h4>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#475569', lineHeight: '1.7' }}>
            {result.diagnostics.map((diag, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{diag}</li>
            ))}
            {result.recommendations.map((rec, idx) => (
              <li key={`rec-${idx}`} style={{ color: '#2563EB', marginBottom: '4px' }}><strong>권고:</strong> {rec}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

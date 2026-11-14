'use client';
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { StreamData, UnitOpBlockResult } from '@/lib/calculations/streams';
import { ElectrolyzerInputs, ElectrolyzerOutputs } from '@/lib/calculations/electrolyzer';

// ── 섹션 메타 ──────────────────────────────────────────────────────────────
const SECTION_META: Record<string, { label: string; color: string; bg: string }> = {
  '100': { label: '100 Sec — Brine Purification (염수 포화·정제)',  color: '#1A2F44', bg: 'rgba(74,222,128,0.06)' },
  '200': { label: '200 Sec — Electrolysis & Dechlorination (전해·탈염소)', color: '#1A2F44', bg: 'rgba(96,165,250,0.06)' },
  '300': { label: '300 Sec — NaOH Evaporation (3중효용 농축)',   color: '#1A2F44', bg: 'rgba(249,115,22,0.06)'  },
  '400': { label: '400 Sec — Cl₂ Processing (염소 냉각·건조·액화)', color: '#1A2F44', bg: 'rgba(0,212,255,0.06)'   },
  '600': { label: '600 Sec — H₂ Processing (수소 냉각·압축·제습)',  color: '#202C3C', bg: 'rgba(167,139,250,0.06)' },
};

const COMP_LABELS: Record<string, string> = {
  NaCl: 'NaCl', H2O: 'H₂O', NaOH: 'NaOH',
  Cl2: 'Cl₂', H2: 'H₂', HCl: 'HCl',
  O2: 'O₂', H2SO4: 'H₂SO₄', BaCl2: 'BaCl₂', Na2SO3: 'Na₂SO₃', Na2CO3: 'Na₂CO₃',
};

const ALL_COMPS = ['NaCl', 'H2O', 'NaOH', 'Cl2', 'H2', 'HCl', 'O2', 'H2SO4', 'BaCl2', 'Na2SO3', 'Na2CO3'];

const PHASE_COLOR: Record<string, string> = {
  L: '#1A2F44', G: '#0F5338', 'L/G': '#7C2D12',
};

function fmt(v: number | undefined, dec = 0): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtFlow(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} t/h`;
  return `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} kg/h`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW 0 : ⚡ 공정 시뮬레이션 (전해조 1기 vs ×5기 + 섹션별 유닛·컬럼 열/물질수지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ProcessUnitSimulationView({
  elec,
  unitBlocks,
  numElectrolyzers,
  inputs,
}: {
  elec: ElectrolyzerOutputs;
  unitBlocks: UnitOpBlockResult[];
  numElectrolyzers: number;
  inputs: ElectrolyzerInputs;
}) {
  const pu = elec.perUnit;
  const N = numElectrolyzers;
  const drag = useDragScroll();

  const anodeTempC    = inputs.anodeTempC ?? 87.0;
  const cathodeTempC  = inputs.cathodeTempC ?? 90.0;
  const anodePressG   = inputs.anodePressKgcm2g ?? 0.40;
  const cathodePressG = inputs.cathodePressKgcm2g ?? 0.45;
  const deltaPKgcm2   = cathodePressG - anodePressG;
  const deltaPMmH2O   = deltaPKgcm2 * 10000;

  const SECTION_ORDER: Array<'100' | '200' | '300' | '400' | '600'> = ['100', '200', '300', '400', '600'];

  return (
    <div
      ref={drag.ref}
      onMouseDown={drag.onMouseDown}
      onMouseMove={drag.onMouseMove}
      onMouseUp={drag.onMouseUp}
      onMouseLeave={drag.onMouseLeave}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '14px 18px 28px',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      {/* 1. 전해조 단일기(1기: D-210/D-220) vs 5기 합산 헤더(×5) 전기화학·열·물질수지 */}
      <div style={{ background: '#FFFFFF', border: '1px solid #DFDCD4', borderRadius: 10, marginBottom: 18, minWidth: 980 }}>
        <div style={{
          padding: '10px 16px', background: '#1A2F44', color: '#FFFFFF', borderRadius: '9px 9px 0 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              ⚡ Block 1: EL-200 이온교환막 전해조 &amp; 기액분리기 (D-210 양극 / D-220 음극) — 1기당 vs ×{N}기 공통 헤더 물질·전력 수지
            </span>
            <div style={{ fontSize: 10.5, color: '#D0D7DE', marginTop: 2 }}>
              각 전해조(EL-200)마다 개별 D-210(양극 Cl₂ 분리기)·D-220(음극 H₂ 분리기)이 설치되며, 가스 헤더([220]/[221]) 및 순환조(D-240/D-250)에서 ×{N}배 합산됩니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            <span style={{ background: 'rgba(255,255,255,0.14)', padding: '3px 9px', borderRadius: 6 }}>
              V_cell = {elec.cellVoltageV.toFixed(2)} V
            </span>
            <span style={{ background: 'rgba(255,255,255,0.14)', padding: '3px 9px', borderRadius: 6 }}>
              DC 전력 = {elec.totalDcPowerMW.toFixed(2)} MW ({elec.specificEnergyKWhPerTonCl2.toFixed(0)} kWh/t-Cl₂)
            </span>
            <span style={{ background: 'rgba(255,255,255,0.14)', padding: '3px 9px', borderRadius: 6 }}>
              막 차압 ΔP(D220-D210) = {deltaPKgcm2 >= 0 ? '+' : ''}{deltaPKgcm2.toFixed(2)} kg/cm² ({deltaPMmH2O >= 0 ? '+' : ''}{deltaPMmH2O.toFixed(0)} mmH₂O)
            </span>
            <span style={{ background: 'rgba(255,255,255,0.14)', padding: '3px 9px', borderRadius: 6 }}>
              막 수분이동수 t_H₂O = {pu.transportNumberH2O.toFixed(2)} mol H₂O/mol Na⁺
            </span>
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#F6F7F2', borderBottom: '2px solid #DFDCD4' }}>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#1A2F44', fontWeight: 800, whiteSpace: 'nowrap' }}>구분 / 스트림 번호</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#1A2F44', fontWeight: 800, whiteSpace: 'nowrap' }}>역할 및 전기화학/상평형 메커니즘</th>
                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#1A2F44', fontWeight: 800, whiteSpace: 'nowrap' }}>전해조 1기당 (1 Unit)</th>
                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#0F5338', fontWeight: 800, whiteSpace: 'nowrap' }}>×{N}기 공통 헤더 합산 (Total)</th>
                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#5A6570', fontWeight: 800, whiteSpace: 'nowrap' }}>농도 / 온도·압력 조건</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  tag: '[104] 정제 브라인 공급 (P-174A/B)',
                  desc: '100 Sec 킬레이트 수지탑(T-160) 출구 포화 정제염수',
                  u: `NaCl ${fmt(pu.freshBrine104_NaCl_KgH, 1)} + H₂O ${fmt(pu.freshBrine104_H2O_KgH, 1)} = ${fmt(pu.freshBrine104_NaCl_KgH + pu.freshBrine104_H2O_KgH, 1)} kg/h`,
                  t: `NaCl ${fmt(pu.freshBrine104_NaCl_KgH * N, 0)} + H₂O ${fmt(pu.freshBrine104_H2O_KgH * N, 0)} = ${fmt((pu.freshBrine104_NaCl_KgH + pu.freshBrine104_H2O_KgH) * N, 0)} kg/h`,
                  cond: `${fmt(pu.freshBrine104_NaCl_KgH / (pu.freshBrine104_NaCl_KgH + pu.freshBrine104_H2O_KgH) * 100, 2)} wt% NaCl · ${(inputs.brineFeedTempC ?? 60).toFixed(1)}°C`,
                },
                {
                  tag: '[208] 양극액 내부 재순환 (P-244A/B)',
                  desc: 'D-240 → P-244A/B → FCV-240 양극 입구 혼합 순환',
                  u: `NaCl ${fmt(pu.recircAnolyte208_NaCl_KgH, 1)} + H₂O ${fmt(pu.recircAnolyte208_H2O_KgH, 1)} = ${fmt(pu.recircAnolyte208_NaCl_KgH + pu.recircAnolyte208_H2O_KgH, 1)} kg/h`,
                  t: `NaCl ${fmt(pu.recircAnolyte208_NaCl_KgH * N, 0)} + H₂O ${fmt(pu.recircAnolyte208_H2O_KgH * N, 0)} = ${fmt((pu.recircAnolyte208_NaCl_KgH + pu.recircAnolyte208_H2O_KgH) * N, 0)} kg/h`,
                  cond: `${fmt(pu.d210LiqOut202_ConcWt, 2)} wt% NaCl · ${cathodeTempC.toFixed(1)}°C`,
                },
                {
                  tag: '[201] + [204] 전해조 양극 입구 (FCV-231/212)',
                  desc: '정제염수 + 순환양극액 + 30% HCl 산성화 투입',
                  u: `NaCl ${fmt(pu.anodeInlet201_NaCl_KgH, 1)} + H₂O ${fmt(pu.anodeInlet201_H2O_KgH, 1)} (+HCl ${fmt(pu.hclFeed204_HCl_KgH + pu.hclFeed204_H2O_KgH, 0)}) kg/h`,
                  t: `총 ${fmt((pu.anodeInlet201_NaCl_KgH + pu.anodeInlet201_H2O_KgH) * N, 0)} kg/h (+HCl ${fmt((pu.hclFeed204_HCl_KgH + pu.hclFeed204_H2O_KgH) * N, 0)} kg/h)`,
                  cond: `${fmt(pu.anodeInlet201_ConcWt, 2)} wt% NaCl · 66.0°C`,
                },
                {
                  tag: '⚡ 양극 전기화학 반응 & 막 수분이동',
                  desc: '2NaCl → Cl₂↑ + 2Na⁺ + 2e⁻ / Na⁺ 수화물 이온교환막 통과',
                  u: `NaCl 분해 -${fmt(pu.naclConsumedKgH, 1)} kg/h · 막 수분이동 -${fmt(pu.waterElectroOsmoticKgH, 1)} kg/h`,
                  t: `NaCl 분해 -${fmt(elec.naclConsumptionKgH, 0)} kg/h · 막 수분이동 -${fmt(elec.waterToMembraneKgH, 0)} kg/h`,
                  cond: `I = ${pu.currentKA} kA × ${pu.cells}셀 × ${N}기`,
                },
                {
                  tag: '[203] → [220] D-210 Cl₂ 기상 (양극분리기 → 헤더)',
                  desc: 'D-210 양극 기액분리기 기액평형(VLE) 습윤 염소가스',
                  u: `[203] Cl₂ ${fmt(pu.d210GasOut203_Cl2_KgH, 1)} + H₂O ${fmt(pu.d210GasOut203_H2O_KgH, 1)} = ${fmt(pu.d210GasOut203_Cl2_KgH + pu.d210GasOut203_H2O_KgH, 1)} kg/h`,
                  t: `[220] Cl₂ ${fmt(elec.cl2ProductionKgH, 0)} + H₂O ${fmt(pu.d210GasOut203_H2O_KgH * N, 0)} = ${fmt((pu.d210GasOut203_Cl2_KgH + pu.d210GasOut203_H2O_KgH) * N, 0)} kg/h`,
                  cond: `D-210: ${anodeTempC.toFixed(1)}°C · ${anodePressG.toFixed(2)} kg/cm²G`,
                },
                {
                  tag: '[202] → [202a]/[218] D-210 묽은 브라인 (양극분리기 하부)',
                  desc: '~25% 염수가 반응 후 ~18% (17.45%) 묽은 염수로 배출 → D-240 합산',
                  u: `[202] NaCl ${fmt(pu.d210LiqOut202_NaCl_KgH, 1)} + H₂O ${fmt(pu.d210LiqOut202_H2O_KgH, 1)} = ${fmt(pu.d210LiqOut202_NaCl_KgH + pu.d210LiqOut202_H2O_KgH, 1)} kg/h`,
                  t: `[202a] 총 ${fmt((pu.d210LiqOut202_NaCl_KgH + pu.d210LiqOut202_H2O_KgH) * N, 0)} kg/h (탈염소행 [218]: ${fmt(((pu.freshBrine104_NaCl_KgH - pu.naclConsumedKgH) + (pu.freshBrine104_H2O_KgH + pu.hclFeed204_H2O_KgH - pu.waterElectroOsmoticKgH - pu.d210GasOut203_H2O_KgH)) * N, 0)} kg/h)`,
                  cond: `${fmt(pu.d210LiqOut202_ConcWt, 2)} wt% NaCl · ${anodeTempC.toFixed(1)}°C`,
                },
                {
                  tag: '[213]/[217] + [209] 음극 순환액 & 순수(SPW) 투입',
                  desc: 'D-250/P-254A/B 순환 가성소다 + 32% 농도 맞춤용 순수(SPW)',
                  u: `[213] ${fmt(pu.cathodeInlet213_NaOH_KgH + pu.cathodeInlet213_H2O_KgH, 0)} kg/h + SPW ${fmt(pu.spwDilution209_H2O_KgH, 1)} kg/h`,
                  t: `[217] ${fmt((pu.cathodeInlet213_NaOH_KgH + pu.cathodeInlet213_H2O_KgH) * N, 0)} kg/h + [209] SPW ${fmt(pu.spwDilution209_H2O_KgH * N, 0)} kg/h`,
                  cond: `E-223 냉각 후 85.0°C 인입`,
                },
                {
                  tag: '[212] → [221] D-220 H₂ 기상 (음극분리기 → 헤더)',
                  desc: '2H₂O + 2e⁻ → H₂↑ + 2OH⁻ (D-220 음극 기액분리기 VLE 수증기 동반)',
                  u: `[212] H₂ ${fmt(pu.d220GasOut212_H2_KgH, 2)} + H₂O ${fmt(pu.d220GasOut212_H2O_KgH, 1)} = ${fmt(pu.d220GasOut212_H2_KgH + pu.d220GasOut212_H2O_KgH, 1)} kg/h`,
                  t: `[221] H₂ ${fmt(elec.h2ProductionKgH, 1)} + H₂O ${fmt(pu.d220GasOut212_H2O_KgH * N, 0)} = ${fmt((pu.d220GasOut212_H2_KgH + pu.d220GasOut212_H2O_KgH) * N, 0)} kg/h`,
                  cond: `D-220: ${cathodeTempC.toFixed(1)}°C · ${cathodePressG.toFixed(2)} kg/cm²G`,
                },
                {
                  tag: '[211] → [219] D-220 32% 가성소다 제품 (D-220 → D-250 → D-310)',
                  desc: '생성 NaOH + 막 이동수 + SPW → 32% 가성소다 배출 → 300 Sec 농축공정',
                  u: `생성 NaOH ${fmt(pu.naohGeneratedKgH, 1)} kg/h (용액 ${fmt(pu.naohGeneratedKgH / (pu.d220LiqOut_ConcWt / 100), 1)} kg/h)`,
                  t: `[219] NaOH ${fmt(elec.naohProductionKgH, 0)} + H₂O ${fmt(elec.naohProductionKgH * (1 - pu.d220LiqOut_ConcWt / 100) / (pu.d220LiqOut_ConcWt / 100), 0)} = ${fmt(elec.naohProductionKgH / (pu.d220LiqOut_ConcWt / 100), 0)} kg/h`,
                  cond: `${fmt(pu.d220LiqOut_ConcWt, 2)} wt% NaOH · ${cathodeTempC.toFixed(1)}°C`,
                },
              ].map((r, i) => (
                <tr key={r.tag} style={{ borderBottom: '1px solid #EFECE5', background: i % 2 === 1 ? '#FAF9F5' : '#FFFFFF' }}>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#1A2F44', whiteSpace: 'nowrap' }}>{r.tag}</td>
                  <td style={{ padding: '7px 10px', color: '#2C353E' }}>{r.desc}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#1A2F44', whiteSpace: 'nowrap' }}>{r.u}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#0F5338', whiteSpace: 'nowrap' }}>{r.t}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#5A6570', whiteSpace: 'nowrap' }}>{r.cond}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. 섹션별(100~600 Sec) 컬럼·냉각기·건조탑·압축기 온도/압력 조건별 수분 제거량 및 냉각 필요 열량 시뮬레이션 테이블 */}
      <div style={{ background: '#FFFFFF', border: '1px solid #DFDCD4', borderRadius: 10, minWidth: 980 }}>
        <div style={{
          padding: '10px 16px', background: '#202C3C', color: '#FFFFFF', borderRadius: '9px 9px 0 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              🌡️ Block 2: 섹션별(100~600 Sec) 컬럼·열교환기·건조탑 조건에 따른 수분·염소 제거량 및 냉각 열량 시뮬레이션
            </span>
            <div style={{ fontSize: 10.5, color: '#D0D7DE', marginTop: 2 }}>
              온도·압력·농도 변경 시 Antoine 증기압 + 전해질 수분 활동도(a_w) 기액평형(VLE) 및 엔탈피 수지에 의해 응축수량과 냉각열량(Q)이 실시간 재계산됩니다.
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#F6F7F2', borderBottom: '2px solid #DFDCD4' }}>
                {['유닛 태그 (Tag)', '장치명 / 단위공정 해석 모델', '연결 스트림', '온도 / 압력 조건', '수분·Cl₂ 제거량', '현열 (kcal/h)', '잠열·희석열 (kcal/h)', '총 열부하 (Q)', '냉각매체 / 유량', '설계 시뮬레이션 요약'].map((h, i) => (
                  <th key={h} style={{
                    padding: '7px 8px',
                    textAlign: i >= 3 && i <= 8 ? 'right' : 'left',
                    color: '#1A2F44', fontWeight: 800, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map(sec => {
                const secBlocks = unitBlocks.filter(b => b.section === sec);
                if (secBlocks.length === 0) return null;
                const meta = SECTION_META[sec];
                return (
                  <React.Fragment key={sec}>
                    <tr style={{ background: '#EFECE5', borderTop: '1.5px solid #D5D2C8', borderBottom: '1px solid #D5D2C8' }}>
                      <td colSpan={10} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 800, color: meta.color }}>
                        ■ {meta.label}
                      </td>
                    </tr>
                    {secBlocks.map((b, i) => (
                      <tr key={b.id} style={{ borderBottom: '1px solid #EFECE5', background: i % 2 === 1 ? '#FAF9F5' : '#FFFFFF' }}>
                        <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                          <div>{b.id}</div>
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#EFECE5', color: '#5A6570' }}>{b.section} Sec</span>
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <div style={{ fontWeight: 700, color: '#1A2F44' }}>{b.name}</div>
                          <div style={{ fontSize: 9.5, color: '#5A6570', fontFamily: 'JetBrains Mono, monospace' }}>{b.simBlockType}</div>
                        </td>
                        <td style={{ padding: '8px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#2C353E', whiteSpace: 'nowrap' }}>
                          <div>In: [{b.inletStreams.join('],[')}]</div>
                          <div>Out: [{b.outletStreams.join('],[')}]</div>
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#1A2F44' }}>{b.tempInC.toFixed(1)} → {b.tempOutC.toFixed(1)} °C</div>
                          <div style={{ fontSize: 9.5, color: '#5A6570' }}>{b.pressKgcm2g.toFixed(2)} kg/cm²G</div>
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                          {b.waterRemovedKgH !== undefined && b.waterRemovedKgH > 0 && (
                            <div style={{ color: '#0F5338', fontWeight: 700 }}>H₂O: -{fmt(b.waterRemovedKgH, 1)} kg/h</div>
                          )}
                          {b.cl2RemovedKgH !== undefined && b.cl2RemovedKgH > 0 && (
                            <div style={{ color: '#7C2D12', fontWeight: 700 }}>Cl₂: -{fmt(b.cl2RemovedKgH, 1)} kg/h</div>
                          )}
                          {!b.waterRemovedKgH && !b.cl2RemovedKgH && '—'}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#52525B', whiteSpace: 'nowrap' }}>
                          {fmt(b.sensibleHeatKcalH, 0)}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#52525B', whiteSpace: 'nowrap' }}>
                          {fmt(b.latentOrDilutionHeatKcalH, 0)}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 800, color: '#1A2F44' }}>{fmt(b.totalHeatDutyKcalH, 0)} kcal/h</div>
                          <div style={{ fontSize: 9.5, color: '#5A6570' }}>({fmt(b.totalHeatDutyKW, 1)} kW)</div>
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, whiteSpace: 'nowrap' }}>
                          <div style={{ color: '#1A2F44', fontWeight: 600 }}>{b.coolingMedium ?? '—'}</div>
                          {b.coolingFlowM3H !== undefined && (
                            <div style={{ color: '#0F5338', fontWeight: 700 }}>{fmt(b.coolingFlowM3H, 1)} m³/h</div>
                          )}
                        </td>
                        <td style={{ padding: '8px 8px', fontSize: 10, color: '#2C353E', maxWidth: 280 }}>
                          {b.keySpecSummary}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW A : 카드/섹션별 보기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StreamRow({ s, color }: { s: StreamData; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const comps = Object.entries(s.components ?? {})
    .filter(([, v]) => v && (v as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number));
  const total = s.total_kgh ?? 0;

  return (
    <>
      <tr
        onClick={() => setExpanded(x => !x)}
        style={{ cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#F6F7F2')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color, letterSpacing: 0.5 }}>[{s.id}]</span>
          {s.isPerUnit && (
            <span style={{ marginLeft: 5, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#E0F2FE', color: '#0369A1', fontWeight: 700 }}>
              1기당
            </span>
          )}
        </td>
        <td style={{ padding: '7px 8px', fontSize: 11, color: 'var(--text-primary)', maxWidth: 230 }}>
          <div style={{ fontWeight: 600 }}>{s.name}</div>
          {s.description && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{s.description}</div>}
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          <div>{fmtFlow(total)}</div>
          {s.molarFlow_kmolh !== undefined && <div style={{ fontSize: 9, color: '#7A7872' }}>{fmt(s.molarFlow_kmolh, 1)} kmol/h</div>}
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#1A2F44', whiteSpace: 'nowrap' }}>
          {s.temperature_C !== undefined ? `${fmt(s.temperature_C, 1)} °C` : '—'}
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#52525B', whiteSpace: 'nowrap' }}>
          {s.pressure_kgcm2g !== undefined ? `${fmt(s.pressure_kgcm2g, 2)}` : '—'}
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#52525B', whiteSpace: 'nowrap' }}>
          <div>{s.density_kgm3 !== undefined ? `${fmt(s.density_kgm3, s.phase === 'G' ? 2 : 0)}` : '—'}</div>
          {s.volFlow_m3h !== undefined && <div style={{ fontSize: 9, color: '#7A7872' }}>{fmt(s.volFlow_m3h, 1)} m³/h</div>}
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B', background: `${PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B'}18`, border: `1px solid ${PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B'}44`, borderRadius: 4, padding: '1px 6px', fontFamily: 'JetBrains Mono, monospace' }}>
            {s.phase ?? 'L'}
          </span>
        </td>
        <td style={{ padding: '7px 8px', fontSize: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {comps.slice(0, 3).map(([k, v]) => (
              <span key={k} style={{ background: '#EFECE5', border: '1px solid #DFDCD4', borderRadius: 3, padding: '1px 5px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                {COMP_LABELS[k] ?? k}: {fmtFlow(v as number)}
              </span>
            ))}
            {comps.length > 3 && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>+{comps.length - 3}종</span>}
          </div>
        </td>
        <td style={{ padding: '7px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr>
          <td />
          <td colSpan={8} style={{ padding: '0 8px 10px 8px' }}>
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E2DC', borderRadius: 6, padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 20px' }}>
              {comps.map(([k, v]) => {
                const pct = total > 0 ? ((v as number) / total) * 100 : 0;
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 52, fontFamily: 'JetBrains Mono, monospace' }}>{COMP_LABELS[k] ?? k}</span>
                    <div style={{ flex: 1, height: 4, background: '#EFECE5', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', minWidth: 80, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtFlow(v as number)}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 42, textAlign: 'right' }}>{fmt(pct, 2)}%</span>
                  </div>
                );
              })}
              <div style={{ gridColumn: '1 / -1', marginTop: 6, paddingTop: 6, borderTop: '1px solid #EFECE5', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 10 }}>
                {[
                  { k: '질량유량', v: fmtFlow(s.total_kgh) },
                  { k: '몰유량', v: s.molarFlow_kmolh !== undefined ? `${fmt(s.molarFlow_kmolh, 2)} kmol/h` : undefined },
                  { k: '부피유량', v: s.volFlow_m3h !== undefined ? `${fmt(s.volFlow_m3h, 2)} m³/h` : undefined },
                  { k: '평균분자량', v: s.avgMW !== undefined ? `${fmt(s.avgMW, 2)} g/mol` : undefined },
                  { k: '온도', v: s.temperature_C !== undefined ? `${fmt(s.temperature_C, 1)} °C` : undefined },
                  { k: '압력', v: s.pressure_kgcm2g !== undefined ? `${fmt(s.pressure_kgcm2g, 2)} kg/cm²G` : undefined },
                  { k: '밀도', v: s.density_kgm3 !== undefined ? `${fmt(s.density_kgm3, s.phase === 'G' ? 3 : 1)} kg/m³` : undefined },
                  { k: '비열 Cp', v: s.cp_kcalKgC !== undefined ? `${fmt(s.cp_kcalKgC, 3)} kcal/kg·°C` : undefined },
                  { k: '엔탈피 유량', v: s.enthalpyFlow_Mcalh !== undefined ? `${fmt(s.enthalpyFlow_Mcalh, 1)} Mcal/h` : undefined },
                  { k: '농도', v: s.concentration !== undefined ? `${fmt(s.concentration, 2)} wt%` : undefined },
                  { k: '수분함량', v: s.moisturePpm !== undefined ? `${fmt(s.moisturePpm, 2)} ppm` : undefined },
                ].filter(r => r.v).map(r => (
                  <div key={r.k} style={{ display: 'flex', gap: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.k}:</span>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SectionBlock({ section, streams }: { section: string; streams: StreamData[] }) {
  const meta = SECTION_META[section] ?? { label: section, color: '#52525B', bg: '#FFFFFF' };
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ marginBottom: 24 }}>
      <div onClick={() => setCollapsed(x => !x)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: meta.bg, border: `1px solid ${meta.color}22`, borderRadius: collapsed ? 8 : '8px 8px 0 0', borderBottom: collapsed ? undefined : 'none', userSelect: 'none' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, flex: 1 }}>{meta.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{streams.length}개 스트림</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div style={{ border: `1px solid ${meta.color}22`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E2DC' }}>
                {['스트림 No.','스트림명','유량 (질량/몰)','온도','압력 (kg/cm²G)','밀도 / 부피유량','상','조성 (주요)',''].map((h, i) => (
                  <th key={i} style={{ padding: '6px 8px', textAlign: i >= 2 && i <= 5 ? 'right' : i === 6 ? 'center' : 'left', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streams.map(s => <StreamRow key={s.id} s={s} color={meta.color} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 드래그 스크롤 훅
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX    = useRef(0);
  const startY    = useRef(0);
  const scrollLeft = useRef(0);
  const scrollTop  = useRef(0);
  const moved      = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
    isDragging.current = true;
    moved.current      = false;
    startX.current     = e.clientX;
    startY.current     = e.clientY;
    scrollLeft.current = ref.current?.scrollLeft ?? 0;
    scrollTop.current  = ref.current?.scrollTop  ?? 0;
    if (ref.current) ref.current.style.cursor = 'grabbing';
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current || !ref.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    ref.current.scrollLeft = scrollLeft.current - dx;
    ref.current.scrollTop  = scrollTop.current  - dy;
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
    if (ref.current) ref.current.style.cursor = 'grab';
  }, []);

  const onMouseLeave = useCallback(() => {
    isDragging.current = false;
    if (ref.current) ref.current.style.cursor = 'grab';
  }, []);

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW B : PFD 스트림 시트 형식
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PFDSheetView({ streams }: { streams: StreamData[] }) {
  const SECTION_ORDER = ['100', '200', '300', '400', '600'];
  const bySection = useMemo(() => {
    const map: Record<string, StreamData[]> = {};
    SECTION_ORDER.forEach(s => { map[s] = []; });
    streams.forEach(s => {
      const sec = s.section ?? 'etc';
      if (!map[sec]) map[sec] = [];
      map[sec].push(s);
    });
    SECTION_ORDER.forEach(sec => {
      map[sec].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    });
    return map;
  }, [streams]);

  const activeComps = useMemo(() =>
    ALL_COMPS.filter(c => streams.some(s => (s.components?.[c as keyof typeof s.components] ?? 0) > 0)),
    [streams]
  );

  const LABEL_W = 190;
  const UNIT_W  = 92;
  const COL_W   = 92;

  const thBase: React.CSSProperties = {
    padding: '0 6px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 700, fontSize: 10,
    whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 3,
    background: 'var(--bg-surface)',
    borderBottom: '2px solid #DFDCD4',
  };

  const tdLabel: React.CSSProperties = {
    position: 'sticky', left: 0, zIndex: 2,
    background: 'var(--bg-elevated)',
    borderRight: '1px solid #E5E2DC',
    padding: '5px 10px',
    fontSize: 10, fontWeight: 600,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    minWidth: LABEL_W,
  };

  const tdUnit: React.CSSProperties = {
    position: 'sticky', left: LABEL_W, zIndex: 2,
    background: 'var(--bg-elevated)',
    borderRight: '2px solid #DFDCD4',
    padding: '5px 8px',
    fontSize: 9, color: 'var(--text-muted)',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap',
    minWidth: UNIT_W,
  };

  const tdVal = (color?: string): React.CSSProperties => ({
    padding: '5px 8px',
    textAlign: 'right' as const,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    color: color ?? 'var(--text-primary)',
    whiteSpace: 'nowrap',
    borderRight: '1px solid #F6F7F2',
    minWidth: COL_W,
  });

  const rowStripe = (i: number): React.CSSProperties =>
    i % 2 === 0 ? {} : { background: 'rgba(26,47,68,0.02)' };

  const orderedStreams = SECTION_ORDER.flatMap(sec => bySection[sec] ?? []);

  const sectionStartIdx: Record<string, number> = {};
  let idx = 0;
  SECTION_ORDER.forEach(sec => {
    sectionStartIdx[sec] = idx;
    idx += bySection[sec]?.length ?? 0;
  });

  const drag = useDragScroll();

  return (
    <div
      ref={drag.ref}
      onMouseDown={drag.onMouseDown}
      onMouseMove={drag.onMouseMove}
      onMouseUp={drag.onMouseUp}
      onMouseLeave={drag.onMouseLeave}
      style={{
        flex: 1,
        overflow: 'auto',
        position: 'relative',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...thBase, position: 'sticky', left: 0, zIndex: 4, width: LABEL_W, textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', borderRight: '1px solid #E5E2DC' }}>스트림 물성 / 항목</th>
            <th style={{ ...thBase, position: 'sticky', left: LABEL_W, zIndex: 4, width: UNIT_W, textAlign: 'right', padding: '8px 8px', color: 'var(--text-muted)', borderRight: '2px solid #DFDCD4' }}>단위</th>
            {SECTION_ORDER.map(sec => {
              const sStreams = bySection[sec] ?? [];
              if (sStreams.length === 0) return null;
              const meta = SECTION_META[sec] ?? { color: '#52525B', label: sec };
              return (
                <th
                  key={sec}
                  colSpan={sStreams.length}
                  style={{
                    ...thBase,
                    textAlign: 'center',
                    color: meta.color,
                    background: `${meta.color}12`,
                    borderLeft: `2px solid ${meta.color}44`,
                    borderRight: `2px solid ${meta.color}44`,
                    padding: '5px 6px',
                  }}
                >
                  {meta.label}
                </th>
              );
            })}
          </tr>
          <tr>
            <th style={{ ...thBase, position: 'sticky', left: 0, zIndex: 4, width: LABEL_W, background: 'var(--bg-surface)', borderRight: '1px solid #E5E2DC', height: 36 }} />
            <th style={{ ...thBase, position: 'sticky', left: LABEL_W, zIndex: 4, width: UNIT_W, background: 'var(--bg-surface)', borderRight: '2px solid #DFDCD4', height: 36 }} />
            {orderedStreams.map((s, i) => {
              const meta = SECTION_META[s.section] ?? { color: '#52525B' };
              const isFirstInSec = Object.values(sectionStartIdx).includes(i);
              return (
                <th key={s.id} style={{
                  ...thBase,
                  textAlign: 'center',
                  color: meta.color,
                  width: COL_W,
                  borderLeft: isFirstInSec ? `2px solid ${meta.color}44` : '1px solid #EFECE5',
                  padding: '4px 4px',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>[{s.id}]</div>
                  {s.isPerUnit && <div style={{ fontSize: 8, color: '#0369A1', fontWeight: 700 }}>1기당 (×5 전)</div>}
                </th>
              );
            })}
          </tr>
          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
            <td style={{ ...tdLabel, fontSize: 9, fontStyle: 'italic', color: 'var(--text-muted)' }}>Stream Name</td>
            <td style={tdUnit} />
            {orderedStreams.map((s, i) => {
              const meta = SECTION_META[s.section] ?? { color: '#52525B' };
              const isFirstInSec = Object.values(sectionStartIdx).includes(i);
              return (
                <td key={s.id} title={s.description} style={{
                  ...tdVal(),
                  textAlign: 'center',
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  borderLeft: isFirstInSec ? `2px solid ${meta.color}33` : undefined,
                  maxWidth: COL_W,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {s.name}
                </td>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {[
            {
              label: 'Phase (상)', unit: '—', render: (s: StreamData) => (
                <span style={{ fontSize: 9, fontWeight: 700, color: PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B', background: `${PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B'}18`, border: `1px solid ${PHASE_COLOR[s.phase ?? 'L'] ?? '#52525B'}44`, borderRadius: 3, padding: '1px 5px', fontFamily: 'JetBrains Mono, monospace' }}>
                  {s.phase ?? 'L'}
                </span>
              ),
              center: true,
            },
            { label: 'Vapor Fraction (기상분율 β)', unit: '—', getVal: (s: StreamData) => fmt(s.vaporFraction, 2), color: '#52525B' },
            { label: 'Temperature (온도)', unit: '°C', getVal: (s: StreamData) => fmt(s.temperature_C, 1), color: '#1A2F44' },
            { label: 'Pressure (압력)', unit: 'kg/cm²G', getVal: (s: StreamData) => fmt(s.pressure_kgcm2g, 2), color: '#52525B' },
            { label: 'Molar Flow (몰유량)', unit: 'kmol/h', getVal: (s: StreamData) => fmt(s.molarFlow_kmolh, 1), color: '#1A2F44' },
            { label: 'Volume Flow (부피유량)', unit: 'm³/h', getVal: (s: StreamData) => fmt(s.volFlow_m3h, 1), color: '#0F5338' },
            { label: 'Average MW (평균분자량)', unit: 'g/mol', getVal: (s: StreamData) => fmt(s.avgMW, 2), color: '#52525B' },
            { label: 'Density (밀도)', unit: 'kg/m³', getVal: (s: StreamData) => fmt(s.density_kgm3, s.phase === 'G' ? 2 : 0), color: '#52525B' },
            { label: 'Heat Capacity Cp (비열)', unit: 'kcal/kg·°C', getVal: (s: StreamData) => fmt(s.cp_kcalKgC, 3), color: '#52525B' },
            { label: 'Specific Enthalpy (비엔탈피)', unit: 'kcal/kg', getVal: (s: StreamData) => fmt(s.enthalpy_kcalKg, 1), color: '#52525B' },
            { label: 'Enthalpy Flow (엔탈피 유량)', unit: 'Mcal/h', getVal: (s: StreamData) => fmt(s.enthalpyFlow_Mcalh, 1), color: '#7C2D12' },
            { label: 'Concentration (주성분 농도)', unit: 'wt%', getVal: (s: StreamData) => s.concentration !== undefined ? fmt(s.concentration, 2) : '—', color: '#1A2F44' },
            { label: 'Moisture (수분 농도)', unit: 'wt ppm', getVal: (s: StreamData) => s.moisturePpm !== undefined ? fmt(s.moisturePpm, 2) : '—', color: '#0369A1' },
          ].map((row, ri) => (
            <tr key={row.label} style={rowStripe(ri)}>
              <td style={tdLabel}>{row.label}</td>
              <td style={tdUnit}>{row.unit}</td>
              {orderedStreams.map((s, i) => {
                const meta = SECTION_META[s.section] ?? { color: '#52525B' };
                const isFirstInSec = Object.values(sectionStartIdx).includes(i);
                return (
                  <td key={s.id} style={{
                    ...tdVal(row.color),
                    textAlign: row.center ? 'center' : 'right',
                    borderLeft: isFirstInSec ? `2px solid ${meta.color}33` : undefined,
                  }}>
                    {row.render ? row.render(s) : (row.getVal?.(s) ?? '—')}
                  </td>
                );
              })}
            </tr>
          ))}

          <tr>
            <td colSpan={999} style={{ padding: '2px 10px', background: '#F6F7F2', borderTop: '1px solid #DFDCD4', borderBottom: '1px solid #DFDCD4' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#1A2F44', textTransform: 'uppercase', letterSpacing: '0.08em' }}>━ 성분별 질량 유량 (Component Mass Flows)</span>
            </td>
          </tr>

          <tr style={rowStripe(0)}>
            <td style={{ ...tdLabel, fontWeight: 700, color: 'var(--text-primary)' }}>Total Mass Flow</td>
            <td style={tdUnit}>kg/h</td>
            {orderedStreams.map((s, i) => {
              const meta = SECTION_META[s.section] ?? { color: '#52525B' };
              const isFirstInSec = Object.values(sectionStartIdx).includes(i);
              return (
                <td key={s.id} style={{ ...tdVal('#27272A'), fontWeight: 700, borderLeft: isFirstInSec ? `2px solid ${meta.color}33` : undefined }}>
                  {s.total_kgh !== undefined ? fmt(s.total_kgh, 1) : '—'}
                </td>
              );
            })}
          </tr>

          {activeComps.map((comp, ci) => (
            <tr key={comp} style={rowStripe(ci + 1)}>
              <td style={{ ...tdLabel, paddingLeft: 22, fontStyle: 'italic' }}>
                {COMP_LABELS[comp] ?? comp}
              </td>
              <td style={tdUnit}>kg/h</td>
              {orderedStreams.map((s, i) => {
                const meta = SECTION_META[s.section] ?? { color: '#52525B' };
                const isFirstInSec = Object.values(sectionStartIdx).includes(i);
                const val = s.components?.[comp as keyof typeof s.components];
                return (
                  <td key={s.id} style={{ ...tdVal(), color: val ? 'var(--text-secondary)' : '#DFDCD4', borderLeft: isFirstInSec ? `2px solid ${meta.color}33` : undefined }}>
                    {val ? fmt(val as number, (val as number) < 10 ? 2 : 1) : '—'}
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 StreamTable 컴포넌트 (섹션별 운전조건 설정바 + 3종 뷰 전환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export interface StreamTableProps {
  externalMode?: 'pfd_sheet' | 'sim';
  externalSection?: string;
  compactSplit?: boolean;
}

export default function StreamTable({ externalMode, externalSection, compactSplit = false }: StreamTableProps = {}) {
  const { inputs, setInput, resetInputs, balance } = useBalanceStore();
  const streams    = balance?.streams ?? [];
  const unitBlocks = balance?.unitBlocks ?? [];
  const summary    = balance?.summary;
  const elec       = balance?.electrolyzerResult;

  const [viewMode, setViewMode] = useState<'sim' | 'pfd' | 'card'>(externalMode === 'sim' ? 'sim' : 'pfd');
  const [showSimConsole, setShowSimConsole] = useState(!compactSplit);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalSection, setFilterSection] = useState<string>('all');
  const filterSection = externalSection !== undefined ? externalSection : internalSection;

  React.useEffect(() => {
    if (externalMode === 'sim') setViewMode('sim');
    else if (externalMode === 'pfd_sheet' && viewMode === 'sim') setViewMode('pfd');
  }, [externalMode]);
  const [filterPhase, setFilterPhase] = useState<string>('all');
  const [sortKey] = useState<'id' | 'total_kgh' | 'temperature_C'>('id');

  const filtered = useMemo(() => {
    let list = [...streams];
    if (filterSection !== 'all') list = list.filter(s => s.section === filterSection);
    if (filterPhase !== 'all')   list = list.filter(s => (s.phase ?? 'L') === filterPhase);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        Object.keys(s.components ?? {}).some(k => k.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      if (sortKey === 'id') return a.id.localeCompare(b.id, undefined, { numeric: true });
      if (sortKey === 'total_kgh') return (b.total_kgh ?? 0) - (a.total_kgh ?? 0);
      if (sortKey === 'temperature_C') return (b.temperature_C ?? 0) - (a.temperature_C ?? 0);
      return 0;
    });
    return list;
  }, [streams, filterSection, filterPhase, searchQuery, sortKey]);

  const grouped = useMemo(() => {
    const map: Record<string, StreamData[]> = {};
    filtered.forEach(s => {
      const sec = s.section ?? 'etc';
      if (!map[sec]) map[sec] = [];
      map[sec].push(s);
    });
    return map;
  }, [filtered]);
  const sections = Object.keys(grouped).sort();

  const totalCl2 = streams.find(s => s.id === '220')?.components?.Cl2 ?? 0;
  const totalH2  = streams.find(s => s.id === '221')?.components?.H2 ?? 0;

  const anodePressG   = inputs.anodePressKgcm2g ?? 0.40;
  const cathodePressG = inputs.cathodePressKgcm2g ?? 0.45;
  const deltaPKgcm2   = cathodePressG - anodePressG;
  const deltaPMmH2O   = deltaPKgcm2 * 10000;

  const selectStyle: React.CSSProperties = {
    height: 30, padding: '0 8px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
  };

  const SECTION_INPUT_GROUPS: Array<{
    sec: string;
    title: string;
    badgeBg: string;
    items: Array<{
      key: keyof ElectrolyzerInputs;
      label: string;
      unit: string;
      min: number;
      max: number;
      step: number;
      val: number;
    }>;
  }> = [
    {
      sec: '100 Sec',
      title: '브라인 정제',
      badgeBg: '#1A2F44',
      items: [
        { key: 'brineFeedConcWt', label: '[104] 정제염수 농도', unit: 'wt%', min: 24.0, max: 26.5, step: 0.05, val: inputs.brineFeedConcWt ?? 25.65 },
        { key: 'brineFeedTempC',  label: '[104] 정제염수 온도', unit: '°C',  min: 45.0, max: 75.0, step: 0.5,  val: inputs.brineFeedTempC ?? 60.0 },
      ],
    },
    {
      sec: '200 Sec',
      title: '전해조 · 기액분리기 (D-210 / D-220) · 탈염소',
      badgeBg: '#0F5338',
      items: [
        { key: 'anodeTempC',             label: 'D-210 양극온도',     unit: '°C',      min: 75.0, max: 95.0, step: 0.5,  val: inputs.anodeTempC ?? 87.0 },
        { key: 'anodePressKgcm2g',       label: 'D-210 양극압력',     unit: 'kg/cm²G', min: 0.05, max: 1.00, step: 0.05, val: anodePressG },
        { key: 'cathodeTempC',           label: 'D-220 음극온도',     unit: '°C',      min: 75.0, max: 95.0, step: 0.5,  val: inputs.cathodeTempC ?? 90.0 },
        { key: 'cathodePressKgcm2g',     label: 'D-220 음극압력',     unit: 'kg/cm²G', min: 0.05, max: 1.15, step: 0.05, val: cathodePressG },
        { key: 'anolyteExitConcWt',      label: '[202] 양극출구 농도', unit: 'wt%',     min: 15.5, max: 20.5, step: 0.05, val: inputs.anolyteExitConcWt ?? 17.45 },
        { key: 'catholyteConcWt',        label: '[219] 가성소다 농도', unit: 'wt%',     min: 30.0, max: 34.5, step: 0.05, val: inputs.catholyteConcWt ?? 32.34 },
        { key: 't280VacuumPressKgcm2g',  label: 'T-280 탈염소 진공압', unit: 'kg/cm²G', min: -0.85, max: -0.20, step: 0.05, val: inputs.t280VacuumPressKgcm2g ?? -0.65 },
      ],
    },
    {
      sec: '400 Sec',
      title: '염소 냉각 · 건조 · 압축',
      badgeBg: '#0369A1',
      items: [
        { key: 'cl2Cooler1TempC',   label: 'T-410/E-413 1차냉각', unit: '°C',      min: 28.0, max: 58.0, step: 0.5, val: inputs.cl2Cooler1TempC ?? 40.0 },
        { key: 'cl2Cooler2TempC',   label: 'T-420/E-423 2차냉각', unit: '°C',      min: 12.0, max: 30.0, step: 0.5, val: inputs.cl2Cooler2TempC ?? 20.0 },
        { key: 'cl2CompPressKgcm2g',label: 'C-470 염소압축 압력', unit: 'kg/cm²G', min: 1.5,  max: 6.0,  step: 0.2, val: inputs.cl2CompPressKgcm2g ?? 3.0 },
      ],
    },
    {
      sec: '600 Sec',
      title: '수소 냉각 · 고압압축 · 제습',
      badgeBg: '#4C1D95',
      items: [
        { key: 'h2Cooler1TempC',    label: 'E-5613 1차냉각',   unit: '°C',      min: 30.0, max: 55.0, step: 0.5, val: inputs.h2Cooler1TempC ?? 41.0 },
        { key: 'h2Cooler2TempC',    label: 'E-5630 2차냉각',   unit: '°C',      min: 7.0,  max: 25.0, step: 0.5, val: inputs.h2Cooler2TempC ?? 10.0 },
        { key: 'h2CompPressKgcm2g', label: 'C-620 수소압축',   unit: 'kg/cm²G', min: 5.0,  max: 35.0, step: 1.0, val: inputs.h2CompPressKgcm2g ?? 23.0 },
        { key: 'h2HighPCoolTempC',  label: 'E-5680 고압냉각',  unit: '°C',      min: 5.0,  max: 25.0, step: 0.5, val: inputs.h2HighPCoolTempC ?? 10.0 },
      ],
    },
  ];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', system-ui, sans-serif", background: 'var(--bg-base)' }}>

      {/* ── 상단 바 ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, padding: '8px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: 'Cl₂ 생산 (5기 합산)', value: totalCl2 ? `${(totalCl2 * 24 / 1000).toFixed(1)} t/d` : '—', color: '#1A2F44' },
          { label: '32% NaOH (용액)', value: summary ? `${summary.naoh32_tonDay.toFixed(1)} t/d` : '—', color: '#1A2F44' },
          { label: '50% NaOH (농축)', value: summary ? `${summary.naoh50_tonDay.toFixed(1)} t/d` : '—', color: '#1A2F44' },
          { label: 'H₂ 생산량', value: totalH2 ? `${(totalH2 * 24 / 1000).toFixed(2)} t/d` : '—', color: '#202C3C' },
          { label: 'DC 소비전력', value: summary?.dcPower_MW ? `${summary.dcPower_MW.toFixed(2)} MW` : '—', color: '#0F5338' },
        ].map(c => (
          <div key={c.label} style={{ background: `${c.color}0e`, border: `1px solid ${c.color}25`, borderRadius: 7, padding: '4px 11px', minWidth: 94 }}>
            <div style={{ fontSize: 8.5, color: c.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: c.color, fontFamily: 'JetBrains Mono, monospace' }}>{c.value}</div>
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setShowSimConsole(v => !v)}
          style={{
            height: 30, padding: '0 12px', borderRadius: 7,
            background: showSimConsole ? '#1A2F44' : '#EFECE5',
            color: showSimConsole ? '#FFFFFF' : '#1A2F44',
            border: '1px solid #1A2F44', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          }}
        >
          🎛️ 공정 운전조건 설정 {showSimConsole ? '▲' : '▼'}
        </button>

        {/* 스트림 표시 형식 전환 (상단 통합 탭과 혼동 없도록 명확화) */}
        {externalMode !== 'sim' && (
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid #DFDCD4', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
            {([
              { id: 'pfd',  icon: '📋', label: '가로형 스트림 시트' },
              { id: 'card', icon: '🗂', label: '섹션별 카드 보기' },
            ] as const).map(v => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                style={{
                  height: 30, padding: '0 11px',
                  background: viewMode === v.id ? '#1A2F44' : 'transparent',
                  border: 'none',
                  borderRight: v.id !== 'card' ? '1px solid #DFDCD4' : 'none',
                  color: viewMode === v.id ? '#FFFFFF' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: viewMode === v.id ? 700 : 500,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <span>{v.icon}</span>
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        )}

        {viewMode !== 'sim' && (
          <>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
              <input
                placeholder="번호·이름 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...selectStyle, padding: '0 10px 0 26px', width: 135, fontFamily: 'monospace', outline: 'none' }}
              />
            </div>
            {externalSection === undefined && (
              <select value={filterSection} onChange={e => setFilterSection(e.target.value)} style={selectStyle}>
                <option value="all">전체 섹션</option>
                {['100','200','300','400','600'].map(s => <option key={s} value={s}>{s} Sec</option>)}
              </select>
            )}
            <select value={filterPhase} onChange={e => setFilterPhase(e.target.value)} style={selectStyle}>
              <option value="all">전체 상</option>
              <option value="L">액체 L</option>
              <option value="G">기체 G</option>
              <option value="L/G">기액 L/G</option>
            </select>
          </>
        )}
      </div>

      {/* ── 섹션별 체계적 운전조건 설정 패널 (100 / 200 / 400 / 600 Sec) ── */}
      {showSimConsole && (
        <div style={{
          padding: '8px 16px', background: '#F6F7F2', borderBottom: '1px solid #DFDCD4',
          display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
        }}>
          {SECTION_INPUT_GROUPS.map(group => (
            <div
              key={group.sec}
              style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px',
                background: '#FFFFFF', border: '1px solid #E5E2DC', borderRadius: 7, padding: '5px 10px',
              }}
            >
              {/* 섹션 배지 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 165 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                  background: group.badgeBg, color: '#FFFFFF', fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {group.sec}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
                  {group.title}
                </span>
              </div>

              {/* 해당 섹션의 수치 입력 박스들 */}
              {group.items.map(item => (
                <div
                  key={item.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: '#FAF9F5', border: '1px solid #DFDCD4', borderRadius: 5, padding: '2px 8px',
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#2C353E', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                  <input
                    type="number"
                    min={item.min} max={item.max} step={item.step}
                    value={Number(item.val.toFixed(item.step < 0.1 ? 2 : 1))}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) setInput(item.key, v);
                    }}
                    style={{
                      width: 64, height: 22, padding: '0 5px',
                      borderRadius: 4, border: '1px solid #C8C4B8',
                      background: '#FFFFFF', color: '#1A2F44',
                      fontSize: 11, fontWeight: 800, textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 9.5, color: '#5A6570', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {item.unit}
                  </span>
                </div>
              ))}

              {/* 200 Sec에는 D-220과 D-210의 막 차압(ΔP) 실시간 표시 배지 추가 */}
              {group.sec === '200 Sec' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: deltaPKgcm2 >= 0 ? '#ECFDF5' : '#FEF2F2',
                  border: `1px solid ${deltaPKgcm2 >= 0 ? '#10B981' : '#EF4444'}`,
                  borderRadius: 5, padding: '2px 9px',
                  fontSize: 10, fontWeight: 800,
                  color: deltaPKgcm2 >= 0 ? '#065F46' : '#991B1B',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  <span>막 차압 ΔP(D-220 − D-210):</span>
                  <span>
                    {deltaPKgcm2 >= 0 ? '+' : ''}{deltaPKgcm2.toFixed(2)} kg/cm² ({deltaPMmH2O >= 0 ? '+' : ''}{deltaPMmH2O.toFixed(0)} mmH₂O)
                  </span>
                </div>
              )}

              {/* 마지막 줄 우측에 기준값 복원 버튼 배치 */}
              {group.sec === '600 Sec' && (
                <button
                  onClick={resetInputs}
                  style={{
                    marginLeft: 'auto', height: 24, padding: '0 11px', borderRadius: 5,
                    background: '#EFECE5', border: '1px solid #1A2F44',
                    color: '#1A2F44', fontSize: 10.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ↺ 설계 기준값(468 T/D) 복원
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 콘텐츠 ─────────────────────────────────────────────── */}
      {streams.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
          <span style={{ fontSize: 36 }}>📊</span>
          <span style={{ fontSize: 13 }}>스트림 데이터가 없습니다</span>
        </div>
      ) : viewMode === 'sim' && elec ? (
        <ProcessUnitSimulationView elec={elec} unitBlocks={filterSection === 'all' ? unitBlocks : unitBlocks.filter(b => b.section === filterSection)} numElectrolyzers={inputs.numElectrolyzers} inputs={inputs} />
      ) : viewMode === 'pfd' ? (
        <PFDSheetView streams={filtered} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 8, color: 'var(--text-muted)' }}>
              <span style={{ fontSize: 24 }}>🔍</span>
              <span style={{ fontSize: 12 }}>검색 결과가 없습니다</span>
            </div>
          ) : sections.map(sec => <SectionBlock key={sec} section={sec} streams={grouped[sec]} />)}
        </div>
      )}
    </div>
  );
}

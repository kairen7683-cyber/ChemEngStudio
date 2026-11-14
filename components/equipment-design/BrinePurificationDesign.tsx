'use client';
import React, { useState, useMemo, useEffect } from 'react';
import {
  SaturatorDesignInputs,
  SaturatorDesignResults,
  CandleFilterDesignInputs,
  CandleFilterDesignResults,
  IonExchangeDesignInputs,
  IonExchangeDesignResults,
  CHELATING_RESIN_DB,
  calcBrineSaturator,
  calcCandleBrineFilter,
  calcChelatingIonExchange,
  getBrinePurifPresets,
} from '@/lib/calculations/brinePurification';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E2DC',
  borderRadius: 10,
  padding: '16px 20px',
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(26, 47, 68, 0.04)',
};

const inpStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  background: '#F6F7F2',
  border: '1px solid #DFDCD4',
  borderRadius: 6,
  color: '#1A2F44',
  fontSize: 12,
  padding: '0 10px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: "'JetBrains Mono', 'Pretendard', monospace",
};

const selectStyle: React.CSSProperties = {
  ...inpStyle,
  fontFamily: "'Pretendard', 'Inter', system-ui, sans-serif",
  fontWeight: 600,
  cursor: 'pointer',
};

const labelSt: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: '#52525B',
  letterSpacing: '0.02em',
  marginBottom: 4,
  display: 'block',
};

const kpiBox = (accent: string): React.CSSProperties => ({
  background: '#FBFBFA',
  border: '1px solid #E5E2DC',
  borderLeft: `3px solid ${accent}`,
  borderRadius: 8,
  padding: '10px 14px',
});

interface SpecSummaryItem {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'navy' | 'teal' | 'amber';
}

/* ─────────────────────────────────────────────────────────────────────
 * 1) T-030 / D-010 포화조 · 침전조 벡터(SVG) 단면 도면
 * ───────────────────────────────────────────────────────────────────── */
function SaturatorSchematicSvg({
  inp,
  res,
}: {
  inp: SaturatorDesignInputs;
  res: SaturatorDesignResults;
}) {
  const isSat = inp.mode === 'upflow_saturator';

  if (!isSat) {
    // 중력 침강 정제조 (Clarifier / Settler) 단면도
    return (
      <svg viewBox="0 0 430 292" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="brineClarLiq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.85" />
            <stop offset="72%" stopColor="#BAE6FD" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#FDE68A" stopOpacity="0.75" />
          </linearGradient>
          <pattern id="brineGrid1" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ECEAE3" strokeWidth="0.8" />
          </pattern>
        </defs>

        <rect x="0" y="0" width="430" height="292" rx="8" fill="#F9FAF7" />
        <rect x="0" y="0" width="430" height="292" rx="8" fill="url(#brineGrid1)" />
        <rect x="0.75" y="0.75" width="428.5" height="290.5" rx="7.5" fill="none" stroke="#E5E2DC" strokeWidth="1.5" />

        {/* 상단 도면 배지 */}
        <rect x="12" y="10" width="118" height="20" rx="4" fill="#1A2F44" />
        <text x="71" y="24" textAnchor="middle" fill="#FFFFFF" fontSize="10.5" fontWeight="700">
          {inp.tag} · 중력 침강조
        </text>
        <rect x="308" y="10" width="110" height="20" rx="4" fill="#EFF6FF" stroke="#BFDBFE" />
        <text x="363" y="24" textAnchor="middle" fill="#1E40AF" fontSize="10" fontWeight="700">
          SLR {res.actualUpflowVel_mh} m/h
        </text>

        {/* 상부 브릿지 및 레이크 모터 */}
        <rect x="92" y="54" width="246" height="8" rx="2" fill="#CBD5E1" stroke="#1A2F44" strokeWidth="1.4" />
        <rect x="198" y="36" width="34" height="18" rx="3" fill="#1A2F44" />
        <text x="215" y="48" textAnchor="middle" fill="#FFFFFF" fontSize="8.5" fontWeight="700">
          M
        </text>
        <text x="257" y="48" fill="#1A2F44" fontSize="9.5" fontWeight="700">
          구동부 {res.rakeMotor_kW} kW
        </text>

        {/* 침전조 본체 + 하부 완만 콘 (일체형 패스) */}
        <path
          d="M 104 68 L 326 68 L 326 190 L 228 232 L 202 232 L 104 190 Z"
          fill="url(#brineClarLiq)"
          stroke="#1A2F44"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* 상부 V-노치 위어 런더 */}
        <rect x="104" y="74" width="18" height="14" fill="#FFFFFF" stroke="#1A2F44" strokeWidth="1.3" />
        <rect x="308" y="74" width="18" height="14" fill="#FFFFFF" stroke="#1A2F44" strokeWidth="1.3" />

        {/* 중앙 피드웰 (Center Well) */}
        <rect x="192" y="68" width="46" height="58" fill="#E2E8F0" fillOpacity="0.7" stroke="#1A2F44" strokeWidth="1.4" />
        <line x1="215" y1="54" x2="215" y2="224" stroke="#1A2F44" strokeWidth="2" />

        {/* 하부 슬러지 레이크 암 */}
        <path d="M 122 188 L 215 220 L 308 188" fill="none" stroke="#334155" strokeWidth="2.2" />
        <line x1="145" y1="196" x2="145" y2="203" stroke="#334155" strokeWidth="1.8" />
        <line x1="175" y1="206" x2="175" y2="213" stroke="#334155" strokeWidth="1.8" />
        <line x1="255" y1="206" x2="255" y2="213" stroke="#334155" strokeWidth="1.8" />
        <line x1="285" y1="196" x2="285" y2="203" stroke="#334155" strokeWidth="1.8" />

        {/* 슬러지 농축 계면선 */}
        <line x1="106" y1="184" x2="324" y2="184" stroke="#B45309" strokeWidth="1.3" strokeDasharray="5 3" />

        {/* 내부 구역 한글 주석 */}
        <text x="150" y="108" textAnchor="middle" fill="#0F172A" fontSize="10" fontWeight="700">
          상부 청징 구간
        </text>
        <text x="150" y="122" textAnchor="middle" fill="#475569" fontSize="9.5">
          ({res.H_clarification_m} m)
        </text>
        <text x="276" y="176" textAnchor="middle" fill="#92400E" fontSize="9.5" fontWeight="700">
          슬러지 농축층 ({res.H_saltBed_m} m)
        </text>

        {/* 유입 배관 (좌측 → 피드웰) */}
        <path d="M 38 92 L 192 92" fill="none" stroke="#0284C7" strokeWidth="2.4" />
        <polygon points="186,88 194,92 186,96" fill="#0284C7" />
        <text x="40" y="85" fill="#0369A1" fontSize="9.5" fontWeight="700">
          원액 유입 ({res.nozzleInlet_NPS.replace(' Sch 40', '')})
        </text>

        {/* 상등액 출구 배관 (우측 위어) */}
        <path d="M 326 81 L 392 81" fill="none" stroke="#0F766E" strokeWidth="2.4" />
        <polygon points="386,77 394,81 386,85" fill="#0F766E" />
        <text x="392" y="73" textAnchor="end" fill="#0F766E" fontSize="9.5" fontWeight="700">
          청징액 출구
        </text>

        {/* 하부 슬러지 배출 */}
        <path d="M 215 232 L 215 254 L 278 254" fill="none" stroke="#B45309" strokeWidth="2" />
        <polygon points="274,250 282,254 274,258" fill="#B45309" />
        <text x="286" y="257" fill="#92400E" fontSize="9.5" fontWeight="700">
          슬러지 언더플로우
        </text>

        {/* 치수선 (직경 D / 총높이 H) */}
        <line x1="104" y1="272" x2="326" y2="272" stroke="#64748B" strokeWidth="1.2" />
        <line x1="104" y1="267" x2="104" y2="277" stroke="#64748B" strokeWidth="1.2" />
        <line x1="326" y1="267" x2="326" y2="277" stroke="#64748B" strokeWidth="1.2" />
        <rect x="166" y="263" width="98" height="17" rx="3" fill="#F9FAF7" />
        <text x="215" y="275" textAnchor="middle" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
          Ø {res.D_vessel_m} m
        </text>

        <line x1="74" y1="68" x2="74" y2="232" stroke="#64748B" strokeWidth="1.2" />
        <line x1="69" y1="68" x2="79" y2="68" stroke="#64748B" strokeWidth="1.2" />
        <line x1="69" y1="232" x2="79" y2="232" stroke="#64748B" strokeWidth="1.2" />
        <text x="68" y="154" textAnchor="end" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
          H {res.H_total_m}m
        </text>
      </svg>
    );
  }

  // 원염 충진층 상향류 포화조 (Upflow Salt-Bed Saturator) 단면도
  return (
    <svg viewBox="0 0 430 292" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="satBrineZone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="satSaltZone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FDE68A" stopOpacity="0.95" />
        </linearGradient>
        <pattern id="brineGrid2" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ECEAE3" strokeWidth="0.8" />
        </pattern>
        <pattern id="saltCrystalDots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="1.3" fill="#D97706" fillOpacity="0.45" />
          <circle cx="9" cy="9" r="1.5" fill="#B45309" fillOpacity="0.38" />
        </pattern>
      </defs>

      <rect x="0" y="0" width="430" height="292" rx="8" fill="#F9FAF7" />
      <rect x="0" y="0" width="430" height="292" rx="8" fill="url(#brineGrid2)" />
      <rect x="0.75" y="0.75" width="428.5" height="290.5" rx="7.5" fill="none" stroke="#E5E2DC" strokeWidth="1.5" />

      {/* 상단 태그 및 운전 상태 배지 */}
      <rect x="12" y="10" width="126" height="20" rx="4" fill="#1A2F44" />
      <text x="75" y="24" textAnchor="middle" fill="#FFFFFF" fontSize="10.5" fontWeight="700">
        {inp.tag} · 상향류 포화조
      </text>
      <rect x="300" y="10" width="118" height="20" rx="4" fill="#FEF3C7" stroke="#FCD34D" />
      <text x="359" y="24" textAnchor="middle" fill="#92400E" fontSize="10" fontWeight="700">
        용해 {res.saltDissolveRate_th} ton/h
      </text>

      {/* 상부 원염 투입 호퍼 */}
      <path d="M 197 32 L 233 32 L 225 56 L 205 56 Z" fill="#FDE68A" stroke="#1A2F44" strokeWidth="1.5" />
      <text x="242" y="45" fill="#92400E" fontSize="9.5" fontWeight="700">
        원염 투입 ({res.saltDissolveRate_td} t/d)
      </text>

      {/* 포화조 상부 청징 구간 + 원염 충진 직동부 + 하부 콘 (일체형 외곽) */}
      {/* 청징 액상 영역 */}
      <rect x="136" y="56" width="158" height="62" fill="url(#satBrineZone)" />
      {/* 원염 충진층 + 하부 콘 영역 */}
      <path
        d="M 136 118 L 294 118 L 294 188 L 215 244 L 136 188 Z"
        fill="url(#satSaltZone)"
      />
      <path
        d="M 136 118 L 294 118 L 294 188 L 215 244 L 136 188 Z"
        fill="url(#saltCrystalDots)"
      />

      {/* 본체 외곽선 (이음선 없는 단일 패스) */}
      <path
        d="M 136 56 L 294 56 L 294 188 L 215 244 L 136 188 Z"
        fill="none"
        stroke="#1A2F44"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* 상부 오버플로우 위어 트로프 */}
      <rect x="128" y="64" width="12" height="18" rx="2" fill="#E0F2FE" stroke="#1A2F44" strokeWidth="1.4" />
      <rect x="290" y="64" width="12" height="18" rx="2" fill="#E0F2FE" stroke="#1A2F44" strokeWidth="1.4" />

      {/* 청징 구간 / 원염 충진층 경계선 */}
      <line x1="138" y1="118" x2="292" y2="118" stroke="#B45309" strokeWidth="1.5" strokeDasharray="5 3" />

      {/* 하부 스파저 분배 링 */}
      <rect x="166" y="200" width="98" height="7" rx="3.5" fill="#0F766E" stroke="#1A2F44" strokeWidth="1.2" />
      <line x1="184" y1="196" x2="184" y2="178" stroke="#0F766E" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="215" y1="196" x2="215" y2="174" stroke="#0F766E" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="246" y1="196" x2="246" y2="178" stroke="#0F766E" strokeWidth="1.5" strokeDasharray="3 2" />

      {/* 내부 한글 라벨 (여유 폭 충분) */}
      <text x="215" y="84" textAnchor="middle" fill="#0F172A" fontSize="10.5" fontWeight="700">
        포화염수 청징 구간
      </text>
      <text x="215" y="99" textAnchor="middle" fill="#0369A1" fontSize="9.5" fontWeight="600">
        NaCl {inp.targetNaCl_gL} g/L · LV {res.actualUpflowVel_mh} m/h
      </text>

      <rect x="155" y="136" width="120" height="36" rx="5" fill="#FFFFFF" fillOpacity="0.82" stroke="#F59E0B" strokeWidth="1" />
      <text x="215" y="151" textAnchor="middle" fill="#92400E" fontSize="10.5" fontWeight="700">
        원염 충진층 ({res.saltHoldup_ton} t)
      </text>
      <text x="215" y="165" textAnchor="middle" fill="#78350F" fontSize="9.5" fontFamily="'JetBrains Mono', monospace">
        H_bed = {res.H_saltBed_m} m
      </text>

      {/* 희박염수 하부 유입 배관 */}
      <path d="M 40 203.5 L 166 203.5" fill="none" stroke="#0284C7" strokeWidth="2.4" />
      <polygon points="158,199.5 166,203.5 158,207.5" fill="#0284C7" />
      <text x="40" y="195" fill="#0369A1" fontSize="9.5" fontWeight="700">
        희박염수 유입 ({inp.inletNaCl_gL} g/L)
      </text>
      <text x="40" y="217" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">
        {res.nozzleInlet_NPS}
      </text>

      {/* 포화염수 상부 출구 배관 */}
      <path d="M 302 73 L 392 73" fill="none" stroke="#0F766E" strokeWidth="2.4" />
      <polygon points="386,69 394,73 386,77" fill="#0F766E" />
      <text x="392" y="65" textAnchor="end" fill="#0F766E" fontSize="9.5" fontWeight="700">
        포화염수 출구
      </text>
      <text x="392" y="87" textAnchor="end" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">
        {res.nozzleOutlet_NPS}
      </text>

      {/* 외곽 치수선 */}
      <line x1="136" y1="268" x2="294" y2="268" stroke="#64748B" strokeWidth="1.2" />
      <line x1="136" y1="263" x2="136" y2="273" stroke="#64748B" strokeWidth="1.2" />
      <line x1="294" y1="263" x2="294" y2="273" stroke="#64748B" strokeWidth="1.2" />
      <rect x="169" y="259" width="92" height="17" rx="3" fill="#F9FAF7" />
      <text x="215" y="271" textAnchor="middle" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        Ø {res.D_vessel_m} m
      </text>

      <line x1="322" y1="56" x2="322" y2="244" stroke="#64748B" strokeWidth="1.2" />
      <line x1="317" y1="56" x2="327" y2="56" stroke="#64748B" strokeWidth="1.2" />
      <line x1="317" y1="244" x2="327" y2="244" stroke="#64748B" strokeWidth="1.2" />
      <text x="330" y="154" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        총고 {res.H_total_m} m
      </text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * 2) F-140 캔들 타입 프리코트 브라인 필터 벡터(SVG) 단면 도면
 * ───────────────────────────────────────────────────────────────────── */
function CandleFilterSchematicSvg({
  inp,
  res,
}: {
  inp: CandleFilterDesignInputs;
  res: CandleFilterDesignResults;
}) {
  const candleXs = [166, 182, 198, 214, 230, 246, 262];

  return (
    <svg viewBox="0 0 430 292" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="fltShellGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F1F5F9" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>
        <linearGradient id="fltPlenumGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CCFBF1" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#E0F2FE" stopOpacity="0.7" />
        </linearGradient>
        <pattern id="brineGrid3" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ECEAE3" strokeWidth="0.8" />
        </pattern>
      </defs>

      <rect x="0" y="0" width="430" height="292" rx="8" fill="#F9FAF7" />
      <rect x="0" y="0" width="430" height="292" rx="8" fill="url(#brineGrid3)" />
      <rect x="0.75" y="0.75" width="428.5" height="290.5" rx="7.5" fill="none" stroke="#E5E2DC" strokeWidth="1.5" />

      {/* 상단 태그 및 운전 기수 배지 */}
      <rect x="12" y="10" width="132" height="20" rx="4" fill="#1A2F44" />
      <text x="78" y="24" textAnchor="middle" fill="#FFFFFF" fontSize="10.5" fontWeight="700">
        {inp.tag} · 캔들 브라인 필터
      </text>
      <rect x="286" y="10" width="132" height="20" rx="4" fill="#F0FDFA" stroke="#99F6E4" />
      <text x="352" y="24" textAnchor="middle" fill="#0F766E" fontSize="10" fontWeight="700">
        운전 {inp.nOperatingUnits}기 + 예비 {inp.nStandbyUnits}기
      </text>

      {/* 상부 여과액 챔버(Plenum) 채움 */}
      <path
        d="M 150 76 A 64 26 0 0 1 278 76 L 278 86 L 150 86 Z"
        fill="url(#fltPlenumGrad)"
      />

      {/* 하부 여과실 + 슬러지 배출 콘 채움 */}
      <path
        d="M 150 86 L 278 86 L 278 196 L 214 238 L 150 196 Z"
        fill="url(#fltShellGrad)"
      />

      {/* 일체형 압력용기 외곽선 (상부 경판 가로선 겹침 완전 제거) */}
      <path
        d="M 150 76 A 64 26 0 0 1 278 76 L 278 196 L 214 238 L 150 196 Z"
        fill="none"
        stroke="#1A2F44"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* 상부 튜브시트 플랜지 */}
      <rect x="143" y="83" width="142" height="6" rx="2" fill="#1A2F44" />

      {/* 캔들 엘리먼트 다발 (중심 코어 + 외부 α-Cellulose/Carbon 프리코트 층) */}
      {candleXs.map((cx, i) => (
        <g key={i}>
          {/* 프리코트 케이크 슬리브 */}
          <rect x={cx - 4.5} y="89" width="9" height="96" rx="3" fill="#FCD34D" fillOpacity="0.65" stroke="#D97706" strokeWidth="0.9" />
          {/* PVDF/PP 다공성 캔들 코어 */}
          <rect x={cx - 2} y="87" width="4" height="96" rx="1.5" fill="#1A2F44" />
        </g>
      ))}

      {/* 서포트 레그 */}
      <line x1="162" y1="204" x2="156" y2="248" stroke="#475569" strokeWidth="2.2" />
      <line x1="266" y1="204" x2="272" y2="248" stroke="#475569" strokeWidth="2.2" />

      {/* 원액(1차 정제 브라인) 유입 배관 */}
      <path d="M 38 152 L 150 152" fill="none" stroke="#0284C7" strokeWidth="2.4" />
      <polygon points="142,148 150,152 142,156" fill="#0284C7" />
      <text x="38" y="143" fill="#0369A1" fontSize="9.5" fontWeight="700">
        브라인 유입 (SS {inp.inletSS_ppm} ppm)
      </text>
      <text x="38" y="166" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">
        {res.nozzleInOut_NPS}
      </text>

      {/* 상부 여과 브라인 출구 배관 */}
      <path d="M 272 68 L 392 68" fill="none" stroke="#0F766E" strokeWidth="2.4" />
      <polygon points="386,64 394,68 386,72" fill="#0F766E" />
      <text x="392" y="59" textAnchor="end" fill="#0F766E" fontSize="9.5" fontWeight="700">
        여과액 출구 (&lt;{inp.outletSS_ppm} ppm)
      </text>
      <text x="392" y="81" textAnchor="end" fill="#64748B" fontSize="9">
        역세수 {res.backwashWater_m3} m³/회
      </text>

      {/* 하부 케이크 슬러지 드레인 */}
      <path d="M 214 238 L 214 254 L 272 254" fill="none" stroke="#B45309" strokeWidth="2" />
      <polygon points="268,250 276,254 268,258" fill="#B45309" />
      <text x="280" y="257" fill="#92400E" fontSize="9.5" fontWeight="700">
        프리코트 케이크 역세 배출
      </text>

      {/* 우측 캔들 사양 콜아웃 박스 */}
      <rect x="292" y="114" width="124" height="54" rx="6" fill="#FFFFFF" stroke="#DFDCD4" />
      <text x="354" y="130" textAnchor="middle" fill="#1A2F44" fontSize="10" fontWeight="700">
        캔들 {res.candlesPerUnit} EA / 기
      </text>
      <text x="354" y="145" textAnchor="middle" fill="#475569" fontSize="9.5" fontFamily="'JetBrains Mono', monospace">
        Ø{inp.candleOD_mm}×{inp.candleLength_mm}mm
      </text>
      <text x="354" y="160" textAnchor="middle" fill="#B45309" fontSize="9" fontWeight="700">
        프리코트 {inp.precoatDosage_kgm2} kg/m²
      </text>
      <line x1="266" y1="140" x2="292" y2="140" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 2" />

      {/* 치수선 (내경 ID / 총높이 H) */}
      <line x1="150" y1="272" x2="278" y2="272" stroke="#64748B" strokeWidth="1.2" />
      <line x1="150" y1="267" x2="150" y2="277" stroke="#64748B" strokeWidth="1.2" />
      <line x1="278" y1="267" x2="278" y2="277" stroke="#64748B" strokeWidth="1.2" />
      <rect x="167" y="263" width="94" height="17" rx="3" fill="#F9FAF7" />
      <text x="214" y="275" textAnchor="middle" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        Ø {res.D_vessel_mm} mm
      </text>

      <line x1="122" y1="50" x2="122" y2="238" stroke="#64748B" strokeWidth="1.2" />
      <line x1="117" y1="50" x2="127" y2="50" stroke="#64748B" strokeWidth="1.2" />
      <line x1="117" y1="238" x2="127" y2="238" stroke="#64748B" strokeWidth="1.2" />
      <text x="116" y="198" textAnchor="end" fill="#1A2F44" fontSize="9.5" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        H {res.H_vessel_mm}mm
      </text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * 3) T-160 킬레이트 이온교환 수지탑 벡터(SVG) 단면 도면
 * ───────────────────────────────────────────────────────────────────── */
function ChelatingTowerSchematicSvg({
  inp,
  res,
}: {
  inp: IonExchangeDesignInputs;
  res: IonExchangeDesignResults;
}) {
  return (
    <svg viewBox="0 0 430 292" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="ixVesselShell" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F1F5F9" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>
        <linearGradient id="ixResinBedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CCFBF1" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#99F6E4" stopOpacity="0.88" />
        </linearGradient>
        <pattern id="ixResinBeads" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.4" fill="#0F766E" fillOpacity="0.28" />
          <circle cx="8" cy="8" r="1.4" fill="#0D9488" fillOpacity="0.24" />
        </pattern>
        <pattern id="brineGrid4" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ECEAE3" strokeWidth="0.8" />
        </pattern>
      </defs>

      <rect x="0" y="0" width="430" height="292" rx="8" fill="#F9FAF7" />
      <rect x="0" y="0" width="430" height="292" rx="8" fill="url(#brineGrid4)" />
      <rect x="0.75" y="0.75" width="428.5" height="290.5" rx="7.5" fill="none" stroke="#E5E2DC" strokeWidth="1.5" />

      {/* 상단 태그 및 탑 운전 구성 배지 */}
      <rect x="12" y="10" width="140" height="20" rx="4" fill="#1A2F44" />
      <text x="82" y="24" textAnchor="middle" fill="#FFFFFF" fontSize="10.5" fontWeight="700">
        T-160 · 킬레이트 수지탑
      </text>
      <rect x="276" y="10" width="142" height="20" rx="4" fill="#F0FDFA" stroke="#99F6E4" />
      <text x="347" y="24" textAnchor="middle" fill="#0F766E" fontSize="10" fontWeight="700">
        {inp.configMode === 'carousel_3' ? '2운전(직렬) + 1재생 [3탑]' : '1운전 + 1재생 [2탑]'}
      </text>

      {/* 일체형 압력용기 채움 (상·하부 타원형 경판 통합 — 가로 분할선 완전 제거) */}
      <path
        d="M 152 68 A 62 22 0 0 1 276 68 L 276 206 A 62 22 0 0 1 152 206 Z"
        fill="url(#ixVesselShell)"
      />

      {/* 역세 팽창 여유고(Freeboard) 점선 구간 */}
      <rect
        x="158"
        y="76"
        width="112"
        height="42"
        rx="3"
        fill="#F8FAFC"
        stroke="#94A3B8"
        strokeWidth="1.1"
        strokeDasharray="4 3"
      />

      {/* 킬레이트 이온교환 수지 충진층 (1 BV) */}
      <rect x="156" y="122" width="116" height="76" rx="2" fill="url(#ixResinBedGrad)" />
      <rect x="156" y="122" width="116" height="76" rx="2" fill="url(#ixResinBeads)" stroke="#0F766E" strokeWidth="1.4" />

      {/* 상부 분배 노즐 헤더 & 하부 스트레이너 집수판 */}
      <line x1="162" y1="70" x2="266" y2="70" stroke="#1A2F44" strokeWidth="2.2" />
      {[174, 194, 214, 234, 254].map(nx => (
        <line key={nx} x1={nx} y1="70" x2={nx} y2="75" stroke="#1A2F44" strokeWidth="1.6" />
      ))}
      <line x1="154" y1="201" x2="274" y2="201" stroke="#1A2F44" strokeWidth="2.2" strokeDasharray="5 2" />

      {/* 수지탑 본체 외곽선 + 스커트 지지대 */}
      <path
        d="M 152 68 A 62 22 0 0 1 276 68 L 276 206 A 62 22 0 0 1 152 206 Z"
        fill="none"
        stroke="#1A2F44"
        strokeWidth="2.1"
      />
      <line x1="164" y1="216" x2="158" y2="248" stroke="#475569" strokeWidth="2.4" />
      <line x1="264" y1="216" x2="270" y2="248" stroke="#475569" strokeWidth="2.4" />

      {/* 탑 내부 구역 한글 표기 (간결·선명) */}
      <text x="214" y="94" textAnchor="middle" fill="#475569" fontSize="9.5" fontWeight="700">
        역세 팽창 여유고 (+{inp.freeboardPct}%)
      </text>
      <text x="214" y="108" textAnchor="middle" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">
        H_fb = {res.H_freeboard_m} m
      </text>

      <rect x="165" y="138" width="98" height="44" rx="5" fill="#FFFFFF" fillOpacity="0.86" stroke="#0F766E" strokeWidth="1" />
      <text x="214" y="154" textAnchor="middle" fill="#0F766E" fontSize="10" fontWeight="800">
        킬레이트 수지층
      </text>
      <text x="214" y="167" textAnchor="middle" fill="#1A2F44" fontSize="9.5" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        1 BV = {res.adoptedResinVol_m3} m³
      </text>
      <text x="214" y="178" textAnchor="middle" fill="#475569" fontSize="8.8" fontFamily="'JetBrains Mono', monospace">
        Z_bed = {res.H_resinBed_m} m
      </text>

      {/* 상부 1차 브라인 / 재생제 유입 배관 */}
      <path d="M 38 58 L 214 58 L 214 46" fill="none" stroke="#0284C7" strokeWidth="2.3" />
      <line x1="214" y1="46" x2="214" y2="70" stroke="#0284C7" strokeWidth="2.3" />
      <polygon points="210,63 214,70 218,63" fill="#0284C7" />
      <text x="38" y="50" fill="#0369A1" fontSize="9.5" fontWeight="700">
        여과 브라인 유입
      </text>
      <text x="38" y="71" fill="#64748B" fontSize="8.8">
        Ca {inp.inletCa_ppm} / Mg {inp.inletMg_ppm} ppm
      </text>

      {/* 우측 상단 재생 약품 분기 표시 */}
      <path d="M 392 58 L 246 58" fill="none" stroke="#B45309" strokeWidth="1.7" strokeDasharray="4 2" />
      <text x="392" y="50" textAnchor="end" fill="#92400E" fontSize="9" fontWeight="700">
        재생 HCl · NaOH · 순수
      </text>

      {/* 하부 초고순도 정제 브라인 출구 배관 */}
      <path d="M 214 228 L 214 246 L 392 246" fill="none" stroke="#0F766E" strokeWidth="2.4" />
      <polygon points="386,242 394,246 386,250" fill="#0F766E" />
      <text x="392" y="238" textAnchor="end" fill="#0F766E" fontSize="9.5" fontWeight="700">
        2차 정제 브라인 (&lt;{inp.targetOutletTotal_ppb} ppb)
      </text>
      <text x="392" y="259" textAnchor="end" fill="#64748B" fontSize="8.8" fontFamily="'JetBrains Mono', monospace">
        {res.nozzleBrine_NPS}
      </text>

      {/* 우측 수지 운전조건 콜아웃 카드 */}
      <rect x="292" y="112" width="124" height="58" rx="6" fill="#FFFFFF" stroke="#DFDCD4" />
      <text x="354" y="128" textAnchor="middle" fill="#1A2F44" fontSize="9.5" fontWeight="700">
        SV {res.actualSV_bvh} BV/h · LV {res.actualLV_mh} m/h
      </text>
      <text x="354" y="143" textAnchor="middle" fill="#0F766E" fontSize="9.5" fontWeight="700">
        운전주기 {res.operatingCycleHours} hr
      </text>
      <text x="354" y="158" textAnchor="middle" fill="#64748B" fontSize="8.8">
        ΔP {res.dP_bed_bar} bar · {res.resinSpec.functionalGroup.split(' ')[0]}형
      </text>
      <line x1="276" y1="141" x2="292" y2="141" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 2" />

      {/* 치수선 (내경 Ø D / 쉘 높이 H) */}
      <line x1="152" y1="272" x2="276" y2="272" stroke="#64748B" strokeWidth="1.2" />
      <line x1="152" y1="267" x2="152" y2="277" stroke="#64748B" strokeWidth="1.2" />
      <line x1="276" y1="267" x2="276" y2="277" stroke="#64748B" strokeWidth="1.2" />
      <rect x="167" y="263" width="94" height="17" rx="3" fill="#F9FAF7" />
      <text x="214" y="275" textAnchor="middle" fill="#1A2F44" fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        Ø {res.D_tower_m} m
      </text>

      <line x1="126" y1="46" x2="126" y2="228" stroke="#64748B" strokeWidth="1.2" />
      <line x1="121" y1="46" x2="131" y2="46" stroke="#64748B" strokeWidth="1.2" />
      <line x1="121" y1="228" x2="131" y2="228" stroke="#64748B" strokeWidth="1.2" />
      <text x="120" y="144" textAnchor="end" fill="#1A2F44" fontSize="9.5" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        H {res.H_shell_m}m
      </text>
    </svg>
  );
}

export default function BrinePurificationDesign() {
  const streams = useBalanceStore(s => s.result.streams);
  const { setEquipmentSpecOverride, activeDesignRequest, setActiveDesignRequest } = usePFDStore();

  const presets = useMemo(() => getBrinePurifPresets(streams), [streams]);

  const [unitTab, setUnitTab] = useState<'T-030' | 'F-140' | 'T-160'>('T-160');
  const [satInp, setSatInp] = useState<SaturatorDesignInputs>(presets.saturatorPreset);
  const [fltInp, setFltInp] = useState<CandleFilterDesignInputs>(presets.candleFilterPreset);
  const [ixInp, setIxInp] = useState<IonExchangeDesignInputs>(presets.ionExchangePreset);
  const [saveToast, setSaveToast] = useState<string>('');

  // PFD 또는 장치목록에서 점프 진입 시 해당 장치 탭 자동 선택
  useEffect(() => {
    if (activeDesignRequest?.tab === 'brine' && activeDesignRequest.tag) {
      const t = activeDesignRequest.tag.toUpperCase();
      if (t.includes('030') || t.includes('010')) {
        setUnitTab('T-030');
        setSatInp(prev => ({ ...prev, tag: t.includes('010') ? 'D-010' : 'T-030' }));
      } else if (t.includes('140') || t.includes('150')) {
        setUnitTab('F-140');
      } else if (t.includes('160')) {
        setUnitTab('T-160');
      }
      setActiveDesignRequest(null);
    }
  }, [activeDesignRequest, setActiveDesignRequest]);

  // 실시간 사이징 계산 결과
  const satRes = useMemo(() => calcBrineSaturator(satInp), [satInp]);
  const fltRes = useMemo(() => calcCandleBrineFilter(fltInp), [fltInp]);
  const ixRes = useMemo(() => calcChelatingIonExchange(ixInp), [ixInp]);

  // 킬레이트 수지 모델 변경 시 권장 재생 조건 자동 로드
  const handleResinChange = (newKey: string) => {
    const spec = CHELATING_RESIN_DB.find(r => r.key === newKey);
    if (!spec) return;
    setIxInp(prev => ({
      ...prev,
      resinKey: newKey,
      hclDosage_gL: spec.hclDosage_gL,
      hclConc_wtPct: spec.hclConc_wtPct,
      hclSV_bvh: spec.hclSV_bvh,
      naohDosage_gL: spec.naohDosage_gL,
      naohConc_wtPct: spec.naohConc_wtPct,
      naohSV_bvh: spec.naohSV_bvh,
    }));
  };

  // 장치 목록(Equipment List) 저장 핸들러
  const saveSaturatorToEquipList = () => {
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const modeLabel = satInp.mode === 'upflow_saturator' ? '원염 상향류 포화조' : '중력 침전조(Clarifier)';
    const cap = `ID ${satRes.D_vessel_m}m × H ${satRes.H_total_m}m (V=${satRes.V_total_m3} m³, RT ${satRes.liquidRT_min} min)`;
    const rem = satInp.mode === 'upflow_saturator'
      ? `[${modeLabel} 설계완료] LV=${satRes.actualUpflowVel_mh} m/h, 원염용해 ${satRes.saltDissolveRate_th} t/h (${satRes.saltDissolveRate_td} t/d), 원염보유 ${satRes.saltHoldup_ton} ton (H_bed=${satRes.H_saltBed_m}m), 노즐 ${satRes.nozzleInlet_NPS}/${satRes.nozzleOutlet_NPS}`
      : `[${modeLabel} 설계완료] SLR=${satRes.actualUpflowVel_mh} m³/m²h, 직경 D=${satRes.D_vessel_m}m, 체류 ${satRes.liquidRT_min} min, 레이크 ${satRes.rakeMotor_kW} kW`;

    setEquipmentSpecOverride(satInp.tag, {
      name: satInp.mode === 'upflow_saturator' ? '포화조 (Brine Saturator)' : '침전조 (Brine Clarifier)',
      fluid: `Brine (${satInp.inletNaCl_gL}→${satInp.targetNaCl_gL} g/L)`,
      operTemp: String(satInp.temp_C),
      operPress: 'Atm',
      designTemp: String(satInp.temp_C + 20),
      designPress: 'FV / Atm',
      material: satInp.material,
      capacity: cap,
      motor: satRes.rakeMotor_kW > 0 ? `${satRes.rakeMotor_kW} kW` : '-',
      remarks: rem,
      designedAt: now,
    });
    setSaveToast(`[${satInp.tag}] ${cap} 사양이 전공정 기기목록에 반영되었습니다.`);
  };

  const saveCandleFilterToEquipList = () => {
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const qtyTot = fltInp.nOperatingUnits + fltInp.nStandbyUnits;
    const cap = `A=${fltRes.areaPerUnit_m2} m²/기 (ID ${fltRes.D_vessel_mm}×H ${fltRes.H_vessel_mm}mm, Candle Ø${fltInp.candleOD_mm}×${fltInp.candleLength_mm}L × ${fltRes.candlesPerUnit}EA)`;
    const rem = `[캔들 프리코트 설계완료] ${fltInp.nOperatingUnits}운전+${fltInp.nStandbyUnits}예비, Flux=${fltRes.actualFlux_mh} m/h, SS ${fltInp.inletSS_ppm}→${fltInp.outletSS_ppm} ppm, 주기 ${fltRes.filtrationCycle_hr} hr, 프리코트 ${fltRes.precoatPerCycle_kg} kg/회, ${fltRes.nozzleInOut_NPS}`;

    ['F-140', 'F-150'].forEach(t => {
      setEquipmentSpecOverride(t, {
        name: '캔들 타입 카본 프리코트 브라인 필터 (Brine Filter)',
        fluid: `Brine (SS ${fltInp.inletSS_ppm}→${fltInp.outletSS_ppm} ppm)`,
        qty: qtyTot,
        operTemp: String(fltInp.temp_C),
        operPress: '3.5',
        designTemp: '85',
        designPress: '6.0',
        material: fltInp.material,
        capacity: cap,
        motor: `Precoat ${fltRes.precoatPumpFlow_m3h} m³/h`,
        remarks: rem,
        designedAt: now,
      });
    });
    setSaveToast(`[F-140] ${cap} 사양이 전공정 기기목록에 반영되었습니다.`);
  };

  const saveIonExchangeToEquipList = () => {
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const cap = `ID ${ixRes.D_tower_m}m × H ${ixRes.H_shell_m}m (Resin ${ixRes.adoptedResinVol_m3} m³/탑, Z_bed=${ixRes.H_resinBed_m}m, SV=${ixRes.actualSV_bvh} BV/h)`;
    const rem = `[킬레이트 수지탑 설계완료] ${ixRes.resinSpec.model} (${ixRes.nTotalTowers}탑), 재생주기 ${ixRes.operatingCycleHours}h (재생 ${ixRes.totalRegenTime_min}분: PW ${ixRes.totalRegenWater_m3}m³, 35%HCl ${ixRes.hcl35Commercial_kg}kg, 32%NaOH ${ixRes.naoh32Commercial_kg}kg/회)`;
    setEquipmentSpecOverride('T-160', {
      name: '킬레이트 이온교환수지탑 (Chelating IX Tower)',
      fluid: `Brine (Ca+Mg < ${ixInp.targetOutletTotal_ppb} ppb)`,
      qty: ixRes.nTotalTowers,
      operTemp: String(ixInp.temp_C),
      operPress: '4.0',
      designTemp: '80',
      designPress: '7.0',
      material: 'FRP + Butyl/EPDM Rubber Lining',
      capacity: cap,
      motor: `Regen ${ixRes.totalRegenTime_hr} hr/회`,
      remarks: rem,
      designedAt: now,
    });
    setSaveToast(`[T-160] ${cap} 및 5단계 재생 스케줄 사양이 전공정 기기목록에 반영되었습니다.`);
  };

  const saveAllThreeUnits = () => {
    saveSaturatorToEquipList();
    saveCandleFilterToEquipList();
    saveIonExchangeToEquipList();
    setSaveToast('[T-030 포화조 · F-140 캔들 브라인 필터 · T-160 킬레이트 수지탑] 3대 정제 장치 사양이 모두 기기목록에 반영되었습니다.');
  };

  // 우측 핵심 사양 요약 데이터 구성 (기존 캔버스 fillText를 대체하는 정돈된 엔지니어링 스펙 시트)
  const activeSummaryMeta = useMemo(() => {
    if (unitTab === 'T-030') {
      const isSat = satInp.mode === 'upflow_saturator';
      const items: SpecSummaryItem[] = [
        {
          label: '조 내경 × 총 높이',
          value: `Ø ${satRes.D_vessel_mm.toLocaleString()} mm × H ${satRes.H_total_m} m`,
          sub: `직동부 ${satRes.H_cylinder_m} m + 하부 콘 ${satRes.H_cone_m} m (${satRes.D_vessel_m} m ID)`,
          highlight: 'navy',
        },
        {
          label: '유효 용적 · 액 체류시간',
          value: `V = ${satRes.V_total_m3} m³ / ${satRes.liquidRT_min} min`,
          sub: `처리 유량 ${satRes.volFlow_m3h} m³/h (${satInp.brineFlow_kgh.toLocaleString()} kg/h)`,
        },
        {
          label: isSat ? '실제 상향류 유속 (LV)' : '실제 표면부하율 (SLR)',
          value: `${satRes.actualUpflowVel_mh} m/h`,
          sub: `유효 수평 단면적 A = ${satRes.crossArea_m2} m²`,
          highlight: 'teal',
        },
        {
          label: '원염 용해 소비량',
          value: `${satRes.saltDissolveRate_th} ton/h (${satRes.saltDissolveRate_td} t/d)`,
          sub: `농도 상승 ${satInp.inletNaCl_gL} → ${satInp.targetNaCl_gL} g/L @ ${satInp.temp_C}°C`,
          highlight: 'amber',
        },
        {
          label: isSat ? '원염 적재 보유량 · 층고' : '슬러지 농축층 · 레이크 동력',
          value: isSat
            ? `${satRes.saltHoldup_ton} ton (H_bed ${satRes.H_saltBed_m} m)`
            : `농축층 ${satRes.H_saltBed_m} m / 구동 ${satRes.rakeMotor_kW} kW`,
          sub: `버퍼 기준 ${satInp.saltRetention_hr} hr 유지`,
        },
        {
          label: '상부 청징 구간 · 여유고',
          value: `청징 ${satRes.H_clarification_m} m / 여유고 ${satInp.freeboard_m} m`,
          sub: `하부 콘 경사각 ${isSat ? satInp.coneAngle_deg : 15}°`,
        },
      ];
      return {
        tag: satInp.tag,
        sectionBadge: '100-1 원염 용해 · 1차 정제',
        title: isSat ? '원염 충진층 상향류 포화조 설계 사양 요약' : '1차 중력 침강 정제조(Clarifier) 설계 사양 요약',
        subtitle: `운전 온도 ${satInp.temp_C}°C · 밀도 ${satInp.brineDensity_kgm3} kg/m³ · 대기압(Atm) 운전`,
        nozzleText: `유입 ${satRes.nozzleInlet_NPS}  |  오버플로우 출구 ${satRes.nozzleOutlet_NPS}`,
        materialText: satInp.material,
        warningCount: satRes.warnings.length,
        items,
      };
    }

    if (unitTab === 'F-140') {
      const items: SpecSummaryItem[] = [
        {
          label: '1기당 여과면적 · 총 제공면적',
          value: `${fltRes.areaPerUnit_m2} m²/기 (총 ${fltRes.totalAreaProv_m2} m²)`,
          sub: `상시 운전 ${fltInp.nOperatingUnits}기 + 예비/역세 대기 ${fltInp.nStandbyUnits}기`,
          highlight: 'navy',
        },
        {
          label: '캔들 엘리먼트 구성 사양',
          value: `Ø${fltInp.candleOD_mm} × L ${fltInp.candleLength_mm} mm × ${fltRes.candlesPerUnit} EA/기`,
          sub: `단일 캔들 면적 ${fltRes.areaPerCandle_m2} m² · 삼각 배열 피치 ${fltInp.candlePitch_mm} mm`,
        },
        {
          label: '필터 베셀 규격 (ID × H)',
          value: `Ø ${fltRes.D_vessel_mm.toLocaleString()} × H ${fltRes.H_vessel_mm.toLocaleString()} mm`,
          sub: `1기당 처리 유량 ${fltRes.volFlowPerUnit_m3h} m³/h (총 ${fltRes.volFlowTotal_m3h} m³/h)`,
          highlight: 'navy',
        },
        {
          label: '실제 여과 유속 (Flux) · SS 제거',
          value: `${fltRes.actualFlux_mh} m³/m²·h`,
          sub: `부유물(SS) ${fltInp.inletSS_ppm} → ${fltInp.outletSS_ppm} ppm (포집 ${fltRes.ssRemoved_kgh} kg/h)`,
          highlight: 'teal',
        },
        {
          label: '프리코트 도포량 · 순환펌프',
          value: `${fltRes.precoatPerCycle_kg} kg/회 · ${fltRes.precoatPumpFlow_m3h} m³/h`,
          sub: `α-Cellulose + 분말활성탄 도포율 ${fltInp.precoatDosage_kgm2} kg/m²`,
          highlight: 'amber',
        },
        {
          label: '여과 운전주기 · 차압 · 역세수량',
          value: `${fltRes.filtrationCycle_hr} hr / ΔP ${fltRes.dP_initial_bar}→${fltRes.dP_terminal_bar} bar`,
          sub: `1회 케이크 역세 배출 소요수량 ${fltRes.backwashWater_m3} m³/회`,
        },
      ];
      return {
        tag: fltInp.tag,
        sectionBadge: '100-1 미세 부유물(SS) 여과',
        title: '캔들 타입 카본 프리코트 브라인 필터 설계 사양 요약',
        subtitle: `운전 ${fltInp.temp_C}°C · 3.5 kgf/cm²G (설계 6.0 kgf/cm²G) · 최대 케이크 ${fltInp.maxCakeThickness_mm} mm`,
        nozzleText: `브라인 입·출구 배관 ${fltRes.nozzleInOut_NPS}`,
        materialText: fltInp.material,
        warningCount: fltRes.warnings.length,
        items,
      };
    }

    const items: SpecSummaryItem[] = [
      {
        label: '수지탑 규격 (내경 × 직동부 높이)',
        value: `Ø ${ixRes.D_tower_mm.toLocaleString()} mm (${ixRes.D_tower_m} m) × H ${ixRes.H_shell_m} m`,
        sub: `${ixRes.nTotalTowers}탑 시스템 (${ixInp.configMode === 'carousel_3' ? '2운전 Lead-Lag + 1재생' : '1운전 + 1재생 교대'})`,
        highlight: 'navy',
      },
      {
        label: '1탑당 수지 충진량 · 층고',
        value: `1 BV = ${ixRes.adoptedResinVol_m3} m³ (Z_bed ${ixRes.H_resinBed_m} m)`,
        sub: `역세 팽창 여유고 ${ixRes.H_freeboard_m} m (+${ixInp.freeboardPct}%) · 전환팽창 +${ixRes.resinSpec.swellingNaPct}%`,
        highlight: 'teal',
      },
      {
        label: '운전 공간속도(SV) · 선속도(LV)',
        value: `SV ${ixRes.actualSV_bvh} BV/h  |  LV ${ixRes.actualLV_mh} m/h`,
        sub: `수지층 차압 ΔP = ${ixRes.dP_bed_bar} bar (제조사 권장 SV ${ixRes.resinSpec.recSV_min_bvh}~${ixRes.resinSpec.recSV_max_bvh})`,
      },
      {
        label: '2가 양이온 부하 · 출구 목표 순도',
        value: `${ixRes.totalIonLoad_eqh} eq/h (${ixRes.totalIonLoad_eqd} eq/d)`,
        sub: `전해조 멤브레인 보호 기준 Ca+Mg+Sr < ${ixInp.targetOutletTotal_ppb} ppb`,
      },
      {
        label: '운전 재생주기 · 이론 파과한계',
        value: `주기 ${ixRes.operatingCycleHours} hr (이론 한계 ${ixRes.maxBreakthroughHours} hr)`,
        sub: `일평균 재생 빈도 ${ixRes.regenerationsPerDay} 회/일`,
        highlight: 'teal',
      },
      {
        label: '1회 재생 소요시간 · 약품/순수량',
        value: `${ixRes.totalRegenTime_min} 분 | 순수 ${ixRes.totalRegenWater_m3} m³/회`,
        sub: `35% HCl ${ixRes.hcl35Commercial_kg} kg/회 · 32% NaOH ${ixRes.naoh32Commercial_kg} kg/회`,
        highlight: 'amber',
      },
    ];
    return {
      tag: 'T-160',
      sectionBadge: '100-2 킬레이트 2차 초정밀 정제',
      title: '킬레이트 이온교환 수지탑 상세 설계 사양 요약',
      subtitle: `${ixRes.resinSpec.maker} · ${ixRes.resinSpec.model} (${ixRes.resinSpec.functionalGroup})`,
      nozzleText: `브라인 본관 ${ixRes.nozzleBrine_NPS}  |  재생 약품·순수 배관 ${ixRes.nozzleRegen_NPS}`,
      materialText: 'FRP + Butyl / EPDM 고무 라이닝 (내산·내알칼리 사양)',
      warningCount: ixRes.warnings.length,
      items,
    };
  }, [unitTab, satInp, satRes, fltInp, fltRes, ixInp, ixRes]);

  return (
    <div style={{ maxWidth: 1420, margin: '0 auto' }}>
      {/* ── 상단 3대 브라인 정제 장치 선택 바 & 일괄 반영 툴바 (NewtNote 시그니처 톤) ── */}
      <div
        style={{
          ...card,
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: '#1A2F44',
              background: '#F6F7F2',
              border: '1px solid #E5E2DC',
              borderRadius: 5,
              padding: '5px 9px',
            }}
          >
            100 브라인 정제 공정
          </span>
          {[
            { key: 'T-030' as const, code: 'T-030', label: '원염 포화조 · 침전조' },
            { key: 'F-140' as const, code: 'F-140', label: '캔들 프리코트 브라인 필터' },
            { key: 'T-160' as const, code: 'T-160', label: '킬레이트 이온교환 수지탑' },
          ].map(btn => {
            const active = unitTab === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => setUnitTab(btn.key)}
                style={{
                  padding: '7px 13px',
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                  border: `1px solid ${active ? '#1A2F44' : '#DFDCD4'}`,
                  background: active ? '#1A2F44' : '#F6F7F2',
                  color: active ? '#FFFFFF' : '#2C353E',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: active ? 'rgba(255,255,255,0.18)' : '#FFFFFF',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    border: active ? 'none' : '1px solid #E5E2DC',
                  }}
                >
                  {btn.code}
                </span>
                <span>{btn.label}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={saveAllThreeUnits}
          style={{
            padding: '8px 14px',
            borderRadius: 7,
            fontSize: 11.5,
            fontWeight: 700,
            cursor: 'pointer',
            border: '1px solid #0F766E',
            background: '#0F766E',
            color: '#FFFFFF',
          }}
        >
          3대 정제 장치 일괄 설계 → 기기목록 반영
        </button>
      </div>

      {saveToast && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: 14,
            borderRadius: 8,
            background: '#F0FDFA',
            border: '1px solid #99F6E4',
            color: '#134E4A',
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>✓ {saveToast}</span>
          <button
            onClick={() => setSaveToast('')}
            style={{ background: 'transparent', border: 'none', color: '#52525B', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 상단 통합 엔지니어링 단면 도면(SVG) & 핵심 설계 사양 시트 ── */}
      <div
        style={{
          ...card,
          padding: '18px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
          gap: 20,
          alignItems: 'stretch',
        }}
      >
        {/* 좌측: 벡터(SVG) 장치 단면 및 배관/치수 도면 */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {unitTab === 'T-030' && <SaturatorSchematicSvg inp={satInp} res={satRes} />}
          {unitTab === 'F-140' && <CandleFilterSchematicSvg inp={fltInp} res={fltRes} />}
          {unitTab === 'T-160' && <ChelatingTowerSchematicSvg inp={ixInp} res={ixRes} />}
        </div>

        {/* 우측: 정돈된 한글 엔지니어링 데이터시트 요약 패널 */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: "'JetBrains Mono', monospace",
                    padding: '2px 8px',
                    borderRadius: 5,
                    background: '#1A2F44',
                    color: '#FFFFFF',
                  }}
                >
                  {activeSummaryMeta.tag}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 5,
                    background: '#F6F7F2',
                    border: '1px solid #E5E2DC',
                    color: '#52525B',
                  }}
                >
                  {activeSummaryMeta.sectionBadge}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '2px 9px',
                  borderRadius: 999,
                  background: activeSummaryMeta.warningCount === 0 ? '#F0FDFA' : '#FFFBEB',
                  border: `1px solid ${activeSummaryMeta.warningCount === 0 ? '#99F6E4' : '#FDE68A'}`,
                  color: activeSummaryMeta.warningCount === 0 ? '#0F766E' : '#B45309',
                }}
              >
                {activeSummaryMeta.warningCount === 0 ? '✓ 설계 기준 충족' : `검토 권고 ${activeSummaryMeta.warningCount}건`}
              </span>
            </div>

            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1A2F44', letterSpacing: '-0.01em' }}>
              {activeSummaryMeta.title}
            </div>
            <div style={{ fontSize: 11.5, color: '#52525B', marginTop: 2 }}>
              {activeSummaryMeta.subtitle}
            </div>
          </div>

          {/* 2열 × 3행 핵심 사양 그리드 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {activeSummaryMeta.items.map((item, idx) => {
              const valColor =
                item.highlight === 'teal'
                  ? '#0F766E'
                  : item.highlight === 'amber'
                    ? '#B45309'
                    : '#1A2F44';
              return (
                <div
                  key={idx}
                  style={{
                    background: '#F9FAF7',
                    border: '1px solid #E5E2DC',
                    borderRadius: 7,
                    padding: '8px 11px',
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', marginBottom: 3 }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 800,
                      color: valColor,
                      fontFamily: "'JetBrains Mono', 'Pretendard', monospace",
                    }}
                  >
                    {item.value}
                  </div>
                  {item.sub && (
                    <div style={{ fontSize: 10, color: '#52525B', marginTop: 2 }}>
                      {item.sub}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 하단 배관 규격 및 재질 요약 바 */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 7,
              background: '#F6F7F2',
              border: '1px solid #E5E2DC',
              fontSize: 11,
              color: '#2C353E',
            }}
          >
            <div>
              <strong style={{ color: '#1A2F44' }}>ANSI 배관 노즐:</strong>{' '}
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{activeSummaryMeta.nozzleText}</span>
            </div>
            <div>
              <strong style={{ color: '#1A2F44' }}>선정 재질:</strong> {activeSummaryMeta.materialText}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          UNIT 1: T-030 (및 D-010) 브라인 포화조 / 침전조 사이징
         ===================================================================== */}
      {unitTab === 'T-030' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18 }}>
          {/* 좌측 입력 패널 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
              {satInp.tag} 브라인 포화조 · 침전조 설계 조건 입력
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>대상 장치 태그</label>
                <select
                  style={selectStyle}
                  value={satInp.tag}
                  onChange={e => setSatInp({ ...satInp, tag: e.target.value })}
                >
                  <option value="T-030">T-030 (포화조 / 침전정제조)</option>
                  <option value="D-010">D-010 (1차 원염 포화조)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>설계 운전 모드</label>
                <select
                  style={selectStyle}
                  value={satInp.mode}
                  onChange={e => {
                    const m = e.target.value as SaturatorDesignInputs['mode'];
                    setSatInp({
                      ...satInp,
                      mode: m,
                      upflowVel_mh: m === 'upflow_saturator' ? 7.5 : 0.65,
                      coneAngle_deg: m === 'upflow_saturator' ? 55 : 15,
                    });
                  }}
                >
                  <option value="upflow_saturator">원염 충진층 상향류 포화조 (Saturator)</option>
                  <option value="clarifier_settler">중력 침강 정제조 (Clarifier / Settler)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>브라인 질량유량 (kg/h)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={satInp.brineFlow_kgh}
                  onChange={e => setSatInp({ ...satInp, brineFlow_kgh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>운전 온도 (°C)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={satInp.temp_C}
                  onChange={e => setSatInp({ ...satInp, temp_C: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>입구 희박염수 NaCl (g/L)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={satInp.inletNaCl_gL}
                  onChange={e => setSatInp({ ...satInp, inletNaCl_gL: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>목표 포화염수 NaCl (g/L)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={satInp.targetNaCl_gL}
                  onChange={e => setSatInp({ ...satInp, targetNaCl_gL: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>
                  {satInp.mode === 'upflow_saturator' ? '설계 상향 유속 LV (m/h, 권장 6~10)' : '표면부하율 SLR (m³/m²·h, 권장 0.5~1.0)'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={satInp.upflowVel_mh}
                  onChange={e => setSatInp({ ...satInp, upflowVel_mh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>원염 적재 버퍼 시간 (hr, 권장 6~12)</label>
                <input
                  type="number"
                  step="0.5"
                  style={inpStyle}
                  value={satInp.saltRetention_hr}
                  onChange={e => setSatInp({ ...satInp, saltRetention_hr: +e.target.value })}
                />
              </div>
            </div>

            <button
              onClick={saveSaturatorToEquipList}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '10px',
                borderRadius: 7,
                border: '1px solid #1A2F44',
                background: '#1A2F44',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              [{satInp.tag}] 설계 결과 → 전공정 기기목록 반영
            </button>
          </div>

          {/* 우측 결과 패널 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
              [{satInp.tag}] 포화조 · 침전조 사이징 계산 결과
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={kpiBox('#1A2F44')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>조 내경 × 총 높이</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  Ø{satRes.D_vessel_m}m × {satRes.H_total_m}m
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  직동부 {satRes.H_cylinder_m}m + 콘 {satRes.H_cone_m}m
                </div>
              </div>
              <div style={kpiBox('#B45309')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>원염 용해 소비량</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#B45309', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {satRes.saltDissolveRate_th} t/h
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  일일 {satRes.saltDissolveRate_td} ton/day 원염 투입
                </div>
              </div>
              <div style={kpiBox('#0F766E')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>유효 용적 · 액 체류시간</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0F766E', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {satRes.V_total_m3} m³
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  액 체류 {satRes.liquidRT_min} min (유량 {satRes.volFlow_m3h} m³/h)
                </div>
              </div>
              <div style={kpiBox('#1A2F44')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>원염 충진층 보유량</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {satRes.saltHoldup_ton} ton
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  충진층 높이 H_bed = {satRes.H_saltBed_m} m
                </div>
              </div>
            </div>

            {satRes.warnings.map((w, idx) => (
              <div
                key={idx}
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  color: '#92400E',
                  fontSize: 11.5,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          UNIT 2: F-140 캔들 타입 카본 프리코트 브라인 필터 사이징
         ===================================================================== */}
      {unitTab === 'F-140' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18 }}>
          {/* 좌측 입력 패널 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
              F-140 캔들 타입 프리코트 브라인 필터 (SS 제거용) 설계 조건 입력
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>브라인 유량 (kg/h)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={fltInp.brineFlow_kgh}
                  onChange={e => setFltInp({ ...fltInp, brineFlow_kgh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>여과 유속 Flux (m³/m²·h, 권장 1.0~1.5)</label>
                <input
                  type="number"
                  step="0.05"
                  style={inpStyle}
                  value={fltInp.filtrationFlux_mh}
                  onChange={e => setFltInp({ ...fltInp, filtrationFlux_mh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>입구 SS 농도 (ppm, 침전조 후단)</label>
                <input
                  type="number"
                  step="1"
                  style={inpStyle}
                  value={fltInp.inletSS_ppm}
                  onChange={e => setFltInp({ ...fltInp, inletSS_ppm: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>출구 목표 SS 농도 (ppm, &lt;0.5)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={fltInp.outletSS_ppm}
                  onChange={e => setFltInp({ ...fltInp, outletSS_ppm: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>캔들 외경 OD (mm)</label>
                <select
                  style={selectStyle}
                  value={fltInp.candleOD_mm}
                  onChange={e => setFltInp({ ...fltInp, candleOD_mm: +e.target.value })}
                >
                  <option value={60}>Ø60 mm (슬림 캔들)</option>
                  <option value={70}>Ø70 mm (전해공장 표준 캔들)</option>
                  <option value={89}>Ø89 mm (대용량 캔들)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>캔들 유효 길이 L (mm)</label>
                <select
                  style={selectStyle}
                  value={fltInp.candleLength_mm}
                  onChange={e => setFltInp({ ...fltInp, candleLength_mm: +e.target.value })}
                >
                  <option value={1200}>1,200 mm</option>
                  <option value={1500}>1,500 mm (표준)</option>
                  <option value={1800}>1,800 mm</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>상시 운전 기수 + 예비 기수</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    style={inpStyle}
                    value={fltInp.nOperatingUnits}
                    onChange={e => setFltInp({ ...fltInp, nOperatingUnits: +e.target.value })}
                    title="상시 운전 기수"
                  />
                  <input
                    type="number"
                    min={0}
                    max={3}
                    style={inpStyle}
                    value={fltInp.nStandbyUnits}
                    onChange={e => setFltInp({ ...fltInp, nStandbyUnits: +e.target.value })}
                    title="예비 기수"
                  />
                </div>
              </div>
              <div>
                <label style={labelSt}>프리코트 도포량 (kg/m², Cellulose+PAC)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={fltInp.precoatDosage_kgm2}
                  onChange={e => setFltInp({ ...fltInp, precoatDosage_kgm2: +e.target.value })}
                />
              </div>
            </div>

            <button
              onClick={saveCandleFilterToEquipList}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '10px',
                borderRadius: 7,
                border: '1px solid #1A2F44',
                background: '#1A2F44',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              [F-140] 캔들 브라인 필터 설계 결과 → 전공정 기기목록 반영
            </button>
          </div>

          {/* 우측 결과 패널 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
              [F-140] 캔들 타입 프리코트 카본 필터 사이징 계산 결과
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={kpiBox('#1A2F44')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>1기당 여과면적 · 캔들 수</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {fltRes.areaPerUnit_m2} m² ({fltRes.candlesPerUnit} EA)
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  운전 {fltInp.nOperatingUnits}기 총 {fltRes.totalAreaProv_m2} m² (예비 {fltInp.nStandbyUnits}기)
                </div>
              </div>
              <div style={kpiBox('#0F766E')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>베셀 내경 × 총 높이</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0F766E', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  Ø{fltRes.D_vessel_mm} × {fltRes.H_vessel_mm} mm
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  실제 여과 유속 {fltRes.actualFlux_mh} m³/m²·h
                </div>
              </div>
              <div style={kpiBox('#B45309')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>프리코트제 · 순환펌프</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#B45309', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {fltRes.precoatPerCycle_kg} kg/회
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  프리코트 순환유량 {fltRes.precoatPumpFlow_m3h} m³/h
                </div>
              </div>
              <div style={kpiBox('#1A2F44')}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>여과 운전주기 · 차압</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                  {fltRes.filtrationCycle_hr} hr/주기
                </div>
                <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                  ΔP {fltRes.dP_initial_bar} → {fltRes.dP_terminal_bar} bar | 역세수 {fltRes.backwashWater_m3} m³
                </div>
              </div>
            </div>

            {fltRes.warnings.map((w, idx) => (
              <div
                key={idx}
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  color: '#92400E',
                  fontSize: 11.5,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          UNIT 3: T-160 킬레이트 이온교환수지탑 + 제조사 기준 5단계 재생 스케줄러
         ===================================================================== */}
      {unitTab === 'T-160' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18 }}>
          {/* 좌측 입력 패널 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
              T-160 킬레이트 이온교환 수지탑 · 재생 주기 설정
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>킬레이트 수지 제조사 및 모델 선택 (상용 카탈로그 DB)</label>
              <select
                style={{
                  ...selectStyle,
                  background: '#FFFFFF',
                  borderColor: '#1A2F44',
                  color: '#1A2F44',
                  fontWeight: 700,
                }}
                value={ixInp.resinKey}
                onChange={e => handleResinChange(e.target.value)}
              >
                {CHELATING_RESIN_DB.map(r => (
                  <option key={r.key} value={r.key} style={{ color: '#1A2F44', background: '#FFFFFF' }}>
                    [{r.maker}] {r.model} — {r.functionalGroup} (유효 {r.operCapacity_eqL} eq/L)
                  </option>
                ))}
              </select>
              <div
                style={{
                  fontSize: 10.5,
                  color: '#475569',
                  marginTop: 5,
                  padding: '5px 9px',
                  borderRadius: 5,
                  background: '#F6F7F2',
                  border: '1px solid #E5E2DC',
                }}
              >
                수지 특성: {ixRes.resinSpec.notes}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>운전 탑 구성 방식</label>
                <select
                  style={selectStyle}
                  value={ixInp.configMode}
                  onChange={e => setIxInp({ ...ixInp, configMode: e.target.value as IonExchangeDesignInputs['configMode'] })}
                >
                  <option value="carousel_3">2운전(Lead-Lag) + 1재생 = 3탑</option>
                  <option value="lead_lag_2">1운전 + 1재생/교대 = 2탑</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>브라인 유량 (kg/h)</label>
                <input
                  type="number"
                  style={inpStyle}
                  value={ixInp.brineFlow_kgh}
                  onChange={e => setIxInp({ ...ixInp, brineFlow_kgh: +e.target.value })}
                />
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#1A2F44', margin: '12px 0 6px' }}>
              유입 브라인 2가 양이온 농도 (1차 여과 후 입구 기준, ppm = mg/L)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>Ca²⁺ (ppm)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={ixInp.inletCa_ppm}
                  onChange={e => setIxInp({ ...ixInp, inletCa_ppm: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>Mg²⁺ (ppm)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={ixInp.inletMg_ppm}
                  onChange={e => setIxInp({ ...ixInp, inletMg_ppm: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>Sr²⁺ (ppm)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={ixInp.inletSr_ppm}
                  onChange={e => setIxInp({ ...ixInp, inletSr_ppm: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>Ba²⁺ (ppm)</label>
                <input
                  type="number"
                  step="0.1"
                  style={inpStyle}
                  value={ixInp.inletBa_ppm}
                  onChange={e => setIxInp({ ...ixInp, inletBa_ppm: +e.target.value })}
                />
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#1A2F44', margin: '12px 0 6px' }}>
              공간속도(SV) · 재생 주기 · 재생 약품 조건
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelSt}>설계 공간속도 SV (BV/h, 권장 15~30)</label>
                <input
                  type="number"
                  step="1"
                  style={inpStyle}
                  value={ixInp.designSV_bvh}
                  onChange={e => setIxInp({ ...ixInp, designSV_bvh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>목표 재생 주기 (hr, 표준 24~48h)</label>
                <input
                  type="number"
                  step="2"
                  style={inpStyle}
                  value={ixInp.targetCycleHours}
                  onChange={e => setIxInp({ ...ixInp, targetCycleHours: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>설계 선속도 LV (m/h, 권장 20~32)</label>
                <input
                  type="number"
                  step="1"
                  style={inpStyle}
                  value={ixInp.designLV_mh}
                  onChange={e => setIxInp({ ...ixInp, designLV_mh: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>역세 팽창 여유율 Freeboard (%)</label>
                <input
                  type="number"
                  step="5"
                  style={inpStyle}
                  value={ixInp.freeboardPct}
                  onChange={e => setIxInp({ ...ixInp, freeboardPct: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>HCl 재생 도즈 (g 100% HCl/L-수지)</label>
                <input
                  type="number"
                  step="5"
                  style={inpStyle}
                  value={ixInp.hclDosage_gL}
                  onChange={e => setIxInp({ ...ixInp, hclDosage_gL: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>HCl 농도 (wt%) / 주입 SV (BV/h)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    step="0.5"
                    style={inpStyle}
                    value={ixInp.hclConc_wtPct}
                    onChange={e => setIxInp({ ...ixInp, hclConc_wtPct: +e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.5"
                    style={inpStyle}
                    value={ixInp.hclSV_bvh}
                    onChange={e => setIxInp({ ...ixInp, hclSV_bvh: +e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label style={labelSt}>NaOH 컨디셔닝 도즈 (g 100%/L-수지)</label>
                <input
                  type="number"
                  step="5"
                  style={inpStyle}
                  value={ixInp.naohDosage_gL}
                  onChange={e => setIxInp({ ...ixInp, naohDosage_gL: +e.target.value })}
                />
              </div>
              <div>
                <label style={labelSt}>NaOH 농도 (wt%) / 주입 SV (BV/h)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    step="0.5"
                    style={inpStyle}
                    value={ixInp.naohConc_wtPct}
                    onChange={e => setIxInp({ ...ixInp, naohConc_wtPct: +e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.5"
                    style={inpStyle}
                    value={ixInp.naohSV_bvh}
                    onChange={e => setIxInp({ ...ixInp, naohSV_bvh: +e.target.value })}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={saveIonExchangeToEquipList}
              style={{
                width: '100%',
                marginTop: 6,
                padding: '10px',
                borderRadius: 7,
                border: '1px solid #1A2F44',
                background: '#1A2F44',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              [T-160] 수지탑 · 재생 스케줄 → 전공정 기기목록 반영
            </button>
          </div>

          {/* 우측 결과 및 5단계 재생 스케줄 테이블 */}
          <div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #EFECE5' }}>
                [T-160] 킬레이트 수지탑 사이징 · 이온 부하 해석 ({ixRes.resinSpec.model})
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12, marginBottom: 14 }}>
                <div style={kpiBox('#1A2F44')}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>수지탑 규격 (ID × H)</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                    Ø{ixRes.D_tower_m}m × {ixRes.H_shell_m}m
                  </div>
                  <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                    수지층고 Z={ixRes.H_resinBed_m}m + 여유고 {ixRes.H_freeboard_m}m
                  </div>
                </div>
                <div style={kpiBox('#0F766E')}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>1탑당 수지 충진량 (1 BV)</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#0F766E', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                    {ixRes.adoptedResinVol_m3} m³/탑
                  </div>
                  <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                    SV={ixRes.actualSV_bvh} BV/h | LV={ixRes.actualLV_mh} m/h
                  </div>
                </div>
                <div style={kpiBox('#1A2F44')}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>운전 재생주기 · 파과한계</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#1A2F44', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                    {ixRes.operatingCycleHours} hr (일 {ixRes.regenerationsPerDay}회)
                  </div>
                  <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                    이론 한계 {ixRes.maxBreakthroughHours} hr ({ixRes.totalIonLoad_eqh} eq/h)
                  </div>
                </div>
                <div style={kpiBox('#B45309')}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>1회 재생 총 소요 시간</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#B45309', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                    {ixRes.totalRegenTime_min} 분 ({ixRes.totalRegenTime_hr} hr)
                  </div>
                  <div style={{ fontSize: 10, color: '#52525B', marginTop: 3 }}>
                    순수 {ixRes.totalRegenWater_m3} m³/회 (일일 {ixRes.dailyPW_m3d} m³/d)
                  </div>
                </div>
              </div>

              {ixRes.warnings.map((w, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 6,
                    background: '#FFFBEB',
                    border: '1px solid #FDE68A',
                    color: '#92400E',
                    fontSize: 11.5,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  {w}
                </div>
              ))}
            </div>

            {/* 5단계 재생 시퀀스 상세 테이블 */}
            <div style={card}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1A2F44' }}>
                  T-160 킬레이트 수지탑 5단계 자동 재생(Regeneration) 시퀀스 유량 및 시간표
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: '#52525B',
                    fontFamily: "'JetBrains Mono', monospace",
                    background: '#F6F7F2',
                    border: '1px solid #E5E2DC',
                    padding: '3px 8px',
                    borderRadius: 5,
                  }}
                >
                  1 BV = {ixRes.adoptedResinVol_m3} m³ | 일일 {ixRes.regenerationsPerDay}회: 35% HCl {ixRes.dailyHCl35_kgd} kg/d · 32% NaOH {ixRes.dailyNaOH32_kgd} kg/d
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: '#F6F7F2', color: '#1A2F44', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', fontWeight: 800 }}>단계</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', fontWeight: 800 }}>재생 공정 단계</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', fontWeight: 800 }}>주입 유체</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', textAlign: 'right', fontWeight: 800 }}>SV (BV/h)</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', textAlign: 'right', fontWeight: 800 }}>주입량 (BV)</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', textAlign: 'right', fontWeight: 800 }}>유량 (m³/h)</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', textAlign: 'right', fontWeight: 800 }}>시간 (분)</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', textAlign: 'right', fontWeight: 800 }}>액량 (m³/회)</th>
                      <th style={{ padding: '8px 10px', borderBottom: '2px solid #DFDCD4', fontWeight: 800 }}>비고 · 원액 소모량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ixRes.regSteps.map((st, idx) => (
                      <tr
                        key={st.stepNo}
                        style={{
                          borderBottom: '1px solid #EFECE5',
                          background: idx % 2 === 1 ? '#FBFBFA' : '#FFFFFF',
                        }}
                      >
                        <td style={{ padding: '9px 10px', fontWeight: 800, color: '#0F766E', fontFamily: "'JetBrains Mono', monospace" }}>
                          #{st.stepNo}
                        </td>
                        <td style={{ padding: '9px 10px', fontWeight: 700, color: '#1A2F44' }}>{st.stepName}</td>
                        <td style={{ padding: '9px 10px', color: '#2C353E' }}>{st.fluidName}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: '#2C353E' }}>
                          {st.sv_bvh}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: '#2C353E' }}>
                          {st.bedVolumes_BV} BV
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#1A2F44', fontFamily: "'JetBrains Mono', monospace" }}>
                          {st.flowRate_m3h} m³/h
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#1A2F44', fontFamily: "'JetBrains Mono', monospace" }}>
                          {st.duration_min} 분
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: '#2C353E' }}>
                          {st.totalVolume_m3} m³
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: 11, color: '#52525B' }}>{st.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F0FDFA', borderTop: '2px solid #99F6E4', fontWeight: 800, color: '#1A2F44' }}>
                      <td colSpan={6} style={{ padding: '9px 10px' }}>
                        합계 (1회 전체 재생 시퀀스 총 소요 시간 및 총 액량)
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: '#0F766E', fontFamily: "'JetBrains Mono', monospace" }}>
                        {ixRes.totalRegenTime_min} 분 ({ixRes.totalRegenTime_hr} h)
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: '#0F766E', fontFamily: "'JetBrains Mono', monospace" }}>
                        {ixRes.totalRegenWater_m3} m³/회
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: 11, fontWeight: 700, color: '#134E4A' }}>
                        35% HCl {ixRes.hcl35Commercial_kg} kg/회 · 32% NaOH {ixRes.naoh32Commercial_kg} kg/회
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { FlowUnitType } from '@/lib/calculations/flowsheetSolver';

export interface ClassicBlockNodeData {
  tag: string;
  modelName: string;
  unitType: FlowUnitType;
  subLabel?: string;
  status?: 'ok' | 'error' | 'warn' | 'idle';
  statusTitle?: string;
  liveMetric?: string;
}

export interface ClassicModelCatalogItem {
  unitType: FlowUnitType;
  modelName: string;
  koName: string;
  category:
    | 'mix_split'
    | 'separators'
    | 'heat_exchangers'
    | 'columns'
    | 'reactors'
    | 'pressure'
    | 'electro_special'
    | 'io';
  defaultPrefix: string;
  desc: string;
}

export const CLASSIC_MODEL_CATEGORIES = [
  { id: 'all', label: 'All Models' },
  { id: 'io', label: 'Streams / I-O' },
  { id: 'mix_split', label: 'Mixers / Splitters' },
  { id: 'separators', label: 'Separators' },
  { id: 'heat_exchangers', label: 'Exchangers' },
  { id: 'columns', label: 'Columns' },
  { id: 'reactors', label: 'Reactors' },
  { id: 'pressure', label: 'Pressure Changers' },
  { id: 'electro_special', label: 'Electro / Special' },
] as const;

export const CLASSIC_MODEL_CATALOG: ClassicModelCatalogItem[] = [
  {
    unitType: 'feed',
    modelName: 'Feed',
    koName: '원료 유입',
    category: 'io',
    defaultPrefix: 'FEED',
    desc: '공정 원료(유량·온도·압력·조성) 공급 블록',
  },
  {
    unitType: 'product',
    modelName: 'Product',
    koName: '제품 유출',
    category: 'io',
    defaultPrefix: 'PROD',
    desc: '공정 최종 제품·배출 스트림 수취 블록',
  },
  {
    unitType: 'mixer',
    modelName: 'Mixer',
    koName: '스트림 혼합기',
    category: 'mix_split',
    defaultPrefix: 'MIX',
    desc: '다수 유입 스트림을 단열 혼합하여 단일 출구로 합류',
  },
  {
    unitType: 'splitter',
    modelName: 'FSplit',
    koName: '유량 분배기',
    category: 'mix_split',
    defaultPrefix: 'SPL',
    desc: '지정 분배비(Split Fraction)에 따라 상·하부로 분기',
  },
  {
    unitType: 'separator',
    modelName: 'Flash2',
    koName: '기액 분리기',
    category: 'separators',
    defaultPrefix: 'V',
    desc: '2상(기상/액상) 평형 플래시 분리기',
  },
  {
    unitType: 'hex',
    modelName: 'HeatX',
    koName: '2유체 열교환기',
    category: 'heat_exchangers',
    defaultPrefix: 'E',
    desc: '고온·저온 유체 간 열교환 및 정밀 TEMA 설계 연동',
  },
  {
    unitType: 'cooler',
    modelName: 'Heater',
    koName: '가열 / 냉각기',
    category: 'heat_exchangers',
    defaultPrefix: 'H',
    desc: '단일 유체 목표 온도·열부하(Duty) 제어 열교환기',
  },
  {
    unitType: 'distillation',
    modelName: 'MeshColumn',
    koName: '다단 정밀증류탑',
    category: 'columns',
    defaultPrefix: 'C',
    desc: '응축기·리보일러 포함 다단 MESH 정밀증류 및 인터널 설계',
  },
  {
    unitType: 'absorber',
    modelName: 'Absorber',
    koName: '흡수 / 탈기탑',
    category: 'columns',
    defaultPrefix: 'T',
    desc: '향류 기액 접촉 다단 MESH 흡수·스팀 스트리핑 컬럼',
  },
  {
    unitType: 'extractor',
    modelName: 'Extractor',
    koName: '다단 액-액 추출탑',
    category: 'columns',
    defaultPrefix: 'X',
    desc: 'NRTL/UNIFAC 다단 향류 액-액 추출 컬럼 (Extract/Raffinate)',
  },
  {
    unitType: 'reactor',
    modelName: 'Reactor',
    koName: '범용 화학반응기',
    category: 'reactors',
    defaultPrefix: 'R',
    desc: '화학양론·평형(Keq)·깁스최소화·CSTR·촉매층 PFR 반응기',
  },
  {
    unitType: 'pump',
    modelName: 'Pump',
    koName: '원심 펌프',
    category: 'pressure',
    defaultPrefix: 'P',
    desc: '액상 스트림 가압 및 수력 축동력(kW) 계산',
  },
  {
    unitType: 'compressor',
    modelName: 'Compr',
    koName: '압축기',
    category: 'pressure',
    defaultPrefix: 'K',
    desc: '기상 스트림 폴리트로픽/단열 압축 및 토출온도 계산',
  },
  {
    unitType: 'valve',
    modelName: 'JT-Valve',
    koName: '단열 팽창 밸브',
    category: 'pressure',
    defaultPrefix: 'VLV',
    desc: '고압 등엔탈피 교축(Joule-Thomson 냉각 및 2상 플래시)',
  },
  {
    unitType: 'evaporator',
    modelName: 'Evap',
    koName: '다중효용 증발관',
    category: 'separators',
    defaultPrefix: 'EV',
    desc: '증발 농축 및 기액 분리 (가성소다 등 수용액 농축)',
  },
  {
    unitType: 'liquefier',
    modelName: 'Liquefier',
    koName: '심냉 응축·액화기',
    category: 'heat_exchangers',
    defaultPrefix: 'E',
    desc: '저온 냉매 기반 부분/전응축 기액 분리 열교환',
  },
  {
    unitType: 'desiccant_dryer',
    modelName: 'Dryer',
    koName: '흡착 제습탑',
    category: 'columns',
    defaultPrefix: 'T',
    desc: '수분 미량 흡착 건조 (-60°C 노점 달성)',
  },
  {
    unitType: 'saturator',
    modelName: 'Saturator',
    koName: '포화·1차 정제조',
    category: 'electro_special',
    defaultPrefix: 'B',
    desc: '원염 포화 용해 및 화학 침전 1차 정제',
  },
  {
    unitType: 'chelate_tower',
    modelName: 'Chelate',
    koName: '킬레이트 수지탑',
    category: 'electro_special',
    defaultPrefix: 'T',
    desc: '이온교환 수지 2차 초정제 (Ca+Mg ppb 제거)',
  },
  {
    unitType: 'electrolyzer',
    modelName: 'ElectroCell',
    koName: '이온교환막 전해조',
    category: 'electro_special',
    defaultPrefix: 'EL',
    desc: 'Faraday 전기화학 양극·음극 동시 반응 및 이온막 수송',
  },
];

/** 상용 표준 공정 시뮬레이터 스타일의 정통 단색 선화 SVG 심볼 */
export function ClassicUnitSvg({
  unitType,
  size = 52,
}: {
  unitType: FlowUnitType;
  size?: number;
}) {
  const stroke = '#1E293B';
  const fillLight = '#F8FAFC';
  const accent = '#1D4ED8';

  switch (unitType) {
    case 'feed':
      return (
        <svg width={size} height={size * 0.72} viewBox="0 0 64 46">
          <polygon
            points="6,13 42,13 58,23 42,33 6,33"
            fill="#EFF6FF"
            stroke={accent}
            strokeWidth="2"
          />
          <line x1="14" y1="23" x2="42" y2="23" stroke={accent} strokeWidth="1.6" />
        </svg>
      );
    case 'product':
      return (
        <svg width={size} height={size * 0.72} viewBox="0 0 64 46">
          <polygon
            points="8,13 44,13 58,23 44,33 8,33 16,23"
            fill="#F1F5F9"
            stroke={stroke}
            strokeWidth="2"
          />
        </svg>
      );
    case 'mixer':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <polygon
            points="14,8 52,26 14,44"
            fill={fillLight}
            stroke={stroke}
            strokeWidth="2"
          />
          <line x1="4" y1="17" x2="14" y2="17" stroke={stroke} strokeWidth="1.6" />
          <line x1="4" y1="35" x2="14" y2="35" stroke={stroke} strokeWidth="1.6" />
          <line x1="52" y1="26" x2="62" y2="26" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'splitter':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <polygon
            points="50,8 12,26 50,44"
            fill={fillLight}
            stroke={stroke}
            strokeWidth="2"
          />
          <line x1="2" y1="26" x2="12" y2="26" stroke={stroke} strokeWidth="1.6" />
          <line x1="50" y1="17" x2="60" y2="17" stroke={stroke} strokeWidth="1.6" />
          <line x1="50" y1="35" x2="60" y2="35" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'separator':
      return (
        <svg width={size} height={size * 0.92} viewBox="0 0 64 60">
          <rect
            x="20"
            y="8"
            width="24"
            height="44"
            rx="12"
            fill={fillLight}
            stroke={stroke}
            strokeWidth="2"
          />
          <path d="M 20 35 Q 32 32 44 35" fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1="6" y1="26" x2="20" y2="26" stroke={stroke} strokeWidth="1.6" />
          <line x1="32" y1="2" x2="32" y2="8" stroke={stroke} strokeWidth="1.6" />
          <line x1="32" y1="52" x2="32" y2="58" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'hex':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <circle cx="32" cy="26" r="17" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <polyline
            points="10,26 22,26 27,17 37,35 42,26 54,26"
            fill="none"
            stroke={accent}
            strokeWidth="1.8"
          />
          <line x1="32" y1="3" x2="32" y2="9" stroke={stroke} strokeWidth="1.5" />
          <line x1="32" y1="43" x2="32" y2="49" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'cooler':
    case 'liquefier':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <circle cx="32" cy="26" r="16" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <polyline
            points="10,26 22,26 27,19 37,33 42,26 54,26"
            fill="none"
            stroke={stroke}
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'distillation':
      return (
        <svg width={size} height={size * 1.08} viewBox="0 0 72 78">
          {/* 주 탑체 */}
          <rect x="20" y="16" width="20" height="46" rx="9" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="21" y1="27" x2="39" y2="27" stroke="#94A3B8" strokeWidth="1.2" />
          <line x1="21" y1="38" x2="39" y2="38" stroke="#94A3B8" strokeWidth="1.2" />
          <line x1="21" y1="49" x2="39" y2="49" stroke="#94A3B8" strokeWidth="1.2" />
          {/* 상단 응축기 + 환류 라인 */}
          <polyline points="30,16 30,6 48,6" fill="none" stroke={stroke} strokeWidth="1.5" />
          <circle cx="52" cy="11" r="6" fill="#FFFFFF" stroke={accent} strokeWidth="1.6" />
          <polyline points="52,17 52,21 40,21" fill="none" stroke={stroke} strokeWidth="1.4" />
          <line x1="58" y1="11" x2="68" y2="11" stroke={stroke} strokeWidth="1.5" />
          {/* 하단 리보일러 */}
          <polyline points="30,62 30,71 48,71" fill="none" stroke={stroke} strokeWidth="1.5" />
          <circle cx="52" cy="65" r="6" fill="#FFFFFF" stroke={stroke} strokeWidth="1.6" />
          <polyline points="52,59 52,55 40,55" fill="none" stroke={stroke} strokeWidth="1.4" />
          <line x1="58" y1="71" x2="68" y2="71" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'absorber':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <rect x="22" y="6" width="20" height="52" rx="8" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="23" y1="20" x2="41" y2="42" stroke="#94A3B8" strokeWidth="1.2" />
          <line x1="41" y1="20" x2="23" y2="42" stroke="#94A3B8" strokeWidth="1.2" />
        </svg>
      );
    case 'extractor':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <rect x="21" y="6" width="22" height="52" rx="8" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="22" y1="19" x2="42" y2="19" stroke={accent} strokeWidth="1.3" strokeDasharray="3 2" />
          <line x1="22" y1="32" x2="42" y2="32" stroke={accent} strokeWidth="1.3" strokeDasharray="3 2" />
          <line x1="22" y1="45" x2="42" y2="45" stroke={accent} strokeWidth="1.3" strokeDasharray="3 2" />
        </svg>
      );
    case 'valve':
      return (
        <svg width={size} height={size * 0.72} viewBox="0 0 64 46">
          <polygon points="12,12 32,24 12,36" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <polygon points="52,12 32,24 52,36" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="24" x2="32" y2="8" stroke={accent} strokeWidth="1.8" />
          <line x1="24" y1="8" x2="40" y2="8" stroke={accent} strokeWidth="2" />
        </svg>
      );
    case 'reactor':
      return (
        <svg width={size} height={size * 0.96} viewBox="0 0 64 62">
          <rect x="17" y="10" width="30" height="42" rx="10" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="4" x2="32" y2="40" stroke={accent} strokeWidth="1.6" />
          <line x1="23" y1="36" x2="41" y2="36" stroke={accent} strokeWidth="2" />
        </svg>
      );
    case 'pump':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <circle cx="30" cy="28" r="14" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <polygon points="30,14 48,14 48,22 36,22" fill={fillLight} stroke={stroke} strokeWidth="1.8" />
          <polygon points="21,42 39,42 35,36 25,36" fill="#E2E8F0" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'compressor':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <polygon
            points="14,10 50,18 50,34 14,42"
            fill={fillLight}
            stroke={stroke}
            strokeWidth="2"
          />
          <line x1="4" y1="26" x2="14" y2="26" stroke={stroke} strokeWidth="1.6" />
          <line x1="50" y1="26" x2="60" y2="26" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'electrolyzer':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="10" y="12" width="44" height="32" rx="3" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="13" x2="32" y2="43" stroke={stroke} strokeWidth="1.6" strokeDasharray="3 2" />
          <line x1="22" y1="6" x2="22" y2="18" stroke={stroke} strokeWidth="1.6" />
          <rect x="19.5" y="18" width="5" height="20" fill="#E2E8F0" stroke={stroke} strokeWidth="1.5" />
          <line x1="42" y1="6" x2="42" y2="18" stroke={stroke} strokeWidth="1.6" />
          <rect x="39.5" y="18" width="5" height="20" fill="#E2E8F0" stroke={stroke} strokeWidth="1.5" />
          <line x1="11.5" y1="7" x2="16.5" y2="7" stroke={stroke} strokeWidth="1.5" />
          <line x1="14" y1="4.5" x2="14" y2="9.5" stroke={stroke} strokeWidth="1.5" />
          <line x1="47.5" y1="7" x2="52.5" y2="7" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'evaporator':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="19" y="11" width="26" height="34" rx="9" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <polyline points="32,11 32,4 48,4" fill="none" stroke={stroke} strokeWidth="1.8" />
          <line x1="32" y1="45" x2="32" y2="50" stroke={stroke} strokeWidth="1.6" />
          <line x1="21" y1="19" x2="43" y2="19" stroke="#94A3B8" strokeWidth="1.1" strokeDasharray="3 2" />
          <line x1="20" y1="24" x2="44" y2="24" stroke={stroke} strokeWidth="1.4" />
          <line x1="20" y1="37" x2="44" y2="37" stroke={stroke} strokeWidth="1.4" />
          <line x1="24" y1="24" x2="24" y2="37" stroke="#64748B" strokeWidth="1.3" />
          <line x1="28" y1="24" x2="28" y2="37" stroke="#64748B" strokeWidth="1.3" />
          <line x1="32" y1="24" x2="32" y2="37" stroke="#64748B" strokeWidth="1.3" />
          <line x1="36" y1="24" x2="36" y2="37" stroke="#64748B" strokeWidth="1.3" />
          <line x1="40" y1="24" x2="40" y2="37" stroke="#64748B" strokeWidth="1.3" />
        </svg>
      );
    case 'saturator':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="20" y="6" width="24" height="40" rx="8" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="2" x2="32" y2="6" stroke={stroke} strokeWidth="1.5" />
          <line x1="32" y1="46" x2="32" y2="50" stroke={stroke} strokeWidth="1.5" />
          <line x1="21" y1="16" x2="43" y2="16" stroke={stroke} strokeWidth="1.4" />
          <line x1="21" y1="38" x2="43" y2="38" stroke={stroke} strokeWidth="1.4" />
          <line x1="21" y1="16" x2="43" y2="38" stroke="#64748B" strokeWidth="1.2" />
          <line x1="43" y1="16" x2="21" y2="38" stroke="#64748B" strokeWidth="1.2" />
          <line x1="21" y1="27" x2="32" y2="38" stroke="#94A3B8" strokeWidth="1.1" />
          <line x1="32" y1="16" x2="43" y2="27" stroke="#94A3B8" strokeWidth="1.1" />
          <line x1="32" y1="16" x2="21" y2="27" stroke="#94A3B8" strokeWidth="1.1" />
          <line x1="43" y1="27" x2="32" y2="38" stroke="#94A3B8" strokeWidth="1.1" />
        </svg>
      );
    case 'chelate_tower':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="21" y="6" width="22" height="40" rx="8" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="2" x2="32" y2="6" stroke={stroke} strokeWidth="1.5" />
          <line x1="32" y1="46" x2="32" y2="50" stroke={stroke} strokeWidth="1.5" />
          <rect x="22" y="15" width="20" height="7" fill="#E2E8F0" stroke={stroke} strokeWidth="1.2" />
          <line x1="23" y1="18.5" x2="41" y2="18.5" stroke="#64748B" strokeWidth="1.1" strokeDasharray="2 2" />
          <rect x="22" y="29" width="20" height="7" fill="#E2E8F0" stroke={stroke} strokeWidth="1.2" />
          <line x1="23" y1="32.5" x2="41" y2="32.5" stroke="#64748B" strokeWidth="1.1" strokeDasharray="2 2" />
        </svg>
      );
    case 'desiccant_dryer':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="19" y="6" width="26" height="40" rx="9" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="32" y1="2" x2="32" y2="6" stroke={stroke} strokeWidth="1.5" />
          <line x1="32" y1="46" x2="32" y2="50" stroke={stroke} strokeWidth="1.5" />
          <circle cx="32" cy="26" r="8.5" fill="#E2E8F0" stroke={stroke} strokeWidth="1.4" />
          <line x1="26" y1="20" x2="38" y2="32" stroke={stroke} strokeWidth="1.6" />
          <line x1="38" y1="20" x2="26" y2="32" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'tank_visual':
    case 'silo_visual':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <polygon
            points="32,7 50,17 50,44 14,44 14,17"
            fill={fillLight}
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line x1="14" y1="17" x2="50" y2="17" stroke={stroke} strokeWidth="1.4" />
          <line x1="16" y1="29" x2="48" y2="29" stroke="#64748B" strokeWidth="1.3" strokeDasharray="4 2" />
          <line x1="10" y1="44" x2="54" y2="44" stroke={stroke} strokeWidth="1.8" />
        </svg>
      );
    case 'h_drum_visual':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="8" y="14" width="48" height="22" rx="11" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="16" y1="14.5" x2="16" y2="35.5" stroke="#94A3B8" strokeWidth="1.1" />
          <line x1="48" y1="14.5" x2="48" y2="35.5" stroke="#94A3B8" strokeWidth="1.1" />
          <line x1="10" y1="26" x2="54" y2="26" stroke="#64748B" strokeWidth="1.2" strokeDasharray="3 2" />
          <polygon points="16,36 24,36 22,43 18,43" fill="#E2E8F0" stroke={stroke} strokeWidth="1.5" />
          <polygon points="40,36 48,36 46,43 42,43" fill="#E2E8F0" stroke={stroke} strokeWidth="1.5" />
          <line x1="13" y1="43" x2="51" y2="43" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'filter_visual':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="16" y="10" width="32" height="32" rx="6" fill={fillLight} stroke={stroke} strokeWidth="2" />
          <line x1="6" y1="26" x2="16" y2="26" stroke={stroke} strokeWidth="1.6" />
          <line x1="48" y1="26" x2="58" y2="26" stroke={stroke} strokeWidth="1.6" />
          <line x1="18" y1="39" x2="46" y2="13" stroke={stroke} strokeWidth="2" strokeDasharray="3 2.5" />
        </svg>
      );
    case 'valve_visual':
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <line x1="4" y1="34" x2="14" y2="34" stroke={stroke} strokeWidth="1.6" />
          <line x1="50" y1="34" x2="60" y2="34" stroke={stroke} strokeWidth="1.6" />
          <polygon points="14,24 32,34 14,44" fill={fillLight} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <polygon points="50,24 32,34 50,44" fill={fillLight} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
          <line x1="32" y1="34" x2="32" y2="19" stroke={stroke} strokeWidth="1.8" />
          <path d="M 21 19 A 11 10 0 0 1 43 19 Z" fill="#E2E8F0" stroke={stroke} strokeWidth="1.8" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size * 0.8} viewBox="0 0 64 52">
          <rect x="14" y="10" width="36" height="32" rx="6" fill={fillLight} stroke={stroke} strokeWidth="2" />
        </svg>
      );
  }
}

export default function ClassicBlockNode({ data, selected }: NodeProps<ClassicBlockNodeData>) {
  const isFeed = data.unitType === 'feed';
  const isProduct = data.unitType === 'product';
  const isElectrolyzer = data.unitType === 'electrolyzer';
  const isColumnOrSep =
    data.unitType === 'distillation' ||
    data.unitType === 'separator' ||
    data.unitType === 'absorber' ||
    data.unitType === 'extractor' ||
    data.unitType === 'evaporator' ||
    data.unitType === 'saturator' ||
    data.unitType === 'liquefier' ||
    data.unitType === 'desiccant_dryer';
  const isSplitter = data.unitType === 'splitter';
  const isHex = data.unitType === 'hex' || data.unitType === 'cooler' || data.unitType === 'liquefier';
  const hasSolventPort = data.unitType === 'absorber' || data.unitType === 'extractor';

  const handleStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    background: '#FFFFFF',
    border: '1.8px solid #003399',
    borderRadius: 999,
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '5px 8px',
        borderRadius: 4,
        background: selected ? '#EFF6FF' : 'rgba(255, 255, 255, 0.96)',
        border: selected ? '1.5px solid #003399' : '1px solid #CBD5E1',
        boxShadow: selected
          ? '0 0 0 2px rgba(0, 51, 153, 0.16)'
          : '0 1px 2px rgba(15, 23, 42, 0.06)',
        minWidth: 78,
        position: 'relative',
      }}
    >
      {/* 좌측 유입 포트 */}
      {isElectrolyzer ? (
        <>
          <Handle
            id="anode_in"
            type="target"
            position={Position.Left}
            title="양극 유입 (Anode In)"
            style={{ ...handleStyle, top: '34%' }}
          />
          <Handle
            id="cathode_in"
            type="target"
            position={Position.Left}
            title="음극 순수 유입 (Cathode In)"
            style={{ ...handleStyle, top: '68%', borderColor: '#0D9488' }}
          />
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            style={{ ...handleStyle, top: '50%', opacity: 0, pointerEvents: 'none' }}
          />
        </>
      ) : (
        !isFeed && (
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            style={{ ...handleStyle, top: isHex ? '38%' : hasSolventPort ? '34%' : '48%' }}
          />
        )
      )}

      {/* 흡수탑/추출탑 보조 용매(Solvent) 포트 */}
      {hasSolventPort && (
        <Handle
          id="solvent"
          type="target"
          position={Position.Left}
          title="흡수액 / 추출용매 유입 포트 (solvent)"
          style={{ ...handleStyle, top: '70%', borderColor: '#0D9488' }}
        />
      )}

      {/* 열교환기 저온/유틸리티 포트 (cold_* 및 util_* 호환) */}
      {isHex && (
        <>
          <Handle
            id="cold_in"
            type="target"
            position={Position.Left}
            style={{ ...handleStyle, top: '72%', borderColor: '#475569' }}
          />
          <Handle
            id="util_in"
            type="target"
            position={Position.Left}
            style={{ ...handleStyle, top: '72%', opacity: 0, pointerEvents: 'none' }}
          />
          <Handle
            id="cold_out"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '72%', borderColor: '#475569' }}
          />
          <Handle
            id="util_out"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '72%', opacity: 0, pointerEvents: 'none' }}
          />
        </>
      )}

      {/* 우측 유출 포트 */}
      {isElectrolyzer ? (
        <>
          <Handle
            id="anode_out"
            type="source"
            position={Position.Right}
            title="양극 유출 (Cl₂ / 감손염수)"
            style={{ ...handleStyle, top: '34%' }}
          />
          <Handle
            id="cathode_out"
            type="source"
            position={Position.Right}
            title="음극 유출 (H₂ / 가성소다)"
            style={{ ...handleStyle, top: '68%', borderColor: '#0D9488' }}
          />
          <Handle
            id="out"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '50%', opacity: 0, pointerEvents: 'none' }}
          />
        </>
      ) : !isProduct && (isColumnOrSep || isSplitter) ? (
        <>
          <Handle
            id="vapor"
            type="source"
            position={Position.Right}
            title="상부 / 기상 / 탑정 유출"
            style={{ ...handleStyle, top: '26%' }}
          />
          <Handle
            id="top"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '26%', opacity: 0, pointerEvents: 'none' }}
          />
          <Handle
            id="liquid"
            type="source"
            position={Position.Right}
            title="하부 / 액상 / 탑저 유출"
            style={{ ...handleStyle, top: '70%' }}
          />
          <Handle
            id="bot"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '70%', opacity: 0, pointerEvents: 'none' }}
          />
          <Handle
            id="out"
            type="source"
            position={Position.Right}
            style={{ ...handleStyle, top: '48%', opacity: 0, pointerEvents: 'none' }}
          />
        </>
      ) : !isProduct ? (
        <Handle
          id="out"
          type="source"
          position={Position.Right}
          style={{ ...handleStyle, top: isHex ? '38%' : '48%' }}
        />
      ) : null}

      {/* 우상단 수렴(✓) / 에러(!) / 대기 상태 배지 */}
      {data.status === 'ok' && (
        <span
          title={data.statusTitle || '수렴 완료'}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: '#059669',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 900,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          ✓
        </span>
      )}
      {data.status === 'error' && (
        <span
          title={data.statusTitle || '미수렴 또는 수지 오차 발생'}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: '#DC2626',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 900,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          !
        </span>
      )}
      {data.status === 'warn' && (
        <span
          title={data.statusTitle || '입력 확인 필요'}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: '#D97706',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 900,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        >
          !
        </span>
      )}

      {/* 아이콘 */}
      <ClassicUnitSvg unitType={data.unitType} size={50} />

      {/* 블록 태그 & 모델명 */}
      <div
        style={{
          marginTop: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontWeight: 900,
          color: '#0F172A',
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        <span>{data.tag}</span>
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: '#475569',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        {data.modelName}
      </div>
      {data.liveMetric && (
        <div
          style={{
            marginTop: 2,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            color: '#1D4ED8',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {data.liveMetric}
        </div>
      )}
    </div>
  );
}

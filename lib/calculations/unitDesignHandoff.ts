// ============================================================================
// 시뮬레이터(PLANT 02 전해공장 시뮬레이터 & 6. 플로우시트 빌더) ↔ 단위 장치 설계(ChemPro Suite)
// 실시간 유체 조건 · 운전 변수 자동 전달 브리지 (Live Fluid Condition Handoff)
// ============================================================================

import {
  FlowNodeDef,
  FlowEdgeDef,
  FlowUnitType,
  SimCompKey,
  SIM_COMPS,
  COMP_META,
  SolvedStream,
  SolvedUnitResult,
  REFRIGERANT_PRESETS,
  RefrigerantPresetKey,
  cl2DewPointTempC,
  emptySimFlows,
} from './flowsheetSolver';

export const CHEMPRO_SIM_HANDOFF_KEY = 'chempro_sim_handoff_v1';

export type ChemProTargetTab = 'hx' | 'pump' | 'column' | 'vessel' | 'piping' | 'psv';

export interface ChemProSimHandoffPayload {
  version: 1;
  timestamp: number;
  sourceLabel: string; // 예: 'PLANT 02 전해공장 시뮬레이터' | '신규공장 플로우시트 빌더' | 'PLANT 01 전해공장 PFD'
  tab: ChemProTargetTab;
  equipTag: string;
  equipName: string;
  detectedFluidSummary: string;

  // 1) 열교환기 · 응축기 · 냉매 액화기 (tab === 'hx')
  hx?: {
    hx_type: 'shell_tube' | 'plate_phe';
    hotFluidId: string;
    coldFluidId: string;
    allocation: 'hot_shell' | 'hot_tube';
    dofTarget: 'mc_auto' | 'mh_auto' | 'tco_auto' | 'tho_auto';
    mh_kgh: number;
    Th_in: number;
    Th_out: number;
    mc_kgh: number;
    Tc_in: number;
    Tc_out: number;
    hot_mode: 'sensible' | 'cond_full' | 'cond_partial';
    Th_sat?: number;
    hot_xfrac?: number;
    hot_hv?: number;
    cold_mode: 'sensible' | 'boil_full' | 'boil_partial';
    Tc_sat?: number;
    cold_xfrac?: number;
    cold_hv?: number;
    U_assumed?: number;
  };

  // 2) 원심 펌프 (tab === 'pump')
  pump?: {
    fluidId: string;
    T_C: number;
    Q_m3h: number;
    rho_kgm3: number;
    P1_barG: number;
    P2_barG: number;
    eff_pct: number;
    dsuc_mm: string;
    ddis_mm: string;
  };

  // 3) 흡수탑 · 건조탑 · 제해탑 · 증류탑 (tab === 'column')
  column?: {
    col_mode: 'absorption' | 'distillation';
    abs_service: 'scrubbing' | 'stripping' | 'water_wash';
    internals: 'packed' | 'tray';
    pack_key: string;
    lkFluidId: string;
    hkFluidId: string;
    P_col_barA: number;
    gas_kgh: number;
    liq_kgh: number;
    T_gas_in: number;
    T_liq_in: number;
    y_in_ppm: number;
    y_out_ppm: number;
    F_kmolh?: number;
    zF?: number;
    xD?: number;
    xB?: number;
    R_mult?: number;
    q?: number;
    tray_eff_pct?: number;
  };

  // 4) 기액분리기 · 수평 액화드럼 · 압력용기 (tab === 'vessel')
  vessel?: {
    orientation: 'vertical' | 'horizontal';
    gasFluidId: string;
    liqFluidId: string;
    Wg_kgh: number;
    Wl_kgh: number;
    rhoG: number;
    rhoL: number;
    P_op_barG: number;
    P_des_barG: number;
    mat_key: string;
  };

  // 5) 공정 배관 · 압축기 토출 헤더 (tab === 'piping')
  piping?: {
    fluidId: string;
    flowMode: 'liquid' | 'gas';
    T_C: number;
    P1_barG: number;
    Q_m3h: number;
    rho_kgm3: number;
  };
}

export interface UnitDesignRouteAction {
  kind: 'chempro' | 'evap_special' | 'plant_brine' | 'plant_evap' | 'plant_packing' | 'electrolyzer_sub';
  buttonLabel: string;
  subHint: string;
  accentColor: string;
  bgGradient: string;
  borderColor: string;
  chemproTab?: ChemProTargetTab;
  secondaryAction?: {
    label: string;
    href: string;
    equipSubTab?: string;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function emptyFlows(): Record<SimCompKey, number> {
  return emptySimFlows();
}

function addFlows(a: Record<SimCompKey, number>, b: Record<SimCompKey, number>): Record<SimCompKey, number> {
  const out = emptyFlows();
  for (const k of SIM_COMPS) {
    out[k] = Math.max(0, (a[k] || 0) + (b[k] || 0));
  }
  return out;
}

function totalMass(f: Record<SimCompKey, number>): number {
  let s = 0;
  for (const k of SIM_COMPS) s += Math.max(0, f[k] || 0);
  return s;
}

/**
 * 시뮬레이터 9종 성분 질량유량 + 상(Phase) → ChemPro 151종 물성 DB 물질 ID 정밀 매핑
 */
export function mapSimFlowsToChemProFluid(
  flows: Record<SimCompKey, number>,
  phase: 'L' | 'G' | 'L/G',
  tempC: number,
  pressKgcm2g = 0.5
): string {
  const tot = totalMass(flows);
  if (tot <= 1e-6) {
    return phase === 'G' ? 'nitrogen_gas' : 'water';
  }

  const wCl2 = flows.Cl2 / tot;
  const wH2 = flows.H2 / tot;
  const wO2 = flows.O2 / tot;
  const wNaOH = flows.NaOH / tot;
  const wNaCl = flows.NaCl / tot;
  const wH2SO4 = flows.H2SO4 / tot;
  const wHCl = flows.HCl / tot;
  const wNaOCl = flows.NaOCl / tot;
  const wH2O = flows.H2O / tot;
  const wECH = flows.ECH / tot;
  const wDCH = flows.DCH / tot;
  const wMCH = flows.MCH / tot;
  const wGly = flows.Glycerol / tot;
  const wDCP = flows.DCP / tot;
  const wFeCl3 = flows.FeCl3 / tot;
  const wFeCl2 = flows.FeCl2 / tot;
  const wPAC = flows.PAC / tot;
  const wNaClO3 = flows.NaClO3 / tot;

  if (wECH >= 0.30) return 'ech_pure';
  if (wDCP >= 0.25) return 'dcp_12';
  if (wDCH >= 0.20) return 'dch_13';
  if (wMCH >= 0.20) return 'mch_3';
  if (wGly >= 0.25) return 'glycerol';
  if (wFeCl3 >= 0.08) return 'fecl3_40';
  if (wFeCl2 >= 0.08) return 'fecl2_28';
  if (wPAC >= 0.08) return 'pac_17';
  if (wNaClO3 >= 0.08) return 'naclo3_40';
  if (wNaOCl >= 0.05 && wNaOH < 0.08) {
    return wNaOCl >= 0.18 ? 'naocl_25_hs' : 'naocl_12';
  }
  if (wHCl >= 0.85 && wH2O < 0.02) {
    return phase === 'L' ? 'ahcl_liq' : 'ahcl_gas';
  }

  // 몰 유량 기준 수소 우세 판별 (수소는 분자량 2.016이라 수분 조금만 섞여도 질량분율이 낮아보임)
  let molTot = 0;
  for (const k of SIM_COMPS) {
    molTot += (flows[k] || 0) / COMP_META[k].mw;
  }
  const yH2 = molTot > 0 ? (flows.H2 / COMP_META.H2.mw) / molTot : 0;

  if (wCl2 >= 0.45) {
    if (phase === 'L') return 'liquid_cl2';
    return wH2O > 0.0005 ? 'cl2_wet_gas' : 'cl2_dry_gas';
  }
  if (yH2 >= 0.50 || wH2 >= 0.15) {
    return wH2O > 0.002 ? 'h2_wet_gas' : 'hydrogen_gas';
  }
  if (wO2 >= 0.45) {
    return 'oxygen_gas';
  }
  if (wH2SO4 >= 0.25) {
    return 'h2so4_98';
  }
  if (wHCl >= 0.05) {
    return 'hcl_32';
  }
  if (wNaOH >= 0.04 || wNaOCl >= 0.03) {
    const wtPct = wNaOH * 100;
    if (wtPct >= 46) return 'naoh_50';
    if (wtPct >= 38) return 'naoh_42';
    return 'naoh_32';
  }
  if (wNaCl >= 0.04) {
    const wtPct = wNaCl * 100;
    return wtPct >= 22.0 ? 'brine_25' : 'anolyte_depleted';
  }
  if (phase === 'G' || (phase === 'L/G' && tempC > 95)) {
    return pressKgcm2g >= 6.0 ? 'steam_13k' : 'steam_lp';
  }
  return 'water';
}

function mapRefrigerantToChemProFluid(preset: RefrigerantPresetKey | undefined, utilInTempC: number): string {
  switch (preset) {
    case 'cw':
      return 'water';
    case 'chw':
      return 'chilled_water_7c';
    case 'meg_brine':
      return 'brine_eg40';
    case 'brine_m20':
      return 'brine_cacl2_25';
    case 'r134a_chiller':
      return 'r134a_refrig';
    case 'r22_m30':
      return 'r22';
    case 'r404a_m32':
      return 'r404a';
    case 'freon_m35':
      return 'r507a';
    case 'nh3_m33':
      return 'ammonia';
    case 'steam_lp':
      return 'steam_lp';
    default:
      if (utilInTempC <= -20) return 'brine_cacl2_25';
      if (utilInTempC <= 0) return 'brine_eg40';
      if (utilInTempC <= 14) return 'chilled_water_7c';
      if (utilInTempC >= 105) return 'steam_lp';
      return 'water';
  }
}

/** 유량 Q (m³/h) 기준 흡입(유속 ~1.2 m/s)·토출(유속 ~2.0 m/s) ANSI Sch 40 배관 내경 자동 추천 */
function pickPumpNozzleIds(Q_m3h: number): { dsuc: string; ddis: string } {
  const sch40Ids = ['26.64', '40.89', '52.50', '62.71', '77.92', '102.26', '154.05', '202.72', '254.51', '303.23'];
  // ChemPro index.html <select id="pump_dsuc"> option values 확인 호환
  const q_m3s = Math.max(0.5, Q_m3h) / 3600;
  const reqIdMm = (targetV: number) => Math.sqrt((4 * q_m3s) / (Math.PI * targetV)) * 1000;
  const dSucTarget = reqIdMm(1.25);
  const dDisTarget = reqIdMm(2.15);

  const pickClosest = (targetMm: number) => {
    let best = sch40Ids[0];
    for (const s of sch40Ids) {
      if (parseFloat(s) >= targetMm * 0.92) {
        best = s;
        break;
      }
      best = s;
    }
    return best;
  };

  let dsuc = pickClosest(dSucTarget);
  let ddis = pickClosest(dDisTarget);
  if (parseFloat(ddis) > parseFloat(dsuc)) {
    ddis = dsuc;
  }
  return { dsuc, ddis };
}

/**
 * 선택된 시뮬레이터 장치 타입에 맞는 정확한 단위장치 설계 이동 경로 반환
 * - 전해조(electrolyzer)는 절대로 열교환기(hx)로 연결하지 않음!
 */
export function getUnitDesignRouteInfo(
  node: FlowNodeDef,
  isElectrolyzerPlantMode: boolean,
  activeSheetId: string
): UnitDesignRouteAction | null {
  const t: FlowUnitType = node.unitType;

  // 전해조: 절대로 열교환기(HX)로 라우팅하지 않고 전해조 세부 시뮬레이션으로만 안내
  if (t === 'electrolyzer') {
    if (isElectrolyzerPlantMode && activeSheetId === 'master' && node.subSheetId) {
      // 마스터 시트에서는 이미 상단 계층형 세부공정 진입 카드가 표시되므로 중복 버튼 불필요
      return null;
    }
    if (!isElectrolyzerPlantMode) {
      return {
        kind: 'electrolyzer_sub',
        buttonLabel: '⚡ 전해조 세부 스택·순환루프 참조 시뮬 열기 →',
        subHint: '전해조는 열교환기가 아닌 전용 멤브레인 셀 전압·패러데이 수지 모듈에서 해석합니다.',
        accentColor: '#0F766E',
        bgGradient: 'linear-gradient(135deg, #F0FDFA 0%, #ECFDF5 100%)',
        borderColor: '#5EEAD4',
      };
    }
    return null;
  }

  if (t === 'hex' || t === 'liquefier' || t === 'cooler') {
    const isLiq = t === 'liquefier';
    return {
      kind: 'chempro',
      chemproTab: 'hx',
      buttonLabel: isLiq
        ? '❄️ 이 유체·상변화 조건으로 액화기(HEX) 상세설계 →'
        : '🔥 이 유체·온도 조건으로 열교환기(HEX) 상세설계 →',
      subHint: '현재 유입 유량·조성·입출구 온도·냉매·잠열(3-Zone) 조건을 단위장치 설계에 그대로 반영하여 전열면적·튜브수를 즉시 계산합니다.',
      accentColor: '#B45309',
      bgGradient: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
      borderColor: '#FCD34D',
    };
  }

  if (t === 'pump') {
    return {
      kind: 'chempro',
      chemproTab: 'pump',
      buttonLabel: '🔧 이 유량·양정 조건으로 원심펌프(PUMP) 상세설계 →',
      subHint: '실시간 액상 유량(m³/h)·밀도·흡입/토출 압력·온도를 그대로 물고 넘어가 양정·축동력·NPSHa를 계산합니다.',
      accentColor: '#1D4ED8',
      bgGradient: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
      borderColor: '#93C5FD',
    };
  }

  if (t === 'distillation') {
    return {
      kind: 'chempro',
      chemproTab: 'column',
      buttonLabel: '🏗️ 내장 컬럼 사이징 & 인터널(트레이·충진물) 개념설계 열기 →',
      subHint: '다성분 MESH 수렴의 단별(Stage 2~N-1) 기액유량·밀도·표면장력·점도를 실시간 연동하여 트레이(Sieve/Valve)·충진탑 탑경, 범람율, 압손, 섬프·노즐 개념디자인을 빌더 안에서 즉시 수행합니다.',
      accentColor: '#4338CA',
      bgGradient: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
      borderColor: '#A5B4FC',
    };
  }

  if (t === 'absorber' || t === 'desiccant_dryer') {
    return {
      kind: 'chempro',
      chemproTab: 'column',
      buttonLabel: '🗼 이 기액 유량·농도로 흡수·패킹컬럼(COL) 상세설계 →',
      subHint: '가스/흡수액 유량·온도·압력·입출구 농도(ppm)를 그대로 물고 넘어가 탑경(GPDC)·패킹 높이(HTU·NTU)·차압을 계산합니다.',
      accentColor: '#5B21B6',
      bgGradient: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
      borderColor: '#C4B5FD',
      secondaryAction: isElectrolyzerPlantMode
        ? {
            label: '전해공장 전용 패킹타워(황산건조/제해) 사이징 열기 →',
            href: '/equipment-design?tab=packing',
            equipSubTab: 'packing',
          }
        : undefined,
    };
  }

  if (t === 'separator' || t === 'h_drum_visual' || t === 'tank_visual') {
    return {
      kind: 'chempro',
      chemproTab: 'vessel',
      buttonLabel: '🛢️ 이 기액유량·압력으로 기액분리기·용기(VES) 설계 →',
      subHint: '기상/액상 유량·밀도·운전압력을 그대로 전달하여 Souders-Brown 직경 및 ASME Sec.VIII 두께를 계산합니다.',
      accentColor: '#1E3A8A',
      bgGradient: 'linear-gradient(135deg, #EFF6FF 0%, #E0E7FF 100%)',
      borderColor: '#A5B4FC',
    };
  }

  if (t === 'evaporator') {
    return {
      kind: isElectrolyzerPlantMode ? 'plant_evap' : 'evap_special',
      buttonLabel: '🔥 다중효용 강하막 증발농축 상세설계 열기 →',
      subHint: '가성소다 BPE(비점상승)·총괄열전달·강하막 튜브 적심률(Γ) 전용 증발농축 설계 화면으로 이동합니다.',
      accentColor: '#9A3412',
      bgGradient: 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)',
      borderColor: '#FDBA74',
    };
  }

  if (t === 'saturator' || t === 'chelate_tower') {
    return {
      kind: 'plant_brine',
      buttonLabel: '🧪 브라인 포화조·캔들필터·킬레이트탑 상세설계 →',
      subHint: '원염 포화조 상승유속·캔들필터 여과면적·이온교환수지탑(SV/BV) 전용 사이징 화면으로 이동합니다.',
      accentColor: '#0369A1',
      bgGradient: 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
      borderColor: '#7DD3FC',
    };
  }

  if (t === 'compressor') {
    return {
      kind: 'chempro',
      chemproTab: 'piping',
      buttonLabel: '💨 토출 고압가스 배관(PIPE) 유속·차압 상세설계 →',
      subHint: '압축 토출 가스의 실제 유량·온도·압력·기체밀도를 배관 설계 모듈로 전달하여 적정 관경(NPS)과 마하수를 계산합니다.',
      accentColor: '#0369A1',
      bgGradient: 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
      borderColor: '#7DD3FC',
    };
  }

  return null;
}

/**
 * 실시간 해결된 스트림(SolvedStream[])과 유닛 결과(SolvedUnitResult)로부터
 * ChemPro Suite 입력 폼에 즉시 주입할 유체조건 페이로드 생성
 */
export function buildChemProHandoffPayload(
  node: FlowNodeDef,
  allEdges: FlowEdgeDef[],
  solvedStreams: SolvedStream[],
  unitRes: SolvedUnitResult | undefined,
  sourceLabel: string
): ChemProSimHandoffPayload | null {
  const streamByEdge = new Map<string, SolvedStream>();
  solvedStreams.forEach(s => streamByEdge.set(s.edgeId, s));

  const inEdges = allEdges.filter(e => e.target === node.id);
  const outEdges = allEdges.filter(e => e.source === node.id);

  const inStreams = inEdges
    .map(e => ({ edge: e, stream: streamByEdge.get(e.id) }))
    .filter((x): x is { edge: FlowEdgeDef; stream: SolvedStream } => Boolean(x.stream));

  const outStreams = outEdges
    .map(e => ({ edge: e, stream: streamByEdge.get(e.id) }))
    .filter((x): x is { edge: FlowEdgeDef; stream: SolvedStream } => Boolean(x.stream));

  // 공정 주 유입 스트림 (유틸리티 포트 제외)
  const procInItems = inStreams.filter(x => x.edge.targetPort !== 'util_in');
  const utilInItem = inStreams.find(x => x.edge.targetPort === 'util_in');

  let sumInFlows = emptyFlows();
  let sumInMass = 0;
  let weightedInTemp = 0;
  let weightedInPress = 0;
  let weightedInRho = 0;
  let weightedInVapFrac = 0;

  for (const { stream } of procInItems) {
    sumInFlows = addFlows(sumInFlows, stream.flowsKgH);
    const m = Math.max(0, stream.totalMassKgH);
    sumInMass += m;
    weightedInTemp += m * stream.tempC;
    weightedInPress += m * stream.pressKgcm2g;
    weightedInRho += m * stream.densityKgM3;
    weightedInVapFrac += m * stream.vaporFraction;
  }

  const T_in = sumInMass > 1e-6 ? weightedInTemp / sumInMass : (node.params.operTempC ?? 40);
  const P_in = sumInMass > 1e-6 ? weightedInPress / sumInMass : (node.params.operPressKgcm2g ?? 1.0);
  const rho_in = sumInMass > 1e-6 ? weightedInRho / sumInMass : 1000;
  const vapFrac_in = sumInMass > 1e-6 ? weightedInVapFrac / sumInMass : 0;
  const phase_in: 'L' | 'G' | 'L/G' = vapFrac_in > 0.95 ? 'G' : vapFrac_in < 0.05 ? 'L' : 'L/G';

  const procOutItems = outStreams.filter(x => x.edge.sourcePort !== 'util_out');
  let sumOutMass = 0;
  let weightedOutTemp = 0;
  let weightedOutPress = 0;
  for (const { stream } of procOutItems) {
    const m = Math.max(0, stream.totalMassKgH);
    sumOutMass += m;
    weightedOutTemp += m * stream.tempC;
    weightedOutPress += m * stream.pressKgcm2g;
  }
  const T_out =
    sumOutMass > 1e-6
      ? weightedOutTemp / sumOutMass
      : (node.params.operTempC ?? T_in);
  const P_out =
    sumOutMass > 1e-6
      ? weightedOutPress / sumOutMass
      : (node.params.outletPressKgcm2g ?? node.params.operPressKgcm2g ?? P_in);

  const detectedFluidSummary = unitRes?.detectedFluidLabel || `${node.tag} 공정 유체`;
  const t = node.unitType;

  // ── 1) 열교환기 · 액화기 · 냉각기 (HEX) ──
  if (t === 'hex' || t === 'liquefier' || t === 'cooler') {
    const procFluidId = mapSimFlowsToChemProFluid(sumInFlows, phase_in, T_in, P_in);
    const refPreset: RefrigerantPresetKey =
      node.params.refrigerantPreset ?? (t === 'liquefier' ? 'freon_m35' : 'cw');
    const refMeta = REFRIGERANT_PRESETS[refPreset] ?? REFRIGERANT_PRESETS.cw;

    const utilInT = utilInItem ? utilInItem.stream.tempC : (node.params.utilInTempC ?? refMeta.inTempC);
    const utilOutT = node.params.utilOutTempC ?? refMeta.outTempC;
    const utilFluidId = utilInItem
      ? mapSimFlowsToChemProFluid(utilInItem.stream.flowsKgH, utilInItem.stream.phase, utilInT, utilInItem.stream.pressKgcm2g)
      : mapRefrigerantToChemProFluid(refPreset, utilInT);

    const isHeating = T_out > T_in + 0.3 || refPreset === 'steam_lp';
    // kcal/(m²·h·°C) -> W/(m²·K) 변환 (× 1.163)
    const U_W_m2K = Math.round((node.params.overallU ?? refMeta.defaultU ?? 450) * 1.163);
    const isPHECandidate =
      !isHeating &&
      t !== 'liquefier' &&
      (procFluidId.startsWith('naoh_') || procFluidId === 'brine_25' || procFluidId === 'anolyte_depleted') &&
      Math.max(T_in, T_out) <= 170 &&
      node.name.includes('판형');

    if (isHeating) {
      // 스팀/열매 가열기: Hot = Utility(Steam), Cold = Process
      const Th_in = Math.max(T_out + 5, utilInT);
      const Th_out = Math.min(Th_in - 0.5, utilOutT);
      const Tc_in = T_in;
      const Tc_out = Math.max(Tc_in + 0.5, T_out);
      const mc_kgh = Math.max(20, sumInMass || 5000);
      const dutyKW = Math.max(5, Math.abs(unitRes?.heatDutyKcalH || mc_kgh * (Tc_out - Tc_in) * 0.85) / 859.845);
      const mh_est = refMeta.latentKcalKg
        ? Math.max(10, (dutyKW * 859.845) / refMeta.latentKcalKg)
        : Math.max(20, (dutyKW * 3600) / (4.184 * Math.max(2, Th_in - Th_out)));

      return {
        version: 1,
        timestamp: Date.now(),
        sourceLabel,
        tab: 'hx',
        equipTag: node.tag,
        equipName: node.name,
        detectedFluidSummary,
        hx: {
          hx_type: isPHECandidate ? 'plate_phe' : 'shell_tube',
          hotFluidId: utilFluidId,
          coldFluidId: procFluidId,
          allocation: 'hot_shell',
          dofTarget: 'mh_auto',
          mh_kgh: Math.round(mh_est),
          Th_in: Number(Th_in.toFixed(1)),
          Th_out: Number(Th_out.toFixed(1)),
          mc_kgh: Math.round(mc_kgh),
          Tc_in: Number(Tc_in.toFixed(1)),
          Tc_out: Number(Tc_out.toFixed(1)),
          hot_mode: refPreset === 'steam_lp' || utilFluidId.startsWith('steam') ? 'cond_full' : 'sensible',
          Th_sat: Number(Th_in.toFixed(1)),
          hot_xfrac: 1.0,
          hot_hv: refMeta.latentKcalKg ? Math.round(refMeta.latentKcalKg * 4.184) : undefined,
          cold_mode: 'sensible',
          U_assumed: U_W_m2K,
        },
      };
    } else {
      // 공정 냉각기 · 응축기 · 염소 냉매 액화기: Hot = Process, Cold = Cooling Water / Refrigerant
      const Th_in = T_in;
      const Th_out = Math.min(Th_in - 0.5, T_out);
      let Tc_in = utilInT;
      let Tc_out = Math.max(Tc_in + 0.5, utilOutT);
      // 온도 역전 방지 가드
      if (Tc_in >= Th_out - 1.5) {
        Tc_in = Th_out - 8.0;
        Tc_out = Math.min(Th_in - 2.0, Tc_in + 5.0);
      } else if (Tc_out >= Th_in - 1.5) {
        Tc_out = Math.max(Tc_in + 1.0, Th_in - 3.0);
      }

      const mh_kgh = Math.max(10, sumInMass || 5000);
      const condensedKgH = Math.max(0, unitRes?.condensedOrRemovedKgH ?? 0);

      // 고온측(공정 유체) 상변화(3-Zone 과열제거·응축·과냉) 자동 판별
      let hot_mode: 'sensible' | 'cond_full' | 'cond_partial' = 'sensible';
      let Th_sat: number | undefined;
      let hot_xfrac: number | undefined;
      let hot_hv: number | undefined;

      const cl2Mass = sumInFlows.Cl2 || 0;
      if ((t === 'liquefier' || cl2Mass / Math.max(1, sumInMass) > 0.5) && condensedKgH > 1.0) {
        let totMol = 0;
        for (const k of SIM_COMPS) totMol += (sumInFlows[k] || 0) / COMP_META[k].mw;
        const yCl2 = totMol > 0 ? (cl2Mass / COMP_META.Cl2.mw) / totMol : 0.95;
        const P_abs = Math.max(0.3, 1.0332 + (node.params.operPressKgcm2g ?? P_in));
        const dewT = cl2DewPointTempC(P_abs * yCl2);
        Th_sat = Number(clamp(dewT, Th_out + 0.3, Th_in).toFixed(1));
        const xFrac = clamp(condensedKgH / Math.max(1, sumInMass), 0.05, 1.0);
        hot_mode = xFrac >= 0.98 ? 'cond_full' : 'cond_partial';
        hot_xfrac = Number(xFrac.toFixed(3));
        hot_hv = 274; // Cl2 증발잠열 kJ/kg
      } else if (vapFrac_in > 0.20 && condensedKgH > 0.05 * Math.max(1, sumInMass)) {
        const xFrac = clamp(condensedKgH / Math.max(1, sumInMass), 0.05, 1.0);
        hot_mode = xFrac >= 0.98 ? 'cond_full' : 'cond_partial';
        Th_sat = Number(clamp(Th_in * 0.65 + Th_out * 0.35, Th_out + 0.5, Th_in).toFixed(1));
        hot_xfrac = Number(xFrac.toFixed(3));
      }

      // 저온측(냉매) 증발 잠열 모드 판별 (R-507A, R-404A, R-134a, R-22, NH3 등)
      const hasRefrigBoiling = Boolean(refMeta.latentKcalKg);
      const cold_mode: 'sensible' | 'boil_full' = hasRefrigBoiling ? 'boil_full' : 'sensible';
      const Tc_sat = hasRefrigBoiling ? Number(Tc_in.toFixed(1)) : undefined;
      const cold_hv = hasRefrigBoiling && refMeta.latentKcalKg ? Math.round(refMeta.latentKcalKg * 4.184) : undefined;

      const dutyKcalH = Math.max(1000, Math.abs(unitRes?.heatDutyKcalH || mh_kgh * Math.max(1, Th_in - Th_out) * 0.5));
      const mc_est = hasRefrigBoiling && refMeta.latentKcalKg
        ? Math.max(20, dutyKcalH / refMeta.latentKcalKg)
        : Math.max(50, dutyKcalH / (Math.max(0.4, refMeta.cp) * Math.max(1, Tc_out - Tc_in)));

      const corrosiveOrGasTube =
        procFluidId.includes('cl2') ||
        procFluidId.includes('h2') ||
        procFluidId.startsWith('naoh_') ||
        procFluidId === 'brine_25' ||
        procFluidId === 'anolyte_depleted' ||
        procFluidId === 'hcl_32';

      return {
        version: 1,
        timestamp: Date.now(),
        sourceLabel,
        tab: 'hx',
        equipTag: node.tag,
        equipName: node.name,
        detectedFluidSummary,
        hx: {
          hx_type: isPHECandidate ? 'plate_phe' : 'shell_tube',
          hotFluidId: procFluidId,
          coldFluidId: utilFluidId,
          allocation: corrosiveOrGasTube ? 'hot_tube' : 'hot_shell',
          dofTarget: 'mc_auto',
          mh_kgh: Math.round(mh_kgh),
          Th_in: Number(Th_in.toFixed(1)),
          Th_out: Number(Th_out.toFixed(1)),
          mc_kgh: Math.round(mc_est),
          Tc_in: Number(Tc_in.toFixed(1)),
          Tc_out: Number(Tc_out.toFixed(1)),
          hot_mode,
          Th_sat,
          hot_xfrac,
          hot_hv,
          cold_mode,
          Tc_sat,
          cold_xfrac: hasRefrigBoiling ? 1.0 : undefined,
          cold_hv,
          U_assumed: U_W_m2K,
        },
      };
    }
  }

  // ── 2) 원심 펌프 (PUMP) ──
  if (t === 'pump') {
    const fluidId = mapSimFlowsToChemProFluid(sumInFlows, 'L', T_in, P_in);
    const rho = clamp(rho_in, 450, 1950);
    const Q_m3h = Math.max(0.5, sumInMass > 0 ? sumInMass / rho : 50);
    const P1_barG = Number((P_in * 0.980665).toFixed(2));
    const rawP2 = (node.params.outletPressKgcm2g ?? Math.max(P_in + 2.5, P_out)) * 0.980665;
    const P2_barG = Number(Math.max(P1_barG + 0.5, rawP2).toFixed(2));
    const eff_pct = Math.round(clamp((node.params.efficiency ?? 0.72) * 100, 35, 90));
    const { dsuc, ddis } = pickPumpNozzleIds(Q_m3h);

    return {
      version: 1,
      timestamp: Date.now(),
      sourceLabel,
      tab: 'pump',
      equipTag: node.tag,
      equipName: node.name,
      detectedFluidSummary,
      pump: {
        fluidId,
        T_C: Number(T_in.toFixed(1)),
        Q_m3h: Number(Q_m3h.toFixed(1)),
        rho_kgm3: Number(rho.toFixed(1)),
        P1_barG,
        P2_barG,
        eff_pct,
        dsuc_mm: dsuc,
        ddis_mm: ddis,
      },
    };
  }

  // ── 3-A) 다단 정밀증류탑 (DISTILLATION COLUMN) ──
  if (t === 'distillation') {
    const dRes = unitRes?.distillResult;
    const vapOut = outStreams.find(x => x.edge.sourcePort === 'vapor' || x.edge.sourcePort === 'out1')?.stream ?? outStreams[0]?.stream;
    const liqOut = outStreams.find(x => x.edge.sourcePort === 'liquid' || x.edge.sourcePort === 'out2')?.stream ?? outStreams[1]?.stream;

    const rr = dRes?.actualRefluxRatio ?? node.params.distillConfig?.topSpecValue ?? 2.8;
    const distKgH = vapOut?.totalMassKgH ?? Math.max(100, sumInMass * 0.5);
    const maxStageVap = dRes?.stages?.length
      ? Math.max(...dRes.stages.map(st => st.vapMassKgH))
      : distKgH * (rr + 1);
    const maxStageLiq = dRes?.stages?.length
      ? Math.max(...dRes.stages.map(st => st.liqMassKgH))
      : distKgH * rr + sumInMass * 0.5;

    const topP = dRes?.topPressKgcm2g ?? node.params.distillConfig?.topPressKgcm2g ?? P_in;
    const topT = dRes?.topTempC ?? vapOut?.tempC ?? T_in;
    const botT = dRes?.bottomTempC ?? liqOut?.tempC ?? T_in + 35;

    let lkFluidId = vapOut
      ? mapSimFlowsToChemProFluid(vapOut.flowsKgH, 'L', topT, topP)
      : mapSimFlowsToChemProFluid(sumInFlows, 'L', topT, topP);
    let hkFluidId = liqOut
      ? mapSimFlowsToChemProFluid(liqOut.flowsKgH, 'L', botT, topP)
      : mapSimFlowsToChemProFluid(sumInFlows, 'L', botT, topP);

    let lkKey: SimCompKey = 'ECH';
    let hkKey: SimCompKey = 'DCH';
    if (sumInFlows.HCl > 1 && sumInFlows.H2O > 1) {
      if (topP < -0.1) {
        lkFluidId = 'water';
        hkFluidId = 'hcl_20_azeo';
        lkKey = 'H2O';
        hkKey = 'HCl';
      } else {
        lkFluidId = 'ahcl_liq';
        hkFluidId = 'hcl_20_azeo';
        lkKey = 'HCl';
        hkKey = 'H2O';
      }
    } else if (sumInFlows.HCl > 1 && sumInFlows.H2O <= 1) {
      lkFluidId = 'hydrogen_gas';
      hkFluidId = 'ahcl_liq';
      lkKey = 'H2';
      hkKey = 'HCl';
    } else if (sumInFlows.DCP > 1 && sumInFlows.ECH > 1) {
      lkFluidId = 'dcp_12';
      hkFluidId = 'ech_pure';
      lkKey = 'DCP';
      hkKey = 'ECH';
    } else if (sumInFlows.ECH > 1 && sumInFlows.DCH > 1) {
      lkFluidId = 'ech_pure';
      hkFluidId = 'dch_13';
      lkKey = 'ECH';
      hkKey = 'DCH';
    } else if (lkFluidId === hkFluidId) {
      hkFluidId = lkFluidId === 'water' ? 'hcl_20_azeo' : 'water';
    }

    const totalFeedKmolH = SIM_COMPS.reduce((s, k) => s + sumInFlows[k] / COMP_META[k].mw, 0);
    const nLkF = sumInFlows[lkKey] / COMP_META[lkKey].mw;
    const nHkF = sumInFlows[hkKey] / COMP_META[hkKey].mw;
    const zF = nLkF + nHkF > 1e-6 ? clamp(nLkF / (nLkF + nHkF), 0.05, 0.95) : 0.45;

    const dFlows = vapOut?.flowsKgH ?? sumInFlows;
    const bFlows = liqOut?.flowsKgH ?? sumInFlows;
    const nLkD = dFlows[lkKey] / COMP_META[lkKey].mw;
    const nHkD = dFlows[hkKey] / COMP_META[hkKey].mw;
    const nLkB = bFlows[lkKey] / COMP_META[lkKey].mw;
    const nHkB = bFlows[hkKey] / COMP_META[hkKey].mw;

    const xD = nLkD + nHkD > 1e-6 ? clamp(nLkD / (nLkD + nHkD), Math.min(0.92, zF + 0.08), 0.999) : 0.98;
    const xB = nLkB + nHkB > 1e-6 ? clamp(nLkB / (nLkB + nHkB), 0.001, Math.max(0.08, zF - 0.05)) : 0.02;
    const effPct = clamp(node.params.distillConfig?.murphreeEffPct ?? 75, 35, 95);

    return {
      version: 1,
      timestamp: Date.now(),
      sourceLabel,
      tab: 'column',
      equipTag: node.tag,
      equipName: node.name,
      detectedFluidSummary,
      column: {
        col_mode: 'distillation',
        abs_service: 'stripping',
        internals: 'tray',
        pack_key: 'mellapak_250y',
        lkFluidId,
        hkFluidId,
        P_col_barA: Number(Math.max(0.08, (topP + 1.03323) * 0.980665).toFixed(3)),
        gas_kgh: Math.round(Math.max(50, maxStageVap)),
        liq_kgh: Math.round(Math.max(50, maxStageLiq)),
        T_gas_in: Number(botT.toFixed(1)),
        T_liq_in: Number(topT.toFixed(1)),
        y_in_ppm: 50000,
        y_out_ppm: 100,
        F_kmolh: Number(Math.max(5, totalFeedKmolH).toFixed(1)),
        zF: Number(zF.toFixed(3)),
        xD: Number(xD.toFixed(4)),
        xB: Number(xB.toFixed(4)),
        R_mult: Number(clamp(1.15 + rr * 0.08, 1.15, 2.2).toFixed(2)),
        q: 1.0,
        tray_eff_pct: Math.round(effPct),
      },
    };
  }

  // ── 3) 흡수탑 · 황산건조탑 · 제해탑 · 제습탑 (COLUMN) ──
  if (t === 'absorber' || t === 'desiccant_dryer') {
    const gasInItems = inStreams.filter(
      x => x.stream.phase !== 'L' || (x.edge.targetPort !== 'solvent' && x.edge.targetPort !== 'liq_in' && inStreams.length === 1)
    );
    const liqInItems = inStreams.filter(
      x => x.edge.targetPort === 'solvent' || x.edge.targetPort === 'liq_in' || (x.stream.phase === 'L' && !gasInItems.includes(x))
    );

    let gasFlows = emptyFlows();
    let gasMass = 0;
    let gasT = T_in;
    let gasP = P_in;
    for (const { stream } of gasInItems) {
      gasFlows = addFlows(gasFlows, stream.flowsKgH);
      gasMass += stream.totalMassKgH;
      gasT = stream.tempC;
      gasP = stream.pressKgcm2g;
    }

    let liqFlows = emptyFlows();
    let liqMass = 0;
    let liqT = 25;
    for (const { stream } of liqInItems) {
      liqFlows = addFlows(liqFlows, stream.flowsKgH);
      liqMass += stream.totalMassKgH;
      liqT = stream.tempC;
    }
    if (liqMass <= 1e-3) {
      const mkComp: SimCompKey = node.params.makeupSolventComp ?? 'H2SO4';
      const mkKgH = node.params.makeupSolventKgH ?? Math.max(500, gasMass * 1.2);
      liqFlows[mkComp] = mkKgH;
      liqMass = mkKgH;
    }

    const lkFluidId = mapSimFlowsToChemProFluid(gasFlows, 'G', gasT, gasP);
    const hkFluidId = mapSimFlowsToChemProFluid(liqFlows, 'L', liqT, gasP);

    const targetComp: SimCompKey = t === 'desiccant_dryer' ? 'H2O' : (node.params.targetComponent ?? 'H2O');
    // 가스 입·출구 몰분율(ppm) 산출
    let gasMolIn = 0;
    for (const k of SIM_COMPS) gasMolIn += (gasFlows[k] || 0) / COMP_META[k].mw;
    const targetMolIn = (gasFlows[targetComp] || 0) / COMP_META[targetComp].mw;
    const y_in_ppm = gasMolIn > 0 ? clamp(Math.round((targetMolIn / gasMolIn) * 1e6), 20, 250000) : 5000;

    const vapOut = outStreams.find(x => x.edge.sourcePort === 'vapor' || x.stream.phase === 'G')?.stream ?? outStreams[0]?.stream;
    let y_out_ppm = Math.max(1, Math.round(y_in_ppm * (1 - (node.params.removalEfficiency ?? 0.98))));
    if (vapOut && vapOut.totalMolarKmolH > 0) {
      const targetMolOut = (vapOut.flowsKgH[targetComp] || 0) / COMP_META[targetComp].mw;
      const calcOutPpm = (targetMolOut / vapOut.totalMolarKmolH) * 1e6;
      if (calcOutPpm > 0 && calcOutPpm < y_in_ppm) {
        y_out_ppm = Number(Math.max(0.5, calcOutPpm).toFixed(1));
      }
    }

    const pack_key =
      hkFluidId === 'h2so4_98'
        ? 'intalox_ceramic_25'
        : hkFluidId.startsWith('naoh_') || lkFluidId.includes('cl2')
          ? 'pall_plastic_50'
          : 'pall_metal_38';

    return {
      version: 1,
      timestamp: Date.now(),
      sourceLabel,
      tab: 'column',
      equipTag: node.tag,
      equipName: node.name,
      detectedFluidSummary,
      column: {
        col_mode: 'absorption',
        abs_service: hkFluidId === 'water' || hkFluidId === 'chilled_water_7c' ? 'water_wash' : 'scrubbing',
        internals: 'packed',
        pack_key,
        lkFluidId,
        hkFluidId,
        P_col_barA: Number(Math.max(0.2, 1.013 + gasP * 0.980665).toFixed(2)),
        gas_kgh: Math.round(Math.max(20, gasMass || sumInMass || 1000)),
        liq_kgh: Math.round(Math.max(50, liqMass)),
        T_gas_in: Number(gasT.toFixed(1)),
        T_liq_in: Number(liqT.toFixed(1)),
        y_in_ppm,
        y_out_ppm,
      },
    };
  }

  // ── 4) 기액분리기 · 수평 액화드럼 · 수직 저장조 (VESSEL) ──
  if (t === 'separator' || t === 'h_drum_visual' || t === 'tank_visual') {
    const vapOut = outStreams.find(x => x.edge.sourcePort === 'vapor' || x.stream.phase === 'G')?.stream;
    const liqOut = outStreams.find(x => x.edge.sourcePort === 'liquid' || x.stream.phase === 'L')?.stream;

    const Wg = vapOut ? vapOut.totalMassKgH : (phase_in === 'G' ? sumInMass : Math.max(50, sumInMass * 0.08));
    const Wl = liqOut ? liqOut.totalMassKgH : (phase_in === 'G' ? Math.max(50, sumInMass * 0.1) : Math.max(100, sumInMass));
    const rhoG = vapOut ? clamp(vapOut.densityKgM3, 0.08, 120) : (phase_in === 'G' ? clamp(rho_in, 0.08, 120) : 2.5);
    const rhoL = liqOut ? clamp(liqOut.densityKgM3, 450, 1900) : (phase_in !== 'G' ? clamp(rho_in, 450, 1900) : 1150);

    const gasFluidId = vapOut
      ? mapSimFlowsToChemProFluid(vapOut.flowsKgH, 'G', vapOut.tempC, vapOut.pressKgcm2g)
      : mapSimFlowsToChemProFluid(sumInFlows, 'G', T_out, P_out);
    const liqFluidId = liqOut
      ? mapSimFlowsToChemProFluid(liqOut.flowsKgH, 'L', liqOut.tempC, liqOut.pressKgcm2g)
      : mapSimFlowsToChemProFluid(sumInFlows, 'L', T_out, P_out);

    const Pop = Number((P_out * 0.980665).toFixed(2));
    const Pdes = Number(Math.max(2.5, Math.abs(Pop) * 1.25 + 1.5).toFixed(1));
    const mat_key =
      liqFluidId === 'liquid_cl2' || gasFluidId === 'cl2_dry_gas'
        ? 'SA-516-70'
        : 'SA-240-316L';

    return {
      version: 1,
      timestamp: Date.now(),
      sourceLabel,
      tab: 'vessel',
      equipTag: node.tag,
      equipName: node.name,
      detectedFluidSummary,
      vessel: {
        orientation: t === 'h_drum_visual' ? 'horizontal' : 'vertical',
        gasFluidId,
        liqFluidId,
        Wg_kgh: Math.round(Math.max(10, Wg)),
        Wl_kgh: Math.round(Math.max(50, Wl)),
        rhoG: Number(rhoG.toFixed(2)),
        rhoL: Math.round(rhoL),
        P_op_barG: Pop,
        P_des_barG: Pdes,
        mat_key,
      },
    };
  }

  // ── 5) 압축기 토출 가스 배관 설계 (PIPING) ──
  if (t === 'compressor') {
    const disStream = outStreams[0]?.stream;
    const flows = disStream ? disStream.flowsKgH : sumInFlows;
    const T_dis = disStream ? disStream.tempC : T_out;
    const P_dis = disStream ? disStream.pressKgcm2g : (node.params.outletPressKgcm2g ?? 3.5);
    const rho_dis = disStream ? clamp(disStream.densityKgM3, 0.1, 150) : 5.0;
    const Q_m3h = disStream ? Math.max(5, disStream.volFlowM3H) : Math.max(10, sumInMass / rho_dis);

    return {
      version: 1,
      timestamp: Date.now(),
      sourceLabel,
      tab: 'piping',
      equipTag: `${node.tag}-DIS`,
      equipName: `${node.name} 토출배관`,
      detectedFluidSummary,
      piping: {
        fluidId: mapSimFlowsToChemProFluid(flows, 'G', T_dis, P_dis),
        flowMode: 'gas',
        T_C: Number(T_dis.toFixed(1)),
        P1_barG: Number(Math.max(0.2, P_dis * 0.980665).toFixed(2)),
        Q_m3h: Number(Q_m3h.toFixed(1)),
        rho_kgm3: Number(rho_dis.toFixed(2)),
      },
    };
  }

  return null;
}

export function saveChemProHandoffPayload(payload: ChemProSimHandoffPayload): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CHEMPRO_SIM_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

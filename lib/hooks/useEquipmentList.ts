// =====================================================================
// 장치 선택 시 연결 스트림/유체 자동 감지 훅
// PFD의 하드코딩 노드와 userNodes를 합쳐서 목록 제공
// =====================================================================

import { useMemo } from 'react';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useBalanceStore } from '@/lib/stores/balanceStore';

// ─── 유체 타입 문자열 → physicalProperties key 매핑 ─────────────────
const FLUID_TYPE_TO_KEY: Record<string, string> = {
  'Brine':          'brine_25',
  'NaOH':           'naoh_32',
  'NaOH32':         'naoh_32',
  'NaOH50':         'naoh_50',
  'Cl2':            'cl2_gas',
  'H2':             'h2_gas',
  'HCl':            'hcl_31',
  'H2SO4':          'h2so4_98',
  'Water':          'process_water',
  'ProcessWater':   'process_water',
  'CoolingWater':   'cooling_water',
  'Catholyte':      'catholyte',
  'Anolyte':        'anolyte',
};

// ─── 장치 타입 ───────────────────────────────────────────────────────
export type EquipmentItem = {
  id: string;
  tag: string;
  name: string;
  type: string;    // 'pump' | 'tower' | 'heatExchanger' | ...
  section: string;
  /** 연결된 유체 키 (physicalProperties) — 감지 실패 시 undefined */
  fluidKey?: string;
  /** 연결된 스트림 번호 */
  streamIds: string[];
  /** 연결된 엣지들의 fluidType (SelectionPanel 저장값) */
  fluidType?: string;
};

// PFD 하드코딩 펌프 / 타워(컬럼) / 열교환기 정적 데이터
const STATIC_EQUIPMENT: EquipmentItem[] = [
  // ── 100 SEC: 염수 정제 ──────────────────────────────────────────────
  { id: 'P044', tag: 'P-044A/B', name: 'Brine Saturation Pump (포화염수 펌프)',      type: 'pump',  section: '100', fluidKey: 'brine_25',     streamIds: ['004'] },
  { id: 'P033', tag: 'P-033A/B', name: 'Brine Storage Pump (반응 전 이송펌프)',      type: 'pump',  section: '100', fluidKey: 'brine_25',     streamIds: ['013'] },
  { id: 'P014', tag: 'P-014A/B', name: 'Reaction Tank Pump (반응 후 이송펌프)',      type: 'pump',  section: '100', fluidKey: 'brine_25',     streamIds: ['022'] },
  { id: 'P154', tag: 'P-154A/B', name: 'Brine Filter Feed Pump (침전 후 이송펌프)',  type: 'pump',  section: '100', fluidKey: 'brine_25',     streamIds: ['102'] },
  { id: 'P084', tag: 'P-084A/B', name: 'Brine Feed Pump to Elec (전해조 공급펌프)',  type: 'pump',  section: '100', fluidKey: 'brine_fed',    streamIds: ['104'] },
  { id: 'T160', tag: 'T-160',    name: 'Ion Exchange Resin Tower (이온교환수지탑)',  type: 'tower', section: '100', fluidKey: 'brine_25',     streamIds: ['102', '104'] },

  // ── 200 SEC: 전해 및 탈염소 ──────────────────────────────────────────
  { id: 'P244', tag: 'P-244A/B', name: 'Anolyte Feed Pump (양극액 순환펌프)',        type: 'pump',  section: '200', fluidKey: 'brine_fed',    streamIds: ['201'] },
  { id: 'P254', tag: 'P-254A/B', name: 'Catholyte Circ. Pump (음극액 순환펌프)',     type: 'pump',  section: '200', fluidKey: 'naoh_32',      streamIds: ['211', '208'] },
  { id: 'P284', tag: 'P-284A/B', name: 'NaOH Product Pump (가성소다 제품펌프)',      type: 'pump',  section: '200', fluidKey: 'naoh_32',      streamIds: ['219', '217'] },
  { id: 'P264', tag: 'P-264A/B', name: 'Dechlorinated Brine Pump (탈염소 펌프)',     type: 'pump',  section: '200', fluidKey: 'anolyte',      streamIds: ['218', '224'] },
  { id: 'P314', tag: 'P-314A/B', name: 'Brine Return Pump (염수 반송펌프)',          type: 'pump',  section: '200', fluidKey: 'anolyte',      streamIds: ['224', '250'] },
  { id: 'P374', tag: 'P-374A/B', name: 'Depleted Brine Pump (희박염수 이송펌프)',    type: 'pump',  section: '200', fluidKey: 'anolyte',      streamIds: ['250', '256'] },
  { id: 'T280', tag: 'T-280',    name: 'Vacuum Dechlorination Tower (감압 탈염소탑)',type: 'tower', section: '200', fluidKey: 'anolyte',      streamIds: ['218', '250', '252'] },

  // ── 300 SEC: 가성소다 3중 효용 강하막식 증발 농축 (32% → 50%, Excel "300 Sec") ──
  { id: 'E332', tag: 'E-332',    name: '1st Preheater - NaOH (1효 가성소다 열회수 예열기 E-5332)', type: 'heatExchanger', section: '300', fluidKey: 'naoh_50', streamIds: ['L11', 'L12', 'L8', 'L10'] },
  { id: 'E333', tag: 'E-333',    name: '1st Preheater - Cond. (1효 응축수 열회수 예열기 E-5333)',  type: 'heatExchanger', section: '300', fluidKey: 'naoh_50', streamIds: ['C1', 'C2', 'L9', 'L10'] },
  { id: 'E342', tag: 'E-342',    name: '2nd Preheater - NaOH (2효 가성소다 열회수 예열기 E-5342)', type: 'heatExchanger', section: '300', fluidKey: 'naoh_32', streamIds: ['L12', 'L13', 'L3', 'L5'] },
  { id: 'E343', tag: 'E-343',    name: '2nd Preheater - Cond. (2효 응축수 열회수 예열기 E-5343)',  type: 'heatExchanger', section: '300', fluidKey: 'naoh_32', streamIds: ['C2', 'C3', 'L4', 'L5'] },
  { id: 'E352', tag: 'E-352',    name: '50% NaOH Product Cooler (50% 제품 냉각기 E-5352)',        type: 'heatExchanger', section: '300', fluidKey: 'naoh_50', streamIds: ['L13', 'L14', 'L15'] },
  { id: 'E350', tag: 'E-350',    name: 'Surface Condenser (3효 진공 표면응축기 E-5350)',           type: 'heatExchanger', section: '300', fluidKey: 'cooling_water', streamIds: ['V3'] },
  { id: 'P321', tag: 'P-321A/B', name: '1st Effect 50% NaOH Pump (1효 배출/순환펌프)',            type: 'pump',          section: '300', fluidKey: 'naoh_50', streamIds: ['L11'] },
  { id: 'P331', tag: 'P-331A/B', name: '2nd Effect 42.1% NaOH Pump (2효 이송/순환펌프)',          type: 'pump',          section: '300', fluidKey: 'naoh_50', streamIds: ['L7'] },
  { id: 'P341', tag: 'P-341A/B', name: '3rd Effect 36.4% NaOH Pump (3효 이송/순환펌프)',          type: 'pump',          section: '300', fluidKey: 'naoh_32', streamIds: ['L2'] },

  // ── 400 SEC: 염소가스 세정·냉각·황산건조(T-430~450)·액화 & 700 SEC Hypo 제해탑(T-730/760) ──
  { id: 'T410', tag: 'T-410',    name: '1st Cl₂ Wash Tower (염소가스 1차 수세/직접냉각탑)',        type: 'tower', section: '400', fluidKey: 'cl2_gas',      streamIds: ['220', '401', '402'] },
  { id: 'T420', tag: 'T-420',    name: '2nd Cl₂ Chilled Wash Tower (염소가스 2차 냉수세정탑)',      type: 'tower', section: '400', fluidKey: 'cl2_gas',      streamIds: ['403', '405', '404'] },
  { id: 'T430', tag: 'T-430',    name: 'H₂SO₄ Drying Tower 1단 (황산 1차 건조탑 - 78% H₂SO₄)',     type: 'tower', section: '400', fluidKey: 'cl2_gas',      streamIds: ['405', '409', '416'] },
  { id: 'T440', tag: 'T-440',    name: 'H₂SO₄ Drying Tower 2단 (황산 2차 건조탑 - 88% H₂SO₄)',     type: 'tower', section: '400', fluidKey: 'cl2_gas',      streamIds: ['409', '411', '416'] },
  { id: 'T450', tag: 'T-450',    name: 'H₂SO₄ Drying Tower 3단 (황산 최종 건조탑 - 98% H₂SO₄)',    type: 'tower', section: '400', fluidKey: 'cl2_gas',      streamIds: ['411', '413', '416'] },
  { id: 'T730', tag: 'T-730',    name: 'Hypo / Vent Cl₂ Tower 1단 (폐염소 제해 / 차아염소산 제조 1차 타워)', type: 'tower', section: '400', fluidKey: 'naoh_32', streamIds: ['420', '429'] },
  { id: 'T760', tag: 'T-760',    name: 'Hypo / Vent Cl₂ Tower 2단 (폐염소 제해 / 차아염소산 제조 2차 타워)', type: 'tower', section: '400', fluidKey: 'naoh_32', streamIds: ['420', '429'] },
  { id: 'E413', tag: 'E-413',    name: 'Cl₂ Cooler 1 (염소 1차 냉각기 - CW)',       type: 'heatExchanger', section: '400', fluidKey: 'cl2_gas', streamIds: ['401', '403'] },
  { id: 'E423', tag: 'E-423',    name: 'Cl₂ Cooler 2 (염소 2차 냉각기 - 냉수)',      type: 'heatExchanger', section: '400', fluidKey: 'cl2_gas', streamIds: ['403', '405'] },
  { id: 'E433', tag: 'E-433',    name: 'Cl₂ Cooler 3 (염소 3차 냉각기 - 칠러)',      type: 'heatExchanger', section: '400', fluidKey: 'cl2_gas', streamIds: ['405'] },
  { id: 'D484', tag: 'D-484',    name: 'Cl₂ Liquefier (염소 냉동 액화기)',           type: 'heatExchanger', section: '400', fluidKey: 'cl2_gas', streamIds: ['415', '418'] },
  { id: 'P413a',tag: 'P-413A/B', name: 'Cl₂ Wash Tower Circ. Pump (수세탑 순환펌프)', type: 'pump',  section: '400', fluidKey: 'process_water',streamIds: ['402'] },
  { id: 'P413c',tag: 'P-413C/D', name: 'H₂SO₄ Drying Circ. Pump (황산 순환펌프)',    type: 'pump',  section: '400', fluidKey: 'h2so4_98',     streamIds: ['416'] },
  { id: 'P450', tag: 'P-450A/B', name: 'H₂SO₄ Feed Pump (농황산 공급펌프)',         type: 'pump',  section: '400', fluidKey: 'h2so4_98',     streamIds: ['416'] },
  { id: 'P494', tag: 'P-494A/B', name: 'Liq Cl₂ Transfer Pump (액화염소 이송펌프)',  type: 'pump',  section: '400', fluidKey: 'cl2_gas',      streamIds: ['421'] },
  { id: 'P496', tag: 'P-496A/B', name: 'Liq Cl₂ Product Pump (액화염소 출하펌프)',   type: 'pump',  section: '400', fluidKey: 'cl2_gas',      streamIds: ['425'] },

  // ── 600 SEC: 수소가스 세정·냉각·압축·정제 ────────────────────────────────
  { id: 'T610', tag: 'T-610',    name: 'H₂ Caustic Removal Tower (수소가스 가성소다 제거 세정탑)', type: 'tower', section: '600', fluidKey: 'h2_gas', streamIds: ['221', '601'] },
  { id: 'E5613',tag: 'E-5613',   name: 'H₂ 1st Cooler - CW (수소 1차 냉각기)',       type: 'heatExchanger', section: '600', fluidKey: 'h2_gas',  streamIds: ['221', '601', '602'] },
  { id: 'E5630',tag: 'E-5630',   name: 'H₂ 2nd Cooler - CCW (수소 2차 칠러냉각기)',  type: 'heatExchanger', section: '600', fluidKey: 'h2_gas',  streamIds: ['602', '603', '612'] },
  { id: 'E5680',tag: 'E-5680',   name: 'H₂ Purif Cooler (고압 수소 정제 냉각기)',     type: 'heatExchanger', section: '600', fluidKey: 'h2_gas',  streamIds: ['608', '609'] },
  { id: 'E5682',tag: 'E-5682',   name: 'H₂ After-cooler (수소 최종 후단 냉각기)',     type: 'heatExchanger', section: '600', fluidKey: 'h2_gas',  streamIds: ['610', '611'] },
  { id: 'P613', tag: 'P-613A/B', name: 'H₂ Condensate Drain Pump (응축수 이송펌프)', type: 'pump',  section: '600', fluidKey: 'process_water',streamIds: ['604'] },
];

// PLANT 03 (1A 염산·회수 공장) 전용 정적 장치 목록
const HCL_SYNTH_EQUIPMENT: EquipmentItem[] = [
  // ── 100 SEC: 염소-수소 합성 및 35% 전자급 염산 흡수·제해 ──
  { id: 'E102', tag: 'E-102', name: 'HCl Synthesis Quench Cooler (합성로 급냉 가스 냉각기)', type: 'heatExchanger', section: '100', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'C110', tag: 'C-110', name: 'Graphite Falling-Film Absorber (흑연 강하막 흡수탑 · 35% HCl)', type: 'tower', section: '100', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'T130', tag: 'T-130', name: 'Tail-Gas Alkali Scrubber (테일가스 알칼리 제해탑 · 20% NaOH)', type: 'tower', section: '100', fluidKey: 'naoh_32', streamIds: [] },
  { id: 'P115', tag: 'P-115', name: '35% Electronic HCl Transfer Pump (전자급 염산 이송펌프)', type: 'pump', section: '100', fluidKey: 'hcl_31', streamIds: [] },

  // ── 200 SEC: 5N 무수염산(AHCl) 제습·정제 ──
  { id: 'T210', tag: 'T-210', name: '98% H₂SO₄ Dehydration Tower (황산 초정밀 제습탑 · <1 ppm H₂O)', type: 'tower', section: '200', fluidKey: 'h2so4_98', streamIds: [] },
  { id: 'C220', tag: 'C-220', name: 'AHCl Liquefaction & Stripper (무수염산 액화·분리탑)', type: 'tower', section: '200', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'E225', tag: 'E-225', name: 'AHCl Condenser / Reboiler HX (무수염산 응축·열교환기)', type: 'heatExchanger', section: '200', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'C230', tag: 'C-230', name: '5N AHCl Light-Gas Purifier (5N 무수염산 정제탑 · 99.999%)', type: 'tower', section: '200', fluidKey: 'hcl_31', streamIds: [] },

  // ── 300 SEC: 폐염산 진공농축 및 가압 공비탈기 회수 ──
  { id: 'C310', tag: 'C-310', name: 'Spent HCl Vacuum Concentrator (폐염산 진공 농축탑 · 0.15 barA)', type: 'tower', section: '300', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'P315', tag: 'P-315', name: 'Concentrated Spent HCl Pump (농축 폐염산 가압 이송펌프)', type: 'pump', section: '300', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'C320', tag: 'C-320', name: 'Pressurized Azeotropic Stripper (가압 공비탈기 증류탑 · 7.0 barA)', type: 'tower', section: '300', fluidKey: 'hcl_31', streamIds: [] },
  { id: 'E325', tag: 'E-325', name: 'Spent HCl Recovery Preheater/Cooler (폐염산 회수 열교환기)', type: 'heatExchanger', section: '300', fluidKey: 'hcl_31', streamIds: [] },
];

// PLANT 03 (Bio-ECH 70,000 TPA) 전용 정적 장치 목록
const ECH_GTE_EQUIPMENT: EquipmentItem[] = [
  { id: 'ech_r101', tag: 'R-101', name: '글리세린 염산 촉매 반응기 (DCH 합성 · 112°C)', type: 'reactor',       section: '100', fluidKey: 'dch_13',   streamIds: ['101', '104'] },
  { id: 'ech_e102', tag: 'E-102', name: 'DCH 반응물 냉각기 (112→55°C · CW)',              type: 'heatExchanger', section: '100', fluidKey: 'dch_13',   streamIds: ['104', '105'] },
  { id: 'ech_p101', tag: 'P-101', name: '조 DCH 반응액 이송 펌프',                        type: 'pump',          section: '100', fluidKey: 'dch_13',   streamIds: ['105'] },
  { id: 'ech_r201', tag: 'R-201', name: 'NaOH 비누화 · ECH 고리화 반응기 (68°C)',       type: 'reactor',       section: '200', fluidKey: 'ech_pure', streamIds: ['201', '203'] },
  { id: 'ech_v202', tag: 'V-202', name: '조 ECH / 염수 LLE 유수분리 디캔터',              type: 'separator',     section: '200', fluidKey: 'ech_pure', streamIds: ['203', '204'] },
  { id: 'ech_c101', tag: 'C-101', name: '경질분·수분 공비탈수 증류탑 (20단 · -0.65 kG)', type: 'tower',         section: '300', fluidKey: 'ech_pure', streamIds: ['301', '302'] },
  { id: 'ech_c102', tag: 'C-102', name: '99.9% ECH 제품 진공 정제탑 (26단 · -0.92 kG)',  type: 'tower',         section: '300', fluidKey: 'ech_pure', streamIds: ['302', '303'] },
  { id: 'ech_e301', tag: 'E-301', name: '고순도 99.9% ECH 제품 냉각기 (62→35°C · CW)',  type: 'heatExchanger', section: '300', fluidKey: 'ech_pure', streamIds: ['303'] },
  { id: 'ech_p301', tag: 'P-301', name: '99.9% 에폭시급 ECH 제품 이송 펌프',              type: 'pump',          section: '300', fluidKey: 'ech_pure', streamIds: ['303'] },
];

// PLANT 04 (클로로메탄 CMS · MCL 120 + CFM 80 T/D) 전용 정적 장치 목록
const CMS_PLANT_EQUIPMENT: EquipmentItem[] = [
  { id: 'cms_e101', tag: 'E-101', name: '액화염소(Cl₂) 가압 기화기 (25→95°C · 24.5 kG)',  type: 'heatExchanger', section: '100', fluidKey: 'cl2_gas', streamIds: ['101'] },
  { id: 'cms_r101', tag: 'R-101', name: 'AIBN 라디칼 염소화 고압 반응기 (120°C · 24 kG)',   type: 'reactor',       section: '100', fluidKey: 'CH3Cl',   streamIds: ['103', '104'] },
  { id: 'cms_e102', tag: 'E-102', name: '염소화 반응생성물 냉각기 (120→38°C · CW)',        type: 'heatExchanger', section: '100', fluidKey: 'CH2Cl2',  streamIds: ['104'] },
  { id: 'cms_c201', tag: 'C-201', name: '고압 무수염산(AHCl) 탈거탑 (60단 · 17.5 kG)',       type: 'tower',         section: '200', fluidKey: 'HCl',     streamIds: ['201', '202'] },
  { id: 'cms_c202', tag: 'C-202', name: '미반응 MC 순환 분리탑 (50단 · 6.5 kG · MCL 무순환)', type: 'tower',       section: '200', fluidKey: 'CH3Cl',   streamIds: ['202', '203'] },
  { id: 'cms_p202', tag: 'P-202', name: '순환 메틸클로라이드(MC) 승압 펌프 (9.2→24.5 kG)',  type: 'pump',          section: '200', fluidKey: 'CH3Cl',   streamIds: ['203'] },
  { id: 'cms_c203', tag: 'C-203', name: 'Azeo 공비·경질 분리탑 (30단 · 2.2 kG)',             type: 'tower',         section: '200', fluidKey: 'CH2Cl2',  streamIds: ['204'] },
  { id: 'cms_c301', tag: 'C-301', name: '고순도 MCL 제품 정제탑 (80단 · 120 T/D · 99.99%)',  type: 'tower',         section: '300', fluidKey: 'CH2Cl2',  streamIds: ['301', '302'] },
  { id: 'cms_e301', tag: 'E-301', name: '고순도 MCL 제품 냉각기 (78→32°C · CW)',              type: 'heatExchanger', section: '300', fluidKey: 'CH2Cl2',  streamIds: ['302'] },
  { id: 'cms_c302', tag: 'C-302', name: 'CFM 정제탑 & CTC/헤비 폐기분리 (120단 · 80 T/D)',  type: 'tower',         section: '300', fluidKey: 'CHCl3',   streamIds: ['303', '304'] },
];

// PLANT 05 (MDI 10만톤 통합 공정) 전용 정적 장치 목록 (14기)
const MDI_PLANT_EQUIPMENT: EquipmentItem[] = [
  // ── 100 SEC: MDA 합성 · 염수 디캔터 · 진공탈수 · 아닐린 감압회수 ──
  { id: 'mdi_r101', tag: 'R-101',    name: 'MDA 축합·전위 및 가성중화 반응기 (95°C · 2.5 kG)',             type: 'reactor',       section: '100', streamIds: ['103', '104', '105'] },
  { id: 'mdi_d101', tag: 'D-101',    name: '염수 수세 유수분리 디캔터 (LLE Settler · 75°C)',                type: 'separator',     section: '100', streamIds: ['105', '106', '107'] },
  { id: 'mdi_s101', tag: 'S-101',    name: '유기층 진공 탈수 드럼 (Flash Dehydrator · 140°C / -0.80 kG)',  type: 'separator',     section: '100', streamIds: ['107', '107V', '108'] },
  { id: 'mdi_c101', tag: 'C-101',    name: '아닐린 감압 회수탑 (14단 · -0.88 kG)',                         type: 'tower',         section: '100', streamIds: ['108', '112', '204'] },
  { id: 'mdi_p101', tag: 'P-101A/B', name: 'MDA/아닐린 순환·이송 펌프 (Circulation Pump)',                  type: 'pump',          section: '100', streamIds: ['105', '204'] },

  // ── 200 SEC: CO+Cl2 포스겐 합성 · 2단 포스겐화 · 부생 HCl 회수 ──
  { id: 'mdi_r201',   tag: 'R-201',   name: '포스겐(COCl₂) 활성탄 촉매 합성 반응기 (90°C · 3.5 kG)',       type: 'reactor',   section: '200', streamIds: ['201', '202', '203'] },
  { id: 'mdi_r202',   tag: 'R-202',   name: 'MDA 2단 연속 포스겐화 반응기 (145°C · MCB 용매)',             type: 'reactor',   section: '200', streamIds: ['203', '204', '205', '206'] },
  { id: 'mdi_s201',   tag: 'S-201',   name: '부생 HCl · 포스겐 냉각 기액 분리기 (38°C · 2.0 kG)',          type: 'separator', section: '200', streamIds: ['206', '207', '301'] },
  { id: 'mdi_psv201', tag: 'PSV-201', name: '포스겐 반응계 긴급 압력방출 안전밸브 (API 526 Orifice)',      type: 'psv',       section: '200', streamIds: ['203', '206'] },

  // ── 300 SEC: 탈포스겐 스트리핑 & MCB 용매 진공 회수 ──
  { id: 'mdi_c301', tag: 'C-301',    name: '탈포스겐(COCl₂) 회수 스트리퍼 (14단 · 2.0 kG)',                type: 'tower', section: '300', streamIds: ['301', '311', '302'] },
  { id: 'mdi_c302', tag: 'C-302',    name: 'MCB 용매 진공 회수탑 (16단 · -0.90 kG)',                        type: 'tower', section: '300', streamIds: ['302', '312A', '401'] },
  { id: 'mdi_p302', tag: 'P-302A/B', name: '회수 MCB 용매 이송·순환 펌프 (MCB Transfer Pump)',              type: 'pump',  section: '300', streamIds: ['312'] },

  // ── 400 SEC: 고진공 박막 예열 및 Pure 4,4'-MDI / PMDI 정밀 분별 ──
  { id: 'mdi_e401', tag: 'E-401',    name: '고진공 박막 예열기 (TFE Preheater · 190°C · -0.985 kG)',       type: 'heatExchanger', section: '400', streamIds: ['401', '401A'] },
  { id: 'mdi_c401', tag: 'C-401',    name: '고진공 Pure 4,4\'-MDI / PMDI 분별탑 (16단 · 20 mbar)',         type: 'tower',         section: '400', streamIds: ['401A', '402A', '403A'] },
];

// ─── 메인 훅 ─────────────────────────────────────────────────────────
export function useEquipmentList(typeFilter?: 'pump' | 'tower' | 'heatExchanger') {
  const activePlantId     = useBalanceStore(s => s.activePlantId);
  const userNodes         = usePFDStore(s => s.userNodes);
  const edgeFluidMap      = usePFDStore(s => s.edgeFluidMap ?? {});
  const nodeTagOverrides  = usePFDStore(s => s.nodeTagOverrides ?? {});

  return useMemo(() => {
    const matchUserType = (nType: string) => {
      if (!typeFilter) return true;
      if (typeFilter === 'tower') return nType === 'tower' || nType === 'towerPacking';
      return nType === typeFilter;
    };

    const staticSource =
      activePlantId === 'hcl_synth'
        ? HCL_SYNTH_EQUIPMENT
        : activePlantId === 'ech_gte'
          ? ECH_GTE_EQUIPMENT
          : activePlantId === 'cms_plant'
            ? CMS_PLANT_EQUIPMENT
            : activePlantId === 'mdi_plant'
              ? MDI_PLANT_EQUIPMENT
              : activePlantId === 'green_h2'
                ? []
                : STATIC_EQUIPMENT;

    const allEquipment: EquipmentItem[] = [
      ...staticSource.map(eq => {
        const nodeId = `s${eq.section}_${eq.id}`;
        const ov = nodeTagOverrides[nodeId];
        return ov ? { ...eq, tag: ov.tag, name: ov.name } : eq;
      }),
      ...userNodes
        .filter(n => matchUserType(n.type))
        .map(n => ({
          id:        n.id,
          tag:       n.tag,
          name:      n.name,
          type:      n.type === 'towerPacking' ? 'tower' : n.type,
          section:   n.section,
          streamIds: [] as string[],
          fluidKey:  undefined as string | undefined,
          fluidType: undefined as string | undefined,
        })),
    ];

    // edgeFluidMap에서 각 장치의 fluidType 보완
    const fluidByNode: Record<string, string> = {};
    Object.entries(edgeFluidMap).forEach(([edgeId, fluidType]) => {
      const parts = edgeId.split('-');
      if (parts.length >= 2) {
        const nodeIds = parts.slice(1);
        nodeIds.forEach(nid => {
          if (!fluidByNode[nid] && fluidType && fluidType !== 'custom') {
            fluidByNode[nid] = fluidType;
          }
        });
      }
    });

    const resolveFluidKey = (fluidType?: string, defaultKey?: string): string | undefined => {
      if (!fluidType) return defaultKey;
      return FLUID_TYPE_TO_KEY[fluidType] ?? defaultKey;
    };

    const enriched = allEquipment.map(eq => {
      const detectedFluidType = fluidByNode[eq.id];
      return {
        ...eq,
        fluidType: detectedFluidType ?? eq.fluidType,
        fluidKey:  resolveFluidKey(detectedFluidType, eq.fluidKey),
      };
    });

    return typeFilter
      ? enriched.filter(e => e.type === typeFilter)
      : enriched;
  }, [activePlantId, userNodes, edgeFluidMap, nodeTagOverrides, typeFilter]);
}

/** 장치 tag로 조회 */
export function useEquipmentByTag(tag: string): EquipmentItem | undefined {
  const all = useEquipmentList();
  return all.find(e => e.tag === tag || e.id === tag);
}

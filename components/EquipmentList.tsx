'use client';
import React, { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import {
  calcHeatExchanger, getHXProcessPreset, getTowerProcessPreset, HXDesignInputs,
} from '@/lib/hxCalc';
import { PACKING_DB, calcPackingTower, PackingTowerInputs } from '@/lib/packingCalc';
import { LIQUID_FLUIDS, GAS_FLUIDS, densityAtT, viscosityAtT, gasDensity } from '@/lib/physicalProperties';
import { calcFallingFilmEvaporator, getFallingFilmPreset } from '@/lib/calculations/evaporator';
import {
  calcBrineSaturator,
  calcCandleBrineFilter,
  calcChelatingIonExchange,
  getBrinePurifPresets,
} from '@/lib/calculations/brinePurification';

// ── EPC Equipment List standard columns ───────────────────────────────────
export interface EquipmentItem {
  tag: string;           // Tag No. e.g. D-010
  name: string;          // Equipment Name
  type: string;          // Type (Tank, Pump, HX, Column...)
  section: string;       // Process section
  fluid: string;         // Process fluid
  qty: number;           // Quantity
  operTemp: string;      // Operating Temperature
  operPress: string;     // Operating Pressure
  designTemp: string;    // Design Temperature
  designPress: string;   // Design Pressure
  material: string;      // Shell / Lining material
  capacity: string;      // Volume / Flow / Duty
  motor: string;         // Motor (kW)
  remarks: string;       // Remarks / Notes
  nodeId?: string;       // Linked PFD node id
  designedAt?: string;   // Timestamp if updated by Equipment Design module
}

// ── Built-in equipment from PFD sections (100 ~ 600 SEC 전수 반영) ─────────
export const BUILTIN_EQUIPMENT: EquipmentItem[] = [
  // ── 100 SEC: 염수 정제 ──────────────────────────────────────────────────
  { tag:'D-010', name:'포화조 (Brine Saturation Tank)', type:'Tank',   section:'100', fluid:'Sat. Brine + Salt', qty:1, operTemp:'67', operPress:'Atm', designTemp:'90', designPress:'Atm/FV', material:'FRP / CS+RL', capacity:'ID 5.6 m × H 7.2 m (~177 m³)', motor:'-',        remarks:'Upflow salt-bed saturator (Salt 23.1 t/h, LV 8.0 m/h)', nodeId:'s100_D010' },
  { tag:'P-044', name:'포화염수 펌프',                  type:'Pump',   section:'100', fluid:'Sat. Brine', qty:2, operTemp:'70', operPress:'3.4', designTemp:'90', designPress:'6.0',material:'316L SS',       capacity:'~205 m³/h',motor:'37 kW',   remarks:'A/B standby (D-010→D-013)', nodeId:'s100_P044' },
  { tag:'D-013', name:'브라인 완충조',                  type:'Tank',   section:'100', fluid:'Sat. Brine', qty:1, operTemp:'70', operPress:'Atm', designTemp:'90', designPress:'FV', material:'FRP',           capacity:'~50 m³',   motor:'-',        remarks:'Buffer tank before P-033. RT 20 min', nodeId:'s100_D013' },
  { tag:'P-033', name:'반응 전 브라인 이송펌프',         type:'Pump',   section:'100', fluid:'Sat. Brine', qty:2, operTemp:'70', operPress:'3.5', designTemp:'90', designPress:'6.0',material:'316L SS',       capacity:'~205 m³/h',motor:'37 kW',   remarks:'A/B standby (D-013→D-020)', nodeId:'s100_P033' },
  { tag:'D-020', name:'정제 반응조',                    type:'Tank',   section:'100', fluid:'Brine+Chem', qty:1, operTemp:'70', operPress:'Atm', designTemp:'90', designPress:'FV', material:'FRP',           capacity:'~210 m³',  motor:'22 kW',   remarks:'Chemical treatment. RT 60 min', nodeId:'s100_D020' },
  { tag:'P-014', name:'반응 후 브라인 이송펌프',         type:'Pump',   section:'100', fluid:'Brine',      qty:2, operTemp:'70', operPress:'3.5', designTemp:'90', designPress:'6.0',material:'316L SS',       capacity:'~210 m³/h',motor:'37 kW',   remarks:'A/B standby (D-020→T-030)', nodeId:'s100_P014' },
  { tag:'T-030', name:'포화/침전정제조 (Saturator & Clarifier)', type:'Settler',section:'100', fluid:'Sat. Brine Slurry',qty:1,operTemp:'67', operPress:'Atm', designTemp:'85', designPress:'Atm/FV', material:'CS+Rubber/Epoxy', capacity:'ID 5.6 m × H 7.2 m (V=177 m³)', motor:'2.2 kW (Rake)', remarks:'포화/침전정제조 (Salt 23.1 t/h, LV 8.0 m/h, SS <15 ppm)', nodeId:'s100_T030' },
  { tag:'P-154', name:'침전 후 여과공급 펌프',           type:'Pump',   section:'100', fluid:'Brine',      qty:2, operTemp:'65', operPress:'3.9', designTemp:'80', designPress:'6.0',material:'316L SS',       capacity:'~210 m³/h',motor:'37 kW',   remarks:'A/B standby', nodeId:'s100_P154' },
  { tag:'D-040', name:'여과 전 완충조',                  type:'Tank',   section:'100', fluid:'Brine',      qty:1, operTemp:'65', operPress:'Atm', designTemp:'80', designPress:'FV', material:'FRP',           capacity:'~140 m³',  motor:'-',        remarks:'Pre-filter buffer. RT 40 min', nodeId:'s100_D040' },
  { tag:'F-140', name:'캔들 프리코트 카본 브라인 필터 (Candle Filter)', type:'Filter', section:'100', fluid:'Brine + Carbon Precoat', qty:3, operTemp:'65', operPress:'3.5', designTemp:'85', designPress:'6.0',material:'CS+Rubber / PVDF Candle', capacity:'82 m²/기 (Candle Ø70×1500 248EA, ID 1950mm)', motor:'Precoat 164 m³/h', remarks:'2운전+1대기, LV 1.2 m/h, SS 20→<0.2 ppm, 여과주기 ~28 hr', nodeId:'s100_F150' },
  { tag:'D-150', name:'2차 브라인 완충조',               type:'Tank',   section:'100', fluid:'Brine',      qty:1, operTemp:'65', operPress:'Atm', designTemp:'80', designPress:'FV', material:'FRP',           capacity:'~100 m³',  motor:'-',        remarks:'Pre IX buffer. RT 30 min', nodeId:'s100_D150' },
  { tag:'T-160', name:'킬레이트 이온교환수지탑 (Chelating IX Tower)', type:'Column', section:'100', fluid:'Filtered Brine', qty:2, operTemp:'62', operPress:'3.2', designTemp:'85', designPress:'6.0',material:'CS+Rubber (5t) / Hastelloy C', capacity:'ID 3,200 mm × Z 1,230 mm (1 BV=9.9 m³/탑)', motor:'-', remarks:'Lewatit TP 208 (Lead-Lag 2탑), SV 20 BV/h, 24h 주기 5단계 재생(HCl/PW/NaOH)', nodeId:'s100_T160' },
  { tag:'D-170', name:'정제 브라인 저장조',              type:'Tank',   section:'100', fluid:'Pure Brine', qty:1, operTemp:'65', operPress:'Atm', designTemp:'80', designPress:'FV', material:'FRP',           capacity:'~100 m³',  motor:'-',        remarks:'Post IX buffer. RT 30 min', nodeId:'s100_D170' },
  { tag:'P-084', name:'전해조 공급펌프',                 type:'Pump',   section:'100', fluid:'Pure Brine', qty:2, operTemp:'65', operPress:'4.5', designTemp:'80', designPress:'8.0',material:'Titanium Gr.2', capacity:'~215 m³/h',motor:'55 kW',   remarks:'Feed to electrolyzer. A/B', nodeId:'s100_P084' },

  // ── 200 SEC: 전해 및 탈염소 ─────────────────────────────────────────────
  { tag:'ELEC-201~250', name:'이온교환막 전해조',        type:'Electrolyzer', section:'200', fluid:'Brine/NaOH/Cl2/H2', qty:5, operTemp:'90', operPress:'0.45', designTemp:'95', designPress:'1.0', material:'Ti (anode), Ni (cathode)', capacity:'190 cells/unit, KA 16.2', motor:'-', remarks:'Asahi Kasei BiTAC membrane', nodeId:'s200_ELEC' },
  { tag:'D-210', name:'양극액 분리조 (Anolyte Tank)',    type:'Separator',section:'200', fluid:'Anolyte/Cl2',qty:1, operTemp:'87', operPress:'0.4', designTemp:'95', designPress:'1.5', material:'FRP+PVDF',      capacity:'~80 m³',   motor:'-',        remarks:'Anolyte gas-liquid separator', nodeId:'s200_D210' },
  { tag:'P-244', name:'양극액 순환 펌프',                type:'Pump',   section:'200', fluid:'Pure Brine', qty:2, operTemp:'65', operPress:'4.0', designTemp:'90', designPress:'7.0', material:'Titanium Gr.2', capacity:'~215 m³/h',motor:'55 kW',   remarks:'Anolyte feed circulation', nodeId:'s200_P244' },
  { tag:'D-220', name:'음극액/NaOH 순환조',              type:'Separator',section:'200', fluid:'32% NaOH/H2',qty:1, operTemp:'85', operPress:'0.4', designTemp:'95', designPress:'1.5', material:'CS+Ni lining',  capacity:'~120 m³',  motor:'-',        remarks:'Catholyte circulation tank', nodeId:'s200_D220' },
  { tag:'P-254', name:'음극액(NaOH) 순환 펌프',          type:'Pump',   section:'200', fluid:'32% NaOH',   qty:2, operTemp:'85', operPress:'4.0', designTemp:'95', designPress:'7.0', material:'316L SS / Ni',  capacity:'~280 m³/h',motor:'75 kW',   remarks:'Catholyte circulation A/B', nodeId:'s200_P254' },
  { tag:'P-284', name:'32% NaOH 제품 이송펌프',          type:'Pump',   section:'200', fluid:'32% NaOH',   qty:2, operTemp:'85', operPress:'3.5', designTemp:'95', designPress:'6.0', material:'316L SS',       capacity:'~55 m³/h', motor:'22 kW',   remarks:'NaOH product to 300 Sec', nodeId:'s200_P284' },
  { tag:'T-280', name:'감압 탈염소탑 (Dechlorinator)',   type:'Column', section:'200', fluid:'Depleted Brine',qty:1,operTemp:'86',operPress:'-0.55',designTemp:'95',designPress:'FV/1.0',material:'Titanium Gr.2',capacity:'D=2.2 m, Z=3.8 m',motor:'-',remarks:'Vacuum stripping column', nodeId:'s200_T280' },
  { tag:'P-264', name:'탈염소 브라인 펌프',              type:'Pump',   section:'200', fluid:'Depleted Brine',qty:2,operTemp:'87',operPress:'3.2',designTemp:'95',designPress:'6.0', material:'Titanium Gr.2', capacity:'~155 m³/h',motor:'37 kW',   remarks:'A/B standby', nodeId:'s200_P264' },
  { tag:'P-314', name:'염수 반송 펌프',                  type:'Pump',   section:'200', fluid:'Depleted Brine',qty:2,operTemp:'86',operPress:'3.3',designTemp:'95',designPress:'6.0', material:'Titanium Gr.2', capacity:'~160 m³/h',motor:'37 kW',   remarks:'A/B standby', nodeId:'s200_P314' },
  { tag:'P-374', name:'희박 브라인 이송펌프',            type:'Pump',   section:'200', fluid:'Depleted Brine',qty:2,operTemp:'90',operPress:'3.8',designTemp:'95',designPress:'7.0', material:'Titanium Gr.2', capacity:'~165 m³/h',motor:'45 kW',   remarks:'Return to 100 Sec A/B', nodeId:'s200_P374' },

  // ── 300 SEC: 가성소다 3중 효용 강하막식 증발 농축 (32% → 50%, 실측 설계 데이터시트 기준) ──
  { tag:'E-320',  name:'1효 강하막 증발관 (1st FFEvap E-5320)',     type:'Evaporator',section:'300', fluid:'NaOH 42.1→50.0%', qty:1, operTemp:'164.8',       operPress:'0.72',  designTemp:'220', designPress:'13.2/2.2', material:'Nickel 201 / SS304', capacity:'Falling Film 70.1 m² (70 Tubes, Ø48.3×6.8m, ID 637mm)', motor:'-', remarks:'1효 강하막 증발관: 70 Tubes, Γ=0.98 L/m·s (1.40 kg/m·s), 13K Steam 가열', nodeId:'s300_E320' },
  { tag:'D-321',  name:'1효 기액분리기 (1st Vapor Separator)',      type:'Separator', section:'300', fluid:'NaOH 50.0% / V1', qty:1, operTemp:'164.8',       operPress:'0.72',  designTemp:'190', designPress:'3.5',      material:'Nickel 200 Clad', capacity:'ID 1,500 × H 4,200 mm (20"-V-)',     motor:'-',     remarks:'1효 농축액/증기 V1(8,072 kg/h) 분리기', nodeId:'s300_D321' },
  { tag:'D-5321', name:'1효 스팀응축수 플래시폿 (1st Cond. Pot)',   type:'Separator', section:'300', fluid:'Steam Cond. C1/C5',qty:1,operTemp:'175.4→116.0', operPress:'0.72',  designTemp:'200', designPress:'12.0',     material:'SS 304',          capacity:'Flash C5 357 kg/h, Cond C1 10,356 kg/h', motor:'-', remarks:'FCV-5321 Flash Steam(1") → E-330 보충', nodeId:'s300_D5321' },
  { tag:'P-321',  name:'1효 50% NaOH 배출/순환펌프',               type:'Pump',      section:'300', fluid:'50.0% NaOH [L11]',qty:2, operTemp:'164.8',       operPress:'3.8',   designTemp:'190', designPress:'7.0',      material:'Nickel 200',      capacity:'~30 m³/h 배출 / 160 m³/h 순환 (4"-NA-B74)', motor:'45 kW', remarks:'1효 50% 제품 E-332 고온측 이송 A/B', nodeId:'s300_P321' },
  { tag:'E-330',  name:'2효 강하막 증발관 (2nd FFEvap E-5330)',     type:'Evaporator',section:'300', fluid:'NaOH 36.4→42.1%', qty:1, operTemp:'108.5',       operPress:'-0.68', designTemp:'200', designPress:'2.2/FV',   material:'Nickel 201 / SS316Ti', capacity:'Falling Film 168.8 m² (164 Tubes, Ø48.3×6.8m, ID 934mm)', motor:'-', remarks:'2효 강하막 증발관: 164 Tubes, Γ=1.03 kg/m·s (0.76 L/m·s), V1+C5 가열', nodeId:'s300_E330' },
  { tag:'D-331',  name:'2효 기액분리기 (2nd Vapor Separator)',      type:'Separator', section:'300', fluid:'NaOH 42.1% / V2', qty:1, operTemp:'108.5',       operPress:'-0.68', designTemp:'150', designPress:'FV/2.5',   material:'Nickel 200 Clad', capacity:'ID 1,900 × H 5,200 mm (28"-V-316L)', motor:'-',     remarks:'2효 농축액/증기 V2(7,970 kg/h) 분리기', nodeId:'s300_D331' },
  { tag:'P-331',  name:'2효 42.1% NaOH 이송/순환펌프',             type:'Pump',      section:'300', fluid:'42.1% NaOH [L7]', qty:2, operTemp:'108.5',       operPress:'3.2',   designTemp:'140', designPress:'6.0',      material:'Nickel 200',      capacity:'~37 m³/h 이송 / 175 m³/h 순환 (4"-NA-B74)', motor:'45 kW', remarks:'L8(75.5%→E-332) / L9(24.5%→E-333) 병렬 이송 A/B', nodeId:'s300_P331' },
  { tag:'E-340',  name:'3효 강하막 증발관 (3rd FFEvap E-5340)',     type:'Evaporator',section:'300', fluid:'NaOH 32.0→36.4%', qty:1, operTemp:'68.4',        operPress:'-0.94', designTemp:'200', designPress:'2.2/FV',   material:'Nickel 201 / SS316Ti', capacity:'Falling Film 430.0 m² (423 Tubes, Ø48.3×6.8m, ID 1484mm)', motor:'-', remarks:'3효 강하막 증발관: 423 Tubes, Γ=0.35 kg/m·s (0.26 L/m·s), V2+C6 가열', nodeId:'s300_E340' },
  { tag:'D-341',  name:'3효 기액분리기 (3rd Vapor Separator)',      type:'Separator', section:'300', fluid:'NaOH 36.4% / V3', qty:1, operTemp:'68.4',        operPress:'-0.94', designTemp:'120', designPress:'FV/2.0',   material:'SS 316L / Ni',    capacity:'ID 2,400 × H 6,500 mm (32"-V-316L)', motor:'-',     remarks:'3효 농축액/증기 V3(8,797 kg/h) 분리기', nodeId:'s300_D341' },
  { tag:'D-340',  name:'응축수 플래시 스팀 드럼 (D-5341)',          type:'Separator', section:'300', fluid:'Condensate C4/C6',qty:1, operTemp:'73.2',        operPress:'-0.68', designTemp:'120', designPress:'FV/3.0',   material:'SS 316L',         capacity:'Flash C6 702.7 kg/h (8.3%), Cond C4 24.5 t/h', motor:'-', remarks:'FCV-5331 Flash Steam → 3효 E-340 열원 회수', nodeId:'s300_D5341' },
  { tag:'P-341',  name:'3효 36.4% NaOH 이송/순환펌프',             type:'Pump',      section:'300', fluid:'36.4% NaOH [L2]', qty:2, operTemp:'68.4',        operPress:'2.8',   designTemp:'110', designPress:'5.0',      material:'Ni / 316L SS',    capacity:'~44 m³/h 이송 / 185 m³/h 순환 (6"-NA-B74)', motor:'37 kW', remarks:'L3(75.5%→E-342) / L4(24.5%→E-343) 병렬 이송 A/B', nodeId:'s300_P341' },
  { tag:'E-332',  name:'1효 가성소다 열회수 예열기 (E-5332)',       type:'HX',        section:'300', fluid:'50% / 42.1% NaOH',qty:1, operTemp:'164.8→120.0', operPress:'2.5',   designTemp:'190', designPress:'6.0',      material:'Nickel 200',      capacity:'Q=1,443,303 kcal/h (1,679 kW), A=54.0 m²', motor:'-', remarks:'Hot L11→L12 / Cold L8(75.5%) 108.5→156.2°C (LMTD 9.94°C)', nodeId:'s300_E332' },
  { tag:'E-333',  name:'1효 응축수 열회수 예열기 (E-5333)',         type:'HX',        section:'300', fluid:'Cond. C1 / 42.1%',qty:1, operTemp:'175.4→126.6', operPress:'3.0',   designTemp:'200', designPress:'6.0',      material:'Nickel 200',      capacity:'Q=505,327 kcal/h (588 kW), A=14.0 m²',     motor:'-', remarks:'Hot C1→C2 / Cold L9(24.5%) 108.5→160.0°C (LMTD 16.70°C)', nodeId:'s300_E333' },
  { tag:'E-342',  name:'2효 가성소다 열회수 예열기 (E-5342)',       type:'HX',        section:'300', fluid:'50% / 36.4% NaOH',qty:1, operTemp:'120.0→75.0',  operPress:'2.2',   designTemp:'150', designPress:'5.0',      material:'Nickel 200',      capacity:'Q=1,447,151 kcal/h (1,683 kW), A=54.0 m²', motor:'-', remarks:'Hot L12→L13 / Cold L3(75.5%) 68.4→108.2°C (LMTD 9.15°C)', nodeId:'s300_E342' },
  { tag:'E-343',  name:'2효 응축수 열회수 예열기 (E-5343)',         type:'HX',        section:'300', fluid:'Cond. C2 / 36.4%',qty:1, operTemp:'126.6→74.7',  operPress:'2.5',   designTemp:'150', designPress:'5.0',      material:'Nickel 200',      capacity:'Q=537,525 kcal/h (625 kW), A=20.0 m²',     motor:'-', remarks:'Hot C2→C3 / Cold L4(24.5%) 68.4→114.0°C (LMTD 9.48°C)', nodeId:'s300_E343' },
  { tag:'E-352',  name:'50% NaOH 제품 냉각기 (E-5352)',             type:'HX',        section:'300', fluid:'50% NaOH / CW',   qty:1, operTemp:'75.0→42.0',   operPress:'1.8',   designTemp:'100', designPress:'5.0',      material:'Nickel 200',      capacity:'Q=1,058,342 kcal/h (1,231 kW), A=20.0 m²', motor:'-', remarks:'Hot L13→L14 / Cold CW 132,293 kg/h (32→40°C, LMTD 19.96°C)', nodeId:'s300_E352' },
  { tag:'E-350',  name:'3효 진공 표면응축기 (Surface Cond. E-5350)',type:'HX',        section:'300', fluid:'3효 증기 V3 / CW',qty:1, operTemp:'68.4→42.9',   operPress:'-0.94', designTemp:'90',  designPress:'FV/4.0',   material:'SS 316L',         capacity:'Q=5,011,944 kcal/h (5,829 kW), CW 626.5 t/h', motor:'-', remarks:'3효 수증기 V3 (32"-V-316L, 8,797 kg/h) 진공 응축기', nodeId:'s300_E350' },

  // ── 400 SEC: 염소가스 세정(T-410/420)·황산건조(T-430~450)·액화 & Hypo 제해탑(T-730/760) ──────
  { tag:'T-410', name:'Cl₂ 1차 수세/직접냉각탑 (1st Wash Tower)',   type:'Column', section:'400', fluid:'Wet Cl₂ / Process Water', qty:1, operTemp:'58', operPress:'0.27', designTemp:'95', designPress:'0.5', material:'FRP+PVDF lining', capacity:'D=2.20 m, Z=3.2 m', motor:'-', remarks:'1st Cl2 direct cooling & brine mist wash tower', nodeId:'s400_T410' },
  { tag:'P-413', name:'수세탑 순환펌프',                            type:'Pump',   section:'400', fluid:'Chlorinated Water',       qty:2, operTemp:'50', operPress:'2.8',  designTemp:'80', designPress:'5.0', material:'PVDF / Titanium', capacity:'~52 m³/h', motor:'15 kW', remarks:'T-410/420 circulation A/B', nodeId:'s400_P413a' },
  { tag:'E-413', name:'Cl₂ 1차 냉각기 (CW 간접냉각)',               type:'HX',     section:'400', fluid:'Wet Cl₂ / CW',            qty:1, operTemp:'65→38',operPress:'0.27', designTemp:'85', designPress:'3.0', material:'Titanium Gr.2',   capacity:'Q=1,080 kW, A=115 m²',motor:'-', remarks:'1st stage Cl2 gas cooler', nodeId:'s400_E413' },
  { tag:'E-423', name:'Cl₂ 2차 냉각기 (냉수 냉각)',                 type:'HX',     section:'400', fluid:'Wet Cl₂ / CCW',           qty:1, operTemp:'38→22',operPress:'0.27', designTemp:'60', designPress:'3.0', material:'Titanium Gr.2',   capacity:'Q=580 kW, A=78 m²',  motor:'-', remarks:'2nd stage Cl2 gas cooler', nodeId:'s400_E423' },
  { tag:'E-433', name:'Cl₂ 3차 냉각기 (칠러 냉각)',                 type:'HX',     section:'400', fluid:'Wet Cl₂ / CCW',           qty:1, operTemp:'22→13',operPress:'0.25', designTemp:'50', designPress:'3.0', material:'Titanium Gr.2',   capacity:'Q=290 kW, A=52 m²',  motor:'-', remarks:'Chilled water Cl2 cooler (hydrate guard)', nodeId:'s400_E433' },
  { tag:'T-420', name:'Cl₂ 2차 냉수세정/냉각탑 (2nd Chilled Wash)', type:'Column', section:'400', fluid:'Wet Cl₂ / Chilled Water', qty:1, operTemp:'24', operPress:'0.24', designTemp:'70', designPress:'0.5', material:'FRP+PVDF lining', capacity:'D=2.10 m, Z=3.2 m', motor:'-', remarks:'2nd Cl2 direct chilled wash tower before H2SO4 drying', nodeId:'s400_T420' },
  { tag:'T-430', name:'H₂SO₄ 건조탑 1단 (1st Drying - 78% H₂SO₄)',  type:'Column', section:'400', fluid:'Cl₂ / 78% H₂SO₄',         qty:1, operTemp:'20', operPress:'0.21', designTemp:'50', designPress:'0.5', material:'FRP+PP lining',   capacity:'D=2.00 m, Z=3.8 m', motor:'-', remarks:'1st stage H2SO4 drying tower (4,500→500 ppm H2O)', nodeId:'s400_T430' },
  { tag:'T-440', name:'H₂SO₄ 건조탑 2단 (2nd Drying - 88% H₂SO₄)',  type:'Column', section:'400', fluid:'Cl₂ / 88% H₂SO₄',         qty:1, operTemp:'18', operPress:'0.19', designTemp:'50', designPress:'0.5', material:'FRP+PP lining',   capacity:'D=1.90 m, Z=4.2 m', motor:'-', remarks:'2nd stage H2SO4 drying tower (500→50 ppm H2O)', nodeId:'s400_T440' },
  { tag:'T-450', name:'H₂SO₄ 건조탑 3단 (Final Drying - 98% H₂SO₄)',type:'Column', section:'400', fluid:'Dry Cl₂ / 98% H₂SO₄',     qty:1, operTemp:'16', operPress:'0.16', designTemp:'50', designPress:'0.5', material:'CS+PTFE lining',  capacity:'D=1.80 m, Z=3.6 m', motor:'-', remarks:'3rd / Final H2SO4 drying tower (<5~10 ppm H2O)', nodeId:'s400_T450' },
  { tag:'P-450', name:'농황산 순환/공급 펌프',                      type:'Pump',   section:'400', fluid:'98% H₂SO₄',               qty:2, operTemp:'25', operPress:'3.7',  designTemp:'50', designPress:'6.0', material:'Alloy 20 / PTFE', capacity:'~20 m³/h', motor:'11 kW', remarks:'T-430~450 drying acid circulation', nodeId:'s400_P450' },
  { tag:'F-424', name:'황산 미스트 제거기 (Mist Elim.)',            type:'Filter', section:'400', fluid:'Dry Cl₂',                 qty:1, operTemp:'20', operPress:'0.15', designTemp:'50', designPress:'1.0', material:'CS+Glass fiber',  capacity:'D=1.6 m',  motor:'-',     remarks:'Candle type mist eliminator', nodeId:'s400_F424' },
  { tag:'C-470', name:'Cl₂ 가스 압축기',                            type:'Compressor',section:'400',fluid:'Dry Cl₂',               qty:2, operTemp:'40', operPress:'3.0',  designTemp:'80', designPress:'5.0', material:'Hastelloy C-276', capacity:'~6,900 Nm³/h',motor:'400 kW',remarks:'Multi-stage centrifugal, dry N2 seal', nodeId:'s400_C470' },
  { tag:'D-484', name:'Cl₂ 냉동 액화기 (Liquefier)',                type:'HX',     section:'400', fluid:'Liq. Cl₂ / Refrig.',      qty:1, operTemp:'40→-22',operPress:'3.0',designTemp:'60',designPress:'6.0', material:'CS (LTCS)',       capacity:'Q=1,680 kW, A=185 m²',motor:'-', remarks:'Shell & tube Cl2 condenser', nodeId:'s400_D484' },
  { tag:'D-495', name:'액체 Cl₂ 수액기 (Accumulator)',              type:'Separator',section:'400',fluid:'Liq. Cl₂',               qty:1, operTemp:'-20',operPress:'3.0',  designTemp:'40', designPress:'6.0', material:'CS (LTCS)',       capacity:'~15 m³',   motor:'-',     remarks:'Liquid Cl2 receiver drum', nodeId:'s400_D495' },
  { tag:'D-496', name:'액체 Cl₂ 저장탱크',                          type:'Tank',   section:'400', fluid:'Liq. Cl₂',                qty:2, operTemp:'-17',operPress:'3.0',  designTemp:'40', designPress:'6.0', material:'CS (LTCS)',       capacity:'~1,000 m³ each',motor:'-', remarks:'2-day storage. Vent to T-730/760', nodeId:'s400_D496' },
  { tag:'P-494', name:'액화염소 이송펌프',                          type:'Pump',   section:'400', fluid:'Liq. Cl₂',                qty:2, operTemp:'-17',operPress:'6.5',  designTemp:'40', designPress:'10.0',material:'LTCS / Hast. C',  capacity:'~10 m³/h', motor:'11 kW', remarks:'Canned motor pump (Sealless)', nodeId:'s400_P494' },
  { tag:'P-496', name:'액화염소 출하펌프',                          type:'Pump',   section:'400', fluid:'Liq. Cl₂',                qty:2, operTemp:'-17',operPress:'12.0', designTemp:'40', designPress:'18.0',material:'LTCS / Hast. C',  capacity:'~10 m³/h', motor:'18.5 kW',remarks:'Canned motor pump (Sealless)', nodeId:'s400_P496' },
  { tag:'T-730', name:'폐염소 제해 / Hypo 제조 1차 타워 (Hypo Tower 1)', type:'Column', section:'400', fluid:'Vent Cl₂ / NaOH→NaOCl', qty:1, operTemp:'32', operPress:'0.04', designTemp:'75', designPress:'1.0', material:'FRP+PVC/PVDF', capacity:'D=1.60 m, Z=4.2 m', motor:'-', remarks:'1st Vent Cl2 scrubbing & 12% NaOCl(Hypo) manufacturing tower', nodeId:'s400_D940' },
  { tag:'T-760', name:'폐염소 제해 / Hypo 제조 2차 타워 (Hypo Tower 2)', type:'Column', section:'400', fluid:'Tail Cl₂ / NaOH→NaOCl', qty:1, operTemp:'28', operPress:'0.02', designTemp:'75', designPress:'1.0', material:'FRP+PVC/PVDF', capacity:'D=1.40 m, Z=4.2 m', motor:'-', remarks:'2nd Vent Cl2 final scrubbing tower (<1 ppm Cl2 vent)', nodeId:'s400_T760' },

  // ── 600 SEC: 수소가스 세정·냉각·압축·정제 ───────────────────────────────────
  { tag:'T-610', name:'수소가스 가성소다 제거 세정탑 (H₂ Caustic Scrubber)', type:'Column', section:'600', fluid:'Wet H₂ / Pure Water', qty:1, operTemp:'88→38', operPress:'0.25', designTemp:'110', designPress:'2.0', material:'SS 304L', capacity:'D=1.20 m, Z=3.0 m (Pall Ring 38mm)', motor:'-', remarks:'H2 caustic mist scrubbing tower (3,500→<5 ppm NaOH)', nodeId:'s600_T610' },
  { tag:'E-5613',name:'H₂ 1차 냉각기 (CW Cooler)',       type:'HX',     section:'600', fluid:'Wet H₂ / CW',    qty:1,operTemp:'90→41',operPress:'0.21', designTemp:'110',designPress:'3.0', material:'SS 316L',         capacity:'Q=690 kW, A=54 m²',  motor:'-', remarks:'1st stage H2 cooler & moisture knock-out', nodeId:'s600_E5613' },
  { tag:'E-5630',name:'H₂ 2차 냉각기 (CCW Chilled)',     type:'HX',     section:'600', fluid:'Wet H₂ / CCW',   qty:1,operTemp:'41→10',operPress:'0.21', designTemp:'65', designPress:'3.0', material:'SS 316L',         capacity:'Q=210 kW, A=32 m²',  motor:'-', remarks:'2nd stage chilled water H2 cooler', nodeId:'s600_E5630' },
  { tag:'D-610', name:'H₂ 수분분리기 (Moisture Sep.)',   type:'Separator',section:'600',fluid:'H₂ Gas',        qty:1,operTemp:'10',  operPress:'0.21', designTemp:'60', designPress:'2.0', material:'SS 316L',         capacity:'~550 kg/h H₂',       motor:'-', remarks:'Demister pad KO drum', nodeId:'s600_D610' },
  { tag:'C-620', name:'H₂ 다단 압축기',                  type:'Compressor',section:'600',fluid:'H₂ Gas',       qty:2,operTemp:'95',  operPress:'23.0', designTemp:'135',designPress:'28.0',material:'SS 316L',         capacity:'~6,200 Nm³/h',       motor:'160 kW',remarks:'Oil-free reciprocating A/B', nodeId:'s600_C620' },
  { tag:'E-5680',name:'H₂ 고압 정제 냉각기',             type:'HX',     section:'600', fluid:'HP H₂ / CCW',    qty:1,operTemp:'95→10',operPress:'23.0', designTemp:'120',designPress:'28.0',material:'SS 316L',         capacity:'Q=190 kW, A=24 m²',  motor:'-', remarks:'HP H2 cooler before dryer', nodeId:'s600_E5680' },
  { tag:'E-5682',name:'H₂ 최종 후단 냉각기 (Aftercooler)',type:'HX',    section:'600', fluid:'Dry H₂ / CW',    qty:1,operTemp:'80→40',operPress:'23.0', designTemp:'110',designPress:'28.0',material:'SS 316L',         capacity:'Q=90 kW, A=15 m²',   motor:'-', remarks:'Final H2 product cooler', nodeId:'s600_E5682' },
  { tag:'D-680', name:'고압 H₂ 출하 헤더 드럼',          type:'Tank',   section:'600', fluid:'Dry H₂',         qty:1,operTemp:'40',  operPress:'23.0', designTemp:'80', designPress:'28.0',material:'SS 316L',         capacity:'~10 m³',             motor:'-', remarks:'High pressure H2 buffer header', nodeId:'s600_D680' },
  { tag:'P-613', name:'수소 응축수 이송펌프',            type:'Pump',   section:'600', fluid:'Condensate',     qty:2,operTemp:'38',  operPress:'2.5',  designTemp:'60', designPress:'5.0', material:'SS 316L',         capacity:'~5 m³/h',            motor:'2.2 kW',remarks:'Condensate return A/B', nodeId:'s600_P613' },
];

const SECTIONS = ['ALL','100','200','300','400','600'] as const;
type SectionFilter = typeof SECTIONS[number];

const TYPE_COLORS: Record<string, string> = {
  Tank: '#1A2F44', Pump: '#1A2F44', HX: '#1A2F44', Column: '#202C3C',
  Evaporator: '#1A2F44', Filter: '#1A2F44', Compressor: '#202C3C',
  Separator: '#1A2F44', Electrolyzer: '#1A2F44', Settler: '#52525B',
};

function typeBadge(type: string) {
  const color = TYPE_COLORS[type] ?? '#52525B';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px',
      borderRadius: 3, border: `1px solid ${color}44`,
      background: `${color}18`, color, whiteSpace: 'nowrap',
    }}>{type}</span>
  );
}

export default function EquipmentList() {
  const {
    userNodes,
    nodeTagOverrides,
    equipmentSpecsOverrides,
    setEquipmentSpecOverride,
    setActiveDesignRequest,
  } = usePFDStore();
  const router = useRouter();
  const streams = useBalanceStore(s => s.result.streams);
  const setActivePlantId = useBalanceStore(s => s.setActivePlantId);
  const requestSimSheet = useBalanceStore(s => s.requestSimSheet);

  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('ALL');
  const [search, setSearch] = useState('');
  const [editRow, setEditRow] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<EquipmentItem>>({});
  const [batchNotice, setBatchNotice] = useState<string>('');

  // Merge user-added nodes + nodeTagOverrides + equipmentSpecsOverrides
  const allEquipment = useMemo<EquipmentItem[]>(() => {
    const typeMap: Record<string, string> = {
      tank: 'Tank', drumHorizontal: 'Tank', pump: 'Pump',
      heatExchanger: 'HX', tower: 'Column', towerPacking: 'Column',
      compressor: 'Compressor', filter: 'Filter', separator: 'Separator',
      valve: 'Valve', electrolyzer: 'Electrolyzer',
    };
    const userItems: EquipmentItem[] = userNodes
      .filter(un => un.type !== 'branch' && un.type !== 'mixer')
      .map(un => ({
        tag: un.tag, name: un.name,
        type: typeMap[un.type] ?? un.type,
        section: un.section, fluid: '',
        qty: un.multiplier ?? 1,
        operTemp: '', operPress: '',
        designTemp: '', designPress: '',
        material: '', capacity: '', motor: '', remarks: '사용자 삽입 장치',
        nodeId: `s${un.section}_${un.id}`,
      }));

    const builtinWithOv = BUILTIN_EQUIPMENT.map(eq => {
      let item = { ...eq };
      if (eq.nodeId && nodeTagOverrides[eq.nodeId]) {
        const ov = nodeTagOverrides[eq.nodeId];
        item = { ...item, tag: ov.tag, name: ov.name };
      }
      return item;
    });

    const combined = [...builtinWithOv, ...userItems];

    return combined.map(item => {
      const specOv = equipmentSpecsOverrides?.[item.tag];
      if (!specOv) return item;
      return {
        ...item,
        name:        specOv.name        ?? item.name,
        fluid:       specOv.fluid       ?? item.fluid,
        qty:         specOv.qty         ?? item.qty,
        operTemp:    specOv.operTemp    ?? item.operTemp,
        operPress:   specOv.operPress   ?? item.operPress,
        designTemp:  specOv.designTemp  ?? item.designTemp,
        designPress: specOv.designPress ?? item.designPress,
        material:    specOv.material    ?? item.material,
        capacity:    specOv.capacity    ?? item.capacity,
        motor:       specOv.motor       ?? item.motor,
        remarks:     specOv.remarks     ?? item.remarks,
        designedAt:  specOv.designedAt,
      };
    });
  }, [userNodes, nodeTagOverrides, equipmentSpecsOverrides]);

  const filtered = useMemo(() => allEquipment.filter(eq => {
    if (sectionFilter !== 'ALL' && eq.section !== sectionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return eq.tag.toLowerCase().includes(q) ||
             eq.name.toLowerCase().includes(q) ||
             eq.type.toLowerCase().includes(q) ||
             eq.remarks.toLowerCase().includes(q);
    }
    return true;
  }), [allEquipment, sectionFilter, search]);

  const startEdit = (eq: EquipmentItem) => {
    setEditRow(eq.tag);
    setEditData({ ...eq });
  };

  const saveEdit = () => {
    if (editRow) {
      setEquipmentSpecOverride(editRow, {
        name:        editData.name,
        fluid:       editData.fluid,
        operTemp:    editData.operTemp,
        operPress:   editData.operPress,
        designTemp:  editData.designTemp,
        designPress: editData.designPress,
        material:    editData.material,
        capacity:    editData.capacity,
        motor:       editData.motor,
        remarks:     editData.remarks,
        designedAt:  new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      });
    }
    setEditRow(null);
    setEditData({});
  };

  // 현재 공정조건(Material Balance) 기준으로 모든 열교환기, 패킹컬럼, 강하막 증발관, 브라인 정제설비(T-030, F-140, T-160) 일괄 설계 후 업데이트
  const runBatchAutoDesign = () => {
    const nowTime = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    let hxCount = 0;
    let colCount = 0;
    let evapCount = 0;
    let brineCount = 0;
    const { saturatorPreset, candleFilterPreset, ionExchangePreset } = getBrinePurifPresets(streams);

    allEquipment.forEach(eq => {
      if (['T-030', 'D-010'].includes(eq.tag)) {
        const satRes = calcBrineSaturator(saturatorPreset);
        const cap = `ID ${satRes.D_vessel_m}m × H ${satRes.H_total_m}m (V=${satRes.V_total_m3} m³, RT ${satRes.liquidRT_min} min)`;
        const rem = `[포화/침전조 설계완료] LV=${satRes.actualUpflowVel_mh} m/h, 원염용해 ${satRes.saltDissolveRate_th} t/h (${satRes.saltDissolveRate_td} t/d), 원염보유 ${satRes.saltHoldup_ton} ton (H_bed=${satRes.H_saltBed_m}m), 노즐 ${satRes.nozzleInlet_NPS}/${satRes.nozzleOutlet_NPS}`;
        setEquipmentSpecOverride(eq.tag, {
          operTemp: `${saturatorPreset.temp_C}`,
          operPress: 'Atm',
          designTemp: `${Math.ceil((saturatorPreset.temp_C + 20) / 5) * 5}`,
          designPress: 'Atm / FV',
          material: saturatorPreset.material,
          capacity: cap,
          motor: satRes.rakeMotor_kW > 0 ? `${satRes.rakeMotor_kW} kW` : '-',
          remarks: rem,
          designedAt: nowTime,
        });
        brineCount++;
      } else if (['F-140', 'F-150'].includes(eq.tag)) {
        const fltRes = calcCandleBrineFilter(candleFilterPreset);
        const qtyTot = candleFilterPreset.nOperatingUnits + candleFilterPreset.nStandbyUnits;
        const cap = `A=${fltRes.areaPerUnit_m2} m²/기 (ID ${fltRes.D_vessel_mm}×H ${fltRes.H_vessel_mm}mm, Candle Ø${candleFilterPreset.candleOD_mm}×${candleFilterPreset.candleLength_mm}L × ${fltRes.candlesPerUnit}EA)`;
        const rem = `[캔들 프리코트 설계완료] ${candleFilterPreset.nOperatingUnits}운전+${candleFilterPreset.nStandbyUnits}예비, Flux=${fltRes.actualFlux_mh} m/h, SS ${candleFilterPreset.inletSS_ppm}→${candleFilterPreset.outletSS_ppm} ppm, 주기 ${fltRes.filtrationCycle_hr} hr, 프리코트 ${fltRes.precoatPerCycle_kg} kg/회, ${fltRes.nozzleInOut_NPS}`;
        const f140Spec = {
          name: '캔들 프리코트 카본 브라인 필터 (Candle Filter)',
          qty: qtyTot,
          operTemp: `${candleFilterPreset.temp_C}`,
          operPress: '3.5',
          designTemp: '85',
          designPress: '6.0',
          material: candleFilterPreset.material,
          capacity: cap,
          motor: `Precoat ${fltRes.precoatPumpFlow_m3h} m³/h`,
          remarks: rem,
          designedAt: nowTime,
        };
        setEquipmentSpecOverride('F-140', f140Spec);
        setEquipmentSpecOverride('F-150', f140Spec);
        brineCount++;
      } else if (eq.tag === 'T-160') {
        const ixRes = calcChelatingIonExchange(ionExchangePreset);
        const cap = `ID ${ixRes.D_tower_m}m × H ${ixRes.H_shell_m}m (Resin ${ixRes.adoptedResinVol_m3} m³/탑, Z_bed=${ixRes.H_resinBed_m}m, SV=${ixRes.actualSV_bvh} BV/h)`;
        const rem = `[킬레이트 수지탑 설계완료] ${ixRes.resinSpec.model} (${ixRes.nTotalTowers}탑), 재생주기 ${ixRes.operatingCycleHours}h (재생 ${ixRes.totalRegenTime_min}분: PW ${ixRes.totalRegenWater_m3}m³, 35%HCl ${ixRes.hcl35Commercial_kg}kg, 32%NaOH ${ixRes.naoh32Commercial_kg}kg/회)`;
        setEquipmentSpecOverride('T-160', {
          name: '킬레이트 이온교환수지탑 (Chelating IX Tower)',
          qty: ixRes.nTotalTowers,
          operTemp: `${ionExchangePreset.temp_C}`,
          operPress: '4.0',
          designTemp: '80',
          designPress: '7.0',
          material: 'FRP + Butyl/EPDM Rubber Lining',
          capacity: cap,
          motor: `Regen ${ixRes.totalRegenTime_hr} hr/회`,
          remarks: rem,
          designedAt: nowTime,
        });
        brineCount++;
      } else if (eq.type === 'Evaporator' && ['E-320', 'E-330', 'E-340'].includes(eq.tag)) {
        const ffInp = getFallingFilmPreset(eq.tag, streams);
        const ffRes = calcFallingFilmEvaporator(ffInp);
        const specSummary = `Falling Film ${ffRes.A_prov_m2.toFixed(1)} m² (ID ${ffRes.D_calandria_mm}×${ffInp.L_m}m, ${ffRes.N_tubes} Tubes)`;
        const remarksSummary = `[강하막 설계완료] Q=${(ffRes.Q_total_Mcalh / 1000).toFixed(2)} Gcal/h (${ffRes.Q_total_kW.toFixed(0)} kW), U=${ffRes.U_dirty_Wm2K.toFixed(0)} W/m²K, BPR=+${ffRes.BPR_C.toFixed(1)}°C, Γ=${ffRes.actualWettingRate_kgms.toFixed(2)} kg/m·s`;
        const recircVol = ffRes.recircFlow_kgh / Math.max(1000, ffRes.rhoL_kgm3);
        setEquipmentSpecOverride(eq.tag, {
          operTemp: `${ffRes.T_boil_C.toFixed(1)} / ${ffInp.T_steam_C.toFixed(1)}`,
          operPress: `${ffInp.P_tube_kgcm2g.toFixed(2)}`,
          designTemp: `${Math.ceil((Math.max(ffRes.T_boil_C, ffInp.T_steam_C) + 25) / 10) * 10}`,
          designPress: ffInp.P_tube_kgcm2g < 0 ? 'FV/3.5' : '15.0',
          material: ffInp.material,
          capacity: specSummary,
          motor: `Recirc ${recircVol.toFixed(0)} m³/h`,
          remarks: remarksSummary,
          designedAt: nowTime,
        });
        evapCount++;
      } else if (eq.type === 'HX') {
        const preset = getHXProcessPreset(eq.tag, streams);
        const calcIn: HXDesignInputs = {
          tag: eq.tag,
          serviceName: preset.serviceName ?? eq.name,
          section: preset.section ?? eq.section,
          dofMode: preset.dofMode ?? 'calc_mc',
          hotFluidKey: preset.hotFluidKey ?? 'cl2_wet',
          mh_kgh: preset.mh_kgh ?? 20000,
          Th_in_C: preset.Th_in_C ?? 65,
          Th_out_C: preset.Th_out_C ?? 38,
          Ph_kgcm2g: preset.Ph_kgcm2g ?? 0.3,
          hotCondensingFrac: preset.hotCondensingFrac ?? 0,
          coldFluidKey: preset.coldFluidKey ?? 'cooling_water',
          mc_kgh: preset.mc_kgh ?? 80000,
          Tc_in_C: preset.Tc_in_C ?? 30,
          Tc_out_C: preset.Tc_out_C ?? 38,
          Pc_kgcm2g: preset.Pc_kgcm2g ?? 3.5,
          n_shell: preset.n_shell ?? 1,
          n_passes: preset.n_passes ?? 2,
          do_mm: preset.do_mm ?? 19.05,
          tw_mm: preset.tw_mm ?? 1.65,
          L_m: preset.L_m ?? 4.5,
          layoutAngle: (preset.layoutAngle ?? 30) as 30 | 45 | 90,
          baffleCutPct: preset.baffleCutPct ?? 25,
          overdesignPct: preset.overdesignPct ?? 15,
          rft: preset.rft ?? 0.00018,
          rfs: preset.rfs ?? 0.00018,
          material: preset.material ?? eq.material,
        };
        const res = calcHeatExchanger(calcIn);
        const capStr = `Q=${res.Q_kW >= 1000 ? (res.Q_kW / 1000).toFixed(2) + ' MW' : res.Q_kW.toFixed(0) + ' kW'}, A=${res.A_prov_m2.toFixed(1)} m² (ID ${res.D_shell_mm}×${calcIn.L_m}m)`;
        const remStr = `[설계완료] U=${res.U_calc_Wm2K.toFixed(0)} W/m²K, Tube ${res.N_tubes}EA, ΔP=${res.dPt_bar.toFixed(2)}/${res.dPs_bar.toFixed(2)} bar`;
        setEquipmentSpecOverride(eq.tag, {
          operTemp: `${calcIn.Th_in_C}→${calcIn.Th_out_C}`,
          operPress: String(calcIn.Ph_kgcm2g),
          designTemp: String(preset.designTemp_C),
          designPress: String(preset.designPress_kgcm2g),
          material: calcIn.material,
          capacity: capStr,
          remarks: remStr,
          designedAt: nowTime,
        });
        hxCount++;
      } else if (eq.type === 'Column') {
        const preset = getTowerProcessPreset(eq.tag, streams);
        const gf = GAS_FLUIDS.find(f => f.key === preset.gasFluidKey);
        const lf = LIQUID_FLUIDS.find(f => f.key === preset.liqFluidKey);
        const gRho = gf?.MW ? gasDensity(gf.MW, preset.temp_C, preset.pressure_kPa) : (gf ? densityAtT(gf, preset.temp_C) : 2.9);
        const gVisc = gf ? viscosityAtT(gf, preset.temp_C) : 0.013;
        const lRho = lf ? densityAtT(lf, preset.temp_C) : 998;
        const lVisc = lf ? viscosityAtT(lf, preset.temp_C) : 1.0;
        const lSig = lf?.surfaceTension ?? 72;
        const validPack = PACKING_DB.some(p => p.key === preset.packingKey) ? preset.packingKey : 'pall_50';

        const inputs: PackingTowerInputs = {
          mode: preset.mode,
          temperature_C: preset.temp_C,
          pressure_kPa: preset.pressure_kPa,
          gasFlow_kgh: preset.gasFlow_kgh,
          gasDensity_kgm3: gRho,
          gasViscosity_mPas: gVisc,
          liquidFlow_kgh: preset.liqFlow_kgh,
          liquidDensity_kgm3: lRho,
          liquidViscosity_mPas: lVisc,
          surfaceTension_mNm: lSig,
          packingKey: validPack,
          floodingFraction: preset.floodFrac,
          HETP_correction: 1.0,
          ...(preset.separationMode === 'stages'
            ? { theoreticalStages: preset.stages }
            : { y_in: preset.yIn, y_out: preset.yOut, absorptionFactor: preset.absA }),
        };
        const res = calcPackingTower(inputs);
        const pk = PACKING_DB.find(p => p.key === validPack);
        const dMeters = (res.tower_diameter_std_mm / 1000).toFixed(2);
        const zMeters = res.packingHeight_m.toFixed(1);
        const hMeters = res.totalHeight_m.toFixed(1);
        const capStr = `D=${dMeters} m, Z=${zMeters} m (H=${hMeters} m)`;
        const remStr = `[설계완료] ${pk?.name ?? validPack}, N=${res.theoreticalStages.toFixed(1)}단(HETP ${res.HETP_m.toFixed(2)}m), ΔP=${res.dP_total_kPa.toFixed(2)} kPa`;

        setEquipmentSpecOverride(eq.tag, {
          operTemp: String(preset.temp_C),
          operPress: preset.operPress_kgcm2g,
          designTemp: preset.designTemp_C,
          designPress: preset.designPress_kgcm2g,
          material: preset.material,
          capacity: capStr,
          remarks: remStr,
          designedAt: nowTime,
        });
        colCount++;
      }
    });

    setBatchNotice(`⚡ 현재 공정조건(Material Balance) 기준으로 브라인 정제설비(T-030·F-140·T-160) ${brineCount}기, 3효 강하막 증발관 ${evapCount}기, 열교환기 ${hxCount}기, 패킹컬럼 ${colCount}기의 상세 설계 및 사양 업데이트를 완료했습니다!`);
  };

  const jumpToDesign = (eq: EquipmentItem) => {
    if (eq.type === 'Electrolyzer' || /^EL/i.test(eq.tag)) {
      setActivePlantId('clorsim_sim');
      requestSimSheet('sub_200_cell');
      router.push('/material-balance');
    } else if (eq.type === 'Compressor' || /^C-\d/i.test(eq.tag)) {
      setActivePlantId('clorsim_sim');
      requestSimSheet(eq.section === '600' ? 'sub_600_h2' : 'sub_400_liquefaction');
      router.push('/material-balance');
    } else if (['T-030', 'D-010', 'F-140', 'F-150', 'T-160'].includes(eq.tag) || eq.type === 'Settler') {
      setActiveDesignRequest({ tab: 'brine', tag: eq.tag });
    } else if (eq.type === 'Evaporator' || ['E-320', 'E-330', 'E-340'].includes(eq.tag)) {
      setActiveDesignRequest({ tab: 'evap', tag: eq.tag });
    } else if (eq.type === 'Column' || ['T-280', 'T-410', 'T-420', 'T-430', 'T-440', 'T-450', 'T-610', 'T-730', 'T-760'].includes(eq.tag)) {
      setActiveDesignRequest({ tab: 'packing', tag: eq.tag });
    } else if (eq.type === 'Pump') {
      setActiveDesignRequest({ tab: 'chempro', tag: `${eq.tag}A/B`, chemproSubTab: 'pump' });
    } else if (eq.type === 'Separator' || eq.type === 'Tank') {
      setActiveDesignRequest({ tab: 'chempro', tag: eq.tag, chemproSubTab: 'vessel' });
    } else {
      setActiveDesignRequest({ tab: 'chempro', tag: eq.tag, chemproSubTab: 'hx' });
    }
  };

  const exportCSV = useCallback(() => {
    const headers = ['Tag No.','Name','Type','Section','Process Fluid','Qty','Oper.Temp (°C)','Oper.Press (kg/cm²G)','Design Temp (°C)','Design Press (kg/cm²G)','Material','Capacity/Size','Motor (kW)','Remarks'];
    const rows = filtered.map(eq => [
      eq.tag, eq.name, eq.type, eq.section, eq.fluid, eq.qty,
      eq.operTemp, eq.operPress, eq.designTemp, eq.designPress,
      eq.material, eq.capacity, eq.motor, eq.remarks,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'equipment_list.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const COL_W = { tag:95, name:175, type:85, sec:45, fluid:115, qty:35, ot:65, op:70, dt:65, dp:70, mat:125, cap:185, mot:65, rem:220 };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{
        padding: '10px 16px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#18181B' }}>
          📋 Equipment List
        </span>
        <span style={{ fontSize: 10, color: '#2C353E' }}>(EPC 표준 양식 · 실시간 설계 연동)</span>

        {/* Section filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {SECTIONS.map(s => (
            <button key={s} onClick={() => setSectionFilter(s)} style={{
              height: 26, padding: '0 10px', borderRadius: 5,
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${sectionFilter === s ? '#1A2F4444' : '#E5E2DC'}`,
              background: sectionFilter === s ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: sectionFilter === s ? '#1A2F44' : '#64748b',
            }}>{s}</button>
          ))}
        </div>

        {/* Search */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Tag / Name 검색..."
          style={{
            height: 28, padding: '0 10px', borderRadius: 6,
            background: '#EFECE5',
            border: '1px solid #DFDCD4',
            color: '#27272A', fontSize: 11, outline: 'none', width: 150,
          }}
        />

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#3F3F46' }}>{filtered.length}개 장치</span>

        <button onClick={runBatchAutoDesign} style={{
          height: 28, padding: '0 12px', borderRadius: 6,
          background: '#EFECE5', border: '1px solid rgba(249,115,22,0.4)',
          color: '#1A2F44', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }} title="현재 물질수지(Material Balance) 유량·온도 조건으로 브라인 정제설비(T-030·F-140·T-160), 3효 강하막 증발관, 열교환기, 패킹컬럼을 자동 설계하여 목록에 반영합니다">
          ⚡ 정제·증발관·열교환기·패킹컬럼 일괄 자동설계 반영
        </button>

        <button onClick={exportCSV} style={{
          height: 28, padding: '0 12px', borderRadius: 6,
          background: '#EFECE5', border: '1px solid rgba(74,222,128,0.3)',
          color: '#1A2F44', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          📥 CSV 내보내기
        </button>
      </div>

      {batchNotice && (
        <div style={{
          padding: '8px 16px', background: 'rgba(74,222,128,0.10)',
          borderBottom: '1px solid rgba(74,222,128,0.3)',
          color: '#1A2F44', fontSize: 11, fontWeight: 600,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{batchNotice}</span>
          <button onClick={() => setBatchNotice('')} style={{ background: 'none', border: 'none', color: '#1A2F44', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{
          borderCollapse: 'collapse', width: '100%',
          fontSize: 11, fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          <thead>
            <tr style={{
              position: 'sticky', top: 0, zIndex: 2,
              background: '#FFFFFF',
              borderBottom: '1px solid #DFDCD4',
            }}>
              {[
                ['Tag No.', COL_W.tag], ['장치명', COL_W.name], ['형식', COL_W.type],
                ['SEC', COL_W.sec], ['공정유체', COL_W.fluid], ['수량', COL_W.qty],
                ['운전온도 °C', COL_W.ot], ['운전압력 kg/cm²G', COL_W.op],
                ['설계온도 °C', COL_W.dt], ['설계압력 kg/cm²G', COL_W.dp],
                ['재질', COL_W.mat], ['용량 / 설계규격', COL_W.cap],
                ['모터 kW', COL_W.mot], ['비고 / 설계결과', COL_W.rem], ['설계/편집', 75],
              ].map(([label, w]) => (
                <th key={label as string} style={{
                  padding: '8px 8px', textAlign: 'left', fontWeight: 600,
                  fontSize: 9, color: '#3F3F46', letterSpacing: '0.05em',
                  textTransform: 'uppercase', minWidth: w as number,
                  borderRight: '1px solid #F6F7F2',
                }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((eq, i) => {
              const isEdit = editRow === eq.tag;
              const isDesigned = Boolean(eq.designedAt);
              const canDesign =
                ['HX', 'Column', 'Pump', 'Evaporator', 'Separator', 'Electrolyzer', 'Compressor'].includes(eq.type) ||
                ['T-030', 'D-010', 'F-140', 'F-150', 'T-160'].includes(eq.tag);
              const bg = isDesigned
                ? 'rgba(74,222,128,0.035)'
                : i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent';

              return (
                <tr key={`${eq.tag}-${i}`} style={{
                  background: bg, borderBottom: '1px solid #FFFFFF',
                  transition: 'background 0.12s',
                }}>
                  {/* Tag */}
                  <td style={tdS}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{
                        fontFamily: 'monospace', fontWeight: 700,
                        color: '#1A2F44', fontSize: 11,
                      }}>{eq.tag}</span>
                      {isDesigned && (
                        <span style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                          background: 'rgba(74,222,128,0.18)', color: '#1A2F44', border: '1px solid rgba(74,222,128,0.4)',
                        }}>설계됨</span>
                      )}
                    </div>
                  </td>
                  {/* Name */}
                  <td style={tdS}>{isEdit
                    ? <EditInput value={editData.name ?? ''} onChange={v => setEditData(d => ({ ...d, name: v }))} />
                    : <span style={{ color: '#27272A' }}>{eq.name}</span>
                  }</td>
                  {/* Type */}
                  <td style={tdS}>{typeBadge(eq.type)}</td>
                  {/* Section */}
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <span style={{ fontSize: 10, color: '#52525B' }}>{eq.section}</span>
                  </td>
                  {/* Fluid */}
                  <td style={tdS}>{isEdit
                    ? <EditInput value={editData.fluid ?? ''} onChange={v => setEditData(d => ({ ...d, fluid: v }))} />
                    : <span style={{ color: '#52525B', fontSize: 10 }}>{eq.fluid}</span>
                  }</td>
                  {/* Qty */}
                  <td style={{ ...tdS, textAlign: 'center', color: '#18181B' }}>{eq.qty}</td>
                  {/* Oper Temp */}
                  <td style={{ ...tdS, textAlign: 'right' }}>{isEdit
                    ? <EditInput value={editData.operTemp ?? ''} onChange={v => setEditData(d => ({ ...d, operTemp: v }))} width={55} />
                    : <NumVal>{eq.operTemp}</NumVal>
                  }</td>
                  {/* Oper Press */}
                  <td style={{ ...tdS, textAlign: 'right' }}>{isEdit
                    ? <EditInput value={editData.operPress ?? ''} onChange={v => setEditData(d => ({ ...d, operPress: v }))} width={55} />
                    : <NumVal>{eq.operPress}</NumVal>
                  }</td>
                  {/* Design Temp */}
                  <td style={{ ...tdS, textAlign: 'right' }}>{isEdit
                    ? <EditInput value={editData.designTemp ?? ''} onChange={v => setEditData(d => ({ ...d, designTemp: v }))} width={55} />
                    : <NumVal>{eq.designTemp}</NumVal>
                  }</td>
                  {/* Design Press */}
                  <td style={{ ...tdS, textAlign: 'right' }}>{isEdit
                    ? <EditInput value={editData.designPress ?? ''} onChange={v => setEditData(d => ({ ...d, designPress: v }))} width={55} />
                    : <NumVal>{eq.designPress}</NumVal>
                  }</td>
                  {/* Material */}
                  <td style={tdS}>{isEdit
                    ? <EditInput value={editData.material ?? ''} onChange={v => setEditData(d => ({ ...d, material: v }))} />
                    : <span style={{ color: '#52525B', fontSize: 10 }}>{eq.material}</span>
                  }</td>
                  {/* Capacity */}
                  <td style={tdS}>{isEdit
                    ? <EditInput value={editData.capacity ?? ''} onChange={v => setEditData(d => ({ ...d, capacity: v }))} width={160} />
                    : <span style={{ color: isDesigned ? '#1A2F44' : '#18181B', fontSize: 10, fontWeight: isDesigned ? 600 : 400 }}>{eq.capacity}</span>
                  }</td>
                  {/* Motor */}
                  <td style={{ ...tdS, textAlign: 'right' }}>{isEdit
                    ? <EditInput value={editData.motor ?? ''} onChange={v => setEditData(d => ({ ...d, motor: v }))} width={55} />
                    : <span style={{ color: '#1A2F44', fontSize: 10 }}>{eq.motor}</span>
                  }</td>
                  {/* Remarks */}
                  <td style={tdS}>{isEdit
                    ? <EditInput value={editData.remarks ?? ''} onChange={v => setEditData(d => ({ ...d, remarks: v }))} width={180} />
                    : <span style={{ color: isDesigned ? '#3F3F46' : '#64748b', fontSize: 10 }}>{eq.remarks}</span>
                  }</td>
                  {/* Design / Edit actions */}
                  <td style={{ ...tdS, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      {canDesign && !isEdit && (
                        <button
                          onClick={() => jumpToDesign(eq)}
                          style={{
                            ...actionBtn('#1A2F44'),
                            width: 'auto', padding: '0 6px', fontSize: 10, fontWeight: 700,
                          }}
                          title={`${eq.tag} 상세 설계 화면으로 이동`}
                        >
                          🔧설계
                        </button>
                      )}
                      {isEdit ? (
                        <button onClick={saveEdit} style={actionBtn('#1A2F44')}>✓</button>
                      ) : (
                        <button onClick={() => startEdit(eq)} style={actionBtn('#1A2F44')}>✏</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer summary ───────────────────────────────────── */}
      <div style={{
        padding: '6px 16px', background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex', gap: 24, flexShrink: 0, flexWrap: 'wrap',
      }}>
        {Object.entries(
          filtered.reduce<Record<string, number>>((acc, eq) => {
            acc[eq.type] = (acc[eq.type] ?? 0) + eq.qty;
            return acc;
          }, {})
        ).map(([type, count]) => (
          <span key={type} style={{ fontSize: 10, color: '#2C353E' }}>
            <span style={{ color: TYPE_COLORS[type] ?? '#52525B', fontWeight: 700 }}>{type}</span> × {count}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Mini helpers ──────────────────────────────────────────────────────────
const tdS: React.CSSProperties = {
  padding: '6px 8px',
  borderRight: '1px solid #FFFFFF',
  verticalAlign: 'middle',
};

const NumVal = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#52525B' }}>{children}</span>
);

function EditInput({ value, onChange, width = 100 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width, height: 22, padding: '0 6px',
        background: '#E5E2DC',
        border: '1px solid rgba(96,165,250,0.4)',
        borderRadius: 3, color: '#27272A', fontSize: 10, outline: 'none',
        fontFamily: 'monospace',
      }}
    />
  );
}

const actionBtn = (color: string): React.CSSProperties => ({
  width: 22, height: 22, borderRadius: 4,
  background: `${color}18`, border: `1px solid ${color}44`,
  color, fontSize: 11, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
});

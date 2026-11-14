'use client';

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  BackgroundVariant, MarkerType, EdgeMarker,
  NodeChange, EdgeChange, Connection,
  applyNodeChanges, applyEdgeChanges, addEdge,
  useReactFlow, ConnectionMode, ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { colorFromFluidKey, fluidKeyFromStream } from '@/lib/pfdFluidColors';
import PFDToolbar from './PFDToolbar';
import dynamic from 'next/dynamic';
import {
  ElectrolyzerNode, AgitatedDrumNode, TankNode, DrumHorizontalNode, PumpNode, SeparatorNode,
  HeatExchangerNode, StreamLabelNode, CompressorNode, TowerNode, TowerPackingNode, EvaporatorNode,
  FilterNode, ValveNode, SectionLabelNode, BranchNode, MixerNode,
} from './nodes/EquipmentNodes';
import { SectionGroupNode, editModeRef } from './nodes/SectionGroupNode';
import StreamEdge from './edges/StreamEdge';

const IconManager = dynamic(() => import('./IconManager'), { ssr: false });
import { AddEquipmentPanel } from './AddEquipmentPanel';
import SelectionPanel from './SelectionPanel';
import EquipmentInspectorDrawer from './EquipmentInspectorDrawer';
import StreamCoverageDrawer from './StreamCoverageDrawer';

// ── Edge handle auto-spread ────────────────────────────────
// All 8 handles are now type="source", so we use the same pool for both ends.
const ALL_HANDLES = ['src-r1', 'src-r2', 'src-b1', 'src-b2', 'tgt-l1', 'tgt-l2', 'tgt-t1', 'tgt-t2'];
// Keep legacy aliases for backward-compat (existing saved edges use these IDs)
const SOURCE_HANDLES = ALL_HANDLES;
const TARGET_HANDLES = ALL_HANDLES;

function spreadEdgeHandles(edges: Edge[]): Edge[] {
  const sourceCount: Record<string, number> = {};
  const targetCount: Record<string, number> = {};

  return edges.map(e => {
    const hasSourceHandle = ALL_HANDLES.includes(e.sourceHandle ?? '');
    const hasTargetHandle = ALL_HANDLES.includes(e.targetHandle ?? '');

    const sKey = e.source;
    const tKey = e.target;
    sourceCount[sKey] = (sourceCount[sKey] ?? -1) + 1;
    targetCount[tKey] = (targetCount[tKey] ?? -1) + 1;

    // Prefer different handles on each side so pipes don't stack on same point
    const srcIdx =  sourceCount[sKey] % 4;              // right/bottom handles (0-3)
    const tgtIdx = (targetCount[tKey] % 4) + 4;         // left/top handles (4-7)

    return {
      ...e,
      sourceHandle: hasSourceHandle ? e.sourceHandle : ALL_HANDLES[srcIdx],
      targetHandle: hasTargetHandle ? e.targetHandle : ALL_HANDLES[tgtIdx],
    };
  });
}

// ── Color palette (NewtNote Plum & Monochrome Slate) ─────
const C = {
  brine: '#1A2F44',
  cl2:   '#1A2F44',
  naoh:  '#1A2F44',
  h2:    '#3A4D63',
  stm:   '#71717A',
  cw:    '#64748B',
  h2so4: '#2C353E',
  waste: '#A1A1AA',
};

const arrow = (color: string): EdgeMarker => ({
  type: MarkerType.ArrowClosed, color, width: 10, height: 10,
});

function e(
  id: string, source: string, target: string, color: string,
  sourceHandle?: string, targetHandle?: string, animated = false,
  streamId = '',
): Edge {
  return {
    id, source, target, type: 'stream',  // use custom StreamEdge
    sourceHandle, targetHandle,
    style: { stroke: color, strokeWidth: 1.8 },
    markerEnd: arrow(color),
    animated,
    data: { streamId, color },
  };
}

function sl(
  id: string, streamId: string, x: number, y: number,
  sf: (id: string) => number | undefined,
  phase: 'G' | 'L' | 'L/G' = 'L',
  color?: string,
  parentRef?: string,   // equipment node id (within section) to attach to
): Node {
  return {
    id,
    type: 'streamLabel',
    position: { x, y },
    data: { streamId, flowKgh: sf(streamId), phase, color, parentRef },
  };
}

interface PFDCanvasProps {
  section: '100' | '200' | '300' | '400' | '600' | 'all';
  canvasHeight?: number;
}

// =====================================================================
// 100 SEC -- BRINE PURIFICATION
// Actual flow (user confirmed):
//   [NaCl feed] + [Depleted brine from D-080] --> D-010 (Brine Saturation Tank)
//   D-010 --> D-013 --> D-020 (Reaction Tank: BaCl2/NaOH/Na2CO3 injection)
//   D-020 --> T-030 (Settling/Clarifier Tank)
//   T-030 --> D-040 --> F-150 (Carbon Filter)
//   F-150 --> D-150 --> T-160 (Ion Exchange Resin Tower)
//   T-160 --> D-170 --> P-084A/B --> Electrolyzer (25% brine feed [104])
// =====================================================================
function buildSection100(sf: (id: string) => number | undefined): { nodes: Node[] ; edges: Edge[] } {
  //
  // Main process line at y=110 (left to right)
  // Depleted brine return (from electrolyzer D-080) comes from below-right
  // Chemical injection tanks sit below main line
  //
  const X = {
    D010:  80,   // Brine Saturation Tank
    P044:  200,  // pump D-010 -> D-013
    D013:  310,  // intermediate vessel
    P033:  420,  // pump D-013 -> D-020
    D020:  530,  // Reaction Tank (chemical dosing)
    P014:  650,  // pump D-020 -> T-030
    T030:  760,  // Settling / Clarifier
    P154:  880,  // pump T-030 -> D-040
    D040:  990,  // intermediate vessel
    F150: 1100,  // Carbon Filter
    D150: 1220,  // intermediate (post carbon filter)
    T160: 1350,  // Ion Exchange Resin Tower
    D170: 1480,  // refined brine storage
    P084: 1600,  // feed pump to electrolyzer
  };
  const Y_MAIN  = 110;  // main line equipment y
  const Y_PUMP  = 145;  // pump y (slightly below)
  const Y_CHEM  = 260;  // chemical injection tanks
  const Y_DEPL  = 280;  // depleted brine return line

  const nodes: Node[] = [
    // ── Main process equipment ─────────────────────────────
    { id: 'D010', type: 'agitatedDrum', position: { x: X.D010, y: Y_MAIN-10 }, data: { tag: 'D-010A/B', name: 'Brine Saturation',   color: C.brine, agitated: true } },
    { id: 'P044', type: 'pump',         position: { x: X.P044, y: Y_PUMP    }, data: { tag: 'P-044A/B', color: C.brine } },
    { id: 'D013', type: 'tank',         position: { x: X.D013, y: Y_MAIN    }, data: { tag: 'D-013',    name: 'Brine Storage',      color: C.brine } },
    { id: 'P033', type: 'pump',         position: { x: X.P033, y: Y_PUMP    }, data: { tag: 'P-033A/B', color: C.brine } },
    { id: 'D020', type: 'agitatedDrum', position: { x: X.D020, y: Y_MAIN-10 }, data: { tag: 'D-020',    name: 'Reaction Tank',      color: '#bef264', agitated: true } },
    { id: 'P014', type: 'pump',         position: { x: X.P014, y: Y_PUMP    }, data: { tag: 'P-014A/B', color: C.brine } },
    { id: 'T030', type: 'agitatedDrum', position: { x: X.T030, y: Y_MAIN-10 }, data: { tag: 'T-030',    name: 'Settler / Clarifier',color: C.brine, agitated: true } },
    { id: 'P154', type: 'pump',         position: { x: X.P154, y: Y_PUMP    }, data: { tag: 'P-154A/B', color: C.brine } },
    { id: 'D040', type: 'tank',         position: { x: X.D040, y: Y_MAIN    }, data: { tag: 'D-040',    name: 'Brine Buffer',       color: C.brine } },
    { id: 'F150', type: 'filter',       position: { x: X.F150, y: Y_MAIN-5  }, data: { tag: 'F-150',    name: 'Carbon Filter',      color: C.brine } },
    { id: 'D150', type: 'tank',         position: { x: X.D150, y: Y_MAIN    }, data: { tag: 'D-150',    name: 'Post-Filter Tank',   color: C.brine } },
    { id: 'T160', type: 'towerPacking', position: { x: X.T160, y: Y_MAIN-20 }, data: { tag: 'T-160',    name: 'Ion Exchange Resin', color: '#86efac' } },
    { id: 'D170', type: 'tank',         position: { x: X.D170, y: Y_MAIN    }, data: { tag: 'D-170',    name: 'Refined Brine Tk',   color: C.brine } },
    { id: 'P084', type: 'pump',         position: { x: X.P084, y: Y_PUMP    }, data: { tag: 'P-084A/B', color: C.brine } },

    // ── Chemical injection tanks (below main line) ─────────
    { id: 'CHEM_BaCl2', type: 'tank', position: { x: X.D020-120, y: Y_CHEM }, data: { tag: 'BaCl2 Tank', name: 'BaCl2 (SO4 removal)', color: '#e879f9' } },
    { id: 'CHEM_NaOH',  type: 'tank', position: { x: X.D020,     y: Y_CHEM }, data: { tag: 'NaOH Tank',  name: 'NaOH (pH / Mg)',     color: C.naoh } },
    { id: 'CHEM_Na2CO3',type: 'tank', position: { x: X.D020+120, y: Y_CHEM }, data: { tag: 'Na2CO3',     name: 'Na2CO3 (Ca removal)', color: '#93c5fd' } },

    // ── NaCl (salt) feed ───────────────────────────────────
    { id: 'SALT', type: 'tank', position: { x: X.D010-100, y: Y_CHEM }, data: { tag: 'NaCl Feed', name: 'Salt Hopper', color: '#fde68a' } },

    // NOTE: boundary stream labels are represented by edge stream badges.
    // No standalone sl-nodes needed here to avoid duplicate [001]/[002] labels.
  ];

  const edges: Edge[] = [
    // ── NaCl feed + Water → D-010 (stream 001 = saturated brine feed) ──
    e('100-SALT-D010',    'SALT',  'D010',  '#fde68a', undefined, undefined, false, '001'),
    // Depleted brine from 200 SEC arrives at D010 via cross-edge (stream 250)

    // ── Main process path ──────────────────────────────────────────────
    e('100-D010-P044',    'D010', 'P044', C.brine, undefined, undefined, false, '001'),
    e('100-P044-D013',    'P044', 'D013', C.brine, undefined, undefined, false, '002'),
    e('100-D013-P033',    'D013', 'P033', C.brine, undefined, undefined, false, '002'),
    e('100-P033-D020',    'P033', 'D020', C.brine, undefined, undefined, false, '002'),
    e('100-D020-P014',    'D020', 'P014', C.brine, undefined, undefined, false, '004'),
    e('100-P014-T030',    'P014', 'T030', C.brine, undefined, undefined, false, '004'),
    e('100-T030-P154',    'T030', 'P154', C.brine, undefined, undefined, false, '004'),
    e('100-P154-D040',    'P154', 'D040', C.brine, undefined, undefined, false, '004'),
    e('100-D040-F150',    'D040', 'F150', C.brine, undefined, undefined, false, '013'),
    e('100-F150-D150',    'F150', 'D150', C.brine, undefined, undefined, false, '013'),
    e('100-D150-T160',    'D150', 'T160', C.brine, undefined, undefined, false, '102'),
    e('100-T160-D170',    'T160', 'D170', C.brine, undefined, undefined, false, '022'),
    e('100-D170-P084',    'D170', 'P084', C.brine, undefined, undefined, false, '104'),
    // P084 output goes to electrolyzers via cross-edge (stream 104)

    // ── Chemical injection → D-020 (Reaction Tank) ────────────────────
    e('100-CHEM_BaCl2-D020',  'CHEM_BaCl2',  'D020', '#e879f9', undefined, undefined, false, '017'),
    e('100-CHEM_NaOH-D020',   'CHEM_NaOH',   'D020', C.naoh,    undefined, undefined, false, '105'),
    e('100-CHEM_Na2CO3-D020', 'CHEM_Na2CO3', 'D020', '#93c5fd', undefined, undefined, false, '017'),
  ];

  return { nodes, edges };
}

// =====================================================================
// =====================================================================
// 200 SEC -- ELECTROLYSIS  (Excel sheet "200 Sec")
// Equipment (R37-38): P-244A/B, P-254A/B, P-374A/B, P-314A/B, P-284A/B, P-084A/B
// Streams (R61-R70):
//   [201] Brine feed    → D-210  (FCV-231)
//   [204] HCl injection → D-210  (FCV-212)
//   [202] Depleted brine from D-210 → EL-200 (R.Header)
//   [208] Dilute NaOH catholyte feed
//   [209] SPW (soft process water)
//   [211] NaOH catholyte out ← D-220 (L.Out)
//   [213] NaOH product → storage (FCV-232)
//   [217] NaOH to 300 Sec (NaOH header)
//   [219] 32% NaOH product (LCV-250)
//   [203] Cl2 gas out   ← D-210 (G.Out)
//   [220] Cl2 header    → 400 Sec (Cl2 header)
//   [212] H2 gas out    ← D-220 (G.Out)
//   [221] H2 header     → 600 Sec (H2 header)
//   [218] Concentrated anolyte → dechlorination
//   [224] Dechlorinated brine return
//   [250] Depleted brine → 100 Sec  (LCV-370)
//   [402] Anolyte waste → 400 Sec
// =====================================================================
function buildSection200(sf: (id: string) => number | undefined): { nodes: Node[]; edges: Edge[] } {
  // ── X positions ─────────────────────────────────────────────────────
  const X = {
    // Top row: anolyte side (left) → electrolyzers (center) → catholyte/NaOH side (right)
    D210:  60,   // Anolyte Tank (separator)
    P244:  190,  // Anolyte feed pump
    ELEC:  320,  // Electrolyzers x5 (wide: 120px)
    D220:  580,  // Catholyte/NaOH Tank (separator)
    P254:  720,  // Catholyte circ. pump
    P284:  820,  // NaOH product pump → 300 Sec
    // Bottom row: dechlorination / brine return loop
    P264:  190,  // Dechlorination pump
    P314:  320,  // Brine return pump
    P374:  450,  // Depleted brine pump → 100 Sec
  };
  const Y_TOP  =  60;  // main equipment row
  const Y_PUMP = 100;  // pump row (below vessels)
  const Y_BOT  = 240;  // dechlorination row

  const nodes: Node[] = [
    // ── Anolyte side ──────────────────────────────────────────────────
    { id: 'D210', type: 'separator', position: { x: X.D210, y: Y_TOP  }, data: { tag: 'D-210',    name: 'Anolyte Tank',         color: C.brine } },
    { id: 'P244', type: 'pump',      position: { x: X.P244, y: Y_PUMP }, data: { tag: 'P-244A/B', name: 'Anolyte Feed Pump',     color: C.brine } },

    // ── Electrolyzers ─────────────────────────────────────────────────
    { id: 'ELEC', type: 'electrolyzer', position: { x: X.ELEC, y: Y_TOP-20 }, data: { tag: 'EL-200', name: 'Electrolyzers ×5 (Asahi Kasei)', color: C.cl2, numCells: 190 } },

    // ── Catholyte / NaOH side ─────────────────────────────────────────
    { id: 'D220', type: 'separator', position: { x: X.D220, y: Y_TOP  }, data: { tag: 'D-220',    name: 'Catholyte/NaOH Tank',  color: C.naoh } },
    { id: 'P254', type: 'pump',      position: { x: X.P254, y: Y_PUMP }, data: { tag: 'P-254A/B', name: 'Catholyte Circ. Pump', color: C.naoh } },
    { id: 'P284', type: 'pump',      position: { x: X.P284, y: Y_PUMP }, data: { tag: 'P-284A/B', name: 'NaOH Product Pump',    color: C.naoh } },

    // ── Dechlorination / brine return (bottom row) ────────────────────
    { id: 'P264', type: 'pump', position: { x: X.P264, y: Y_BOT }, data: { tag: 'P-264A/B', name: 'Dechlorin. Pump',   color: C.brine } },
    { id: 'P314', type: 'pump', position: { x: X.P314, y: Y_BOT }, data: { tag: 'P-314A/B', name: 'Brine Return Pump', color: C.brine } },
    { id: 'P374', type: 'pump', position: { x: X.P374, y: Y_BOT }, data: { tag: 'P-374A/B', name: 'Depleted Brine Pump',color: C.brine } },

    // ── Boundary stream labels ────────────────────────────────────────
    // [201] Brine feed IN → D-210 (T=65°C, P=4.0, 54173 kg/h, 1159 kg/m³)
    sl('sl201',  '201',  -100, -20, sf, 'L', C.brine, 'D210'),
    // [204] HCl injection IN → D-210 (T=30°C, 231 kg/h)
    sl('sl204',  '204',  -100,  30, sf, 'L', C.brine, 'D210'),
    // [208] Dilute NaOH catholyte feed IN (T=87°C, 32950 kg/h)
    sl('sl208',  '208',  -100,  20, sf, 'L', C.naoh, 'D220'),
    // [209] SPW (soft process water) IN (T=25°C, 3234 kg/h)
    sl('sl209',  '209',  -100, -20, sf, 'L', C.cw,   'D220'),
    // [203] Cl2 gas OUT ← ELEC anode (T=87°C, 4694 kg/h, MW=47.4)
    sl('sl203',  '203',  +60,  -60, sf, 'G', C.cl2,  'ELEC'),
    // [212] H2 gas OUT ← ELEC cathode (T=90°C, 405 kg/h, MW=5.67)
    sl('sl212',  '212',  +60,  +80, sf, 'G', C.h2,   'ELEC'),
    // [220] Cl2 gas header → 400 Sec (T=85.5°C, 23470 kg/h total)
    sl('sl220',  '220',  +80,  -60, sf, 'G', C.cl2,  'D210'),
    // [221] H2 gas header → 600 Sec (T=90°C, 2024 kg/h total)
    sl('sl221',  '221',  +80,  +60, sf, 'G', C.h2,   'D220'),
    // [217] NaOH product → 300 Sec (T=90°C, 67591 kg/h)
    sl('sl217',  '217',  +80,  -30, sf, 'L', C.naoh, 'P284'),
    // [219] 32% NaOH product out (T=43.5°C, 67591 kg/h)
    sl('sl219',  '219',  +80,  +10, sf, 'L', C.naoh, 'P284'),
    // [250] Depleted brine return → 100 Sec (T=86°C, P=3.2, 5450 kg/h)
    sl('sl250',  '250',  +80,  +20, sf, 'L', C.brine,'P374'),
    // [402] Anolyte waste → 400 Sec (6117 kg/h)
    sl('sl402',  '402',  +60,  +60, sf, 'L', C.waste,'P374'),
  ];

  const edges: Edge[] = [
    // ── Brine feed → Anolyte tank ──────────────────────────────────────
    e('200-sl201-D210',    'sl201', 'D210',  C.brine, undefined, undefined, false, '201'),
    e('200-sl204-D210',    'sl204', 'D210',  C.brine, undefined, undefined, false, '204'),

    // ── Anolyte loop: D-210 → P-244 → ELEC ────────────────────────────
    e('200-D210-P244',     'D210',  'P244',  C.brine, undefined, undefined, false, '201'),
    e('200-P244-ELEC',     'P244',  'ELEC',  C.brine, undefined, undefined, false, '201'),  // [201] brine to anode

    // ── Electrolyzers → gas/liquid outlets ────────────────────────────
    e('200-ELEC-sl203',    'ELEC',  'sl203', C.cl2,   undefined, undefined, false, '203'),  // Cl2 gas anode
    e('200-ELEC-sl212',    'ELEC',  'sl212', C.h2,    undefined, undefined, false, '212'),  // H2 gas cathode
    e('200-ELEC-D220',     'ELEC',  'D220',  C.naoh,  undefined, undefined, false, '211'),  // NaOH catholyte out [211]
    e('200-ELEC-D210ret',  'ELEC',  'D210',  C.brine, undefined, undefined, false, '202'),  // depleted brine [202] back to D-210

    // ── Anolyte: Cl2 gas header → 400 Sec ─────────────────────────────
    e('200-sl203-sl220',   'sl203', 'sl220', C.cl2,   undefined, undefined, false, '220'),

    // ── Catholyte (NaOH) loop ──────────────────────────────────────────
    e('200-sl208-D220',    'sl208', 'D220',  C.naoh,  undefined, undefined, false, '208'),  // dilute NaOH feed
    e('200-sl209-D220',    'sl209', 'D220',  C.cw,    undefined, undefined, false, '209'),  // SPW
    e('200-D220-P254',     'D220',  'P254',  C.naoh,  undefined, undefined, false, '211'),  // catholyte circ.
    e('200-P254-ELEC',     'P254',  'ELEC',  C.naoh,  undefined, undefined, false, '208'),  // catholyte recirculation to ELEC
    e('200-D220-P284',     'D220',  'P284',  C.naoh,  undefined, undefined, false, '219'),  // NaOH product draw-off
    e('200-P284-sl217',    'P284',  'sl217', C.naoh,  undefined, undefined, false, '217'),  // NaOH → 300 Sec
    e('200-P284-sl219',    'P284',  'sl219', C.naoh,  undefined, undefined, false, '219'),  // NaOH product

    // ── H2 header → 600 Sec ────────────────────────────────────────────
    e('200-sl212-sl221',   'sl212', 'sl221', C.h2,    undefined, undefined, false, '221'),

    // ── Depleted brine dechlorination loop ─────────────────────────────
    e('200-D210-P264',     'D210',  'P264',  C.brine, undefined, undefined, false, '218'),  // concentrated anolyte [218]
    e('200-P264-P314',     'P264',  'P314',  C.brine, undefined, undefined, false, '224'),  // dechlorinated brine [224]
    e('200-P314-P374',     'P314',  'P374',  C.brine, undefined, undefined, false, '224'),
    e('200-P374-sl250',    'P374',  'sl250', C.brine, undefined, undefined, false, '250'),  // → 100 Sec return
    e('200-P374-sl402',    'P374',  'sl402', C.waste, undefined, undefined, false, '402'),  // → 400 Sec waste
  ];

  return { nodes, edges };
}

// =====================================================================
// 300 SEC -- NaOH EVAPORATION (32% -> 50%) — Excel "300 Sec" (MB-2012_CA_NO.3_468TON_R1)
// Triple-Effect Falling Film Evaporator (3중 효용 강하막식 증발 농축 공정)
// • Top Row (Left → Right):
//     [1st Effect] D-5321(Cond Pot) + E-320(1st FF Evap) + D-321(1st Sep) + P-321
//     [2nd Effect] E-330(2nd FF Evap) + D-331(2nd Sep) + P-331
//     [3rd Effect] D-5341(Flash Drum) + E-340(3rd FF Evap) + D-341(3rd Sep) + P-341 + E-350(Surface Condenser)
// • Middle Row (50% NaOH Heat Recovery + Final Cooler):
//     P-321 [L11] -> E-332(E-5332) [L12] -> E-342(E-5342) [L13] -> E-352(E-5352 Cooler) -> [L14] 50% NaOH Product
// • Bottom Row (Steam Condensate Heat Recovery):
//     D-5321 [C1] -> E-333(E-5333) [C2] -> E-343(E-5343) -> [C3] Condensate Out
// • Parallel Preheating Splits (Backward-Feed Liquor):
//     [L1] (32%, 90°C) -> E-340(3rd FF) -> D-341 -> P-341 [L2: 36.4%, 68.4°C]
//       -> Split L3(75.5% to E-342) & L4(24.5% to E-343) -> Join [L5: 109.6°C] -> E-330(2nd FF)
//       -> D-331 -> P-331 [L7: 42.1%, 108.5°C]
//       -> Split L8(75.5% to E-332) & L9(24.5% to E-333) -> Join [L10: 157.2°C] -> E-320(1st FF)
// =====================================================================
function buildSection300(sf: (id: string) => number | undefined): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // ── Top Row (Left → Right): 1st Effect (E-320) → 2nd Effect (E-330) → 3rd Effect (E-340) → Surface Condenser (E-350) ──
    // 1st Effect Group (Left)
    { id: 'D5321', type: 'separator',     position: { x: 70,   y: 115 }, data: { tag: 'D-5321',   name: '1st Cond. Flash Pot',      color: C.stm  } },
    { id: 'E320',  type: 'evaporator',    position: { x: 155,  y: 55  }, data: { tag: 'E-320',    name: '1st FF Evap (50.0%)',      color: C.naoh, subType: 'evap' } },
    { id: 'D321',  type: 'separator',     position: { x: 245,  y: 80  }, data: { tag: 'D-321',    name: '1st Vapor Sep',            color: C.stm  } },
    { id: 'P321',  type: 'pump',          position: { x: 215,  y: 200 }, data: { tag: 'P-321A/B', name: '1st Effect Pump',          color: C.naoh } },

    // 2nd Effect Group (Middle)
    { id: 'E330',  type: 'evaporator',    position: { x: 525,  y: 55  }, data: { tag: 'E-330',    name: '2nd FF Evap (42.1%)',      color: C.naoh, subType: 'evap' } },
    { id: 'D331',  type: 'separator',     position: { x: 615,  y: 80  }, data: { tag: 'D-331',    name: '2nd Vapor Sep',            color: C.stm  } },
    { id: 'P331',  type: 'pump',          position: { x: 585,  y: 185 }, data: { tag: 'P-331A/B', name: '2nd Effect Pump',          color: C.naoh } },

    // 3rd Effect Group & Surface Condenser (Right)
    { id: 'D5341', type: 'separator',     position: { x: 820,  y: 115 }, data: { tag: 'D-340',    name: 'Flash Steam Drum',         color: C.stm  } },
    { id: 'E340',  type: 'evaporator',    position: { x: 905,  y: 55  }, data: { tag: 'E-340',    name: '3rd FF Evap (36.4%)',      color: C.naoh, subType: 'evap' } },
    { id: 'D341',  type: 'separator',     position: { x: 995,  y: 80  }, data: { tag: 'D-341',    name: '3rd Vapor Sep',            color: C.stm  } },
    { id: 'P341',  type: 'pump',          position: { x: 965,  y: 185 }, data: { tag: 'P-341A/B', name: '3rd Effect Pump',          color: C.naoh } },
    { id: 'E350',  type: 'heatExchanger', position: { x: 1145, y: 60  }, data: { tag: 'E-350',    name: 'Surface Condenser',        color: C.cw   } },

    // ── Middle Row: 50% NaOH Heat Recovery Train (L11 → E-332 → L12 → E-342 → L13 → E-352 → L14) ──
    { id: 'E332',  type: 'heatExchanger', position: { x: 465,  y: 265 }, data: { tag: 'E-332',    name: '1st Preheater (NaOH)'      } },
    { id: 'E342',  type: 'heatExchanger', position: { x: 845,  y: 265 }, data: { tag: 'E-342',    name: '2nd Preheater (NaOH)'      } },
    { id: 'E352',  type: 'heatExchanger', position: { x: 1105, y: 265 }, data: { tag: 'E-352',    name: '50% NaOH Cooler'           } },

    // ── Bottom Row: Steam Condensate Heat Recovery Train (C1 → E-333 → C2 → E-343 → C3) ──
    { id: 'E333',  type: 'heatExchanger', position: { x: 465,  y: 360 }, data: { tag: 'E-333',    name: '1st Preheater (Cond.)'     } },
    { id: 'E343',  type: 'heatExchanger', position: { x: 845,  y: 360 }, data: { tag: 'E-343',    name: '2nd Preheater (Cond.)'     } },

    // ── Boundary stream labels (parentRef = move with equipment) ──
    sl('slS1',   'S1',  -75, -35, sf, 'G', '#fb7185', 'E320'),   // 13K Live Steam IN (8"-SM-BA1 to E-320)
    sl('slL1',   'L1',  +95, -40, sf, 'L', C.naoh,    'E340'),   // 32% NaOH Feed IN (top-right via LCV-5340 to E-340 top)
    sl('slC4',   'C4',  +85, +55, sf, 'L', C.stm,     'D5341'),  // Process Condensate OUT (from D-5341 via LCV-5341)
    sl('slL14',  'L14', +85,   0, sf, 'L', C.naoh,    'E352'),   // 50% NaOH Product OUT (42°C)
    sl('slL15',  'L15',   0, +58, sf, 'L', C.cw,      'E352'),   // E-352 Cooling / Dilution Water IN (32°C)
    sl('slC3',   'C3',  +85,   0, sf, 'L', C.stm,     'E343'),   // Steam Condensate OUT (74.7°C via LCV-5321)
  ];

  const edges: Edge[] = [
    // ── 1. Forward-Vapor Heating Path (Left → Right: S1 → E-320 → V1 → E-330 → V2 → E-340 → V3 → E-350) ──
    e('300-slS1-E320',    'slS1',  'E320',  '#fb7185', 'src-r1', 'tgt-l1', true,  'S1'),
    e('300-E320-D5321',   'E320',  'D5321', C.stm,     'tgt-l2', 'src-r1', false, 'C1'),
    e('300-D5321-E330',   'D5321', 'E330',  '#38bdf8', 'tgt-t1', 'tgt-l1', true,  'C5'),
    e('300-D321-E330',    'D321',  'E330',  '#38bdf8', 'tgt-t1', 'tgt-l1', true,  'V1'),
    e('300-D331-E340',    'D331',  'E340',  '#38bdf8', 'tgt-t1', 'tgt-l1', true,  'V2'),
    e('300-E340-D5341',   'E340',  'D5341', C.stm,     'tgt-l2', 'src-r1', false, 'C6'),
    e('300-D5341-slC4',   'D5341', 'slC4',  C.stm,     'src-b1', 'tgt-l1', false, 'C4'),
    e('300-D341-E350',    'D341',  'E350',  '#38bdf8', 'tgt-t1', 'tgt-l1', true,  'V3'),

    // ── 2. Backward-Feed NaOH Liquor Path (Right → Left: L1 → 3rd E-340 → E-342/343 → 2nd E-330 → E-332/333 → 1st E-320) ──
    // 32% NaOH Feed [L1] into top of 3rd Effect E-340
    e('300-slL1-E340',    'slL1',  'E340',  C.naoh,    'tgt-l1', 'tgt-t1', false, 'L1'),
    e('300-E340-D341',    'E340',  'D341',  C.naoh,    'src-b2', 'tgt-l2', false, 'L2'),
    e('300-D341-P341',    'D341',  'P341',  C.naoh,    'src-b1', 'tgt-t1', false, 'L2'),
    // P-341 [L2: 36.4%] splits into L3 (75.5% → E-342) and L4 (24.5% → E-343), recombining as [L5] to E-330 top
    e('300-P341-E342',    'P341',  'E342',  C.naoh,    'src-b1', 'tgt-t1', false, 'L3'),
    e('300-P341-E343',    'P341',  'E343',  C.naoh,    'src-b1', 'tgt-t1', false, 'L4'),
    e('300-E342-E330',    'E342',  'E330',  C.naoh,    'tgt-l1', 'tgt-t1', false, 'L5'),
    e('300-E343-E330',    'E343',  'E330',  C.naoh,    'tgt-l1', 'tgt-t1', false, 'L5'),

    // 2nd Effect E-330 → D-331 → P-331 [L7: 42.1%]
    e('300-E330-D331',    'E330',  'D331',  C.naoh,    'src-b2', 'tgt-l2', false, 'L7'),
    e('300-D331-P331',    'D331',  'P331',  C.naoh,    'src-b1', 'tgt-t1', false, 'L7'),
    // P-331 [L7: 42.1%] splits into L8 (75.5% → E-332) and L9 (24.5% → E-333), recombining as [L10] to E-320 top
    e('300-P331-E332',    'P331',  'E332',  C.naoh,    'src-b1', 'tgt-t1', false, 'L8'),
    e('300-P331-E333',    'P331',  'E333',  C.naoh,    'src-b1', 'tgt-t1', false, 'L9'),
    e('300-E332-E320',    'E332',  'E320',  C.naoh,    'tgt-l1', 'tgt-t1', false, 'L10'),
    e('300-E333-E320',    'E333',  'E320',  C.naoh,    'tgt-l1', 'tgt-t1', false, 'L10'),

    // 1st Effect E-320 → D-321 → P-321 [L11: 50.0% NaOH, 164.8°C]
    e('300-E320-D321',    'E320',  'D321',  C.naoh,    'src-b2', 'tgt-l2', false, 'L11'),
    e('300-D321-P321',    'D321',  'P321',  C.naoh,    'src-b1', 'tgt-t1', false, 'L11'),

    // ── 3. Middle Row: 50% NaOH Product Heat Recovery & Cooling (L11 → E-332 → L12 → E-342 → L13 → E-352 → L14) ──
    e('300-P321-E332',    'P321',  'E332',  '#f97316', 'src-r1', 'tgt-l1', false, 'L11'),
    e('300-E332-E342',    'E332',  'E342',  '#f97316', 'src-r1', 'tgt-l1', false, 'L12'),
    e('300-E342-E352',    'E342',  'E352',  '#f97316', 'src-r1', 'tgt-l1', false, 'L13'),
    e('300-E352-slL14',   'E352',  'slL14', '#f97316', 'src-r1', 'tgt-l1', false, 'L14'),
    e('300-slL15-E352',   'slL15', 'E352',  C.cw,      'tgt-t1', 'src-b1', false, 'L15'),

    // ── 4. Bottom Row: 1st Effect Steam Condensate Heat Recovery (D-5321 → C1 → E-333 → C2 → E-343 → C3) ──
    e('300-D5321-E333',   'D5321', 'E333',  C.stm,     'src-b1', 'tgt-l1', false, 'C1'),
    e('300-E333-E343',    'E333',  'E343',  C.stm,     'src-r1', 'tgt-l1', false, 'C2'),
    e('300-E343-slC3',    'E343',  'slC3',  C.stm,     'src-r1', 'tgt-l1', false, 'C3'),
  ];
  return { nodes, edges };
}

// =====================================================================
// 400 SEC -- Cl2 PROCESSING, DRYING & LIQUEFACTION
// Excel R66: T-410(Wash) -> P-413 -> T-420/430/440/450(Dry) -> F-424
//            -> C-470(Compress) -> D-484(Liquefy) -> D-495/496(Store)
// =====================================================================
function buildSection400(sf: (id: string) => number | undefined): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // Main Cl2 gas path (top row, left to right)
    { id: 'T410',  type: 'towerPacking',position: { x: 60,   y: 80  }, data: { tag: 'T-410',    name: '1st Cl2 Wash Tower', color: C.cl2 } },
    { id: 'P413a', type: 'pump',        position: { x: 140,  y: 220 }, data: { tag: 'P-413A/B', color: C.waste } },
    { id: 'P413c', type: 'pump',        position: { x: 230,  y: 220 }, data: { tag: 'P-413C/D', color: C.waste } },
    { id: 'E413',  type: 'heatExchanger',position: { x: 200, y: 80  }, data: { tag: 'E-413',    name: 'Cl2 Cooler 1'      } },
    { id: 'E423',  type: 'heatExchanger',position: { x: 310, y: 80  }, data: { tag: 'E-423',    name: 'Cl2 Cooler 2'      } },
    { id: 'E433',  type: 'heatExchanger',position: { x: 400, y: 80  }, data: { tag: 'E-433',    name: 'Cl2 Cooler 3'      } },
    { id: 'T420',  type: 'towerPacking',position: { x: 500,  y: 70  }, data: { tag: 'T-420',    name: '2nd Cl2 Wash Tower', color: C.cl2 } },
    { id: 'T430',  type: 'towerPacking',position: { x: 600,  y: 70  }, data: { tag: 'T-430',    name: 'H2SO4 Drying 1',   color: C.cl2 } },
    { id: 'T440',  type: 'towerPacking',position: { x: 700,  y: 70  }, data: { tag: 'T-440',    name: 'H2SO4 Drying 2',   color: C.cl2 } },
    { id: 'T450',  type: 'towerPacking',position: { x: 790,  y: 70  }, data: { tag: 'T-450',    name: 'H2SO4 Drying 3',   color: C.h2so4} },
    { id: 'F424',  type: 'filter',      position: { x: 880,  y: 90  }, data: { tag: 'F-424',    name: 'Mist Eliminator',   color: C.cl2 } },
    { id: 'C470',  type: 'compressor',  position: { x: 990,  y: 80  }, data: { tag: 'C-470',    name: 'Cl2 Compressor',    color: C.cl2 } },
    // Liquefaction section
    { id: 'D484',  type: 'heatExchanger',position: { x: 1110, y: 80  }, data: { tag: 'D-484',    name: 'Cl2 Liquefier',     color: C.cl2 } },
    { id: 'D495',  type: 'separator',   position: { x: 1240, y: 80  }, data: { tag: 'D-495',    name: 'Cl2 Accumulator',   color: C.cl2 } },
    { id: 'D496',  type: 'drumHorizontal',position: { x: 1240, y: 230 }, data: { tag: 'D-496',    name: 'Liq Cl2 Storage',   color: C.cl2 } },
    { id: 'P494',  type: 'pump',        position: { x: 1340, y: 115 }, data: { tag: 'P-494A/B', color: C.cl2 } },
    { id: 'P496',  type: 'pump',        position: { x: 1340, y: 260 }, data: { tag: 'P-496A/B', color: C.cl2 } },
    // H2SO4 supply tank
    { id: 'TH2SO4',type: 'tank',        position: { x: 650,  y: 250 }, data: { tag: 'H2SO4 Tk', name: 'H2SO4 Supply Tank', color: C.h2so4} },
    { id: 'P450',  type: 'pump',        position: { x: 820,  y: 250 }, data: { tag: 'P-450A/B', color: C.h2so4} },
    // Vent/waste (Hypo Manufacturing Towers T-730 / T-760)
    { id: 'D940',  type: 'towerPacking',position: { x: 1390, y: 80  }, data: { tag: 'T-730',    name: 'Hypo / Cl2 Scrubber (T-730/760)', color: C.waste} },
    // Stream labels
    sl('sl400_220', '220',  30,   40,  sf, 'G', C.cl2),   // Cl2 gas in
    sl('sl401',     '401',  130,  40,  sf, 'G', C.cl2),
    sl('sl403',     '403',  260,  40,  sf, 'G', C.cl2),
    sl('sl405',     '405',  360,  40,  sf, 'G', C.cl2),
    sl('sl409',     '409',  570,  40,  sf, 'G', C.cl2),
    sl('sl411',     '411',  760,  40,  sf, 'G', C.cl2),
    sl('sl413',     '413',  890,  40,  sf, 'G', C.cl2),
    sl('sl415',     '415',  1020, 40,  sf, 'G', C.cl2),
    sl('sl418',     '418',  1150, 40,  sf, 'G', C.cl2),
    sl('sl420',     '420',  1370, 40,  sf, 'G', C.waste),  // Vent
    sl('sl421',     '421',  1150, 200, sf, 'L', C.cl2),    // Liq Cl2
    sl('sl404',     '404',  130,  180, sf, 'L', C.waste),  // Wash water
    sl('sl412_1',   '412-1',550,  200, sf, 'L', C.h2so4), // Spent H2SO4
  ];
  const edges: Edge[] = [
    e('400-sl400_220-T410', 'sl400_220', 'T410',  C.cl2,   undefined, undefined, false, '220'),
    e('400-T410-E413',      'T410',      'E413',  C.cl2,   undefined, undefined, false, '401'),
    e('400-E413-E423',      'E413',      'E423',  C.cl2,   undefined, undefined, false, '403'),
    e('400-E423-E433',      'E423',      'E433',  C.cl2,   undefined, undefined, false, '405'),
    e('400-E433-T420',      'E433',      'T420',  C.cl2,   undefined, undefined, false, '405'),
    e('400-T420-T430',      'T420',      'T430',  C.cl2,   undefined, undefined, false, '409'),
    e('400-T430-T440',      'T430',      'T440',  C.cl2,   undefined, undefined, false, '409'),
    e('400-T440-F424',      'T440',      'F424',  C.cl2,   undefined, undefined, false, '411'),
    e('400-F424-C470',      'F424',      'C470',  C.cl2,   undefined, undefined, false, '413'),
    e('400-C470-D484',      'C470',      'D484',  C.cl2,   undefined, undefined, false, '415'),
    e('400-D484-D495',      'D484',      'D495',  C.cl2,   undefined, undefined, false, '418'),
    e('400-D495-P494',      'D495',      'P494',  C.cl2,   undefined, undefined, false, '418'),
    e('400-D484-D496',      'D484',      'D496',  C.cl2,   undefined, undefined, false, '421'),
    e('400-D496-P496',      'D496',      'P496',  C.cl2,   undefined, undefined, false, '425'),
    e('400-P496-sl421',     'P496',      'sl421', C.cl2,   undefined, undefined, false, '425'),
    e('400-D495-sl420',     'D495',      'sl420', C.waste, undefined, undefined, false, '420'),
    e('400-sl420-D940',     'sl420',     'D940',  C.waste, undefined, undefined, false, '429'),
    e('400-TH2SO4-P450',    'TH2SO4',    'P450',  C.h2so4, undefined, undefined, false, '416'),
    e('400-P450-T420',      'P450',      'T420',  C.h2so4, undefined, undefined, false, '416'),
    e('400-T410-sl404',     'T410',      'sl404', C.waste, undefined, undefined, false, '402'),
    e('400-T440-sl412_1',   'T440',      'sl412_1',C.h2so4,undefined, undefined, false, '416'),
    e('400-P413a-T410',     'P413a',     'T410',  C.waste, undefined, undefined, false, '402'),
  ];
  return { nodes, edges };
}

// =====================================================================
// 600 SEC -- H2 PROCESSING (Cooling -> Sep -> Compress -> Purify)
// Excel R91: E-5613(1st cool) E-5630(2nd cool CCW) E-5680(purif cool) E-5682(after-cool)
// =====================================================================
function buildSection600(sf: (id: string) => number | undefined): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // Main H2 path
    { id: 'E5613', type: 'heatExchanger', position: { x: 100,  y: 90  }, data: { tag: 'E-5613', name: 'H2 1st Cooler (CW)' } },
    { id: 'E5630', type: 'heatExchanger', position: { x: 230,  y: 90  }, data: { tag: 'E-5630', name: 'H2 2nd Cooler (CCW)'} },
    { id: 'D610',  type: 'separator',     position: { x: 360,  y: 70  }, data: { tag: 'D-610',  name: 'H2 Moisture Sep',    color: C.h2 } },
    { id: 'C620',  type: 'compressor',    position: { x: 500,  y: 90  }, data: { tag: 'C-620',  name: 'H2 Compressor',     color: C.h2 } },
    { id: 'E5680', type: 'heatExchanger', position: { x: 630,  y: 90  }, data: { tag: 'E-5680', name: 'H2 Purif Cooler'   } },
    { id: 'E5682', type: 'heatExchanger', position: { x: 760,  y: 90  }, data: { tag: 'E-5682', name: 'H2 After-cooler'   } },
    { id: 'D680',  type: 'tank',          position: { x: 880,  y: 70  }, data: { tag: 'D-680',  name: 'H2 Header',         color: C.h2 } },
    // Condensate / utility
    { id: 'T620',  type: 'tank',          position: { x: 360,  y: 230 }, data: { tag: 'T-620',  name: 'Condensate Tank',   color: C.cw } },
    { id: 'P613',  type: 'pump',          position: { x: 460,  y: 260 }, data: { tag: 'P-613A/B',color: C.cw } },
    // Chilled water system
    { id: 'CCW',   type: 'tank',          position: { x: 230,  y: 240 }, data: { tag: 'CCW',    name: 'Chilled CW',        color: C.cw } },
    // ── Boundary stream labels (parentRef = attached to equipment, move with it) ──
    sl('sl221_600', '221', -80, -30, sf, 'G', C.h2,  'E5613'),  // H2 in from 200 SEC
    sl('sl611',     '611', +60, -30, sf, 'G', C.h2,  'D680'),   // H2 product OUT
    sl('sl604',     '604', -30, +60, sf, 'L', C.cw,  'D610'),   // Condensate drain
    sl('sl612',     '612', -70, -30, sf, 'L', C.cw,  'CCW'),    // CCW supply
    sl('sl613',     '613', +50, +50, sf, 'L', C.cw,  'E5680'),  // Condensate from cooler
  ];
  const edges: Edge[] = [
    e('600-sl221_600-E5613', 'sl221_600', 'E5613', C.h2,  undefined, undefined, false, '601'),
    e('600-E5613-E5630',     'E5613',     'E5630',  C.h2, undefined, undefined, false, '602'),
    e('600-E5630-D610',      'E5630',     'D610',   C.h2, undefined, undefined, false, '603'),
    e('600-D610-C620',       'D610',      'C620',   C.h2, undefined, undefined, false, '607'),
    e('600-C620-E5680',      'C620',      'E5680',  C.h2, undefined, undefined, false, '608'),
    e('600-E5680-E5682',     'E5680',     'E5682',  C.h2, undefined, undefined, false, '609'),
    e('600-E5682-D680',      'E5682',     'D680',   C.h2, undefined, undefined, false, '610'),
    e('600-D680-sl611',      'D680',      'sl611',  C.h2, undefined, undefined, false, '611'),
    e('600-D610-T620',       'D610',      'T620',   C.cw, undefined, undefined, false, '604'),
    e('600-T620-P613',       'T620',      'P613',   C.cw, undefined, undefined, false, '604'),
    e('600-CCW-E5630',       'CCW',       'E5630',  C.cw, undefined, undefined, false, '612'),
    e('600-E5680-T620',      'E5680',     'T620',   C.cw, undefined, undefined, false, '613'),
  ];
  return { nodes, edges };
}

// =====================================================================
// GROUP NODE HELPERS
// =====================================================================

function prefixNodes(nodes: Node[], key: string): Node[] {
  // Separate main equipment nodes from stream-label nodes with parentRef
  const mainNodes = nodes.filter(n => !n.data?.parentRef);
  const minY = mainNodes.length ? Math.min(...mainNodes.map(n => n.position.y)) : 0;

  return nodes.map(n => {
    const parentRef = n.data?.parentRef as string | undefined;
    if (parentRef) {
      // Stream label attached to a specific equipment node -- moves with it
      return {
        ...n,
        id: `${key}_${n.id}`,
        parentId: `${key}_${parentRef}`,
        extent: undefined,          // allowed to render outside parent bounds
        position: n.position,       // position is RELATIVE to the equipment node
        draggable: false,           // moves automatically with parent
        selectable: true,
        zIndex: 200,
      };
    }
    return {
      ...n,
      id: `${key}_${n.id}`,
      parentId: `${key}_group`,
      extent: 'parent' as const,
      position: { x: n.position.x, y: n.position.y - minY + 60 },
      // Do NOT set draggable here — let nodesDraggable={editMode} on ReactFlow
      // control it globally. If we set draggable:false here (e.g. at mount when
      // editMode is false), it overrides the global prop and prevents drag
      // even after the user switches to edit mode.
    };
  });
}

function prefixEdges(edges: Edge[], key: string): Edge[] {
  return edges.map(ed => ({
    ...ed,
    id: `${key}_${ed.id}`,
    source: `${key}_${ed.source}`,
    target: `${key}_${ed.target}`,
  }));
}

function buildCrossEdges(show: boolean): Edge[] {
  if (!show) return [];
  const dash = (id: string, src: string, tgt: string, color: string): Edge => ({
    id, source: src, target: tgt, type: 'smoothstep',
    style: { stroke: color, strokeWidth: 1.8, strokeDasharray: '8 4' },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 10, height: 10 },
    animated: true,
  });
  return [
    dash('cross-104-201',  's100_P084',      's200_D210',      C.brine),   // stream 104: refined brine to electrolyzers
    dash('cross-250-100',  's200_sl250',     's100_D010',      C.brine),   // stream 250: depleted brine return
    dash('cross-217-L1',   's200_sl217',     's300_slL1',      C.naoh),
    dash('cross-220-400',  's200_sl220',     's400_sl400_220', C.cl2),
    dash('cross-221-600',  's200_sl221',     's600_sl221_600', C.h2),
  ];
}

const SECTION_DEFAULTS = {
  s100: { x: 0,    y: 0, w: 1780, h: 420, color: '#4ade80', label: '100 SEC - Brine Purification' },
  s200: { x: 1860, y: 0, w: 1200, h: 360, color: '#60a5fa', label: '200 SEC - Electrolysis' },
  s300: { x: 3090, y: 0, w: 1320, h: 485, color: '#f97316', label: '300 SEC - NaOH Evaporation (3-Effect Falling Film)' },
  s400: { x: 4270, y: 0, w: 1600, h: 420, color: '#60a5fa', label: '400 SEC - Cl2 Processing' },
  s600: { x: 5950, y: 0, w: 1100, h: 380, color: '#a78bfa', label: '600 SEC - H2 Processing' },
};

// =====================================================================
// SECTION FOCUSER -- pans camera to selected section tab
// =====================================================================
function SectionFocuser({ section }: { section: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = setTimeout(() => {
      if (section === 'all') {
        fitView({ padding: 0.06, duration: 600 });
      } else {
        fitView({ nodes: [{ id: `s${section}_group` }], padding: 0.08, duration: 600 });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [section, fitView]);
  return null;
}

// nodeTypes and edgeTypes OUTSIDE component to avoid re-creation warnings
const nodeTypes = {
  sectionGroup:   SectionGroupNode,
  electrolyzer:   ElectrolyzerNode,
  agitatedDrum:   AgitatedDrumNode,
  tank:           TankNode,
  drumHorizontal: DrumHorizontalNode,
  pump:           PumpNode,
  separator:      SeparatorNode,
  heatExchanger:  HeatExchangerNode,
  streamLabel:    StreamLabelNode,
  compressor:     CompressorNode,
  tower:          TowerNode,
  towerPacking:   TowerPackingNode,
  evaporator:     EvaporatorNode,
  filter:         FilterNode,
  valve:          ValveNode,
  branch:         BranchNode,
  mixer:          MixerNode,
  sectionLabel:   SectionLabelNode,
};

const edgeTypes = {
  stream: StreamEdge,
};

// =====================================================================
// MAIN COMPONENT
// =====================================================================
export default function PFDCanvas({ section }: PFDCanvasProps) {
  const { balance } = useBalanceStore();
  const streams = balance.streams;
  // ── Store selectors (individual to avoid re-render on unrelated changes) ──
  const editMode         = usePFDStore(s => s.editMode);
  const showCrossEdges   = usePFDStore(s => s.showCrossEdges);
  const nodePositions    = usePFDStore(s => s.nodePositions);
  const saveNodePosition = usePFDStore(s => s.saveNodePosition);
  const edgeStreamMap      = usePFDStore(s => s.edgeStreamMap);
  const userEdges          = usePFDStore(s => s.userEdges);
  const deletedNodeIds     = usePFDStore(s => s.deletedNodeIds);
  const deletedEdgeIds     = usePFDStore(s => s.deletedEdgeIds);
  const nodeTagOverrides   = usePFDStore(s => s.nodeTagOverrides);
  const nodeTypeOverrides  = usePFDStore(s => s.nodeTypeOverrides ?? {});
  const edgeColorOverrides = usePFDStore(s => s.edgeColorOverrides ?? {});
  const edgeFluidMap       = usePFDStore(s => s.edgeFluidMap ?? {});
  const setEdgeAppearance  = usePFDStore(s => s.setEdgeAppearance);
  const addUserEdge        = usePFDStore(s => s.addUserEdge);
  const markNodeDeleted    = usePFDStore(s => s.markNodeDeleted);
  const markEdgeDeleted    = usePFDStore(s => s.markEdgeDeleted);
  const removeUserNode     = usePFDStore(s => s.removeUserNode);
  const removeUserEdge     = usePFDStore(s => s.removeUserEdge);
  const userNodes          = usePFDStore(s => s.userNodes);
  const addUserNode        = usePFDStore(s => s.addUserNode);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [iconManagerOpen,    setIconManagerOpen]    = useState(false);
  const [addPanelOpen,       setAddPanelOpen]       = useState(false);
  const [coverageOpen,       setCoverageOpen]       = useState(false);
  const [highlightCalcUnits, setHighlightCalcUnits] = useState(true);
  const [rfInstance,         setRfInstance]         = useState<ReactFlowInstance | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [selectedNodes,      setSelectedNodes]      = useState<Node[]>([]);
  const [selectedEdges,      setSelectedEdges]      = useState<Edge[]>([]);

  // Keep the module-level ref in sync so SectionGroupNode reads latest editMode
  // without calling usePFDStore (which causes nodeTypes recreation warning).
  editModeRef.current = editMode;

  const getFlow = useCallback((id: string) => {
    const s = streams.find(s => s.id === id);
    return s?.total_kgh;
  }, [streams]);

  const sec100 = useMemo(() => buildSection100(getFlow), [getFlow]);
  const sec200 = useMemo(() => buildSection200(getFlow), [getFlow]);
  const sec300 = useMemo(() => buildSection300(getFlow), [getFlow]);
  const sec400 = useMemo(() => buildSection400(getFlow), [getFlow]);
  const sec600 = useMemo(() => buildSection600(getFlow), [getFlow]);

  // Build single canvas with all sections as group nodes
  const { allNodes, allEdges } = useMemo(() => {
    const SECS = [
      { key: 's100', sec: sec100 },
      { key: 's200', sec: sec200 },
      { key: 's300', sec: sec300 },
      { key: 's400', sec: sec400 },
      { key: 's600', sec: sec600 },
    ];
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Helper: convert user-added nodes for a section into Node format
    const userNodesFor = (sectionKey: string) =>
      (userNodes ?? []).filter(un => un.section === sectionKey).map(un => ({
        id: un.id,
        type: un.type,
        position: un.position,
        data: { tag: un.tag, name: un.name, color: un.color, multiplier: un.multiplier },
      }));

    SECS.forEach(({ key, sec }) => {
      const sectionNum = key.replace('s', '');
      const def = SECTION_DEFAULTS[key as keyof typeof SECTION_DEFAULTS];
      const savedPos = nodePositions[`${key}_group`];
      const savedW   = nodePositions[`${key}_group_w`];
      const savedH   = nodePositions[`${key}_group_h`];
      const gPos = savedPos ?? { x: def.x, y: def.y };
      const gW   = savedW ? savedW.x : def.w;
      const gH   = savedH ? savedH.y : def.h;

      const groupDeleted = deletedNodeIds.includes(`${key}_group`);

      // Skip deleted group nodes
      if (!groupDeleted) {
        nodes.push({
          id: `${key}_group`,
          type: 'sectionGroup',
          position: gPos,
          style: { width: gW, height: gH },
          data: { label: def.label, color: def.color },
          zIndex: -1,
        });
      }

      // If the group is deleted, skip ALL its children too
      // (otherwise they'd have a parentId pointing to a missing node)
      if (!groupDeleted) {
        const mergedNodes = [...sec.nodes, ...userNodesFor(sectionNum)];
        const prefixed = prefixNodes(mergedNodes, key);

        prefixed
          .map(n => { const saved = nodePositions[n.id]; return saved ? { ...n, position: saved } : n; })
          .map(n => { const ov = nodeTagOverrides[n.id]; return ov ? { ...n, data: { ...n.data, tag: ov.tag, name: ov.name } } : n; })
          .map(n => { const ovType = nodeTypeOverrides[n.id]; return ovType ? { ...n, type: ovType } : n; })
          .filter(n => !deletedNodeIds.includes(n.id))
          .forEach(n => nodes.push(n));
      }

      prefixEdges(sec.edges, key)
        .filter(e => !deletedEdgeIds.includes(e.id))
        .forEach(e => {
          // 저장된 색상 오버라이드 적용 (없으면 원래 색 유지)
          const ov = edgeColorOverrides[e.id];
          if (ov) {
            edges.push({
              ...e,
              style: { ...e.style, stroke: ov },
              markerEnd: { ...e.markerEnd as object, color: ov } as EdgeMarker,
              data: { ...e.data, color: ov },
            });
          } else {
            edges.push(e);
          }
        });
    });

    edges.push(...buildCrossEdges(showCrossEdges).filter(e => {
      if (deletedEdgeIds.includes(e.id)) return false;
      return true;
    }).map(e => {
      const ov = edgeColorOverrides[e.id];
      if (!ov) return e;
      return {
        ...e,
        style: { ...e.style, stroke: ov },
        markerEnd: { ...e.markerEnd as object, color: ov } as EdgeMarker,
        data: { ...e.data, color: ov },
      };
    }));

    // Add user-created edges
    userEdges.filter(ue => !deletedEdgeIds.includes(ue.id)).forEach(ue => {
      // 저장된 색상 오버라이드 우선, 없으면 userEdge.color
      const color = edgeColorOverrides[ue.id] ?? ue.color ?? '#94a3b8';
      edges.push({
        id: ue.id,
        source: ue.source,
        target: ue.target,
        sourceHandle: ue.sourceHandle ?? null,
        targetHandle: ue.targetHandle ?? null,
        type: 'stream',
        data: { streamId: ue.streamId ?? '', color, fluidType: edgeFluidMap[ue.id] ?? ue.fluidType ?? '' },
        style: { stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color } as EdgeMarker,
        animated: false,
      });
    });

    // ── Edge deduplication + orphan filtering ─────────────────
    // Build a set of valid node IDs so we can filter out edges whose
    // source or target no longer exists (orphan/phantom pipes).
    const nodeIdSet = new Set(nodes.map(n => n.id));
    const seenEdgeIds = new Set<string>();
    const validEdges = edges.filter(e => {
      if (seenEdgeIds.has(e.id)) return false;          // deduplicate by ID
      seenEdgeIds.add(e.id);
      // Only keep edge if BOTH endpoints exist in the current node set
      return nodeIdSet.has(e.source) && nodeIdSet.has(e.target);
    });

    return { allNodes: nodes, allEdges: validEdges };
  }, [sec100, sec200, sec300, sec400, sec600, nodePositions, showCrossEdges, userNodes,
      deletedNodeIds, deletedEdgeIds, userEdges, nodeTagOverrides, nodeTypeOverrides,
      edgeColorOverrides, edgeFluidMap]);

  // ── Single source of truth: rfNodes ────────────────────────────────────────
  // IMPORTANT: zustand persist hydration may be async. We wait for the store
  // to finish loading from localStorage before initializing rfNodes/rfEdges.
  // Without this, nodePositions is {} on first render → positions lost.
  const [hydrated,  setHydrated]  = useState(false);
  const [rfNodes,   setRfNodes]   = useState<Node[]>([]);
  const [rfEdges,   setRfEdges]   = useState<Edge[]>([]);

  // ── Undo / Redo history ────────────────────────────────────
  const MAX_HISTORY = 60;
  type Snapshot = { nodes: Node[]; edges: Edge[] };
  const historyRef   = useRef<Snapshot[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  // ── ReactFlow requires parent nodes to appear BEFORE their children ──────
  // Without this, undo/redo that restores a snapshot can trigger the
  // "Parent node X not found" error even though the group node IS present.
  const sortNodesForReactFlow = useCallback((nodes: Node[]): Node[] => {
    const parents = nodes.filter(n => !n.parentId);
    const children = nodes.filter(n => !!n.parentId);
    return [...parents, ...children];
  }, []);

  // pushHistory: snapshot current state, deferred via setTimeout so setHistIdx
  // never fires synchronously inside another setState call (React violation).
  const pushHistory = useCallback((nodes: Node[], edges: Edge[]) => {
    const sorted = sortNodesForReactFlow(nodes);
    const snap: Snapshot = {
      nodes: sorted.map(n => ({ ...n, position: { ...n.position } })),
      edges: edges.map(e => ({ ...e })),
    };
    setTimeout(() => {
      setHistIdx(prev => {
        const trimmed = historyRef.current.slice(0, prev + 1);
        trimmed.push(snap);
        if (trimmed.length > MAX_HISTORY) trimmed.shift();
        historyRef.current = trimmed;
        return trimmed.length - 1;
      });
    }, 0);
  }, [sortNodesForReactFlow]);

  // undo/redo: called only from user events (button click / Ctrl+Z).
  // We read histIdx directly from closure (NOT inside an updater) so we can
  // also call setRfNodes/setRfEdges without nesting setState.
  const undo = useCallback(() => {
    const next = histIdx - 1;
    if (next < 0 || !historyRef.current[next]) return;
    const { nodes, edges } = historyRef.current[next];
    setRfNodes(sortNodesForReactFlow(nodes.map(n => ({ ...n, position: { ...n.position } }))));
    setRfEdges(edges.map(e => ({ ...e })));
    setHistIdx(next);
  }, [histIdx, sortNodesForReactFlow]);

  const redo = useCallback(() => {
    const next = histIdx + 1;
    if (next >= historyRef.current.length || !historyRef.current[next]) return;
    const { nodes, edges } = historyRef.current[next];
    setRfNodes(sortNodesForReactFlow(nodes.map(n => ({ ...n, position: { ...n.position } }))));
    setRfEdges(edges.map(e => ({ ...e })));
    setHistIdx(next);
  }, [histIdx, sortNodesForReactFlow]);

  const canUndo = histIdx > 0;
  const canRedo = histIdx < historyRef.current.length - 1;

  // Always-current refs to allNodes/allEdges so the hydration callback
  // (which is a one-time closure) can read the LATEST values even when
  // zustand persist hydrates asynchronously after first render.
  const allNodesRef = useRef(allNodes);
  const allEdgesRef = useRef(allEdges);
  allNodesRef.current = allNodes;
  allEdgesRef.current = allEdges;

  // Wait for zustand persist hydration, then initialize canvas
  useEffect(() => {
    const init = () => {
      // Use refs to get CURRENT allNodes/allEdges (not stale closure values).
      // This is critical when hydration is async: by the time onHydrationFinished
      // fires, allNodesRef.current already has the saved nodePositions.
      const nodes = allNodesRef.current;
      const edges = allEdgesRef.current;

    // ── Migration: remove any _group IDs from deletedNodeIds.
      // Old data may have accidentally added section groups to deletedNodeIds,
      // causing their children to render with an orphaned parentId.
      const staleGroupIds = usePFDStore.getState().deletedNodeIds.filter(id => id.endsWith('_group'));
      if (staleGroupIds.length > 0) {
        usePFDStore.setState(s => ({
          deletedNodeIds: s.deletedNodeIds.filter(id => !id.endsWith('_group')),
        }));
      }

      // ── Migration: clean up "reconnected" duplicate edges from the old buggy
      // onEdgeUpdate that created `user_edge_XXX_reconnected_YYY` entries.
      // Keep only the LATEST reconnected edge per original base ID.
      const storeEdges = usePFDStore.getState().userEdges;
      const reconnected = storeEdges.filter(e => e.id.includes('_reconnected_'));
      if (reconnected.length > 0) {
        // Group by base ID (everything before _reconnected_)
        const byBase: Record<string, typeof reconnected> = {};
        reconnected.forEach(e => {
          const base = e.id.split('_reconnected_')[0];
          byBase[base] = byBase[base] ? [...byBase[base], e] : [e];
        });
        // Keep only the latest (highest timestamp) per base; discard the rest
        const toRemove = new Set<string>();
        Object.values(byBase).forEach(group => {
          group.sort((a, b) => {
            const tA = parseInt(a.id.split('_reconnected_')[1] ?? '0');
            const tB = parseInt(b.id.split('_reconnected_')[1] ?? '0');
            return tB - tA; // newest first
          });
          group.slice(1).forEach(e => toRemove.add(e.id)); // drop all but newest
        });
        if (toRemove.size > 0) {
          usePFDStore.setState(s => ({
            userEdges: s.userEdges.filter(e => !toRemove.has(e.id)),
          }));
        }
      }

      const spread = spreadEdgeHandles(edges);
      const sorted = sortNodesForReactFlow(nodes);
      setRfNodes(sorted);
      setRfEdges(spread);
      // Push initial snapshot so user can't undo past the start
      historyRef.current = [{ nodes: sorted.map(n => ({ ...n })), edges: spread.map(e => ({ ...e })) }];
      setHistIdx(0);
      setHydrated(true);
    };
    if (usePFDStore.persist?.hasHydrated()) {
      init();
    } else {
      // Async hydration path: defer init until after React re-renders with
      // the hydrated store state (allNodesRef.current will then be up-to-date).
      const unsub = usePFDStore.persist?.onFinishHydration(() => setTimeout(init, 0));
      return () => unsub?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Safety net: after hydration, verify rfNodes positions match saved nodePositions.
  // This catches any remaining timing issues where init ran with stale positions.
  const positionCheckDone = useRef(false);
  useEffect(() => {
    if (!hydrated || positionCheckDone.current) return;
    positionCheckDone.current = true;
    const np = usePFDStore.getState().nodePositions;
    if (Object.keys(np).length === 0) return; // nothing saved yet
    setRfNodes(nds => {
      let changed = false;
      const corrected = nds.map(n => {
        const saved = np[n.id];
        if (!saved) return n;
        if (saved.x === n.position.x && saved.y === n.position.y) return n;
        changed = true;
        return { ...n, position: { x: saved.x, y: saved.y } };
      });
      return changed ? corrected : nds;
    });
  }, [hydrated]);

  // balanceKey changes only when stream calculation results change
  const balanceKey = useMemo(
    () => balance.streams.slice(0, 5).map(s => `${s.id}:${Math.round(s.total_kgh)}`).join('|'),
    [balance.streams]
  );
  const prevBalanceKeyRef = useRef(balanceKey);
  useEffect(() => {
    if (prevBalanceKeyRef.current !== balanceKey) {
      prevBalanceKeyRef.current = balanceKey;
      // Rebuild from allNodes which already incorporates store state
      setRfNodes(allNodes);
      setRfEdges(allEdges);
    }
  // allNodes/allEdges are memoized from balance data — safe here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKey]);

  // Sync rfNodes whenever userNodes changes (new equipment added or removed).
  // Initialize prevUserNodesLenRef to ACTUAL length so we don't spuriously
  // rebuild rfNodes on mount (which would overwrite positions set by init).
  const prevUserNodesLenRef = useRef((userNodes ?? []).length);
  useEffect(() => {
    if (!hydrated) return;
    const cur = userNodes?.length ?? 0;
    const prev = prevUserNodesLenRef.current;
    prevUserNodesLenRef.current = cur;
    if (cur !== prev) {
      // allNodes already has the new node with correct parentId + sorted order
      setRfNodes(sortNodesForReactFlow(allNodes));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNodes]);

  // When editMode changes, touch sectionGroup nodes so they re-render
  // and pick up the new editModeRef.current value.
  useEffect(() => {
    setRfNodes(nds => nds.map(n => n.type === 'sectionGroup' ? { ...n } : n));
  }, [editMode]);


  // Track edges changes (drag to reconnect, delete)
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges(eds => applyEdgeChanges(changes, eds));
    if (!editMode) return;
    changes.forEach(ch => {
      if (ch.type === 'remove') markEdgeDeleted(ch.id);
    });
  }, [editMode, markEdgeDeleted]);

  // New connection drawn by user
  const onConnect = useCallback((connection: Connection) => {
    if (!editMode || !connection.source || !connection.target) return;
    const id = `user_edge_${Date.now()}`;
    const newEdge: Edge = {
      id,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      type: 'stream',
      data: { streamId: '', color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } as EdgeMarker,
    };
    // Compute next edges synchronously, set state, then push history separately
    const nextEdges = addEdge(newEdge, rfEdges);
    setRfEdges(nextEdges);
    addUserEdge({
      id,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,  // ← save handle
      targetHandle: connection.targetHandle ?? null,  // ← save handle
      color: '#94a3b8',
    });
    pushHistory(rfNodes, nextEdges);
  }, [editMode, addUserEdge, pushHistory, rfNodes, rfEdges]);

  // Edge update (drag endpoint to reconnect)
  const onEdgeUpdate = useCallback((oldEdge: Edge, newConnection: Connection) => {
    if (!editMode || !newConnection.source || !newConnection.target) return;

    // Update rfEdges immediately (visual)
    const nextEdges = rfEdges.map(e =>
      e.id === oldEdge.id
        ? {
            ...e,
            source: newConnection.source!,
            target: newConnection.target!,
            sourceHandle: newConnection.sourceHandle ?? null,
            targetHandle: newConnection.targetHandle ?? null,
          }
        : e
    );
    setRfEdges(nextEdges);
    pushHistory(rfNodes, nextEdges);

    // Persist: if it's a user edge, UPDATE it in place (don't create new + delete old).
    // If it's a static/built-in edge, we have to create a user edge copy and delete the original.
    if (oldEdge.id.startsWith('user_')) {
      // Update existing user edge source/target AND handles in store
      usePFDStore.setState(s => ({
        userEdges: s.userEdges.map(ue =>
          ue.id === oldEdge.id
            ? {
                ...ue,
                source: newConnection.source!,
                target: newConnection.target!,
                sourceHandle: newConnection.sourceHandle ?? null,
                targetHandle: newConnection.targetHandle ?? null,
              }
            : ue
        ),
      }));
    } else {
      // Static edge — create a user-edge copy with the new endpoints, mark original deleted
      const newId = `user_edge_${Date.now()}`;
      addUserEdge({
        id: newId,
        source: newConnection.source!,
        target: newConnection.target!,
        sourceHandle: newConnection.sourceHandle ?? null,  // ← save handle
        targetHandle: newConnection.targetHandle ?? null,  // ← save handle
        streamId: (edgeStreamMap[oldEdge.id] ?? oldEdge.data?.streamId) || '',
        color: (oldEdge.style?.stroke as string) || '#94a3b8',
      });
      markEdgeDeleted(oldEdge.id);
      // Also update rfEdges to use the new ID so future updates work
      setRfEdges(eds => eds.map(e =>
        e.id === oldEdge.id ? { ...e, id: newId } : e
      ));
    }
  }, [editMode, addUserEdge, markEdgeDeleted, edgeStreamMap, pushHistory, rfNodes, rfEdges]);

  // Delete selected nodes/edges via Delete key
  const onNodesDelete = useCallback((deleted: Node[]) => {
    // NEVER delete section group nodes — they cannot be orphaned from their children
    const toDelete = deleted.filter(n => !n.id.endsWith('_group'));
    toDelete.forEach(n => {
      if (n.id.startsWith('user_')) removeUserNode(n.id);
      else markNodeDeleted(n.id);
    });
    // Compute next state directly; don't call setState-inside-setState
    const deletedIds = new Set(toDelete.map(n => n.id));
    const nextNodes = rfNodes.filter(n => !deletedIds.has(n.id));
    pushHistory(nextNodes, rfEdges);
  }, [removeUserNode, markNodeDeleted, pushHistory, rfEdges, rfNodes]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    deleted.forEach(e => {
      if (e.id.startsWith('user_')) removeUserEdge(e.id);
      else markEdgeDeleted(e.id);
    });
    const deletedIds = new Set(deleted.map(e => e.id));
    const nextEdges = rfEdges.filter(e => !deletedIds.has(e.id));
    pushHistory(rfNodes, nextEdges);
  }, [removeUserEdge, markEdgeDeleted, pushHistory, rfNodes, rfEdges]);

  // Panel delete handlers — update BOTH store (persist) AND rfNodes/rfEdges (visual)
  const handleDeleteNode = useCallback((id: string) => {
    if (id.startsWith('user_')) removeUserNode(id);
    else markNodeDeleted(id);
    setRfNodes(nds => nds.filter(n => n.id !== id));
    setSelectedNodes([]);
  }, [removeUserNode, markNodeDeleted]);

  const handleDeleteEdge = useCallback((id: string) => {
    if (id.startsWith('user_')) removeUserEdge(id);
    else markEdgeDeleted(id);
    setRfEdges(eds => eds.filter(e => e.id !== id));
    setSelectedEdges([]);
  }, [removeUserEdge, markEdgeDeleted]);

  // Tag/name update — store (persist) + rfNodes.data (immediate visual)
  const handleNodeUpdate = useCallback((id: string, data: { tag: string; name: string }) => {
    setRfNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, tag: data.tag, name: data.name } } : n
    ));
  }, []);

  // Node shape/type update — immediate visual update on rfNodes & selectedNodes
  const handleNodeTypeUpdate = useCallback((id: string, newType: string) => {
    setRfNodes(nds => nds.map(n =>
      n.id === id ? { ...n, type: newType } : n
    ));
    setSelectedNodes(nds => nds.map(n =>
      n.id === id ? { ...n, type: newType } : n
    ));
  }, []);

  // 믹서(배수) 노드의 ×N 값 즉시 반영 — 저장은 SelectionPanel 이 updateUserNodeMultiplier 로 처리.
  const handleNodeMultiplierUpdate = useCallback((id: string, multiplier: number) => {
    setRfNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, multiplier } } : n
    ));
  }, []);

  // Edge stream/color update — immediately update rfEdges + persist color for user edges
  const handleEdgeUpdate = useCallback((id: string, streamId: string, manualColor?: string) => {
    let autoColor: string | undefined;

    if (manualColor) {
      // User explicitly picked a color — use it directly, skip auto-color
      autoColor = manualColor;
    } else if (streamId) {
      // Derive auto-color from stream section / components
      const matched = streams.find(s => s.id === streamId);
      if (matched) {
        const sec = matched.section;
        if (sec === '100') autoColor = C.brine;
        else if (sec === '200') {
          const hasNaOH = (matched.components?.NaOH ?? 0) > 0;
          const hasCl2  = (matched.components?.Cl2  ?? 0) > 0;
          const hasH2   = (matched.components?.H2   ?? 0) > 0;
          if (hasCl2)       autoColor = C.cl2;
          else if (hasH2)   autoColor = C.h2;
          else if (hasNaOH) autoColor = C.naoh;
          else              autoColor = C.brine;
        } else if (sec === '300') autoColor = C.naoh;
        else if (sec === '400') autoColor = C.cl2;
        else if (sec === '600') autoColor = C.h2;
      }
    }

    setRfEdges(eds => eds.map(e => {
      if (e.id !== id) return e;
      const color = autoColor ?? (e.style?.stroke as string) ?? '#94a3b8';
      return {
        ...e,
        data: { ...e.data, streamId, color },
        style: { ...e.style, stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color } as EdgeMarker,
      };
    }));

    // Persist color for user-created edges so it survives reload
    if (id.startsWith('user_') && (manualColor || autoColor)) {
      usePFDStore.getState().updateUserEdgeColor(id, manualColor ?? autoColor!);
    }
  }, [streams]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Block position changes in view mode so nodes can't be dragged
    const filtered = editMode
      ? changes
      : changes.filter(ch => ch.type !== 'position');

    // Apply node changes (pure – no side effects inside updater)
    setRfNodes(nds => applyNodeChanges(filtered, nds));

    // Side effects outside the updater (no nested setState)
    if (editMode) {
      changes.forEach(ch => {
        if (ch.type === 'position' && ch.dragging === false && ch.position) {
          saveNodePosition(ch.id, ch.position);
        }
        if (ch.type === 'dimensions' && ch.dimensions && ch.id.endsWith('_group')) {
          saveNodePosition(`${ch.id}_w`, { x: ch.dimensions.width, y: 0 });
          saveNodePosition(`${ch.id}_h`, { x: 0, y: ch.dimensions.height });
        }
      });
      // Push history snapshot after drag ends (reads current rfNodes via ref)
      const hasDragEnd = changes.some(ch => ch.type === 'position' && ch.dragging === false);
      if (hasDragEnd) pushHistory(rfNodes, rfEdges);
    }
  }, [saveNodePosition, editMode, pushHistory, rfNodes, rfEdges]);

  // Reliable position save on drag end — direct event, no timing ambiguity.
  // ReactFlow guarantees node.position is the final relative position here.
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!editMode) return;
    saveNodePosition(node.id, node.position);
  }, [editMode, saveNodePosition]);

  const legend = [
    { color: C.brine, label: 'Brine/NaCl' },
    { color: C.cl2,   label: 'Cl2' },
    { color: C.naoh,  label: 'NaOH' },
    { color: C.h2,    label: 'H2' },
    { color: C.h2so4, label: 'H2SO4' },
    { color: C.cw,    label: 'CW' },
    { color: C.waste, label: 'Waste' },
    { color: C.stm,   label: 'Steam' },
  ];

  // 실시간 미표기 스트림 건수 계산
  const missingStreamCount = useMemo(() => {
    const edgeSet = new Set<string>();
    for (const ed of rfEdges) {
      const sid = (edgeStreamMap[ed.id] ?? ed.data?.streamId ?? '').trim();
      if (sid) edgeSet.add(sid);
    }
    if (rfEdges.some(ed => ed.id === 'cross-250-100')) edgeSet.add('250');
    if (rfEdges.some(ed => ed.id === 'cross-217-L1')) { edgeSet.add('217'); edgeSet.add('L1'); }
    if (rfEdges.some(ed => ed.id === 'cross-220-400')) edgeSet.add('220');
    if (rfEdges.some(ed => ed.id === 'cross-221-600')) edgeSet.add('221');
    for (const nd of rfNodes) {
      if (nd.type === 'streamLabel' && nd.data?.streamId) {
        edgeSet.add(String(nd.data.streamId).trim());
      }
    }
    return streams.filter(s => !edgeSet.has(s.id)).length;
  }, [rfEdges, rfNodes, edgeStreamMap, streams]);

  // 계산 연동 장치 vs 단순 도면 장치 시각 구분 적용
  const displayRfNodes = useMemo(() => {
    const sorted = sortNodesForReactFlow(rfNodes);
    if (!highlightCalcUnits) return sorted;
    const calcTypes = new Set(['electrolyzer', 'separator', 'heatExchanger', 'towerPacking', 'tower', 'evaporator', 'compressor', 'agitatedDrum']);
    const skipTypes = new Set(['sectionGroup', 'streamLabel', 'sectionLabel']);
    return sorted.map(nd => {
      const t = nd.type ?? '';
      if (skipTypes.has(t)) return nd;
      const isCalc = calcTypes.has(t);
      return {
        ...nd,
        style: {
          ...(nd.style ?? {}),
          outline: isCalc ? '2px solid rgba(15, 118, 110, 0.72)' : '1.4px dashed rgba(100, 116, 139, 0.55)',
          outlineOffset: 3,
          borderRadius: 7,
          background: isCalc ? 'rgba(236, 253, 245, 0.52)' : 'transparent',
        },
      };
    });
  }, [rfNodes, highlightCalcUnits]);

  // 편집 모드 드래그 앤 드랍으로 즉시 장치 배치
  const handleCanvasDragOver = useCallback((ev: React.DragEvent) => {
    if (!editMode) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }, [editMode]);

  const handleCanvasDrop = useCallback((ev: React.DragEvent) => {
    if (!editMode || !rfInstance || !canvasWrapRef.current) return;
    const raw = ev.dataTransfer.getData('application/pfd-equip');
    if (!raw) return;
    ev.preventDefault();
    try {
      const item = JSON.parse(raw) as { type: string; label: string; tagPrefix: string; isCalc: boolean };
      const bounds = canvasWrapRef.current.getBoundingClientRect();
      const gPos = rfInstance.project({
        x: ev.clientX - bounds.left - 24,
        y: ev.clientY - bounds.top - 24,
      });
      // 드랍된 X 좌표 기준으로 해당 섹션 자동 판별
      const secOrigins: Array<{ sec: string; x: number; y: number }> = [
        { sec: '100', x: 0,    y: 0 },
        { sec: '200', x: 1860, y: 0 },
        { sec: '300', x: 3090, y: 0 },
        { sec: '400', x: 4270, y: 0 },
        { sec: '600', x: 5950, y: 0 },
      ];
      let chosen = secOrigins[0];
      if (gPos.x >= 5880) chosen = secOrigins[4];
      else if (gPos.x >= 4220) chosen = secOrigins[3];
      else if (gPos.x >= 3060) chosen = secOrigins[2];
      else if (gPos.x >= 1810) chosen = secOrigins[1];

      const localX = Math.max(20, Math.round(gPos.x - chosen.x));
      const localY = Math.max(35, Math.round(gPos.y - chosen.y));
      const seq = userNodes.length + 1;
      addUserNode({
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tag: `${item.tagPrefix}-${chosen.sec[0]}${String(seq).padStart(2, '0')}`,
        name: item.label,
        type: item.type,
        section: chosen.sec,
        color: item.isCalc ? '#0F766E' : '#475569',
        position: { x: localX, y: localY },
        ...(item.type === 'mixer' ? { multiplier: 5 } : {}),
      });
    } catch {
      // ignore invalid drag data
    }
  }, [editMode, rfInstance, userNodes.length, addUserNode]);

  return (
    <div
      ref={canvasWrapRef}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-base)' }}
    >
      {/* Hydration loading overlay — ReactFlow은 hydration 완료 후에만 mount */}
      {!hydrated ? (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-base)', gap: 12,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#00d4ff',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>저장된 배치 불러오는 중...</span>
        </div>
      ) : (
      <>
      <ReactFlow
        nodes={displayRfNodes}
        edges={rfEdges}
        onInit={setRfInstance}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeUpdate={editMode ? onEdgeUpdate : undefined}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={({ nodes: sn, edges: se }) => {
          setSelectedNodes(sn); setSelectedEdges(se);
        }}
        nodesDraggable={editMode}
        nodesConnectable={editMode}
        connectionMode={ConnectionMode.Loose}
        elementsSelectable={true}
        edgesUpdatable={editMode}
        deleteKeyCode={editMode ? ['Backspace', 'Delete'] : []}
        minZoom={0.03}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ width: '100%', height: '100%' }}
        elevateNodesOnSelect={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(255,255,255,0.05)" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="top-right"
          style={{ width: 200, height: 120, background: 'var(--bg-elevated)' }}
          nodeColor={(n) => {
            if (n.type === 'sectionGroup') return 'transparent';
            if (n.type === 'electrolyzer') return 'rgba(0,212,255,0.8)';
            if (n.type === 'streamLabel') return 'rgba(255,255,255,0.12)';
            return 'rgba(100,140,200,0.45)';
          }}
          maskColor="rgba(10,14,26,0.7)"
        />
        <SectionFocuser section={section} />
      </ReactFlow>

      <PFDToolbar
        onOpenIconManager={() => setIconManagerOpen(true)}
        onOpenAddPanel={() => setAddPanelOpen(true)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        missingStreamCount={missingStreamCount}
        totalStreamCount={streams.length}
        onOpenStreamCoverage={() => setCoverageOpen(v => !v)}
        highlightCalcUnits={highlightCalcUnits}
        onToggleHighlightCalc={() => setHighlightCalcUnits(v => !v)}
      />
      {coverageOpen && (
        <StreamCoverageDrawer
          allEdges={rfEdges}
          allNodes={rfNodes}
          onClose={() => setCoverageOpen(false)}
        />
      )}
      {iconManagerOpen && <IconManager onClose={() => setIconManagerOpen(false)} />}
      {addPanelOpen && (
        <AddEquipmentPanel
          onClose={() => setAddPanelOpen(false)}
          onNodeAdded={() => {
            // Nothing to do here — userNodes store was already updated by AddEquipmentPanel.
            // The useEffect above (prevUserNodesLenRef) detects the change and
            // rebuilds rfNodes from allNodes, which correctly assigns parentId.
          }}
        />
      )}

      {/* Properties panel for selected elements */}
      {editMode && (
        <SelectionPanel
          selectedNodes={selectedNodes}
          selectedEdges={selectedEdges}
          allNodes={rfNodes}
          onDeleteNode={handleDeleteNode}
          onDeleteEdge={handleDeleteEdge}
          onNodeUpdate={handleNodeUpdate}
          onNodeTypeUpdate={handleNodeTypeUpdate}
          onNodeMultiplierUpdate={handleNodeMultiplierUpdate}
          onEdgeUpdate={handleEdgeUpdate}
        />
      )}
      {!editMode && (selectedNodes.length > 0 || selectedEdges.length > 0) && (
        <EquipmentInspectorDrawer
          selectedNodes={selectedNodes}
          selectedEdges={selectedEdges}
          allNodes={rfNodes}
          allEdges={rfEdges}
          onClose={() => {
            setSelectedNodes([]);
            setSelectedEdges([]);
            setRfNodes(nds => nds.map(n => (n.selected ? { ...n, selected: false } : n)));
            setRfEdges(eds => eds.map(e => (e.selected ? { ...e, selected: false } : e)));
          }}
        />
      )}
      {/* Fluid legend */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(10,14,26,0.88)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8, padding: '5px 12px',
        display: 'flex', gap: 12, alignItems: 'center',
        backdropFilter: 'blur(10px)', flexWrap: 'wrap', zIndex: 10,
      }}>
        {legend.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 20, height: 3, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
        {showCrossEdges && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ width: 20, height: 2, borderRadius: 2,
              backgroundImage: 'repeating-linear-gradient(90deg, #94a3b8 0, #94a3b8 5px, transparent 5px, transparent 9px)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Cross-section</span>
          </div>
        )}
      </div>
      </>
      )} {/* end hydration ternary */}
    </div>
  );
}
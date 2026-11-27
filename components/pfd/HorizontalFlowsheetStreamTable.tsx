'use client';

import React, { useRef, useState } from 'react';
import {
  SIM_COMPS,
  COMP_META,
  COMP_LABEL_EN as SOLVER_COMP_LABEL_EN,
  SolvedStream,
  type SimCompKey,
} from '@/lib/calculations/flowsheetSolver';
import { UnitSelect, useLocalUnit } from '@/components/units/UnitControls';
import { formatCanonicalValue, fromCanonical, getUnitLabel } from '@/lib/units/unitSystem';
import { useUnitStore } from '@/lib/stores/unitStore';
import { t } from '@/lib/i18n/uiText';

interface HorizontalFlowsheetStreamTableProps {
  streams: SolvedStream[];
  selectedEdgeId: string | null;
  onSelectStream: (edgeId: string) => void;
  onDeleteStream: (edgeId: string) => void;
  configuredComps?: SimCompKey[];
}

const LABEL_W = 186;
const UNIT_W = 92;
const COL_W = 98;

const COMP_LABEL_EN: Record<SimCompKey, string> = {
  H2O: 'H₂O (Water / Steam)',
  NaCl: 'NaCl (Sodium Chloride)',
  NaOH: 'NaOH (Caustic Soda)',
  Cl2: 'Cl₂ (Chlorine)',
  H2: 'H₂ (Hydrogen)',
  HCl: 'HCl (Hydrogen Chloride)',
  H2SO4: 'H₂SO₄ (Sulfuric Acid)',
  O2: 'O₂ (Oxygen)',
  NaOCl: 'NaOCl (Sodium Hypochlorite)',
  N2: 'N₂ (Nitrogen / Inert)',
  NaClO3: 'NaClO₃ (Sodium Chlorate)',
  FeCl2: 'FeCl₂ (Ferrous Chloride)',
  FeCl3: 'FeCl₃ (Ferric Chloride)',
  PAC: 'PAC (Polyaluminum Chloride)',
  Glycerol: 'Glycerol',
  MCH: 'MCH (Monochlorohydrin)',
  DCH: 'DCH (Dichlorohydrin)',
  ECH: 'ECH (Epichlorohydrin)',
  DCP: 'DCP (1,2-Dichloropropane)',
  CH4: 'CH₄ (Methane / Natural Gas)',
  CO: 'CO (Carbon Monoxide)',
  CO2: 'CO₂ (Carbon Dioxide)',
  NH3: 'NH₃ (Ammonia)',
  C2H4: 'C₂H₄ (Ethylene)',
  C2H6: 'C₂H₆ (Ethane)',
  C3H6: 'C₃H₆ (Propylene)',
  C3H8: 'C₃H₈ (Propane)',
  nC4H10: 'n-C₄H₁₀ (n-Butane)',
  nC6H14: 'n-C₆H₁₄ (n-Hexane)',
  nC7H16: 'n-C₇H₁₆ (n-Heptane)',
  Benzene: 'Benzene (C₆H₆)',
  Toluene: 'Toluene (C₇H₈)',
  pXylene: 'p-Xylene',
  MeOH: 'MeOH (Methanol)',
  EtOH: 'EtOH (Ethanol)',
  IPA: 'IPA (Isopropanol)',
  Acetone: 'Acetone',
  AceticAcid: 'Acetic Acid (CH₃COOH)',
  EtOAc: 'EtOAc (Ethyl Acetate)',
  CHCl3: 'CHCl₃ (Chloroform / CFM)',
  Ar: 'Ar (Argon)',
  H2S: 'H₂S (Hydrogen Sulfide)',
  SO2: 'SO₂ (Sulfur Dioxide)',
  SO3: 'SO₃ (Sulfur Trioxide)',
  iC4H10: 'i-C₄H₁₀ (Isobutane)',
  C4H8_1: '1-C₄H₈ (1-Butene)',
  nC5H12: 'n-C₅H₁₂ (n-Pentane)',
  nC8H18: 'n-C₈H₁₈ (n-Octane)',
  Cyclohexane: 'Cyclohexane (C₆H₁₂)',
  Ethylbenzene: 'Ethylbenzene',
  Styrene: 'Styrene Monomer',
  Cumene: 'Cumene',
  Phenol: 'Phenol',
  THF: 'THF (Tetrahydrofuran)',
  DMF: 'DMF (Dimethylformamide)',
  DMSO: 'DMSO (Dimethyl Sulfoxide)',
  MTBE: 'MTBE',
  MEK: 'MEK (Methyl Ethyl Ketone)',
  DMC: 'DMC (Dimethyl Carbonate)',
  EG: 'EG (Ethylene Glycol)',
  MEA: 'MEA (Monoethanolamine)',
  MDEA: 'MDEA (Methyldiethanolamine)',
  FormicAcid: 'Formic Acid (HCOOH)',
  HNO3: 'HNO₃ (Nitric Acid)',
  CH3Cl: 'CH₃Cl (Methyl Chloride / MC)',
  CH2Cl2: 'CH₂Cl₂ (Methylene Chloride / MCL)',
  CCl4: 'CCl₄ (Carbon Tetrachloride / CTC)',
  C2Cl4: 'C₂Cl₄ (Perchloroethylene / Heavies)',
  COCl2: 'COCl₂ (Phosgene)',
  HCHO: 'HCHO (Formaldehyde / Formalin)',
  MCB: 'MCB (Monochlorobenzene)',
  Aniline: 'Aniline',
  MDA: "MDA (4,4'-Methylenedianiline)",
  MDI: "MDI (4,4'-Pure MDI)",
  PMDI: 'PMDI (Polymeric MDI)',
  CUSTOM_1: 'CUSTOM_1 (User / UNIFAC Comp 1)',
  CUSTOM_2: 'CUSTOM_2 (User / UNIFAC Comp 2)',
  H2O2: 'H₂O₂ (Hydrogen Peroxide)',
  H3PO4: 'H₃PO₄ (Phosphoric Acid)',
  HF: 'HF (Hydrofluoric Acid)',
  KOH: 'KOH (Potassium Hydroxide)',
  NH4OH: 'NH₄OH (Ammonia Water)',
  TMAH: 'TMAH (Tetramethylammonium Hydroxide)',
  NMP: 'NMP (N-Methyl-2-pyrrolidone)',
  BCS: 'BCS (Butyl Cellosolve)',
  Na2CO3: 'Na₂CO₃ (Sodium Carbonate)',
  NaHSO3: 'NaHSO₃ (Sodium Bisulfite)',
  CaOH2: 'Ca(OH)₂ (Calcium Hydroxide)',
  HCPX: 'HCPX (Hexachloro-p-xylene)',
  TPA: 'TPA (Terephthalic Acid)',
  TPC: 'TPC (Terephthaloyl Chloride)',
  Si: 'Si (Metallurgical Silicon)',
  DCS: 'DCS (Dichlorosilane)',
  TCS: 'TCS (Trichlorosilane)',
  STC: 'STC (Silicon Tetrachloride)',
};

function localizeKeyConcLabel(label: string, isEn: boolean): string {
  if (!isEn) return label;
  if (label === '▶ RUN 대기') return '▶ Pending RUN';
  if (label === '기액혼합 Cl₂') return '2-Phase Cl₂';
  if (label === '수증기') return 'Steam / Vapor';
  if (label === '원염 NaCl') return 'Raw Salt NaCl';
  if (label === '순수/응축수') return 'Pure Water / Condensate';
  return label
    .replace(/^습윤 Cl₂/, 'Wet Cl₂')
    .replace(/^액화 Cl₂/, 'Liq Cl₂')
    .replace(/^액화 AHCl/, 'Liq AHCl')
    .replace(/글리세린/g, 'Glycerol');
}

function localizePortRole(role: string, isEn: boolean): string {
  if (!isEn) return role;
  const map: Record<string, string> = {
    '주배관': 'Main',
    '상부 기상(G↑)': 'Overhead (G↑)',
    '상부 기상 (G↑)': 'Overhead (G↑)',
    '하부 액상(L↓)': 'Bottoms (L↓)',
    '하부 액상 (L↓)': 'Bottoms (L↓)',
    '측류(S→)': 'Side-Cut (S→)',
    '사이드컷 측류(Side-Cut S)': 'Side-Cut (S)',
    '디캔터 수층(Decanter)': 'Decanter Aqueous',
    '양극 출구(Anode)': 'Anode Outlet',
    '음극 출구(Cathode)': 'Cathode Outlet',
    '냉매/열매 유입': 'Utility In',
    '냉매/열매 출구': 'Utility Out',
  };
  return map[role] ?? role;
}

export default function HorizontalFlowsheetStreamTable({
  streams,
  selectedEdgeId,
  onSelectStream,
  onDeleteStream,
  configuredComps,
}: HorizontalFlowsheetStreamTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [compViewMode, setCompViewMode] = useState<'active' | 'configured' | 'all'>('active');
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';

  const [tempUnit, setTempUnit] = useLocalUnit('temp');
  const [pressUnit, setPressUnit] = useLocalUnit('pressG');
  const [molarUnit, setMolarUnit] = useLocalUnit('molarFlow');
  const [volUnit, setVolUnit] = useLocalUnit('volFlow');
  const [densUnit, setDensUnit] = useLocalUnit('density');
  const [cpUnit, setCpUnit] = useLocalUnit('cp');
  const [dutyUnit, setDutyUnit] = useLocalUnit('heatDuty');
  const [massUnit, setMassUnit] = useLocalUnit('massFlow');

  const activeComps = SIM_COMPS.filter(ck =>
    streams.some(s => (s.flowsKgH[ck] || 0) > 0.00005)
  );
  const configSet = new Set<SimCompKey>(
    configuredComps && configuredComps.length > 0 ? configuredComps : SIM_COMPS.slice(0, 9)
  );
  activeComps.forEach(c => configSet.add(c));
  const mergedConfiguredComps = SIM_COMPS.filter(ck => configSet.has(ck));

  const visibleComps =
    compViewMode === 'all'
      ? SIM_COMPS
      : compViewMode === 'configured'
        ? mergedConfiguredComps
        : activeComps.length > 0
          ? activeComps
          : mergedConfiguredComps;

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select, input, option')) return;
    const el = scrollRef.current;
    if (!el) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !scrollRef.current) return;
    scrollRef.current.scrollLeft = dragStart.current.left - (e.clientX - dragStart.current.x);
    scrollRef.current.scrollTop = dragStart.current.top - (e.clientY - dragStart.current.y);
  };

  const stopDrag = () => setDragging(false);

  if (streams.length === 0) {
    return (
      <div style={{ padding: '24px 16px', fontSize: 12, color: '#64748B', textAlign: 'center' }}>
        {t(lang, 'st_empty')}
      </div>
    );
  }

  const stickyCornerLabel: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    top: 0,
    zIndex: 6,
    width: LABEL_W,
    minWidth: LABEL_W,
    maxWidth: LABEL_W,
    background: '#EFECE5',
    borderRight: '1px solid #DFDCD4',
    borderBottom: '1px solid #DFDCD4',
    padding: '5px 10px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 800,
    color: '#1A2F44',
  };

  const stickyCornerUnit: React.CSSProperties = {
    position: 'sticky',
    left: LABEL_W,
    top: 0,
    zIndex: 6,
    width: UNIT_W,
    minWidth: UNIT_W,
    maxWidth: UNIT_W,
    background: '#EFECE5',
    borderRight: '2px solid #C8C4BA',
    borderBottom: '1px solid #DFDCD4',
    padding: '5px 8px',
    textAlign: 'right',
    fontSize: 9.5,
    fontWeight: 700,
    color: '#64748B',
  };

  const stickyRowLabel = (bg: string, bold = false, indent = false): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 3,
    width: LABEL_W,
    minWidth: LABEL_W,
    maxWidth: LABEL_W,
    background: bg,
    borderRight: '1px solid #E5E2DC',
    borderBottom: '1px solid #EFECE5',
    padding: indent ? '4px 10px 4px 20px' : '4px 10px',
    fontSize: 10,
    fontWeight: bold ? 800 : 600,
    fontStyle: indent ? 'italic' : 'normal',
    color: bold ? '#1A2F44' : '#27272A',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  const stickyRowUnit = (bg: string): React.CSSProperties => ({
    position: 'sticky',
    left: LABEL_W,
    zIndex: 3,
    width: UNIT_W,
    minWidth: UNIT_W,
    maxWidth: UNIT_W,
    background: bg,
    borderRight: '2px solid #C8C4BA',
    borderBottom: '1px solid #EFECE5',
    padding: '4px 8px',
    textAlign: 'right',
    fontSize: 9,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#7A7872',
    whiteSpace: 'nowrap',
  });

  const cellValStyle = (s: SolvedStream, rowBg: string, align: 'right' | 'center' = 'right'): React.CSSProperties => {
    const sel = s.edgeId === selectedEdgeId;
    return {
      minWidth: COL_W,
      width: COL_W,
      padding: '4px 8px',
      textAlign: align,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      background: sel ? '#FEF3C7' : rowBg,
      borderRight: '1px solid #EFECE5',
      borderBottom: '1px solid #EFECE5',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
  };

  const renderPhaseBadge = (s: SolvedStream) => {
    const isLiqCl2 = s.phase === 'L' && s.totalMassKgH > 0 && s.flowsKgH.Cl2 / s.totalMassKgH > 0.5;
    const color = isLiqCl2
      ? '#0284C7'
      : s.phase === 'G'
        ? '#0F5338'
        : s.phase === 'L/G'
          ? '#7C2D12'
          : '#1A2F44';
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          padding: '1px 6px',
          borderRadius: 3,
          color,
          background: `${color}16`,
          border: `1px solid ${color}45`,
        }}
      >
        {isLiqCl2 ? 'L (Liq Cl₂)' : s.phase}
      </span>
    );
  };

  return (
    <div
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        background: '#FFFFFF',
      }}
    >
      <table
        style={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          width: 'max-content',
          minWidth: '100%',
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <thead>
          {/* 1단 헤더: 스트림 번호 (우측 가로 확장!) */}
          <tr>
            <th style={stickyCornerLabel}>{t(lang, 'st_col_item')}</th>
            <th style={stickyCornerUnit}>{t(lang, 'st_col_unit')}</th>
            {streams.map(s => {
              const sel = s.edgeId === selectedEdgeId;
              return (
                <th
                  key={s.edgeId}
                  onClick={() => onSelectStream(s.edgeId)}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 4,
                    minWidth: COL_W,
                    width: COL_W,
                    background: sel ? '#FDE68A' : s.isTearStream ? '#F5F3FF' : '#F6F7F2',
                    borderRight: '1px solid #DFDCD4',
                    borderBottom: '1px solid #DFDCD4',
                    padding: '5px 6px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 10.5,
                        fontWeight: 900,
                        color: s.isTearStream ? '#6D28D9' : '#0F5338',
                      }}
                    >
                      [{s.streamNo}]{s.isTearStream ? '♻' : ''}
                    </span>
                    <button
                      title={isEn ? `Delete stream [${s.streamNo}]` : `배관 [${s.streamNo}] 삭제`}
                      onClick={ev => {
                        ev.stopPropagation();
                        onDeleteStream(s.edgeId);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: 900,
                        cursor: 'pointer',
                        padding: '0 2px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: '#475569',
                      marginTop: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${s.fromTag} → ${s.toTag} (${localizePortRole(s.portRole, isEn)})`}
                  >
                    {s.fromTag}→{s.toTag}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {/* 01. 유체 식별 / 핵심 농도 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>{t(lang, 'st_row_fluid')}</td>
            <td style={stickyRowUnit('#FAF9F5')}>—</td>
            {streams.map(s => {
              const fluidLabel = localizeKeyConcLabel(s.keyConcLabel, isEn);
              return (
                <td
                  key={s.edgeId}
                  onClick={() => onSelectStream(s.edgeId)}
                  style={{
                    ...cellValStyle(s, '#FAF9F5', 'center'),
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: s.keyConcLabel.includes('액화 Cl₂') ? '#0284C7' : '#1A2F44',
                  }}
                  title={fluidLabel}
                >
                  {fluidLabel}
                </td>
              );
            })}
          </tr>

          {/* 02. 상 (Phase) */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>{t(lang, 'st_row_phase')}</td>
            <td style={stickyRowUnit('#FFFFFF')}>—</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={cellValStyle(s, '#FFFFFF', 'center')}>
                {renderPhaseBadge(s)}
              </td>
            ))}
          </tr>

          {/* 03. 기상 분율 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>{t(lang, 'st_row_vf')}</td>
            <td style={stickyRowUnit('#FAF9F5')}>wt frac</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#52525B' }}>
                {s.vaporFraction.toFixed(2)}
              </td>
            ))}
          </tr>

          {/* 04. 온도 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF', true)}>{t(lang, 'st_row_temp')}</td>
            <td style={{ ...stickyRowUnit('#FFFFFF'), padding: '2px 4px' }}>
              <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), fontWeight: 800, color: '#1A2F44' }}>
                {formatCanonicalValue('temp', s.tempC, tempUnit, 1)}
              </td>
            ))}
          </tr>

          {/* 05. 압력 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>{t(lang, 'st_row_press')}</td>
            <td style={{ ...stickyRowUnit('#FAF9F5'), padding: '2px 4px' }}>
              <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), fontWeight: 700, color: '#334155' }}>
                {formatCanonicalValue('pressG', s.pressKgcm2g, pressUnit)}
              </td>
            ))}
          </tr>

          {/* 06. 몰 유량 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>{t(lang, 'st_row_molar')}</td>
            <td style={{ ...stickyRowUnit('#FFFFFF'), padding: '2px 4px' }}>
              <UnitSelect quantity="molarFlow" value={molarUnit} onChange={setMolarUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#1A2F44' }}>
                {formatCanonicalValue('molarFlow', s.totalMolarKmolH, molarUnit, 1)}
              </td>
            ))}
          </tr>

          {/* 07. 부피 유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>{t(lang, 'st_row_vol')}</td>
            <td style={{ ...stickyRowUnit('#FAF9F5'), padding: '2px 4px' }}>
              <UnitSelect quantity="volFlow" value={volUnit} onChange={setVolUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#0F5338', fontWeight: 700 }}>
                {formatCanonicalValue('volFlow', s.volFlowM3H, volUnit, 1)}
              </td>
            ))}
          </tr>

          {/* 08. 평균 분자량 */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>{t(lang, 'st_row_mw')}</td>
            <td style={stickyRowUnit('#FFFFFF')}>g/mol</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#52525B' }}>
                {s.avgMW.toFixed(2)}
              </td>
            ))}
          </tr>

          {/* 09. 밀도 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>{t(lang, 'st_row_density')}</td>
            <td style={{ ...stickyRowUnit('#FAF9F5'), padding: '2px 4px' }}>
              <UnitSelect quantity="density" value={densUnit} onChange={setDensUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#334155' }}>
                {formatCanonicalValue('density', s.densityKgM3, densUnit, densUnit === 'gcm3' ? 4 : s.phase === 'G' ? 2 : 1)}
              </td>
            ))}
          </tr>

          {/* 10. 압축인자 Z / 비열 Cp */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>{t(lang, 'st_row_cp')}</td>
            <td style={{ ...stickyRowUnit('#FFFFFF'), padding: '2px 4px' }}>
              <UnitSelect quantity="cp" value={cpUnit} onChange={setCpUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#52525B' }}>
                {formatCanonicalValue('cp', s.cpKcalKgC, cpUnit, 3)}
                {s.compressibilityZ !== undefined ? ` (Z=${s.compressibilityZ.toFixed(2)})` : ''}
              </td>
            ))}
          </tr>

          {/* 11. 엔탈피 유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5')}>{t(lang, 'st_row_enthalpy')}</td>
            <td style={{ ...stickyRowUnit('#FAF9F5'), padding: '2px 4px' }}>
              <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), color: '#7C2D12', fontWeight: 700 }}>
                {formatCanonicalValue('heatDuty', s.enthalpyKcalH / 1000, dutyUnit)}
              </td>
            ))}
          </tr>

          {/* 12. 수분 농도 (가스/액화염소 스트림용) */}
          <tr>
            <td style={stickyRowLabel('#FFFFFF')}>{t(lang, 'st_row_moisture')}</td>
            <td style={stickyRowUnit('#FFFFFF')}>wt ppm</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FFFFFF'), color: '#0369A1' }}>
                {s.moistureWtPpm !== null ? s.moistureWtPpm.toLocaleString() : '—'}
              </td>
            ))}
          </tr>

          {/* 구분 배너: 성분별 질량유량 */}
          <tr>
            <td
              style={{
                position: 'sticky',
                left: 0,
                zIndex: 3,
                background: '#EFECE5',
                borderTop: '1.5px solid #C8C4BA',
                borderBottom: '1px solid #DFDCD4',
                padding: '4px 10px',
                fontSize: 9.5,
                fontWeight: 900,
                color: '#1A2F44',
                letterSpacing: '0.04em',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span>{t(lang, 'st_banner_comp_flows')}</span>
                <button
                  type="button"
                  onClick={() =>
                    setCompViewMode(m =>
                      m === 'active'
                        ? configuredComps && configuredComps.length > 0
                          ? 'configured'
                          : 'all'
                        : m === 'configured'
                          ? 'all'
                          : 'active'
                    )
                  }
                  style={{
                    border: '1px solid #C8C4BA',
                    background: compViewMode !== 'active' ? '#1A2F44' : '#FFFFFF',
                    color: compViewMode !== 'active' ? '#FFFFFF' : '#334155',
                    borderRadius: 4,
                    padding: '1px 5px',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                  title={t(lang, 'st_comp_toggle_title')}
                >
                  {compViewMode === 'all'
                    ? isEn
                      ? `All ${SIM_COMPS.length}`
                      : `전체 ${SIM_COMPS.length}종`
                    : compViewMode === 'configured'
                      ? isEn
                        ? `Configured ${mergedConfiguredComps.length}`
                        : `설정 ${mergedConfiguredComps.length}종`
                      : isEn
                        ? `Active ${visibleComps.length}`
                        : `활성 ${visibleComps.length}종`}
                </button>
              </div>
            </td>
            <td
              style={{
                position: 'sticky',
                left: LABEL_W,
                zIndex: 3,
                background: '#EFECE5',
                borderTop: '1.5px solid #C8C4BA',
                borderBottom: '1px solid #DFDCD4',
                borderRight: '2px solid #C8C4BA',
                padding: '2px 4px',
                fontSize: 9,
                fontWeight: 800,
                color: '#64748B',
                textAlign: 'right',
              }}
            >
              <UnitSelect quantity="massFlow" value={massUnit} onChange={setMassUnit} style={{ width: '100%' }} />
            </td>
            {streams.map(s => (
              <td
                key={s.edgeId}
                style={{
                  background: '#EFECE5',
                  borderTop: '1.5px solid #C8C4BA',
                  borderBottom: '1px solid #DFDCD4',
                  borderRight: '1px solid #E5E2DC',
                }}
              />
            ))}
          </tr>

          {/* 13. 총 질량유량 */}
          <tr>
            <td style={stickyRowLabel('#FAF9F5', true)}>{t(lang, 'st_row_total_mass')}</td>
            <td style={stickyRowUnit('#FAF9F5')}>{getUnitLabel('massFlow', massUnit)}</td>
            {streams.map(s => (
              <td key={s.edgeId} onClick={() => onSelectStream(s.edgeId)} style={{ ...cellValStyle(s, '#FAF9F5'), fontWeight: 900, color: '#18181B' }}>
                {formatCanonicalValue('massFlow', s.totalMassKgH, massUnit)}
              </td>
            ))}
          </tr>

          {/* 14+. 개별 성분 질량유량 */}
          {visibleComps.map((comp, idx) => {
            const bg = idx % 2 === 0 ? '#FFFFFF' : '#FAF9F5';
            const massLabel = getUnitLabel('massFlow', massUnit);
            const compLabel = isEn
              ? COMP_LABEL_EN[comp] ?? SOLVER_COMP_LABEL_EN[comp] ?? COMP_META[comp].formula
              : COMP_META[comp].label;
            return (
              <tr key={comp}>
                <td style={stickyRowLabel(bg, false, true)} title={compLabel}>
                  {compLabel}
                </td>
                <td style={stickyRowUnit(bg)}>{massLabel}</td>
                {streams.map(s => {
                  const rawKgH = s.flowsKgH[comp] || 0;
                  const val = fromCanonical('massFlow', rawKgH, massUnit);
                  return (
                    <td
                      key={s.edgeId}
                      onClick={() => onSelectStream(s.edgeId)}
                      style={{
                        ...cellValStyle(s, bg),
                        color: rawKgH >= 0.0001 ? '#1A2F44' : '#CBD5E1',
                        fontWeight: rawKgH >= 0.0001 ? 700 : 400,
                      }}
                    >
                      {rawKgH >= 0.0001
                        ? Math.abs(val) >= 1.0
                          ? val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })
                          : val.toFixed(4)
                        : '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import {
  PACKING_CATALOG,
  solveColumnInternalsDesign,
  type ColumnInternalsKind,
  type ColumnInternalsParams,
  type PackingKey,
  type ShellMaterialCode,
  type ShellSectionMode,
  type StageHydraulicStatus,
  type TrayDeckType,
} from '@/lib/calculations/columnInternalsDesign';
import { formatKrwReadable } from '@/lib/calculations/equipmentCostModel';
import type { WindExposure } from '@/lib/calculations/mechanicalDesign';
import type {
  DistillColumnParams,
  DistillFeedInput,
  DistillSolveResult,
} from '@/lib/calculations/rigorousDistillation';
import {
  autoFixColumnInternalsAsync,
  fetchOptionalGeminiAdvice,
} from '@/lib/calculations/aiEquipmentAdvisor';
import { downloadColumnCadDxf } from '@/lib/cad/columnDxfExport';
import { downloadColumnEpcDatasheet } from '@/lib/excel/datasheetExport';

interface ColumnInternalsDesignPanelProps {
  unitTag: string;
  unitLabel: string;
  config: DistillColumnParams;
  feeds: DistillFeedInput[];
  simResult?: DistillSolveResult;
  isMobile?: boolean;
  onChangeConfig: (patch: Partial<DistillColumnParams>) => void;
  onApplyHydraulicsToMesh?: (avgStageDpKgcm2: number, predictedEffPct: number) => void;
}

type RightVisualTab = 'datasheet' | 'drawing' | 'profile' | 'nozzles' | 'mechanical_cost';

const MONO = 'JetBrains Mono, monospace';

const cardBox: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '10px 12px',
};

const lblStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 800,
  color: '#334155',
  marginBottom: 3,
};

const inpStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11.5,
  fontWeight: 800,
  fontFamily: MONO,
  boxSizing: 'border-box',
};

const selStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11,
  fontWeight: 800,
  boxSizing: 'border-box',
  cursor: 'pointer',
};

function statusBadgeColors(
  status: StageHydraulicStatus,
  isEn = false
): { bg: string; fg: string; border: string; label: string } {
  switch (status) {
    case 'flooding':
      return { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5', label: isEn ? 'Flooding Risk' : '범람위험' };
    case 'weeping':
      return { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D', label: isEn ? 'Weeping / Low Wetting' : '위핑/적심부족' };
    case 'high':
      return { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74', label: isEn ? 'High Load' : '고부하' };
    case 'low':
      return { bg: '#E0F2FE', fg: '#075985', border: '#7DD3FC', label: isEn ? 'Low Load' : '저부하' };
    default:
      return { bg: '#DCFCE7', fg: '#065F46', border: '#86EFAC', label: isEn ? 'Normal' : '정상' };
  }
}

function governingCaseLabel(
  c: 'internal' | 'external' | 'wind' | 'seismic' | 'minimum',
  isEn = false
): string {
  switch (c) {
    case 'internal':
      return isEn ? 'Internal Press. (UG-27)' : '내압 (UG-27)';
    case 'external':
      return isEn ? 'External / Vacuum (UG-28)' : '외압/진공 (UG-28)';
    case 'wind':
      return isEn ? 'Wind Combined Stress' : '풍하중 조합응력';
    case 'seismic':
      return isEn ? 'Seismic Combined Stress' : '지진하중 조합응력';
    default:
      return isEn ? 'Min. Stiffness Thick. (UG-16)' : '최소 강성두께 (UG-16)';
  }
}

export default function ColumnInternalsDesignPanel({
  unitTag,
  unitLabel,
  config,
  feeds,
  simResult,
  isMobile: isMobileProp,
  onChangeConfig,
  onApplyHydraulicsToMesh,
}: ColumnInternalsDesignPanelProps) {
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';
  const [visualTab, setVisualTab] = useState<RightVisualTab>('drawing');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [aiStepLabel, setAiStepLabel] = useState('');
  const [isMobileState, setIsMobileState] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [mobilePane, setMobilePane] = useState<'inputs' | 'results'>('results');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobileState(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  const isMobile = isMobileProp ?? isMobileState;

  const ic: ColumnInternalsParams = config.internalsConfig ?? {};
  const patchInternals = (patch: Partial<ColumnInternalsParams>) => {
    onChangeConfig({
      internalsConfig: {
        ...ic,
        ...patch,
      },
    });
  };

  const designRes = useMemo(() => {
    if (!simResult || !simResult.stages || simResult.stages.length < 3) return null;
    return solveColumnInternalsDesign(config, feeds, simResult);
  }, [config, feeds, simResult]);

  const [lenUnit, setLenUnit] = useLocalUnit('length');
  const [dpUnit, setDpUnit] = useLocalUnit('deltaP');
  const [velUnit, setVelUnit] = useLocalUnit('velocity');
  const [areaUnit, setAreaUnit] = useLocalUnit('area');
  const [dutyUnit, setDutyUnit] = useLocalUnit('heatDuty');
  const [volUnit, setVolUnit] = useLocalUnit('volume');

  if (!simResult || !designRes) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          color: '#475569',
          fontSize: 13,
          fontWeight: 700,
          background: '#F8FAFC',
        }}
      >
        {isEn
          ? 'Connect feed stream(s) and click [▶ RUN Simulation] to complete multi-stage MESH calculations, activating column sizing, internals, mechanical, and cost design.'
          : '유입 스트림을 연결하고 [▶ RUN 시뮬레이션 실행]으로 다단 MESH 계산을 완료하면 단별 기액 부하·물성을 기반으로 컬럼 사이징 & 인터널·기계·원가 설계가 즉시 활성화됩니다.'}
      </div>
    );
  }

  const isTray = designRes.internalsKind === 'tray';
  const isSwaged = designRes.shellSectionMode === 'swaged';
  const mech = designRes.mechanical;
  const cost = designRes.costEstimate;
  const elMap = designRes.elevations;

  const handleDownloadSvg = () => {
    const triggerExport = () => {
      const svgEl = document.getElementById('col-epc-cad-svg');
      if (!svgEl) return;
      const xml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CAD_${unitTag}_${isTray ? 'TRAY' : 'PACKED'}.svg`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 350);
    };
    if (!document.getElementById('col-epc-cad-svg')) {
      setVisualTab('drawing');
      setTimeout(triggerExport, 120);
      return;
    }
    triggerExport();
  };

  const handlePrintDatasheet = () => {
    setVisualTab('datasheet');
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // ── 0) 실무 EPC 분리 데이터시트 탭 (Part I 본체 + Part II 트레이/패킹 분리 + Part III 노즐·EL) ──
  const renderEpcDatasheetTab = () => {
    const rSec = designRes.rectifying;
    const sSec = designRes.stripping;
    const pk = designRes.packingSpec;
    const hw = designRes.packingHardware;
    const tblStyle: React.CSSProperties = {
      width: '100%',
      minWidth: 640,
      borderCollapse: 'collapse',
      fontSize: 10.6,
    };
    const thSec = (title: string, badge: string, bg: string) => (
      <div
        style={{
          padding: '7px 11px',
          background: bg,
          color: '#FFFFFF',
          fontSize: 11.2,
          fontWeight: 900,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 9.8, opacity: 0.9, fontFamily: MONO }}>{badge}</span>
      </div>
    );
    const tdL: React.CSSProperties = { padding: '5px 8px', fontWeight: 700, color: '#1E293B', borderBottom: '1px solid #E2E8F0' };
    const tdU: React.CSSProperties = { padding: '5px 7px', textAlign: 'center', color: '#64748B', fontFamily: MONO, fontSize: 10, borderBottom: '1px solid #E2E8F0' };
    const tdV: React.CSSProperties = { padding: '5px 8px', textAlign: 'right', fontWeight: 900, color: '#0F172A', fontFamily: MONO, borderBottom: '1px solid #E2E8F0' };
    const tdN: React.CSSProperties = { padding: '5px 8px', color: '#475569', fontSize: 10, borderBottom: '1px solid #E2E8F0' };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {/* PART I: 본체 데이터시트 (Vessel & Shell Datasheet) */}
        <div style={{ ...cardBox, padding: 0, overflow: 'hidden' }}>
          {thSec(
            isEn
              ? `PART I. COLUMN VESSEL & SHELL DATASHEET (${unitTag})`
              : `PART I. 본체 데이터시트 — COLUMN VESSEL & SHELL (${unitTag})`,
            isTray ? 'TYPE: TRAYED FRACTIONATOR' : 'TYPE: PACKED FRACTIONATOR',
            '#1E3A5F'
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={tblStyle}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Vessel & Process Spec' : '설계 항목 (Vessel & Process Spec)'}</th>
                  <th style={{ padding: '5px 7px', textAlign: 'center' }}>{isEn ? 'Unit' : '단위'}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right' }}>{isEn ? 'Design Value' : '설계 사양 (Design Value)'}</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Code / Operating Conditions' : '적용 규격 / 운전 조건'}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdL}>{isEn ? 'Shell Nominal ID (Rectifying / Stripping)' : '동체 공칭 내경 (Rectifying / Stripping ID)'}</td>
                  <td style={tdU}>mm</td>
                  <td style={tdV}>Ø{Math.round(rSec.selectedNominalDiamM * 1000)} / Ø{Math.round(sSec.selectedNominalDiamM * 1000)}</td>
                  <td style={tdN}>
                    {isSwaged
                      ? (isEn ? 'Swaged Cone (2-Section ID)' : '이단 직경 (Swaged Cone)')
                      : (isEn ? 'Uniform Shell' : '단일 직경 (Uniform Shell)')}{' '}
                    · Gov Ø{Math.round(designRes.governingDiamM * 1000)} mm
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'Tangent Height (H_T/T) / Skirt / Overall (O.A.L.)' : '탑 탄젠트 높이 (H_T/T) / 스커트 / 전체고도 (O.A.L.)'}</td>
                  <td style={tdU}>mm</td>
                  <td style={tdV}>{(elMap.ttlElMm - elMap.btlElMm).toLocaleString()} / {elMap.btlElMm.toLocaleString()} / {elMap.oalElMm.toLocaleString()}</td>
                  <td style={tdN}>B.T.L. EL +{elMap.btlElMm} · T.T.L. EL +{elMap.ttlElMm} · L/D = {designRes.lengthToDiamRatio}</td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'Operating Temp. (Top / Feed / Bottom) & Pressure' : '운전 온도 (Top / Feed / Bottom) & 운전 압력'}</td>
                  <td style={tdU}>°C / kG</td>
                  <td style={tdV}>{simResult.topTempC.toFixed(1)} / {(simResult.stages[Math.max(0, simResult.feedStageUsed - 1)]?.tempC ?? simResult.topTempC).toFixed(1)} / {simResult.bottomTempC.toFixed(1)} °C</td>
                  <td style={tdN}>P_top {(config.topPressKgcm2g ?? 0.05).toFixed(3)} / P_bot {simResult.bottomPressKgcm2g.toFixed(3)} kg/cm²G · RR={simResult.actualRefluxRatio.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'ASME Design Press. / Temp. / CA / Joint Eff.' : 'ASME 설계압력 / 설계온도 / 부식여유 / 용접효율'}</td>
                  <td style={tdU}>barG / °C</td>
                  <td style={tdV}>{designRes.designPressBarG.toFixed(1)} barG / {designRes.designTempC.toFixed(0)} °C</td>
                  <td style={tdN}>
                    CA={mech.corrosionAllowanceMm.toFixed(1)}mm · E={mech.jointEfficiency.toFixed(2)} ·{' '}
                    {designRes.vacuumStiffenerRequired
                      ? (isEn ? `Vacuum Ext. 0.101MPa (${mech.stiffenerCount} Rings)` : `진공외압 0.101MPa (링 ${mech.stiffenerCount}EA)`)
                      : (isEn ? 'Atm / Pressurized' : '상압/가압')}
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'Shell / Head / Skirt Material & Selected Thickness' : '동체/경판/스커트 재질 및 채택 판두께'}</td>
                  <td style={tdU}>mm</td>
                  <td style={tdV}>Shell {mech.selectedShellMm}t / Head {mech.selectedHeadMm}t / Skirt {mech.skirtThicknessMm}t</td>
                  <td style={tdN}>
                    {designRes.recommendedMaterialLabel} · {isEn ? '2:1 Ellipsoidal Head' : '2:1 타원경판'} ({governingCaseLabel(mech.governingCase, isEn)})
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'Bottom Sump Residence Time & Liquid Levels (LLL / NLL / HLL)' : '탑저 섬프 체류시간 & 액위 고도 (LLL / NLL / HLL)'}</td>
                  <td style={tdU}>min / EL mm</td>
                  <td style={tdV}>{designRes.sumpResidenceMin} min ({designRes.sumpLiquidHeightM} m)</td>
                  <td style={tdN}>
                    LLL EL +{elMap.lllElMm} · NLL EL +{elMap.nllElMm} · HLL EL +{elMap.hllElMm} ({isEn ? 'Ref. Base EL 0' : 'Base EL 0 기준'})
                  </td>
                </tr>
                <tr>
                  <td style={tdL}>{isEn ? 'Vessel Weight (Empty / Operating / Hydrotest) & Bare-Module Cost' : '장치 중량 (공탑 / 운전 / 만수) & Bare-Module 원가'}</td>
                  <td style={tdU}>{isEn ? 'ton / USD' : 'ton / M₩'}</td>
                  <td style={tdV}>{designRes.estimatedDryWeightTon} / {(mech.operatingWeightKN / 9.80665).toFixed(1)} / {(mech.hydrotestWeightKN / 9.80665).toFixed(1)} t</td>
                  <td style={tdN}>
                    {isEn
                      ? `Anchor Bolts ${mech.anchorBoltCount}×${mech.anchorBoltSize} · Bare-Module $${cost.bareModuleUsd.toLocaleString()}`
                      : `앵커볼트 ${mech.anchorBoltCount}×${mech.anchorBoltSize} · 총 설치비 ${formatKrwReadable(cost.bareModuleKrw)}`}
                  </td>
                </tr>
                {designRes.sideCutSummary && (
                  <tr style={{ background: '#F5F3FF' }}>
                    <td style={{ ...tdL, color: '#5B21B6' }}>{isEn ? 'Side-Cut Product (S)' : 'Side-Cut Product (S · 측류 인출)'}</td>
                    <td style={tdU}>kg/h</td>
                    <td style={{ ...tdV, color: '#6D28D9' }}>
                      {designRes.sideCutSummary.massKgH.toLocaleString(undefined, { maximumFractionDigits: 1 })} ({designRes.sideCutSummary.sOverFPct.toFixed(1)}% F)
                    </td>
                    <td style={{ ...tdN, color: '#5B21B6', fontWeight: 700 }}>
                      Stage #{designRes.sideCutSummary.stage} ·{' '}
                      {designRes.sideCutSummary.phase === 'G'
                        ? (isEn ? 'Vapor' : 'Vapor (기상)')
                        : (isEn ? 'Liquid' : 'Liquid (액상)')}{' '}
                      · T={designRes.sideCutSummary.tempC.toFixed(1)}°C · {designRes.sideCutSummary.nozzleTag} EL +{designRes.sideCutSummary.elevationMm} mm
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* PART II: 엄격 분리된 내부장치 데이터시트 (TRAY 전용 vs PACKING 전용) */}
        {isTray ? (
          <div style={{ ...cardBox, padding: 0, overflow: 'hidden' }}>
            {thSec(
              isEn
                ? `PART II-A. FRACTIONATION TRAY INTERNALS DATASHEET (${unitTag})`
                : `PART II-A. 트레이 컬럼 내부장치 데이터시트 — FRACTIONATION TRAY SPEC (${unitTag})`,
              `${designRes.trayType.toUpperCase()} · ${designRes.actualTotalTrays} TRAYS TOTAL`,
              '#3730A3'
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={tblStyle}>
                <thead>
                  <tr style={{ background: '#EEF2FF', borderBottom: '1px solid #C7D2FE', color: '#1E1B4B' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Tray Specification' : '트레이 설계 항목 (Tray Specification)'}</th>
                    <th style={{ padding: '5px 7px', textAlign: 'center' }}>{isEn ? 'Unit' : '단위'}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right' }}>{isEn ? 'Rectifying Section' : '상부 정류부 (Rectifying)'}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right' }}>{isEn ? 'Stripping Section' : '하부 스트리핑부 (Stripping)'}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Notes / Basis' : '비고 / 기준'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdL}>{isEn ? 'Tray Type & Metallurgy' : '트레이 형식 (Tray Type) & 재질'}</td>
                    <td style={tdU}>-</td>
                    <td style={tdV}>{designRes.trayTypeLabel}</td>
                    <td style={tdV}>{designRes.trayTypeLabel}</td>
                    <td style={tdN}>Deck {rSec.deckThicknessMm}mmt ({designRes.recommendedMaterialCode})</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Flow Passes & Flow Path Length (FPL)' : '유로 패스 수 (Flow Passes) & 유로길이 (FPL)'}</td>
                    <td style={tdU}>Pass / mm</td>
                    <td style={tdV}>{rSec.flowPasses}-Pass ({Math.round(rSec.flowPathLengthM * 1000)} mm)</td>
                    <td style={tdV}>{sSec.flowPasses}-Pass ({Math.round(sSec.flowPathLengthM * 1000)} mm)</td>
                    <td style={tdN}>
                      {isEn
                        ? `Rect #${rSec.stageStart}~#${rSec.stageEnd} (${rSec.actualTraysOrBeds} trays) / Strip #${sSec.stageStart}~#${sSec.stageEnd} (${sSec.actualTraysOrBeds} trays)`
                        : `정류 #${rSec.stageStart}~#${rSec.stageEnd} (${rSec.actualTraysOrBeds}단) / 스 #${sSec.stageStart}~#${sSec.stageEnd} (${sSec.actualTraysOrBeds}단)`}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Tray Spacing & Section Height' : '단간격 (Tray Spacing) & 구간 총 높이'}</td>
                    <td style={tdU}>mm / m</td>
                    <td style={tdV}>{designRes.traySpacingMm} mm ({rSec.sectionHeightM} m)</td>
                    <td style={tdV}>{designRes.traySpacingMm} mm ({sSec.sectionHeightM} m)</td>
                    <td style={tdN}>
                      {isEn
                        ? `Feed Nozzle Stage #${simResult.feedStageUsed} (EL +${elMap.feedNozzleElMm})`
                        : `Feed Nozzle #${simResult.feedStageUsed}단 (EL +${elMap.feedNozzleElMm})`}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Hole/Valve Ø & Triangular Pitch' : '홀지름 (Hole/Valve Ø) & 정삼각 피치 (Pitch)'}</td>
                    <td style={tdU}>mm</td>
                    <td style={tdV}>Ø{rSec.holeDiameterMm} / P={rSec.holePitchMm} mm Δ</td>
                    <td style={tdV}>Ø{sSec.holeDiameterMm} / P={sSec.holePitchMm} mm Δ</td>
                    <td style={tdN}>{isEn ? '60° Triangular Pitch Pattern' : '60° 삼각 천공 배열'}</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Open Area (% of A_a / % of A_T) & Active Area A_a' : '개공비 (Open Area % of A_a / % of A_T) & 활성면적 A_a'}</td>
                    <td style={tdU}>% / m²</td>
                    <td style={tdV}>{rSec.openAreaPctOfActive}% Aa ({rSec.openAreaPctOfTower}% AT)</td>
                    <td style={tdV}>{sSec.openAreaPctOfActive}% Aa ({sSec.openAreaPctOfTower}% AT)</td>
                    <td style={tdN}>A_a = {rSec.activeAreaM2} / {sSec.activeAreaM2} m² (A_h={rSec.holeAreaM2}/{sSec.holeAreaM2} m²)</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Outlet Weir Type · Height(h_w) · Length(L_w) · Crest(h_ow)' : '출구 위어 형식 · 높이(h_w) · 길이(L_w) · 월류수두(h_ow)'}</td>
                    <td style={tdU}>mm</td>
                    <td style={tdV}>h_w={rSec.weirHeightMm} · L_w={rSec.weirLengthMm} · h_ow={rSec.avgWeirCrestMm}</td>
                    <td style={tdV}>h_w={sSec.weirHeightMm} · L_w={sSec.weirLengthMm} · h_ow={sSec.avgWeirCrestMm}</td>
                    <td style={tdN}>{rSec.weirType}</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Downcomer Type · Top/Bot Width(W_dc) · Area(A_d/A_T)' : '다운커머 형식 · 상/하 폭(W_dc) · 면적비(A_d/A_T)'}</td>
                    <td style={tdU}>mm / %</td>
                    <td style={tdV}>{rSec.dcWidthTopMm} / {rSec.dcWidthBotMm} mm ({rSec.dcAreaPctOfTower}%)</td>
                    <td style={tdV}>{sSec.dcWidthTopMm} / {sSec.dcWidthBotMm} mm ({sSec.dcAreaPctOfTower}%)</td>
                    <td style={tdN}>{sSec.dcType}</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Downcomer Apron Clearance (h_ap) & Seal Pan' : '다운코머 하단 틈새(Apron Clearance h_ap) & 씰팬'}</td>
                    <td style={tdU}>mm</td>
                    <td style={tdV}>{rSec.dcClearanceMm} mm</td>
                    <td style={tdV}>{sSec.dcClearanceMm} mm</td>
                    <td style={tdN}>{rSec.sealPanSpec}</td>
                  </tr>
                  <tr style={{ background: '#F8FAFC' }}>
                    <td style={tdL}>{isEn ? 'Operating Window & Turndown Ratio' : '운전 가능 범위 (Operating Window) & 턴다운 비'}</td>
                    <td style={tdU}>% / Ratio</td>
                    <td style={tdV}>{rSec.operatingLoadMinPct}% ~ {rSec.operatingLoadMaxPct}% ({rSec.sectionTurndownRatio}:1)</td>
                    <td style={tdV}>{sSec.operatingLoadMinPct}% ~ {sSec.operatingLoadMaxPct}% ({sSec.sectionTurndownRatio}:1)</td>
                    <td style={tdN}>
                      {isEn
                        ? `Overall Window ${designRes.operatingLoadMinPct}%~${designRes.operatingLoadMaxPct}% · Lockett Weep ${rSec.avgWeepSafetyRatio}/${sSec.avgWeepSafetyRatio}x`
                        : `통합 운전범위 ${designRes.operatingLoadMinPct}%~${designRes.operatingLoadMaxPct}% · Lockett Weep ${rSec.avgWeepSafetyRatio}/${sSec.avgWeepSafetyRatio}x`}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Flooding (Jet/Choke) · DC Backup · ΔP/Tray · Chan-Fair Eff.' : '범람율(Jet/Choke) · DC백업 · 단당 ΔP · Chan-Fair 효율'}</td>
                    <td style={tdU}>% / mbar</td>
                    <td style={tdV}>Flood {rSec.maxFloodPct}% · DC {rSec.maxDcBackupPct}% · {rSec.avgTrayDpMbar} mbar</td>
                    <td style={tdV}>Flood {sSec.maxFloodPct}% · DC {sSec.maxDcBackupPct}% · {sSec.avgTrayDpMbar} mbar</td>
                    <td style={tdN}>
                      {isEn
                        ? `Total ΔP ${designRes.totalInternalsDpMbar} mbar · Eff. ${designRes.avgChanFairEffPct}%`
                        : `총 ΔP ${designRes.totalInternalsDpMbar} mbar · 효율 ${designRes.avgChanFairEffPct}%`}
                    </td>
                  </tr>
                  {designRes.sideCutSummary && (
                    <tr style={{ background: '#F5F3FF' }}>
                      <td style={{ ...tdL, color: '#5B21B6' }}>{isEn ? 'Side-Cut Chimney Draw-Off Collector' : '측류 침니 드로우오프 콜렉터 (Side-Cut Chimney Draw-Off)'}</td>
                      <td style={tdU}>Stage / EL</td>
                      <td style={tdV}>
                        {designRes.sideCutSummary.stage < simResult.feedStageUsed
                          ? `Stage #${designRes.sideCutSummary.stage} · EL +${designRes.sideCutSummary.elevationMm} mm`
                          : '-'}
                      </td>
                      <td style={tdV}>
                        {designRes.sideCutSummary.stage >= simResult.feedStageUsed
                          ? `Stage #${designRes.sideCutSummary.stage} · EL +${designRes.sideCutSummary.elevationMm} mm`
                          : '-'}
                      </td>
                      <td style={{ ...tdN, color: '#5B21B6', fontWeight: 700 }}>
                        {designRes.sideCutSummary.phase === 'G'
                          ? (isEn
                              ? `Vapor Side-Cut Baffle (${designRes.sideCutSummary.nozzleTag} @ 90°)`
                              : `기상 측류 배플 (${designRes.sideCutSummary.nozzleTag} @ 90°)`)
                          : (isEn
                              ? `Chimney Tray Sump (+600mm clearance · ${designRes.sideCutSummary.nozzleTag} @ 90°)`
                              : `침니 트레이 섬프 (+600mm 여유 · ${designRes.sideCutSummary.nozzleTag} @ 90°)`)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ ...cardBox, padding: 0, overflow: 'hidden' }}>
            {thSec(
              isEn
                ? `PART II-B. PACKED COLUMN INTERNALS DATASHEET (${unitTag})`
                : `PART II-B. 패킹 컬럼 내부장치 데이터시트 — PACKED INTERNALS SPEC (${unitTag})`,
              `${pk.category.toUpperCase()} · ${designRes.packedBedCount} BEDS · Z=${designRes.totalPackedHeightM} m`,
              '#0F766E'
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={tblStyle}>
                <thead>
                  <tr style={{ background: '#CCFBF1', borderBottom: '1px solid #99F6E4', color: '#134E4A' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Packing & Hardware Item' : '패킹 & 인터널 항목 (Packing & Hardware)'}</th>
                    <th style={{ padding: '5px 7px', textAlign: 'center' }}>{isEn ? 'Unit' : '단위'}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right' }}>{isEn ? 'Specification' : '설계 사양 (Specification)'}</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left' }}>{isEn ? 'Aux Metrics / Operating Range / EL' : '보조 지표 / 운전 범위 / EL 위치'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdL}>{isEn ? 'Packing Category & Model' : '패킹 종류 (Category & Model)'}</td>
                    <td style={tdU}>-</td>
                    <td style={tdV}>{pk.name}</td>
                    <td style={tdN}>
                      {pk.category === 'structured'
                        ? (isEn ? 'Structured Packing' : '규칙 패킹 (Structured)')
                        : (isEn ? 'Random Packing' : '불규칙 패킹 (Random)')}{' '}
                      · {pk.materialNote}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Nominal Size / Crimp Spec' : '패킹 공칭 크기 / 크림프 규격 (Nominal Size)'}</td>
                    <td style={tdU}>mm</td>
                    <td style={tdV}>{pk.nominalSizeLabel || '-'}</td>
                    <td style={tdN}>
                      {isEn
                        ? `Area a_p=${pk.surfaceAreaM2M3} m²/m³ · Void ε=${(pk.voidFraction * 100).toFixed(1)}% · F_p=${pk.packingFactorFpM1} 1/m`
                        : `비표면적 a_p=${pk.surfaceAreaM2M3} m²/m³ · 공극률 ε=${(pk.voidFraction * 100).toFixed(1)}% · F_p=${pk.packingFactorFpM1} 1/m`}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Total Packed Bed Height & Section HETP' : '배드 높이 총합 (Total Bed Height) & 구간별 HETP'}</td>
                    <td style={tdU}>mm / m</td>
                    <td style={tdV}>{Math.round(designRes.totalPackedHeightM * 1000)} mm ({designRes.totalPackedHeightM} m)</td>
                    <td style={tdN}>
                      {isEn
                        ? `Rect HETP ${rSec.hetpAvgM}m · Strip HETP ${sSec.hetpAvgM}m · Avg H_OG=${designRes.avgPackedHogM}m`
                        : `정류 HETP ${rSec.hetpAvgM}m · 스트리핑 HETP ${sSec.hetpAvgM}m · 평균 H_OG=${designRes.avgPackedHogM}m`}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>
                      {isEn
                        ? `Top Liquid Distributor (${hw.topDistributor.tag})`
                        : `상부 액체 분배기 (${hw.topDistributor.tag} Top Distributor)`}
                    </td>
                    <td style={tdU}>pts/m²</td>
                    <td style={tdV}>
                      {isEn
                        ? `${hw.topDistributor.dripPointsPerM2} pts/m² (${hw.topDistributor.totalDripPoints} pts)`
                        : `${hw.topDistributor.dripPointsPerM2} pts/m² (총 ${hw.topDistributor.totalDripPoints}공)`}
                    </td>
                    <td style={tdN}>{hw.topDistributor.type} · EL +{hw.topDistributor.elevationMm} mm</td>
                  </tr>
                  <tr>
                    <td style={tdL}>{isEn ? 'Mid Collector & Liquid Redistributors' : '중간 콜렉터 & 액체 재분배기 (Redistributors)'}</td>
                    <td style={tdU}>EA</td>
                    <td style={tdV}>
                      {isEn
                        ? `${hw.redistributors.count} EA (${hw.redistributors.items.map((x) => x.tag).join(', ') || 'None'})`
                        : `${hw.redistributors.count} 기 (${hw.redistributors.items.map((x) => x.tag).join(', ') || 'None'})`}
                    </td>
                    <td style={tdN}>
                      {hw.redistributors.items.length > 0
                        ? hw.redistributors.items.map((rd) => `${rd.tag}@EL+${rd.elevationMm} (${rd.collectorType})`).join(' | ')
                        : (isEn ? 'Single bed — no intermediate redistributor required' : '단일 베드 구간으로 중간 재분배기 불필요')}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdL}>
                      {isEn
                        ? `Packing Support Plate (${hw.supportPlates.count} EA)`
                        : `패킹 지지판 (${hw.supportPlates.count} EA Support Plate)`}
                    </td>
                    <td style={tdU}>% Open</td>
                    <td style={tdV}>{hw.supportPlates.freeAreaPct}% Free Area</td>
                    <td style={tdN}>{hw.supportPlates.type} · EL: {hw.supportPlates.elevationsMm.map((e) => `+${e}`).join(', ')} mm</td>
                  </tr>
                  <tr>
                    <td style={tdL}>
                      {isEn
                        ? `Packing Hold-Down Grid (${hw.holdDownGrids.count} EA)`
                        : `패킹 홀드다운 그리드 (${hw.holdDownGrids.count} EA Hold-Down)`}
                    </td>
                    <td style={tdU}>% Open</td>
                    <td style={tdV}>{hw.holdDownGrids.freeAreaPct}% Free Area</td>
                    <td style={tdN}>{hw.holdDownGrids.type} · EL: {hw.holdDownGrids.elevationsMm.map((e) => `+${e}`).join(', ')} mm</td>
                  </tr>
                  <tr>
                    <td style={tdL}>
                      {isEn
                        ? `Overhead Demister Pad (${hw.demister.tag})`
                        : `탑정 미스트 제거기 (${hw.demister.tag} Demister Pad)`}
                    </td>
                    <td style={tdU}>mm</td>
                    <td style={tdV}>{hw.demister.thicknessMm}t ({hw.demister.densityKgM3} kg/m³)</td>
                    <td style={tdN}>{hw.demister.type} · EL +{hw.demister.elevationMm} mm</td>
                  </tr>
                  <tr style={{ background: '#F0FDFA' }}>
                    <td style={tdL}>{isEn ? 'Operating Range & Liquid Wetting Rate' : '패킹 운전 범위 (Operating Range) & 적심률 (Wetting Rate)'}</td>
                    <td style={tdU}>% / m³/m²h</td>
                    <td style={tdV}>{designRes.operatingLoadMinPct}% ~ {designRes.operatingLoadMaxPct}% (TD {designRes.minTurndownRatio}:1)</td>
                    <td style={tdN}>
                      {isEn
                        ? `Wetting ${rSec.avgWettingRateM3M2H}/${sSec.avgWettingRateM3M2H} (MWR ${pk.minWettingM3M2H}) · B-S Flood ${designRes.maxFloodPct}% · Total ΔP ${designRes.totalInternalsDpMbar} mbar`
                        : `적심률 ${rSec.avgWettingRateM3M2H}/${sSec.avgWettingRateM3M2H} (MWR ${pk.minWettingM3M2H}) · B-S Flood ${designRes.maxFloodPct}% · 총 ΔP ${designRes.totalInternalsDpMbar} mbar`}
                    </td>
                  </tr>
                  {designRes.sideCutSummary && (
                    <tr style={{ background: '#F5F3FF' }}>
                      <td style={{ ...tdL, color: '#5B21B6' }}>{isEn ? 'Side-Cut Chimney Draw-Off Collector' : '측류 침니 드로우오프 콜렉터 (Side-Cut Chimney Draw-Off)'}</td>
                      <td style={tdU}>Stage / EL</td>
                      <td style={{ ...tdV, color: '#6D28D9' }}>
                        Stage #{designRes.sideCutSummary.stage} · EL +{designRes.sideCutSummary.elevationMm} mm
                      </td>
                      <td style={{ ...tdN, color: '#5B21B6', fontWeight: 700 }}>
                        {designRes.sideCutSummary.phase === 'G'
                          ? (isEn ? 'Vapor Side-Cut Baffle' : '기상 측류 인출 배플')
                          : (isEn ? 'Liquid Chimney Collector + Sump' : '액상 침니 콜렉터 + 섬프')}{' '}
                        · {designRes.sideCutSummary.nozzleTag} ({designRes.sideCutSummary.massKgH.toFixed(1)} kg/h, {designRes.sideCutSummary.phase})
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '6px 10px', background: '#F8FAFC', borderTop: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 10.2, fontWeight: 900, color: '#0F766E', marginBottom: 4 }}>
                {isEn
                  ? `Bed-by-Bed Distribution Schedule (Top → Bottom Bed #1 ~ #${designRes.packedBeds.length})`
                  : `베드별 상세 배분 스케줄 (Top → Bottom Bed #1 ~ #${designRes.packedBeds.length})`}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.2, fontFamily: MONO }}>
                <thead>
                  <tr style={{ background: '#E2E8F0', color: '#334155' }}>
                    <th style={{ padding: '3px 6px', textAlign: 'center' }}>Bed #</th>
                    <th style={{ padding: '3px 6px', textAlign: 'left' }}>{isEn ? 'Section' : '구간'}</th>
                    <th style={{ padding: '3px 6px', textAlign: 'right' }}>{isEn ? 'ID (mm)' : '내경 (mm)'}</th>
                    <th style={{ padding: '3px 6px', textAlign: 'right' }}>{isEn ? 'Bed Height (mm)' : '배드높이 (mm)'}</th>
                    <th style={{ padding: '3px 6px', textAlign: 'right' }}>HETP (mm)</th>
                    <th style={{ padding: '3px 6px', textAlign: 'right' }}>{isEn ? 'Theor. Stages' : '이론단'}</th>
                    <th style={{ padding: '3px 6px', textAlign: 'right' }}>EL (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {designRes.packedBeds.map((b) => (
                    <tr key={b.bedNumber} style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td style={{ padding: '3px 6px', textAlign: 'center', fontWeight: 900 }}>#{b.bedNumber}</td>
                      <td style={{ padding: '3px 6px' }}>{b.sectionLabel}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>Ø{b.diameterMm}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 900 }}>{b.bedHeightMm} ({b.bedHeightM}m)</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>{b.hetpMm}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>{b.eqTheoreticalStages}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>EL +{b.botElMm} ~ +{b.topElMm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PART III: 노즐 및 맨홀 설치 EL 스케줄 */}
        <div style={{ ...cardBox, padding: 0, overflow: 'hidden' }}>
          {thSec(
            isEn
              ? 'PART III. NOZZLE & MANHOLE ELEVATION (EL) & FLANGE SCHEDULE'
              : 'PART III. 노즐·맨홀 설치 고도(EL) 및 플랜지 스케줄',
            isEn ? 'Ref. Base Ring EL +0 mm' : 'Base Ring EL +0 mm 기준',
            '#334155'
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={tblStyle}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                  <th style={{ padding: '4px 7px', textAlign: 'center' }}>Tag</th>
                  <th style={{ padding: '4px 7px', textAlign: 'left' }}>{isEn ? 'Service' : '서비스'}</th>
                  <th style={{ padding: '4px 7px', textAlign: 'center' }}>{isEn ? 'Size (DN)' : '규격 (DN)'}</th>
                  <th style={{ padding: '4px 7px', textAlign: 'center' }}>{isEn ? 'Flange Rating' : '플랜지 등급'}</th>
                  <th style={{ padding: '4px 7px', textAlign: 'center' }}>{isEn ? 'Orientation' : '방위각'}</th>
                  <th style={{ padding: '4px 7px', textAlign: 'right' }}>{isEn ? 'Elevation EL' : '설치 고도 EL'}</th>
                  <th style={{ padding: '4px 7px', textAlign: 'right' }}>From B.T.L.</th>
                </tr>
              </thead>
              <tbody>
                {designRes.nozzles.map((nz) => (
                  <tr key={nz.nozzleTag} style={{ borderBottom: '1px solid #E2E8F0', background: nz.nozzleTag === 'N7' ? '#F5F3FF' : undefined }}>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontWeight: 900, color: nz.nozzleTag === 'N7' ? '#7C3AED' : '#4338CA', fontFamily: MONO }}>{nz.nozzleTag}</td>
                    <td style={{ padding: '4px 7px' }}>{nz.service}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontWeight: 900, fontFamily: MONO }}>{nz.selectedDn}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontFamily: MONO }}>{nz.flangeRating}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontFamily: MONO }}>{nz.orientationDeg}°</td>
                    <td style={{ padding: '4px 7px', textAlign: 'right', fontWeight: 900, fontFamily: MONO }}>EL +{nz.elevationMm} mm</td>
                    <td style={{ padding: '4px 7px', textAlign: 'right', fontFamily: MONO }}>{nz.elevationFromBtlMm >= 0 ? '+' : ''}{nz.elevationFromBtlMm} mm</td>
                  </tr>
                ))}
                {designRes.manholes.map((mh) => (
                  <tr key={mh.tag} style={{ borderBottom: '1px solid #E2E8F0', background: '#FFFBEB' }}>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontWeight: 900, color: '#B45309', fontFamily: MONO }}>{mh.tag}</td>
                    <td style={{ padding: '4px 7px' }}>{mh.service}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontWeight: 900, fontFamily: MONO }}>{mh.sizeDn}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontFamily: MONO }}>{mh.flangeRating}</td>
                    <td style={{ padding: '4px 7px', textAlign: 'center', fontFamily: MONO }}>{mh.orientationDeg}°</td>
                    <td style={{ padding: '4px 7px', textAlign: 'right', fontWeight: 900, fontFamily: MONO }}>EL +{mh.elevationMm} mm</td>
                    <td style={{ padding: '4px 7px', textAlign: 'right', fontFamily: MONO }}>+{mh.elevationFromBtlMm} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── 1) 정밀 축척 엔지니어링 CAD 입면도(GA Elevation) + 단면 상세도 SVG ──
  const renderConceptualDrawingSvg = () => {
    const dRect = designRes.rectifying.selectedNominalDiamM;
    const dStrip = designRes.stripping.selectedNominalDiamM;
    const dMax = Math.max(dRect, dStrip, 0.5);
    const oalMm = Math.max(4000, elMap.oalElMm);

    const cx = 248;
    const gradeY = 548;
    const topPxY = 66;
    const spanPxH = gradeY - topPxY;
    const yPx = (mm: number) => gradeY - (mm / oalMm) * spanPxH;

    const rectPxW = Math.round(64 + 44 * (dRect / dMax));
    const stripPxW = Math.round(64 + 44 * (dStrip / dMax));
    const rectLeft = cx - rectPxW / 2;
    const rectRight = cx + rectPxW / 2;
    const stripLeft = cx - stripPxW / 2;
    const stripRight = cx + stripPxW / 2;

    const btlY = yPx(elMap.btlElMm);
    const ttlY = yPx(elMap.ttlElMm);
    const headDepthR = Math.max(12, Math.round(rectPxW * 0.25));
    const headDepthS = Math.max(12, Math.round(stripPxW * 0.25));
    const rectBotY = yPx(elMap.rectBotElMm);
    const rectTopY = yPx(elMap.rectTopElMm);
    const stripBotY = yPx(elMap.stripBotElMm);
    const stripTopY = yPx(elMap.stripTopElMm);
    const lllY = yPx(elMap.lllElMm);
    const nllY = yPx(elMap.nllElMm);
    const hllY = yPx(elMap.hllElMm);

    const planCx = 605;
    const planCy = 168;
    const planR = 80;
    const dcFrac = (ic.downcomerAreaPct ?? 12) / 100.0;
    const dcChordOffset = Math.round(planR * (1 - 1.55 * dcFrac));
    const activePasses = designRes.stripping.flowPasses;

    const nzByTag = Object.fromEntries(designRes.nozzles.map((n) => [n.nozzleTag, n]));
    const datumTicks: Array<{ label: string; mm: number; color: string }> = [
      { label: 'O.A.L.', mm: elMap.oalElMm, color: '#1E293B' },
      { label: 'T.T.L.', mm: elMap.ttlElMm, color: '#1D4ED8' },
      { label: isTray ? 'Top Tray' : 'Bed #1 Top', mm: elMap.rectTopElMm, color: '#0F766E' },
      { label: 'Feed N3', mm: elMap.feedNozzleElMm, color: '#B91C1C' },
      ...(designRes.sideCutSummary &&
      elMap.sideCutNozzleElMm !== undefined &&
      Math.abs(elMap.sideCutNozzleElMm - elMap.feedNozzleElMm) >= 350
        ? [{ label: 'SIDE N7', mm: elMap.sideCutNozzleElMm, color: '#7C3AED' }]
        : []),
      { label: isTray ? 'Bot Tray' : 'Strip Bot', mm: elMap.stripBotElMm, color: '#0F766E' },
      { label: 'HLL', mm: elMap.hllElMm, color: '#0369A1' },
      { label: 'B.T.L.', mm: elMap.btlElMm, color: '#1D4ED8' },
      { label: 'Base EL', mm: 0, color: '#475569' },
    ];

    return (
      <svg
        id="col-epc-cad-svg"
        viewBox="0 0 920 620"
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: isMobile ? 'none' : '78vh',
          aspectRatio: '920 / 620',
          background: '#FFFFFF',
          border: '1.5px solid #CBD5E1',
          borderRadius: 8,
          display: 'block',
        }}
      >
        <defs>
          <linearGradient id="colShellGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E2E8F0" />
            <stop offset="45%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>
          <pattern id="packCrossHatch" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 0 8 L 8 0 M -2 2 L 2 -2 M 6 10 L 10 6" stroke="#0F766E" strokeWidth="0.85" opacity="0.55" />
            <path d="M 0 0 L 8 8 M -2 6 L 2 10 M 6 -2 L 10 2" stroke="#0F766E" strokeWidth="0.85" opacity="0.55" />
          </pattern>
        </defs>

        {/* 도면 외곽 CAD 프레임 */}
        <rect x={4} y={4} width={912} height={612} fill="none" stroke="#94A3B8" strokeWidth={1.2} />
        <line x1={465} y1={12} x2={465} y2={608} stroke="#E2E8F0" strokeWidth={1.2} />

        {/* 좌측 상단 타이틀 */}
        <text x={14} y={24} fontSize={12} fontWeight={900} fill="#0F172A">
          {isEn
            ? `[${unitTag}] PRECISION CAD ELEVATION (GA · PROPORTIONAL EL +mm)`
            : `[${unitTag}] 정밀 CAD 입면도 (GA ELEVATION · 축척 비례 EL +mm)`}
        </text>
        <text x={14} y={40} fontSize={9.6} fontWeight={700} fill="#475569" fontFamily={MONO}>
          {isSwaged
            ? (isEn
                ? `Swaged Shell ID: Rect Ø${Math.round(dRect * 1000)} / Strip Ø${Math.round(dStrip * 1000)}mm (${designRes.shellWallThicknessMm}t)`
                : `이단 동체 ID: 정류 Ø${Math.round(dRect * 1000)} / 스 Ø${Math.round(dStrip * 1000)}mm (${designRes.shellWallThicknessMm}t)`)
            : (isEn
                ? `Shell ID Ø${Math.round(dRect * 1000)}mm (${designRes.shellWallThicknessMm}t) · T-T ${(elMap.ttlElMm - elMap.btlElMm).toLocaleString()}mm`
                : `동체 ID Ø${Math.round(dRect * 1000)}mm (${designRes.shellWallThicknessMm}t) · T-T ${(elMap.ttlElMm - elMap.btlElMm).toLocaleString()}mm`)}
        </text>

        {/* 좌측 절대 고도 눈금 (EL +xxxx mm Datum Ladder) */}
        <line x1={110} y1={yPx(elMap.oalElMm)} x2={110} y2={gradeY} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="3 2" />
        {datumTicks.map((dt) => {
          const yy = yPx(dt.mm);
          return (
            <g key={dt.label}>
              <line x1={105} y1={yy} x2={stripLeft - 8} y2={yy} stroke="#CBD5E1" strokeWidth={0.8} strokeDasharray="2 2" />
              <line x1={104} y1={yy} x2={114} y2={yy} stroke={dt.color} strokeWidth={1.4} />
              <text x={100} y={yy + 3} textAnchor="end" fontSize={8.2} fontWeight={800} fill={dt.color} fontFamily={MONO}>
                {dt.label} +{dt.mm}
              </text>
            </g>
          );
        })}

        {/* 중심선 */}
        <line x1={cx} y1={topPxY - 14} x2={cx} y2={gradeY + 12} stroke="#94A3B8" strokeWidth={0.9} strokeDasharray="8 3 2 3" />

        {/* 베이스 링 & 지지 스커트 (EL 0 -> B.T.L.) */}
        <path
          d={`M ${stripLeft + 2} ${btlY} L ${stripLeft - 5} ${gradeY} M ${stripRight - 2} ${btlY} L ${stripRight + 5} ${gradeY}`}
          stroke="#475569"
          strokeWidth={2.5}
        />
        <line x1={stripLeft - 18} y1={gradeY} x2={stripRight + 18} y2={gradeY} stroke="#0F172A" strokeWidth={3.2} />

        {/* 용기 본체 (원통 + 2:1 타원경판) */}
        <path
          d={`
            M ${rectLeft} ${ttlY}
            Q ${cx} ${ttlY - headDepthR * 1.4} ${rectRight} ${ttlY}
            L ${rectRight} ${rectBotY}
            L ${stripRight} ${stripTopY}
            L ${stripRight} ${btlY}
            Q ${cx} ${btlY + headDepthS * 1.4} ${stripLeft} ${btlY}
            L ${stripLeft} ${stripTopY}
            L ${rectLeft} ${rectBotY}
            Z
          `}
          fill="url(#colShellGrad)"
          stroke="#0F172A"
          strokeWidth={2.2}
        />

        {/* 섬프 액위 LLL / NLL / HLL */}
        <rect x={stripLeft + 2} y={hllY} width={stripPxW - 4} height={Math.max(4, btlY - hllY)} fill="#93C5FD" opacity={0.45} />
        <line x1={stripLeft + 3} y1={hllY} x2={stripRight - 3} y2={hllY} stroke="#0369A1" strokeWidth={1.2} />
        <line x1={stripLeft + 3} y1={nllY} x2={stripRight - 3} y2={nllY} stroke="#0284C7" strokeWidth={1.1} strokeDasharray="3 2" />
        <line x1={stripLeft + 3} y1={lllY} x2={stripRight - 3} y2={lllY} stroke="#38BDF8" strokeWidth={1.1} strokeDasharray="2 2" />
        <text x={cx} y={Math.max(hllY + 11, (hllY + btlY) / 2 + 3)} textAnchor="middle" fontSize={7.8} fontWeight={800} fill="#1E3A8A" fontFamily={MONO}>
          HLL +{elMap.hllElMm}
        </text>

        {/* 인터널 상세 (트레이 단 vs 충진 베드+하드웨어) */}
        {isTray ? (
          (() => {
            const rN = Math.min(18, Math.max(2, designRes.rectifying.actualTraysOrBeds));
            const sN = Math.min(18, Math.max(2, designRes.stripping.actualTraysOrBeds));
            return (
              <>
                {Array.from({ length: rN }, (_, i) => {
                  const frac = rN === 1 ? 0.5 : i / (rN - 1);
                  const yy = rectTopY + frac * Math.max(8, rectBotY - rectTopY);
                  const dcL = i % 2 === 0;
                  return (
                    <g key={`rt-${i}`}>
                      <line x1={dcL ? rectLeft + 10 : rectLeft + 2} y1={yy} x2={dcL ? rectRight - 2 : rectRight - 10} y2={yy} stroke="#1E293B" strokeWidth={1.2} />
                      {i < rN - 1 && (
                        <line x1={dcL ? rectLeft + 10 : rectRight - 10} y1={yy} x2={dcL ? rectLeft + 10 : rectRight - 10} y2={yy + Math.max(4, (rectBotY - rectTopY) / rN - 2)} stroke="#475569" strokeWidth={1.1} />
                      )}
                    </g>
                  );
                })}
                {Array.from({ length: sN }, (_, i) => {
                  const frac = sN === 1 ? 0.5 : i / (sN - 1);
                  const yy = stripTopY + frac * Math.max(8, stripBotY - stripTopY);
                  const dcL = i % 2 === 1;
                  return (
                    <g key={`st-${i}`}>
                      <line x1={dcL ? stripLeft + 10 : stripLeft + 2} y1={yy} x2={dcL ? stripRight - 2 : stripRight - 10} y2={yy} stroke="#1E293B" strokeWidth={1.2} />
                      {i < sN - 1 && (
                        <line x1={dcL ? stripLeft + 10 : stripRight - 10} y1={yy} x2={dcL ? stripLeft + 10 : stripRight - 10} y2={yy + Math.max(4, (stripBotY - stripTopY) / sN - 2)} stroke="#475569" strokeWidth={1.1} />
                      )}
                    </g>
                  );
                })}
              </>
            );
          })()
        ) : (
          <>
            {designRes.packedBeds.map((b) => {
              const isR = b.section === 'rectifying';
              const bx = (isR ? rectLeft : stripLeft) + 4;
              const bw = (isR ? rectPxW : stripPxW) - 8;
              const byTop = yPx(b.topElMm);
              const byBot = yPx(b.botElMm);
              const bh = Math.max(10, byBot - byTop);
              return (
                <g key={b.bedNumber}>
                  <rect x={bx} y={byTop} width={bw} height={bh} fill="url(#packCrossHatch)" stroke="#0F766E" strokeWidth={1.2} />
                  <line x1={bx - 2} y1={byBot} x2={bx + bw + 2} y2={byBot} stroke="#0F172A" strokeWidth={2.2} />
                  <line x1={bx - 2} y1={byTop} x2={bx + bw + 2} y2={byTop} stroke="#D97706" strokeWidth={1.6} />
                  <text x={cx} y={byTop + bh / 2 + 3} textAnchor="middle" fontSize={7.6} fontWeight={900} fill="#0F766E" fontFamily={MONO}>
                    B#{b.bedNumber} {b.bedHeightM}m
                  </text>
                </g>
              );
            })}
            {/* LD-1 상부 분배기 & ME-1 미스트 제거기 */}
            <rect x={rectLeft + 5} y={yPx(designRes.packingHardware.topDistributor.elevationMm) - 2} width={rectPxW - 10} height={4} fill="#0284C7" />
            <rect x={rectLeft + 6} y={yPx(designRes.packingHardware.demister.elevationMm) - 4} width={rectPxW - 12} height={7} fill="#FDE68A" stroke="#D97706" strokeWidth={1} />
            {designRes.packingHardware.redistributors.items.map((rd) => (
              <rect key={rd.tag} x={rectLeft + 4} y={yPx(rd.elevationMm) - 3} width={rectPxW - 8} height={6} fill="#7C3AED" opacity={0.85} />
            ))}
          </>
        )}

        {/* 측류 침니 드로우오프 콜렉터 (Side-Cut Chimney Draw-Off) */}
        {designRes.sideCutSummary && elMap.sideCutNozzleElMm !== undefined && (() => {
          const scEl = elMap.sideCutNozzleElMm!;
          const scY = yPx(scEl);
          const inRect = scEl >= elMap.rectBotElMm;
          const scL = inRect ? rectLeft : stripLeft;
          const scR = inRect ? rectRight : stripRight;
          const scW = inRect ? rectPxW : stripPxW;
          return (
            <g>
              <rect x={scL + 3} y={scY - 4} width={scW - 6} height={8} fill="#EDE9FE" stroke="#7C3AED" strokeWidth={1.3} />
              <line x1={scL + 3} y1={scY + 4} x2={scR - 3} y2={scY + 4} stroke="#7C3AED" strokeWidth={1.8} />
              <rect x={scL + scW * 0.24} y={scY - 10} width={5} height={10} fill="#7C3AED" />
              <line x1={scL + scW * 0.24 - 2.5} y1={scY - 11.5} x2={scL + scW * 0.24 + 7.5} y2={scY - 11.5} stroke="#7C3AED" strokeWidth={1.5} />
              <rect x={scL + scW * 0.56} y={scY - 10} width={5} height={10} fill="#7C3AED" />
              <line x1={scL + scW * 0.56 - 2.5} y1={scY - 11.5} x2={scL + scW * 0.56 + 7.5} y2={scY - 11.5} stroke="#7C3AED" strokeWidth={1.5} />
            </g>
          );
        })()}

        {/* 맨홀 M1..M3 */}
        {designRes.manholes.map((mh) => (
          <g key={mh.tag}>
            <circle cx={cx} cy={yPx(mh.elevationMm)} r={4.5} fill="#FEF3C7" stroke="#B45309" strokeWidth={1.4} />
            <text x={cx + 7} y={yPx(mh.elevationMm) + 2.5} fontSize={7.2} fontWeight={900} fill="#B45309" fontFamily={MONO}>
              {mh.tag}
            </text>
          </g>
        ))}

        {/* 노즐 N1..N6 정확 고도 콜아웃 */}
        {designRes.nozzles.map((nz) => {
          const ny = yPx(nz.elevationMm);
          if (nz.nozzleTag === 'N1') {
            return (
              <g key="N1">
                <line x1={cx} y1={ttlY - headDepthR} x2={cx} y2={ny - 6} stroke="#1D4ED8" strokeWidth={2.2} />
                <text x={cx + 8} y={ny - 6} fontSize={8.2} fontWeight={900} fill="#1D4ED8" fontFamily={MONO}>
                  N1 {nz.selectedDn} (+{nz.elevationMm})
                </text>
              </g>
            );
          }
          if (nz.nozzleTag === 'N4') {
            return (
              <g key="N4">
                <line x1={cx} y1={btlY + headDepthS} x2={cx + 42} y2={gradeY + 12} stroke="#0F172A" strokeWidth={2} />
                <text x={cx + 46} y={gradeY + 15} fontSize={8.2} fontWeight={900} fill="#0F172A" fontFamily={MONO}>
                  N4 {nz.selectedDn} (+{nz.elevationMm})
                </text>
              </g>
            );
          }
          const isLeft = nz.orientationDeg === 270;
          const xEdge = ny <= rectBotY ? (isLeft ? rectLeft : rectRight) : (isLeft ? stripLeft : stripRight);
          const xOut = isLeft ? xEdge - 24 : xEdge + 24;
          const clr = nz.nozzleTag === 'N7' ? '#7C3AED' : nz.nozzleTag === 'N3' ? '#DC2626' : nz.nozzleTag === 'N2' ? '#059669' : '#B91C1C';
          return (
            <g key={nz.nozzleTag}>
              <line x1={xEdge} y1={ny} x2={xOut} y2={ny} stroke={clr} strokeWidth={2.2} />
              <line x1={xOut} y1={ny - 4} x2={xOut} y2={ny + 4} stroke={clr} strokeWidth={2} />
              <text
                x={isLeft ? xOut - 4 : xOut + 4}
                y={ny + 3}
                textAnchor={isLeft ? 'end' : 'start'}
                fontSize={8}
                fontWeight={900}
                fill={clr}
                fontFamily={MONO}
              >
                {nz.nozzleTag} {nz.selectedDn.split(' ')[0]} (+{nz.elevationMm})
              </text>
            </g>
          );
        })}

        {/* 우측 치수선 체인: T/T & Skirt & OAL */}
        <line x1={408} y1={ttlY} x2={408} y2={btlY} stroke="#4338CA" strokeWidth={1.3} />
        <line x1={403} y1={ttlY} x2={413} y2={ttlY} stroke="#4338CA" strokeWidth={1.3} />
        <line x1={403} y1={btlY} x2={413} y2={btlY} stroke="#4338CA" strokeWidth={1.3} />
        <text x={415} y={(ttlY + btlY) / 2} transform={`rotate(-90, 415, ${(ttlY + btlY) / 2})`} textAnchor="middle" fontSize={8.5} fontWeight={900} fill="#4338CA" fontFamily={MONO}>
          H_T/T = {(elMap.ttlElMm - elMap.btlElMm).toLocaleString()} mm
        </text>
        <line x1={438} y1={yPx(elMap.oalElMm)} x2={438} y2={gradeY} stroke="#DC2626" strokeWidth={1.3} />
        <line x1={433} y1={yPx(elMap.oalElMm)} x2={443} y2={yPx(elMap.oalElMm)} stroke="#DC2626" strokeWidth={1.3} />
        <line x1={433} y1={gradeY} x2={443} y2={gradeY} stroke="#DC2626" strokeWidth={1.3} />
        <text x={446} y={(yPx(elMap.oalElMm) + gradeY) / 2} transform={`rotate(-90, 446, ${(yPx(elMap.oalElMm) + gradeY) / 2})`} textAnchor="middle" fontSize={8.5} fontWeight={900} fill="#DC2626" fontFamily={MONO}>
          O.A.L. = {elMap.oalElMm.toLocaleString()} mm (Skirt {elMap.btlElMm}mm)
        </text>

        {/* 우측 하단/상단: SECTION A-A 평면 상세 */}
        <text x={478} y={24} fontSize={12} fontWeight={900} fill="#0F172A">
          {isTray
            ? (isEn
                ? `SECTION A-A: ${activePasses}-Pass Tray Plan & Hydraulic Dimensions`
                : `SECTION A-A: ${activePasses}-Pass 트레이 평면 & 수력 치수 상세`)
            : (isEn
                ? `SECTION A-A: Distributor (LD-1) & Bed Hardware Stack`
                : `SECTION A-A: 분배기(LD-1) · 베드 하드웨어 스택 상세`)}
        </text>
        <text x={478} y={40} fontSize={9.4} fontWeight={700} fill="#475569" fontFamily={MONO}>
          {isTray
            ? `Spacing=${designRes.traySpacingMm}mm · Øh=${designRes.stripping.holeDiameterMm}mm · ${isEn ? 'Open' : '개공'}=${designRes.stripping.openAreaPctOfActive}% · hw=${designRes.stripping.weirHeightMm}mm · hap=${designRes.stripping.dcClearanceMm}mm`
            : `${designRes.packingSpec.name} (${designRes.packingSpec.nominalSizeLabel || ''})`}
        </text>

        {isTray ? (
          <g>
            <circle cx={planCx} cy={planCy} r={planR} fill="#F8FAFC" stroke="#1E293B" strokeWidth={2.4} />
            <circle cx={planCx} cy={planCy} r={planR - 4} fill="#EEF2FF" />
            <clipPath id="trayCircleClip">
              <circle cx={planCx} cy={planCy} r={planR - 1} />
            </clipPath>
            <g clipPath="url(#trayCircleClip)">
              <rect x={planCx - planR} y={planCy - planR} width={planR - dcChordOffset} height={planR * 2} fill="#BFDBFE" opacity={0.78} />
              <rect x={planCx + dcChordOffset} y={planCy - planR} width={planR - dcChordOffset} height={planR * 2} fill="#93C5FD" />
              {activePasses >= 2 && (
                <rect x={planCx - 9} y={planCy - planR} width={18} height={planR * 2} fill="#93C5FD" stroke="#1D4ED8" strokeWidth={1.2} />
              )}
              <line x1={planCx + dcChordOffset} y1={planCy - planR} x2={planCx + dcChordOffset} y2={planCy + planR} stroke="#1D4ED8" strokeWidth={2.2} />
              <line x1={planCx - dcChordOffset} y1={planCy - planR} x2={planCx - dcChordOffset} y2={planCy + planR} stroke="#64748B" strokeWidth={1.4} strokeDasharray="3 2" />
            </g>
            {[-36, -18, 0, 18, 36].map((dy) =>
              [-28, -10, 10, 28].map((dx) => {
                if (activePasses >= 2 && Math.abs(dx) < 13) return null;
                return (
                  <circle
                    key={`h-${dx}-${dy}`}
                    cx={planCx + dx}
                    cy={planCy + dy}
                    r={designRes.trayType === 'sieve' ? 2.0 : 3.0}
                    fill={designRes.trayType === 'sieve' ? '#4338CA' : '#FFFFFF'}
                    stroke="#4338CA"
                    strokeWidth={1.1}
                  />
                );
              })
            )}
            <text x={planCx + dcChordOffset + 4} y={planCy + 3} fontSize={8} fontWeight={900} fill="#1E3A8A">DC</text>
            {/* 우측 트레이 수치 카드 */}
            <rect x={706} y={76} width={198} height={184} rx={6} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={1.2} />
            <text x={716} y={96} fontSize={9.6} fontWeight={900} fill="#3730A3">{isEn ? 'Tray Dimensions (mm)' : '트레이 상세 치수 (mm)'}</text>
            <text x={716} y={115} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Passes' : '패스'}: {activePasses}-Pass (FPL {Math.round(designRes.stripping.flowPathLengthM * 1000)}mm)</text>
            <text x={716} y={132} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Spacing' : '단간격'}: {designRes.traySpacingMm} mm</text>
            <text x={716} y={149} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Hole/Valve' : '홀/밸브'}: Ø{designRes.stripping.holeDiameterMm} @ {designRes.stripping.holePitchMm}mm</text>
            <text x={716} y={166} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Open Area' : '개공비'}: {designRes.stripping.openAreaPctOfActive}% Aa ({designRes.stripping.openAreaPctOfTower}% AT)</text>
            <text x={716} y={183} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Weir' : '위어'}: hw={designRes.stripping.weirHeightMm} / Lw={designRes.stripping.weirLengthMm}</text>
            <text x={716} y={200} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'DC Width' : 'DC폭'}: {designRes.stripping.dcWidthTopMm}/{designRes.stripping.dcWidthBotMm} (Ad {designRes.stripping.dcAreaPctOfTower}%)</text>
            <text x={716} y={217} fontSize={8.8} fontWeight={700} fill="#1E293B" fontFamily={MONO}>• {isEn ? 'Clearance' : '틈새'} hap: {designRes.stripping.dcClearanceMm} mm</text>
            <text x={716} y={238} fontSize={8.8} fontWeight={900} fill="#047857" fontFamily={MONO}>• {isEn ? 'Op. Window' : '운전범위'}: {designRes.operatingLoadMinPct}~{designRes.operatingLoadMaxPct}% ({designRes.minTurndownRatio}:1)</text>
          </g>
        ) : (
          <g>
            <rect x={478} y={64} width={426} height={224} rx={8} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={1.3} />
            <text x={691} y={84} textAnchor="middle" fontSize={10} fontWeight={900} fill="#0F766E">
              {isEn
                ? 'Packed Column Internals Hardware Stack (Top → Bottom)'
                : '패킹 컬럼 내부 하드웨어 조립 스택 (Top → Bottom)'}
            </text>
            {[
              {
                y: 94,
                title: isEn
                  ? `1. Demister Pad (${designRes.packingHardware.demister.tag}) @ EL +${designRes.packingHardware.demister.elevationMm} mm`
                  : `1. 미스트 제거기 (${designRes.packingHardware.demister.tag}) @ EL +${designRes.packingHardware.demister.elevationMm} mm`,
                sub: `${designRes.packingHardware.demister.type} (${designRes.packingHardware.demister.thicknessMm}mmt)`,
              },
              {
                y: 132,
                title: isEn
                  ? `2. Top Liquid Distributor (${designRes.packingHardware.topDistributor.tag}) @ EL +${designRes.packingHardware.topDistributor.elevationMm} mm`
                  : `2. 상부 액체 분배기 (${designRes.packingHardware.topDistributor.tag}) @ EL +${designRes.packingHardware.topDistributor.elevationMm} mm`,
                sub: isEn
                  ? `Drip ${designRes.packingHardware.topDistributor.dripPointsPerM2} pts/m² (${designRes.packingHardware.topDistributor.totalDripPoints} pts) · ${designRes.packingHardware.topDistributor.type}`
                  : `점적 ${designRes.packingHardware.topDistributor.dripPointsPerM2} pts/m² (총 ${designRes.packingHardware.topDistributor.totalDripPoints}공) · ${designRes.packingHardware.topDistributor.type}`,
              },
              {
                y: 170,
                title: isEn
                  ? `3. Hold-Down Grid (${designRes.packingHardware.holdDownGrids.count} EA) & ${designRes.packedBedCount} Packed Beds`
                  : `3. 홀드다운 그리드(${designRes.packingHardware.holdDownGrids.count}EA) & ${designRes.packedBedCount}개 충진 베드`,
                sub: isEn
                  ? `Total Bed ${designRes.totalPackedHeightM}m · Rect HETP ${designRes.rectifying.hetpAvgM}m / Strip ${designRes.stripping.hetpAvgM}m`
                  : `총 충진고 ${designRes.totalPackedHeightM}m · 정류 HETP ${designRes.rectifying.hetpAvgM}m / 스 ${designRes.stripping.hetpAvgM}m`,
              },
              {
                y: 208,
                title: isEn
                  ? `4. Redistributors (${designRes.packingHardware.redistributors.count} EA) & Support Plates (${designRes.packingHardware.supportPlates.count} EA)`
                  : `4. 중간 재분배기(${designRes.packingHardware.redistributors.count}EA) & 지지판(${designRes.packingHardware.supportPlates.count}EA)`,
                sub: isEn
                  ? `Support Open ${designRes.packingHardware.supportPlates.freeAreaPct}% · Min Wetting MWR=${designRes.packingSpec.minWettingM3M2H} m³/m²h`
                  : `지지판 개구 ${designRes.packingHardware.supportPlates.freeAreaPct}% · 적심 MWR=${designRes.packingSpec.minWettingM3M2H} m³/m²h`,
              },
              {
                y: 246,
                title: isEn
                  ? `5. Operating Range ${designRes.operatingLoadMinPct}% ~ ${designRes.operatingLoadMaxPct}% (Turndown ${designRes.minTurndownRatio}:1)`
                  : `5. 운전범위 ${designRes.operatingLoadMinPct}% ~ ${designRes.operatingLoadMaxPct}% (Turndown ${designRes.minTurndownRatio}:1)`,
                sub: isEn
                  ? `B-S Flood ${designRes.maxFloodPct}% · Holdup h_L=${designRes.avgPackedHoldupPct}% · ΔP=${designRes.totalInternalsDpMbar} mbar`
                  : `B-S Flood ${designRes.maxFloodPct}% · 홀드업 h_L=${designRes.avgPackedHoldupPct}% · ΔP=${designRes.totalInternalsDpMbar} mbar`,
              },
            ].map((b, idx) => (
              <g key={idx}>
                <rect x={488} y={b.y} width={406} height={33} rx={5} fill="#FFFFFF" stroke="#99F6E4" strokeWidth={1.1} />
                <text x={496} y={b.y + 13} fontSize={8.7} fontWeight={900} fill="#0F172A" fontFamily={MONO}>{b.title}</text>
                <text x={496} y={b.y + 26} fontSize={8.1} fontWeight={600} fill="#475569">{b.sub}</text>
              </g>
            ))}
          </g>
        )}

        {/* 우측 하단: 본체 기계·원가·노즐 요약 박스 */}
        <rect x={478} y={302} width={426} height={294} rx={7} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={1.3} />
        <text x={490} y={322} fontSize={10.4} fontWeight={900} fill="#1E293B">
          {isEn
            ? 'Vessel Mechanical · Nozzle EL · Cost CAD Summary'
            : '본체 기계사양 · 노즐 EL · 장치원가 CAD 타이틀 블록'}
        </text>
        <text x={490} y={341} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'ASME Design P/T' : 'ASME 설계 P/T'}: {designRes.designPressBarG.toFixed(1)} barG / {designRes.designTempC.toFixed(0)} °C (CA {mech.corrosionAllowanceMm}mm)
        </text>
        <text x={490} y={358} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Shell/Head/Skirt' : '동체/경판/스커트'}: {mech.selectedShellMm}t / {mech.selectedHeadMm}t / {mech.skirtThicknessMm}t ({designRes.recommendedMaterialCode})
        </text>
        <text x={490} y={375} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Empty/Oper/Hydro Wt' : '공탑/운전/만수 중량'}: {designRes.estimatedDryWeightTon} / {(mech.operatingWeightKN / 9.80665).toFixed(1)} / {(mech.hydrotestWeightKN / 9.80665).toFixed(1)} ton
        </text>
        <text x={490} y={392} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Main Nozzles' : '주요 노즐'}: N1 {nzByTag.N1?.selectedDn.split(' ')[0]} · N2 {nzByTag.N2?.selectedDn.split(' ')[0]} · N3 {nzByTag.N3?.selectedDn.split(' ')[0]} · N4 {nzByTag.N4?.selectedDn.split(' ')[0]}{nzByTag.N7 ? ` · N7 ${nzByTag.N7.selectedDn.split(' ')[0]}` : ''}
        </text>
        <text x={490} y={409} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Reboiler Nozzles' : '리보일러 노즐'}: N5 {nzByTag.N5?.selectedDn.split(' ')[0]} (+{nzByTag.N5?.elevationMm}) · N6 {nzByTag.N6?.selectedDn.split(' ')[0]} (+{nzByTag.N6?.elevationMm})
        </text>
        <text x={490} y={426} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Manholes (180°)' : '맨홀(180°)'}: {designRes.manholes.map((m) => `${m.tag}(+${m.elevationMm})`).join(' · ')}
        </text>
        <text x={490} y={443} fontSize={9.1} fontWeight={700} fill="#334155" fontFamily={MONO}>
          • {isEn ? 'Vacuum Stiffeners' : '외압 보강링'}: {mech.stiffenerCount > 0 ? `${mech.stiffenerCount}EA (${mech.stiffenerSection} @ ${mech.stiffenerSpacingM}m)` : (isEn ? 'Not Required (UG-28 OK)' : '무보강 안전 (UG-28 OK)')}
        </text>
        <text x={490} y={462} fontSize={9.4} fontWeight={900} fill="#047857" fontFamily={MONO}>
          • {isEn ? `Bare-Module Cost (C_BM): $${cost.bareModuleUsd.toLocaleString()}` : `설치원가(C_BM): $${cost.bareModuleUsd.toLocaleString()} (${formatKrwReadable(cost.bareModuleKrw)})`}
        </text>

        {/* 하단 CAD 표제란 */}
        <rect x={488} y={482} width={406} height={102} rx={4} fill="#FFFFFF" stroke="#475569" strokeWidth={1.2} />
        <line x1={488} y1={514} x2={894} y2={514} stroke="#94A3B8" strokeWidth={1} />
        <line x1={488} y1={548} x2={894} y2={548} stroke="#94A3B8" strokeWidth={1} />
        <text x={691} y={502} textAnchor="middle" fontSize={10.2} fontWeight={900} fill="#0F172A">
          CHEMENG STUDIO EPC CAD — COLUMN GA &amp; INTERNALS
        </text>
        <text x={498} y={534} fontSize={9} fontWeight={800} fill="#334155" fontFamily={MONO}>
          TAG: {unitTag} | {isTray ? 'TRAYED COLUMN' : 'PACKED COLUMN'} | REV 0
        </text>
        <text x={498} y={569} fontSize={8.6} fontWeight={700} fill="#475569" fontFamily={MONO}>
          SCALE: PROPORTIONAL EL (UNIT: MM) | CODE: ASME VIII-1 / FRI
        </text>
      </svg>
    );
  };

  // ── 2) 단별 % Flood & ΔP 수력학 프로파일 차트 SVG ──
  const renderHydraulicProfileSvg = () => {
    const rows = designRes.stageRows;
    const W = 600;
    const H = 320;
    const padL = 52;
    const padR = 54;
    const padT = 26;
    const padB = 36;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxFloodAxis = Math.max(100, Math.ceil(designRes.maxFloodPct / 10) * 10);
    const maxDpAxis = Math.max(10, ...rows.map((r) => r.dpMbar * 1.25));

    const xOf = (idx: number) =>
      rows.length <= 1 ? padL + plotW / 2 : padL + (idx / (rows.length - 1)) * plotW;
    const yFlood = (f: number) => padT + plotH * (1 - Math.min(maxFloodAxis, Math.max(0, f)) / maxFloodAxis);
    const yDp = (dp: number) => padT + plotH * (1 - Math.min(maxDpAxis, Math.max(0, dp)) / maxDpAxis);

    const floodPts = rows.map((r, i) => `${xOf(i).toFixed(1)},${yFlood(r.floodPct).toFixed(1)}`).join(' ');
    const subFloodPts = rows
      .map((r, i) => `${xOf(i).toFixed(1)},${yFlood(isTray ? r.dcChokeFloodPct : r.gpdcFloodPct).toFixed(1)}`)
      .join(' ');
    const dpPts = rows.map((r, i) => `${xOf(i).toFixed(1)},${yDp(r.dpMbar).toFixed(1)}`).join(' ');

    const feedIdx = rows.findIndex((r) => r.stage >= simResult.feedStageUsed);

    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: isMobile ? 'auto' : 315,
          aspectRatio: isMobile ? `${W} / ${H}` : undefined,
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 8,
          display: 'block',
        }}
      >
        <rect
          x={padL}
          y={yFlood(82)}
          width={plotW}
          height={Math.max(2, yFlood(50) - yFlood(82))}
          fill="#ECFDF5"
          opacity={0.75}
        />
        <line
          x1={padL}
          y1={yFlood(85)}
          x2={W - padR}
          y2={yFlood(85)}
          stroke="#DC2626"
          strokeWidth={1.4}
          strokeDasharray="5 3"
        />
        <text x={padL + 6} y={yFlood(85) - 4} fontSize={9} fontWeight={900} fill="#DC2626">
          {isEn ? 'Flooding Design Limit (85% Flood)' : '범람 설계상한 (85% Flood)'}
        </text>

        {feedIdx >= 0 && (
          <>
            <line
              x1={xOf(feedIdx)}
              y1={padT}
              x2={xOf(feedIdx)}
              y2={H - padB}
              stroke="#7C3AED"
              strokeWidth={1.3}
              strokeDasharray="3 3"
            />
            <text x={xOf(feedIdx) + 4} y={padT + 11} fontSize={9} fontWeight={800} fill="#6D28D9">
              {isEn ? `Feed Stage #${simResult.feedStageUsed}` : `Feed #${simResult.feedStageUsed}단`}
            </text>
          </>
        )}

        {[0, 25, 50, 75, 100].map((v) => {
          if (v > maxFloodAxis) return null;
          const yy = yFlood(v);
          return (
            <g key={`fy-${v}`}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#E2E8F0" strokeWidth={0.8} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize={9.5} fontWeight={700} fill="#1D4ED8" fontFamily={MONO}>
                {v}%
              </text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
          const val = maxDpAxis * frac;
          const yy = yDp(val);
          return (
            <text
              key={`dy-${idx}`}
              x={W - padR + 6}
              y={yy + 3}
              fontSize={9.5}
              fontWeight={700}
              fill="#D97706"
              fontFamily={MONO}
            >
              {val.toFixed(1)}
            </text>
          );
        })}

        {rows.map((r, i) => {
          const step = Math.max(1, Math.ceil(rows.length / 10));
          if (i % step !== 0 && i !== rows.length - 1) return null;
          return (
            <text
              key={`sx-${r.stage}`}
              x={xOf(i)}
              y={H - padB + 15}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={700}
              fill="#334155"
              fontFamily={MONO}
            >
              #{r.stage}
            </text>
          );
        })}

        <polyline fill="none" stroke="#2563EB" strokeWidth={2.4} points={floodPts} />
        <polyline fill="none" stroke="#0D9488" strokeWidth={1.6} strokeDasharray="2 2" points={subFloodPts} />
        <polyline fill="none" stroke="#D97706" strokeWidth={2.0} strokeDasharray="4 2" points={dpPts} />

        {rows.map((r, i) => (
          <circle
            key={`pt-${r.stage}`}
            cx={xOf(i)}
            cy={yFlood(r.floodPct)}
            r={r.stage === designRes.maxFloodStage ? 4.5 : 2.6}
            fill={r.floodPct >= 85 ? '#DC2626' : '#2563EB'}
          />
        ))}

        <text x={padL} y={15} fontSize={9.5} fontWeight={900} fill="#1D4ED8">
          {isEn
            ? `● Governing Flood% (${isTray ? 'Teal Dash: DC Choke%' : 'Teal Dash: GPDC Check%'})`
            : `● 지배 Flood% (${isTray ? '청록점선: DC초크%' : '청록점선: GPDC 교차검증%'})`}
        </text>
        <text x={W - padR} y={15} textAnchor="end" fontSize={9.5} fontWeight={900} fill="#B45309">
          {isEn ? '-- Orange Dash: Stage ΔP (mbar)' : '-- 주황점선: 단당 ΔP (mbar)'}
        </text>
        <text x={W / 2} y={H - 5} textAnchor="middle" fontSize={10} fontWeight={800} fill="#475569">
          {isEn
            ? `Internal Stage Number (Stage 2 = Top Tray → Stage ${simResult.totalStagesUsed - 1} = Bottom)`
            : `탑 내부 단 번호 (Stage 2 = 상부 1단 → Stage ${simResult.totalStagesUsed - 1} = 최하단)`}
        </text>
      </svg>
    );
  };

  // ── 4) 기계설계(ASME VIII-1) · 풍/지진 · 장치원가(Turton/Guthrie) 탭 ──
  const renderMechanicalAndCostTab = () => {
    const condBmKrw = designRes.auxiliaries.condenserCost?.bareModuleKrw ?? 0;
    const rebBmKrw = designRes.auxiliaries.reboilerCost?.bareModuleKrw ?? 0;
    const totalSystemBmKrw = cost.bareModuleKrw + condBmKrw + rebBmKrw;
    const totalSystemBmUsd =
      cost.bareModuleUsd +
      (designRes.auxiliaries.condenserCost?.bareModuleUsd ?? 0) +
      (designRes.auxiliaries.reboilerCost?.bareModuleUsd ?? 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 4-1. ASME VIII Div.1 내압/외압 두께 & 보강링 요약 */}
        <div style={cardBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
              {isEn
                ? '🛡️ ASME Sec. VIII Div.1 Shell/Head Thickness & External Pressure (UG-28/29)'
                : '🛡️ ASME Sec. VIII Div.1 동체·경판 두께 및 외압(UG-28/29) 검토'}
            </div>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: '#EEF2FF',
                border: '1px solid #C7D2FE',
                color: '#3730A3',
                fontSize: 9.8,
                fontWeight: 900,
              }}
            >
              {isEn ? 'Governing' : '지배 조건'}: {governingCaseLabel(mech.governingCase, isEn)} · MAWP {mech.mawpMpaG} MPa(g)
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
              gap: 7,
            }}
          >
            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569' }}>{isEn ? 'Selected Shell / Head Thick.' : '채택 동체 / 경판 두께'}</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 2 }}>
                {mech.selectedShellMm} mm / {mech.selectedHeadMm} mm
              </div>
              <div style={{ fontSize: 9, color: '#64748B' }}>
                CA={mech.corrosionAllowanceMm}mm · Ej={mech.jointEfficiency}
              </div>
            </div>

            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569' }}>{isEn ? 'Required Thick. (Int / Ext / Comb)' : '소요 두께 (내압 / 외압 / 조합)'}</div>
              <div style={{ fontSize: 12.2, fontWeight: 900, color: '#1E3A8A', fontFamily: MONO, marginTop: 2 }}>
                {mech.shellInternalReqMm} / {mech.shellExternalReqMm || '-'} / {mech.combinedLoadReqMm || '-'} mm
              </div>
              <div style={{ fontSize: 9, color: '#64748B' }}>
                {isEn ? 'Allow. Stress' : '허용응력'} S={mech.allowStressMpa} MPa · E={Math.round(mech.elasticModulusMpa / 1000)} GPa
              </div>
            </div>

            <div style={{ padding: '6px 8px', borderRadius: 6, background: mech.stiffenerCount > 0 ? '#FFFBEB' : '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569' }}>{isEn ? 'UG-28/29 Vacuum Stiffeners' : 'UG-28/29 진공 보강링'}</div>
              <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 2 }}>
                {mech.stiffenerCount > 0
                  ? (isEn ? `${mech.stiffenerCount} Rings @ ${mech.stiffenerSpacingM}m` : `${mech.stiffenerCount}개 @ ${mech.stiffenerSpacingM}m`)
                  : (isEn ? 'Not Required' : '보강링 불요')}
              </div>
              <div style={{ fontSize: 9, color: '#64748B' }}>
                {mech.externalPressMpa > 0
                  ? `${mech.stiffenerSection} (Pa=${mech.ug28AllowableMpa} MPa)`
                  : (isEn ? 'Internal Press. Only (No Ext.)' : '내압 운전 (외압 미적용)')}
              </div>
            </div>

            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569' }}>{isEn ? 'UG-99(b) Hydrotest Press.' : 'UG-99(b) 수압시험 압력'}</div>
              <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F766E', fontFamily: MONO, marginTop: 2 }}>
                {isEn
                  ? `Top ${mech.hydrotestPressMpaG} / Bot ${mech.hydrotestPressBottomMpaG} MPa`
                  : `탑정 ${mech.hydrotestPressMpaG} / 탑저 ${mech.hydrotestPressBottomMpaG} MPa`}
              </div>
              <div style={{ fontSize: 9, color: '#64748B' }}>
                {isEn
                  ? `Empty ${(mech.emptyWeightKN / 9.80665).toFixed(1)}t · Oper ${(mech.operatingWeightKN / 9.80665).toFixed(1)}t · Hydro ${(mech.hydrotestWeightKN / 9.80665).toFixed(1)}t`
                  : `공탑 ${(mech.emptyWeightKN / 9.80665).toFixed(1)}t · 운전 ${(mech.operatingWeightKN / 9.80665).toFixed(1)}t · 충수 ${(mech.hydrotestWeightKN / 9.80665).toFixed(1)}t`}
              </div>
            </div>
          </div>
        </div>

        {/* 4-2. ASCE 7 풍하중 · 지진하중 · 스커트/앵커볼트 & 기부 응력 이용률 */}
        <div style={cardBox}>
          <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
            {isEn
              ? '🌪️ ASCE 7 Wind · Seismic · Skirt/Anchor Bolts & Base Axial Stress Utilization'
              : '🌪️ ASCE 7 풍하중 · 지진하중 · 스커트/앵커볼트 및 기부 축응력 가동률'}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
              gap: 7,
              marginBottom: 8,
            }}
          >
            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#334155' }}>
                {isEn
                  ? `Wind Load (V=${formatCanonicalValue('velocity', ic.windSpeedMS ?? 38, velUnit, 1)} ${getUnitLabel('velocity', velUnit)})`
                  : `풍하중 (Wind · V=${formatCanonicalValue('velocity', ic.windSpeedMS ?? 38, velUnit, 1)} ${getUnitLabel('velocity', velUnit)})`}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 2 }}>
                {isEn
                  ? `Shear ${mech.windBaseShearKN} kN · Moment ${mech.windBaseMomentKNm} kN·m`
                  : `전단 ${mech.windBaseShearKN} kN · 모멘트 ${mech.windBaseMomentKNm} kN·m`}
              </div>
            </div>
            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#334155' }}>
                {isEn ? 'Seismic Load' : '지진하중'} (Tn={mech.seismicPeriodS}s · Cs={mech.seismicCs})
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 2 }}>
                {isEn
                  ? `Shear ${mech.seismicBaseShearKN} kN · Moment ${mech.seismicBaseMomentKNm} kN·m`
                  : `전단 ${mech.seismicBaseShearKN} kN · 모멘트 ${mech.seismicBaseMomentKNm} kN·m`}
              </div>
            </div>
            <div style={{ padding: '6px 8px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#334155' }}>
                {isEn ? 'Skirt · Base Ring · Anchor Bolts' : '스커트 · 베이스링 · 앵커볼트'}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: '#1E3A8A', fontFamily: MONO, marginTop: 2 }}>
                {isEn
                  ? `Skirt ${mech.skirtThicknessMm}t · ${mech.anchorBoltCount}-${mech.anchorBoltSize} (${mech.anchorTensionPerBoltKN}kN/bolt)`
                  : `스커트 ${mech.skirtThicknessMm}t · ${mech.anchorBoltCount}-${mech.anchorBoltSize} (${mech.anchorTensionPerBoltKN}kN/볼트)`}
              </div>
              <div style={{ fontSize: 9, color: '#64748B' }}>
                {isEn
                  ? `Base Ring ${mech.baseRingThicknessMm}t (Concrete Bearing ${mech.concreteBearingMpa} MPa)`
                  : `베이스링 ${mech.baseRingThicknessMm}t (콘크리트 지압 ${mech.concreteBearingMpa} MPa)`}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 530, borderCollapse: 'collapse', fontSize: 10.3 }}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Load Combination Case' : '하중 조합 케이스'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Windward Tensile (MPa)' : '풍상측 인장 (MPa)'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Tensile Util.' : '인장 이용률'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Leeward Comp. (MPa)' : '풍하측 압축 (MPa)'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Comp. Util.' : '압축 이용률'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'center' }}>{isEn ? 'Status' : '판정'}</th>
                </tr>
              </thead>
              <tbody>
                {mech.loadCases.map((lc, idx) => {
                  const tenUtil = Math.max(0, (lc.windwardTensileMpa / Math.max(1, lc.allowTensileMpa)) * 100);
                  const compUtil = Math.max(0, (lc.leewardCompressiveMpa / Math.max(1, lc.allowCompressiveMpa)) * 100);
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '4px 6px', fontWeight: 800, color: '#0F172A' }}>{lc.label}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>
                        {lc.windwardTensileMpa} / {lc.allowTensileMpa}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 800 }}>
                        {tenUtil.toFixed(1)}%
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>
                        {lc.leewardCompressiveMpa} / {lc.allowCompressiveMpa}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: compUtil > 90 ? '#B45309' : '#0F172A' }}>
                        {compUtil.toFixed(1)}%
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '1.5px 6px',
                            borderRadius: 999,
                            background: lc.ok ? '#DCFCE7' : '#FEE2E2',
                            color: lc.ok ? '#065F46' : '#991B1B',
                            fontSize: 9.2,
                            fontWeight: 900,
                          }}
                        >
                          {lc.ok ? (isEn ? 'OK' : '적합') : (isEn ? 'Reinforce' : '보강필요')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4-3. UG-37 노즐 보강 테이블 */}
        <div style={cardBox}>
          <div style={{ fontSize: 11.2, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
            {isEn
              ? '🔩 ASME UG-37 Nozzle Opening Reinforcement (Area Replacement)'
              : '🔩 ASME UG-37 개구부 노즐 보강(면적치환법) 검토'}
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 10.2 }}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>{isEn ? 'Nozzle' : '노즐'}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{isEn ? 'ID d (mm)' : '내경 d (mm)'}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{isEn ? 'Req. Area A_req (mm²)' : '소요 보강면적 A_req (mm²)'}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{isEn ? 'Avail. Area A_avail (mm²)' : '유효 여유면적 A_avail (mm²)'}</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>{isEn ? 'Reinforcing Pad (W×t)' : '보강판 규격 (폭×두께)'}</th>
                </tr>
              </thead>
              <tbody>
                {mech.nozzleReinforcement.map((nr) => (
                  <tr key={nr.tag} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '4px 6px', fontWeight: 900, color: '#4338CA', fontFamily: MONO }}>{nr.tag}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>{nr.idMm.toFixed(1)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>{nr.areaRequiredMm2.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>{nr.areaAvailableMm2.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: nr.padRequired ? '#B45309' : '#065F46' }}>
                      {nr.padRequired
                        ? (isEn ? `Pad ${nr.padWidthMm}W × ${nr.padThicknessMm}t` : `보강판 ${nr.padWidthMm}W × ${nr.padThicknessMm}t`)
                        : (isEn ? 'Self-Reinforced by Shell' : '동체 여유두께 자체만족')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4-4. Guthrie / Turton 형상 기반 Bare-Module 장치원가 명세 */}
        <div style={cardBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: '#065F46' }}>
              {isEn
                ? `💰 Geometry-Based Equipment Cost (Turton / Towler–Sinnott · CEPCI=${cost.cepciUsed} · ${cost.fxKrwPerUsd.toLocaleString()} KRW/$)`
                : `💰 형상 기반 장치원가 산출 (Turton / Towler–Sinnott · CEPCI=${cost.cepciUsed} · ${cost.fxKrwPerUsd.toLocaleString()}원/$)`}
            </div>
            <span style={{ fontSize: 9.8, fontWeight: 800, color: '#475569', fontFamily: MONO }}>
              FM={cost.factors.fmVessel} · FP={cost.factors.fpVessel} · FBM={cost.factors.fbmVessel}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ padding: '7px 9px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#475569' }}>
                {isEn ? 'Column Shell & Internals Purchase (FOB Cp)' : '컬럼 본체·인터널 구입가 (FOB Cp)'}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 2 }}>
                {isEn ? `$${cost.totalPurchaseUsd.toLocaleString()} USD` : formatKrwReadable(cost.totalPurchaseKrw)}
              </div>
              <div style={{ fontSize: 9.5, color: '#64748B', fontFamily: MONO }}>
                {isEn ? formatKrwReadable(cost.totalPurchaseKrw) : `$${cost.totalPurchaseUsd.toLocaleString()} USD`}
              </div>
            </div>

            <div style={{ padding: '7px 9px', borderRadius: 6, background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#065F46' }}>
                {isEn ? 'Column Bare-Module Cost (C_BM)' : '컬럼 Bare-Module 설치원가 (C_BM)'}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#064E3B', fontFamily: MONO, marginTop: 2 }}>
                {isEn ? `$${cost.bareModuleUsd.toLocaleString()} USD` : formatKrwReadable(cost.bareModuleKrw)}
              </div>
              <div style={{ fontSize: 9.5, color: '#047857', fontFamily: MONO }}>
                {isEn
                  ? `Total Module C_TM $${cost.totalModuleUsd.toLocaleString()} (${formatKrwReadable(cost.bareModuleKrw)})`
                  : `$${cost.bareModuleUsd.toLocaleString()} USD (예비비포함 C_TM ${formatKrwReadable(cost.totalModuleKrw)})`}
              </div>
            </div>

            <div style={{ padding: '7px 9px', borderRadius: 6, background: '#EFF6FF', border: '1px solid #93C5FD' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#1E40AF' }}>
                {isEn ? 'Total Distillation System (Col + Cond + Reb C_BM)' : '증류 시스템 합계 (탑+응축기+리보일러 C_BM)'}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#1E3A8A', fontFamily: MONO, marginTop: 2 }}>
                {isEn ? `$${totalSystemBmUsd.toLocaleString()} USD` : formatKrwReadable(totalSystemBmKrw)}
              </div>
              <div style={{ fontSize: 9.5, color: '#1D4ED8', fontFamily: MONO }}>
                {isEn ? formatKrwReadable(totalSystemBmKrw) : `$${totalSystemBmUsd.toLocaleString()} USD`}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 540, borderCollapse: 'collapse', fontSize: 10.3 }}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Cost Line Item' : '원가 구성 항목'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Calculation Basis' : '산출 근거'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Purchase Cp (USD)' : '구입원가 Cp (USD)'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Bare-Module C_BM (USD)' : '설치원가 C_BM (USD)'}</th>
                  <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Bare-Module C_BM (KRW)' : '설치원가 C_BM (KRW)'}</th>
                </tr>
              </thead>
              <tbody>
                {cost.lineItems.map((li) => (
                  <tr key={li.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '4px 6px', fontWeight: 800, color: '#0F172A' }}>{li.label}</td>
                    <td style={{ padding: '4px 6px', color: '#475569', fontSize: 9.8 }}>{li.basisNote}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>${li.purchaseUsd.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 800 }}>${li.bareModuleUsd.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 900, color: '#065F46' }}>
                      {formatKrwReadable(li.bareModuleKrw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#F1F5F9',
        overflowY: isMobile ? 'auto' : 'hidden',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* ── 상단 6대 핵심 사이징 KPI 요약 바 + 시뮬레이션 역반영 버튼 ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 6 : 8,
          padding: isMobile ? '6px 9px' : '6px 9px',
          background: '#FFFFFF',
          borderBottom: '1px solid #CBD5E1',
          flexWrap: 'nowrap',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))',
            gap: isMobile ? 5 : 6,
            flex: isMobile ? 'none' : 1,
            width: isMobile ? '100%' : undefined,
            minWidth: 0,
          }}
        >
          <div style={{ padding: '4px 7px', borderRadius: 6, background: '#EEF2FF', border: '1px solid #C7D2FE', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#4338CA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isEn ? 'Nominal ID (ØD)' : '공칭 내경 (ØD)'}
              </span>
              <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} />
            </div>
            <div style={{ fontSize: 12.2, fontWeight: 900, color: '#1E1B4B', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isSwaged
                ? `Ø${formatCanonicalValue('length', designRes.rectifying.selectedNominalDiamM, lenUnit, 2)} / Ø${formatCanonicalValue('length', designRes.stripping.selectedNominalDiamM, lenUnit, 2)} ${getUnitLabel('length', lenUnit)}`
                : `Ø${formatCanonicalValue('length', designRes.governingDiamM, lenUnit, 2)} ${getUnitLabel('length', lenUnit)}`}
            </div>
            <div style={{ fontSize: 8.6, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isEn ? 'Min' : '최소'} Ø{formatCanonicalValue('length', Math.max(designRes.rectifying.requiredMinDiamM, designRes.stripping.requiredMinDiamM), lenUnit, 2)} {getUnitLabel('length', lenUnit)}
            </div>
          </div>

          <div
            style={{
              padding: '4px 7px',
              borderRadius: 6,
              background: designRes.maxFloodPct > 85 ? '#FEE2E2' : '#ECFDF5',
              border: `1px solid ${designRes.maxFloodPct > 85 ? '#FCA5A5' : '#6EE7B7'}`,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 800, color: designRes.maxFloodPct > 85 ? '#991B1B' : '#065F46', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isEn ? 'Max Flooding (% Flood)' : '최대 범람율 (% Flood)'}
            </div>
            <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isEn
                ? `${designRes.maxFloodPct.toFixed(1)}% (Stg #${designRes.maxFloodStage})`
                : `${designRes.maxFloodPct.toFixed(1)}% (#${designRes.maxFloodStage}단)`}
            </div>
            <div style={{ fontSize: 8.6, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isTray
                ? `Jet ${designRes.maxJetFloodPct}% · DC ${designRes.maxDcChokeFloodPct}%`
                : `GPDC ${Math.max(designRes.rectifying.gpdcFloodMaxPct, designRes.stripping.gpdcFloodMaxPct)}%`}
            </div>
          </div>

          <div style={{ padding: '4px 7px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isEn ? 'Tower Height (T-T/OAL)' : '탑 높이 (T-T/OAL)'}
              </span>
              <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} />
            </div>
            <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {formatCanonicalValue('length', designRes.tangentToTangentHeightM, lenUnit, 2)} / {formatCanonicalValue('length', designRes.totalElevationM, lenUnit, 2)} {getUnitLabel('length', lenUnit)}
            </div>
            <div style={{ fontSize: 8.6, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isTray
                ? (isEn
                    ? `${designRes.actualTotalTrays} Trays · DC ≥${designRes.minDcResidenceTimeSec}s`
                    : `실제 ${designRes.actualTotalTrays}단 · DC ≥${designRes.minDcResidenceTimeSec}s`)
                : (isEn
                    ? `Packed ${formatCanonicalValue('length', designRes.totalPackedHeightM, lenUnit, 2)}${getUnitLabel('length', lenUnit)} (hL ${designRes.avgPackedHoldupPct}%)`
                    : `충진고 ${formatCanonicalValue('length', designRes.totalPackedHeightM, lenUnit, 2)}${getUnitLabel('length', lenUnit)} (hL ${designRes.avgPackedHoldupPct}%)`)}
            </div>
          </div>

          <div style={{ padding: '4px 7px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isEn ? 'Total Pressure Drop (ΔP)' : '총 압력손실 (ΔP)'}
              </span>
              <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
            </div>
            <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {formatCanonicalValue('deltaP', designRes.totalInternalsDpKgcm2, dpUnit)} {getUnitLabel('deltaP', dpUnit)}
            </div>
            <div style={{ fontSize: 8.6, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{designRes.totalInternalsDpMbar} mbar</div>
          </div>

          <div style={{ padding: '4px 7px', borderRadius: 6, background: '#F8FAFC', border: '1px solid #CBD5E1', minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isTray ? (isEn ? 'Chan–Fair / Turndown' : 'Chan–Fair / 턴다운') : 'B–S HETP / H_OG'}
            </div>
            <div style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isTray
                ? `${designRes.avgChanFairEffPct}% · ${designRes.minTurndownRatio}:1`
                : `${designRes.stripping.hetpAvgM}m / ${designRes.avgPackedHogM}m`}
            </div>
            <div style={{ fontSize: 8.6, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isTray
                ? `O'Connell ${designRes.avgOconnellEffPct}% · ${designRes.stripping.flowPasses}-Pass`
                : `${isEn ? 'Turndown' : '턴다운'} ${designRes.minTurndownRatio}:1`}
            </div>
          </div>

          <div style={{ padding: '4px 7px', borderRadius: 6, background: '#FFFBEB', border: '1px solid #FDE68A', minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#92400E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isEn ? 'ASME / Cost (C_BM)' : 'ASME / 설치원가(C_BM)'}
            </div>
            <div style={{ fontSize: 11.6, fontWeight: 900, color: '#78350F', fontFamily: MONO, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isEn
                ? `${mech.selectedShellMm}t · $${cost.bareModuleUsd.toLocaleString()}`
                : `${mech.selectedShellMm}t · ${formatKrwReadable(cost.bareModuleKrw)}`}
            </div>
            <div style={{ fontSize: 8.6, color: '#92400E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {designRes.recommendedMaterialCode} · {designRes.estimatedDryWeightTon}t
            </div>
          </div>
        </div>

        {onApplyHydraulicsToMesh && (
          <button
            type="button"
            onClick={() => onApplyHydraulicsToMesh(designRes.avgStageDpKgcm2, designRes.predictedOverallEffPct)}
            title={
              isEn
                ? 'Apply calculated stage ΔP and Chan–Fair predicted efficiency back to the multi-stage MESH simulation'
                : '산출된 단당 압손(ΔP)과 Chan–Fair 예측 단효율을 다단 MESH 시뮬레이션 파라미터에 반영합니다'
            }
            style={{
              width: isMobile ? '100%' : undefined,
              flexShrink: 0,
              padding: isMobile ? '6px 10px' : '7px 10px',
              borderRadius: 6,
              border: '1px solid #059669',
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              color: '#FFFFFF',
              fontSize: 10.5,
              fontWeight: 900,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              boxShadow: '0 1px 4px rgba(5,150,105,0.25)',
            }}
          >
            {isEn ? '🔄 Apply ΔP & Efficiency to MESH' : '🔄 ΔP·효율 MESH 역반영'}
          </button>
        )}
      </div>

      {/* ── 모바일 전용 좌/우 패널 전환 바 ── */}
      {isMobile && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            padding: '6px 10px',
            background: '#F1F5F9',
            borderBottom: '1px solid #CBD5E1',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setMobilePane('inputs')}
            style={{
              padding: '7px 8px',
              borderRadius: 6,
              border: mobilePane === 'inputs' ? '1.5px solid #1A2F44' : '1px solid #CBD5E1',
              background: mobilePane === 'inputs' ? '#1A2F44' : '#FFFFFF',
              color: mobilePane === 'inputs' ? '#FFFFFF' : '#334155',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {isEn ? '⚙ Internals · Mech Inputs' : '⚙ 인터널 · 기계 입력'}
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('results')}
            style={{
              padding: '7px 8px',
              borderRadius: 6,
              border: mobilePane === 'results' ? '1.5px solid #1A2F44' : '1px solid #CBD5E1',
              background: mobilePane === 'results' ? '#1A2F44' : '#FFFFFF',
              color: mobilePane === 'results' ? '#FFFFFF' : '#334155',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {isEn ? '📐 Drawing · ASME · Cost' : '📐 도면 · ASME · 원가 결과'}
          </button>
        </div>
      )}

      {/* ── 본문 좌/우 2단 엔지니어링 워크스페이스 ── */}
      <div
        style={{
          flex: isMobile ? 'none' : 1,
          minHeight: isMobile ? 'auto' : 0,
          display: isMobile ? 'block' : 'flex',
          overflow: isMobile ? 'visible' : 'hidden',
        }}
      >
        {/* 좌측: 인터널·기하구조·재질·기계/원가 입력 패널 */}
        {(!isMobile || mobilePane === 'inputs') && (
        <div
          style={{
            width: isMobile ? '100%' : 390,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : '1px solid #CBD5E1',
            background: '#F8FAFC',
            padding: isMobile ? '10px 10px 28px' : '11px 12px',
            overflowY: isMobile ? 'visible' : 'auto',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* 1. 인터널 형식 선택 (Tray vs Packed) */}
          <div style={cardBox}>
            <label style={lblStyle}>{isEn ? '① Column Internals Type' : '① 컬럼 인터널 형식 (Internals Type)'}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
              {(
                [
                  { id: 'tray' as ColumnInternalsKind, label: isEn ? '💿 Tray Column' : '💿 단탑 (Tray Column)' },
                  { id: 'packed' as ColumnInternalsKind, label: isEn ? '🧱 Packed Bed' : '🧱 충진탑 (Packed Bed)' },
                ] as const
              ).map((opt) => {
                const active = designRes.internalsKind === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => patchInternals({ internalsKind: opt.id })}
                    style={{
                      padding: '7px 8px',
                      borderRadius: 6,
                      border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                      background: active ? '#EEF2FF' : '#FFFFFF',
                      color: active ? '#312E81' : '#475569',
                      fontSize: 11,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <label style={{ ...lblStyle, marginTop: 9 }}>{isEn ? '② Shell Diameter Mode (Uniform vs Swaged)' : '② 동체 직경 구성 (Uniform vs Swaged)'}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(
                [
                  { id: 'uniform' as ShellSectionMode, label: isEn ? 'Uniform ØD' : '단일 직경 (Uniform ØD)' },
                  { id: 'swaged' as ShellSectionMode, label: isEn ? 'Swaged (2-Section ID)' : '상·하 이단 직경 (Swaged)' },
                ] as const
              ).map((opt) => {
                const active = designRes.shellSectionMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => patchInternals({ shellSectionMode: opt.id })}
                    style={{
                      padding: '6px 6px',
                      borderRadius: 6,
                      border: active ? '1.5px solid #0F766E' : '1px solid #CBD5E1',
                      background: active ? '#ECFDF5' : '#FFFFFF',
                      color: active ? '#065F46' : '#475569',
                      fontSize: 10.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 9 }}>
              <div>
                <label style={lblStyle}>{isEn ? 'Design Target Flood (%)' : '설계 목표 범람율 (%)'}</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-ic-fl`}
                  min={50}
                  max={86}
                  step={2}
                  value={ic.designFloodTargetPct ?? 76}
                  onValueChange={(v) => patchInternals({ designFloodTargetPct: v })}
                  style={inpStyle}
                />
              </div>
              <div>
                <label style={lblStyle}>{isEn ? 'Foaming Factor Φ_foam' : '발포 보정계수 Φ_foam'}</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-ic-foam`}
                  min={0.65}
                  max={1.0}
                  step={0.05}
                  value={ic.foamingFactor ?? 0.9}
                  onValueChange={(v) => patchInternals({ foamingFactor: v })}
                  style={inpStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isSwaged ? '1fr 1fr' : '1fr', gap: 8, marginTop: 8 }}>
              <div>
                <label style={lblStyle}>
                  {isSwaged
                    ? (isEn ? 'Rectifying ID Override (0=Auto)' : '정류부 내경 지정 (0=자동)')
                    : (isEn ? 'Tower ID Override (0=Auto)' : '탑 내경 수동 지정 (0=자동)')}
                </label>
                <UnitNumberInput
                  quantity="length"
                  unitId={lenUnit}
                  onUnitChange={setLenUnit}
                  syncKey={`${unitTag}-ic-dr`}
                  minCanonical={0}
                  maxCanonical={8}
                  value={ic.manualRectDiamM ?? 0}
                  onValueChange={(v) => patchInternals({ manualRectDiamM: v > 0.3 ? v : 0 })}
                  inputStyle={inpStyle}
                />
              </div>
              {isSwaged && (
                <div>
                  <label style={lblStyle}>{isEn ? 'Stripping ID Override (0=Auto)' : '스트리핑 내경 지정 (0=자동)'}</label>
                  <UnitNumberInput
                    quantity="length"
                    unitId={lenUnit}
                    onUnitChange={setLenUnit}
                    syncKey={`${unitTag}-ic-ds`}
                    minCanonical={0}
                    maxCanonical={8}
                    value={ic.manualStripDiamM ?? 0}
                    onValueChange={(v) => patchInternals({ manualStripDiamM: v > 0.3 ? v : 0 })}
                    inputStyle={inpStyle}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 2. 트레이 상세 설계 vs 충진물 상세 설계 */}
          {isTray ? (
            <div style={cardBox}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#1E3A8A', marginBottom: 7 }}>
                {isEn
                  ? '💿 Tray Deck Specification (Fair · Glitsch · Chan–Fair)'
                  : '💿 트레이 데크 상세 제원 (Fair · Glitsch · Chan–Fair)'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 8 }}>
                <div>
                  <label style={lblStyle}>{isEn ? 'Tray Type' : '트레이 종류'}</label>
                  <select
                    value={ic.trayType ?? 'valve'}
                    onChange={(e) => {
                      const nextT = e.target.value as TrayDeckType;
                      patchInternals({
                        trayType: nextT,
                        holeDiameterMm: nextT === 'valve' ? 38 : nextT === 'bubble_cap' ? 75 : 5.0,
                      });
                    }}
                    style={selStyle}
                  >
                    <option value="valve">{isEn ? 'Floating Valve Tray' : '부상식 밸브 (Floating Valve)'}</option>
                    <option value="sieve">{isEn ? 'Sieve Tray (Perforated)' : '다공판 시브 (Sieve Tray)'}</option>
                    <option value="bubble_cap">{isEn ? 'Bubble-Cap (Very Low Flow)' : '버블캡 (Bubble-Cap — 극저유량)'}</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>{isEn ? 'Tray Spacing' : '단 간격 (Spacing)'}</label>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
                    <select
                      value={ic.traySpacingMm ?? 500}
                      onChange={(e) => patchInternals({ traySpacingMm: Number(e.target.value) })}
                      style={{ ...selStyle, flex: 1, minWidth: 0 }}
                    >
                      {([
                        { v: 300, note: isEn ? 'Small Ø' : '소구경' },
                        { v: 450, note: isEn ? 'Standard' : '표준' },
                        { v: 500, note: isEn ? 'Recommended' : '권장' },
                        { v: 600, note: isEn ? 'Large Ø' : '대구경' },
                        { v: 750, note: isEn ? 'High Foam' : '고발포' },
                      ] as const).map((opt) => (
                        <option key={opt.v} value={opt.v}>
                          {formatCanonicalValue('length', opt.v / 1000, lenUnit)} {getUnitLabel('length', lenUnit)} ({opt.note})
                        </option>
                      ))}
                    </select>
                    <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} style={{ flexShrink: 0, minWidth: 48 }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div>
                  <label style={lblStyle}>{isEn ? 'Flow Passes' : '유로 패스 수 (Passes)'}</label>
                  <select
                    value={String(ic.flowPasses ?? 'auto')}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchInternals({ flowPasses: v === 'auto' ? 'auto' : (Number(v) as 1 | 2 | 4) });
                    }}
                    style={selStyle}
                  >
                    <option value="auto">
                      {isEn
                        ? `Auto Optimal (${designRes.stripping.flowPasses}-Pass)`
                        : `자동 최적선정 (${designRes.stripping.flowPasses}-Pass)`}
                    </option>
                    <option value="1">{isEn ? '1-Pass (Single)' : '1-Pass (단일 유로)'}</option>
                    <option value="2">{isEn ? '2-Pass (Split)' : '2-Pass (분할 유로)'}</option>
                    <option value="4">{isEn ? '4-Pass (High Flow)' : '4-Pass (대유량)'}</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>{isEn ? 'Downcomer Area Ad/AT (%)' : '다운코머 면적비 Ad/AT (%)'}</label>
                  <BufferedNumberInput
                    syncKey={`${unitTag}-ic-dc`}
                    min={6}
                    max={22}
                    step={1}
                    value={ic.downcomerAreaPct ?? 12}
                    onValueChange={(v) => patchInternals({ downcomerAreaPct: v })}
                    style={inpStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                <div>
                  <label style={lblStyle}>{isEn ? 'Weir Height hw' : '위어 높이 hw'}</label>
                  <UnitNumberInput
                    quantity="length"
                    syncKey={`${unitTag}-ic-hw`}
                    minCanonical={0.025}
                    maxCanonical={0.095}
                    value={(ic.weirHeightMm ?? 50) / 1000}
                    onValueChange={(v) => patchInternals({ weirHeightMm: Number((v * 1000).toFixed(1)) })}
                    inputStyle={inpStyle}
                    selectStyle={{ minWidth: 46 }}
                  />
                </div>
                <div>
                  <label style={lblStyle}>{isEn ? 'Hole/Valve Øh' : '홀/밸브경 Øh'}</label>
                  <UnitNumberInput
                    quantity="length"
                    syncKey={`${unitTag}-ic-dh`}
                    minCanonical={0.003}
                    maxCanonical={0.09}
                    value={(ic.holeDiameterMm ?? ((ic.trayType ?? 'valve') === 'sieve' ? 5 : 38)) / 1000}
                    onValueChange={(v) => patchInternals({ holeDiameterMm: Number((v * 1000).toFixed(2)) })}
                    inputStyle={inpStyle}
                    selectStyle={{ minWidth: 46 }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={lblStyle}>{isEn ? 'Open Area Ratio Ah/Aa (%)' : '개구율 Ah/Aa (%)'}</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-ic-ah`}
                  min={5}
                  max={16}
                  step={0.5}
                  value={ic.holeAreaPct ?? 10}
                  onValueChange={(v) => patchInternals({ holeAreaPct: v })}
                  style={inpStyle}
                />
              </div>
            </div>
          ) : (
            <div style={cardBox}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#0F766E', marginBottom: 7 }}>
                {isEn
                  ? '🧱 Packing Spec & Bed Split (Billet–Schultes 1999)'
                  : '🧱 충진물 규격 & 베드 분할 (Billet–Schultes 1999)'}
              </div>
              <label style={lblStyle}>{isEn ? 'Packing Selection (8 Structured/Random Types)' : '충진물 규격 선택 (규칙/불규칙 8종)'}</label>
              <select
                value={ic.packingKey ?? 'mellapak_250y'}
                onChange={(e) => patchInternals({ packingKey: e.target.value as PackingKey })}
                style={selStyle}
              >
                {Object.values(PACKING_CATALOG).map((pk) => (
                  <option key={pk.key} value={pk.key}>
                    {pk.name}
                  </option>
                ))}
              </select>

              <div
                style={{
                  marginTop: 7,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: '#F0FDFA',
                  border: '1px solid #99F6E4',
                  fontSize: 10,
                  color: '#115E59',
                  lineHeight: 1.4,
                }}
              >
                <div>
                  <b>ap={designRes.packingSpec.surfaceAreaM2M3} m²/m³</b> · ε=
                  <b>{(designRes.packingSpec.voidFraction * 100).toFixed(0)}%</b> · Cp=
                  <b>{designRes.packingSpec.bsCp}</b> · CL=<b>{designRes.packingSpec.bsCL}</b> · CV=
                  <b>{designRes.packingSpec.bsCV}</b>
                </div>
                <div style={{ marginTop: 2, color: '#0F766E', fontWeight: 700 }}>
                  💡 {designRes.packingSpec.materialNote}
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <label style={lblStyle}>{isEn ? 'Max Height per Bed (Redistributor Spacing)' : '베드당 최대 높이 (액체 재분배기 간격)'}</label>
                <UnitNumberInput
                  quantity="length"
                  unitId={lenUnit}
                  onUnitChange={setLenUnit}
                  syncKey={`${unitTag}-ic-bedh`}
                  minCanonical={2.5}
                  maxCanonical={8.5}
                  value={ic.maxBedHeightM ?? 5.5}
                  onValueChange={(v) => patchInternals({ maxBedHeightM: v })}
                  inputStyle={inpStyle}
                />
              </div>
            </div>
          )}

          {/* 3. 동체 재질 · 하중 · 원가 지수 설정 */}
          <div style={cardBox}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 7 }}>
              {isEn
                ? '🛡️ Shell Metallurgy · Wind/Seismic · Cost Index (CEPCI)'
                : '🛡️ 동체 재질 · 풍/지진 하중 · 원가지수(CEPCI)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.85fr', gap: 8 }}>
              <div>
                <label style={lblStyle}>{isEn ? 'Shell Metallurgy' : '동체 재질 선정'}</label>
                <select
                  value={ic.shellMaterial ?? 'AUTO'}
                  onChange={(e) => patchInternals({ shellMaterial: e.target.value as ShellMaterialCode })}
                  style={selStyle}
                >
                  <option value="AUTO">{isEn ? 'Auto Corrosion Selection (AUTO)' : '자동 부식판별 (AUTO)'}</option>
                  <option value="SS316L">{isEn ? 'SUS 316L Stainless Steel' : 'SUS 316L 스테인리스'}</option>
                  <option value="DUPLEX_2205">{isEn ? 'Duplex 2205 (SCC-Resistant)' : 'Duplex 2205 (내SCC)'}</option>
                  <option value="PTFE_LINED_CS">{isEn ? 'PTFE/PFA Lined CS (HCl/Cl₂)' : 'PTFE/PFA 라이닝 (염산/염소)'}</option>
                  <option value="ALLOY_C276">{isEn ? 'Alloy C-276 (Hot Strong Acid)' : 'Alloy C-276 (고온 강산)'}</option>
                  <option value="CS_A516_70">{isEn ? 'Carbon Steel SA-516-70' : '탄소강 SA-516-70'}</option>
                </select>
              </div>
              <div>
                <label style={lblStyle}>{isEn ? 'Sump Holdup (min)' : '섬프 체류시간 (분)'}</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-ic-sump`}
                  min={1.5}
                  max={15}
                  step={0.5}
                  value={ic.sumpResidenceMin ?? 4.0}
                  onValueChange={(v) => patchInternals({ sumpResidenceMin: v })}
                  style={inpStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.9fr 0.75fr', gap: 6, marginTop: 8 }}>
              <div>
                <label style={lblStyle}>{isEn ? 'Design Wind' : '설계풍속'}</label>
                <UnitNumberInput
                  quantity="velocity"
                  unitId={velUnit}
                  onUnitChange={setVelUnit}
                  syncKey={`${unitTag}-ic-wind`}
                  minCanonical={20}
                  maxCanonical={65}
                  value={ic.windSpeedMS ?? 38}
                  onValueChange={(v) => patchInternals({ windSpeedMS: v })}
                  inputStyle={inpStyle}
                  selectStyle={{ minWidth: 48 }}
                />
              </div>
              <div>
                <label style={lblStyle}>{isEn ? 'Exposure' : '노풍도'}</label>
                <select
                  value={ic.windExposure ?? 'C'}
                  onChange={(e) => patchInternals({ windExposure: e.target.value as WindExposure })}
                  style={selStyle}
                >
                  <option value="B">{isEn ? 'B (Urban/Ind.)' : 'B (도심/산단)'}</option>
                  <option value="C">{isEn ? 'C (Open Std.)' : 'C (평지 표준)'}</option>
                  <option value="D">{isEn ? 'D (Coastal)' : 'D (해안/임해)'}</option>
                </select>
              </div>
              <div>
                <label style={lblStyle}>{isEn ? 'CEPCI' : 'CEPCI 지수'}</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-ic-cepci`}
                  min={400}
                  max={1200}
                  step={10}
                  value={ic.cepci ?? 800}
                  onValueChange={(v) => patchInternals({ cepci: v })}
                  style={inpStyle}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 7,
                padding: '6px 8px',
                borderRadius: 6,
                background: '#FEF3C7',
                border: '1px solid #FDE68A',
                fontSize: 9.8,
                fontWeight: 700,
                color: '#78350F',
                lineHeight: 1.35,
              }}
            >
              🔍 <b>{isEn ? 'Selection Basis:' : '선정 근거:'}</b> {designRes.materialReason}
            </div>
          </div>

          {/* 4. 엔지니어링 수력학·기계 진단 알림 */}
          {designRes.designWarnings.length > 0 && (
            <div
              style={{
                padding: '9px 11px',
                borderRadius: 8,
                background: designRes.overallStatus === 'critical' ? '#FEF2F2' : '#FFFBEB',
                border: `1.5px solid ${designRes.overallStatus === 'critical' ? '#FCA5A5' : '#FCD34D'}`,
                fontSize: 10.2,
                color: designRes.overallStatus === 'critical' ? '#991B1B' : '#92400E',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900 }}>{isEn ? '⚠ Hydraulics · Mechanical Design Check' : '⚠ 수력학 · 기계 설계 점검'}</span>
                {simResult && (
                  <button
                    type="button"
                    disabled={isAiBusy}
                    onClick={async () => {
                      setIsAiBusy(true);
                      setAiStepLabel(isEn ? 'Searching flood & ΔP combinations...' : '범람·압손 조합 탐색 중...');
                      try {
                        const fix = await autoFixColumnInternalsAsync(
                          config,
                          feeds,
                          simResult,
                          (step, total, label) => {
                            setAiStepLabel(`(${step}/${total}) ${label}`);
                          }
                        );
                        if (Object.keys(fix.patch).length > 0) {
                          patchInternals(fix.patch);
                        }
                        const gNote = await fetchOptionalGeminiAdvice(
                          `[컬럼 인터널 ${unitTag}] 범람율=${fix.solvedAfter.maxFloodPct.toFixed(1)}%, 압손=${fix.solvedAfter.totalInternalsDpMbar.toFixed(1)} mbar, 조치=${fix.actionsTaken.join(', ')}`
                        );
                        setAiNote(
                          `${fix.headline}${fix.actionsTaken.length > 0 ? ` (${fix.actionsTaken.join(' · ')})` : ''}${gNote ? `\n${gNote}` : ''}`
                        );
                      } catch (err) {
                        setAiNote(
                          `${isEn ? '⚠ AI Auto-Fix Error:' : '⚠ AI 보정 오류:'} ${err instanceof Error ? err.message : String(err)}`
                        );
                      } finally {
                        setIsAiBusy(false);
                        setAiStepLabel('');
                      }
                    }}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 5,
                      border: '1px solid #7C3AED',
                      background: '#7C3AED',
                      color: '#FFFFFF',
                      fontSize: 10.2,
                      fontWeight: 900,
                      cursor: isAiBusy ? 'wait' : 'pointer',
                    }}
                  >
                    {isAiBusy ? (aiStepLabel || (isEn ? '⏳ Optimizing...' : '⏳ 보정 중...')) : (isEn ? '✨ AI Auto-Fix' : '✨ AI 자동 해결')}
                  </button>
                )}
              </div>
              {designRes.designWarnings.map((w, idx) => (
                <div key={idx} style={{ lineHeight: 1.35 }}>
                  • {w}
                </div>
              ))}
              {isAiBusy && aiStepLabel && (
                <div style={{ marginTop: 3, paddingTop: 4, borderTop: '1px dashed #CBD5E1', color: '#6D28D9', fontWeight: 800 }}>
                  ⏳ {aiStepLabel}
                </div>
              )}
              {aiNote && !isAiBusy && (
                <div style={{ marginTop: 3, paddingTop: 4, borderTop: '1px dashed #CBD5E1', color: '#5B21B6', fontWeight: 800, whiteSpace: 'pre-line' }}>
                  {aiNote}
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* 우측: 도면/프로파일/노즐/ASME·원가 4개 탭 + 단별 수력학 테이블 */}
        {(!isMobile || mobilePane === 'results') && (
        <div
          style={{
            flex: isMobile ? 'none' : 1,
            width: isMobile ? '100%' : undefined,
            minWidth: 0,
            padding: isMobile ? '10px 10px 28px' : '11px 14px',
            overflowY: isMobile ? 'visible' : 'auto',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 11,
          }}
        >
          {/* 우측 상단 5탭 전환 바 + 통합 내보내기 드롭다운 툴바 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              flexWrap: isMobile ? 'wrap' : 'nowrap',
            }}
          >
            <div
              style={{
                display: isMobile ? 'grid' : 'inline-flex',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : undefined,
                width: isMobile ? '100%' : undefined,
                gap: isMobile ? 4 : 2,
                padding: isMobile ? 0 : 2,
                borderRadius: isMobile ? 0 : 7,
                background: isMobile ? 'transparent' : '#E2E8F0',
                border: isMobile ? 'none' : '1px solid #CBD5E1',
                minWidth: 0,
              }}
            >
              {(
                [
                  { id: 'datasheet' as RightVisualTab, label: isEn ? '📋 Datasheet' : '📋 데이터시트' },
                  { id: 'drawing' as RightVisualTab, label: isEn ? '📐 CAD Drawing' : '📐 CAD 도면' },
                  { id: 'profile' as RightVisualTab, label: isEn ? '📊 Flood · ΔP' : '📊 범람율·차압' },
                  { id: 'nozzles' as RightVisualTab, label: isEn ? '🔩 Nozzles · Aux' : '🔩 노즐·부속' },
                  { id: 'mechanical_cost' as RightVisualTab, label: isEn ? '🛡️ ASME · Cost' : '🛡️ ASME·원가' },
                ] as const
              ).map((t) => {
                const active = visualTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setVisualTab(t.id)}
                    style={{
                      padding: isMobile ? '6px 6px' : '5px 9px',
                      borderRadius: 5,
                      border: active
                        ? '1px solid #4338CA'
                        : isMobile
                        ? '1px solid #CBD5E1'
                        : '1px solid transparent',
                      background: active ? '#4338CA' : isMobile ? '#FFFFFF' : 'transparent',
                      color: active ? '#FFFFFF' : '#334155',
                      fontSize: 10.5,
                      fontWeight: 900,
                      cursor: 'pointer',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div
              ref={exportMenuRef}
              style={{
                position: 'relative',
                flexShrink: 0,
                width: isMobile ? '100%' : undefined,
              }}
            >
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                style={{
                  width: isMobile ? '100%' : undefined,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: exportMenuOpen ? '1px solid #1D4ED8' : '1px solid #94A3B8',
                  background: exportMenuOpen ? '#EFF6FF' : '#FFFFFF',
                  color: exportMenuOpen ? '#1E3A8A' : '#1E293B',
                  fontSize: 10.5,
                  fontWeight: 900,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
                }}
              >
                {isEn ? '⬇ Export ▾' : '⬇ 내보내기 ▾'}
              </button>

              {exportMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 4px)',
                    minWidth: 196,
                    background: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
                    padding: 4,
                    zIndex: 40,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void downloadColumnEpcDatasheet({
                        unitTag,
                        unitLabel,
                        colConfig: config,
                        feeds,
                        simResult,
                        design: designRes,
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#065F46',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isEn ? '📊 Excel Datasheet (.xlsx)' : '📊 엑셀 데이터시트 (.xlsx)'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      downloadColumnCadDxf({
                        unitTag,
                        unitLabel,
                        colConfig: config,
                        simResult,
                        design: designRes,
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#1E3A8A',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    📐 AutoCAD (.dxf)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleDownloadSvg();
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isEn ? '🖼 SVG Drawing' : '🖼 SVG 도면'}
                  </button>
                  <div style={{ height: 1, background: '#E2E8F0', margin: '2px 4px' }} />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handlePrintDatasheet();
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isEn ? '🖨 Print' : '🖨 인쇄'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {visualTab === 'datasheet' && renderEpcDatasheetTab()}
          {visualTab === 'drawing' && renderConceptualDrawingSvg()}
          {visualTab === 'profile' && renderHydraulicProfileSvg()}
          {visualTab === 'mechanical_cost' && renderMechanicalAndCostTab()}

          {visualTab === 'nozzles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ ...cardBox, overflow: 'hidden' }}>
                <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                  {isEn
                    ? '🔩 Column Main Nozzle & Manhole Schedule (Elevation EL +mm · Momentum ρv² · Friedel 2-Phase ΔP)'
                    : '🔩 컬럼 주요 노즐·맨홀 스케줄 (설치 고도 EL +mm · 운동량 ρv² · Friedel 2상 차압)'}
                </div>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', minWidth: 740, borderCollapse: 'collapse', fontSize: 10.4 }}>
                    <thead>
                      <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                        <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Tag' : '태그'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Service' : '서비스 명칭'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center' }}>{isEn ? 'Size / Rating' : '선정 규격 / 등급'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'center' }}>{isEn ? 'Orientation' : '방위각'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'EL (Base / BTL)' : '설치 EL (Base / BTL)'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Flow (kg/h)' : '유량 (kg/h)'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Velocity · ρv²' : '유속 · ρv²'}</th>
                        <th style={{ padding: '5px 6px', textAlign: 'right' }}>{isEn ? 'Friedel 2-Phase ΔP' : 'Friedel 2상 ΔP'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {designRes.nozzles.map((nz) => (
                        <tr key={nz.nozzleTag} style={{ borderBottom: '1px solid #E2E8F0' }}>
                          <td style={{ padding: '5px 6px', fontWeight: 900, color: '#4338CA', fontFamily: MONO }}>{nz.nozzleTag}</td>
                          <td style={{ padding: '5px 6px', fontWeight: 700, color: '#0F172A' }}>{nz.service}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'center', fontWeight: 900, color: '#065F46', fontFamily: MONO }}>
                            {nz.selectedDn} · {nz.flangeRating}
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'center', fontFamily: MONO }}>{nz.orientationDeg}°</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 900, fontFamily: MONO, color: '#1E3A8A' }}>
                            +{nz.elevationMm} ({nz.elevationFromBtlMm >= 0 ? '+' : ''}{nz.elevationFromBtlMm})
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO }}>{nz.massFlowKgH.toLocaleString()}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO }}>{nz.designVelMS} m/s · {nz.rhoV2Pa.toLocaleString()} Pa</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO, color: '#0F766E' }}>
                            {nz.friedelDpPaPerM !== undefined
                              ? `${nz.friedelDpPaPerM} Pa/m (${nz.estLineDpKpa} kPa)`
                              : '-'}
                          </td>
                        </tr>
                      ))}
                      {designRes.manholes.map((mh) => (
                        <tr key={mh.tag} style={{ borderBottom: '1px solid #E2E8F0', background: '#FFFBEB' }}>
                          <td style={{ padding: '5px 6px', fontWeight: 900, color: '#B45309', fontFamily: MONO }}>{mh.tag}</td>
                          <td style={{ padding: '5px 6px', fontWeight: 700, color: '#78350F' }}>{mh.service}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'center', fontWeight: 900, color: '#92400E', fontFamily: MONO }}>
                            {mh.sizeDn} · {mh.flangeRating}
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'center', fontFamily: MONO }}>{mh.orientationDeg}°</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 900, fontFamily: MONO, color: '#92400E' }}>
                            +{mh.elevationMm} (+{mh.elevationFromBtlMm})
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO }}>-</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO }}>Manway</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: MONO }}>-</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 9 }}>
                <div style={cardBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: '#1D4ED8' }}>
                      {isEn ? '❄️ Overhead Condenser' : '❄️ 탑정 응축기 (Condenser)'}
                    </span>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                      <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} />
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 4 }}>
                    {isEn ? 'Est. Area' : '전열면적 약'} {formatCanonicalValue('area', designRes.auxiliaries.condenserEstAreaM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {isEn ? 'Duty' : '열부하'} {formatCanonicalValue('heatDuty', designRes.auxiliaries.condenserDutyKw / 1.163, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)} · {isEn ? 'C_BM' : '설치원가'}{' '}
                    {designRes.auxiliaries.condenserCost
                      ? (isEn
                          ? `$${designRes.auxiliaries.condenserCost.bareModuleUsd.toLocaleString()}`
                          : formatKrwReadable(designRes.auxiliaries.condenserCost.bareModuleKrw))
                      : '-'}
                  </div>
                </div>
                <div style={cardBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: '#B91C1C' }}>
                      {isEn ? '🔥 Bottom Reboiler' : '🔥 탑저 리보일러 (Reboiler)'}
                    </span>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                      <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} />
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 4 }}>
                    {isEn ? 'Est. Area' : '전열면적 약'} {formatCanonicalValue('area', designRes.auxiliaries.reboilerEstAreaM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {isEn ? 'Duty' : '열부하'} {formatCanonicalValue('heatDuty', designRes.auxiliaries.reboilerDutyKw / 1.163, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)} · {isEn ? 'C_BM' : '설치원가'}{' '}
                    {designRes.auxiliaries.reboilerCost
                      ? (isEn
                          ? `$${designRes.auxiliaries.reboilerCost.bareModuleUsd.toLocaleString()}`
                          : formatKrwReadable(designRes.auxiliaries.reboilerCost.bareModuleKrw))
                      : '-'}
                  </div>
                </div>
                <div style={cardBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: '#0F766E' }}>
                      {isEn ? '🛢️ Horiz. Reflux Drum (5 min Holdup)' : '🛢️ 수평 환류드럼 (5분 홀드업)'}
                    </span>
                    <UnitSelect quantity="volume" value={volUnit} onChange={setVolUnit} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 4 }}>
                    Ø{formatCanonicalValue('length', designRes.auxiliaries.refluxDrumDiamM, lenUnit, 2)} × {formatCanonicalValue('length', designRes.auxiliaries.refluxDrumLengthM, lenUnit, 2)} {getUnitLabel('length', lenUnit)}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {isEn ? 'Total Vol.' : '총 용적'} {formatCanonicalValue('volume', designRes.auxiliaries.refluxDrumHoldupM3, volUnit)} {getUnitLabel('volume', volUnit)} ({isEn ? '50% Liquid Level' : '50% 액위 기준'})
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 하단 고정: 단별(Stage 2 ~ N-1) 수력학·물질전달 정밀 검증 테이블 (CAD 도면 탭에서는 도면 단독 확대 표시) */}
          {visualTab !== 'drawing' && (
          <div style={{ ...cardBox, padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '7px 11px',
                background: '#1E293B',
                color: '#FFFFFF',
                fontSize: isMobile ? 10.3 : 11,
                fontWeight: 900,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 4,
              }}
            >
              <span>
                {isEn
                  ? `📋 Stage-by-Stage (Stage 2 ~ ${simResult.totalStagesUsed - 1}) `
                  : `📋 단별(Stage 2 ~ ${simResult.totalStagesUsed - 1}) `}
                {isTray
                  ? (isEn ? 'Fair · Glitsch · Lockett · Chan–Fair Tray Hydraulics' : 'Fair · Glitsch · Lockett · Chan–Fair 트레이 수력학표')
                  : (isEn ? 'Billet–Schultes (1999) · GPDC Packed Hydraulics' : 'Billet–Schultes (1999) · GPDC 충진탑 수력학표')}
              </span>
              <span style={{ fontSize: 9.8, color: '#93C5FD', fontFamily: MONO }}>
                {isEn
                  ? `Rectifying #${designRes.rectifying.stageStart}~#${designRes.rectifying.stageEnd} | Stripping #${designRes.stripping.stageStart}~#${designRes.stripping.stageEnd}`
                  : `정류부 #${designRes.rectifying.stageStart}~#${designRes.rectifying.stageEnd} | 스트리핑 #${designRes.stripping.stageStart}~#${designRes.stripping.stageEnd}`}
              </span>
            </div>
            <div style={{ maxHeight: isMobile ? 320 : 225, overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 740, borderCollapse: 'collapse', fontSize: 10.2 }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#334155' }}>
                    <th style={{ padding: '5px 6px', textAlign: 'left' }}>{isEn ? 'Stage' : '단(Stage)'}</th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>T (°C)</th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>Fs (Pa^0.5)</th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {isTray ? (isEn ? 'Jet / DC Choke%' : 'Jet / DC초크%') : 'B-S / GPDC%'}
                    </th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {isTray ? (isEn ? 'Stage ΔP (mbar)' : '단 ΔP (mbar)') : (isEn ? 'Dry/Wet ΔP (mbar/m)' : '건식/적심 ΔP (mbar/m)')}
                    </th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {isTray ? (isEn ? 'DC Backup% / τ_dc(s)' : 'DC백업% / τ_dc(s)') : (isEn ? 'Holdup h_L% / Wetting' : '홀드업 h_L% / 적심율')}
                    </th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {isTray ? (isEn ? 'Weep Ratio (Lockett)' : '위핑비(Lockett)') : 'H_OG / HETP (m)'}
                    </th>
                    <th style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {isTray ? "Chan-Fair / O'C%" : 'GPDC HETP (m)'}
                    </th>
                    <th style={{ padding: '5px 6px', textAlign: 'center' }}>{isEn ? 'Status' : '판정'}</th>
                  </tr>
                </thead>
                <tbody>
                  {designRes.stageRows.map((r) => {
                    const b = statusBadgeColors(r.status, isEn);
                    const isFeed = r.stage === simResult.feedStageUsed;
                    return (
                      <tr
                        key={r.stage}
                        style={{
                          borderBottom: '1px solid #F1F5F9',
                          background: isFeed ? '#F5F3FF' : '#FFFFFF',
                        }}
                      >
                        <td style={{ padding: '4px 6px', fontWeight: 900, fontFamily: MONO, color: isFeed ? '#6D28D9' : '#0F172A' }}>
                          #{r.stage} {isFeed ? '★F' : r.section === 'rectifying' ? (isEn ? '(Rect)' : '(정류)') : (isEn ? '(Strip)' : '(탈거)')}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>{r.tempC.toFixed(1)}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>{r.fFactorPa05.toFixed(2)}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 900, color: r.floodPct > 85 ? '#DC2626' : '#1E3A8A' }}>
                          {isTray
                            ? `${r.jetFloodPct.toFixed(1)} / ${r.dcChokeFloodPct.toFixed(1)}%`
                            : `${r.bsFloodPct.toFixed(1)} / ${r.gpdcFloodPct.toFixed(1)}%`}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>
                          {isTray
                            ? r.dpMbar.toFixed(2)
                            : `${r.dryDpMbarM.toFixed(2)} / ${r.specificDpMbarM.toFixed(2)}`}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>
                          {isTray
                            ? `${r.dcBackupPct.toFixed(0)}% / ${r.dcResidenceTimeSec.toFixed(1)}s`
                            : `${(r.liquidHoldupFrac * 100).toFixed(1)}% / ${r.wettingRateM3M2H.toFixed(1)}`}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO }}>
                          {isTray
                            ? `${r.weepRatio.toFixed(2)}x`
                            : `${r.hogM.toFixed(2)} / ${r.localHetpM.toFixed(2)}`}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: '#0F766E' }}>
                          {isTray
                            ? `${r.chanFairEffPct.toFixed(1)} / ${r.oconnellEffPct.toFixed(1)}%`
                            : r.gpdcHetpM.toFixed(2)}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '1.5px 6px',
                              borderRadius: 999,
                              background: b.bg,
                              color: b.fg,
                              border: `1px solid ${b.border}`,
                              fontSize: 9.2,
                              fontWeight: 900,
                            }}
                          >
                            {b.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import { MW } from '../../lib/calculations/constants';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';
import {
  PROPERTY_METHOD_INFO,
  type ResolvedPropertyMethod,
} from '../../lib/calculations/componentCatalog';
import {
  ALL_REACTOR_COMPS,
  INDUSTRIAL_REACTION_TEMPLATES,
  calcReactionStdThermo,
  checkStoichiometryBalance,
  solveChemicalReactor,
  type ReactorAxialPoint,
  type ReactorConfig,
  type ReactorModelType,
  type ReactorThermalMode,
  type StoicReactionSpec,
} from '../../lib/calculations/chemicalReactor';
import { useAuth } from '@/components/auth/AuthContext';
import { isSimulatorOnlyUser } from '@/lib/plantRegistry';
import { useUnitStore } from '@/lib/stores/unitStore';

const PRIVATE_PLANT_REACTION_IDS = new Set([
  'cms_aibn_liquid_chlorination',
  'gte_glycerol_hydrochlorination',
  'ech_saponification',
  'hcl_synthesis_burner',
  'cl2_caustic_scrubbing',
]);

function isPrivatePlantReactionTemplate(id: string): boolean {
  if (PRIVATE_PLANT_REACTION_IDS.has(id)) return true;
  const lower = id.toLowerCase();
  return (
    lower.startsWith('mdi_') ||
    lower.startsWith('mda_') ||
    lower.startsWith('phosgenation') ||
    lower.startsWith('fecl3') ||
    lower.startsWith('brine')
  );
}

export interface ReactorWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  unitTag: string;
  unitName: string;
  inletFlowsKgH: Partial<Record<SimCompKey, number>>;
  inletTempC: number;
  inletPressKgcm2g: number;
  activeComponents: SimCompKey[];
  propertyMethod: ResolvedPropertyMethod;
  initialConfig?: ReactorConfig;
  onApplyConfig: (cfg: ReactorConfig) => void;
}

const MONO = 'JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace';
const BAR_TO_KGCM2 = 1 / 0.980665;

function formatSignedDeltaT(dtC: number, tempUnitId: string): string {
  if (!Number.isFinite(dtC)) return '—';
  const sign = dtC >= 0 ? '+' : '';
  if (tempUnitId === 'F') return `${sign}${(dtC * 1.8).toFixed(1)} °F`;
  if (tempUnitId === 'K') return `${sign}${dtC.toFixed(1)} K`;
  return `${sign}${dtC.toFixed(1)} °C`;
}

const MODEL_TABS: Array<{
  key: ReactorModelType;
  labelKo: string;
  labelEn: string;
  shortTag: string;
  descKo: string;
  descEn: string;
}> = [
  {
    key: 'stoic',
    labelKo: '양론 전환',
    labelEn: 'Stoichiometric',
    shortTag: 'STOIC',
    descKo: '화학양론 계수(ν_i)와 기준 반응물 전환율(X) 지정',
    descEn: 'Specify stoichiometric coefficients (ν_i) and key reactant conversion (X)',
  },
  {
    key: 'equilibrium',
    labelKo: '화학 평형',
    labelEn: 'Equilibrium',
    shortTag: 'EQUIL',
    descKo: 'ΔG°(T) 기반 Keq(T) 및 실제기체(φ_i)·액상(γ_i) 평형',
    descEn: 'ΔG°(T)-based Keq(T) with real-gas (φ_i) and liquid-phase (γ_i) equilibrium',
  },
  {
    key: 'gibbs',
    labelKo: '깁스 최소화',
    labelEn: 'Gibbs Minimization',
    shortTag: 'GIBBS',
    descKo: '반응식 없이 원소 보존 하 총 Gibbs 자유에너지 최소화',
    descEn: 'Minimize total Gibbs free energy under element conservation without reaction equations',
  },
  {
    key: 'cstr',
    labelKo: '연속교반 CSTR',
    labelEn: 'CSTR',
    shortTag: 'CSTR',
    descKo: '완전혼합 체류시간(V) + Arrhenius 속도식 + 자켓 UA',
    descEn: 'Well-mixed residence time (V) + Arrhenius kinetics + Jacket UA',
  },
  {
    key: 'pfr',
    labelKo: '관형 PFR',
    labelEn: 'Tubular PFR',
    shortTag: 'PFR',
    descKo: '60-구간 RK4 축방향 T(z)·X(z)·P(z) + Ergun 압력강하',
    descEn: '60-step RK4 axial T(z)·X(z)·P(z) + Ergun pressure drop',
  },
];

const THERMAL_OPTIONS: Array<{ key: ReactorThermalMode; labelKo: string; labelEn: string }> = [
  { key: 'isothermal', labelKo: '등온 운전 (T 지정)', labelEn: 'Isothermal (Specify T)' },
  { key: 'adiabatic', labelKo: '단열 운전 (Q = 0)', labelEn: 'Adiabatic (Q = 0)' },
  { key: 'specified_duty', labelKo: '열부하 지정 (Q 지정)', labelEn: 'Specified Duty (Specify Q)' },
  { key: 'jacket_ua', labelKo: '열매체 자켓 (UA 열전달)', labelEn: 'Thermal Jacket (UA Heat Transfer)' },
];

const PROPERTY_METHOD_SHORT_EN: Record<ResolvedPropertyMethod, string> = {
  ENRTL: 'Electrolytes · Acid/Base Aqueous',
  NRTL: 'Polar Organic Solvents · Azeotrope/LLE',
  UNIFAC: 'Predictive Group-Contribution VLE (Hansen 1991)',
  PR: 'Hydrocarbons · Aromatics · Liquefied Gas',
  SRK: 'Hydrogen · Syngas · Light Olefins',
  STEAM_IF97: 'IAPWS-IF97 Pure Water · Steam · Condensate',
  IDEAL: 'Raoult’s Law · Ideal Gas / BTX Baseline',
};

const TEMPLATE_EN: Record<string, { category: string; label: string; desc: string }> = {
  wgs_hts: {
    category: 'Syngas · Hydrogen',
    label: 'Water-Gas Shift Reaction (HTS)',
    desc: 'CO + H₂O ⇌ CO₂ + H₂ high-temperature shift catalytic equilibrium (Fe₃O₄/Cr₂O₃, 350–450 °C)',
  },
  smr_reformer: {
    category: 'Syngas · Hydrogen',
    label: 'Steam Methane Reforming (SMR)',
    desc: 'Simultaneous CH₄ + H₂O ⇌ CO + 3H₂ and WGS multi-equilibrium reformer (Ni/Al₂O₃, 800–900 °C)',
  },
  nh3_haber_bosch: {
    category: 'Syngas · Fertilizer',
    label: 'High-Pressure Ammonia Synthesis (NH₃)',
    desc: 'N₂ + 3H₂ ⇌ 2NH₃ high-pressure real-gas (SRK) equilibrium reactor (Fe catalyst, 150–250 bar)',
  },
  meoh_synthesis: {
    category: 'Syngas · C1 Chemistry',
    label: 'Catalytic Methanol Synthesis',
    desc: 'Simultaneous CO + 2H₂ ⇌ CH₃OH and CO₂ hydrogenation equilibrium (Cu/ZnO/Al₂O₃, 240–270 °C)',
  },
  styrene_eb_dehydro: {
    category: 'Petrochemicals · Aromatics',
    label: 'Ethylbenzene Dehydrogenation (EB → Styrene + H₂)',
    desc: 'Steam-diluted adiabatic packed-bed PFR dehydrogenation (K-Fe₂O₃ catalyst, 600–650 °C, with Ergun ΔP)',
  },
  etoac_esterification: {
    category: 'Fine Chemicals · Solvents',
    label: 'Ethyl Acetate Esterification',
    desc: 'CH₃COOH + C₂H₅OH ⇌ EtOAc + H₂O non-ideal liquid-phase (NRTL γ_i) reversible equilibrium',
  },
  so2_contact_oxidation: {
    category: 'Inorganic Acids · Sulfuric Acid',
    label: 'SO₂ Contact Oxidation (SO₂ + 0.5 O₂ ⇌ SO₃)',
    desc: 'Exothermic oxidation and equilibrium limitation in V₂O₅ packed-bed catalytic reactor (with Ergun ΔP)',
  },
  cumene_alkylation: {
    category: 'Petrochemicals · Aromatics',
    label: 'Cumene Alkylation (Benzene + C₃H₆ → Cumene)',
    desc: 'Multi-tube jacket-cooled (Jacket UA) packed-bed PFR exothermic reaction with axial hotspot peak analysis',
  },
  mtbe_etherification: {
    category: 'Petrochemicals · Fuel Additives',
    label: 'MTBE Liquid-Phase Etherification (C₄H₈ + MeOH ⇌ MTBE)',
    desc: 'Ion-exchange resin catalytic cooled liquid CSTR reactor (NRTL activity & jacket cooling coupled)',
  },
  hcl_synthesis_burner: {
    category: 'Chlor-Alkali · Inorganic Chlorine',
    label: 'Anhydrous HCl Synthesis Adiabatic Burner (H₂ + Cl₂ → 2HCl)',
    desc: 'Complete chlorine combustion in excess hydrogen adiabatic reactor (ΔH°₂₉₈ = -184.6 kJ/mol, adiabatic flame temp)',
  },
  cl2_caustic_scrubbing: {
    category: 'Chlor-Alkali · Environmental Safety',
    label: 'Chlorine Caustic Scrubbing · Hypochlorite Synthesis',
    desc: 'Cl₂ + 2NaOH → NaOCl + NaCl + H₂O aqueous electrolyte exothermic neutralization (ENRTL heat balance)',
  },
  gte_glycerol_hydrochlorination: {
    category: 'Bio-ECH · Fine Chemicals',
    label: 'GTE Glycerol Hydrochlorination (Glycerol → MCH → DCH)',
    desc: 'Two-stage series liquid-phase CSTR chlorination kinetics with glycerol + anhydrous HCl',
  },
  ech_saponification: {
    category: 'Bio-ECH · Fine Chemicals',
    label: 'Epichlorohydrin Saponification (DCH + NaOH → ECH)',
    desc: 'Dichlorohydrin caustic saponification coupled with brine/organic VLE flash separation',
  },
  ipa_acetone_dehydro: {
    category: 'Fine Chemicals · Solvents',
    label: 'IPA Dehydrogenation to Acetone (IPA ⇌ Acetone + H₂)',
    desc: 'Heated multi-tube catalytic PFR endothermic dehydrogenation (axial cold-spot and conversion profile)',
  },
  cms_aibn_liquid_chlorination: {
    category: 'Chlorine Downstream · Chloromethanes (CMS)',
    label: 'Methyl Chloride AIBN Liquid Chlorination (MC → MCL → CFM → CTC)',
    desc: '24 kgf/cm²G · 120°C pressurized liquid PFR (AIBN radical-initiated consecutive chlorination: MCL/CFM/CTC/C₂Cl₄)',
  },
};

function cloneConfig(
  cfg: ReactorConfig | undefined,
  inletTempC: number,
  inletPressKgcm2g: number,
  propMethod: ResolvedPropertyMethod,
  activeComps: SimCompKey[],
  isSimOnly = false,
  isEn = false
): ReactorConfig {
  if (!cfg) {
    return {
      model: 'stoic',
      thermalMode: 'adiabatic',
      operTempC: inletTempC,
      operPressKgcm2g: inletPressKgcm2g,
      phaseMode: 'vle',
      propertyMethod: propMethod,
      volumeM3: 4.0,
      tubeCount: 1,
      tubeDiamM: 0.8,
      tubeLengthM: 8.0,
      jacketTempC: inletTempC,
      overallU_KcalM2HC: 200,
      catalystVoidage: 0.42,
      particleDiamMm: 0,
      gibbsSpeciesPool: [...activeComps],
      gibbsInertSet: [],
      reactions: [
        isSimOnly
          ? {
              id: 'R1',
              name: isEn ? 'Main Reaction 1 (Water-Gas Shift)' : '주반응 1 (수성가스 전환)',
              stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
              keyComp: 'CO',
              conversion: 0.85,
              k0Forward: 1.0e4,
              EaForwardKJmol: 60,
              reversible: false,
            }
          : {
              id: 'R1',
              name: isEn ? 'Main Reaction 1' : '주반응 1',
              stoic: { H2: -1, Cl2: -1, HCl: 2 },
              keyComp: 'Cl2',
              conversion: 0.99,
              k0Forward: 1.0e4,
              EaForwardKJmol: 60,
              reversible: false,
            },
      ],
    };
  }
  return {
    ...cfg,
    propertyMethod: cfg.propertyMethod ?? propMethod,
    phaseMode: cfg.phaseMode ?? 'vle',
    gibbsSpeciesPool: cfg.gibbsSpeciesPool ? [...cfg.gibbsSpeciesPool] : [...activeComps],
    gibbsInertSet: cfg.gibbsInertSet ? [...cfg.gibbsInertSet] : [],
    reactions: (cfg.reactions ?? []).map((r) => ({
      ...r,
      stoic: { ...r.stoic },
      keqOverride: r.keqOverride ? { ...r.keqOverride } : undefined,
      ordersForward: r.ordersForward ? { ...r.ordersForward } : undefined,
      ordersReverse: r.ordersReverse ? { ...r.ordersReverse } : undefined,
    })),
  };
}

function formatEquation(stoic: Partial<Record<SimCompKey, number>>, reversible?: boolean, isEn = false): string {
  const lhs: string[] = [];
  const rhs: string[] = [];
  for (const [k, nu] of Object.entries(stoic) as [SimCompKey, number][]) {
    if (!nu) continue;
    const absNu = Math.abs(nu);
    const coef = absNu === 1 ? '' : `${Number(absNu.toFixed(3))} `;
    if (nu < 0) lhs.push(`${coef}${k}`);
    else rhs.push(`${coef}${k}`);
  }
  const arrow = reversible ? '⇌' : '→';
  if (lhs.length === 0 && rhs.length === 0) {
    return isEn ? '(No stoichiometric coefficients entered)' : '(화학양론 계수 미입력)';
  }
  return `${lhs.join(' + ') || '∅'} ${arrow} ${rhs.join(' + ') || '∅'}`;
}

function buildSampleFeedForConfig(cfg: ReactorConfig): Partial<Record<SimCompKey, number>> {
  const sample: Partial<Record<SimCompKey, number>> = {};
  const rxns = cfg.reactions ?? [];
  if (rxns.length > 0) {
    for (const rxn of rxns) {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu && nu < 0) {
          const mw = (MW as Record<string, number>)[k] ?? 40;
          const kmol = Math.max(50, Math.abs(nu) * 80);
          sample[k] = Math.max(sample[k] ?? 0, kmol * mw);
        }
      }
    }
  }
  if (Object.keys(sample).length === 0 && cfg.gibbsSpeciesPool) {
    for (const k of cfg.gibbsSpeciesPool.slice(0, 2)) {
      const mw = (MW as Record<string, number>)[k] ?? 30;
      sample[k] = 80 * mw;
    }
  }
  return sample;
}

// ── PFR 축방향 프로파일 인라인 SVG 차트 컴포넌트 ──────────────────────────────

function PfrAxialSvgChart({
  profile,
  hotspotTempC,
}: {
  profile: ReactorAxialPoint[];
  hotspotTempC?: number;
}) {
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!profile || profile.length < 2) return null;

  const W = 520;
  const H = 205;
  const padL = 44;
  const padR = 44;
  const padT = 22;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const temps = profile.map((p) => p.tempC);
  const press = profile.map((p) => p.pressKgcm2g);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const tSpan = Math.max(2, tMax - tMin);
  const pMin = Math.min(...press);
  const pMax = Math.max(...press);
  const pSpan = Math.max(0.05, pMax - pMin);

  const xOf = (zFrac: number) => padL + zFrac * plotW;
  const yTemp = (t: number) => padT + plotH - ((t - (tMin - 0.08 * tSpan)) / (1.16 * tSpan)) * plotH;
  const yConv = (x: number) => padT + plotH - Math.max(0, Math.min(1, x)) * plotH;
  const yPress = (p: number) => padT + plotH - ((p - (pMin - 0.08 * pSpan)) / (1.16 * pSpan)) * plotH;

  const tempPoints = profile.map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yTemp(pt.tempC).toFixed(1)}`).join(' ');
  const convPoints = profile
    .map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yConv(pt.conversion).toFixed(1)}`)
    .join(' ');
  const pressPoints = profile
    .map((pt) => `${xOf(pt.zFrac).toFixed(1)},${yPress(pt.pressKgcm2g).toFixed(1)}`)
    .join(' ');

  let hotNode = profile[0];
  for (const pt of profile) {
    if (pt.tempC > hotNode.tempC) hotNode = pt;
  }

  const activeNode = hoverIdx !== null ? profile[hoverIdx] : hotNode;

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 9,
        border: '1px solid #CBD5E1',
        background: '#F8FAFC',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44' }}>
          {isEn
            ? 'Tubular PFR Axial Profile (60-Step RK4)'
            : '관형 PFR 축방향 프로파일 (60-Step RK4)'}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>
          <span style={{ color: '#1D4ED8' }}>{isEn ? '● T(z) Temp [°C]' : '● T(z) 온도 [°C]'}</span>
          <span style={{ color: '#0D9488' }}>{isEn ? '● X(z) Conv [%]' : '● X(z) 전환율 [%]'}</span>
          <span style={{ color: '#D97706' }}>{isEn ? '-- P(z) Press [kg/cm²g]' : '-- P(z) 압력 [kg/cm²g]'}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
          const z = Math.max(0, Math.min(1, (relX - padL) / plotW));
          const idx = Math.round(z * (profile.length - 1));
          setHoverIdx(Math.max(0, Math.min(profile.length - 1, idx)));
        }}
      >
        {/* 배경 격자 */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((g) => {
          const gy = padT + (1 - g) * plotH;
          return (
            <g key={g}>
              <line
                x1={padL}
                y1={gy}
                x2={W - padR}
                y2={gy}
                stroke="#E2E8F0"
                strokeWidth={1}
              />
              <text
                x={W - padR + 5}
                y={gy + 3.5}
                fontSize={9.5}
                fill="#0D9488"
                fontFamily={MONO}
                fontWeight={700}
              >
                {(g * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* 좌측 온도 눈금 */}
        <text x={4} y={padT + 6} fontSize={9.5} fill="#1D4ED8" fontFamily={MONO} fontWeight={700}>
          {tMax.toFixed(0)}°
        </text>
        <text x={4} y={padT + plotH} fontSize={9.5} fill="#1D4ED8" fontFamily={MONO} fontWeight={700}>
          {tMin.toFixed(0)}°
        </text>

        {/* X축 z/L 눈금 */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((zf) => (
          <text
            key={zf}
            x={xOf(zf)}
            y={H - 8}
            textAnchor="middle"
            fontSize={9.5}
            fill="#475569"
            fontFamily={MONO}
            fontWeight={700}
          >
            z/L={zf.toFixed(2)}
          </text>
        ))}

        {/* 압력 곡선 */}
        <polyline
          fill="none"
          stroke="#D97706"
          strokeWidth={1.8}
          strokeDasharray="5,3"
          points={pressPoints}
        />

        {/* 전환율 곡선 */}
        <polyline fill="none" stroke="#0D9488" strokeWidth={2.3} points={convPoints} />

        {/* 온도 곡선 */}
        <polyline fill="none" stroke="#1D4ED8" strokeWidth={2.5} points={tempPoints} />

        {/* Hotspot 마커 */}
        {hotspotTempC !== undefined && (
          <g>
            <circle
              cx={xOf(hotNode.zFrac)}
              cy={yTemp(hotNode.tempC)}
              r={4.5}
              fill="#1D4ED8"
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
            <text
              x={Math.min(W - padR - 55, Math.max(padL + 4, xOf(hotNode.zFrac) - 22))}
              y={Math.max(13, yTemp(hotNode.tempC) - 7)}
              fontSize={9.5}
              fill="#1E3A8A"
              fontFamily={MONO}
              fontWeight={800}
            >
              Tmax {hotNode.tempC.toFixed(1)}°C
            </text>
          </g>
        )}

        {/* 호버 수직 가이드 */}
        {hoverIdx !== null && activeNode && (
          <line
            x1={xOf(activeNode.zFrac)}
            y1={padT}
            x2={xOf(activeNode.zFrac)}
            y2={padT + plotH}
            stroke="#64748B"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}
      </svg>

      {activeNode && (
        <div
          style={{
            marginTop: 5,
            padding: '4px 8px',
            borderRadius: 6,
            background: '#EFF6FF',
            fontSize: 11,
            fontFamily: MONO,
            fontWeight: 700,
            color: '#1E3A8A',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span>
            z = {activeNode.lengthM.toFixed(2)} m ({(activeNode.zFrac * 100).toFixed(0)}%)
          </span>
          <span>T = {activeNode.tempC.toFixed(2)} °C</span>
          <span>X = {(activeNode.conversion * 100).toFixed(2)} %</span>
          <span>P = {activeNode.pressKgcm2g.toFixed(3)} kg/cm²g</span>
          <span>F_tot = {activeNode.totalMolarKmolH.toFixed(2)} kmol/h</span>
        </div>
      )}
    </div>
  );
}

// ── 메인 반응기 워크벤치 모달 ────────────────────────────────────────────────

export function ReactorWorkbenchModal({
  open,
  onClose,
  unitTag,
  unitName,
  inletFlowsKgH,
  inletTempC,
  inletPressKgcm2g,
  activeComponents,
  propertyMethod,
  initialConfig,
  onApplyConfig,
}: ReactorWorkbenchModalProps) {
  const { user } = useAuth();
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';
  const isSimOnly = isSimulatorOnlyUser(user);
  const visibleTemplates = useMemo(
    () =>
      isSimOnly
        ? INDUSTRIAL_REACTION_TEMPLATES.filter((t) => !isPrivatePlantReactionTemplate(t.id))
        : INDUSTRIAL_REACTION_TEMPLATES,
    [isSimOnly]
  );

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [cfg, setCfg] = useState<ReactorConfig>(() =>
    cloneConfig(initialConfig, inletTempC, inletPressKgcm2g, propertyMethod, activeComponents, isSimOnly, isEn)
  );
  const [useSampleFeed, setUseSampleFeed] = useState<boolean>(false);
  const [compToAddByRxn, setCompToAddByRxn] = useState<Record<string, SimCompKey>>({});
  const pushedHistoryRef = useRef(false);

  // 초기 설정 동기화
  useEffect(() => {
    if (open) {
      const next = cloneConfig(
        initialConfig,
        inletTempC,
        inletPressKgcm2g,
        propertyMethod,
        activeComponents,
        isSimOnly,
        isEn
      );
      setCfg(next);
      let liveSum = 0;
      for (const v of Object.values(inletFlowsKgH)) liveSum += v ?? 0;
      setUseSampleFeed(liveSum <= 1e-9);
    }
  }, [open, initialConfig, inletTempC, inletPressKgcm2g, propertyMethod, activeComponents, inletFlowsKgH, isSimOnly, isEn]);

  // 반응형 브레이크포인트 감지
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape 키 및 모바일 브라우저 뒤로가기(popstate) 지원
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    window.history.pushState({ reactorWorkbenchModal: true }, '');
    pushedHistoryRef.current = true;

    const onPopState = () => {
      pushedHistoryRef.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        window.history.back();
      }
    };
  }, [open, onClose]);

  const selectableComponents = useMemo<SimCompKey[]>(() => {
    const set = new Set<SimCompKey>(activeComponents);
    for (const [k, m] of Object.entries(inletFlowsKgH) as [SimCompKey, number][]) {
      if ((m ?? 0) > 0) set.add(k);
    }
    for (const rxn of cfg.reactions ?? []) {
      for (const k of Object.keys(rxn.stoic) as SimCompKey[]) set.add(k);
    }
    for (const k of cfg.gibbsSpeciesPool ?? []) set.add(k);
    const prioritized = Array.from(set);
    for (const k of ALL_REACTOR_COMPS) {
      if (!set.has(k)) prioritized.push(k);
    }
    return prioritized;
  }, [activeComponents, inletFlowsKgH, cfg.reactions, cfg.gibbsSpeciesPool]);

  const previewFeed = useMemo<Partial<Record<SimCompKey, number>>>(() => {
    if (useSampleFeed) return buildSampleFeedForConfig(cfg);
    return inletFlowsKgH;
  }, [useSampleFeed, cfg, inletFlowsKgH]);

  const previewTempC = useSampleFeed ? (cfg.operTempC ?? inletTempC) : inletTempC;
  const previewPressG = useSampleFeed ? (cfg.operPressKgcm2g ?? inletPressKgcm2g) : inletPressKgcm2g;

  const liveResult = useMemo(() => {
    return solveChemicalReactor(previewFeed, previewTempC, previewPressG, cfg);
  }, [previewFeed, previewTempC, previewPressG, cfg]);

  const [tempUnit, setTempUnit] = useLocalUnit('temp');
  const [pressUnit, setPressUnit] = useLocalUnit('pressG');
  const [dpUnit, setDpUnit] = useLocalUnit('deltaP');
  const [dutyUnit, setDutyUnit] = useLocalUnit('heatDuty');
  const [htcUnit, setHtcUnit] = useLocalUnit('htc');
  const [volUnit, setVolUnit] = useLocalUnit('volume');
  const [lenUnit, setLenUnit] = useLocalUnit('length');
  const [massUnit, setMassUnit] = useLocalUnit('massFlow');

  if (!open) return null;

  const applyTemplate = (tplId: string) => {
    const tpl = visibleTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    const cloned = cloneConfig(
      tpl.defaultConfig,
      inletTempC,
      inletPressKgcm2g,
      tpl.defaultConfig.propertyMethod ?? propertyMethod,
      activeComponents,
      isSimOnly
    );
    setCfg(cloned);
    // 실제 피드에 해당 반응물이 없으면 자동으로 샘플 피드 프리뷰 활성화
    let hasReactantInLive = false;
    for (const rxn of cloned.reactions ?? []) {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu && nu < 0 && (inletFlowsKgH[k] ?? 0) > 1e-6) {
          hasReactantInLive = true;
        }
      }
    }
    if (!hasReactantInLive) setUseSampleFeed(true);
  };

  const updateReaction = (idx: number, patch: Partial<StoicReactionSpec>) => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, reactions: list };
    });
  };

  const updateStoicCoef = (rxnIdx: number, comp: SimCompKey, nuVal: number) => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      const nextStoic = { ...(list[rxnIdx].stoic ?? {}) };
      if (!Number.isFinite(nuVal) || Math.abs(nuVal) < 1e-12) {
        delete nextStoic[comp];
      } else {
        nextStoic[comp] = nuVal;
      }
      list[rxnIdx] = { ...list[rxnIdx], stoic: nextStoic };
      return { ...prev, reactions: list };
    });
  };

  const addReaction = () => {
    setCfg((prev) => {
      const list = [...(prev.reactions ?? [])];
      const nextId = `R${list.length + 1}`;
      const c1 = activeComponents[0] ?? 'CO';
      const c2 = activeComponents[1] ?? 'H2O';
      list.push({
        id: nextId,
        name: isEn ? `Reaction ${list.length + 1}` : `반응 ${list.length + 1}`,
        stoic: { [c1]: -1, [c2]: 1 },
        keyComp: c1,
        conversion: 0.8,
        k0Forward: 1e4,
        EaForwardKJmol: 60,
        reversible: false,
      });
      return { ...prev, reactions: list };
    });
  };

  const removeReaction = (idx: number) => {
    setCfg((prev) => {
      const list = (prev.reactions ?? []).filter((_, i) => i !== idx);
      return { ...prev, reactions: list };
    });
  };

  const toggleGibbsPoolComp = (comp: SimCompKey) => {
    setCfg((prev) => {
      const pool = new Set<SimCompKey>(prev.gibbsSpeciesPool ?? []);
      if (pool.has(comp)) pool.delete(comp);
      else pool.add(comp);
      return { ...prev, gibbsSpeciesPool: Array.from(pool) };
    });
  };

  const toggleGibbsInertComp = (comp: SimCompKey) => {
    setCfg((prev) => {
      const inerts = new Set<SimCompKey>(prev.gibbsInertSet ?? []);
      if (inerts.has(comp)) inerts.delete(comp);
      else inerts.add(comp);
      return { ...prev, gibbsInertSet: Array.from(inerts) };
    });
  };

  // 입출구 스트림 비교 행 데이터
  const streamRows = ALL_REACTOR_COMPS.filter(
    (k) => (previewFeed[k] ?? 0) > 1e-8 || (liveResult.outletFlowsKgH[k] ?? 0) > 1e-8
  );
  let totOutMoles = 0;
  for (const k of streamRows) {
    totOutMoles += (liveResult.outletFlowsKgH[k] ?? 0) / ((MW as Record<string, number>)[k] ?? 40);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 31,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: '#1A2F44',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: MONO,
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 800,
    color: '#475569',
    marginBottom: 4,
  };

  const cardStyle: React.CSSProperties = {
    padding: isMobile ? '10px 11px' : '12px 14px',
    borderRadius: 9,
    border: '1px solid #E2E8F0',
    background: '#FFFFFF',
  };

  const isKinetic = cfg.model === 'cstr' || cfg.model === 'pfr';
  const dutyKW = liveResult.heatDutyKcalH / 860.42;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 14,
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? '100vw' : 'min(1260px, 96vw)',
          height: isMobile ? '100dvh' : 'min(880px, 93vh)',
          background: '#F8FAFC',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid #CBD5E1',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.38)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#1A2F44',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* ── 상단 고정 헤더 (Deep Industrial Navy) ── */}
        <div
          style={{
            background: '#1A2F44',
            color: '#FFFFFF',
            padding: isMobile ? '10px 12px' : '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#2563EB',
                  fontSize: 11,
                  fontWeight: 900,
                  fontFamily: MONO,
                }}
              >
                {unitTag}
              </span>
              <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 900 }}>
                {isEn
                  ? `Universal Chemical Reactor Workbench — ${unitName}`
                  : `범용 화학 반응기 워크벤치 — ${unitName}`}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: liveResult.converged ? '#059669' : '#D97706',
                  fontSize: 10.5,
                  fontWeight: 800,
                  fontFamily: MONO,
                }}
              >
                {liveResult.converged ? 'CONVERGED' : 'CHECK SPEC'}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#93C5FD', marginTop: 3 }}>
              {isEn
                ? 'Integrated Solver: Stoichiometric · Equilibrium (Keq) · Gibbs Minimization · CSTR · Multi-Tube Packed PFR'
                : '양론 · 화학평형(Keq) · Gibbs 자유에너지 최소화 · CSTR · 다관식 충전층 PFR 통합 해석기'}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: isMobile ? '6px 11px' : '6px 12px',
              height: 32,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.42)',
              background: '#142435',
              color: '#FFFFFF',
              fontSize: 12.5,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {isEn ? '✕ Close' : '✕ 닫기'}
          </button>
        </div>

        {/* ── 본문 스크롤 영역 (데스크탑 2단 / 모바일 1단) ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? 10 : 16,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.22fr 1fr',
            gap: isMobile ? 12 : 16,
            alignItems: 'start',
          }}
        >
          {/* ── 좌측: 반응기 모델 · 템플릿 · 운전조건 · 양론/속도론 편집 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 1) 14종 산업 화학반응 프리셋 빠른 불러오기 */}
            <div style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 7,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#1A2F44' }}>
                  {isEn
                    ? `Industrial Standard Reaction Templates (${visibleTemplates.length})`
                    : `산업 표준 반응 템플릿 (${visibleTemplates.length}종)`}
                </span>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 700,
                    color: useSampleFeed ? '#1D4ED8' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useSampleFeed}
                    onChange={(e) => setUseSampleFeed(e.target.checked)}
                  />
                  {isEn ? 'Use sample reactant feed for preview' : '프리뷰에 반응물 샘플 피드 사용'}
                </label>
              </div>
              <select
                value={visibleTemplates.some((t) => t.id === cfg.presetId) ? (cfg.presetId ?? '') : ''}
                onChange={(e) => applyTemplate(e.target.value)}
                style={selectStyle}
              >
                <option value="">
                  {isEn
                    ? `-- Custom setup or select from ${visibleTemplates.length} industrial reaction templates --`
                    : `-- 직접 구성 또는 ${visibleTemplates.length}종 산업 반응 템플릿 선택 --`}
                </option>
                {visibleTemplates.map((tpl) => {
                  const enTpl = TEMPLATE_EN[tpl.id];
                  return (
                    <option key={tpl.id} value={tpl.id}>
                      [{isEn && enTpl ? enTpl.category : tpl.category}] {isEn && enTpl ? enTpl.label : tpl.labelKo}
                    </option>
                  );
                })}
              </select>
              {cfg.presetId && visibleTemplates.some((t) => t.id === cfg.presetId) && (
                <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                  {isEn && TEMPLATE_EN[cfg.presetId]
                    ? TEMPLATE_EN[cfg.presetId].desc
                    : visibleTemplates.find((t) => t.id === cfg.presetId)?.descKo}
                </div>
              )}
            </div>

            {/* 2) 5종 반응기 모델 탭 */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 8 }}>
                {isEn ? 'Reactor Solver Model Selection (5 Models)' : '반응기 해석 모델 선택 (5종)'}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
                  gap: 6,
                }}
              >
                {MODEL_TABS.map((m) => {
                  const active = cfg.model === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() =>
                        setCfg((prev) => ({
                          ...prev,
                          model: m.key,
                          thermalMode:
                            prev.thermalMode === 'jacket_ua' && m.key !== 'cstr' && m.key !== 'pfr'
                              ? 'isothermal'
                              : prev.thermalMode,
                        }))
                      }
                      style={{
                        padding: '8px 6px',
                        borderRadius: 8,
                        border: active ? '2px solid #1D4ED8' : '1px solid #CBD5E1',
                        background: active ? '#EFF6FF' : '#FFFFFF',
                        color: active ? '#1E3A8A' : '#334155',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 900, fontFamily: MONO, color: '#2563EB' }}>
                        {m.shortTag}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 2 }}>
                        {isEn ? m.labelEn : m.labelKo}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 7 }}>
                {isEn
                  ? MODEL_TABS.find((t) => t.key === cfg.model)?.descEn
                  : MODEL_TABS.find((t) => t.key === cfg.model)?.descKo}
              </div>
            </div>

            {/* 3) 열수지 · 상모드 · 운전 조건 · 기하 치수 */}
            <div style={cardStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 9 }}>
                {isEn
                  ? 'Thermal Mode · Phase Equilibrium · Geometry Setup'
                  : '열수지 모드 · 상평형 · 기하 구조 설정'}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                  gap: 8,
                }}
              >
                <div>
                  <label style={labelStyle}>{isEn ? 'Thermal Mode' : '열수지 모드'}</label>
                  <select
                    value={cfg.thermalMode}
                    onChange={(e) =>
                      setCfg((p) => ({ ...p, thermalMode: e.target.value as ReactorThermalMode }))
                    }
                    style={selectStyle}
                  >
                    {THERMAL_OPTIONS.filter(
                      (opt) => opt.key !== 'jacket_ua' || cfg.model === 'cstr' || cfg.model === 'pfr'
                    ).map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {isEn ? opt.labelEn : opt.labelKo}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>{isEn ? 'Reaction Phase Mode' : '반응 상 모드'}</label>
                  <select
                    value={cfg.phaseMode ?? 'vle'}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        phaseMode: e.target.value as 'vapor' | 'liquid' | 'vle',
                      }))
                    }
                    style={selectStyle}
                  >
                    <option value="vle">{isEn ? 'Vapor-Liquid Equilibrium (Auto VLE)' : '기액평형 (VLE 자동)'}</option>
                    <option value="vapor">{isEn ? 'Vapor Phase (Vapor)' : '기상 반응 (Vapor)'}</option>
                    <option value="liquid">{isEn ? 'Liquid Phase (Liquid)' : '액상 반응 (Liquid)'}</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>{isEn ? 'Property Package' : '물성 패키지'}</label>
                  <select
                    value={cfg.propertyMethod ?? propertyMethod}
                    onChange={(e) =>
                      setCfg((p) => ({
                        ...p,
                        propertyMethod: e.target.value as ResolvedPropertyMethod,
                      }))
                    }
                    style={selectStyle}
                  >
                    {(['ENRTL', 'NRTL', 'PR', 'SRK'] as ResolvedPropertyMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {m} — {isEn ? (PROPERTY_METHOD_SHORT_EN[m] ?? m) : (PROPERTY_METHOD_INFO[m]?.shortKo ?? m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>{isEn ? 'Operating Pressure' : '운전 압력'}</label>
                  <UnitNumberInput
                    quantity="pressG"
                    unitId={pressUnit}
                    onUnitChange={setPressUnit}
                    syncKey={`${unitTag}-rx-p`}
                    value={cfg.operPressKgcm2g ?? inletPressKgcm2g}
                    onValueChange={(v) => setCfg((p) => ({ ...p, operPressKgcm2g: v }))}
                    inputStyle={inputStyle}
                  />
                </div>

                {cfg.thermalMode === 'isothermal' && (
                  <div>
                    <label style={labelStyle}>{isEn ? 'Isothermal Operating Temp' : '등온 운전 온도'}</label>
                    <UnitNumberInput
                      quantity="temp"
                      unitId={tempUnit}
                      onUnitChange={setTempUnit}
                      syncKey={`${unitTag}-rx-t`}
                      value={cfg.operTempC ?? inletTempC}
                      onValueChange={(v) => setCfg((p) => ({ ...p, operTempC: v }))}
                      inputStyle={inputStyle}
                    />
                  </div>
                )}

                {cfg.thermalMode === 'specified_duty' && (
                  <div>
                    <label style={labelStyle}>{isEn ? 'Specified Heat Duty Q' : '지정 열부하 Q'}</label>
                    <UnitNumberInput
                      quantity="heatDuty"
                      unitId={dutyUnit}
                      onUnitChange={setDutyUnit}
                      syncKey={`${unitTag}-rx-q`}
                      value={(cfg.specifiedDutyKcalH ?? 0) / 1000}
                      onValueChange={(v) =>
                        setCfg((p) => ({ ...p, specifiedDutyKcalH: v * 1000 }))
                      }
                      inputStyle={inputStyle}
                    />
                  </div>
                )}

                {cfg.thermalMode === 'jacket_ua' && (
                  <>
                    <div>
                      <label style={labelStyle}>{isEn ? 'Jacket Medium Temp T_jacket' : '열매체 온도 T_jacket'}</label>
                      <UnitNumberInput
                        quantity="temp"
                        unitId={tempUnit}
                        onUnitChange={setTempUnit}
                        syncKey={`${unitTag}-rx-tj`}
                        value={cfg.jacketTempC ?? inletTempC}
                        onValueChange={(v) => setCfg((p) => ({ ...p, jacketTempC: v }))}
                        inputStyle={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{isEn ? 'Overall Heat Transfer Coeff U' : '총괄열전달계수 U'}</label>
                      <UnitNumberInput
                        quantity="htc"
                        unitId={htcUnit}
                        onUnitChange={setHtcUnit}
                        syncKey={`${unitTag}-rx-u`}
                        value={cfg.overallU_KcalM2HC ?? 200}
                        onValueChange={(v) => setCfg((p) => ({ ...p, overallU_KcalM2HC: v }))}
                        inputStyle={inputStyle}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* CSTR / PFR 기하 및 충전층 Ergun 입력 */}
              {isKinetic && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px dashed #CBD5E1',
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
                    gap: 8,
                  }}
                >
                  <div>
                    <label style={labelStyle}>{isEn ? 'Reactor Volume V' : '반응기 부피 V'}</label>
                    <UnitNumberInput
                      quantity="volume"
                      unitId={volUnit}
                      onUnitChange={setVolUnit}
                      syncKey={`${unitTag}-rx-v`}
                      minCanonical={0.0001}
                      value={cfg.volumeM3 ?? 4.0}
                      onValueChange={(v) =>
                        setCfg((p) => ({
                          ...p,
                          volumeM3: Math.max(0.0001, v),
                        }))
                      }
                      inputStyle={inputStyle}
                    />
                  </div>

                  {cfg.model === 'pfr' && (
                    <>
                      <div>
                        <label style={labelStyle}>{isEn ? 'Parallel Tube Count N_tube' : '병렬 튜브 수 N_tube'}</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={cfg.tubeCount ?? 1}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              tubeCount: Math.max(1, Math.round(Number(e.target.value))),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>{isEn ? 'Tube Inner Diameter D' : '튜브 내경 D'}</label>
                        <UnitNumberInput
                          quantity="length"
                          unitId={lenUnit}
                          onUnitChange={setLenUnit}
                          syncKey={`${unitTag}-rx-td`}
                          minCanonical={0.005}
                          value={cfg.tubeDiamM ?? 0.1}
                          onValueChange={(v) =>
                            setCfg((p) => ({
                              ...p,
                              tubeDiamM: Math.max(0.005, v),
                            }))
                          }
                          inputStyle={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>{isEn ? 'Tube Length L' : '튜브 길이 L'}</label>
                        <UnitNumberInput
                          quantity="length"
                          unitId={lenUnit}
                          onUnitChange={setLenUnit}
                          syncKey={`${unitTag}-rx-tl`}
                          minCanonical={0.05}
                          value={cfg.tubeLengthM ?? 4.0}
                          onValueChange={(v) =>
                            setCfg((p) => ({
                              ...p,
                              tubeLengthM: Math.max(0.05, v),
                            }))
                          }
                          inputStyle={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>{isEn ? 'Catalyst Particle Dia d_p [mm] (Ergun)' : '촉매 입경 d_p [mm] (Ergun)'}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={cfg.particleDiamMm ?? 0}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              particleDiamMm: Math.max(0, Number(e.target.value)),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>{isEn ? 'Catalyst Bed Voidage ε (0.2~0.9)' : '촉매 공극률 ε (0.2~0.9)'}</label>
                        <input
                          type="number"
                          min="0.2"
                          max="0.9"
                          step="0.02"
                          value={cfg.catalystVoidage ?? 0.42}
                          onChange={(e) =>
                            setCfg((p) => ({
                              ...p,
                              catalystVoidage: Math.max(0.15, Math.min(0.95, Number(e.target.value))),
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 4) 모델별 화학양론/속도식 또는 Gibbs 화학종 풀 편집기 */}
            {cfg.model === 'gibbs' ? (
              <div style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 900 }}>
                    {isEn
                      ? 'Gibbs Equilibrium Species Pool & Inert Components'
                      : 'Gibbs 평형 탐색 화학종 풀 (Species Pool) & 불활성 성분'}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setCfg((p) => ({
                          ...p,
                          gibbsSpeciesPool: Array.from(
                            new Set([...(p.gibbsSpeciesPool ?? []), 'CH4', 'H2O', 'CO', 'CO2', 'H2', 'NH3', 'N2'])
                          ),
                        }))
                      }
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#EFF6FF',
                        color: '#1D4ED8',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {isEn ? '+ Add Syngas Pool' : '+ 합성가스 풀 추가'}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>
                  {isEn
                    ? 'Select possible product species to minimize total Gibbs free energy while conserving inlet elements (C, H, O, N, Cl, S, Na...).'
                    : '유입 원소(C, H, O, N, Cl, S, Na...)를 보존하면서 총 Gibbs 에너지를 최소화할 생성 가능 성분들을 선택하세요.'}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {selectableComponents.slice(0, 28).map((k) => {
                    const inPool = (cfg.gibbsSpeciesPool ?? []).includes(k);
                    const isInert = (cfg.gibbsInertSet ?? []).includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleGibbsPoolComp(k)}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 999,
                          border: inPool ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                          background: isInert ? '#FEF3C7' : inPool ? '#DBEAFE' : '#FFFFFF',
                          color: isInert ? '#92400E' : inPool ? '#1E3A8A' : '#475569',
                          fontSize: 11,
                          fontWeight: 800,
                          fontFamily: MONO,
                          cursor: 'pointer',
                        }}
                      >
                        {inPool ? '✓ ' : ''}
                        {k}
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 5 }}>
                  {isEn ? 'Non-Reacting Inert Components (Fixed):' : '반응 제외 불활성 성분 (Inert 고정):'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(['N2', 'Ar', 'H2O', 'CH4', 'CO2'] as SimCompKey[]).map((k) => {
                    const isInert = (cfg.gibbsInertSet ?? []).includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleGibbsInertComp(k)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          border: isInert ? '1.5px solid #D97706' : '1px solid #CBD5E1',
                          background: isInert ? '#FEF3C7' : '#FFFFFF',
                          color: isInert ? '#92400E' : '#64748B',
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: MONO,
                          cursor: 'pointer',
                        }}
                      >
                        {isInert ? (isEn ? 'Inert: ' : '불활성 고정: ') : ''}
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 900 }}>
                    {isEn
                      ? `Reaction Stoichiometry & Kinetics/Equilibrium Parameters (${(cfg.reactions ?? []).length} ${(cfg.reactions ?? []).length === 1 ? 'Reaction' : 'Reactions'})`
                      : `반응 화학양론 및 속도/평형 파라미터 (${(cfg.reactions ?? []).length}개 반응)`}
                  </span>
                  <button
                    type="button"
                    onClick={addReaction}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #1D4ED8',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {isEn ? '+ Add Reaction' : '+ 반응 추가'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(cfg.reactions ?? []).map((rxn, idx) => {
                    const bal = checkStoichiometryBalance(rxn.stoic);
                    const stdThermo = calcReactionStdThermo(
                      rxn,
                      liveResult.outletTempC,
                      cfg.phaseMode === 'liquid' ? 'liquid' : 'vapor'
                    );
                    const stoicEntries = Object.entries(rxn.stoic) as [SimCompKey, number][];
                    const addKey = compToAddByRxn[rxn.id] ?? selectableComponents[0] ?? 'H2';

                    return (
                      <div
                        key={rxn.id}
                        style={{
                          padding: '10px 11px',
                          borderRadius: 8,
                          border: bal.balanced ? '1px solid #CBD5E1' : '1.5px solid #D97706',
                          background: '#F8FAFC',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                            marginBottom: 6,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                padding: '2px 7px',
                                borderRadius: 5,
                                background: '#1A2F44',
                                color: '#FFFFFF',
                                fontSize: 10.5,
                                fontWeight: 900,
                                fontFamily: MONO,
                              }}
                            >
                              #{idx + 1}
                            </span>
                            <input
                              type="text"
                              value={rxn.name ?? rxn.id}
                              onChange={(e) => updateReaction(idx, { name: e.target.value })}
                              style={{ ...inputStyle, width: 170, height: 27, fontFamily: 'inherit' }}
                            />
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: bal.balanced ? '#DCFCE7' : '#FEF3C7',
                                color: bal.balanced ? '#166534' : '#92400E',
                                fontSize: 10.5,
                                fontWeight: 800,
                                fontFamily: MONO,
                              }}
                            >
                              {bal.balanced
                                ? (isEn ? 'Atom Balance OK' : '원소 균형 OK')
                                : (isEn
                                    ? `Imbalance ΔMW=${bal.mwResidualGmol.toFixed(2)}`
                                    : `불균형 ΔMW=${bal.mwResidualGmol.toFixed(2)}`)}
                            </span>
                          </div>

                          {(cfg.reactions ?? []).length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeReaction(idx)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: '1px solid #FCA5A5',
                                background: '#FEF2F2',
                                color: '#B91C1C',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {isEn ? 'Delete' : '삭제'}
                            </button>
                          )}
                        </div>

                        {/* 반응식 요약 및 ΔH° / Keq 표시 */}
                        <div
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            fontSize: 11.5,
                            fontFamily: MONO,
                            fontWeight: 800,
                            color: '#1E3A8A',
                            marginBottom: 8,
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <span>
                            {formatEquation(
                              rxn.stoic,
                              cfg.model === 'equilibrium' || rxn.reversible,
                              isEn
                            )}
                          </span>
                          <span style={{ color: '#475569' }}>
                            ΔH°₂₉₈={stdThermo.dH298KJmol.toFixed(1)} kJ/mol | Keq(
                            {liveResult.outletTempC.toFixed(0)}°C)=
                            {stdThermo.Keq > 1e4 || stdThermo.Keq < 1e-3
                              ? stdThermo.Keq.toExponential(2)
                              : stdThermo.Keq.toFixed(3)}
                          </span>
                        </div>

                        {/* 양론 계수 ν_i 칩 편집 */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            alignItems: 'center',
                            marginBottom: 8,
                          }}
                        >
                          {stoicEntries.map(([comp, nu]) => (
                            <div
                              key={comp}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 6px',
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  fontFamily: MONO,
                                  color: nu < 0 ? '#1D4ED8' : '#059669',
                                }}
                              >
                                {comp}
                              </span>
                              <input
                                type="number"
                                step="0.5"
                                value={nu}
                                onChange={(e) =>
                                  updateStoicCoef(idx, comp, Number(e.target.value))
                                }
                                style={{
                                  width: 58,
                                  height: 24,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  border: '1px solid #CBD5E1',
                                  fontFamily: MONO,
                                  fontSize: 11.5,
                                  fontWeight: 800,
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => updateStoicCoef(idx, comp, 0)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#94A3B8',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  padding: '0 2px',
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}

                          {/* 성분 추가 */}
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <select
                              value={addKey}
                              onChange={(e) =>
                                setCompToAddByRxn((p) => ({
                                  ...p,
                                  [rxn.id]: e.target.value as SimCompKey,
                                }))
                              }
                              style={{ ...selectStyle, width: 105, height: 26, fontSize: 11 }}
                            >
                              {selectableComponents.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateStoicCoef(idx, addKey, rxn.stoic[addKey] ?? 1)
                              }
                              style={{
                                height: 26,
                                padding: '0 8px',
                                borderRadius: 5,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {isEn ? '+ Add Coeff' : '+ 계수 추가'}
                            </button>
                          </div>
                        </div>

                        {/* 모델별 반응 세부 파라미터 */}
                        {cfg.model === 'stoic' && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 8,
                            }}
                          >
                            <div>
                              <label style={labelStyle}>
                                {isEn ? 'Key Reactant (Key Component)' : '기준 반응물 (Key Component)'}
                              </label>
                              <select
                                value={rxn.keyComp ?? ''}
                                onChange={(e) =>
                                  updateReaction(idx, { keyComp: e.target.value as SimCompKey })
                                }
                                style={selectStyle}
                              >
                                {stoicEntries
                                  .filter(([, nu]) => nu < 0)
                                  .map(([c]) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>
                                {isEn
                                  ? `Target Conversion X (0 ~ 1): ${((rxn.conversion ?? 0.9) * 100).toFixed(1)}%`
                                  : `목표 전환율 X (0 ~ 1): ${((rxn.conversion ?? 0.9) * 100).toFixed(1)}%`}
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                value={rxn.conversion ?? 0.9}
                                onChange={(e) =>
                                  updateReaction(idx, {
                                    conversion: Math.max(0, Math.min(1, Number(e.target.value))),
                                  })
                                }
                                style={inputStyle}
                              />
                            </div>
                          </div>
                        )}

                        {isKinetic && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr',
                              gap: 8,
                            }}
                          >
                            <div>
                              <label style={labelStyle}>
                                {isEn ? 'Pre-exponential Factor k₀_fwd [kmol/m³·s]' : '빈도인자 k₀_fwd [kmol/m³·s 기준]'}
                              </label>
                              <input
                                type="number"
                                step="100"
                                value={rxn.k0Forward ?? 1e4}
                                onChange={(e) =>
                                  updateReaction(idx, { k0Forward: Math.max(0, Number(e.target.value)) })
                                }
                                style={inputStyle}
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>
                                {isEn ? 'Activation Energy Ea_fwd [kJ/mol]' : '활성화 에너지 Ea_fwd [kJ/mol]'}
                              </label>
                              <input
                                type="number"
                                step="1"
                                value={rxn.EaForwardKJmol ?? 60}
                                onChange={(e) =>
                                  updateReaction(idx, { EaForwardKJmol: Number(e.target.value) })
                                }
                                style={inputStyle}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 5 }}>
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 11.5,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(rxn.reversible)}
                                  onChange={(e) =>
                                    updateReaction(idx, { reversible: e.target.checked })
                                  }
                                />
                                {isEn ? 'Reversible Reaction (Keq Reverse Coupled)' : '가역 반응 (Keq 역반응 연동)'}
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── 우측: 실시간 시뮬레이션 프리뷰 · 보존율 배지 · PFR 차트 · 스트림 표 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 보존 진단 & 상태 배너 */}
            <div
              style={{
                ...cardStyle,
                background: liveResult.converged ? '#F0FDF4' : '#FFFBEB',
                border: liveResult.converged ? '1px solid #86EFAC' : '1px solid #FCD34D',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: '#1A2F44' }}>
                {liveResult.statusNote}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 7,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  fontWeight: 800,
                }}
              >
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: liveResult.atomBalanceMaxRelErr < 1e-6 ? '#DCFCE7' : '#FEF3C7',
                    color: liveResult.atomBalanceMaxRelErr < 1e-6 ? '#166534' : '#92400E',
                  }}
                >
                  {isEn ? 'Atom Balance Error:' : '원소보존 오차:'} {liveResult.atomBalanceMaxRelErr.toExponential(2)}
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: liveResult.massBalanceRelErr < 1e-6 ? '#DCFCE7' : '#FEF3C7',
                    color: liveResult.massBalanceRelErr < 1e-6 ? '#166534' : '#92400E',
                  }}
                >
                  {isEn ? 'Mass Balance Error:' : '질량보존 오차:'} {liveResult.massBalanceRelErr.toExponential(2)}
                </span>
                {useSampleFeed && (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#DBEAFE',
                      color: '#1E40AF',
                    }}
                  >
                    {isEn ? 'Sample Feed Preview Active' : '샘플 피드 프리뷰 활성'}
                  </span>
                )}
              </div>

              {liveResult.warnings.length > 0 && (
                <div style={{ marginTop: 7, fontSize: 11, color: '#B45309', fontWeight: 700 }}>
                  {liveResult.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}
            </div>

            {/* 핵심 성능 지표 KPI 카드 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}
            >
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                    {isEn ? 'Outlet Temp T_out / ΔT' : '출구 온도 T_out / ΔT'}
                  </span>
                  <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {formatCanonicalValue('temp', liveResult.outletTempC, tempUnit, 1)} {getUnitLabel('temp', tempUnit)}{' '}
                  <span
                    style={{
                      fontSize: 12,
                      color:
                        liveResult.outletTempC - previewTempC >= 0 ? '#D97706' : '#0284C7',
                    }}
                  >
                    ({formatSignedDeltaT(liveResult.outletTempC - previewTempC, tempUnit)})
                  </span>
                </div>
                {liveResult.hotspotTempC !== undefined && (
                  <div style={{ fontSize: 11, color: '#1D4ED8', fontFamily: MONO, fontWeight: 700 }}>
                    {isEn ? 'Peak Hotspot:' : '최고점 Hotspot:'} {formatCanonicalValue('temp', liveResult.hotspotTempC, tempUnit, 1)} {getUnitLabel('temp', tempUnit)}
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                    {isEn
                      ? `Reactor Heat Duty Q (${liveResult.heatDutyKcalH >= 0 ? 'Heating/Endo' : 'Cooling/Exo'})`
                      : `반응기 열부하 Q (${liveResult.heatDutyKcalH >= 0 ? '가열/흡열' : '냉각/발열'})`}
                  </span>
                  <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {formatCanonicalValue('heatDuty', liveResult.heatDutyKcalH / 1000, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: MONO, fontWeight: 700 }}>
                  ({dutyKW.toFixed(1)} kW)
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                    {isEn ? 'Outlet Pressure / Packed Bed ΔP' : '출구 압력 / 충전층 ΔP'}
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} />
                    <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, fontFamily: MONO, marginTop: 3 }}>
                  {formatCanonicalValue('pressG', liveResult.outletPressKgcm2g, pressUnit, 2)} {getUnitLabel('pressG', pressUnit)}
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: MONO, fontWeight: 700 }}>
                  ΔP = {formatCanonicalValue('deltaP', liveResult.pressureDropBar * BAR_TO_KGCM2, dpUnit, 3)} {getUnitLabel('deltaP', dpUnit)}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800 }}>
                  {isEn ? 'Key Reactant Conversion (X)' : '주요 반응물 전환율 (X)'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, fontFamily: MONO, marginTop: 4 }}>
                  {Object.keys(liveResult.keyConversions).length === 0
                    ? '—'
                    : Object.entries(liveResult.keyConversions)
                        .slice(0, 3)
                        .map(([k, x]) => `${k}: ${(x * 100).toFixed(1)}%`)
                        .join(' | ')}
                </div>
              </div>
            </div>

            {/* PFR 축방향 프로파일 SVG 차트 */}
            {cfg.model === 'pfr' && liveResult.axialProfile && (
              <PfrAxialSvgChart
                profile={liveResult.axialProfile}
                hotspotTempC={liveResult.hotspotTempC}
              />
            )}

            {/* 입출구 성분 물질수지 및 기액 분배 표 */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 900 }}>
                  {isEn ? 'Inlet/Outlet Material Balance & Phase Split Summary' : '입·출구 성분 물질수지 및 상분배 요약'}
                </span>
                <UnitSelect quantity="massFlow" value={massUnit} onChange={setMassUnit} />
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 11.5,
                    fontFamily: MONO,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: '2px solid #CBD5E1', color: '#475569' }}>
                      <th style={{ textAlign: 'left', padding: '5px 4px' }}>{isEn ? 'Component' : '성분'}</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>{isEn ? 'Inlet' : '유입'} [{getUnitLabel('massFlow', massUnit)}]</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>{isEn ? 'Outlet' : '출구'} [{getUnitLabel('massFlow', massUnit)}]</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>{isEn ? 'Outlet [mol%]' : '출구 [mol%]'}</th>
                      <th style={{ textAlign: 'right', padding: '5px 4px' }}>{isEn ? 'Vapor/Liquid' : '기상/액상'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streamRows.map((k) => {
                      const mIn = previewFeed[k] ?? 0;
                      const mOut = liveResult.outletFlowsKgH[k] ?? 0;
                      const mw = (MW as Record<string, number>)[k] ?? 40;
                      const molPct = totOutMoles > 0 ? ((mOut / mw) / totOutMoles) * 100 : 0;
                      const vFrac = mOut > 1e-9 ? ((liveResult.vapFlowsKgH[k] ?? 0) / mOut) * 100 : 0;
                      return (
                        <tr key={k} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '5px 4px', fontWeight: 800, color: '#1A2F44' }}>
                            {k}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#64748B' }}>
                            {formatCanonicalValue('massFlow', mIn, massUnit)}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 800 }}>
                            {formatCanonicalValue('massFlow', mOut, massUnit)}
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#1D4ED8' }}>
                            {molPct.toFixed(2)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#0D9488' }}>
                            V {vFrac.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* ── 하단 고정 액션 바 (Sticky Footer) ── */}
        <div
          style={{
            padding: isMobile ? '10px 12px' : '11px 18px',
            borderTop: '1px solid #CBD5E1',
            background: '#FFFFFF',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() =>
              setCfg(
                cloneConfig(
                  initialConfig,
                  inletTempC,
                  inletPressKgcm2g,
                  propertyMethod,
                  activeComponents,
                  isSimOnly,
                  isEn
                )
              )
            }
            style={{
              padding: '7px 12px',
              borderRadius: 7,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#475569',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {isEn ? 'Reset Defaults' : '초기값 복원'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: 12.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isEn ? 'Cancel' : '취소'}
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyConfig(cfg);
                onClose();
              }}
              style={{
                padding: '8px 18px',
                borderRadius: 7,
                border: '1px solid #1D4ED8',
                background: '#1D4ED8',
                color: '#FFFFFF',
                fontSize: 12.5,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {isEn ? 'Apply Reactor Config' : '반응기 설정 적용'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReactorWorkbenchModal;

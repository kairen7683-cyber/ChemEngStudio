'use client';

import React, { useState, useMemo } from 'react';
import { type FlowNodeDef, type FlowUnitType } from '@/lib/calculations/flowsheetSolver';
import {
  getPlantTemplatesForUnitType,
  cloneUnitParams,
  type PlantUnitTemplate,
} from '@/lib/calculations/plantUnitTemplates';
import { useAuth } from '@/components/auth/AuthContext';
import {
  PLANT_REGISTRY,
  isPlantAllowed,
  formatPlantLabelForUser,
  formatPlantCodeAndName,
} from '@/lib/plantRegistry';
import type { PlantId } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import { formatEquipmentTag } from '@/lib/units/tagNaming';

const UNIT_TYPE_KO: Partial<Record<FlowUnitType, string>> = {
  distillation: '증류탑',
  absorber: '흡수·건조탑',
  hex: '열교환기',
  cooler: '냉각기',
  liquefier: '액화기',
  pump: '펌프',
  compressor: '압축기',
  reactor: '반응기',
  electrolyzer: '전해조',
  evaporator: '증발기',
  separator: '기액분리기',
  extractor: '추출탑',
  valve: '감압밸브',
  feed: '원료 유입',
};

const UNIT_TYPE_EN: Partial<Record<FlowUnitType, string>> = {
  distillation: 'Distillation',
  absorber: 'Absorber / Dryer',
  hex: 'Heat Exchanger',
  cooler: 'Cooler',
  liquefier: 'Liquefier',
  pump: 'Pump',
  compressor: 'Compressor',
  reactor: 'Reactor',
  electrolyzer: 'Electrolyzer',
  evaporator: 'Evaporator',
  separator: 'Separator',
  extractor: 'Extractor',
  valve: 'Valve',
  feed: 'Feed Stream',
};

const PLANT_NAME_EN: Partial<Record<PlantId, { code: string; name: string }>> = {
  clorsim: { code: 'REF', name: 'Chlor-Alkali Reference' },
  clorsim_sim: { code: 'PLANT 01', name: 'Chlor-Alkali' },
  hcl_synth: { code: 'PLANT 02', name: '1A HCl & Recovery' },
  ech_gte: { code: 'PLANT 03', name: 'Bio-ECH' },
  cms_plant: { code: 'PLANT 04', name: 'Chloromethanes (CMS)' },
  mdi_plant: { code: 'PLANT 05', name: 'MDI Process' },
  green_h2: { code: 'REF', name: 'Water Electrolysis Reference' },
};

const TEMPLATE_EN: Record<string, { name: string; summary: string }> = {
  tpl_c230_hcl: {
    name: '5N AHCl Multi-Stage Stripping Column',
    summary: 'PENG_ROB · 17.6 kG · O₂/HCl 5N Purification',
  },
  tpl_c310_hcl: {
    name: 'Spent HCl Vacuum Concentrator (0.15 barA)',
    summary: 'ELEC_HCL_AZEO · Vacuum -0.85 kG · Azeo 22.9%',
  },
  tpl_c320_hcl: {
    name: 'Pressurized Azeotropic Stripper (7.0 barA)',
    summary: 'ELEC_HCL_AZEO · Pressurized 6.0 kG · Azeo 17.5%',
  },
  tpl_c101_ech: {
    name: 'ECH Lights & Water Azeo Dehydration Column (Decanter)',
    summary: 'NRTL · Vacuum -0.65 kG · 20 Stages · R=2.2 · D/F=0.068',
  },
  tpl_c102_ech: {
    name: 'ECH Product Vacuum Purification Column (99.9% ECH)',
    summary: 'NRTL · Vacuum -0.92 kG · 26 Stages · R=2.4 · D/F=0.955',
  },
  tpl_c201_cms: {
    name: 'HP Anhydrous HCl Stripping Column (60 Stages · 17.5 kG)',
    summary: 'PENG_ROB · 60 Stages · 17.5 kG · HCl 99.99% Recov · MC Strip',
  },
  tpl_c202_cms: {
    name: 'Unreacted MC (CH₃Cl) Recovery Column (50 Stages · No MCL Recycle)',
    summary: 'PENG_ROB · 50 Stages · 6.5 kG · MC 99.98% Recov (Recycle Only)',
  },
  tpl_c203_cms: {
    name: 'Azeotropic Water / Lights Purge Column (30 Stages)',
    summary: 'NRTL · 30 Stages · 0.6 kG · RR=20 · Water/Lights Purge',
  },
  tpl_c301_cms: {
    name: 'High-Purity MCL (CH₂Cl₂) Product Column (80 Stages · 99.99 wt%)',
    summary: 'NRTL · 80 Stages · 0.8 kG · MCL 99.99 wt% 120 T/D',
  },
  tpl_c302_cms: {
    name: 'High-Purity CFM (CHCl₃) & CTC/Heavies Column (120 Stages · 99.99 wt%)',
    summary: 'NRTL · 120 Stages · 0.3 kG · CFM 99.99 wt% 80 T/D / Bot Purge',
  },
  tpl_c101_mdi: {
    name: 'Aniline Vacuum Recovery Column (14 Stages · -0.88 kG)',
    summary: 'NRTL · 14 Stages · -0.88 kG · Unreacted Aniline Recov / Crude MDA',
  },
  tpl_c301_mdi: {
    name: 'Phosgene (COCl₂) Recovery Stripper (14 Stages · 2.0 kG)',
    summary: 'NRTL · 14 Stages · 2.0 kG · Residual Phosgene Overhead Recycle',
  },
  tpl_c302_mdi: {
    name: 'MCB Solvent Vacuum Recovery Column (16 Stages · -0.90 kG)',
    summary: 'NRTL · 16 Stages · -0.90 kG · MCB Overhead Recov / Solvent-Free Crude MDI',
  },
  tpl_c401_mdi: {
    name: "High-Vacuum Pure 4,4'-MDI / PMDI Splitter (16 Stages · 20 mbar)",
    summary: "NRTL · 16 Stages · -0.99 kG · Pure 4,4'-MDI (4,500) + PMDI (8,000 kg/h)",
  },
  tpl_c110_hcl: {
    name: 'Graphite Falling-Film HCl Absorber (35% HCl)',
    summary: 'HCl 99.8% Abs · Outlet 45°C · ΔP 0.08 kG',
  },
  tpl_t130_hcl: {
    name: 'Tail-Gas Caustic Scrubber (20% NaOH)',
    summary: 'HCl 99.95% Removal · Outlet 35°C · Atm',
  },
  tpl_t210_hcl: {
    name: '98% H₂SO₄ Ultra-Dry Dehydration Tower (<1 ppm H₂O)',
    summary: 'H₂O 99.99% Removal · Outlet 25°C · 2.5 kG',
  },
  tpl_t410_elec: {
    name: 'Cl₂ Primary Quench & Direct Cooling Tower',
    summary: 'H₂O 65% Cond · Outlet 55°C · ΔP 0.05 kG',
  },
  tpl_t430_elec: {
    name: 'Cl₂ Sulfuric Acid Drying Tower (98% H₂SO₄)',
    summary: 'H₂O 99.9% Removal · Outlet 21°C · ΔP 0.08 kG',
  },
  tpl_t280_elec: {
    name: 'Vacuum Dechlorinator Tower',
    summary: 'Cl₂ 98.5% Strip · Outlet 78°C · ΔP 0.10 kG',
  },
  tpl_e413_elec: {
    name: 'Cl₂ Primary Cooler (Cooling Water CW)',
    summary: 'cw · Target 35°C · 0.2 kG',
  },
  tpl_e423_elec: {
    name: 'Cl₂ Secondary Chiller (CHW 7°C)',
    summary: 'chw · Target 14°C · 0.15 kG',
  },
  tpl_d484_elec: {
    name: 'Cl₂ Freon Refrigerant Liquefier (-35°C)',
    summary: 'freon_m35 · Target -28°C · Phase-Change VLE',
  },
  tpl_e102_hcl: {
    name: 'HCl Synthesis Quench Gas Cooler',
    summary: 'cw · 280°C → 65°C Quench · 0.25 kG',
  },
  tpl_e225_hcl: {
    name: 'Anhydrous HCl Cryogenic Condenser (Brine -20°C)',
    summary: 'brine_m20 · Target -22°C · 17.6 kG',
  },
  tpl_hx_h2: {
    name: 'Hydrogen Gas Cooler (CHW)',
    summary: 'chw · Target 25°C · 1.0 kG',
  },
  tpl_e102_ech: {
    name: 'Glycerol Chlorination Effluent Cooler (112→55°C)',
    summary: 'cw · Target 55°C · 1.8 kG',
  },
  tpl_e301_ech: {
    name: 'Purified ECH Product Cooler (62→35°C)',
    summary: 'cw · Target 35°C · 0.3 kG',
  },
  tpl_e101_cms: {
    name: 'Liquid Cl₂ Vaporizer (25→95°C Vapor Feed)',
    summary: 'steam_lp · Target 95°C · 24.8 kG · 220 T/D Vaporizer',
  },
  tpl_e102_cms: {
    name: 'Chlorination Reactor Effluent HP Cooler (120→58°C)',
    summary: 'cw · Target 58°C · 23.2 kG · T-201 Pre-Cooler',
  },
  tpl_p084_elec: {
    name: 'Electrolyzer Saturated Brine Feed Pump',
    summary: 'Outlet 3.5 kG · Eff 75%',
  },
  tpl_p115_hcl: {
    name: '35% Electronic-Grade HCl Product Pump',
    summary: 'Outlet 4.2 kG · Eff 72%',
  },
  tpl_p315_hcl: {
    name: 'Spent HCl Pressurized Azeo Column Feed Pump',
    summary: 'Outlet 7.5 kG · Eff 70%',
  },
  tpl_p101_ech: {
    name: 'DCH Reactor Effluent 200-Sec Transfer Pump',
    summary: 'Outlet 3.2 kG · Eff 72%',
  },
  tpl_p301_ech: {
    name: 'High-Purity 99.9% ECH Product Pump',
    summary: 'Outlet 4.5 kG · Eff 74%',
  },
  tpl_p202_cms: {
    name: 'Recovered Unreacted MC HP Recycle Pump (6.5→25.0 kG)',
    summary: 'Outlet 25.0 kG · Eff 76% · MC-Only Recycle',
  },
  tpl_k471_elec: {
    name: 'Dry Cl₂ Gas Liquefaction Compressor',
    summary: 'Outlet 7.5 kG · Eff 78%',
  },
  tpl_comp_h2: {
    name: 'High-Purity H₂ Multi-Stage Compressor',
    summary: 'Outlet 30.0 kG · Eff 75%',
  },
  tpl_r101_hcl: {
    name: 'HCl Synthesis Burner (Cl₂ + H₂ → 2HCl)',
    summary: 'Conv 99.9% · Outlet 280°C · 0.35 kG',
  },
  tpl_r101_ech: {
    name: 'Glycerol Hydrochlorination Reactor (DCH Synthesis)',
    summary: 'Conv 97.5% · 112°C · 2.2 kG',
  },
  tpl_r201_ech: {
    name: 'DCH Saponification / Epoxidation Reactor (ECH Synthesis)',
    summary: 'Conv 98.5% · 68°C · 0.4 kG',
  },
  tpl_r101_cms: {
    name: 'AIBN-Initiated HP Liquid Chlorination Reactor (24.0 kG · 120°C)',
    summary: 'PFR RK4 · 120°C · 24.0 kG · AIBN Free-Radical Chlorination',
  },
  tpl_r101_mdi: {
    name: 'MDA Condensation & Neutralization Reactor (95°C · 2.5 kG)',
    summary: 'Conv 99.5% · 95°C · 2.5 kG · Aniline + HCHO + NaOH',
  },
  tpl_r201_mdi: {
    name: 'Phosgene (COCl₂) Activated-Carbon Fixed-Bed Reactor (90°C · 3.5 kG)',
    summary: 'Conv 99.6% · 90°C · 3.5 kG · CO + Cl₂ → COCl₂',
  },
  tpl_r202_mdi: {
    name: '2-Stage Continuous MDA Phosgenation Reactor (145°C · MCB)',
    summary: 'Conv 99.8% · 145°C · 3.0 kG · MDA + COCl₂ → MDI/PMDI + 4HCl',
  },
  tpl_elec_100: {
    name: 'Ion-Exchange Membrane Chlor-Alkali Electrolyzer (32% NaOH)',
    summary: '30 kA · 24 Cells · CE 96.5% · 88°C',
  },
  tpl_pem_h2: {
    name: 'PEM Water Electrolyzer Stack (Green H₂)',
    summary: '25 kA · 180 Cells · CE 98% · 70°C',
  },
  tpl_evap_300: {
    name: 'Caustic Soda 3-Effect Falling-Film Evaporator (32→50%)',
    summary: 'Target 50 wt% NaOH · 115°C',
  },
  tpl_flash_cl2: {
    name: 'Liquid Cl₂ Vapor-Liquid Separator',
    summary: 'Isothermal -28°C · 2.0 kG',
  },
  tpl_flash_hcl: {
    name: 'Synthetic HCl Quench Separator',
    summary: 'Isothermal 45°C · 0.25 kG',
  },
  tpl_v102_ech: {
    name: 'Chlorination Off-Gas V-L Separator',
    summary: 'Isothermal 55°C · 1.8 kG',
  },
  tpl_v202_ech: {
    name: 'ECH / Brine Decanter Separator',
    summary: 'Isothermal 55°C · 0.2 kG',
  },
  tpl_feed_brine: {
    name: 'Saturated Purified Brine (25.5 wt% NaCl)',
    summary: '65°C · 1.5 kG · 12,000 kg/h',
  },
  tpl_feed_gly_ech: {
    name: 'Refined Glycerol Feed',
    summary: '45°C · 2.0 kG · 9,115 kg/h',
  },
  tpl_feed_ahcl_ech: {
    name: 'Anhydrous HCl (AHCl) Gas Feed',
    summary: '35°C · 3.5 kG · 7,402 kg/h',
  },
  tpl_feed_naoh_ech: {
    name: '25 wt% Caustic Soda (NaOH) Saponification Feed',
    summary: '40°C · 2.5 kG · 17,200 kg/h',
  },
  tpl_feed_ech: {
    name: 'Crude ECH Organic Phase Feed (ECH/DCP/DCH/H₂O)',
    summary: '55°C · 0.2 kG · 9,505 kg/h',
  },
  tpl_feed_cl2_cms: {
    name: 'Liquid Cl₂ Feed Supply (220 T/D)',
    summary: '25°C · 25.5 kG · 9,166.7 kg/h (to Vaporizer E-101)',
  },
  tpl_feed_mc_cms: {
    name: 'Fresh Methyl Chloride (CH₃Cl) Make-Up Feed',
    summary: '35°C · 25.0 kG · HP Liquid MC Make-Up',
  },
};

interface PlantUnitCopyBoxProps {
  unitType: FlowUnitType;
  nodeKey: string;
  activePlantId?: PlantId | null;
  onCopyParams: (
    params: FlowNodeDef['params'],
    template: PlantUnitTemplate,
    includeInlet: boolean
  ) => void;
}

export default function PlantUnitCopyBox({
  unitType,
  nodeKey,
  activePlantId,
  onCopyParams,
}: PlantUnitCopyBoxProps) {
  const { user } = useAuth();
  const tagStandard = useUnitStore((s) => s.tagStandard);
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';
  const unitTypeLabel = isEn
    ? (UNIT_TYPE_EN[unitType] ?? unitType)
    : (UNIT_TYPE_KO[unitType] ?? unitType);

  const templates = useMemo(
    () =>
      getPlantTemplatesForUnitType(unitType).filter(
        (tpl) => tpl.plantId !== 'green_h2' && isPlantAllowed(tpl.plantId, user)
      ),
    [unitType, user]
  );

  // Group by plantId (preserving display label formatted for current user role)
  // and place currently opened PFD plant first if present.
  const groupedList = useMemo(() => {
    const map = new Map<PlantId, { plantId: PlantId; displayLabel: string; items: PlantUnitTemplate[] }>();
    templates.forEach((tpl) => {
      const existing = map.get(tpl.plantId);
      if (existing) {
        existing.items.push(tpl);
      } else {
        const enPlant = PLANT_NAME_EN[tpl.plantId];
        const rawLabel = isEn && enPlant ? `${enPlant.code} ${enPlant.name}` : tpl.plantLabel;
        map.set(tpl.plantId, {
          plantId: tpl.plantId,
          displayLabel: formatPlantLabelForUser(rawLabel, user),
          items: [tpl],
        });
      }
    });
    const list = Array.from(map.values());
    if (activePlantId) {
      list.sort((a, b) => {
        if (a.plantId === activePlantId) return -1;
        if (b.plantId === activePlantId) return 1;
        return 0;
      });
    }
    return list;
  }, [templates, user, activePlantId, isEn]);

  const hasActivePlantTemplates = Boolean(
    activePlantId && groupedList.some((g) => g.plantId === activePlantId)
  );
  const defaultFilter: string = hasActivePlantTemplates && activePlantId ? activePlantId : 'ALL';

  const scopeKey = `${nodeKey}::${unitType}::${activePlantId ?? 'sim'}`;
  const [uiState, setUiState] = useState<{
    scope: string;
    selectedPlant: string;
    selectedId: string;
    copiedNotice: string;
  }>({
    scope: scopeKey,
    selectedPlant: defaultFilter,
    selectedId: '',
    copiedNotice: '',
  });
  const [includeInlet, setIncludeInlet] = useState<boolean>(true);

  const selectedPlant = uiState.scope === scopeKey ? uiState.selectedPlant : defaultFilter;
  const selectedId = uiState.scope === scopeKey ? uiState.selectedId : '';
  const copiedNotice = uiState.scope === scopeKey ? uiState.copiedNotice : '';

  // Allowed plants that do not have any templates of this unitType (only shown when user has >1 allowed plant)
  const missingAllowedPlants = useMemo(() => {
    const allowedPlants = PLANT_REGISTRY.filter(
      (p) => !p.hiddenFromSelector && !p.isSandbox && isPlantAllowed(p.id, user)
    );
    if (allowedPlants.length <= 1) return [];
    const presentIds = new Set(groupedList.map((g) => g.plantId));
    return allowedPlants
      .filter((p) => !presentIds.has(p.id))
      .map((p) => {
        const shortLabel = isEn ? (PLANT_NAME_EN[p.id]?.name ?? p.shortLabel) : p.shortLabel;
        return formatPlantCodeAndName({ code: p.code, shortLabel }, user, ' ');
      });
  }, [groupedList, user, isEn]);

  if (templates.length === 0) return null;

  const visibleEntries =
    selectedPlant === 'ALL'
      ? groupedList
      : groupedList.filter((g) => g.plantId === selectedPlant);
  const visibleCount = visibleEntries.reduce((acc, g) => acc + g.items.length, 0);

  const handleApply = (tplId: string) => {
    const found = templates.find((t) => t.id === tplId);
    if (!found) {
      setUiState({ scope: scopeKey, selectedPlant, selectedId: tplId, copiedNotice: '' });
      return;
    }
    onCopyParams(cloneUnitParams(found.params), found, includeInlet);
    const displayTag = formatEquipmentTag(found.tag, found.unitType, tagStandard);
    const summaryText = isEn ? (TEMPLATE_EN[found.id]?.summary ?? found.summary) : found.summary;
    setUiState({
      scope: scopeKey,
      selectedPlant,
      selectedId: tplId,
      copiedNotice: isEn
        ? `✓ Copied [${displayTag}] (${summaryText})`
        : `✓ [${displayTag}] 복사 완료 (${found.summary})`,
    });
  };

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1E293B' }}>
          {isEn
            ? `Load Reference ${unitTypeLabel} Conditions`
            : `동종 장치(${unitTypeLabel}) 조건 불러오기`}
        </span>
        <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>
          {isEn ? `${visibleCount}` : `${visibleCount}건`}
        </span>
      </div>

      {groupedList.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(['ALL', ...groupedList.map((g) => g.plantId)] as const).map((pid) => {
            const active = selectedPlant === pid;
            const grp = groupedList.find((g) => g.plantId === pid);
            const isCurrent = Boolean(activePlantId && pid === activePlantId);
            const btnText =
              pid === 'ALL'
                ? isEn ? 'All' : '전체'
                : `${grp?.displayLabel ?? pid}${isCurrent ? (isEn ? ' (Current)' : ' (현재)') : ''}`;
            return (
              <button
                key={pid}
                type="button"
                onClick={() =>
                  setUiState({
                    scope: scopeKey,
                    selectedPlant: pid,
                    selectedId: '',
                    copiedNotice: '',
                  })
                }
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: active ? '1px solid #1E293B' : '1px solid #E2E8F0',
                  background: active ? '#1E293B' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#475569',
                  fontSize: 9.5,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                {btnText}
              </button>
            );
          })}
        </div>
      )}

      <select
        value={selectedId}
        onChange={(e) => handleApply(e.target.value)}
        style={{
          width: '100%',
          height: 28,
          padding: '0 7px',
          borderRadius: 5,
          border: '1px solid #CBD5E1',
          background: '#FFFFFF',
          color: '#1E293B',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <option value="">
          {isEn ? `— Select reference ${unitTypeLabel} —` : `— 참조 ${unitTypeLabel} 선택 —`}
        </option>
        {visibleEntries.map((grp) => (
          <optgroup key={grp.plantId} label={grp.displayLabel}>
            {grp.items.map((tpl) => {
              const enTpl = isEn ? TEMPLATE_EN[tpl.id] : undefined;
              const tplName = enTpl?.name ?? tpl.name;
              const tplSummary = enTpl?.summary ?? tpl.summary;
              return (
                <option key={tpl.id} value={tpl.id}>
                  [{formatEquipmentTag(tpl.tag, tpl.unitType, tagStandard)}] {tplName} · {tplSummary}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          color: '#334155',
          fontWeight: 700,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={includeInlet}
          onChange={(e) => setIncludeInlet(e.target.checked)}
          style={{ margin: 0, cursor: 'pointer', accentColor: '#1E3A8A' }}
        />
        <span>{isEn ? 'Include Inlet Conditions' : '유입(Inlet) 조건 함께 복사'}</span>
      </label>

      <div style={{ fontSize: 9.5, color: copiedNotice ? '#1E3A8A' : '#64748B', fontWeight: copiedNotice ? 700 : 500, lineHeight: 1.35 }}>
        {copiedNotice ||
          (includeInlet
            ? isEn
              ? 'Apply operating & inlet conditions together'
              : '운전조건 + 유입 조건 동시 반영'
            : isEn
              ? 'Apply unit operating conditions only'
              : '장치 운전조건만 반영')}
      </div>

      {missingAllowedPlants.length > 0 && (
        <div style={{ fontSize: 9, color: '#94A3B8', lineHeight: 1.35 }}>
          {isEn
            ? `Note: No registered ${unitTypeLabel} templates in ${missingAllowedPlants.join(', ')}.`
            : `※ ${missingAllowedPlants.join(', ')}에는 등록된 ${unitTypeLabel} 예제가 없습니다.`}
        </div>
      )}
    </div>
  );
}

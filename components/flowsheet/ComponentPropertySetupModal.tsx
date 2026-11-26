'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { reportInteropGaps } from '@/lib/auth/authClient';
import { SIM_COMPS, COMP_META, COMP_LABEL_EN, getCompLabel, type SimCompKey } from '@/lib/calculations/flowsheetSolver';
import {
  type SimPropertyMethod,
  type ResolvedPropertyMethod,
  type CompChemicalFamily,
  PROPERTY_METHOD_INFO,
  COMP_CATALOG_META,
  COMP_FAMILY_LABELS,
  PLANT_COMPONENT_PRESETS,
  GENERAL_COMPONENT_PACKS,
  recommendPropertyMethod,
} from '@/lib/calculations/componentCatalog';
import {
  EXTENDED_CHEMICAL_LIBRARY,
  EXTENDED_LIB_CATEGORY_LABELS,
  JOBACK_GROUPS,
  type ExtendedLibCategory,
  type JobackGroupId,
  type CustomSlotKey,
  predictPropertiesFromJobackGroups,
  buildSpecFromJobackGroups,
  applyExtendedChemicalToSlot,
  applyCustomSpecToSlot,
  getActiveCustomSlotSpec,
  resetCustomSlot,
} from '@/lib/calculations/customComponentEngine';
import { useAuth } from '@/components/auth/AuthContext';
import { isPlantAllowed, isSimulatorOnlyUser } from '@/lib/plantRegistry';
import { useUnitStore } from '@/lib/stores/unitStore';
import { UNIT_PRESETS } from '@/lib/units/unitSystem';
import { UNIT_PRESET_NAMES_EN } from '@/lib/i18n/uiText';

export interface ComponentPropertySetupModalProps {
  open: boolean;
  onClose: () => void;
  activeComponents: SimCompKey[];
  propertyMethod: SimPropertyMethod;
  currentFeedFlows?: Partial<Record<SimCompKey, number>>;
  maxPressKgcm2g?: number;
  currentPlantContext?: string;
  onApply: (nextComponents: SimCompKey[], nextPropertyMethod: SimPropertyMethod) => void;
}

const FAMILY_ORDER: Array<'ALL' | CompChemicalFamily> = [
  'ALL',
  'polar_solvent',
  'hydrocarbon',
  'aromatic',
  'gas_syngas',
  'electrolyte_inorg',
  'chlor_ech',
];

const COMP_FAMILY_LABELS_EN: Record<CompChemicalFamily, string> = {
  electrolyte_inorg: 'Electrolytes · Acids · Inorganic Salts',
  chlor_ech: 'Chlorine · ECH · Chlorohydrins',
  gas_syngas: 'Industrial Gases · Syngas',
  hydrocarbon: 'Paraffins · Olefins',
  aromatic: 'BTX Aromatics',
  polar_solvent: 'Alcohols · Ketones · Polar Solvents',
};

const EXTENDED_LIB_CATEGORY_LABELS_EN: Record<ExtendedLibCategory, string> = {
  hydrocarbon: 'C4–C16 Paraffins · Olefins · Naphthenes',
  aromatic_petrochem: 'Aromatics · Petrochemical Monomers',
  battery_carbonate: 'Battery Carbonates · Glymes',
  electronic_solvent: 'Semiconductor & Display Solvents',
  chlorinated_organic: 'Chlorinated Organics · Monomers',
  oxygenate_amine_nitrile: 'Alcohols · Glycols · Amines · Nitriles · Acids',
};

const PROPERTY_METHOD_EN: Record<
  ResolvedPropertyMethod,
  { label: string; formulaDesc: string; bestFor: string }
> = {
  ENRTL: {
    label: 'ENRTL (Electrolyte NRTL · Aqueous Multi-Phase)',
    formulaDesc: 'Pitzer-Debye-Hückel ionic activity + Extended NRTL (a_ij + b_ij/T) + Sechenov salting-out + heat of solution',
    bestFor: 'Chlor-alkali brine (NaCl·NaOH), HCl absorption/azeotrope, H₂SO₄ drying, aq. NH₃, chlor-organics/brine LLE',
  },
  NRTL: {
    label: 'NRTL (Non-Ideal Liquid Activity γ-φ)',
    formulaDesc: 'Extended NRTL (τ_ij = a_ij + b_ij/T) + 25-group Hansen UNIFAC fallback + Poynting/PR vapor fugacity + LLE',
    bestFor: 'Alcohol (MeOH·EtOH·IPA)-water azeotropes, acetone/acetic acid/EtOAc, CHCl₃, ECH/chlorohydrins, LLE decanters',
  },
  PR: {
    label: 'PR (Peng-Robinson Cubic EOS)',
    formulaDesc: 'P = RT/(v-b) - aα(T,ω)/[v(v+b)+b(v-b)], binary interaction k_ij, VLE fugacity (φ^L=φ^V) & enthalpy departure',
    bestFor: 'Natural gas (CH₄), LPG (ethane/propane/butane), hexane/heptane, BTX aromatics, liquefied Cl₂/CO₂/anhydrous HCl',
  },
  SRK: {
    label: 'SRK (Soave-Redlich-Kwong Cubic EOS)',
    formulaDesc: 'P = RT/(v-b) - aα(T)/[v(v+b)], Graboski-Daubert H₂ quantum correction α_H2, binary k_ij & enthalpy departure',
    bestFor: 'High-P H₂, syngas (CO·H₂·CH₄·N₂), ethylene/propylene olefin separation, petrochemical gas trains',
  },
};

const PLANT_PRESET_EN: Record<string, { label: string; desc: string }> = {
  clorsim_sim: {
    label: 'Chlor-Alkali Plant (Brine · Electrolysis · NaOH · Cl₂ Liquefaction)',
    desc: '11 standard species for brine purification, electrolysis, caustic concentration, H₂SO₄ drying & Cl₂ liquefaction',
  },
  hcl_synth: {
    label: '1A Ultra-Pure / Anhydrous HCl & Spent Acid Recovery (PSD)',
    desc: '10 species for Cl₂/H₂ synthesis burner, pressure-swing azeotropic distillation (PSD), cryogenic anhydrous HCl & etchant',
  },
  ech_gte: {
    label: 'ECH 70kTA (Glycerol Chlorination · Saponification · Refining)',
    desc: '10 species for GTE glycerol chlorination (MCH/DCH), caustic saponification, azeotropic dehydration & vacuum purification',
  },
  cms_plant: {
    label: 'Chloromethanes (CMS) Plant (MCL 120 · CFM 80 T/D)',
    desc: '10 species for liquid Cl₂ vaporization, high-P liquid chlorination (24 kg/cm²G, 120°C), anhydrous HCl stripping, MC recycle & MCL/CFM/CTC fractionation',
  },
  mdi_plant: {
    label: 'MDI 100kTA Integrated Plant (MDA · Phosgenation · Pure/PMDI)',
    desc: '13 species for aniline-formalin condensation, CO+Cl₂ phosgene synthesis, MCB phosgenation, solvent recovery & vacuum MDI/PMDI fractionation',
  },
};

const GENERAL_PACK_EN: Record<string, { label: string; badge: string; desc: string }> = {
  polar_solvents: {
    label: 'Alcohols · Ketones · Solvent Recovery (Azeotropic / Extractive)',
    badge: 'NRTL Best',
    desc: 'Azeotropic distillation & decanter separation for MeOH, EtOH, IPA, Acetone, Acetic Acid, EtOAc + Water',
  },
  btx_refinery: {
    label: 'BTX Aromatics · Naphtha Fractionation',
    badge: 'PR / NRTL',
    desc: 'Precision distillation & water-phase separation for Benzene, Toluene, p-Xylene, Hexane, Heptane',
  },
  light_hc_lpg: {
    label: 'Natural Gas · Ethylene/Propylene · LPG Separation',
    badge: 'PR / SRK',
    desc: 'Cryogenic & pressurized distillation for Methane, Ethylene, Ethane, Propylene, Propane, n-Butane',
  },
  syngas_h2_nh3: {
    label: 'Syngas · Hydrogen · Ammonia · CO₂',
    badge: 'SRK / ENRTL',
    desc: 'Reformer syngas (H₂·CO·CO₂·CH₄), high-pressure NH₃ synthesis/liquefaction & water scrubbing',
  },
  chlorinated_org: {
    label: 'Chlorinated Solvents · CMS · Chlorohydrin Refining',
    badge: 'NRTL / PR',
    desc: 'MC, MCL, Chloroform (CFM), CCl₄ (CTC), PCE, ECH & aqueous phase separation',
  },
  sm_cumene_aromatics: {
    label: 'Styrene (SM) · Cumene · Phenol Aromatics',
    badge: 'PR / NRTL',
    desc: 'EB dehydrogenation SM vacuum distillation & cumene oxidation phenol/acetone purification',
  },
  amine_sour_gas: {
    label: 'Amine Sour Gas (CO₂ · H₂S) Absorption & Regeneration',
    badge: 'ENRTL / NRTL',
    desc: 'CO₂/H₂S/SO₂ chemical absorption & stripping with aqueous MEA/MDEA',
  },
  battery_semi_solvents: {
    label: 'Battery Carbonates · Semiconductor Polar Solvents',
    badge: 'NRTL + UNIFAC',
    desc: 'Recovery & purification of DMC, THF, DMF, DMSO, MEK, MTBE, EG & extended slots (EC/PC/EMC/NMP/PGMEA)',
  },
  electronic_battery_water: {
    label: 'Electronics · Secondary Battery · Wastewater',
    badge: 'ENRTL / NRTL',
    desc: 'Semiconductor wet etch/clean (H₂O₂·H₃PO₄·HF·KOH·NH₄OH·TMAH), battery solvents (NMP·BCS) & neutralization/dechlorination (Na₂CO₃·NaHSO₃·Ca(OH)₂)',
  },
};

const JOBACK_GROUP_LABEL_EN: Record<JobackGroupId, string> = {
  CH3: 'Methyl (-CH₃)',
  CH2_chain: 'Chain methylene (-CH₂-)',
  CH_chain: 'Chain methine (>CH-)',
  C_chain: 'Quaternary carbon (>C<)',
  CH2_alkene: 'Terminal alkene (=CH₂)',
  CH_alkene: 'Internal alkene (=CH-)',
  C_alkene: 'Branched alkene (=C<)',
  CH_alkyne: 'Terminal alkyne (≡CH)',
  C_alkyne: 'Internal alkyne (≡C-)',
  CH2_ring: 'Ring methylene (ring -CH₂-)',
  CH_ring: 'Ring methine (ring >CH-)',
  C_ring: 'Ring quat. carbon (ring >C<)',
  ACH_arom: 'Aromatic CH (ring =CH-)',
  AC_arom: 'Substituted arom. C (ring =C<)',
  F: 'Fluoro (-F)',
  Cl: 'Chloro (-Cl)',
  Br: 'Bromo (-Br)',
  OH_alcohol: 'Hydroxyl (-OH alcohol)',
  OH_phenol: 'Phenolic OH (arom. -OH)',
  O_chain: 'Chain ether (-O-)',
  O_ring: 'Ring ether (THF/EO)',
  CO_chain: 'Chain ketone (>C=O)',
  CO_ring: 'Ring ketone (cyclohexanone)',
  CHO_ald: 'Aldehyde (-CHO)',
  COOH_acid: 'Carboxylic acid (-COOH)',
  COO_ester: 'Ester (-COO-)',
  OCOO_carb: 'Carbonate (-OCOO-)',
  NH2_amine: 'Primary amine (-NH₂)',
  NH_chain: 'Secondary amine (>NH)',
  NH_ring: 'Ring sec. amine (piperazine)',
  N_chain: 'Tertiary amine (>N-)',
  N_ring_arom: 'Aromatic ring N (-N=)',
  CN_nitrile: 'Nitrile (-CN)',
  NO2_nitro: 'Nitro (-NO₂)',
  SH_thiol: 'Thiol (-SH)',
  S_chain: 'Sulfide (-S-)',
  SO_sulfoxide: 'Sulfoxide (>S=O)',
};

const COMP_NOTE_EN: Record<SimCompKey, string> = {
  H2O: 'Process water · steam · aqueous solvent standard',
  NaCl: 'Brine electrolyte (Pitzer osmotic, salting-out, heat of solution)',
  NaOH: 'Caustic soda strong alkali electrolyte (BPE & heat of dilution)',
  Cl2: 'Chlorine gas · cryogenic liquefaction & brine dissolution (Sechenov)',
  H2: 'Hydrogen (SRK Graboski-Daubert quantum correction built-in)',
  HCl: 'Hydrogen chloride (aq. pressure-swing azeotrope & anhydrous liq.)',
  H2SO4: 'Sulfuric acid desiccant · strong electrolyte (absorption & dilution heat)',
  O2: 'Oxygen · water/brine electrolysis byproduct gas',
  NaOCl: 'Sodium hypochlorite aqueous electrolyte',
  N2: 'Nitrogen purge · inert carrier gas',
  NaClO3: 'Sodium chlorate inorganic salt electrolyte',
  FeCl2: 'Ferrous chloride spent etchant component',
  FeCl3: 'Ferric chloride regenerated etchant component',
  PAC: 'Polyaluminum chloride inorganic coagulant',
  Glycerol: 'Glycerol (GTE feedstock · high-boiling polyol)',
  MCH: 'Monochlorohydrin (3-MCPD reaction intermediate)',
  DCH: 'Dichlorohydrin (1,3-DCH saponification feedstock)',
  ECH: 'Epichlorohydrin (88°C heterogeneous azeotrope with water · LLE)',
  DCP: '1,2-Dichloropropane (light organochlorine byproduct · LLE)',
  CH4: 'Methane · natural gas / reformer gas main component',
  CO: 'Carbon monoxide · key syngas component',
  CO2: 'Carbon dioxide (high-P liquefaction · acid gas capture)',
  NH3: 'Ammonia (PR/SRK refrigerant liq. & ENRTL aq. ammonia)',
  C2H4: 'Ethylene · cracker light olefin monomer',
  C2H6: 'Ethane · NGL / cracker feedstock',
  C3H6: 'Propylene · light olefin monomer',
  C3H8: 'Propane · LPG & refrigeration cycle working fluid',
  nC4H10: 'n-Butane · LPG / C4 hydrocarbon fraction',
  nC6H14: 'n-Hexane · extraction solvent / naphtha fraction',
  nC7H16: 'n-Heptane · standard hydrocarbon solvent',
  Benzene: 'Benzene · BTX aromatic base chemical',
  Toluene: 'Toluene · BTX aromatic / azeotropic entrainer',
  pXylene: 'p-Xylene · BTX aromatic (PTA feedstock)',
  MeOH: 'Methanol · polar alcohol solvent & reactant',
  EtOH: 'Ethanol · water-azeotrope polar alcohol',
  IPA: 'Isopropanol · electronics cleaning & azeotropic alcohol',
  Acetone: 'Acetone · polar ketone solvent',
  AceticAcid: 'Acetic acid · polar organic carboxylic acid',
  EtOAc: 'Ethyl acetate · ester solvent (water azeotrope · LLE)',
  CHCl3: 'Chloroform (CFM) · chlorinated polar solvent (LLE)',
  Ar: 'Argon · inert purge / air separation byproduct',
  H2S: 'Hydrogen sulfide · sour gas / amine scrubbing component',
  SO2: 'Sulfur dioxide · acid gas / sulfonation intermediate',
  SO3: 'Sulfur trioxide · oleum / sulfonation reagent',
  iC4H10: 'Isobutane · C4 isomer / alkylation feedstock',
  C4H8_1: '1-Butene · C4 alpha-olefin comonomer',
  nC5H12: 'n-Pentane · C5 light naphtha / blowing agent',
  nC8H18: 'n-Octane · C8 heavy paraffin hydrocarbon',
  Cyclohexane: 'Cyclohexane · naphthene / nylon intermediate',
  Ethylbenzene: 'Ethylbenzene · styrene dehydrogenation feedstock',
  Styrene: 'Styrene monomer · vacuum distillation polymer precursor',
  Cumene: 'Cumene (isopropylbenzene) · phenol/acetone feedstock',
  Phenol: 'Phenol · aromatic alcohol (cumene process product)',
  THF: 'Tetrahydrofuran · cyclic ether solvent (pressure-swing dist.)',
  DMF: 'Dimethylformamide · high-boiling polar aprotic solvent',
  DMSO: 'Dimethyl sulfoxide · semiconductor stripper / aromatic extraction solvent',
  MTBE: 'Methyl tert-butyl ether · octane booster & reactive distillation',
  MEK: 'Methyl ethyl ketone · general ketone solvent (aq. azeotrope)',
  DMC: 'Dimethyl carbonate · Li-ion battery electrolyte chain carbonate',
  EG: 'Ethylene glycol · gas dehydration, polyester & antifreeze',
  MEA: 'Monoethanolamine · standard alkanolamine for CO₂/H₂S capture',
  MDEA: 'Methyldiethanolamine · selective H₂S/CO₂ tertiary amine',
  FormicAcid: 'Formic acid · max-boiling azeotrope with water',
  HNO3: 'Nitric acid · strong acid (68 wt% max-boiling azeotrope at 120.5°C)',
  CH3Cl: 'Methyl chloride (MC) · CMS chlorination feed & recycle',
  CH2Cl2: 'Methylene chloride (MCL) · CMS primary non-flammable solvent',
  CCl4: 'Carbon tetrachloride (CTC) · CMS perchlorination byproduct',
  C2Cl4: 'Perchloroethylene (PCE) · C2 heavy chlorinated residue',
  COCl2: 'Phosgene · CO + Cl₂ intermediate / MDI phosgenation reagent',
  HCHO: 'Formaldehyde (37% formalin) · MDA condensation feedstock',
  MCB: 'Monochlorobenzene · MDI phosgenation & vacuum recovery solvent',
  Aniline: 'Aniline · MDA synthesis feedstock (vacuum overhead recycle)',
  MDA: "4,4'-Methylenedianiline · aniline-HCHO condensation intermediate",
  MDI: "4,4'-Pure MDI monomer · high-vacuum distillation product",
  PMDI: 'Polymeric MDI · crude MDI high-boiling bottoms product',
  CUSTOM_1: 'Custom Slot #1 mapped to Joback+UNIFAC or 128-species library (default: 1-Butanol)',
  CUSTOM_2: 'Custom Slot #2 mapped to Joback+UNIFAC or 128-species library (default: Aniline)',
  H2O2: 'Hydrogen peroxide · semiconductor SC-1/SPM cleaning oxidizer (30–50 wt%)',
  H3PO4: 'Phosphoric acid · silicon nitride wet etch (85 wt% viscous acid)',
  HF: 'Hydrofluoric acid · silicon oxide wet etch (DHF/BOE weak acid)',
  KOH: 'Potassium hydroxide · anisotropic Si etch & alkaline water electrolysis',
  NH4OH: 'Ammonium hydroxide · semiconductor SC-1 cleaning weak base',
  TMAH: 'Tetramethylammonium hydroxide · 2.38 wt% photoresist developer',
  NMP: 'N-Methyl-2-pyrrolidone · battery cathode slurry & stripper recovery solvent',
  BCS: 'Butyl Cellosolve (2-Butoxyethanol) · coating & display glycol ether',
  Na2CO3: 'Sodium carbonate (soda ash) · brine Ca²⁺ precipitation & acid neutralization',
  NaHSO3: 'Sodium bisulfite (SBS) · dechlorination & peroxide reduction agent',
  CaOH2: 'Calcium hydroxide (slaked lime) · HF/H₂SO₄ neutralization & CaF₂ slurry',
};

export default function ComponentPropertySetupModal({
  open,
  onClose,
  activeComponents,
  propertyMethod,
  currentFeedFlows,
  maxPressKgcm2g = 1.0,
  currentPlantContext,
  onApply,
}: ComponentPropertySetupModalProps) {
  const { user } = useAuth();
  const unitPresetId = useUnitStore(s => s.presetId);
  const applyUnitPreset = useUnitStore(s => s.applyPreset);
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);
  const isSimOnly = isSimulatorOnlyUser(user);
  const visibleGeneralPacks = useMemo(
    () => (isSimOnly ? GENERAL_COMPONENT_PACKS.filter(pk => pk.id !== 'chlorinated_org') : GENERAL_COMPONENT_PACKS),
    [isSimOnly]
  );
  const allowedPlantPresets = useMemo(
    () => PLANT_COMPONENT_PRESETS.filter(p => isPlantAllowed(p.plantId, user)),
    [user]
  );
  const isPlantCtx =
    allowedPlantPresets.length > 0 &&
    (currentPlantContext === 'electrolyzer_plant' ||
      currentPlantContext === 'hcl_1a_plant' ||
      currentPlantContext === 'ech_gte_plant' ||
      currentPlantContext === 'cms_plant' ||
      currentPlantContext === 'mdi_plant');

  const [sourceTab, setSourceTab] = useState<'general' | 'plant' | 'custom'>(isPlantCtx ? 'plant' : 'general');
  const [draftComps, setDraftComps] = useState<SimCompKey[]>(activeComponents);
  const [draftMethod, setDraftMethod] = useState<SimPropertyMethod>(propertyMethod);
  const [familyFilter, setFamilyFilter] = useState<'ALL' | CompChemicalFamily>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [customSubTab, setCustomSubTab] = useState<'library' | 'joback'>('library');
  const [extCatFilter, setExtCatFilter] = useState<'ALL' | ExtendedLibCategory>('ALL');
  const [extSearch, setExtSearch] = useState('');
  const [slotRev, setSlotRev] = useState(0);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [jbNameKo, setJbNameKo] = useState(() => (isEn ? 'Isoamyl Acetate' : '이소아밀아세테이트'));
  const [jbFormula, setJbFormula] = useState('C7H14O2');
  const [jbTbExpStr, setJbTbExpStr] = useState('142.0');
  const [jbGroups, setJbGroups] = useState<Partial<Record<JobackGroupId, number>>>({
    CH3: 3,
    CH2_chain: 2,
    CH_chain: 1,
    COO_ester: 1,
  });
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  useEffect(() => {
    if (open) {
      setDraftComps(activeComponents);
      setDraftMethod(propertyMethod || 'AUTO');
      setSourceTab(isPlantCtx ? 'plant' : 'general');
      setSearchQuery('');
    }
  }, [open, activeComponents, propertyMethod, isPlantCtx]);

  const inUseSet = useMemo(() => {
    const s = new Set<SimCompKey>();
    if (currentFeedFlows) {
      for (const k of SIM_COMPS) {
        if ((currentFeedFlows[k] ?? 0) > 1e-6) s.add(k);
      }
    }
    return s;
  }, [currentFeedFlows]);

  const recommendation = useMemo(
    () => recommendPropertyMethod(draftComps, currentFeedFlows, maxPressKgcm2g),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftComps, currentFeedFlows, maxPressKgcm2g, slotRev]
  );

  const effectiveResolved: ResolvedPropertyMethod =
    draftMethod === 'AUTO' ? recommendation.method : draftMethod;

  const filteredComps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return SIM_COMPS.filter(k => {
      const cat = COMP_CATALOG_META[k];
      const meta = COMP_META[k];
      if (!cat || !meta) return false;
      if (familyFilter !== 'ALL' && cat.family !== familyFilter) return false;
      if (!q) return true;
      return (
        k.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        (COMP_LABEL_EN[k] ?? '').toLowerCase().includes(q) ||
        meta.formula.toLowerCase().includes(q) ||
        cat.cas.includes(q) ||
        cat.noteKo.toLowerCase().includes(q) ||
        (COMP_NOTE_EN[k] ?? '').toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyFilter, searchQuery, slotRev]);

  const filteredExtLibrary = useMemo(() => {
    const q = extSearch.trim().toLowerCase();
    return EXTENDED_CHEMICAL_LIBRARY.filter(item => {
      if (extCatFilter !== 'ALL' && item.category !== extCatFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.nameKo.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.formula.toLowerCase().includes(q) ||
        item.cas.includes(q)
      );
    });
  }, [extCatFilter, extSearch]);

  const liveJobackPred = useMemo(() => {
    const parsedTb = jbTbExpStr.trim() !== '' ? Number(jbTbExpStr) : undefined;
    const tbOpt = parsedTb !== undefined && Number.isFinite(parsedTb) ? parsedTb : undefined;
    return predictPropertiesFromJobackGroups(jbGroups, { tbExpC: tbOpt });
  }, [jbGroups, jbTbExpStr]);

  const reportedMissingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const isExtTab = sourceTab === 'custom' && customSubTab === 'library';
    const rawQuery = isExtTab ? extSearch : sourceTab === 'general' ? searchQuery : '';
    const q = rawQuery.trim();
    if (q.length < 2 || q.length > 60) return;

    const visibleCount = isExtTab ? filteredExtLibrary.length : filteredComps.length;
    if (visibleCount > 0) return;

    const normKey = q.toLowerCase();
    if (reportedMissingRef.current.has(normKey)) return;

    const timer = window.setTimeout(() => {
      const hasCoreMatch = SIM_COMPS.some(k => {
        const cat = COMP_CATALOG_META[k];
        const meta = COMP_META[k];
        if (!cat || !meta) return false;
        return (
          k.toLowerCase().includes(normKey) ||
          meta.label.toLowerCase().includes(normKey) ||
          (COMP_LABEL_EN[k] ?? '').toLowerCase().includes(normKey) ||
          meta.formula.toLowerCase().includes(normKey) ||
          cat.cas.includes(normKey) ||
          cat.noteKo.toLowerCase().includes(normKey) ||
          (COMP_NOTE_EN[k] ?? '').toLowerCase().includes(normKey)
        );
      });
      const hasExtMatch = EXTENDED_CHEMICAL_LIBRARY.some(item =>
        item.id.toLowerCase().includes(normKey) ||
        item.nameKo.toLowerCase().includes(normKey) ||
        item.nameEn.toLowerCase().includes(normKey) ||
        item.formula.toLowerCase().includes(normKey) ||
        item.cas.includes(normKey)
      );
      if (hasCoreMatch || hasExtMatch) return;
      if (reportedMissingRef.current.has(normKey)) return;
      reportedMissingRef.current.add(normKey);
      void reportInteropGaps({
        source_type: 'component_search',
        missing_searches: [q],
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [open, sourceTab, customSubTab, searchQuery, extSearch, filteredComps.length, filteredExtLibrary.length]);

  if (!open) return null;

  const toggleComp = (comp: SimCompKey) => {
    setDraftComps(prev => {
      if (prev.includes(comp)) {
        if (prev.length <= 1) return prev;
        return prev.filter(c => c !== comp);
      }
      const nextSet = new Set([...prev, comp]);
      return SIM_COMPS.filter(c => nextSet.has(c));
    });
  };

  const applyPresetList = (list: SimCompKey[], mergeWithInUse = true) => {
    const nextSet = new Set<SimCompKey>(list);
    if (mergeWithInUse) {
      inUseSet.forEach(c => nextSet.add(c));
    }
    setDraftComps(SIM_COMPS.filter(c => nextSet.has(c)));
    setDraftMethod('AUTO');
  };

  const ensureSlotInDraft = (slot: CustomSlotKey) => {
    setDraftComps(prev => {
      if (prev.includes(slot)) return prev;
      const nextSet = new Set([...prev, slot]);
      return SIM_COMPS.filter(c => nextSet.has(c));
    });
  };

  const handleAssignExtToSlot = (slot: CustomSlotKey, chemId: string) => {
    const applied = applyExtendedChemicalToSlot(slot, chemId);
    if (!applied) return;
    ensureSlotInDraft(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(`✓ ${slot} ← ${isEn ? applied.nameEn : applied.nameKo} (${applied.formula}), Tb ${applied.tbC.toFixed(1)}°C`);
  };

  const handleAssignJobackToSlot = (slot: CustomSlotKey) => {
    const parsedTb = jbTbExpStr.trim() !== '' ? Number(jbTbExpStr) : undefined;
    const tbOpt = parsedTb !== undefined && Number.isFinite(parsedTb) ? parsedTb : undefined;
    const { spec } = buildSpecFromJobackGroups(jbGroups, {
      formula: jbFormula,
      nameKo: jbNameKo,
      nameEn: jbNameKo,
      tbExpC: tbOpt,
    });
    applyCustomSpecToSlot(slot, spec);
    ensureSlotInDraft(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(`✓ ${slot} ← ${isEn ? spec.nameEn : spec.nameKo} (${spec.formula}), Tc ${spec.tcK.toFixed(1)}K, Pc ${spec.pcBar.toFixed(1)}bar`);
  };

  const handleResetSlot = (slot: CustomSlotKey) => {
    const def = resetCustomSlot(slot);
    setSlotRev(r => r + 1);
    setSlotNotice(isEn ? `↺ ${slot} reset to default (${def.nameEn})` : `↺ ${slot} 기본값 (${def.nameKo}) 복원`);
  };

  const adjustJobackGroup = (gid: JobackGroupId, delta: number) => {
    setJbGroups(prev => {
      const nextVal = Math.max(0, Math.min(24, (prev[gid] ?? 0) + delta));
      const copy = { ...prev };
      if (nextVal <= 0) delete copy[gid];
      else copy[gid] = nextVal;
      return copy;
    });
  };

  const slot1Spec = getActiveCustomSlotSpec('CUSTOM_1');
  const slot2Spec = getActiveCustomSlotSpec('CUSTOM_2');

  const getCompDisplayName = (comp: SimCompKey) => {
    if (!isEn) return COMP_META[comp].label;
    if (comp === 'CUSTOM_1' || comp === 'CUSTOM_2') {
      const slotLabelKo = COMP_META[comp].label;
      if (slotLabelKo.includes('[확장#')) {
        const slotSpec = comp === 'CUSTOM_1' ? slot1Spec : slot2Spec;
        return `${slotSpec.nameEn} [${comp === 'CUSTOM_1' ? 'Custom#1' : 'Custom#2'}]`;
      }
    }
    return getCompLabel(comp, 'en');
  };

  const getCompNote = (comp: SimCompKey, noteKo: string) => {
    if (!isEn) return noteKo;
    if (comp === 'CUSTOM_1' || comp === 'CUSTOM_2') {
      const slotSpec = comp === 'CUSTOM_1' ? slot1Spec : slot2Spec;
      if (noteKo.startsWith('[Joback+UNIFAC')) {
        return `[Joback+UNIFAC Builder] ${slotSpec.nameEn} · Tb ${slotSpec.tbC.toFixed(1)}°C`;
      }
      if (noteKo.startsWith('[확장 라이브러리]')) {
        return `[Extended Library] ${slotSpec.nameEn} · Tb ${slotSpec.tbC.toFixed(1)}°C`;
      }
    }
    return COMP_NOTE_EN[comp] ?? noteKo;
  };

  const getRecommendationReason = (rec: typeof recommendation): string => {
    if (!isEn) return rec.reasonKo;
    if (rec.reasonKo.includes('대기 상태')) {
      return 'Default Peng-Robinson equation of state standby';
    }
    if (rec.reasonKo.includes('무수 HCl/가스')) {
      return 'Anhydrous HCl / gas compression & liquefaction → Auto-selected PR EOS for high-P VLE and liquid density';
    }
    if (rec.method === 'ENRTL') {
      return 'Aqueous electrolyte (acid/alkali/salt) system → Auto-selected ENRTL for ionic activity, BPE, heat of solution & salting-out';
    }
    if (rec.method === 'NRTL') {
      return 'Polar organics, H-bonding, azeotropic / LLE system → Auto-selected NRTL + UNIFAC liquid activity model';
    }
    if (rec.method === 'SRK') {
      return 'H₂ / syngas / light olefins system → Auto-selected SRK EOS with Graboski-Daubert H₂ quantum correction';
    }
    return 'Non-polar hydrocarbons, aromatics & liquefied gases → Auto-selected PR EOS for accurate fugacity & liquid compressibility';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.52)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: isMobile ? '100vw' : 'min(1080px, 96vw)',
          height: isMobile ? '100dvh' : undefined,
          maxHeight: isMobile ? '100dvh' : '90vh',
          background: '#FFFFFF',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.34)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: isMobile ? '10px 12px' : '12px 18px',
            background: '#142435',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{t('🧪 성분 · 열역학 물성 설정', '🧪 Components & Thermodynamic Properties')}</span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#2563EB',
                  color: '#FFFFFF',
                }}
              >
                {draftComps.length}{isEn ? ' comps' : '종'} · {draftMethod === 'AUTO' ? `AUTO(${effectiveResolved})` : effectiveResolved}
              </span>
            </div>
            <div style={{ fontSize: isMobile ? 10.2 : 11, color: '#CBD5E1', marginTop: 2 }}>
              {t(
                `범용 ${SIM_COMPS.length}종 · 공장 표준 · 확장 ${EXTENDED_CHEMICAL_LIBRARY.length}종 · Joback+UNIFAC`,
                `General ${SIM_COMPS.length} · Plant Standard · Extended ${EXTENDED_CHEMICAL_LIBRARY.length} · Joback+UNIFAC`
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              padding: isMobile ? '5px 10px' : 0,
              width: isMobile ? 'auto' : 30,
              height: 30,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.4)',
              background: '#1A2F44',
              color: '#FFFFFF',
              fontSize: isMobile ? 12 : 14,
              fontWeight: 900,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isMobile ? t('✕ 닫기', '✕ Close') : '✕'}
          </button>
        </div>

        {/* 본문 2단 레이아웃: 좌측 [성분 선택] / 우측 [열역학 물성 모델 자동·수동 선택] */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.55fr 1fr',
            overflowY: isMobile ? 'auto' : 'hidden',
            overflowX: 'hidden',
          }}
        >
          {/* 좌측: 성분 설정 영역 */}
          <div
            style={{
              padding: isMobile ? '12px' : '14px 16px',
              borderRight: isMobile ? 'none' : '1px solid #E2E8F0',
              borderBottom: isMobile ? '1px solid #E2E8F0' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 0,
              overflow: isMobile ? 'visible' : 'hidden',
            }}
          >
            {/* 모드 스위치 탭: 범용 공정 개발 vs 공장별 표준 성분 vs 100+ 확장물질 · UNIFAC 분자설계 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div
                style={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  gap: 2,
                  background: '#F1F5F9',
                  padding: 3,
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  maxWidth: '100%',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSourceTab('general')}
                  style={{
                    padding: isMobile ? '5px 8px' : '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: sourceTab === 'general' ? '#1D4ED8' : 'transparent',
                    color: sourceTab === 'general' ? '#FFFFFF' : '#334155',
                    fontSize: isMobile ? 10.8 : 11.2,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {t(`🌐 범용 (${SIM_COMPS.length}종)`, `🌐 General (${SIM_COMPS.length})`)}
                </button>
                {allowedPlantPresets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSourceTab('plant')}
                    style={{
                      padding: isMobile ? '5px 8px' : '5px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: sourceTab === 'plant' ? '#0F5338' : 'transparent',
                      color: sourceTab === 'plant' ? '#FFFFFF' : '#334155',
                      fontSize: isMobile ? 10.8 : 11.2,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {t('🏭 공장 표준', '🏭 Plant Standard')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSourceTab('custom')}
                  style={{
                    padding: isMobile ? '5px 8px' : '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: sourceTab === 'custom' ? '#7C3AED' : 'transparent',
                    color: sourceTab === 'custom' ? '#FFFFFF' : '#5B21B6',
                    fontSize: isMobile ? 10.8 : 11.2,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {t('🧪 확장 · Joback/UNIFAC', '🧪 Extended · Joback/UNIFAC')}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => setDraftComps([...SIM_COMPS])}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 5,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {t(`전체 (${SIM_COMPS.length})`, `All (${SIM_COMPS.length})`)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const base: SimCompKey[] = inUseSet.size > 0 ? Array.from(inUseSet) : ['H2O'];
                    setDraftComps(SIM_COMPS.filter(c => base.includes(c)));
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 5,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#64748B',
                    cursor: 'pointer',
                  }}
                >
                  {t('사용중만', 'In Use Only')}
                </button>
              </div>
            </div>

            {sourceTab === 'custom' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
                {/* 현재 배정된 CUSTOM_1 / CUSTOM_2 슬롯 상태 카드 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: 6,
                  }}
                >
                  {([
                    { slot: 'CUSTOM_1' as CustomSlotKey, spec: slot1Spec },
                    { slot: 'CUSTOM_2' as CustomSlotKey, spec: slot2Spec },
                  ]).map(({ slot, spec }) => {
                    const activeInFlow = draftComps.includes(slot);
                    const unifacStr = Object.entries(spec.unifacGroups)
                      .map(([g, n]) => `${g}×${n}`)
                      .join(', ');
                    return (
                      <div
                        key={slot}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: activeInFlow ? '1.6px solid #7C3AED' : '1px solid #CBD5E1',
                          background: activeInFlow ? '#F5F3FF' : '#F8FAFC',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 900,
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                background: '#6D28D9',
                                color: '#FFFFFF',
                              }}
                            >
                              {slot}
                            </span>
                            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                              {isEn ? spec.nameEn : spec.nameKo} ({spec.formula})
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => toggleComp(slot)}
                              style={{
                                padding: '2px 6px',
                                fontSize: 9.5,
                                fontWeight: 800,
                                borderRadius: 4,
                                border: '1px solid #7C3AED',
                                background: activeInFlow ? '#7C3AED' : '#FFFFFF',
                                color: activeInFlow ? '#FFFFFF' : '#6D28D9',
                                cursor: 'pointer',
                              }}
                            >
                              {activeInFlow ? t('✓ 활성', '✓ Active') : t('+ 포함', '+ Add')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetSlot(slot)}
                              style={{
                                padding: '2px 6px',
                                fontSize: 9.5,
                                fontWeight: 700,
                                borderRadius: 4,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                color: '#64748B',
                                cursor: 'pointer',
                              }}
                            >
                              {t('초기화', 'Reset')}
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                          MW {spec.mw.toFixed(2)} · Tb {spec.tbC.toFixed(1)}°C · Tc {spec.tcK.toFixed(1)}K · Pc {spec.pcBar.toFixed(1)}bar · ω {spec.omega.toFixed(3)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#6D28D9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          UNIFAC: {unifacStr || 'CH2×2'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {slotNotice && (
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: '#ECFDF5',
                      border: '1px solid #6EE7B7',
                      color: '#065F46',
                      fontSize: 10.8,
                      fontWeight: 800,
                    }}
                  >
                    {slotNotice}
                  </div>
                )}

                {/* 서브 모드 선택: 128종 확장 라이브러리 vs Joback+UNIFAC 분자 직접 설계 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setCustomSubTab('library')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: customSubTab === 'library' ? '1.5px solid #7C3AED' : '1px solid #CBD5E1',
                      background: customSubTab === 'library' ? '#EDE9FE' : '#FFFFFF',
                      color: customSubTab === 'library' ? '#5B21B6' : '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {t(`📚 확장 라이브러리 (${EXTENDED_CHEMICAL_LIBRARY.length}종)`, `📚 Extended Library (${EXTENDED_CHEMICAL_LIBRARY.length})`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomSubTab('joback')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: customSubTab === 'joback' ? '1.5px solid #0F766E' : '1px solid #CBD5E1',
                      background: customSubTab === 'joback' ? '#CCFBF1' : '#FFFFFF',
                      color: customSubTab === 'joback' ? '#0F766E' : '#334155',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {t('🧬 Joback + UNIFAC 분자설계', '🧬 Joback + UNIFAC Molecule Builder')}
                  </button>
                </div>

                {customSubTab === 'library' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 220 }}>
                    <input
                      type="text"
                      value={extSearch}
                      onChange={e => setExtSearch(e.target.value)}
                      placeholder={t('물질명, 화학식, CAS 검색...', 'Search name, formula, or CAS...')}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '6px 10px',
                        fontSize: 11.2,
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#F8FAFC',
                      }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(['ALL', ...(Object.keys(EXTENDED_LIB_CATEGORY_LABELS) as ExtendedLibCategory[])] as const).map(cat => {
                        const active = extCatFilter === cat;
                        const cnt =
                          cat === 'ALL'
                            ? EXTENDED_CHEMICAL_LIBRARY.length
                            : EXTENDED_CHEMICAL_LIBRARY.filter(x => x.category === cat).length;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setExtCatFilter(cat)}
                            style={{
                              padding: '3px 7px',
                              borderRadius: 999,
                              border: active ? '1px solid #7C3AED' : '1px solid #CBD5E1',
                              background: active ? '#7C3AED' : '#FFFFFF',
                              color: active ? '#FFFFFF' : '#475569',
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {cat === 'ALL'
                              ? t(`전체 (${cnt})`, `All (${cnt})`)
                              : `${isEn ? EXTENDED_LIB_CATEGORY_LABELS_EN[cat] : EXTENDED_LIB_CATEGORY_LABELS[cat]} (${cnt})`}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minHeight: 200,
                        maxHeight: isMobile ? 340 : 380,
                        overflowY: 'auto',
                        border: '1px solid #E2E8F0',
                        borderRadius: 8,
                        background: '#F8FAFC',
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      {filteredExtLibrary.map(item => {
                        const isSlot1 = slot1Spec.id === item.id;
                        const isSlot2 = slot2Spec.id === item.id;
                        return (
                          <div
                            key={item.id}
                            style={{
                              padding: '7px 9px',
                              borderRadius: 7,
                              border: isSlot1 || isSlot2 ? '1.5px solid #7C3AED' : '1px solid #E2E8F0',
                              background: isSlot1 || isSlot2 ? '#F5F3FF' : '#FFFFFF',
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>{isEn ? item.nameEn : item.nameKo}</span>
                                <span style={{ fontSize: 10.2, fontWeight: 700, color: '#6D28D9', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {item.formula}
                                </span>
                                <span style={{ fontSize: 9.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                                  CAS {item.cas}
                                </span>
                              </div>
                              <div style={{ fontSize: 9.8, color: '#475569', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                                MW {item.mw.toFixed(1)} · Tb {item.tbC.toFixed(1)}°C · Tc {item.tcK.toFixed(0)}K · Pc {item.pcBar.toFixed(1)}bar · ΔHf° {item.dHfIg298_kJ_mol.toFixed(0)}kJ/mol
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => handleAssignExtToSlot('CUSTOM_1', item.id)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #7C3AED',
                                  background: isSlot1 ? '#7C3AED' : '#FFFFFF',
                                  color: isSlot1 ? '#FFFFFF' : '#6D28D9',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {isSlot1 ? '✓ #1' : t('슬롯#1', 'Slot #1')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAssignExtToSlot('CUSTOM_2', item.id)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 5,
                                  border: '1px solid #0F766E',
                                  background: isSlot2 ? '#0F766E' : '#FFFFFF',
                                  color: isSlot2 ? '#FFFFFF' : '#0F766E',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {isSlot2 ? '✓ #2' : t('슬롯#2', 'Slot #2')}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Joback + Hansen UNIFAC 분자 직접 설계 빌더 */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '1.2fr 0.9fr 1fr',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>{t('물질명', 'Compound Name')}</label>
                        <input
                          type="text"
                          value={jbNameKo}
                          onChange={e => setJbNameKo(e.target.value)}
                          placeholder={t('물질명', 'Compound Name')}
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #CBD5E1' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>{t('화학식', 'Formula')}</label>
                        <input
                          type="text"
                          value={jbFormula}
                          onChange={e => setJbFormula(e.target.value)}
                          placeholder="C7H14O2"
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #CBD5E1', fontFamily: 'JetBrains Mono, monospace' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#0F766E' }}>{t('실험 Tb (°C, 선택)', 'Exp. Tb (°C, optional)')}</label>
                        <input
                          type="text"
                          value={jbTbExpStr}
                          onChange={e => setJbTbExpStr(e.target.value)}
                          placeholder={t('미입력 시 Joback 추산', 'Joback estimate if blank')}
                          style={{ padding: '5px 8px', fontSize: 11, borderRadius: 5, border: '1px solid #5EEAD4', background: '#F0FDFA', fontFamily: 'JetBrains Mono, monospace' }}
                        />
                      </div>
                    </div>

                    {/* 빠른 분자 예시 프리셋 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#64748B' }}>{t('예시:', 'Examples:')}</span>
                      {[
                        { labelKo: '이소아밀아세테이트', labelEn: 'Isoamyl Acetate', f: 'C7H14O2', tb: '142.0', g: { CH3: 3, CH2_chain: 2, CH_chain: 1, COO_ester: 1 } as Partial<Record<JobackGroupId, number>> },
                        { labelKo: '시클로헥실메탄올', labelEn: 'Cyclohexylmethanol', f: 'C7H14O', tb: '181.0', g: { CH2_ring: 5, CH_ring: 1, CH2_chain: 1, OH_alcohol: 1 } as Partial<Record<JobackGroupId, number>> },
                        { labelKo: '프로필벤젠', labelEn: 'Propylbenzene', f: 'C9H12', tb: '159.2', g: { ACH_arom: 5, AC_arom: 1, CH2_chain: 2, CH3: 1 } as Partial<Record<JobackGroupId, number>> },
                        { labelKo: '초기화', labelEn: 'Reset', f: 'Custom', tb: '', g: { CH3: 2 } as Partial<Record<JobackGroupId, number>> },
                      ].map(ex => (
                        <button
                          key={ex.labelKo}
                          type="button"
                          onClick={() => {
                            const exLabel = isEn ? ex.labelEn : ex.labelKo;
                            setJbNameKo(ex.labelKo === '초기화' ? t('사용자 설계 분자', 'Custom Molecule') : exLabel);
                            setJbFormula(ex.f);
                            setJbTbExpStr(ex.tb);
                            setJbGroups(ex.g);
                          }}
                          style={{
                            padding: '2.5px 7px',
                            fontSize: 9.8,
                            fontWeight: 700,
                            borderRadius: 4,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#334155',
                            cursor: 'pointer',
                          }}
                        >
                          {isEn ? ex.labelEn : ex.labelKo}
                        </button>
                      ))}
                    </div>

                    {/* Joback 작용기 카운터 그리드 */}
                    <div
                      style={{
                        maxHeight: isMobile ? 220 : 215,
                        overflowY: 'auto',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        background: '#F8FAFC',
                        padding: 6,
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                        gap: 4,
                      }}
                    >
                      {(Object.keys(JOBACK_GROUPS) as JobackGroupId[]).map(gid => {
                        const def = JOBACK_GROUPS[gid];
                        const cnt = jbGroups[gid] ?? 0;
                        return (
                          <div
                            key={gid}
                            style={{
                              padding: '4px 7px',
                              borderRadius: 5,
                              border: cnt > 0 ? '1.3px solid #0F766E' : '1px solid #E2E8F0',
                              background: cnt > 0 ? '#F0FDFA' : '#FFFFFF',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 4,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                                {def.symbol}
                              </span>{' '}
                              <span style={{ fontSize: 9.8, color: '#475569' }}>{isEn ? JOBACK_GROUP_LABEL_EN[gid] : def.labelKo}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => adjustJobackGroup(gid, -1)}
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  border: '1px solid #CBD5E1',
                                  background: '#FFFFFF',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  lineHeight: 1,
                                }}
                              >
                                -
                              </button>
                              <span style={{ minWidth: 16, textAlign: 'center', fontSize: 11, fontWeight: 900, color: cnt > 0 ? '#0F766E' : '#94A3B8' }}>
                                {cnt}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustJobackGroup(gid, 1)}
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  border: '1px solid #0F766E',
                                  background: '#CCFBF1',
                                  color: '#0F766E',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  lineHeight: 1,
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 실시간 물성 예측 결과 & 슬롯 배정 */}
                    <div
                      style={{
                        padding: '9px 11px',
                        borderRadius: 8,
                        border: '1.5px solid #0F766E',
                        background: '#F0FDFA',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <div style={{ fontSize: 10.8, fontWeight: 900, color: '#0F766E' }}>
                        {t('🔬 Joback · Lee–Kesler · UNIFAC 물성 추산', '🔬 Joback · Lee–Kesler · UNIFAC Property Estimation')}
                      </div>
                      <div style={{ fontSize: 10.2, color: '#1E293B', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
                        MW <b>{liveJobackPred.mw.toFixed(2)}</b> g/mol · Tb <b>{liveJobackPred.tbC.toFixed(1)}°C</b> (Joback {(liveJobackPred.tbJoback_K - 273.15).toFixed(1)}°C) · Tc <b>{liveJobackPred.tc_K.toFixed(1)} K</b> · Pc <b>{liveJobackPred.pc_bar.toFixed(2)} bar</b> · ω <b>{liveJobackPred.omega.toFixed(3)}</b>
                        <br />
                        ΔHf°(g,298K) <b>{liveJobackPred.dHfIg298_kJ_mol.toFixed(1)}</b> kJ/mol · ΔHvap(298K) <b>{liveJobackPred.dHvap298_kJ_mol.toFixed(1)}</b> kJ/mol · μL(25°C) <b>{liveJobackPred.viscLiq298_cP.toFixed(2)}</b> cP
                        <br />
                        UNIFAC:{' '}
                        <b>
                          {Object.entries(liveJobackPred.unifacGroups)
                            .map(([g, n]) => `${g}:${n}`)
                            .join(', ')}
                        </b>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                        <button
                          type="button"
                          onClick={() => handleAssignJobackToSlot('CUSTOM_1')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #7C3AED',
                            background: '#7C3AED',
                            color: '#FFFFFF',
                            fontSize: 10.8,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          {t('✓ CUSTOM_1 적용', '✓ Apply to CUSTOM_1')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssignJobackToSlot('CUSTOM_2')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #0F766E',
                            background: '#0F766E',
                            color: '#FFFFFF',
                            fontSize: 10.8,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          {t('✓ CUSTOM_2 적용', '✓ Apply to CUSTOM_2')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : sourceTab === 'plant' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', paddingRight: 2 }}>
                <div style={{ fontSize: 10.5, color: '#64748B' }}>
                  {t(
                    '공장별 표준 성분 프리셋 (로드 후 범용 탭에서 추가/편집 가능)',
                    'Plant-standard component presets (you can add or edit components in General tab after loading)'
                  )}
                </div>
                {allowedPlantPresets.map(preset => {
                  const isExact =
                    preset.components.length === draftComps.length &&
                    preset.components.every(c => draftComps.includes(c));
                  const pEn = PLANT_PRESET_EN[preset.plantId];
                  return (
                    <div
                      key={preset.plantId}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 9,
                        border: isExact ? '1.8px solid #059669' : '1px solid #CBD5E1',
                        background: isExact ? '#ECFDF5' : '#F8FAFC',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 900,
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: '#0F5338',
                              color: '#FFFFFF',
                            }}
                          >
                            {preset.code}
                          </span>
                          <span style={{ fontSize: 12.2, fontWeight: 900, color: '#0F172A' }}>
                            {isEn && pEn ? pEn.label : preset.labelKo}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyPresetList(preset.components)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #059669',
                            background: isExact ? '#059669' : '#FFFFFF',
                            color: isExact ? '#FFFFFF' : '#065F46',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isExact ? t('✓ 적용됨', '✓ Applied') : t('불러오기', 'Load')}
                        </button>
                      </div>
                      <div style={{ fontSize: 10.8, color: '#475569' }}>{isEn && pEn ? pEn.desc : preset.descKo}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {preset.components.map(c => (
                          <span
                            key={c}
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1.5px 6px',
                              borderRadius: 4,
                              background: '#FFFFFF',
                              border: '1px solid #CBD5E1',
                              color: '#1E293B',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {getCompDisplayName(c)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {/* 범용 공정 빠른 스타터 패키지 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>
                    {t('⚡ 빠른 프리셋:', '⚡ Quick Presets:')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {visibleGeneralPacks.map(pk => {
                      const gEn = GENERAL_PACK_EN[pk.id];
                      return (
                        <button
                          key={pk.id}
                          type="button"
                          onClick={() => applyPresetList(pk.components)}
                          title={isEn && gEn ? gEn.desc : pk.descKo}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid #BFDBFE',
                            background: '#EFF6FF',
                            color: '#1E3A8A',
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <span>{isEn && gEn ? gEn.label : pk.labelKo}</span>
                          <span
                            style={{
                              fontSize: 9,
                              padding: '0.5px 4px',
                              borderRadius: 3,
                              background: '#DBEAFE',
                              color: '#1D4ED8',
                            }}
                          >
                            {isEn && gEn ? gEn.badge : pk.badge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 검색창 + 화학군 필터 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('물질명, 화학식, CAS 검색...', 'Search name, formula, or CAS...')}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 11.5,
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                    }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {FAMILY_ORDER.map(fam => {
                      const active = familyFilter === fam;
                      const count =
                        fam === 'ALL'
                          ? SIM_COMPS.length
                          : SIM_COMPS.filter(k => COMP_CATALOG_META[k]?.family === fam).length;
                      return (
                        <button
                          key={fam}
                          type="button"
                          onClick={() => setFamilyFilter(fam)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 999,
                            border: active ? '1px solid #1D4ED8' : '1px solid #CBD5E1',
                            background: active ? '#1D4ED8' : '#FFFFFF',
                            color: active ? '#FFFFFF' : '#475569',
                            fontSize: 10.2,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {fam === 'ALL'
                            ? t(`전체 (${count})`, `All (${count})`)
                            : `${isEn ? COMP_FAMILY_LABELS_EN[fam] : COMP_FAMILY_LABELS[fam]} (${count})`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 검증된 40종 물질 그리드 */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 6,
                    alignContent: 'start',
                    paddingRight: 3,
                  }}
                >
                  {filteredComps.map(comp => {
                    const checked = draftComps.includes(comp);
                    const inUse = inUseSet.has(comp);
                    const cat = COMP_CATALOG_META[comp];
                    return (
                      <div
                        key={comp}
                        onClick={() => toggleComp(comp)}
                        style={{
                          padding: '7px 9px',
                          borderRadius: 7,
                          border: checked ? '1.5px solid #2563EB' : '1px solid #E2E8F0',
                          background: checked ? '#EFF6FF' : '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {}}
                              style={{ margin: 0, cursor: 'pointer' }}
                            />
                            <span
                              style={{
                                fontSize: 11.3,
                                fontWeight: checked ? 900 : 700,
                                color: '#0F172A',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {getCompDisplayName(comp)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                            {inUse && (
                              <span
                                style={{
                                  fontSize: 8.8,
                                  fontWeight: 900,
                                  padding: '1px 4px',
                                  borderRadius: 3,
                                  background: '#DCFCE7',
                                  color: '#166534',
                                }}
                              >
                                {t('유량있음', 'In Use')}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 9.2,
                                color: '#64748B',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            >
                              Tb {cat.tbC > 500 ? t('비휘발', 'Non-vol.') : `${cat.tbC}°C`}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <span style={{ fontSize: 9.8, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getCompNote(comp, cat.noteKo)}
                          </span>
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {cat.reliableMethods.map(m => (
                              <span
                                key={m}
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 800,
                                  padding: '0.5px 3.5px',
                                  borderRadius: 3,
                                  background: m === effectiveResolved ? '#1E40AF' : '#F1F5F9',
                                  color: m === effectiveResolved ? '#FFFFFF' : '#475569',
                                }}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 우측: 열역학 물성 모델 (Property Method) 자동 추천 + 수동 지정 */}
          <div
            style={{
              padding: '14px 16px',
              background: '#F8FAFC',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
              {t('⚗️ 물성 모델 (Property Method)', '⚗️ Property Method')}
            </div>

            {/* 자동 선택 (AUTO) 카드 */}
            <div
              onClick={() => setDraftMethod('AUTO')}
              style={{
                padding: '11px 12px',
                borderRadius: 9,
                border: draftMethod === 'AUTO' ? '2px solid #2563EB' : '1px solid #CBD5E1',
                background: draftMethod === 'AUTO' ? '#EFF6FF' : '#FFFFFF',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={draftMethod === 'AUTO'} onChange={() => setDraftMethod('AUTO')} />
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#1E3A8A' }}>
                    {t('✨ 자동 선택 (AUTO · 권장)', '✨ Auto Select (AUTO · Recommended)')}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: '#1D4ED8',
                    color: '#FFFFFF',
                  }}
                >
                  {t(`추천 ${recommendation.method}`, `Rec: ${recommendation.method}`)}
                </span>
              </div>
              <div style={{ fontSize: 10.8, color: '#1E40AF', fontWeight: 700, lineHeight: 1.45 }}>
                {getRecommendationReason(recommendation)}
              </div>
            </div>

            <div style={{ fontSize: 10.8, fontWeight: 800, color: '#475569', marginTop: 2 }}>
              {t('개별 모델 직접 선택:', 'Select Property Method Manually:')}
            </div>

            {(['ENRTL', 'NRTL', 'PR', 'SRK'] as const).map(mCode => {
              const info = PROPERTY_METHOD_INFO[mCode];
              const infoEn = PROPERTY_METHOD_EN[mCode];
              const isManualSelected = draftMethod === mCode;
              const isAutoActive = draftMethod === 'AUTO' && recommendation.method === mCode;
              return (
                <div
                  key={mCode}
                  onClick={() => setDraftMethod(mCode)}
                  style={{
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: isManualSelected
                      ? `1.8px solid ${info.accent}`
                      : isAutoActive
                        ? `1.5px dashed ${info.accent}`
                        : '1px solid #CBD5E1',
                    background: isManualSelected ? info.bg : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        checked={isManualSelected}
                        onChange={() => setDraftMethod(mCode)}
                      />
                      <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                        {isEn ? infoEn.label : info.labelKo}
                      </span>
                    </div>
                    {isAutoActive && (
                      <span
                        style={{
                          fontSize: 9.2,
                          fontWeight: 900,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: info.bg,
                          border: `1px solid ${info.border}`,
                          color: info.accent,
                        }}
                      >
                        {t('AUTO 활성', 'AUTO Active')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#334155', fontFamily: 'JetBrains Mono, monospace' }}>
                    {isEn ? infoEn.formulaDesc : info.formulaDesc}
                  </div>
                  <div style={{ fontSize: 10.2, color: '#64748B', lineHeight: 1.4 }}>
                    {t('적합:', 'Best for:')} {isEn ? infoEn.bestFor : info.bestForKo}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 단위계 선택 바 (새 시뮬레이션 · 단위계 빠른 설정) */}
        <div
          style={{
            padding: '7px 18px',
            borderTop: '1px solid #E2E8F0',
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: '#334155', whiteSpace: 'nowrap' }}>
            {t('단위계 (Unit System):', 'Unit System:')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {UNIT_PRESETS.map(p => {
              const active = unitPresetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyUnitPreset(p.id)}
                  title={p.desc}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 5,
                    border: active ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                    background: active ? '#EFF6FF' : '#F8FAFC',
                    color: active ? '#1E3A8A' : '#475569',
                    fontSize: 11,
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isEn ? (UNIT_PRESET_NAMES_EN[p.id] ?? p.name) : p.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 하단 선택 성분 요약 + 적용 버튼 바 */}
        <div
          style={{
            padding: '10px 18px',
            background: '#F1F5F9',
            borderTop: '1px solid #CBD5E1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
              maxHeight: 48,
              overflowY: 'auto',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#334155', marginRight: 4 }}>
              {t(`선택 (${draftComps.length}):`, `Selected (${draftComps.length}):`)}
            </span>
            {draftComps.length === 0 ? (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#B45309' }}>
                {t(
                  '위 목록에서 사용할 화학 성분을 1개 이상 선택하세요 (열역학 모델 자동 추천)',
                  'Select at least 1 chemical component above (property method is auto-recommended)'
                )}
              </span>
            ) : (
              draftComps.map(c => (
                <span
                  key={c}
                  onClick={() => toggleComp(c)}
                  title={t('클릭하여 제거', 'Click to remove')}
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#FFFFFF',
                    border: '1px solid #94A3B8',
                    color: '#0F172A',
                    cursor: 'pointer',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {c} ×
                </span>
              ))
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isMobile ? 'flex-end' : undefined,
              width: isMobile ? '100%' : undefined,
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#475569',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('취소', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={draftComps.length === 0}
              onClick={() => {
                if (draftComps.length === 0) return;
                onApply(draftComps, draftMethod);
                onClose();
              }}
              style={{
                padding: '7px 18px',
                borderRadius: 7,
                border: '1px solid #1E3A8A',
                background: draftComps.length === 0 ? '#94A3B8' : '#1E3A8A',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 900,
                cursor: draftComps.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: draftComps.length === 0 ? 'none' : '0 2px 6px rgba(30, 58, 138, 0.25)',
              }}
            >
              {t('✓ 적용 및 시작', '✓ Apply & Start')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

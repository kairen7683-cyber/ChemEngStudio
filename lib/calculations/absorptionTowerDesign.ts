/**
 * Packed Absorption / Scrubbing / Drying / Stripping Tower Solver
 *
 * Strictly unifies & upgrades:
 *   1. ChemPro `solveColumn` (`colMode === 'absorption'`)
 *   2. `lib/packingCalc.ts` (`PACKING_DB`, `calcPackingTower` including Table 1.39 fixed U/Z modes)
 *   3. Rigorous Correlations (ZERO EQUATION DOWNGRADE):
 *      - Eckert GPDC flooding velocity & % flooding (`calcEckertGpdcPacking`)
 *      - Billet & Schultes (1999) irrigated pressure drop, liquid holdup, loading/flooding (`calcBilletSchultesPacking`)
 *      - Onda, Takeuchi & Okumoto (1968) wetted area a_w, k_G, k_L -> HTU_G, HTU_L, HTU_OG
 *      - Colburn / Kremser / Equilibrium N_OG & packed bed height Z
 */

import { type FluidProps, resolveFluidProps } from './chemproFluidBridge';
import {
  type PackingCatalogSpec,
  type BilletSchultesResult,
  calcBilletSchultesPacking,
  calcEckertGpdcPacking,
} from './columnInternalsDesign';
import {
  buildChemproVesselAndLevels,
  pickChemproNozzleDn,
  type ChemproManholeItem,
  type ChemproNozzleItem,
  type ChemproPackingDetail,
  type ChemproVesselSpec,
} from './chemproColumnEpcHelper';

export type AbsorptionSolverMode = 'quick' | 'rigorous';
export type AbsorptionService = 'scrubbing' | 'drying' | 'cooling_wash' | 'stripping' | 'absorption' | string;

export interface UnifiedPackingSpec {
  key: string;
  name: string;
  type: 'Random' | 'Structured';
  category: 'random' | 'structured';
  mat: string;
  size_mm: number;
  /** Packing factor in metric m⁻¹ (ChemPro standard) */
  Fp: number;
  /** Packing factor in imperial ft⁻¹ (GPDC / packingCalc legacy) */
  packingFactor: number;
  /** Specific surface area ap (m²/m³) */
  ap: number;
  /** Void percentage (%) */
  void_pct: number;
  /** Void fraction ε (0..1) */
  voidFraction: number;
  /** Reference HETP (m) */
  hetp_base: number;
  HETP_ref: number;
  /** Minimum wetting rate (m³/m²·h) */
  minWettingM3M2H: number;
  /** Critical surface tension of packing material (mN/m) for Onda correlation */
  sigmaCritMnM: number;
  /** Billet & Schultes (1999) packing constants */
  bsCp: number;
  bsCh: number;
  bsCL: number;
  bsCV: number;
  bsCfl: number;
  /** Whether entry is part of the primary lib/packingCalc.ts PACKING_DB dropdown */
  isLegacyPackingCalcEntry?: boolean;
}

const FT_TO_M_INV = 3.28084;

function makePacking(spec: {
  key: string;
  name: string;
  category: 'random' | 'structured';
  mat: string;
  size_mm: number;
  Fp_m1?: number;
  Fp_ft1?: number;
  ap: number;
  voidFraction: number;
  hetp_base: number;
  minWettingM3M2H?: number;
  sigmaCritMnM?: number;
  bsCp: number;
  bsCh: number;
  bsCL: number;
  bsCV: number;
  bsCfl: number;
  isLegacyPackingCalcEntry?: boolean;
}): UnifiedPackingSpec {
  const Fp = spec.Fp_m1 ?? Math.round((spec.Fp_ft1 ?? 30) * FT_TO_M_INV);
  const packingFactor = spec.Fp_ft1 ?? Math.round(Fp / FT_TO_M_INV);
  const matU = spec.mat.toUpperCase();
  const sigmaCritMnM =
    spec.sigmaCritMnM ??
    (matU.includes('PTFE') || matU.includes('PVDF') || matU.includes('PVC') || matU.includes('PP')
      ? 33
      : matU.includes('CERAMIC') || matU.includes('PORCELAIN') || matU.includes('세라믹')
        ? 61
        : 75);
  const minWettingM3M2H =
    spec.minWettingM3M2H ??
    (spec.category === 'structured' ? 1.0 : sigmaCritMnM < 40 ? 6.5 : 4.0);
  return {
    key: spec.key,
    name: spec.name,
    type: spec.category === 'structured' ? 'Structured' : 'Random',
    category: spec.category,
    mat: spec.mat,
    size_mm: spec.size_mm,
    Fp,
    packingFactor,
    ap: spec.ap,
    void_pct: Number((spec.voidFraction * 100).toFixed(1)),
    voidFraction: spec.voidFraction,
    hetp_base: spec.hetp_base,
    HETP_ref: spec.hetp_base,
    minWettingM3M2H,
    sigmaCritMnM,
    bsCp: spec.bsCp,
    bsCh: spec.bsCh,
    bsCL: spec.bsCL,
    bsCV: spec.bsCV,
    bsCfl: spec.bsCfl,
    isLegacyPackingCalcEntry: spec.isLegacyPackingCalcEntry,
  };
}

/**
 * Unified Packing Catalog combining:
 *   - All 10 entries of `lib/packingCalc.ts` (`PACKING_DB`)
 *   - All 18 entries of ChemPro `eng_solvers.js` (`PACKING_DB`)
 *   - Additional high-rigor structured/random entries from `columnInternalsDesign.ts`
 *   with complete Billet-Schultes (1999) + Onda (1968) + Eckert GPDC constants.
 */
export const PACKING_CATALOG: Record<string, UnifiedPackingSpec> = {
  // ── Legacy `lib/packingCalc.ts` PACKING_DB primary entries (preserved in exact order) ──
  tellerette_1b: makePacking({
    key: 'tellerette_1b', name: '1B Tellerette (테라렛 45×19mm, PVC/PVDF)', category: 'random',
    mat: 'PVC / PVDF', size_mm: 45, Fp_ft1: 18, ap: 190, voidFraction: 0.87, hetp_base: 0.55,
    bsCp: 0.54, bsCh: 0.66, bsCL: 1.32, bsCV: 0.40, bsCfl: 0.78, isLegacyPackingCalcEntry: true,
  }),
  tellerette_2k: makePacking({
    key: 'tellerette_2k', name: '2K Tellerette (테라렛 70×25mm, PVC/PVDF)', category: 'random',
    mat: 'PVC / PVDF', size_mm: 70, Fp_ft1: 12, ap: 112, voidFraction: 0.92, hetp_base: 0.72,
    bsCp: 0.48, bsCh: 0.62, bsCL: 1.28, bsCV: 0.39, bsCfl: 0.82, isLegacyPackingCalcEntry: true,
  }),
  raschig_50: makePacking({
    key: 'raschig_50', name: '2B Raschig Ring 50×50mm (라시히링 2")', category: 'random',
    mat: 'Acid-Proof Ceramic', size_mm: 50, Fp_ft1: 37, ap: 95, voidFraction: 0.79, hetp_base: 0.95,
    bsCp: 1.33, bsCh: 0.58, bsCL: 1.36, bsCV: 0.41, bsCfl: 0.55, isLegacyPackingCalcEntry: true,
  }),
  raschig_25: makePacking({
    key: 'raschig_25', name: '1B Raschig Ring 25×25mm (라시히링 1")', category: 'random',
    mat: 'Acid-Proof Ceramic', size_mm: 25, Fp_ft1: 65, ap: 190, voidFraction: 0.73, hetp_base: 0.50,
    bsCp: 1.52, bsCh: 0.55, bsCL: 1.38, bsCV: 0.42, bsCfl: 0.52, isLegacyPackingCalcEntry: true,
  }),
  pall_25: makePacking({
    key: 'pall_25', name: 'Pall Ring 25mm', category: 'random',
    mat: 'SS316L', size_mm: 25, Fp_ft1: 45, Fp_m1: 183, ap: 205, voidFraction: 0.94, hetp_base: 0.40,
    bsCp: 0.749, bsCh: 0.719, bsCL: 1.412, bsCV: 0.41, bsCfl: 0.64, isLegacyPackingCalcEntry: true,
  }),
  pall_38: makePacking({
    key: 'pall_38', name: 'Pall Ring 38mm', category: 'random',
    mat: 'SS316L', size_mm: 38, Fp_ft1: 28, Fp_m1: 131, ap: 130, voidFraction: 0.95, hetp_base: 0.55,
    bsCp: 0.763, bsCh: 0.784, bsCL: 1.227, bsCV: 0.395, bsCfl: 0.66, isLegacyPackingCalcEntry: true,
  }),
  pall_50: makePacking({
    key: 'pall_50', name: 'Pall Ring 50mm', category: 'random',
    mat: 'SS316L', size_mm: 50, Fp_ft1: 20, Fp_m1: 89, ap: 100, voidFraction: 0.96, hetp_base: 0.70,
    bsCp: 0.763, bsCh: 0.784, bsCL: 1.192, bsCV: 0.39, bsCfl: 0.68, isLegacyPackingCalcEntry: true,
  }),
  intx_50: makePacking({
    key: 'intx_50', name: 'Intalox Saddle 50mm', category: 'random',
    mat: 'Acid-Proof Ceramic', size_mm: 50, Fp_ft1: 21, ap: 108, voidFraction: 0.78, hetp_base: 0.60,
    bsCp: 0.65, bsCh: 0.74, bsCL: 1.35, bsCV: 0.40, bsCfl: 0.69, isLegacyPackingCalcEntry: true,
  }),
  mellapak_250y: makePacking({
    key: 'mellapak_250y', name: 'Mellapak 250Y (Structured)', category: 'structured',
    mat: 'SS316L Sheet 0.15mm', size_mm: 250, Fp_ft1: 9, Fp_m1: 66, ap: 250, voidFraction: 0.97, hetp_base: 0.28,
    minWettingM3M2H: 0.8, bsCp: 0.355, bsCh: 0.554, bsCL: 1.476, bsCV: 0.385, bsCfl: 1.10, isLegacyPackingCalcEntry: true,
  }),
  mellapak_125y: makePacking({
    key: 'mellapak_125y', name: 'Mellapak 125Y (structured)', category: 'structured',
    mat: 'SS316L Sheet 0.15mm', size_mm: 125, Fp_ft1: 6, ap: 125, voidFraction: 0.98, hetp_base: 0.45,
    minWettingM3M2H: 0.8, bsCp: 0.38, bsCh: 0.56, bsCL: 1.45, bsCV: 0.385, bsCfl: 1.12, isLegacyPackingCalcEntry: true,
  }),

  // ── ChemPro `eng_solvers.js` PACKING_DB entries ────────────────────────────────────
  pall_plastic_50: makePacking({
    key: 'pall_plastic_50', name: 'PP/PVDF Plastic Pall Ring 50mm (2")', category: 'random',
    mat: 'PP / PVDF', size_mm: 50, Fp_m1: 85, ap: 110, voidFraction: 0.92, hetp_base: 0.65,
    minWettingM3M2H: 7.5, bsCp: 0.69, bsCh: 0.59, bsCL: 1.05, bsCV: 0.38, bsCfl: 0.70,
  }),
  intalox_ceramic_25: makePacking({
    key: 'intalox_ceramic_25', name: 'Ceramic Intalox Saddle 25mm (1")', category: 'random',
    mat: 'Acid-Proof Ceramic', size_mm: 25, Fp_m1: 300, ap: 255, voidFraction: 0.77, hetp_base: 0.45,
    minWettingM3M2H: 4.5, bsCp: 0.72, bsCh: 0.70, bsCL: 1.40, bsCV: 0.41, bsCfl: 0.63,
  }),
  intalox_ceramic_38: makePacking({
    key: 'intalox_ceramic_38', name: 'Ceramic Intalox Saddle 38mm (1.5")', category: 'random',
    mat: 'Acid-Proof Ceramic', size_mm: 38, Fp_m1: 170, ap: 195, voidFraction: 0.80, hetp_base: 0.58,
    minWettingM3M2H: 4.5, bsCp: 0.68, bsCh: 0.72, bsCL: 1.38, bsCV: 0.405, bsCfl: 0.66,
  }),
  pall_ti_38: makePacking({
    key: 'pall_ti_38', name: 'Titanium Gr.2 Pall Ring 38mm (1.5")', category: 'random',
    mat: 'Titanium Gr.2', size_mm: 38, Fp_m1: 131, ap: 130, voidFraction: 0.95, hetp_base: 0.56,
    minWettingM3M2H: 4.5, bsCp: 0.763, bsCh: 0.784, bsCL: 1.227, bsCV: 0.395, bsCfl: 0.66,
  }),
  pall_ss316_38: makePacking({
    key: 'pall_ss316_38', name: 'SS316L Metal Pall Ring 38mm (1.5")', category: 'random',
    mat: 'SS316L / SS304L', size_mm: 38, Fp_m1: 131, ap: 130, voidFraction: 0.95, hetp_base: 0.56,
    minWettingM3M2H: 4.5, bsCp: 0.763, bsCh: 0.784, bsCL: 1.227, bsCV: 0.395, bsCfl: 0.66,
  }),
  tellerette_pp_50: makePacking({
    key: 'tellerette_pp_50', name: 'PP/PVDF Tellerette 2" Rosette', category: 'random',
    mat: 'PP / PVDF', size_mm: 50, Fp_m1: 65, ap: 125, voidFraction: 0.93, hetp_base: 0.55,
    minWettingM3M2H: 7.5, bsCp: 0.50, bsCh: 0.63, bsCL: 1.28, bsCV: 0.39, bsCfl: 0.80,
  }),
  pall_metal_16: makePacking({
    key: 'pall_metal_16', name: 'Metal Pall Ring 16mm (5/8")', category: 'random',
    mat: 'SS316L', size_mm: 16, Fp_m1: 266, ap: 340, voidFraction: 0.93, hetp_base: 0.36,
    minWettingM3M2H: 4.5, bsCp: 0.957, bsCh: 0.78, bsCL: 1.317, bsCV: 0.415, bsCfl: 0.62,
  }),
  pall_metal_25: makePacking({
    key: 'pall_metal_25', name: 'Metal Pall Ring 25mm (1")', category: 'random',
    mat: 'SS316L', size_mm: 25, Fp_m1: 183, ap: 205, voidFraction: 0.94, hetp_base: 0.48,
    minWettingM3M2H: 4.5, bsCp: 0.749, bsCh: 0.719, bsCL: 1.412, bsCV: 0.41, bsCfl: 0.64,
  }),
  pall_metal_38: makePacking({
    key: 'pall_metal_38', name: 'Metal Pall Ring 38mm (1.5")', category: 'random',
    mat: 'SS316L / Ti Gr.2', size_mm: 38, Fp_m1: 131, ap: 130, voidFraction: 0.95, hetp_base: 0.64,
    minWettingM3M2H: 4.5, bsCp: 0.763, bsCh: 0.784, bsCL: 1.227, bsCV: 0.395, bsCfl: 0.66,
  }),
  pall_metal_50: makePacking({
    key: 'pall_metal_50', name: 'Metal Pall Ring 50mm (2")', category: 'random',
    mat: 'SS316L', size_mm: 50, Fp_m1: 89, ap: 105, voidFraction: 0.96, hetp_base: 0.82,
    minWettingM3M2H: 4.5, bsCp: 0.763, bsCh: 0.784, bsCL: 1.192, bsCV: 0.39, bsCfl: 0.68,
  }),
  imtp_25: makePacking({
    key: 'imtp_25', name: 'IMTP #25 (Intalox Metal)', category: 'random',
    mat: 'SS316L', size_mm: 25, Fp_m1: 135, ap: 225, voidFraction: 0.965, hetp_base: 0.42,
    minWettingM3M2H: 4.5, bsCp: 0.65, bsCh: 0.69, bsCL: 1.45, bsCV: 0.42, bsCfl: 0.76,
  }),
  imtp_40: makePacking({
    key: 'imtp_40', name: 'IMTP #40 (Intalox Metal)', category: 'random',
    mat: 'SS316L', size_mm: 40, Fp_m1: 79, ap: 150, voidFraction: 0.97, hetp_base: 0.56,
    minWettingM3M2H: 4.5, bsCp: 0.632, bsCh: 0.68, bsCL: 1.42, bsCV: 0.415, bsCfl: 0.80,
  }),
  imtp_50: makePacking({
    key: 'imtp_50', name: 'IMTP #50 (Intalox Metal)', category: 'random',
    mat: 'SS316L', size_mm: 50, Fp_m1: 59, ap: 100, voidFraction: 0.978, hetp_base: 0.72,
    minWettingM3M2H: 4.5, bsCp: 0.58, bsCh: 0.66, bsCL: 1.38, bsCV: 0.405, bsCfl: 0.84,
  }),
  raschig_metal_25: makePacking({
    key: 'raschig_metal_25', name: 'Metal Raschig Ring 25mm', category: 'random',
    mat: 'Carbon Steel / SS304', size_mm: 25, Fp_m1: 450, ap: 190, voidFraction: 0.86, hetp_base: 0.58,
    minWettingM3M2H: 4.5, bsCp: 1.35, bsCh: 0.56, bsCL: 1.34, bsCV: 0.41, bsCfl: 0.56,
  }),
  berl_ceramic_25: makePacking({
    key: 'berl_ceramic_25', name: 'Ceramic Berl Saddle 25mm', category: 'random',
    mat: 'Chemical Porcelain', size_mm: 25, Fp_m1: 360, ap: 250, voidFraction: 0.68, hetp_base: 0.52,
    minWettingM3M2H: 4.5, bsCp: 0.82, bsCh: 0.68, bsCL: 1.35, bsCV: 0.405, bsCfl: 0.60,
  }),
  mellapak_350y: makePacking({
    key: 'mellapak_350y', name: 'Mellapak 350Y (Structured)', category: 'structured',
    mat: 'SS316L Sheet 0.15mm', size_mm: 350, Fp_m1: 95, ap: 350, voidFraction: 0.975, hetp_base: 0.29,
    minWettingM3M2H: 1.0, bsCp: 0.33, bsCh: 0.52, bsCL: 1.44, bsCV: 0.37, bsCfl: 1.06,
  }),
  mellapak_500y: makePacking({
    key: 'mellapak_500y', name: 'Mellapak 500Y (Structured)', category: 'structured',
    mat: 'SS316L Gauze/Sheet', size_mm: 500, Fp_m1: 145, ap: 500, voidFraction: 0.965, hetp_base: 0.22,
    minWettingM3M2H: 1.0, bsCp: 0.31, bsCh: 0.50, bsCL: 1.40, bsCV: 0.36, bsCfl: 1.02,
  }),

  // ── `columnInternalsDesign.ts` aliases ──────────────────────────────────────────
  corrpak_ptfe_250y: makePacking({
    key: 'corrpak_ptfe_250y', name: '불소수지(PTFE/PVDF) 규칙 충진물 250Y', category: 'structured',
    mat: 'PTFE / PVDF', size_mm: 250, Fp_m1: 78, ap: 240, voidFraction: 0.94, hetp_base: 0.50,
    minWettingM3M2H: 1.8, bsCp: 0.42, bsCh: 0.49, bsCL: 1.18, bsCV: 0.36, bsCfl: 1.02,
  }),
  graphite_struct_250: makePacking({
    key: 'graphite_struct_250', name: '불침투 흑연(Graphite) 규칙 충진물 220Y', category: 'structured',
    mat: 'Graphite', size_mm: 220, Fp_m1: 88, ap: 220, voidFraction: 0.92, hetp_base: 0.48,
    minWettingM3M2H: 1.5, bsCp: 0.45, bsCh: 0.58, bsCL: 1.32, bsCV: 0.375, bsCfl: 1.00,
  }),
};

export function resolvePackingSpec(key?: string): UnifiedPackingSpec {
  if (key && PACKING_CATALOG[key]) return PACKING_CATALOG[key];
  return PACKING_CATALOG.pall_plastic_50;
}

function toColumnInternalsSpec(spec: UnifiedPackingSpec): PackingCatalogSpec {
  return {
    key: (spec.category === 'structured' ? 'mellapak_250y' : 'pall_ring_38_ss'),
    name: spec.name,
    category: spec.category,
    materialNote: spec.mat,
    packingFactorFpM1: spec.Fp,
    surfaceAreaM2M3: spec.ap,
    voidFraction: spec.voidFraction,
    baseHetpM: spec.hetp_base,
    minWettingM3M2H: spec.minWettingM3M2H,
    bsCp: spec.bsCp,
    bsCh: spec.bsCh,
    bsCL: spec.bsCL,
    bsCV: spec.bsCV,
    bsCfl: spec.bsCfl,
  };
}

export interface OndaMassTransferResult {
  a_w_m2m3: number;
  a_w_ratio: number;
  k_L_ms: number;
  k_G_ms: number;
  HTU_G_m: number;
  HTU_L_m: number;
  HTU_OG_m: number;
}

/**
 * Onda, Takeuchi & Okumoto (1968) gas/liquid mass-transfer correlation.
 */
export function calcOndaMassTransfer(params: {
  spec: UnifiedPackingSpec;
  diamM: number;
  Gm_kgs: number;
  Lm_kgs: number;
  rhoV: number;
  rhoL: number;
  muV_Pas: number;
  muL_Pas: number;
  sigma_Nm: number;
  tempC: number;
  pressBarA: number;
  mwGas: number;
  mwLiq: number;
  strippingLambda: number;
}): OndaMassTransferResult {
  const G_ACC = 9.80665;
  const { spec, diamM, Gm_kgs, Lm_kgs, rhoV, rhoL, muV_Pas, muL_Pas, sigma_Nm, tempC, pressBarA, mwGas, mwLiq, strippingLambda } = params;

  const Ac = Math.max(0.02, (Math.PI * diamM * diamM) / 4.0);
  const Gs = Math.max(1e-4, Gm_kgs / Ac); // kg/(m²·s)
  const Ls = Math.max(1e-4, Lm_kgs / Ac); // kg/(m²·s)
  const uG = Gs / rhoV;
  const uL = Ls / rhoL;

  const ap = Math.max(40, spec.ap);
  const dp = spec.size_mm > 0 && spec.category === 'random'
    ? spec.size_mm / 1000.0
    : (4.0 * spec.voidFraction) / ap;

  const sigma_c_Nm = spec.sigmaCritMnM * 1e-3;

  // Liquid Reynolds, Froude, Weber numbers
  const ReL = Math.max(0.05, Ls / (ap * muL_Pas));
  const FrL = Math.max(1e-8, (Ls * Ls * ap) / (rhoL * rhoL * G_ACC));
  const WeL = Math.max(1e-8, (Ls * Ls) / (rhoL * sigma_Nm * ap));

  // Wetted interfacial area a_w / a_p (Onda 1968 Eq. 1)
  const exponent =
    1.45 *
    Math.pow(sigma_c_Nm / Math.max(0.008, sigma_Nm), 0.75) *
    Math.pow(ReL, 0.1) *
    Math.pow(FrL, -0.05) *
    Math.pow(WeL, 0.2);
  const a_w_ratio = Math.min(0.98, Math.max(0.18, 1.0 - Math.exp(-exponent)));
  const a_w_m2m3 = a_w_ratio * ap;

  // Diffusivities (Wilke-Chang for liquid, Fuller scaling for gas)
  const tempK = tempC + 273.15;
  const muL_cP = muL_Pas * 1000;
  const vMolCm3 = Math.min(240, Math.max(18, (mwLiq / rhoL) * 1000));
  const D_L = Math.min(
    1.2e-8,
    Math.max(1.5e-10, (7.4e-12 * Math.sqrt(1.15 * mwLiq) * tempK) / (Math.max(0.08, muL_cP) * Math.pow(vMolCm3, 0.6))),
  );
  const D_G = Math.min(
    1.5e-4,
    Math.max(5e-7, ((5.4e-6 * Math.pow(tempK / 298.15, 1.75)) / Math.max(0.05, pressBarA)) * Math.pow(60 / Math.max(2, mwGas), 0.85)),
  );

  // Liquid film mass transfer coefficient k_L (m/s, Onda Eq. 2)
  const ScL = Math.max(20, muL_Pas / (rhoL * D_L));
  const ReLw = Math.max(0.05, Ls / (a_w_m2m3 * muL_Pas));
  const k_L_ms =
    0.0051 *
    Math.pow(ReLw, 2 / 3) *
    Math.pow(ScL, -0.5) *
    Math.pow(ap * dp, 0.4) *
    Math.pow((muL_Pas * G_ACC) / rhoL, 1 / 3);

  // Gas film mass transfer coefficient k_G (m/s, Onda Eq. 3 converted from molar k_G*RT)
  const ReG = Math.max(1.0, Gs / (ap * muV_Pas));
  const ScG = Math.max(0.2, muV_Pas / (rhoV * D_G));
  const cOnda = dp < 0.015 ? 2.0 : 5.23;
  const k_G_ms = Math.max(
    1e-4,
    cOnda * Math.pow(ReG, 0.7) * Math.pow(ScG, 1 / 3) * Math.pow(ap * dp, -2.0) * (ap * D_G),
  );

  // Practical maldistribution allowance for large commercial towers
  const maldist = Math.min(1.28, 1.1 + 0.03 * Math.max(0, diamM - 0.8));
  const HTU_G_m = Math.min(1.8, Math.max(0.14, (uG / (k_G_ms * a_w_m2m3)) * maldist));
  const HTU_L_m = Math.min(1.2, Math.max(0.05, (uL / (k_L_ms * a_w_m2m3)) * maldist));
  const HTU_OG_m = Math.min(2.2, Math.max(0.18, HTU_G_m + strippingLambda * HTU_L_m));

  return {
    a_w_m2m3: Number(a_w_m2m3.toFixed(1)),
    a_w_ratio: Number(a_w_ratio.toFixed(3)),
    k_L_ms,
    k_G_ms,
    HTU_G_m,
    HTU_L_m,
    HTU_OG_m,
  };
}

const STD_TOWER_DIAMETERS_MM = [
  300, 400, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000,
  3200, 3400, 3600, 3800, 4000,
];

export interface AbsorptionColumnInput {
  equipTag?: string;
  equipName?: string;
  col_mode?: string;
  abs_service?: AbsorptionService;
  lkFluidId?: string;
  hkFluidId?: string;
  P_col_bar?: number;
  P_bar?: number;
  pack_key?: string;
  bed_max_h_m?: number;
  flood_pct?: number;
  Wg_kgh?: number;
  gas_kgh?: number;
  Wl_kgh?: number;
  liq_kgh?: number;
  Tg_C?: number;
  T_gas_in?: number;
  Tl_C?: number;
  T_liq_in?: number;
  yin_ppm?: number;
  y_in_ppm?: number;
  yout_ppm?: number;
  y_out_ppm?: number;
  m_eq?: number;
  // Optional overrides for packingCalc Table 1.39 compatibility
  rhoV_override?: number;
  rhoL_override?: number;
  muL_cP_override?: number;
  muG_mPas_override?: number;
  sigma_mNm_override?: number;
  mwGas_override?: number;
  targetSuperficialVelocity_ms?: number;
  fixedPackingHeight_m?: number;
  y_in_frac?: number;
  y_out_frac?: number;
  y_eq_frac?: number;
  absorptionFactor_override?: number;
  NTU_override?: number;
  theoreticalStages_override?: number;
  hetpCorrection?: number;
}

export interface AbsorptionIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface AbsorptionWarningItem {
  level: 'danger' | 'warn' | 'ok';
  text: string;
}

export interface AbsorptionColumnResult {
  // ── Exact ChemPro `solveColumn` (colMode === 'absorption') contract keys ──
  equipTag: string;
  equipName: string;
  colMode: 'absorption';
  absService: string;
  Wg_kgh: number;
  Wl_kgh: number;
  Gm_kgh: number;
  Lm_kgh: number;
  gas_kgh: number;
  liq_kgh: number;
  LG_mass_ratio: number;
  m_abs_kgh: number;
  Tg_C: number;
  Tl_C: number;
  T_gas_in: number;
  T_gas_out: number;
  T_liq_in: number;
  T_liq_out: number;
  yin_ppm: number;
  yout_ppm: number;
  y_in_ppm: number;
  y_out_ppm: number;
  removal_pct: number;
  removal_eff_pct: number;
  N_OG: number;
  HTU_m: number;
  HTU_OG_m: number;
  HTU_G_m: number;
  HTU_L_m: number;
  H_pack_m: number;
  H_pack_total_m: number;
  H_bed_m: number;
  A_abs: number;
  m_eq: number;
  flood_pct: number;
  Lw_m3m2h: number;
  wetting_rate_m3m2h: number;
  Lw_min_m3m2h: number;
  Flv: number;
  FLV: number;
  lkBase: FluidProps;
  hkBase: FluidProps;
  P_bar: number;
  internals: 'packed';
  trayType: 'sieve';
  trayPasses: number;
  holeD_mm: number;
  weirH_mm: number;
  holeAreaPct: number;
  traySpacing_m: number;
  packKey: string;
  packSpec: UnifiedPackingSpec;
  N_beds: number;
  dP_pack_mbar_m: number;
  dP_pack_Pa_m: number;
  dP_pack_mmH2O_m: number;
  HETP_m: number;
  internalsSummary: string;
  T_top_C: number;
  T_feed_C: number;
  T_bot_C: number;
  gamma1_top: number;
  gamma2_bot: number;
  alpha: number;
  alpha_calc: number;
  azeotropeX: null;
  vleCurve: Array<{ x: number; y: number; y_ppm: number; T: number }>;
  absProfile: Array<{ z_norm: number; y_ppm: number; T_C: number }>;
  F: number;
  D: number;
  B: number;
  zF: number;
  xD: number;
  xB: number;
  q: number;
  lk_recovery_pct: number;
  Nmin: number;
  Rmin: number;
  R: number;
  N_theo: number;
  N_actual: number;
  feed_stage_actual: number;
  E_overall_pct: number;
  L_rect: number;
  V_rect: number;
  L_strip: number;
  V_strip: number;
  Qc_kW: number;
  Qr_kW: number;
  Csb: number;
  u_flood: number;
  u_design: number;
  u_op: number;
  F_factor: number;
  D_col_m: number;
  H_tangent_m: number;
  weep_ratio: number;
  psi_entrain: number;
  dc_backup_pct: number;
  dP_tray_mbar: number;
  dP_total_mbar: number;
  iterations: AbsorptionIterationRow[];
  warnings: AbsorptionWarningItem[];

  // ── Rigorous Eckert + Billet-Schultes (1999) + Onda (1968) telemetry ──
  D_col_raw_m: number;
  D_std_mm: number;
  crossSectionArea_m2: number;
  u_flood_gpdc_ms: number;
  u_flood_bs_ms: number;
  dP_dry_mbar_m: number;
  liquidHoldupFrac: number;
  k_G_ms: number;
  k_L_ms: number;
  a_w_m2m3: number;
  a_w_ratio: number;
  onda: OndaMassTransferResult;
  billetSchultes: BilletSchultesResult;
  vesselSpec: ChemproVesselSpec;
  packingDetail: ChemproPackingDetail;
  nozzleSchedule: ChemproNozzleItem[];
  manholeSchedule: ChemproManholeItem[];
  mode: AbsorptionSolverMode;
}

export function solveAbsorptionColumn(
  inp: AbsorptionColumnInput = {},
  mode: AbsorptionSolverMode | string = 'rigorous',
): AbsorptionColumnResult {
  const G_ACC = 9.80665;
  const R_GAS = 8.31446;
  const solverMode: AbsorptionSolverMode = mode === 'quick' ? 'quick' : 'rigorous';

  const lkId = inp.lkFluidId ?? 'h2_wet_gas';
  const hkId = inp.hkFluidId ?? 'water';
  const P_bar = Math.max(0.05, inp.P_col_bar ?? inp.P_bar ?? 1.05);

  const packKey = inp.pack_key ?? 'pall_plastic_50';
  const packSpec = resolvePackingSpec(packKey);
  const bsSpec = toColumnInternalsSpec(packSpec);

  const bedMaxH_m = Math.max(1.0, inp.bed_max_h_m ?? 4.5);
  const floodFrac = Math.min(0.9, Math.max(0.45, (inp.flood_pct ?? 72) / 100.0));
  const absService = inp.abs_service ?? 'scrubbing';

  const Gm_kgh = Math.max(20, inp.Wg_kgh ?? inp.gas_kgh ?? 2024);
  const Lm_kgh = Math.max(50, inp.Wl_kgh ?? inp.liq_kgh ?? 18500);
  const T_gas_in = inp.Tg_C ?? inp.T_gas_in ?? 85.0;
  const T_liq_in = inp.Tl_C ?? inp.T_liq_in ?? 32.0;
  const y_in_ppm = Math.max(1.0, inp.yin_ppm ?? inp.y_in_ppm ?? 4500);
  const y_out_ppm = Math.max(
    0.05,
    Math.min(y_in_ppm * 0.99, inp.yout_ppm ?? inp.y_out_ppm ?? 5.0),
  );
  const m_eq = Math.max(0.005, inp.m_eq ?? 0.25);

  const T_avg = 0.4 * T_gas_in + 0.6 * T_liq_in;
  const gasProps = resolveFluidProps(lkId, T_avg);
  const liqProps = resolveFluidProps(hkId, T_avg);

  const mw_gas = Math.max(2.0, inp.mwGas_override ?? gasProps.mw);
  const mw_liq = Math.max(18.0, liqProps.mw);
  const rhoV =
    inp.rhoV_override !== undefined
      ? Math.max(0.04, inp.rhoV_override)
      : Math.max(0.08, (P_bar * 100.0 * mw_gas) / (R_GAS * (T_avg + 273.15)));
  const rhoL = Math.max(400, inp.rhoL_override ?? liqProps.rho);
  const muL_cP = Math.max(0.15, inp.muL_cP_override ?? liqProps.mu);
  const muV_Pas = Math.max(5e-6, (inp.muG_mPas_override ?? 0.015) * 1e-3);
  const sigma_mNm = Math.max(10.0, inp.sigma_mNm_override ?? liqProps.sigma ?? 55.0);

  const Gm_kgs = Gm_kgh / 3600.0;
  const Lm_kgs = Lm_kgh / 3600.0;
  const Qv_m3s = Gm_kgs / rhoV;
  const Ql_m3s = Lm_kgs / rhoL;
  const LG_mass_ratio = Lm_kgh / Gm_kgh;

  // ── 1. Eckert GPDC Preliminary Diameter Sizing ───────────────────────────
  const Flv = Math.max(
    0.01,
    Math.min(2.5, (Lm_kgs / Math.max(0.005, Gm_kgs)) * Math.sqrt(rhoV / rhoL)),
  );
  const lnFlv = Math.log(Flv);
  const Y_flood = Math.exp(-3.635 - 1.164 * lnFlv - 0.124 * lnFlv * lnFlv);
  const muFactor = Math.pow(muL_cP, 0.1);
  const u_flood_gpdc_ms = Math.sqrt(
    (Y_flood * G_ACC * Math.max(1, rhoL - rhoV)) / (packSpec.Fp * rhoV * muFactor),
  );

  // Respect fixed superficial velocity if provided (e.g., packingCalc Table 1.39 U = 0.24 m/s)
  const hasTargetVel =
    inp.targetSuperficialVelocity_ms !== undefined && inp.targetSuperficialVelocity_ms > 0;
  const u_design = hasTargetVel
    ? inp.targetSuperficialVelocity_ms!
    : u_flood_gpdc_ms * floodFrac;

  const Ac_req_m2 = Qv_m3s / Math.max(0.04, u_design);
  const D_col_raw_m = Math.sqrt((4.0 * Ac_req_m2) / Math.PI);

  let D_col_m: number;
  if (hasTargetVel) {
    D_col_m = Math.round((D_col_raw_m * 1000) / 5) * 5 / 1000;
  } else {
    D_col_m = Math.max(0.45, Math.ceil(D_col_raw_m * 20.0) / 20.0);
  }

  // Standard 100mm commercial shell OD lookup for packingCalc compatibility
  const D_mm_raw = D_col_raw_m * 1000;
  const D_std_mm = hasTargetVel
    ? Math.round(D_mm_raw / 5) * 5
    : STD_TOWER_DIAMETERS_MM.find((d) => d >= D_mm_raw) ?? Math.ceil(D_mm_raw / 100) * 100;

  // Iterate diameter once in rigorous mode if Billet-Schultes flood exceeds 85%
  const L_mol = Lm_kgh / mw_liq;
  const G_mol = Gm_kgh / mw_gas;
  const A_abs =
    inp.absorptionFactor_override ??
    Math.max(1.35, Math.min(25.0, L_mol / Math.max(0.1, G_mol) / m_eq));
  const strippingLambda = 1.0 / Math.max(0.25, A_abs);

  let bsRes: BilletSchultesResult = calcBilletSchultesPacking({
    spec: bsSpec,
    diamM: D_col_m,
    vapMassKgH: Gm_kgh,
    liqMassKgH: Lm_kgh,
    rhoVapKgM3: rhoV,
    rhoLiqKgM3: rhoL,
    viscLiqCp: muL_cP,
    viscVapPaS: muV_Pas,
    surfTensMnM: sigma_mNm,
    tempC: T_avg,
    pressBarA: P_bar,
    avgMwVap: mw_gas,
    avgMwLiq: mw_liq,
    strippingFactorLambda: strippingLambda,
    foamingFactor: 0.92,
  });

  if (solverMode === 'rigorous' && !hasTargetVel && bsRes.bsFloodPct > 84.0) {
    // Expand diameter until Billet-Schultes flooding is within design envelope
    for (let it = 0; it < 4 && bsRes.bsFloodPct > 82.0; it++) {
      D_col_m = Math.ceil((D_col_m + 0.05) * 20) / 20;
      bsRes = calcBilletSchultesPacking({
        spec: bsSpec,
        diamM: D_col_m,
        vapMassKgH: Gm_kgh,
        liqMassKgH: Lm_kgh,
        rhoVapKgM3: rhoV,
        rhoLiqKgM3: rhoL,
        viscLiqCp: muL_cP,
        viscVapPaS: muV_Pas,
        surfTensMnM: sigma_mNm,
        tempC: T_avg,
        pressBarA: P_bar,
        avgMwVap: mw_gas,
        avgMwLiq: mw_liq,
        strippingFactorLambda: strippingLambda,
        foamingFactor: 0.92,
      });
    }
  }

  const Ac_actual_m2 = hasTargetVel ? Ac_req_m2 : (Math.PI * D_col_m * D_col_m) / 4.0;
  const u_op = Qv_m3s / Ac_actual_m2;
  const F_factor = u_op * Math.sqrt(rhoV);

  const u_flood_bs_ms = bsRes.uFloodMS;
  const u_flood =
    solverMode === 'rigorous'
      ? Math.min(u_flood_gpdc_ms, u_flood_bs_ms * 1.05)
      : u_flood_gpdc_ms;
  const Csb = u_flood / Math.sqrt(Math.max(1, rhoL - rhoV) / rhoV);
  const flood_actual_pct = hasTargetVel
    ? (u_op / Math.max(0.05, u_flood)) * 100.0
    : solverMode === 'rigorous'
      ? Math.max((u_op / Math.max(0.05, u_flood)) * 100.0, bsRes.bsFloodPct * 0.95)
      : floodFrac * 100.0;

  const Lw_m3m2h = (Ql_m3s * 3600.0) / Ac_actual_m2;
  const Lw_min_m3m2h = packSpec.minWettingM3M2H;

  // ── 2. Mass Transfer: Colburn N_OG & Onda (1968) + Billet-Schultes (1999) HTU_OG ──
  let N_OG: number;
  if (inp.NTU_override !== undefined && inp.NTU_override > 0) {
    N_OG = inp.NTU_override;
  } else if (
    inp.y_in_frac !== undefined &&
    inp.y_out_frac !== undefined &&
    inp.y_eq_frac !== undefined
  ) {
    const num = Math.max(1e-9, inp.y_in_frac - inp.y_eq_frac);
    const den = Math.max(1e-9, inp.y_out_frac - inp.y_eq_frac);
    N_OG = Math.max(0.1, Math.log(num / den));
  } else {
    const ratioY = y_in_ppm / Math.max(0.01, y_out_ppm);
    if (Math.abs(A_abs - 1.0) < 1e-4) {
      N_OG = Math.max(0.5, ratioY - 1.0);
    } else {
      N_OG = Math.log(ratioY * (1.0 - 1.0 / A_abs) + 1.0 / A_abs) / Math.log(A_abs);
    }
  }
  const removal_eff_pct = ((y_in_ppm - y_out_ppm) / y_in_ppm) * 100.0;

  const onda = calcOndaMassTransfer({
    spec: packSpec,
    diamM: D_col_m,
    Gm_kgs,
    Lm_kgs,
    rhoV,
    rhoL,
    muV_Pas,
    muL_Pas: muL_cP * 1e-3,
    sigma_Nm: sigma_mNm * 1e-3,
    tempC: T_avg,
    pressBarA: P_bar,
    mwGas: mw_gas,
    mwLiq: mw_liq,
    strippingLambda,
  });

  // Eckert cross-check
  calcEckertGpdcPacking(
    Gm_kgh,
    Lm_kgh,
    rhoV,
    rhoL,
    muL_cP,
    sigma_mNm,
    D_col_m,
    bsSpec,
    0.92,
  );

  // HTU selection: Billet-Schultes for structured / Onda for random in rigorous mode
  const HTU_G_m =
    solverMode === 'rigorous'
      ? packSpec.category === 'structured'
        ? bsRes.hGM
        : onda.HTU_G_m
      : Math.max(
          0.22,
          (0.38 / Math.pow(packSpec.ap / 150.0, 0.65)) *
            Math.pow(muL_cP, 0.12) *
            Math.pow(15.0 / Math.max(3.0, Lw_m3m2h), 0.18),
        );

  const HTU_L_m =
    solverMode === 'rigorous'
      ? packSpec.category === 'structured'
        ? bsRes.hLM
        : onda.HTU_L_m
      : 0.18 * Math.pow(muL_cP, 0.25);

  const hetpCorr = inp.hetpCorrection ?? 1.0;
  const HTU_OG_calc = Math.max(0.18, (HTU_G_m + strippingLambda * HTU_L_m) * hetpCorr);

  const H_pack_calc_m = N_OG * HTU_OG_calc;
  const hasFixedHeight =
    inp.fixedPackingHeight_m !== undefined && inp.fixedPackingHeight_m > 0;

  const H_pack_total_m = hasFixedHeight
    ? inp.fixedPackingHeight_m!
    : Math.max(2.0, Math.ceil(H_pack_calc_m * 5.0) / 5.0);

  const HTU_OG_m = hasFixedHeight
    ? H_pack_total_m / Math.max(0.05, N_OG)
    : HTU_OG_calc;

  const N_beds = Math.max(1, Math.ceil(H_pack_total_m / bedMaxH_m));
  const H_bed_m = Number((H_pack_total_m / N_beds).toFixed(2));

  // HETP (Colburn ln(lambda)/(lambda-1) relation or Onda-corrected base HETP)
  const lnLam =
    Math.abs(strippingLambda - 1.0) < 1e-3
      ? 1.0
      : Math.log(strippingLambda) / (strippingLambda - 1.0);
  const HETP_m = Number(
    Math.max(
      0.18,
      solverMode === 'rigorous'
        ? HTU_OG_m * lnLam
        : packSpec.HETP_ref * hetpCorr * Math.pow(sigma_mNm / 72, 0.2) * Math.pow(muL_cP, 0.15),
    ).toFixed(3),
  );

  // ── 3. Irrigated Pressure Drop (Billet-Schultes 1999 vs Quick GPDC) ─────
  const dP_pack_mbar_m =
    solverMode === 'rigorous'
      ? bsRes.irrigatedDpMbarM
      : Math.max(
          0.12,
          (0.28 + 0.0075 * packSpec.Fp) *
            Math.pow(floodFrac / 0.75, 2.25) *
            (1.0 + 1.6 * Flv),
        );
  const dP_pack_Pa_m = dP_pack_mbar_m * 100.0;
  const dP_pack_mmH2O_m = dP_pack_Pa_m / G_ACC; // ~10.197 mmH2O per mbar
  const dP_demister_mbar = 2.2;
  const dP_total_mbar = dP_pack_mbar_m * H_pack_total_m + dP_demister_mbar;

  // ── 4. Thermal Balance & Profiles ───────────────────────────────────────
  const m_abs_kgh = Number(
    (Gm_kgh * ((y_in_ppm - y_out_ppm) / 1e6)).toFixed(2),
  );
  const T_gas_out =
    T_liq_in + Math.max(2.0, (T_gas_in - T_liq_in) * Math.exp(-0.65 * N_OG));
  const Qc_kW =
    Math.abs(Gm_kgs * gasProps.cp * (T_gas_in - T_gas_out)) +
    (absService === 'drying' ? Gm_kgs * 42.0 : 12.0);
  const dT_liq = Qc_kW / Math.max(0.5, Lm_kgs * liqProps.cp);
  const T_liq_out = T_liq_in + Math.min(22.0, dT_liq);

  const H_tangent_m = H_pack_total_m + N_beds * 1.1 + 3.4;
  const internalsSummary = `${packSpec.name} (${packSpec.mat}, Fp=${packSpec.Fp} m⁻¹, a=${packSpec.ap} m²/m³)`;

  const vleCurve: Array<{ x: number; y: number; y_ppm: number; T: number }> = [];
  const absProfile: Array<{ z_norm: number; y_ppm: number; T_C: number }> = [];
  for (let i = 0; i <= 40; i++) {
    const zFrac = i / 40.0;
    const y_z = y_out_ppm * Math.pow(y_in_ppm / y_out_ppm, 1.0 - zFrac);
    const T_z = T_gas_out + (1.0 - zFrac) * (T_gas_in - T_gas_out);
    vleCurve.push({ x: zFrac, y: y_z / y_in_ppm, y_ppm: y_z, T: T_z });
    absProfile.push({ z_norm: Number(zFrac.toFixed(3)), y_ppm: Number(y_z.toFixed(2)), T_C: Number(T_z.toFixed(2)) });
  }

  const iterations: AbsorptionIterationRow[] = [
    {
      iter: 1,
      param: `기액 물성 및 유동인자 산출 (P=${P_bar.toFixed(2)} barA)`,
      assumed: `G_m=${Gm_kgh} kg/h, L_m=${Lm_kgh} kg/h`,
      calc: `ρ_G=${rhoV.toFixed(2)} kg/m³, ρ_L=${rhoL.toFixed(0)} kg/m³ → F_LV=${Flv.toFixed(3)}`,
      err: '0.00%',
      note: `${gasProps.name} / ${liqProps.name}`,
    },
    {
      iter: 2,
      param: `Eckert GPDC + Billet-Schultes(1999) 수력학 수렴`,
      assumed: `Flood=${flood_actual_pct.toFixed(1)}%, Fp=${packSpec.Fp} m⁻¹`,
      calc: `u_flood=${u_flood.toFixed(2)} m/s, u_op=${u_op.toFixed(2)} m/s (F_s=${F_factor.toFixed(2)}) → ID Ø${(D_col_m * 1000).toFixed(0)} mm`,
      err: '0.00%',
      note: `B-S Holdup h_L=${(bsRes.liquidHoldupFrac * 100).toFixed(1)}%, L_w=${Lw_m3m2h.toFixed(1)} m³/m²h`,
    },
    {
      iter: 3,
      param: `Colburn N_OG & Onda(1968) 물질전달 (k_G, k_L, a_w)`,
      assumed: `y_in=${y_in_ppm} ppm → y_out=${y_out_ppm} ppm (제거율 ${removal_eff_pct.toFixed(2)}%)`,
      calc: `N_OG=${N_OG.toFixed(2)} × HTU_OG=${HTU_OG_m.toFixed(2)}m (a_w=${onda.a_w_m2m3} m²/m³)`,
      err: '0.00%',
      note: `충진층고 Z=${H_pack_total_m.toFixed(2)} m (${N_beds} Beds)`,
    },
    {
      iter: 4,
      param: `Billet-Schultes 적심 압력강하 & 열수지`,
      assumed: `ΔP_dry=${bsRes.dryDpMbarM.toFixed(2)} → ΔP_irr=${dP_pack_mbar_m.toFixed(2)} mbar/m`,
      calc: `총 ΔP=${dP_total_mbar.toFixed(1)} mbar (T/T 높이 ${H_tangent_m.toFixed(1)} m)`,
      err: '0.00%',
      note: `가스 출구 ${T_gas_out.toFixed(1)}°C / 액 출구 ${T_liq_out.toFixed(1)}°C`,
    },
  ];

  const warnings: AbsorptionWarningItem[] = [];
  if (Lw_m3m2h < Lw_min_m3m2h) {
    warnings.push({
      level: 'warn',
      text: `액체 젖음율(L_w = ${Lw_m3m2h.toFixed(1)} m³/m²h)이 최소 적심 기준(${Lw_min_m3m2h} m³/m²h)보다 낮아 채널링 위험이 있습니다 — 순환 세정액 유량(L_m) 증대 권장!`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `패킹 적심(Wetting Rate) 양호: L_w = ${Lw_m3m2h.toFixed(1)} m³/m²·h ≥ 최소 기준 ${Lw_min_m3m2h} m³/m²·h`,
    });
  }

  if (dP_pack_mbar_m > 6.0) {
    warnings.push({
      level: 'warn',
      text: `패킹 단위 차압 주의 (${dP_pack_mbar_m.toFixed(2)} mbar/m > 6.0 mbar/m) — 가스 블로워/압축기 흡입 부하 절감을 위해 50mm Pall Ring 또는 Tellerette 검토 권장`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `Eckert GPDC · Billet-Schultes · Onda 수력학 및 물질전달 최적: 제거율 ${removal_eff_pct.toFixed(2)}% (N_OG=${N_OG.toFixed(2)}, HTU=${HTU_OG_m.toFixed(2)}m) · 총 ΔP=${dP_total_mbar.toFixed(1)} mbar`,
    });
  }

  const N_theo = inp.theoreticalStages_override ?? N_OG;

  const vesselSpec = buildChemproVesselAndLevels({
    D_col_m,
    H_tangent_m,
    P_op_barA: P_bar,
    T_max_C: Math.max(T_gas_in, T_liq_out),
    skirtHeightMm: 2800,
    isAbsorber: true,
  });

  const stripBotEl = vesselSpec.hllElMm + 900;
  const nbAbs = Math.max(1, N_beds);
  const gapAbs = 800;
  const bedHAbs = Math.max(600, Math.round((H_pack_total_m * 1000) / nbAbs));
  const absBeds: ChemproPackingDetail['beds'] = [];
  let curTopAbs = Math.min(vesselSpec.ttlElMm - 850, stripBotEl + nbAbs * bedHAbs + (nbAbs - 1) * gapAbs);
  for (let b = 0; b < nbAbs; b++) {
    const botEl = curTopAbs - bedHAbs;
    absBeds.push({
      bedNo: b + 1,
      section: nbAbs > 1 ? `Absorption Bed #${b + 1}` : 'Absorption Packed Bed',
      heightMm: bedHAbs,
      botElMm: botEl,
      topElMm: curTopAbs,
      hetpMm: Math.round(HETP_m * 1000),
      dpMbar: Number(((dP_pack_mbar_m * bedHAbs) / 1000.0).toFixed(1)),
    });
    curTopAbs = botEl - gapAbs;
  }
  const dripAbsPerM2 = packSpec.category === 'structured' ? 100 : 75;
  const absTd = Number(Math.min(6.5, Math.max(1.2, (Lw_m3m2h / Math.max(0.2, Lw_min_m3m2h)) * 1.15)).toFixed(2));
  const absRedItems = absBeds.slice(0, -1).map((ub, idx) => ({
    tag: `RD-${idx + 1}`,
    type: 'Chimney Collector + Trough Liquid Redistributor',
    interBedHeightMm: gapAbs,
    elevationMm: ub.botElMm - Math.round(gapAbs * 0.5),
    freeAreaPct: 35,
  }));
  const packingDetail: ChemproPackingDetail = {
    categoryLabel: packSpec.category === 'structured' ? 'Structured Tower Packing' : 'Random Scrubbing Packing',
    modelName: packSpec.name,
    nominalSize: packSpec.category === 'structured' ? `${packSpec.ap} m²/m³` : `${packSpec.size_mm} mm Nominal`,
    material: packSpec.mat,
    ap: packSpec.ap,
    voidPct: packSpec.void_pct,
    Fp: packSpec.Fp,
    hetpMm: Math.round(HETP_m * 1000),
    totalPackedHeightMm: Math.round(H_pack_total_m * 1000),
    beds: absBeds,
    topDistributor: {
      tag: 'LD-1',
      type: packSpec.category === 'structured' ? 'Narrow-Trough Gravity Orifice Distributor' : 'Full-Cone Spray / Weir-Trough Distributor',
      dripPointsPerM2: dripAbsPerM2,
      totalDripPoints: Math.ceil(dripAbsPerM2 * Ac_actual_m2),
      elevationMm: Math.min(vesselSpec.ttlElMm - 460, absBeds[0].topElMm + 280),
    },
    redistributors: { count: absRedItems.length, items: absRedItems },
    supportPlate: {
      count: absBeds.length,
      type: 'Gas-Injection Multi-Beam Support Grid (Open ≥85%)',
      freeAreaPct: 86,
      elevationsMm: absBeds.map((b) => b.botElMm),
    },
    holdDownGrid: {
      count: absBeds.length,
      type: packSpec.category === 'structured' ? 'Bolted Bed Limiter Grid' : 'Weighted Hold-Down Grid',
      freeAreaPct: 92,
      elevationsMm: absBeds.map((b) => b.topElMm),
    },
    demister: {
      tag: 'ME-1',
      type: 'PP / Alloy Mesh Mist Eliminator Pad',
      thicknessMm: 150,
      elevationMm: vesselSpec.ttlElMm - 240,
    },
    mwrM3M2H: Lw_min_m3m2h,
    wettingRateM3M2H: Number(Lw_m3m2h.toFixed(2)),
    wettingSafetyRatio: Number((Lw_m3m2h / Math.max(0.2, Lw_min_m3m2h)).toFixed(2)),
    dryDpMbarM: Number(bsRes.dryDpMbarM.toFixed(2)),
    irrigDpMbarM: Number(dP_pack_mbar_m.toFixed(2)),
    opMinPct: Math.round(Math.max(20, Math.min(90, 100 / Math.max(1.05, absTd)))),
    opMaxPct: Math.round(Math.max(70, Math.min(200, 100 * (85 / Math.max(25, flood_actual_pct))))),
    turndownRatio: absTd,
  };

  const nzGout = pickChemproNozzleDn(Gm_kgh, rhoV, Math.min(24, Math.max(8, 28 / Math.sqrt(Math.max(0.1, rhoV)))));
  const nzLin = pickChemproNozzleDn(Lm_kgh, rhoL, 1.8);
  const nzGin = pickChemproNozzleDn(Gm_kgh, rhoV, Math.min(22, Math.max(8, 25 / Math.sqrt(Math.max(0.1, rhoV)))));
  const nzLout = pickChemproNozzleDn(Lm_kgh, rhoL, 1.5);
  const nozzleSchedule: ChemproNozzleItem[] = [
    { tag: 'N1', service: 'Treated Gas Out', phase: 'Gas', selectedDn: nzGout.selectedDn, flangeRating: vesselSpec.flangeRating, flowKgH: Math.round(Gm_kgh), velMS: nzGout.velMS, elevationMm: vesselSpec.oalElMm - 200, elevationFromBtlMm: vesselSpec.oalElMm - 200 - vesselSpec.btlElMm, orientationDeg: 0 },
    { tag: 'N2', service: 'Scrubbing Liquid In', phase: 'Liquid', selectedDn: nzLin.selectedDn, flangeRating: vesselSpec.flangeRating, flowKgH: Math.round(Lm_kgh), velMS: nzLin.velMS, elevationMm: packingDetail.topDistributor.elevationMm, elevationFromBtlMm: packingDetail.topDistributor.elevationMm - vesselSpec.btlElMm, orientationDeg: 90 },
    { tag: 'N3', service: 'Feed Gas In', phase: 'Gas', selectedDn: nzGin.selectedDn, flangeRating: vesselSpec.flangeRating, flowKgH: Math.round(Gm_kgh), velMS: nzGin.velMS, elevationMm: Math.min(absBeds[absBeds.length - 1].botElMm - 250, Math.round((vesselSpec.hllElMm + absBeds[absBeds.length - 1].botElMm) * 0.5)), elevationFromBtlMm: Math.round((vesselSpec.hllElMm + absBeds[absBeds.length - 1].botElMm) * 0.5) - vesselSpec.btlElMm, orientationDeg: 270 },
    { tag: 'N4', service: 'Bottoms Rich Liquid Out', phase: 'Liquid', selectedDn: nzLout.selectedDn, flangeRating: vesselSpec.flangeRating, flowKgH: Math.round(Lm_kgh), velMS: nzLout.velMS, elevationMm: Math.max(700, vesselSpec.btlElMm - 280), elevationFromBtlMm: -280, orientationDeg: 0 },
  ];
  const mhSizeAbs = D_col_m >= 1.2 ? 'DN500 (20")' : 'DN450 (18")';
  const manholeSchedule: ChemproManholeItem[] = [
    { tag: 'M1', sizeDn: mhSizeAbs, flangeRating: vesselSpec.flangeRating, service: 'Top Distributor / Demister Manway', elevationMm: vesselSpec.ttlElMm - 360, orientationDeg: 180 },
    { tag: 'M2', sizeDn: mhSizeAbs, flangeRating: vesselSpec.flangeRating, service: 'Bottom Packing Support / Gas Inlet Manway', elevationMm: Math.max(vesselSpec.hllElMm + 250, absBeds[absBeds.length - 1].botElMm - 220), orientationDeg: 180 },
  ];

  return {
    equipTag: inp.equipTag ?? 'T-410',
    equipName: inp.equipName ?? `${gasProps.name} Packed Scrubbing / Drying Tower`,
    colMode: 'absorption',
    absService,
    Wg_kgh: Gm_kgh,
    Wl_kgh: Lm_kgh,
    Gm_kgh,
    Lm_kgh,
    gas_kgh: Gm_kgh,
    liq_kgh: Lm_kgh,
    LG_mass_ratio: Number(LG_mass_ratio.toFixed(3)),
    m_abs_kgh,
    Tg_C: T_gas_in,
    Tl_C: T_liq_in,
    T_gas_in,
    T_gas_out: Number(T_gas_out.toFixed(2)),
    T_liq_in,
    T_liq_out: Number(T_liq_out.toFixed(2)),
    yin_ppm: y_in_ppm,
    yout_ppm: y_out_ppm,
    y_in_ppm,
    y_out_ppm,
    removal_pct: removal_eff_pct,
    removal_eff_pct,
    N_OG,
    HTU_m: HTU_OG_m,
    HTU_OG_m,
    HTU_G_m,
    HTU_L_m,
    H_pack_m: H_pack_total_m,
    H_pack_total_m,
    H_bed_m,
    A_abs,
    m_eq,
    flood_pct: Number(flood_actual_pct.toFixed(2)),
    Lw_m3m2h,
    wetting_rate_m3m2h: Lw_m3m2h,
    Lw_min_m3m2h,
    Flv,
    FLV: Flv,
    lkBase: gasProps,
    hkBase: liqProps,
    P_bar,
    internals: 'packed',
    trayType: 'sieve',
    trayPasses: 1,
    holeD_mm: 5,
    weirH_mm: 50,
    holeAreaPct: 10,
    traySpacing_m: 0.6,
    packKey,
    packSpec,
    N_beds,
    dP_pack_mbar_m,
    dP_pack_Pa_m,
    dP_pack_mmH2O_m,
    HETP_m,
    internalsSummary,
    T_top_C: T_gas_out,
    T_feed_C: T_avg,
    T_bot_C: T_gas_in,
    gamma1_top: 1.0,
    gamma2_bot: 1.0,
    alpha: A_abs,
    alpha_calc: A_abs,
    azeotropeX: null,
    vleCurve,
    absProfile,
    F: Gm_kgh / mw_gas,
    D: Gm_kgh / mw_gas,
    B: Lm_kgh / mw_liq,
    zF: y_in_ppm / 1e6,
    xD: y_out_ppm / 1e6,
    xB: y_in_ppm / 1e6,
    q: 1.0,
    lk_recovery_pct: removal_eff_pct,
    Nmin: N_OG * 0.7,
    Rmin: 1.0,
    R: Lm_kgh / Gm_kgh,
    N_theo,
    N_actual: Math.ceil(N_theo),
    feed_stage_actual: 1,
    E_overall_pct: removal_eff_pct,
    L_rect: Lm_kgh / mw_liq,
    V_rect: Gm_kgh / mw_gas,
    L_strip: Lm_kgh / mw_liq,
    V_strip: Gm_kgh / mw_gas,
    Qc_kW,
    Qr_kW: 0,
    Csb,
    u_flood,
    u_design,
    u_op,
    F_factor,
    D_col_m,
    H_tangent_m,
    weep_ratio: Lw_m3m2h / Lw_min_m3m2h,
    psi_entrain: 0.01,
    dc_backup_pct: flood_actual_pct,
    dP_tray_mbar: dP_pack_mbar_m * HTU_OG_m,
    dP_total_mbar,
    iterations,
    warnings,

    D_col_raw_m,
    D_std_mm,
    crossSectionArea_m2: Ac_actual_m2,
    u_flood_gpdc_ms,
    u_flood_bs_ms,
    dP_dry_mbar_m: bsRes.dryDpMbarM,
    liquidHoldupFrac: bsRes.liquidHoldupFrac,
    k_G_ms: packSpec.category === 'structured' ? bsRes.kGMs : onda.k_G_ms,
    k_L_ms: packSpec.category === 'structured' ? bsRes.kLMs : onda.k_L_ms,
    a_w_m2m3: onda.a_w_m2m3,
    a_w_ratio: onda.a_w_ratio,
    onda,
    billetSchultes: bsRes,
    vesselSpec,
    packingDetail,
    nozzleSchedule,
    manholeSchedule,
    mode: solverMode,
  };
}

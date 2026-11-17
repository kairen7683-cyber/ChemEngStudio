/**
 * Shared EPC Vessel Mechanical, Nozzle/Manhole Elevation, Tray Detail & Packing Hardware Builder
 * for ChemPro Unified Column Solvers (`chemproColumnAdapter.ts` & `absorptionTowerDesign.ts`).
 */

export interface ChemproVesselSpec {
  idMm: number;
  wallThicknessMm: number;
  headThicknessMm: number;
  skirtHeightMm: number;
  hTangentMm: number;
  oalElMm: number;
  btlElMm: number;
  lllElMm: number;
  nllElMm: number;
  hllElMm: number;
  ttlElMm: number;
  designP_barG: number;
  designT_C: number;
  corrAllowanceMm: number;
  material: string;
  emptyWeightKg: number;
  operWeightKg: number;
  flangeRating: string;
}

export interface ChemproTrayDetail {
  trayTypeLabel: string;
  passes: number;
  spacingMm: number;
  activeAreaM2: number;
  activeAreaPct: number;
  holeD_mm: number;
  holePitchMm: number;
  openAreaPct: number;
  openAreaTowerPct: number;
  deckThicknessMm: number;
  weirH_mm: number;
  weirL_mm: number;
  weirCrestMm: number;
  dcWidthTopMm: number;
  dcWidthBotMm: number;
  dcAreaPct: number;
  dcClearanceMm: number;
  dryDropMmLiq: number;
  opMinPct: number;
  opMaxPct: number;
  turndownRatio: number;
}

export interface ChemproPackingDetail {
  categoryLabel: string;
  modelName: string;
  nominalSize: string;
  material: string;
  ap: number;
  voidPct: number;
  Fp: number;
  hetpMm: number;
  totalPackedHeightMm: number;
  beds: Array<{
    bedNo: number;
    section: string;
    heightMm: number;
    botElMm: number;
    topElMm: number;
    hetpMm: number;
    dpMbar: number;
  }>;
  topDistributor: {
    tag: string;
    type: string;
    dripPointsPerM2: number;
    totalDripPoints: number;
    elevationMm: number;
  };
  redistributors: {
    count: number;
    items: Array<{
      tag: string;
      type: string;
      interBedHeightMm: number;
      elevationMm: number;
      freeAreaPct: number;
    }>;
  };
  supportPlate: {
    count: number;
    type: string;
    freeAreaPct: number;
    elevationsMm: number[];
  };
  holdDownGrid: {
    count: number;
    type: string;
    freeAreaPct: number;
    elevationsMm: number[];
  };
  demister: {
    tag: string;
    type: string;
    thicknessMm: number;
    elevationMm: number;
  };
  mwrM3M2H: number;
  wettingRateM3M2H: number;
  wettingSafetyRatio: number;
  dryDpMbarM: number;
  irrigDpMbarM: number;
  opMinPct: number;
  opMaxPct: number;
  turndownRatio: number;
}

export interface ChemproNozzleItem {
  tag: string;
  service: string;
  phase: string;
  selectedDn: string;
  flangeRating: string;
  flowKgH: number;
  velMS: number;
  elevationMm: number;
  elevationFromBtlMm: number;
  orientationDeg: number;
}

export interface ChemproManholeItem {
  tag: string;
  sizeDn: string;
  flangeRating: string;
  service: string;
  elevationMm: number;
  orientationDeg: number;
}

const PLATE_STD = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 60];
const PIPE_DN_TBL: Array<{ dn: string; nps: string; idMm: number }> = [
  { dn: 'DN25', nps: '1"', idMm: 26.6 },
  { dn: 'DN40', nps: '1.5"', idMm: 40.9 },
  { dn: 'DN50', nps: '2"', idMm: 52.5 },
  { dn: 'DN65', nps: '2.5"', idMm: 62.7 },
  { dn: 'DN80', nps: '3"', idMm: 77.9 },
  { dn: 'DN100', nps: '4"', idMm: 102.3 },
  { dn: 'DN150', nps: '6"', idMm: 154.1 },
  { dn: 'DN200', nps: '8"', idMm: 202.7 },
  { dn: 'DN250', nps: '10"', idMm: 254.5 },
  { dn: 'DN300', nps: '12"', idMm: 303.2 },
  { dn: 'DN350', nps: '14"', idMm: 333.4 },
  { dn: 'DN400', nps: '16"', idMm: 381.0 },
  { dn: 'DN450', nps: '18"', idMm: 428.6 },
  { dn: 'DN500', nps: '20"', idMm: 477.8 },
  { dn: 'DN600', nps: '24"', idMm: 574.7 },
  { dn: 'DN750', nps: '30"', idMm: 736.6 },
  { dn: 'DN900', nps: '36"', idMm: 889.0 },
];

function roundPlate(t: number): number {
  for (const p of PLATE_STD) if (p >= t - 1e-6) return p;
  return Math.ceil(t / 5) * 5;
}

export function pickChemproNozzleDn(massKgH: number, rhoKgM3: number, targetVelMS: number): {
  selectedDn: string;
  velMS: number;
} {
  const qM3S = Math.max(1e-5, massKgH / (Math.max(0.05, rhoKgM3) * 3600.0));
  const reqIdMm = Math.sqrt((4.0 * qM3S) / (Math.PI * Math.max(0.4, targetVelMS))) * 1000.0;
  let picked = PIPE_DN_TBL[PIPE_DN_TBL.length - 1];
  for (const row of PIPE_DN_TBL) {
    if (row.idMm >= reqIdMm) {
      picked = row;
      break;
    }
  }
  const actualArea = (Math.PI * Math.pow(picked.idMm / 1000.0, 2)) / 4.0;
  const velMS = Number((qM3S / Math.max(1e-5, actualArea)).toFixed(2));
  return { selectedDn: `${picked.dn} (${picked.nps})`, velMS };
}

export function buildChemproVesselAndLevels(args: {
  D_col_m: number;
  H_tangent_m: number;
  P_op_barA: number;
  T_max_C: number;
  skirtHeightMm: number;
  isAbsorber?: boolean;
  material?: string;
}): ChemproVesselSpec {
  const idMm = Math.round(Math.max(0.3, args.D_col_m) * 1000);
  const hTangentMm = Math.round(Math.max(2.0, args.H_tangent_m) * 1000);
  const pOpG = Math.max(-0.95, args.P_op_barA - 1.01325);
  const designP_barG = Number(Math.max(3.5, pOpG + 1.8, pOpG * 1.15).toFixed(2));
  const designT_C = Math.round(Math.max(50, args.T_max_C + 25));
  const corrAllowanceMm = args.isAbsorber ? 2.0 : 3.0;
  const mat = args.material ?? (args.isAbsorber ? 'SA-240 316L / FRP-Lined CS' : 'ASME SA-516 Gr.70 / SS316L');
  const S_MPa = 138.0; // ASME SA-516 Gr.70 / SA-240 316L conservative basis
  const E = 0.85;
  const P_MPa = designP_barG * 0.1;
  const Rcorr = idMm / 2.0 + corrAllowanceMm;
  const tShellReq = (P_MPa * Rcorr) / Math.max(10, S_MPa * E - 0.6 * P_MPa) + corrAllowanceMm;
  const tHeadReq = (P_MPa * (idMm + 2 * corrAllowanceMm)) / Math.max(10, 2 * S_MPa - 0.2 * P_MPa) + corrAllowanceMm;
  const tMin = Math.max(6.0, idMm / 1000.0 + 3.0 + corrAllowanceMm * 0.5);
  const wallThicknessMm = roundPlate(Math.max(tShellReq, tMin));
  const headThicknessMm = roundPlate(Math.max(tHeadReq, tMin));

  const btlElMm = Math.round(args.skirtHeightMm);
  const ttlElMm = btlElMm + hTangentMm;
  const sumpH = Math.min(2400, Math.max(1000, Math.round(hTangentMm * 0.14)));
  const lllElMm = btlElMm + Math.round(0.22 * sumpH);
  const nllElMm = btlElMm + Math.round(0.55 * sumpH);
  const hllElMm = btlElMm + Math.round(0.82 * sumpH);
  const oalElMm = ttlElMm + Math.round(0.25 * idMm) + 450;

  const cylVolM3 = Math.PI * (args.D_col_m + wallThicknessMm / 1000.0) * (wallThicknessMm / 1000.0) * args.H_tangent_m;
  const headsVolM3 = 2 * 1.084 * args.D_col_m * args.D_col_m * (headThicknessMm / 1000.0);
  const emptyWeightKg = Math.round((cylVolM3 + headsVolM3) * 7850 * 1.28); // +28% skirt/nozzles/internals
  const operWeightKg = Math.round(emptyWeightKg + ((Math.PI * args.D_col_m * args.D_col_m) / 4.0) * (sumpH / 1000.0) * 900);
  const flangeRating = designP_barG > 16.0 ? 'ASME 300# RFWN' : 'ASME 150# RFWN';

  return {
    idMm,
    wallThicknessMm,
    headThicknessMm,
    skirtHeightMm: btlElMm,
    hTangentMm,
    oalElMm,
    btlElMm,
    lllElMm,
    nllElMm,
    hllElMm,
    ttlElMm,
    designP_barG,
    designT_C,
    corrAllowanceMm,
    material: mat,
    emptyWeightKg,
    operWeightKg,
    flangeRating,
  };
}

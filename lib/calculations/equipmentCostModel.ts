/**
 * equipmentCostModel.ts — 형상 기반 장치 구입원가(Cp) · 설치원가(Bare-Module CBM) 산출 모듈
 *
 * 문헌 상관식 근거:
 *  - Turton, Bailie, Whiting, Shaeiwitz & Bhattacharyya (2018), Analysis, Synthesis, and Design of Chemical Processes (5th ed.), Appendix A (기준 CEPCI = 397)
 *  - Towler & Sinnott (2022), Chemical Engineering Design (6th ed.), Ch. 7 (압력용기 강재 질량 기반 상관식, 기준 CEPCI = 532)
 *  - Guthrie (1969, 1974) Bare-Module 설치계수 체계: C_BM = C_p^0 · (B_1 + B_2 · F_M · F_P)
 *
 * 기본 지수 및 환율:
 *  - 기본 CEPCI = 800 (사용자 조정 가능)
 *  - 기본 환율 = 1,380 KRW/USD (사용자 조정 가능)
 */

export type CostMaterialKey =
  | 'CS'
  | 'SS304'
  | 'SS316L'
  | 'DUPLEX_2205'
  | 'TI_GR2'
  | 'PTFE_LINED'
  | 'ALLOY_C276'
  | 'HASTELLOY_C276';

export interface CostIndexOptions {
  /** 화학플랜트 비용지수 (기본 800) */
  cepci?: number;
  /** 원/달러 환율 KRW/USD (기본 1380) */
  fxKrwPerUsd?: number;
  /** 예비비·엔지니어링 수수료 계수 C_TM / C_BM (Turton 기본 1.18) */
  contingencyFeeFactor?: number;
}

export const CEPCI_TURTON_REF = 397;
export const CEPCI_TOWLER_REF = 532;
export const DEFAULT_CEPCI = 800;
export const DEFAULT_FX_KRW_PER_USD = 1380;

export interface CostMaterialSpec {
  key: CostMaterialKey;
  label: string;
  /** 압력용기/탑조 재질계수 F_M */
  fmVessel: number;
  /** 열교환기(쉘/튜브 동재질 기준) 재질계수 F_M */
  fmHx: number;
  /** 유체기계(펌프/압축기) 재질계수 F_M */
  fmMachinery: number;
  /** 트레이/인터널 재질계수 F_M,tray */
  fmTray: number;
  /** 금속 밀도 (kg/m³) */
  densityKgM3: number;
}

export const COST_MATERIAL_FACTORS: Record<CostMaterialKey, CostMaterialSpec> = {
  CS: {
    key: 'CS',
    label: '탄소강 (Carbon Steel SA-516-70)',
    fmVessel: 1.0,
    fmHx: 1.0,
    fmMachinery: 1.0,
    fmTray: 1.0,
    densityKgM3: 7850,
  },
  SS304: {
    key: 'SS304',
    label: '스테인리스강 304 (SS304)',
    fmVessel: 1.75,
    fmHx: 1.85,
    fmMachinery: 1.65,
    fmTray: 1.55,
    densityKgM3: 8000,
  },
  SS316L: {
    key: 'SS316L',
    label: '스테인리스강 316L (SS316L)',
    fmVessel: 2.1,
    fmHx: 2.25,
    fmMachinery: 1.95,
    fmTray: 1.85,
    densityKgM3: 8000,
  },
  DUPLEX_2205: {
    key: 'DUPLEX_2205',
    label: '듀플렉스 2205 (UNS S32205)',
    fmVessel: 2.6,
    fmHx: 2.85,
    fmMachinery: 2.4,
    fmTray: 2.35,
    densityKgM3: 7800,
  },
  PTFE_LINED: {
    key: 'PTFE_LINED',
    label: '불소수지 라이닝 탄소강 (PTFE-Lined CS)',
    fmVessel: 2.35,
    fmHx: 2.75,
    fmMachinery: 2.2,
    fmTray: 2.6,
    densityKgM3: 7850,
  },
  TI_GR2: {
    key: 'TI_GR2',
    label: '티타늄 (Titanium Gr.2)',
    fmVessel: 4.2,
    fmHx: 4.6,
    fmMachinery: 4.5,
    fmTray: 3.9,
    densityKgM3: 4510,
  },
  ALLOY_C276: {
    key: 'ALLOY_C276',
    label: '니켈-몰리브덴 초합금 (Alloy C-276)',
    fmVessel: 5.4,
    fmHx: 5.8,
    fmMachinery: 5.2,
    fmTray: 4.9,
    densityKgM3: 8890,
  },
  HASTELLOY_C276: {
    key: 'HASTELLOY_C276',
    label: '니켈-몰리브덴 초합금 (Alloy C-276)',
    fmVessel: 5.4,
    fmHx: 5.8,
    fmMachinery: 5.2,
    fmTray: 4.9,
    densityKgM3: 8890,
  },
};

export interface CostLineItem {
  id: string;
  label: string;
  basisNote: string;
  purchaseUsd: number;
  bareModuleUsd: number;
  purchaseKrw: number;
  bareModuleKrw: number;
}

export interface EquipmentCostResult {
  equipmentType: string;
  materialLabel: string;
  cepciUsed: number;
  fxKrwPerUsd: number;
  baseCp0Usd: number;
  purchasedUsd: number;
  bareModuleUsd: number;
  totalModuleUsd: number;
  purchasedKrw: number;
  bareModuleKrw: number;
  totalModuleKrw: number;
  /** 억 원 단위 (예: 4.25 → 4.25억원) */
  bareModuleEokKrw: number;
  totalModuleEokKrw: number;
  factors: {
    fm: number;
    fp: number;
    fbm: number;
    contingencyFeeFactor: number;
  };
  basisSummary: string;
}

export interface ColumnVesselCostInput extends CostIndexOptions {
  /** 탑 지배 내경 D (m) */
  innerDiamM: number;
  /** 탄젠트-탄젠트 높이 H_TT (m) */
  tangentHeightM: number;
  /** 스커트 높이 (m, 기본 3.0) */
  skirtHeightM?: number;
  /** 설계 내압 (bar g, 기본 3.5) */
  designPressBarG?: number;
  /** 진공(외압) 설계 여부 */
  isVacuum?: boolean;
  /** 동체 재질 */
  shellMaterial: CostMaterialKey;
  /** 인터널 재질 (미지정 시 동체 재질과 동일) */
  internalsMaterial?: CostMaterialKey;
  /** ASME 산출 동체 두께 (mm) — 지정 시 실제 강재 질량 직접 반영 */
  shellThicknessMm?: number;
  /** ASME 산출 경판 두께 (mm) */
  headThicknessMm?: number;
  /** 스커트 두께 (mm) */
  skirtThicknessMm?: number;
  /** 외압 보강링 개수 */
  stiffenerCount?: number;
  /** 보강링 포함 동체+경판 중량 (kg, 지정 시 우선 사용) */
  vesselShellHeadsMassKg?: number;
  /** 스커트 중량 (kg, 지정 시 우선 사용) */
  skirtMassKg?: number;
  // 인터널 사양
  internalsKind: 'tray' | 'packed';
  /** 트레이 단수 (단탑일 때) */
  trayCount?: number;
  /** 트레이 종류 */
  trayType?: 'sieve' | 'valve' | 'bubble_cap';
  /** 트레이 설치 평균 직경 (m, 이단 직경 시 면적가중 직경) */
  trayDiamM?: number;
  /** 충진물 총 체적 (m³, 충진탑일 때) */
  packingVolumeM3?: number;
  /** 충진물 종류 단가 분류 */
  packingCategory?: 'structured_250y' | 'structured_350y' | 'structured_ptfe' | 'structured_graphite' | 'random_metal' | 'random_ceramic';
  /** 충진 베드 수 (분배기·서포트 그리드 세트 수 산정용) */
  packedBedCount?: number;
}

export interface ColumnCostBreakdown {
  cepciUsed: number;
  fxKrwPerUsd: number;
  shellAndHeadsMassKg: number;
  skirtMassKg: number;
  baseVesselCp0Usd: number;
  vesselPurchaseUsd: number;
  skirtAndSupportPurchaseUsd: number;
  platformsLaddersPurchaseUsd: number;
  internalsPurchaseUsd: number;
  distributorsSupportsPurchaseUsd: number;
  totalPurchaseUsd: number;
  bareModuleUsd: number;
  totalModuleUsd: number;
  totalPurchaseKrw: number;
  bareModuleKrw: number;
  totalModuleKrw: number;
  bareModuleEokKrw: number;
  totalModuleEokKrw: number;
  factors: {
    fmVessel: number;
    fmInternals: number;
    fpVessel: number;
    fbmVessel: number;
    fqTrays: number;
    contingencyFeeFactor: number;
  };
  lineItems: CostLineItem[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Turton log10 다항 상관식: log10(Cp0) = K1 + K2·log10(A) + K3·(log10(A))² (@ CEPCI = 397) */
function turtonCp0(A: number, k1: number, k2: number, k3: number, cepci: number): number {
  const lg = Math.log10(Math.max(1e-4, A));
  const cpRef = Math.pow(10, k1 + k2 * lg + k3 * lg * lg);
  return cpRef * (cepci / CEPCI_TURTON_REF);
}

/** 원화 금액을 'X.XX억 원' 또는 'X,XXX만 원' 형식으로 변환 */
export function formatKrwReadable(krw: number): string {
  const abs = Math.abs(krw);
  if (abs >= 1e8) {
    return `${(krw / 1e8).toFixed(2)}억 원`;
  }
  return `${Math.round(krw / 1e4).toLocaleString()}만 원`;
}

/**
 * 증류탑·흡수탑 통합 형상 기반 원가 산출 (Turton + Towler-Sinnott + Guthrie Bare-Module)
 */
export function costColumnVessel(inp: ColumnVesselCostInput): ColumnCostBreakdown {
  const cepci = clamp(inp.cepci ?? DEFAULT_CEPCI, 300, 1500);
  const fx = clamp(inp.fxKrwPerUsd ?? DEFAULT_FX_KRW_PER_USD, 800, 2500);
  const ctmFactor = clamp(inp.contingencyFeeFactor ?? 1.18, 1.0, 1.6);

  const matSpec = COST_MATERIAL_FACTORS[inp.shellMaterial] ?? COST_MATERIAL_FACTORS.SS316L;
  const intMatSpec = COST_MATERIAL_FACTORS[inp.internalsMaterial ?? inp.shellMaterial] ?? matSpec;

  const D = clamp(inp.innerDiamM, 0.3, 10.0);
  const H = clamp(inp.tangentHeightM, 1.5, 95.0);
  const Hskirt = clamp(inp.skirtHeightM ?? 3.0, 0.8, 12.0);
  const pBarG = Math.max(0, inp.designPressBarG ?? 3.5);

  // 1) 기준 저압 탄소강 최소 두께 t0 (mm) 대비 실제 두께 질량비 → 기하 기반 압력·좌굴 계수 F_P
  const t0Mm = Math.max(6.0, (D * 1000) / 1000 + 4.0);
  const pMpa = Math.max(0.35, pBarG * 0.1);
  const estThkFromP = (pMpa * (D * 500)) / Math.max(10, 138 * 0.85 - 0.6 * pMpa) + 3.0;
  const tShellMm = Math.max(t0Mm, inp.shellThicknessMm ?? estThkFromP);
  const tHeadMm = Math.max(t0Mm, inp.headThicknessMm ?? tShellMm);
  const tSkirtMm = Math.max(8.0, inp.skirtThicknessMm ?? Math.max(8.0, t0Mm + 2.0));

  const headArea2 = 2 * 1.084 * D * D; // 상·하 2:1 반타원 경판 표면적 합 (m²)
  const shellArea = Math.PI * (D + tShellMm / 1000) * H;

  // 기준 저압 CS 용기 질량 M0 (노즐·맨홀 부착물 12% 여유 포함)
  const baseCsMassKg =
    (Math.PI * (D + t0Mm / 1000) * H * (t0Mm / 1000) + headArea2 * (t0Mm / 1000)) * 7850 * 1.12;

  const stiffenerAllowanceFactor = 1.0 + 0.035 * Math.max(0, inp.stiffenerCount ?? 0);
  const computedActualMassKg =
    (shellArea * (tShellMm / 1000) + headArea2 * (tHeadMm / 1000)) *
    matSpec.densityKgM3 *
    1.12 *
    stiffenerAllowanceFactor;

  const shellAndHeadsMassKg = Math.max(180, inp.vesselShellHeadsMassKg ?? computedActualMassKg);
  const skirtMassKg = Math.max(
    80,
    inp.skirtMassKg ?? Math.PI * (D + 2 * (tShellMm / 1000)) * Hskirt * (tSkirtMm / 1000) * 7850 * 1.15
  );

  // Towler & Sinnott 수직 압력용기 기준 구입원가 Cp0 (탄소강 상압 등가 질량 S = M0 기준, CEPCI 532 → cepci)
  const sClamped = clamp(baseCsMassKg, 160, 250000);
  const baseVesselCp0Usd = (11600 + 34 * Math.pow(sClamped, 0.85)) * (cepci / CEPCI_TOWLER_REF);

  // 두께 증가분(내압·진공보강·풍/지진)을 반영한 F_P (밀도 차이 제거 후 순수 두께/보강 증가율^0.85)
  const eqCsDesignMassKg = shellAndHeadsMassKg * (7850 / matSpec.densityKgM3);
  const vacFabFactor = inp.isVacuum ? 1.08 : 1.0;
  const fpVessel = clamp(Math.pow(Math.max(1.0, eqCsDesignMassKg / Math.max(120, baseCsMassKg)), 0.85) * vacFabFactor, 1.0, 6.5);
  const fmVessel = matSpec.fmVessel;

  // Guthrie / Turton 수직 용기 Bare-Module 계수: B1 = 2.25, B2 = 1.82
  const B1_VESSEL = 2.25;
  const B2_VESSEL = 1.82;
  const fbmVessel = B1_VESSEL + B2_VESSEL * fmVessel * fpVessel;

  const vesselPurchaseUsd = baseVesselCp0Usd * fmVessel * fpVessel;
  const vesselBareModuleUsd = baseVesselCp0Usd * fbmVessel;

  // 2) 스커트 · 베이스링 · 앵커볼트 (탄소강 구조물 질량 기반)
  const skirtPurchaseUsd = (2400 + 8.5 * Math.pow(skirtMassKg, 0.92)) * (cepci / CEPCI_TOWLER_REF);
  const skirtBareModuleUsd = skirtPurchaseUsd * 2.15;

  // 3) 외부 작업 플랫폼 & 사다리 (Turton / Guthrie: C_p^0 = 361.8 · D^0.7396 · H^0.70684 @ CEPCI 397)
  const platformsLaddersPurchaseUsd =
    361.8 * Math.pow(D, 0.7396) * Math.pow(H, 0.70684) * (cepci / CEPCI_TURTON_REF);
  const platformsBareModuleUsd = platformsLaddersPurchaseUsd * 2.05;

  // 4) 내부 인터널 원가: 트레이 데크 OR 충진물 + 액체 분배기/지지 그리드
  let internalsPurchaseUsd = 0;
  let internalsBareModuleUsd = 0;
  let distributorsSupportsPurchaseUsd = 0;
  let distributorsBareModuleUsd = 0;
  let fqTrays = 1.0;
  let internalsBasisNote = '';
  let distBasisNote = '';

  if (inp.internalsKind === 'tray') {
    const nTrays = Math.max(1, Math.round(inp.trayCount ?? 20));
    const dTray = clamp(inp.trayDiamM ?? D, 0.3, 10.0);
    const aTray = clamp((Math.PI * dTray * dTray) / 4, 0.07, 80.0);

    // Turton Table A.1 Sieve Tray 단당 기준원가 (A_tray 범위 0.07 ~ 12.3 m², 대구경은 면적 비례 외삽)
    const aCorr = Math.min(aTray, 12.3);
    const singleTrayCp0 =
      turtonCp0(aCorr, 2.9949, 0.4465, 0.3961, cepci) * (aTray > 12.3 ? Math.pow(aTray / 12.3, 1.15) : 1.0);

    if (nTrays < 20) {
      const lgN = Math.log10(nTrays);
      fqTrays = Math.pow(10, 0.4771 + 0.08516 * lgN - 0.3473 * lgN * lgN);
    } else {
      fqTrays = 1.0;
    }
    const trayTypeFactor = inp.trayType === 'bubble_cap' ? 1.85 : inp.trayType === 'valve' ? 1.18 : 1.0;
    internalsPurchaseUsd = singleTrayCp0 * nTrays * fqTrays * trayTypeFactor * intMatSpec.fmTray;
    // 탑 내부 설치 계수 (F_BM,tray ≈ 1.0 + 1.2 F_M,tray → 이미 구입가에 F_M 반영됨, 설치 인건비 +25% Cp0)
    internalsBareModuleUsd = internalsPurchaseUsd + singleTrayCp0 * nTrays * fqTrays * trayTypeFactor * 0.35;
    internalsBasisNote = `${(inp.trayType ?? 'valve').toUpperCase()} 트레이 ${nTrays}단 (Ø${dTray.toFixed(2)}m, Fq=${fqTrays.toFixed(2)}, FM=${intMatSpec.fmTray.toFixed(2)})`;
  } else {
    const volM3 = Math.max(0.1, inp.packingVolumeM3 ?? ((Math.PI * D * D) / 4) * (H * 0.65));
    const cat = inp.packingCategory ?? 'structured_250y';
    // CEPCI = 800 기준 충진물 단위 체적당 기본 단가 ($/m³, SS316L 또는 고유 재질 기준)
    const unitUsdPerM3At800: Record<NonNullable<ColumnVesselCostInput['packingCategory']>, number> = {
      structured_250y: 4150,
      structured_350y: 5350,
      structured_ptfe: 7900,
      structured_graphite: 8600,
      random_metal: 2150,
      random_ceramic: 1450,
    };
    let alloyMult = 1.0;
    if (cat === 'structured_250y' || cat === 'structured_350y' || cat === 'random_metal') {
      // 기본 단가가 SS316L 기준이므로 재질 비례 스케일링
      alloyMult = intMatSpec.fmTray / COST_MATERIAL_FACTORS.SS316L.fmTray;
    }
    const unitPrice = unitUsdPerM3At800[cat] * alloyMult * (cepci / 800);
    internalsPurchaseUsd = volM3 * unitPrice;
    internalsBareModuleUsd = internalsPurchaseUsd * 1.18; // 충진 작업 인건비 포함
    internalsBasisNote = `충진물 체적 ${volM3.toFixed(2)} m³ × $${Math.round(unitPrice).toLocaleString()}/m³`;

    // 액체 분배기(상부+재분배기) + 서포트 그리드 + 홀드다운 그리드
    const nBeds = Math.max(1, inp.packedBedCount ?? 2);
    const colArea = (Math.PI * D * D) / 4;
    const perBedSetCsUsd = (3800 + 2950 * Math.pow(colArea, 0.82)) * (cepci / 800);
    distributorsSupportsPurchaseUsd = nBeds * perBedSetCsUsd * Math.max(1.0, intMatSpec.fmTray * 0.78);
    distributorsBareModuleUsd = distributorsSupportsPurchaseUsd * 1.28;
    distBasisNote = `액체 분배기·재분배기·서포트 그리드 ${nBeds}베드 세트`;
  }

  const lineItems: CostLineItem[] = [
    {
      id: 'vessel_shell_heads',
      label: '압력용기 동체·경판 (ASME VIII-1)',
      basisNote: `강재 ${(shellAndHeadsMassKg / 1000).toFixed(2)} ton · FM=${fmVessel.toFixed(2)} · FP=${fpVessel.toFixed(2)}`,
      purchaseUsd: Math.round(vesselPurchaseUsd),
      bareModuleUsd: Math.round(vesselBareModuleUsd),
      purchaseKrw: Math.round(vesselPurchaseUsd * fx),
      bareModuleKrw: Math.round(vesselBareModuleUsd * fx),
    },
    {
      id: 'skirt_anchor',
      label: '스커트 지지대 · 베이스링 · 앵커볼트',
      basisNote: `스커트 H=${Hskirt.toFixed(1)}m (${(skirtMassKg / 1000).toFixed(2)} ton CS)`,
      purchaseUsd: Math.round(skirtPurchaseUsd),
      bareModuleUsd: Math.round(skirtBareModuleUsd),
      purchaseKrw: Math.round(skirtPurchaseUsd * fx),
      bareModuleKrw: Math.round(skirtBareModuleUsd * fx),
    },
    {
      id: 'internals_main',
      label: inp.internalsKind === 'tray' ? '컬럼 트레이 데크 어셈블리' : '컬럼 규칙/불규칙 충진물',
      basisNote: internalsBasisNote,
      purchaseUsd: Math.round(internalsPurchaseUsd),
      bareModuleUsd: Math.round(internalsBareModuleUsd),
      purchaseKrw: Math.round(internalsPurchaseUsd * fx),
      bareModuleKrw: Math.round(internalsBareModuleUsd * fx),
    },
  ];

  if (distributorsSupportsPurchaseUsd > 0) {
    lineItems.push({
      id: 'distributors_grids',
      label: '액체 분배기 · 콜렉터 · 서포트 그리드',
      basisNote: distBasisNote,
      purchaseUsd: Math.round(distributorsSupportsPurchaseUsd),
      bareModuleUsd: Math.round(distributorsBareModuleUsd),
      purchaseKrw: Math.round(distributorsSupportsPurchaseUsd * fx),
      bareModuleKrw: Math.round(distributorsBareModuleUsd * fx),
    });
  }

  lineItems.push({
    id: 'platforms_ladders',
    label: '외부 점검 플랫폼 · 케이지 사다리',
    basisNote: `Ø${D.toFixed(2)}m × H_TT ${H.toFixed(1)}m 표준 액세스 구조물`,
    purchaseUsd: Math.round(platformsLaddersPurchaseUsd),
    bareModuleUsd: Math.round(platformsBareModuleUsd),
    purchaseKrw: Math.round(platformsLaddersPurchaseUsd * fx),
    bareModuleKrw: Math.round(platformsBareModuleUsd * fx),
  });

  const totalPurchaseUsd =
    vesselPurchaseUsd +
    skirtPurchaseUsd +
    platformsLaddersPurchaseUsd +
    internalsPurchaseUsd +
    distributorsSupportsPurchaseUsd;

  const bareModuleUsd =
    vesselBareModuleUsd +
    skirtBareModuleUsd +
    platformsBareModuleUsd +
    internalsBareModuleUsd +
    distributorsBareModuleUsd;

  const totalModuleUsd = bareModuleUsd * ctmFactor;
  const totalPurchaseKrw = totalPurchaseUsd * fx;
  const bareModuleKrw = bareModuleUsd * fx;
  const totalModuleKrw = totalModuleUsd * fx;

  return {
    cepciUsed: cepci,
    fxKrwPerUsd: fx,
    shellAndHeadsMassKg: Math.round(shellAndHeadsMassKg),
    skirtMassKg: Math.round(skirtMassKg),
    baseVesselCp0Usd: Math.round(baseVesselCp0Usd),
    vesselPurchaseUsd: Math.round(vesselPurchaseUsd),
    skirtAndSupportPurchaseUsd: Math.round(skirtPurchaseUsd),
    platformsLaddersPurchaseUsd: Math.round(platformsLaddersPurchaseUsd),
    internalsPurchaseUsd: Math.round(internalsPurchaseUsd),
    distributorsSupportsPurchaseUsd: Math.round(distributorsSupportsPurchaseUsd),
    totalPurchaseUsd: Math.round(totalPurchaseUsd),
    bareModuleUsd: Math.round(bareModuleUsd),
    totalModuleUsd: Math.round(totalModuleUsd),
    totalPurchaseKrw: Math.round(totalPurchaseKrw),
    bareModuleKrw: Math.round(bareModuleKrw),
    totalModuleKrw: Math.round(totalModuleKrw),
    bareModuleEokKrw: Number((bareModuleKrw / 1e8).toFixed(3)),
    totalModuleEokKrw: Number((totalModuleKrw / 1e8).toFixed(3)),
    factors: {
      fmVessel: Number(fmVessel.toFixed(2)),
      fmInternals: Number(intMatSpec.fmTray.toFixed(2)),
      fpVessel: Number(fpVessel.toFixed(2)),
      fbmVessel: Number(fbmVessel.toFixed(2)),
      fqTrays: Number(fqTrays.toFixed(3)),
      contingencyFeeFactor: ctmFactor,
    },
    lineItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 열교환기 원가 (Turton Table A.1 / Guthrie)
// ─────────────────────────────────────────────────────────────────────────────

export type HxCostTemaType = 'fixed_tube' | 'u_tube' | 'floating_head' | 'kettle_reboiler' | 'double_pipe' | 'plate';

export interface HeatExchangerCostInput extends CostIndexOptions {
  areaM2: number;
  hxType?: HxCostTemaType;
  designPressBarG?: number;
  shellMaterial?: CostMaterialKey;
  tubeMaterial?: CostMaterialKey;
}

export function costHeatExchanger(inp: HeatExchangerCostInput): EquipmentCostResult {
  const cepci = clamp(inp.cepci ?? DEFAULT_CEPCI, 300, 1500);
  const fx = clamp(inp.fxKrwPerUsd ?? DEFAULT_FX_KRW_PER_USD, 800, 2500);
  const ctmFactor = clamp(inp.contingencyFeeFactor ?? 1.18, 1.0, 1.6);

  const hxType: HxCostTemaType = inp.hxType ?? 'fixed_tube';
  const area = Math.max(1.0, inp.areaM2);
  const pBarG = Math.max(0.5, inp.designPressBarG ?? 5.0);

  const coeffs: Record<HxCostTemaType, [number, number, number, number, number]> = {
    fixed_tube: [4.3247, -0.303, 0.1634, 10, 1000],
    u_tube: [4.1884, -0.2503, 0.1974, 10, 1000],
    floating_head: [4.8306, -0.8509, 0.3187, 10, 1000],
    kettle_reboiler: [4.4646, -0.5277, 0.3955, 10, 100],
    double_pipe: [3.3444, 0.2745, -0.0472, 1, 10],
    plate: [4.6656, -0.1557, 0.1547, 10, 1000],
  };
  const [k1, k2, k3, aMin, aMax] = coeffs[hxType];
  // 대구경 다기 병렬 분할 또는 소면적 외삽 보정
  const nShells = area > aMax ? Math.ceil(area / aMax) : 1;
  const aUnit = clamp(area / nShells, aMin, aMax);
  const scaleSmall = area < aMin ? Math.pow(area / aMin, 0.62) : 1.0;
  const baseCp0Usd = nShells * turtonCp0(aUnit, k1, k2, k3, cepci) * scaleSmall;

  // 압력계수 F_P (Turton Table A.2, pBarG > 5 bar g 시 상승)
  let fp = 1.0;
  if (pBarG > 5.0 && hxType !== 'plate') {
    const lgP = Math.log10(clamp(pBarG, 5.0, 140.0));
    fp = Math.pow(10, 0.03881 - 0.11272 * lgP + 0.08183 * lgP * lgP);
  }

  const shellMat = COST_MATERIAL_FACTORS[inp.shellMaterial ?? 'CS'] ?? COST_MATERIAL_FACTORS.CS;
  const tubeMat = COST_MATERIAL_FACTORS[inp.tubeMaterial ?? inp.shellMaterial ?? 'SS316L'] ?? COST_MATERIAL_FACTORS.SS316L;
  // 쉘(40% 가중) + 튜브(60% 가중) 복합 재질계수
  const fm = 0.4 * shellMat.fmHx + 0.6 * tubeMat.fmHx;
  const fbm = 1.63 + 1.66 * fm * fp;

  const purchasedUsd = baseCp0Usd * fm * fp;
  const bareModuleUsd = baseCp0Usd * fbm;
  const totalModuleUsd = bareModuleUsd * ctmFactor;

  return {
    equipmentType: `열교환기 (${hxType})`,
    materialLabel: `Shell: ${shellMat.key} / Tube: ${tubeMat.key}`,
    cepciUsed: cepci,
    fxKrwPerUsd: fx,
    baseCp0Usd: Math.round(baseCp0Usd),
    purchasedUsd: Math.round(purchasedUsd),
    bareModuleUsd: Math.round(bareModuleUsd),
    totalModuleUsd: Math.round(totalModuleUsd),
    purchasedKrw: Math.round(purchasedUsd * fx),
    bareModuleKrw: Math.round(bareModuleUsd * fx),
    totalModuleKrw: Math.round(totalModuleUsd * fx),
    bareModuleEokKrw: Number(((bareModuleUsd * fx) / 1e8).toFixed(3)),
    totalModuleEokKrw: Number(((totalModuleUsd * fx) / 1e8).toFixed(3)),
    factors: {
      fm: Number(fm.toFixed(2)),
      fp: Number(fp.toFixed(2)),
      fbm: Number(fbm.toFixed(2)),
      contingencyFeeFactor: ctmFactor,
    },
    basisSummary: `A=${area.toFixed(1)} m² (${nShells}기), P=${pBarG.toFixed(1)} bar(g)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 펌프 원가 (Turton Table A.1 — 축동력·유량/양정 기반)
// ─────────────────────────────────────────────────────────────────────────────

export type PumpCostType = 'centrifugal' | 'reciprocating' | 'positive_displacement';

export interface PumpCostInput extends CostIndexOptions {
  /** 축동력 (kW) — 미지정 시 유량·양정·효율로 자동 산출 */
  shaftPowerKw?: number;
  flowM3H?: number;
  headM?: number;
  densityKgM3?: number;
  efficiency?: number;
  dischargePressBarG?: number;
  pumpType?: PumpCostType;
  material?: CostMaterialKey;
}

export function costPump(inp: PumpCostInput): EquipmentCostResult {
  const cepci = clamp(inp.cepci ?? DEFAULT_CEPCI, 300, 1500);
  const fx = clamp(inp.fxKrwPerUsd ?? DEFAULT_FX_KRW_PER_USD, 800, 2500);
  const ctmFactor = clamp(inp.contingencyFeeFactor ?? 1.18, 1.0, 1.6);

  const rho = clamp(inp.densityKgM3 ?? 1000, 300, 2200);
  const eff = clamp(inp.efficiency ?? 0.72, 0.25, 0.9);
  const qM3S = Math.max(0, inp.flowM3H ?? 20) / 3600;
  const headM = Math.max(5, inp.headM ?? 40);
  const calcShaftKw = (rho * 9.80665 * qM3S * headM) / (1000 * eff);
  const powerKw = Math.max(0.75, inp.shaftPowerKw ?? calcShaftKw);

  const pType: PumpCostType = inp.pumpType ?? 'centrifugal';
  const mat = COST_MATERIAL_FACTORS[inp.material ?? 'SS316L'] ?? COST_MATERIAL_FACTORS.SS316L;

  const pClamped = clamp(powerKw, 1.0, 300.0);
  const scalePower = powerKw > 300 ? Math.pow(powerKw / 300, 0.78) : powerKw < 1 ? Math.pow(powerKw, 0.45) : 1.0;

  let baseCp0Usd: number;
  if (pType === 'reciprocating') {
    baseCp0Usd = turtonCp0(clamp(powerKw, 1, 200), 3.8696, 0.3161, 0.122, cepci) * scalePower;
  } else if (pType === 'positive_displacement') {
    baseCp0Usd = turtonCp0(clamp(powerKw, 1, 100), 3.4771, 0.135, 0.1438, cepci) * scalePower;
  } else {
    baseCp0Usd = turtonCp0(pClamped, 3.3892, 0.0536, 0.1538, cepci) * scalePower;
  }

  const pDisBarG = Math.max(1.0, inp.dischargePressBarG ?? (rho * 9.80665 * headM) / 1e5);
  let fp = 1.0;
  if (pDisBarG > 10.0) {
    const lgP = Math.log10(clamp(pDisBarG, 10.0, 100.0));
    fp = Math.pow(10, -0.3935 + 0.3957 * lgP - 0.00226 * lgP * lgP);
  }
  const fm = mat.fmMachinery;
  const fbm = 1.89 + 1.35 * fm * fp;

  const purchasedUsd = baseCp0Usd * fm * fp;
  const bareModuleUsd = baseCp0Usd * fbm;
  const totalModuleUsd = bareModuleUsd * ctmFactor;

  return {
    equipmentType: `펌프 (${pType})`,
    materialLabel: mat.label,
    cepciUsed: cepci,
    fxKrwPerUsd: fx,
    baseCp0Usd: Math.round(baseCp0Usd),
    purchasedUsd: Math.round(purchasedUsd),
    bareModuleUsd: Math.round(bareModuleUsd),
    totalModuleUsd: Math.round(totalModuleUsd),
    purchasedKrw: Math.round(purchasedUsd * fx),
    bareModuleKrw: Math.round(bareModuleUsd * fx),
    totalModuleKrw: Math.round(totalModuleUsd * fx),
    bareModuleEokKrw: Number(((bareModuleUsd * fx) / 1e8).toFixed(3)),
    totalModuleEokKrw: Number(((totalModuleUsd * fx) / 1e8).toFixed(3)),
    factors: {
      fm: Number(fm.toFixed(2)),
      fp: Number(fp.toFixed(2)),
      fbm: Number(fbm.toFixed(2)),
      contingencyFeeFactor: ctmFactor,
    },
    basisSummary: `축동력 ${powerKw.toFixed(1)} kW, 토출압 ${pDisBarG.toFixed(1)} bar(g)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 압축기 · 진공펌프 원가 (Turton Table A.1 — 축동력 + 전동기 드라이버 포함)
// ─────────────────────────────────────────────────────────────────────────────

export type CompressorCostType = 'centrifugal' | 'reciprocating' | 'rotary_screw' | 'liquid_ring_vacuum';

export interface CompressorCostInput extends CostIndexOptions {
  shaftPowerKw: number;
  compressorType?: CompressorCostType;
  material?: CostMaterialKey;
  includeElectricDrive?: boolean;
}

export function costCompressor(inp: CompressorCostInput): EquipmentCostResult {
  const cepci = clamp(inp.cepci ?? DEFAULT_CEPCI, 300, 1500);
  const fx = clamp(inp.fxKrwPerUsd ?? DEFAULT_FX_KRW_PER_USD, 800, 2500);
  const ctmFactor = clamp(inp.contingencyFeeFactor ?? 1.18, 1.0, 1.6);

  const cType: CompressorCostType = inp.compressorType ?? 'centrifugal';
  const mat = COST_MATERIAL_FACTORS[inp.material ?? 'CS'] ?? COST_MATERIAL_FACTORS.CS;
  const powerKw = Math.max(2.0, inp.shaftPowerKw);

  let compCp0Usd: number;
  if (cType === 'reciprocating') {
    // 왕복동 압축기 (고압/수소/염화수소용, Turton rotary/reciprocating 보정)
    const pRef = clamp(powerKw, 18, 1500);
    const scale = powerKw < 18 ? Math.pow(powerKw / 18, 0.68) : powerKw > 1500 ? Math.pow(powerKw / 1500, 0.82) : 1.0;
    compCp0Usd = turtonCp0(pRef, 2.2897, 1.3604, -0.1027, cepci) * 1.18 * scale;
  } else if (cType === 'rotary_screw' || cType === 'liquid_ring_vacuum') {
    const pRef = clamp(powerKw, 18, 950);
    const scale = powerKw < 18 ? Math.pow(powerKw / 18, 0.65) : powerKw > 950 ? Math.pow(powerKw / 950, 0.8) : 1.0;
    const vacMult = cType === 'liquid_ring_vacuum' ? 1.12 : 1.0;
    compCp0Usd = turtonCp0(pRef, 5.0355, -1.8002, 0.8253, cepci) * scale * vacMult;
  } else {
    // 원심 압축기 (Turton: 450 ~ 3000 kW, 소형은 지수 스케일링)
    const pRef = clamp(powerKw, 450, 3000);
    const scale = powerKw < 450 ? Math.pow(powerKw / 450, 0.67) : powerKw > 3000 ? Math.pow(powerKw / 3000, 0.82) : 1.0;
    compCp0Usd = turtonCp0(pRef, 2.2897, 1.3604, -0.1027, cepci) * scale;
  }

  // 방폭형 전동기 드라이버 원가 (Turton Explosion-Proof Electric Drive: 75 ~ 2600 kW)
  let driveCp0Usd = 0;
  if (inp.includeElectricDrive ?? true) {
    const dRef = clamp(powerKw / 0.93, 75, 2600);
    const dScale = powerKw / 0.93 < 75 ? Math.pow(powerKw / 0.93 / 75, 0.72) : powerKw / 0.93 > 2600 ? Math.pow(powerKw / 0.93 / 2600, 0.85) : 1.0;
    driveCp0Usd = turtonCp0(dRef, 2.4604, 1.4191, -0.1798, cepci) * dScale;
  }

  const baseCp0Usd = compCp0Usd + driveCp0Usd;
  const fm = mat.fmMachinery;
  // Turton Table A.6 압축기 Bare-Module 계수 (CS F_BM ≈ 2.75, SS ≈ 5.8)
  const fbmComp = 2.75 * fm;
  const purchasedUsd = compCp0Usd * fm + driveCp0Usd;
  const bareModuleUsd = compCp0Usd * fbmComp + driveCp0Usd * 1.5;
  const totalModuleUsd = bareModuleUsd * ctmFactor;

  return {
    equipmentType: `압축기 (${cType})`,
    materialLabel: mat.label,
    cepciUsed: cepci,
    fxKrwPerUsd: fx,
    baseCp0Usd: Math.round(baseCp0Usd),
    purchasedUsd: Math.round(purchasedUsd),
    bareModuleUsd: Math.round(bareModuleUsd),
    totalModuleUsd: Math.round(totalModuleUsd),
    purchasedKrw: Math.round(purchasedUsd * fx),
    bareModuleKrw: Math.round(bareModuleUsd * fx),
    totalModuleKrw: Math.round(totalModuleUsd * fx),
    bareModuleEokKrw: Number(((bareModuleUsd * fx) / 1e8).toFixed(3)),
    totalModuleEokKrw: Number(((totalModuleUsd * fx) / 1e8).toFixed(3)),
    factors: {
      fm: Number(fm.toFixed(2)),
      fp: 1.0,
      fbm: Number((bareModuleUsd / Math.max(1, baseCp0Usd)).toFixed(2)),
      contingencyFeeFactor: ctmFactor,
    },
    basisSummary: `축동력 ${powerKw.toFixed(1)} kW (${inp.includeElectricDrive ?? true ? '방폭 전동기 포함' : '본체만'})`,
  };
}

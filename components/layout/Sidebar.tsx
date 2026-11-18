'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  useBalanceStore,
  calculateCmsPlantSummary,
  calculateMdiPlantSummary,
  type PlantId,
  type Plant03OperatingInputs,
  type CmsPlantOperatingInputs,
  type MdiPlantOperatingInputs,
} from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import type { ElectrolyzerInputs } from '@/lib/calculations/electrolyzer';
import { emptySimFlows, type FlowNodeDef } from '@/lib/calculations/flowsheetSolver';
import { createInitialHierarchySheets } from '@/lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '@/lib/calculations/hcl1AHierarchy';
import { createInitialCmsHierarchySheets } from '@/lib/calculations/cmsPlantHierarchy';
import { createInitialMdiHierarchySheets } from '@/lib/calculations/mdiPlantHierarchy';

const PLANT02_SAVE_KEY = 'chemplant-plant02-electrolyzer-v2';
const PLANT03_SAVE_KEY = 'chemplant-plant03-hcl1a-v2';
const PLANT05_SAVE_KEY = 'chemplant-plant05-cms-v2';
const PLANT06_MDI_SAVE_KEY = 'chemplant-plant06-mdi-v1';

interface NavMenuItem {
  key: string;
  label: string;
  badge: string;
  isPfd?: boolean;
  href?: string;
}

const CA_SUB_MENUS: NavMenuItem[] = [
  { key: 'pfd',         label: '공정도 (PFD) & 물질수지',        badge: 'M&EB',    isPfd: true },
  { key: 'evap',        label: '300 농축공정 설계 (3효 증발관)',  badge: '300 Sec' },
  { key: 'evap_studio', label: '다중효용(1~3효) 증발 스튜디오',   badge: 'MEE' },
  { key: 'brine',       label: '100 브라인 정제 설계',           badge: '100 Sec' },
  { key: 'packing',     label: '흡수·건조·제해 패킹타워 설계',    badge: 'COL' },
  { key: 'chempro',     label: '전해공장 기기 연동 설계',        badge: 'HEX/PMP' },
  { key: 'equip',       label: '전공정 기기목록 (Equipment)',    badge: 'LIST' },
  { key: 'standards',   label: '전해공정 설계기준',              badge: 'STD' },
];

const PLANT02_SIM_MENUS = [
  { sheetId: 'master',                 label: '통합 마스터 도면',           badge: 'ALL' },
  { sheetId: 'sub_100_primary',        label: '100-1 원염 용해 · 1차 정제', badge: '100A' },
  { sheetId: 'sub_100_secondary',      label: '100-2 킬레이트 2차 정제탑',  badge: '100B' },
  { sheetId: 'sub_200_cell',           label: '200-1 이온교환막 전해조',    badge: '200A' },
  { sheetId: 'sub_200_dechlor',        label: '200-2 양극액 진공 탈염소',   badge: '200B' },
  { sheetId: 'sub_300_evap',           label: '300 가성소다 3효 증발농축',  badge: '300' },
  { sheetId: 'sub_400_cooling',        label: '400-1 염소 냉각 · 제습전단', badge: '400A' },
  { sheetId: 'sub_400_drying',         label: '400-2 황산건조탑 3단 시뮬',  badge: '400B' },
  { sheetId: 'sub_400_liquefaction',   label: '400-3 염소 압축 · 냉매액화', badge: '400C' },
  { sheetId: 'sub_600_h2',             label: '600 수소 냉각 · 압축 · 제습', badge: '600' },
  { sheetId: 'sub_500_700_hcl_hypo',   label: '500/700 염산합성 · 제해탑',  badge: '500/700' },
];

const PLANT03_SUB_MENUS: NavMenuItem[] = [
  { key: 'pfd',     label: '공정도 (PFD) & 시뮬레이션',      badge: 'M&EB',    isPfd: true },
  { key: 'hcl_hub', label: '1A 증류탑·액화기 내장설계',      badge: 'MESH/HX' },
  { key: 'packing', label: '100/300 염산 흡수·제해탑 설계',  badge: 'COL' },
  { key: 'chempro', label: '펌프·압력용기·배관 상세설계',    badge: 'PMP/VSL' },
  { key: 'equip',   label: '1A 전공정 기기목록 & 시트',      badge: 'LIST' },
  { key: 'econ',    label: '1A 원단위 · 경제성 분석',        badge: 'ECON',    href: '/pep-yearbook' },
];

const PLANT03_HCL1A_MENUS = [
  { sheetId: 'master',           label: '통합 마스터 도면 (100~300)',     badge: 'ALL' },
  { sheetId: 'sub_1a_100_synth', label: '100 합성버너 · 흑연흡수 (35%)', badge: '100' },
  { sheetId: 'sub_1a_200_ahcl',  label: '200 반도체 5N 무수염산 정제',    badge: '200' },
  { sheetId: 'sub_1a_300_psd',   label: '300 폐염산 공비증류 회수(PSD)', badge: '300' },
];

const PLANT04_ECH_SUB_MENUS: NavMenuItem[] = [
  { key: 'pfd',     label: '공정도 (PFD) & 시뮬레이션',      badge: 'M&EB',    isPfd: true },
  { key: 'chempro', label: '펌프·열교환기·증류탑 설계',      badge: 'DESIGN' },
  { key: 'equip',   label: 'ECH 전공정 기기목록 & 시트',     badge: 'LIST' },
  { key: 'econ',    label: 'ECH 원단위 · 경제성 분석',       badge: 'ECON',    href: '/pep-yearbook' },
];

const PLANT04_ECH_SHEETS = [
  { sheetId: 'master',            label: '통합 마스터 도면 (100~300)',      badge: 'ALL' },
  { sheetId: 'sub_ech_100_hydro', label: '100 글리세린 염산반응 (DCH)',    badge: '100' },
  { sheetId: 'sub_ech_200_sapon', label: '200 가성소다 비누화 · 염수분리', badge: '200' },
  { sheetId: 'sub_ech_300_purif', label: '300 진공 2탑 정제 (NRTL 99.9%)',badge: '300' },
];

const CMS_SUB_MENUS: NavMenuItem[] = [
  { key: 'pfd',        label: '공정도 (PFD) & 시뮬레이션',      badge: 'M&EB',    isPfd: true },
  { key: 'cms_hub',    label: 'CMS 핵심장치 내장설계',          badge: 'RXN/COL' },
  { key: 'packing',    label: 'C-201~302 5탑 증류·탈거 설계',    badge: 'COL' },
  { key: 'chempro',    label: '기화기·냉각기·펌프 상세설계',    badge: 'HX/PMP' },
  { key: 'compressor', label: '공정가스 압축기 상세설계',       badge: 'COMP' },
  { key: 'equip',      label: 'CMS 전공정 기기목록 & 시트',     badge: 'LIST' },
  { key: 'econ',       label: 'CMS 원단위 · 경제성 분석',       badge: 'ECON',    href: '/pep-yearbook' },
];

const CMS_SHEETS = [
  { sheetId: 'master',            label: '통합 마스터 도면 (100~300)',            badge: 'ALL' },
  { sheetId: 'sub_cms_100_rxn',   label: '100 Cl₂ 기화 · R-101 AIBN 반응',        badge: '100' },
  { sheetId: 'sub_cms_200_rec',   label: '200 HCl(60단)·MC(50단)·Azeo(30단)',     badge: '200' },
  { sheetId: 'sub_cms_300_purif', label: '300 MCL(80단)·CFM(120단) 정제',         badge: '300' },
];

const MDI_SUB_MENUS: NavMenuItem[] = [
  { key: 'pfd',     label: '공정도 (PFD) & 시뮬레이션',      badge: 'M&EB',    isPfd: true },
  { key: 'mdi_hub', label: 'MDI 핵심장치 내장설계',          badge: 'RXN/COL' },
  { key: 'packing', label: 'C-101·301·302·401 증류탑 설계',  badge: 'COL' },
  { key: 'chempro', label: '예열기·냉각기·펌프·안전밸브',    badge: 'HX/PMP' },
  { key: 'equip',   label: 'MDI 전공정 기기목록 & 시트',     badge: 'LIST' },
  { key: 'econ',    label: 'MDI 원단위 · 경제성 분석',       badge: 'ECON',    href: '/pep-yearbook' },
];

const MDI_SHEETS = [
  { sheetId: 'master',            label: '통합 마스터 도면 (100~400)',           badge: 'ALL' },
  { sheetId: 'sub_mdi_100_mda',   label: '100 MDA 합성·염수분리·아닐린 회수',   badge: '100' },
  { sheetId: 'sub_mdi_200_phos',  label: '200 CO+Cl₂ 포스겐·2단 포스겐화',     badge: '200' },
  { sheetId: 'sub_mdi_300_mcb',   label: '300 탈포스겐·MCB 진공 회수',          badge: '300' },
  { sheetId: 'sub_mdi_400_purif', label: '400 Pure 4,4\'-MDI / PMDI 정밀분별',  badge: '400' },
];

/** 비-PFD 화면(장치목록 등)에서 PLANT 01(전해) 사이드바 운전변수 조절 시 저장소 즉시 동기화 */
function patchStoredPlant02Flowsheet(p2: ElectrolyzerInputs) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PLANT02_SAVE_KEY);
    const parsed = raw
      ? JSON.parse(raw)
      : { hierarchySheets: createInitialHierarchySheets(), savedAt: '운전변수 실시간 동기화' };
    const baseLoad = 5 * 190 * 16.2 * 0.94;
    const curLoad = p2.numElectrolyzers * p2.cellsPerElectrolyzer * p2.operatingCurrentKA * p2.currentEfficiency;
    const scale = Math.max(0.05, curLoad / baseLoad);

    const patchDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.unitType === 'electrolyzer') {
          return {
            ...d,
            params: {
              ...d.params,
              unitCount: p2.numElectrolyzers,
              cellCount: p2.cellsPerElectrolyzer,
              currentKA: p2.operatingCurrentKA,
              currentEffPct: Number((p2.currentEfficiency * 100).toFixed(2)),
              operTempC: p2.electrolyzerTempC ?? 89.0,
            },
          };
        }
        if (d.id === 'fp_b110') {
          return { ...d, params: { ...d.params, targetBrineWtPct: p2.brineFeedConcWt ?? 25.65 } };
        }
        if (d.id === 'fp_f_bw') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2O: Math.round(45900 * scale) }) } };
        }
        if (d.id === 'fp_f_pw' || d.id === 'c2_in_pw') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2O: Math.round(15525 * scale) }) } };
        }
        if (d.id === 'c2_in_brine') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({ NaCl: Math.round(57493 * scale), H2O: Math.round(166651 * scale) }),
            },
          };
        }
        return d;
      });

    if (Array.isArray(parsed.simDefs)) parsed.simDefs = patchDefs(parsed.simDefs);
    if (parsed.hierarchySheets && typeof parsed.hierarchySheets === 'object') {
      for (const k of Object.keys(parsed.hierarchySheets)) {
        if (Array.isArray(parsed.hierarchySheets[k]?.simDefs)) {
          parsed.hierarchySheets[k].simDefs = patchDefs(parsed.hierarchySheets[k].simDefs);
        }
      }
    }
    window.localStorage.setItem(PLANT02_SAVE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

/** 비-PFD 화면(장치목록 등)에서 PLANT 02(1A) 사이드바 운전변수 조절 시 저장소 즉시 동기화 */
function patchStoredPlant03Flowsheet(p3: Plant03OperatingInputs) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PLANT03_SAVE_KEY);
    const parsed = raw
      ? JSON.parse(raw)
      : { hierarchySheets: createInitialHcl1AHierarchySheets(), savedAt: '1A 운전변수 실시간 동기화' };

    const cl2KgH = Math.max(10, p3.cl2FeedKgH);
    const o2ImpKgH = Number((cl2KgH * 0.00125).toFixed(2));
    const h2KgH = Number(((cl2KgH / 70.906) * 2.016 * (1 + Math.max(0, p3.h2ExcessPct) / 100)).toFixed(2));
    const splitFrac = Number(Math.max(0.05, Math.min(0.92, p3.ahclSplitPct / 100)).toFixed(3));
    const synthHclKgH = 2 * (cl2KgH / 70.906) * 36.461 * 0.999998;
    const upwKgH = Number(Math.max(50, synthHclKgH * (1 - splitFrac) * 0.9995 * (0.65 / 0.35)).toFixed(1));
    const spentKgH = Math.max(0, p3.spentHclFeedKgH);
    const wSpent = Math.max(0.01, Math.min(0.30, p3.spentHclConcWt / 100));

    const patchDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'h1a_f_cl2') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ Cl2: Number(cl2KgH.toFixed(1)), O2: o2ImpKgH }) } };
        }
        if (d.id === 'h1a_f_h2') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2: h2KgH }) } };
        }
        if (d.id === 's100_in_mix') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ Cl2: Number(cl2KgH.toFixed(1)), H2: h2KgH, O2: o2ImpKgH }) } };
        }
        if (d.id === 'h1a_sp105' || d.id === 's100_sp') {
          return { ...d, params: { ...d.params, splitRatioTop: splitFrac } };
        }
        if (d.id === 'h1a_f_upw') {
          return { ...d, params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2O: upwKgH }) } };
        }
        if (d.id === 'h1a_e225' || d.id === 's200_e225') {
          return { ...d, params: { ...d.params, operTempC: p3.liquefierTempC } };
        }
        if (d.id === 'h1a_f_spent' || d.id === 's300_feed') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({
                HCl: Number((spentKgH * wSpent).toFixed(1)),
                H2O: Number((spentKgH * (1 - wSpent)).toFixed(1)),
              }),
            },
          };
        }
        if (d.id === 'h1a_c310' || d.id === 's300_c310') {
          return {
            ...d,
            params: {
              ...d.params,
              distillConfig: { ...(d.params.distillConfig ?? {}), topPressKgcm2g: p3.vacColPressKg },
            },
          };
        }
        return d;
      });

    if (Array.isArray(parsed.simDefs)) parsed.simDefs = patchDefs(parsed.simDefs);
    if (parsed.hierarchySheets && typeof parsed.hierarchySheets === 'object') {
      for (const k of Object.keys(parsed.hierarchySheets)) {
        if (Array.isArray(parsed.hierarchySheets[k]?.simDefs)) {
          parsed.hierarchySheets[k].simDefs = patchDefs(parsed.hierarchySheets[k].simDefs);
        }
      }
    }
    window.localStorage.setItem(PLANT03_SAVE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

/** 비-PFD 화면(장치목록 등)에서 PLANT 04(CMS) 사이드바 운전변수 조절 시 저장소 즉시 동기화 */
function patchStoredCmsFlowsheet(cms: CmsPlantOperatingInputs) {
  if (typeof window === 'undefined') return;
  try {
    const baseSheets = createInitialCmsHierarchySheets();
    const raw = window.localStorage.getItem(PLANT05_SAVE_KEY);
    const parsed = raw
      ? JSON.parse(raw)
      : { hierarchySheets: baseSheets, savedAt: 'CMS 운전변수 실시간 동기화' };

    const cl2FeedKgH = Number(((Math.max(20, cms.cl2FeedTonDay) * 1000) / 24).toFixed(2));
    const cmsSum = calculateCmsPlantSummary(cms);
    const freshMcKgH = Number(cmsSum.freshMcKgH.toFixed(2));
    const totalMcKgH = Number((cmsSum.freshMcKgH + cmsSum.recycleMcKgH).toFixed(2));
    const aibnScale = Math.sqrt(Math.max(50, cms.aibnDosagePpm) / 350);

    const baseK0Map = new Map<string, number>();
    for (const sh of Object.values(baseSheets)) {
      for (const node of sh.simDefs) {
        if (node.params?.reactorConfig?.reactions) {
          node.params.reactorConfig.reactions.forEach((rx, idx) => {
            if (typeof rx.k0Forward === 'number') {
              baseK0Map.set(`${node.id}:${rx.id || idx}`, rx.k0Forward);
            }
          });
        }
      }
    }

    const patchDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'cms_m_cl2' || d.id === 'cms1_cl2') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), Cl2: cl2FeedKgH },
            },
          };
        }
        if (d.id === 'cms_m_mc' || d.id === 'cms1_mc') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                CH3Cl: d.id === 'cms1_mc' ? totalMcKgH : freshMcKgH,
              },
            },
          };
        }
        if (d.id === 'cms_m_r101' || d.id === 'cms1_r101') {
          const prevRx = d.params.reactorConfig;
          const nextReactions = prevRx?.reactions?.map((rx, idx) => {
            if (typeof rx.k0Forward !== 'number') return rx;
            const baseK0 = baseK0Map.get(`${d.id}:${rx.id || idx}`) ?? rx.k0Forward;
            return { ...rx, k0Forward: Number((baseK0 * aibnScale).toPrecision(6)) };
          });
          return {
            ...d,
            params: {
              ...d.params,
              operTempC: cms.reactorTempC,
              operPressKgcm2g: cms.reactorPressKgcm2g,
              ...(prevRx
                ? {
                    reactorConfig: {
                      ...prevRx,
                      operTempC: cms.reactorTempC,
                      operPressKgcm2g: cms.reactorPressKgcm2g,
                      ...(nextReactions ? { reactions: nextReactions } : {}),
                    },
                  }
                : {}),
            },
          };
        }
        if (d.id === 'cms_m_c201' || d.id === 'cms2_c201') {
          return {
            ...d,
            params: {
              ...d.params,
              operPressKgcm2g: cms.hclStripperPressKg,
              distillConfig: {
                ...(d.params.distillConfig ?? {}),
                topPressKgcm2g: cms.hclStripperPressKg,
              },
            },
          };
        }
        return d;
      });

    if (Array.isArray(parsed.simDefs)) parsed.simDefs = patchDefs(parsed.simDefs);
    if (parsed.hierarchySheets && typeof parsed.hierarchySheets === 'object') {
      for (const k of Object.keys(parsed.hierarchySheets)) {
        if (Array.isArray(parsed.hierarchySheets[k]?.simDefs)) {
          parsed.hierarchySheets[k].simDefs = patchDefs(parsed.hierarchySheets[k].simDefs);
        }
      }
    }
    window.localStorage.setItem(PLANT05_SAVE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

/** 비-PFD 화면(장치목록 등)에서 PLANT 05(MDI) 사이드바 운전변수 조절 시 저장소 즉시 동기화 */
function patchStoredMdiFlowsheet(mdi: MdiPlantOperatingInputs) {
  if (typeof window === 'undefined') return;
  try {
    const baseSheets = createInitialMdiHierarchySheets();
    const raw = window.localStorage.getItem(PLANT06_MDI_SAVE_KEY);
    const parsed = raw
      ? JSON.parse(raw)
      : { hierarchySheets: baseSheets, savedAt: 'MDI 운전변수 실시간 동기화' };

    const mdiSum = calculateMdiPlantSummary(mdi);
    const capScale = Math.max(20, mdi.annualCapacityKta) / 100.0;
    const pureShareFrac = Math.max(0.15, Math.min(0.65, mdi.pureMdiSharePct / 100));
    const anilRatioScale = Math.max(0.5, mdi.anilineToHchoRatio / 3.2);
    const phosScale = Math.max(0.5, (1 + mdi.phosgeneExcessPct / 100) / 2.0);
    const mcbScale = Math.max(0.5, mdi.mcbSolventRatio / 2.5);
    const vacPressKg = Math.max(
      -0.99,
      Math.min(-0.8, Number((mdi.vacColTopMbar / 1000 - 1.01325).toFixed(3)))
    );

    const patchDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'mdi_f_anil' || d.id === 'mdi1_anil') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                Aniline: Number((mdiSum.anilineFreshKgH * (0.98 + 0.03 * anilRatioScale)).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_hcho' || d.id === 'mdi1_hcho') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                HCHO: Number((mdiSum.formalin37KgH * 0.37).toFixed(1)),
                H2O: Number((mdiSum.formalin37KgH * 0.63).toFixed(1)),
                HCl: Number((1200.0 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_naoh' || d.id === 'mdi1_naoh') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                NaOH: Number((1316.4 * capScale).toFixed(1)),
                H2O: Number((3071.6 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_co' || d.id === 'mdi2_co') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), CO: Number((mdiSum.coFreshKgH * phosScale).toFixed(1)) },
            },
          };
        }
        if (d.id === 'mdi_f_cl2' || d.id === 'mdi2_cl2') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), Cl2: Number((mdiSum.cl2FreshKgH * phosScale).toFixed(1)) },
            },
          };
        }
        if (d.id === 'mdi_f_mcb_mu') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), MCB: Number((1100.0 * capScale * mcbScale).toFixed(1)) },
            },
          };
        }
        if ((d.id === 'mdi_c302' || d.id === 'mdi3_c302') && d.params.distillConfig?.splitSpecType === 'bottoms_kgh') {
          return {
            ...d,
            params: {
              ...d.params,
              distillConfig: {
                ...d.params.distillConfig,
                splitSpecValue: Number((12320.0 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_c401' || d.id === 'mdi4_c401') {
          return {
            ...d,
            params: {
              ...d.params,
              operPressKgcm2g: vacPressKg,
              ...(d.params.distillConfig
                ? {
                    distillConfig: {
                      ...d.params.distillConfig,
                      topPressKgcm2g: vacPressKg,
                      ...(d.params.distillConfig.splitSpecType === 'd_over_f_mass'
                        ? { splitSpecValue: Number(pureShareFrac.toFixed(3)) }
                        : {}),
                    },
                  }
                : {}),
            },
          };
        }
        return d;
      });

    if (Array.isArray(parsed.simDefs)) parsed.simDefs = patchDefs(parsed.simDefs);
    if (parsed.hierarchySheets && typeof parsed.hierarchySheets === 'object') {
      for (const k of Object.keys(parsed.hierarchySheets)) {
        if (Array.isArray(parsed.hierarchySheets[k]?.simDefs)) {
          parsed.hierarchySheets[k].simDefs = patchDefs(parsed.hierarchySheets[k].simDefs);
        }
      }
    }
    window.localStorage.setItem(PLANT06_MDI_SAVE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export default function Sidebar() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const {
    activePlantId,
    setActivePlantId,
    expansionScaleFactor,
    setExpansionScaleFactor,
    simActiveSheetId,
    requestSimSheet,
    inputs,
    setInput,
    resetInputs,
    balance,
    plant02Inputs,
    plant02Balance,
    setPlant02Input,
    resetPlant02Inputs,
    plant03Inputs,
    plant03Summary,
    setPlant03Input,
    resetPlant03Inputs,
    cmsPlantInputs,
    cmsPlantSummary,
    setCmsPlantInput,
    resetCmsPlantInputs,
    mdiPlantInputs,
    mdiPlantSummary,
    setMdiPlantInput,
    resetMdiPlantInputs,
  } = useBalanceStore();

  const equipSubTab = usePFDStore(s => s.equipSubTab);
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [p02SheetsExpanded, setP02SheetsExpanded] = useState(true);
  const [p03SheetsExpanded, setP03SheetsExpanded] = useState(true);
  const [cmsSheetsExpanded, setCmsSheetsExpanded] = useState(true);
  const [mdiSheetsExpanded, setMdiSheetsExpanded] = useState(true);

  useEffect(() => {
    const checkViewport = () => {
      if (typeof window !== 'undefined') {
        const mob = window.innerWidth <= 768;
        setIsMobile(mob);
        if (window.innerWidth < 960 && !mob) {
          setCollapsed(true);
        }
      }
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  const isPfdLikeRoute = pathname === '/' || pathname.startsWith('/material-balance');
  const isPlantDomain =
    activePlantId !== 'new_builder' &&
    activePlantId !== 'classic_sim' &&
    (isPfdLikeRoute || pathname.startsWith('/equipment-design'));
  if (!isPlantDomain) {
    return null;
  }

  const isOnEquipPage = pathname.startsWith('/equipment-design');

  // 공장 ID를 덮어쓰지 않고 현재 공장을 유지한 채 서브 메뉴 이동
  const handleMenuNavigate = (item: NavMenuItem, keepPlantId: PlantId) => {
    setMobileDrawerOpen(false);
    setActivePlantId(keepPlantId);
    if (item.href) {
      router.push(item.href);
      return;
    }
    if (item.isPfd) {
      router.push('/material-balance');
    } else {
      setEquipSubTab(item.key);
      if (!isOnEquipPage) {
        router.push(`/equipment-design?tab=${item.key}`);
      } else if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', item.key);
        window.history.replaceState({}, '', url.toString());
      }
    }
  };

  const handleP02Change = (key: keyof ElectrolyzerInputs, val: number) => {
    setPlant02Input(key, val);
    if (!isPfdLikeRoute) {
      patchStoredPlant02Flowsheet({ ...plant02Inputs, [key]: val });
    }
  };

  const handleP03Change = (key: keyof Plant03OperatingInputs, val: number) => {
    setPlant03Input(key, val);
    if (!isPfdLikeRoute) {
      patchStoredPlant03Flowsheet({ ...plant03Inputs, [key]: val });
    }
  };

  const handleCmsChange = (key: keyof CmsPlantOperatingInputs, val: number) => {
    setCmsPlantInput(key, val);
    if (!isPfdLikeRoute) {
      patchStoredCmsFlowsheet({ ...cmsPlantInputs, [key]: val });
    }
  };

  const handleMdiChange = (key: keyof MdiPlantOperatingInputs, val: number) => {
    setMdiPlantInput(key, val);
    if (!isPfdLikeRoute) {
      patchStoredMdiFlowsheet({ ...mdiPlantInputs, [key]: val });
    }
  };

  // PLANT 01과 PLANT 02가 100% 동일한 전해조 운전 파라미터 + 실시간 물질수지 생산량 대시보드를 공유
  const renderChlorAlkaliOperatingAndKpi = (
    curInputs: ElectrolyzerInputs,
    curBalance: typeof balance,
    onChangeParam: (key: keyof ElectrolyzerInputs, val: number) => void,
    onReset: () => void,
    isLiveSimSync?: boolean
  ) => {
    const { summary: curSum, electrolyzerResult: curElec } = curBalance;
    return (
      <>
        <div style={{ padding: '6px 14px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                color: '#1A2F44',
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
              }}
            >
              전해조 운전 파라미터 {isLiveSimSync ? '(시뮬 연동)' : ''}
            </span>
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: '1.5px 6px',
                borderRadius: 4,
                border: '1px solid #D5D2C8',
                background: '#FAF9F5',
                color: '#5A6570',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              초기화
            </button>
          </div>

          <ControlRow
            label="전해조 수량" unit="기"
            value={curInputs.numElectrolyzers}
            min={1} max={20} step={1}
            onChange={v => onChangeParam('numElectrolyzers', v)}
          />
          <ControlRow
            label="셀 수량" unit="셀/전해조"
            value={curInputs.cellsPerElectrolyzer}
            min={50} max={500} step={1}
            onChange={v => onChangeParam('cellsPerElectrolyzer', v)}
          />
          <ControlRow
            label="운전 전류" unit="kA"
            value={curInputs.operatingCurrentKA}
            min={1} max={30} step={0.1}
            onChange={v => onChangeParam('operatingCurrentKA', v)}
          />
          <ControlRow
            label="전류 효율 (CE)" unit="%"
            value={curInputs.currentEfficiency * 100}
            min={80} max={99} step={0.1}
            onChange={v => onChangeParam('currentEfficiency', v / 100)}
          />
          <ControlRow
            label="출구 브라인 농도" unit="wt%"
            value={curInputs.anolyteExitConcWt ?? 17.45}
            min={15.5} max={20.5} step={0.05}
            onChange={v => onChangeParam('anolyteExitConcWt', v)}
          />
          <ControlRow
            label="출구 가성소다 농도" unit="wt%"
            value={curInputs.catholyteConcWt ?? 32.34}
            min={30.0} max={34.5} step={0.05}
            onChange={v => onChangeParam('catholyteConcWt', v)}
          />
          <ControlRow
            label="전해조 운전온도" unit="°C"
            value={curInputs.electrolyzerTempC ?? 89.0}
            min={75.0} max={95.0} step={0.5}
            onChange={v => onChangeParam('electrolyzerTempC', v)}
          />

          <div
            style={{
              marginTop: 6,
              padding: '8px 10px',
              borderRadius: 8,
              background: '#EFECE5',
              border: '1px solid #DFDCD4',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: '#5A6570', fontWeight: 700, marginBottom: 2 }}>
                총 셀수 ({curInputs.numElectrolyzers}기 합산)
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#1A2F44',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: 1,
                }}
              >
                {(curInputs.numElectrolyzers * curInputs.cellsPerElectrolyzer).toLocaleString()}
                <span style={{ fontSize: 9, color: '#5A6570', marginLeft: 3 }}>PCS</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#5A6570', fontWeight: 700, marginBottom: 2 }}>
                DC 소비전력 ({curElec.cellVoltageV?.toFixed(2) ?? '3.05'}V)
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#0F5338',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: 1,
                }}
              >
                {(curElec.totalDcPowerMW ?? 0).toFixed(2)}
                <span style={{ fontSize: 9, color: '#5A6570', marginLeft: 3 }}>MW</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: '#E5E2DC', margin: '10px 0' }} />

        <div style={{ padding: '0 14px 14px' }}>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              color: '#1A2F44',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginBottom: 8,
            }}
          >
            실시간 물질수지 생산량
          </div>

          <SummaryCard
            label="Cl₂ 생산량"
            main={`${curSum.cl2_tonDay.toFixed(1)} ton/일`}
            sub={`${curElec.cl2ProductionKgH.toFixed(0)} kg/h`}
            highlight
          />
          <SummaryCard
            label="NaOH 32% (용액)"
            main={`${curSum.naoh32_tonDay.toFixed(1)} ton/일`}
            sub={`${((curSum.naoh32_tonDay / 24) * 1000).toFixed(0)} kg/h`}
          />
          <SummaryCard
            label="NaOH 50% (농축제품)"
            main={`${curSum.naoh50_tonDay.toFixed(1)} ton/일`}
            sub={`드라이 ${curElec.naohProductionKgH.toFixed(0)} kg/h`}
            highlight
          />
          <SummaryCard
            label="H₂ 생산량"
            main={`${curSum.h2_tonDay.toFixed(2)} ton/일`}
            sub={`${curElec.h2ProductionKgH.toFixed(1)} kg/h`}
          />
          <SummaryCard
            label="NaCl 소모"
            main={`${curSum.naclUsage_tonDay.toFixed(1)} ton/일`}
            sub={`소금 ${curSum.saltUsage_tonDay.toFixed(1)} ton/일`}
          />
        </div>
      </>
    );
  };

  // PLANT 03 전용 Capa 운전변수 + 실시간 생산량 대시보드
  const renderPlant03OperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              color: '#1A2F44',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            1A 공정 운전 · CAPA 변수
          </span>
          <button
            type="button"
            onClick={() => {
              resetPlant03Inputs();
            }}
            style={{
              padding: '1.5px 6px',
              borderRadius: 4,
              border: '1px solid #D5D2C8',
              background: '#FAF9F5',
              color: '#5A6570',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="원료 Cl₂ 공급량" unit="kg/h"
          value={plant03Inputs.cl2FeedKgH}
          min={500} max={10000} step={50}
          onChange={v => handleP03Change('cl2FeedKgH', v)}
        />
        <ControlRow
          label="합성 H₂ 과잉률" unit="%"
          value={plant03Inputs.h2ExcessPct}
          min={1.0} max={12.0} step={0.2}
          onChange={v => handleP03Change('h2ExcessPct', v)}
        />
        <ControlRow
          label="5N 무수 분배율" unit="%"
          value={plant03Inputs.ahclSplitPct}
          min={10} max={85} step={1}
          onChange={v => handleP03Change('ahclSplitPct', v)}
        />
        <ControlRow
          label="심냉액화 온도" unit="°C"
          value={plant03Inputs.liquefierTempC}
          min={-38} max={-10} step={1}
          onChange={v => handleP03Change('liquefierTempC', v)}
        />
        <ControlRow
          label="폐염산 유입량" unit="kg/h"
          value={plant03Inputs.spentHclFeedKgH}
          min={0} max={12000} step={100}
          onChange={v => handleP03Change('spentHclFeedKgH', v)}
        />
        <ControlRow
          label="폐염산 유입농도" unit="wt%"
          value={plant03Inputs.spentHclConcWt}
          min={8.0} max={20.0} step={0.5}
          onChange={v => handleP03Change('spentHclConcWt', v)}
        />
        <ControlRow
          label="진공탑(C-310) 압력" unit="kG"
          value={plant03Inputs.vacColPressKg}
          min={-0.93} max={-0.70} step={0.01}
          onChange={v => handleP03Change('vacColPressKg', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#EFECE5',
            border: '1px solid #DFDCD4',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 9, color: '#5A6570', fontWeight: 700, marginBottom: 2 }}>
              합성 HCl 총량
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: '#1A2F44',
                fontFamily: 'JetBrains Mono, monospace',
                lineHeight: 1,
              }}
            >
              {plant03Summary.synthHclTonDay.toFixed(1)}
              <span style={{ fontSize: 9, color: '#5A6570', marginLeft: 3 }}>T/D</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: '#5A6570', fontWeight: 700, marginBottom: 2 }}>
              동력 / 총 열부하
            </div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                color: '#0F766E',
                fontFamily: 'JetBrains Mono, monospace',
                lineHeight: 1,
              }}
            >
              {plant03Summary.elecPowerKW.toFixed(0)}
              <span style={{ fontSize: 8.5, color: '#5A6570', marginLeft: 2 }}>kW</span>
              <span style={{ fontSize: 9, color: '#7A7872' }}> · {plant03Summary.thermalDutyMW.toFixed(2)}MW</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E5E2DC', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color: '#1A2F44',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (1A CAPA)
        </div>

        <SummaryCard
          label="5N 무수염산 (AHCl)"
          main={`${plant03Summary.ahcl5nTonDay.toFixed(1)} ton/일`}
          sub={`${plant03Summary.ahcl5nKgH.toFixed(0)} kg/h · 순도 99.999%`}
          highlight
        />
        <SummaryCard
          label="전자급 35% 고순도 염산"
          main={`${plant03Summary.hcl35SolTonDay.toFixed(1)} ton/일`}
          sub={`100% HCl 환산 ${plant03Summary.hcl35PureTonDay.toFixed(1)} T/D`}
          highlight
        />
        <SummaryCard
          label="PSD 청정 회수수 (C-310)"
          main={`${plant03Summary.psdCleanWaterTonDay.toFixed(1)} ton/일`}
          sub={`순환 HCl ${plant03Summary.psdRecycledHclKgH.toFixed(0)} kg/h 회수`}
        />
        <SummaryCard
          label="원료 Cl₂ / H₂ 소비"
          main={`${plant03Summary.cl2UsageTonDay.toFixed(1)} ton/일`}
          sub={`수소 ${plant03Summary.h2UsageTonDay.toFixed(2)} ton/일 (${plant03Summary.h2FeedKgH.toFixed(1)} kg/h)`}
        />
        <SummaryCard
          label="부생 폐염산 처리량"
          main={`${plant03Summary.spentFeedTonDay.toFixed(1)} ton/일`}
          sub={`${plant03Inputs.spentHclConcWt.toFixed(1)} wt% 폐산 공비회수`}
        />
      </div>
    </>
  );

  // PLANT 04 (CMS) 전용 운전변수 + 실시간 생산량·열부하 대시보드
  const renderCmsOperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              color: '#1A2F44',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            CMS 공정 운전 · 반응 변수
          </span>
          <button
            type="button"
            onClick={() => {
              resetCmsPlantInputs();
            }}
            style={{
              padding: '1.5px 6px',
              borderRadius: 4,
              border: '1px solid #D5D2C8',
              background: '#FAF9F5',
              color: '#5A6570',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="액체 Cl₂ 투입량" unit="T/D"
          value={cmsPlantInputs.cl2FeedTonDay}
          min={50} max={500} step={5}
          onChange={v => handleCmsChange('cl2FeedTonDay', v)}
        />
        <ControlRow
          label="MC/Cl₂ 몰비" unit="mol"
          value={cmsPlantInputs.mcCl2MolarRatio}
          min={1.2} max={4.0} step={0.02}
          onChange={v => handleCmsChange('mcCl2MolarRatio', v)}
        />
        <ControlRow
          label="R-101 반응온도" unit="°C"
          value={cmsPlantInputs.reactorTempC}
          min={90} max={150} step={1}
          onChange={v => handleCmsChange('reactorTempC', v)}
        />
        <ControlRow
          label="R-101 압력" unit="kG"
          value={cmsPlantInputs.reactorPressKgcm2g}
          min={12} max={35} step={0.5}
          onChange={v => handleCmsChange('reactorPressKgcm2g', v)}
        />
        <ControlRow
          label="AIBN 농도" unit="wt ppm"
          value={cmsPlantInputs.aibnDosagePpm}
          min={100} max={1000} step={25}
          onChange={v => handleCmsChange('aibnDosagePpm', v)}
        />
        <ControlRow
          label="C-201 탈거압력" unit="kG"
          value={cmsPlantInputs.hclStripperPressKg}
          min={10} max={24} step={0.5}
          onChange={v => handleCmsChange('hclStripperPressKg', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#ECFEFF',
            border: '1px solid #A5F3FC',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#155E75', fontWeight: 700 }}>
              Cl₂ 전환율 / 동력
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0E7490', fontFamily: 'JetBrains Mono, monospace' }}>
              {cmsPlantSummary.cl2ConversionPct.toFixed(2)}% · {cmsPlantSummary.elecPowerKW.toFixed(0)} kW
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #A5F3FC', paddingTop: 4 }}>
            <span style={{ fontSize: 9, color: '#155E75', fontWeight: 700 }}>
              E-101 기화 / R-101 제열 / 리보일러
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1A2F44', fontFamily: 'JetBrains Mono, monospace' }}>
              {cmsPlantSummary.vaporizerDutyMW.toFixed(2)} / {cmsPlantSummary.reactorCoolingMW.toFixed(2)} / {cmsPlantSummary.reboilerDutyMW.toFixed(2)} MW
            </span>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E5E2DC', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color: '#1A2F44',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (CMS CAPA)
        </div>

        <SummaryCard
          label="MCL (메틸렌클로라이드)"
          main={`${cmsPlantSummary.mclProdTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.mclProdKgH.toFixed(0)} kg/h · C-301 80단 정제 (99.99%)`}
          highlight
        />
        <SummaryCard
          label="CFM (클로로포름)"
          main={`${cmsPlantSummary.cfmProdTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.cfmProdKgH.toFixed(0)} kg/h · C-302 120단 정제 (99.99%)`}
          highlight
        />
        <SummaryCard
          label="무수 HCl (부생 가스)"
          main={`${cmsPlantSummary.ahclByprodTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.ahclByprodKgH.toFixed(0)} kg/h · C-201 (${cmsPlantInputs.hclStripperPressKg.toFixed(1)} kG)`}
        />
        <SummaryCard
          label="CTC·헤비 폐기 (C-302)"
          main={`${cmsPlantSummary.ctcHeavyWasteTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.ctcHeavyWasteKgH.toFixed(0)} kg/h · 잔류 CCl₄·헤비`}
        />
        <SummaryCard
          label="Fresh MC / 순환 MC"
          main={`${cmsPlantSummary.freshMcTonDay.toFixed(1)} ton/일`}
          sub={`순환 MC ${cmsPlantSummary.recycleMcTonDay.toFixed(1)} T/D (MCL 무순환)`}
        />
      </div>
    </>
  );

  // PLANT 05 (금호미쓰이 MDI 10만톤) 전용 운전변수 + 실시간 Pure/PMDI·부생HCl·MCB 수지 대시보드
  const renderMdiOperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              color: '#1A2F44',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            MDI 공정 운전 · 반응 변수
          </span>
          <button
            type="button"
            onClick={() => {
              resetMdiPlantInputs();
            }}
            style={{
              padding: '1.5px 6px',
              borderRadius: 4,
              border: '1px solid #D5D2C8',
              background: '#FAF9F5',
              color: '#5A6570',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="연간 생산규모" unit="kTA"
          value={mdiPlantInputs.annualCapacityKta}
          min={20} max={300} step={5}
          showSlider
          onChange={v => handleMdiChange('annualCapacityKta', v)}
        />
        <ControlRow
          label="Pure 4,4'-MDI 비율" unit="wt%"
          value={mdiPlantInputs.pureMdiSharePct}
          min={15} max={65} step={1}
          showSlider
          onChange={v => handleMdiChange('pureMdiSharePct', v)}
        />
        <ControlRow
          label="Aniline/HCHO 몰비" unit="mol"
          value={mdiPlantInputs.anilineToHchoRatio}
          min={2.2} max={5.0} step={0.1}
          showSlider
          onChange={v => handleMdiChange('anilineToHchoRatio', v)}
        />
        <ControlRow
          label="포스겐 과잉률" unit="%"
          value={mdiPlantInputs.phosgeneExcessPct}
          min={30} max={200} step={5}
          showSlider
          onChange={v => handleMdiChange('phosgeneExcessPct', v)}
        />
        <ControlRow
          label="MCB 용매/MDA 비" unit="wt/wt"
          value={mdiPlantInputs.mcbSolventRatio}
          min={1.5} max={4.0} step={0.1}
          showSlider
          onChange={v => handleMdiChange('mcbSolventRatio', v)}
        />
        <ControlRow
          label="C-401 고진공 압력" unit="mbar"
          value={mdiPlantInputs.vacColTopMbar}
          min={5} max={50} step={1}
          showSlider
          onChange={v => handleMdiChange('vacColTopMbar', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#92400E', fontWeight: 700 }}>
              소요 전력 / 총 열부하
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#B45309', fontFamily: 'JetBrains Mono, monospace' }}>
              {mdiPlantSummary.elecPowerKW.toFixed(0)} kW · {mdiPlantSummary.thermalDutyMW.toFixed(1)} MW
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #FCD34D', paddingTop: 4 }}>
            <span style={{ fontSize: 9, color: '#92400E', fontWeight: 700 }}>
              Aniline / Cl₂ / CO
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1A2F44', fontFamily: 'JetBrains Mono, monospace' }}>
              {mdiPlantSummary.anilineFreshKgH.toFixed(0)} / {mdiPlantSummary.cl2FreshKgH.toFixed(0)} / {mdiPlantSummary.coFreshKgH.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E5E2DC', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color: '#1A2F44',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (MDI CAPA)
        </div>

        <SummaryCard
          label="Pure 4,4'-MDI (고진공 탑정)"
          main={`${(mdiPlantSummary.pureMdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.pureMdiTonDay.toFixed(1)} T/D`}
          sub={`${mdiPlantSummary.pureMdiKgH.toFixed(0)} kg/h · C-401 (${mdiPlantInputs.pureMdiSharePct.toFixed(0)} wt%)`}
          highlight
        />
        <SummaryCard
          label="Polymeric MDI (PMDI 탑저)"
          main={`${(mdiPlantSummary.pmdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.pmdiTonDay.toFixed(1)} T/D`}
          sub={`${mdiPlantSummary.pmdiKgH.toFixed(0)} kg/h · C-401 (20 mbar 고진공)`}
          highlight
        />
        <SummaryCard
          label="총 MDI 생산규모 (100,000 TPA)"
          main={`${(mdiPlantSummary.annualCapacityKta * 1000).toLocaleString()} TPA`}
          sub={`${(mdiPlantSummary.totalMdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.totalMdiTonDay.toFixed(1)} T/D (8,000 hr/yr)`}
        />
        <SummaryCard
          label="부생 무수 HCl 회수"
          main={`${mdiPlantSummary.byproductHclTonDay.toFixed(1)} ton/일`}
          sub={`${mdiPlantSummary.byproductHclKgH.toFixed(0)} kg/h · S-201 탈거 (Plant 02 연계)`}
        />
        <SummaryCard
          label="MCB 용매 순환량 (C-302)"
          main={`${(mdiPlantSummary.mcbRecycleKgH / 1000).toFixed(2)} t/h`}
          sub={`${mdiPlantSummary.mcbRecycleKgH.toFixed(0)} kg/h · 용매/MDA 비 ${mdiPlantInputs.mcbSolventRatio.toFixed(1)}×`}
        />
      </div>
    </>
  );

  if (isMobile) {
    const mobileMenus =
      activePlantId === 'clorsim' || activePlantId === 'clorsim_sim'
        ? CA_SUB_MENUS
        : activePlantId === 'hcl_synth'
          ? PLANT03_SUB_MENUS
          : activePlantId === 'ech_gte'
            ? PLANT04_ECH_SUB_MENUS
            : activePlantId === 'cms_plant'
              ? CMS_SUB_MENUS
              : activePlantId === 'mdi_plant'
                ? MDI_SUB_MENUS
                : [];

    return (
      <>
        <div
          className="mobile-plant-subbar"
          style={{
            width: '100%',
            background: '#FFFFFF',
            borderBottom: '1px solid #E5E2DC',
            padding: '5px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            overflowX: 'auto',
            flexShrink: 0,
            zIndex: 40,
          }}
        >
          {(activePlantId === 'clorsim' || activePlantId === 'clorsim_sim' || activePlantId === 'hcl_synth' || activePlantId === 'cms_plant' || activePlantId === 'mdi_plant') && (
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(v => !v)}
              style={{
                padding: '5px 10px',
                borderRadius: 14,
                background: '#EFECE5',
                border: '1px solid #1A2F44',
                color: '#1A2F44',
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ⚙ 운전변수·생산량
            </button>
          )}
          {mobileMenus.map(item => {
            const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleMenuNavigate(item, activePlantId)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 14,
                  background: active ? '#1A2F44' : '#F6F7F2',
                  border: active ? '1px solid #1A2F44' : '1px solid #DFDCD4',
                  color: active ? '#FFFFFF' : '#2C353E',
                  fontSize: 11,
                  fontWeight: active ? 800 : 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {mobileDrawerOpen && (
          <div
            onClick={() => setMobileDrawerOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(26, 47, 68, 0.45)',
              zIndex: 300,
              display: 'flex',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '86%',
                maxWidth: 320,
                height: '100%',
                background: '#FFFFFF',
                borderRight: '1px solid #E5E2DC',
                overflowY: 'auto',
                padding: '12px 4px',
                boxShadow: '4px 0 20px rgba(26, 47, 68, 0.22)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px 8px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44' }}>운전 파라미터 &amp; 실시간 생산량</div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: '#1A2F44',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  닫기 ✕
                </button>
              </div>
              {activePlantId === 'clorsim' &&
                renderChlorAlkaliOperatingAndKpi(inputs, balance, setInput, resetInputs, false)}
              {activePlantId === 'clorsim_sim' && (
                <>
                  {renderChlorAlkaliOperatingAndKpi(plant02Inputs, plant02Balance, handleP02Change, resetPlant02Inputs, true)}
                  <div style={{ margin: '0 14px 12px', padding: '7px 9px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #CBD5E1', fontSize: 9.5, color: '#334155', lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 800, color: '#0F5338', marginBottom: 2 }}>
                      기준공장(468 T/D) 참고 비교
                    </div>
                    <div>
                      Cl₂: {plant02Balance.summary.cl2_tonDay.toFixed(1)} vs {balance.summary.cl2_tonDay.toFixed(1)} T/D (
                      {plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay >= 0 ? '+' : ''}
                      {(plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay).toFixed(1)})
                    </div>
                    <div>
                      NaOH 50%: {plant02Balance.summary.naoh50_tonDay.toFixed(1)} vs {balance.summary.naoh50_tonDay.toFixed(1)} T/D
                    </div>
                  </div>
                </>
              )}
              {activePlantId === 'hcl_synth' && renderPlant03OperatingAndKpi()}
              {activePlantId === 'cms_plant' && renderCmsOperatingAndKpi()}
              {activePlantId === 'mdi_plant' && renderMdiOperatingAndKpi()}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <nav
      className="sidebar"
      style={{
        width: collapsed ? 44 : 228,
        transition: 'width 0.22s ease',
        flexShrink: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#FFFFFF',
        borderRight: '1px solid #E5E2DC',
        position: 'relative',
      }}
    >
      {/* ─── 접기/펼치기 버튼 ─── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '패널 펼치기' : '패널 접기'}
        style={{
          position: 'absolute',
          top: 8,
          right: 6,
          zIndex: 10,
          width: 26,
          height: 26,
          borderRadius: 6,
          background: '#EFECE5',
          border: '1px solid #DFDCD4',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#1A2F44',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          {collapsed ? (
            <path d="M3 6h6M7 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M9 6H3M5 3L2 6l3 3" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 01 (전해 기준공장) 좌측 사이드 패널
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'clorsim' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#1A2F44',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 2,
              }}
            >
              PLANT 01 · 전해공장 메뉴
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              공정도 · 농축 · 정제 · 기기목록 이동
            </div>

            {CA_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <MenuButton
                  key={item.key}
                  label={item.label}
                  badge={item.badge}
                  active={active}
                  onClick={() => handleMenuNavigate(item, 'clorsim')}
                />
              );
            })}
          </div>

          <div style={{ height: 1, background: '#E5E2DC', margin: '6px 0' }} />

          {renderChlorAlkaliOperatingAndKpi(inputs, balance, setInput, resetInputs, false)}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 02 (전해공장 시뮬레이터) 좌측 사이드 패널 — PLANT 01과 동일 구성 + 시트 연동
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'clorsim_sim' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#1A2F44',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PLANT 01 · 전해공장 메뉴
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#DCFCE7',
                  color: '#065F46',
                  border: '1px solid #86EFAC',
                }}
              >
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              공정도 · 농축 · 정제 · 기기목록 이동
            </div>

            {CA_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <React.Fragment key={item.key}>
                  <MenuButton
                    label={item.label}
                    badge={item.badge}
                    active={active}
                    onClick={() => handleMenuNavigate(item, 'clorsim_sim')}
                  />
                  {/* 공정도 항목 바로 아래에 100~700 세부시트 빠른 선택기 배치 */}
                  {item.isPfd && (
                    <div
                      style={{
                        margin: '2px 0 6px',
                        padding: '6px 7px',
                        borderRadius: 10,
                        background: '#FAF9F5',
                        border: '1px solid #E5E2DC',
                      }}
                    >
                      <div
                        onClick={() => setP02SheetsExpanded(v => !v)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#1E3A8A',
                          cursor: 'pointer',
                          marginBottom: p02SheetsExpanded ? 5 : 0,
                        }}
                      >
                        <span>세부공정 시트 이동 (100~700)</span>
                        <span style={{ fontSize: 9, color: '#64748B' }}>{p02SheetsExpanded ? '▲' : '▼'}</span>
                      </div>
                      {p02SheetsExpanded && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3.5 }}>
                          {PLANT02_SIM_MENUS.map(sh => {
                            const shActive = isPfdLikeRoute && simActiveSheetId === sh.sheetId;
                            return (
                              <button
                                key={sh.sheetId}
                                type="button"
                                title={sh.label}
                                onClick={() => {
                                  requestSimSheet(sh.sheetId);
                                  if (!isPfdLikeRoute) router.push('/material-balance');
                                }}
                                style={{
                                  padding: '2.5px 6px',
                                  borderRadius: 6,
                                  border: shActive ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                                  background: shActive ? '#1E3A8A' : '#FFFFFF',
                                  color: shActive ? '#FFFFFF' : '#334155',
                                  fontSize: 9.5,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {sh.badge}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ height: 1, background: '#E5E2DC', margin: '6px 0' }} />

          {renderChlorAlkaliOperatingAndKpi(
            plant02Inputs,
            plant02Balance,
            handleP02Change,
            resetPlant02Inputs,
            true
          )}
          <div style={{ margin: '0 14px 12px', padding: '7px 9px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #CBD5E1', fontSize: 9.5, color: '#334155', lineHeight: 1.45 }}>
            <div style={{ fontWeight: 800, color: '#0F5338', marginBottom: 2 }}>
              기준공장(468 T/D) 참고 비교
            </div>
            <div>
              Cl₂: {plant02Balance.summary.cl2_tonDay.toFixed(1)} vs {balance.summary.cl2_tonDay.toFixed(1)} T/D (
              {plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay >= 0 ? '+' : ''}
              {(plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay).toFixed(1)})
            </div>
            <div>
              NaOH 50%: {plant02Balance.summary.naoh50_tonDay.toFixed(1)} vs {balance.summary.naoh50_tonDay.toFixed(1)} T/D
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 03 (1A 초고순도·무수염산 & 폐염산 공비회수) 좌측 사이드 패널
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'hcl_synth' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#1A2F44',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PLANT 02 · 1A 염산공장 메뉴
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#DCFCE7',
                  color: '#065F46',
                  border: '1px solid #86EFAC',
                }}
              >
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              공정도 · 내장설계 · 기기목록 · 경제성 이동
            </div>

            {PLANT03_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <React.Fragment key={item.key}>
                  <MenuButton
                    label={item.label}
                    badge={item.badge}
                    active={active}
                    onClick={() => handleMenuNavigate(item, 'hcl_synth')}
                  />
                  {item.isPfd && (
                    <div
                      style={{
                        margin: '2px 0 6px',
                        padding: '6px 7px',
                        borderRadius: 10,
                        background: '#FAF9F5',
                        border: '1px solid #E5E2DC',
                      }}
                    >
                      <div
                        onClick={() => setP03SheetsExpanded(v => !v)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#0F766E',
                          cursor: 'pointer',
                          marginBottom: p03SheetsExpanded ? 5 : 0,
                        }}
                      >
                        <span>세부공정 시트 이동 (100~300)</span>
                        <span style={{ fontSize: 9, color: '#64748B' }}>{p03SheetsExpanded ? '▲' : '▼'}</span>
                      </div>
                      {p03SheetsExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {PLANT03_HCL1A_MENUS.map(sh => {
                            const shActive = isPfdLikeRoute && simActiveSheetId === sh.sheetId;
                            return (
                              <button
                                key={sh.sheetId}
                                type="button"
                                onClick={() => {
                                  requestSimSheet(sh.sheetId);
                                  if (!isPfdLikeRoute) router.push('/material-balance');
                                }}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '4px 7px',
                                  borderRadius: 6,
                                  border: shActive ? '1px solid #0F766E' : '1px solid #E2E8F0',
                                  background: shActive ? '#0F766E' : '#FFFFFF',
                                  color: shActive ? '#FFFFFF' : '#334155',
                                  fontSize: 10,
                                  fontWeight: shActive ? 800 : 700,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sh.label}
                                </span>
                                <span style={{ fontSize: 8.5, fontWeight: 900, marginLeft: 4 }}>{sh.badge}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ height: 1, background: '#E5E2DC', margin: '6px 0' }} />

          {renderPlant03OperatingAndKpi()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 04 (ECH 70,000 TPA · GTE 글리세린 공정) 좌측 사이드 패널
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'ech_gte' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#1A2F44',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PLANT 03 · ECH (7만톤 GTE)
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#DCFCE7',
                  color: '#065F46',
                  border: '1px solid #86EFAC',
                }}
              >
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              70,000 TPA (8.75 t/h) · 99.9 wt% ECH
            </div>

            {PLANT04_ECH_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <React.Fragment key={item.key}>
                  <MenuButton
                    label={item.label}
                    badge={item.badge}
                    active={active}
                    onClick={() => handleMenuNavigate(item, 'ech_gte')}
                  />
                  {item.isPfd && (
                    <div
                      style={{
                        margin: '2px 0 6px',
                        padding: '6px 7px',
                        borderRadius: 10,
                        background: '#FAF9F5',
                        border: '1px solid #E5E2DC',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#0F766E',
                          marginBottom: 5,
                        }}
                      >
                        세부공정 시트 이동 (100~300)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {PLANT04_ECH_SHEETS.map(sh => {
                          const shActive = isPfdLikeRoute && simActiveSheetId === sh.sheetId;
                          return (
                            <button
                              key={sh.sheetId}
                              type="button"
                              onClick={() => {
                                requestSimSheet(sh.sheetId);
                                if (!isPfdLikeRoute) router.push('/material-balance');
                              }}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '4px 7px',
                                borderRadius: 6,
                                border: shActive ? '1px solid #0F766E' : '1px solid #E2E8F0',
                                background: shActive ? '#0F766E' : '#FFFFFF',
                                color: shActive ? '#FFFFFF' : '#334155',
                                fontSize: 10,
                                fontWeight: shActive ? 800 : 700,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sh.label}
                              </span>
                              <span style={{ fontSize: 8.5, fontWeight: 900, marginLeft: 4 }}>{sh.badge}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 04 (CMS · 클로로메탄 공정 MCL 120 · CFM 80 T/D) 좌측 사이드 패널
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'cms_plant' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#1A2F44',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PLANT 04 · 클로로메탄(CMS)
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#CFFAFE',
                  color: '#155E75',
                  border: '1px solid #67E8F9',
                }}
              >
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              Cl₂ 220 · MCL 120 · CFM 80 T/D
            </div>

            {CMS_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <React.Fragment key={item.key}>
                  <MenuButton
                    label={item.label}
                    badge={item.badge}
                    active={active}
                    onClick={() => handleMenuNavigate(item, 'cms_plant')}
                  />
                  {item.isPfd && (
                    <div
                      style={{
                        margin: '2px 0 6px',
                        padding: '6px 7px',
                        borderRadius: 10,
                        background: '#FAF9F5',
                        border: '1px solid #E5E2DC',
                      }}
                    >
                      <div
                        onClick={() => setCmsSheetsExpanded(v => !v)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#0891B2',
                          cursor: 'pointer',
                          marginBottom: cmsSheetsExpanded ? 5 : 0,
                        }}
                      >
                        <span>세부공정 시트 이동 (100~300)</span>
                        <span style={{ fontSize: 9, color: '#64748B' }}>{cmsSheetsExpanded ? '▲' : '▼'}</span>
                      </div>
                      {cmsSheetsExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {CMS_SHEETS.map(sh => {
                            const shActive = isPfdLikeRoute && simActiveSheetId === sh.sheetId;
                            return (
                              <button
                                key={sh.sheetId}
                                type="button"
                                onClick={() => {
                                  requestSimSheet(sh.sheetId);
                                  if (!isPfdLikeRoute) router.push('/material-balance');
                                }}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '4px 7px',
                                  borderRadius: 6,
                                  border: shActive ? '1px solid #0891B2' : '1px solid #E2E8F0',
                                  background: shActive ? '#0891B2' : '#FFFFFF',
                                  color: shActive ? '#FFFFFF' : '#334155',
                                  fontSize: 10,
                                  fontWeight: shActive ? 800 : 700,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sh.label}
                                </span>
                                <span style={{ fontSize: 8.5, fontWeight: 900, marginLeft: 4 }}>{sh.badge}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ height: 1, background: '#E5E2DC', margin: '6px 0' }} />

          {renderCmsOperatingAndKpi()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PLANT 05 (금호미쓰이 MDI 10만톤 공정) 좌측 사이드 패널
          ═══════════════════════════════════════════════════════════════════════ */}
      {!collapsed && activePlantId === 'mdi_plant' && (
        <>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#1A2F44',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                PLANT 05 · 금호미쓰이 MDI
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: '#FEF3C7',
                  color: '#92400E',
                  border: '1px solid #FCD34D',
                }}
              >
                LIVE
              </span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#7A7872', marginBottom: 8 }}>
              100,000 TPA · Pure 108 · PMDI 192 T/D
            </div>

            {MDI_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <React.Fragment key={item.key}>
                  <MenuButton
                    label={item.label}
                    badge={item.badge}
                    active={active}
                    onClick={() => handleMenuNavigate(item, 'mdi_plant')}
                  />
                  {item.isPfd && (
                    <div
                      style={{
                        margin: '2px 0 6px',
                        padding: '6px 7px',
                        borderRadius: 10,
                        background: '#FAF9F5',
                        border: '1px solid #E5E2DC',
                      }}
                    >
                      <div
                        onClick={() => setMdiSheetsExpanded(v => !v)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#B45309',
                          cursor: 'pointer',
                          marginBottom: mdiSheetsExpanded ? 5 : 0,
                        }}
                      >
                        <span>세부공정 시트 이동 (100~400)</span>
                        <span style={{ fontSize: 9, color: '#64748B' }}>{mdiSheetsExpanded ? '▲' : '▼'}</span>
                      </div>
                      {mdiSheetsExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {MDI_SHEETS.map(sh => {
                            const shActive = isPfdLikeRoute && simActiveSheetId === sh.sheetId;
                            return (
                              <button
                                key={sh.sheetId}
                                type="button"
                                onClick={() => {
                                  requestSimSheet(sh.sheetId);
                                  if (!isPfdLikeRoute) router.push('/material-balance');
                                }}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '4px 7px',
                                  borderRadius: 6,
                                  border: shActive ? '1px solid #B45309' : '1px solid #E2E8F0',
                                  background: shActive ? '#B45309' : '#FFFFFF',
                                  color: shActive ? '#FFFFFF' : '#334155',
                                  fontSize: 10,
                                  fontWeight: shActive ? 800 : 700,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sh.label}
                                </span>
                                <span style={{ fontSize: 8.5, fontWeight: 900, marginLeft: 4 }}>{sh.badge}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ height: 1, background: '#E5E2DC', margin: '6px 0' }} />

          {renderMdiOperatingAndKpi()}
        </>
      )}

      {/* ─── 접힘(Collapsed) 아이콘 스트립 ─── */}
      {collapsed && (
        <div style={{ paddingTop: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, paddingBottom: 12 }}>
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 900,
              color: '#065F46',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: 6,
              padding: '2px 5px',
              marginBottom: 2,
            }}
          >
            {activePlantId === 'clorsim_sim'
              ? 'P01'
              : activePlantId === 'hcl_synth'
                ? 'P02'
                : activePlantId === 'ech_gte'
                  ? 'P03'
                  : activePlantId === 'cms_plant'
                    ? 'P04'
                    : 'P05'}
          </span>

          {(activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') &&
            CA_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleMenuNavigate(item, activePlantId)}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 26,
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    border: '1px solid #DFDCD4',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.badge.slice(0, 3)}
                </button>
              );
            })}

          {activePlantId === 'hcl_synth' &&
            PLANT03_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleMenuNavigate(item, 'hcl_synth')}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 26,
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    border: '1px solid #DFDCD4',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.badge.slice(0, 4)}
                </button>
              );
            })}

          {activePlantId === 'ech_gte' &&
            PLANT04_ECH_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleMenuNavigate(item, 'ech_gte')}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 26,
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    border: '1px solid #DFDCD4',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.badge.slice(0, 4)}
                </button>
              );
            })}

          {activePlantId === 'cms_plant' &&
            CMS_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleMenuNavigate(item, 'cms_plant')}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 26,
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    border: '1px solid #DFDCD4',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.badge.slice(0, 4)}
                </button>
              );
            })}

          {activePlantId === 'mdi_plant' &&
            MDI_SUB_MENUS.map(item => {
              const active = item.isPfd ? isPfdLikeRoute : isOnEquipPage && equipSubTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleMenuNavigate(item, 'mdi_plant')}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 26,
                    borderRadius: 7,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? '#FFFFFF' : '#1A2F44',
                    background: active ? '#1A2F44' : '#F6F7F2',
                    border: '1px solid #DFDCD4',
                    fontSize: 8.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {item.badge.slice(0, 4)}
                </button>
              );
            })}
        </div>
      )}
    </nav>
  );
}

function MenuButton({
  label,
  badge,
  active,
  onClick,
}: {
  label: string;
  badge: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        borderRadius: 16,
        marginBottom: 4,
        color: active ? '#FFFFFF' : '#2C353E',
        background: active ? '#1A2F44' : '#F6F7F2',
        border: active ? '1px solid #1A2F44' : '1px solid #E5E2DC',
        textAlign: 'left',
        fontSize: 11.2,
        fontWeight: active ? 800 : 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span
        style={{
          fontSize: 8.5,
          padding: '1px 6px',
          borderRadius: 10,
          background: active ? 'rgba(255,255,255,0.18)' : '#EFECE5',
          color: active ? '#FFFFFF' : '#1A2F44',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {badge}
      </span>
    </button>
  );
}

function ControlRow({
  label,
  unit,
  value,
  min,
  max,
  step,
  showSlider,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  display?: string;
  min: number;
  max: number;
  step: number;
  showSlider?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: showSlider ? 3 : 0,
        padding: '3px 0',
        marginBottom: 3,
        borderBottom: '1px dashed #EFECE5',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 10.5, color: '#2C353E', fontWeight: 600 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0))}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(v);
            }}
            style={{
              width: 64,
              height: 22,
              padding: '0 5px',
              borderRadius: 5,
              border: '1px solid #D5D2C8',
              background: '#F6F7F2',
              color: '#1A2F44',
              fontSize: 11.5,
              fontWeight: 800,
              textAlign: 'right',
              fontFamily: 'JetBrains Mono, monospace',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 9, color: '#7A7872', minWidth: 28 }}>{unit}</span>
        </div>
      </div>
      {showSlider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.max(min, Math.min(max, value))}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          style={{
            width: '100%',
            height: 4,
            accentColor: '#B45309',
            cursor: 'pointer',
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  main,
  sub,
  highlight,
}: {
  label: string;
  main: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 9px',
        borderRadius: 8,
        marginBottom: 4,
        background: highlight ? '#EFECE5' : '#F6F7F2',
        border: '1px solid #E5E2DC',
        borderLeft: `3px solid ${highlight ? '#1A2F44' : '#9AA2AA'}`,
      }}
    >
      <div>
        <div style={{ fontSize: 9.5, color: '#1A2F44', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 9, color: '#7A7872', marginTop: 1 }}>{sub}</div>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: '#1A2F44',
          fontFamily: 'JetBrains Mono, monospace',
          textAlign: 'right',
        }}
      >
        {main}
      </div>
    </div>
  );
}

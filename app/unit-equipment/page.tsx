'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import { PLANT_REGISTRY, getPlantRegistryItem, isPlantAllowed } from '@/lib/plantRegistry';
import {
  CHEMPRO_SIM_HANDOFF_KEY,
  ChemProSimHandoffPayload,
  buildChemProHandoffPayload,
} from '@/lib/calculations/unitDesignHandoff';
import {
  FlowNodeDef,
  FlowEdgeDef,
  createIdleFlowsheetResult,
} from '@/lib/calculations/flowsheetSolver';
import {
  SheetRuntimeData,
  createInitialHierarchySheets,
} from '@/lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '@/lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '@/lib/calculations/echPlantHierarchy';
import { createInitialCmsHierarchySheets } from '@/lib/calculations/cmsPlantHierarchy';
import { createInitialMdiHierarchySheets } from '@/lib/calculations/mdiPlantHierarchy';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PLANT02_SAVE_KEY = 'chemplant-plant02-electrolyzer-v2';
const PLANT03_SAVE_KEY = 'chemplant-plant03-hcl1a-v2';
const PLANT04_SAVE_KEY = 'chemplant-plant04-ech-v1';
const PLANT05_SAVE_KEY = 'chemplant-plant05-cms-v2';
const PLANT06_MDI_SAVE_KEY = 'chemplant-plant06-mdi-v1';
const BUILDER_SAVE_KEY = 'chemplant-newplant-builder-v1';
const CLASSIC_SAVE_KEY = 'chemplant-classic-sim-auto-v1';

interface PlantBridgeCandidate {
  id: string;
  label: string;
  summary: string;
  group: 'case' | 'example';
  payload: ChemProSimHandoffPayload;
}

function getTabKoLabel(tab: ChemProSimHandoffPayload['tab']): string {
  switch (tab) {
    case 'hx':
      return '열교환기';
    case 'pump':
      return '펌프';
    case 'column':
      return '탑/흡수/증류';
    case 'vessel':
      return '분리기/용기';
    case 'psv':
      return '안전밸브';
    default:
      return '배관';
  }
}

function UnitEquipmentInner() {
  const searchParams = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { user } = useAuth();
  const { activePlantId, balance } = useBalanceStore();
  const units = useUnitStore(s => s.units);
  const hydrateUnits = useUnitStore(s => s.hydrate);
  const plantMeta = getPlantRegistryItem(activePlantId);

  useEffect(() => {
    hydrateUnits();
  }, [hydrateUnits]);

  const allowedPlants = useMemo(
    () =>
      PLANT_REGISTRY.filter(
        p => !p.isSandbox && !p.hiddenFromSelector && isPlantAllowed(p.id, user)
      ).map(p => p.id),
    [user]
  );

  const [fallbackState, setFallbackState] = useState<{
    tab: string | null;
    handoff: boolean;
    ts: string;
  }>({ tab: null, handoff: false, ts: '' });

  const [candidates, setCandidates] = useState<PlantBridgeCandidate[]>([]);

  // 정적 배포(GitHub Pages) 또는 직접 이동 시 쿼리 누락 대비 최근 시뮬레이터 핸드오프 자동 복원 (타 공정·미허용 공정 차단)
  useEffect(() => {
    const qTab = searchParams?.get('tab');
    const qHandoff = searchParams?.get('handoff') === '1';
    if (qTab && qHandoff) return;
    try {
      const raw = window.localStorage.getItem(CHEMPRO_SIM_HANDOFF_KEY);
      if (!raw) {
        setFallbackState({ tab: null, handoff: false, ts: '' });
        return;
      }
      const parsed = JSON.parse(raw) as {
        plantId?: string;
        tab?: string;
        timestamp?: number;
        equipTag?: string;
        equipName?: string;
        sourceLabel?: string;
      };
      const normPlant = (pid?: string) => (pid === 'clorsim_sim' ? 'clorsim' : pid || '');
      const isHandoffPlantAllowed = (pid: string): boolean => {
        if (pid === 'new_builder' || pid === 'classic_sim') return true;
        if (pid === 'clorsim') {
          return isPlantAllowed('clorsim', user) || isPlantAllowed('clorsim_sim', user);
        }
        return isPlantAllowed(pid, user);
      };

      if (parsed.plantId) {
        if (
          normPlant(parsed.plantId) !== normPlant(activePlantId) ||
          !isHandoffPlantAllowed(parsed.plantId)
        ) {
          setFallbackState({ tab: null, handoff: false, ts: '' });
          return;
        }
      } else if (parsed.sourceLabel) {
        const srcCode = parsed.sourceLabel.match(/^PLANT\s+\d+/i)?.[0]?.toUpperCase();
        const expCode = (activePlantId === 'clorsim' ? 'PLANT 01' : plantMeta.code)
          ?.match(/^PLANT\s+\d+/i)?.[0]
          ?.toUpperCase();
        const inferredFromLabel =
          srcCode === 'PLANT 01'
            ? 'clorsim_sim'
            : srcCode === 'PLANT 02'
              ? 'hcl_synth'
              : srcCode === 'PLANT 03'
                ? 'ech_gte'
                : srcCode === 'PLANT 04'
                  ? 'cms_plant'
                  : srcCode === 'PLANT 05'
                    ? 'mdi_plant'
                    : parsed.sourceLabel === 'electrolyzer_plant'
                      ? 'clorsim_sim'
                      : parsed.sourceLabel === 'hcl_1a_plant'
                        ? 'hcl_synth'
                        : parsed.sourceLabel === 'ech_gte_plant'
                          ? 'ech_gte'
                          : parsed.sourceLabel === 'cms_plant'
                            ? 'cms_plant'
                            : parsed.sourceLabel === 'mdi_plant'
                              ? 'mdi_plant'
                              : '';
        if (inferredFromLabel) {
          if (
            normPlant(inferredFromLabel) !== normPlant(activePlantId) ||
            !isHandoffPlantAllowed(inferredFromLabel)
          ) {
            setFallbackState({ tab: null, handoff: false, ts: '' });
            return;
          }
        } else if (srcCode && expCode && srcCode !== expCode) {
          setFallbackState({ tab: null, handoff: false, ts: '' });
          return;
        } else if (!srcCode && !plantMeta.isSandbox) {
          setFallbackState({ tab: null, handoff: false, ts: '' });
          return;
        }
      }

      const ageMs = Date.now() - Number(parsed.timestamp || 0);
      if (parsed?.tab && ageMs >= 0 && ageMs < 15 * 60 * 1000) {
        setFallbackState({
          tab: qTab || parsed.tab,
          handoff: true,
          ts: String(parsed.timestamp || ''),
        });
      } else {
        setFallbackState({ tab: null, handoff: false, ts: '' });
      }
    } catch {
      setFallbackState({ tab: null, handoff: false, ts: '' });
    }
  }, [searchParams, activePlantId, plantMeta.code, plantMeta.isSandbox, user]);

  // 현재 선택된 공장/시뮬레이터(activePlantId)의 실시간 스트림·장치 조건 후보 목록 구성
  useEffect(() => {
    if (activePlantId === 'clorsim') {
      if (!(isPlantAllowed('clorsim', user) || isPlantAllowed('clorsim_sim', user))) {
        setCandidates([]);
        return;
      }
      const list: PlantBridgeCandidate[] = [];
      const findS = (sid: string) => balance.streams.find(s => s.id === sid);

      const sBrine = findS('104');
      if (sBrine) {
        const rho = sBrine.density_kgm3 || 1190;
        const qM3h = sBrine.total_kgh / rho;
        const tBrine = sBrine.temperature_C ?? 60.0;
        const pBrine = sBrine.pressure_kgcm2g ?? 1.5;
        list.push({
          id: 'p1-p140',
          label: `[P-140] 정제 브라인 공급펌프 (Stream 104 · ${sBrine.total_kgh.toFixed(0)} kg/h)`,
          summary: `${tBrine.toFixed(1)}°C · ${pBrine} kG · Q=${qM3h.toFixed(1)} m³/h`,
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
            plantId: 'clorsim',
            tab: 'pump',
            equipTag: 'P-140',
            equipName: '정제 브라인 전해조 공급펌프',
            detectedFluidSummary: `정제 브라인 (${(sBrine.concentration ?? 25.6).toFixed(1)} wt% NaCl)`,
            pump: {
              fluidId: 'brine_25',
              T_C: Number(tBrine.toFixed(1)),
              Q_m3h: Number(qM3h.toFixed(1)),
              rho_kgm3: Math.round(rho),
              P1_barG: 0.2,
              P2_barG: 3.5,
              eff_pct: 75,
              dsuc_mm: '150',
              ddis_mm: '125',
            },
          },
        });
      }

      const sCl2 = findS('217');
      if (sCl2) {
        const tCl2 = sCl2.temperature_C ?? 87.0;
        list.push({
          id: 'p1-e210',
          label: `[E-210] 습염소가스 1차 티타늄 냉각기 (Stream 217 · ${sCl2.total_kgh.toFixed(0)} kg/h)`,
          summary: `입구 ${tCl2.toFixed(1)}°C → 40.0°C · 냉각수(CW)`,
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
            plantId: 'clorsim',
            tab: 'hx',
            equipTag: 'E-210',
            equipName: '양극 습염소가스 1차 냉각기',
            detectedFluidSummary: '습염소가스 (Wet Cl₂ + H₂O Vapor)',
            hx: {
              hx_type: 'shell_tube',
              hotFluidId: 'cl2_wet_gas',
              coldFluidId: 'water',
              allocation: 'hot_tube',
              dofTarget: 'mc_auto',
              mh_kgh: Math.round(sCl2.total_kgh),
              Th_in: Number(tCl2.toFixed(1)),
              Th_out: 40.0,
              mc_kgh: Math.round(sCl2.total_kgh * 3.2),
              Tc_in: 28.0,
              Tc_out: 36.0,
              hot_mode: 'cond_partial',
              cold_mode: 'sensible',
              U_assumed: 380,
            },
          },
        });
      }

      const sNaoh = findS('L1');
      if (sNaoh) {
        const tNaoh = sNaoh.temperature_C ?? 89.0;
        list.push({
          id: 'p1-e220',
          label: `[E-220] 32% 가성소다 판형 냉각기 (Stream L1 · ${sNaoh.total_kgh.toFixed(0)} kg/h)`,
          summary: `입구 ${tNaoh.toFixed(1)}°C → 45.0°C · 판형(PHE)`,
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
            plantId: 'clorsim',
            tab: 'hx',
            equipTag: 'E-220',
            equipName: '32% 가성소다 순환/제품 판형냉각기',
            detectedFluidSummary: `32 wt% 가성소다 수용액`,
            hx: {
              hx_type: 'plate_phe',
              hotFluidId: 'naoh_32',
              coldFluidId: 'water',
              allocation: 'hot_shell',
              dofTarget: 'mc_auto',
              mh_kgh: Math.round(sNaoh.total_kgh),
              Th_in: Number(tNaoh.toFixed(1)),
              Th_out: 45.0,
              mc_kgh: Math.round(sNaoh.total_kgh * 4.5),
              Tc_in: 28.0,
              Tc_out: 36.0,
              hot_mode: 'sensible',
              cold_mode: 'sensible',
              U_assumed: 1450,
            },
          },
        });
      }

      const sH2 = findS('220');
      if (sH2) {
        const rhoG = Math.max(0.12, sH2.density_kgm3 || 0.35);
        const tH2 = sH2.temperature_C ?? 90.0;
        const pH2 = sH2.pressure_kgcm2g ?? 0.45;
        list.push({
          id: 'p1-pipe220',
          label: `[PIPE-220] 음극 수소가스 주배관 사이징 (Stream 220 · ${sH2.total_kgh.toFixed(0)} kg/h)`,
          summary: `${tH2.toFixed(1)}°C · ${pH2} kG · 기상 배관`,
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
            plantId: 'clorsim',
            tab: 'piping',
            equipTag: 'H2-HDR-220',
            equipName: '음극 습수소 헤더 배관',
            detectedFluidSummary: '습수소 가스 (H₂ + 수증기)',
            piping: {
              fluidId: 'h2_wet_gas',
              flowMode: 'gas',
              T_C: Number(tH2.toFixed(1)),
              P1_barG: Math.max(0.2, Number((pH2 * 0.980665).toFixed(2))),
              Q_m3h: Number((sH2.total_kgh / rhoG).toFixed(1)),
              rho_kgm3: Number(rhoG.toFixed(3)),
            },
          },
        });
      }

      setCandidates(list);
      return;
    }

    if (activePlantId === 'classic_sim') {
      const classicList: PlantBridgeCandidate[] = [];
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(CLASSIC_SAVE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              simDefs?: FlowNodeDef[];
              flowEdges?: FlowEdgeDef[];
              lastSolvedMeta?: {
                result?: ReturnType<typeof createIdleFlowsheetResult>;
              };
            };
            const simDefs = Array.isArray(parsed?.simDefs) ? parsed.simDefs : [];
            const flowEdges = Array.isArray(parsed?.flowEdges) ? parsed.flowEdges : [];
            if (simDefs.length > 0) {
              const solved =
                parsed?.lastSolvedMeta?.result &&
                Array.isArray(parsed.lastSolvedMeta.result.streams) &&
                Array.isArray(parsed.lastSolvedMeta.result.units)
                  ? parsed.lastSolvedMeta.result
                  : createIdleFlowsheetResult(simDefs, flowEdges);
              const unitMap = new Map(solved.units.map(u => [u.nodeId, u]));
              const seenTags = new Set<string>();
              for (const def of simDefs) {
                const tagKey = (def.tag || def.id || '').trim();
                if (!tagKey || seenTags.has(tagKey)) continue;
                const uRes = unitMap.get(def.id);
                const rawPayload = buildChemProHandoffPayload(
                  def,
                  flowEdges,
                  solved.streams,
                  uRes,
                  '현재 클래식 케이스'
                );
                if (!rawPayload) continue;
                seenTags.add(tagKey);
                const payload: ChemProSimHandoffPayload = {
                  ...rawPayload,
                  plantId: 'classic_sim',
                };
                const flowTxt = uRes?.inletMassKgH ? `${uRes.inletMassKgH.toFixed(0)} kg/h` : '-';
                const tabKo = getTabKoLabel(payload.tab);
                classicList.push({
                  id: `classic-${def.id}`,
                  label: `[${def.tag}] ${def.name} (${tabKo} · ${flowTxt})`,
                  summary: `현재 클래식 케이스 · ${uRes?.detectedFluidLabel || payload.detectedFluidSummary}`,
                  group: 'case',
                  payload,
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }
      setCandidates(classicList);
      return;
    }

    if (activePlantId !== 'new_builder' && !isPlantAllowed(activePlantId, user)) {
      setCandidates([]);
      return;
    }

    // PLANT 01 / PLANT 02 / PLANT 03 / SANDBOX: 저장된 마지막 수렴 결과 우선 사용, 미실행 시트는 동기 계산 없이 O(1) 즉시 오픈
    const storageKey =
      activePlantId === 'clorsim_sim'
        ? PLANT02_SAVE_KEY
        : activePlantId === 'hcl_synth'
          ? PLANT03_SAVE_KEY
          : activePlantId === 'ech_gte'
            ? PLANT04_SAVE_KEY
            : activePlantId === 'cms_plant'
              ? PLANT05_SAVE_KEY
              : activePlantId === 'mdi_plant'
                ? PLANT06_MDI_SAVE_KEY
                : BUILDER_SAVE_KEY;

    let sheets: Record<string, SheetRuntimeData> | null = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.hierarchySheets && Object.keys(parsed.hierarchySheets).length > 0) {
            sheets = parsed.hierarchySheets as Record<string, SheetRuntimeData>;
            const actId = parsed.activeSheetId || 'master';
            if (parsed.lastSolvedMeta?.result && sheets[actId] && !sheets[actId].cachedSolvedMeta) {
              sheets = {
                ...sheets,
                [actId]: {
                  ...sheets[actId],
                  cachedSolvedMeta: {
                    result: parsed.lastSolvedMeta.result,
                    elapsedMs: parsed.lastSolvedMeta.elapsedMs ?? 1,
                    lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? '',
                    runCount: parsed.lastSolvedMeta.runCount ?? 1,
                  },
                },
              };
            }
          } else if (Array.isArray(parsed?.simDefs)) {
            sheets = {
              master: {
                id: 'master',
                sectionCode: 'SANDBOX',
                shortTabLabel: '신규 빌더',
                title: '신규 공정 플로우시트',
                subtitle: '',
                parentMasterNodeIds: [],
                simDefs: parsed.simDefs as FlowNodeDef[],
                positions: parsed.positions ?? {},
                flowEdges: (parsed.flowEdges ?? []) as FlowEdgeDef[],
                cachedSolvedMeta: parsed.lastSolvedMeta?.result
                  ? {
                      result: parsed.lastSolvedMeta.result,
                      elapsedMs: parsed.lastSolvedMeta.elapsedMs ?? 1,
                      lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? '',
                      runCount: parsed.lastSolvedMeta.runCount ?? 1,
                    }
                  : undefined,
              },
            };
          }
        }
      } catch {
        // ignore
      }
    }

    if (!sheets) {
      sheets =
        activePlantId === 'clorsim_sim'
          ? createInitialHierarchySheets()
          : activePlantId === 'hcl_synth'
            ? createInitialHcl1AHierarchySheets()
            : activePlantId === 'ech_gte'
              ? createInitialEchHierarchySheets()
              : activePlantId === 'cms_plant'
                ? createInitialCmsHierarchySheets()
                : activePlantId === 'mdi_plant'
                  ? createInitialMdiHierarchySheets({ syncMasterOnInit: true })
                  : {};
    }

    const sheetValues = Object.values(sheets);
    const nonMaster =
      activePlantId !== 'new_builder' && sheetValues.length > 1
        ? sheetValues.filter(s => s.id !== 'master')
        : sheetValues;
    const masterSheet = sheets['master'];
    const targetSheets =
      masterSheet && activePlantId !== 'new_builder' && sheetValues.length > 1
        ? [...nonMaster, masterSheet]
        : nonMaster;

    const extracted: PlantBridgeCandidate[] = [];
    const seenTags = new Set<string>();
    for (const sh of targetSheets) {
      const solved =
        sh.cachedSolvedMeta?.result ?? createIdleFlowsheetResult(sh.simDefs, sh.flowEdges);
      const unitMap = new Map(solved.units.map(u => [u.nodeId, u]));
      for (const def of sh.simDefs) {
        const tagKey = (def.tag || def.id || '').trim();
        if (!tagKey || seenTags.has(tagKey)) continue;
        const uRes = unitMap.get(def.id);
        const sourceLbl =
          activePlantId === 'new_builder'
            ? `현재 시뮬레이터 케이스 · ${sh.shortTabLabel || sh.title}`
            : `${plantMeta.code} ${plantMeta.shortLabel} · ${sh.shortTabLabel || sh.title}`;
        const rawPayload = buildChemProHandoffPayload(
          def,
          sh.flowEdges,
          solved.streams,
          uRes,
          sourceLbl
        );
        if (!rawPayload) continue;
        seenTags.add(tagKey);
        const payload: ChemProSimHandoffPayload = {
          ...rawPayload,
          plantId: activePlantId,
        };
        const flowTxt = uRes?.inletMassKgH ? `${uRes.inletMassKgH.toFixed(0)} kg/h` : '-';
        const tabKo = getTabKoLabel(payload.tab);
        extracted.push({
          id: `${sh.id}-${def.id}`,
          label: `[${def.tag}] ${def.name} (${tabKo} · ${flowTxt})`,
          summary: `${activePlantId === 'new_builder' ? '현재 시뮬레이터 케이스' : (sh.sectionCode || sh.id)} · ${uRes?.detectedFluidLabel || payload.detectedFluidSummary}`,
          group: 'case',
          payload,
        });
      }
    }

    if (activePlantId === 'mdi_plant') {
      extracted.push(
        {
          id: 'mdi-aux-p101',
          label: '[P-101A/B] MDA/아닐린 순환·이송 펌프 (펌프 · 10,006 kg/h)',
          summary: '100 SEC · 정제 조 MDA/아닐린 (95°C · 0.5→3.8 barG)',
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 05 MDI',
            plantId: 'mdi_plant',
            tab: 'pump',
            equipTag: 'P-101A/B',
            equipName: 'MDA/아닐린 순환·이송 펌프',
            detectedFluidSummary: 'MDA/아닐린 유기 혼합액 (95°C · 3.8 kG)',
            pump: {
              fluidId: 'aniline',
              T_C: 95.0,
              Q_m3h: 10.5,
              rho_kgm3: 1015,
              P1_barG: 0.5,
              P2_barG: 3.8,
              eff_pct: 74,
              dsuc_mm: '80',
              ddis_mm: '65',
            },
          },
        },
        {
          id: 'mdi-aux-p302',
          label: '[P-302A/B] 회수 MCB 용매 이송펌프 (펌프 · 18,807 kg/h)',
          summary: '300 SEC · 모노클로로벤젠 MCB (68°C · -0.9→3.5 barG)',
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 05 MDI',
            plantId: 'mdi_plant',
            tab: 'pump',
            equipTag: 'P-302A/B',
            equipName: '회수 MCB 용매 이송·순환 펌프',
            detectedFluidSummary: '회수 모노클로로벤젠 MCB 용매 (68°C · 3.5 kG)',
            pump: {
              fluidId: 'chlorobenzene',
              T_C: 68.0,
              Q_m3h: 17.5,
              rho_kgm3: 1075,
              P1_barG: -0.9,
              P2_barG: 3.5,
              eff_pct: 76,
              dsuc_mm: '100',
              ddis_mm: '80',
            },
          },
        },
        {
          id: 'mdi-aux-psv201',
          label: '[PSV-201] 포스겐 반응계 긴급 안전밸브 (안전밸브 · API 526)',
          summary: '200 SEC · 포스겐/HCl 고압 가스계 (Set 4.5 barG · 145°C)',
          group: 'case',
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 05 MDI',
            plantId: 'mdi_plant',
            tab: 'psv',
            equipTag: 'PSV-201',
            equipName: '포스겐 반응계 긴급 압력방출 안전밸브',
            detectedFluidSummary: '포스겐(COCl₂) / 무수 HCl 반응 가스 (Set 4.5 barG · 145°C)',
            psv: {
              fluidId: 'phosgene',
              scenario: 'blocked_outlet',
              phase: 'vapor',
              W_kgh: 8500,
              Pset_barG: 4.5,
              Pback_barG: 0.3,
              T_C: 145,
              mw: 62.5,
              k: 1.28,
              Z: 0.96,
            },
          },
        }
      );
    }

    setCandidates(extracted);
  }, [activePlantId, balance.streams, plantMeta.code, plantMeta.shortLabel, user]);

  const effectiveTab = searchParams?.get('tab') || fallbackState.tab || 'hx';
  const effectiveHandoff = searchParams?.get('handoff') === '1' || fallbackState.handoff;
  const effectiveTs = searchParams?.get('ts') || fallbackState.ts;

  const postSyncToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'CHEMPRO_SET_PLANT',
        plantId: activePlantId,
        allowedPlants,
        skipPresetLoad: effectiveHandoff,
      },
      '*'
    );
    win.postMessage(
      {
        type: 'CHEMPRO_SYNC_UNIT_CANDIDATES',
        candidates,
        allowedPlants,
        activePlantId,
      },
      '*'
    );
    if (effectiveHandoff) {
      win.postMessage({ type: 'CHEMPRO_APPLY_SIM_HANDOFF' }, '*');
    }
    win.postMessage({ type: 'CHEMENG_UNITS_SYNC', units }, '*');
  }, [activePlantId, allowedPlants, candidates, effectiveHandoff, units]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'CHEMENG_UNITS_SYNC', units }, '*');
  }, [units]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e?.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'CHEMPRO_READY') {
        postSyncToIframe();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postSyncToIframe]);

  useEffect(() => {
    postSyncToIframe();
  }, [candidates, allowedPlants, activePlantId, postSyncToIframe]);

  const iframeSrc = useMemo(
    () =>
      `${BASE_PATH}/chempro/index.html?embed=1&standalone=1&plant=${encodeURIComponent(activePlantId)}&tab=${encodeURIComponent(effectiveTab)}${
        effectiveHandoff ? '&handoff=1' : ''
      }${effectiveTs ? `&ts=${encodeURIComponent(effectiveTs)}` : ''}&v=20261119a`,
    [activePlantId, effectiveTab, effectiveHandoff, effectiveTs]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#F6F7F2', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          onLoad={() => {
            iframeRef.current?.contentWindow?.postMessage({ type: 'CHEMENG_UNITS_SYNC', units }, '*');
          }}
          title="ChemPro Unit Equipment Workstation"
          style={{ width: '100%', height: '100%', border: 'none', background: '#F6F7F2' }}
        />
      </div>
    </div>
  );
}

export default function UnitEquipmentPage() {
  return (
    <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#F6F7F2' }} />}>
      <UnitEquipmentInner />
    </Suspense>
  );
}

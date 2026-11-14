'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { getPlantRegistryItem } from '@/lib/plantRegistry';
import {
  CHEMPRO_SIM_HANDOFF_KEY,
  ChemProSimHandoffPayload,
  buildChemProHandoffPayload,
  saveChemProHandoffPayload,
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

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PLANT02_SAVE_KEY = 'chemplant-plant02-electrolyzer-v2';
const PLANT03_SAVE_KEY = 'chemplant-plant03-hcl1a-v2';
const PLANT04_SAVE_KEY = 'chemplant-plant04-ech-v1';
const BUILDER_SAVE_KEY = 'chemplant-newplant-builder-v1';

interface PlantBridgeCandidate {
  id: string;
  label: string;
  summary: string;
  payload: ChemProSimHandoffPayload;
}

function UnitEquipmentInner() {
  const searchParams = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { activePlantId, balance } = useBalanceStore();
  const plantMeta = getPlantRegistryItem(activePlantId);

  const [fallbackState, setFallbackState] = useState<{
    tab: string | null;
    handoff: boolean;
    ts: string;
  }>({ tab: null, handoff: false, ts: '' });

  const [manualOverride, setManualOverride] = useState<{
    tab: string;
    ts: string;
  } | null>(null);

  const [bridgeCollapsed, setBridgeCollapsed] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<PlantBridgeCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [appliedBanner, setAppliedBanner] = useState<string>('');

  // 정적 배포(GitHub Pages) 또는 직접 이동 시 쿼리 누락 대비 최근 시뮬레이터 핸드오프 자동 복원
  useEffect(() => {
    const qTab = searchParams?.get('tab');
    const qHandoff = searchParams?.get('handoff') === '1';
    if (qTab && qHandoff) return;
    try {
      const raw = window.localStorage.getItem(CHEMPRO_SIM_HANDOFF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        tab?: string;
        timestamp?: number;
        equipTag?: string;
        equipName?: string;
        sourceLabel?: string;
      };
      const ageMs = Date.now() - Number(parsed.timestamp || 0);
      if (parsed?.tab && ageMs >= 0 && ageMs < 15 * 60 * 1000) {
        setFallbackState({
          tab: qTab || parsed.tab,
          handoff: true,
          ts: String(parsed.timestamp || ''),
        });
        if (parsed.equipTag) {
          setAppliedBanner(`[${parsed.equipTag}] ${parsed.equipName || ''} 운전조건 자동 전달됨`);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [searchParams]);

  // 현재 선택된 공장(activePlantId)의 실시간 스트림·장치 조건 후보 목록 구성
  useEffect(() => {
    setAppliedBanner('');

    if (activePlantId === 'clorsim') {
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
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
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
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
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
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
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
          payload: {
            version: 1,
            timestamp: Date.now(),
            sourceLabel: 'PLANT 01 전해 기준공장 물질수지',
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
      setSelectedCandidateId(list[0]?.id || '');
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
              : {};
    }

    const sheetValues = Object.values(sheets);
    const targetSheets =
      activePlantId !== 'new_builder' && sheetValues.length > 1
        ? sheetValues.filter(s => s.id !== 'master')
        : sheetValues;

    const extracted: PlantBridgeCandidate[] = [];
    for (const sh of targetSheets) {
      const solved =
        sh.cachedSolvedMeta?.result ?? createIdleFlowsheetResult(sh.simDefs, sh.flowEdges);
      const unitMap = new Map(solved.units.map(u => [u.nodeId, u]));
      for (const def of sh.simDefs) {
        const uRes = unitMap.get(def.id);
        const payload = buildChemProHandoffPayload(
          def,
          sh.flowEdges,
          solved.streams,
          uRes,
          `${plantMeta.code} ${plantMeta.shortLabel} · ${sh.shortTabLabel || sh.title}`
        );
        if (!payload) continue;
        const flowTxt = uRes?.inletMassKgH ? `${uRes.inletMassKgH.toFixed(0)} kg/h` : '-';
        const tabKo =
          payload.tab === 'hx'
            ? '열교환기'
            : payload.tab === 'pump'
              ? '펌프'
              : payload.tab === 'column'
                ? '탑/흡수/증류'
                : payload.tab === 'vessel'
                  ? '분리기/용기'
                  : '배관';
        extracted.push({
          id: `${sh.id}-${def.id}`,
          label: `[${def.tag}] ${def.name} (${tabKo} · ${flowTxt})`,
          summary: `${sh.sectionCode || sh.id} · ${uRes?.detectedFluidLabel || payload.detectedFluidSummary}`,
          payload,
        });
      }
    }

    setCandidates(extracted);
    setSelectedCandidateId(extracted[0]?.id || '');
  }, [activePlantId, balance.streams, plantMeta.code, plantMeta.shortLabel]);

  const effectiveTab =
    manualOverride?.tab || searchParams?.get('tab') || fallbackState.tab || 'hx';
  const effectiveHandoff =
    Boolean(manualOverride) || searchParams?.get('handoff') === '1' || fallbackState.handoff;
  const effectiveTs =
    manualOverride?.ts || searchParams?.get('ts') || fallbackState.ts;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e?.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'CHEMPRO_READY' && effectiveHandoff) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'CHEMPRO_APPLY_SIM_HANDOFF' },
          '*'
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [effectiveHandoff, effectiveTs]);

  const handleApplySelectedCandidate = () => {
    const found = candidates.find(c => c.id === selectedCandidateId);
    if (!found) return;
    const nowTs = Date.now();
    const nextPayload: ChemProSimHandoffPayload = {
      ...found.payload,
      timestamp: nowTs,
    };
    saveChemProHandoffPayload(nextPayload);
    setManualOverride({ tab: nextPayload.tab, ts: String(nowTs) });
    setAppliedBanner(`[${nextPayload.equipTag}] ${nextPayload.equipName} 조건이 계산기에 자동 입력되었습니다.`);
    window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'CHEMPRO_APPLY_SIM_HANDOFF' },
        '*'
      );
    }, 220);
  };

  const selectedCandidate = useMemo(
    () => candidates.find(c => c.id === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId]
  );

  const iframeSrc = useMemo(
    () =>
      `${BASE_PATH}/chempro/index.html?embed=1&standalone=1&tab=${encodeURIComponent(effectiveTab)}${
        effectiveHandoff ? '&handoff=1' : ''
      }${effectiveTs ? `&ts=${encodeURIComponent(effectiveTs)}` : ''}&v=20261112d`,
    [effectiveTab, effectiveHandoff, effectiveTs]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#F6F7F2', overflow: 'hidden' }}>
      {/* 활성 공장 스트림·장치 빠른 조건 불러오기 브리지 바 */}
      {candidates.length > 0 && (
        <div
          style={{
            padding: bridgeCollapsed ? '4px 14px' : '7px 14px',
            background: '#F8FAFC',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          {bridgeCollapsed ? (
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
              🔗 [{plantMeta.code} {plantMeta.shortLabel}] 공정 장치 조건 불러오기 바 접힘
              {appliedBanner ? ` · ${appliedBanner}` : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 5,
                  background: plantMeta.accentSoftBg,
                  border: `1px solid ${plantMeta.accentBorder}`,
                  color: plantMeta.accent,
                  fontSize: 10.5,
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                }}
              >
                🔗 {plantMeta.code} 실시간 연동
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#1E293B', whiteSpace: 'nowrap' }}>
                공정 장치 운전조건 불러오기:
              </span>
              <select
                value={selectedCandidateId}
                onChange={e => setSelectedCandidateId(e.target.value)}
                style={{
                  height: 29,
                  minWidth: 280,
                  maxWidth: 430,
                  padding: '0 8px',
                  borderRadius: 5,
                  border: '1px solid #94A3B8',
                  background: '#FFFFFF',
                  color: '#0F172A',
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {candidates.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleApplySelectedCandidate}
                style={{
                  height: 29,
                  padding: '0 11px',
                  borderRadius: 5,
                  border: '1px solid #1E3A8A',
                  background: '#1E3A8A',
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ⚡ 현재 계산기에 유량·온도·압력 자동입력
              </button>
              {selectedCandidate && (
                <span style={{ fontSize: 10.5, color: '#475569', fontWeight: 600 }}>
                  ({selectedCandidate.summary})
                </span>
              )}
              {appliedBanner && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: '#ECFDF5',
                    border: '1px solid #6EE7B7',
                    color: '#065F46',
                    fontSize: 10.5,
                    fontWeight: 800,
                  }}
                >
                  ✓ {appliedBanner}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setBridgeCollapsed(v => !v)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#475569',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {bridgeCollapsed ? '연동 바 펼치기 ▼' : '접기 ▲'}
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={iframeSrc}
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

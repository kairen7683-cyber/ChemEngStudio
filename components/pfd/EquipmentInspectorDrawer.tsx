'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Node, Edge } from 'reactflow';
import { BUILTIN_EQUIPMENT, EquipmentItem } from '@/components/EquipmentList';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { StreamData, UnitOpBlockResult } from '@/lib/calculations/streams';

interface Props {
  selectedNodes: Node[];
  selectedEdges: Edge[];
  allNodes: Node[];
  allEdges: Edge[];
  onClose: () => void;
}

function normalizeTag(t: string): string {
  return t.replace(/A\/B|\/[A-Z0-9]+/gi, '').replace(/[^A-Z0-9-]/gi, '').toUpperCase();
}

function fmt(v: number | undefined, dec = 1): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function EquipmentInspectorDrawer({
  selectedNodes,
  selectedEdges,
  allNodes,
  allEdges,
  onClose,
}: Props) {
  const router = useRouter();
  const { balance, setActivePlantId, requestSimSheet } = useBalanceStore();
  const {
    nodeTagOverrides,
    equipmentSpecsOverrides,
    edgeStreamMap,
    setActiveDesignRequest,
    setEquipSubTab,
  } = usePFDStore();

  const streams = balance?.streams ?? [];
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  const unitBlocks = balance?.unitBlocks ?? [];

  const selNode = useMemo(() => {
    const valid = selectedNodes.filter(n => !['sectionGroup', 'streamLabel', 'sectionLabel'].includes(n.type ?? ''));
    return valid.length === 1 ? valid[0] : null;
  }, [selectedNodes]);

  const selEdge = !selNode && selectedEdges.length === 1 ? selectedEdges[0] : null;

  // 1) 장치 사양 매칭 (nodeId 또는 Tag 퍼지 매칭)
  const matchedEquip = useMemo<EquipmentItem | null>(() => {
    if (!selNode) return null;
    const ov = nodeTagOverrides[selNode.id];
    const displayTag = (ov?.tag ?? selNode.data?.tag ?? '').trim();
    const normSel = normalizeTag(displayTag);

    let found = BUILTIN_EQUIPMENT.find(e => e.nodeId === selNode.id);
    if (!found && normSel) {
      found = BUILTIN_EQUIPMENT.find(e => {
        const ne = normalizeTag(e.tag);
        return ne === normSel || ne.includes(normSel) || (normSel.length >= 4 && normSel.includes(ne));
      });
    }

    const specOv = found ? equipmentSpecsOverrides[found.tag] : equipmentSpecsOverrides[displayTag];
    if (found) {
      return {
        ...found,
        tag: displayTag || found.tag,
        name: ov?.name || specOv?.name || found.name,
        ...(specOv ?? {}),
      };
    }

    return {
      tag: displayTag || selNode.id,
      name: ov?.name || selNode.data?.name || '사용자 정의 공정 장치',
      type: selNode.type ?? 'Vessel',
      section: selNode.data?.section ?? '200',
      fluid: specOv?.fluid ?? '공정 유체',
      qty: specOv?.qty ?? 1,
      operTemp: specOv?.operTemp ?? '-',
      operPress: specOv?.operPress ?? '-',
      designTemp: specOv?.designTemp ?? '-',
      designPress: specOv?.designPress ?? '-',
      material: specOv?.material ?? '설계 기준 참조',
      capacity: specOv?.capacity ?? '-',
      motor: specOv?.motor ?? '-',
      remarks: specOv?.remarks ?? 'PFD 캔버스 연동 장치',
    };
  }, [selNode, nodeTagOverrides, equipmentSpecsOverrides]);

  // 2) 해당 장치와 연결된 PFD 배관(Inlet / Outlet Edges) 및 매칭된 스트림 물질수지 집계
  const ioBalance = useMemo(() => {
    if (!selNode) return null;
    const inEdges = allEdges.filter(e => e.target === selNode.id);
    const outEdges = allEdges.filter(e => e.source === selNode.id);

    const resolveStream = (e: Edge): { edgeId: string; streamId: string; otherTag: string; stream?: StreamData } => {
      const sid = (edgeStreamMap[e.id] ?? e.data?.streamId ?? '').trim();
      const otherId = e.target === selNode.id ? e.source : e.target;
      const otherNode = allNodes.find(n => n.id === otherId);
      const otherTag = nodeTagOverrides[otherId]?.tag ?? otherNode?.data?.tag ?? otherId;
      const st = sid ? streams.find(s => s.id === sid) : undefined;
      return { edgeId: e.id, streamId: sid, otherTag, stream: st };
    };

    const inlets = inEdges.map(resolveStream);
    const outlets = outEdges.map(resolveStream);

    // 전해조 1기당 스트림과 ×5 합산 스트림이 혼재할 수 있으므로 각각 표시하되 총 질량유량 합산 제공
    const sumInKgH = inlets.reduce((s, x) => s + (x.stream?.total_kgh ?? 0), 0);
    const sumOutKgH = outlets.reduce((s, x) => s + (x.stream?.total_kgh ?? 0), 0);
    const outVaporKgH = outlets.filter(x => x.stream?.phase === 'G').reduce((s, x) => s + (x.stream?.total_kgh ?? 0), 0);
    const outLiquidKgH = outlets.filter(x => x.stream?.phase !== 'G').reduce((s, x) => s + (x.stream?.total_kgh ?? 0), 0);

    return {
      inlets,
      outlets,
      sumInKgH,
      sumOutKgH,
      diffKgH: sumInKgH - sumOutKgH,
      outVaporKgH,
      outLiquidKgH,
    };
  }, [selNode, allEdges, allNodes, edgeStreamMap, nodeTagOverrides, streams]);

  // 3) 유닛 블록 시뮬레이션 결과(열량/수분제거량 등) 매칭
  const matchedUnitSim = useMemo<UnitOpBlockResult | undefined>(() => {
    if (!matchedEquip) return undefined;
    const norm = normalizeTag(matchedEquip.tag);
    if (!norm) return undefined;
    return unitBlocks.find(b => {
      const tokens = b.id.split(/[/·&\s()]+/).map(normalizeTag).filter(Boolean);
      return tokens.some(tk => tk === norm || (norm.startsWith('ELEC') && tk.startsWith('EL200')) || (norm === 'EL200' && tk.startsWith('EL200')));
    });
  }, [matchedEquip, unitBlocks]);

  if (!selNode && !selEdge) return null;

  // 배관(Edge) 단독 클릭 시 스트림 상세 요약 팝업
  if (selEdge) {
    const sid = (edgeStreamMap[selEdge.id] ?? selEdge.data?.streamId ?? '').trim();
    const st = sid ? streams.find(s => s.id === sid) : undefined;
    const srcNode = allNodes.find(n => n.id === selEdge.source);
    const tgtNode = allNodes.find(n => n.id === selEdge.target);
    const srcTag = nodeTagOverrides[selEdge.source]?.tag ?? srcNode?.data?.tag ?? selEdge.source;
    const tgtTag = nodeTagOverrides[selEdge.target]?.tag ?? tgtNode?.data?.tag ?? selEdge.target;

    return (
      <div style={isMobile ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, top: 'auto', width: '100%', maxHeight: '76dvh',
        background: '#FFFFFF', borderTop: '2px solid #1A2F44', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -10px 32px rgba(26,47,68,0.28)', zIndex: 120,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      } : {
        position: 'absolute', top: 54, right: 14, width: 330, maxHeight: 'calc(100% - 74px)',
        background: '#FFFFFF', border: '1.5px solid #1A2F44', borderRadius: 12,
        boxShadow: '0 10px 30px rgba(26,47,68,0.22)', zIndex: 35,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px', background: '#1A2F44', color: '#FFFFFF',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>
              ⟶ 배관 스트림 {sid ? `[${sid}]` : '(미지정)'}
            </div>
            <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 1 }}>
              {srcTag} → {tgtTag}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: 14, cursor: 'pointer', fontWeight: 800 }}>✕</button>
        </div>

        <div style={{ padding: '12px 14px', overflowY: 'auto', fontSize: 11 }}>
          {st ? (
            <>
              <div style={{ fontWeight: 800, color: '#1A2F44', fontSize: 12, marginBottom: 4 }}>{st.name}</div>
              {st.description && <div style={{ fontSize: 10, color: '#5A6570', marginBottom: 10 }}>{st.description}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <SpecBadge label="총 질량유량" value={`${fmt(st.total_kgh, 1)} kg/h`} highlight />
                <SpecBadge label="부피 / 몰유량" value={`${fmt(st.volFlow_m3h, 1)} m³/h (${fmt(st.molarFlow_kmolh, 1)} kmol/h)`} />
                <SpecBadge label="운전 온도 / 상" value={`${fmt(st.temperature_C, 1)} °C (${st.phase ?? 'L'})`} />
                <SpecBadge label="운전 압력 / 밀도" value={`${fmt(st.pressure_kgcm2g, 2)} kg/cm²G · ${fmt(st.density_kgm3, 1)} kg/m³`} />
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#1A2F44', marginBottom: 5 }}>성분별 유량 (kg/h)</div>
              <div style={{ background: '#F6F7F2', borderRadius: 7, padding: '7px 10px', border: '1px solid #E5E2DC' }}>
                {Object.entries(st.components)
                  .filter(([, v]) => v && v > 0)
                  .map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5 }}>
                      <span style={{ fontWeight: 700, color: '#2C353E' }}>{k}</span>
                      <span style={{ color: '#1A2F44', fontWeight: 700 }}>
                        {fmt(v, 1)} kg/h ({((v! / Math.max(1e-6, st.total_kgh)) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <div style={{ color: '#5A6570', lineHeight: 1.5 }}>
              이 배관에는 아직 스트림 번호가 연결되어 있지 않습니다. 좌측 상단의 <b>편집 모드</b>를 켜면 스트림 번호를 직접 매핑할 수 있습니다.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!matchedEquip || !ioBalance) return null;

  const isSeparatorLike = ['Separator', 'Column', 'Evaporator'].includes(matchedEquip.type) || ['separator', 'tower', 'towerPacking', 'evaporator'].includes(selNode?.type ?? '');

  return (
    <div style={isMobile ? {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      top: 'auto',
      width: '100%',
      maxHeight: '78dvh',
      background: '#FFFFFF',
      borderTop: '2px solid #1A2F44',
      borderRadius: '16px 16px 0 0',
      boxShadow: '0 -12px 34px rgba(26, 47, 68, 0.28)',
      zIndex: 120,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    } : {
      position: 'absolute',
      top: 54,
      right: 14,
      width: 365,
      maxHeight: 'calc(100% - 74px)',
      background: '#FFFFFF',
      border: '1.5px solid #1A2F44',
      borderRadius: 12,
      boxShadow: '0 12px 32px rgba(26, 47, 68, 0.24)',
      zIndex: 35,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 1. 헤더: 태그명 & 기기명 */}
      <div style={{
        padding: '10px 14px',
        background: '#1A2F44',
        color: '#FFFFFF',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 8,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 900,
              background: 'rgba(255,255,255,0.18)', padding: '1px 7px', borderRadius: 5,
            }}>
              {matchedEquip.tag}
            </span>
            <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 4, background: '#0F5338', color: '#FFFFFF', fontWeight: 700 }}>
              {matchedEquip.section} Sec · {matchedEquip.type}
            </span>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#E2E8F0', marginTop: 4 }}>
            {matchedEquip.name}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="닫기"
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 6,
            color: '#FFFFFF',
            fontSize: 15,
            cursor: 'pointer',
            fontWeight: 800,
            padding: '2px 8px',
            lineHeight: 1.2,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* 본문 스크롤 영역 */}
      <div style={{ padding: '12px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 2. 기기목록(Equipment List) 연동 사양 카드 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1A2F44' }}>📋 기기목록 연동 설계 사양</span>
            <button
              onClick={() => {
                setEquipSubTab('equip');
                router.push('/equipment-design?tab=equip');
              }}
              style={{
                fontSize: 9.5, fontWeight: 700, color: '#0369A1', background: '#E0F2FE',
                border: '1px solid #BAE6FD', borderRadius: 4, padding: '1px 6px', cursor: 'pointer',
              }}
            >
              전체 기기목록 열기 →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            <SpecBadge label="용량 / 규격" value={matchedEquip.capacity} highlight />
            <SpecBadge label="선정 재질" value={matchedEquip.material} highlight />
            <SpecBadge label="운전 온도 / 압력" value={`${matchedEquip.operTemp} °C / ${matchedEquip.operPress} kg/cm²G`} />
            <SpecBadge label="설계 온도 / 압력" value={`${matchedEquip.designTemp} °C / ${matchedEquip.designPress} kg/cm²G`} />
            <SpecBadge label="취급 유체 / 수량" value={`${matchedEquip.fluid} (${matchedEquip.qty}대)`} />
            <SpecBadge label="전동기 동력" value={matchedEquip.motor} />
          </div>
          {matchedEquip.remarks && (
            <div style={{ marginTop: 5, fontSize: 9.5, color: '#5A6570', background: '#FAF9F5', padding: '5px 8px', borderRadius: 5, border: '1px solid #EFECE5' }}>
              비고: {matchedEquip.remarks}
            </div>
          )}
        </div>

        {/* 3. 단위공정 시뮬레이션 해석 결과 (기액분리 / 열부하 / 수분제거량) */}
        {(matchedUnitSim || (isSeparatorLike && (ioBalance.outVaporKgH > 0 || ioBalance.outLiquidKgH > 0))) && (
          <div style={{ background: '#F6F7F2', border: '1px solid #DFDCD4', borderRadius: 8, padding: '9px 11px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0F5338', marginBottom: 5 }}>
              ⚡ 장치 시뮬레이션 &amp; 상분리 해석
            </div>
            {isSeparatorLike && (ioBalance.outVaporKgH > 0 || ioBalance.outLiquidKgH > 0) && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 10.5,
                padding: '5px 8px', background: '#FFFFFF', borderRadius: 6, border: '1px solid #E5E2DC', marginBottom: 6,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                <span style={{ color: '#0F5338', fontWeight: 800 }}>기상(G) 분리: {fmt(ioBalance.outVaporKgH, 1)} kg/h</span>
                <span style={{ color: '#1A2F44', fontWeight: 800 }}>액상(L) 분리: {fmt(ioBalance.outLiquidKgH, 1)} kg/h</span>
              </div>
            )}
            {matchedUnitSim && (
              <div style={{ fontSize: 10, color: '#2C353E', lineHeight: 1.55 }}>
                <div>• <b>해석 모델:</b> {matchedUnitSim.simBlockType}</div>
                <div>• <b>운전 조건:</b> {matchedUnitSim.tempInC.toFixed(1)} → {matchedUnitSim.tempOutC.toFixed(1)} °C ({matchedUnitSim.pressKgcm2g.toFixed(2)} kg/cm²G)</div>
                <div>• <b>총 열부하(Q):</b> <b>{fmt(matchedUnitSim.totalHeatDutyKcalH, 0)} kcal/h</b> ({fmt(matchedUnitSim.totalHeatDutyKW, 1)} kW)</div>
                {matchedUnitSim.waterRemovedKgH !== undefined && matchedUnitSim.waterRemovedKgH > 0 && (
                  <div>• <b>응축/흡수 수분 제거:</b> <b style={{ color: '#0F5338' }}>{fmt(matchedUnitSim.waterRemovedKgH, 1)} kg/h</b></div>
                )}
                {matchedUnitSim.cl2RemovedKgH !== undefined && matchedUnitSim.cl2RemovedKgH > 0 && (
                  <div>• <b>용존 Cl₂ 탈기 회수:</b> <b style={{ color: '#7C2D12' }}>{fmt(matchedUnitSim.cl2RemovedKgH, 1)} kg/h</b></div>
                )}
                <div style={{ marginTop: 3, color: '#5A6570', fontSize: 9.5 }}>{matchedUnitSim.keySpecSummary}</div>
              </div>
            )}
          </div>
        )}

        {/* 4. 연결 배관 인입(Inlet) / 토출(Outlet) 물질수지 검증 */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#1A2F44', marginBottom: 6 }}>
            🔄 연결 배관 In / Out 물질수지 ({ioBalance.inlets.length} In → {ioBalance.outlets.length} Out)
          </div>

          {/* INLETS */}
          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#5A6570', marginBottom: 3 }}>▶ 유입 배관 (Inlet Streams)</div>
          {ioBalance.inlets.length === 0 ? (
            <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 6 }}>연결된 유입 배관 없음 (경계 공급단)</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              {ioBalance.inlets.map(item => (
                <StreamMiniRow key={item.edgeId} dir="IN" item={item} />
              ))}
            </div>
          )}

          {/* OUTLETS */}
          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#5A6570', marginBottom: 3 }}>◀ 유출 배관 (Outlet Streams)</div>
          {ioBalance.outlets.length === 0 ? (
            <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 6 }}>연결된 유출 배관 없음 (제품/배출단)</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              {ioBalance.outlets.map(item => (
                <StreamMiniRow key={item.edgeId} dir="OUT" item={item} />
              ))}
            </div>
          )}

          {/* 총 합계 요약 */}
          {(ioBalance.sumInKgH > 0 || ioBalance.sumOutKgH > 0) && (
            <div style={{
              padding: '7px 10px', borderRadius: 7, background: '#EFECE5', border: '1px solid #D5D2C8',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
            }}>
              <span style={{ color: '#1A2F44', fontWeight: 800 }}>Σ In: {fmt(ioBalance.sumInKgH, 1)} kg/h</span>
              <span style={{ color: '#0F5338', fontWeight: 800 }}>Σ Out: {fmt(ioBalance.sumOutKgH, 1)} kg/h</span>
            </div>
          )}
        </div>

        {/* 5. 상세 단위장치 설계 / 세부 시뮬레이션 바로가기 버튼 (장치 형식별 1:1 매칭) */}
        {(() => {
          const rawTag = matchedEquip.tag.trim();
          const targetTag = rawTag === 'D-940' ? 'T-730' : rawTag;
          const isElectrolyzer = matchedEquip.type === 'Electrolyzer' || /^EL/i.test(targetTag);
          const isCompressor = matchedEquip.type === 'Compressor' || /^C-\d/i.test(targetTag);
          const isEvap = matchedEquip.type === 'Evaporator' || ['E-320', 'E-330', 'E-340'].includes(targetTag);
          const isBrine =
            ['T-030', 'D-010', 'D-010A/B', 'F-140', 'F-150', 'T-160'].includes(targetTag) ||
            matchedEquip.type === 'Settler' ||
            (matchedEquip.type === 'Filter' && matchedEquip.section === '100');
          const isPackingTower =
            !isBrine &&
            (matchedEquip.type === 'Column' ||
              ['T-280', 'T-410', 'T-420', 'T-430', 'T-440', 'T-450', 'T-610', 'T-730', 'T-760'].includes(targetTag));

          const chemproSubTab: 'pump' | 'vessel' | 'hx' =
            matchedEquip.type === 'Pump' || /^P-/i.test(targetTag)
              ? 'pump'
              : matchedEquip.type === 'HX' || /^E-/i.test(targetTag) || targetTag === 'D-484'
                ? 'hx'
                : 'vessel';

          const btnLabel = isElectrolyzer
            ? '⚡ 이온교환막 전해조 세부 시뮬레이션 열기 (200-1) →'
            : isCompressor
              ? `⚡ ${matchedEquip.section === '600' ? '고압 수소 압축(600)' : '염소 다단 압축·액화(400-3)'} 시뮬 열기 →`
              : isBrine
                ? '🔧 100 브라인 정제설비 상세 사이징 열기 →'
                : isEvap
                  ? '🔧 3효 강하막 증발농축 상세 설계 열기 →'
                  : isPackingTower
                    ? '🔧 흡수·건조·제해 패킹타워 상세 사이징 열기 →'
                    : chemproSubTab === 'pump'
                      ? '🔧 원심펌프(PUMP) 수력학·NPSH 상세 사이징 열기 →'
                      : chemproSubTab === 'vessel'
                        ? '🔧 기액분리기·압력용기(VES) 상세 사이징 열기 →'
                        : '🔧 열교환기·응축기·액화기(HEX) 상세 사이징 열기 →';

          return (
            <button
              onClick={() => {
                if (isElectrolyzer) {
                  setActivePlantId('clorsim_sim');
                  requestSimSheet('sub_200_cell');
                  router.push('/material-balance');
                  return;
                }
                if (isCompressor) {
                  setActivePlantId('clorsim_sim');
                  requestSimSheet(matchedEquip.section === '600' ? 'sub_600_h2' : 'sub_400_liquefaction');
                  router.push('/material-balance');
                  return;
                }
                const tab = isBrine ? 'brine' : isEvap ? 'evap' : isPackingTower ? 'packing' : 'chempro';
                setEquipSubTab(tab);
                if (tab === 'chempro') {
                  const tagParam = chemproSubTab === 'pump' && !/A\/B$/i.test(targetTag) ? `${targetTag}A/B` : targetTag;
                  setActiveDesignRequest({ tab: 'chempro', tag: tagParam, chemproSubTab });
                  router.push(`/equipment-design?tab=chempro&sub=${chemproSubTab}&tag=${encodeURIComponent(tagParam)}`);
                } else {
                  setActiveDesignRequest({ tab, tag: targetTag });
                  router.push(`/equipment-design?tab=${tab}`);
                }
              }}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                background: isElectrolyzer ? '#0F766E' : '#1A2F44',
                border: `1px solid ${isElectrolyzer ? '#0F766E' : '#1A2F44'}`,
                color: '#FFFFFF',
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
              }}
            >
              {btnLabel}
            </button>
          );
        })()}
      </div>
    </div>
  );
}

function SpecBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '5px 8px', borderRadius: 6,
      background: highlight ? '#F6F7F2' : '#FFFFFF',
      border: '1px solid #E5E2DC',
    }}>
      <div style={{ fontSize: 8.5, color: '#7A7872', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: '#1A2F44', fontWeight: 800, marginTop: 1, wordBreak: 'break-word' }}>{value || '-'}</div>
    </div>
  );
}

function StreamMiniRow({
  dir,
  item,
}: {
  dir: 'IN' | 'OUT';
  item: { edgeId: string; streamId: string; otherTag: string; stream?: StreamData };
}) {
  const st = item.stream;
  return (
    <div style={{
      padding: '5px 8px', borderRadius: 6, background: '#FAF9F5', border: '1px solid #E5E2DC',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 10,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44' }}>
            {item.streamId ? `[${item.streamId}]` : '[미매핑]'}
          </span>
          {st?.phase && (
            <span style={{
              fontSize: 8.5, fontWeight: 800, padding: '0 4px', borderRadius: 3,
              background: st.phase === 'G' ? '#DCFCE7' : '#E0F2FE',
              color: st.phase === 'G' ? '#065F46' : '#0369A1',
            }}>
              {st.phase}
            </span>
          )}
          <span style={{ color: '#5A6570', fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dir === 'IN' ? `from ${item.otherTag}` : `to ${item.otherTag}`}
          </span>
        </div>
        {st && (
          <div style={{ fontSize: 9, color: '#7A7872', marginTop: 1 }}>
            {st.name} · {fmt(st.temperature_C, 1)}°C / {fmt(st.pressure_kgcm2g, 2)}kG
          </div>
        )}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#1A2F44', whiteSpace: 'nowrap' }}>
        {st ? `${fmt(st.total_kgh, 1)} kg/h` : '—'}
      </div>
    </div>
  );
}

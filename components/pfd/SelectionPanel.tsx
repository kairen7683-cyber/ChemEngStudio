'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Node, Edge } from 'reactflow';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { FLUID_PRESETS, colorFromFluidKey, fluidKeyFromStream } from '@/lib/pfdFluidColors';
import { CATALOG, EquipIcon } from './AddEquipmentPanel';

interface Props {
  selectedNodes: Node[];
  selectedEdges: Edge[];
  allNodes: Node[];
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onNodeUpdate?: (id: string, data: { tag: string; name: string }) => void;
  onNodeTypeUpdate?: (id: string, newType: string) => void;
  onNodeMultiplierUpdate?: (id: string, multiplier: number) => void;
  onEdgeUpdate?: (id: string, streamId: string, color?: string) => void;
}

// ── Helper: get a node's display tag ────────────────────────────────────────
function getNodeTag(nodeId: string, allNodes: Node[]): string {
  const n = allNodes.find(x => x.id === nodeId);
  return n?.data?.tag ?? nodeId.split('_').slice(1).join('_') ?? nodeId;
}

export default function SelectionPanel({
  selectedNodes, selectedEdges, allNodes,
  onDeleteNode, onDeleteEdge, onNodeUpdate, onNodeTypeUpdate, onNodeMultiplierUpdate, onEdgeUpdate,
}: Props) {
  const router = useRouter();
  const {
    setNodeTagOverride, setNodeTypeOverride, setEdgeStream, edgeStreamMap, nodeTagOverrides, nodeTypeOverrides,
    edgeFluidMap, setEdgeAppearance, updateUserNodeMultiplier,
    setActiveDesignRequest,
  } = usePFDStore();
  const balance = useBalanceStore(s => s.balance);
  const streams = balance?.streams ?? [];

  // safe fallback for hydration timing
  const safeEdgeFluidMap = edgeFluidMap ?? {};

  // ── Node editing state ──────────────────────────────────────────────────
  const [nodeTag,  setNodeTag]  = useState('');
  const [nodeName, setNodeName] = useState('');
  const [nodeType, setNodeType] = useState('tank');
  const [nodeMultiplier, setNodeMultiplier] = useState(1);

  // ── Edge editing state ──────────────────────────────────────────────────
  const [edgeStream,   setEdgeStreamLocal] = useState('');
  const [edgeColor,    setEdgeColor]       = useState('#4ade80');
  const [fluidType,    setFluidType]       = useState('Brine');

  const selNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selEdge = selectedEdges.length === 1 ? selectedEdges[0] : null;

  // Sync inputs when selection changes
  useEffect(() => {
    if (selNode) {
      const ov = nodeTagOverrides[selNode.id];
      const ovType = nodeTypeOverrides?.[selNode.id];
      setNodeTag(ov?.tag   ?? selNode.data?.tag  ?? '');
      setNodeName(ov?.name ?? selNode.data?.name ?? '');
      setNodeType(ovType   ?? selNode.type       ?? 'tank');
      setNodeMultiplier(selNode.data?.multiplier && selNode.data.multiplier > 0 ? selNode.data.multiplier : 1);
    }
  }, [selNode?.id]);

  useEffect(() => {
    if (selEdge) {
      const sid = edgeStreamMap[selEdge.id] ?? selEdge.data?.streamId ?? '';
      const savedColor = (selEdge.style?.stroke as string) ?? selEdge.data?.color ?? '#4ade80';
      const savedFluid = safeEdgeFluidMap[selEdge.id] ?? selEdge.data?.fluidType ?? '';

      setEdgeStreamLocal(sid);

      if (savedFluid) {
        // 저장된 유체 종류가 있으면 우선 사용
        setFluidType(savedFluid);
        setEdgeColor(savedFluid === 'custom' ? savedColor : colorFromFluidKey(savedFluid));
      } else if (sid) {
        // 스트림 데이터에서 자동 감지
        const matched = streams.find(s => s.id === sid);
        if (matched) {
          const fk = fluidKeyFromStream(matched);
          setFluidType(fk);
          setEdgeColor(colorFromFluidKey(fk));
        } else {
          setEdgeColor(savedColor);
          setFluidType('custom');
        }
      } else {
        setEdgeColor(savedColor);
        setFluidType('custom');
      }
    }
  }, [selEdge?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!selNode && !selEdge) return null;
  if (selectedNodes.length > 1 || selectedEdges.length > 1) {
    return (
      <PanelShell>
        <div style={{ fontSize: 11, color: '#64748b', padding: '8px 0' }}>
          {selectedNodes.length + selectedEdges.length}개 선택됨
        </div>
      </PanelShell>
    );
  }

  // ── NODE PANEL ──────────────────────────────────────────────────────────
  if (selNode) {
    const typeLabel: Record<string, string> = {
      agitatedDrum: '반응기/교반드럼', tank: '수직드럼(탱크)', drumHorizontal: '수평드럼',
      pump: '원심펌프', heatExchanger: '열교환기(HEX)',
      tower: '증류컬럼(트레이)', towerPacking: '팩킹컬럼(충진탑)', evaporator: '강하막증발관',
      compressor: '압축기', filter: '필터(캔들/수지)',
      separator: '기액분리기(K.O)', valve: '컨트롤밸브', electrolyzer: '이온교환막 전해조',
      branch: '배관 브랜치', mixer: '믹서(배수 ×N)',
      sectionGroup: '섹션 그룹', streamLabel: '스트림 라벨',
    };

    const isMixer = nodeType === 'mixer';
    const isShapeEditable = !['sectionGroup', 'streamLabel', 'sectionLabel'].includes(selNode.type ?? '');

    const handleTypeSelect = (newType: string) => {
      setNodeType(newType);
      setNodeTypeOverride(selNode.id, newType);
      onNodeTypeUpdate?.(selNode.id, newType);
    };

    const handleSaveNode = () => {
      const trimTag  = nodeTag.trim();
      const trimName = nodeName.trim();
      // 1. persist to store (survives reload)
      setNodeTagOverride(selNode.id, trimTag, trimName);
      // 2. immediately update rfNodes.data (canvas label changes now)
      onNodeUpdate?.(selNode.id, { tag: trimTag, name: trimName });
      if (isShapeEditable && nodeType !== selNode.type) {
        setNodeTypeOverride(selNode.id, nodeType);
        onNodeTypeUpdate?.(selNode.id, nodeType);
      }
      if (isMixer) {
        const n = Math.max(1, Math.round(nodeMultiplier));
        updateUserNodeMultiplier(selNode.id, n);
        onNodeMultiplierUpdate?.(selNode.id, n);
      }
    };

    return (
      <PanelShell>
        <PanelHeader icon="⬡" title="장치 속성" subtitle={nodeTag || selNode.data?.tag} color="#4ade80" />

        <Field label="Tag 번호">
          <input value={nodeTag} onChange={e => setNodeTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveNode()}
            style={inputStyle} placeholder="e.g. D-010" />
        </Field>

        <Field label="용도 / 이름">
          <input value={nodeName} onChange={e => setNodeName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveNode()}
            style={inputStyle} placeholder="e.g. 포화조" />
        </Field>

        <Field label="아이콘 모양 변경 (클릭 시 즉시 적용)">
          {isShapeEditable ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 4,
              maxHeight: 196,
              overflowY: 'auto',
              padding: 4,
              background: '#F6F7F2',
              border: '1px solid #DFDCD4',
              borderRadius: 6,
            }}>
              {CATALOG.map(item => {
                const active = nodeType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleTypeSelect(item.type)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      padding: '4px 2px',
                      borderRadius: 5,
                      cursor: 'pointer',
                      background: active ? '#1A2F44' : '#FFFFFF',
                      border: active ? '1.5px solid #1A2F44' : '1px solid #E5E2DC',
                      transition: 'all 0.12s',
                    }}
                    title={`${item.label} 모양으로 변경`}
                  >
                    <EquipIcon type={item.type} color={active ? '#FFFFFF' : '#1A2F44'} size={26} />
                    <span style={{
                      fontSize: 8.5,
                      fontWeight: active ? 700 : 600,
                      color: active ? '#FFFFFF' : '#2C353E',
                      lineHeight: 1.15,
                      textAlign: 'center',
                      wordBreak: 'keep-all',
                    }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {typeLabel[selNode.type ?? ''] ?? selNode.type}
            </span>
          )}
        </Field>

        {isMixer && (
          <Field label="배수 (×N)">
            <input
              type="number" min={1} step={1}
              value={nodeMultiplier}
              onChange={e => setNodeMultiplier(Math.max(1, Number(e.target.value) || 1))}
              onKeyDown={e => e.key === 'Enter' && handleSaveNode()}
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="노드 ID">
          <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>
            {selNode.id}
          </span>
        </Field>

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={handleSaveNode} style={btnStyle('#4ade80')}>
            ✓ 저장
          </button>
          <button
            onClick={() => { if (confirm(`"${nodeTag || selNode.id}" 장치를 삭제하시겠습니까?`)) onDeleteNode(selNode.id); }}
            style={btnStyle('#ef4444')}
          >
            🗑 삭제
          </button>
        </div>

        {['heatExchanger', 'tower', 'towerPacking', 'evaporator', 'pump', 'tank', 'agitatedDrum', 'drumHorizontal', 'filter', 'separator'].includes(nodeType) && (
          <button
            onClick={() => {
              const rawTag = (nodeTag || selNode.data?.tag || '').trim();
              const targetTag = rawTag === 'D-940' ? 'T-730' : rawTag;
              const isEvap = ['E-320', 'E-330', 'E-340'].includes(targetTag);
              const isBrine = ['T-030', 'D-010', 'D-010A/B', 'F-140', 'F-150', 'T-160'].includes(targetTag);
              const isPackingTower = !isBrine && (selNode.type === 'tower' || selNode.type === 'towerPacking' || ['T-280', 'T-410', 'T-420', 'T-430', 'T-440', 'T-450', 'T-610', 'T-730', 'T-760'].includes(targetTag));
              const tab = isBrine ? 'brine' : isEvap ? 'evap' : isPackingTower ? 'packing' : 'chempro';
              setActiveDesignRequest({ tab, tag: targetTag });
              router.push('/equipment-design');
            }}
            style={{
              ...btnStyle('#fb923c'),
              width: '100%',
              marginTop: 8,
              padding: '7px 10px',
              justifyContent: 'center',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            🔧 {['T-030', 'D-010', 'D-010A/B', 'F-140', 'F-150', 'T-160'].includes((nodeTag || selNode.data?.tag || '').trim())
              ? '브라인 정제 설비(T-030·F-140·T-160) 사이징하기'
              : ['E-320', 'E-330', 'E-340'].includes((nodeTag || selNode.data?.tag || '').trim())
                ? '강하막 증발관(Falling Film) 설계하기'
                : (selNode.type === 'tower' || selNode.type === 'towerPacking')
                  ? '흡수·건조·제해 패킹타워(GPDC) 설계하기'
                  : 'ChemPro 공정조건 연동 상세 설계하기'}
          </button>
        )}
      </PanelShell>
    );
  }

  // ── EDGE PANEL ──────────────────────────────────────────────────────────
  if (selEdge) {
    const srcTag = getNodeTag(selEdge.source, allNodes);
    const tgtTag = getNodeTag(selEdge.target, allNodes);

    const handleSaveEdge = () => {
      const sid = edgeStream.trim();
      setEdgeStream(selEdge.id, sid);
      // 1. 스토어에 색상+유체 저장 (리로드 후 복원될)
      setEdgeAppearance(selEdge.id, edgeColor, fluidType);
      // 2. 캔버스 즉시 반영
      onEdgeUpdate?.(selEdge.id, sid, edgeColor);
    };

    // 유체 종류 변경 → 색상 자동 적용 + 라이브 프리뷰
    const handleFluidChange = (key: string) => {
      setFluidType(key);
      if (key !== 'custom') {
        const c = colorFromFluidKey(key);
        setEdgeColor(c);
        onEdgeUpdate?.(selEdge.id, edgeStream.trim(), c);
      }
    };

    // 색상 피커 직접 변경 (기타 모드)
    const handleColorChange = (color: string) => {
      setEdgeColor(color);
      onEdgeUpdate?.(selEdge.id, edgeStream.trim(), color);
    };

    // 스트림 번호 입력 → 유체 자동 감지
    const handleStreamInput = (val: string) => {
      setEdgeStreamLocal(val);
      const matched = streams.find(s => s.id === val.trim());
      if (matched) {
        const fk = fluidKeyFromStream(matched);
        setFluidType(fk);
        const c = colorFromFluidKey(fk);
        setEdgeColor(c);
        onEdgeUpdate?.(selEdge.id, val.trim(), c);
      }
    };

    // Look up matched stream data for preview
    const matchedStream = edgeStream ? streams.find(s => s.id === edgeStream) : undefined;

    return (
      <PanelShell>
        <PanelHeader icon="⟶" title="배관 속성" subtitle={edgeStream ? `[${edgeStream}]` : '번호 없음'} color={edgeColor} />

        <Field label="라인테이블(물질수지표) 스트림 선택">
          <select
            value={edgeStream}
            onChange={e => {
              const v = e.target.value;
              handleStreamInput(v);
              setEdgeStream(selEdge.id, v.trim());
            }}
            style={{
              ...inputStyle,
              height: 32,
              cursor: 'pointer',
              marginBottom: 6,
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 5,
              fontSize: 11,
            }}
          >
            <option value="" style={{ background: '#1e293b', color: '#94a3b8' }}>— 라인테이블 스트림 선택 (78개) —</option>
            {(['100', '200', '300', '400', '600'] as const).map(sec => {
              const secStreams = streams.filter(s => s.section === sec);
              if (!secStreams.length) return null;
              return (
                <optgroup key={sec} label={`${sec} Sec 공정 스트림`} style={{ background: '#0f172a', color: '#38bdf8' }}>
                  {secStreams.map(s => (
                    <option key={s.id} value={s.id} style={{ background: '#1e293b', color: '#e2e8f0' }}>
                      [{s.id}] {s.name} ({s.total_kgh >= 1000 ? `${(s.total_kgh / 1000).toFixed(1)}t/h` : `${Math.round(s.total_kgh)}kg/h`}, {s.temperature_C}°C)
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <input value={edgeStream} onChange={e => handleStreamInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveEdge()}
            style={inputStyle} placeholder="직접 입력 (예: 104, L1, 401)" />
        </Field>

        {/* ── Stream data preview ─────────────────────────────── */}
        {edgeStream && (
          <div style={{
            marginBottom: 10, padding: '8px 10px',
            background: matchedStream ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
            border: `1px solid ${matchedStream ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
            borderRadius: 6, fontSize: 10,
          }}>
            {matchedStream ? (
              <>
                <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: 5, fontSize: 10 }}>
                  ✓ {matchedStream.name}
                </div>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {matchedStream.total_kgh != null && (
                      <tr>
                        <td style={{ color: '#64748b', paddingRight: 8, paddingBottom: 3, fontSize: 10 }}>총 유량</td>
                        <td style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 10 }}>
                          {matchedStream.total_kgh >= 1000
                            ? `${(matchedStream.total_kgh / 1000).toFixed(2)} t/h`
                            : `${matchedStream.total_kgh.toFixed(1)} kg/h`}
                        </td>
                      </tr>
                    )}
                    {matchedStream.temperature_C != null && (
                      <tr>
                        <td style={{ color: '#64748b', paddingRight: 8, paddingBottom: 3, fontSize: 10 }}>온도</td>
                        <td style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 10 }}>{matchedStream.temperature_C} °C</td>
                      </tr>
                    )}
                    {matchedStream.pressure_kgcm2g != null && (
                      <tr>
                        <td style={{ color: '#64748b', paddingRight: 8, paddingBottom: 3, fontSize: 10 }}>압력</td>
                        <td style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 10 }}>{matchedStream.pressure_kgcm2g} kg/cm²G</td>
                      </tr>
                    )}
                    {matchedStream.phase && (
                      <tr>
                        <td style={{ color: '#64748b', paddingRight: 8, paddingBottom: 3, fontSize: 10 }}>상태</td>
                        <td style={{ color: '#fbbf24', fontWeight: 700, fontSize: 10 }}>{matchedStream.phase}</td>
                      </tr>
                    )}
                    {matchedStream.concentration != null && (
                      <tr>
                        <td style={{ color: '#64748b', paddingRight: 8, paddingBottom: 3, fontSize: 10 }}>농도</td>
                        <td style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 10 }}>{matchedStream.concentration.toFixed(1)} wt%</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {/* Main components */}
                {matchedStream.components && (
                  <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {Object.entries(matchedStream.components)
                      .filter(([, v]) => v != null && (v as number) > 0)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <div key={k} style={{ fontSize: 9, color: '#64748b', lineHeight: 1.6 }}>
                          {k}: <span style={{ color: '#94a3b8' }}>{(v as number).toFixed(1)} kg/h</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#f87171', fontSize: 10 }}>
                ✗ 스트림 [{edgeStream}] 없음 — 번호 확인 필요
              </div>
            )}
          </div>
        )}

        <Field label="유체 종류">
          {/* 드롭다운 선택 */}
          <select
            value={fluidType}
            onChange={e => handleFluidChange(e.target.value)}
            style={{
              ...inputStyle,
              height: 32,
              cursor: 'pointer',
              paddingRight: 4,
              background: '#1e293b',   // 다크 배경
              color: '#e2e8f0',        // 밝은 글자
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 5,
              fontSize: 11,
            }}
          >
            {FLUID_PRESETS.map(p => (
              <option
                key={p.key}
                value={p.key}
                style={{ background: '#1e293b', color: '#e2e8f0' }}
              >
                {p.label}
              </option>
            ))}
          </select>

          {/* 선택된 유체 색상 프리븷 */}
          {fluidType !== 'custom' && (
            <div style={{
              marginTop: 6, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 3,
                background: edgeColor,
                boxShadow: `0 0 6px ${edgeColor}88`,
                flexShrink: 0,
              }} />
              <div style={{
                flex: 1, height: 3, borderRadius: 2,
                background: edgeColor,
                boxShadow: `0 0 6px ${edgeColor}88`,
              }} />
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{edgeColor}</span>
            </div>
          )}

          {/* 기타 선택 시 색상 피커 표시 */}
          {fluidType === 'custom' && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={edgeColor}
                onChange={e => handleColorChange(e.target.value)}
                style={{ width: 32, height: 28, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                title="커스텀 색상"
              />
              <div style={{
                flex: 1, height: 3, borderRadius: 2,
                background: edgeColor,
                boxShadow: `0 0 6px ${edgeColor}88`,
              }} />
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{edgeColor}</span>
            </div>
          )}
        </Field>


        <Field label="출발지 (From)">
          <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
            {srcTag}
          </span>
        </Field>

        <Field label="목적지 (To)">
          <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
            {tgtTag}
          </span>
        </Field>

        <div style={{
          marginTop: 8, padding: '8px 10px',
          background: 'rgba(96,165,250,0.06)',
          border: '1px solid rgba(96,165,250,0.15)',
          borderRadius: 6, fontSize: 10, color: '#64748b', lineHeight: 1.6,
        }}>
          💡 배관 끝단을 드래그하면 연결 장치를 변경할 수 있습니다.
          새 배관은 장치 핸들(●)에서 드래그하여 그립니다.
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={handleSaveEdge} style={btnStyle('#60a5fa')}>
            ✓ 적용
          </button>
          <button
            onClick={() => { if (confirm('이 배관을 삭제하시겠습니까?')) onDeleteEdge(selEdge.id); }}
            style={btnStyle('#ef4444')}
          >
            🗑 삭제
          </button>
        </div>
      </PanelShell>
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────────────────────────
function PanelShell({ children }: { children: React.ReactNode }) {
  // Drag state: null = use default CSS position, otherwise absolute pixel coords
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on the grip area (data-drag="true")
    if (!(e.target as HTMLElement).closest('[data-drag]')) return;
    e.preventDefault();
    dragging.current = true;
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Dragged position uses left/top; default position uses right/top
  const posStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto' }
    : { position: 'absolute', top: 130, right: 12 };

  return (
    <div
      ref={panelRef}
      onMouseDown={onMouseDown}
      style={{
        ...posStyle,
        width: 250, zIndex: 30,
        background: '#FFFFFF',
        border: '1px solid #DFDCD4',
        borderRadius: 10, padding: '0 0 12px',
        boxShadow: '0 8px 28px rgba(24,24,27,0.12)',
        fontFamily: "'Inter', system-ui, sans-serif",
        color: '#18181B',
        userSelect: 'none',
      }}
    >
      {/* Drag handle bar at the top */}
      <div
        data-drag="true"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 20, borderRadius: '10px 10px 0 0',
          background: '#EFECE5',
          borderBottom: '1px solid #E5E2DC',
          cursor: 'grab',
          userSelect: 'none',
        }}
        title="드래그하여 이동"
      >
        <span style={{ fontSize: 11, color: '#A1A1AA', letterSpacing: 3 }}>⠿⠿⠿</span>
      </div>
      <div style={{ padding: '10px 14px 0' }}>
        {children}
      </div>
    </div>
  );
}

function PanelHeader({ icon, title, subtitle, color }: {
  icon: string; title: string; subtitle?: string; color: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
      paddingBottom: 10, borderBottom: '1px solid #E5E2DC',
    }}>
      <span style={{ fontSize: 16, color: '#1A2F44' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#18181B' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: '#1A2F44', fontFamily: 'monospace' }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#52525B', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 28,
  background: '#FFFFFF',
  border: '1px solid #DFDCD4',
  borderRadius: 5, color: '#18181B', fontSize: 11,
  padding: '0 8px', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'monospace',
};

const btnStyle = (color: string): React.CSSProperties => ({
  flex: 1, height: 30, borderRadius: 5, fontSize: 11, fontWeight: 700,
  border: '1px solid #1A2F44',
  background: '#EFECE5',
  color: '#1A2F44', cursor: 'pointer',
  transition: 'background 0.15s',
});

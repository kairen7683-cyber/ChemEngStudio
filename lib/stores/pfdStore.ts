import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import defaultPfdLayoutData from './defaultPfdLayout.json';

// PFD 레이아웃(노드 위치·유저 장치·엣지·아이콘)은 브라우저 localStorage 에 저장한다(단독 실행판).
const LOCAL_KEY = 'electro-pfd-layout-v12';

export const DEFAULT_PFD_LAYOUT = defaultPfdLayoutData;

export interface CustomIconDef {
  viewBox: string;
  svgInner: string;
  width: number;
  height: number;
  label?: string;
}

export interface UserEquipmentNode {
  id: string;       // unique, e.g. 'user_abc123'
  tag: string;      // e.g. 'D-010'
  name: string;     // e.g. 'Brine Saturation'
  type: string;     // 'tank' | 'pump' | 'heatExchanger' | ...
  section: string;  // '100' | '200' | '300' | '400' | '600'
  color?: string;
  position: { x: number; y: number };
  /** type==='mixer' 전용 — 배관 합류 배수(예: 전해조 5기 중 1기만 그리고 ×5 로 표기) */
  multiplier?: number;
}

export interface UserEdgeDef {
  id: string;
  source: string;         // full prefixed node id e.g. 's100_D010'
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  streamId?: string;
  color?: string;
  fluidType?: string;     // e.g. 'Brine' | 'Cl2' | 'NaOH' | 'H2' | 'custom' ...
}

export interface EquipmentSpecOverride {
  name?: string;
  fluid?: string;
  qty?: number;
  operTemp?: string;
  operPress?: string;
  designTemp?: string;
  designPress?: string;
  material?: string;
  capacity?: string;
  motor?: string;
  remarks?: string;
  designedAt?: string;
}

export interface ActiveDesignRequest {
  tab: 'pump' | 'packing' | 'hx' | 'evap' | 'brine' | 'pressure' | 'chempro';
  tag: string;
  chemproSubTab?: 'hx' | 'pump' | 'column' | 'vessel' | 'piping' | 'psv';
  handoff?: boolean;
}

interface NodePosition { x: number; y: number; }

interface PFDStore {
  editMode: boolean;
  showCrossEdges: boolean;
  nodePositions: Record<string, NodePosition>;
  customIcons: Record<string, CustomIconDef>;
  edgeStreamMap: Record<string, string>;
  /** 모든 엣지(하드코딩 포함)의 색상 오버라이드 — 리로드 후에도 유지 */
  edgeColorOverrides: Record<string, string>;
  /** 모든 엣지의 유체 종류 — 리로드 후에도 유지 */
  edgeFluidMap: Record<string, string>;
  userNodes: UserEquipmentNode[];
  userEdges: UserEdgeDef[];
  deletedNodeIds: string[];
  deletedEdgeIds: string[];
  nodeTagOverrides: Record<string, { tag: string; name: string }>;
  /** 개별 장치 노드의 모양(type) 오버라이드 — 예: tank -> agitatedDrum, tower -> towerPacking */
  nodeTypeOverrides: Record<string, string>;
  /** 장치 설계 모듈에서 계산/업데이트된 장치 사양 (Equipment List 연동) */
  equipmentSpecsOverrides: Record<string, EquipmentSpecOverride>;
  /** 장치 목록 또는 PFD에서 특정 장치 설계 탭으로 바로 이동 요청 */
  activeDesignRequest: ActiveDesignRequest | null;
  /** 좌측 사이드바에서 선택한 전해공장 하위 설비설계 탭 */
  equipSubTab: string;

  setEditMode: (v: boolean) => void;
  setEquipSubTab: (tab: string) => void;
  toggleCrossEdges: () => void;
  saveNodePosition: (id: string, pos: NodePosition) => void;
  saveBatchPositions: (positions: Record<string, NodePosition>) => void;
  setCustomIcon: (type: string, def: CustomIconDef) => void;
  removeCustomIcon: (type: string) => void;
  resetNodePositions: () => void;
  /** 라인테이블(물질수지표) 78개 전 스트림 번호 및 누락 배관을 현재 캔버스와 즉시 동기화 */
  syncLineTableStreams: () => void;
  setEdgeStream: (edgeId: string, streamId: string) => void;
  clearEdgeStream: (edgeId: string) => void;
  /** 배관 색상+유체 한꺼번에 저장 (모든 엣지 공통) */
  setEdgeAppearance: (edgeId: string, color: string, fluidType: string) => void;
  addUserNode: (node: UserEquipmentNode) => void;
  removeUserNode: (id: string) => void;
  updateUserNodePosition: (id: string, pos: { x: number; y: number }) => void;
  updateUserNodeMultiplier: (id: string, multiplier: number) => void;
  // Edge editing
  addUserEdge: (edge: UserEdgeDef) => void;
  removeUserEdge: (id: string) => void;
  updateUserEdgeColor: (id: string, color: string) => void;
  // Delete
  markNodeDeleted: (id: string) => void;
  markEdgeDeleted: (id: string) => void;
  restoreNode: (id: string) => void;
  restoreEdge: (id: string) => void;
  // Tag & Type overrides
  setNodeTagOverride: (nodeId: string, tag: string, name: string) => void;
  clearNodeTagOverride: (nodeId: string) => void;
  setNodeTypeOverride: (nodeId: string, newType: string) => void;
  // Equipment design spec overrides
  setEquipmentSpecOverride: (tag: string, spec: EquipmentSpecOverride) => void;
  clearEquipmentSpecOverride: (tag: string) => void;
  setActiveDesignRequest: (req: ActiveDesignRequest | null) => void;
}

export const usePFDStore = create<PFDStore>()(
  persist(
    (set) => ({
      editMode: false,
      showCrossEdges: true,
      nodePositions: (defaultPfdLayoutData.nodePositions as Record<string, NodePosition>) || {},
      customIcons: {},
      edgeStreamMap: defaultPfdLayoutData.edgeStreamMap || {},
      edgeColorOverrides: {},
      edgeFluidMap: {},
      userNodes: (defaultPfdLayoutData.userNodes as unknown as UserEquipmentNode[]) || [],
      userEdges: (defaultPfdLayoutData.userEdges as unknown as UserEdgeDef[]) || [],
      deletedNodeIds: defaultPfdLayoutData.deletedNodeIds || [],
      deletedEdgeIds: defaultPfdLayoutData.deletedEdgeIds || [],
      nodeTagOverrides: (defaultPfdLayoutData.nodeTagOverrides as unknown as Record<string, { tag: string; name: string }>) || {},
      nodeTypeOverrides: {},
      equipmentSpecsOverrides: {},
      activeDesignRequest: null,
      equipSubTab: 'evap',

      setEditMode: (v) => set({ editMode: v }),
      setEquipSubTab: (tab) => set({ equipSubTab: tab }),
      toggleCrossEdges: () => set(s => ({ showCrossEdges: !s.showCrossEdges })),
      saveNodePosition: (id, pos) => set(s => ({
        nodePositions: { ...s.nodePositions, [id]: pos },
      })),
      saveBatchPositions: (positions) => set(s => ({
        nodePositions: { ...s.nodePositions, ...positions },
      })),
      setCustomIcon: (type, def) => set(s => ({
        customIcons: { ...s.customIcons, [type]: def },
      })),
      removeCustomIcon: (type) => set(s => {
        const next = { ...s.customIcons };
        delete next[type];
        return { customIcons: next };
      }),
      resetNodePositions: () => set({
        nodePositions: (defaultPfdLayoutData.nodePositions as Record<string, NodePosition>) || {},
        userNodes: (defaultPfdLayoutData.userNodes as unknown as UserEquipmentNode[]) || [],
        userEdges: (defaultPfdLayoutData.userEdges as unknown as UserEdgeDef[]) || [],
        deletedNodeIds: defaultPfdLayoutData.deletedNodeIds || [],
        deletedEdgeIds: defaultPfdLayoutData.deletedEdgeIds || [],
        nodeTagOverrides: (defaultPfdLayoutData.nodeTagOverrides as unknown as Record<string, { tag: string; name: string }>) || {},
        nodeTypeOverrides: {},
        edgeStreamMap: defaultPfdLayoutData.edgeStreamMap || {},
      }),
      syncLineTableStreams: () => set(s => {
        const defMap = (defaultPfdLayoutData.edgeStreamMap as Record<string, string>) || {};
        const defEdges = (defaultPfdLayoutData.userEdges as unknown as UserEdgeDef[]) || [];
        const badIds = new Set(['user_edge_1779540028672', 'user_edge_1779511369861']);
        const mergedEdges = s.userEdges
          .filter(ue => !badIds.has(ue.id))
          .map(ue => defMap[ue.id] ? { ...ue, streamId: defMap[ue.id] } : ue);
        const existingIds = new Set(mergedEdges.map(e => e.id));
        defEdges.forEach(de => {
          if (!existingIds.has(de.id)) {
            mergedEdges.push(de);
          }
        });
        return {
          edgeStreamMap: { ...s.edgeStreamMap, ...defMap },
          userEdges: mergedEdges,
        };
      }),
      setEdgeStream: (edgeId, streamId) => set(s => ({
        edgeStreamMap: { ...s.edgeStreamMap, [edgeId]: streamId },
      })),
      clearEdgeStream: (edgeId) => set(s => {
        const next = { ...s.edgeStreamMap };
        delete next[edgeId];
        return { edgeStreamMap: next };
      }),
      setEdgeAppearance: (edgeId, color, fluidType) => set(s => ({
        edgeColorOverrides: { ...s.edgeColorOverrides, [edgeId]: color },
        edgeFluidMap:       { ...s.edgeFluidMap,       [edgeId]: fluidType },
        // userEdge 도 함께 업데이트
        userEdges: s.userEdges.map(e =>
          e.id === edgeId ? { ...e, color, fluidType } : e
        ),
      })),
      addUserNode: (node) => set(s => ({ userNodes: [...s.userNodes, node] })),
      removeUserNode: (id) => set(s => ({ userNodes: s.userNodes.filter(n => n.id !== id) })),
      updateUserNodePosition: (id, pos) => set(s => ({
        userNodes: s.userNodes.map(n => n.id === id ? { ...n, position: pos } : n),
      })),
      updateUserNodeMultiplier: (id, multiplier) => set(s => ({
        userNodes: s.userNodes.map(n => n.id === id ? { ...n, multiplier } : n),
      })),
      addUserEdge: (edge) => set(s => ({ userEdges: [...s.userEdges, edge] })),
      removeUserEdge: (id) => set(s => ({ userEdges: s.userEdges.filter(e => e.id !== id) })),
      updateUserEdgeColor: (id, color) => set(s => ({
        userEdges: s.userEdges.map(e => e.id === id ? { ...e, color } : e),
        edgeColorOverrides: { ...s.edgeColorOverrides, [id]: color },
      })),
      markNodeDeleted: (id) => set(s => ({
        deletedNodeIds: s.deletedNodeIds.includes(id) ? s.deletedNodeIds : [...s.deletedNodeIds, id],
      })),
      markEdgeDeleted: (id) => set(s => ({
        deletedEdgeIds: s.deletedEdgeIds.includes(id) ? s.deletedEdgeIds : [...s.deletedEdgeIds, id],
      })),
      restoreNode: (id) => set(s => ({ deletedNodeIds: s.deletedNodeIds.filter(x => x !== id) })),
      restoreEdge: (id) => set(s => ({ deletedEdgeIds: s.deletedEdgeIds.filter(x => x !== id) })),
      setNodeTagOverride: (nodeId, tag, name) => set(s => ({
        nodeTagOverrides: { ...s.nodeTagOverrides, [nodeId]: { tag, name } },
      })),
      clearNodeTagOverride: (nodeId) => set(s => {
        const next = { ...s.nodeTagOverrides };
        delete next[nodeId];
        return { nodeTagOverrides: next };
      }),
      setNodeTypeOverride: (nodeId, newType) => set(s => ({
        nodeTypeOverrides: { ...s.nodeTypeOverrides, [nodeId]: newType },
        userNodes: s.userNodes.map(n => n.id === nodeId ? { ...n, type: newType } : n),
      })),
      setEquipmentSpecOverride: (tag, spec) => set(s => ({
        equipmentSpecsOverrides: {
          ...s.equipmentSpecsOverrides,
          [tag]: { ...(s.equipmentSpecsOverrides[tag] ?? {}), ...spec },
        },
      })),
      clearEquipmentSpecOverride: (tag) => set(s => {
        const next = { ...s.equipmentSpecsOverrides };
        delete next[tag];
        return { equipmentSpecsOverrides: next };
      }),
      setActiveDesignRequest: (req) => set({ activeDesignRequest: req }),
    }),
    {
      name: LOCAL_KEY,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state || typeof window === 'undefined') return;
        try {
          // v10, v11, v12에 사용자가 직접 그려둔 장치(D-080, D-250, D-370 등)와 배관·위치를 모두 병합 복원
          const legacyKeys = ['electro-pfd-layout-v10', 'electro-pfd-layout-v11', 'electro-pfd-layout-v12'];
          const mergedUserNodesMap = new Map<string, UserEquipmentNode>();
          const mergedUserEdgesMap = new Map<string, UserEdgeDef>();
          let mergedPositions: Record<string, NodePosition> = { ...(state.nodePositions ?? {}) };
          let mergedTagOverrides: Record<string, { tag: string; name: string }> = { ...(state.nodeTagOverrides ?? {}) };
          let mergedTypeOverrides: Record<string, string> = { ...(state.nodeTypeOverrides ?? {}) };
          let mergedColorOverrides: Record<string, string> = { ...(state.edgeColorOverrides ?? {}) };
          let mergedFluidMap: Record<string, string> = { ...(state.edgeFluidMap ?? {}) };
          let mergedStreamMap: Record<string, string> = { ...(state.edgeStreamMap ?? {}) };
          let mergedCustomIcons: Record<string, CustomIconDef> = { ...(state.customIcons ?? {}) };
          let mergedSpecs: Record<string, EquipmentSpecOverride> = { ...(state.equipmentSpecsOverrides ?? {}) };
          let bestDeletedNodes: string[] = state.deletedNodeIds ?? [];
          let bestDeletedEdges: string[] = state.deletedEdgeIds ?? [];
          let maxUserNodesCount = (state.userNodes ?? []).length;

          (state.userNodes ?? []).forEach(n => mergedUserNodesMap.set(n.id, n));
          (state.userEdges ?? []).forEach(e => mergedUserEdgesMap.set(e.id, e));

          for (const key of legacyKeys) {
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw)?.state;
            if (!parsed) continue;

            if (Array.isArray(parsed.userNodes)) {
              parsed.userNodes.forEach((n: UserEquipmentNode) => {
                if (n && n.id) mergedUserNodesMap.set(n.id, n);
              });
              if (parsed.userNodes.length >= maxUserNodesCount) {
                maxUserNodesCount = parsed.userNodes.length;
                if (Array.isArray(parsed.deletedNodeIds)) bestDeletedNodes = parsed.deletedNodeIds;
                if (Array.isArray(parsed.deletedEdgeIds)) bestDeletedEdges = parsed.deletedEdgeIds;
              }
            }
            if (Array.isArray(parsed.userEdges)) {
              parsed.userEdges.forEach((e: UserEdgeDef) => {
                if (e && e.id) mergedUserEdgesMap.set(e.id, e);
              });
            }
            if (parsed.nodePositions) {
              mergedPositions = { ...mergedPositions, ...parsed.nodePositions };
            }
            if (parsed.nodeTagOverrides) {
              mergedTagOverrides = { ...mergedTagOverrides, ...parsed.nodeTagOverrides };
            }
            if (parsed.nodeTypeOverrides) {
              mergedTypeOverrides = { ...mergedTypeOverrides, ...parsed.nodeTypeOverrides };
            }
            if (parsed.edgeColorOverrides) {
              mergedColorOverrides = { ...mergedColorOverrides, ...parsed.edgeColorOverrides };
            }
            if (parsed.edgeFluidMap) {
              mergedFluidMap = { ...mergedFluidMap, ...parsed.edgeFluidMap };
            }
            if (parsed.edgeStreamMap) {
              mergedStreamMap = { ...mergedStreamMap, ...parsed.edgeStreamMap };
            }
            if (parsed.customIcons) {
              mergedCustomIcons = { ...mergedCustomIcons, ...parsed.customIcons };
            }
            if (parsed.equipmentSpecsOverrides) {
              mergedSpecs = { ...mergedSpecs, ...parsed.equipmentSpecsOverrides };
            }
          }

          usePFDStore.setState({
            userNodes: Array.from(mergedUserNodesMap.values()),
            userEdges: Array.from(mergedUserEdgesMap.values()),
            nodePositions: mergedPositions,
            nodeTagOverrides: mergedTagOverrides,
            nodeTypeOverrides: mergedTypeOverrides,
            edgeColorOverrides: mergedColorOverrides,
            edgeFluidMap: mergedFluidMap,
            edgeStreamMap: mergedStreamMap,
            customIcons: mergedCustomIcons,
            equipmentSpecsOverrides: mergedSpecs,
            deletedNodeIds: bestDeletedNodes,
            deletedEdgeIds: bestDeletedEdges,
          });
        } catch {
          // ignore
        }
      },
    }
  )
);

// Equipment type display names (used in IconManager)
export const EQUIPMENT_TYPES = [
  { type: 'electrolyzer',  label: '이온교환막 전해조',    defaultW: 100, defaultH: 70 },
  { type: 'agitatedDrum',  label: '반응기 / 교반드럼',    defaultW: 54,  defaultH: 74 },
  { type: 'tank',          label: '수직 드럼 (V-Drum)',   defaultW: 54,  defaultH: 66 },
  { type: 'drumHorizontal',label: '수평 드럼 (H-Drum)',   defaultW: 76,  defaultH: 40 },
  { type: 'separator',     label: '기액분리기 (K.O Drum)', defaultW: 44,  defaultH: 76 },
  { type: 'towerPacking',  label: '팩킹컬럼 (충진탑)',     defaultW: 38,  defaultH: 90 },
  { type: 'tower',         label: '증류컬럼 (트레이탑)',   defaultW: 38,  defaultH: 90 },
  { type: 'evaporator',    label: '강하막 증발관 (Evap)',  defaultW: 42,  defaultH: 90 },
  { type: 'filter',        label: '필터 / 여과기',        defaultW: 52,  defaultH: 60 },
  { type: 'heatExchanger', label: '열교환기 (HEX)',       defaultW: 60,  defaultH: 48 },
  { type: 'pump',          label: '원심 펌프 (Pump)',     defaultW: 36,  defaultH: 36 },
  { type: 'compressor',    label: '압축기 (Compressor)',  defaultW: 46,  defaultH: 46 },
  { type: 'valve',         label: '컨트롤 밸브',          defaultW: 28,  defaultH: 28 },
  { type: 'branch',        label: '배관 브랜치',          defaultW: 20,  defaultH: 20 },
  { type: 'mixer',         label: '믹서 (배수 ×N)',       defaultW: 40,  defaultH: 40 },
];

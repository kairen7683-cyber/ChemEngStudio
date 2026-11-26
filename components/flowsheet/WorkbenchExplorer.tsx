'use client';

import React, { useState } from 'react';

export interface WorkbenchExplorerSheetItem {
  id: string;
  shortLabel: string;
  title: string;
  unitCount: number;
}

export interface WorkbenchExplorerBlockItem {
  id: string;
  tag: string;
  name: string;
  unitType: string;
}

export interface WorkbenchExplorerStreamItem {
  id: string;
  streamNo: string;
  summary?: string;
}

export interface WorkbenchExplorerProps {
  lang: 'ko' | 'en';
  open: boolean;
  onToggleOpen: () => void;
  sheets: WorkbenchExplorerSheetItem[];
  activeSheetId: string;
  onSelectSheet: (sheetId: string) => void;
  blocks: WorkbenchExplorerBlockItem[];
  selectedNodeId: string | null;
  onSelectBlock: (nodeId: string) => void;
  streams?: WorkbenchExplorerStreamItem[];
  selectedEdgeId?: string | null;
  onSelectStream?: (edgeId: string) => void;
  hasPlantBasisControls?: boolean;
  onOpenPlantBasis?: () => void;
}

interface HoverTip {
  top: number;
  title: string;
  sub?: string;
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * 초슬림 고정형 좌측 태그 레일 탐색기 (98px 고정 — 열고 닫는 번거로움 제거)
 * - 시트(다단 공정 시) · 블록(태그) · 스트림(번호)을 깔끔하게 구분 표시
 * - 긴 태그/스트림에 마우스를 올리면 우측으로 전체 이름 말풍선이 부드럽게 표시됨
 * - 예제 공장(Plant Basis)처럼 넓은 사이드 패널이 필요할 때만 상단 [기준 ▸]으로 전용 패널 호출
 */
export default function WorkbenchExplorer({
  lang,
  sheets,
  activeSheetId,
  onSelectSheet,
  blocks,
  selectedNodeId,
  onSelectBlock,
  streams = [],
  selectedEdgeId = null,
  onSelectStream,
  hasPlantBasisControls = false,
  onOpenPlantBasis,
}: WorkbenchExplorerProps) {
  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);

  const [blocksOpen, setBlocksOpen] = useState(true);
  const [streamsOpen, setStreamsOpen] = useState(true);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);

  const showSheets = sheets.length > 1;
  const orderedSheets = [
    ...sheets.filter(s => s.id === 'master'),
    ...sheets.filter(s => s.id !== 'master'),
  ];

  // 블록 목록에는 순수 공정 장치만 표시 (feed/product 경계 노드는 스트림과 중복되므로 제외)
  const equipmentBlocks = blocks.filter(
    b => b.unitType !== 'feed' && b.unitType !== 'product'
  );

  // 스트림 중복 제거 (동일 streamNo/id)
  const uniqueStreams = streams.filter((s, idx, arr) => {
    const key = (s.streamNo || s.id).trim();
    return arr.findIndex(x => (x.streamNo || x.id).trim() === key) === idx;
  });

  const handleMouseEnterItem = (e: React.MouseEvent<HTMLElement>, title: string, sub?: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverTip({
      top: rect.top + rect.height / 2,
      title,
      sub,
    });
  };

  return (
    <aside
      className="wb-slim-rail"
      onMouseLeave={() => setHoverTip(null)}
      style={{
        width: 76,
        flexShrink: 0,
        height: '100%',
        backgroundColor: 'var(--bg-surface, #FFFFFF)',
        borderRight: '1px solid var(--border-subtle, #E2E8F0)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
        userSelect: 'none',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
      }}
    >
      <style>{`
        .wb-rail-scroll::-webkit-scrollbar { width: 3px; }
        .wb-rail-scroll::-webkit-scrollbar-track { background: transparent; }
        .wb-rail-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }
        .wb-rail-item {
          width: 100%;
          border: none;
          border-left: 2px solid transparent;
          background: transparent;
          text-align: left;
          padding: 3.5px 5px;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-secondary, #334155);
          font-family: ${MONO};
          cursor: pointer;
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition: background-color 100ms ease, color 100ms ease;
        }
        .wb-rail-item.wb-rail-stream {
          color: #0F766E;
        }
        html[data-wb-theme="dark"] .wb-rail-item.wb-rail-stream {
          color: #5EEAD4;
        }
        .wb-rail-item:hover {
          background-color: var(--bg-hover, #F1F5F9);
          color: var(--text-primary, #0F172A);
        }
        .wb-rail-item.active {
          background-color: #EFF6FF;
          border-left-color: #1E3A8A;
          color: #1E3A8A;
          font-weight: 800;
        }
        html[data-wb-theme="dark"] .wb-rail-item.active {
          background-color: rgba(30, 58, 138, 0.45);
          border-left-color: #60A5FA;
          color: #93C5FD;
        }
        .wb-rail-sec-btn {
          width: 100%;
          border: none;
          background: var(--bg-base, #F8FAFC);
          border-top: 1px solid var(--border-subtle, #E2E8F0);
          border-bottom: 1px solid var(--border-subtle, #E2E8F0);
          padding: 3.5px 5px;
          font-size: 9px;
          font-weight: 800;
          color: var(--text-muted, #64748B);
          letter-spacing: 0.15px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
        }
      `}</style>

      {/* 예제 공장 전용: 넓은 운전 기준 패널이 필요할 때만 상단 1클릭 버튼 제공 */}
      {hasPlantBasisControls && onOpenPlantBasis && (
        <div style={{ padding: '6px 6px 4px', borderBottom: '1px solid var(--border-subtle, #E2E8F0)' }}>
          <button
            type="button"
            onClick={onOpenPlantBasis}
            onMouseEnter={e =>
              handleMouseEnterItem(
                e,
                t('공장 운전 기준 패널', 'Plant Operating Basis'),
                t('생산량 · 전류 · 부하율 조절', 'Scale capacity, current & load')
              )
            }
            onMouseLeave={() => setHoverTip(null)}
            style={{
              width: '100%',
              padding: '4px 6px',
              borderRadius: 5,
              border: '1px solid #BFDBFE',
              background: '#EFF6FF',
              color: '#1E3A8A',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{t('운전 기준', 'Basis')}</span>
            <span style={{ fontSize: 10 }}>▸</span>
          </button>
        </div>
      )}

      {/* 스크롤 영역: 시트 · 블록 · 스트림 */}
      <div className="wb-rail-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* 1) 다단 계층 시트 */}
        {showSheets && (
          <div>
            <div
              style={{
                padding: '4px 6px',
                fontSize: 9.5,
                fontWeight: 800,
                color: 'var(--text-muted, #64748B)',
                background: 'var(--bg-base, #F8FAFC)',
                borderBottom: '1px solid var(--border-subtle, #E2E8F0)',
              }}
            >
              {t('시트', 'SHEETS')} ({orderedSheets.length})
            </div>
            {orderedSheets.map(sh => {
              const active = sh.id === activeSheetId;
              const shortTag =
                sh.id === 'master'
                  ? t('마스터', 'Master')
                  : sh.shortLabel.replace(/^[^\w가-힣]+/, '').slice(0, 12);
              return (
                <button
                  key={sh.id}
                  type="button"
                  className={`wb-rail-item${active ? ' active' : ''}`}
                  onClick={() => onSelectSheet(sh.id)}
                  onMouseEnter={e => handleMouseEnterItem(e, sh.shortLabel, sh.title)}
                  onMouseLeave={() => setHoverTip(null)}
                >
                  {shortTag}
                </button>
              );
            })}
          </div>
        )}

        {/* 2) 블록 (순수 장치 태그만) */}
        <button
          type="button"
          className="wb-rail-sec-btn"
          onClick={() => setBlocksOpen(v => !v)}
        >
          <span>{t('블록', 'BLK')} ({equipmentBlocks.length})</span>
          <span>{blocksOpen ? '▾' : '▸'}</span>
        </button>
        {blocksOpen && (
          <div style={{ padding: '2px 0' }}>
            {equipmentBlocks.map(b => {
              const active = selectedNodeId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`wb-rail-item${active ? ' active' : ''}`}
                  onClick={() => onSelectBlock(b.id)}
                  onMouseEnter={e => handleMouseEnterItem(e, b.tag, b.name)}
                  onMouseLeave={() => setHoverTip(null)}
                >
                  {b.tag}
                </button>
              );
            })}
          </div>
        )}

        {/* 3) 스트림 (중복 제거된 배관 번호) */}
        <button
          type="button"
          className="wb-rail-sec-btn"
          onClick={() => setStreamsOpen(v => !v)}
        >
          <span>{t('스트림', 'STR')} ({uniqueStreams.length})</span>
          <span>{streamsOpen ? '▾' : '▸'}</span>
        </button>
        {streamsOpen && (
          <div style={{ padding: '2px 0 8px' }}>
            {uniqueStreams.map(s => {
              const active = selectedEdgeId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`wb-rail-item wb-rail-stream${active ? ' active' : ''}`}
                  onClick={() => onSelectStream?.(s.id)}
                  onMouseEnter={e => handleMouseEnterItem(e, s.streamNo, s.summary)}
                  onMouseLeave={() => setHoverTip(null)}
                >
                  {s.streamNo}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 마우스 호버 시 우측으로 살짝 펼쳐지는 전체 태그/이름 툴팁 */}
      {hoverTip && (
        <div
          style={{
            position: 'fixed',
            left: 82,
            top: hoverTip.top,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
            background: '#0F172A',
            color: '#F8FAFC',
            padding: '5px 9px',
            borderRadius: 6,
            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.28)',
            border: '1px solid #334155',
            maxWidth: 280,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, fontFamily: MONO }}>{hoverTip.title}</div>
          {hoverTip.sub && (
            <div
              style={{
                fontSize: 10.5,
                color: '#CBD5E1',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {hoverTip.sub}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

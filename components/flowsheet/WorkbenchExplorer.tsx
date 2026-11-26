'use client';

import React, { useMemo, useState } from 'react';

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
  hasPlantBasisControls?: boolean;
  onOpenPlantBasis?: () => void;
}

export default function WorkbenchExplorer({
  lang,
  open,
  onToggleOpen,
  sheets,
  activeSheetId,
  onSelectSheet,
  blocks,
  selectedNodeId,
  onSelectBlock,
  hasPlantBasisControls = false,
  onOpenPlantBasis,
}: WorkbenchExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetsExpanded, setSheetsExpanded] = useState(true);
  const [blocksExpanded, setBlocksExpanded] = useState(true);

  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);

  const { masterSheet, subSheets } = useMemo(() => {
    const master = sheets.find((s) => s.id === 'master') ?? sheets[0] ?? null;
    const subs = master ? sheets.filter((s) => s.id !== master.id) : [];
    return { masterSheet: master, subSheets: subs };
  }, [sheets]);

  const filteredBlocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter(
      (b) =>
        b.tag.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        b.unitType.toLowerCase().includes(q)
    );
  }, [blocks, searchQuery]);

  // Collapsed slim 28px expand rail
  if (!open) {
    return (
      <div
        style={{
          width: 28,
          minWidth: 28,
          maxWidth: 28,
          height: '100%',
          backgroundColor: '#F8FAFC',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          gap: 10,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          title={t('탐색기 열기', 'Expand Explorer')}
          aria-label={t('탐색기 열기', 'Expand Explorer')}
          style={{
            width: 20,
            height: 22,
            borderRadius: 4,
            border: '1px solid #CBD5E1',
            backgroundColor: '#FFFFFF',
            color: '#475569',
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ›
        </button>
        <button
          type="button"
          onClick={onToggleOpen}
          title={t('탐색기 열기', 'Expand Explorer')}
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            border: 'none',
            background: 'transparent',
            color: '#64748B',
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          {t('탐색기', 'Explorer')}
        </button>
      </div>
    );
  }

  return (
    <aside
      className="wb-explorer-root"
      style={{
        width: 224,
        minWidth: 224,
        maxWidth: 224,
        height: '100%',
        backgroundColor: '#F8FAFC',
        borderRight: '1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
      }}
    >
      <style>{`
        .wb-exp-scroll::-webkit-scrollbar { width: 5px; }
        .wb-exp-scroll::-webkit-scrollbar-track { background: transparent; }
        .wb-exp-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
        .wb-exp-row {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          border-radius: 4px;
          transition: background-color 110ms ease, color 110ms ease;
        }
        .wb-exp-row:hover {
          background: #E2E8F0;
        }
        .wb-exp-row.active {
          background: #EFF6FF;
          color: #1E3A8A;
        }
        .wb-exp-basis-btn {
          width: 100%;
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid #CBD5E1;
          background: #FFFFFF;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          text-align: left;
          transition: border-color 120ms ease, background-color 120ms ease;
        }
        .wb-exp-basis-btn:hover {
          border-color: #1E3A8A;
          background: #EFF6FF;
        }
      `}</style>

      {/* Panel Header */}
      <div
        style={{
          height: 32,
          padding: '0 8px 0 10px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#1E293B',
            letterSpacing: '0.02em',
          }}
        >
          {t('시뮬레이션 탐색기', 'Simulation Explorer')}
        </span>
        <button
          type="button"
          onClick={onToggleOpen}
          title={t('탐색기 접기', 'Collapse Explorer')}
          aria-label={t('탐색기 접기', 'Collapse Explorer')}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: '1px solid transparent',
            background: 'transparent',
            color: '#64748B',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ‹
        </button>
      </div>

      {/* Section 1: Flowsheets (rendered when sheets.length > 1) */}
      {sheets.length > 1 && masterSheet && (
        <div
          style={{
            borderBottom: '1px solid #E2E8F0',
            padding: '6px 8px 8px',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setSheetsExpanded((v) => !v)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              padding: '2px 2px 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              color: '#64748B',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.03em',
            }}
          >
            <span>
              {sheetsExpanded ? '▾ ' : '▸ '}
              {t('공정 시트', 'Flowsheets')}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>
              {sheets.length}
            </span>
          </button>

          {sheetsExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              {/* Master Sheet Root */}
              {(() => {
                const isActive = activeSheetId === masterSheet.id;
                return (
                  <button
                    type="button"
                    className={`wb-exp-row${isActive ? ' active' : ''}`}
                    onClick={() => onSelectSheet(masterSheet.id)}
                    title={masterSheet.title}
                    style={{
                      padding: '5px 7px',
                      borderLeft: isActive ? '2px solid #1E3A8A' : '2px solid transparent',
                      fontSize: 11.5,
                      fontWeight: isActive ? 700 : 600,
                      color: isActive ? '#1E3A8A' : '#1E293B',
                    }}
                  >
                    <span style={{ fontSize: 10, color: isActive ? '#1E3A8A' : '#64748B' }}>
                      ◆
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {masterSheet.id === 'master'
                        ? t('마스터 도면', 'Master Sheet')
                        : masterSheet.shortLabel}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '0 5px',
                        borderRadius: 8,
                        backgroundColor: isActive ? '#DBEAFE' : '#E2E8F0',
                        color: isActive ? '#1E3A8A' : '#475569',
                        flexShrink: 0,
                      }}
                    >
                      {masterSheet.unitCount}
                    </span>
                  </button>
                );
              })()}

              {/* Indented Sub-sheets */}
              {subSheets.length > 0 && (
                <div
                  style={{
                    marginLeft: 10,
                    paddingLeft: 8,
                    borderLeft: '1px solid #CBD5E1',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    marginTop: 2,
                  }}
                >
                  {subSheets.map((sheet) => {
                    const isActive = activeSheetId === sheet.id;
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        className={`wb-exp-row${isActive ? ' active' : ''}`}
                        onClick={() => onSelectSheet(sheet.id)}
                        title={sheet.title}
                        style={{
                          padding: '4px 6px',
                          borderLeft: isActive ? '2px solid #1E3A8A' : '2px solid transparent',
                          fontSize: 11,
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? '#1E3A8A' : '#334155',
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {sheet.shortLabel}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '0 5px',
                            borderRadius: 8,
                            backgroundColor: isActive ? '#DBEAFE' : '#E2E8F0',
                            color: isActive ? '#1E3A8A' : '#475569',
                            flexShrink: 0,
                          }}
                        >
                          {sheet.unitCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section 2: Plant Basis (rendered when hasPlantBasisControls) */}
      {hasPlantBasisControls && (
        <div
          style={{
            borderBottom: '1px solid #E2E8F0',
            padding: '8px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: '#64748B',
              letterSpacing: '0.03em',
              marginBottom: 6,
              paddingLeft: 2,
            }}
          >
            {t('공장 운전 기준', 'Plant Basis')}
          </div>
          <button
            type="button"
            className="wb-exp-basis-btn"
            onClick={() => onOpenPlantBasis?.()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#1E3A8A',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t('기준 패널 열기', 'Open Basis Panel')}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#64748B',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t('생산량 · 운전조건 슬라이더', 'Capacity & Operating Sliders')}
              </span>
            </div>
            <span style={{ fontSize: 12, color: '#1E3A8A', fontWeight: 700, flexShrink: 0 }}>
              ⚙
            </span>
          </button>
        </div>
      )}

      {/* Section 3: Blocks (N) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 8px 8px',
        }}
      >
        <button
          type="button"
          onClick={() => setBlocksExpanded((v) => !v)}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            padding: '2px 2px 5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            color: '#64748B',
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.03em',
            flexShrink: 0,
          }}
        >
          <span>
            {blocksExpanded ? '▾ ' : '▸ '}
            {isEn ? `Blocks (${blocks.length})` : `장치 목록 (${blocks.length})`}
          </span>
        </button>

        {blocksExpanded && (
          <>
            {/* Compact Search Filter */}
            <div style={{ position: 'relative', marginBottom: 6, flexShrink: 0 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('태그·장치명 검색...', 'Filter tag or name...')}
                style={{
                  width: '100%',
                  height: 26,
                  padding: searchQuery ? '0 22px 0 8px' : '0 8px',
                  borderRadius: 4,
                  border: '1px solid #CBD5E1',
                  backgroundColor: '#FFFFFF',
                  color: '#0F172A',
                  fontSize: 11,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('검색어 지우기', 'Clear filter')}
                  style={{
                    position: 'absolute',
                    right: 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    border: 'none',
                    background: 'transparent',
                    color: '#94A3B8',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* Scrollable Block List */}
            <div
              className="wb-exp-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {filteredBlocks.length === 0 ? (
                <div
                  style={{
                    padding: '16px 6px',
                    textAlign: 'center',
                    fontSize: 11,
                    color: '#94A3B8',
                  }}
                >
                  {blocks.length === 0
                    ? t('배치된 장치가 없습니다.', 'No blocks on this sheet.')
                    : t('일치하는 장치가 없습니다.', 'No matching blocks.')}
                </div>
              ) : (
                filteredBlocks.map((block) => {
                  const isSelected = selectedNodeId === block.id;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      className={`wb-exp-row${isSelected ? ' active' : ''}`}
                      onClick={() => onSelectBlock(block.id)}
                      title={`${block.tag} — ${block.name} (${block.unitType})`}
                      style={{
                        padding: '4px 6px',
                        borderLeft: isSelected ? '2px solid #1E3A8A' : '2px solid transparent',
                        color: isSelected ? '#1E3A8A' : '#334155',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: isSelected ? '#1E3A8A' : '#0F172A',
                          flexShrink: 0,
                        }}
                      >
                        {block.tag}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? '#1E3A8A' : '#64748B',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {block.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

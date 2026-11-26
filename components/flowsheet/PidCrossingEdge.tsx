'use client';

import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow';

export interface PidStreamCardData {
  streamNo: string;
  flowText?: string;
  tempText?: string;
  pressText?: string;
  phase?: 'L' | 'G' | 'L/G' | string;
  isTear?: boolean;
  compact?: boolean;
  onSelect?: (edgeId: string) => void;
}

/**
 * P&ID / ISO-10628 교차 배관 끊김(Line Crossing Break) + 콤팩트 텔레메트리 카드 엣지
 * - 배관 아래에 배경색 Halo 마스크를 그려 교차 시 아래쪽 배관이 깔끔하게 끊어져 보입니다.
 * - 긴 1줄 배너 대신 콤팩트 사각 카드(번호·상 / 유량 / 온도·압력)로 도면 겹침을 최소화합니다.
 */
export default function PidCrossingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerStart,
  markerEnd,
  label,
  selected,
  data,
  interactionWidth,
}: EdgeProps<PidStreamCardData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const card = data;
  const phase = card?.phase ?? '';
  const phaseColor =
    phase === 'G' ? '#B45309' : phase === 'L/G' ? '#6D28D9' : '#0369A1';
  const phaseBg =
    phase === 'G'
      ? 'rgba(217, 119, 6, 0.14)'
      : phase === 'L/G'
        ? 'rgba(124, 58, 237, 0.14)'
        : 'rgba(2, 132, 199, 0.13)';

  return (
    <>
      {/* 배경색 교차 마스크 — 위쪽 배관이 지나가는 자리의 아래쪽 배관을 깔끔하게 끊어줌 */}
      <path
        d={edgePath}
        fill="none"
        stroke="#F6F7F2"
        strokeWidth={11}
        strokeLinecap="butt"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
      />

      {card ? (
        <EdgeLabelRenderer>
          <div
            className={`cp-stream-card nodrag nopan${selected ? ' selected' : ''}${card.isTear ? ' tear' : ''}${card.compact ? ' compact' : ''}`}
            onClick={e => {
              e.stopPropagation();
              card.onSelect?.(id);
            }}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {card.compact || !card.flowText ? (
              <div className="cp-stream-card-compact">
                {card.isTear && <span className="cp-stream-tear-dot" />}
                <span>{card.streamNo}</span>
              </div>
            ) : (
              <>
                <div className="cp-stream-card-head">
                  <span className="cp-stream-no">
                    {card.isTear && <span className="cp-stream-tear-dot" />}
                    {card.streamNo}
                  </span>
                  {phase && (
                    <span
                      className="cp-stream-phase"
                      style={{ color: phaseColor, background: phaseBg }}
                    >
                      {phase}
                    </span>
                  )}
                </div>
                <div className="cp-stream-card-flow">{card.flowText}</div>
                <div className="cp-stream-card-tp">
                  {card.tempText} · {card.pressText}
                </div>
              </>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : label ? (
        <EdgeLabelRenderer>
          <div
            className={`cp-stream-card compact nodrag nopan${selected ? ' selected' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <div className="cp-stream-card-compact">{String(label)}</div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

'use client';

import React from 'react';
import {
  BaseEdge,
  EdgeText,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow';

/**
 * P&ID / ISO-10628 교차 배관 끊김(Line Crossing Break) 커스텀 엣지
 * - 모든 smoothstep 배관 아래에 캔버스 배경색(#F6F7F2)의 11px 마스크(Halo)를 먼저 그려
 *   두 배관이 교차할 때 아래쪽 배관이 깔끔하게 잘려(끊겨) 보이는 P&ID 표준 표현을 구현합니다.
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
  labelStyle,
  labelShowBg = true,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* 배경색 교차 마스크 — 위쪽 배관이 지나가는 자리의 아래쪽 배관을 4.5px씩 깔끔하게 끊어줌 */}
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
      {label ? (
        <EdgeText
          x={labelX}
          y={labelY}
          label={label}
          labelStyle={labelStyle}
          labelShowBg={labelShowBg}
          labelBgStyle={labelBgStyle}
          labelBgPadding={labelBgPadding}
          labelBgBorderRadius={labelBgBorderRadius}
        />
      ) : null}
    </>
  );
}

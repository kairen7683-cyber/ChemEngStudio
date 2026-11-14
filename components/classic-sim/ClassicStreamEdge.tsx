'use client';

import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow';

export interface ClassicStreamEdgeData {
  streamNo: string;
  tempC?: number;
  pressKgcm2g?: number;
  massFlowKgH?: number;
  vaporFrac?: number;
  showCallout?: boolean;
  isSolved?: boolean;
  orthogonal?: boolean;
}

export default function ClassicStreamEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
}: EdgeProps<ClassicStreamEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: data?.orthogonal === false ? 8 : 0,
  });

  const showCallout = Boolean(data?.showCallout && data?.isSolved && (data.massFlowKgH ?? 0) > 0);
  const streamNo = data?.streamNo || id;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? '#DC2626' : '#003399',
          strokeWidth: selected ? 2.4 : 1.75,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            cursor: 'pointer',
            background: selected ? '#EFF6FF' : 'rgba(255, 255, 255, 0.94)',
            border: selected ? '1.2px solid #003399' : '1px solid #94A3B8',
            borderRadius: 3,
            padding: showCallout ? '2px 5px' : '1px 4px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            lineHeight: 1.25,
            color: '#0F172A',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 800, color: '#003399', textAlign: 'center' }}>
            {streamNo}
          </div>
          {showCallout && (
            <div style={{ fontSize: 8.2, color: '#334155', borderTop: '1px solid #E2E8F0', marginTop: 1, paddingTop: 1 }}>
              {(data?.tempC ?? 0).toFixed(1)}°C | {(data?.pressKgcm2g ?? 0).toFixed(2)}kG
              <br />
              {(data?.massFlowKgH ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const MultiEffectEvapStudio = dynamic(() => import('@/components/equipment-design/MultiEffectEvapStudio'), { ssr: false });

export default function SpecialProcessPage() {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#F6F7F2',
      color: '#1A2F44',
      fontFamily: "'Inter', system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, width: '100%', overflow: 'auto', minHeight: 0, padding: '16px 20px', background: '#F6F7F2' }}>
        <MultiEffectEvapStudio />
      </div>
    </div>
  );
}

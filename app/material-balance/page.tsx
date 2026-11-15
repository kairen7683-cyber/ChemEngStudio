'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useBalanceStore } from '@/lib/stores/balanceStore';

const ElectrolyzerPlantSimulator = dynamic(
  () => import('@/app/flowsheet-simulator/page').then(m => m.FlowsheetWorkspace),
  {
    ssr: false,
    loading: () => (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%', gap: 16,
        color: 'var(--text-muted)',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid var(--border-default)',
          borderTopColor: '#1A2F44',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 12 }}>공정 시뮬레이터 불러오는 중...</span>
      </div>
    ),
  }
);

export default function MaterialBalancePage() {
  const { activePlantId: plantId, setActivePlantId: setPlantId } = useBalanceStore();

  // 숨김(clorsim 기준참고용) 또는 삭제(green_h2)된 플랜트 ID가 남아있으면 PLANT 01(clorsim_sim)로 정규화
  useEffect(() => {
    if (plantId === 'clorsim' || plantId === 'green_h2') {
      setPlantId('clorsim_sim');
    }
  }, [plantId, setPlantId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden', background: '#F6F7F2' }}>
      {plantId === 'hcl_synth' ? (
        /* ── PLANT 02: 초고순도·무수 염산 합성 & 폐염산 공비회수(PSD) 시뮬레이터 (100~300 SEC 계층형 PFD + 물질수지) ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ElectrolyzerPlantSimulator key="plant03_hcl1a" workspaceMode="hcl_1a_plant" embeddedInPlant={true} />
        </div>
      ) : plantId === 'ech_gte' ? (
        /* ── PLANT 03: ECH 70,000 TPA (GTE 글리세린 공정) 전공정 시뮬레이터 ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ElectrolyzerPlantSimulator key="plant04_ech" workspaceMode="ech_gte_plant" embeddedInPlant={true} />
        </div>
      ) : plantId === 'cms_plant' ? (
        /* ── PLANT 04: 클로로메탄(CMS) 공정 시뮬레이터 (MCL 120 + CFM 80 T/D) ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ElectrolyzerPlantSimulator key="plant05_cms" workspaceMode="cms_plant" embeddedInPlant={true} />
        </div>
      ) : plantId === 'new_builder' ? (
        /* ── 공정 시뮬레이터 ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ElectrolyzerPlantSimulator key="new_plant_builder" workspaceMode="new_plant_builder" embeddedInPlant={false} />
        </div>
      ) : (
        /* ── PLANT 01: 전해공장 시뮬레이터 (100~700 SEC 계층형 풀패키지 + 더블클릭 세부 시뮬레이션) ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ElectrolyzerPlantSimulator key="plant02_chloralkali" workspaceMode="electrolyzer_plant" embeddedInPlant={true} />
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

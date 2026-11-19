'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { useAuth } from '@/components/auth/AuthContext';
import { formatPlantLabelForUser } from '@/lib/plantRegistry';

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
  const router = useRouter();
  const { user } = useAuth();
  const { activePlantId: plantId, setActivePlantId: setPlantId } = useBalanceStore();

  // 숨김(clorsim 기준참고용) 또는 삭제(green_h2)된 플랜트 ID 정규화 및 classic_sim 라우트 이동
  useEffect(() => {
    if (plantId === 'clorsim' || plantId === 'green_h2') {
      setPlantId('clorsim_sim');
    } else if (plantId === 'classic_sim') {
      router.replace('/classic-simulator');
    }
  }, [plantId, router, setPlantId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden', background: '#F8FAFC' }}>
      {plantId === 'classic_sim' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            gap: 14,
            color: '#475569',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '3px solid #E2E8F0',
              borderTopColor: '#1E293B',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>클래식 시뮬레이터로 이동 중...</span>
        </div>
      ) : plantId === 'hcl_synth' ? (
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
      ) : plantId === 'mdi_plant' ? (
        /* ── PLANT 05: MDI 10만톤 통합 공정 시뮬레이터 (Pure 4,500 + PMDI 8,000 kg/h) ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: '#1E293B', color: '#FFFFFF' }}>
                {formatPlantLabelForUser('PLANT 05 · MDI 100,000 TPA', user)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                Pure 4,4&apos;-MDI 4,500 kg/h (108 T/D) · PMDI 8,000 kg/h (192 T/D)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Link
                href="/flowsheet-simulator"
                style={{
                  padding: '3px 9px',
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#1E293B',
                  fontSize: 10.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                독립 플로우시트 시뮬레이터 →
              </Link>
              <Link
                href="/equipment-design?tab=mdi_hub"
                style={{
                  padding: '3px 9px',
                  borderRadius: 5,
                  border: '1px solid #1E3A8A',
                  background: '#1E3A8A',
                  color: '#FFFFFF',
                  fontSize: 10.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                MDI 핵심장치 상세설계 →
              </Link>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ElectrolyzerPlantSimulator key="plant06_mdi" workspaceMode="mdi_plant" embeddedInPlant={true} />
          </div>
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

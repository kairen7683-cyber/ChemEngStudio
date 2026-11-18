'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useBalanceStore } from '@/lib/stores/balanceStore';

const MDI_SECTION_CARDS = [
  { sheetId: 'sub_mdi_100_mda',   code: '100 SEC', title: '100 SEC MDA 합성·염수분리·아닐린회수',           sub: 'R-101 · D-101 · S-101 · C-101 (-0.88 kG)' },
  { sheetId: 'sub_mdi_200_phos',  code: '200 SEC', title: '200 SEC CO+Cl₂ 포스겐합성·2단 포스겐화',         sub: 'R-201 · R-202 (145°C) · S-201 부생 HCl' },
  { sheetId: 'sub_mdi_300_mcb',   code: '300 SEC', title: '300 SEC 탈포스겐·MCB 회수',                     sub: 'C-301 (14단) · C-302 (16단 · -0.90 kG)' },
  { sheetId: 'sub_mdi_400_purif', code: '400 SEC', title: '400 SEC 고진공 Pure 4,4\'-MDI / PMDI 정밀분별', sub: 'E-401 · C-401 (20 mbar) · 4,500 + 8,000 kg/h' },
];

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
  const { activePlantId: plantId, setActivePlantId: setPlantId, simActiveSheetId, requestSimSheet } = useBalanceStore();
  const [mdiStripOpen, setMdiStripOpen] = useState(true);

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
      ) : plantId === 'mdi_plant' ? (
        /* ── PLANT 05: MDI 10만톤 통합 공정 시뮬레이터 (Pure 4,500 + PMDI 8,000 kg/h) ── */
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              background: '#FFFBEB',
              borderBottom: '1px solid #FCD34D',
              padding: mdiStripOpen ? '6px 12px' : '4px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 5, background: '#B45309', color: '#FFFFFF' }}>
                  PLANT 05 · MDI 100,000 TPA
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#78350F' }}>
                  Pure 4,4&apos;-MDI 4,500 kg/h (108 T/D) · PMDI 8,000 kg/h (192 T/D)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Link
                  href="/flowsheet-simulator"
                  style={{
                    padding: '3px 9px',
                    borderRadius: 5,
                    border: '1px solid #1E3A8A',
                    background: '#FFFFFF',
                    color: '#1E3A8A',
                    fontSize: 10.5,
                    fontWeight: 800,
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
                    border: '1px solid #B45309',
                    background: '#B45309',
                    color: '#FFFFFF',
                    fontSize: 10.5,
                    fontWeight: 800,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  MDI 핵심장치 상세설계 →
                </Link>
                <button
                  type="button"
                  onClick={() => setMdiStripOpen(v => !v)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 5,
                    border: '1px solid #D97706',
                    background: '#FEF3C7',
                    color: '#92400E',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {mdiStripOpen ? '섹션 카드 접기 ▲' : '섹션 카드 펼치기 ▼'}
                </button>
              </div>
            </div>
            {mdiStripOpen && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
                {MDI_SECTION_CARDS.map(sec => {
                  const active = simActiveSheetId === sec.sheetId;
                  return (
                    <button
                      key={sec.sheetId}
                      type="button"
                      onClick={() => requestSimSheet(sec.sheetId)}
                      style={{
                        textAlign: 'left',
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: active ? '1.5px solid #B45309' : '1px solid #FDE68A',
                        background: active ? '#FEF3C7' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 900, color: '#92400E' }}>{sec.title}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: '#64748B', marginTop: 1 }}>{sec.sub}</div>
                    </button>
                  );
                })}
              </div>
            )}
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

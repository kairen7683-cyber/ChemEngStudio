'use client';

import { useBalanceStore } from '@/lib/stores/balanceStore';

export default function SummaryStrip() {
  const { balance } = useBalanceStore();
  const { summary, electrolyzerResult: e } = balance;

  const cards = [
    {
      key: 'cl2',
      label: 'Cl₂ 생산량',
      value: summary.cl2_tonDay.toFixed(1),
      unit: 'ton/일',
      sub: `${(e.cl2ProductionKgH).toFixed(0)} kg/h`,
      className: 'cl2',
    },
    {
      key: 'naoh32',
      label: 'NaOH 32% 생산',
      value: summary.naoh32_tonDay.toFixed(1),
      unit: 'ton/일',
      sub: `${(e.naohProductionKgH).toFixed(0)} kg/h`,
      className: 'naoh',
    },
    {
      key: 'naoh50',
      label: 'NaOH 50% 생산',
      value: summary.naoh50_tonDay.toFixed(1),
      unit: 'ton/일',
      sub: '증발농축 후',
      className: 'naoh',
    },
    {
      key: 'h2',
      label: 'H₂ 생산량',
      value: summary.h2_tonDay.toFixed(2),
      unit: 'ton/일',
      sub: `${(e.h2ProductionKgH).toFixed(1)} kg/h`,
      className: 'h2',
    },
    {
      key: 'nacl',
      label: 'NaCl 소모',
      value: summary.naclUsage_tonDay.toFixed(1),
      unit: 'ton/일',
      sub: `소금 ${summary.saltUsage_tonDay.toFixed(1)} ton/일`,
      className: 'nacl',
    },
    {
      key: 'cells',
      label: '총 셀수',
      value: e.totalCellCount.toLocaleString(),
      unit: 'PCS',
      sub: `${e.totalCurrentA.toFixed(0)} A × ${e.theoreticalCurrentEfficiency*100}% CE`,
      className: 'nacl',
    },
  ];

  return (
    <div className="summary-strip">
      {cards.map(card => (
        <div key={card.key} className={`summary-card ${card.className}`}>
          <div className="summary-card-label">{card.label}</div>
          <div className="summary-card-value">{card.value}</div>
          <div className="summary-card-unit">{card.unit} · <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{card.sub}</span></div>
        </div>
      ))}
    </div>
  );
}

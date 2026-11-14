'use client';

import { useBalanceStore } from '@/lib/stores/balanceStore';

export default function OperatingPanel() {
  const { inputs, setInput, balance } = useBalanceStore();
  const { summary } = balance;

  return (
    <div className="control-panel">
      {/* 전해조 수량 */}
      <div className="control-group">
        <div className="control-label">
          전해조 수량
          <span className="control-label-unit">기 (Electrolyzer)</span>
        </div>
        <div className="control-input-row">
          <div className="control-value-display">{inputs.numElectrolyzers}</div>
          <input
            type="range"
            className="control-slider"
            min={1} max={20} step={1}
            value={inputs.numElectrolyzers}
            onChange={e => setInput('numElectrolyzers', Number(e.target.value))}
          />
          <input
            type="number"
            className="control-input"
            min={1} max={20}
            value={inputs.numElectrolyzers}
            onChange={e => setInput('numElectrolyzers', Number(e.target.value))}
          />
        </div>
      </div>

      <Divider />

      {/* 셀 수량 */}
      <div className="control-group">
        <div className="control-label">
          셀 수량
          <span className="control-label-unit">셀/전해조</span>
        </div>
        <div className="control-input-row">
          <div className="control-value-display">{inputs.cellsPerElectrolyzer}</div>
          <input
            type="range"
            className="control-slider"
            min={50} max={500} step={1}
            value={inputs.cellsPerElectrolyzer}
            onChange={e => setInput('cellsPerElectrolyzer', Number(e.target.value))}
          />
          <input
            type="number"
            className="control-input"
            min={50} max={500}
            value={inputs.cellsPerElectrolyzer}
            onChange={e => setInput('cellsPerElectrolyzer', Number(e.target.value))}
          />
        </div>
      </div>

      <Divider />

      {/* 운전 전류 */}
      <div className="control-group">
        <div className="control-label">
          운전 전류
          <span className="control-label-unit">kA</span>
        </div>
        <div className="control-input-row">
          <div className="control-value-display">{inputs.operatingCurrentKA.toFixed(1)}</div>
          <input
            type="range"
            className="control-slider"
            min={1} max={30} step={0.1}
            value={inputs.operatingCurrentKA}
            onChange={e => setInput('operatingCurrentKA', Number(e.target.value))}
          />
          <input
            type="number"
            className="control-input"
            min={1} max={30} step={0.1}
            value={inputs.operatingCurrentKA}
            onChange={e => setInput('operatingCurrentKA', Number(e.target.value))}
          />
        </div>
      </div>

      <Divider />

      {/* 전류 효율 */}
      <div className="control-group">
        <div className="control-label">
          전류 효율
          <span className="control-label-unit">CE (%)</span>
        </div>
        <div className="control-input-row">
          <div className="control-value-display" style={{ fontSize: '18px' }}>
            {(inputs.currentEfficiency * 100).toFixed(1)}
          </div>
          <input
            type="range"
            className="control-slider"
            min={0.80} max={0.99} step={0.001}
            value={inputs.currentEfficiency}
            onChange={e => setInput('currentEfficiency', Number(e.target.value))}
          />
          <input
            type="number"
            className="control-input"
            min={80} max={99} step={0.1}
            value={(inputs.currentEfficiency * 100).toFixed(1)}
            onChange={e => setInput('currentEfficiency', Number(e.target.value) / 100)}
          />
        </div>
      </div>

      <Divider />

      {/* 총 셀수 표시 */}
      <div className="control-group" style={{ minWidth: 120 }}>
        <div className="control-label">총 셀수</div>
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-warn)' }}>
          {(inputs.numElectrolyzers * inputs.cellsPerElectrolyzer).toLocaleString()}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Inter,sans-serif', marginLeft: 4 }}>PCS</span>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div style={{
      width: 1,
      alignSelf: 'stretch',
      background: 'var(--border-subtle)',
      marginTop: 4,
      marginBottom: 4,
    }} />
  );
}

'use client';

import React, { useState, useMemo } from 'react';
import { type FlowNodeDef, type FlowUnitType } from '@/lib/calculations/flowsheetSolver';
import {
  getPlantTemplatesForUnitType,
  cloneUnitParams,
  type PlantUnitTemplate,
} from '@/lib/calculations/plantUnitTemplates';

interface PlantUnitCopyBoxProps {
  unitType: FlowUnitType;
  nodeKey: string;
  onCopyParams: (
    params: FlowNodeDef['params'],
    template: PlantUnitTemplate,
    includeInlet: boolean
  ) => void;
}

export default function PlantUnitCopyBox({
  unitType,
  nodeKey,
  onCopyParams,
}: PlantUnitCopyBoxProps) {
  const templates = useMemo(() => getPlantTemplatesForUnitType(unitType), [unitType]);
  const scopeKey = `${nodeKey}::${unitType}`;
  const [uiState, setUiState] = useState<{
    scope: string;
    selectedPlant: string;
    selectedId: string;
    copiedNotice: string;
  }>({
    scope: scopeKey,
    selectedPlant: 'ALL',
    selectedId: '',
    copiedNotice: '',
  });
  const [includeInlet, setIncludeInlet] = useState<boolean>(true);

  const selectedPlant = uiState.scope === scopeKey ? uiState.selectedPlant : 'ALL';
  const selectedId = uiState.scope === scopeKey ? uiState.selectedId : '';
  const copiedNotice = uiState.scope === scopeKey ? uiState.copiedNotice : '';

  const grouped = useMemo(() => {
    const map = new Map<string, PlantUnitTemplate[]>();
    templates.forEach((tpl) => {
      const arr = map.get(tpl.plantLabel) ?? [];
      arr.push(tpl);
      map.set(tpl.plantLabel, arr);
    });
    return map;
  }, [templates]);

  if (templates.length === 0) return null;

  const plantLabels = Array.from(grouped.keys());
  const visibleEntries =
    selectedPlant === 'ALL'
      ? Array.from(grouped.entries())
      : Array.from(grouped.entries()).filter(([label]) => label === selectedPlant);
  const visibleCount = visibleEntries.reduce((acc, [, items]) => acc + items.length, 0);

  const handleApply = (tplId: string) => {
    const found = templates.find((t) => t.id === tplId);
    if (!found) {
      setUiState({ scope: scopeKey, selectedPlant, selectedId: tplId, copiedNotice: '' });
      return;
    }
    onCopyParams(cloneUnitParams(found.params), found, includeInlet);
    setUiState({
      scope: scopeKey,
      selectedPlant,
      selectedId: tplId,
      copiedNotice: `✓ [${found.tag}] 복사 완료 (${found.summary})`,
    });
  };

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: '#F8FAFC',
        border: '1px solid #CBD5E1',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1E293B' }}>
          📋 타 공정 장치 조건 복사
        </span>
        <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>
          {visibleCount}건
        </span>
      </div>

      {plantLabels.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(['ALL', ...plantLabels] as const).map((pl) => {
            const active = selectedPlant === pl;
            return (
              <button
                key={pl}
                type="button"
                onClick={() =>
                  setUiState({
                    scope: scopeKey,
                    selectedPlant: pl,
                    selectedId: '',
                    copiedNotice: '',
                  })
                }
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: active ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: active ? '#1E3A8A' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#475569',
                  fontSize: 9.5,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                {pl === 'ALL' ? '전체' : pl}
              </button>
            );
          })}
        </div>
      )}

      <select
        value={selectedId}
        onChange={(e) => handleApply(e.target.value)}
        style={{
          width: '100%',
          height: 28,
          padding: '0 7px',
          borderRadius: 5,
          border: '1px solid #94A3B8',
          background: '#FFFFFF',
          color: '#0F172A',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <option value="">— 참조 장치 선택 —</option>
        {visibleEntries.map(([plantLabel, items]) => (
          <optgroup key={plantLabel} label={plantLabel}>
            {items.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                [{tpl.tag}] {tpl.name} · {tpl.summary}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          color: '#334155',
          fontWeight: 700,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={includeInlet}
          onChange={(e) => setIncludeInlet(e.target.checked)}
          style={{ margin: 0, cursor: 'pointer' }}
        />
        <span>유입(Inlet) 조건 함께 복사</span>
      </label>

      <div style={{ fontSize: 9.5, color: copiedNotice ? '#059669' : '#64748B', fontWeight: copiedNotice ? 700 : 500, lineHeight: 1.35 }}>
        {copiedNotice ||
          (includeInlet ? '운전조건 + 유입 조건 동시 반영' : '장치 운전조건만 반영')}
      </div>
    </div>
  );
}

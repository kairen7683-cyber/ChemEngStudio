'use client';

import React, { useState, useMemo } from 'react';
import { type FlowNodeDef, type FlowUnitType } from '@/lib/calculations/flowsheetSolver';
import {
  getPlantTemplatesForUnitType,
  cloneUnitParams,
  type PlantUnitTemplate,
} from '@/lib/calculations/plantUnitTemplates';
import { useAuth } from '@/components/auth/AuthContext';
import {
  PLANT_REGISTRY,
  isPlantAllowed,
  formatPlantLabelForUser,
  formatPlantCodeAndName,
} from '@/lib/plantRegistry';
import type { PlantId } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import { formatEquipmentTag } from '@/lib/units/tagNaming';

const UNIT_TYPE_KO: Partial<Record<FlowUnitType, string>> = {
  distillation: '증류탑',
  absorber: '흡수·건조탑',
  hex: '열교환기',
  cooler: '냉각기',
  liquefier: '액화기',
  pump: '펌프',
  compressor: '압축기',
  reactor: '반응기',
  electrolyzer: '전해조',
  evaporator: '증발기',
  separator: '기액분리기',
  extractor: '추출탑',
  valve: '감압밸브',
  feed: '원료 유입',
};

interface PlantUnitCopyBoxProps {
  unitType: FlowUnitType;
  nodeKey: string;
  activePlantId?: PlantId | null;
  onCopyParams: (
    params: FlowNodeDef['params'],
    template: PlantUnitTemplate,
    includeInlet: boolean
  ) => void;
}

export default function PlantUnitCopyBox({
  unitType,
  nodeKey,
  activePlantId,
  onCopyParams,
}: PlantUnitCopyBoxProps) {
  const { user } = useAuth();
  const tagStandard = useUnitStore((s) => s.tagStandard);
  const unitTypeLabel = UNIT_TYPE_KO[unitType] ?? unitType;

  const templates = useMemo(
    () =>
      getPlantTemplatesForUnitType(unitType).filter(
        (tpl) => tpl.plantId !== 'green_h2' && isPlantAllowed(tpl.plantId, user)
      ),
    [unitType, user]
  );

  // Group by plantId (preserving display label formatted for current user role)
  // and place currently opened PFD plant first if present.
  const groupedList = useMemo(() => {
    const map = new Map<PlantId, { plantId: PlantId; displayLabel: string; items: PlantUnitTemplate[] }>();
    templates.forEach((tpl) => {
      const existing = map.get(tpl.plantId);
      if (existing) {
        existing.items.push(tpl);
      } else {
        map.set(tpl.plantId, {
          plantId: tpl.plantId,
          displayLabel: formatPlantLabelForUser(tpl.plantLabel, user),
          items: [tpl],
        });
      }
    });
    const list = Array.from(map.values());
    if (activePlantId) {
      list.sort((a, b) => {
        if (a.plantId === activePlantId) return -1;
        if (b.plantId === activePlantId) return 1;
        return 0;
      });
    }
    return list;
  }, [templates, user, activePlantId]);

  const hasActivePlantTemplates = Boolean(
    activePlantId && groupedList.some((g) => g.plantId === activePlantId)
  );
  const defaultFilter: string = hasActivePlantTemplates && activePlantId ? activePlantId : 'ALL';

  const scopeKey = `${nodeKey}::${unitType}::${activePlantId ?? 'sim'}`;
  const [uiState, setUiState] = useState<{
    scope: string;
    selectedPlant: string;
    selectedId: string;
    copiedNotice: string;
  }>({
    scope: scopeKey,
    selectedPlant: defaultFilter,
    selectedId: '',
    copiedNotice: '',
  });
  const [includeInlet, setIncludeInlet] = useState<boolean>(true);

  const selectedPlant = uiState.scope === scopeKey ? uiState.selectedPlant : defaultFilter;
  const selectedId = uiState.scope === scopeKey ? uiState.selectedId : '';
  const copiedNotice = uiState.scope === scopeKey ? uiState.copiedNotice : '';

  // Allowed plants that do not have any templates of this unitType (only shown when user has >1 allowed plant)
  const missingAllowedPlants = useMemo(() => {
    const allowedPlants = PLANT_REGISTRY.filter(
      (p) => !p.hiddenFromSelector && !p.isSandbox && isPlantAllowed(p.id, user)
    );
    if (allowedPlants.length <= 1) return [];
    const presentIds = new Set(groupedList.map((g) => g.plantId));
    return allowedPlants
      .filter((p) => !presentIds.has(p.id))
      .map((p) => formatPlantCodeAndName(p, user, ' '));
  }, [groupedList, user]);

  if (templates.length === 0) return null;

  const visibleEntries =
    selectedPlant === 'ALL'
      ? groupedList
      : groupedList.filter((g) => g.plantId === selectedPlant);
  const visibleCount = visibleEntries.reduce((acc, g) => acc + g.items.length, 0);

  const handleApply = (tplId: string) => {
    const found = templates.find((t) => t.id === tplId);
    if (!found) {
      setUiState({ scope: scopeKey, selectedPlant, selectedId: tplId, copiedNotice: '' });
      return;
    }
    onCopyParams(cloneUnitParams(found.params), found, includeInlet);
    const displayTag = formatEquipmentTag(found.tag, found.unitType, tagStandard);
    setUiState({
      scope: scopeKey,
      selectedPlant,
      selectedId: tplId,
      copiedNotice: `✓ [${displayTag}] 복사 완료 (${found.summary})`,
    });
  };

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1E293B' }}>
          동종 장치({unitTypeLabel}) 조건 불러오기
        </span>
        <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>
          {visibleCount}건
        </span>
      </div>

      {groupedList.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(['ALL', ...groupedList.map((g) => g.plantId)] as const).map((pid) => {
            const active = selectedPlant === pid;
            const grp = groupedList.find((g) => g.plantId === pid);
            const isCurrent = Boolean(activePlantId && pid === activePlantId);
            const btnText =
              pid === 'ALL'
                ? '전체'
                : `${grp?.displayLabel ?? pid}${isCurrent ? ' (현재)' : ''}`;
            return (
              <button
                key={pid}
                type="button"
                onClick={() =>
                  setUiState({
                    scope: scopeKey,
                    selectedPlant: pid,
                    selectedId: '',
                    copiedNotice: '',
                  })
                }
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: active ? '1px solid #1E293B' : '1px solid #E2E8F0',
                  background: active ? '#1E293B' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#475569',
                  fontSize: 9.5,
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                {btnText}
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
          border: '1px solid #CBD5E1',
          background: '#FFFFFF',
          color: '#1E293B',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <option value="">— 참조 {unitTypeLabel} 선택 —</option>
        {visibleEntries.map((grp) => (
          <optgroup key={grp.plantId} label={grp.displayLabel}>
            {grp.items.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                [{formatEquipmentTag(tpl.tag, tpl.unitType, tagStandard)}] {tpl.name} · {tpl.summary}
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
          style={{ margin: 0, cursor: 'pointer', accentColor: '#1E3A8A' }}
        />
        <span>유입(Inlet) 조건 함께 복사</span>
      </label>

      <div style={{ fontSize: 9.5, color: copiedNotice ? '#1E3A8A' : '#64748B', fontWeight: copiedNotice ? 700 : 500, lineHeight: 1.35 }}>
        {copiedNotice ||
          (includeInlet ? '운전조건 + 유입 조건 동시 반영' : '장치 운전조건만 반영')}
      </div>

      {missingAllowedPlants.length > 0 && (
        <div style={{ fontSize: 9, color: '#94A3B8', lineHeight: 1.35 }}>
          ※ {missingAllowedPlants.join(', ')}에는 등록된 {unitTypeLabel} 예제가 없습니다.
        </div>
      )}
    </div>
  );
}

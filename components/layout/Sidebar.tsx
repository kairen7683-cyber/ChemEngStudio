'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  useBalanceStore,
  type Plant03OperatingInputs,
  type CmsPlantOperatingInputs,
  type MdiPlantOperatingInputs,
} from '@/lib/stores/balanceStore';
import type { ElectrolyzerInputs } from '@/lib/calculations/electrolyzer';
import { useAuth } from '@/components/auth/AuthContext';
import { getPlantRegistryItem, isPlantAllowed } from '@/lib/plantRegistry';

export default function Sidebar() {
  const pathname = usePathname() || '/';
  const { user } = useAuth();
  const {
    activePlantId,
    balance,
    plant02Inputs,
    plant02Balance,
    setPlant02Input,
    resetPlant02Inputs,
    plant03Inputs,
    plant03Summary,
    setPlant03Input,
    resetPlant03Inputs,
    cmsPlantInputs,
    cmsPlantSummary,
    setCmsPlantInput,
    resetCmsPlantInputs,
    mdiPlantInputs,
    mdiPlantSummary,
    setMdiPlantInput,
    resetMdiPlantInputs,
  } = useBalanceStore();

  const [collapsed, setCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const checkViewport = () => {
      if (typeof window !== 'undefined') {
        const mob = window.innerWidth <= 768;
        setIsMobile(mob);
        if (window.innerWidth < 960 && !mob) {
          setCollapsed(true);
        }
      }
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenPlantBasis = () => {
      if (window.innerWidth <= 768) {
        setMobileDrawerOpen(true);
      } else {
        setCollapsed(false);
      }
    };
    window.addEventListener('chemeng:open-plant-basis', onOpenPlantBasis);
    return () => window.removeEventListener('chemeng:open-plant-basis', onOpenPlantBasis);
  }, []);

  const isPfdLikeRoute = pathname === '/' || pathname.startsWith('/material-balance');
  const hasMacroControls =
    activePlantId === 'clorsim_sim' ||
    activePlantId === 'hcl_synth' ||
    activePlantId === 'cms_plant' ||
    activePlantId === 'mdi_plant';

  if (!isPfdLikeRoute || !hasMacroControls || !isPlantAllowed(activePlantId, user)) {
    return null;
  }

  const plantMeta = getPlantRegistryItem(activePlantId);

  const handleP02Change = (key: keyof ElectrolyzerInputs, val: number) => {
    setPlant02Input(key, val);
  };

  const handleP03Change = (key: keyof Plant03OperatingInputs, val: number) => {
    setPlant03Input(key, val);
  };

  const handleCmsChange = (key: keyof CmsPlantOperatingInputs, val: number) => {
    setCmsPlantInput(key, val);
  };

  const handleMdiChange = (key: keyof MdiPlantOperatingInputs, val: number) => {
    setMdiPlantInput(key, val);
  };

  const renderChlorAlkaliOperatingAndKpi = (
    curInputs: ElectrolyzerInputs,
    curBalance: typeof balance,
    onChangeParam: (key: keyof ElectrolyzerInputs, val: number) => void,
    onReset: () => void
  ) => {
    const { summary: curSum, electrolyzerResult: curElec } = curBalance;
    return (
      <>
        <div style={{ padding: '6px 14px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span
              style={{
                fontSize: 9.8,
                fontWeight: 800,
                color: '#1E293B',
                letterSpacing: '0.3px',
              }}
            >
              전해조 운전 파라미터
            </span>
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid #CBD5E1',
                background: '#F8FAFC',
                color: '#475569',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              초기화
            </button>
          </div>

          <ControlRow
            label="전해조 수량" unit="기"
            value={curInputs.numElectrolyzers}
            min={1} max={20} step={1}
            onChange={v => onChangeParam('numElectrolyzers', v)}
          />
          <ControlRow
            label="셀 수량" unit="셀/전해조"
            value={curInputs.cellsPerElectrolyzer}
            min={50} max={500} step={1}
            onChange={v => onChangeParam('cellsPerElectrolyzer', v)}
          />
          <ControlRow
            label="운전 전류" unit="kA"
            value={curInputs.operatingCurrentKA}
            min={1} max={30} step={0.1}
            onChange={v => onChangeParam('operatingCurrentKA', v)}
          />
          <ControlRow
            label="전류 효율 (CE)" unit="%"
            value={curInputs.currentEfficiency * 100}
            min={80} max={99} step={0.1}
            onChange={v => onChangeParam('currentEfficiency', v / 100)}
          />
          <ControlRow
            label="출구 브라인 농도" unit="wt%"
            value={curInputs.anolyteExitConcWt ?? 17.45}
            min={15.5} max={20.5} step={0.05}
            onChange={v => onChangeParam('anolyteExitConcWt', v)}
          />
          <ControlRow
            label="출구 가성소다 농도" unit="wt%"
            value={curInputs.catholyteConcWt ?? 32.34}
            min={30.0} max={34.5} step={0.05}
            onChange={v => onChangeParam('catholyteConcWt', v)}
          />
          <ControlRow
            label="전해조 운전온도" unit="°C"
            value={curInputs.electrolyzerTempC ?? 89.0}
            min={75.0} max={95.0} step={0.5}
            onChange={v => onChangeParam('electrolyzerTempC', v)}
          />

          <div
            style={{
              marginTop: 6,
              padding: '8px 10px',
              borderRadius: 7,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginBottom: 2 }}>
                총 셀수 ({curInputs.numElectrolyzers}기 합산)
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: '#0F172A',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: 1,
                }}
              >
                {(curInputs.numElectrolyzers * curInputs.cellsPerElectrolyzer).toLocaleString()}
                <span style={{ fontSize: 9, color: '#64748B', marginLeft: 3 }}>PCS</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginBottom: 2 }}>
                DC 소비전력 ({curElec.cellVoltageV?.toFixed(2) ?? '3.05'}V)
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: '#1E293B',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: 1,
                }}
              >
                {(curElec.totalDcPowerMW ?? 0).toFixed(2)}
                <span style={{ fontSize: 9, color: '#64748B', marginLeft: 3 }}>MW</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: '#E2E8F0', margin: '10px 0' }} />

        <div style={{ padding: '0 14px 12px' }}>
          <div
            style={{
              fontSize: 9.8,
              fontWeight: 800,
              color: '#1E293B',
              letterSpacing: '0.3px',
              marginBottom: 8,
            }}
          >
            실시간 물질수지 생산량
          </div>

          <SummaryCard
            label="Cl₂ 생산량"
            main={`${curSum.cl2_tonDay.toFixed(1)} ton/일`}
            sub={`${curElec.cl2ProductionKgH.toFixed(0)} kg/h`}
            highlight
          />
          <SummaryCard
            label="NaOH 32% (용액)"
            main={`${curSum.naoh32_tonDay.toFixed(1)} ton/일`}
            sub={`${((curSum.naoh32_tonDay / 24) * 1000).toFixed(0)} kg/h`}
          />
          <SummaryCard
            label="NaOH 50% (농축제품)"
            main={`${curSum.naoh50_tonDay.toFixed(1)} ton/일`}
            sub={`드라이 ${curElec.naohProductionKgH.toFixed(0)} kg/h`}
            highlight
          />
          <SummaryCard
            label="H₂ 생산량"
            main={`${curSum.h2_tonDay.toFixed(2)} ton/일`}
            sub={`${curElec.h2ProductionKgH.toFixed(1)} kg/h`}
          />
          <SummaryCard
            label="NaCl 소모"
            main={`${curSum.naclUsage_tonDay.toFixed(1)} ton/일`}
            sub={`소금 ${curSum.saltUsage_tonDay.toFixed(1)} ton/일`}
          />
        </div>
      </>
    );
  };

  const renderPlant03OperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.8,
              fontWeight: 800,
              color: '#1E293B',
              letterSpacing: '0.3px',
            }}
          >
            1A 공정 운전 · CAPA 변수
          </span>
          <button
            type="button"
            onClick={() => resetPlant03Inputs()}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#475569',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="원료 Cl₂ 공급량" unit="kg/h"
          value={plant03Inputs.cl2FeedKgH}
          min={500} max={10000} step={50}
          onChange={v => handleP03Change('cl2FeedKgH', v)}
        />
        <ControlRow
          label="합성 H₂ 과잉률" unit="%"
          value={plant03Inputs.h2ExcessPct}
          min={1.0} max={12.0} step={0.2}
          onChange={v => handleP03Change('h2ExcessPct', v)}
        />
        <ControlRow
          label="5N 무수 분배율" unit="%"
          value={plant03Inputs.ahclSplitPct}
          min={10} max={85} step={1}
          onChange={v => handleP03Change('ahclSplitPct', v)}
        />
        <ControlRow
          label="심냉액화 온도" unit="°C"
          value={plant03Inputs.liquefierTempC}
          min={-38} max={-10} step={1}
          onChange={v => handleP03Change('liquefierTempC', v)}
        />
        <ControlRow
          label="폐염산 유입량" unit="kg/h"
          value={plant03Inputs.spentHclFeedKgH}
          min={0} max={12000} step={100}
          onChange={v => handleP03Change('spentHclFeedKgH', v)}
        />
        <ControlRow
          label="폐염산 유입농도" unit="wt%"
          value={plant03Inputs.spentHclConcWt}
          min={8.0} max={20.0} step={0.5}
          onChange={v => handleP03Change('spentHclConcWt', v)}
        />
        <ControlRow
          label="진공탑(C-310) 압력" unit="kG"
          value={plant03Inputs.vacColPressKg}
          min={-0.93} max={-0.70} step={0.01}
          onChange={v => handleP03Change('vacColPressKg', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 7,
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginBottom: 2 }}>
              합성 HCl 총량
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: '#0F172A',
                fontFamily: 'JetBrains Mono, monospace',
                lineHeight: 1,
              }}
            >
              {plant03Summary.synthHclTonDay.toFixed(1)}
              <span style={{ fontSize: 9, color: '#64748B', marginLeft: 3 }}>T/D</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, marginBottom: 2 }}>
              동력 / 총 열부하
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: '#1E293B',
                fontFamily: 'JetBrains Mono, monospace',
                lineHeight: 1,
              }}
            >
              {plant03Summary.elecPowerKW.toFixed(0)}
              <span style={{ fontSize: 8.5, color: '#64748B', marginLeft: 2 }}>kW</span>
              <span style={{ fontSize: 9, color: '#64748B' }}> · {plant03Summary.thermalDutyMW.toFixed(2)}MW</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E2E8F0', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.8,
            fontWeight: 800,
            color: '#1E293B',
            letterSpacing: '0.3px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (1A CAPA)
        </div>

        <SummaryCard
          label="5N 무수염산 (AHCl)"
          main={`${plant03Summary.ahcl5nTonDay.toFixed(1)} ton/일`}
          sub={`${plant03Summary.ahcl5nKgH.toFixed(0)} kg/h · 순도 99.999%`}
          highlight
        />
        <SummaryCard
          label="전자급 35% 고순도 염산"
          main={`${plant03Summary.hcl35SolTonDay.toFixed(1)} ton/일`}
          sub={`100% HCl 환산 ${plant03Summary.hcl35PureTonDay.toFixed(1)} T/D`}
          highlight
        />
        <SummaryCard
          label="PSD 청정 회수수 (C-310)"
          main={`${plant03Summary.psdCleanWaterTonDay.toFixed(1)} ton/일`}
          sub={`순환 HCl ${plant03Summary.psdRecycledHclKgH.toFixed(0)} kg/h 회수`}
        />
        <SummaryCard
          label="원료 Cl₂ / H₂ 소비"
          main={`${plant03Summary.cl2UsageTonDay.toFixed(1)} ton/일`}
          sub={`수소 ${plant03Summary.h2UsageTonDay.toFixed(2)} ton/일 (${plant03Summary.h2FeedKgH.toFixed(1)} kg/h)`}
        />
        <SummaryCard
          label="부생 폐염산 처리량"
          main={`${plant03Summary.spentFeedTonDay.toFixed(1)} ton/일`}
          sub={`${plant03Inputs.spentHclConcWt.toFixed(1)} wt% 폐산 공비회수`}
        />
      </div>
    </>
  );

  const renderCmsOperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.8,
              fontWeight: 800,
              color: '#1E293B',
              letterSpacing: '0.3px',
            }}
          >
            CMS 공정 운전 · 반응 변수
          </span>
          <button
            type="button"
            onClick={() => resetCmsPlantInputs()}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#475569',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="액체 Cl₂ 투입량" unit="T/D"
          value={cmsPlantInputs.cl2FeedTonDay}
          min={50} max={500} step={5}
          onChange={v => handleCmsChange('cl2FeedTonDay', v)}
        />
        <ControlRow
          label="MC/Cl₂ 몰비" unit="mol"
          value={cmsPlantInputs.mcCl2MolarRatio}
          min={1.2} max={4.0} step={0.02}
          onChange={v => handleCmsChange('mcCl2MolarRatio', v)}
        />
        <ControlRow
          label="R-101 반응온도" unit="°C"
          value={cmsPlantInputs.reactorTempC}
          min={90} max={150} step={1}
          onChange={v => handleCmsChange('reactorTempC', v)}
        />
        <ControlRow
          label="R-101 압력" unit="kG"
          value={cmsPlantInputs.reactorPressKgcm2g}
          min={12} max={35} step={0.5}
          onChange={v => handleCmsChange('reactorPressKgcm2g', v)}
        />
        <ControlRow
          label="AIBN 농도" unit="wt ppm"
          value={cmsPlantInputs.aibnDosagePpm}
          min={100} max={1000} step={25}
          onChange={v => handleCmsChange('aibnDosagePpm', v)}
        />
        <ControlRow
          label="C-201 탈거압력" unit="kG"
          value={cmsPlantInputs.hclStripperPressKg}
          min={10} max={24} step={0.5}
          onChange={v => handleCmsChange('hclStripperPressKg', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 7,
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#64748B', fontWeight: 700 }}>
              Cl₂ 전환율 / 동력
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
              {cmsPlantSummary.cl2ConversionPct.toFixed(2)}% · {cmsPlantSummary.elecPowerKW.toFixed(0)} kW
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #CBD5E1', paddingTop: 4 }}>
            <span style={{ fontSize: 9, color: '#64748B', fontWeight: 700 }}>
              기화 / 제열 / 리보일러
            </span>
            <span style={{ fontSize: 10.2, fontWeight: 800, color: '#1E293B', fontFamily: 'JetBrains Mono, monospace' }}>
              {cmsPlantSummary.vaporizerDutyMW.toFixed(2)} / {cmsPlantSummary.reactorCoolingMW.toFixed(2)} / {cmsPlantSummary.reboilerDutyMW.toFixed(2)} MW
            </span>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E2E8F0', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.8,
            fontWeight: 800,
            color: '#1E293B',
            letterSpacing: '0.3px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (CMS CAPA)
        </div>

        <SummaryCard
          label="MCL (메틸렌클로라이드)"
          main={`${cmsPlantSummary.mclProdTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.mclProdKgH.toFixed(0)} kg/h · C-301 80단 정제 (99.99%)`}
          highlight
        />
        <SummaryCard
          label="CFM (클로로포름)"
          main={`${cmsPlantSummary.cfmProdTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.cfmProdKgH.toFixed(0)} kg/h · C-302 120단 정제 (99.99%)`}
          highlight
        />
        <SummaryCard
          label="무수 HCl (부생 가스)"
          main={`${cmsPlantSummary.ahclByprodTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.ahclByprodKgH.toFixed(0)} kg/h · C-201 (${cmsPlantInputs.hclStripperPressKg.toFixed(1)} kG)`}
        />
        <SummaryCard
          label="CTC·헤비 폐기 (C-302)"
          main={`${cmsPlantSummary.ctcHeavyWasteTonDay.toFixed(1)} ton/일`}
          sub={`${cmsPlantSummary.ctcHeavyWasteKgH.toFixed(0)} kg/h · 잔류 CCl₄·헤비`}
        />
        <SummaryCard
          label="Fresh MC / 순환 MC"
          main={`${cmsPlantSummary.freshMcTonDay.toFixed(1)} ton/일`}
          sub={`순환 MC ${cmsPlantSummary.recycleMcTonDay.toFixed(1)} T/D (MCL 무순환)`}
        />
      </div>
    </>
  );

  const renderMdiOperatingAndKpi = () => (
    <>
      <div style={{ padding: '6px 14px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 9.8,
              fontWeight: 800,
              color: '#1E293B',
              letterSpacing: '0.3px',
            }}
          >
            MDI 공정 운전 · 반응 변수
          </span>
          <button
            type="button"
            onClick={() => resetMdiPlantInputs()}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#475569',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

        <ControlRow
          label="연간 생산규모" unit="kTA"
          value={mdiPlantInputs.annualCapacityKta}
          min={20} max={300} step={5}
          showSlider
          onChange={v => handleMdiChange('annualCapacityKta', v)}
        />
        <ControlRow
          label="Pure 4,4'-MDI 비율" unit="wt%"
          value={mdiPlantInputs.pureMdiSharePct}
          min={15} max={65} step={1}
          showSlider
          onChange={v => handleMdiChange('pureMdiSharePct', v)}
        />
        <ControlRow
          label="Aniline/HCHO 몰비" unit="mol"
          value={mdiPlantInputs.anilineToHchoRatio}
          min={2.2} max={5.0} step={0.1}
          showSlider
          onChange={v => handleMdiChange('anilineToHchoRatio', v)}
        />
        <ControlRow
          label="포스겐 과잉률" unit="%"
          value={mdiPlantInputs.phosgeneExcessPct}
          min={30} max={200} step={5}
          showSlider
          onChange={v => handleMdiChange('phosgeneExcessPct', v)}
        />
        <ControlRow
          label="MCB 용매/MDA 비" unit="wt/wt"
          value={mdiPlantInputs.mcbSolventRatio}
          min={1.5} max={4.0} step={0.1}
          showSlider
          onChange={v => handleMdiChange('mcbSolventRatio', v)}
        />
        <ControlRow
          label="C-401 고진공 압력" unit="mbar"
          value={mdiPlantInputs.vacColTopMbar}
          min={5} max={50} step={1}
          showSlider
          onChange={v => handleMdiChange('vacColTopMbar', v)}
        />

        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 7,
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#64748B', fontWeight: 700 }}>
              소요 전력 / 총 열부하
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
              {mdiPlantSummary.elecPowerKW.toFixed(0)} kW · {mdiPlantSummary.thermalDutyMW.toFixed(1)} MW
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #CBD5E1', paddingTop: 4 }}>
            <span style={{ fontSize: 9, color: '#64748B', fontWeight: 700 }}>
              Aniline / Cl₂ / CO
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1E293B', fontFamily: 'JetBrains Mono, monospace' }}>
              {mdiPlantSummary.anilineFreshKgH.toFixed(0)} / {mdiPlantSummary.cl2FreshKgH.toFixed(0)} / {mdiPlantSummary.coFreshKgH.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#E2E8F0', margin: '10px 0' }} />

      <div style={{ padding: '0 14px 14px' }}>
        <div
          style={{
            fontSize: 9.8,
            fontWeight: 800,
            color: '#1E293B',
            letterSpacing: '0.3px',
            marginBottom: 8,
          }}
        >
          실시간 물질수지 생산량 (MDI CAPA)
        </div>

        <SummaryCard
          label="Pure 4,4'-MDI (고진공 탑정)"
          main={`${(mdiPlantSummary.pureMdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.pureMdiTonDay.toFixed(1)} T/D`}
          sub={`${mdiPlantSummary.pureMdiKgH.toFixed(0)} kg/h · C-401 (${mdiPlantInputs.pureMdiSharePct.toFixed(0)} wt%)`}
          highlight
        />
        <SummaryCard
          label="Polymeric MDI (PMDI 탑저)"
          main={`${(mdiPlantSummary.pmdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.pmdiTonDay.toFixed(1)} T/D`}
          sub={`${mdiPlantSummary.pmdiKgH.toFixed(0)} kg/h · C-401 (20 mbar 고진공)`}
          highlight
        />
        <SummaryCard
          label="총 MDI 생산규모"
          main={`${(mdiPlantSummary.annualCapacityKta * 1000).toLocaleString()} TPA`}
          sub={`${(mdiPlantSummary.totalMdiKgH / 1000).toFixed(2)} t/h · ${mdiPlantSummary.totalMdiTonDay.toFixed(1)} T/D (8,000 hr/yr)`}
        />
        <SummaryCard
          label="부생 무수 HCl 회수"
          main={`${mdiPlantSummary.byproductHclTonDay.toFixed(1)} ton/일`}
          sub={`${mdiPlantSummary.byproductHclKgH.toFixed(0)} kg/h · S-201 탈거`}
        />
        <SummaryCard
          label="MCB 용매 순환량 (C-302)"
          main={`${(mdiPlantSummary.mcbRecycleKgH / 1000).toFixed(2)} t/h`}
          sub={`${mdiPlantSummary.mcbRecycleKgH.toFixed(0)} kg/h · 용매/MDA 비 ${mdiPlantInputs.mcbSolventRatio.toFixed(1)}×`}
        />
      </div>
    </>
  );

  const renderPlantBody = () => (
    <>
      {activePlantId === 'clorsim_sim' && (
        <>
          {renderChlorAlkaliOperatingAndKpi(
            plant02Inputs,
            plant02Balance,
            handleP02Change,
            resetPlant02Inputs
          )}
          <div
            style={{
              margin: '0 14px 12px',
              padding: '7px 9px',
              borderRadius: 7,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              fontSize: 9.5,
              color: '#475569',
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontWeight: 800, color: '#1E293B', marginBottom: 2 }}>
              기준공장(468 T/D) 참고 비교
            </div>
            <div>
              Cl₂: {plant02Balance.summary.cl2_tonDay.toFixed(1)} vs {balance.summary.cl2_tonDay.toFixed(1)} T/D (
              {plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay >= 0 ? '+' : ''}
              {(plant02Balance.summary.cl2_tonDay - balance.summary.cl2_tonDay).toFixed(1)})
            </div>
            <div>
              NaOH 50%: {plant02Balance.summary.naoh50_tonDay.toFixed(1)} vs {balance.summary.naoh50_tonDay.toFixed(1)} T/D
            </div>
          </div>
        </>
      )}
      {activePlantId === 'hcl_synth' && renderPlant03OperatingAndKpi()}
      {activePlantId === 'cms_plant' && renderCmsOperatingAndKpi()}
      {activePlantId === 'mdi_plant' && renderMdiOperatingAndKpi()}
    </>
  );

  if (isMobile) {
    return (
      <>
        <div
          style={{
            width: '100%',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            padding: '4px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexShrink: 0,
            zIndex: 40,
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#475569' }}>
            {plantMeta.code} · {plantMeta.shortLabel}
          </span>
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(v => !v)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              color: '#1E293B',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ⚙ 예제 기준 운전조건
          </button>
        </div>

        {mobileDrawerOpen && (
          <div
            onClick={() => setMobileDrawerOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.45)',
              zIndex: 300,
              display: 'flex',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '86%',
                maxWidth: 320,
                height: '100%',
                background: '#FFFFFF',
                borderRight: '1px solid #E2E8F0',
                overflowY: 'auto',
                padding: '12px 4px',
                boxShadow: '4px 0 20px rgba(15, 23, 42, 0.22)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px 8px', borderBottom: '1px solid #E2E8F0', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                  예제 기준 운전조건
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: '#1E293B',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  닫기 ✕
                </button>
              </div>
              {renderPlantBody()}
            </div>
          </div>
        )}
      </>
    );
  }

  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          flexShrink: 0,
          background: '#F8FAFC',
          borderRight: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="예제 기준 운전조건 펼치기"
          style={{
            width: 22,
            padding: '8px 0',
            borderRadius: 5,
            border: '1px solid #E2E8F0',
            background: '#FFFFFF',
            color: '#1E293B',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.15,
          }}
        >
          <span>▸</span>
          <span style={{ writingMode: 'vertical-rl', letterSpacing: '1px' }}>기준</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="sidebar"
      style={{
        width: 242,
        flexShrink: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#FFFFFF',
        borderRight: '1px solid #E2E8F0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px 8px 14px',
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#0F172A' }}>
            예제 기준 운전조건
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 600, color: '#64748B', marginTop: 1 }}>
            {plantMeta.code} · {plantMeta.shortLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="패널 접기"
          style={{
            width: 24,
            height: 24,
            borderRadius: 5,
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#1E293B',
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ◂
        </button>
      </div>

      <div style={{ paddingTop: 4 }}>{renderPlantBody()}</div>
    </aside>
  );
}

function ControlRow({
  label,
  unit,
  value,
  min,
  max,
  step,
  showSlider,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  showSlider?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: showSlider ? 3 : 0,
        padding: '3px 0',
        marginBottom: 3,
        borderBottom: '1px dashed #E2E8F0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 10.5, color: '#334155', fontWeight: 600 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0))}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(v);
            }}
            style={{
              width: 64,
              height: 22,
              padding: '0 5px',
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#0F172A',
              fontSize: 11.2,
              fontWeight: 800,
              textAlign: 'right',
              fontFamily: 'JetBrains Mono, monospace',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 9, color: '#64748B', minWidth: 28 }}>{unit}</span>
        </div>
      </div>
      {showSlider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.max(min, Math.min(max, value))}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          style={{
            width: '100%',
            height: 4,
            accentColor: '#1E3A8A',
            cursor: 'pointer',
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  main,
  sub,
  highlight,
}: {
  label: string;
  main: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 9px',
        borderRadius: 7,
        marginBottom: 4,
        background: highlight ? '#F8FAFC' : '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderLeft: `3px solid ${highlight ? '#1E3A8A' : '#CBD5E1'}`,
      }}
    >
      <div>
        <div style={{ fontSize: 9.5, color: '#1E293B', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 9, color: '#64748B', marginTop: 1 }}>{sub}</div>
      </div>
      <div
        style={{
          fontSize: 11.8,
          fontWeight: 800,
          color: '#0F172A',
          fontFamily: 'JetBrains Mono, monospace',
          textAlign: 'right',
        }}
      >
        {main}
      </div>
    </div>
  );
}

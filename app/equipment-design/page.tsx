'use client';
import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { saveChemProHandoffPayload } from '@/lib/calculations/unitDesignHandoff';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const VALID_TABS = ['evap', 'evap_studio', 'brine', 'packing', 'chempro', 'equip', 'standards', 'hcl_hub', 'distill', 'cms_hub', 'mdi_hub', 'compressor'];

const PackingTower             = dynamic(() => import('@/components/equipment-design/PackingTower'),             { ssr: false });
const BrinePurificationDesign  = dynamic(() => import('@/components/equipment-design/BrinePurificationDesign'),  { ssr: false });
const FallingFilmDesign        = dynamic(() => import('@/components/equipment-design/FallingFilmDesign'),        { ssr: false });
const MultiEffectEvapStudio    = dynamic(() => import('@/components/equipment-design/MultiEffectEvapStudio'),    { ssr: false });
const EquipmentList            = dynamic(() => import('@/components/EquipmentList'),                             { ssr: false });
const PlantScopedEquipmentList = dynamic(() => import('@/components/PlantScopedEquipmentList'),                  { ssr: false });
const DesignStandards          = dynamic(() => import('@/components/DesignStandards'),                           { ssr: false });
const CompressorDesignPanel    = dynamic(() => import('@/components/equipment/CompressorDesignPanel'),           { ssr: false });

const CA_DESIGN_TABS = [
  { key: 'evap',        label: '300 가성소다 3효 증발관' },
  { key: 'evap_studio', label: '1·2·3중 효용 증발농축 스튜디오' },
  { key: 'brine',       label: '100 브라인 정제 · 킬레이트탑' },
  { key: 'packing',     label: '400/700 건조·흡수·제해 패킹타워' },
  { key: 'chempro',     label: '펌프·열교환기·용기 상세설계' },
  { key: 'compressor',  label: '공정가스 압축기(Compressor) 상세설계' },
];

const HCL1A_DESIGN_TABS = [
  { key: 'hcl_hub', label: '1A 핵심 증류탑·액화기·열교환기 내장설계 연동' },
  { key: 'packing', label: '100/300 염산 흡수·제해 패킹타워 설계' },
  { key: 'chempro', label: '펌프·압력용기·안전밸브 상세설계' },
  { key: 'compressor', label: '공정가스 압축기(Compressor) 상세설계' },
];

const ECH_DESIGN_TABS = [
  { key: 'distill',    label: 'ECH 핵심 증류탑·반응기·열교환기 내장설계' },
  { key: 'packing',    label: 'C-101·C-102 진공 패킹타워 설계' },
  { key: 'chempro',    label: '열교환기(E-102/E-301)·펌프·용기 상세설계' },
  { key: 'compressor', label: '공정가스 압축기(Compressor) 상세설계' },
];

const CMS_DESIGN_TABS = [
  { key: 'cms_hub',    label: 'CMS 핵심장치 (E-101·R-101·C-201~203·C-301~302)' },
  { key: 'packing',    label: 'C-201~203 · C-301~302 5탑 패킹/트레이 설계' },
  { key: 'chempro',    label: '기화기(E-101)·냉각기(E-301)·펌프(P-202) 상세설계' },
  { key: 'compressor', label: '공정가스 압축기(Compressor) 상세설계' },
];

const MDI_DESIGN_TABS = [
  { key: 'mdi_hub',    label: 'MDI 핵심장치 (R-101·C-101·R-201/202·C-301/302·E-401·C-401)' },
  { key: 'packing',    label: 'C-101·C-301·C-302·C-401 증류·회수탑 패킹/트레이 설계' },
  { key: 'chempro',    label: '예열기(E-401)·펌프(P-101/P-302)·안전밸브(PSV-201)' },
  { key: 'compressor', label: '공정가스 압축기(Compressor) 상세설계' },
];

interface EchHxHandoffConfig {
  sourceLabel?: string;
  plantId?: string;
  tag: string;
  name: string;
  fluidSummary: string;
  hotFluidId: string;
  coldFluidId?: string;
  allocation?: 'hot_shell' | 'hot_tube';
  dofTarget?: 'mc_auto' | 'mh_auto';
  mh_kgh: number;
  Th_in: number;
  Th_out: number;
  mc_kgh: number;
  Tc_in: number;
  Tc_out: number;
  hot_mode?: 'sensible' | 'cond_full';
  cold_mode?: 'sensible' | 'boil_full';
  Th_sat?: number;
  Tc_sat?: number;
  hot_hv?: number;
  cold_hv?: number;
  U_assumed: number;
}

function saveEchChemProHXHandoff(cfg: EchHxHandoffConfig) {
  saveChemProHandoffPayload({
    version: 1,
    timestamp: Date.now(),
    sourceLabel: cfg.sourceLabel ?? 'PLANT 03 바이오 ECH',
    ...(cfg.plantId ? { plantId: cfg.plantId } : {}),
    tab: 'hx',
    equipTag: cfg.tag,
    equipName: cfg.name,
    detectedFluidSummary: cfg.fluidSummary,
    hx: {
      hx_type: 'shell_tube',
      hotFluidId: cfg.hotFluidId,
      coldFluidId: cfg.coldFluidId ?? 'water',
      allocation: cfg.allocation ?? 'hot_tube',
      dofTarget: cfg.dofTarget ?? 'mc_auto',
      mh_kgh: cfg.mh_kgh,
      Th_in: cfg.Th_in,
      Th_out: cfg.Th_out,
      mc_kgh: cfg.mc_kgh,
      Tc_in: cfg.Tc_in,
      Tc_out: cfg.Tc_out,
      hot_mode: cfg.hot_mode ?? 'sensible',
      cold_mode: cfg.cold_mode ?? 'sensible',
      ...(cfg.Th_sat !== undefined ? { Th_sat: cfg.Th_sat, hot_xfrac: 1.0 } : {}),
      ...(cfg.Tc_sat !== undefined ? { Tc_sat: cfg.Tc_sat, cold_xfrac: 1.0 } : {}),
      ...(cfg.hot_hv !== undefined ? { hot_hv: cfg.hot_hv } : {}),
      ...(cfg.cold_hv !== undefined ? { cold_hv: cfg.cold_hv } : {}),
      U_assumed: cfg.U_assumed,
    },
  });
}

function getDefaultChemProTag(plantId: string): string {
  if (plantId === 'hcl_synth') return 'E-102A';
  if (plantId === 'ech_gte') return 'E-102';
  if (plantId === 'cms_plant') return 'E-101';
  if (plantId === 'mdi_plant') return 'E-401';
  return 'E-332';
}

export default function EquipmentDesignPage() {
  const router = useRouter();
  const { activePlantId, setActivePlantId, requestSimSheet, requestSimNodeAction } = useBalanceStore();
  const activeTab = usePFDStore(s => s.equipSubTab || 'evap');
  const setActiveTab = usePFDStore(s => s.setEquipSubTab);
  const [chemproTag, setChemproTag] = useState<string>(() => getDefaultChemProTag(activePlantId));
  const [chemproSubTab, setChemproSubTab] = useState<string>('');
  const [chemproHandoff, setChemproHandoff] = useState<boolean>(false);
  const activeDesignRequest = usePFDStore(s => s.activeDesignRequest);
  const setActiveDesignRequest = usePFDStore(s => s.setActiveDesignRequest);
  const setEquipmentSpecOverride = usePFDStore(s => s.setEquipmentSpecOverride);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastSyncedPlantRef = useRef<string>(activePlantId);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const qTab = p.get('tab');
      const qSub = p.get('sub');
      const qTag = p.get('tag');
      const qHandoff = p.get('handoff') === '1';
      if (qTab && VALID_TABS.includes(qTab)) {
        setActiveTab(qTab);
      }
      if (qSub) setChemproSubTab(qSub);
      if (qTag) setChemproTag(qTag);
      if (qHandoff) setChemproHandoff(true);
    }
  }, [setActiveTab]);

  // 공장 전환 시 다른 공장의 전용 설계 탭(및 전해 전용 설계기준)이 남지 않도록 자동 정합성 보정
  useEffect(() => {
    if (activeTab === 'equip') return;
    const isElectrolysis = activePlantId === 'clorsim' || activePlantId === 'clorsim_sim';
    if (activeTab === 'standards' && !isElectrolysis) {
      if (activePlantId === 'hcl_synth') setActiveTab('hcl_hub');
      else if (activePlantId === 'ech_gte') setActiveTab('distill');
      else if (activePlantId === 'cms_plant') setActiveTab('cms_hub');
      else if (activePlantId === 'mdi_plant') setActiveTab('mdi_hub');
      else setActiveTab('chempro');
      return;
    }
    if (activeTab === 'standards') return;
    if (typeof window !== 'undefined') {
      const qTab = new URLSearchParams(window.location.search).get('tab');
      if (qTab && VALID_TABS.includes(qTab) && qTab !== activeTab) return;
      if (qTab === 'distill' && activeTab === 'distill') return;
    }
    if (activePlantId === 'hcl_synth') {
      if (activeTab === 'evap' || activeTab === 'evap_studio' || activeTab === 'brine' || activeTab === 'distill' || activeTab === 'cms_hub' || activeTab === 'mdi_hub') {
        setActiveTab('hcl_hub');
      }
    } else if (activePlantId === 'ech_gte') {
      if (activeTab === 'evap' || activeTab === 'evap_studio' || activeTab === 'brine' || activeTab === 'hcl_hub' || activeTab === 'cms_hub' || activeTab === 'mdi_hub') {
        setActiveTab('distill');
      }
    } else if (activePlantId === 'cms_plant') {
      if (activeTab === 'evap' || activeTab === 'evap_studio' || activeTab === 'brine' || activeTab === 'hcl_hub' || activeTab === 'distill' || activeTab === 'mdi_hub') {
        setActiveTab('cms_hub');
      }
    } else if (activePlantId === 'mdi_plant') {
      if (activeTab === 'evap' || activeTab === 'evap_studio' || activeTab === 'brine' || activeTab === 'hcl_hub' || activeTab === 'distill' || activeTab === 'cms_hub') {
        setActiveTab('mdi_hub');
      }
    } else if (activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') {
      if (activeTab === 'hcl_hub' || activeTab === 'distill' || activeTab === 'cms_hub' || activeTab === 'mdi_hub') {
        setActiveTab('evap');
      }
    }
  }, [activePlantId, activeTab, setActiveTab]);

  // 활성 공장 전환 시 ChemPro 상세설계 기본 장치 태그·유체·드롭다운 즉시 동기화
  useEffect(() => {
    if (lastSyncedPlantRef.current === activePlantId) return;
    lastSyncedPlantRef.current = activePlantId;
    const defaultTag = getDefaultChemProTag(activePlantId);
    setChemproTag(defaultTag);
    setChemproSubTab('');
    setChemproHandoff(false);
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'CHEMPRO_SET_PLANT', plantId: activePlantId, tag: defaultTag },
      '*'
    );
  }, [activePlantId]);

  useEffect(() => {
    if (activeDesignRequest?.tab) {
      const reqTab = activeDesignRequest.tab;
      const reqTag = activeDesignRequest.tag;
      const reqSub =
        activeDesignRequest.chemproSubTab ||
        (reqTab === 'pump' ? 'pump' : reqTab === 'hx' ? 'hx' : reqTab === 'pressure' ? 'vessel' : '');
      const reqHandoff = Boolean(activeDesignRequest.handoff);
      if (['chempro', 'hx', 'pump', 'pressure'].includes(reqTab)) {
        setActiveTab('chempro');
        setChemproSubTab(reqSub);
        setChemproHandoff(reqHandoff);
        if (reqTag) {
          setChemproTag(reqTag);
          setTimeout(() => {
            if (reqHandoff) {
              iframeRef.current?.contentWindow?.postMessage(
                { type: 'CHEMPRO_APPLY_SIM_HANDOFF' },
                '*'
              );
            } else {
              iframeRef.current?.contentWindow?.postMessage(
                { type: 'CHEMPRO_SELECT_EQUIP_TAG', tag: reqTag, subTab: reqSub },
                '*'
              );
            }
          }, 250);
        }
        setActiveDesignRequest(null);
      } else {
        setActiveTab(reqTab);
        setActiveDesignRequest(null);
      }
    }
  }, [activeDesignRequest, setActiveDesignRequest, setActiveTab]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e?.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'CHEMPRO_READY') {
        if (chemproHandoff) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'CHEMPRO_SET_PLANT', plantId: activePlantId, skipPresetLoad: true },
            '*'
          );
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'CHEMPRO_APPLY_SIM_HANDOFF' },
            '*'
          );
        } else {
          const targetTag = chemproTag || getDefaultChemProTag(activePlantId);
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'CHEMPRO_SET_PLANT', plantId: activePlantId, tag: targetTag, subTab: chemproSubTab },
            '*'
          );
        }
      }
      if (d.type === 'CHEMPRO_SAVE_TO_EQUIP_LIST' && d.payload?.tag) {
        const p = d.payload;
        const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        setEquipmentSpecOverride(p.tag, {
          name: p.name,
          fluid: p.fluid,
          operTemp: p.operTemp,
          operPress: p.operPress,
          designTemp: p.designTemp,
          designPress: p.designPress,
          material: p.material,
          capacity: p.capacity,
          motor: p.motor,
          remarks: p.remarks,
          designedAt: nowStr,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setEquipmentSpecOverride, activePlantId, chemproTag, chemproSubTab, chemproHandoff]);

  // 1) 장치목록 탭: 선택된 공장의 장치목록만 정확히 출력
  if (activeTab === 'equip') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F6F7F2' }}>
        {activePlantId === 'clorsim' ? <EquipmentList /> : <PlantScopedEquipmentList />}
      </div>
    );
  }

  // 2) 설계기준 탭 (전해공장 전용 — 타 공정에서는 자동 제외)
  if (activeTab === 'standards' && (activePlantId === 'clorsim' || activePlantId === 'clorsim_sim')) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F6F7F2' }}>
        <DesignStandards />
      </div>
    );
  }

  // 3) 단위·패키지 장치 상세설계 모드 (공장별 맞춤 서브바 제공)
  const isMdiMode = activePlantId === 'mdi_plant' || activeTab === 'mdi_hub';
  const isCmsMode = !isMdiMode && (activePlantId === 'cms_plant' || activeTab === 'cms_hub');
  const isEchMode = !isMdiMode && !isCmsMode && (activePlantId === 'ech_gte' || activeTab === 'distill');
  const subTabs = isMdiMode
    ? MDI_DESIGN_TABS
    : isCmsMode
      ? CMS_DESIGN_TABS
      : isEchMode
        ? ECH_DESIGN_TABS
        : activePlantId === 'hcl_synth'
          ? HCL1A_DESIGN_TABS
          : CA_DESIGN_TABS;
  const effectiveDesignTab =
    isMdiMode && !MDI_DESIGN_TABS.some(t => t.key === activeTab)
      ? 'mdi_hub'
      : isCmsMode && !CMS_DESIGN_TABS.some(t => t.key === activeTab)
        ? 'cms_hub'
        : isEchMode && !ECH_DESIGN_TABS.some(t => t.key === activeTab)
          ? 'distill'
          : !isMdiMode && !isCmsMode && !isEchMode && activePlantId === 'hcl_synth' && !HCL1A_DESIGN_TABS.some(t => t.key === activeTab)
            ? 'hcl_hub'
            : activeTab;

  const switchDesignSubTab = (key: string) => {
    setActiveTab(key);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const openSimNode = (
    sheetId: string,
    nodeIdOrTag: string,
    workbenchView?: 'mesh' | 'internals' | 'thermal' | 'mechanical',
    forcePlant?: boolean | 'ech_gte' | 'cms_plant' | 'mdi_plant'
  ) => {
    if (forcePlant === true) setActivePlantId('ech_gte');
    else if (forcePlant) setActivePlantId(forcePlant);
    requestSimNodeAction({
      sheetId,
      nodeIdOrTag,
      openWorkbench: true,
      ...(workbenchView ? { workbenchView } : {}),
    });
    router.push('/material-balance');
  };

  const openSimSheet = (sheetId: string, forcePlant?: boolean | 'ech_gte' | 'cms_plant' | 'mdi_plant') => {
    if (forcePlant === true) setActivePlantId('ech_gte');
    else if (forcePlant) setActivePlantId(forcePlant);
    requestSimSheet(sheetId);
    router.push('/material-balance');
  };

  const openEchChemProHX = (cfg: EchHxHandoffConfig) => {
    saveEchChemProHXHandoff(cfg);
    setActiveDesignRequest({
      tab: 'hx',
      tag: cfg.tag,
      chemproSubTab: 'hx',
      handoff: true,
    });
  };

  const openCmsChemProPump = () => {
    saveChemProHandoffPayload({
      version: 1,
      timestamp: Date.now(),
      sourceLabel: 'PLANT 04 클로로메탄(CMS)',
      plantId: 'cms_plant',
      tab: 'pump',
      equipTag: 'P-202',
      equipName: '고압 순환 메틸클로라이드 승압펌프 (MC Recycle Pump)',
      detectedFluidSummary: '순환 액상 메틸클로라이드 (CH₃Cl · 24 kG 승압)',
      pump: {
        fluidId: 'methyl_chloride',
        T_C: 40.0,
        Q_m3h: 12.6,
        rho_kgm3: 880,
        P1_barG: 9.2,
        P2_barG: 24.5,
        eff_pct: 72,
        dsuc_mm: '62.71',
        ddis_mm: '52.50',
      },
    });
    setActiveDesignRequest({
      tab: 'pump',
      tag: 'P-202',
      chemproSubTab: 'pump',
      handoff: true,
    });
  };

  const openMdiChemProPump = (cfg: {
    tag: string;
    name: string;
    fluidSummary: string;
    fluidId: string;
    T_C: number;
    Q_m3h: number;
    rho_kgm3: number;
    P1_barG: number;
    P2_barG: number;
    eff_pct: number;
    dsuc_mm: string;
    ddis_mm: string;
  }) => {
    saveChemProHandoffPayload({
      version: 1,
      timestamp: Date.now(),
      sourceLabel: 'PLANT 05 MDI',
      plantId: 'mdi_plant',
      tab: 'pump',
      equipTag: cfg.tag,
      equipName: cfg.name,
      detectedFluidSummary: cfg.fluidSummary,
      pump: {
        fluidId: cfg.fluidId,
        T_C: cfg.T_C,
        Q_m3h: cfg.Q_m3h,
        rho_kgm3: cfg.rho_kgm3,
        P1_barG: cfg.P1_barG,
        P2_barG: cfg.P2_barG,
        eff_pct: cfg.eff_pct,
        dsuc_mm: cfg.dsuc_mm,
        ddis_mm: cfg.ddis_mm,
      },
    });
    setActiveDesignRequest({
      tab: 'pump',
      tag: cfg.tag,
      chemproSubTab: 'pump',
      handoff: true,
    });
  };

  const openMdiChemProPSV = () => {
    saveChemProHandoffPayload({
      version: 1,
      timestamp: Date.now(),
      sourceLabel: 'PLANT 05 MDI',
      plantId: 'mdi_plant',
      tab: 'psv',
      equipTag: 'PSV-201',
      equipName: '포스겐(COCl₂) 반응계 긴급 압력방출 안전밸브',
      detectedFluidSummary: '포스겐(COCl₂) / 부생 HCl / MCB 고압 가스 (Set 4.5 barG · 145°C)',
      psv: {
        fluidId: 'phosgene',
        scenario: 'blocked_outlet',
        phase: 'vapor',
        W_kgh: 8500,
        Pset_barG: 4.5,
        Pback_barG: 0.3,
        T_C: 145,
        mw: 62.5,
        k: 1.28,
        Z: 0.96,
      },
    });
    setActiveDesignRequest({
      tab: 'chempro',
      tag: 'PSV-201',
      chemproSubTab: 'psv',
      handoff: true,
    });
  };

  const hubCards =
    effectiveDesignTab === 'mdi_hub'
      ? [
          {
            key: 'mdi_100_mda',
            sec: '100 SEC · MDA 합성 · 염수 디캔터 · 아닐린 진공회수',
            title: 'R-101 MDA 축합반응기 · D-101/S-101 분리 · C-101 아닐린 회수탑 · P-101',
            units: 'R-101 (95°C · 2.5 kG) · D-101 염수 디캔터 · S-101 진공탈수 · C-101 (14단 · -0.88 kG) · P-101A/B',
            desc: '아닐린·포르말린 산촉매 축합 및 NaOH 중화 후 LLE 염수분리, 진공탈수, 미반응 아닐린 감압 회수탑 인터널 설계',
            actions: [
              { label: '🔧 [R-101] MDA 축합·중화 반응기 수지 확인', onClick: () => openSimNode('sub_mdi_100_mda', 'R-101', undefined, 'mdi_plant') },
              { label: '🔧 [C-101] 아닐린 감압 회수탑(14단) 인터널·탑경 설계', onClick: () => openSimNode('sub_mdi_100_mda', 'C-101', 'internals', 'mdi_plant') },
              {
                label: '📐 [P-101A/B] MDA/아닐린 순환 펌프 상세설계 열기',
                onClick: () =>
                  openMdiChemProPump({
                    tag: 'P-101A/B',
                    name: 'MDA/아닐린 순환·이송 펌프',
                    fluidSummary: '조 MDA/아닐린 유기액 (10,006 kg/h · 95°C · 3.8 kG)',
                    fluidId: 'aniline',
                    T_C: 95.0,
                    Q_m3h: 10.5,
                    rho_kgm3: 1015,
                    P1_barG: 0.5,
                    P2_barG: 3.8,
                    eff_pct: 74,
                    dsuc_mm: '80',
                    ddis_mm: '65',
                  }),
              },
            ],
            sheetButtons: [
              { label: '100 Sec MDA 합성 PFD 이동 →', onClick: () => openSimSheet('sub_mdi_100_mda', 'mdi_plant') },
            ],
          },
          {
            key: 'mdi_200_phos',
            sec: '200 SEC · 포스겐(COCl₂) 제조 · 2단 포스겐화 & HCl 회수',
            title: 'R-201 포스겐 합성 · R-202 2단 포스겐화 · S-201 · PSV-201',
            units: 'R-201 (90°C · 3.5 kG) · R-202 (145°C · MCB 용매) · S-201 부생 HCl 분리기 · PSV-201 (API 526)',
            desc: 'CO+Cl₂ 고정층 촉매 포스겐 합성, MCB 용매 MDA 2단 연속 포스겐화, 부생 무수 HCl(8.23 t/h) 탈거 및 안전밸브 설계',
            actions: [
              { label: '🔧 [R-201] CO+Cl₂ 포스겐 합성 반응기 수지 확인', onClick: () => openSimNode('sub_mdi_200_phos', 'R-201', undefined, 'mdi_plant') },
              { label: '🔧 [R-202] 2단 연속 포스겐화 반응기(145°C) 수지 확인', onClick: () => openSimNode('sub_mdi_200_phos', 'R-202', undefined, 'mdi_plant') },
              { label: '📐 [PSV-201] 포스겐 반응계 긴급 안전밸브(API 526) 열기', onClick: openMdiChemProPSV },
            ],
            sheetButtons: [
              { label: '200 Sec 포스겐화 PFD 이동 →', onClick: () => openSimSheet('sub_mdi_200_phos', 'mdi_plant') },
            ],
          },
          {
            key: 'mdi_300_mcb',
            sec: '300 SEC · 탈포스겐 스트리핑 & MCB 용매 진공 회수',
            title: 'C-301 탈포스겐 스트리퍼 · C-302 MCB 진공회수탑 · P-302',
            units: 'C-301 (14단 · 2.0 kG) · C-302 (16단 · -0.90 kG · MCB 18.8 t/h 회수) · P-302A/B',
            desc: '과잉 포스겐 전량 회수 순환(C-301) 및 MCB 진공 회수(C-302) 다단 증류 인터널·진공 이송펌프 상세설계',
            actions: [
              { label: '🔧 [C-301] 탈포스겐 스트리퍼(14단) 인터널·단별 설계', onClick: () => openSimNode('sub_mdi_300_mcb', 'C-301', 'internals', 'mdi_plant') },
              { label: '🔧 [C-302] MCB 진공 회수탑(16단) 인터널·탑경 설계', onClick: () => openSimNode('sub_mdi_300_mcb', 'C-302', 'internals', 'mdi_plant') },
              {
                label: '📐 [P-302A/B] 회수 MCB 용매 이송펌프 상세설계 열기',
                onClick: () =>
                  openMdiChemProPump({
                    tag: 'P-302A/B',
                    name: '회수 MCB 용매 이송·순환 펌프',
                    fluidSummary: '회수 모노클로로벤젠 MCB (18,807 kg/h · 68°C · -0.90→3.5 kG)',
                    fluidId: 'chlorobenzene',
                    T_C: 68.0,
                    Q_m3h: 17.5,
                    rho_kgm3: 1075,
                    P1_barG: -0.9,
                    P2_barG: 3.5,
                    eff_pct: 76,
                    dsuc_mm: '100',
                    ddis_mm: '80',
                  }),
              },
            ],
            sheetButtons: [
              { label: '300 Sec MCB 회수 PFD 이동 →', onClick: () => openSimSheet('sub_mdi_300_mcb', 'mdi_plant') },
            ],
          },
          {
            key: 'mdi_400_purif',
            sec: '400 SEC · 고진공 Pure 4,4\'-MDI / PMDI 정밀 분별 (100,000 TPA)',
            title: 'E-401 박막 예열기 · C-401 고진공 분별탑 (Pure 4,500 · PMDI 8,000 kg/h)',
            units: 'E-401 (190°C · -0.985 kG) · C-401 (16단 · 20 mbar · Mellapak) · E-402/E-403',
            desc: '고진공 박막 증발/예열 전열 설계 및 열분해 억제를 위한 20 mbar 고진공 Pure 4,4\'-MDI / Polymeric MDI 정밀 분별탑 인터널 설계',
            actions: [
              { label: '🔧 [E-401] 고진공 박막 예열기 내장설계 직행', onClick: () => openSimNode('sub_mdi_400_purif', 'E-401', 'thermal', 'mdi_plant') },
              { label: '🔧 [C-401] 고진공 Pure/PMDI 분별탑(16단) 인터널 설계', onClick: () => openSimNode('sub_mdi_400_purif', 'C-401', 'internals', 'mdi_plant') },
              {
                label: '📐 [E-401] 박막 예열기(TFE Preheater) 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    sourceLabel: 'PLANT 05 MDI',
                    plantId: 'mdi_plant',
                    tag: 'E-401',
                    name: '고진공 박막 예열기 (Thin-Film Preheater)',
                    fluidSummary: '무용매 Crude MDI (12,625 kg/h, 165→190°C · 20 mbar 진공)',
                    hotFluidId: 'steam_13k',
                    coldFluidId: 'mdi_pure',
                    allocation: 'hot_shell',
                    dofTarget: 'mh_auto',
                    mh_kgh: 1850,
                    Th_in: 215.0,
                    Th_out: 210.0,
                    mc_kgh: 12625,
                    Tc_in: 165.0,
                    Tc_out: 190.0,
                    hot_mode: 'cond_full',
                    Th_sat: 215.0,
                    hot_hv: 1880,
                    cold_mode: 'sensible',
                    U_assumed: 520,
                  }),
              },
              {
                label: '📐 [E-402] Pure MDI 제품 냉각기 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    sourceLabel: 'PLANT 05 MDI',
                    plantId: 'mdi_plant',
                    tag: 'E-402',
                    name: 'Pure 4,4\'-MDI 제품 급랭·냉각기 (Product Cooler)',
                    fluidSummary: 'Pure 4,4\'-MDI (4,500 kg/h, 195→65°C · 순환수/냉수)',
                    hotFluidId: 'mdi_pure',
                    coldFluidId: 'water',
                    allocation: 'hot_tube',
                    dofTarget: 'mc_auto',
                    mh_kgh: 4500,
                    Th_in: 195.0,
                    Th_out: 65.0,
                    mc_kgh: 14500,
                    Tc_in: 45.0,
                    Tc_out: 62.0,
                    hot_mode: 'sensible',
                    cold_mode: 'sensible',
                    U_assumed: 410,
                  }),
              },
            ],
            sheetButtons: [
              { label: '400 Sec Pure/PMDI PFD 이동 →', onClick: () => openSimSheet('sub_mdi_400_purif', 'mdi_plant') },
              {
                label: '단위장치 상세설계 브리지 열기 →',
                onClick: () => {
                  setActivePlantId('mdi_plant');
                  router.push('/unit-equipment');
                },
              },
            ],
          },
        ]
      : effectiveDesignTab === 'cms_hub'
      ? [
          {
            key: 'cms_100_rxn',
            sec: '100 SEC · 액체염소 기화 & AIBN 고압 반응',
            title: 'E-101 액체염소 기화기 · R-101 24kG·120°C AIBN 반응기',
            units: 'E-101 (220 T/D · 25→95°C) · R-101 (24.0 kG · 120°C · AIBN 350 ppm)',
            desc: '액화 Cl₂ 가압 기화 전열 설계 및 MC/Cl₂ 몰비 2.08 연속 라디칼 염소화(MCL/CFM 선택도) 연동',
            actions: [
              { label: '🔧 [E-101] 액체염소 기화기 내장설계 직행', onClick: () => openSimNode('sub_cms_100_rxn', 'E-101', 'thermal', 'cms_plant') },
              { label: '🔧 [R-101] 24kG·120°C AIBN 반응기 조건·수지 확인', onClick: () => openSimNode('sub_cms_100_rxn', 'R-101', undefined, 'cms_plant') },
              {
                label: '📐 [E-101] Cl₂ Vaporizer 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    sourceLabel: 'PLANT 04 클로로메탄(CMS)',
                    plantId: 'cms_plant',
                    tag: 'E-101',
                    name: '액체염소 기화기 (Cl₂ Vaporizer)',
                    fluidSummary: '액화염소 (9,167 kg/h, 25→95°C 기화 · 24.5 kG)',
                    hotFluidId: 'steam_lp',
                    coldFluidId: 'liquid_cl2',
                    allocation: 'hot_shell',
                    dofTarget: 'mh_auto',
                    mh_kgh: 1480,
                    Th_in: 151.0,
                    Th_out: 145.0,
                    mc_kgh: 9167,
                    Tc_in: 25.0,
                    Tc_out: 95.0,
                    hot_mode: 'cond_full',
                    Th_sat: 151.0,
                    hot_hv: 2110,
                    cold_mode: 'boil_full',
                    Tc_sat: 76.0,
                    cold_hv: 255,
                    U_assumed: 680,
                  }),
              },
            ],
            sheetButtons: [
              { label: '100 Sec 기화·반응 PFD 이동 →', onClick: () => openSimSheet('sub_cms_100_rxn', 'cms_plant') },
            ],
          },
          {
            key: 'cms_200_rec',
            sec: '200 SEC · 고압 무수 HCl 탈거 · MC 순환 · Azeo 분리',
            title: 'C-201(60단) 무수 HCl 탈거탑 · C-202(50단) MC 순환탑 · C-203(30단) Azeo 분리탑',
            units: 'C-201 (60단 · 17.5 kG · 113 T/D AHCl) · C-202 (50단 · 6.5 kG · MC 회수) · C-203 (30단 · 공비/수분 퍼지) · P-202',
            desc: '부생 무수 HCl 고압 탈거, 미반응 메틸클로라이드 전량 순환(MCL 무순환) 및 C-203 공비·경질 불순물 제거 연동',
            actions: [
              { label: '🔧 [C-201] 무수 HCl 탈거탑(60단) 인터널·단별 설계', onClick: () => openSimNode('sub_cms_200_rec', 'C-201', 'internals', 'cms_plant') },
              { label: '🔧 [C-202] MC 순환탑(50단 · MCL 무순환) 인터널·탑경 설계', onClick: () => openSimNode('sub_cms_200_rec', 'C-202', 'internals', 'cms_plant') },
              { label: '🔧 [C-203] Azeo 공비·경질 분리탑(30단) 인터널 설계', onClick: () => openSimNode('sub_cms_200_rec', 'C-203', 'internals', 'cms_plant') },
              { label: '📐 [P-202] MC Recycle Pump 상세설계 열기', onClick: openCmsChemProPump },
            ],
            sheetButtons: [
              { label: '200 Sec 탈거·순환 PFD 이동 →', onClick: () => openSimSheet('sub_cms_200_rec', 'cms_plant') },
            ],
          },
          {
            key: 'cms_300_purif',
            sec: '300 SEC · MCL 120 · CFM 80 T/D 정제 & CTC 폐기',
            title: 'C-301(80단) MCL 정제탑 · C-302(120단) CFM 정제탑 & CTC 폐기',
            units: 'C-301 (80단 · MCL 120 T/D · 99.99%) · C-302 (120단 · CFM 80 T/D · 99.99% & 잔류 CTC·헤비 18 T/D)',
            desc: 'NRTL 다단 정밀증류 단별 조성·리보일러·응축기 전열 및 고순도 MCL 제품 냉각기 상세설계',
            actions: [
              { label: '🔧 [C-301] MCL 정제탑(80단 · 120 T/D) 인터널·탑경 설계', onClick: () => openSimNode('sub_cms_300_purif', 'C-301', 'internals', 'cms_plant') },
              { label: '🔧 [C-302] CFM 정제탑(120단 · 80 T/D) & CTC 폐기 설계', onClick: () => openSimNode('sub_cms_300_purif', 'C-302', 'internals', 'cms_plant') },
              {
                label: '📐 [E-301] MCL Cooler 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    sourceLabel: 'PLANT 04 클로로메탄(CMS)',
                    plantId: 'cms_plant',
                    tag: 'E-301',
                    name: '고순도 MCL 제품 냉각기 (MCL Cooler)',
                    fluidSummary: '정제 메틸렌클로라이드 (5,000 kg/h, 78→32°C · CW)',
                    hotFluidId: 'dcm',
                    coldFluidId: 'water',
                    allocation: 'hot_tube',
                    dofTarget: 'mc_auto',
                    mh_kgh: 5000,
                    Th_in: 78.0,
                    Th_out: 32.0,
                    mc_kgh: 18500,
                    Tc_in: 28.0,
                    Tc_out: 34.0,
                    hot_mode: 'sensible',
                    cold_mode: 'sensible',
                    U_assumed: 560,
                  }),
              },
            ],
            sheetButtons: [
              { label: '300 Sec MCL·CFM 정제 PFD 이동 →', onClick: () => openSimSheet('sub_cms_300_purif', 'cms_plant') },
              {
                label: '단위장치 상세설계 브리지 열기 →',
                onClick: () => {
                  setActivePlantId('cms_plant');
                  router.push('/unit-equipment');
                },
              },
            ],
          },
        ]
      : effectiveDesignTab === 'distill'
      ? [
          {
            key: 'ech_300_distill',
            sec: '300 SEC · 진공 다단 정밀증류 2탑',
            title: 'C-101 공비탈수탑 · C-102 99.9% ECH 정제탑',
            units: 'C-101 (-0.65 kG · 20단 · 디캔터) · C-102 (-0.92 kG / 85 Torr · 26단)',
            desc: 'NRTL 진공 MESH 다단 프로파일 및 트레이·패킹 인터널 설계',
            actions: [
              { label: '🔧 [C-101] 공비탈수탑 인터널·단별 설계', onClick: () => openSimNode('sub_ech_300_purif', 'C-101', 'internals', true) },
              { label: '🔧 [C-102] ECH 정제탑 인터널·탑경 설계', onClick: () => openSimNode('sub_ech_300_purif', 'C-102', 'internals', true) },
            ],
            sheetButtons: [
              { label: '300 Sec 진공정제 PFD 이동 →', onClick: () => openSimSheet('sub_ech_300_purif', true) },
            ],
          },
          {
            key: 'ech_100_200_react',
            sec: '100 / 200 SEC · 염소화 & 비누화 반응기',
            title: 'R-101 DCH 염소화 반응기 · R-201 비누화 반응기',
            units: 'R-101 (112°C · 2.2 kG · 97.5%) · R-201 (68°C · 0.4 kG · 98.5%) · V-202',
            desc: '글리세린 염소화·NaOH 고리화 반응 수지 및 유수분리 공정 연동',
            actions: [
              { label: '🔧 [R-101] 염소화 반응기 조건·수지 확인', onClick: () => openSimNode('sub_ech_100_hydro', 'R-101', undefined, true) },
              { label: '🔧 [R-201] 비누화 반응기 조건·수지 확인', onClick: () => openSimNode('sub_ech_200_sapon', 'R-201', undefined, true) },
            ],
            sheetButtons: [
              { label: '100 Sec 염소화 PFD →', onClick: () => openSimSheet('sub_ech_100_hydro', true) },
              { label: '200 Sec 비누화 PFD →', onClick: () => openSimSheet('sub_ech_200_sapon', true) },
            ],
          },
          {
            key: 'ech_hx_units',
            sec: '100 / 300 SEC · 공정 열교환기 & 제품 냉각기',
            title: 'E-102 반응물 냉각기 · E-301 ECH 제품 냉각기',
            units: 'E-102 (조 DCH 112→55°C · CW) · E-301 (99.9% ECH 62→35°C · CW)',
            desc: '반응열 제거(E-102) 및 정제 ECH 냉각(E-301) 내장·TEMA 전열 설계',
            actions: [
              { label: '🔧 [E-102] 반응물 냉각기 내장설계 직행', onClick: () => openSimNode('sub_ech_100_hydro', 'E-102', 'thermal', true) },
              {
                label: '📐 [E-102] TEMA 열교환기 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    plantId: 'ech_gte',
                    tag: 'E-102',
                    name: '글리세린 염소화 반응물 냉각기',
                    fluidSummary: '조 DCH 반응액 (16,517 kg/h, 112→55°C)',
                    hotFluidId: 'dch_13',
                    mh_kgh: 16517,
                    Th_in: 112,
                    Th_out: 55,
                    mc_kgh: 48000,
                    Tc_in: 30,
                    Tc_out: 38,
                    U_assumed: 520,
                  }),
              },
              {
                label: '📐 [E-301] 고순도 ECH 냉각기 상세설계 열기',
                onClick: () =>
                  openEchChemProHX({
                    plantId: 'ech_gte',
                    tag: 'E-301',
                    name: '고순도 99.9% ECH 제품 냉각기',
                    fluidSummary: '정제 ECH (8,650 kg/h, 62→35°C)',
                    hotFluidId: 'ech_pure',
                    mh_kgh: 8650,
                    Th_in: 62,
                    Th_out: 35,
                    mc_kgh: 16000,
                    Tc_in: 28,
                    Tc_out: 33,
                    U_assumed: 480,
                  }),
              },
            ],
            sheetButtons: [
              {
                label: '단위장치 상세설계 브리지 열기 →',
                onClick: () => {
                  setActivePlantId('ech_gte');
                  router.push('/unit-equipment');
                },
              },
            ],
          },
        ]
      : [
          {
            key: 'sub_1a_100_synth',
            sec: '100 SEC · 합성버너 & 35% 흡수',
            title: '불투명흑연 급랭기(E-102A) & 강하막 흡수계통',
            units: 'R-101A 합성로 · E-102A 흑연 급랭기 · C-110A/B 강하막 흡수탑',
            desc: '고온 HCl 합성가스 급냉 열수지 및 35 wt% 전자급 염산 흡수탑 전열·패킹 설계',
            actions: [
              { label: '🔧 [E-102A] 흑연 급랭기 내장설계 직행', onClick: () => openSimNode('sub_1a_100_synth', 'E-102A', 'thermal') },
            ],
            sheetButtons: [
              { label: '해당 세부공정 전체 PFD 도면으로 이동 →', onClick: () => openSimSheet('sub_1a_100_synth') },
            ],
          },
          {
            key: 'sub_1a_200_ahcl',
            sec: '200 SEC · 반도체 5N 무수염산(AHCl)',
            title: '심냉 액화기(E-225A) & 5N 정제 증류탑(C-230A)',
            units: 'T-210A 제습탑 · C-220A 압축기 · E-225A 심냉액화기 · C-230A 정제탑',
            desc: '수분 1 ppm 이하 무수염산 액화 T-Q 핀치 및 고압 정밀증류탑 인터널 사이징',
            actions: [
              { label: '🔧 [E-225A] 심냉 액화기(R-404A) 설계 직행', onClick: () => openSimNode('sub_1a_200_ahcl', 'E-225A', 'thermal') },
              { label: '🔧 [C-230A] 5N 정제탑 인터널·탑경 설계 직행', onClick: () => openSimNode('sub_1a_200_ahcl', 'C-230A', 'internals') },
            ],
            sheetButtons: [
              { label: '해당 세부공정 전체 PFD 도면으로 이동 →', onClick: () => openSimSheet('sub_1a_200_ahcl') },
            ],
          },
          {
            key: 'sub_1a_300_psd',
            sec: '300 SEC · 폐염산 압력변동 공비증류(PSD)',
            title: '진공 농축탑(C-310A) & 가압 회수탑(C-320A)',
            units: 'C-310A (-0.88 kG) · E-318A 예열기 · C-320A (6.0 kG) · E-325A',
            desc: 'HCl-H₂O 압력변동 공비이동 활용 무약품 폐염산 회수탑 단수·탑경 설계',
            actions: [
              { label: '🔧 [C-310A] 진공 농축탑 인터널·탑경 설계 직행', onClick: () => openSimNode('sub_1a_300_psd', 'C-310A', 'internals') },
              { label: '🔧 [C-320A] 가압 탈기탑 인터널·탑경 설계 직행', onClick: () => openSimNode('sub_1a_300_psd', 'C-320A', 'internals') },
              { label: '🔧 [E-318A] 고압 예열 열교환기 설계 직행', onClick: () => openSimNode('sub_1a_300_psd', 'E-318A', 'thermal') },
            ],
            sheetButtons: [
              { label: '해당 세부공정 전체 PFD 도면으로 이동 →', onClick: () => openSimSheet('sub_1a_300_psd') },
            ],
          },
        ];

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
      {/* 공장별 맞춤 상세설계 서브 네비게이션 */}
      <div
        className="no-scrollbar"
        style={{
          padding: '7px 16px',
          background: '#FFFFFF',
          borderBottom: '1px solid #DFDCD4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#64748B', marginRight: 4, whiteSpace: 'nowrap' }}>
            {isMdiMode
              ? 'PLANT 05 MDI:'
              : isCmsMode
                ? 'PLANT 04 클로로메탄(CMS):'
                : isEchMode
                  ? 'PLANT 03 바이오 ECH:'
                  : activePlantId === 'hcl_synth'
                    ? 'PLANT 02 1A 염산:'
                    : '전해공장 상세설계:'}
          </span>
          {subTabs.map(st => {
            const isSel = effectiveDesignTab === st.key;
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => switchDesignSubTab(st.key)}
                style={{
                  padding: '4px 11px',
                  borderRadius: 6,
                  border: isSel ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: isSel ? '#1E3A8A' : '#F8FAFC',
                  color: isSel ? '#FFFFFF' : '#334155',
                  fontSize: 11,
                  fontWeight: isSel ? 900 : 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        {(activePlantId === 'clorsim_sim' || activePlantId === 'hcl_synth' || isEchMode || isCmsMode || isMdiMode) && (
          <button
            type="button"
            onClick={() => {
              if (isMdiMode) setActivePlantId('mdi_plant');
              else if (isCmsMode) setActivePlantId('cms_plant');
              else if (isEchMode) setActivePlantId('ech_gte');
              router.push('/material-balance');
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#1E3A8A',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            도면 워크벤치 열기 →
          </button>
        )}
      </div>

      {/* 본문 영역 */}
      {effectiveDesignTab === 'chempro' ? (
        <div style={{ width: '100%', height: '100%', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#F6F7F2' }}>
          <iframe
            ref={iframeRef}
            src={`${BASE_PATH}/chempro/index.html?embed=1&v=20261118a&plant=${encodeURIComponent(activePlantId)}&tag=${encodeURIComponent(chemproTag)}${chemproSubTab ? `&sub=${encodeURIComponent(chemproSubTab)}` : ''}${chemproHandoff ? '&handoff=1' : ''}`}
            title="Integrated Equipment Design Studio"
            style={{ width: '100%', height: '100%', border: 'none', background: '#F6F7F2' }}
          />
        </div>
      ) : effectiveDesignTab === 'compressor' ? (
        <div style={{ flex: 1, width: '100%', overflow: 'auto', minHeight: 0, background: '#F8FAFC' }}>
          <CompressorDesignPanel />
        </div>
      ) : effectiveDesignTab === 'evap_studio' ? (
        <div style={{ flex: 1, width: '100%', overflow: 'auto', minHeight: 0, background: '#F6F7F2' }}>
          <MultiEffectEvapStudio />
        </div>
      ) : (effectiveDesignTab === 'hcl_hub' || effectiveDesignTab === 'distill' || effectiveDesignTab === 'cms_hub' || effectiveDesignTab === 'mdi_hub') ? (
        <div style={{ flex: 1, width: '100%', overflow: 'auto', minHeight: 0, padding: '14px 20px', background: '#F6F7F2' }}>
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 8,
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A' }}>
                {effectiveDesignTab === 'mdi_hub'
                  ? 'PLANT 05 MDI 10만톤 — 핵심장치 내장·상세설계'
                  : effectiveDesignTab === 'cms_hub'
                    ? 'PLANT 04 클로로메탄(CMS) — 핵심장치 내장·상세설계'
                    : effectiveDesignTab === 'distill'
                      ? 'PLANT 03 바이오 ECH — 핵심장치 내장·상세설계'
                      : 'PLANT 02 1A 염산 · 공비회수 — 핵심장치 내장설계'}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                {effectiveDesignTab === 'mdi_hub'
                  ? '100,000 TPA · Pure 4,4\'-MDI 4,500 · PMDI 8,000 kg/h · 반응기(R-101/R-201/R-202) · 분리기(D-101/S-101/S-201) · 4탑(C-101/C-301/C-302/C-401) · 박막예열·펌프·PSV'
                  : effectiveDesignTab === 'cms_hub'
                    ? 'Cl₂ 220 · MCL 120 · CFM 80 T/D · 기화기(E-101) · 반응기(R-101) · 5탑(C-201~203 · C-301~302) · 제품냉각·순환펌프(E-301/P-202)'
                    : effectiveDesignTab === 'distill'
                      ? '70,000 TPA GTE-ECH 공정 연동 · 증류탑(C-101/C-102) · 반응기(R-101/R-201) · 열교환기(E-102/E-301)'
                      : '실시간 PFD 유량·조성·압력 연동 내장 워크벤치 (증류탑 · 열교환기 · 급랭·심냉액화기)'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 12 }}>
            {hubCards.map(card => (
              <div
                key={card.key}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: 9,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: '#F0FDFA',
                      border: '1px solid #5EEAD4',
                      color: '#0F766E',
                      fontSize: 10,
                      fontWeight: 900,
                      marginBottom: 6,
                    }}
                  >
                    {card.sec}
                  </span>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginBottom: 4 }}>
                    {card.title}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#1E3A8A', marginBottom: 5 }}>
                    {card.units}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.4 }}>
                    {card.desc}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {card.actions.map(qa => (
                    <button
                      key={qa.label}
                      type="button"
                      onClick={qa.onClick}
                      style={{
                        width: '100%',
                        padding: '7px 11px',
                        borderRadius: 6,
                        border: '1px solid #1E3A8A',
                        background: '#EFF6FF',
                        color: '#1E3A8A',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {qa.label} →
                    </button>
                  ))}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {card.sheetButtons.map(sb => (
                      <button
                        key={sb.label}
                        type="button"
                        onClick={sb.onClick}
                        style={{
                          flex: 1,
                          minWidth: 130,
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #0F766E',
                          background: '#0F766E',
                          color: '#FFFFFF',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {sb.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, width: '100%', overflow: 'auto', minHeight: 0, padding: '16px 20px', background: '#F6F7F2' }}>
          <React.Suspense fallback={
            <div style={{ textAlign: 'center', padding: 60, color: '#7A7872' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚙</div>
              <div>로딩 중...</div>
            </div>
          }>
            {effectiveDesignTab === 'packing'  && <PackingTower />}
            {effectiveDesignTab === 'brine'    && <BrinePurificationDesign />}
            {effectiveDesignTab === 'evap'     && <FallingFilmDesign />}
          </React.Suspense>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PwaInstallButton } from '@/components/pwa/PwaRegistrar';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  CalcShortcutIcon,
  ColumnInternalIcon,
  DocSheetIcon,
  FlaskCompIcon,
  HexCircleIcon,
  PfdSchematicIcon,
  SlidersParamIcon,
  SpecControlIcon,
  StreamFlowIcon,
  VesselEquipIcon,
} from '@/components/ui/EngIcons';

export interface LandingPageProps {
  onOpenAuth: (defaultTab?: 'login' | 'register') => void;
  registrationMode: string;
  authError?: string | null;
}

type Lang = 'ko' | 'en';
type LegalDocKey = 'terms' | 'privacy' | 'refund' | 'disclaimer';

interface ModuleItem {
  id: string;
  code: string;
  icon: React.ReactNode;
  title: Record<Lang, string>;
  subtitle: Record<Lang, string>;
  bullets: Record<Lang, string[]>;
  tags: string[];
}

const CORE_MODULES: ModuleItem[] = [
  {
    id: 'flowsheet',
    code: 'MOD-01',
    icon: <PfdSchematicIcon size={18} />,
    title: {
      ko: '공정 플로우시트 시뮬레이터',
      en: 'Process Flowsheet Simulator',
    },
    subtitle: {
      ko: 'Modern & Classic 듀얼 UI 기반 정상상태 공정 해석 워크스테이션',
      en: 'Steady-state process modeling with Modern & Classic engineering interfaces',
    },
    bullets: {
      ko: [
        'MESH 엄밀 다성분 증류탑, 5종 반응기(RStoic·REquil·RGibbs·RCSTR·RPlug), LLE 추출',
        'Design Spec 목표역산 제어 및 다변수 Sensitivity 민감도 해석',
        '자동 재순환(Recycle) 수렴 솔버 및 스트림 물성표 즉시 생성',
      ],
      en: [
        'Rigorous MESH distillation, 5 reactor models (RStoic, REquil, RGibbs, RCSTR, RPlug) & LLE',
        'Built-in Design Spec feedback control and multi-variable Sensitivity studies',
        'Automated recycle convergence solver with instant stream property tables',
      ],
    },
    tags: ['MESH', '5 Reactors', 'LLE', 'Design Spec'],
  },
  {
    id: 'heat-exchanger',
    code: 'MOD-02',
    icon: <HexCircleIcon size={18} />,
    title: {
      ko: '열교환기 Rating & 공식 TEMA / API 662 데이터시트',
      en: 'Heat Exchanger Rating & Official TEMA / API 662 Datasheets',
    },
    subtitle: {
      ko: 'Shell & Tube · Plate 열전달 엄밀 정밀검토 및 공식 엑셀 산출물',
      en: 'Rigorous shell-and-tube thermal/hydraulic rating with native .xlsx datasheets',
    },
    bullets: {
      ko: [
        'Bell-Delaware + Pass-lane 보정, SBG 비응축가스(NCG) 응축, 10구간 상변화 적분',
        'Zuber 임계열유속(CHF) 검증 및 Window-span 2·Lb 유체유발진동(FIV) 판정',
        'TEMA RCB-4.6 / Section V 및 API 662 규격 공식 .xlsx 데이터시트 원클릭 내보내기',
      ],
      en: [
        'Bell-Delaware with pass-lane correction, SBG NCG condensation & 10-segment phase change',
        'Zuber CHF verification and window-span 2·Lb flow-induced vibration (FIV) screening',
        'One-click official TEMA RCB-4.6/V & API 662 formatted .xlsx datasheet export',
      ],
    },
    tags: ['Bell-Delaware', 'Zuber CHF', '2·Lb FIV', '.xlsx'],
  },
  {
    id: 'psv-flare',
    code: 'MOD-03',
    icon: <VesselEquipIcon size={18} />,
    title: {
      ko: 'PSV (API 520/526) & 플레어 네트워크 (API 521)',
      en: 'PSV (API 520/526) & Flare Network (API 521)',
    },
    subtitle: {
      ko: '압력방출장치 사이징부터 플레어 헤더 수력·복사열 해석까지 일괄 수행',
      en: 'End-to-end pressure relief sizing, flare header hydraulics & thermal radiation',
    },
    bullets: {
      ko: [
        '2상 Leung Omega 모델, 입구 배관 3% ΔP 기준, 방출 반력(Reaction Force) 계산',
        '다중 시나리오(화재·냉각수 중단·차단 등) 자동 비교 및 Governing Case 선정',
        '플레어 헤더 배압/Mach 수, KO Drum 사이징, 복사열(1.58 / 4.73 / 6.31 kW/m²) 등고선',
      ],
      en: [
        'Two-phase Leung Omega method, 3% inlet ΔP check & discharge reaction force calculation',
        'Multi-scenario comparison with automatic Governing Case identification',
        'Flare header backpressure/Mach, KO drum sizing & 1.58 / 4.73 / 6.31 kW/m² radiation zones',
      ],
    },
    tags: ['API 520/526', 'API 521', 'Leung Omega', 'Radiation'],
  },
  {
    id: 'shortcut-suite',
    code: 'MOD-04',
    icon: <CalcShortcutIcon size={18} />,
    title: {
      ko: '단위장치 숏컷 설계 스위트',
      en: 'Shortcut Equipment Design Suite',
    },
    subtitle: {
      ko: '현장 엔지니어를 위한 핵심 공정장치 6종 고속 사이징 계산기',
      en: 'Rapid first-pass sizing calculators for 6 essential process unit types',
    },
    bullets: {
      ko: [
        '열교환기(HEX), 펌프(API 610 NPSHa/축동력), 증류탑 수력(Column Internals)',
        '배관(ASME B31.3 두께·압력강하), 압력용기(ASME Sec. VIII Div. 1), PSV 단품 검토',
        '플로우시트 스트림 데이터를 단품 계산기로 직접 연동하여 중복 입력 제거',
      ],
      en: [
        'HEX sizing, API 610 Pump (NPSHa & brake power) & Column internal hydraulics',
        'ASME B31.3 Piping wall thickness/ΔP, ASME VIII Pressure Vessel & standalone PSV checks',
        'Direct stream handoff from flowsheet results to equipment modules without re-entry',
      ],
    },
    tags: ['API 610', 'ASME B31.3', 'ASME VIII', 'Column'],
  },
  {
    id: 'thermo-db',
    code: 'MOD-05',
    icon: <FlaskCompIcon size={18} />,
    title: {
      ko: '열역학 & 전해질 물성 데이터베이스',
      en: 'Thermodynamic & Electrolyte Property DB',
    },
    subtitle: {
      ko: '검증된 이성분 상호작용 파라미터와 수용액 전해질 모델 내장',
      en: 'Validated binary interaction parameters and aqueous electrolyte thermodynamics',
    },
    bullets: {
      ko: [
        '120+ 핵심 화학물질 순수성분 물성 및 CAS 번호·화학식 즉시 검색 지원',
        '212개 NRTL 이성분 파라미터 쌍, 78개 Peng-Robinson kij 상호작용 쌍 탑재',
        '강전해질·염수·가성소다 계통을 위한 Pitzer / eNRTL 비점상승(BPE) 및 밀도 모델',
      ],
      en: [
        '120+ industrial chemical compounds with instant CAS number & molecular formula lookup',
        '212 validated NRTL binary pairs and 78 Peng-Robinson kij interaction pairs',
        'Pitzer / eNRTL aqueous electrolyte modeling for brines, caustic, and acid systems',
      ],
    },
    tags: ['120+ Compounds', '212 NRTL', '78 PR kij', 'Pitzer / eNRTL'],
  },
  {
    id: 'units-tags',
    code: 'MOD-06',
    icon: <SlidersParamIcon size={18} />,
    title: {
      ko: '글로벌 단위계 & 장치 태그 명명 표준',
      en: 'Global Units & Tag Naming Standards',
    },
    subtitle: {
      ko: '국내외 EPC 프로젝트 표준에 맞춘 실시간 단위 변환 및 태그 체계',
      en: 'Real-time unit switching and configurable EPC equipment tag conventions',
    },
    bullets: {
      ko: [
        'MKS(kg/h, kg/cm²g, kcal/h) · SI(kmol/h, kPa, kW) · US Field(lb/h, psig, BTU/h) 즉시 전환',
        '한·일 플랜트 표준(R·T·C·D·TK·A) vs 글로벌 EPC 표준(R·C·K·V·TK·M) 태그 프리셋',
        '산출물 Excel 데이터시트 및 리포트 헤더에 선택된 단위계 자동 반영',
      ],
      en: [
        'Instant switching across MKS, SI, and US Field engineering unit systems',
        'KR/JP plant tags (R·T·C·D·TK·A) vs Global EPC conventions (R·C·K·V·TK·M)',
        'Automatic unit propagation into exported .xlsx datasheets and calculation sheets',
      ],
    },
    tags: ['MKS · SI · US', 'KR/JP Tags', 'Global EPC'],
  },
];

const BENCHMARKS = [
  {
    metric: '0.86%',
    label: { ko: '기포점 압력 %AAD', en: 'Bubble Pressure %AAD' },
    detail: { ko: '다성분 VLE 벤치마크 검증', en: 'Multi-component VLE benchmark' },
  },
  {
    metric: '0.21 °C',
    label: { ko: '비점 예측 AAD', en: 'Boiling Point AAD' },
    detail: { ko: '상압·가압 증기압 곡선 검증', en: 'Normal & elevated pressure curves' },
  },
  {
    metric: '0.40 K',
    label: { ko: '전해질 BPE AAD', en: 'Electrolyte BPE AAD' },
    detail: { ko: 'Pitzer / eNRTL 수용액계', en: 'Pitzer / eNRTL aqueous systems' },
  },
  {
    metric: '6 / 6 PASS',
    label: { ko: '공식 규격 골든 케이스', en: 'API 520/521 & TEMA Cases' },
    detail: { ko: '방출·플레어·열교환기 전수 통과', en: 'Relief, flare & HEX golden cases' },
  },
];

function getLegalContent(doc: LegalDocKey, lang: Lang): { title: string; updated: string; sections: { heading: string; body: string }[] } {
  const updated = lang === 'ko' ? '최종 개정일: 2026년 4월 12일' : 'Last Updated: April 12, 2026';

  if (doc === 'terms') {
    return lang === 'ko'
      ? {
          title: '이용약관 (Terms of Service)',
          updated,
          sections: [
            {
              heading: '1. 서비스 제공 및 목적',
              body: 'ChemPlant Studio(https://chemplantstudio.com)는 화학공정 시뮬레이션, 열교환기 정밀검토, PSV/플레어 사이징 및 단위장치 설계를 지원하는 웹 기반 엔지니어링 소프트웨어(SaaS)입니다. 본 약관은 서비스 이용자와 ChemPlant Studio 간의 권리, 의무 및 책임 사항을 규정합니다.',
            },
            {
              heading: '2. 계정 및 보안',
              body: '이용자는 본인 계정의 인증 정보(아이디·비밀번호)를 안전하게 관리할 책임이 있으며, 개인 워크스페이스에 저장된 공정 모델 및 데이터시트는 해당 계정에 독립적으로 격리 보관됩니다. 무단 계정 공유, 자동화 스크래핑, 역설계(Reverse Engineering)는 금지됩니다.',
            },
            {
              heading: '3. 구독, 결제 및 해지',
              body: '유료 플랜(Pro Engineer, Team / Enterprise)은 월간 또는 연간 정기 결제 방식으로 제공되며, 결제 대행(Merchant of Record)을 통해 안전하게 처리됩니다. 이용자는 언제든지 다음 결제 주기 전에 구독을 해지할 수 있으며, 해지 후에도 이미 결제된 기간의 만료일까지 정상 이용이 가능합니다.',
            },
            {
              heading: '4. 지적재산권',
              body: '이용자가 생성한 플로우시트, 장치 설계 케이스 및 내보낸 데이터시트의 소유권은 전적으로 이용자에게 있습니다. 소프트웨어 소스코드, 계산 엔진, UI 및 브랜드 자산에 대한 지적재산권은 ChemPlant Studio에 귀속됩니다.',
            },
            {
              heading: '5. 문의처',
              body: '약관 및 서비스 이용 관련 문의는 support@chemplantstudio.com 으로 접수해 주시기 바랍니다.',
            },
          ],
        }
      : {
          title: 'Terms of Service',
          updated,
          sections: [
            {
              heading: '1. Scope of Service',
              body: 'ChemPlant Studio (https://chemplantstudio.com) provides a cloud-hosted chemical process simulation, heat exchanger rating, pressure relief (PSV/Flare), and equipment design software suite. By accessing or using the platform, you agree to these Terms of Service.',
            },
            {
              heading: '2. Accounts & Workspace Isolation',
              body: 'You are responsible for safeguarding your account credentials. Engineering cases, flowsheets, and datasheets saved in your workspace are logically isolated to your account. Unauthorized credential sharing, automated scraping, or reverse engineering of the calculation engine is prohibited.',
            },
            {
              heading: '3. Subscriptions & Billing',
              body: 'Paid plans (Pro Engineer and Team / Enterprise) are billed on a recurring monthly or annual basis via our authorized Merchant of Record. You may cancel your subscription at any time prior to the next renewal date and retain access through the end of the current billing period.',
            },
            {
              heading: '4. Intellectual Property',
              body: 'You retain full ownership of all process models, inputs, and exported datasheets you create. ChemPlant Studio retains all rights to the underlying software platform, algorithms, databases, and brand assets.',
            },
            {
              heading: '5. Contact',
              body: 'For legal or service inquiries, contact support@chemplantstudio.com.',
            },
          ],
        };
  }

  if (doc === 'privacy') {
    return lang === 'ko'
      ? {
          title: '개인정보처리방침 (Privacy Policy)',
          updated,
          sections: [
            {
              heading: '1. 수집하는 정보',
              body: '서비스 제공을 위해 최소한의 계정 정보(아이디, 표시 이름, 암호화된 비밀번호 해시, 결제 시 이메일 주소)와 이용자가 직접 저장한 공정 설계 케이스 데이터를 수집·보관합니다. 신용카드 번호 등 민감 결제 정보는 ChemPlant Studio 서버에 저장되지 않고 공인 결제 대행사를 통해 처리됩니다.',
            },
            {
              heading: '2. 정보의 이용 목적',
              body: '수집된 정보는 사용자 인증, 개인 워크스페이스 동기화, 유료 라이선스 확인, 기술 지원 응답(support@chemplantstudio.com) 및 서비스 안정성 유지 목적으로만 사용됩니다. 이용자의 공정 데이터는 제3자에게 판매하거나 AI 모델 학습에 무단 사용하지 않습니다.',
            },
            {
              heading: '3. 보관 및 파기',
              body: '계정 삭제 요청 시 관련 개인정보 및 워크스페이스 데이터는 법령상 보관 의무가 있는 결제 기록을 제외하고 지체 없이 영구 삭제됩니다.',
            },
            {
              heading: '4. 이용자의 권리',
              body: '이용자는 언제든지 본인 데이터의 열람, 수정, 내보내기(JSON/Excel) 및 계정 삭제를 support@chemplantstudio.com 을 통해 요청할 수 있습니다.',
            },
          ],
        }
      : {
          title: 'Privacy Policy',
          updated,
          sections: [
            {
              heading: '1. Information We Collect',
              body: 'We collect only the minimum account information required to operate the service (username, display name, salted password hash, and billing email when subscribing) together with engineering workspace files you explicitly save. Payment card details are processed exclusively by our Merchant of Record and are never stored on ChemPlant Studio servers.',
            },
            {
              heading: '2. How We Use Information',
              body: 'Your information is used solely for authentication, workspace persistence, subscription management, technical support, and platform reliability. We never sell user data and never use your proprietary process models to train external models.',
            },
            {
              heading: '3. Data Retention & Deletion',
              body: 'Upon account deletion request, your personal profile and saved simulation cases are permanently purged, subject only to statutory tax/accounting retention obligations for billing records.',
            },
            {
              heading: '4. Your Rights & Contact',
              body: 'You may request access, export, correction, or deletion of your data at any time by emailing support@chemplantstudio.com.',
            },
          ],
        };
  }

  if (doc === 'refund') {
    return lang === 'ko'
      ? {
          title: '환불정책 (14-Day Refund Policy)',
          updated,
          sections: [
            {
              heading: '1. 14일 전액 환불 보장',
              body: 'ChemPlant Studio 유료 구독(Pro Engineer 월간/연간 및 Team / Enterprise) 최초 결제일로부터 14일 이내에는 사유와 관계없이 100% 전액 환불을 요청할 수 있습니다.',
            },
            {
              heading: '2. 환불 신청 방법',
              body: '결제 영수증(주문 번호) 및 가입 아이디를 기재하여 support@chemplantstudio.com 으로 이메일을 보내주시면 영업일 기준 2일 이내에 원결제 수단으로 환불을 처리해 드립니다.',
            },
            {
              heading: '3. 정기결제 해지',
              body: '14일 이후에는 언제든지 구독 자동 갱신을 중단할 수 있으며, 해지 시 다음 결제일부터 과금되지 않고 잔여 이용 기간 동안 유료 기능을 계속 사용할 수 있습니다. 중복 결제 또는 시스템 장애로 인한 과오금은 기간과 무관하게 즉시 전액 환불됩니다.',
            },
          ],
        }
      : {
          title: 'Refund Policy (14-Day Full Refund)',
          updated,
          sections: [
            {
              heading: '1. 14-Day Full Refund Guarantee',
              body: 'All new paid subscriptions (Pro Engineer monthly/annual and Team / Enterprise) are covered by a 14-day, no-questions-asked 100% full refund policy from the initial purchase date.',
            },
            {
              heading: '2. How to Request a Refund',
              body: 'Email support@chemplantstudio.com with your order reference number and account username. Approved refunds are processed back to your original payment method within 2 business days.',
            },
            {
              heading: '3. Subscription Cancellation & Billing Errors',
              body: 'After 14 days, you may cancel auto-renewal at any time to stop future charges while retaining access until the end of your current billing cycle. Duplicate charges or verified billing errors are refunded in full regardless of elapsed time.',
            },
          ],
        };
  }

  return lang === 'ko'
    ? {
        title: '엔지니어링 면책 고지 (Engineering Disclaimer)',
        updated,
        sections: [
          {
            heading: '1. 전문 엔지니어의 독립 검증 필수',
            body: 'ChemPlant Studio는 화학공정 설계, 열전달 검토, 압력방출장치(PSV) 및 플레어 시스템 해석을 보조하기 위한 엔지니어링 계산 도구입니다. 본 소프트웨어에서 산출된 모든 계산 결과, 물성 추정치 및 데이터시트는 실제 플랜트 시공, 제작, 운전 또는 안전장치 구매에 적용하기 전에 반드시 자격을 갖춘 공정 엔지니어(PE / 기술사)의 독립적인 검토 및 승인을 거쳐야 합니다.',
          },
          {
            heading: '2. 규격 및 현장 조건의 적용 책임',
            body: 'TEMA, API 520/521/526/610/662, ASME B31.3 및 ASME Section VIII 등 산업 표준의 최신 개정 사항, 지역 법규, 부식 여유, 특수 유체 독성 및 운전 안전계수의 최종 선정 책임은 전적으로 사용자 및 설계 수행 기관에 있습니다.',
          },
          {
            heading: '3. 책임의 제한',
            body: 'ChemPlant Studio는 벤치마크 검증을 통해 계산 정확도를 지속적으로 관리하지만, 소프트웨어 산출물의 직접·간접적 활용으로 인해 발생하는 설비 손상, 공정 중단, 인명 피해 또는 재산 손실에 대하여 법적 책임을 부담하지 않습니다.',
          },
        ],
      }
    : {
        title: 'Engineering Disclaimer',
        updated,
        sections: [
          {
            heading: '1. Independent Verification by Qualified Engineers',
            body: 'ChemPlant Studio is an engineering calculation and simulation aid. All process simulation outputs, thermal ratings, relief sizing results, flare radiation contours, and exported datasheets must be independently verified and approved by a licensed Professional Engineer (PE) or qualified process authority prior to equipment fabrication, procurement, construction, or plant operation.',
          },
          {
            heading: '2. Code Compliance & Site Conditions',
            body: 'Final compliance with the latest editions of TEMA, API 520/521/526/610/662, ASME B31.3, ASME Section VIII, local statutory regulations, corrosion allowances, and site-specific safety margins remains the sole responsibility of the user and engineering organization.',
          },
          {
            heading: '3. Limitation of Liability',
            body: 'While ChemPlant Studio maintains continuous benchmark verification, the software is provided "as is" without warranty of fitness for a particular plant design, and ChemPlant Studio assumes no liability for direct, indirect, or consequential damages arising from engineering decisions based on its outputs.',
          },
        ],
      };
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

function CheckMarkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <polyline points="3.2,8.4 6.5,11.6 12.8,4.6" />
    </svg>
  );
}

function HeroPfdPreview({ lang }: { lang: Lang }) {
  return (
    <div
      style={{
        background: '#0B1220',
        border: '1px solid #334155',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* Window Chrome */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: '#0F172A',
          borderBottom: '1px solid #1E293B',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#475569' }} />
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#475569' }} />
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#475569' }} />
          </span>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: '#94A3B8',
              letterSpacing: '0.02em',
            }}
          >
            PFD-100 · MESH + TEMA + API 520
          </span>
        </div>
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            fontWeight: 700,
            color: '#CBD5E1',
            background: '#1E293B',
            border: '1px solid #334155',
            borderRadius: 4,
            padding: '2px 7px',
          }}
        >
          CONVERGED · 1.4e-7
        </span>
      </div>

      {/* Monochrome Engineering Schematic SVG */}
      <div style={{ padding: '16px 14px 12px', background: '#0B1220' }}>
        <svg
          viewBox="0 0 540 248"
          width="100%"
          style={{ display: 'block', height: 'auto' }}
          role="img"
          aria-label={
            lang === 'ko'
              ? 'ChemPlant Studio 공정 플로우시트 및 장치 설계 미리보기'
              : 'ChemPlant Studio process flowsheet and equipment preview'
          }
        >
          <defs>
            <pattern id="cp-pfd-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="#1E293B"
                strokeWidth="0.7"
              />
            </pattern>
            <marker
              id="cp-arrow"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 7 4 L 0 7 Z" fill="#94A3B8" />
            </marker>
          </defs>

          <rect x="0" y="0" width="540" height="248" fill="url(#cp-pfd-grid)" rx="6" />

          {/* Stream S-01 Feed -> E-101 */}
          <line x1="20" y1="124" x2="86" y2="124" stroke="#94A3B8" strokeWidth="1.6" markerEnd="url(#cp-arrow)" />
          <text x="24" y="114" fill="#CBD5E1" fontSize="9.5" fontFamily="JetBrains Mono, monospace">
            S-01 FEED
          </text>
          <text x="24" y="140" fill="#64748B" fontSize="8.5" fontFamily="JetBrains Mono, monospace">
            45°C · 12.5 bar
          </text>

          {/* E-101 Feed Preheater (HEX symbol) */}
          <circle cx="110" cy="124" r="20" fill="#0F172A" stroke="#E2E8F0" strokeWidth="1.6" />
          <polyline
            points="93,124 101,124 106,115 114,133 119,124 127,124"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="1.4"
          />
          <text x="110" y="158" textAnchor="middle" fill="#F8FAFC" fontSize="9.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            E-101
          </text>
          <text x="110" y="170" textAnchor="middle" fill="#64748B" fontSize="8" fontFamily="JetBrains Mono, monospace">
            TEMA BEM
          </text>

          {/* Stream S-02 -> R-101 */}
          <line x1="130" y1="124" x2="178" y2="124" stroke="#94A3B8" strokeWidth="1.6" markerEnd="url(#cp-arrow)" />

          {/* R-101 Reactor */}
          <rect x="184" y="84" width="46" height="80" rx="18" fill="#0F172A" stroke="#E2E8F0" strokeWidth="1.6" />
          <line x1="184" y1="106" x2="230" y2="106" stroke="#334155" strokeWidth="1" strokeDasharray="3 2" />
          <line x1="184" y1="142" x2="230" y2="142" stroke="#334155" strokeWidth="1" strokeDasharray="3 2" />
          <text x="207" y="128" textAnchor="middle" fill="#CBD5E1" fontSize="9" fontFamily="JetBrains Mono, monospace">
            RGibbs
          </text>
          <text x="207" y="179" textAnchor="middle" fill="#F8FAFC" fontSize="9.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            R-101
          </text>
          <text x="207" y="191" textAnchor="middle" fill="#64748B" fontSize="8" fontFamily="JetBrains Mono, monospace">
            185°C · 98.4%
          </text>

          {/* PSV-101 Relief Valve to Flare Header */}
          <polyline
            points="207,84 207,40 315,40"
            fill="none"
            stroke="#64748B"
            strokeWidth="1.3"
            strokeDasharray="4 2"
            markerEnd="url(#cp-arrow)"
          />
          <polygon points="200,56 214,56 207,66" fill="#0F172A" stroke="#CBD5E1" strokeWidth="1.3" />
          <text x="220" y="34" fill="#94A3B8" fontSize="8.5" fontFamily="JetBrains Mono, monospace">
            PSV-101 → FLARE HEADER (API 521)
          </text>

          {/* Stream S-03 -> C-101 */}
          <line x1="230" y1="124" x2="292" y2="124" stroke="#94A3B8" strokeWidth="1.6" markerEnd="url(#cp-arrow)" />

          {/* C-101 Distillation Column */}
          <rect x="298" y="64" width="44" height="128" rx="18" fill="#0F172A" stroke="#F8FAFC" strokeWidth="1.8" />
          <line x1="298" y1="90" x2="342" y2="90" stroke="#475569" strokeWidth="1" />
          <line x1="298" y1="112" x2="342" y2="112" stroke="#475569" strokeWidth="1" />
          <line x1="298" y1="134" x2="342" y2="134" stroke="#475569" strokeWidth="1" />
          <line x1="298" y1="156" x2="342" y2="156" stroke="#475569" strokeWidth="1" />
          <text x="320" y="208" textAnchor="middle" fill="#F8FAFC" fontSize="9.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            C-101
          </text>
          <text x="320" y="220" textAnchor="middle" fill="#64748B" fontSize="8" fontFamily="JetBrains Mono, monospace">
            32 STG · MESH
          </text>

          {/* Overhead -> E-102 Condenser -> D-101 Reflux Drum */}
          <polyline points="320,64 320,48 398,48 398,74" fill="none" stroke="#94A3B8" strokeWidth="1.4" markerEnd="url(#cp-arrow)" />
          <circle cx="398" cy="92" r="14" fill="#0F172A" stroke="#CBD5E1" strokeWidth="1.5" />
          <polyline points="387,92 393,92 396,86 400,98 403,92 409,92" fill="none" stroke="#94A3B8" strokeWidth="1.2" />
          <text x="420" y="95" fill="#CBD5E1" fontSize="8.5" fontFamily="JetBrains Mono, monospace">
            E-102
          </text>

          {/* Distillate Product */}
          <line x1="398" y1="106" x2="398" y2="124" stroke="#94A3B8" strokeWidth="1.4" />
          <rect x="380" y="124" width="36" height="18" rx="7" fill="#0F172A" stroke="#CBD5E1" strokeWidth="1.4" />
          <text x="398" y="136" textAnchor="middle" fill="#94A3B8" fontSize="7.5" fontFamily="JetBrains Mono, monospace">
            D-101
          </text>
          {/* Reflux back */}
          <polyline points="380,133 360,133 360,82 346,82" fill="none" stroke="#64748B" strokeWidth="1.2" markerEnd="url(#cp-arrow)" />
          {/* Distillate out */}
          <line x1="416" y1="133" x2="514" y2="133" stroke="#E2E8F0" strokeWidth="1.6" markerEnd="url(#cp-arrow)" />
          <text x="434" y="125" fill="#F8FAFC" fontSize="9" fontFamily="JetBrains Mono, monospace">
            S-04 OVERHEAD
          </text>
          <text x="434" y="147" fill="#64748B" fontSize="8" fontFamily="JetBrains Mono, monospace">
            99.8 wt% · 64.2°C
          </text>

          {/* Bottoms -> E-103 Reboiler -> Bottoms Out */}
          <polyline points="320,192 320,232 418,232" fill="none" stroke="#94A3B8" strokeWidth="1.4" />
          <circle cx="432" cy="232" r="12" fill="#0F172A" stroke="#CBD5E1" strokeWidth="1.4" />
          <line x1="444" y1="232" x2="514" y2="232" stroke="#94A3B8" strokeWidth="1.5" markerEnd="url(#cp-arrow)" />
          <text x="452" y="224" fill="#CBD5E1" fontSize="8.5" fontFamily="JetBrains Mono, monospace">
            S-05 BOTTOMS
          </text>
        </svg>
      </div>

      {/* Verified Badges Footer */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '10px 14px 12px',
          background: '#0F172A',
          borderTop: '1px solid #1E293B',
        }}
      >
        {['VLE %AAD 0.86%', 'TEMA RCB-4.6/V', 'API 520 Omega', 'API 521 Flare', 'MKS · SI · US'].map(badge => (
          <span
            key={badge}
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10.5,
              fontWeight: 600,
              color: '#E2E8F0',
              background: '#1E293B',
              border: '1px solid #334155',
              borderRadius: 5,
              padding: '3px 8px',
            }}
          >
            {badge}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage({
  onOpenAuth,
  registrationMode,
  authError,
}: LandingPageProps) {
  const lang = useUnitStore(s => s.lang);
  const setLang = useUnitStore(s => s.setLang);
  const hydrateUnits = useUnitStore(s => s.hydrate);
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hydrateUnits();
  }, [hydrateUnits]);

  useEffect(() => {
    if (!activeLegalDoc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveLegalDoc(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeLegalDoc]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const legalContent = activeLegalDoc ? getLegalContent(activeLegalDoc, lang) : null;

  const regBadgeText =
    registrationMode === 'invite_only'
      ? lang === 'ko'
        ? '초대코드 베타 운영 중'
        : 'Invite-Only Early Access'
      : registrationMode === 'approval'
        ? lang === 'ko'
          ? '엔지니어 승인제 가입'
          : 'Engineer Approval Access'
        : lang === 'ko'
          ? '즉시 가입 및 워크스페이스 오픈'
          : 'Open Registration Active';

  return (
    <div
      ref={scrollContainerRef}
      className="cp-landing-root"
      style={{
        height: '100vh',
        width: '100vw',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#F8FAFC',
        color: '#0F172A',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <style>{`
        .cp-landing-root {
          scroll-behavior: smooth;
        }
        .cp-container {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0 24px;
        }
        .cp-hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          gap: 44px;
          align-items: center;
        }
        .cp-modules-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
        }
        .cp-bench-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        .cp-pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          align-items: stretch;
        }
        .cp-nav-links {
          display: flex;
          align-items: center;
          gap: 24px;
        }
        .cp-nav-link {
          background: none;
          border: none;
          color: #CBD5E1;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 2px;
          transition: color 0.15s ease;
        }
        .cp-nav-link:hover {
          color: #FFFFFF;
        }
        .cp-module-card {
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          padding: 22px;
          display: flex;
          flex-direction: column;
          transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }
        .cp-module-card:hover {
          border-color: #94A3B8;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
        }
        .cp-btn-primary {
          background: #1E3A8A;
          color: #FFFFFF;
          border: 1px solid #1E3A8A;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .cp-btn-primary:hover {
          background: #1D4ED8;
        }
        .cp-btn-outline-dark {
          background: rgba(255, 255, 255, 0.04);
          color: #E2E8F0;
          border: 1px solid #475569;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .cp-btn-outline-dark:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: #94A3B8;
        }
        .cp-btn-outline-light {
          background: #FFFFFF;
          color: #0F172A;
          border: 1px solid #CBD5E1;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .cp-btn-outline-light:hover {
          background: #F1F5F9;
          border-color: #94A3B8;
        }
        .cp-footer-link {
          background: none;
          border: none;
          color: #94A3B8;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          padding: 2px 0;
          text-align: left;
          transition: color 0.15s ease;
        }
        .cp-footer-link:hover {
          color: #FFFFFF;
          text-decoration: underline;
        }
        @media (max-width: 1024px) {
          .cp-hero-grid {
            grid-template-columns: 1fr;
            gap: 32px;
          }
          .cp-modules-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .cp-bench-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .cp-pricing-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 680px) {
          .cp-container {
            padding: 0 16px;
          }
          .cp-nav-links {
            display: none;
          }
          .cp-modules-grid {
            grid-template-columns: 1fr;
          }
          .cp-bench-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Sticky Top Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(15, 23, 42, 0.94)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid #1E293B',
        }}
      >
        <div
          className="cp-container"
          style={{
            height: 62,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* Brand Logo */}
          <button
            type="button"
            onClick={() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: '#FFFFFF',
            }}
          >
            <img
              src="/icon-192-v2.png"
              alt="ChemPlant Studio"
              style={{
                width: 32,
                height: 32,
                borderRadius: 7,
                objectFit: 'cover',
                border: '1px solid #334155',
              }}
            />
            <span style={{ textAlign: 'left' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: '#FFFFFF',
                  lineHeight: 1.15,
                }}
              >
                ChemPlant Studio
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontFamily: 'JetBrains Mono, monospace',
                  color: '#94A3B8',
                  letterSpacing: '0.03em',
                }}
              >
                chemplantstudio.com
              </span>
            </span>
          </button>

          {/* Anchor Links */}
          <nav className="cp-nav-links" aria-label="Primary Navigation">
            <button type="button" className="cp-nav-link" onClick={() => scrollToSection('features')}>
              {lang === 'ko' ? '기능' : 'Features'}
            </button>
            <button type="button" className="cp-nav-link" onClick={() => scrollToSection('benchmarks')}>
              {lang === 'ko' ? '검증' : 'Benchmarks'}
            </button>
            <button type="button" className="cp-nav-link" onClick={() => scrollToSection('pricing')}>
              {lang === 'ko' ? '요금제' : 'Pricing'}
            </button>
          </nav>

          {/* Right Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* KO / EN Toggle */}
            <div
              role="group"
              aria-label="Language Selector"
              style={{
                display: 'inline-flex',
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: 2,
              }}
            >
              {(['ko', 'en'] as Lang[]).map(code => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  style={{
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'JetBrains Mono, monospace',
                    cursor: 'pointer',
                    background: lang === code ? '#FFFFFF' : 'transparent',
                    color: lang === code ? '#0F172A' : '#94A3B8',
                    transition: 'all 0.12s ease',
                  }}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>

            <PwaInstallButton variant="login-header" />

            <button
              type="button"
              className="cp-btn-primary"
              onClick={() => onOpenAuth('login')}
              style={{
                padding: '7px 14px',
                fontSize: 12.5,
                whiteSpace: 'nowrap',
              }}
            >
              {lang === 'ko' ? '로그인' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Optional Auth Error Banner */}
      {authError && (
        <div
          style={{
            background: '#FEF2F2',
            borderBottom: '1px solid #FECACA',
            color: '#991B1B',
            padding: '10px 16px',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <div
            className="cp-container"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              style={{
                background: '#991B1B',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {lang === 'ko' ? '로그인 창 열기' : 'Open Sign In'}
            </button>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section
        style={{
          background:
            'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
          backgroundImage:
            'linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px), linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
          backgroundSize: '28px 28px, 28px 28px, 100% 100%',
          color: '#F8FAFC',
          padding: '68px 0 76px',
          borderBottom: '1px solid #334155',
        }}
      >
        <div className="cp-container">
          <div className="cp-hero-grid">
            {/* Left Copy */}
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 11px',
                  borderRadius: 999,
                  background: 'rgba(30, 58, 138, 0.35)',
                  border: '1px solid rgba(147, 197, 253, 0.3)',
                  color: '#CBD5E1',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.03em',
                  marginBottom: 18,
                }}
              >
                <SpecControlIcon size={13} />
                <span>{regBadgeText}</span>
              </div>

              <h1
                style={{
                  fontSize: 'clamp(28px, 4vw, 42px)',
                  fontWeight: 800,
                  lineHeight: 1.18,
                  letterSpacing: '-0.03em',
                  color: '#FFFFFF',
                  marginBottom: 18,
                }}
              >
                {lang === 'ko' ? (
                  <>
                    화학공정 시뮬레이션과
                    <br />
                    공식 장치 설계 데이터시트를
                    <br />
                    하나의 웹 워크스페이스에서
                  </>
                ) : (
                  <>
                    Chemical Process Simulation
                    <br />
                    &amp; Official Equipment Design
                    <br />
                    in One Web Workspace
                  </>
                )}
              </h1>

              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.68,
                  color: '#CBD5E1',
                  maxWidth: 540,
                  marginBottom: 28,
                }}
              >
                {lang === 'ko'
                  ? '정상상태 MESH 증류·반응기 플로우시트부터 Bell-Delaware 열교환기 정밀검토, API 520/526 PSV, API 521 플레어 복사열, 전해질 열역학까지. 설치 없이 브라우저에서 즉시 해석하고 공식 TEMA · API 규격 Excel 데이터시트를 생성합니다.'
                  : 'From rigorous MESH distillation and multi-reactor flowsheets to Bell-Delaware heat exchanger rating, API 520/526 PSV sizing, API 521 flare radiation, and electrolyte thermodynamics. Run directly in your browser and export official TEMA & API .xlsx datasheets.'}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
                <button
                  type="button"
                  className="cp-btn-primary"
                  onClick={() => onOpenAuth('login')}
                  style={{
                    padding: '12px 22px',
                    fontSize: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <StreamFlowIcon size={15} />
                  <span>{lang === 'ko' ? '워크스페이스 로그인' : 'Launch Workspace'}</span>
                </button>

                <button
                  type="button"
                  className="cp-btn-outline-dark"
                  onClick={() => scrollToSection('benchmarks')}
                  style={{
                    padding: '12px 20px',
                    fontSize: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <DocSheetIcon size={15} />
                  <span>{lang === 'ko' ? '검증 데이터 보기' : 'View Benchmarks'}</span>
                </button>
              </div>

              {/* Compact Trust Line */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px 18px',
                  fontSize: 12,
                  color: '#94A3B8',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                <span>TEMA 10th Ed.</span>
                <span>API 520 / 521 / 526</span>
                <span>API 610 / 662</span>
                <span>ASME VIII / B31.3</span>
              </div>
            </div>

            {/* Right Preview Card */}
            <HeroPfdPreview lang={lang} />
          </div>
        </div>
      </section>

      {/* 6 Core Engineering Modules */}
      <section id="features" style={{ padding: '76px 0', background: '#F8FAFC' }}>
        <div className="cp-container">
          <div style={{ marginBottom: 38, maxWidth: 680 }}>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11.5,
                fontWeight: 700,
                color: '#1E3A8A',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              {lang === 'ko' ? 'CORE ENGINEERING MODULES' : 'CORE ENGINEERING MODULES'}
            </div>
            <h2
              style={{
                fontSize: 'clamp(22px, 3vw, 30px)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#0F172A',
                marginBottom: 10,
              }}
            >
              {lang === 'ko'
                ? '공정 설계 전 주기를 아우르는 6대 핵심 모듈'
                : 'Six Integrated Modules Across the Process Design Lifecycle'}
            </h2>
            <p style={{ fontSize: 14.5, color: '#475569', lineHeight: 1.6 }}>
              {lang === 'ko'
                ? '별도 플러그인이나 수작업 스프레드시트 변환 없이, 플로우시트 계산 결과가 장치 정밀검토와 공식 데이터시트로 직결됩니다.'
                : 'Eliminate manual spreadsheet transcription. Converged flowsheet streams feed directly into rigorous equipment rating and official datasheet generation.'}
            </p>
          </div>

          <div className="cp-modules-grid">
            {CORE_MODULES.map(mod => (
              <article key={mod.id} className="cp-module-card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      background: '#0F172A',
                      color: '#F8FAFC',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {mod.icon}
                  </div>
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: '#64748B',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {mod.code}
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: '#0F172A',
                    lineHeight: 1.35,
                    marginBottom: 6,
                  }}
                >
                  {mod.title[lang]}
                </h3>

                <p
                  style={{
                    fontSize: 12.8,
                    color: '#475569',
                    lineHeight: 1.55,
                    marginBottom: 14,
                  }}
                >
                  {mod.subtitle[lang]}
                </p>

                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: '0 0 18px 0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    flex: 1,
                  }}
                >
                  {mod.bullets[lang].map((b, idx) => (
                    <li
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        fontSize: 12.5,
                        color: '#1E293B',
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: '#1E3A8A' }}>
                        <CheckMarkIcon size={13} />
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    paddingTop: 12,
                    borderTop: '1px solid #E2E8F0',
                  }}
                >
                  {mod.tags.map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: '#334155',
                        background: '#F1F5F9',
                        border: '1px solid #E2E8F0',
                        borderRadius: 4,
                        padding: '2px 7px',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Validation Benchmarks Strip */}
      <section
        id="benchmarks"
        style={{
          background: '#0F172A',
          color: '#F8FAFC',
          padding: '68px 0',
          borderTop: '1px solid #1E293B',
          borderBottom: '1px solid #1E293B',
        }}
      >
        <div className="cp-container">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              marginBottom: 32,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#93C5FD',
                  letterSpacing: '0.06em',
                  marginBottom: 8,
                }}
              >
                VALIDATION &amp; BENCHMARKS
              </div>
              <h2
                style={{
                  fontSize: 'clamp(22px, 3vw, 28px)',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: '#FFFFFF',
                }}
              >
                {lang === 'ko'
                  ? '실험 데이터와 국제 설계 규격으로 검증된 수치 정확도'
                  : 'Numerically Verified Against Experimental Data & Industry Codes'}
              </h2>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11.5,
                color: '#CBD5E1',
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '6px 12px',
              }}
            >
              <ColumnInternalIcon size={14} />
              <span>
                {lang === 'ko' ? '회귀 테스트 스위트 상시 통과' : 'Automated Regression Verified'}
              </span>
            </div>
          </div>

          <div className="cp-bench-grid">
            {BENCHMARKS.map(item => (
              <div
                key={item.metric}
                style={{
                  background: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 10,
                  padding: '22px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 28,
                    fontWeight: 800,
                    color: '#FFFFFF',
                    letterSpacing: '-0.02em',
                    marginBottom: 6,
                  }}
                >
                  {item.metric}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#E2E8F0', marginBottom: 4 }}>
                  {item.label[lang]}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
                  {item.detail[lang]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section (MoR / Lemon Squeezy Review-Ready) */}
      <section id="pricing" style={{ padding: '78px 0', background: '#FFFFFF' }}>
        <div className="cp-container">
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 42px' }}>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11.5,
                fontWeight: 700,
                color: '#1E3A8A',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              TRANSPARENT PRICING
            </div>
            <h2
              style={{
                fontSize: 'clamp(22px, 3vw, 30px)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#0F172A',
                marginBottom: 10,
              }}
            >
              {lang === 'ko'
                ? '엔지니어와 설계 팀을 위한 명확한 요금제'
                : 'Clear Licensing for Process Engineers & Teams'}
            </h2>
            <p style={{ fontSize: 14.5, color: '#475569', lineHeight: 1.6 }}>
              {lang === 'ko'
                ? '복잡한 동글이나 연간 억대 라이선스 없이, 필요한 규모에 맞춰 즉시 시작하세요. 모든 유료 플랜은 14일 전액 환불을 보장합니다.'
                : 'No hardware dongles or opaque quotes. Start immediately with transparent monthly or annual licensing backed by a 14-day full refund policy.'}
            </p>
          </div>

          <div className="cp-pricing-grid">
            {/* Tier 1: Free / Early Access */}
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
                {lang === 'ko' ? 'Free / 얼리 액세스' : 'Free / Early Access'}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  $0
                </span>
                <span style={{ fontSize: 12.5, color: '#64748B' }}>
                  {lang === 'ko' ? '/ 평가·베타 계정' : '/ preview & beta'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, marginBottom: 20 }}>
                {lang === 'ko'
                  ? '핵심 플로우시트 시뮬레이터 미리보기 및 기본 물성 조회를 위한 시작 플랜'
                  : 'Core simulator preview, basic property lookup, and early-access workspace.'}
              </p>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  flex: 1,
                }}
              >
                {(lang === 'ko'
                  ? [
                      '핵심 플로우시트 시뮬레이터 미리보기',
                      '기본 화학물질 물성 조회 (CAS / 화학식)',
                      '단위장치 숏컷 계산기 체험',
                      '공정 경제성 · 원단위 핸드북 대표 10종 체험 (104종 수록)',
                    ]
                  : [
                      'Core flowsheet simulator preview',
                      'Basic chemical property lookup (CAS / formula)',
                      'Shortcut equipment calculator access',
                      'Process Economics Handbook preview (10 of 104 commercial routes)',
                    ]
                ).map((feat, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#1E293B' }}>
                    <span style={{ color: '#475569' }}>
                      <CheckMarkIcon size={14} />
                    </span>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="cp-btn-outline-light"
                onClick={() => onOpenAuth('register')}
                style={{ width: '100%', padding: '11px 16px', fontSize: 13.5 }}
              >
                {lang === 'ko' ? '무료 계정 시작하기' : 'Start Free Access'}
              </button>
            </div>

            {/* Tier 2: Pro Engineer */}
            <div
              style={{
                background: '#FFFFFF',
                border: '2px solid #1E3A8A',
                borderRadius: 12,
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 14px 36px rgba(15, 23, 42, 0.08)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800, color: '#1E3A8A' }}>
                  Pro Engineer
                </span>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    background: '#0F172A',
                    color: '#FFFFFF',
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
                >
                  {lang === 'ko' ? 'RECOMMENDED' : 'RECOMMENDED'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  $19
                </span>
                <span style={{ fontSize: 12.5, color: '#64748B' }}>
                  {lang === 'ko' ? '/ 월 (약 2.6만 원)' : '/ mo'}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11.5,
                  color: '#1E3A8A',
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {lang === 'ko' ? '연간 결제 시 $190 / 년 (2개월 절감)' : 'or $190 / yr (save 2 months)'}
              </div>

              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, marginBottom: 20 }}>
                {lang === 'ko'
                  ? '실무 공정 엔지니어를 위한 전체 열역학 DB, 104종 공정 경제성 핸드북 및 공식 데이터시트 무제한 출력'
                  : 'Full engineering suite with 104-process economics handbook and official .xlsx deliverables.'}
              </p>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  flex: 1,
                }}
              >
                {(lang === 'ko'
                  ? [
                      '전체 물성 DB (120+ 물질, 212 NRTL, 78 PR kij, Pitzer/eNRTL)',
                      '공정 경제성 · 원단위 핸드북 104종 전체 열람 및 엑셀(.xlsx) 내보내기',
                      '공식 TEMA / API 662 / API 520 / 521 .xlsx 데이터시트 & 플레어 리포트',
                      '무제한 클라우드 케이스 저장 및 개인 워크스페이스 동기화',
                    ]
                  : [
                      'Full Property DB (120+ compounds, 212 NRTL, 78 PR kij, Pitzer/eNRTL)',
                      'Full 104-Process Economics & Unit Consumption Handbook + .xlsx Export',
                      'Official TEMA / API 662 / API 520 / 521 Datasheets & Flare Reports',
                      'Unlimited Cloud Cases & Private Workspace Sync',
                    ]
                ).map((feat, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#0F172A', fontWeight: 500 }}>
                    <span style={{ color: '#1E3A8A' }}>
                      <CheckMarkIcon size={14} />
                    </span>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="cp-btn-primary"
                onClick={() => onOpenAuth('register')}
                style={{ width: '100%', padding: '11px 16px', fontSize: 13.5 }}
              >
                {lang === 'ko' ? 'Pro Engineer 시작하기' : 'Get Pro Engineer'}
              </button>
            </div>

            {/* Tier 3: Team / Enterprise */}
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
                Team / Enterprise
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  $79
                </span>
                <span style={{ fontSize: 12.5, color: '#64748B' }}>
                  {lang === 'ko' ? '/ 월 (5석 기준)' : '/ mo (up to 5 seats)'}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11.5,
                  color: '#475569',
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {lang === 'ko' ? '인당 월 $15.8 · 추가 좌석 맞춤 견적' : '$15.8 / seat · custom scaling available'}
              </div>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, marginBottom: 20 }}>
                {lang === 'ko'
                  ? 'EPC 프로젝트 팀 및 플랜트 공정기술팀을 위한 다중 좌석·권한 관리 플랜'
                  : 'Designed for EPC engineering teams and plant technical departments.'}
              </p>

              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  flex: 1,
                }}
              >
                {(lang === 'ko'
                  ? [
                      'Pro Engineer의 모든 기능 포함 (5석 기본 제공)',
                      '팀 공유 워크스페이스 및 프로젝트별 접근 제어(ACL)',
                      '법인카드 · 세금계산서 일괄 결제 및 통합 계정 관리',
                      '우선 기술 지원 및 신규 물성 · 공정 모델 우선 반영',
                    ]
                  : [
                      'Everything in Pro Engineer (5 seats included)',
                      'Shared team workspaces & project-level access control (ACL)',
                      'Consolidated corporate billing & seat administration',
                      'Priority engineering support & expedited property/process additions',
                    ]
                ).map((feat, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#1E293B' }}>
                    <span style={{ color: '#1E3A8A' }}>
                      <CheckMarkIcon size={14} />
                    </span>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="cp-btn-outline-light"
                onClick={() => onOpenAuth('login')}
                style={{ width: '100%', padding: '11px 16px', fontSize: 13.5 }}
              >
                {lang === 'ko' ? '팀 워크스페이스 문의 / 로그인' : 'Launch Team Workspace'}
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 26,
              textAlign: 'center',
              fontSize: 12.5,
              color: '#64748B',
            }}
          >
            {lang === 'ko' ? (
              <>
                모든 유료 구독은 <strong>14일 100% 환불 정책</strong>이 적용되며 언제든 해지할 수 있습니다. 결제·도입 문의:{' '}
                <a href="mailto:support@chemplantstudio.com" style={{ color: '#1E3A8A', fontWeight: 600 }}>
                  support@chemplantstudio.com
                </a>
              </>
            ) : (
              <>
                All paid subscriptions include a <strong>14-day full refund guarantee</strong> and can be canceled anytime. Billing &amp; licensing inquiries:{' '}
                <a href="mailto:support@chemplantstudio.com" style={{ color: '#1E3A8A', fontWeight: 600 }}>
                  support@chemplantstudio.com
                </a>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: '#0F172A',
          color: '#CBD5E1',
          borderTop: '1px solid #1E293B',
          padding: '44px 0 36px',
        }}
      >
        <div className="cp-container">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 28,
              paddingBottom: 28,
              borderBottom: '1px solid #1E293B',
            }}
          >
            <div style={{ maxWidth: 420 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <img
                  src="/icon-192-v2.png"
                  alt="ChemPlant Studio"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    objectFit: 'cover',
                    border: '1px solid #334155',
                  }}
                />
                <span style={{ fontSize: 15, fontWeight: 800, color: '#FFFFFF' }}>
                  ChemPlant Studio
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: '#94A3B8', lineHeight: 1.6, marginBottom: 10 }}>
                {lang === 'ko'
                  ? '화학공정 시뮬레이션, 열교환기 정밀검토, PSV/플레어 시스템 설계 및 공식 엔지니어링 데이터시트 플랫폼.'
                  : 'Web-native chemical process simulation, heat exchanger rating, PSV/flare design, and official engineering datasheet platform.'}
              </p>
              <a
                href="mailto:support@chemplantstudio.com"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                  color: '#E2E8F0',
                  textDecoration: 'none',
                }}
              >
                support@chemplantstudio.com
              </a>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 36 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    marginBottom: 4,
                  }}
                >
                  {lang === 'ko' ? 'PLATFORM' : 'PLATFORM'}
                </div>
                <button type="button" className="cp-footer-link" onClick={() => scrollToSection('features')}>
                  {lang === 'ko' ? '핵심 모듈' : 'Core Modules'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => scrollToSection('benchmarks')}>
                  {lang === 'ko' ? '검증 벤치마크' : 'Benchmarks'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => scrollToSection('pricing')}>
                  {lang === 'ko' ? '요금제' : 'Pricing'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => onOpenAuth('login')}>
                  {lang === 'ko' ? '워크스페이스 로그인' : 'Workspace Sign In'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    marginBottom: 4,
                  }}
                >
                  {lang === 'ko' ? 'LEGAL & POLICIES' : 'LEGAL & POLICIES'}
                </div>
                <button type="button" className="cp-footer-link" onClick={() => setActiveLegalDoc('terms')}>
                  {lang === 'ko' ? '이용약관 (Terms of Service)' : 'Terms of Service'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => setActiveLegalDoc('privacy')}>
                  {lang === 'ko' ? '개인정보처리방침 (Privacy Policy)' : 'Privacy Policy'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => setActiveLegalDoc('refund')}>
                  {lang === 'ko' ? '환불정책 (14일 전액 환불)' : 'Refund Policy (14-Day Full Refund)'}
                </button>
                <button type="button" className="cp-footer-link" onClick={() => setActiveLegalDoc('disclaimer')}>
                  {lang === 'ko' ? '엔지니어링 면책 고지' : 'Engineering Disclaimer'}
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              paddingTop: 20,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              fontSize: 12,
              color: '#64748B',
            }}
          >
            <span>© 2026 ChemPlant Studio. All rights reserved.</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>https://chemplantstudio.com</span>
          </div>
        </div>
      </footer>

      {/* Interactive Legal Modal */}
      {activeLegalDoc && legalContent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cp-legal-modal-title"
          onClick={() => setActiveLegalDoc(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            background: 'rgba(15, 23, 42, 0.76)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 640,
              maxHeight: '85vh',
              background: '#FFFFFF',
              borderRadius: 14,
              border: '1px solid #CBD5E1',
              boxShadow: '0 28px 70px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#0F172A',
                color: '#FFFFFF',
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderBottom: '1px solid #1E293B',
              }}
            >
              <div>
                <h3
                  id="cp-legal-modal-title"
                  style={{ fontSize: 16, fontWeight: 800, color: '#FFFFFF', marginBottom: 2 }}
                >
                  {legalContent.title}
                </h3>
                <div style={{ fontSize: 11.5, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>
                  {legalContent.updated}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActiveLegalDoc(null)}
                style={{
                  background: '#1E293B',
                  color: '#E2E8F0',
                  border: '1px solid #334155',
                  borderRadius: 7,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <CloseIcon size={15} />
              </button>
            </div>

            <div
              style={{
                padding: '22px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              {legalContent.sections.map((sec, idx) => (
                <div key={idx}>
                  <h4 style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
                    {sec.heading}
                  </h4>
                  <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.68 }}>
                    {sec.body}
                  </p>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: '14px 22px',
                background: '#F8FAFC',
                borderTop: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 11.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                support@chemplantstudio.com
              </span>
              <button
                type="button"
                className="cp-btn-primary"
                onClick={() => setActiveLegalDoc(null)}
                style={{ padding: '7px 16px', fontSize: 12.5 }}
              >
                {lang === 'ko' ? '닫기' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

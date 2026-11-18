import React from 'react';

export interface EngIconProps {
  size?: number;
  style?: React.CSSProperties;
}

function baseProps(size: number, style?: React.CSSProperties): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style },
  };
}

/** 플로우시트 공정 도면 (유입·블록 + 연결 스트림 + 증류/분리 컬럼) */
export function PfdSchematicIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="1.5" y="5" width="4" height="6" rx="0.9" />
      <rect x="10" y="2" width="4.5" height="12" rx="2" />
      <line x1="10" y1="6" x2="14.5" y2="6" />
      <line x1="10" y1="10" x2="14.5" y2="10" />
      <line x1="5.5" y1="8" x2="9.8" y2="8" />
      <polyline points="8.3,6.6 9.8,8 8.3,9.4" />
    </svg>
  );
}

/** 물질 수지 / 배관 스트림 흐름 */
export function StreamFlowIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <line x1="1.5" y1="5" x2="13" y2="5" />
      <polyline points="10.2,2.8 13,5 10.2,7.2" />
      <line x1="3" y1="11" x2="14.5" y2="11" />
      <polyline points="11.7,8.8 14.5,11 11.7,13.2" />
    </svg>
  );
}

/** 공정 장치 / 압력용기 · 타워 노즐 심볼 */
export function VesselEquipIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="4.5" y="2" width="7" height="12" rx="3" />
      <line x1="4.5" y1="6.2" x2="11.5" y2="6.2" />
      <line x1="4.5" y1="9.8" x2="11.5" y2="9.8" />
      <line x1="8" y1="0.8" x2="8" y2="2" />
      <line x1="1.8" y1="8" x2="4.5" y2="8" />
      <line x1="11.5" y1="5" x2="14.2" y2="5" />
    </svg>
  );
}

/** 화면 맞춤 (CAD 4코너 프레임) */
export function FitFrameIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <polyline points="2,5.5 2,2.2 5.3,2.2" />
      <polyline points="10.7,2.2 14,2.2 14,5.5" />
      <polyline points="14,10.5 14,13.8 10.7,13.8" />
      <polyline points="5.3,13.8 2,13.8 2,10.5" />
      <line x1="8" y1="6.2" x2="8" y2="9.8" />
      <line x1="6.2" y1="8" x2="9.8" y2="8" />
    </svg>
  );
}

/** 시뮬레이션 실행 삼각형 */
export function PlayTriangleIcon({ size = 10, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)} stroke="none" fill="currentColor">
      <polygon points="3.5,2 13.5,8 3.5,14" />
    </svg>
  );
}

/** 추가 / 새 케이스 플러스 */
export function PlusSquareIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="2" y="2" width="12" height="12" rx="2.2" />
      <line x1="8" y1="5" x2="8" y2="11" />
      <line x1="5" y1="8" x2="11" y2="8" />
    </svg>
  );
}

/** 화학 성분 · 열역학 · 물성 DB 삼각 플라스크 */
export function FlaskCompIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <line x1="5.8" y1="2" x2="10.2" y2="2" />
      <path d="M6.7 2v3.6L3 12.2A1.3 1.3 0 0 0 4.2 14h7.6a1.3 1.3 0 0 0 1.2-1.8L9.3 5.6V2" />
      <line x1="4.6" y1="10.4" x2="11.4" y2="10.4" />
    </svg>
  );
}

/** 목표역산 제어 / 설정점 루프 게이지 */
export function SpecControlIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <circle cx="8" cy="8" r="5.3" />
      <line x1="8" y1="1.2" x2="8" y2="3.2" />
      <line x1="8" y1="12.8" x2="8" y2="14.8" />
      <line x1="1.2" y1="8" x2="3.2" y2="8" />
      <line x1="12.8" y1="8" x2="14.8" y2="8" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 케이스 저장 심볼 */
export function SaveArchiveIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <path d="M3 2.2h8.2L13.8 4.8V13a.8.8 0 0 1-.8.8H3a.8.8 0 0 1-.8-.8V3a.8.8 0 0 1 .8-.8Z" />
      <polyline points="5.2,2.2 5.2,5.6 10.2,5.6 10.2,2.2" />
      <line x1="5" y1="9.8" x2="11" y2="9.8" />
      <line x1="5" y1="11.8" x2="9.5" y2="11.8" />
    </svg>
  );
}

/** 단품 숏컷 엔지니어링 계산기 */
export function CalcShortcutIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.6" />
      <line x1="4.8" y1="4.5" x2="11.2" y2="4.5" />
      <circle cx="5.3" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="10.7" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="5.3" cy="10.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="10.7" cy="10.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 참고 · 산출물 데이터시트 문서 */
export function DocSheetIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <path d="M3.5 1.8h6.1L13 5.2v8.2a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8V2.6a.8.8 0 0 1 .5-.8Z" />
      <polyline points="9.5,1.8 9.5,5.3 13,5.3" />
      <line x1="5.2" y1="8.2" x2="10.8" y2="8.2" />
      <line x1="5.2" y1="10.9" x2="9.2" y2="10.9" />
    </svg>
  );
}

/** 증류/회수 컬럼 & 응축 루프 (컬럼설계) */
export function ColumnInternalIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="4" y="2.2" width="5.5" height="11.6" rx="2.5" />
      <line x1="4" y1="5.8" x2="9.5" y2="5.8" />
      <line x1="4" y1="8.5" x2="9.5" y2="8.5" />
      <line x1="4" y1="11.2" x2="9.5" y2="11.2" />
      <polyline points="6.8,2.2 6.8,1.2 12.6,1.2 12.6,4.8 9.5,4.8" />
    </svg>
  );
}

/** P&ID 열교환기 심볼 (원형 쉘 + 전열 코일) */
export function HexCircleIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <circle cx="8" cy="8" r="5.6" />
      <polyline points="2.6,8 4.8,8 6.4,5.4 9.6,10.6 11.2,8 13.4,8" />
    </svg>
  );
}

/** 장치/배관 파라미터 조건 슬라이더 */
export function SlidersParamIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <line x1="2" y1="5" x2="14" y2="5" />
      <line x1="5.5" y1="3.2" x2="5.5" y2="6.8" />
      <line x1="2" y1="11" x2="14" y2="11" />
      <line x1="10.5" y1="9.2" x2="10.5" y2="12.8" />
    </svg>
  );
}

/** 계층형 세부공정 트리 */
export function SubprocessTreeIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="2" y="2" width="4.6" height="3.6" rx="0.8" />
      <polyline points="4.3,5.6 4.3,11.6 7.4,11.6" />
      <rect x="7.4" y="9.7" width="6.6" height="3.8" rx="0.8" />
    </svg>
  );
}

/** JSON / 케이스 파일 열기 */
export function FolderOpenIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <path d="M2 4.2a1 1 0 0 1 1-1h3.2l1.3 1.4H13a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.2Z" />
    </svg>
  );
}

/** 다운로드 / 내보내기 / 앱 설치 */
export function DownloadFileIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <line x1="8" y1="2.2" x2="8" y2="10.4" />
      <polyline points="5.2,7.8 8,10.6 10.8,7.8" />
      <path d="M2.5 11.4v1.6a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.6" />
    </svg>
  );
}

/** 사용자 계정 아이콘 */
export function UserOutlineIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <circle cx="8" cy="5.2" r="2.5" />
      <path d="M3 13.6c.6-2.4 2.6-3.6 5-3.6s4.4 1.2 5 3.6" />
    </svg>
  );
}

/** 표 보기 그리드 */
export function TableGridIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <line x1="2" y1="6.2" x2="14" y2="6.2" />
      <line x1="2" y1="9.8" x2="14" y2="9.8" />
      <line x1="6.5" y1="6.2" x2="6.5" y2="13.5" />
    </svg>
  );
}

/** 카드형 리스트 */
export function CardsStackIcon({ size = 13, style }: EngIconProps) {
  return (
    <svg {...baseProps(size, style)}>
      <rect x="2" y="2.2" width="12" height="4.8" rx="1" />
      <rect x="2" y="9" width="12" height="4.8" rx="1" />
    </svg>
  );
}

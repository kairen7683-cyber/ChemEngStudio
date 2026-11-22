import type { UnitQuantity, UnitPresetId } from '@/lib/units/unitSystem';
import type { TagStandardId } from '@/lib/units/tagNaming';

export type AppLang = 'ko' | 'en';

export const UI_TEXT = {
  // Header - Brand & Case Selector
  header_brand_title: {
    ko: '시뮬레이터 메인 화면으로 이동',
    en: 'Go to Simulator Home',
  },
  header_case_label: {
    ko: '케이스:',
    en: 'Case:',
  },
  header_my_cases: {
    ko: '내 케이스',
    en: 'My Cases',
  },
  header_default_workspace: {
    ko: '기본 작업공간',
    en: 'Default Workspace',
  },
  header_example_prefix: {
    ko: '[예제]',
    en: '[Example]',
  },
  header_case_trigger_title: {
    ko: '작업 케이스 또는 내장 예제 공장 열기',
    en: 'Open workspace case or reference plant',
  },
  header_case_trigger_title_sim_only: {
    ko: '작업 케이스 열기 및 관리',
    en: 'Open and manage workspace cases',
  },
  header_case_section_my: {
    ko: '내 작업 케이스',
    en: 'My Workspace Cases',
  },
  header_case_resume_default: {
    ko: '기본 시뮬레이터 작업공간 (이어하기)',
    en: 'Default Simulator Workspace (Resume)',
  },
  header_case_new_blank: {
    ko: '새 빈 시뮬레이션',
    en: 'New Blank Simulation',
  },
  header_case_import_json: {
    ko: 'JSON 케이스 파일 불러오기...',
    en: 'Import JSON Case...',
  },
  header_case_empty: {
    ko: '저장된 사용자 케이스가 없습니다.',
    en: 'No saved cases yet.',
  },
  header_case_delete_title: {
    ko: '저장 케이스 삭제',
    en: 'Delete saved case',
  },
  header_case_section_examples: {
    ko: '내장 예제 공장 (참고 케이스)',
    en: 'Built-in Example Plants (Reference)',
  },
  header_json_invalid: {
    ko: '유효한 시뮬레이션 JSON 파일이 아닙니다.',
    en: 'Invalid simulation JSON file.',
  },
  header_json_parse_error: {
    ko: 'JSON 파일을 해석하지 못했습니다.',
    en: 'Failed to parse JSON file.',
  },
  header_json_default_name: {
    ko: '불러온 케이스',
    en: 'Imported Case',
  },

  // Header - View Mode
  header_view_label: {
    ko: '보기:',
    en: 'View:',
  },
  header_view_title: {
    ko: '시뮬레이터 인터페이스 스타일 선택 (모던 UI / 클래식 UI)',
    en: 'Select simulator interface style (Modern UI / Classic UI)',
  },
  header_modern_ui: {
    ko: '모던 UI',
    en: 'Modern UI',
  },
  header_classic_ui: {
    ko: '클래식 UI',
    en: 'Classic UI',
  },

  // Header - Reference / Outputs Dropdown
  header_outputs_btn: {
    ko: '참고 · 산출물',
    en: 'Outputs',
  },
  header_outputs_title: {
    ko: '현재 컨텍스트의 참고 자료 및 산출물 화면 이동',
    en: 'Navigate to outputs, equipment sheets & reports',
  },
  header_outputs_heading: {
    ko: '참고 · 산출물 이동',
    en: 'References & Outputs',
  },
  header_tab_pfd: {
    ko: '① 시뮬레이터 도면',
    en: '① Flowsheet Simulator',
  },
  header_tab_design: {
    ko: '② 핵심장치 상세설계',
    en: '② Equipment Design',
  },
  header_tab_equip: {
    ko: '③ 장치목록',
    en: '③ Equipment List',
  },
  header_tab_econ: {
    ko: '④ 공정 경제성 · 원단위',
    en: '④ Process Economics',
  },
  header_psv_flare: {
    ko: 'PSV · 플레어 안전설계 (API 520/521)',
    en: 'PSV & Flare Safety (API 520/521)',
  },
  header_validation_report: {
    ko: '검증 리포트 (Golden Cases)',
    en: 'Validation Report (Golden Cases)',
  },

  // Header - Right Cluster Tools
  header_shortcut_calc: {
    ko: '단품 숏컷 계산기',
    en: 'Shortcut Calc',
  },
  header_shortcut_calc_title: {
    ko: '단품 장치 숏컷 설계 도구 (열교환기·펌프·컬럼·용기·배관·PSV)',
    en: 'Standalone Shortcut Equipment Calculators (HEX, Pump, Column, Vessel, Pipe, PSV)',
  },
  header_prop_db: {
    ko: '물성 · 열역학 DB',
    en: 'Property DB',
  },
  header_prop_db_title: {
    ko: '열역학 모델 · 순수·혼합물 물성 계산 DB',
    en: 'Thermodynamic Models & Pure/Mixture Property Database',
  },
  header_lang_toggle_title: {
    ko: '표시 언어 전환 (한국어 / English)',
    en: 'Switch Display Language (Korean / English)',
  },

  // Header - Aux 2nd Context Bar
  header_aux_shortcut: {
    ko: '단품 숏컷 설계 도구',
    en: 'Shortcut Equipment Design',
  },
  header_aux_prop_db: {
    ko: '물성 · 열역학 DB',
    en: 'Property & Thermo DB',
  },
  header_aux_econ: {
    ko: '공정 경제성 · 원단위',
    en: 'Process Economics',
  },
  header_aux_equip: {
    ko: '공장 장치목록',
    en: 'Equipment List',
  },
  header_aux_psv_flare: {
    ko: 'PSV · 플레어 안전설계',
    en: 'PSV & Flare Safety Design',
  },
  header_aux_design: {
    ko: '핵심장치 상세설계',
    en: 'Equipment Design',
  },
  header_aux_default: {
    ko: '보조 엔지니어링 도구',
    en: 'Engineering Tool',
  },
  header_return_to_sim: {
    ko: '← 시뮬레이터로 복귀',
    en: '← Back to Simulator',
  },

  // Unit & Tag Settings Modal
  unit_btn_prefix: {
    ko: '단위',
    en: 'Units',
  },
  unit_btn_custom: {
    ko: '사용자',
    en: 'Custom',
  },
  unit_btn_title: {
    ko: '기본 보기 단위 설정 (스트림 테이블 · 블록 입력 · 장치설계 전역 적용)',
    en: 'Global Display Units, Tag Standard & Language Settings',
  },
  unit_modal_title: {
    ko: '기본 보기 단위 · 장치 태그 · 언어 설정',
    en: 'Display Units · Equipment Tags · Language',
  },
  unit_modal_subtitle: {
    ko: '스트림 테이블 · 블록 입력 · 장치설계 단위계, 태그 표준 및 인터페이스 언어',
    en: 'Global unit system, EPC tag naming convention (KR/JP · Global) & UI language',
  },
  unit_modal_close: {
    ko: '닫기 ✕',
    en: 'Close ✕',
  },
  unit_modal_lang_heading: {
    ko: '인터페이스 언어 (Language)',
    en: 'Interface Language (언어)',
  },
  unit_modal_lang_ko_desc: {
    ko: '한국어 엔지니어링 UI · 용어 표시',
    en: 'Korean engineering interface & labels',
  },
  unit_modal_lang_en_desc: {
    ko: '영문 글로벌 엔지니어링 UI · 용어 표시',
    en: 'English global engineering interface & labels',
  },
  unit_modal_tag_heading: {
    ko: '장치 태그 명명 표준 (Equipment Tagging Standard)',
    en: 'Equipment Tagging Standard',
  },
  unit_modal_preset_heading: {
    ko: '단위계 프리셋 선택',
    en: 'Unit System Presets',
  },
  unit_modal_override_heading: {
    ko: '물리량별 기본 단위 개별 지정',
    en: 'Per-Quantity Unit Overrides',
  },
  unit_modal_custom_badge: {
    ko: '사용자 지정 단위계',
    en: 'Custom Unit System',
  },
  unit_modal_preset_badge_prefix: {
    ko: '프리셋:',
    en: 'Preset:',
  },
  unit_modal_footer_hint: {
    ko: '설정은 브라우저에 자동 저장되며, 각 테이블·입력칸에서 개별 단위를 임시 변경해 볼 수 있습니다.',
    en: 'Preferences are saved automatically in your browser. Individual fields can still be overridden locally.',
  },
  unit_modal_reset: {
    ko: '기본값(MKS) 복원',
    en: 'Reset Defaults (MKS)',
  },
  unit_modal_done: {
    ko: '적용 완료',
    en: 'Done',
  },

  // Horizontal Flowsheet Stream Table
  st_empty: {
    ko: '캔버스에서 장치 간 배관을 연결하면 전해 PFD와 동일한 가로 확장형 H&MB 스트림 시트가 자동 생성됩니다.',
    en: 'Connect streams between blocks on the canvas to automatically generate the horizontal H&MB stream table.',
  },
  st_col_item: {
    ko: '항목 (Property Item)',
    en: 'Property Item',
  },
  st_col_unit: {
    ko: '단위',
    en: 'Unit',
  },
  st_row_fluid: {
    ko: '유체 식별 (Fluid / Conc.)',
    en: 'Fluid / Conc.',
  },
  st_row_phase: {
    ko: 'Phase (상 상태)',
    en: 'Phase',
  },
  st_row_vf: {
    ko: 'Vapor Fraction (기상분율 β)',
    en: 'Vapor Fraction β',
  },
  st_row_temp: {
    ko: 'Temperature (온도)',
    en: 'Temperature',
  },
  st_row_press: {
    ko: 'Pressure (압력)',
    en: 'Pressure',
  },
  st_row_molar: {
    ko: 'Molar Flow (몰유량)',
    en: 'Molar Flow',
  },
  st_row_vol: {
    ko: 'Volume Flow (부피유량)',
    en: 'Volume Flow',
  },
  st_row_mw: {
    ko: 'Average MW (평균분자량)',
    en: 'Average MW',
  },
  st_row_density: {
    ko: 'Density (밀도 ρ)',
    en: 'Density ρ',
  },
  st_row_cp: {
    ko: 'Heat Capacity Cp (기상 Z)',
    en: 'Heat Capacity Cp (Z)',
  },
  st_row_enthalpy: {
    ko: 'Enthalpy Flow (엔탈피 유량)',
    en: 'Enthalpy Flow',
  },
  st_row_moisture: {
    ko: 'Moisture (가스 수분농도)',
    en: 'Moisture',
  },
  st_banner_comp_flows: {
    ko: '━ 성분별 질량 유량',
    en: '━ Component Mass Flows',
  },
  st_comp_toggle_title: {
    ko: '활성 성분(유량>0) / 프로젝트 설정 성분 / 등록 전체 성분을 순환 표시합니다',
    en: 'Cycle between Active (flow > 0), Configured, and All registered components',
  },
  st_row_total_mass: {
    ko: 'Total Mass Flow (총 질량유량)',
    en: 'Total Mass Flow',
  },
} as const;

export type UiTextKey = keyof typeof UI_TEXT;

export function t(lang: AppLang, key: UiTextKey): string {
  return UI_TEXT[key][lang];
}

export const QUANTITY_LABELS_EN: Record<UnitQuantity, string> = {
  temp: 'Temperature',
  pressG: 'Pressure',
  deltaP: 'Pressure Drop (ΔP)',
  massFlow: 'Mass Flow',
  molarFlow: 'Molar Flow',
  volFlow: 'Volume Flow',
  density: 'Density',
  cp: 'Heat Capacity (Cp)',
  heatDuty: 'Heat Duty',
  power: 'Shaft / Electric Power',
  htc: 'Heat Transfer Coeff. (U)',
  fouling: 'Fouling Factor (Rf)',
  area: 'Area',
  volume: 'Volume',
  length: 'Length / Diameter',
  velocity: 'Velocity',
  viscosity: 'Viscosity',
};

export const UNIT_PRESET_NAMES_EN: Record<Exclude<UnitPresetId, 'CUSTOM'>, string> = {
  METRIC_ENG: 'Metric Eng / MKS (Default)',
  SI: 'SI Standard (barA · kW)',
  SI_BARG: 'SI Plant (barG · t/h)',
  US_FIELD: 'US / Field (°F · psig)',
};

export const TAG_STANDARD_TEXT_EN: Record<TagStandardId, { name: string; desc: string }> = {
  KR_JP: {
    name: 'Korea / Japan EPC (Default)',
    desc: 'R Reactor · T Tower/Column · C Compressor · D Drum · TK Tank · A Agitator',
  },
  GLOBAL_US: {
    name: 'US / Global EPC',
    desc: 'R Reactor · C Column · K Compressor · V Drum/Vessel · TK Tank · M Agitator',
  },
};

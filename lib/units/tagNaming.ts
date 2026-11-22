export type TagStandardId = 'KR_JP' | 'GLOBAL_US';

export interface TagStandardDef {
  id: TagStandardId;
  name: string;
  shortName: string;
  desc: string;
}

export const TAG_STANDARDS: TagStandardDef[] = [
  {
    id: 'KR_JP',
    name: '한국·일본 EPC (기본)',
    shortName: 'T·C·D',
    desc: 'R 반응기 · T 타워/컬럼 · C 압축기 · D 드럼 · TK 탱크 · A 교반기',
  },
  {
    id: 'GLOBAL_US',
    name: '미국·글로벌 EPC',
    shortName: 'C·K·V',
    desc: 'R 반응기 · C 컬럼 · K 압축기 · V 드럼/용기 · TK 탱크 · M 교반기',
  },
];

export const DEFAULT_TAG_STANDARD: TagStandardId = 'KR_JP';

/**
 * 팔레트에서 새 장치를 추가할 때 표준에 맞는 기본 태그 접두어를 반환합니다.
 */
export function getDefaultTagPrefix(unitType: string, standard: TagStandardId = DEFAULT_TAG_STANDARD): string {
  switch (unitType) {
    case 'reactor':
      return 'R';
    case 'distillation':
    case 'absorber':
    case 'extractor':
    case 'chelate_tower':
    case 'desiccant_dryer':
    case 'column':
      return standard === 'KR_JP' ? 'T' : 'C';
    case 'compressor':
      return standard === 'KR_JP' ? 'C' : 'K';
    case 'separator':
    case 'h_drum_visual':
    case 'saturator':
    case 'vessel':
      return standard === 'KR_JP' ? 'D' : 'V';
    case 'tank_visual':
    case 'tank':
      return 'TK';
    case 'mixer':
    case 'agitator':
      return standard === 'KR_JP' ? 'A' : 'M';
    case 'hex':
    case 'cooler':
    case 'liquefier':
      return 'E';
    case 'evaporator':
      return 'EV';
    case 'pump':
      return 'P';
    case 'valve':
      return 'CV';
    case 'splitter':
      return 'SP';
    case 'electrolyzer':
      return 'EL';
    case 'feed':
      return 'FEED';
    case 'product':
      return 'PROD';
    default:
      return 'U';
  }
}

const COLUMN_TYPES = new Set(['distillation', 'absorber', 'extractor', 'chelate_tower', 'desiccant_dryer', 'column']);
const COMPRESSOR_TYPES = new Set(['compressor']);
const DRUM_TYPES = new Set(['separator', 'h_drum_visual', 'vessel']);
const TANK_TYPES = new Set(['tank_visual', 'tank']);
const MIXER_TYPES = new Set(['mixer', 'agitator']);

/**
 * 기존 장치 태그(예: C-401, K-410, S-101, M-210 등)를 사용자가 선택한 태그 명명 표준에 맞춰 변환합니다.
 * 사용자 커스텀 이름이나 FEED/PROD/SEC 태그는 건드리지 않고 표준 접두어+번호 패턴만 안전하게 치환합니다.
 */
export function formatEquipmentTag(
  tag: string,
  unitType: string | undefined,
  standard: TagStandardId = DEFAULT_TAG_STANDARD
): string {
  if (!tag || !unitType) return tag;
  const m = /^([A-Z]{1,3})(-?\d.*)$/.exec(tag.trim());
  if (!m) return tag;
  const [, prefix, rest] = m;

  if (COLUMN_TYPES.has(unitType)) {
    if (prefix === 'C' || prefix === 'T') {
      return `${standard === 'KR_JP' ? 'T' : 'C'}${rest}`;
    }
    return tag;
  }
  if (COMPRESSOR_TYPES.has(unitType)) {
    if (prefix === 'K' || prefix === 'C' || prefix === 'CMP') {
      return `${standard === 'KR_JP' ? 'C' : 'K'}${rest}`;
    }
    return tag;
  }
  if (DRUM_TYPES.has(unitType)) {
    if (prefix === 'D' || prefix === 'V' || prefix === 'S') {
      return `${standard === 'KR_JP' ? 'D' : 'V'}${rest}`;
    }
    return tag;
  }
  if (TANK_TYPES.has(unitType)) {
    if (prefix === 'T' || prefix === 'TK' || prefix === 'D') {
      return `TK${rest}`;
    }
    return tag;
  }
  if (MIXER_TYPES.has(unitType)) {
    if (prefix === 'M' || prefix === 'A' || prefix === 'MIX') {
      return `${standard === 'KR_JP' ? 'A' : 'M'}${rest}`;
    }
    return tag;
  }
  return tag;
}

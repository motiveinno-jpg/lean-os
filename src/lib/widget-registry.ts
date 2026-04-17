/**
 * Widget Registry — 위젯 정의 + 역할 프리셋 + 상황별 뷰
 * 대시보드 위젯 ID, 기본 설정, 프리셋 뷰 4개, 역할 프리셋 4개
 */

export type WidgetId =
  | 'cash_pulse'
  | 'approval_center'
  | 'today_actions'
  | 'risk_zone'
  | 'growth_tracking'
  | 'financial_overview'
  | 'closing_checklist'
  | 'automation_status'
  | 'scenario_simulator'
  | 'overdue_receivables'
  | 'burn_rate_trend'
;

export interface WidgetDef {
  id: WidgetId;
  name: string;
  description: string;
  category: 'cash' | 'deal' | 'tax' | 'ops';
  defaultVisible: boolean;
  defaultOrder: number;
}

export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'cash_pulse',        name: '현금 펄스',     description: 'D+7~90 현금 예측과 브리핑',      category: 'cash', defaultVisible: true,  defaultOrder: 0 },
  { id: 'approval_center',   name: '승인센터',      description: '결재 대기 건 목록과 일괄 승인',   category: 'ops',  defaultVisible: true,  defaultOrder: 1 },
  { id: 'today_actions',     name: '오늘의 액션',   description: '오늘 처리해야 할 항목',           category: 'ops',  defaultVisible: true,  defaultOrder: 2 },
  { id: 'risk_zone',         name: '위험 구역',     description: '마진·마감·미수금·외주비 위험 감지', category: 'deal', defaultVisible: true,  defaultOrder: 3 },
  { id: 'growth_tracking',   name: '성장 영역',     description: '월/분기/연 매출 목표 진행률',     category: 'deal', defaultVisible: true,  defaultOrder: 4 },
  { id: 'financial_overview', name: '재무 현황',    description: '월별 수입/지출 차트와 드릴다운',   category: 'cash', defaultVisible: false, defaultOrder: 5 },
  { id: 'closing_checklist', name: '월 마감',       description: '월 마감 체크리스트',              category: 'tax',  defaultVisible: false, defaultOrder: 6 },
  { id: 'automation_status', name: '자동화 엔진',   description: '15개 자동화 실행 상태',           category: 'ops',  defaultVisible: false, defaultOrder: 7 },
  { id: 'scenario_simulator', name: '시나리오 시뮬레이터', description: 'What-if 런웨이 시뮬레이션', category: 'cash', defaultVisible: false, defaultOrder: 8 },
  { id: 'overdue_receivables', name: '미수금 현황', description: '미수금/연체 상세 현황', category: 'cash', defaultVisible: false, defaultOrder: 9 },
  { id: 'burn_rate_trend', name: '번레이트 추이', description: '월별 지출 추이와 런웨이 변화', category: 'cash', defaultVisible: false, defaultOrder: 10 },
];

// ── Widget config per view ──
export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

// ── Preset views (상황별) ──
export interface PresetView {
  id: string;
  name: string;
  widgets: WidgetConfig[];
}

function makeConfigs(visibleIds: WidgetId[]): WidgetConfig[] {
  return WIDGET_REGISTRY.map((w, i) => ({
    id: w.id,
    visible: visibleIds.includes(w.id),
    order: i,
  }));
}

export const PRESET_VIEWS: PresetView[] = [
  {
    id: 'default',
    name: '기본 뷰',
    widgets: makeConfigs([
      'cash_pulse', 'approval_center', 'today_actions',
      'risk_zone', 'growth_tracking',
    ]),
  },
  {
    id: 'crisis',
    name: '위기 모드',
    widgets: makeConfigs([
      'cash_pulse', 'scenario_simulator', 'risk_zone',
      'overdue_receivables', 'burn_rate_trend',
      'today_actions', 'approval_center',
    ]),
  },
  {
    id: 'monthend',
    name: '월말 마감',
    widgets: makeConfigs([
      'financial_overview', 'closing_checklist', 'automation_status',
    ]),
  },
  {
    id: 'sales',
    name: '영업 집중',
    widgets: makeConfigs([
      'growth_tracking', 'risk_zone', 'today_actions', 'approval_center',
    ]),
  },
];

// ── 역할 프리셋 (Role-based defaults) ──
export type RolePreset = 'ceo' | 'accounting' | 'hr' | 'sales';

export interface RolePresetDef {
  id: RolePreset;
  label: string;
  description: string;
  icon: string;
  defaultWidgets: WidgetId[];
}

export const ROLE_PRESETS: RolePresetDef[] = [
  {
    id: 'ceo',
    label: '경영/의사결정',
    description: '대표이사, 경영자 — 핵심 KPI와 현금흐름 중심',
    icon: '👔',
    defaultWidgets: [
      'cash_pulse', 'approval_center', 'today_actions',
      'risk_zone', 'growth_tracking',
    ],
  },
  {
    id: 'accounting',
    label: '회계/재무',
    description: '회계담당자, CFO — 거래내역과 마감 중심',
    icon: '🧮',
    defaultWidgets: [
      'cash_pulse', 'financial_overview', 'closing_checklist',
      'overdue_receivables', 'burn_rate_trend', 'automation_status',
    ],
  },
  {
    id: 'hr',
    label: '인사/총무',
    description: '인사담당자, 총무 — 승인과 일정 중심',
    icon: '📋',
    defaultWidgets: [
      'approval_center', 'today_actions',
    ],
  },
  {
    id: 'sales',
    label: '영업/프로젝트',
    description: '영업담당자, PM — 딜과 성장 중심',
    icon: '🎯',
    defaultWidgets: [
      'growth_tracking', 'risk_zone', 'today_actions', 'approval_center',
    ],
  },
];

/** 역할 프리셋으로부터 위젯 설정 생성 */
export function makeRolePresetConfigs(roleId: RolePreset): WidgetConfig[] {
  const preset = ROLE_PRESETS.find(r => r.id === roleId);
  const visibleIds = preset?.defaultWidgets || ROLE_PRESETS[0].defaultWidgets;
  return makeConfigs(visibleIds);
}

// ── Default config ──
export function getDefaultWidgets(): WidgetConfig[] {
  return WIDGET_REGISTRY.map(w => ({
    id: w.id,
    visible: w.defaultVisible,
    order: w.defaultOrder,
  }));
}

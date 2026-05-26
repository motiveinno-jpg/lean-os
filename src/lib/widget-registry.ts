/**
 * Widget Registry — 위젯 정의 + 역할 프리셋 + 상황별 뷰
 * 대시보드(대표 뷰) 위젯 ID, 기본 설정, 프리셋 뷰 4개, 역할 프리셋 4개
 *
 * 2026-05-26 토글↔렌더 정합 (사장님 요청 "체크해도 안 나오는 거 없애줘"):
 *   대표 대시보드(owner 뷰)에 실제 렌더 분기가 있는 위젯만 등록 → 설정 체크박스 = 화면 1:1.
 *   제거: cash_pulse·approval_center·today_actions·risk_zone·closing_checklist·my_attendance·
 *         my_approvals (owner 뷰 렌더 분기 0 — 일부는 admin 뷰 고정 영역에만 존재) + scenario_simulator.
 *   admin/employee/partner 대시보드의 고정 위젯은 이 레지스트리와 무관(영향 없음).
 */

export type WidgetId =
  | 'summary_kpis'
  | 'quick_nav'
  | 'my_todos'
  | 'growth_tracking'
  | 'overdue_receivables'
  | 'burn_rate_trend'
  | 'financial_overview'
  | 'automation_status'
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
  { id: 'summary_kpis',        name: '요약 위젯',   description: '승인대기·통장잔고·미수금·월고정비 한눈에', category: 'ops',  defaultVisible: true,  defaultOrder: 0 },
  { id: 'quick_nav',           name: '빠른 이동',   description: '자주 가는 메뉴 바로가기',                category: 'ops',  defaultVisible: true,  defaultOrder: 1 },
  { id: 'my_todos',            name: '내 할일',     description: '할일에 추가한 항목 (마감 임박 우선)',     category: 'ops',  defaultVisible: true,  defaultOrder: 2 },
  { id: 'growth_tracking',     name: '성장 영역',   description: '월/분기/연 매출 목표 진행률',            category: 'deal', defaultVisible: true,  defaultOrder: 3 },
  { id: 'overdue_receivables', name: '미수금 현황', description: '미수금/연체 상세 현황',                  category: 'cash', defaultVisible: false, defaultOrder: 4 },
  { id: 'burn_rate_trend',     name: '번레이트 추이', description: '월별 지출 추이와 런웨이 변화',         category: 'cash', defaultVisible: false, defaultOrder: 5 },
  { id: 'financial_overview',  name: '재무 현황',   description: '월별 수입/지출 차트와 드릴다운',          category: 'cash', defaultVisible: false, defaultOrder: 6 },
  { id: 'automation_status',   name: '자동화 엔진', description: '15개 자동화 실행 상태',                 category: 'ops',  defaultVisible: false, defaultOrder: 7 },
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
      'summary_kpis', 'quick_nav', 'my_todos', 'growth_tracking',
    ]),
  },
  {
    id: 'crisis',
    name: '위기 모드',
    widgets: makeConfigs([
      'summary_kpis', 'overdue_receivables', 'burn_rate_trend',
    ]),
  },
  {
    id: 'monthend',
    name: '월말 마감',
    widgets: makeConfigs([
      'financial_overview', 'automation_status',
    ]),
  },
  {
    id: 'sales',
    name: '영업 집중',
    widgets: makeConfigs([
      'summary_kpis', 'growth_tracking',
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
      'summary_kpis', 'quick_nav', 'my_todos', 'growth_tracking',
    ],
  },
  {
    id: 'accounting',
    label: '회계/재무',
    description: '회계담당자, CFO — 거래내역과 마감 중심',
    icon: '🧮',
    defaultWidgets: [
      'financial_overview', 'overdue_receivables', 'burn_rate_trend', 'automation_status',
    ],
  },
  {
    id: 'hr',
    label: '인사/총무',
    description: '인사담당자, 총무 — 요약과 할 일 중심',
    icon: '📋',
    defaultWidgets: [
      'summary_kpis', 'quick_nav', 'my_todos',
    ],
  },
  {
    id: 'sales',
    label: '영업/프로젝트',
    description: '영업담당자, PM — 딜과 성장 중심',
    icon: '🎯',
    defaultWidgets: [
      'summary_kpis', 'growth_tracking',
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

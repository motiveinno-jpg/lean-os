/**
 * Widget Registry — 위젯 정의 + 프리셋 뷰
 * 대시보드 위젯 ID, 기본 설정, 프리셋 뷰 4개
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
  | 'ai_insights';

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
  { id: 'ai_insights',       name: 'AI 인사이트',   description: 'AI 대시보드 분석 요약',           category: 'ops',  defaultVisible: false, defaultOrder: 8 },
];

// ── Widget config per view ──
export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

// ── Preset views ──
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
      'cash_pulse', 'approval_center', 'today_actions', 'risk_zone',
    ]),
  },
  {
    id: 'monthend',
    name: '월말 마감',
    widgets: makeConfigs([
      'financial_overview', 'closing_checklist', 'automation_status', 'ai_insights',
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

// ── Default config ──
export function getDefaultWidgets(): WidgetConfig[] {
  return WIDGET_REGISTRY.map(w => ({
    id: w.id,
    visible: w.defaultVisible,
    order: w.defaultOrder,
  }));
}

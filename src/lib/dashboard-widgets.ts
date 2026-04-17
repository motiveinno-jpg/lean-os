/**
 * OwnerView Dashboard Widget System
 * 역할별 프리셋 + 위젯 토글 + 레이아웃 저장/로드
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export type RolePreset = 'ceo' | 'accounting' | 'hr' | 'sales';

export interface WidgetConfig {
  visible: boolean;
  order: number;
}

export interface DashboardLayout {
  [widgetId: string]: WidgetConfig;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  company_id: string;
  role_preset: RolePreset;
  dashboard_widgets: DashboardLayout;
  pinned_pages: string[];
  sidebar_collapsed: boolean;
}

export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  icon: string;
  size: 'small' | 'medium' | 'large';  // grid column span hint
  module: string;  // for permission check
}

// ── Widget Registry ──

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  { id: 'kpi_cash', label: '현금 보유액', description: '현재 현금 잔액 및 변동', icon: '💰', size: 'small', module: 'dashboard' },
  { id: 'kpi_revenue', label: '월 매출', description: '이번 달 매출 현황', icon: '📈', size: 'small', module: 'dashboard' },
  { id: 'kpi_expenses', label: '월 지출', description: '이번 달 비용 현황', icon: '📉', size: 'small', module: 'dashboard' },
  { id: 'kpi_runway', label: '생존 개월', description: '현금으로 버틸 수 있는 개월 수', icon: '⏳', size: 'small', module: 'dashboard' },
  { id: 'kpi_deals', label: '진행중 딜', description: '파이프라인 내 활성 딜 수', icon: '🤝', size: 'small', module: 'deals' },
  { id: 'kpi_employees', label: '구성원 수', description: '재직 중 구성원 현황', icon: '👥', size: 'small', module: 'hr' },
  { id: 'deal_pipeline', label: '딜 파이프라인', description: '단계별 딜 현황 차트', icon: '📊', size: 'large', module: 'deals' },
  { id: 'recent_transactions', label: '최근 거래내역', description: '최근 입출금 내역', icon: '💳', size: 'medium', module: 'accounting' },
  { id: 'receivables', label: '미수금 현황', description: '미수금/미지급 요약', icon: '📋', size: 'medium', module: 'accounting' },
  { id: 'invoice_unmatched', label: '세금계산서 미매칭', description: '매칭 필요한 세금계산서', icon: '📄', size: 'medium', module: 'invoices' },
  { id: 'payroll_summary', label: '급여 요약', description: '이번 달 급여 총액/예정일', icon: '💵', size: 'medium', module: 'payroll' },
  { id: 'attendance_summary', label: '근태 현황', description: '오늘 출근/결근/휴가 현황', icon: '⏰', size: 'medium', module: 'attendance' },
  { id: 'contract_expiry', label: '계약 만료 알림', description: '30일 내 만료 예정 계약', icon: '📝', size: 'medium', module: 'documents' },
  { id: 'pending_approvals', label: '결재 대기', description: '승인 대기 중인 건', icon: '✅', size: 'small', module: 'deals' },
  { id: 'recent_chat', label: '최근 채팅', description: '읽지 않은 메시지', icon: '💬', size: 'medium', module: 'chat' },
  { id: 'cash_flow_chart', label: '현금 흐름 추이', description: '월별 현금 흐름 차트', icon: '📉', size: 'large', module: 'accounting' },
  { id: 'quick_actions', label: '빠른 작업', description: '자주 쓰는 기능 바로가기', icon: '⚡', size: 'medium', module: 'dashboard' },
];

// ── Role Presets ──

export const ROLE_PRESETS: Record<RolePreset, { label: string; description: string; icon: string; widgets: string[] }> = {
  ceo: {
    label: '경영/의사결정',
    description: '대표이사, 경영자 — 핵심 KPI와 현금흐름 중심',
    icon: '👔',
    widgets: [
      'kpi_cash', 'kpi_revenue', 'kpi_expenses', 'kpi_runway', 'kpi_deals', 'kpi_employees',
      'deal_pipeline', 'receivables', 'cash_flow_chart', 'pending_approvals', 'quick_actions',
    ],
  },
  accounting: {
    label: '회계/재무',
    description: '회계담당자, CFO — 거래내역과 세금 중심',
    icon: '🧮',
    widgets: [
      'kpi_cash', 'kpi_revenue', 'kpi_expenses', 'kpi_runway',
      'recent_transactions', 'receivables', 'invoice_unmatched', 'payroll_summary',
      'cash_flow_chart', 'pending_approvals',
    ],
  },
  hr: {
    label: '인사/총무',
    description: '인사담당자, 총무 — 구성원과 근태 중심',
    icon: '📋',
    widgets: [
      'kpi_employees', 'kpi_deals',
      'attendance_summary', 'payroll_summary', 'contract_expiry',
      'pending_approvals', 'recent_chat', 'quick_actions',
    ],
  },
  sales: {
    label: '영업/프로젝트',
    description: '영업담당자, PM — 딜과 거래처 중심',
    icon: '🎯',
    widgets: [
      'kpi_deals', 'kpi_revenue',
      'deal_pipeline', 'receivables', 'contract_expiry',
      'recent_chat', 'quick_actions', 'pending_approvals',
    ],
  },
};

// ── Helpers ──

/** 프리셋에서 기본 레이아웃 생성 */
export function buildDefaultLayout(preset: RolePreset): DashboardLayout {
  const presetWidgets = ROLE_PRESETS[preset]?.widgets || ROLE_PRESETS.ceo.widgets;
  const layout: DashboardLayout = {};

  WIDGET_DEFINITIONS.forEach((w, idx) => {
    layout[w.id] = {
      visible: presetWidgets.includes(w.id),
      order: presetWidgets.indexOf(w.id) >= 0 ? presetWidgets.indexOf(w.id) : 100 + idx,
    };
  });

  return layout;
}

/** 보이는 위젯만 정렬해서 반환 */
export function getVisibleWidgets(layout: DashboardLayout): WidgetDefinition[] {
  return WIDGET_DEFINITIONS
    .filter((w) => layout[w.id]?.visible !== false)
    .sort((a, b) => (layout[a.id]?.order ?? 99) - (layout[b.id]?.order ?? 99));
}

// ── DB Operations ──

/** 사용자 환경설정 로드 (없으면 생성) */
export async function loadUserPreferences(
  userId: string,
  companyId: string,
): Promise<UserPreferences> {
  const { data, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .single();

  if (data) return data as UserPreferences;

  // 신규 유저: 기본 프리셋으로 생성
  const defaultPreset: RolePreset = 'ceo';
  const defaultLayout = buildDefaultLayout(defaultPreset);

  const { data: created, error: createError } = await db
    .from('user_preferences')
    .insert({
      user_id: userId,
      company_id: companyId,
      role_preset: defaultPreset,
      dashboard_widgets: defaultLayout,
      pinned_pages: [],
    })
    .select()
    .single();

  if (createError) {
    // 동시 생성 충돌 시 재조회
    const { data: retry } = await db
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .single();
    if (retry) return retry as UserPreferences;
    throw createError;
  }

  return created as UserPreferences;
}

/** 대시보드 위젯 레이아웃 저장 */
export async function saveDashboardLayout(
  userId: string,
  companyId: string,
  widgets: DashboardLayout,
): Promise<void> {
  const { error } = await db
    .from('user_preferences')
    .update({
      dashboard_widgets: widgets,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (error) throw error;
}

/** 역할 프리셋 변경 (위젯 레이아웃 초기화) */
export async function changeRolePreset(
  userId: string,
  companyId: string,
  preset: RolePreset,
): Promise<DashboardLayout> {
  const layout = buildDefaultLayout(preset);

  const { error } = await db
    .from('user_preferences')
    .update({
      role_preset: preset,
      dashboard_widgets: layout,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (error) throw error;
  return layout;
}

/** 위젯 하나 토글 */
export async function toggleWidget(
  userId: string,
  companyId: string,
  currentLayout: DashboardLayout,
  widgetId: string,
): Promise<DashboardLayout> {
  const newLayout = { ...currentLayout };
  if (!newLayout[widgetId]) {
    newLayout[widgetId] = { visible: true, order: Object.keys(newLayout).length };
  } else {
    newLayout[widgetId] = { ...newLayout[widgetId], visible: !newLayout[widgetId].visible };
  }
  await saveDashboardLayout(userId, companyId, newLayout);
  return newLayout;
}

/** 핀 고정 페이지 토글 */
export async function togglePinnedPage(
  userId: string,
  companyId: string,
  currentPins: string[],
  path: string,
): Promise<string[]> {
  const newPins = currentPins.includes(path)
    ? currentPins.filter((p) => p !== path)
    : [...currentPins, path];

  const { error } = await db
    .from('user_preferences')
    .update({
      pinned_pages: newPins,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (error) throw error;
  return newPins;
}

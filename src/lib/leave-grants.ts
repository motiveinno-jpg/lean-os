import { supabase } from '@/lib/supabase';
import { logRead } from '@/lib/log-read';
import { initLeaveBalance } from '@/lib/hr';

// 연차 발생(부여) 이력 — leave_balances 는 연도별 합계 1행이라 "몇 월 며칠에 몇 개 발생"을 못 남긴다.
//   leave_grants 에 발생 건을 날짜별로 쌓고, leave_balances.total_days 는 항상 그 합계로 동기화한다.
//   (총 부여일수의 단일 출처 = grants 합계. 화면에서 직접 total 을 쓰지 말 것.)

const db = supabase as any;

export type LeaveGrantType = 'base' | 'monthly' | 'annual' | 'carryover' | 'adjustment';

export type LeaveGrant = {
  id: string;
  company_id: string;
  employee_id: string;
  year: number;
  grant_date: string;
  days: number;
  grant_type: LeaveGrantType;
  memo: string | null;
  created_at: string;
};

export const GRANT_TYPE_LABELS: Record<LeaveGrantType, string> = {
  base: '연차 부여',
  monthly: '월 발생',
  annual: '1주년 부여',
  carryover: '이월',
  adjustment: '조정',
};

// ── 연차 자동 발생 설정 ──
//   company_settings.settings JSONB 에 저장(스키마 변경 아님, leave_grant_method 와 동일 패턴).
//   실제 발생은 DB 함수 generate_leave_accruals() 를 pg_cron('leave-accrual') 이 매일 KST 00:10 에 실행:
//     · 1년 미만 — 입사 응당일마다 1일 (최대 11일)
//     · 1주년부터 — 근속연수별 법정 연차 (1~2년 15일, 3년 이상 2년마다 +1일, 상한 25일)
//   ⚠️ 기본값은 '켬' — settings 에 'false' 로 명시한 회사만 자동 발생에서 빠진다(DB 함수와 동일 규칙).
//      과거엔 'true' 를 켠 회사만 대상이라 실제로는 어느 회사도 자동 발생이 안 됐다(2026-07-30 교정).

export type MonthlyAccrualBasis = 'hire' | 'fiscal';
export type MonthlyAccrualSettings = { enabled: boolean; basis: MonthlyAccrualBasis };

export const ACCRUAL_BASIS_LABELS: Record<MonthlyAccrualBasis, { label: string; desc: string }> = {
  hire: { label: '입사일 기준', desc: '입사 응당일마다 발생 (3/15 입사 → 4/15, 5/15 …)' },
  fiscal: { label: '회계연도 기준', desc: '입사 다음 달부터 매월 1일 발생' },
};

export async function getMonthlyAccrualSettings(companyId: string): Promise<MonthlyAccrualSettings> {
  const data = logRead('lib/leave-grants:accrual', await db
    .from('company_settings')
    .select('settings')
    .eq('company_id', companyId)
    .maybeSingle());
  const s = (data?.settings as Record<string, unknown> | null) || {};
  return {
    // 설정이 없으면 켬 — 끈 회사만 'false' 로 남는다.
    enabled: s.monthly_leave_accrual_enabled !== 'false' && s.monthly_leave_accrual_enabled !== false,
    basis: s.monthly_leave_accrual_basis === 'fiscal' ? 'fiscal' : 'hire',
  };
}

/** 기존 settings JSONB 의 다른 키를 보존하며 저장. */
export async function setMonthlyAccrualSettings(companyId: string, next: MonthlyAccrualSettings): Promise<void> {
  const existing = logRead('lib/leave-grants:accrual-existing', await db
    .from('company_settings')
    .select('settings')
    .eq('company_id', companyId)
    .maybeSingle());
  const nextSettings = {
    ...((existing?.settings as Record<string, unknown> | null) || {}),
    // DB 함수가 settings->>'...' 텍스트로 비교하므로 문자열로 저장한다.
    monthly_leave_accrual_enabled: next.enabled ? 'true' : 'false',
    monthly_leave_accrual_basis: next.basis,
  };
  const { error } = await db
    .from('company_settings')
    .upsert({ company_id: companyId, settings: nextSettings }, { onConflict: 'company_id' });
  if (error) throw error;
}

/** 관리자 "지금 반영" — 누락된 발생분(월 1일 + 1주년)을 즉시 생성. 본인 회사만(RPC 안에서 권한 검사). */
export async function syncLeaveAccruals(): Promise<number> {
  const { data, error } = await db.rpc('sync_my_leave_accruals');
  if (error) throw error;
  return Number(data || 0);
}

// ── 조회 ──
export async function listLeaveGrants(employeeId: string, year?: number): Promise<LeaveGrant[]> {
  let q = db.from('leave_grants').select('*').eq('employee_id', employeeId);
  if (year !== undefined) q = q.eq('year', year);
  const data = logRead('lib/leave-grants:list', await q.order('grant_date', { ascending: true }));
  return (data || []) as LeaveGrant[];
}

// ── leave_balances.total_days 를 grants 합계로 맞춘다 ──
export async function syncLeaveBalanceTotal(companyId: string, employeeId: string, year: number): Promise<number> {
  const rows = logRead('lib/leave-grants:sync', await db
    .from('leave_grants')
    .select('days')
    .eq('employee_id', employeeId)
    .eq('year', year));
  const total = Math.round(((rows || []).reduce((s: number, r: any) => s + Number(r.days || 0), 0)) * 10) / 10;
  await initLeaveBalance(companyId, employeeId, year, total);
  return total;
}

// ── 발생 1건 추가 ──
export async function addLeaveGrant(params: {
  companyId: string;
  employeeId: string;
  grantDate: string;              // 'YYYY-MM-DD'
  days: number;
  grantType?: LeaveGrantType;
  memo?: string;
  createdBy?: string | null;
}): Promise<void> {
  const year = Number(params.grantDate.slice(0, 4));
  const { error } = await db.from('leave_grants').insert({
    company_id: params.companyId,
    employee_id: params.employeeId,
    year,
    grant_date: params.grantDate,
    days: params.days,
    grant_type: params.grantType || 'adjustment',
    memo: params.memo || null,
    created_by: params.createdBy || null,
  });
  if (error) throw error;
  await syncLeaveBalanceTotal(params.companyId, params.employeeId, year);
}

// ── 발생 1건 삭제 ──
export async function deleteLeaveGrant(grant: Pick<LeaveGrant, 'id' | 'company_id' | 'employee_id' | 'year'>): Promise<void> {
  const { error } = await db.from('leave_grants').delete().eq('id', grant.id);
  if (error) throw error;
  await syncLeaveBalanceTotal(grant.company_id, grant.employee_id, grant.year);
}

// ── 그 해 기본 부여일수 설정 — 기존 'base' 발생을 대체하고 합계를 다시 맞춘다 ──
//   (관리자 화면의 "총 부여일수 설정" 진입점. 월 발생·이월·조정 건은 건드리지 않는다.)
export async function setBaseLeaveGrant(params: {
  companyId: string;
  employeeId: string;
  year: number;
  days: number;
  createdBy?: string | null;
}): Promise<void> {
  const { companyId, employeeId, year, days } = params;
  const { error: delErr } = await db
    .from('leave_grants')
    .delete()
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('grant_type', 'base');
  if (delErr) throw delErr;
  const { error } = await db.from('leave_grants').insert({
    company_id: companyId,
    employee_id: employeeId,
    year,
    grant_date: `${year}-01-01`,
    days,
    grant_type: 'base',
    memo: null,
    created_by: params.createdBy || null,
  });
  if (error) throw error;
  await syncLeaveBalanceTotal(companyId, employeeId, year);
}

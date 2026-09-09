// 달력에 승인 휴가를 표시하기 위한 공용 소스 (2026-09-09).
//   여러 달력(대시보드 미니·메인 일정·메신저 일정)이 제각각 leave_requests 를 안 읽어
//   휴가가 어떤 달력엔 보이고 어떤 달력엔 안 보이던 문제 → 한 곳에서 읽고 한 규칙으로 펼친다.
//   RPC public.leave_calendar() 는 승인된 휴가만 최소 컬럼으로 돌려준다(민감 컬럼 RLS 우회).
import { supabase } from "@/lib/supabase";
import { LEAVE_TYPES } from "@/lib/hr";

export type LeaveCalRow = {
  employee_name: string;
  leave_type: string | null;
  leave_unit: string | null;
  days: number | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  employee_id?: string | null;
  user_id?: string | null;
  employee_email?: string | null;
};

/** 이 휴가가 지금 로그인한 사람의 것인가 — 직원 기록의 계정 연결이 먼저, 없으면 이메일 */
export function isMyLeave(l: LeaveCalRow, me: { userId?: string | null; email?: string | null }): boolean {
  if (me.userId && l.user_id && l.user_id === me.userId) return true;
  const a = String(l.employee_email || "").toLowerCase(), b = String(me.email || "").toLowerCase();
  return !!a && !!b && a === b;
}

export async function fetchLeaveCalendar(): Promise<LeaveCalRow[]> {
  const { data, error } = await (supabase as any).rpc("leave_calendar");
  if (error) throw error;
  return (data || []) as LeaveCalRow[];
}

// 표기 규칙 — 반차·시간차는 단위, 그 외는 유형(연차/병가/공가…). 오전/오후는 시작시각 기준.
//   회사 커스텀 유형 라벨을 쓰려면 typeLabel 을 넘긴다(없으면 기본 LEAVE_TYPES 라벨).
export function leaveDisplayLabel(
  l: { leave_unit?: string | null; start_time?: string | null; days?: number | null; leave_type?: string | null },
  typeLabel?: (v: string) => string,
): string {
  if (l.leave_unit === "half_day") {
    const st = String(l.start_time || "").slice(0, 5);
    return st && st < "13:00" ? "오전 반차" : st ? "오후 반차" : "반차";
  }
  if (l.leave_unit === "two_hours") return "시간차";
  if (Number(l.days) === 0.5) return "반차"; // 단위 없이 0.5일로만 기록된 구 데이터 방어
  const t = String(l.leave_type || "");
  if (typeLabel) return typeLabel(t);
  return LEAVE_TYPES.find((x) => x.value === t)?.label || t;
}

export type LeaveByDateEntry = { name: string; label: string };

// 기간(start_date~end_date)을 날짜별로 펼쳐 map[YYYY-MM-DD] = [{name,label}] 로.
//   ⚠️ 날짜 문자열끼리만 더한다(UTC 자정 기준) — new Date 로 로컬 변환하면 KST 자정이 전날로 밀려 하루 어긋난다.
export function buildLeaveByDate(
  leaves: LeaveCalRow[] | null | undefined,
  typeLabel?: (v: string) => string,
): Record<string, LeaveByDateEntry[]> {
  const map: Record<string, LeaveByDateEntry[]> = {};
  const nextDay = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
  };
  for (const l of leaves || []) {
    const from = String(l.start_date || "").slice(0, 10);
    const to = String(l.end_date || from).slice(0, 10);
    if (!from) continue;
    const name = l.employee_name || "";
    const label = leaveDisplayLabel(l, typeLabel);
    let cur = from;
    for (let i = 0; i < 366 && cur <= to; i++) {
      (map[cur] || (map[cur] = [])).push({ name, label });
      cur = nextDay(cur);
    }
  }
  return map;
}

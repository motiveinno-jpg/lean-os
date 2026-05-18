import { supabase } from "./supabase";

const db = supabase as any;

// ── Events ──────────────────────────────────────────────────────────────

export type EventColor = "blue" | "green" | "red" | "amber" | "violet" | "gray";

export interface ScheduleEvent {
  id: string;
  company_id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  color: EventColor;
  is_shared: boolean;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function toggleEventCompleted(id: string, completed: boolean): Promise<void> {
  const { error } = await db
    .from("schedule_events")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function getMonthEvents(companyId: string, year: number, monthIdx0: number): Promise<ScheduleEvent[]> {
  // monthIdx0 = 0~11 (JS Date convention)
  const start = new Date(year, monthIdx0, 1).toISOString();
  const end = new Date(year, monthIdx0 + 1, 1).toISOString();
  // 기간 일정(end_at 있음)은 시작이 이전 달이어도 이번 달에 걸칠 수 있으므로
  // "start_at < 다음 달 1일" 인 행을 모두 가져온 뒤,
  // end_at(있으면) 또는 start_at 이 이번 달과 겹치는지 클라이언트에서 필터한다.
  // (단일 일정은 end_at = null → 기존과 동일하게 start_at 기준으로만 표시)
  const { data, error } = await db
    .from("schedule_events")
    .select("*")
    .eq("company_id", companyId)
    .lt("start_at", end)
    .order("start_at");
  if (error) throw error;
  const rows: ScheduleEvent[] = data || [];
  return rows.filter((e) => {
    // 일정의 표시 종료 시점: 기간 일정이면 end_at, 아니면 start_at
    const effectiveEnd = e.end_at ?? e.start_at;
    // 이번 달과 한 칸이라도 겹치면 포함
    return effectiveEnd >= start;
  });
}

export async function upsertEvent(input: {
  id?: string;
  companyId: string;
  userId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  color?: EventColor;
  isShared?: boolean;
}): Promise<ScheduleEvent> {
  const row: any = {
    company_id: input.companyId,
    user_id: input.userId,
    title: input.title,
    description: input.description ?? null,
    start_at: input.startAt,
    end_at: input.endAt ?? null,
    all_day: input.allDay ?? true,
    color: input.color ?? "blue",
    is_shared: input.isShared ?? false,
  };
  if (input.id) row.id = input.id;
  const { data, error } = await db.from("schedule_events").upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await db.from("schedule_events").delete().eq("id", id);
  if (error) throw error;
}

// ── Todos ──────────────────────────────────────────────────────────────

export interface ScheduleTodo {
  id: string;
  company_id: string;
  user_id: string;
  title: string;
  description: string | null;
  done: boolean;
  done_at: string | null;
  priority: 0 | 1 | 2;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export async function getTodos(userId: string, opts?: { includeDone?: boolean }): Promise<ScheduleTodo[]> {
  let q = db.from("schedule_todos").select("*").eq("user_id", userId);
  if (!opts?.includeDone) q = q.eq("done", false);
  q = q.order("done").order("priority", { ascending: false }).order("position");
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function upsertTodo(input: {
  id?: string;
  companyId: string;
  userId: string;
  title: string;
  description?: string;
  priority?: 0 | 1 | 2;
  dueDate?: string | null;
  done?: boolean;
}): Promise<ScheduleTodo> {
  const row: any = {
    company_id: input.companyId,
    user_id: input.userId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? 1,
    due_date: input.dueDate ?? null,
  };
  if (input.id) row.id = input.id;
  if (input.done !== undefined) {
    row.done = input.done;
    row.done_at = input.done ? new Date().toISOString() : null;
  }
  const { data, error } = await db.from("schedule_todos").upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function toggleTodoDone(id: string, done: boolean): Promise<void> {
  const { error } = await db
    .from("schedule_todos")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await db.from("schedule_todos").delete().eq("id", id);
  if (error) throw error;
}

// ── Helpers ─────────────────────────────────────────────────────────────

export const EVENT_COLOR_BG: Record<EventColor, string> = {
  blue: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  green: "bg-green-500/15 text-green-500 border-green-500/30",
  red: "bg-red-500/15 text-red-500 border-red-500/30",
  amber: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  violet: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  gray: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

export const PRIORITY_LABEL: Record<0 | 1 | 2, { label: string; color: string }> = {
  0: { label: "낮음", color: "text-gray-400" },
  1: { label: "보통", color: "text-blue-400" },
  2: { label: "높음", color: "text-red-400" },
};

// ── 기간(시작일~종료일) 일정 헬퍼 ────────────────────────────────────────
// schedule_events.end_at(nullable timestamptz) 를 기간 종료로 재사용한다.
// end_at == null  → 단일 날짜 일정 (기존 동작 그대로, 하위호환)
// end_at != null  → 시작일~종료일(end_at 날짜 포함) 기간 일정

/** ISO/타임스탬프 문자열에서 로컬과 무관하게 'YYYY-MM-DD' 추출 */
export function dateKeyOf(ts: string): string {
  return ts.slice(0, 10);
}

/** 기간 일정 여부 (종료일이 시작일보다 뒤인 경우만 멀티데이로 취급) */
export function isMultiDayEvent(e: { start_at: string; end_at: string | null }): boolean {
  if (!e.end_at) return false;
  return dateKeyOf(e.end_at) > dateKeyOf(e.start_at);
}

/** 일정이 걸쳐 있는 모든 날짜 키('YYYY-MM-DD') 배열. 단일 일정이면 [시작일] */
export function eventDateKeys(e: { start_at: string; end_at: string | null }): string[] {
  const startKey = dateKeyOf(e.start_at);
  if (!e.end_at) return [startKey];
  const endKey = dateKeyOf(e.end_at);
  if (endKey <= startKey) return [startKey];
  const keys: string[] = [];
  // 'YYYY-MM-DD' → UTC 정오 기준으로 순회 (DST/타임존 영향 제거)
  let cur = new Date(`${startKey}T12:00:00Z`);
  const last = new Date(`${endKey}T12:00:00Z`);
  // 안전장치: 최대 366일 (1년) 까지만 — 무한루프/오입력 방지
  let guard = 0;
  while (cur <= last && guard < 366) {
    keys.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return keys;
}

/** 캘린더 막대 표시용: 해당 날짜에서 이 일정이 시작/중간/끝 중 무엇인지 */
export function segmentRole(
  e: { start_at: string; end_at: string | null },
  dateKey: string,
): "single" | "start" | "middle" | "end" {
  if (!isMultiDayEvent(e)) return "single";
  const startKey = dateKeyOf(e.start_at);
  const endKey = dateKeyOf(e.end_at as string);
  if (dateKey === startKey) return "start";
  if (dateKey === endKey) return "end";
  return "middle";
}

/** "5/12~5/13" 형태 라벨 (단일 일정은 "5/12") */
export function formatEventRange(e: { start_at: string; end_at: string | null }): string {
  const fmt = (key: string) => {
    const [, m, d] = key.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const startKey = dateKeyOf(e.start_at);
  if (!isMultiDayEvent(e)) return fmt(startKey);
  return `${fmt(startKey)}~${fmt(dateKeyOf(e.end_at as string))}`;
}

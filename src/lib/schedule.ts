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
  const { data, error } = await db
    .from("schedule_events")
    .select("*")
    .eq("company_id", companyId)
    .gte("start_at", start)
    .lt("start_at", end)
    .order("start_at");
  if (error) throw error;
  return data || [];
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

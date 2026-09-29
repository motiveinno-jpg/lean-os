// 달력 하루 칸 안 일정 순서 — 본인 전용(schedule_day_orders, 마이그 20260929200000).
//   키 = 일정 id(반복 회차는 '원본id@YYYYMMDD' 그대로). 저장된 순서에 없는 일정은 원래 순서대로 뒤에 붙는다.
import { supabase } from "@/lib/supabase";

const db = supabase as any;

/** 저장된 순서대로 정렬 — 목록에 없는 것은 들어온 순서 그대로 뒤로. 원본 배열은 건드리지 않는다. */
export function applyDayOrder<T extends { id: string }>(items: T[], keys: string[] | undefined): T[] {
  if (!keys || keys.length === 0) return items;
  const rank = new Map(keys.map((k, i) => [k, i]));
  return items
    .map((it, i) => ({ it, i, r: rank.has(it.id) ? rank.get(it.id)! : Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.it);
}

/** dragged 를 target 앞(before) 또는 뒤로 옮긴 새 키 순서. 같은 키거나 못 찾으면 그대로. */
export function moveKey(keys: string[], dragged: string, target: string, before: boolean): string[] {
  if (dragged === target || !keys.includes(dragged) || !keys.includes(target)) return keys;
  const rest = keys.filter((k) => k !== dragged);
  const at = rest.indexOf(target) + (before ? 0 : 1);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

/** 기간 안의 내 순서들 — { 'YYYY-MM-DD': keys } */
export async function fetchDayOrders(from: string, to: string): Promise<Record<string, string[]>> {
  const { data, error } = await db.from("schedule_day_orders").select("day, event_keys")
    .gte("day", from).lte("day", to).order("day").limit(62);   // 달력 한 화면 = 최대 42칸
  if (error) throw error;
  const out: Record<string, string[]> = {};
  for (const r of (data || []) as { day: string; event_keys: string[] }[]) out[String(r.day).slice(0, 10)] = r.event_keys || [];
  return out;
}

export async function saveDayOrder(companyId: string, day: string, keys: string[]): Promise<void> {
  const { error } = await db.from("schedule_day_orders")
    .upsert({ company_id: companyId, day, event_keys: keys, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
  if (error) throw error;
}

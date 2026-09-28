import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { kstDateTime } from "@/lib/kst";

// 세금 마감 "납부 완료" 체크 (2026-08-31) — 회사 단위 DB 저장(tax_deadline_checks).
//   D-day 는 달력 계산이라 처리 여부를 모른다 — 처리했다는 사실은 여기 남기고,
//   대시보드 세금 위젯·신호 6칸·AI 브리핑이 이 체크를 읽어 완료된 마감을 걸러낸다.
//   deadline_id 에 날짜가 들어 있어(vat-2026-10-25) 다음 주기 마감은 자동으로 다시 뜬다.
//   2026-09-28: 누가·언제 체크했는지도 같이 읽는다(툴팁) — 체크한 사람이 아니면 "정말 냈나" 를 물어볼 곳이 없었다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type TaxCheckInfo = { by: string | null; at: string | null };

/** 체크된 마감 → 누가·언제. `.has(id)` 로 여부만 볼 수 있다(전에는 Set 이었다). */
export async function fetchTaxDeadlineChecks(companyId: string): Promise<Map<string, TaxCheckInfo>> {
  const data = logRead("lib/tax-deadline-checks:list", await db
    .from("tax_deadline_checks")
    .select("deadline_id, checked_at, by:checked_by(name)")
    .eq("company_id", companyId));
  const out = new Map<string, TaxCheckInfo>();
  for (const r of ((data || []) as { deadline_id: string; checked_at: string | null; by: { name: string | null } | null }[])) {
    out.set(r.deadline_id, { by: r.by?.name || null, at: r.checked_at || null });
  }
  return out;
}

/** 툴팁 문구 — "납부 완료 · 홍길동 · 2026-09-09 14:02". 기록이 없으면 "납부 완료로 표시됨" */
export function taxCheckTitle(info: TaxCheckInfo | undefined): string {
  if (!info || (!info.by && !info.at)) return "납부 완료로 표시됨";
  return `납부 완료 · ${info.by || "이름 없음"} · ${info.at ? kstDateTime(info.at) : ""}`.trim();
}

/** 체크/해제 — checked 가 true 면 기록, false 면 지운다. 실패 시 throw. */
export async function setTaxDeadlineChecked(
  companyId: string,
  deadlineId: string,
  userId: string | null,
  checked: boolean,
): Promise<void> {
  if (checked) {
    const { error } = await db.from("tax_deadline_checks").upsert(
      { company_id: companyId, deadline_id: deadlineId, checked_by: userId, checked_at: new Date().toISOString() },
      { onConflict: "company_id,deadline_id" },
    );
    if (error) throw error;
  } else {
    const { error } = await db.from("tax_deadline_checks").delete()
      .eq("company_id", companyId).eq("deadline_id", deadlineId);
    if (error) throw error;
  }
}

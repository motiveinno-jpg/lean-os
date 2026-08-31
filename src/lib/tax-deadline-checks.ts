import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

// 세금 마감 "납부 완료" 체크 (2026-08-31) — 회사 단위 DB 저장(tax_deadline_checks).
//   D-day 는 달력 계산이라 처리 여부를 모른다 — 처리했다는 사실은 여기 남기고,
//   대시보드 세금 위젯·신호 6칸·AI 브리핑이 이 체크를 읽어 완료된 마감을 걸러낸다.
//   deadline_id 에 날짜가 들어 있어(vat-2026-10-25) 다음 주기 마감은 자동으로 다시 뜬다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 체크된 마감 id 집합 */
export async function fetchTaxDeadlineChecks(companyId: string): Promise<Set<string>> {
  const data = logRead("lib/tax-deadline-checks:list", await db
    .from("tax_deadline_checks")
    .select("deadline_id")
    .eq("company_id", companyId));
  return new Set(((data || []) as { deadline_id: string }[]).map((r) => r.deadline_id));
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

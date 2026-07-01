// 회계마감시점 + 기초잔액 CRUD (2026-07-01)
//   accounting_closing 테이블(회사당 1행). settings 화면에서 마감일·기초잔액 입력.
//   수집 하한(floor)은 DB 함수 data_sync_floor() / codef-sync 에서 적용 — 여기선 저장/조회만.

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface AccountingClosing {
  company_id: string;
  closing_date: string | null;        // 'YYYY-MM-DD' | null(미설정)
  opening_bank_balance: number;
  opening_cumulative_net: number;
  note: string | null;
  updated_at: string;
}

export async function getAccountingClosing(companyId: string): Promise<AccountingClosing | null> {
  const { data, error } = await db
    .from("accounting_closing")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as AccountingClosing) ?? null;
}

export interface SaveClosingInput {
  closing_date: string | null;
  opening_bank_balance: number;
  opening_cumulative_net: number;
  note?: string | null;
}

export async function saveAccountingClosing(companyId: string, userId: string | null, input: SaveClosingInput): Promise<void> {
  const { error } = await db.from("accounting_closing").upsert(
    {
      company_id: companyId,
      closing_date: input.closing_date || null,
      opening_bank_balance: input.opening_bank_balance || 0,
      opening_cumulative_net: input.opening_cumulative_net || 0,
      note: input.note ?? null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) throw error;
}

// 미설정 시 클라이언트에서도 동일 규칙으로 하한을 계산(안내 표시용). DB data_sync_floor() 와 일치시킬 것.
export function computeSyncFloor(closingDate: string | null): string {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const floors = [twoYearsAgo];
  if (closingDate) {
    const d = new Date(closingDate);
    d.setDate(d.getDate() + 1); // 마감일 다음 날부터 수집
    floors.push(d);
  }
  const max = floors.reduce((a, b) => (a > b ? a : b));
  return max.toISOString().slice(0, 10);
}

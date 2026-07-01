// 회계마감시점 + 계정별/거래처별 기초잔액 CRUD (2026-07-01)
//   accounting_closing 테이블(회사당 1행, opening_lines jsonb). settings 화면에서 입력.
//   계정과목(chart_of_accounts) 선택 + 집계구분(계정별/거래처별). 거래처별은 통장·카드·등록거래처로 세분화.
//   금액은 부호 있는 단일 값(자산 +, 부채 −). 수집 하한(floor)은 DB data_sync_floor()/codef-sync 에서 적용.

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ledger.ts AccountType 와 동일
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type PartyType = "bank" | "card" | "partner" | "manual";

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  bank: "통장",
  card: "카드",
  partner: "거래처",
  manual: "직접입력",
};

// 거래처별 세분화 한 줄
export interface OpeningParty {
  id: string;
  party_type: PartyType;
  party_id: string | null;   // 통장/카드/거래처 원본 id (직접입력이면 null)
  name: string;
  amount: number;            // 부호 있는 금액
}

// 계정별 기초잔액 한 줄
export interface OpeningLine {
  id: string;
  account_id: string | null;   // chart_of_accounts.id
  code: string;                // 계정코드
  name: string;                // 계정명
  account_type: AccountType | null;
  mode: "account" | "party";   // 계정별 | 거래처별
  amount: number;              // mode='account' 일 때 금액(부호)
  parties: OpeningParty[];     // mode='party' 일 때 거래처별 금액
}

export function lineAmount(l: OpeningLine): number {
  if (l.mode === "party") return (l.parties || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return Number(l.amount) || 0;
}
export function openingTotal(lines: OpeningLine[]): number {
  return lines.reduce((s, l) => s + lineAmount(l), 0);
}

export interface AccountingClosing {
  company_id: string;
  closing_date: string | null;        // 'YYYY-MM-DD' | null(미설정)
  opening_lines: OpeningLine[];
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
  if (!data) return null;
  return { ...data, opening_lines: Array.isArray(data.opening_lines) ? data.opening_lines : [] } as AccountingClosing;
}

export interface SaveClosingInput {
  closing_date: string | null;
  opening_lines: OpeningLine[];
  note?: string | null;
}

export async function saveAccountingClosing(companyId: string, userId: string | null, input: SaveClosingInput): Promise<void> {
  // 계정 미선택 줄 제거 + 거래처별은 이름 있는 거래처만 저장
  const lines = (input.opening_lines || [])
    .filter((l) => (l.name || "").trim() !== "" || l.account_id)
    .map((l) => ({
      id: l.id,
      account_id: l.account_id,
      code: l.code || "",
      name: (l.name || "").trim(),
      account_type: l.account_type,
      mode: l.mode,
      amount: l.mode === "account" ? (Number(l.amount) || 0) : 0,
      parties: l.mode === "party"
        ? (l.parties || [])
            .filter((p) => (p.name || "").trim() !== "")
            .map((p) => ({ id: p.id, party_type: p.party_type, party_id: p.party_id ?? null, name: p.name.trim(), amount: Number(p.amount) || 0 }))
        : [],
    }));
  const { error } = await db.from("accounting_closing").upsert(
    {
      company_id: companyId,
      closing_date: input.closing_date || null,
      opening_lines: lines,
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

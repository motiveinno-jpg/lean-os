// 회계마감시점 + 계정별/거래처별 기초잔액 CRUD (2026-07-01)
//   accounting_closing 테이블(회사당 1행, opening_lines jsonb). settings 화면에서 입력.
//   계정과목(chart_of_accounts) 선택 + 집계구분(계정별/거래처별). 거래처별은 통장·카드·등록거래처로 세분화.
//   금액은 차변/대변(debit/credit) 2칸. 수집 하한(floor)은 DB data_sync_floor()/codef-sync 에서 적용.

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ledger.ts AccountType 와 동일
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type PartyType = "bank" | "card" | "partner" | "manual";

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  bank: "통장", card: "카드", partner: "거래처", manual: "직접입력",
};

// 계정유형 그룹 라벨/순서 (자산·부채·자본·수익·비용)
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "자산", liability: "부채", equity: "자본", revenue: "수익", expense: "비용",
};
export const ACCOUNT_TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

// 거래처별 세분화 한 줄
export interface OpeningParty {
  id: string;
  party_type: PartyType;
  party_id: string | null;
  name: string;
  debit: number;
  credit: number;
}

// 계정별 기초잔액 한 줄
export interface OpeningLine {
  id: string;
  account_id: string | null;   // chart_of_accounts.id
  code: string;
  name: string;
  account_type: AccountType | null;
  mode: "account" | "party";   // 계정별 | 거래처별
  debit: number;               // mode='account' 일 때
  credit: number;
  parties: OpeningParty[];     // mode='party' 일 때
}

export function lineDebit(l: OpeningLine): number {
  if (l.mode === "party") return (l.parties || []).reduce((s, p) => s + (Number(p.debit) || 0), 0);
  return Number(l.debit) || 0;
}
export function lineCredit(l: OpeningLine): number {
  if (l.mode === "party") return (l.parties || []).reduce((s, p) => s + (Number(p.credit) || 0), 0);
  return Number(l.credit) || 0;
}
export function openingDebit(lines: OpeningLine[]): number { return lines.reduce((s, l) => s + lineDebit(l), 0); }
export function openingCredit(lines: OpeningLine[]): number { return lines.reduce((s, l) => s + lineCredit(l), 0); }
export function lineHasValue(l: OpeningLine): boolean {
  return lineDebit(l) !== 0 || lineCredit(l) !== 0 || (l.mode === "party" && (l.parties || []).some((p) => (p.name || "").trim() !== ""));
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
    .from("accounting_closing").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, opening_lines: Array.isArray(data.opening_lines) ? data.opening_lines : [] } as unknown as AccountingClosing;
}

export interface SaveClosingInput {
  closing_date: string | null;
  opening_lines: OpeningLine[];
  note?: string | null;
}

export async function saveAccountingClosing(companyId: string, userId: string | null, input: SaveClosingInput): Promise<void> {
  // 값(차변/대변/거래처) 있는 계정만 저장
  const lines = (input.opening_lines || [])
    .filter((l) => lineHasValue(l) && ((l.name || "").trim() !== "" || l.account_id))
    .map((l) => ({
      id: l.id,
      account_id: l.account_id,
      code: l.code || "",
      name: (l.name || "").trim(),
      account_type: l.account_type,
      mode: l.mode,
      debit: l.mode === "account" ? (Number(l.debit) || 0) : 0,
      credit: l.mode === "account" ? (Number(l.credit) || 0) : 0,
      parties: l.mode === "party"
        ? (l.parties || [])
            .filter((p) => (p.name || "").trim() !== "" || Number(p.debit) || Number(p.credit))
            .map((p) => ({ id: p.id, party_type: p.party_type, party_id: p.party_id ?? null, name: p.name.trim(), debit: Number(p.debit) || 0, credit: Number(p.credit) || 0 }))
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

// ── PDF 자동 채우기 (2026-07-08) ──
//   회계 마감 자료 PDF → pdfjs 래스터화 → parse-closing-pdf 엣지(Claude Vision) → 계정별 차변/대변.
//   수동입력과 투트랙: 추출 결과로 마감 폼을 미리 채우고, 사용자가 검토·수정 후 저장한다.
export interface ClosingPdfLine { account_name: string; account_code: string; debit: number; credit: number; }

export async function parseClosingPdf(
  file: File,
  accounts: { code?: string; name: string }[],
): Promise<ClosingPdfLine[]> {
  const { rasterizePdf } = await import("@/lib/form-templates");
  const { pages } = await rasterizePdf(file);
  if (!pages.length) throw new Error("PDF 페이지를 읽지 못했습니다.");
  const { data, error } = await db.functions.invoke("parse-closing-pdf", { body: { pages, accounts } });
  if (error) throw new Error(error.message || "PDF 인식 요청 실패");
  return (data?.lines || []) as ClosingPdfLine[];
}

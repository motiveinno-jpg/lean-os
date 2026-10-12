// ── 세무 신고본(tax_returns) — 마감한 숫자 (2026-10-12 세무 2차 1단계, docs/20261012_PLAN_tax_closing_v2.md 결정 258·259) ──
//
//   마감 = 그 기간 신고서 숫자 + 근거 자료 id 를 한 행으로 남긴다. 자료(전표·급여)는 잠그지 않는다(사장님 "숫자만 저장").
//   마감 뒤 지금 계산이 달라지면 화면이 '수정신고 만들기'를 띄우고, 수정본을 마감하면 revision+1 행이 생긴다.
//   행은 지우지 않는다 — 마감 취소는 status='cancelled'(DB 트리거가 다른 칸 변경을 막는다). 쓰기 권한 = RLS(/finance/tax-filing).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import type { FormFigures } from "@/lib/tax-forms/vat-form";

export type TaxReturnKind = "vat" | "wht" | "simple_statement" | "annual_statement" | "daily_work_report" | "insurance_report";
export type TaxReturn = {
  id: string; company_id: string; kind: TaxReturnKind; period_key: string; revision: number;
  status: "closed" | "cancelled";
  figures: FormFigures; schedules: Record<string, unknown>; source_ids: Record<string, string[]>; manual: FormFigures;
  note: string | null; closed_by: string | null; closed_at: string;
  cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null;
  closer?: { name: string | null } | null;
};

/** 그 기간 신고본 전부(차수 오름차순, 취소 포함) */
export async function listTaxReturns(companyId: string, kind: TaxReturnKind, periodKey: string): Promise<TaxReturn[]> {
  const data = logRead("tax-returns:list", await (supabase as any).from("tax_returns")
    .select("*, closer:closed_by(name)")
    .eq("company_id", companyId).eq("kind", kind).eq("period_key", periodKey)
    .order("revision", { ascending: true }));
  return (data || []) as TaxReturn[];
}

/** 마지막으로 마감한(취소 안 된) 신고본 */
export const latestClosed = (list: TaxReturn[]) => [...list].reverse().find((r) => r.status === "closed") || null;

/** 마감 — 다음 차수로 저장. 차수는 DB 트리거가 다시 확인한다(빈 차수·중복 거절) */
export async function closeTaxReturn(p: {
  companyId: string; userId: string; kind: TaxReturnKind; periodKey: string; list: TaxReturn[];
  figures: FormFigures; manual?: FormFigures; sourceIds?: Record<string, string[]>; schedules?: Record<string, unknown>; note?: string;
}): Promise<TaxReturn> {
  const revision = p.list.length ? Math.max(...p.list.map((r) => r.revision)) + 1 : 0;
  const { data, error } = await (supabase as any).from("tax_returns").insert({
    company_id: p.companyId, kind: p.kind, period_key: p.periodKey, revision,
    figures: p.figures, manual: p.manual || {}, source_ids: p.sourceIds || {}, schedules: p.schedules || {},
    note: p.note || null, closed_by: p.userId,
  }).select("*").single();
  if (error) throw error;
  return data as TaxReturn;
}

/** 마감 취소 — 지우지 않고 취소 표시(이력은 남는다) */
export async function cancelTaxReturn(id: string, userId: string, reason: string): Promise<void> {
  const { data, error } = await (supabase as any).from("tax_returns")
    .update({ status: "cancelled", cancelled_by: userId, cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
    .eq("id", id).eq("status", "closed").select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("취소할 신고본을 찾지 못했습니다. 이미 취소됐거나 권한이 없습니다");
}

/** 두 신고본 숫자의 다른 칸 목록 */
export function diffFigures(a: FormFigures, b: FormFigures): string[] {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: string[] = [];
  for (const k of keys) {
    const x = a?.[k] || {}, y = b?.[k] || {};
    if (Math.round(Number(x.amount || 0)) !== Math.round(Number(y.amount || 0))
      || Math.round(Number(x.tax || 0)) !== Math.round(Number(y.tax || 0))
      || Math.round(Number(x.n || 0)) !== Math.round(Number(y.n || 0))) out.push(k);
  }
  return out;
}

/** 근거 자료 증감 — 신고본에 있던 id 와 지금 id */
export function diffSources(before: string[] = [], now: string[] = []): { added: number; removed: number } {
  const a = new Set(before), b = new Set(now);
  let added = 0, removed = 0;
  for (const x of b) if (!a.has(x)) added++;
  for (const x of a) if (!b.has(x)) removed++;
  return { added, removed };
}

/** 부가세 신고본 기간 키 — '2026-1p' 처럼 연도-기수 */
export const vatPeriodKey = (year: number, period: string) => `${year}-${period}`;

// ── 고정자산 — 등록·처분·월 감가상각 초안 (2026-08-27 ERP 공백 ⑤, 결정 65~69) ──
//   자산은 표(fixed_assets)에, 상각은 달마다 전표 초안 하나(kind 'depreciation')로. 누계는 확정 전표의 줄만 센다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type FaCategory = "equipment" | "vehicle" | "machine" | "software" | "building" | "structure" | "tool" | "other";
export const FA_CATEGORIES: { value: FaCategory; label: string; months: number; codes: string }[] = [
  { value: "equipment", label: "비품", months: 60, codes: "212 / 213" },
  { value: "vehicle", label: "차량운반구", months: 60, codes: "208 / 209" },
  { value: "machine", label: "기계장치", months: 60, codes: "206 / 207" },
  { value: "software", label: "소프트웨어", months: 60, codes: "240 (누계 없이 직접 차감 · 840)" },
  { value: "building", label: "건물", months: 480, codes: "202 / 203" },
  { value: "structure", label: "구축물", months: 240, codes: "204 / 205" },
  { value: "tool", label: "공구와기구", months: 60, codes: "210 / 211" },
  { value: "other", label: "기타", months: 60, codes: "212 / 213" },
];
export const faCategoryLabel = (v: string) => FA_CATEGORIES.find((c) => c.value === v)?.label || v;

export type FixedAsset = {
  id: string; name: string; category: FaCategory; asset_account_id: string | null; accum_account_id: string | null; expense_account_id: string | null;
  acquired_on: string; cost: number; salvage: number; useful_months: number; method: "straight" | "declining"; depr_start_month: string;
  status: "active" | "disposed"; disposed_on: string | null; disposal_amount: number | null; memo: string | null; created_at: string;
  /** 확정 상각 누계 · 초안 포함 누계 · 장부가 */
  accum: number; accumDraft: number; book: number; lastMonth: string | null;
};
type DeprRow = { asset_id: string; month: string; amount: number; journal_entries: { status: string } | null };

export async function listFixedAssets(companyId: string): Promise<FixedAsset[]> {
  const [assets, deprs] = await Promise.all([
    logRead("fixed-assets:list", await (supabase as any).from("fixed_assets").select("*").eq("company_id", companyId).order("status").order("acquired_on", { ascending: false })),
    logRead("fixed-assets:depr", await (supabase as any).from("fixed_asset_depreciations").select("asset_id, month, amount, journal_entries(status)").eq("company_id", companyId).limit(20000)),
  ]);
  const acc = new Map<string, { c: number; d: number; last: string | null }>();
  for (const r of ((deprs || []) as DeprRow[])) {
    const st = r.journal_entries?.status;
    if (st === "rejected") continue;
    const cur = acc.get(r.asset_id) || { c: 0, d: 0, last: null };
    if (st === "confirmed") { cur.c += Number(r.amount || 0); if (!cur.last || r.month > cur.last) cur.last = r.month; } else cur.d += Number(r.amount || 0);
    acc.set(r.asset_id, cur);
  }
  return ((assets || []) as any[]).map((a) => {
    const x = acc.get(a.id) || { c: 0, d: 0, last: null };
    return { ...a, cost: Number(a.cost || 0), salvage: Number(a.salvage || 0), disposal_amount: a.disposal_amount == null ? null : Number(a.disposal_amount),
      accum: x.c, accumDraft: x.d, book: Number(a.cost || 0) - x.c, lastMonth: x.last };
  });
}

export type FixedAssetInput = Omit<FixedAsset, "id" | "created_at" | "accum" | "accumDraft" | "book" | "lastMonth" | "status" | "disposed_on" | "disposal_amount"> & { id?: string };
export async function upsertFixedAsset(companyId: string, userId: string | null, a: FixedAssetInput): Promise<string> {
  const row = { company_id: companyId, name: a.name.trim(), category: a.category, asset_account_id: a.asset_account_id, accum_account_id: a.accum_account_id, expense_account_id: a.expense_account_id,
    acquired_on: a.acquired_on, cost: a.cost, salvage: a.salvage, useful_months: a.useful_months, method: a.method, depr_start_month: a.depr_start_month, memo: a.memo, updated_at: new Date().toISOString() };
  if (a.id) {
    const { error } = await (supabase as any).from("fixed_assets").update(row).eq("id", a.id);
    if (error) throw error; return a.id;
  }
  const { data, error } = await (supabase as any).from("fixed_assets").insert({ ...row, created_by: userId }).select("id").single();
  if (error) throw error; return data.id as string;
}
export async function disposeFixedAsset(id: string, on: string, amount: number | null): Promise<void> {
  const { error } = await (supabase as any).from("fixed_assets").update({ status: "disposed", disposed_on: on, disposal_amount: amount, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function undisposeFixedAsset(id: string): Promise<void> {
  const { error } = await (supabase as any).from("fixed_assets").update({ status: "active", disposed_on: null, disposal_amount: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function deleteFixedAsset(id: string): Promise<void> {
  const { error } = await (supabase as any).from("fixed_assets").delete().eq("id", id);
  if (error) throw error;
}
/** 월 감가상각 초안 — 자산 없으면 null */
export async function makeDepreciationDraftNow(month: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_my_depreciation_voucher_draft", { p_month: month });
  if (error) throw error;
  return (data as string | null) ?? null;
}
/** 자산 하나의 상각 이력 */
export async function listDepreciations(assetId: string): Promise<{ month: string; amount: number; status: string; entryId: string | null }[]> {
  const data = logRead("fixed-assets:depr-one", await (supabase as any).from("fixed_asset_depreciations").select("month, amount, journal_entry_id, journal_entries(status)").eq("asset_id", assetId).order("month"));
  return ((data || []) as any[]).map((r) => ({ month: r.month, amount: Number(r.amount || 0), status: r.journal_entries?.status || "ai_suggested", entryId: r.journal_entry_id }));
}
/** 정액 월 상각액 미리보기 */
export const monthlyStraight = (cost: number, salvage: number, months: number) => months > 0 ? Math.round((cost - salvage) / months) : 0;

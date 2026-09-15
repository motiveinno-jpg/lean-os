//   4대보험 요율 — 회사설정 연도별 표(company_insurance_rates), 없으면 법정 기본값 (2026-08-27 인사 2차, 결정 96)
//   계산(calculatePayroll)은 여기서 받은 요율만 쓴다. 코드 상수로 계산하지 않는다.
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type InsuranceRates = {
  year: number;
  np_emp: number; np_er: number;
  hi_emp: number; hi_er: number;
  ltc_pct: number;
  ei_emp: number; ei_er: number;
  ia_rate: number;
  np_floor: number; np_ceiling: number;
  hi_floor: number; hi_ceiling: number;
  /** true = 저장된 회사 행이 아니라 법정 기본값 */
  isDefault: boolean;
  note?: string | null;
};

/** 법정 기본값 — 연도별. 모르는 연도는 가장 가까운 아는 연도.
 *  2026 요율 출처: 보건복지부 고시·국민연금공단·건강보험공단 (공개 4대보험 계산기 RATES 와 동일 기준).
 *    · 국민연금 9.5%(연금개혁 인상, 4.75/4.75) · 기준소득월액 하한 41만·상한 659만(2026.7~)
 *    · 건강보험 7.19%(3.595/3.595) · 장기요양 13.14%(건강보험료 대비, 보수월액 대비 0.9448%)
 *    · 고용보험 실업급여 1.8%(0.9/0.9) + 회사 고용안정·직능개발 0.25%(150인 미만) → 회사 1.15%
 *    · 산재 0.7%(업종별 상이, 기본값) */
const LEGAL: Record<number, Omit<InsuranceRates, "year" | "isDefault">> = {
  2026: { np_emp: 0.0475, np_er: 0.0475, hi_emp: 0.03595, hi_er: 0.03595, ltc_pct: 0.1314, ei_emp: 0.009, ei_er: 0.0115, ia_rate: 0.007,
          np_floor: 410_000, np_ceiling: 6_590_000, hi_floor: 279266, hi_ceiling: 119625307 },
};
export function legalInsuranceRates(year: number): InsuranceRates {
  const ys = Object.keys(LEGAL).map(Number).sort((a, b) => Math.abs(a - year) - Math.abs(b - year));
  return { year, isDefault: true, ...LEGAL[ys[0]] };
}

export async function fetchInsuranceRates(companyId: string, year: number): Promise<InsuranceRates> {
  const row = logRead("lib/insurance-rates:get", await (supabase as any).from("company_insurance_rates").select("*").eq("company_id", companyId).eq("year", year).maybeSingle());
  if (!row) return legalInsuranceRates(year);
  const n = (v: unknown) => Number(v);
  return { year, isDefault: false, note: row.note, np_emp: n(row.np_emp), np_er: n(row.np_er), hi_emp: n(row.hi_emp), hi_er: n(row.hi_er), ltc_pct: n(row.ltc_pct),
    ei_emp: n(row.ei_emp), ei_er: n(row.ei_er), ia_rate: n(row.ia_rate), np_floor: n(row.np_floor), np_ceiling: n(row.np_ceiling), hi_floor: n(row.hi_floor), hi_ceiling: n(row.hi_ceiling) };
}
export async function saveInsuranceRates(companyId: string, r: InsuranceRates, userId: string | null) {
  const { isDefault: _d, year, note, ...rest } = r; void _d;
  const { error } = await (supabase as any).from("company_insurance_rates").upsert({ company_id: companyId, year, note: note || null, ...rest, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "company_id,year" });
  if (error) throw error;
}
export async function resetInsuranceRates(companyId: string, year: number) {
  const { error } = await (supabase as any).from("company_insurance_rates").delete().eq("company_id", companyId).eq("year", year);
  if (error) throw error;
}

export type InsuranceNotice = { month: string; np: number; hi: number; ei: number; ia: number; note: string | null };
export async function fetchInsuranceNotice(companyId: string, month: string): Promise<InsuranceNotice | null> {
  const row = logRead("lib/insurance-rates:notice", await (supabase as any).from("insurance_notices").select("month, np, hi, ei, ia, note").eq("company_id", companyId).eq("month", month).maybeSingle());
  return row ? { month: row.month, np: Number(row.np), hi: Number(row.hi), ei: Number(row.ei), ia: Number(row.ia), note: row.note } : null;
}
export async function saveInsuranceNotice(companyId: string, n: InsuranceNotice, userId: string | null) {
  const { error } = await (supabase as any).from("insurance_notices").upsert({ company_id: companyId, ...n, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "company_id,month" });
  if (error) throw error;
}

// 자금 전망 — 결제조건·급여일 **제안** (2026-09-28, docs/20260928_PLAN_cash_outlook_terms_suggest.md 결정 262~265)
//   3827efc2 로 칸(partners.payment_terms_days · company_settings.payroll_day)은 생겼지만 11일간 입력 0건.
//   그래서 이력에서 값을 **제안**하고, 저장은 사람이 체크해서 누른다(제안은 자동·확정은 사람).
//   ▸ 결제조건: 계산서 발행일 → 대조된 통장 거래일(첫 입금·지급) 차이의 중앙값. 출처 = 장부 대조.
//   ▸ 급여일: 현금흐름표와 같은 판정(fetchCashFlow 의 payroll 줄)으로 잡힌 출금의 달별 지급일 최빈값. 출처 = 통장 이력.
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { fetchCashFlow } from "@/lib/cash-flow-statement";
import { addDaysStr, todayKst } from "@/lib/kst";

export type TermsSuggestion = {
  partnerId: string; name: string;
  days: number;              // 제안 일수 (0~180)
  samples: number;           // 근거 계산서 건수
  confirmed: number;         // 그중 사람이 확정한 대조 건수
  sales: number; purchase: number;
  lastPaid: string;          // 마지막 대조 거래일
};

const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const dayGap = (issue: string, paid: string) => Math.round((utc(paid) - utc(issue)) / 86_400_000);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** 결제조건이 비어 있는 거래처 중, 계산서↔통장 대조 이력이 있는 곳의 제안값 */
export async function suggestPartnerTerms(companyId: string): Promise<{ rows: TermsSuggestion[]; noHistory: number }> {
  const [partners, links] = await Promise.all([
    fetchPaged<{ id: string; name: string }>("outlook-suggest:partners", () =>
      supabase.from("partners").select("id, name").eq("company_id", companyId).is("payment_terms_days", null).order("id")),
    //   rejected(사람이 아니라고 한 대조)는 뺀다. suggested·needs_review 는 넣되 confirmed 건수를 따로 세어 근거에 적는다.
    fetchPaged<any>("outlook-suggest:settlements", () =>
      (supabase as any).from("invoice_settlements")
        .select("id, tax_invoice_id, status, bank_transactions(transaction_date), tax_invoices!inner(partner_id, type, issue_date)")
        .eq("company_id", companyId).neq("status", "rejected").order("id")),
  ]);
  // 계산서 한 건 = 첫 거래일 하나 (분할 입금이면 첫 입금이 '결제 시점')
  const byInvoice = new Map<string, { partnerId: string; type: string; issue: string; paid: string; confirmed: boolean }>();
  for (const l of links) {
    const inv = l.tax_invoices, paid = l.bank_transactions?.transaction_date;
    if (!inv?.partner_id || !inv.issue_date || !paid) continue;
    const cur = byInvoice.get(l.tax_invoice_id);
    const confirmed = l.status === "confirmed";
    if (!cur) byInvoice.set(l.tax_invoice_id, { partnerId: inv.partner_id, type: inv.type, issue: inv.issue_date, paid, confirmed });
    else { if (paid < cur.paid) cur.paid = paid; cur.confirmed = cur.confirmed || confirmed; }
  }
  const byPartner = new Map<string, { gaps: number[]; confirmed: number; sales: number; purchase: number; lastPaid: string }>();
  for (const v of byInvoice.values()) {
    const g = byPartner.get(v.partnerId) || { gaps: [], confirmed: 0, sales: 0, purchase: 0, lastPaid: "" };
    g.gaps.push(Math.max(0, dayGap(v.issue, v.paid)));     // 선입금 후 발행(음수) → 0
    if (v.confirmed) g.confirmed++;
    if (v.type === "sales") g.sales++; else g.purchase++;
    if (v.paid > g.lastPaid) g.lastPaid = v.paid;
    byPartner.set(v.partnerId, g);
  }
  const rows: TermsSuggestion[] = [];
  let noHistory = 0;
  for (const p of partners) {
    const g = byPartner.get(p.id);
    if (!g) { noHistory++; continue; }
    rows.push({
      partnerId: p.id, name: p.name || "(이름 없음)",
      days: Math.min(180, Math.max(0, Math.round(median(g.gaps)))),   // 컬럼 CHECK 0~180
      samples: g.gaps.length, confirmed: g.confirmed, sales: g.sales, purchase: g.purchase, lastPaid: g.lastPaid,
    });
  }
  rows.sort((a, b) => b.samples - a.samples || b.confirmed - a.confirmed || a.name.localeCompare(b.name, "ko"));
  return { rows, noHistory };
}

/** 체크한 거래처만 저장. 이미 값이 있는 줄은 건드리지 않는다(null 인 것만). 저장된 건수를 돌려준다. */
export async function applyPartnerTerms(companyId: string, picks: { partnerId: string; days: number }[]): Promise<number> {
  const byDays = new Map<number, string[]>();
  for (const p of picks) {
    const d = Math.min(180, Math.max(0, Math.round(Number(p.days) || 0)));
    byDays.set(d, [...(byDays.get(d) || []), p.partnerId]);
  }
  let n = 0;
  for (const [days, ids] of byDays) {
    const { data, error } = await supabase.from("partners").update({ payment_terms_days: days } as never)
      .eq("company_id", companyId).is("payment_terms_days", null).in("id", ids).select("id");
    if (error) throw new Error(error.message);
    n += (data || []).length;
  }
  return n;
}

export type PayrollSuggestion = {
  day: number;                                                   // 제안 지급일 (말일이면 31)
  months: number;                                                // 근거 달 수
  sample: { month: string; date: string; amount: number }[];     // 달별 가장 큰 급여 지급
};

/** 최근 6개월 급여 지급일 제안. 급여로 분류된 출금이 없으면 null */
export async function suggestPayrollDay(companyId: string): Promise<PayrollSuggestion | null> {
  const today = todayKst();
  const cf = await fetchCashFlow(companyId, addDaysStr(today, -183), today);
  //   달마다 가장 큰 급여 출금 하루 = 그 달의 지급일 (같은 날 여러 명 → 합산)
  const perMonth = new Map<string, Map<string, number>>();
  for (const t of cf.txs) {
    if (t.key !== "payroll" || t.dir !== "out") continue;
    const m = perMonth.get(t.month) || new Map<string, number>();
    m.set(t.date, (m.get(t.date) || 0) + Math.abs(t.amount));
    perMonth.set(t.month, m);
  }
  if (perMonth.size === 0) return null;
  const sample = [...perMonth.entries()].map(([month, days]) => {
    const [date, amount] = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
    return { month, date, amount };
  }).sort((a, b) => a.month.localeCompare(b.month));
  //   28일 이후이면서 그 달 말일-3일 안이면 '말일(31)' — 달마다 28~31로 흔들리는 말일 지급을 하나로
  const norm = (date: string) => {
    const y = Number(date.slice(0, 4)), mo = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    const last = new Date(y, mo, 0).getDate();
    return d >= 28 && d >= last - 3 ? 31 : d;
  };
  const votes = new Map<number, number>();
  for (const s of sample) votes.set(norm(s.date), (votes.get(norm(s.date)) || 0) + 1);
  //   최빈값 · 동률이면 최근 달의 값
  let day = norm(sample[sample.length - 1].date), best = -1;
  for (const s of [...sample].reverse()) { const k = norm(s.date), v = votes.get(k) || 0; if (v > best) { best = v; day = k; } }
  return { day, months: sample.length, sample };
}

/** 회사 급여 지급일 저장 — 회사설정 › 자금·통장과 같은 자리(company_settings.payroll_day) */
export async function applyPayrollDay(companyId: string, day: number): Promise<void> {
  const d = Math.min(31, Math.max(1, Math.round(day)));
  const { error } = await supabase.from("company_settings").upsert({ company_id: companyId, payroll_day: d } as never, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
}

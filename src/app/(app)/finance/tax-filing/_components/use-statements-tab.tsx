"use client";

// ── 재무 › 세무 신고 › 지급명세서 — 간이(반기·월)·일용·연간 10종 (2026-10-14 세무 2차 5단계, docs/20261012_PLAN_tax_closing_v2.md 결정 263) ──
//
//   History: 2차(2026-08-31)엔 근로 간이(반기)·사업 간이(월) 두 개뿐이었다. 연간 지급명세서와 일용근로 지급명세서가 없어
//   3월·2월 기한과 매달 일용 신고는 밖에서 만들었다. 4단계에서 일용·기타·이자·배당 기록이 생겨 자료가 갖춰졌다.
//
//   기준(무엇으로 판단하나): 지급일(급여는 지급월 period_month)이 속한 기간. 원천세 신고서와 같은 자료·같은 해석(lib/tax-forms/wht-rows).
//   서류 = 조회 줄 「서류 ▾」 한 줄 셀렉트(두 층 탭 금지) — 고르면 기간 칸이 반기/월/연도로 바뀐다.
//   마감 = 신고본(tax_returns kind simple_statement·annual_statement) — 사람마다 한 줄 숫자를 남기고, 바뀐 사람은 '수정 제출' 대상으로 보인다.
//   주민번호: 구성원은 결정 108 RPC 로 엑셀 만드는 순간에만. 기타·이자·배당 받는 사람은 저장하지 않으므로 '세무사 기입' 빈 칸.
//   연간 근로 지급명세서의 연말정산 결정세액: 2026-10-14 연말정산 4단계부터 인사에서 **확정한** 연말정산(year_end_settlements)이 있으면
//   그 결정세액·차감징수세액을 채운다. 확정 안 한 사람은 빈 칸(세무사) — 추정치를 신고서에 넣지 않는다.
//
//   6단계(2026-10-14, 결정 264) — 4대보험 신고 3종을 같은 「서류 ▾」 '4대보험 신고' 묶음에:
//   · 근로내용확인신고서(월): 일용 근무 기록을 **근무일** 기준으로(지급명세서는 지급일 기준). 근무한 날짜·일수·보수총액·일용 소득세. 다음 달 15일.
//   · 보수총액신고(연): 지난해 발송된 급여 과세액 합(결정 101) · 근무월수 · 취득/상실일 + 일용근로자 보수 합계 줄. 고용·산재 3/15(건강 3/10).
//   · 보수월액 변경(월): 이번 달 과세 보수가 지난달과 다른 사람 = 후보(사람이 고른다 — 일회성 수당이면 낼 일이 아니다).
//   ★ 공단 EDI 업로드 규격 예제가 없어 '신고서 칸 순서 엑셀'까지 — 업로드 파일이라고 하지 않는다(지어낸 규격 금지).

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { MonthSelect } from "@/components/month-select";
import { TaxReturnSheet } from "@/components/tax-return-sheet";
import { toWhtRows, WHT_SELECT, halfMonths, type WhtRow } from "@/lib/tax-forms/wht-rows";
import { listDailyLogs, listIncomePaymentsRange, listDailyLogsByWork } from "@/lib/wht-income-records";
import { loadJobDefault, JOB_CODES } from "@/lib/insurance-edi";
import { listRetirementPayments, type RetirementPayment } from "@/lib/retirement";
import type { DailyLog, IncomePayment } from "@/lib/tax-forms/wht-income";
import type { FormFigures } from "@/lib/tax-forms/vat-form";
import { writeProtectedXlsx, MIN_XLSX_PASSWORD } from "@/lib/xlsx-protect";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { listConfirmed, type ConfirmedSettlement } from "@/lib/year-end-settlements";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const nextMonthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); const n = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; return lastDay(n); };
const prevMonth = () => { const t = todayKst(); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

/** 서류 — period: half(연·반기) · month · year */
export const STMT_DOCS = [
  { key: "sw", group: "간이지급명세서", label: "근로소득 간이지급명세서 (반기)", period: "half" },
  { key: "sb", group: "간이지급명세서", label: "사업소득 간이지급명세서 (월)", period: "month" },
  { key: "so", group: "간이지급명세서", label: "기타소득 간이지급명세서 (월)", period: "month" },
  { key: "sd", group: "간이지급명세서", label: "일용근로소득 지급명세서 (월)", period: "month" },
  { key: "aw", group: "지급명세서 (연간)", label: "근로소득 지급명세서", period: "year" },
  { key: "ar", group: "지급명세서 (연간)", label: "퇴직소득 지급명세서", period: "year" },
  { key: "ab", group: "지급명세서 (연간)", label: "사업소득 지급명세서", period: "year" },
  { key: "ai", group: "지급명세서 (연간)", label: "이자소득 지급명세서", period: "year" },
  { key: "av", group: "지급명세서 (연간)", label: "배당소득 지급명세서", period: "year" },
  { key: "ao", group: "지급명세서 (연간)", label: "기타소득 지급명세서", period: "year" },
  { key: "iw", group: "4대보험 신고", label: "일용근로자 근로내용확인신고서 (월)", period: "month" },
  { key: "it", group: "4대보험 신고", label: "보수총액신고 (연)", period: "year" },
  { key: "im", group: "4대보험 신고", label: "보수월액 변경 대상 (월)", period: "month" },
] as const;
export type StmtDoc = (typeof STMT_DOCS)[number]["key"];

/** 한 사람 한 줄 */
type Line = { key: string; name: string; sub?: string; employeeId?: string | null; n?: number; amount: number; nonTaxable?: number; tax: number; local: number; months?: Record<string, number>;
  /** 6단계 — 근무일(근로내용확인) · 취득/상실일·근무월수(보수총액) · 변경 전/후(보수월액) */
  days?: string[]; wage?: number; hire?: string | null; resign?: string | null; before?: number; after?: number;
  /** 연말정산 4단계 — 확정한 연말정산의 결정세액·차감징수세액(근로 연간만) */
  decided?: number; diff?: number };
const prevOf = (ym: string) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export function useStatementsTab(p: {
  companyId: string | null; userId: string | null; canWrite: boolean; enabled: boolean; years: number[];
  initial: { doc?: string | null; year?: number | null; half?: string | null; month?: string | null };
  renderDue: (date: string, id: string) => ReactNode;
}) {
  const { toast } = useToast();
  const t = todayKst();
  const [doc, setDoc] = useState<StmtDoc>(() => (STMT_DOCS.some((d) => d.key === p.initial.doc) ? p.initial.doc as StmtDoc : "sw"));
  const [year, setYear] = useState<number>(() => p.initial.year && p.initial.year >= 2000 ? p.initial.year : (Number(t.slice(5, 7)) <= 6 ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4))));
  const [half, setHalf] = useState<1 | 2>(() => (p.initial.half === "1" || p.initial.half === "2") ? Number(p.initial.half) as 1 | 2 : (Number(t.slice(5, 7)) <= 6 ? 2 : 1));
  const [month, setMonth] = useState<string>(() => p.initial.month && /^\d{4}-\d{2}$/.test(p.initial.month) ? p.initial.month : prevMonth());
  const D = STMT_DOCS.find((d) => d.key === doc)!;
  //   연간 서류의 기본 연도 = 지난해(올해 3/10·2월 말에 내는 것)
  const annualYear = year;

  const months = D.period === "half" ? halfMonths(year, half) : doc === "im" ? [prevOf(month), month] : D.period === "month" ? [month] : Array.from({ length: 12 }, (_, i) => `${annualYear}-${String(i + 1).padStart(2, "0")}`);
  const from = `${months[0]}-01`, to = lastDay(months[months.length - 1]);
  const needPayroll = doc === "sw" || doc === "sb" || doc === "aw" || doc === "ab" || doc === "it" || doc === "im";
  const needDailyWork = doc === "iw" || doc === "it";
  const needIncome = doc === "so" || doc === "ai" || doc === "av" || doc === "ao";

  const { data: payroll = [], isLoading: l1 } = useQuery<WhtRow[]>({
    queryKey: ["stmt-payroll", p.companyId, ...months], enabled: !!p.companyId && p.enabled && needPayroll,
    queryFn: async () => toWhtRows(logRead("tax-filing:stmt", await (supabase as any).from("payroll_items")
      .select(WHT_SELECT).eq("company_id", p.companyId!).in("period_month", months).limit(20000)) as any[]),
  });
  const { data: daily = [], isLoading: l2 } = useQuery<DailyLog[]>({
    queryKey: ["stmt-daily", p.companyId, month], enabled: !!p.companyId && p.enabled && doc === "sd",
    queryFn: () => listDailyLogs(p.companyId!, month),
  });
  const { data: pays = [], isLoading: l3 } = useQuery<IncomePayment[]>({
    queryKey: ["stmt-pays", p.companyId, from, to], enabled: !!p.companyId && p.enabled && needIncome,
    queryFn: () => listIncomePaymentsRange(p.companyId!, from, to),
  });
  const { data: rets = [], isLoading: l4 } = useQuery<RetirementPayment[]>({
    queryKey: ["stmt-ret", p.companyId, from, to], enabled: !!p.companyId && p.enabled && doc === "ar",
    queryFn: () => listRetirementPayments(p.companyId!, from, to),
  });
  //   6단계 — 근무일 기준 일용 기록(근로내용확인: 그 달 · 보수총액: 그 해) · 보수총액의 취득/상실일
  const { data: dailyWork = [], isLoading: l5 } = useQuery<DailyLog[]>({
    queryKey: ["stmt-daily-work", p.companyId, from, to], enabled: !!p.companyId && p.enabled && needDailyWork,
    queryFn: () => listDailyLogsByWork(p.companyId!, from, to),
  });
  const payIds = useMemo(() => [...new Set(payroll.map((r) => r.employee_id))].sort(), [payroll]);
  const { data: empDates = new Map<string, { hire: string | null; resign: string | null }>() } = useQuery({
    queryKey: ["stmt-emp-dates", p.companyId, ...payIds], enabled: !!p.companyId && p.enabled && doc === "it" && payIds.length > 0,
    queryFn: async () => {
      const data = logRead("tax-filing:emp-dates", await (supabase as any).from("employees").select("id, hire_date, resignation_date").in("id", payIds).limit(2000));
      return new Map<string, { hire: string | null; resign: string | null }>(((data || []) as any[]).map((e) => [e.id, { hire: e.hire_date || null, resign: e.resignation_date ? String(e.resignation_date).slice(0, 10) : null }]));
    },
  });
  //   연말정산 4단계 — 확정본(급여 권한 RLS). 확정 안 한 사람은 결정세액 빈 칸
  const { data: yeList = [], isLoading: l6 } = useQuery<ConfirmedSettlement[]>({
    queryKey: ["year-end-confirmed", p.companyId, annualYear], enabled: !!p.companyId && p.enabled && doc === "aw",
    queryFn: () => listConfirmed(p.companyId!, annualYear),
  });
  const loading = (doc === "aw" && l6) || (needPayroll && l1) || (doc === "sd" && l2) || (needIncome && l3) || (doc === "ar" && l4) || (needDailyWork && l5);

  //   사람마다 한 줄
  const lines = useMemo<Line[]>(() => {
    const byKey = new Map<string, Line>();
    const add = (k: string, base: Omit<Line, "amount" | "tax" | "local">, amount: number, tax: number, local: number, extra?: (l: Line) => void) => {
      const cur = byKey.get(k) || { ...base, amount: 0, tax: 0, local: 0 };
      cur.amount += amount; cur.tax += tax; cur.local += local; extra?.(cur); byKey.set(k, cur);
    };
    if (doc === "sw" || doc === "aw" || doc === "sb" || doc === "ab") {
      const biz = doc === "sb" || doc === "ab";
      for (const r of payroll.filter((x) => x.biz === biz))
        add(r.employee_id, { key: r.employee_id, name: r.name, sub: r.employee_number ? `#${r.employee_number}` : undefined, employeeId: r.employee_id, months: {}, nonTaxable: 0 },
          r.taxable, r.incomeTax, r.localIncomeTax, (l) => { l.months![r.period_month] = (l.months![r.period_month] || 0) + r.taxable; l.nonTaxable = (l.nonTaxable || 0) + r.nonTaxable; });
    } else if (doc === "iw") {
      //   근로내용확인신고 — 근무일 기준, 사람마다 근무한 날짜
      for (const r of dailyWork)
        add(r.employee_id || r.employee_name, { key: r.employee_id || r.employee_name, name: r.employee_name, employeeId: r.employee_id, n: 0, days: [], wage: 0, nonTaxable: 0 },
          Math.max(0, r.daily_wage - r.non_taxable), r.income_tax, r.local_tax,
          (l) => { l.n = (l.n || 0) + 1; l.days!.push(String(Number(r.work_date.slice(8, 10)))); l.wage = (l.wage || 0) + r.daily_wage; l.nonTaxable = (l.nonTaxable || 0) + r.non_taxable; });
      for (const l of byKey.values()) l.sub = `${l.days!.join("·")}일`;
    } else if (doc === "it") {
      //   보수총액신고 — 근로자(사업소득 제외)의 그 해 과세 보수 합, 근무월수 = 명세가 있는 달 수
      for (const r of payroll.filter((x) => !x.biz))
        add(r.employee_id, { key: r.employee_id, name: r.name, employeeId: r.employee_id, n: 0, months: {} }, r.taxable, 0, 0,
          (l) => { if (!l.months![r.period_month]) l.n = (l.n || 0) + 1; l.months![r.period_month] = (l.months![r.period_month] || 0) + r.taxable; });
      for (const l of byKey.values()) {
        const d = empDates.get(l.key);
        l.hire = d?.hire || null; l.resign = d?.resign || null;
        l.sub = [d?.hire ? `취득 ${d.hire}` : "", d?.resign ? `상실 ${d.resign}` : ""].filter(Boolean).join(" · ") || undefined;
      }
      if (dailyWork.length) {
        const wage = dailyWork.reduce((s, r) => s + Math.max(0, r.daily_wage - r.non_taxable), 0);
        byKey.set("daily-total", { key: "daily-total", name: "일용근로자 보수 합계", sub: `${new Set(dailyWork.map((r) => r.employee_id || r.employee_name)).size}명`, n: dailyWork.length, amount: wage, tax: 0, local: 0 });
      }
    } else if (doc === "im") {
      //   보수월액 변경 후보 — 두 달 다 명세가 있고 과세 보수가 다른 사람
      const prevM = months[0], curM = months[1];
      const by = (m: string) => new Map(payroll.filter((x) => !x.biz && x.period_month === m).map((x) => [x.employee_id, x]));
      const a = by(prevM), b = by(curM);
      for (const [id, cur] of b) {
        const pr = a.get(id); if (!pr || pr.taxable === cur.taxable) continue;
        const pct = pr.taxable ? Math.round(((cur.taxable - pr.taxable) / pr.taxable) * 100) : 0;
        byKey.set(id, { key: id, name: cur.name, employeeId: id, amount: cur.taxable, tax: pr.taxable, local: 0, before: pr.taxable, after: cur.taxable,
          sub: `${pct > 0 ? "+" : ""}${pct}%` });
      }
    } else if (doc === "sd") {
      for (const r of daily)
        add(r.employee_id || r.employee_name, { key: r.employee_id || r.employee_name, name: r.employee_name, employeeId: r.employee_id, n: 0, nonTaxable: 0 },
          Math.max(0, r.daily_wage - r.non_taxable), r.income_tax, r.local_tax, (l) => { l.n = (l.n || 0) + 1; l.nonTaxable = (l.nonTaxable || 0) + r.non_taxable; });
    } else if (doc === "ar") {
      for (const r of rets.filter((x) => !x.irp_deferred))
        add(r.employee_id || r.id, { key: r.employee_id || r.id, name: r.employee_name, employeeId: r.employee_id, sub: `${r.service_start} ~ ${r.service_end}` }, r.retirement_pay, r.income_tax, r.local_tax);
    } else {
      const kind = doc === "ai" ? "interest" : doc === "av" ? "dividend" : "other";
      //   개인에게 준 것만 — 법인 이자·배당은 법인세 원천(지급명세서 서식이 다르다)
      for (const r of pays.filter((x) => x.income_kind === kind && x.payee_kind === "person"))
        add(r.payee_name, { key: `payee:${r.payee_name}`, name: r.payee_name, n: 0 }, r.amount, r.income_tax, r.local_tax, (l) => { l.n = (l.n || 0) + 1; if (r.sub_kind && !l.sub) l.sub = r.sub_kind; });
    }
    if (doc === "aw") for (const s of yeList) {
      const l = byKey.get(s.employee_id); if (!l) continue;
      l.decided = Number(s.result?.decided || 0); l.diff = Number(s.result?.diff || 0);
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [doc, payroll, daily, rets, pays, dailyWork, empDates, months, yeList]);
  const yeDone = doc === "aw" ? lines.filter((l) => l.decided != null).length : 0;
  const tot = useMemo(() => ({ amount: lines.reduce((s, l) => s + l.amount, 0), tax: lines.reduce((s, l) => s + l.tax, 0), local: lines.reduce((s, l) => s + l.local, 0), n: lines.reduce((s, l) => s + (l.n || 0), 0) }), [lines]);
  const irpN = doc === "ar" ? rets.filter((x) => x.irp_deferred).length : 0;

  //   신고본 — 기간 키(형식은 DB 제약 '^\d{4}(-[0-9A-Za-z]{1,8})?$')
  const insurance = doc === "iw" || doc === "it" || doc === "im";
  const kind = doc === "iw" ? "daily_work_report" : insurance ? "insurance_report" : doc.startsWith("a") ? "annual_statement" : "simple_statement";
  const periodKey = doc === "iw" ? month : D.period === "half" ? `${year}-W${half}` : D.period === "month" ? `${month.slice(0, 4)}-${doc.slice(1).toUpperCase()}${month.slice(5, 7)}` : `${annualYear}-${doc.slice(1).toUpperCase()}`;
  const withN = doc === "sd" || doc === "so" || doc === "ai" || doc === "av" || doc === "ao" || doc === "iw" || doc === "it";
  const compute = useMemo(() => () => {
    const F: FormFigures = {};
    for (const l of lines) F[l.key] = { amount: num(l.amount), tax: num(l.tax), ...(withN ? { n: l.n || 0 } : {}) };
    F.total = { amount: num(tot.amount), tax: num(tot.tax), ...(withN ? { n: tot.n } : {}) };
    return F;
  }, [lines, tot, withN]);
  const sources = useMemo(() => ({ people: lines.map((l) => l.key) }), [lines]);
  const schedules = useMemo(() => ({ lines: lines.map(({ employeeId: _e, ...l }) => l) }), [lines]);

  //   제출 기한
  const next15 = (ym: string) => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01-15` : `${y}-${String(m + 1).padStart(2, "0")}-15`; };
  const due = doc === "iw" || doc === "im" ? next15(month) : doc === "it" ? `${annualYear + 1}-03-15`
    : D.period === "half" ? (half === 1 ? `${year}-07-31` : `${year + 1}-01-31`)
    : D.period === "month" ? nextMonthEnd(month)
    : (doc === "ai" || doc === "av" || doc === "ao") ? lastDay(`${annualYear + 1}-02`) : `${annualYear + 1}-03-10`;
  //   기한 체크 id — 근로 반기는 홈 세금 일정과 같은 id(sps-h1/h2), 연간은 aps-w/aps-o(일정에 같이 추가), 그 밖은 stmt-
  const dueId = D.period === "half" ? `${half === 1 ? "sps-h1" : "sps-h2"}-${due}`
    : D.period === "year" && !insurance ? `${doc === "ai" || doc === "av" || doc === "ao" ? "aps-o" : "aps-w"}-${due}` : `stmt-${doc}-${due}`;

  //   주민등록번호 (결정 108) — 구성원만, 엑셀 만드는 순간에만 RPC
  const { data: rrnRegistered = new Set<string>() } = useQuery({
    queryKey: ["rrn-registered", p.companyId], enabled: !!p.companyId && p.enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_rrn_registered");
      if (error) return new Set<string>();
      return new Set<string>(((data || []) as any[]).map((r) => (typeof r === "string" ? r : r.list_rrn_registered || r.employee_id)));
    },
  });
  const empIds = lines.map((l) => l.employeeId).filter(Boolean) as string[];
  const rrnMissing = empIds.filter((id) => !rrnRegistered.has(id)).length;
  const fetchRrns = async (ids: string[]): Promise<Map<string, string>> => {
    const target = ids.filter((id) => rrnRegistered.has(id));
    const out = new Map<string, string>();
    for (let i = 0; i < target.length; i += 500) {
      const { data, error } = await (supabase as any).rpc("get_rrns_for_statement", { p_employee_ids: target.slice(i, i + 500) });
      if (error) { toast(`주민등록번호 조회 실패 · ${friendlyError(error)}`, "error"); return new Map(); }
      for (const r of (data || []) as any[]) out.set(r.employee_id as string, r.rrn as string);
    }
    return out;
  };

  //   4대보험 3종 엑셀 — 신고서 칸 순서(공단 EDI 업로드 양식 아님). 주민번호는 보험 RPC(get_rrns_for_insurance) 대신
  //   세무 신고 화면이라 지급명세서와 같은 RPC 를 쓴다(조회 기록은 같은 표에 남는다)
  //   주민번호가 든 엑셀은 비밀번호를 걸어 내려준다(2026-10-14, 사장님 결정 — 결정 108 숙제). 비밀번호는 저장하지 않는다.
  const saveBook = async (wb: XLSX.WorkBook, name: string, password?: string) => {
    if (password) await writeProtectedXlsx(wb, name, password); else XLSX.writeFile(wb, name);
  };
  const exportInsurance = async (password?: string) => {
    const ids = lines.map((l) => l.employeeId).filter(Boolean) as string[];
    const rrn = ids.length ? await fetchRrns(ids) : new Map<string, string>();
    const idCol = (l: Line) => (l.employeeId ? rrn.get(l.employeeId) || "(미등록)" : "");
    let head: (string | number)[], body: (string | number)[][], notes: string[];
    if (doc === "iw") {
      const job = p.companyId ? await loadJobDefault(p.companyId).catch(() => "") : "";
      const jobLabel = JOB_CODES.find((j) => j.code === job)?.label || "";
      const dim = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      head = ["성명", "주민등록번호", "직종코드", ...Array.from({ length: dim }, (_, i) => `${i + 1}일`), "근로일수", "일평균 근로시간", "보수지급 기초일수", "보수총액(과세)", "임금총액", "이직사유", "비과세", "소득세", "지방소득세"];
      body = lines.map((l) => [l.name, idCol(l), job, ...Array.from({ length: dim }, (_, i) => (l.days || []).includes(String(i + 1)) ? "○" : ""), l.n || 0, "", l.n || 0, num(l.amount), num(l.wage || 0), "", num(l.nonTaxable || 0), num(l.tax), num(l.local)]);
      notes = [`직종코드 = 회사 기본값${jobLabel ? `(${jobLabel})` : "(없음 — 4대보험 취득신고에서 한 번 고르면 기억됩니다)"}. 사람마다 다르면 고치세요.`,
        "일평균 근로시간·이직사유는 오너뷰가 기록하지 않습니다 — 담당자 기입.",
        "같은 사업장에서 한 달 8일 이상(또는 60시간 이상) 일한 일용근로자는 국민연금·건강보험 가입 대상일 수 있습니다 — 확인하세요.",
        "이 신고서를 내면 국세청 일용근로소득 지급명세서를 따로 내지 않아도 됩니다(소득세·지방소득세 칸 기입 시)."];
    } else if (doc === "it") {
      head = ["성명", "주민등록번호", "자격취득일", "자격상실일", "근무월수", "보수총액(고용·산재·건강 과세분)"];
      body = lines.map((l) => [l.name, l.key === "daily-total" ? "" : idCol(l), l.hire || "", l.resign || "", l.n || 0, num(l.amount)]);
      notes = ["보수총액 = 발송된 급여 명세의 과세 지급액 합(비과세 제외, 결정 101). 사업소득(프리랜서)은 빠집니다.",
        "대표이사·임원 등 고용보험 적용 제외자는 오너뷰가 가르지 않습니다 — 고용보험 신고에서 빼세요.",
        "고용·산재는 3/15, 건강보험 보수총액(연말정산)은 3/10까지입니다. 근로복지공단·건강보험 EDI 에서 제출하세요."];
    } else {
      head = ["성명", "주민등록번호", "변경 전 월 보수", "변경 후 월 보수", "변동률", "변경 연월", "변경 사유"];
      body = lines.map((l) => [l.name, idCol(l), num(l.before || 0), num(l.after || 0), l.sub || "", month, ""]);
      notes = ["지난달·이번 달 발송된 급여 명세의 과세 보수가 다른 사람입니다. 수당 한 번처럼 일시적이면 낼 일이 아닙니다 — 고른 사람만 내세요.",
        "고용·산재 월평균보수 변경은 다음 달 15일까지, 건강보험 보수월액 변경은 신청입니다. 변경 사유는 담당자 기입."];
    }
    const ws = XLSX.utils.aoa_to_sheet([[D.label, periodLabel, `기한 ${due}`, "오너뷰 기록 기준 · 신고서 칸 순서(공단 EDI 업로드 양식 아님)"], [], head, ...body, [], ...notes.map((n) => [`※ ${n}`]),
      ["※ 주민등록번호가 포함된 파일입니다. 보관·전달에 주의하세요."]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, D.label.slice(0, 30));
    await saveBook(wb, `${D.label.replace(/\s|\(|\)/g, "")}_${periodKey}.xlsx`, rrn.size > 0 ? password : undefined);
    if (rrn.size > 0) toast(`주민등록번호 ${rrn.size}명분이 포함됐습니다${password ? " — 비밀번호를 걸었습니다" : ""}. 조회 기록이 남습니다`, "info");
  };

  const periodLabel = D.period === "half" ? `${year}년 ${half === 1 ? "상반기(1~6월)" : "하반기(7~12월)"}`
    : doc === "iw" ? `${month} 근무분` : doc === "im" ? `${prevOf(month)} → ${month}` : D.period === "month" ? `${month} 지급분` : `${annualYear}년${insurance ? "" : " 귀속"}`;
  const [pwAsk, setPwAsk] = useState(false);
  const [pw, setPw] = useState({ a: "", b: "" });
  const [pwBusy, setPwBusy] = useState(false);
  //   주민번호가 실제로 담길 사람이 있으면 먼저 비밀번호를 묻는다(없으면 바로 내려받기)
  const exportXlsx = async () => {
    if (!lines.length) { toast("이 기간에 해당 지급이 없습니다", "info"); return; }
    if (empIds.some((id) => rrnRegistered.has(id))) { setPw({ a: "", b: "" }); setPwAsk(true); return; }
    return runExport();
  };
  const runExport = async (password?: string) => {
    if (insurance) return exportInsurance(password);
    const rrn = empIds.length ? await fetchRrns(empIds) : new Map<string, string>();
    const idCol = (l: Line) => (l.employeeId ? rrn.get(l.employeeId) || "(미등록)" : "(세무사 기입)");
    const head = doc === "sw" ? ["이름", "주민등록번호", ...months.map((m) => `${Number(m.slice(5, 7))}월`), "합계"]
      : doc === "sd" ? ["이름", "주민등록번호", "근무일수", "과세 지급액", "비과세", "소득세", "지방소득세"]
      : doc === "aw" ? ["이름", "주민등록번호", "과세 급여", "비과세", "기납부 소득세", "기납부 지방소득세", "결정세액", "차감징수세액(환급 −)"]
      : ["이름", "주민등록번호", ...(withN ? ["건수"] : []), "지급액", "소득세", "지방소득세", "비고"];
    const body = lines.map((l) => doc === "sw" ? [l.name, idCol(l), ...months.map((m) => num(l.months?.[m] || 0)), num(l.amount)]
      : doc === "sd" ? [l.name, idCol(l), l.n || 0, num(l.amount), num(l.nonTaxable || 0), num(l.tax), num(l.local)]
      : doc === "aw" ? [l.name, idCol(l), num(l.amount), num(l.nonTaxable || 0), num(l.tax), num(l.local), l.decided != null ? num(l.decided) : "(미확정 · 세무사)", l.diff != null ? num(l.diff) : ""]
      : [l.name, idCol(l), ...(withN ? [l.n || 0] : []), num(l.amount), num(l.tax), num(l.local), l.sub || ""]);
    const ws = XLSX.utils.aoa_to_sheet([[D.label, periodLabel, `제출 기한 ${due}`, "오너뷰 기록 기준"], [], head, ...body, [],
      ["※ 주민등록번호가 포함될 수 있는 파일입니다. 보관·전달에 주의하세요. (미등록)은 구성원 상세에서 입력, (세무사 기입)은 오너뷰가 저장하지 않는 번호입니다."],
      ...(doc === "aw" ? [[`※ 결정세액은 인사 › 연말정산 자료에서 확정한 ${yeDone}명만 채웠습니다(규칙 2025년 귀속 기준 · 세무사 확인). (미확정)은 세무사 기입.`]] : []),
      ...(irpN ? [[`※ IRP 이전(과세이연) 퇴직금 ${irpN}건은 위에 없습니다 — 홈택스에서 직접.`]] : [])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, D.label.slice(0, 30));
    await saveBook(wb, `${D.label.replace(/\s|\(|\)/g, "")}_${periodKey}.xlsx`, rrn.size > 0 ? password : undefined);
    if (rrn.size > 0) toast(`주민등록번호 ${rrn.size}명분이 포함됐습니다${password ? " — 비밀번호를 걸었습니다" : ""}. 조회 기록이 남습니다`, "info");
  };
  useModalKeys(pwAsk, () => setPwAsk(false));
  const pwOk = pw.a.length >= MIN_XLSX_PASSWORD && pw.a === pw.b;
  const submitPw = async () => {
    if (!pwOk || pwBusy) return;
    setPwBusy(true);
    try { await runExport(pw.a); setPwAsk(false); setPw({ a: "", b: "" }); }
    catch (e) { toast(friendlyError(e, "엑셀을 만들지 못했습니다"), "error"); }
    finally { setPwBusy(false); }
  };
  const pwDialog = pwAsk && (
    <div className="inv-modal" onClick={() => setPwAsk(false)}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="엑셀 비밀번호">
        <div className="inv-modal-head"><h3>엑셀 비밀번호</h3><button type="button" className="inv-modal-x" onClick={() => setPwAsk(false)}>✕</button></div>
        <p className="inv-modal-desc">주민등록번호가 들어가는 파일이라 열 때 비밀번호를 묻게 합니다. 비밀번호는 오너뷰에 저장하지 않습니다 — 받는 사람(세무사 등)에게는 파일과 다른 경로로 알려 주세요.</p>
        <label className="field-label">비밀번호 ({MIN_XLSX_PASSWORD}자 이상)</label>
        <input type="password" className="field-input" autoComplete="new-password" value={pw.a} onChange={(e) => setPw((x) => ({ ...x, a: e.target.value }))} />
        <label className="field-label">한 번 더</label>
        <input type="password" className="field-input" autoComplete="new-password" value={pw.b} onChange={(e) => setPw((x) => ({ ...x, b: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") void submitPw(); }} />
        {pw.b && pw.a !== pw.b && <p className="rtf-legend vr-warn">두 비밀번호가 다릅니다.</p>}
        <div className="inv-modal-actions"><span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPwAsk(false)} disabled={pwBusy}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!pwOk || pwBusy} onClick={() => void submitPw()}>{pwBusy ? "만드는 중…" : "비밀번호 걸고 내려받기"}</button>
        </div>
      </div>
    </div>
  );

  const bar = (
    <>
      <select value={doc} onChange={(e) => setDoc(e.target.value as StmtDoc)} className="qk-input h-8 px-2.5 text-xs" aria-label="서류">
        {["간이지급명세서", "지급명세서 (연간)", "4대보험 신고"].map((g) => (
          <optgroup key={g} label={g}>{STMT_DOCS.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>
        ))}
      </select>
      {D.period !== "month" ? (
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label={D.period === "year" ? "귀속 연도" : "연도"}>
          {p.years.map((y) => <option key={y} value={y}>{y}년{D.period === "year" ? " 귀속" : ""}</option>)}
        </select>
      ) : (
        <MonthSelect className="inv-input fin-close-month" value={month} onChange={(v) => v && setMonth(v)} ariaLabel="지급월" />
      )}
      {D.period === "half" && (
        <select value={half} onChange={(e) => setHalf(Number(e.target.value) as 1 | 2)} className="qk-input h-8 px-2.5 text-xs" aria-label="반기">
          <option value={1}>상반기 (1~6월)</option><option value={2}>하반기 (7~12월)</option>
        </select>
      )}
      <span className="text-[11px] text-[var(--text-dim)]">{doc === "im" ? "제출 기한(고용·산재)" : "제출 기한"} {p.renderDue(due, dueId)} · {insurance ? (doc === "iw" ? "근로복지공단" : "4대보험 EDI") : "홈택스"}</span>
    </>
  );
  const setDeepLink = (q: { doc?: string | null; year?: number; half?: string | null; month?: string | null }) => {
    if (q.doc && STMT_DOCS.some((d) => d.key === q.doc)) setDoc(q.doc as StmtDoc); else setDoc("sw");
    if (q.year && q.year >= 2000 && q.year <= 2100) setYear(q.year);
    if (q.half === "1" || q.half === "2") setHalf(Number(q.half) as 1 | 2);
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) setMonth(q.month);
  };

  const emptyMsg = doc === "iw" ? <>원천세 탭 <b>일용근로 지급</b>에 기록하면 잡힙니다(이 서류는 <b>근무일</b> 기준).</>
    : doc === "it" ? <>그 해 급여 명세서를 발송하면 잡힙니다.</>
    : doc === "im" ? <>지난달과 이번 달 모두 발송된 급여 명세가 있고 과세 보수가 달라진 사람이 없습니다.</>
    : doc === "sb" || doc === "ab" ? <>고용형태가 <b>프리랜서</b>인 구성원의 급여 명세를 발송하면 잡힙니다.</>
    : doc === "sd" ? <>원천세 탭 <b>일용근로 지급</b>에 기록하면 잡힙니다.</>
    : doc === "ar" ? <>원천세 탭 <b>퇴직소득 지급</b>에 기록하면 잡힙니다.</>
    : needIncome ? <>원천세 탭 <b>기타·이자·배당 지급</b>에 개인에게 준 지급을 기록하면 잡힙니다.</>
    : <>급여 명세서를 발송하면 잡힙니다.</>;

  const body = loading ? <div className="collect-empty">불러오는 중…</div> : (
    <div className="vr-wrap">
      {pwDialog}
      {lines.length === 0 && <div className="collect-empty">{periodLabel} <b>{D.label}</b>에 들어갈 지급이 없습니다.<br />{emptyMsg}</div>}
      <p className="inv-hint">
        {D.label} · {periodLabel} · {doc === "it" ? <>근로자 {lines.filter((l) => l.key !== "daily-total").length}명 · 보수총액 {won(tot.amount)}</>
          : doc === "im" ? <>변경 후보 {lines.length}명</>
          : doc === "iw" ? <>일용근로자 {lines.length}명 · 근로일 {tot.n}일 · 보수총액 {won(tot.amount)} · 소득세 {won(tot.tax)}</>
          : <>사람 {lines.length}명 · 지급액 {won(tot.amount)} · 소득세 {won(tot.tax)}</>}.
        {empIds.length > 0 && (rrnMissing > 0 ? <b className="vr-warn"> 주민번호 미등록 {rrnMissing}명은 구성원 상세에서 입력하세요.</b> : ` 주민번호 ${empIds.length}명 등록됨(엑셀에만 담깁니다).`)}
        {needIncome && " 받는 사람 주민번호는 저장하지 않습니다 — 엑셀에 세무사 기입 칸."}
        {doc === "aw" && <b> 연말정산 결정세액은 인사에서 확정한 {yeDone}명만 채웁니다{lines.length - yeDone > 0 ? ` — 나머지 ${lines.length - yeDone}명은 세무사` : ""}.</b>}
        {insurance && <b> 엑셀은 신고서 칸 순서입니다 — 공단 EDI 업로드 양식이 아니라 옮겨 적거나 세무사·노무사에게 전달하는 용도입니다.</b>}
        {doc === "im" && " 일시적인 수당 때문에 달라진 사람은 낼 필요가 없습니다 — 고른 사람만 내세요."}
        {irpN > 0 && <b className="vr-warn"> IRP 이전(과세이연) {irpN}건은 빠졌습니다 — 홈택스에서 직접.</b>}
      </p>
      <TaxReturnSheet layout="list" kind={kind} companyId={p.companyId} userId={p.userId} canWrite={p.canWrite}
        periodKey={periodKey} title={`${D.label} · ${periodLabel}`}
        rows={lines.map((l) => ({ key: l.key, label: l.name, sub: l.sub }))}
        cols={doc === "iw" ? { n: "근로일수", amount: "보수총액(과세)", tax: "소득세" }
          : doc === "it" ? { n: "근무월수", amount: "보수총액" }
          : doc === "im" ? { amount: "변경 후 월 보수", tax: "변경 전 월 보수" }
          : { ...(withN ? { n: doc === "sd" ? "근무일수" : "건수" } : {}), amount: doc === "aw" ? "과세 급여" : "지급액", tax: doc === "aw" ? "기납부 소득세" : "소득세" }}
        compute={compute} sources={sources} schedules={schedules} loading={!!loading} />
      {doc === "aw" && lines.length > 0 && (
        <div className="pnl-panel">
          <h3>연말정산 결정세액</h3><p>인사 › 증명서 › 연말정산 자료에서 확정한 결과입니다. 확정 안 한 사람은 비어 있습니다.</p>
          <div className="stg-table-wrap vr-scroll">
            <table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr><th>이름</th><th>과세 급여</th><th>기납부 소득세</th><th>결정세액</th><th>환급(−)·추징(+)</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.key}><td className="text-left">{l.name}{l.sub && <span className="ev-dim"> {l.sub}</span>}</td>
                  <td className="tr mono-number">{won(l.amount)}</td><td className="tr mono-number">{won(l.tax)}</td>
                  <td className="tr mono-number">{l.decided != null ? won(l.decided) : <span className="ev-dim">미확정</span>}</td>
                  <td className="tr mono-number">{l.diff != null ? `${l.diff > 0 ? "+" : l.diff < 0 ? "−" : ""}${won(Math.abs(l.diff))}` : <span className="ev-dim">—</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {doc === "sw" && lines.length > 0 && (
        <div className="pnl-panel">
          <h3>월별 명세</h3><p>인별 월 과세 지급액(서식 작성요령) — 엑셀도 이 모양입니다.</p>
          <div className="stg-table-wrap vr-scroll">
            <table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr><th>이름</th>{months.map((m) => <th key={m}>{Number(m.slice(5, 7))}월</th>)}<th>합계</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.key}><td className="text-left">{l.name}{l.sub && <span className="ev-dim"> {l.sub}</span>}</td>
                  {months.map((m) => <td key={m} className="tr mono-number">{l.months?.[m] ? won(l.months[m]) : <span className="ev-dim">—</span>}</td>)}
                  <td className="tr mono-number"><b>{won(l.amount)}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  return { bar, body, exportXlsx, setDeepLink };
}

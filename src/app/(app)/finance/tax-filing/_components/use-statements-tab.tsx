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
//   자동으로 못 푸는 것: 연간 근로 지급명세서의 연말정산 결정세액(공제 서류) — 지급액·원천징수 합계까지, 결정세액은 세무사.

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
import { listDailyLogs, listIncomePaymentsRange } from "@/lib/wht-income-records";
import { listRetirementPayments, type RetirementPayment } from "@/lib/retirement";
import type { DailyLog, IncomePayment } from "@/lib/tax-forms/wht-income";
import type { FormFigures } from "@/lib/tax-forms/vat-form";

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
] as const;
export type StmtDoc = (typeof STMT_DOCS)[number]["key"];

/** 한 사람 한 줄 */
type Line = { key: string; name: string; sub?: string; employeeId?: string | null; n?: number; amount: number; nonTaxable?: number; tax: number; local: number; months?: Record<string, number> };

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

  const months = D.period === "half" ? halfMonths(year, half) : D.period === "month" ? [month] : Array.from({ length: 12 }, (_, i) => `${annualYear}-${String(i + 1).padStart(2, "0")}`);
  const from = `${months[0]}-01`, to = lastDay(months[months.length - 1]);
  const needPayroll = doc === "sw" || doc === "sb" || doc === "aw" || doc === "ab";
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
  const loading = (needPayroll && l1) || (doc === "sd" && l2) || (needIncome && l3) || (doc === "ar" && l4);

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
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [doc, payroll, daily, rets, pays]);
  const tot = useMemo(() => ({ amount: lines.reduce((s, l) => s + l.amount, 0), tax: lines.reduce((s, l) => s + l.tax, 0), local: lines.reduce((s, l) => s + l.local, 0), n: lines.reduce((s, l) => s + (l.n || 0), 0) }), [lines]);
  const irpN = doc === "ar" ? rets.filter((x) => x.irp_deferred).length : 0;

  //   신고본 — 기간 키(형식은 DB 제약 '^\d{4}(-[0-9A-Za-z]{1,8})?$')
  const kind = doc.startsWith("a") ? "annual_statement" : "simple_statement";
  const periodKey = D.period === "half" ? `${year}-W${half}` : D.period === "month" ? `${month.slice(0, 4)}-${doc.slice(1).toUpperCase()}${month.slice(5, 7)}` : `${annualYear}-${doc.slice(1).toUpperCase()}`;
  const withN = doc === "sd" || doc === "so" || doc === "ai" || doc === "av" || doc === "ao";
  const compute = useMemo(() => () => {
    const F: FormFigures = {};
    for (const l of lines) F[l.key] = { amount: num(l.amount), tax: num(l.tax), ...(withN ? { n: l.n || 0 } : {}) };
    F.total = { amount: num(tot.amount), tax: num(tot.tax), ...(withN ? { n: tot.n } : {}) };
    return F;
  }, [lines, tot, withN]);
  const sources = useMemo(() => ({ people: lines.map((l) => l.key) }), [lines]);
  const schedules = useMemo(() => ({ lines: lines.map(({ employeeId: _e, ...l }) => l) }), [lines]);

  //   제출 기한
  const due = D.period === "half" ? (half === 1 ? `${year}-07-31` : `${year + 1}-01-31`)
    : D.period === "month" ? nextMonthEnd(month)
    : (doc === "ai" || doc === "av" || doc === "ao") ? lastDay(`${annualYear + 1}-02`) : `${annualYear + 1}-03-10`;
  //   기한 체크 id — 근로 반기는 홈 세금 일정과 같은 id(sps-h1/h2), 연간은 aps-w/aps-o(일정에 같이 추가), 그 밖은 stmt-
  const dueId = D.period === "half" ? `${half === 1 ? "sps-h1" : "sps-h2"}-${due}`
    : D.period === "year" ? `${doc === "ai" || doc === "av" || doc === "ao" ? "aps-o" : "aps-w"}-${due}` : `stmt-${doc}-${due}`;

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

  const periodLabel = D.period === "half" ? `${year}년 ${half === 1 ? "상반기(1~6월)" : "하반기(7~12월)"}` : D.period === "month" ? `${month} 지급분` : `${annualYear}년 귀속`;
  const exportXlsx = async () => {
    if (!lines.length) { toast("이 기간에 해당 지급이 없습니다", "info"); return; }
    const rrn = empIds.length ? await fetchRrns(empIds) : new Map<string, string>();
    const idCol = (l: Line) => (l.employeeId ? rrn.get(l.employeeId) || "(미등록)" : "(세무사 기입)");
    const head = doc === "sw" ? ["이름", "주민등록번호", ...months.map((m) => `${Number(m.slice(5, 7))}월`), "합계"]
      : doc === "sd" ? ["이름", "주민등록번호", "근무일수", "과세 지급액", "비과세", "소득세", "지방소득세"]
      : doc === "aw" ? ["이름", "주민등록번호", "과세 급여", "비과세", "기납부 소득세", "기납부 지방소득세", "결정세액(세무사)"]
      : ["이름", "주민등록번호", ...(withN ? ["건수"] : []), "지급액", "소득세", "지방소득세", "비고"];
    const body = lines.map((l) => doc === "sw" ? [l.name, idCol(l), ...months.map((m) => num(l.months?.[m] || 0)), num(l.amount)]
      : doc === "sd" ? [l.name, idCol(l), l.n || 0, num(l.amount), num(l.nonTaxable || 0), num(l.tax), num(l.local)]
      : doc === "aw" ? [l.name, idCol(l), num(l.amount), num(l.nonTaxable || 0), num(l.tax), num(l.local), ""]
      : [l.name, idCol(l), ...(withN ? [l.n || 0] : []), num(l.amount), num(l.tax), num(l.local), l.sub || ""]);
    const ws = XLSX.utils.aoa_to_sheet([[D.label, periodLabel, `제출 기한 ${due}`, "오너뷰 기록 기준"], [], head, ...body, [],
      ["※ 주민등록번호가 포함될 수 있는 파일입니다. 보관·전달에 주의하세요. (미등록)은 구성원 상세에서 입력, (세무사 기입)은 오너뷰가 저장하지 않는 번호입니다."],
      ...(doc === "aw" ? [["※ 연말정산 결정세액은 공제 서류가 필요해 오너뷰가 계산하지 않습니다 — 세무사."]] : []),
      ...(irpN ? [[`※ IRP 이전(과세이연) 퇴직금 ${irpN}건은 위에 없습니다 — 홈택스에서 직접.`]] : [])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, D.label.slice(0, 30));
    XLSX.writeFile(wb, `${D.label.replace(/\s|\(|\)/g, "")}_${periodKey}.xlsx`);
    if (rrn.size > 0) toast(`주민등록번호 ${rrn.size}명분이 포함됐습니다. 조회 기록이 남습니다`, "info");
  };

  const bar = (
    <>
      <select value={doc} onChange={(e) => setDoc(e.target.value as StmtDoc)} className="qk-input h-8 px-2.5 text-xs" aria-label="서류">
        {["간이지급명세서", "지급명세서 (연간)"].map((g) => (
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
      <span className="text-[11px] text-[var(--text-dim)]">제출 기한 {p.renderDue(due, dueId)} · 홈택스</span>
    </>
  );
  const setDeepLink = (q: { doc?: string | null; year?: number; half?: string | null; month?: string | null }) => {
    if (q.doc && STMT_DOCS.some((d) => d.key === q.doc)) setDoc(q.doc as StmtDoc); else setDoc("sw");
    if (q.year && q.year >= 2000 && q.year <= 2100) setYear(q.year);
    if (q.half === "1" || q.half === "2") setHalf(Number(q.half) as 1 | 2);
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) setMonth(q.month);
  };

  const emptyMsg = doc === "sb" || doc === "ab" ? <>고용형태가 <b>프리랜서</b>인 구성원의 급여 명세를 발송하면 잡힙니다.</>
    : doc === "sd" ? <>원천세 탭 <b>일용근로 지급</b>에 기록하면 잡힙니다.</>
    : doc === "ar" ? <>원천세 탭 <b>퇴직소득 지급</b>에 기록하면 잡힙니다.</>
    : needIncome ? <>원천세 탭 <b>기타·이자·배당 지급</b>에 개인에게 준 지급을 기록하면 잡힙니다.</>
    : <>급여 명세서를 발송하면 잡힙니다.</>;

  const body = loading ? <div className="collect-empty">불러오는 중…</div> : (
    <div className="vr-wrap">
      {lines.length === 0 && <div className="collect-empty">{periodLabel} <b>{D.label}</b>에 들어갈 지급이 없습니다.<br />{emptyMsg}</div>}
      <p className="inv-hint">
        {D.label} · {periodLabel} · 사람 {lines.length}명 · 지급액 {won(tot.amount)} · 소득세 {won(tot.tax)}.
        {empIds.length > 0 && (rrnMissing > 0 ? <b className="vr-warn"> 주민번호 미등록 {rrnMissing}명은 구성원 상세에서 입력하세요.</b> : ` 주민번호 ${empIds.length}명 등록됨(엑셀에만 담깁니다).`)}
        {needIncome && " 받는 사람 주민번호는 저장하지 않습니다 — 엑셀에 세무사 기입 칸."}
        {doc === "aw" && <b> 연말정산 결정세액은 공제 서류가 필요해 계산하지 않습니다 — 지급액·기납부 세액까지입니다.</b>}
        {irpN > 0 && <b className="vr-warn"> IRP 이전(과세이연) {irpN}건은 빠졌습니다 — 홈택스에서 직접.</b>}
      </p>
      <TaxReturnSheet layout="list" kind={kind} companyId={p.companyId} userId={p.userId} canWrite={p.canWrite}
        periodKey={periodKey} title={`${D.label} · ${periodLabel}`}
        rows={lines.map((l) => ({ key: l.key, label: l.name, sub: l.sub }))}
        cols={{ ...(withN ? { n: doc === "sd" ? "근무일수" : "건수" } : {}), amount: doc === "aw" ? "과세 급여" : "지급액", tax: doc === "aw" ? "기납부 소득세" : "소득세" }}
        compute={compute} sources={sources} schedules={schedules} loading={!!loading} />
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

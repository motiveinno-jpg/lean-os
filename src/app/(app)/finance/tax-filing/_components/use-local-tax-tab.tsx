"use client";

// ── 재무 › 세무 신고 › 지방세 (2026-10-14) — 법인지방소득세 · 주민세 종업원분 · 주민세 사업소분 ──
//   계산은 lib/tax-forms/local-tax.ts. 지방세는 국세(법인세 신고본·급여 명세)에서 따라 나오는 숫자라 따로 마감하지 않는다 —
//   법인세를 마감하면 법인지방소득세 과세표준도 그 숫자를 따른다. 위택스 제출은 사람이 한다(엑셀·화면 숫자를 옮겨 적는다).
//   사람 칸(공제·가산세·자본금·연면적·면세점)은 이 화면에만 있고 저장하지 않는다 — 조회값 자동 기억 금지(조회 화면 표준).

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { MonthSelect } from "@/components/month-select";
import { CurrencyInput } from "@/components/currency-input";
import { listTaxReturns, latestClosed } from "@/lib/tax-returns";
import { computeStatements } from "@/lib/closing-snapshot";
import { toWhtRows, WHT_SELECT } from "@/lib/tax-forms/wht-rows";
import { listDailyLogs } from "@/lib/wht-income-records";
import { localCitOf, localCitReturn, employeeTax, EMPLOYEE_TAX_EXEMPT, businessPlaceTax } from "@/lib/tax-forms/local-tax";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);
const prevMonth = () => { const t = todayKst(); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const monthsBack = (ym: string, n: number) => { const out: string[] = []; let [y, m] = ym.split("-").map(Number); for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } } return out; };

export const LOCAL_DOCS = [
  { key: "lc", label: "법인지방소득세 신고서", period: "year" },
  { key: "le", label: "주민세 종업원분 (월)", period: "month" },
  { key: "lb", label: "주민세 사업소분 (연)", period: "year" },
] as const;
type LocalDoc = (typeof LOCAL_DOCS)[number]["key"];

export function useLocalTaxTab(p: { companyId: string | null; enabled: boolean; years: number[]; renderDue: (date: string, id: string) => ReactNode }) {
  const { toast } = useToast();
  const t = todayKst();
  const [doc, setDoc] = useState<LocalDoc>("lc");
  const [year, setYear] = useState<number>(() => (Number(t.slice(5, 7)) <= 4 ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4))));
  const [month, setMonth] = useState<string>(prevMonth);
  const [credit, setCredit] = useState(""); const [penalty, setPenalty] = useState(""); const [prepaid, setPrepaid] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(String(EMPLOYEE_TAX_EXEMPT));
  const [capital, setCapital] = useState(""); const [area, setArea] = useState("");
  const D = LOCAL_DOCS.find((d) => d.key === doc)!;

  // ─── 법인지방소득세: 법인세 신고본(과세표준·원천납부) → 없으면 예상 ───
  const { data: citBase, isLoading: l1 } = useQuery({
    queryKey: ["local-cit-base", p.companyId, year], enabled: !!p.companyId && p.enabled && doc === "lc",
    queryFn: async () => {
      const filed = latestClosed(await listTaxReturns(p.companyId!, "cit", String(year)));
      if (filed) return { base: Math.round(Number(filed.figures?.BASE?.amount || 0)), whtPrepaid: Math.floor(Math.round(Number(filed.figures?.PRE_WHT?.amount || 0)) / 10), source: `${year}년 법인세 신고본(마감한 숫자)의 과세표준` };
      const st = await computeStatements(p.companyId!, `${year}-12`);
      const taxExp = (st.pnl || []).filter((x) => String(x.code || "") === "998").reduce((s, x) => s + Number(x.ytd || 0), 0);
      return { base: Math.max(0, Math.round((st.totals.ytdNet || 0) + taxExp)), whtPrepaid: 0, source: "오너뷰 예상(세무조정 전 회계이익) — 법인세를 마감하면 그 과세표준을 따릅니다" };
    },
  });

  // ─── 종업원분: 그 달 + 최근 12개월 급여총액(과세, 근로 + 일용) ───
  const m12 = useMemo(() => monthsBack(month, 12), [month]);
  const { data: pay12, isLoading: l2 } = useQuery({
    queryKey: ["local-emp-pay", p.companyId, ...m12], enabled: !!p.companyId && p.enabled && doc === "le",
    queryFn: async () => {
      const rows = toWhtRows(logRead("local-tax:pay", await (supabase as any).from("payroll_items").select(WHT_SELECT).eq("company_id", p.companyId!).in("period_month", m12).limit(20000)) as any[]).filter((r) => !r.biz);
      const daily = await listDailyLogs(p.companyId!, month);
      const byMonth: Record<string, number> = {};
      for (const r of rows) byMonth[r.period_month] = (byMonth[r.period_month] || 0) + r.taxable;
      const dailyTotal = daily.reduce((s, r) => s + Math.max(0, r.daily_wage - r.non_taxable), 0);
      return { byMonth, dailyTotal, people: rows.filter((r) => r.period_month === month).length };
    },
  });
  const loading = (doc === "lc" && l1) || (doc === "le" && l2);

  const lc = useMemo(() => {
    const base = citBase?.base || 0;
    const pre = prepaid !== null ? Number(prepaid || 0) : (citBase?.whtPrepaid || 0);
    return { base, br: localCitOf(base).brackets, pre, ...localCitReturn(base, { credit: Number(credit || 0), penalty: Number(penalty || 0), prepaid: pre }) };
  }, [citBase, credit, penalty, prepaid]);
  const le = useMemo(() => {
    const monthTotal = (pay12?.byMonth[month] || 0) + (pay12?.dailyTotal || 0);
    const vals = m12.map((m) => pay12?.byMonth[m] || 0);
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / 12);
    return { monthTotal, avg, ...employeeTax(monthTotal, avg, Number(threshold || 0)) };
  }, [pay12, m12, month, threshold]);
  const lb = useMemo(() => businessPlaceTax(Number(capital || 0), Number(area || 0)), [capital, area]);

  const due = doc === "lc" ? `${year + 1}-04-30` : doc === "le" ? (() => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`; })() : `${year}-08-31`;
  const dueId = doc === "lc" ? `cit-local-${due}` : `local-${doc}-${due}`;

  const exportXlsx = () => {
    const rows: (string | number)[][] = doc === "lc"
      ? [["법인지방소득세 신고서", `${year} 사업연도`, `기한 ${due}`, citBase?.source || ""], [], ["구간", "과세표준", "세율", "세액"], ...lc.br.map((b) => [b.label, num(b.amt), `${(b.rate * 100).toFixed(1)}%`, num(b.tax)]),
          [], ["과세표준", num(lc.base)], ["산출세액", num(lc.calc)], ["공제·감면세액", num(Number(credit || 0))], ["가산세", num(Number(penalty || 0))], ["총부담세액", num(lc.total)], ["기납부(특별징수 등)", num(lc.pre)], ["차감 납부할 세액", num(lc.pay)]]
      : doc === "le"
      ? [["주민세 종업원분", `${month} 귀속`, `기한 ${due}`], [], ["그 달 급여총액(과세, 근로+일용)", num(le.monthTotal)], ["최근 12개월 월평균 급여총액", num(le.avg)], ["면세점", num(Number(threshold || 0))], ["면세 여부", le.exempt ? "면세(월평균이 면세점 이하)" : "과세"], ["세율", "0.5%"], ["납부세액", num(le.tax)]]
      : [["주민세 사업소분", `${year}년 (8월 1일 기준)`, `기한 ${due}`], [], ["자본금(출자금)", num(Number(capital || 0))], ["사업소 연면적(㎡)", Number(area || 0)], ["기본세액", num(lb.base)], ["연면적분(330㎡ 초과 시 ㎡당 250원)", num(lb.area)], ["합계", num(lb.total)]];
    const ws = XLSX.utils.aoa_to_sheet([...rows, [], ["※ 오너뷰 계산 · 위택스에서 확인·제출하세요. 여러 시·군·구에 사업장이 있으면 안분은 세무사와."]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, D.label.slice(0, 30));
    XLSX.writeFile(wb, `${D.label.replace(/\s|\(|\)/g, "")}_${doc === "le" ? month : year}.xlsx`);
    toast("엑셀을 내려받았습니다. 위택스에서 확인·제출하세요", "success");
  };

  const bar = (
    <>
      <select value={doc} onChange={(e) => setDoc(e.target.value as LocalDoc)} className="qk-input h-8 px-2.5 text-xs" aria-label="서류">
        {LOCAL_DOCS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      {D.period === "year"
        ? <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">{p.years.map((y) => <option key={y} value={y}>{y}년{doc === "lc" ? " 사업연도" : ""}</option>)}</select>
        : <MonthSelect className="inv-input fin-close-month" value={month} onChange={(v) => v && setMonth(v)} ariaLabel="귀속월" />}
      <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 {p.renderDue(due, dueId)} · 위택스</span>
    </>
  );

  const moneyRow = (label: string, value: ReactNode, sum = false) => <tr className={sum ? "rtf-sum" : undefined}><td className="rtf-label">{label}</td><td className="rtf-num">{value}</td></tr>;
  const input = (v: string, set: (x: string) => void, ph = "0") => <CurrencyInput className="rtf-input" value={v} placeholder={ph} onValueChange={set} />;

  const body = loading ? <div className="collect-empty">계산하는 중…</div> : (
    <div className="vr-wrap">
      {doc === "lc" && (<>
        <p className="inv-hint">과세표준 = {citBase?.source}. 세율은 법인세 구간의 1/10(0.9~2.4%)입니다. 여러 시·군·구에 사업장이 있으면 종업원 수·건축물 면적으로 안분합니다 — 세무사.</p>
        <table className="rtf-table rtf-refund">
          <thead><tr><th>법인지방소득세 · {year} 사업연도</th><th>금액</th></tr></thead>
          <tbody>
            {moneyRow("과세표준 (법인세 과세표준과 같음)", won(lc.base))}
            {lc.br.map((b) => moneyRow(`  ${b.label} × ${(b.rate * 100).toFixed(1)}%`, won(b.tax)))}
            {moneyRow("산출세액", won(lc.calc), true)}
            {moneyRow("− 공제·감면세액 (직접 입력)", input(credit, setCredit))}
            {moneyRow("+ 가산세 (직접 입력)", input(penalty, setPenalty))}
            {moneyRow("총부담세액", won(lc.total), true)}
            {moneyRow("− 기납부: 특별징수 등 (법인세 원천납부의 10% 기본값)", input(prepaid !== null ? prepaid : String(citBase?.whtPrepaid || ""), (v) => setPrepaid(v)))}
            {moneyRow("차감 납부할 세액 (음수 = 환급)", won(lc.pay), true)}
          </tbody>
        </table>
      </>)}
      {doc === "le" && (<>
        <p className="inv-hint">그 달 종업원 급여총액(비과세 제외 · 근로 {pay12?.people ?? 0}명 + 일용) × 0.5%. 최근 12개월 월평균 급여총액이 면세점 이하면 내지 않습니다(지방세법 84조의4) — 면세점은 개정될 수 있어 칸에서 고칠 수 있습니다.</p>
        <table className="rtf-table rtf-refund">
          <thead><tr><th>주민세 종업원분 · {month}</th><th>금액</th></tr></thead>
          <tbody>
            {moneyRow("그 달 급여총액 (과세)", won(le.monthTotal))}
            {moneyRow("최근 12개월 월평균 급여총액", won(le.avg))}
            {moneyRow("면세점 (직접 수정 가능)", input(threshold, setThreshold))}
            {moneyRow(le.exempt ? "면세 — 월평균이 면세점 이하" : "과세 대상", le.exempt ? "0" : "0.5%")}
            {moneyRow("납부세액", won(le.tax), true)}
          </tbody>
        </table>
      </>)}
      {doc === "lb" && (<>
        <p className="inv-hint">8월 1일 현재 사업소 기준 · 기본세액(법인 자본금 30억 이하 5만 · 50억 이하 10만 · 초과 20만) + 연면적 330㎡ 초과 시 연면적 × 250원. 자본금·연면적은 오너뷰에 없어 직접 넣습니다.</p>
        <table className="rtf-table rtf-refund">
          <thead><tr><th>주민세 사업소분 · {year}년</th><th>금액</th></tr></thead>
          <tbody>
            {moneyRow("자본금 (출자금, 직접 입력)", input(capital, setCapital))}
            {moneyRow("사업소 연면적 ㎡ (직접 입력)", <input className="rtf-input" value={area} placeholder="0" onChange={(e) => setArea(e.target.value.replace(/[^0-9.]/g, ""))} />)}
            {moneyRow("기본세액", won(lb.base))}
            {moneyRow("연면적분", won(lb.area))}
            {moneyRow("합계", won(lb.total), true)}
          </tbody>
        </table>
      </>)}
      <p className="rtf-legend">지방세는 법인세·급여에서 따라 나오는 숫자라 따로 마감하지 않습니다. 직접 입력 칸은 이 화면에만 있고 저장되지 않습니다 — 엑셀로 내려받아 두세요.</p>
    </div>
  );

  return { bar, body, exportXlsx };
}

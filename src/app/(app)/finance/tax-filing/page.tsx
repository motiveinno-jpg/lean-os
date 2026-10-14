"use client";
import { MonthSelect } from "@/components/month-select";

// ── 재무 › 세무 신고 — 원천세 · 부가세 · 지급명세서 (2026-08-31 세무 1·2차, docs/20260831_PLAN_tax_module.md 결정 100~103·107) ──
//
//   History: 부가세만 분석 › 부가세 › '신고서 준비'가 있었고, 원천세는 급여에서 계산(간이세액표)만 하고
//   매월 10일 신고서(원천징수이행상황신고서)는 밖에서 손으로 만들었다. 신고는 '분석'이 아니라 매월 하는
//   업무라 재무 그룹에 자리를 새로 팠다(결정 107). 부가세 신고서 준비(VatReturn)는 여기로 옮겨 왔고,
//   분석 › 부가세에는 예상·집계만 남았다(옛 딥링크 ?tab=return 은 이쪽으로 넘어온다).
//
//   결정 100 — 오너뷰는 신고서 완성·세무사 엑셀·기한까지. **제출은 홈택스에서 사람이 한다**(국세청 제출 API 없음).
//   결정 101 — 원천세 신고서 기준 = **발송된 급여 명세(payroll_items 스냅샷)**. 초안·미리보기는 안 들어간다.
//     과세 지급총액 = 과세 기본급 + 과세 수당(extras allowance). 비과세(식대)는 총지급액에서 빠진다(서식 작성요령).
//     무실적 달도 '0원 신고 대상'으로 보여 준다 — 지급이 없어도 신고는 해야 한다.
//   결정 102 (2차) — 사업소득자(고용형태 '프리랜서') 지급은 급여 엔진이 3.3%로 계산해 A25 칸으로 갈린다.
//     근로/사업 구분은 **지금 고용형태** 기준(스냅샷엔 없다) — 고용형태를 바꾸면 지난 달 구분도 따라간다고 적는다.
//   결정 103 (2차) — 간이지급명세서: 근로(반기)·사업소득(매월) 인별 명세 + 엑셀. 전자제출 파일 포맷은 4차.
//   자동으로 못 푸는 것: 기타소득 지급분 — 오너뷰가 기록하지 않는다. 있으면 사람이 더해야 한다고 화면에 적는다.
//   퇴직소득 (2026-10-07 ERP 3차 A) — 아래 '퇴직소득 지급'에 기록한 것(retirement_payments)이 지급월 A22(그 외)·A20(가감계)로
//     들어간다. IRP 이전(과세이연) 건은 자동 반영에서 빼고 "직접 신고"로 따로 보인다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { getCurrentUser } from "@/lib/queries";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup } from "@/components/query-kit";
import { VatReturn, VAT_PERIODS, VAT_DOCS, vatFilingNow, vatDueDate, type VatPeriodKey, type VatDocKey } from "@/app/(app)/reports/vat/_components/VatReturn";
import { computeStatements } from "@/lib/closing-snapshot";
import { TaxReturnSheet } from "@/components/tax-return-sheet";
import { listTaxReturns, latestClosed } from "@/lib/tax-returns";
import type { FormFigures } from "@/lib/tax-forms/vat-form";
import { computeWhtForm } from "@/lib/tax-forms/wht-form";
import { citOf, computeCitForm, CIT_LINES } from "@/lib/tax-forms/cit-form";
import { toWhtRows, aggOf, WHT_SELECT, type WhtRow } from "@/lib/tax-forms/wht-rows";
import { useStatementsTab } from "./_components/use-statements-tab";
import { useLocalTaxTab } from "./_components/use-local-tax-tab";
import { listFixedAssets, faCategoryLabel } from "@/lib/fixed-assets";
import { fetchJournalLines } from "@/lib/journal-reports";
import { friendlyError } from "@/lib/friendly-error";
import { downloadNtsBytes, type NtsIssue } from "@/lib/nts-efile";
import { buildWhtEfile, type WhtEfileRow } from "@/lib/nts-wht-efile";
import { VatEfileDialog } from "@/components/vat-efile-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import { fetchTaxDeadlineChecks, setTaxDeadlineChecked, taxCheckTitle, type TaxCheckInfo } from "@/lib/tax-deadline-checks";
import { listRetirementPayments, type RetirementPayment } from "@/lib/retirement";
import { RetirementPaymentDialog } from "@/components/retirement-payment-dialog";
import { DailyLogDialog, IncomePaymentDialog } from "@/components/wht-income-dialogs";
import { listDailyLogs, listIncomePayments } from "@/lib/wht-income-records";
import { whtIncomeAgg, INCOME_KIND_LABEL, type DailyLog, type IncomePayment } from "@/lib/tax-forms/wht-income";
import { entertainmentLimit, isEntertainmentAccount, isSalesAccount } from "@/lib/entertainment-limit";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);

/** 지난달 YYYY-MM — 이번 달 10일에 신고할 대상은 지난달 지급분이다 */
function prevMonth(): string {
  const t = todayKst();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
/** 신고·납부 기한 = 지급월 다음 달 10일 */
function dueOf(month: string): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`;
}
const daysLeftOf = (d: string) => Math.round((new Date(d).getTime() - new Date(todayKst()).getTime()) / 86400000);
/** 기한 색 — 7일 안이면 주의, 지났으면 위험. 그 밖엔 검정 (2026-09-03 후속: 기한이 눈에 띄게).
 *  done/onToggle 이 오면 옆에 '납부 완료' 체크 — 홈 세금 일정 위젯과 같은 표(tax_deadline_checks)라 어느 쪽에서 눌러도 같이 바뀐다. */
function DueDate({ d, done, doneInfo, onToggle }: { d: string; done?: boolean; doneInfo?: TaxCheckInfo; onToggle?: (on: boolean) => void }) {
  const left = daysLeftOf(d);
  const cls = done ? "mono-number tax-due-done" : left < 0 ? "mono-number tax-due-over" : left <= 7 ? "mono-number tax-due-soon" : "mono-number";
  //   완료면 누가·언제 체크했는지(2026-09-28) — 체크한 사람이 아니면 "정말 냈나"를 물어볼 곳이 없었다
  return (<>
    <b className={cls} title={done ? taxCheckTitle(doneInfo) : left < 0 ? `${-left}일 지났습니다` : left === 0 ? "오늘까지" : `${left}일 남았습니다`}>{d}{done ? " · 납부 완료" : left < 0 ? " · 지남" : left <= 7 ? ` · D-${left}` : ""}</b>
    {onToggle && (
      <button type="button" aria-label={done ? "납부 완료 해제" : "납부 완료로 표시"}
        title={done ? `${taxCheckTitle(doneInfo)} · 누르면 해제` : "신고/납부를 마쳤으면 체크 · 홈 세금 신호·브리핑에서 빠집니다"}
        onClick={() => onToggle(!done)} className={done ? "dash-tax-chk tax-due-chk dash-tax-chk-on" : "dash-tax-chk tax-due-chk"}>{done ? "✓" : ""}</button>
    )}
  </>);
}
/** 반기의 여섯 달 (h=1 → 01~06, h=2 → 07~12) */


export default function TaxFilingPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u: any) => { if (u?.company_id) setCompanyId(u.company_id); if (u?.id) setUserId(u.id); }); }, []);

  const [tab, setTab] = useState<"wht" | "vat" | "cit" | "local" | "stmt">(() => {
    const t = searchParams?.get("tab");
    return t === "vat" ? "vat" : t === "cit" ? "cit" : t === "local" ? "local" : t === "stmt" ? "stmt" : "wht";
  });
  //   홈 세금 일정 딥링크 ?tab=wht&month=YYYY-MM (2026-09-03 후속)
  const [month, setMonth] = useState(() => { const q = searchParams?.get("month"); return q && /^\d{4}-\d{2}$/.test(q) ? q : prevMonth(); });
  //   부가세·법인세가 같이 쓰는 연도. 기본값 = 지금 신고할 기수의 해(1/1~25 은 지난해 2기 확정 → 지난해; 법인세도 그 해 3/31 신고라 같다).
  //   홈 세금 일정 딥링크(?tab=vat&year=&period=)가 있으면 그 기수를 그대로 연다 (2026-09-03 후속).
  const [year, setYear] = useState(() => { const q = Number(searchParams?.get("year")); return q >= 2000 && q <= 2100 ? q : vatFilingNow().year; });
  const years = useMemo(() => { const y = Number(todayKst().slice(0, 4)); return [y, y - 1, y - 2]; }, []);
  const [vatPeriod, setVatPeriod] = useState<VatPeriodKey>(() => { const q = searchParams?.get("period"); return VAT_PERIODS.some((p) => p.key === q) ? (q as VatPeriodKey) : vatFilingNow().key; });
  //   부가세 서류(신고서·부속서류) — 한 줄 셀렉트. 기억하지 않는다(나갔다 오면 신고서)
  const [vatDoc, setVatDoc] = useState<VatDocKey>("return");
  const vatExportRef = useRef<(() => void) | null>(null);   // VatReturn 이 집계 후 채운다 — 조회 줄 [세무사 전달 엑셀]

  //   ── 납부 완료 체크 + 다가오는 신고 요약 줄 (2026-09-03 후속) ──
  //   체크는 홈 세금 일정 위젯과 같은 쿼리 키·같은 표. 요약 줄은 홈과 같은 달력(getUpcomingTaxDeadlines 60일)에서
  //   세무 신고로 오는 것만, 완료 체크된 것은 뺀다. 누르면 그 탭·그 기간으로(딥링크 href 를 그대로 해석).
  const qc = useQueryClient();
  const { data: taxChecked = new Map<string, TaxCheckInfo>() } = useQuery({
    queryKey: ["tax-deadline-checks", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: () => fetchTaxDeadlineChecks(companyId!),
  });
  const toggleChecked = async (id: string, on: boolean) => {
    if (!companyId) return;
    try {
      await setTaxDeadlineChecked(companyId, id, userId, on);
      qc.invalidateQueries({ queryKey: ["tax-deadline-checks"] });
      toast(on ? "납부 완료로 표시했습니다. 홈 세금 신호·브리핑에서 빠집니다" : "완료 표시를 해제했습니다", "success");
    } catch (e: any) { toast(friendlyError(e, "표시에 실패했습니다"), "error"); }
  };
  //   4대보험(ins-) 도 같이 — 세무 신고 화면은 아니지만 매월 10일 같이 챙기는 납부라 요약 줄에서 빠지면 잊는다(2026-09-28). 누르면 전표 현황 결산 초안으로.
  const router = useRouter();
  const upcoming = useMemo(() => getUpcomingTaxDeadlines(60).filter((t) => t.href.startsWith("/finance/tax-filing") || t.id.startsWith("ins-")), []);
  const upcomingOpen = upcoming.filter((t) => !taxChecked.has(t.id)).slice(0, 4);
  const goDeepLink = (href: string) => {
    if (!href.startsWith("/finance/tax-filing")) { router.push(href); return; }
    const sp = new URL(href, "http://x").searchParams;
    const t = sp.get("tab");
    setTab(t === "vat" ? "vat" : t === "cit" ? "cit" : t === "local" ? "local" : t === "stmt" ? "stmt" : "wht");
    const m = sp.get("month"); if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
    const y = Number(sp.get("year")); const per = sp.get("period"); const half = sp.get("half");
    if (t === "vat" || t === "cit") { if (y >= 2000 && y <= 2100) setYear(y); }
    if (VAT_PERIODS.some((p) => p.key === per)) setVatPeriod(per as VatPeriodKey);
    if (t === "stmt") stmt.setDeepLink({ doc: sp.get("doc"), year: y, half, month: sp.get("month") });
  };

  const { data: rows = [], isLoading } = useQuery<WhtRow[]>({
    queryKey: ["wht-items", companyId, month],
    enabled: !!companyId && tab === "wht",
    queryFn: async () => toWhtRows(logRead("tax-filing:wht", await (supabase as any).from("payroll_items")
      .select(WHT_SELECT).eq("company_id", companyId!).eq("period_month", month)) as any[]),
  });
  //   퇴직금 지급 기록 · 지급일이 이 달인 것 (2026-10-07 ERP 3차 A). 읽기는 RLS 가 급여 권한자·마스터로 좁힌다(payroll_items 와 같다)
  const canWriteRetire = isMaster || hasPerm("/employees:salary");
  const [retDialog, setRetDialog] = useState<{ edit: RetirementPayment | null } | null>(null);
  const { data: retRows = [], isLoading: retLoading } = useQuery<RetirementPayment[]>({
    queryKey: ["retirement-payments", companyId, month],
    enabled: !!companyId && tab === "wht",
    queryFn: () => {
      const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
      return listRetirementPayments(companyId!, `${month}-01`, `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`);
    },
  });
  //   일용 근무 기록·기타/이자/배당 지급 기록 (2026-10-14 세무 2차 4단계, 결정 262) — 지급일이 이 달인 것.
  //   일용은 급여 권한(RLS), 지급 기록은 세무 신고 권한으로 읽힌다 — 권한이 없으면 빈 목록이라 신고서에서도 빠진다(패널에 적는다)
  const [dailyDialog, setDailyDialog] = useState<{ edit: DailyLog | null } | null>(null);
  const [payDialog, setPayDialog] = useState<{ edit: IncomePayment | null } | null>(null);
  const { data: dailyLogs = [], isLoading: dailyLoading } = useQuery<DailyLog[]>({
    queryKey: ["daily-work-logs", companyId, month], enabled: !!companyId && tab === "wht",
    queryFn: () => listDailyLogs(companyId!, month),
  });
  const { data: incomePays = [], isLoading: payLoading } = useQuery<IncomePayment[]>({
    queryKey: ["income-payments", companyId, month], enabled: !!companyId && tab === "wht",
    queryFn: () => listIncomePayments(companyId!, month),
  });

  //   법인세 예상 (결정 104) — 마감·재무제표와 같은 lib(computeStatements = 확정 전표)로 연간 손익을 계산한다.
  //   12월로 부르면 연초~연말 누적(ytd) — 진행 중인 해는 지금까지 확정분만 잡힌다.
  const { data: citStmt, isLoading: citLoading } = useQuery({
    queryKey: ["cit-stmt", companyId, year],
    enabled: !!companyId && tab === "cit",
    queryFn: () => computeStatements(companyId!, `${year}-12`),
  });
  //   기업업무추진비 한도 (2026-10-07 ERP 3차 C) — 중소기업 여부는 회사 설정에 칸이 없어 화면에서 고른다(기본 중소기업:
  //   오너뷰 고객 대부분이 5~20명 회사). 값은 기억하지 않는다(조회값 자동 기억 금지).
  const [citSme, setCitSme] = useState(true);
  const cit = useMemo(() => {
    const pnl = citStmt?.pnl || [];
    //   과세표준은 법인세비용 차감 전 이익 — 손익의 당기순이익엔 998 법인세비용이 이미 빠져 있어 더해 준다
    const taxExpense = pnl.filter((p) => String(p.code || "") === "998").reduce((s, p) => s + Number(p.ytd || 0), 0);
    const income = Math.round((citStmt?.totals.ytdNet || 0) + taxExpense);
    //   한도 초과분은 손금불산입 → 과세표준에 더한다. 수입금액 = 매출 계정(401~450) 순액
    const entLines = pnl.filter((p) => p.nature === "expense" && isEntertainmentAccount(p.code, p.name));
    const sales = Math.round(pnl.filter((p) => p.nature === "revenue" && isSalesAccount(p.code)).reduce((s, p) => s + Number(p.ytd || 0), 0));
    const ent = entertainmentLimit(entLines.reduce((s, p) => s + Number(p.ytd || 0), 0), sales, citSme);
    const base = income + ent.excess;
    const c = citOf(base);
    const local = Math.floor(c.total * 0.1);
    return { income, base, entLines, sales, ent, ...c, local, sum: c.total + local, taxExpense, net: Math.round(citStmt?.totals.ytdNet || 0) };
  }, [citStmt, citSme]);
  //   ── 법인세 신고본 마감 (2026-10-14 세무 2차 후속) — 세무사가 확정한 숫자를 남긴다. 오너뷰 계산은 기본값.
  //   전기 신고본에서: 이월결손금 잔액(LOSS_BAL) → 올해 공제 한도·전기 잔액, 중간예납 기준액(NEXT_INTERIM) → 올해 기납부 중간예납
  const { data: prevCitReturns = [] } = useQuery({
    queryKey: ["tax-returns", companyId, "cit", String(year - 1)], enabled: !!companyId && tab === "cit",
    queryFn: () => listTaxReturns(companyId!, "cit", String(year - 1)),
  });
  const prevCit = latestClosed(prevCitReturns);
  const priorLoss = Math.max(0, Math.round(Number(prevCit?.figures?.LOSS_BAL?.amount || 0)));
  const priorInterim = Math.max(0, Math.round(Number(prevCit?.figures?.NEXT_INTERIM?.amount || 0)));
  const citDefaults = useMemo<FormFigures>(() => {
    const add = Math.round(cit.taxExpense + cit.ent.excess);
    const m: FormFigures = {};
    if (add) m.ADD = { amount: add };
    const inc = cit.net + add;
    const loss = Math.min(priorLoss, Math.max(0, inc));
    if (loss) m.LOSS = { amount: loss };
    if (priorInterim) m.PRE_INTERIM = { amount: priorInterim };
    return m;
  }, [cit, priorLoss, priorInterim]);
  const citNote = [
    cit.taxExpense || cit.ent.excess ? `익금산입·손금불산입 기본값 = 법인세비용 ${won(cit.taxExpense)} + 기업업무추진비 한도초과 ${won(cit.ent.excess)}.` : "",
    prevCit ? `${year - 1}년 신고본에서 이월결손금 잔액 ${won(priorLoss)}·중간예납 기준액 ${won(priorInterim)}을 가져왔습니다.` : `${year - 1}년 법인세 신고본이 없어 이월결손금·중간예납은 0에서 시작합니다(있으면 직접 넣으세요).`,
    "세무사가 확정한 신고 숫자로 고친 뒤 마감하세요. 이월결손금 공제 한도는 중소기업 100%·일반 80% — 기본값은 100%입니다.",
  ].filter(Boolean).join(" ");
  const citCompute = useMemo(() => (m: FormFigures) => computeCitForm({ netIncome: cit.net, priorLoss }, m), [cit.net, priorLoss]);
  const citSources = useMemo(() => ({ year: [String(year)] }), [year]);
  const [packBusy, setPackBusy] = useState(false);

  //   ── 전자신고 파일 베타 (세무 4차, 결정 106). feature_rollout 'tax_efile' 게이트: 모티브 먼저,
  //   홈택스 변환 검증 + 세무사 검토로 실신고 1회 통과 후 전체 오픈 ──
  const  { data: efileOn = false } = useQuery({
    queryKey: ["feature-tax-efile", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("feature_on", { p_feature: "tax_efile", p_company: companyId });
      return !!data;
    },
  });
  //   부가세 전자신고 파일 (2026-10-08 ERP 3차 D) — 원천세와 별도 게이트 'tax_efile_vat': 모티브 먼저, 홈택스 변환 검증 + 실신고 통과 후 전체
  const { data: vatEfileOn = false } = useQuery({
    queryKey: ["feature-tax-efile-vat", companyId],
    enabled: !!companyId,
    queryFn: async () => !!(await (supabase as any).rpc("feature_on", { p_feature: "tax_efile_vat", p_company: companyId })).data,
  });
  const [vatEfileOpen, setVatEfileOpen] = useState(false);
  const [efileOpen, setEfileOpen] = useState(false);
  useModalKeys(efileOpen, () => setEfileOpen(false));
  //   홈택스 사용자ID — 회사 상수라 브라우저에 기억해 준다(조회 조건이 아니라 설정값)
  const [hometaxId, setHometaxId] = useState("");
  useEffect(() => {
    if (!efileOpen || typeof window === "undefined") return;
    try { setHometaxId(window.sessionStorage.getItem(`ov.hometax-id.${companyId}`) || ""); } catch { /* 시크릿 등 */ }
  }, [efileOpen, companyId]);
  const { data: companyInfo } = useQuery({
    queryKey: ["efile-company", companyId],
    enabled: !!companyId && efileOpen,
    queryFn: async () => {
      const data = logRead("tax-filing:company", await (supabase as any).from("companies")
        .select("name, business_number, representative, address, phone").eq("id", companyId!).maybeSingle());
      return (data || null) as { name: string; business_number: string | null; representative: string | null; address: string | null; phone: string | null } | null;
    },
  });
  const [efileIssues, setEfileIssues] = useState<NtsIssue[]>([]);
  const makeEfile = () => {
    if (!companyInfo) return;
    try { if (typeof window !== "undefined") window.sessionStorage.setItem(`ov.hometax-id.${companyId}`, hometaxId.trim()); } catch { /* 무시 */ }
    const { work, biz, ret, sum, daily, other, interest, dividend } = T;
    const efRows: WhtEfileRow[] = [
      { code: "A01" as const, n: work.n, pay: work.taxable, tax: work.incomeTax },
      //   4단계 — 일용(A03), 근로 가감계(A10) = A01 + A03
      ...(daily.n > 0 ? [{ code: "A03" as const, n: daily.n, pay: daily.pay, tax: daily.tax }] : []),
      { code: "A10" as const, n: work.n + daily.n, pay: work.taxable + daily.pay, tax: work.incomeTax + daily.tax },
      //   퇴직소득 그 외(A22)·가감계(A20) — 규격 원천징수소득코드표 (원천신고 전산매체 제출요령 V2)
      ...(ret.n > 0 ? [
        { code: "A22" as const, n: ret.n, pay: ret.pay, tax: ret.incomeTax },
        { code: "A20" as const, n: ret.n, pay: ret.pay, tax: ret.incomeTax },
      ] : []),
      ...(biz.n > 0 ? [
        { code: "A25" as const, n: biz.n, pay: biz.taxable, tax: biz.incomeTax },
        { code: "A30" as const, n: biz.n, pay: biz.taxable, tax: biz.incomeTax },
      ] : []),
      ...(other.n > 0 ? [
        { code: "A42" as const, n: other.n, pay: other.pay, tax: other.tax },
        { code: "A40" as const, n: other.n, pay: other.pay, tax: other.tax },
      ] : []),
      ...(interest.n > 0 ? [{ code: "A50" as const, n: interest.n, pay: interest.pay, tax: interest.tax }] : []),
      ...(dividend.n > 0 ? [{ code: "A60" as const, n: dividend.n, pay: dividend.pay, tax: dividend.tax }] : []),
      { code: "A99" as const, n: sum.n, pay: sum.taxable, tax: sum.incomeTax },
    ].filter((r) => r.n > 0 || r.pay > 0 || r.tax !== 0);
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    const built = buildWhtEfile({
      bizNo: companyInfo.business_number || "",
      hometaxId,
      companyName: companyInfo.name || "",
      ceoName: companyInfo.representative || "",
      address: companyInfo.address || "", phone: companyInfo.phone || "",
      yearMonth: month,
      submitYm: m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`,
      madeOn: todayKst(),
      rows: efRows,
      //   7단계 — 환급세액 조정(서식에서 계산한 값 그대로)
      refund: (() => { const g = (k: string) => Math.round(Number(whtLive[k]?.tax || 0)); return { r12: g("R12"), r13: g("R13"), r14: g("R14"), r15: g("R15"), r18: g("R18"), r19: g("R19"), r20: g("R20") }; })(),
    });
    setEfileIssues(built.issues);
    if (built.bytes) {
      downloadNtsBytes(built.bytes, built.fileName);
      toast(`${built.fileName} 을 내려받았습니다. 홈택스 › 신고서 파일 변환에서 검증·제출하세요`, "success");
      setEfileOpen(false);
    }
  };

  const T = useMemo(() => {
    const all = aggOf(rows);
    //   퇴직소득 A22 — IRP 이전(과세이연)은 원천징수가 없고 신고 방식이 달라 자동 반영에서 뺀다
    const retList = retRows.filter((r) => !r.irp_deferred);
    const ret = {
      n: new Set(retList.map((r) => r.employee_id || r.id)).size,
      pay: retList.reduce((s, r) => s + r.retirement_pay, 0),
      incomeTax: retList.reduce((s, r) => s + r.income_tax, 0),
      localTax: retList.reduce((s, r) => s + r.local_tax, 0),
    };
    //   4단계 — 일용(A03)·기타(A42)·이자(A50)·배당(A60). 법인에게 준 이자·배당은 법인세 원천(A80)이라 뺀다(whtIncomeAgg)
    const X = whtIncomeAgg(dailyLogs, incomePays);
    const extra = [X.daily, X.other, X.interest, X.dividend];
    return {
      work: aggOf(rows.filter((r) => !r.biz)),
      biz: aggOf(rows.filter((r) => r.biz)),
      all,
      ret,
      daily: X.daily, other: X.other, interest: X.interest, dividend: X.dividend, corpCount: X.corpCount,
      irpN: retRows.length - retList.length,
      //   총합계(A99)·납부 세액 = 급여 명세 + 퇴직소득 + 일용·기타·이자·배당
      sum: { n: all.n + ret.n + extra.reduce((s, a) => s + a.n, 0), taxable: all.taxable + ret.pay + extra.reduce((s, a) => s + a.pay, 0),
        incomeTax: all.incomeTax + ret.incomeTax + extra.reduce((s, a) => s + a.tax, 0), localTax: all.localTax + ret.localTax + extra.reduce((s, a) => s + a.local, 0) },
      lastIssued: rows.reduce<string | null>((m, r) => (r.issuedAt && (!m || r.issuedAt > m) ? r.issuedAt : m), null),
    };
  }, [rows, retRows, dailyLogs, incomePays]);

  //   ── 신고서 서식 · 마감 (2026-10-12 세무 2차 1단계) — 숫자는 위 T 그대로(전자신고 파일과 같은 값) ──
  const canTaxWrite = isMaster || hasPerm("/finance/tax-filing");
  //   지방세 탭 (2026-10-14) — 법인지방소득세·주민세 종업원분·사업소분. _components/use-local-tax-tab
  const local = useLocalTaxTab({ companyId, enabled: tab === "local", years,
    renderDue: (d, id) => <DueDate d={d} done={taxChecked.has(id)} doneInfo={taxChecked.get(id)} onToggle={(on) => toggleChecked(id, on)} /> });
  //   지급명세서 탭 (2026-10-14 세무 2차 5단계) — 서류 10종·기간·마감·엑셀은 _components/use-statements-tab
  const stmt = useStatementsTab({
    companyId, userId, canWrite: canTaxWrite, enabled: tab === "stmt", years,
    initial: { doc: searchParams?.get("doc"), year: searchParams?.get("tab") === "stmt" ? Number(searchParams?.get("year")) || null : null, half: searchParams?.get("half"), month: searchParams?.get("month") },
    renderDue: (d, id) => <DueDate d={d} done={taxChecked.has(id)} doneInfo={taxChecked.get(id)} onToggle={(on) => toggleChecked(id, on)} />,
  });
  //   7단계 세무 이월 — ⑫ 전월 미환급세액 = 지난달 원천세 신고본의 ⑳ 차월이월 환급세액(마감한 숫자)
  const prevWhtMonth = (() => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  const { data: prevWhtReturns = [] } = useQuery({
    queryKey: ["tax-returns", companyId, "wht", prevWhtMonth], enabled: !!companyId && tab === "wht",
    queryFn: () => listTaxReturns(companyId!, "wht", prevWhtMonth),
  });
  const prevCarry = Math.max(0, Math.round(Number(latestClosed(prevWhtReturns)?.figures?.R20?.tax || 0)));
  const whtDefaultManual = useMemo<FormFigures>(() => { const m: FormFigures = {}; if (prevCarry) m.R12 = { tax: prevCarry }; return m; }, [prevCarry]);
  const whtCarryNote = prevCarry ? `⑫ 전월 미환급세액 ${won(prevCarry)}은 ${prevWhtMonth} 원천세 신고본(마감한 숫자)의 ⑳ 차월이월 환급세액에서 채웠습니다.` : undefined;
  //   서식의 지금 숫자(사람 칸 포함) — 전자신고 파일의 환급 조정이 같은 값을 쓴다
  const [whtLive, setWhtLive] = useState<FormFigures>({});
  const whtCompute = useMemo(() => (m: FormFigures) => computeWhtForm({
    work: { n: T.work.n, pay: T.work.taxable, tax: T.work.incomeTax },
    biz: { n: T.biz.n, pay: T.biz.taxable, tax: T.biz.incomeTax },
    ret: { n: T.ret.n, pay: T.ret.pay, tax: T.ret.incomeTax },
    daily: T.daily, other: T.other, interest: T.interest, dividend: T.dividend,
  }, m), [T]);
  const whtSources = useMemo(() => ({
    payroll: rows.map((r) => `${r.employee_id}:${r.period_month}`),
    retirement: retRows.filter((r) => !r.irp_deferred).map((r) => r.id),
    daily: dailyLogs.map((r) => r.id),
    income: incomePays.map((r) => r.id),
  }), [rows, retRows, dailyLogs, incomePays]);
  //   마감 때 신고본에 같이 남기는 것 — 급여대장(발송분)·일용·지급 기록·퇴직소득 (4단계)
  const whtSchedules = useMemo(() => ({
    payrollLedger: rows.map(({ issuedAt: _i, ...r }) => r),
    daily: dailyLogs, income: incomePays,
    retirement: retRows.map((r) => ({ id: r.id, employee_name: r.employee_name, paid_on: r.paid_on, retirement_pay: r.retirement_pay, income_tax: r.income_tax, local_tax: r.local_tax, irp_deferred: r.irp_deferred })),
  }), [rows, dailyLogs, incomePays, retRows]);


  const { toast } = useToast();
  const exportWht = () => {
    if (!rows.length && !retRows.length && !dailyLogs.length && !incomePays.length) { toast("이 달 급여 발송·퇴직금·일용·지급 기록이 없습니다", "info"); return; }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["원천징수이행상황신고서 준비", `${month} 지급분 (귀속·지급 같은 달 기준)`, `신고·납부 기한 ${dueOf(month)}`, "발송된 급여 명세 기준 (오너뷰)"], [],
      ["구분", "코드", "인원", "총지급액(과세)", "징수 소득세"],
      ["근로소득 간이세액", "A01", T.work.n, num(T.work.taxable), num(T.work.incomeTax)],
      ...(T.daily.n > 0 ? [["근로소득 일용근로", "A03", T.daily.n, num(T.daily.pay), num(T.daily.tax)]] : []),
      ["근로소득 가감계", "A10", T.work.n + T.daily.n, num(T.work.taxable + T.daily.pay), num(T.work.incomeTax + T.daily.tax)],
      ...(T.biz.n > 0 ? [
        ["사업소득 매월징수", "A25", T.biz.n, num(T.biz.taxable), num(T.biz.incomeTax)],
        ["사업소득 가감계", "A30", T.biz.n, num(T.biz.taxable), num(T.biz.incomeTax)],
      ] : []),
      ...(T.ret.n > 0 ? [
        ["퇴직소득 그 외", "A22", T.ret.n, num(T.ret.pay), num(T.ret.incomeTax)],
        ["퇴직소득 가감계", "A20", T.ret.n, num(T.ret.pay), num(T.ret.incomeTax)],
      ] : []),
      ...(T.other.n > 0 ? [["기타소득 그 외", "A42", T.other.n, num(T.other.pay), num(T.other.tax)], ["기타소득 가감계", "A40", T.other.n, num(T.other.pay), num(T.other.tax)]] : []),
      ...(T.interest.n > 0 ? [["이자소득", "A50", T.interest.n, num(T.interest.pay), num(T.interest.tax)]] : []),
      ...(T.dividend.n > 0 ? [["배당소득", "A60", T.dividend.n, num(T.dividend.pay), num(T.dividend.tax)]] : []),
      ["총합계", "A99", T.sum.n, num(T.sum.taxable), num(T.sum.incomeTax)], [],
      //   7단계 — 환급세액 조정이 있으면 납부 세액 = 징수세액 − ⑲ 당월 조정
      ...((whtLive.R12?.tax || whtLive.R15?.tax) ? [
        ["⑫ 전월 미환급세액", "", "", "", num(Number(whtLive.R12?.tax || 0))],
        ["⑬ 기환급 신청세액", "", "", "", num(Number(whtLive.R13?.tax || 0))],
        ["⑲ 당월 조정 환급세액", "", "", "", num(Number(whtLive.R19?.tax || 0))],
        ["⑳ 차월이월 환급세액", "", "", "", num(Number(whtLive.R20?.tax || 0))],
      ] : []),
      ["납부 세액(홈택스 · 소득세)", "", "", "", num(whtLive.PAY ? Number(whtLive.PAY.tax || 0) : T.sum.incomeTax)],
      ["지방소득세 특별징수분(위택스 · 별도 신고)", "", "", "", num(T.sum.localTax)], [],
      ["※ 프리랜서(사업소득 3.3%)는 고용형태 '프리랜서', 일용근로는 '일용직' + 일용 근무 기록, 기타·이자·배당은 지급 기록으로 잡힙니다."],
      ...(T.corpCount > 0 ? [[`※ 법인에게 준 이자·배당 ${T.corpCount}건은 법인세 원천(A80)이라 위 표에 없습니다 — 세무사 확인.`]] : []),
      ...(T.irpN > 0 ? [[`※ IRP 이전(과세이연) 퇴직금 ${T.irpN}건은 위 표에 없습니다. 홈택스에서 직접 신고하세요.`]] : []),
    ]);
    ws1["!cols"] = [{ wch: 40 }, { wch: 6 }, { wch: 6 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "신고서");
    //   급여대장(발송분) — 4단계: 4대보험·공제 합계·실지급액까지
    const sumOf = (k: "pension" | "health" | "ltc" | "employment" | "deductions" | "net") => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["이름", "사번", "구분", "과세 지급액", "비과세", "지급 합계", "국민연금", "건강보험", "장기요양", "고용보험", "소득세", "지방소득세", "공제 합계", "실지급액"],
      ...rows.map((r) => [r.name, r.employee_number || "", r.biz ? "사업소득" : "근로", num(r.taxable), num(r.nonTaxable), num(r.taxable + r.nonTaxable), num(r.pension), num(r.health), num(r.ltc), num(r.employment), num(r.incomeTax), num(r.localIncomeTax), num(r.deductions), num(r.net)]),
      ["합계", "", "", num(T.all.taxable), num(T.all.nonTaxable), num(T.all.taxable + T.all.nonTaxable), num(sumOf("pension")), num(sumOf("health")), num(sumOf("ltc")), num(sumOf("employment")), num(T.all.incomeTax), num(T.all.localTax), num(sumOf("deductions")), num(sumOf("net"))],
    ]);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }, ...Array(11).fill({ wch: 12 })];
    XLSX.utils.book_append_sheet(wb, ws2, "급여대장");
    if (dailyLogs.length) {
      const wsd = XLSX.utils.aoa_to_sheet([["이름", "근무일", "지급일", "일당", "비과세", "소득세", "지방소득세", "메모"],
        ...dailyLogs.map((r) => [r.employee_name, r.work_date, r.paid_on, num(r.daily_wage), num(r.non_taxable), num(r.income_tax), num(r.local_tax), r.memo || ""])]);
      XLSX.utils.book_append_sheet(wb, wsd, "일용근로");
    }
    if (incomePays.length) {
      const wsp = XLSX.utils.aoa_to_sheet([["받는 사람", "개인/법인", "소득", "세부", "지급일", "지급액", "필요경비", "세율(%)", "소득세", "지방소득세", "주민번호(세무사 기입)", "메모"],
        ...incomePays.map((r) => [r.payee_name, r.payee_kind === "corp" ? "법인" : "개인", INCOME_KIND_LABEL[r.income_kind], r.sub_kind || "", r.paid_on, num(r.amount), num(r.necessary_expense), r.tax_rate, num(r.income_tax), num(r.local_tax), "", r.memo || ""])]);
      XLSX.utils.book_append_sheet(wb, wsp, "기타·이자·배당");
    }
    if (retRows.length) {
      const ws3 = XLSX.utils.aoa_to_sheet([
        ["이름", "지급일", "근속 시작", "퇴사일", "근속연수", "퇴직금", "퇴직소득세", "지방소득세", "실지급액", "비고"],
        ...retRows.map((r) => [r.employee_name, r.paid_on, r.service_start, r.service_end, r.service_years, num(r.retirement_pay), num(r.income_tax), num(r.local_tax), num(r.retirement_pay - r.income_tax - r.local_tax), [r.irp_deferred ? "IRP 이전(과세이연) · 신고서 제외" : "", r.note || ""].filter(Boolean).join(" · ")]),
      ]);
      ws3["!cols"] = [{ wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws3, "퇴직소득");
    }
    XLSX.writeFile(wb, `원천세신고준비_${month}.xlsx`);
  };

  //   세무사 전달 패키지 (결정 104) — 3월에 세무사에게 보낼 것을 한 버튼에: 손익·재무상태표(계정별)·
  //   고정자산 감가상각 명세·전표 원장. 법인세 신고서는 안 만든다 — 세무조정은 세무사의 판단이다.
  const exportCitPack = async () => {
    if (!companyId || packBusy) return;
    setPackBusy(true);
    try {
      const stmt = citStmt || await computeStatements(companyId, `${year}-12`);
      const [assets, lines] = await Promise.all([
        listFixedAssets(companyId),
        fetchJournalLines(companyId, `${year}-01-01`, `${year}-12-31`),
      ]);
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([
        ["손익계산서 (계정별)", `${year}년 연간 · 확정 전표 기준 (오너뷰)`], [],
        ["코드", "계정과목", "구분", "금액"],
        ...stmt.pnl.map((l) => [l.code || "", l.name, l.nature === "revenue" ? "수익" : "비용", num(l.ytd ?? l.amount)]),
        [],
        ["", "수익 합계", "", num(stmt.totals.ytdRevenue)],
        ["", "비용 합계", "", num(stmt.totals.ytdExpense)],
        ["", "당기순이익 (세무조정 전)", "", num(stmt.totals.ytdNet)],
      ]);
      ws1["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 6 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws1, "손익계산서");
      const natureLabel: Record<string, string> = { asset: "자산", liability: "부채", equity: "자본" };
      const ws2 = XLSX.utils.aoa_to_sheet([
        ["재무상태표 (계정별 잔액)", `${year}-12-31 기준 · 확정 전표 (오너뷰)`], [],
        ["코드", "계정과목", "구분", "잔액"],
        ...stmt.bs.map((l) => [l.code || "", l.name, natureLabel[l.nature] || l.nature, num(l.amount)]),
        [],
        ["", "자산 합계", "", num(stmt.totals.assets)],
        ["", "부채 합계", "", num(stmt.totals.liabilities)],
        ["", "자본 합계 (당기손익 포함)", "", num(stmt.totals.equity + stmt.totals.netIncome)],
      ]);
      ws2["!cols"] = ws1["!cols"];
      XLSX.utils.book_append_sheet(wb, ws2, "재무상태표");
      const ws3 = XLSX.utils.aoa_to_sheet([
        ["고정자산 감가상각 명세", `${year}-12-31 기준 (오너뷰)`], [],
        ["자산", "분류", "취득일", "취득가", "잔존가", "내용월수", "방법", "상각 시작", "확정 상각누계", "장부가", "상태"],
        ...assets.map((a) => [a.name, faCategoryLabel(a.category), a.acquired_on, num(a.cost), num(a.salvage), a.useful_months, a.method === "straight" ? "정액" : "정률", a.depr_start_month, num(a.accum), num(a.book), a.status === "disposed" ? `처분 ${a.disposed_on || ""}` : "사용 중"]),
      ]);
      ws3["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws3, "고정자산 명세");
      //   전표 원장 · 세무조정의 원재료. 너무 크면 엑셀이 안 열리므로 3만 줄에서 자르고 잘랐다고 적는다.
      const CAP = 30_000;
      const ws4 = XLSX.utils.aoa_to_sheet([
        ["전표 원장", `${year}년 · 확정 전표 ${lines.length.toLocaleString("ko-KR")}줄${lines.length > CAP ? ` 중 앞 ${CAP.toLocaleString("ko-KR")}줄 (잘림 — 기간을 나눠 다시 받으세요)` : ""} (오너뷰)`], [],
        ["일자", "전표번호", "코드", "계정과목", "차변", "대변", "거래처", "적요"],
        ...lines.slice(0, CAP).map((l) => [l.date, l.voucherNo ?? "", l.code || "", l.name, num(l.debit), num(l.credit), l.partnerName || "", l.memo]),
      ]);
      ws4["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 7 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws4, "전표 원장");
      XLSX.writeFile(wb, `법인세_세무사패키지_${year}.xlsx`);
      toast(`${year}년 패키지를 내려받았습니다. 손익·재무상태표·고정자산·전표 원장 4개 시트`, "success");
    } catch (e) { toast(friendlyError(e), "error"); }
    finally { setPackBusy(false); }
  };

  //   퇴직소득 지급 — 원천세 탭 아래(급여 기록이 없는 달에도 보인다). 추가·고치기는 급여 권한자·마스터만(RLS 와 같다)
  const retirePanel = (
    <div className="pnl-panel">
      <div className="tax-retire-head">
        <h3>퇴직소득 지급</h3>
        {canWriteRetire && <button type="button" className="btn-secondary btn-sm" onClick={() => setRetDialog({ edit: null })}>+ 퇴직금 지급 기록</button>}
      </div>
      <p title="미사용 연차 수당·마지막 달 급여는 근로소득이라 급여 명세로 정산합니다">회사가 직접 지급한 퇴직금입니다. 기록하면 신고서 A22·A20에 들어갑니다.
        {T.irpN > 0 && <b className="vr-warn"> IRP 이전(과세이연) {T.irpN}건은 신고서에 없습니다 — 홈택스에서 직접 신고하세요.</b>}</p>
      {retRows.length === 0 ? (
        <div className="collect-empty">{month} 지급분 퇴직금 기록이 없습니다.{!canWriteRetire && <><br /><span className="vr-warn">급여 권한이 없으면 퇴직금 기록이 보이지 않아 위 신고서에서도 빠집니다. 급여 권한자에게 확인하세요.</span></>}</div>
      ) : (
        <div className="stg-table-wrap vr-scroll">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>이름</th><th>지급일</th><th>근속</th><th>퇴직금</th><th>퇴직소득세</th><th>지방소득세</th><th>실지급액</th><th>비고</th></tr></thead>
            <tbody>
              {retRows.map((r) => (
                <tr key={r.id} className={canWriteRetire ? "cursor-pointer" : undefined} onClick={canWriteRetire ? () => setRetDialog({ edit: r }) : undefined} title={canWriteRetire ? "눌러서 고치기·지우기" : undefined}>
                  <td className="text-left">{r.employee_name}</td>
                  <td className="tc mono-number">{r.paid_on}</td>
                  <td className="tc mono-number" title={`${r.service_start} ~ ${r.service_end}`}>{r.service_years}년</td>
                  <td className="tr mono-number">{won(r.retirement_pay)}</td>
                  <td className="tr mono-number">{won(r.income_tax)}</td>
                  <td className="tr mono-number">{won(r.local_tax)}</td>
                  <td className="tr mono-number">{won(r.retirement_pay - r.income_tax - r.local_tax)}</td>
                  <td className="text-left ev-dim">{[r.irp_deferred ? "IRP 이전 · 신고서 제외" : "", r.note || ""].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  //   일용근로 · 기타/이자/배당 지급 (2026-10-14 4단계) — 퇴직소득 패널과 같은 자리·같은 모양
  const dailyPanel = (
    <div className="pnl-panel">
      <div className="tax-retire-head">
        <h3>일용근로 지급</h3>
        {canWriteRetire && <button type="button" className="btn-secondary btn-sm" onClick={() => setDailyDialog({ edit: null })}>+ 일용 근무 기록</button>}
      </div>
      <p>고용형태 &apos;일용직&apos; 구성원의 날마다 일당입니다. 지급일이 이 달인 기록이 신고서 A03·A10에 들어갑니다.</p>
      {dailyLogs.length === 0 ? (
        <div className="collect-empty">{month} 지급분 일용 근무 기록이 없습니다.{!canWriteRetire && <><br /><span className="vr-warn">급여 권한이 없으면 일용 기록이 보이지 않아 신고서에서도 빠집니다.</span></>}</div>
      ) : (
        <div className="stg-table-wrap vr-scroll">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>이름</th><th>근무일</th><th>지급일</th><th>일당</th><th>비과세</th><th>소득세</th><th>지방소득세</th><th>메모</th></tr></thead>
            <tbody>
              {dailyLogs.map((r) => (
                <tr key={r.id} className={canWriteRetire ? "cursor-pointer" : undefined} onClick={canWriteRetire ? () => setDailyDialog({ edit: r }) : undefined} title={canWriteRetire ? "눌러서 고치기·지우기" : undefined}>
                  <td className="text-left">{r.employee_name}</td><td className="tc mono-number">{r.work_date}</td><td className="tc mono-number">{r.paid_on}</td>
                  <td className="tr mono-number">{won(r.daily_wage)}</td><td className="tr mono-number">{won(r.non_taxable)}</td>
                  <td className="tr mono-number">{won(r.income_tax)}</td><td className="tr mono-number">{won(r.local_tax)}</td><td className="text-left ev-dim">{r.memo || ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="vr-sum"><td className="text-left">합계 ({T.daily.n}명 · {dailyLogs.length}일)</td><td></td><td></td><td className="tr mono-number">{won(dailyLogs.reduce((s, r) => s + r.daily_wage, 0))}</td><td></td><td className="tr mono-number">{won(T.daily.tax)}</td><td className="tr mono-number">{won(T.daily.local)}</td><td></td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
  const incomePanel = (
    <div className="pnl-panel">
      <div className="tax-retire-head">
        <h3>기타·이자·배당 지급</h3>
        {canTaxWrite && <button type="button" className="btn-secondary btn-sm" onClick={() => setPayDialog({ edit: null })}>+ 지급 기록</button>}
      </div>
      <p>강연료·원고료 같은 기타소득, 빌린 돈의 이자, 배당입니다. 개인에게 준 것이 신고서 A42·A40·A50·A60에 들어갑니다.
        {T.corpCount > 0 && <b className="vr-warn"> 법인에게 준 {T.corpCount}건은 법인세 원천(A80)이라 신고서에 없습니다 — 세무사 확인.</b>}</p>
      {incomePays.length === 0 ? (
        <div className="collect-empty">{month} 지급분 기타·이자·배당 기록이 없습니다.</div>
      ) : (
        <div className="stg-table-wrap vr-scroll">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>받는 사람</th><th>소득</th><th>지급일</th><th>지급액</th><th>필요경비</th><th>세율</th><th>소득세</th><th>지방소득세</th></tr></thead>
            <tbody>
              {incomePays.map((r) => (
                <tr key={r.id} className={canTaxWrite ? "cursor-pointer" : undefined} onClick={canTaxWrite ? () => setPayDialog({ edit: r }) : undefined} title={canTaxWrite ? "눌러서 고치기·지우기" : undefined}>
                  <td className="text-left">{r.payee_name}{r.payee_kind === "corp" && <span className="ev-dim"> (법인)</span>}</td>
                  <td className="tc">{INCOME_KIND_LABEL[r.income_kind]}{r.sub_kind ? ` · ${r.sub_kind}` : ""}</td><td className="tc mono-number">{r.paid_on}</td>
                  <td className="tr mono-number">{won(r.amount)}</td><td className="tr mono-number">{won(r.necessary_expense)}</td><td className="tc mono-number">{r.tax_rate}%</td>
                  <td className="tr mono-number">{won(r.income_tax)}</td><td className="tr mono-number">{won(r.local_tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (!permLoading && !(isMaster || hasPerm("/finance/tax-filing")))
    return <AccessDenied detail="세무 신고 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;

  return (
    <div className="qk-shell">
      {/* 전자신고 파일 생성 팝업 (베타, 결정 106) — 확정은 사람: 파일을 받고 홈택스에서 검증·제출한다 */}
      {efileOpen && (
        <div className="inv-modal" onClick={() => setEfileOpen(false)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">원천세 전자신고 파일 (베타)</h3>
            <p className="inv-modal-desc" title="연말정산·수정신고·환급신청·반기 신고는 홈택스에서 직접 합니다">
              {month} 지급분 신고서를 홈택스 <b>신고서 파일 변환</b> 업로드용 파일로 만듭니다. <b>첫 신고는 세무사 확인 후 제출</b>하세요.
            </p>
            <div className="inv-bom-base">
              <label className="text-xs font-semibold text-[var(--text-dim)] whitespace-nowrap">홈택스 사용자ID</label>
              <input className="inv-input" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)}
                placeholder="홈택스에 로그인하는 ID (파일 Header 필수값)" maxLength={20} />
            </div>
            <p className="inv-hint">
              {companyInfo
                ? <>사업자번호 <b className="mono-number">{companyInfo.business_number || "(없음)"}</b> · 상호 <b>{companyInfo.name}</b> · 대표 <b>{companyInfo.representative || "(없음)"}</b> 정보로 채웁니다.</>
                : "회사 정보를 읽는 중…"}
            </p>
            {efileIssues.length > 0 && (
              <div className="inv-paste-sum">
                <span className="inv-paste-bad">파일을 만들 수 없습니다 — {efileIssues.map((x) => `${x.field}: ${x.message}`).join(" / ")}</span>
              </div>
            )}
            <div className="inv-modal-actions">
              <span className="doc-sums-sp" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEfileOpen(false)}>닫기</button>
              <button type="button" className="btn-primary btn-sm" disabled={!companyInfo} onClick={makeEfile}>파일 만들기</button>
            </div>
          </div>
        </div>
      )}
      {vatEfileOpen && companyId && <VatEfileDialog companyId={companyId} year={year} period={vatPeriod} onClose={() => setVatEfileOpen(false)} />}
      {dailyDialog && companyId && (
        <DailyLogDialog companyId={companyId} edit={dailyDialog.edit} onClose={() => setDailyDialog(null)}
          defaultDate={month === todayKst().slice(0, 7) ? todayKst() : `${month}-01`}
          onSaved={() => qc.invalidateQueries({ queryKey: ["daily-work-logs"] })} />
      )}
      {payDialog && companyId && (
        <IncomePaymentDialog companyId={companyId} edit={payDialog.edit} onClose={() => setPayDialog(null)}
          defaultDate={month === todayKst().slice(0, 7) ? todayKst() : `${month}-01`}
          onSaved={() => qc.invalidateQueries({ queryKey: ["income-payments"] })} />
      )}
      {retDialog && companyId && (
        <RetirementPaymentDialog companyId={companyId} edit={retDialog.edit} onClose={() => setRetDialog(null)}
          defaultPaidOn={month === todayKst().slice(0, 7) ? todayKst() : `${month}-01`}
          onSaved={() => qc.invalidateQueries({ queryKey: ["retirement-payments"] })} />
      )}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs">
            <button type="button" className={tab === "wht" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("wht")}>원천세</button>
            <button type="button" className={tab === "vat" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("vat")}>부가세</button>
            <button type="button" className={tab === "cit" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("cit")}>법인세</button>
            <button type="button" className={tab === "local" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("local")}>지방세</button>
            <button type="button" className={tab === "stmt" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("stmt")}>지급명세서</button>
          </div>
          <div className="tax-upcoming">
            <span className="tax-upcoming-label">다가오는 신고 (60일)</span>
            {upcomingOpen.length === 0 ? <span className="ev-dim">60일 안에 할 신고가 없습니다.</span> : upcomingOpen.map((t) => (
              <button key={t.id} type="button" className="qk-chip" onClick={() => goDeepLink(t.href)} title={`${t.date} · 누르면 그 신고 화면으로`}>
                {t.title.replace(" 신고/납부", "").replace(" 제출", "")} <b className="mono-number">{t.date.slice(5).replace("-", "/")}</b> <b className={t.daysLeft <= 7 ? "mono-number tax-due-soon" : "mono-number"}>{t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</b>
              </button>
            ))}
          </div>
          {tab === "wht" && (<>
            <QueryBar right={<>
              {efileOn && (
                <button type="button" className="btn-secondary btn-sm" disabled={T.sum.n === 0} onClick={() => { setEfileIssues([]); setEfileOpen(true); }}
                  title="홈택스 '신고서 파일 변환' 업로드용 전산매체 파일 (C103900). 베타">전자신고 파일 (베타)</button>
              )}
              <button type="button" className="btn-secondary btn-sm" onClick={exportWht} title="신고서 요약 + 급여대장 + 퇴직·일용·기타/이자/배당(있으면)">세무사 전달 엑셀</button>
            </>}>
              <label className="text-xs font-semibold text-[var(--text-dim)]">지급월</label>
              <MonthSelect className="inv-input fin-close-month" value={month} onChange={(v) => v && setMonth(v)} ariaLabel="지급월" />
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <DueDate d={dueOf(month)} done={taxChecked.has(`wht-${dueOf(month)}`)} doneInfo={taxChecked.get(`wht-${dueOf(month)}`)} onToggle={(on) => toggleChecked(`wht-${dueOf(month)}`, on)} /> · 홈택스</span>
            </QueryBar>
            <ResultStrip>
              <Stat label="인원" value={`${T.sum.n}명${T.biz.n ? ` (사업소득 ${T.biz.n})` : ""}${T.ret.n ? ` (퇴직 ${T.ret.n})` : ""}`} />
              <Stat label="총지급액 (과세)" value={won(T.sum.taxable)} />
              {/*   7단계 — 전월 미환급세액으로 조정하면 납부할 세액이 줄어든다(서식 '납부할 소득세'와 같은 값) */}
              <Stat label="소득세 (홈택스 납부)" title={whtLive.R19?.tax ? `징수세액 ${won(T.sum.incomeTax)} − 당월 조정 환급 ${won(Number(whtLive.R19.tax))}` : undefined}
                value={won(whtLive.PAY ? Number(whtLive.PAY.tax || 0) : T.sum.incomeTax)} tone={(whtLive.PAY ? Number(whtLive.PAY.tax || 0) : T.sum.incomeTax) ? "minus" : undefined} />
              <Stat label="지방소득세 (위택스 납부)" value={won(T.sum.localTax)} tone={T.sum.localTax ? "minus" : undefined} />
            </ResultStrip>
          </>)}
          {tab === "vat" && (
            <QueryBar right={<>
              {vatEfileOn && <button type="button" className="btn-secondary btn-sm" onClick={() => setVatEfileOpen(true)} title="홈택스 '신고서 파일 변환' 업로드용 파일 (일반과세자 정기신고 · 전자세금계산서). 베타">전자신고 파일 (베타)</button>}
              <button type="button" className="btn-secondary btn-sm" onClick={() => vatExportRef.current?.()} title="신고서 · 세금계산서/계산서 합계표 4종 · 카드 수령·발행 · 불공제 · 감가상각 취득 · 전표 목록">세무사 전달 엑셀</button>
            </>}>
              <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={vatPeriod} onChange={(e) => setVatPeriod(e.target.value as VatPeriodKey)} className="qk-input h-8 px-2.5 text-xs" aria-label="신고기간">
                {VAT_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {/*   서류 = 신고서·부속서류 한 줄 셀렉트 (2026-10-12 2단계 — 상자 안 두 번째 탭 줄 금지) */}
              <select value={vatDoc} onChange={(e) => setVatDoc(e.target.value as VatDocKey)} className="qk-input h-8 px-2.5 text-xs" aria-label="서류">
                {VAT_DOCS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <DueDate d={vatDueDate(year, vatPeriod)} done={taxChecked.has(`vat-${vatDueDate(year, vatPeriod)}`)} doneInfo={taxChecked.get(`vat-${vatDueDate(year, vatPeriod)}`)} onToggle={(on) => toggleChecked(`vat-${vatDueDate(year, vatPeriod)}`, on)} /> · 홈택스</span>
            </QueryBar>
          )}
          {tab === "cit" && (<>
            <QueryBar right={
              <button type="button" className="btn-secondary btn-sm" disabled={packBusy} onClick={exportCitPack}
                title="손익계산서 · 재무상태표 · 고정자산 명세 · 전표 원장 · 4개 시트">
                {packBusy ? "만드는 중…" : "세무사 전달 패키지"}
              </button>
            }>
              <label className="text-xs font-semibold text-[var(--text-dim)]">사업연도</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="사업연도">
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span className="text-[11px] text-[var(--text-dim)]" title="12월 결산 법인 기준">신고·납부 기한 <DueDate d={`${year + 1}-03-31`} done={taxChecked.has(`cit-${year + 1}-03-31`)} doneInfo={taxChecked.get(`cit-${year + 1}-03-31`)} onToggle={(on) => toggleChecked(`cit-${year + 1}-03-31`, on)} /> · 지방소득세 <DueDate d={`${year + 1}-04-30`} done={taxChecked.has(`cit-local-${year + 1}-04-30`)} doneInfo={taxChecked.get(`cit-local-${year + 1}-04-30`)} onToggle={(on) => toggleChecked(`cit-local-${year + 1}-04-30`, on)} /></span>
            </QueryBar>
            <ResultStrip>
              <Stat label="수익" value={won(citStmt?.totals.ytdRevenue || 0)} />
              <Stat label="비용" value={won(citStmt?.totals.ytdExpense || 0)} />
              <Stat label="회계이익 (세무조정 전)" value={won(cit.income)} tone={cit.income < 0 ? "minus" : undefined} />
              <Stat label="예상 법인세+지방세" value={won(cit.sum)} tone={cit.sum ? "minus" : undefined} />
            </ResultStrip>
          </>)}
          {tab === "local" && (
            <QueryBar right={<button type="button" className="btn-secondary btn-sm" onClick={local.exportXlsx}>엑셀</button>}>
              {local.bar}
            </QueryBar>
          )}
          {tab === "stmt" && (
            <QueryBar right={<button type="button" className="btn-secondary btn-sm" onClick={() => void stmt.exportXlsx()}>세무사 전달 엑셀</button>}>
              {stmt.bar}
            </QueryBar>
          )}
        </QueryHead>
        <QueryBody>
          <div className="ev-scroll fa-scroll">
            {tab === "vat" ? (
              <VatReturn companyId={companyId} userId={userId} canWrite={canTaxWrite} year={year} period={vatPeriod} doc={vatDoc} exportRef={vatExportRef} />
            ) : tab === "cit" ? (
              citLoading ? <div className="collect-empty">연간 손익을 계산하는 중…</div> : (
                <div className="vr-wrap">
                  <p className="inv-hint" title="감가상각 한도·이월결손금 공제는 반영되지 않았습니다. 기업업무추진비 한도는 아래 표대로 반영했습니다">
                    {year}년 확정 전표로 계산한 예상치입니다.
                    <b className="vr-warn"> 세무조정 전 근사치이며 확정 세액은 세무사가 계산합니다.</b>
                    {" 자료는 세무사 전달 패키지로 보냅니다."}
                  </p>
                  {/*   신고서 · 마감 (2026-10-14) — 세무사가 확정한 숫자를 남기고, 이월결손금·중간예납 기준액을 다음 해로 넘긴다 */}
                  <TaxReturnSheet layout="list" kind="cit" companyId={companyId} userId={userId} canWrite={canTaxWrite}
                    periodKey={String(year)} title={`법인세 과세표준 및 세액신고 · ${year} 사업연도`}
                    rows={CIT_LINES} cols={{ amount: "금액" }} noTotal totalKey="PAY"
                    compute={citCompute} sources={citSources} loading={citLoading}
                    defaultManual={citDefaults} defaultManualNote={citNote} />
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>예상 법인세</h3><p title="2억 이하 9% · 200억 이하 19% · 3,000억 이하 21% · 초과 24%">2026년 세율 기준입니다.</p>
                      <div className="stg-table-wrap vr-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>구간</th><th>과세표준</th><th>세율</th><th>세액</th></tr></thead>
                        <tbody>
                          <tr><td className="text-left">회계이익 (세무조정 전)</td><td className="tr mono-number">{won(cit.income)}</td><td></td><td></td></tr>
                          {cit.ent.excess > 0 && <tr><td className="text-left">+ 기업업무추진비 한도 초과 (손금불산입)</td><td className="tr mono-number">{won(cit.ent.excess)}</td><td></td><td></td></tr>}
                          <tr className="vr-sum"><td className="text-left">예상 과세표준</td><td className="tr mono-number">{won(cit.base)}</td><td></td><td></td></tr>
                          {cit.base <= 0 ? (
                            <tr><td className="text-left" colSpan={3}>결손이라 산출세액이 없습니다.</td><td className="tr mono-number">₩0</td></tr>
                          ) : cit.brackets.map((b) => (
                            <tr key={b.label}><td className="text-left">{b.label}</td><td className="tr mono-number">{won(b.amt)}</td><td className="tc mono-number">{Math.round(b.rate * 100)}%</td><td className="tr mono-number">{won(b.tax)}</td></tr>
                          ))}
                          <tr className="vr-sum"><td className="text-left">산출세액 (법인세)</td><td></td><td></td><td className="tr mono-number">{won(cit.total)}</td></tr>
                          <tr><td className="text-left">법인지방소득세 (산출세액의 10% · 위택스)</td><td></td><td></td><td className="tr mono-number">{won(cit.local)}</td></tr>
                          <tr className="vr-total"><td className="text-left" colSpan={3}><b>예상 합계</b></td><td className="tr mono-number"><b>{won(cit.sum)}</b></td></tr>
                        </tbody>
                      </table>
                      </div>
                    </div>
                    <div className="pnl-panel">
                      <h3>기업업무추진비 (접대비) 한도</h3>
                      <p title="법인세법 제25조: 기본한도 + 수입금액 × 0.3%(100억 이하)·0.2%(500억 이하)·0.03%(초과)">한도를 넘은 금액은 비용으로 인정되지 않아 과세표준에 더해집니다.</p>
                      <ChipGroup value={citSme ? "sme" : "general"} onChange={(v) => setCitSme(v === "sme")}
                        options={[{ value: "sme", label: "중소기업 (기본 3,600만)" }, { value: "general", label: "일반 (기본 1,200만)" }] as const} />
                      <div className="stg-table-wrap vr-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>항목</th><th>금액</th></tr></thead>
                        <tbody>
                          {cit.entLines.length === 0 ? (
                            <tr><td className="text-left ev-dim" colSpan={2}>{year}년 확정 전표에 기업업무추진비(접대비) 계정 사용이 없습니다.</td></tr>
                          ) : cit.entLines.map((l) => (
                            <tr key={l.accountId}><td className="text-left">{l.code ? `${l.code} ` : ""}{l.name}</td><td className="tr mono-number">{won(Number(l.ytd || 0))}</td></tr>
                          ))}
                          <tr className="vr-sum"><td className="text-left">지출 합계</td><td className="tr mono-number">{won(cit.ent.spent)}</td></tr>
                          <tr><td className="text-left">기본한도</td><td className="tr mono-number">{won(cit.ent.base)}</td></tr>
                          <tr><td className="text-left">수입금액 한도 <span className="ev-dim">매출 {won(cit.sales)} 기준</span></td><td className="tr mono-number">{won(cit.ent.byRevenue)}</td></tr>
                          <tr className="vr-sum"><td className="text-left">한도 합계</td><td className="tr mono-number">{won(cit.ent.limit)}</td></tr>
                          <tr className="vr-total"><td className="text-left"><b>한도 초과 (손금불산입)</b></td><td className="tr mono-number"><b className={cit.ent.excess > 0 ? "vr-warn" : undefined}>{won(cit.ent.excess)}</b></td></tr>
                        </tbody>
                      </table>
                      </div>
                      <p className="inv-foot" title="진행 중인 해는 지금까지 확정된 지출·매출 기준입니다">
                        문화·전통시장 추가 한도, 특수관계인 매출, 부동산임대업 주업 법인(한도 절반), 3만 원 초과 적격증빙 미수취분은 계산하지 않습니다. 세무사와 확인하세요.
                      </p>
                    </div>
                    <div className="pnl-panel">
                      <h3>신고 일정 · To-do</h3><p>12월 결산 법인 기준 일정입니다.</p>
                      <div className="stg-table-wrap vr-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>무엇</th><th>기한</th><th>비고</th></tr></thead>
                        <tbody>
                          <tr><td className="text-left">법인세 신고·납부 (홈택스)</td><td className="tc mono-number">{year + 1}-03-31</td><td className="text-left">세무사 패키지를 2월 중 전달</td></tr>
                          <tr><td className="text-left">법인지방소득세 (위택스)</td><td className="tc mono-number">{year + 1}-04-30</td><td className="text-left">산출세액의 10%</td></tr>
                          <tr><td className="text-left">중간예납</td><td className="tc mono-number">{year + 1}-08-31</td><td className="text-left">전년 산출세액의 절반 · 예상 <b className="mono-number">{won(Math.floor(cit.total / 2))}</b></td></tr>
                        </tbody>
                      </table>
                      </div>
                      <p className="inv-foot" title="진행 중인 해는 지금까지 확정된 전표만 반영됩니다">자금을 미리 떼어 둘 크기를 가늠하는 예상치입니다.</p>
                    </div>
                  </div>
                </div>
              )
            ) : tab === "local" ? (
              local.body
            ) : tab === "stmt" ? (
              stmt.body
            ) : isLoading || retLoading || dailyLoading || payLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : rows.length === 0 && retRows.length === 0 && dailyLogs.length === 0 && incomePays.length === 0 ? (<>
              <div className="collect-empty">
                {month} 지급분 <b>급여 발송 기록이 없습니다.</b><br />
                급여 명세서를 발송하면 신고서에 반영됩니다.<br />
                <span className="ev-dim">지급이 없어도 <b>무실적 신고</b>는 필요합니다.</span>
              </div>
              {/*   무실적 달도 0원 신고서를 마감할 수 있게 (2026-10-12 결정 258 · 빈 상태) */}
              <TaxReturnSheet layout="wht" kind="wht" companyId={companyId} userId={userId} canWrite={canTaxWrite}
                periodKey={month} title={`원천징수이행상황신고서 · ${month} 귀속·지급 (무실적)`}
                compute={whtCompute} sources={whtSources} schedules={whtSchedules} loading={isLoading || retLoading || dailyLoading || payLoading}
                defaultManual={whtDefaultManual} defaultManualNote={whtCarryNote} onFigures={setWhtLive} />
              {retirePanel}
              {dailyPanel}
              {incomePanel}
            </>) : (
              <div className="vr-wrap">
                <p className="inv-hint" title="귀속월과 지급월을 같은 달로 봅니다">
                  {month} 지급분 급여 명세 {T.all.n}명 기준입니다.
                  {T.lastIssued && <> 마지막 발송 <b className="mono-number">{T.lastIssued.slice(0, 10)}</b> 이후 고친 급여는 다시 발송해야 반영됩니다.</>}
                  {" 프리랜서는 사업소득으로 잡힙니다. 퇴직금·일용근로·기타/이자/배당은 아래 기록에 넣으면 들어갑니다."}
                </p>
                {/*   서식 화면 · 마감 (2026-10-12 세무 2차 1단계, 결정 258~260) — 예전 '원천징수이행상황신고서' 요약 표를 대신한다 */}
                <TaxReturnSheet layout="wht" kind="wht" companyId={companyId} userId={userId} canWrite={canTaxWrite}
                  periodKey={month} title={`원천징수이행상황신고서 · ${month} 귀속·지급`}
                  compute={whtCompute} sources={whtSources} schedules={whtSchedules} loading={isLoading || retLoading || dailyLoading || payLoading}
                defaultManual={whtDefaultManual} defaultManualNote={whtCarryNote} onFigures={setWhtLive} />
                <div className="pnl-grid2">
                  <div className="pnl-panel">
                    <h3>지방소득세 (특별징수)</h3><p>소득세의 10%를 <b>위택스</b>에 따로 신고·납부합니다.</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>구분</th><th>인원</th><th>징수 세액</th></tr></thead>
                      <tbody>
                        <tr><td className="text-left">근로소득분 지방소득세</td><td className="tr mono-number">{T.work.n}</td><td className="tr mono-number">{won(T.work.localTax)}</td></tr>
                        {T.biz.n > 0 && <tr><td className="text-left">사업소득분 지방소득세</td><td className="tr mono-number">{T.biz.n}</td><td className="tr mono-number">{won(T.biz.localTax)}</td></tr>}
                        {T.ret.n > 0 && <tr><td className="text-left">퇴직소득분 지방소득세</td><td className="tr mono-number">{T.ret.n}</td><td className="tr mono-number">{won(T.ret.localTax)}</td></tr>}
                        {T.daily.n > 0 && <tr><td className="text-left">일용근로분 지방소득세</td><td className="tr mono-number">{T.daily.n}</td><td className="tr mono-number">{won(T.daily.local)}</td></tr>}
                        {T.other.n > 0 && <tr><td className="text-left">기타소득분 지방소득세</td><td className="tr mono-number">{T.other.n}</td><td className="tr mono-number">{won(T.other.local)}</td></tr>}
                        {(T.interest.n + T.dividend.n) > 0 && <tr><td className="text-left">이자·배당소득분 지방소득세</td><td className="tr mono-number">{T.interest.n + T.dividend.n}</td><td className="tr mono-number">{won(T.interest.local + T.dividend.local)}</td></tr>}
                        <tr className="vr-total"><td className="text-left" colSpan={2}><b>납부 세액 (위택스)</b></td><td className="tr mono-number"><b>{won(T.sum.localTax)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                {/*   급여대장(발송분) — 2026-10-14 4단계: 예전 '인별 명세'를 4대보험·공제·실지급액까지 넓혔다. 마감하면 신고본에 같이 남는다 */}
                {rows.length > 0 && <div className="pnl-panel">
                  <h3>급여대장</h3><p title="구분은 현재 고용형태 기준입니다">발송된 급여 명세 기준 · 원천세를 마감하면 이 대장도 신고본에 같이 남습니다.</p>
                  <div className="stg-table-wrap vr-scroll">
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>이름</th><th>구분</th><th>과세 지급액</th><th>비과세</th><th>국민연금</th><th>건강보험</th><th>장기요양</th><th>고용보험</th><th>소득세</th><th>지방소득세</th><th>공제 합계</th><th>실지급액</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.employee_id}>
                            <td className="text-left">{r.name}{r.employee_number && <span className="ev-dim"> #{r.employee_number}</span>}</td>
                            <td className="tc">{r.biz ? "사업소득" : "근로"}</td>
                            <td className="tr mono-number">{won(r.taxable)}</td><td className="tr mono-number">{won(r.nonTaxable)}</td>
                            <td className="tr mono-number">{won(r.pension)}</td><td className="tr mono-number">{won(r.health)}</td><td className="tr mono-number">{won(r.ltc)}</td><td className="tr mono-number">{won(r.employment)}</td>
                            <td className="tr mono-number">{won(r.incomeTax)}</td><td className="tr mono-number">{won(r.localIncomeTax)}</td>
                            <td className="tr mono-number">{won(r.deductions)}</td><td className="tr mono-number">{won(r.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="vr-sum"><td className="text-left">합계 ({T.all.n}명)</td><td></td>
                        <td className="tr mono-number">{won(T.all.taxable)}</td><td className="tr mono-number">{won(T.all.nonTaxable)}</td>
                        {(["pension", "health", "ltc", "employment"] as const).map((k) => <td key={k} className="tr mono-number">{won(rows.reduce((s, r) => s + r[k], 0))}</td>)}
                        <td className="tr mono-number">{won(T.all.incomeTax)}</td><td className="tr mono-number">{won(T.all.localTax)}</td>
                        <td className="tr mono-number">{won(rows.reduce((s, r) => s + r.deductions, 0))}</td><td className="tr mono-number">{won(rows.reduce((s, r) => s + r.net, 0))}</td></tr></tfoot>
                    </table>
                  </div>
                </div>}
                {retirePanel}
                {dailyPanel}
                {incomePanel}
              </div>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

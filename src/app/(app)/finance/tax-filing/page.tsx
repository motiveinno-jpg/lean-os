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
//   자동으로 못 푸는 것: 퇴직·기타소득 지급분 — 오너뷰가 기록하지 않는다. 있으면 사람이 더해야 한다고 화면에 적는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { getCurrentUser } from "@/lib/queries";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { comparePeople } from "@/lib/people-sort";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup } from "@/components/query-kit";
import { VatReturn, VAT_PERIODS, vatFilingNow, vatDueDate, type VatPeriodKey } from "@/app/(app)/reports/vat/_components/VatReturn";
import { computeStatements } from "@/lib/closing-snapshot";
import { listFixedAssets, faCategoryLabel } from "@/lib/fixed-assets";
import { fetchJournalLines } from "@/lib/journal-reports";
import { friendlyError } from "@/lib/friendly-error";
import { downloadNtsBytes, type NtsIssue } from "@/lib/nts-efile";
import { buildWhtEfile, type WhtEfileRow } from "@/lib/nts-wht-efile";
import { useModalKeys } from "@/hooks/use-modal-keys";

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
/** 기한 색 — 7일 안이면 주의, 지났으면 위험. 그 밖엔 검정 (2026-09-03 후속: 기한이 눈에 띄게) */
function DueDate({ d }: { d: string }) {
  const left = Math.round((new Date(d).getTime() - new Date(todayKst()).getTime()) / 86400000);
  const cls = left < 0 ? "mono-number tax-due-over" : left <= 7 ? "mono-number tax-due-soon" : "mono-number";
  return <b className={cls} title={left < 0 ? `${-left}일 지났습니다` : left === 0 ? "오늘까지" : `${left}일 남았습니다`}>{d}{left < 0 ? " · 지남" : left <= 7 ? ` · D-${left}` : ""}</b>;
}
/** 반기의 여섯 달 (h=1 → 01~06, h=2 → 07~12) */
const halfMonths = (y: number, h: 1 | 2) =>
  Array.from({ length: 6 }, (_, i) => `${y}-${String(h === 1 ? i + 1 : i + 7).padStart(2, "0")}`);

//   법인세 세율 구간 (2023년 개정 후) — 결정 104. 지방소득세는 산출세액의 10%(구간세율 0.9~2.4%와 같다).
//   ⚠️ 세율이 바뀌면 여기 상수를 고친다 — 화면에 '2026년 세율 기준'을 적어 어긋남이 보이게 한다.
const CIT_BRACKETS = [
  { upTo: 200_000_000, rate: 0.09, label: "2억 이하" },
  { upTo: 20_000_000_000, rate: 0.19, label: "2억 초과 ~ 200억" },
  { upTo: 300_000_000_000, rate: 0.21, label: "200억 초과 ~ 3,000억" },
  { upTo: Infinity, rate: 0.24, label: "3,000억 초과" },
] as const;
function citOf(base: number): { brackets: { label: string; rate: number; amt: number; tax: number }[]; total: number } {
  if (base <= 0) return { brackets: [], total: 0 };
  const brackets: { label: string; rate: number; amt: number; tax: number }[] = [];
  let prev = 0, total = 0;
  for (const b of CIT_BRACKETS) {
    const amt = Math.min(base, b.upTo) - prev;
    if (amt <= 0) break;
    const tax = Math.floor(amt * b.rate);
    brackets.push({ label: b.label, rate: b.rate, amt, tax });
    total += tax;
    prev = b.upTo;
  }
  return { brackets, total };
}

type WhtRow = {
  employee_id: string; name: string; employee_number: string | null;
  /** 사업소득자(프리랜서 3.3%) — 결정 102. 지금 고용형태 기준 */
  biz: boolean;
  period_month: string;
  taxable: number; nonTaxable: number; incomeTax: number; localIncomeTax: number; issuedAt: string | null;
};
const aggOf = (list: WhtRow[]) => ({
  n: list.length,
  taxable: list.reduce((s, r) => s + r.taxable, 0),
  nonTaxable: list.reduce((s, r) => s + r.nonTaxable, 0),
  incomeTax: list.reduce((s, r) => s + r.incomeTax, 0),
  localTax: list.reduce((s, r) => s + r.localIncomeTax, 0),
});

/** payroll_items → WhtRow — 원천세·지급명세서가 같은 해석을 쓴다(두 곳에서 갈리면 안 된다) */
function toWhtRows(data: any[]): WhtRow[] {
  return (data || []).map((r: any) => {
    //   결정 101 — 과세 지급총액 = 과세 기본급 + 과세 수당(extras 의 allowance 는 전부 과세, 비과세 수당은 non_taxable 로 따로 든다)
    const allowance = (Array.isArray(r.extras) ? r.extras : [])
      .filter((e: any) => e?.type === "allowance" && Number(e?.amount) > 0)
      .reduce((s: number, e: any) => s + Math.round(Number(e.amount)), 0);
    return {
      employee_id: r.employee_id,
      name: r.employees?.name || "(이름 없음)",
      employee_number: r.employees?.employee_number || null,
      biz: r.employees?.employment_type === "freelance",
      period_month: r.period_month,
      taxable: Number(r.base_salary || 0) + allowance,
      nonTaxable: Number(r.non_taxable_amount || 0),
      incomeTax: Number(r.income_tax || 0),
      localIncomeTax: Number(r.local_income_tax || 0),
      issuedAt: r.issued_at || null,
    };
  }).sort((a: WhtRow, b: WhtRow) => comparePeople(a, b));
}
const WHT_SELECT = "employee_id, period_month, base_salary, non_taxable_amount, income_tax, local_income_tax, extras, issued_at, employees(name, employee_number, employment_type)";

export default function TaxFilingPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u: any) => { if (u?.company_id) setCompanyId(u.company_id); }); }, []);

  const [tab, setTab] = useState<"wht" | "vat" | "cit" | "stmt">(() => {
    const t = searchParams?.get("tab");
    return t === "vat" ? "vat" : t === "cit" ? "cit" : t === "stmt" ? "stmt" : "wht";
  });
  const [month, setMonth] = useState(prevMonth);
  //   부가세·법인세가 같이 쓰는 연도. 기본값 = 지금 신고할 기수의 해(1/1~25 은 지난해 2기 확정 → 지난해; 법인세도 그 해 3/31 신고라 같다).
  //   홈 세금 일정 딥링크(?tab=vat&year=&period=)가 있으면 그 기수를 그대로 연다 (2026-09-03 후속).
  const [year, setYear] = useState(() => { const q = Number(searchParams?.get("year")); return q >= 2000 && q <= 2100 ? q : vatFilingNow().year; });
  const years = useMemo(() => { const y = Number(todayKst().slice(0, 4)); return [y, y - 1, y - 2]; }, []);
  const [vatPeriod, setVatPeriod] = useState<VatPeriodKey>(() => { const q = searchParams?.get("period"); return VAT_PERIODS.some((p) => p.key === q) ? (q as VatPeriodKey) : vatFilingNow().key; });
  const vatExportRef = useRef<(() => void) | null>(null);   // VatReturn 이 집계 후 채운다 — 조회 줄 [세무사 전달 엑셀]
  //   지급명세서 — 근로는 반기, 사업소득은 달 (결정 103). 기본 반기 = 마지막으로 끝난 반기(1~6월엔 지난해 하반기)
  const [stmtKind, setStmtKind] = useState<"work" | "biz">("work");
  const [stmtYear, setStmtYear] = useState(() => { const t = todayKst(); return Number(t.slice(5, 7)) <= 6 ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4)); });
  const [stmtHalf, setStmtHalf] = useState<1 | 2>(() => (Number(todayKst().slice(5, 7)) <= 6 ? 2 : 1));
  const [stmtMonth, setStmtMonth] = useState(prevMonth);

  const { data: rows = [], isLoading } = useQuery<WhtRow[]>({
    queryKey: ["wht-items", companyId, month],
    enabled: !!companyId && tab === "wht",
    queryFn: async () => toWhtRows(logRead("tax-filing:wht", await (supabase as any).from("payroll_items")
      .select(WHT_SELECT).eq("company_id", companyId!).eq("period_month", month)) as any[]),
  });
  //   지급명세서 자료 — 근로 반기(여섯 달) / 사업소득 한 달
  const stmtMonths = stmtKind === "work" ? halfMonths(stmtYear, stmtHalf) : [stmtMonth];
  const { data: stmtRows = [], isLoading: stmtLoading } = useQuery<WhtRow[]>({
    queryKey: ["wht-stmt", companyId, stmtKind, ...stmtMonths],
    enabled: !!companyId && tab === "stmt",
    queryFn: async () => toWhtRows(logRead("tax-filing:stmt", await (supabase as any).from("payroll_items")
      .select(WHT_SELECT).eq("company_id", companyId!).in("period_month", stmtMonths)) as any[]),
  });

  //   법인세 예상 (결정 104) — 마감·재무제표와 같은 lib(computeStatements = 확정 전표)로 연간 손익을 계산한다.
  //   12월로 부르면 연초~연말 누적(ytd) — 진행 중인 해는 지금까지 확정분만 잡힌다.
  const { data: citStmt, isLoading: citLoading } = useQuery({
    queryKey: ["cit-stmt", companyId, year],
    enabled: !!companyId && tab === "cit",
    queryFn: () => computeStatements(companyId!, `${year}-12`),
  });
  const cit = useMemo(() => {
    const income = Math.round(citStmt?.totals.ytdNet || 0);
    const c = citOf(income);
    const local = Math.floor(c.total * 0.1);
    return { income, ...c, local, sum: c.total + local };
  }, [citStmt]);
  const [packBusy, setPackBusy] = useState(false);

  //   ── 전자신고 파일 베타 (세무 4차, 결정 106) — feature_rollout 'tax_efile' 게이트: 모티브 먼저,
  //   홈택스 변환 검증 + 세무사 검토로 실신고 1회 통과 후 전체 오픈 ──
  const { data: efileOn = false } = useQuery({
    queryKey: ["feature-tax-efile", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("feature_on", { p_feature: "tax_efile", p_company: companyId });
      return !!data;
    },
  });
  const [efileOpen, setEfileOpen] = useState(false);
  useModalKeys(efileOpen, () => setEfileOpen(false));
  //   홈택스 사용자ID — 회사 상수라 브라우저에 기억해 준다(조회 조건이 아니라 설정값)
  const [hometaxId, setHometaxId] = useState("");
  useEffect(() => {
    if (!efileOpen || typeof window === "undefined") return;
    try { setHometaxId(window.localStorage.getItem(`ov.hometax-id.${companyId}`) || ""); } catch { /* 시크릿 등 */ }
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
    try { if (typeof window !== "undefined") window.localStorage.setItem(`ov.hometax-id.${companyId}`, hometaxId.trim()); } catch { /* 무시 */ }
    const work = aggOf(rows.filter((r) => !r.biz));
    const biz = aggOf(rows.filter((r) => r.biz));
    const all = aggOf(rows);
    const efRows: WhtEfileRow[] = [
      { code: "A01" as const, n: work.n, pay: work.taxable, tax: work.incomeTax },
      { code: "A10" as const, n: work.n, pay: work.taxable, tax: work.incomeTax },
      ...(biz.n > 0 ? [
        { code: "A25" as const, n: biz.n, pay: biz.taxable, tax: biz.incomeTax },
        { code: "A30" as const, n: biz.n, pay: biz.taxable, tax: biz.incomeTax },
      ] : []),
      { code: "A99" as const, n: all.n, pay: all.taxable, tax: all.incomeTax },
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
    });
    setEfileIssues(built.issues);
    if (built.bytes) {
      downloadNtsBytes(built.bytes, built.fileName);
      toast(`${built.fileName} 을 내려받았습니다 — 홈택스 › 신고서 파일 변환에서 검증·제출하세요`, "success");
      setEfileOpen(false);
    }
  };

  const T = useMemo(() => ({
    work: aggOf(rows.filter((r) => !r.biz)),
    biz: aggOf(rows.filter((r) => r.biz)),
    all: aggOf(rows),
    lastIssued: rows.reduce<string | null>((m, r) => (r.issuedAt && (!m || r.issuedAt > m) ? r.issuedAt : m), null),
  }), [rows]);

  //   근로 간이지급명세서 — 인별 × 월 피벗 (지급액 = 과세, 서식 작성요령과 같다)
  const workStmt = useMemo(() => {
    const src = stmtRows.filter((r) => !r.biz);
    const byEmp = new Map<string, { employee_id: string; name: string; employee_number: string | null; months: Record<string, number>; total: number }>();
    for (const r of src) {
      const cur = byEmp.get(r.employee_id) || { employee_id: r.employee_id, name: r.name, employee_number: r.employee_number, months: {}, total: 0 };
      cur.months[r.period_month] = (cur.months[r.period_month] || 0) + r.taxable;
      cur.total += r.taxable;
      byEmp.set(r.employee_id, cur);
    }
    return [...byEmp.values()].sort(comparePeople);
  }, [stmtRows]);
  const bizStmt = useMemo(() => stmtRows.filter((r) => r.biz), [stmtRows]);
  const bizStmtT = useMemo(() => aggOf(bizStmt), [bizStmt]);
  //   주민등록번호 등록 여부 (결정 108) — 등록된 직원 id 집합. 전문은 엑셀을 만드는 순간에만 RPC 로 받는다.
  const { data: rrnRegistered = new Set<string>() } = useQuery({
    queryKey: ["rrn-registered", companyId],
    enabled: !!companyId && tab === "stmt",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_rrn_registered");
      if (error) return new Set<string>();
      return new Set<string>(((data || []) as any[]).map((r) => (typeof r === "string" ? r : r.list_rrn_registered || r.employee_id)));
    },
  });
  const stmtEmpIds = useMemo(
    () => (stmtKind === "work" ? workStmt.map((e) => e.employee_id) : bizStmt.map((r) => r.employee_id)),
    [stmtKind, workStmt, bizStmt]);
  const rrnMissing = useMemo(() => stmtEmpIds.filter((id) => !rrnRegistered.has(id)).length, [stmtEmpIds, rrnRegistered]);

  const { toast } = useToast();
  const exportWht = () => {
    if (!rows.length) { toast("이 달 급여 발송 기록이 없습니다", "info"); return; }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["원천징수이행상황신고서 준비", `${month} 지급분 (귀속·지급 같은 달 기준)`, `신고·납부 기한 ${dueOf(month)}`, "발송된 급여 명세 기준 (오너뷰)"], [],
      ["구분", "코드", "인원", "총지급액(과세)", "징수 소득세"],
      ["근로소득 간이세액", "A01", T.work.n, num(T.work.taxable), num(T.work.incomeTax)],
      ["근로소득 가감계", "A10", T.work.n, num(T.work.taxable), num(T.work.incomeTax)],
      ...(T.biz.n > 0 ? [
        ["사업소득 매월징수", "A25", T.biz.n, num(T.biz.taxable), num(T.biz.incomeTax)],
        ["사업소득 가감계", "A30", T.biz.n, num(T.biz.taxable), num(T.biz.incomeTax)],
      ] : []),
      ["총합계", "A99", T.all.n, num(T.all.taxable), num(T.all.incomeTax)], [],
      ["납부 세액(홈택스 · 소득세)", "", "", "", num(T.all.incomeTax)],
      ["지방소득세 특별징수분(위택스 · 별도 신고)", "", "", "", num(T.all.localTax)], [],
      ["※ 퇴직·기타소득 지급분이 있으면 직접 더해야 합니다. 프리랜서(사업소득 3.3%)는 구성원 고용형태를 '프리랜서'로 두면 자동으로 A25에 잡힙니다."],
    ]);
    ws1["!cols"] = [{ wch: 40 }, { wch: 6 }, { wch: 6 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "신고서");
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["이름", "사번", "구분", "총지급액(과세)", "비과세", "소득세", "지방소득세"],
      ...rows.map((r) => [r.name, r.employee_number || "", r.biz ? "사업소득" : "근로", num(r.taxable), num(r.nonTaxable), num(r.incomeTax), num(r.localIncomeTax)]),
      ["합계", "", "", num(T.all.taxable), num(T.all.nonTaxable), num(T.all.incomeTax), num(T.all.localTax)],
    ]);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "인별 명세");
    XLSX.writeFile(wb, `원천세신고준비_${month}.xlsx`);
  };
  //   지급명세서 엑셀 — 주민등록번호는 등록된 직원만 이 순간에 RPC 로 받아 채운다(결정 108: 전문 조회는 기록됨).
  //   미등록은 빈 칸 + '(미등록)' 표기 — 세무사가 채우거나 구성원 상세에서 입력.
  const fetchRrns = async (ids: string[]): Promise<Map<string, string>> => {
    const target = ids.filter((id) => rrnRegistered.has(id));
    const out = new Map<string, string>();
    //   RPC 는 호출당 500명 상한(보안 검수 P3) — 넘으면 청크로 나눠 부른다
    for (let i = 0; i < target.length; i += 500) {
      const { data, error } = await (supabase as any).rpc("get_rrns_for_statement", { p_employee_ids: target.slice(i, i + 500) });
      if (error) { toast(`주민등록번호 조회 실패 — ${friendlyError(error)}`, "error"); return new Map(); }
      for (const r of (data || []) as any[]) out.set(r.employee_id as string, r.rrn as string);
    }
    return out;
  };
  const exportStmt = async () => {
    const wb = XLSX.utils.book_new();
    if (stmtKind === "work") {
      if (!workStmt.length) { toast("이 반기에 발송된 급여 명세가 없습니다", "info"); return; }
      const rrn = await fetchRrns(workStmt.map((e) => e.employee_id));
      const ws = XLSX.utils.aoa_to_sheet([
        ["근로소득 간이지급명세서 준비", `${stmtYear}년 ${stmtHalf === 1 ? "상반기(1~6월)" : "하반기(7~12월)"}`, "발송된 급여 명세 기준 · 지급액=과세 (오너뷰)"], [],
        ["이름", "사번", "주민등록번호", ...stmtMonths.map((m) => `${Number(m.slice(5, 7))}월`), "합계"],
        ...workStmt.map((e) => [e.name, e.employee_number || "", rrn.get(e.employee_id) || "(미등록)", ...stmtMonths.map((m) => num(e.months[m] || 0)), num(e.total)]),
        ["합계", "", "", ...stmtMonths.map((m) => num(workStmt.reduce((s, e) => s + (e.months[m] || 0), 0))), num(workStmt.reduce((s, e) => s + e.total, 0))],
        [], ["※ 주민등록번호가 포함된 파일입니다 — 보관·전달에 주의하세요. (미등록)은 구성원 상세 › 기본 정보에서 입력하면 채워집니다."],
      ]);
      ws["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 20 }, ...stmtMonths.map(() => ({ wch: 12 })), { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, "근로 간이지급명세서");
      XLSX.writeFile(wb, `근로간이지급명세서_${stmtYear}_${stmtHalf === 1 ? "상반기" : "하반기"}.xlsx`);
      if (rrn.size > 0) toast(`주민등록번호 ${rrn.size}명분이 포함됐습니다 — 조회 기록이 남습니다`, "info");
    } else {
      if (!bizStmt.length) { toast("이 달 사업소득(프리랜서) 지급 기록이 없습니다", "info"); return; }
      const rrn = await fetchRrns(bizStmt.map((r) => r.employee_id));
      const ws = XLSX.utils.aoa_to_sheet([
        ["사업소득 간이지급명세서 준비", `${stmtMonth} 지급분`, "발송된 급여 명세 기준 (오너뷰)"], [],
        ["이름", "사번", "주민등록번호", "지급액", "소득세(3%)", "지방소득세(0.3%)"],
        ...bizStmt.map((r) => [r.name, r.employee_number || "", rrn.get(r.employee_id) || "(미등록)", num(r.taxable), num(r.incomeTax), num(r.localIncomeTax)]),
        ["합계", "", "", num(bizStmtT.taxable), num(bizStmtT.incomeTax), num(bizStmtT.localTax)],
        [], ["※ 주민등록번호가 포함된 파일입니다 — 보관·전달에 주의하세요. (미등록)은 구성원 상세 › 기본 정보에서 입력하면 채워집니다."],
      ]);
      ws["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, "사업소득 간이지급명세서");
      XLSX.writeFile(wb, `사업소득간이지급명세서_${stmtMonth}.xlsx`);
      if (rrn.size > 0) toast(`주민등록번호 ${rrn.size}명분이 포함됐습니다 — 조회 기록이 남습니다`, "info");
    }
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
      //   전표 원장 — 세무조정의 원재료. 너무 크면 엑셀이 안 열리므로 3만 줄에서 자르고 잘랐다고 적는다.
      const CAP = 30_000;
      const ws4 = XLSX.utils.aoa_to_sheet([
        ["전표 원장", `${year}년 · 확정 전표 ${lines.length.toLocaleString("ko-KR")}줄${lines.length > CAP ? ` 중 앞 ${CAP.toLocaleString("ko-KR")}줄 (잘림 — 기간을 나눠 다시 받으세요)` : ""} (오너뷰)`], [],
        ["일자", "전표번호", "코드", "계정과목", "차변", "대변", "거래처", "적요"],
        ...lines.slice(0, CAP).map((l) => [l.date, l.voucherNo ?? "", l.code || "", l.name, num(l.debit), num(l.credit), l.partnerName || "", l.memo]),
      ]);
      ws4["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 7 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws4, "전표 원장");
      XLSX.writeFile(wb, `법인세_세무사패키지_${year}.xlsx`);
      toast(`${year}년 패키지를 내려받았습니다 — 손익·재무상태표·고정자산·전표 원장 4개 시트`, "success");
    } catch (e) { toast(friendlyError(e), "error"); }
    finally { setPackBusy(false); }
  };

  if (!permLoading && !(isMaster || hasPerm("/finance/tax-filing")))
    return <AccessDenied detail="세무 신고 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;

  return (
    <div className="qk-shell">
      {/* 전자신고 파일 생성 팝업 (베타, 결정 106) — 확정은 사람: 파일을 받고 홈택스에서 검증·제출한다 */}
      {efileOpen && (
        <div className="inv-modal" onClick={() => setEfileOpen(false)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">원천세 전자신고 파일 (베타)</h3>
            <p className="inv-modal-desc">
              {month} 지급분 정기(매월) 신고서를 홈택스 <b>신고서 파일 변환</b> 업로드용 전산매체(C103900)로 만듭니다.
              내려받은 파일은 홈택스 변환 검증을 거치고, <b>첫 신고는 반드시 세무사 확인 후 제출</b>하세요.
              연말정산·수정신고·환급신청·반기 신고는 이 파일로 안 됩니다 — 홈택스에서 직접.
            </p>
            <div className="inv-bom-base">
              <label className="text-xs font-semibold text-[var(--text-dim)] whitespace-nowrap">홈택스 사용자ID</label>
              <input className="inv-input" value={hometaxId} onChange={(e) => setHometaxId(e.target.value)}
                placeholder="홈택스에 로그인하는 ID (파일 Header 필수값)" maxLength={20} />
            </div>
            <p className="inv-hint">
              {companyInfo
                ? <>회사 정보로 채워집니다 — 사업자번호 <b className="mono-number">{companyInfo.business_number || "(없음)"}</b> · 상호 <b>{companyInfo.name}</b> · 대표 <b>{companyInfo.representative || "(없음)"}</b>. 틀리면 회사설정에서 고치세요.</>
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
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs">
            <button type="button" className={tab === "wht" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("wht")}>원천세</button>
            <button type="button" className={tab === "vat" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("vat")}>부가세</button>
            <button type="button" className={tab === "cit" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("cit")}>법인세</button>
            <button type="button" className={tab === "stmt" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("stmt")}>지급명세서</button>
          </div>
          {tab === "wht" && (<>
            <QueryBar right={<>
              {efileOn && (
                <button type="button" className="btn-secondary btn-sm" disabled={rows.length === 0} onClick={() => { setEfileIssues([]); setEfileOpen(true); }}
                  title="홈택스 '신고서 파일 변환' 업로드용 전산매체 파일 (C103900) — 베타">전자신고 파일 (베타)</button>
              )}
              <button type="button" className="btn-secondary btn-sm" onClick={exportWht} title="신고서 요약 + 인별 명세 — 2개 시트">세무사 전달 엑셀</button>
            </>}>
              <label className="text-xs font-semibold text-[var(--text-dim)]">지급월</label>
              <MonthSelect className="inv-input fin-close-month" value={month} onChange={(v) => v && setMonth(v)} ariaLabel="지급월" />
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <DueDate d={dueOf(month)} /> — 홈택스 › 신고/납부 › 원천세</span>
            </QueryBar>
            <ResultStrip>
              <Stat label="인원" value={`${T.all.n}명${T.biz.n ? ` (사업소득 ${T.biz.n})` : ""}`} />
              <Stat label="총지급액 (과세)" value={won(T.all.taxable)} />
              <Stat label="소득세 (홈택스 납부)" value={won(T.all.incomeTax)} tone={T.all.incomeTax ? "minus" : undefined} />
              <Stat label="지방소득세 (위택스 납부)" value={won(T.all.localTax)} tone={T.all.localTax ? "minus" : undefined} />
            </ResultStrip>
          </>)}
          {tab === "vat" && (
            <QueryBar right={<button type="button" className="btn-secondary btn-sm" onClick={() => vatExportRef.current?.()} title="신고서 · 매출처별 · 매입처별 합계표 · 전표 목록 — 4개 시트">세무사 전달 엑셀</button>}>
              <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={vatPeriod} onChange={(e) => setVatPeriod(e.target.value as VatPeriodKey)} className="qk-input h-8 px-2.5 text-xs" aria-label="신고기간">
                {VAT_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <DueDate d={vatDueDate(year, vatPeriod)} /> — 홈택스 › 신고/납부 › 부가가치세</span>
            </QueryBar>
          )}
          {tab === "cit" && (<>
            <QueryBar right={
              <button type="button" className="btn-secondary btn-sm" disabled={packBusy} onClick={exportCitPack}
                title="손익계산서 · 재무상태표 · 고정자산 명세 · 전표 원장 — 4개 시트">
                {packBusy ? "만드는 중…" : "세무사 전달 패키지"}
              </button>
            }>
              <label className="text-xs font-semibold text-[var(--text-dim)]">사업연도</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="사업연도">
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <DueDate d={`${year + 1}-03-31`} /> · 지방소득세 <DueDate d={`${year + 1}-04-30`} /> — 12월 결산 기준</span>
            </QueryBar>
            <ResultStrip>
              <Stat label="수익" value={won(citStmt?.totals.ytdRevenue || 0)} />
              <Stat label="비용" value={won(citStmt?.totals.ytdExpense || 0)} />
              <Stat label="회계이익 (세무조정 전)" value={won(cit.income)} tone={cit.income < 0 ? "minus" : undefined} />
              <Stat label="예상 법인세+지방세" value={won(cit.sum)} tone={cit.sum ? "minus" : undefined} />
            </ResultStrip>
          </>)}
          {tab === "stmt" && (
            <QueryBar right={<button type="button" className="btn-secondary btn-sm" onClick={exportStmt}>세무사 전달 엑셀</button>}>
              <ChipGroup value={stmtKind} onChange={setStmtKind}
                options={[{ value: "work", label: "근로 (반기)" }, { value: "biz", label: "사업소득 (월)" }] as const} />
              {stmtKind === "work" ? (<>
                <select value={stmtYear} onChange={(e) => setStmtYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">
                  {years.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
                <select value={stmtHalf} onChange={(e) => setStmtHalf(Number(e.target.value) as 1 | 2)} className="qk-input h-8 px-2.5 text-xs" aria-label="반기">
                  <option value={1}>상반기 (1~6월)</option>
                  <option value={2}>하반기 (7~12월)</option>
                </select>
                <span className="text-[11px] text-[var(--text-dim)]">제출 기한 <DueDate d={stmtHalf === 1 ? `${stmtYear}-07-31` : `${stmtYear + 1}-01-31`} /> — 홈택스</span>
              </>) : (<>
                <label className="text-xs font-semibold text-[var(--text-dim)]">지급월</label>
                <input type="month" className="inv-input fin-close-month" value={stmtMonth} onChange={(e) => e.target.value && setStmtMonth(e.target.value)} aria-label="지급월" />
                <span className="text-[11px] text-[var(--text-dim)]">제출 기한 = 지급 다음 달 말일 — 홈택스</span>
              </>)}
            </QueryBar>
          )}
        </QueryHead>
        <QueryBody>
          <div className="ev-scroll fa-scroll">
            {tab === "vat" ? (
              <VatReturn companyId={companyId} year={year} period={vatPeriod} exportRef={vatExportRef} />
            ) : tab === "cit" ? (
              citLoading ? <div className="collect-empty">확정 전표로 연간 손익을 계산하는 중…</div> : (
                <div className="vr-wrap">
                  <p className="inv-hint">
                    {year}년 확정 전표 기준 — 재무제표·마감과 같은 계산입니다.
                    <b className="vr-warn"> 세무조정 전 근사치입니다 — 접대비 한도·감가상각 한도·이월결손금 공제 등이 반영되지 않았습니다. 확정 세액과 신고서는 세무사가 만듭니다.</b>
                    {" 아래 '세무사 전달 패키지'가 3월에 보낼 자료 묶음입니다. 제출은 홈택스에서."}
                  </p>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>예상 법인세</h3><p>2026년 세율 기준 (2억 이하 9% · 200억 이하 19% · 3,000억 이하 21% · 초과 24%)</p>
                      <div className="stg-table-wrap vr-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>구간</th><th>과세표준</th><th>세율</th><th>세액</th></tr></thead>
                        <tbody>
                          <tr className="vr-sum"><td className="text-left">회계이익 (세무조정 전 과세표준)</td><td className="tr mono-number">{won(cit.income)}</td><td></td><td></td></tr>
                          {cit.income <= 0 ? (
                            <tr><td className="text-left" colSpan={3}>결손 — 산출세액 0 (이월결손금 공제·환급은 세무사가 판단합니다)</td><td className="tr mono-number">₩0</td></tr>
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
                      <h3>신고 일정 · 챙길 것</h3><p>12월 결산 법인 기준 — 대시보드 세금 일정에서 납부 완료를 체크할 수 있습니다</p>
                      <div className="stg-table-wrap vr-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>무엇</th><th>기한</th><th>비고</th></tr></thead>
                        <tbody>
                          <tr><td className="text-left">법인세 신고·납부 (홈택스)</td><td className="tc mono-number">{year + 1}-03-31</td><td className="text-left">세무사 패키지를 2월 중 전달</td></tr>
                          <tr><td className="text-left">법인지방소득세 (위택스)</td><td className="tc mono-number">{year + 1}-04-30</td><td className="text-left">산출세액의 10%</td></tr>
                          <tr><td className="text-left">중간예납</td><td className="tc mono-number">{year + 1}-08-31</td><td className="text-left">보통 전년 산출세액의 절반 — 예상 <b className="mono-number">{won(Math.floor(cit.total / 2))}</b>. 가결산 방식은 세무사와 결정</td></tr>
                        </tbody>
                      </table>
                      </div>
                      <p className="inv-foot">예상세액은 자금을 미리 떼어 둘 크기를 가늠하는 용도입니다. 진행 중인 해는 지금까지 확정된 전표만 잡혀 실제 연간 이익보다 작게 보일 수 있습니다.</p>
                    </div>
                  </div>
                </div>
              )
            ) : tab === "stmt" ? (
              stmtLoading ? <div className="collect-empty">불러오는 중…</div> : (
                <div className="vr-wrap">
                  {stmtKind === "work" ? (
                    workStmt.length === 0 ? (
                      <div className="collect-empty">{stmtYear}년 {stmtHalf === 1 ? "상반기" : "하반기"}에 <b>발송된 급여 명세가 없습니다.</b><br />명세서를 발송한 달만 지급명세서에 잡힙니다.</div>
                    ) : (
                      <div className="pnl-panel">
                        <h3>근로소득 간이지급명세서</h3><p>인별 월 지급액(과세) · 사번 순 — 주민등록번호는 엑셀에만 담깁니다(화면 비노출·조회 기록 남음).
                          {rrnMissing > 0 ? <b className="vr-warn"> 주민번호 미등록 {rrnMissing}명 — 구성원 상세 › 기본 정보에서 입력하면 채워집니다.</b> : ` 주민번호 ${stmtEmpIds.length}명 전원 등록됨.`}</p>
                        <div className="stg-table-wrap vr-scroll">
                          <table className="ev-table ev-lined table-inv-status-sm">
                            <thead><tr><th>이름</th>{stmtMonths.map((m) => <th key={m}>{Number(m.slice(5, 7))}월</th>)}<th>합계</th></tr></thead>
                            <tbody>
                              {workStmt.map((e) => (
                                <tr key={`${e.name}-${e.employee_number}`}>
                                  <td className="text-left">{e.name}{e.employee_number && <span className="ev-dim"> #{e.employee_number}</span>}</td>
                                  {stmtMonths.map((m) => <td key={m} className="tr mono-number">{e.months[m] ? won(e.months[m]) : <span className="ev-dim">—</span>}</td>)}
                                  <td className="tr mono-number"><b>{won(e.total)}</b></td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot><tr className="vr-sum"><td className="text-left">합계 ({workStmt.length}명)</td>{stmtMonths.map((m) => <td key={m} className="tr mono-number">{won(workStmt.reduce((s, e) => s + (e.months[m] || 0), 0))}</td>)}<td className="tr mono-number">{won(workStmt.reduce((s, e) => s + e.total, 0))}</td></tr></tfoot>
                          </table>
                        </div>
                      </div>
                    )
                  ) : (
                    bizStmt.length === 0 ? (
                      <div className="collect-empty">{stmtMonth} 지급분 <b>사업소득(프리랜서) 지급 기록이 없습니다.</b><br />구성원 고용형태를 <b>프리랜서</b>로 두고 급여 명세서를 발송하면 3.3%로 계산돼 여기 잡힙니다.</div>
                    ) : (
                      <div className="pnl-panel">
                        <h3>사업소득 간이지급명세서</h3><p>{stmtMonth} 지급분 · 사번 순 — 제출은 지급 다음 달 말일까지. 주민등록번호는 엑셀에만 담깁니다(화면 비노출·조회 기록 남음).
                          {rrnMissing > 0 ? <b className="vr-warn"> 주민번호 미등록 {rrnMissing}명 — 구성원 상세 › 기본 정보에서 입력하면 채워집니다.</b> : ` 주민번호 ${stmtEmpIds.length}명 전원 등록됨.`}</p>
                        <div className="stg-table-wrap vr-scroll">
                          <table className="ev-table ev-lined table-inv-status-sm">
                            <thead><tr><th>이름</th><th>지급액</th><th>소득세 (3%)</th><th>지방소득세 (0.3%)</th></tr></thead>
                            <tbody>
                              {bizStmt.map((r) => (
                                <tr key={r.employee_id}>
                                  <td className="text-left">{r.name}{r.employee_number && <span className="ev-dim"> #{r.employee_number}</span>}</td>
                                  <td className="tr mono-number">{won(r.taxable)}</td>
                                  <td className="tr mono-number">{won(r.incomeTax)}</td>
                                  <td className="tr mono-number">{won(r.localIncomeTax)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot><tr className="vr-sum"><td className="text-left">합계 ({bizStmt.length}명)</td><td className="tr mono-number">{won(bizStmtT.taxable)}</td><td className="tr mono-number">{won(bizStmtT.incomeTax)}</td><td className="tr mono-number">{won(bizStmtT.localTax)}</td></tr></tfoot>
                          </table>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )
            ) : isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : rows.length === 0 ? (
              <div className="collect-empty">
                {month} 지급분 <b>급여 발송 기록이 없습니다.</b><br />
                인사 › 구성원 › 급여에서 명세서를 발송하면 그 금액이 그대로 신고서가 됩니다.<br />
                <span className="ev-dim">급여 지급이 없었어도 원천세는 <b>무실적(0원) 신고</b> 대상입니다 — 홈택스에서 인원·세액 0으로 신고하세요.</span>
              </div>
            ) : (
              <div className="vr-wrap">
                <p className="inv-hint">
                  {month} 지급분 · 발송된 급여 명세({T.all.n}명) 기준 — 귀속·지급 같은 달로 봅니다. 신고는 홈택스에서 사람이 합니다.
                  {T.lastIssued && <> 명세 마지막 발송 <b className="mono-number">{T.lastIssued.slice(0, 10)}</b> — 이후 급여를 고쳤다면 명세서를 다시 발송해야 신고서에 반영됩니다.</>}
                  {" 프리랜서는 구성원 고용형태를 '프리랜서'로 두면 3.3%로 계산돼 사업소득(A25)에 잡힙니다."}
                  <b className="vr-warn"> · 퇴직·기타소득 지급분이 있으면 직접 더해 신고하세요 — 오너뷰가 기록하지 않는 소득입니다.</b>
                </p>
                <div className="pnl-grid2">
                  <div className="pnl-panel">
                    <h3>원천징수이행상황신고서</h3><p>홈택스 신고서 A01{T.biz.n ? "·A25" : ""} 칸에 옮겨 적는 숫자</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>구분</th><th>코드</th><th>인원</th><th>총지급액 (과세)</th><th>징수 소득세</th></tr></thead>
                      <tbody>
                        <tr><td className="text-left">근로소득 간이세액</td><td className="tc mono-number">A01</td><td className="tr mono-number">{T.work.n}</td><td className="tr mono-number">{won(T.work.taxable)}</td><td className="tr mono-number">{won(T.work.incomeTax)}</td></tr>
                        <tr className="vr-sum"><td className="text-left">근로소득 가감계</td><td className="tc mono-number">A10</td><td className="tr mono-number">{T.work.n}</td><td className="tr mono-number">{won(T.work.taxable)}</td><td className="tr mono-number">{won(T.work.incomeTax)}</td></tr>
                        {T.biz.n > 0 && (<>
                          <tr><td className="text-left">사업소득 매월징수 (3.3%)</td><td className="tc mono-number">A25</td><td className="tr mono-number">{T.biz.n}</td><td className="tr mono-number">{won(T.biz.taxable)}</td><td className="tr mono-number">{won(T.biz.incomeTax)}</td></tr>
                          <tr className="vr-sum"><td className="text-left">사업소득 가감계</td><td className="tc mono-number">A30</td><td className="tr mono-number">{T.biz.n}</td><td className="tr mono-number">{won(T.biz.taxable)}</td><td className="tr mono-number">{won(T.biz.incomeTax)}</td></tr>
                        </>)}
                        <tr className="vr-sum"><td className="text-left">총합계</td><td className="tc mono-number">A99</td><td className="tr mono-number">{T.all.n}</td><td className="tr mono-number">{won(T.all.taxable)}</td><td className="tr mono-number">{won(T.all.incomeTax)}</td></tr>
                        <tr className="vr-total"><td className="text-left" colSpan={4}><b>납부 세액 (홈택스 · 소득세)</b></td><td className="tr mono-number"><b>{won(T.all.incomeTax)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="pnl-panel">
                    <h3>지방소득세 (특별징수)</h3><p>소득세의 10% — 홈택스가 아니라 <b>위택스</b>에 별도 신고·납부</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>구분</th><th>인원</th><th>징수 세액</th></tr></thead>
                      <tbody>
                        <tr><td className="text-left">근로소득분 지방소득세</td><td className="tr mono-number">{T.work.n}</td><td className="tr mono-number">{won(T.work.localTax)}</td></tr>
                        {T.biz.n > 0 && <tr><td className="text-left">사업소득분 지방소득세</td><td className="tr mono-number">{T.biz.n}</td><td className="tr mono-number">{won(T.biz.localTax)}</td></tr>}
                        <tr className="vr-total"><td className="text-left" colSpan={2}><b>납부 세액 (위택스)</b></td><td className="tr mono-number"><b>{won(T.all.localTax)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="pnl-panel">
                  <h3>인별 명세</h3><p>발송된 급여 명세 그대로 · 사번 순 — 구분은 지금 고용형태 기준</p>
                  <div className="stg-table-wrap vr-scroll">
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>이름</th><th>구분</th><th>총지급액 (과세)</th><th>비과세</th><th>소득세</th><th>지방소득세</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.employee_id}>
                            <td className="text-left">{r.name}{r.employee_number && <span className="ev-dim"> #{r.employee_number}</span>}</td>
                            <td className="tc">{r.biz ? "사업소득" : "근로"}</td>
                            <td className="tr mono-number">{won(r.taxable)}</td>
                            <td className="tr mono-number">{won(r.nonTaxable)}</td>
                            <td className="tr mono-number">{won(r.incomeTax)}</td>
                            <td className="tr mono-number">{won(r.localIncomeTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="vr-sum"><td className="text-left">합계 ({T.all.n}명)</td><td></td><td className="tr mono-number">{won(T.all.taxable)}</td><td className="tr mono-number">{won(T.all.nonTaxable)}</td><td className="tr mono-number">{won(T.all.incomeTax)}</td><td className="tr mono-number">{won(T.all.localTax)}</td></tr></tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

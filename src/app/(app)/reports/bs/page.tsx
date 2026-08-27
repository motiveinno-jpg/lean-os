"use client";
import { GroupedColumnChart, Legend, vizColor } from "@/components/charts/kit";

import { todayKst } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { useEffect, useState, useCallback, Fragment } from "react";
import { DateField } from "@/components/date-field";
import { ReportHead } from "../_components/ReportHead";
import { Stat } from "@/components/query-kit";
import { fetchJournalLines, countUnposted, bsAmount } from "@/lib/journal-reports";
import { ClosingSnapshotButton } from "@/components/closing-snapshot-button";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PayableInvoice {
  id: string;
  issueDate: string;
  amount: number;
  itemName: string | null;
  status: string;
  ntsConfirmNo: string | null;
}

interface PayableVendor {
  vendor: string;          // counterparty_name
  bizno: string | null;    // counterparty_bizno
  totalAmount: number;
  invoiceCount: number;
  invoices: PayableInvoice[];
}

interface BsData {
  /* Assets — Current */
  cashAndDeposits: number;
  accountsReceivable: number;
  currentAssets: number;
  /* Assets — Fixed */
  fixedAssets: number;
  fixedAssetDetails: { name: string; value: number; type: string; date?: string | null }[];
  totalAssets: number;
  /* Liabilities */
  borrowings: number;
  accountsPayable: number;
  totalLiabilities: number;
  /* Equity */
  capital: number;
  isCapitalDefault: boolean;
  retainedEarnings: number;
  totalEquity: number;
  /* Detail rows */
  bankAccountDetails: { name: string; balance: number; date?: string | null }[];
  loanDetails: { name: string; remainingAmount: number; date?: string | null }[];
  receivableDetails: { name: string; amount: number; date?: string | null }[];
  payableDetails: { name: string; amount: number; date?: string | null }[];
  /* 미지급금 드릴다운: 거래처별 그룹 + 세부 인보이스 */
  payableByVendor: PayableVendor[];
  //   아직 전표로 만들지 않은 자료 — 표가 비어 보이는 이유를 화면이 말하게 한다
  unposted: { taxInvoice: number; card: number; bank: number; total: number };
  //   부호가 뒤집힌 계정 — 마이너스가 왜 났는지 설명하는 데 쓴다
  flipped: { name: string; code: string | null; nature: string; amount: number }[];
}

// 통합 세부 모달용 행 (날짜/거래처/금액)

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const DEFAULT_CAPITAL = 10_000_000;

function formatKrw(value: number): string {
  if (value === 0) return "-";
  const isNeg = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString("ko-KR");
  return isNeg ? `(${formatted})` : formatted;
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
/* Fetch B/S data for a specific cutoff date (or current if not provided) */
async function fetchBsData(companyId: string, cutoffDate?: string): Promise<BsData> {
  //   ★ 2026-08-11 사장님 지시 — 재무상태표도 **전표로 처리된 것만** 반영한다.
  //     예전엔 통장 잔액·세금계산서 미수미지급·대출·자산 원본을 직접 모았다. 그러면 장부와 따로 논다.
  //     이제 확정 전표의 자산·부채·자본 계정 잔액을 그대로 쓴다(회계연도 1/1 ~ 기준일 누적).
  //     ⚠️ 통장 잔액과 장부(103 보통예금) 잔액이 다를 수 있는데, 그 차이가 곧 **아직 안 친 전표**다.
  const cutoff = cutoffDate || todayKst();
  const fromDate = `${cutoff.slice(0, 4)}-01-01`;

  const [lines, unposted, companyRes] = await Promise.all([
    fetchJournalLines(companyId, fromDate, cutoff),
    countUnposted(companyId, fromDate, cutoff),
    supabase.from("companies").select("tax_settings").eq("id", companyId).maybeSingle(),
  ]);

  //   계정별 잔액 — 자산은 차변이 +, 부채·자본은 대변이 +
  type Bal = { name: string; code: string | null; nature: string; amount: number };
  const byAccount = new Map<string, Bal>();
  let pnlNet = 0;                                   // 당기순이익(수익 − 비용) → 이익잉여금
  for (const l of lines) {
    if (l.nature === "revenue" || l.nature === "expense") {
      pnlNet += l.nature === "revenue" ? (l.credit - l.debit) : -(l.debit - l.credit);
      continue;
    }
    const cur = byAccount.get(l.accountId) || { name: l.name, code: l.code, nature: l.nature, amount: 0 };
    cur.amount += bsAmount(l);
    byAccount.set(l.accountId, cur);
  }
  const all = [...byAccount.values()].filter((b) => Math.round(b.amount) !== 0);
  const codeNum = (c: string | null) => parseInt(String(c || "").replace(/\D/g, ""), 10);
  const detail = (b: Bal) => ({ name: `${b.code ? b.code + " " : ""}${b.name}`, amount: Math.round(b.amount) });

  //   ★ 부호가 뒤집힌 계정 — 왜 마이너스인지 화면이 말할 근거 (2026-08-12 사장님 문의)
  //     자산인데 음수 = 그 자산이 **줄어드는 전표만** 쌓였다는 뜻이다.
  //     예: 매출 전표(차변 외상매출금) 없이 **수금 전표(대변 외상매출금)만** 만들면 외상매출금이 음수가 된다.
  //     숫자가 틀린 것이 아니라 **장부가 반쪽**이라는 신호다 — 그 사실을 그대로 적어 준다.
  const flipped = all
    .filter((b) => b.amount < 0 && (b.nature === "asset" || b.nature === "liability"))
    .sort((a2, b2) => a2.amount - b2.amount)
    .slice(0, 4)
    .map((b) => ({ name: b.name, code: b.code, nature: b.nature, amount: b.amount }));

  const assets = all.filter((b) => b.nature === "asset");
  const liabilities = all.filter((b) => b.nature === "liability");
  const equities = all.filter((b) => b.nature === "equity");

  //   유동/비유동 — 계정과목 코드 체계(1xx 유동자산 · 2xx 비유동자산)를 따른다
  const cashAndDeposits = assets.filter((b) => [101, 102, 103].includes(codeNum(b.code)))
    .reduce((s, b) => s + b.amount, 0);
  const accountsReceivable = assets.filter((b) => [108, 110, 120].includes(codeNum(b.code)))
    .reduce((s, b) => s + b.amount, 0);
  const currentAssets = assets.filter((b) => { const n = codeNum(b.code); return !Number.isFinite(n) || n < 200; })
    .reduce((s, b) => s + b.amount, 0);
  const fixedAssets = assets.filter((b) => codeNum(b.code) >= 200).reduce((s, b) => s + b.amount, 0);
  const totalAssets = currentAssets + fixedAssets;

  const borrowings = liabilities.filter((b) => { const n = codeNum(b.code); return n === 260 || n === 293 || n === 294; })
    .reduce((s, b) => s + b.amount, 0);
  const accountsPayable = liabilities.filter((b) => [251, 253, 254, 255, 261].includes(codeNum(b.code)))
    .reduce((s, b) => s + b.amount, 0);
  const totalLiabilities = liabilities.reduce((s, b) => s + b.amount, 0);

  //   ★ 자본금도 **전표에서만** 가져온다. 회사설정 값을 섞어 넣었더니 대차가 깨졌다 —
  //     모든 전표는 차변=대변이라 전표만 쓰면 자산 = 부채 + 자본이 저절로 맞는다.
  //     설정값(회사설정의 자본금)은 전표로 안 친 값이므로 여기 넣으면 그 금액만큼 어긋난다.
  //     자본금 전표가 없으면 0으로 두고 아래 안내로 알린다.
  const capital = equities.filter((b) => codeNum(b.code) === 331).reduce((s, b) => s + b.amount, 0);
  const settingsCapital = Number(((companyRes.data as any)?.tax_settings || {})?.capital || 0);
  const isCapitalDefault = capital === 0;
  void settingsCapital;   // 안내 문구에서만 쓸 수 있게 남겨 둔다(집계에는 넣지 않는다)
  //   이익잉여금 = 전표의 잉여금 계정 + 이번 기간 당기순이익
  const retainedFromJournal = equities.filter((b) => codeNum(b.code) >= 350).reduce((s, b) => s + b.amount, 0);
  const retainedEarnings = retainedFromJournal + pnlNet;
  const totalEquity = capital + retainedEarnings;

  const fixedAssetDetails = assets.filter((b) => codeNum(b.code) >= 200)
    .map((b) => ({ name: detail(b).name, value: detail(b).amount, type: "장부" }));
  const bankAccountDetails = assets.filter((b) => [101, 102, 103].includes(codeNum(b.code)))
    .map((b) => ({ name: detail(b).name, balance: detail(b).amount }));
  const loanDetails = liabilities.filter((b) => { const n = codeNum(b.code); return n === 260 || n === 293 || n === 294; })
    .map((b) => ({ name: detail(b).name, remainingAmount: detail(b).amount }));
  const receivableDetails = assets.filter((b) => [108, 110, 120].includes(codeNum(b.code))).map(detail);
  const payableDetails = liabilities.filter((b) => [251, 253, 254, 255, 261].includes(codeNum(b.code))).map(detail);
  //   거래처별 미지급 드릴다운은 세금계산서 원본을 봐야 하는데, 전표 기준에서는 원천이 다르다 → 비운다
  const payableByVendor: PayableVendor[] = [];

  return {
    cashAndDeposits,
    accountsReceivable,
    currentAssets,
    fixedAssets,
    fixedAssetDetails,
    totalAssets,
    borrowings,
    accountsPayable,
    totalLiabilities,
    capital,
    isCapitalDefault,
    retainedEarnings,
    totalEquity,
    bankAccountDetails,
    loanDetails,
    receivableDetails,
    payableDetails,
    payableByVendor,
    unposted,
    flipped,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Financial ratio helpers                                            */
/* ------------------------------------------------------------------ */
interface RatioInfo {
  label: string;
  value: number;
  unit: string;
  health: "green" | "yellow" | "red";
  description: string;
}

function computeRatios(d: BsData): RatioInfo[] {
  const currentLiabilities = d.accountsPayable;

  const currentRatio = currentLiabilities > 0
    ? (d.currentAssets / currentLiabilities) * 100
    : d.currentAssets > 0 ? 999 : 0;

  const debtToEquity = d.totalEquity > 0
    ? (d.totalLiabilities / d.totalEquity) * 100
    : d.totalLiabilities > 0 ? 999 : 0;

  const equityRatio = d.totalAssets > 0
    ? (d.totalEquity / d.totalAssets) * 100
    : 0;

  return [
    {
      label: "유동비율 (Current Ratio)",
      value: Math.round(currentRatio),
      unit: "%",
      health: currentRatio >= 200 ? "green" : currentRatio >= 100 ? "yellow" : "red",
      description: "200% 이상 양호 / 100% 미만 단기 유동성 위험",
    },
    {
      label: "부채비율 (Debt-to-Equity)",
      value: Math.round(debtToEquity),
      unit: "%",
      health: debtToEquity <= 100 ? "green" : debtToEquity <= 200 ? "yellow" : "red",
      description: "100% 이하 안정 / 200% 초과 과다부채",
    },
    {
      label: "자기자본비율 (Equity Ratio)",
      value: Math.round(equityRatio),
      unit: "%",
      health: equityRatio >= 50 ? "green" : equityRatio >= 30 ? "yellow" : "red",
      description: "50% 이상 건전 / 30% 미만 자본 취약",
    },
  ];
}

const HEALTH_COLORS: Record<string, string> = {
  green: "var(--viz-pos)",
  yellow: "var(--viz-warn)",
  red: "var(--viz-neg)",
};

/* ------------------------------------------------------------------ */
/*  Print CSS                                                          */
/* ------------------------------------------------------------------ */
const PRINT_CSS = `
@media print {
  body { background: white !important; color: black !important; }
  body * { visibility: hidden; }
  #bs-printable, #bs-printable * { visibility: visible; color: black !important; }
  #bs-printable {
    position: absolute; left: 0; top: 0; width: 100%;
    padding: 20px; background: white !important;
  }
  nav, .sidebar, .no-print, button { display: none !important; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; }
  @page { margin: 15mm; }
}
`;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
interface TrendPoint {
  month: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

async function fetchBsTrend(companyId: string, months: number = 6): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const cutoff = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    const label = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const bs = await fetchBsData(companyId, cutoff);
      points.push({ month: label, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity });
    } catch {
      points.push({ month: label, totalAssets: 0, totalLiabilities: 0, totalEquity: 0 });
    }
  }
  return points;
}

export default function BalanceSheetPage() {
  const { role } = useUser();
  // 게이트 early return 뒤 훅 = React #310 결함류 — 본문 분리 (2026-08-03)
  if (role === "partner") {
    return <AccessDenied detail="재무상태표는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return <BalanceSheetPageInner />;
}

function BalanceSheetPageInner() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [data, setData] = useState<BsData | null>(null);
  const [prevData, setPrevData] = useState<BsData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompareMode, setIsCompareMode] = useState(false);
  // 기준일 — 빈 값이면 오늘, 사용자가 지정하면 그 시점 BS 조회
  const [cutoffInput, setCutoffInput] = useState<string>('');
  // 2026-06-10 매출채권/미지급금 집계 기간(개월) — 최근 N개월 송장만 outstanding 으로 간주
  const [showPayableDrill, setShowPayableDrill] = useState(false);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  // 통합 세부 모달: 자산/부채 항목 클릭 시 열림

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) setCompanyId(u.company_id);
      else setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setIsLoading(true);
    setError(null);

    // 기준일: 사용자가 지정 했으면 그 날짜, 아니면 오늘
    const baseDate = cutoffInput || todayKst();
    const baseObj = new Date(baseDate);
    const prevMonth = new Date(baseObj.getFullYear(), baseObj.getMonth() - 1, 1);
    const prevCutoff = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    Promise.all([
      fetchBsData(companyId, cutoffInput || undefined),
      fetchBsData(companyId, prevCutoff),
      fetchBsTrend(companyId, 6),
    ])
      .then(([current, prev, trendData]) => {
        setData(current);
        setPrevData(prev);
        setTrend(trendData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [companyId, cutoffInput]);

  /* ---------------------------------------------------------------- */
  /*  CSV Export                                                       */
  /* ---------------------------------------------------------------- */
  const handleExportCsv = useCallback(() => {
    if (!data) return;
    const lines: string[] = [];
    lines.push("구분,항목,금액");

    lines.push("유동자산,,");
    lines.push(`유동자산,현금 및 예금,${Math.round(data.cashAndDeposits)}`);
    for (const b of data.bankAccountDetails) {
      lines.push(`유동자산 > 현금 및 예금,${b.name},${Math.round(b.balance)}`);
    }
    lines.push(`유동자산,매출채권,${Math.round(data.accountsReceivable)}`);
    for (const r of data.receivableDetails) {
      lines.push(`유동자산 > 매출채권,${r.name},${Math.round(r.amount)}`);
    }
    lines.push(`유동자산 소계,,${Math.round(data.currentAssets)}`);
    lines.push("");
    lines.push("고정자산,,");
    for (const a of data.fixedAssetDetails) {
      lines.push(`고정자산,${a.name} (${a.type}),${Math.round(a.value)}`);
    }
    lines.push(`고정자산 소계,,${Math.round(data.fixedAssets)}`);
    lines.push(`자산 합계,,${Math.round(data.totalAssets)}`);

    lines.push("");
    lines.push("부채,,");
    lines.push(`부채,차입금,${Math.round(data.borrowings)}`);
    for (const l of data.loanDetails) {
      lines.push(`부채 > 차입금,${l.name},${Math.round(l.remainingAmount)}`);
    }
    lines.push(`부채,미지급금,${Math.round(data.accountsPayable)}`);
    for (const p of data.payableDetails) {
      lines.push(`부채 > 미지급금,${p.name},${Math.round(p.amount)}`);
    }
    lines.push(`부채 합계,,${Math.round(data.totalLiabilities)}`);

    lines.push("");
    lines.push("자본,,");
    lines.push(`자본,자본금,${Math.round(data.capital)}`);
    lines.push(`자본,이익잉여금,${Math.round(data.retainedEarnings)}`);
    lines.push(`자본 합계,,${Math.round(data.totalEquity)}`);

    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = todayKst();
    a.download = `재무상태표_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /*  Loading / Error / Empty states                                   */
  /* ---------------------------------------------------------------- */
  if (isLoading) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 20,
              height: 20,
              border: "2px solid var(--border)",
              borderTopColor: "var(--primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
            재무상태표 데이터를 불러오는 중...
          </span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 8,
            background: "var(--danger-dim)",
            color: "var(--danger)",
            fontSize: 14,
          }}
        >
          데이터 로드 실패: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-16 text-center">
        <div className="text-4xl mb-3"><Ico e="📋" /></div>
        <div className="text-sm font-medium text-[var(--text)]">거래 데이터가 쌓이면 재무상태표가 자동 생성됩니다</div>
        <div className="text-xs text-[var(--text-muted)] mt-1">거래내역과 계좌 정보를 먼저 등록해주세요</div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */
  const today = todayKst();

  return (
    <div id="bs-printable">
      <style>{PRINT_CSS}</style>
      {/* 리포트 표준 2차(2026-08-19) — 조회 줄(기준일·채권채무 안내 ‖ 전월 비교·CSV·인쇄)과 핵심 지표는 상자 머리에 고정 */}
      <ReportHead
        bar={<>
          <span className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--text-dim)]">기준일</label>
            <DateField value={cutoffInput || today} max={today} onChange={(e) => setCutoffInput(e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]" />
            {cutoffInput && cutoffInput !== today && (
              <button onClick={() => setCutoffInput('')} className="text-[11px] text-[var(--primary)] font-semibold hover:underline" title="오늘로 초기화">↺ 오늘</button>
            )}
          </span>
          <span className="text-[11px] text-[var(--text-dim)]">채권·채무는 해당연도 <b className="text-[var(--text-muted)]">1/1 ~ 기준일</b> 확정 전표 누적</span>
        </>}
        right={<>
          {/*   마감 확정본 — 잠근 달의 재무상태표, 지금과 다르면 ⚠ (2026-08-27 ERP ③) */}
          <ClosingSnapshotButton companyId={companyId} kind="bs" year={(cutoffInput || today).slice(0, 4)} />
          <button onClick={() => setIsCompareMode((v) => !v)} aria-label="전월 비교" className={isCompareMode ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" /></svg>
            전월 비교
          </button>
          <button onClick={handleExportCsv} aria-label="CSV 다운로드" className="btn-secondary btn-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            CSV
          </button>
          <button onClick={() => window.print()} aria-label="인쇄" className="btn-secondary btn-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /></svg>
            인쇄
          </button>
        </>}
        stats={<>
          {[
            { key: "asset", label: "총 자산", value: data.totalAssets, prev: prevData?.totalAssets, tone: undefined as "plus" | "minus" | undefined },
            { key: "liab", label: "총 부채", value: data.totalLiabilities, prev: prevData?.totalLiabilities, tone: "minus" as const },
            { key: "equity", label: "순자산 (자본)", value: data.totalEquity, prev: prevData?.totalEquity, tone: (data.totalEquity >= 0 ? "plus" : "minus") as "plus" | "minus" },
          ].map((card) => {
            const delta = isCompareMode && card.prev !== undefined ? card.value - card.prev : undefined;
            return (
              <Stat key={card.key} label={card.label} tone={card.tone}
                value={<>{card.value < 0 ? "-" : ""}₩{Math.abs(Math.round(card.value)).toLocaleString("ko-KR")}{delta !== undefined && <small className={`ml-1 font-semibold ${delta === 0 ? "text-[var(--text-dim)]" : delta > 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{delta === 0 ? "전월과 동일" : `${delta > 0 ? "▲" : "▼"} ₩${Math.abs(Math.round(delta)).toLocaleString("ko-KR")}`}</small>}</>} />
            );
          })}
        </>}
      />

      {/* Balance Sheet — T자 레이아웃 (좌: 자산 / 우: 부채 + 자본).
          2026-08-19 사장님: "재무상태표 자세하게, T자표 진행" — 공용 머리단(계정과목·금액·전월 대비) 표 두 장,
          계정을 누르면 그 자리에서 세부(통장별·거래처별·자산별)가 펼쳐진다. 소계·총계 줄은 굵게. */}
      <div className="bs-balance-sheet-grid">
        <BsSide title="자산 (Assets)" isCompareMode={isCompareMode}
          sections={[
            { label: "유동자산 (Current Assets)", subtotalLabel: "유동자산 소계", subtotal: data.currentAssets, prevSubtotal: isCompareMode && prevData ? prevData.currentAssets : undefined,
              rows: [
                { key: "cash", label: "현금 및 예금", amount: data.cashAndDeposits, prev: isCompareMode && prevData ? prevData.cashAndDeposits : undefined,
                  details: data.bankAccountDetails.map((b: any) => ({ name: b.name, amount: b.balance, date: b.date || null })) },
                { key: "ar", label: "매출채권", amount: data.accountsReceivable, prev: isCompareMode && prevData ? prevData.accountsReceivable : undefined,
                  details: data.receivableDetails.map((r: any) => ({ name: r.name, amount: r.amount, date: r.date || null })) },
              ] },
            { label: "고정자산 (Fixed Assets)", subtotalLabel: "고정자산 소계", subtotal: data.fixedAssets, prevSubtotal: isCompareMode && prevData ? prevData.fixedAssets : undefined,
              rows: [
                { key: "fa", label: "고정자산", amount: data.fixedAssets, prev: isCompareMode && prevData ? prevData.fixedAssets : undefined,
                  details: data.fixedAssetDetails.map((a: any) => ({ name: `${a.name} (${a.type})`, amount: a.value, date: a.date || null })) },
              ] },
          ]}
          total={{ label: "자산 총계", amount: data.totalAssets, prev: isCompareMode && prevData ? prevData.totalAssets : undefined }} />

        <BsSide title="부채 + 자본 (Liabilities + Equity)" isCompareMode={isCompareMode}
          sections={[
            { label: "부채 (Liabilities)", subtotalLabel: "부채 합계", subtotal: data.totalLiabilities, prevSubtotal: isCompareMode && prevData ? prevData.totalLiabilities : undefined,
              rows: [
                { key: "loan", label: "차입금", amount: data.borrowings, prev: isCompareMode && prevData ? prevData.borrowings : undefined,
                  details: data.loanDetails.map((l: any) => ({ name: l.name, amount: l.remainingAmount, date: l.date || null })) },
                { key: "ap", label: "미지급금", amount: data.accountsPayable, prev: isCompareMode && prevData ? prevData.accountsPayable : undefined,
                  details: data.payableDetails.map((p: any) => ({ name: p.name, amount: p.amount, date: p.date || null })) },
              ] },
            { label: "자본 (Equity)", subtotalLabel: "자본 합계", subtotal: data.totalEquity, prevSubtotal: isCompareMode && prevData ? prevData.totalEquity : undefined,
              rows: [
                { key: "cap", label: data.isCapitalDefault ? "자본금 (기본값)" : "자본금", amount: data.capital, prev: isCompareMode && prevData ? prevData.capital : undefined },
                { key: "re", label: "이익잉여금", amount: data.retainedEarnings, prev: isCompareMode && prevData ? prevData.retainedEarnings : undefined,
                  note: "누적 손익 — 손익계산서 당기순이익이 쌓인 것" },
              ] },
          ]}
          total={{ label: "부채와 자본 총계", amount: data.totalLiabilities + data.totalEquity, prev: isCompareMode && prevData ? prevData.totalLiabilities + prevData.totalEquity : undefined }} />
      </div>

      {/* 합계 요약 — 자산 vs 부채+자본 (표 바로 아래 정적 요약, sticky 제거: 하단 콘텐츠 위로 떠다니고 헤더와 z충돌하던 문제 수정 2026-06-10) */}
      <div className="bs-balance-summary">
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--primary)]/8 border border-[var(--primary)]/20">
          <div className="text-xs font-bold text-[var(--primary)]">자산 합계</div>
          <div className="text-base font-extrabold text-[var(--primary)] mono-number">₩{Math.round(data.totalAssets).toLocaleString("ko-KR")}</div>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--warning)]/8 border border-[var(--warning)]/20">
          <div className="text-xs font-bold text-[var(--warning)]">부채 + 자본 합계</div>
          <div className="text-base font-extrabold text-[var(--warning)] mono-number">₩{Math.round(data.totalLiabilities + data.totalEquity).toLocaleString("ko-KR")}</div>
        </div>
        {/* 균형 여부 표시 — 회계 정합성 */}
        {Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) > 1 && (
          <div className="md:col-span-2 px-3 py-1.5 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30 text-[10px] text-[var(--warning)]">
            <Ico e="⚠" /> 차변(자산) - 대변(부채+자본) 차이 ₩{Math.round(data.totalAssets - (data.totalLiabilities + data.totalEquity)).toLocaleString("ko-KR")} — 자본금 / 이익잉여금 데이터 확인 필요
          </div>
        )}
      </div>

      {/* Asset vs Liability Composition Bar — 섹션 제목을 카드 안 헤더로 흡수 (2026-07-03 라운드6.5) */}
      <div className="bs-composition-chart glass-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="m-0 text-sm font-bold text-[var(--text)]">자산/부채 구성</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Assets bar */}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, fontWeight: 500 }}>
              자산 {data.totalAssets > 0 ? `₩${Math.round(data.totalAssets).toLocaleString("ko-KR")}` : ""}
            </div>
            <div style={{ display: "flex", gap: 2, height: 20, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface)" }}>
              {data.totalAssets > 0 && (
                <>
                  <div
                    style={{
                      width: `${Math.round((data.cashAndDeposits / data.totalAssets) * 100)}%`,
                      background: "var(--viz-1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.cashAndDeposits > 0 ? 40 : 0,
                    }}
                    title={`현금 및 예금: ₩${Math.round(data.cashAndDeposits).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.cashAndDeposits / data.totalAssets) * 100) > 10 ? "현금" : ""}
                  </div>
                  <div
                    style={{
                      width: `${Math.round((data.accountsReceivable / data.totalAssets) * 100)}%`,
                      background: "var(--viz-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.accountsReceivable > 0 ? 40 : 0,
                    }}
                    title={`매출채권: ₩${Math.round(data.accountsReceivable).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.accountsReceivable / data.totalAssets) * 100) > 10 ? "채권" : ""}
                  </div>
                  {data.fixedAssets > 0 && (
                    <div
                      style={{
                        width: `${Math.round((data.fixedAssets / data.totalAssets) * 100)}%`,
                        background: "var(--viz-8)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        color: "#fff",
                        fontWeight: 600,
                        minWidth: 40,
                      }}
                      title={`고정자산: ₩${Math.round(data.fixedAssets).toLocaleString("ko-KR")}`}
                    >
                      {Math.round((data.fixedAssets / data.totalAssets) * 100) > 10 ? "고정" : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {/* Liabilities + Equity bar */}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, fontWeight: 500 }}>
              부채 + 자본
            </div>
            <div style={{ display: "flex", gap: 2, height: 20, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface)" }}>
              {(data.totalLiabilities + data.totalEquity) > 0 && (
                <>
                  <div
                    style={{
                      width: `${Math.round((data.totalLiabilities / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100)}%`,
                      background: "var(--viz-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.totalLiabilities > 0 ? 40 : 0,
                    }}
                    title={`부채: ₩${Math.round(data.totalLiabilities).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((data.totalLiabilities / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100) > 10 ? "부채" : ""}
                  </div>
                  <div
                    style={{
                      width: `${Math.round((Math.max(data.totalEquity, 0) / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100)}%`,
                      background: "var(--viz-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 600,
                      minWidth: data.totalEquity > 0 ? 40 : 0,
                    }}
                    title={`자본: ₩${Math.round(data.totalEquity).toLocaleString("ko-KR")}`}
                  >
                    {Math.round((Math.max(data.totalEquity, 0) / (data.totalLiabilities + Math.max(data.totalEquity, 0))) * 100) > 10 ? "자본" : ""}
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text-dim)", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--viz-1)", display: "inline-block" }} />현금
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--viz-3)", display: "inline-block" }} />채권/자본
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--viz-8)", display: "inline-block" }} />고정자산
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--viz-2)", display: "inline-block" }} />부채
            </span>
          </div>
        </div>
      </div>

      {/* 데이터 신뢰도 배너 — 자본 섹션 추정값 안내 (정확도 투명성) */}
      {data.isCapitalDefault && (
        <div className="bs-capital-warning kpi-callout warning">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86l-8.1 14A1 1 0 003 19.5h18a1 1 0 00.87-1.5l-8.1-14a1 1 0 00-1.74 0z" /></svg>
          <p className="text-[11.5px] leading-relaxed">
            <b>자본금이 미등록 상태입니다.</b> 기본값 {DEFAULT_CAPITAL.toLocaleString("ko-KR")}원으로 표시 중이라 자본·이익잉여금이 부정확합니다. <Link href="/settings?tab=company" className="underline font-semibold">회사 설정 → 회사정보</Link>에서 자본금을 입력하면 정확해집니다.
          </p>
        </div>
      )}

      {/*   ★ 마이너스가 왜 났는지 — 숫자는 맞는데 장부가 반쪽일 때 (2026-08-12 사장님 문의) */}
      {data.flipped.length > 0 && (
        <div className="bs-flipped-note kpi-callout warning">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.2 16a2 2 0 001.73 3z" /></svg>
          <p className="text-[11.5px] leading-relaxed">
            <b>마이너스로 보이는 이유</b> — 아래 계정은 <b>줄어드는 전표만</b> 쌓여 있습니다.{" "}
            {data.flipped.map((f) => `${f.code ? f.code + " " : ""}${f.name} ${Math.round(f.amount).toLocaleString()}`).join(" · ")}
            <br />
            예를 들어 <b>외상매출금</b>이 음수라면, 매출을 전표로 올리지 않은 채 <b>수금(입금) 전표만</b> 만든 것입니다.
            숫자가 틀린 게 아니라 <b>장부가 아직 반쪽</b>이라는 뜻이라, 빠진 매출·매입 전표를 채우면 제자리로 돌아옵니다.
          </p>
        </div>
      )}

      {/*   ★ 전표만 반영한다 — 비어 보이는 이유를 화면이 스스로 말한다 (2026-08-11 사장님 지시) */}
      {data.unposted.total > 0 && (
        <div className="bs-unposted-banner kpi-callout warning">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.2 16a2 2 0 001.73 3z" /></svg>
          <p className="text-[11.5px] leading-relaxed">
            이 표는 <b>전표로 처리된 것만</b> 보여 줍니다. 아직 전표로 만들지 않은 자료가{" "}
            <b>{data.unposted.total.toLocaleString()}건</b> 있습니다
            {" ("}
            {[
              data.unposted.taxInvoice > 0 ? `세금계산서 ${data.unposted.taxInvoice.toLocaleString()}` : null,
              data.unposted.card > 0 ? `카드 ${data.unposted.card.toLocaleString()}` : null,
              data.unposted.bank > 0 ? `통장 ${data.unposted.bank.toLocaleString()}` : null,
            ].filter(Boolean).join(" · ")}
            {") — 그만큼 이 표에 빠져 있습니다. "}
            <Link href="/collect" className="underline font-semibold">수집·전표</Link>에서 전표를 만들면 바로 반영됩니다.
          </p>
        </div>
      )}

      {/* 통장 실제 잔액과 장부(103 보통예금) 잔액이 다르면 그 차이가 곧 '아직 안 친 전표'다 */}
      {(data.receivableDetails.length > 0 || data.payableDetails.length > 0) && (
        <div className="bs-accuracy-callout kpi-callout">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-[11.5px] leading-relaxed">
            매출채권 {data.receivableDetails.length}건 · 미지급금 {data.payableDetails.length}건은 <b>확정 전표의 계정 잔액</b>입니다.
            통장 실제 잔액과 다르면 그 차이가 <b>아직 전표로 만들지 않은 거래</b>입니다 —
            <Link href="/collect?tab=bank" className="underline font-semibold"> 수집·전표 › 통장</Link>에서 처리하면 맞아집니다.
          </p>
        </div>
      )}

      {/* 산출 기준 — 접이식 */}
      <details className="bs-basis-details group">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
            <svg className="w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 16v-4m0-4h.01" /></svg>
            산출 기준 자세히 보기
          </span>
          <svg className="w-4 h-4 text-[var(--text-dim)] transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </summary>
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[11.5px] leading-relaxed text-[var(--text-dim)] border-t border-[var(--border)] pt-3">
          <div>· <b className="text-[var(--text-muted)]">현금·예금</b> = 등록 은행계좌 잔액 합계</div>
          <div>· <b className="text-[var(--text-muted)]">매출채권</b> = 미입금(미매칭) 매출 세금계산서. 입금 매칭 시 현금으로 이동·상계</div>
          <div>· <b className="text-[var(--text-muted)]">고정자산</b> = 자산관리(Vault) 등록 자산의 감가상각 장부가</div>
          <div>· <b className="text-[var(--text-muted)]">차입금</b> = 진행 중 대출 잔액</div>
          <div>· <b className="text-[var(--text-muted)]">미지급금</b> = 미지급 매입 세금계산서 − 확정 정산액(부분정산 반영)</div>
          <div>· <b className="text-[var(--text-muted)]">매출채권/미지급금</b>은 확정 정산액을 차감해 산출(정산 원장 반영)</div>
          <div>· <b className="text-[var(--text-muted)]">이익잉여금</b> = 순자산(자산−부채) − 납입자본금</div>
        </div>
      </details>

      {/* Monthly Trend Chart — 섹션 제목을 카드 안 헤더로 흡수 (2026-07-03 라운드6.5) */}
      {trend.length > 0 && (
        <div className="bs-trend-section">
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="m-0 text-sm font-bold text-[var(--text)]">월별 추이 (최근 6개월)</h3>
            </div>
            {/* 차트 키트의 묶음 막대 — 눈금·격자·손대면 뜨는 값·범례가 다른 화면과 같은 규칙이 된다
                (2026-08-07 사장님: "색뿐 아니라 디자인도"). 예전엔 브라우저 기본 말풍선이라
                1초쯤 기다려야 값이 보였고 세 계열을 한 번에 비교할 수 없었다. */}
            <GroupedColumnChart
              height={200} unit="원"
              labels={trend.map((p) => p.month)}
              series={[
                { name: "자산", values: trend.map((p) => p.totalAssets) },
                { name: "부채", values: trend.map((p) => p.totalLiabilities) },
                { name: "자본", values: trend.map((p) => Math.max(p.totalEquity, 0)) },
              ]} />
            <div className="mt-3 flex justify-center">
              <Legend items={[
                { name: "자산", color: vizColor(0) },
                { name: "부채", color: vizColor(1) },
                { name: "자본", color: vizColor(2) },
              ]} />
            </div>
          </div>
        </div>
      )}

      {/* 통합 세부 모달 — 자산/부채 항목 클릭 시 열림 */}

      {/* Financial Ratios */}
      <div className="bs-ratios-section">
        <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">Ratios</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>
          재무 비율 분석
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {computeRatios(data).map((ratio) => (
            <div key={ratio.label} className="bs-ratio-card glass-card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: HEALTH_COLORS[ratio.health], flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", color: "var(--text-muted)" }}>
                  {ratio.label}
                </span>
              </div>
              <div className="mono-number" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: HEALTH_COLORS[ratio.health], marginBottom: 8 }}>
                {ratio.value === 999 ? "N/A" : `${ratio.value}${ratio.unit}`}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {ratio.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── T자표 한쪽 — 공용 머리단 표 + 계정 줄(누르면 세부 펼침) + 소계·총계 (2026-08-19) ── */
type BsDetail = { name: string; amount: number; date?: string | null };
type BsRow = { key: string; label: string; amount: number; prev?: number; details?: BsDetail[]; note?: string };
type BsSection = { label: string; rows: BsRow[]; subtotalLabel: string; subtotal: number; prevSubtotal?: number };
function BsSide({ title, sections, total, isCompareMode }: {
  title: string; sections: BsSection[]; total: { label: string; amount: number; prev?: number }; isCompareMode: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const cols = isCompareMode ? 3 : 2;
  const amt = (v: number, bold = false) => (
    <span className={`mono-number ${bold ? "font-bold" : ""} ${v < 0 ? "text-[var(--danger)]" : ""}`}>{formatKrw(v)}</span>
  );
  const deltaCell = (cur: number, prev?: number) => {
    if (!isCompareMode) return null;
    const d = prev === undefined ? undefined : cur - prev;
    return (
      <td className={`text-right mono-number ${d === undefined || d === 0 ? "text-[var(--text-dim)]" : d > 0 ? "text-[var(--viz-pos)]" : "text-[var(--viz-neg)]"}`}>
        {d === undefined || d === 0 ? "-" : `${d > 0 ? "+" : ""}${formatKrw(d)} ${d > 0 ? "\u25B2" : "\u25BC"}`}
      </td>
    );
  };
  const LIMIT = 8;
  return (
    <div className="bs-side">
      <div className="bs-side-title">{title}</div>
      <table className="ev-table ev-lined bs-t-table">
        <thead>
          <tr>
            <th className="text-left">계정과목</th>
            <th>금액 (원)</th>
            {isCompareMode && <th>전월 대비</th>}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => (
            <Fragment key={sec.label}>
              <tr className="bs-sec-head"><td colSpan={cols}>{sec.label}</td></tr>
              {sec.rows.map((r) => {
                const has = (r.details?.length ?? 0) > 0;
                const isOpen = open.has(r.key);
                const list = r.details || [];
                const shown = showAll.has(r.key) ? list : list.slice(0, LIMIT);
                const rest = list.length - shown.length;
                return (
                  <Fragment key={r.key}>
                    <tr className={has ? "bs-acct-row bs-acct-row-click" : "bs-acct-row"} onClick={() => has && toggle(r.key)} title={has ? (isOpen ? "세부 접기" : "세부 펼치기") : undefined}>
                      <td className="text-left">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`bs-caret ${has ? "" : "invisible"} ${isOpen ? "rotate-90" : ""}`}>▸</span>
                          {r.label}
                          {has && <em className="bs-cnt">{list.length}</em>}
                          {r.note && <small className="text-[10px] text-[var(--text-dim)]">{r.note}</small>}
                        </span>
                      </td>
                      <td className="text-right">{amt(r.amount)}</td>
                      {deltaCell(r.amount, r.prev)}
                    </tr>
                    {has && isOpen && shown.map((d, i) => (
                      <tr key={`${r.key}-${i}`} className="bs-detail-row">
                        <td className="text-left"><span className="bs-detail-name">{d.name}{d.date && <small className="ml-1 text-[var(--text-dim)]">{String(d.date).slice(0, 10)}</small>}</span></td>
                        <td className="text-right">{amt(d.amount)}</td>
                        {isCompareMode && <td />}
                      </tr>
                    ))}
                    {has && isOpen && rest > 0 && (
                      <tr className="bs-detail-row">
                        <td colSpan={cols} className="text-left">
                          <button type="button" className="text-[11px] font-semibold text-[var(--primary)] hover:underline pl-7" onClick={(e) => { e.stopPropagation(); setShowAll((o) => new Set(o).add(r.key)); }}>나머지 {rest}건 더 보기</button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="bs-subtotal-row">
                <td className="text-left">{sec.subtotalLabel}</td>
                <td className="text-right">{amt(sec.subtotal, true)}</td>
                {deltaCell(sec.subtotal, sec.prevSubtotal)}
              </tr>
            </Fragment>
          ))}
          <tr className="bs-total-row">
            <td className="text-left">{total.label}</td>
            <td className="text-right">{amt(total.amount, true)}</td>
            {deltaCell(total.amount, total.prev)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================ */
/*  Sub-components                                                */
/* ============================================================ */


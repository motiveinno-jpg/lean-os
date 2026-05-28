"use client";

// /bank — 통장 자립 페이지(시안 적용). 8줄 passthrough 래퍼에서 승격.
//   3탭: 개요 / 통장들 / 거래내역. transactions/page.tsx 본문 0줄 변경(import만).
//   BankAccountsOverview 본문 0줄 변경. CODEF sync·자동매칭·규칙엔진 무관(시각만).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { SiyanPageHeader } from "@/components/siyan";
import { BankAccountsOverview } from "@/components/bank-accounts-overview";
import { TransactionsView } from "../transactions/page";
import { UpcomingAutoTransfersCard } from "@/components/upcoming-auto-transfers";
import { AutoTransferHistoryCard } from "@/components/auto-transfer-history";
import { TopExpensesThisMonth } from "@/components/top-expenses-month";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Tab = "overview" | "accounts" | "transactions";

export default function BankPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const [tab, setTab] = useState<Tab>("accounts");
  const [selectedAccountNo, setSelectedAccountNo] = useState<string>("");

  // 기간 — 이번 달 KST 1일~말일, 전월 동일.
  const ranges = useMemo(() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    const cur = { from: new Date(kst.getFullYear(), kst.getMonth(), 1), to: new Date(kst.getFullYear(), kst.getMonth() + 1, 0) };
    const prev = { from: new Date(kst.getFullYear(), kst.getMonth() - 1, 1), to: new Date(kst.getFullYear(), kst.getMonth(), 0) };
    return {
      curFrom: ymd(cur.from), curTo: ymd(cur.to),
      prevFrom: ymd(prev.from), prevTo: ymd(prev.to),
    };
  }, []);

  // 통장별 잔액(총자산·계좌수). BankAccountsOverview 가 외부 expose 안 해 동일 read-only 쿼리(가벼움).
  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-page-accounts", companyId],
    queryFn: async () => {
      const { data } = await db.from("bank_accounts").select("id, balance").eq("company_id", companyId);
      return (data || []) as { id: string; balance: number | null }[];
    },
    enabled: !!companyId,
  });

  // 이번 달 + 전월 income/expense (전월 대비 증감% 계산용). bank_transactions read-only.
  const { data: flow } = useQuery({
    queryKey: ["bank-page-flow", companyId, ranges.curFrom, ranges.curTo],
    queryFn: async () => {
      const [curRes, prevRes] = await Promise.all([
        db.from("bank_transactions").select("amount, type").eq("company_id", companyId).gte("transaction_date", ranges.curFrom).lte("transaction_date", ranges.curTo).limit(50000),
        db.from("bank_transactions").select("amount, type").eq("company_id", companyId).gte("transaction_date", ranges.prevFrom).lte("transaction_date", ranges.prevTo).limit(50000),
      ]);
      const sum = (rows: any[], t: string) => (rows || []).filter((r) => r.type === t).reduce((s: number, r: any) => s + Math.abs(Number(r.amount || 0)), 0);
      return {
        income: sum(curRes.data || [], "income"),
        expense: sum(curRes.data || [], "expense"),
        prevIncome: sum(prevRes.data || [], "income"),
        prevExpense: sum(prevRes.data || [], "expense"),
      };
    },
    enabled: !!companyId,
  });

  // 이번 달 분류 완료율 — mapping_status null/unmapped 가 아닌 비율. (시안 "예상 수익률" 대체 실 metric)
  const { data: mappingStat } = useQuery({
    queryKey: ["bank-page-mapping", companyId, ranges.curFrom, ranges.curTo],
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("mapping_status")
        .eq("company_id", companyId)
        .gte("transaction_date", ranges.curFrom).lte("transaction_date", ranges.curTo)
        .limit(50000);
      const total = (data || []).length;
      const mapped = (data || []).filter((r: any) => r.mapping_status && r.mapping_status !== "unmapped").length;
      return { total, mapped };
    },
    enabled: !!companyId,
  });

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const income = flow?.income ?? 0;
  const expense = flow?.expense ?? 0;
  const prevIncome = flow?.prevIncome ?? 0;
  const prevExpense = flow?.prevExpense ?? 0;
  const incomeDelta = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : null;
  // 지출 변동은 부호 반대로 해석(지출 감소 = 좋음). UI 색은 단순 증감 표시(증가 위로/감소 아래로) — 의미 해석은 사용자.
  const expenseDelta = prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null;
  const mappingRate = mappingStat && mappingStat.total > 0 ? Math.round((mappingStat.mapped / mappingStat.total) * 100) : null;

  const welcomeName = user?.email?.split("@")[0] || "사용자";

  // 시안 stat 카드(인라인 — 핸드오프 그대로: 좌상단 아이콘 타일 + 우상단 delta 화살표)
  const Stat = ({ tone, icon, label, value, delta, sub }: {
    tone: string; // gradient classes e.g. "from-blue-500 to-blue-600"
    icon: React.ReactNode;
    label: string;
    value: string;
    delta?: number | null;
    sub?: string;
  }) => (
    <div className="glass-card p-6 group hover:shadow-xl transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg bg-gradient-to-br ${tone} group-hover:scale-105 transition-transform`}>
          {icon}
        </div>
        {delta != null ? (
          <span className={`text-sm font-semibold inline-flex items-center gap-1 ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={delta >= 0 ? "M7 17l9-9m0 0H9m7 0v7" : "M17 7l-9 9m0 0h7m-7 0V9"} /></svg>
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : sub ? (
          <span className="text-[11px] text-[var(--text-dim)]">{sub}</span>
        ) : null}
      </div>
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">{label}</p>
      <p className="text-2xl font-bold text-[var(--text)] mono-number">{value}</p>
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "개요" },
    { key: "accounts", label: "통장들" },
    { key: "transactions", label: "거래내역" },
  ];

  return (
    <div>
      <SiyanPageHeader
        title="통장"
        subtitle={`안녕하세요, ${welcomeName}님 — 잔액·수입·지출·분류를 한눈에`}
        gradient="from-blue-600 to-cyan-500"
      />

      {/* 시안 통계 4 그라데이션 카드 — 실 metric. 가짜 % 금지. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat
          tone="from-blue-500 to-blue-600"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          label="총 자산"
          value={fmtW(totalBalance)}
          sub={`${accounts.length}개 계좌`}
        />
        <Stat
          tone="from-emerald-500 to-emerald-600"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
          label="이번 달 수익"
          value={`+${fmtW(income)}`}
          delta={incomeDelta}
        />
        <Stat
          tone="from-orange-500 to-orange-600"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6" /></svg>}
          label="이번 달 지출"
          value={`-${fmtW(expense)}`}
          delta={expenseDelta}
        />
        <Stat
          tone="from-purple-500 to-purple-600"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
          label="분류 완료율"
          value={mappingRate != null ? `${mappingRate}%` : "—"}
          sub={mappingStat && mappingStat.total > 0 ? `${mappingStat.mapped}/${mappingStat.total}건` : "거래 없음"}
        />
      </div>

      {/* Tabs — 시안 underline 톤 */}
      <div className="flex gap-2 mb-6 border-b border-[var(--border)] overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-6 py-3 text-sm font-semibold transition border-b-2 -mb-px whitespace-nowrap ${
              tab === t.key
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 차트 영역 — 자산 추이/구성: 스냅샷 데이터 부족으로 영역 자체 숨김(가짜 placeholder 금지) */}
          <div className="lg:col-span-1">
            <UpcomingAutoTransfersCard companyId={companyId} />
          </div>
          <div className="lg:col-span-1">
            <AutoTransferHistoryCard companyId={companyId} />
          </div>
          <div className="lg:col-span-1">
            <TopExpensesThisMonth companyId={companyId} />
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <BankAccountsOverview
          companyId={companyId}
          selectedAccountNo={selectedAccountNo}
          onSelect={(no) => {
            setSelectedAccountNo(no);
            // 통장 클릭 → 거래내역 탭으로 전환(시안 UX). TransactionsView 는 자체 selectedAccountNo state 보유.
            if (no) setTab("transactions");
          }}
        />
      )}

      {tab === "transactions" && (
        <TransactionsView />
      )}
    </div>
  );
}

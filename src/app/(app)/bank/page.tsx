"use client";

// /bank — 통장 자립 페이지(시안 그대로). 시안 portfolio 카드 + 시안 거래내역 표 직접 구현.
//   기존 BankAccountsOverview / TransactionsView 미사용 (그쪽은 /transactions 에서 그대로).
//   표시 전용 — 새 mutation·RPC 0. read-only 쿼리만.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { SiyanPageHeader } from "@/components/siyan";
import { getBankAccountChanges } from "@/lib/queries";
import { UpcomingAutoTransfersCard } from "@/components/upcoming-auto-transfers";
import { AutoTransferHistoryCard } from "@/components/auto-transfer-history";
import { TopExpensesThisMonth } from "@/components/top-expenses-month";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Tab = "overview" | "accounts" | "transactions";

const MAPPING_META: Record<string, { label: string; bg: string; text: string }> = {
  unmapped: { label: "미매핑", bg: "bg-amber-500/10", text: "text-amber-500" },
  auto_mapped: { label: "자동", bg: "bg-blue-500/10", text: "text-blue-500" },
  manual_mapped: { label: "수동", bg: "bg-emerald-500/10", text: "text-emerald-500" },
  ignored: { label: "무시", bg: "bg-[var(--text-muted)]/10", text: "text-[var(--text-muted)]" },
};

export default function BankPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const [tab, setTab] = useState<Tab>("accounts");

  // 기간 — 이번 달 KST · 전월 동일(증감 계산용).
  const ranges = useMemo(() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    const cur = { from: new Date(kst.getFullYear(), kst.getMonth(), 1), to: new Date(kst.getFullYear(), kst.getMonth() + 1, 0) };
    const prev = { from: new Date(kst.getFullYear(), kst.getMonth() - 1, 1), to: new Date(kst.getFullYear(), kst.getMonth(), 0) };
    return { curFrom: ymd(cur.from), curTo: ymd(cur.to), prevFrom: ymd(prev.from), prevTo: ymd(prev.to) };
  }, []);

  // 통장 목록 (시안 portfolio 카드 — 이름·잔액·이번달 증감).
  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-page-accounts-v2", companyId],
    queryFn: async () => {
      const { data } = await db.from("bank_accounts")
        .select("id, alias, bank_name, account_number, balance, currency")
        .eq("company_id", companyId)
        .order("balance", { ascending: false });
      return (data || []) as { id: string; alias: string | null; bank_name: string | null; account_number: string | null; balance: number | null; currency: string | null }[];
    },
    enabled: !!companyId,
  });

  // 통장별 이번 달 증감 (income−expense). 기존 lib 재사용 — 가짜 metric 금지.
  const { data: changes } = useQuery({
    queryKey: ["bank-page-changes", companyId, ranges.curFrom, ranges.curTo],
    queryFn: () => getBankAccountChanges(companyId!, ranges.curFrom, ranges.curTo),
    enabled: !!companyId,
  });
  const changeByAcct = changes?.byAccount || {};

  // 이번 달 + 전월 합계 (stat 4 — 가짜 % 금지).
  const { data: flow } = useQuery({
    queryKey: ["bank-page-flow-v2", companyId, ranges.curFrom, ranges.curTo],
    queryFn: async () => {
      const [curRes, prevRes] = await Promise.all([
        db.from("bank_transactions").select("amount, type, mapping_status").eq("company_id", companyId).gte("transaction_date", ranges.curFrom).lte("transaction_date", ranges.curTo).limit(50000),
        db.from("bank_transactions").select("amount, type").eq("company_id", companyId).gte("transaction_date", ranges.prevFrom).lte("transaction_date", ranges.prevTo).limit(50000),
      ]);
      const sum = (rows: any[], t: string) => (rows || []).filter((r) => r.type === t).reduce((s: number, r: any) => s + Math.abs(Number(r.amount || 0)), 0);
      const cur = curRes.data || [];
      const mapped = cur.filter((r: any) => r.mapping_status && r.mapping_status !== "unmapped").length;
      const total = cur.length;
      return {
        income: sum(cur, "income"),
        expense: sum(cur, "expense"),
        prevIncome: sum(prevRes.data || [], "income"),
        prevExpense: sum(prevRes.data || [], "expense"),
        mapped, total,
      };
    },
    enabled: !!companyId,
  });

  // 시안 거래내역 표 — 최근 50건 read-only (탭 클릭 시에만).
  const { data: recentTx = [] } = useQuery({
    queryKey: ["bank-page-recent-tx", companyId],
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("id, transaction_date, type, amount, counterparty, description, classification, category, mapping_status")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .limit(50);
      return (data || []) as any[];
    },
    enabled: !!companyId && tab === "transactions",
  });

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const income = flow?.income ?? 0;
  const expense = flow?.expense ?? 0;
  const incomeDelta = (flow?.prevIncome ?? 0) > 0 ? ((income - (flow!.prevIncome)) / flow!.prevIncome) * 100 : null;
  const expenseDelta = (flow?.prevExpense ?? 0) > 0 ? ((expense - (flow!.prevExpense)) / flow!.prevExpense) * 100 : null;
  const mappingRate = flow && flow.total > 0 ? Math.round((flow.mapped / flow.total) * 100) : null;

  const welcomeName = user?.email?.split("@")[0] || "사용자";

  const Stat = ({ tone, icon, label, value, delta, sub }: {
    tone: string;
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
    { key: "accounts", label: "통장" },
    { key: "transactions", label: "거래내역" },
  ];

  return (
    <div>
      <SiyanPageHeader
        title="통장"
        subtitle={`안녕하세요, ${welcomeName}님 — 잔액·수입·지출·분류를 한눈에`}
        gradient="from-blue-600 to-cyan-500"
      />

      {/* 시안 stat 4 그라데이션 카드 */}
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
          sub={flow && flow.total > 0 ? `${flow.mapped}/${flow.total}건` : "거래 없음"}
        />
      </div>

      {/* Tabs — 시안 underline */}
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

      {/* 개요 — 자동이체 예정·자동이체 내역·이번달 큰 지출 (실데이터 read-only 카드, 시안의 차트 영역은 데이터 부족으로 숨김) */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <UpcomingAutoTransfersCard companyId={companyId} />
          <AutoTransferHistoryCard companyId={companyId} />
          <TopExpensesThisMonth companyId={companyId} />
        </div>
      )}

      {/* 통장 — 시안 portfolio 카드(이름·잔액·이번달 증감) 2열 그리드 */}
      {tab === "accounts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {accounts.length === 0 ? (
            <div className="md:col-span-2 glass-card p-12 text-center text-sm text-[var(--text-muted)]">
              <div className="text-4xl mb-3">🏦</div>
              등록된 통장이 없습니다
            </div>
          ) : accounts.map((a) => {
            const accNo = a.account_number || "";
            const change = changeByAcct[accNo] || 0;
            const name = a.alias || (a.bank_name ? `${a.bank_name}${accNo.slice(-4) ? " " + accNo.slice(-4) : ""}` : accNo) || "계좌";
            const bal = Number(a.balance || 0);
            return (
              <div key={a.id} className="glass-card p-6 hover:shadow-xl transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--text)] truncate">{name}</h3>
                  {Math.round(change) !== 0 && (
                    change >= 0 ? (
                      <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9-9m0 0H9m7 0v7" /></svg>
                    ) : (
                      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7l-9 9m0 0h7m-7 0V9" /></svg>
                    )
                  )}
                </div>
                <p className="text-2xl font-bold text-[var(--text)] mb-2 mono-number">{fmtW(bal)}</p>
                {Math.round(change) !== 0 ? (
                  <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${change >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}>
                    {change >= 0 ? "+" : "-"}{fmtW(Math.abs(change))}
                  </div>
                ) : (
                  <div className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    변화 없음
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 거래내역 — 시안 표 (거래/분류/금액/날짜/상태) 최근 50건 */}
      {tab === "transactions" && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-[var(--bg-card)] shadow-[0_1px_0_0_var(--border)]">
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-6 py-4 font-semibold">거래</th>
                  <th className="text-left px-6 py-4 font-semibold">분류</th>
                  <th className="text-left px-6 py-4 font-semibold">금액</th>
                  <th className="text-left px-6 py-4 font-semibold">날짜</th>
                  <th className="text-left px-6 py-4 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {recentTx.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">최근 거래내역이 없습니다</td></tr>
                ) : recentTx.map((tx) => {
                  const isIncome = tx.type === "income";
                  const m = MAPPING_META[tx.mapping_status as string] || MAPPING_META.unmapped;
                  return (
                    <tr key={tx.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isIncome ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                            <svg className={`w-5 h-5 ${isIncome ? "text-emerald-500" : "text-red-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isIncome ? "M7 17l9-9m0 0H9m7 0v7" : "M17 7l-9 9m0 0h7m-7 0V9"} />
                            </svg>
                          </div>
                          <span className="font-medium text-[var(--text)] truncate">{tx.counterparty || tx.description || "—"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{tx.classification || tx.category || "—"}</td>
                      <td className={`px-6 py-4 font-semibold mono-number ${isIncome ? "text-emerald-500" : "text-red-500"}`}>
                        {isIncome ? "+" : "-"}{fmtW(Math.abs(Number(tx.amount || 0)))}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>{m.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

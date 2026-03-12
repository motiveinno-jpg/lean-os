"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { runMatching, type MatchCandidate } from "@/lib/matching";
import { threeWayMatch, markInvoiceMatched, type ThreeWayMatchResult } from "@/lib/tax-invoice";
import { onRevenueReceived } from "@/lib/deal-pipeline";
import { useToast } from "@/components/toast";

type MainTab = "transaction" | "threeway" | "receivables";
type Tab = "auto" | "review" | "unmatched";
type ReceivableFilter = "all" | "under30" | "30to60" | "60to90" | "over90";

interface ReceivableItem {
  id: string;
  counterparty_name: string;
  label: string;
  issue_date: string;
  due_date: string;
  total_amount: number;
  overdue_days: number;
  deal_id?: string;
  type: "invoice" | "schedule";
}

export default function MatchingPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("transaction");
  const [tab, setTab] = useState<Tab>("review");
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [running, setRunning] = useState(false);
  const [threeWayResults, setThreeWayResults] = useState<ThreeWayMatchResult[]>([]);
  const [threeWayRunning, setThreeWayRunning] = useState(false);
  const [receivableFilter, setReceivableFilter] = useState<ReceivableFilter>("all");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    getCurrentUser().then((u) => u && setCompanyId(u.company_id));
  }, []);

  const { data: transactions = [] } = useQuery({
    queryKey: ["match-transactions", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("company_id", companyId!)
        .order("transaction_date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: revenues = [] } = useQuery({
    queryKey: ["match-revenues", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deal_revenue_schedule")
        .select("*, deals!inner(company_id)")
        .eq("deals.company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["match-costs", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deal_cost_schedule")
        .select("*, deal_nodes!inner(deal_id, deals!inner(company_id))");
      return data || [];
    },
    enabled: !!companyId,
  });

  // ── Receivables: sales invoices not yet matched/paid ──
  const { data: salesInvoices = [] } = useQuery({
    queryKey: ["receivable-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tax_invoices")
        .select("*")
        .eq("company_id", companyId!)
        .eq("type", "sales")
        .not("status", "in", '("matched","void")')
        .order("issue_date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId && mainTab === "receivables",
  });

  const { data: pendingRevenues = [] } = useQuery({
    queryKey: ["receivable-revenues", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deal_revenue_schedule")
        .select("*, deals!inner(company_id, name)")
        .eq("deals.company_id", companyId!)
        .in("status", ["pending", "overdue"])
        .order("due_date", { ascending: true });
      return data || [];
    },
    enabled: !!companyId && mainTab === "receivables",
  });

  // Merge invoices + revenue schedules into receivable items
  const receivableItems = useMemo<ReceivableItem[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items: ReceivableItem[] = [];

    for (const inv of salesInvoices) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invAny = inv as any;
      // Use preferred_date or issue_date as due date
      const dueDate = invAny.preferred_date || inv.issue_date;
      if (!dueDate) continue;
      const due = new Date(dueDate);
      const diffMs = today.getTime() - due.getTime();
      const overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      items.push({
        id: inv.id,
        counterparty_name: inv.counterparty_name || "—",
        label: invAny.label || `세금계산서 ${inv.counterparty_name || ""}`,
        issue_date: inv.issue_date || "—",
        due_date: dueDate,
        total_amount: Number(inv.total_amount || 0),
        overdue_days: overdueDays,
        deal_id: inv.deal_id || undefined,
        type: "invoice",
      });
    }

    for (const rev of pendingRevenues) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const revAny = rev as any;
      if (!revAny.due_date) continue;
      const due = new Date(revAny.due_date);
      const diffMs = today.getTime() - due.getTime();
      const overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const dealName = revAny.deals?.name || "";
      items.push({
        id: revAny.id,
        counterparty_name: dealName,
        label: revAny.label || `수금 스케줄 - ${dealName}`,
        issue_date: revAny.due_date,
        due_date: revAny.due_date,
        total_amount: Number(revAny.amount || 0),
        overdue_days: overdueDays,
        deal_id: revAny.deal_id,
        type: "schedule",
      });
    }

    // Deduplicate: if invoice has a revenue_schedule_id, skip the schedule entry
    const invoiceScheduleIds = new Set(
      salesInvoices.filter((i: any) => i.revenue_schedule_id).map((i: any) => i.revenue_schedule_id)
    );
    return items.filter(
      (item) => !(item.type === "schedule" && invoiceScheduleIds.has(item.id))
    );
  }, [salesInvoices, pendingRevenues]);

  const filteredReceivables = useMemo(() => {
    return receivableItems.filter((item) => {
      if (receivableFilter === "all") return true;
      if (receivableFilter === "under30") return item.overdue_days < 30;
      if (receivableFilter === "30to60") return item.overdue_days >= 30 && item.overdue_days < 60;
      if (receivableFilter === "60to90") return item.overdue_days >= 60 && item.overdue_days < 90;
      if (receivableFilter === "over90") return item.overdue_days >= 90;
      return true;
    });
  }, [receivableItems, receivableFilter]);

  function getOverdueColor(days: number) {
    if (days < 30) return { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" };
    if (days < 60) return { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30" };
    if (days < 90) return { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" };
    return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" };
  }

  async function sendPaymentReminder(item: ReceivableItem) {
    setSendingReminder(item.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast("로그인이 필요합니다", "error");
        return;
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-payment-reminder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          counterparty_name: item.counterparty_name,
          document_name: item.label,
          amount: item.total_amount,
          due_date: item.due_date,
          overdue_days: item.overdue_days,
          invoice_id: item.type === "invoice" ? item.id : undefined,
          deal_id: item.deal_id,
        }),
      });
      if (res.ok) {
        toast(`${item.counterparty_name}에 독촉장을 발송했습니다.`, "success");
      } else {
        toast("독촉장 발송에 실패했습니다. 이메일 설정을 확인하세요.", "error");
      }
    } catch {
      toast("독촉장 발송 중 오류가 발생했습니다.", "error");
    } finally {
      setSendingReminder(null);
    }
  }

  const totalReceivable = receivableItems.reduce((s, i) => s + i.total_amount, 0);
  const over30Total = receivableItems.filter((i) => i.overdue_days >= 30).reduce((s, i) => s + i.total_amount, 0);
  const over90Total = receivableItems.filter((i) => i.overdue_days >= 90).reduce((s, i) => s + i.total_amount, 0);

  async function executeMatching() {
    setRunning(true);
    try {
      // Read matching tolerance from company settings
      let tolerance = 0.01;
      if (companyId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: co } = await (supabase as any).from("companies").select("tax_settings").eq("id", companyId).single();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ts = (co as any)?.tax_settings;
          if (ts?.matching_tolerance != null && Number(ts.matching_tolerance) >= 0) {
            tolerance = Number(ts.matching_tolerance) / 100;
          }
        } catch { /* use default */ }
      }
      const matchResults = runMatching(transactions, revenues, costs, { tolerance });
      setResults(matchResults);

      const autoMatches = matchResults.filter((m) => m.status === "auto" && m.schedule_id);
      for (const match of autoMatches) {
        await supabase.from("transaction_matches").insert({
          transaction_id: match.transaction_id,
          revenue_schedule_id: match.schedule_type === "revenue" ? match.schedule_id : null,
          cost_schedule_id: match.schedule_type === "cost" ? match.schedule_id : null,
          match_score: match.score,
          status: "auto",
        });

        await supabase
          .from("transactions")
          .update({ matched: true })
          .eq("id", match.transaction_id);

        if (match.schedule_type === "revenue") {
          await supabase
            .from("deal_revenue_schedule")
            .update({ status: "received", received_at: new Date().toISOString() })
            .eq("id", match.schedule_id);

          // Trigger deal completion check
          const rev = revMap.get(match.schedule_id);
          if (rev && rev.deal_id && companyId) {
            try {
              await onRevenueReceived({
                dealId: rev.deal_id,
                companyId,
                amount: Number(rev.amount || 0),
                userId: "system",
                revenueScheduleId: match.schedule_id,
              });
            } catch { /* non-blocking */ }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["match-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["match-revenues"] });
    } finally {
      setRunning(false);
    }
  }

  async function confirmMatch(match: MatchCandidate) {
    await supabase.from("transaction_matches").insert({
      transaction_id: match.transaction_id,
      revenue_schedule_id: match.schedule_type === "revenue" ? match.schedule_id : null,
      cost_schedule_id: match.schedule_type === "cost" ? match.schedule_id : null,
      match_score: match.score,
      status: "manual",
    });

    await supabase
      .from("transactions")
      .update({ matched: true })
      .eq("id", match.transaction_id);

    if (match.schedule_type === "revenue") {
      await supabase
        .from("deal_revenue_schedule")
        .update({ status: "received", received_at: new Date().toISOString() })
        .eq("id", match.schedule_id);

      // Trigger deal completion check
      const rev = revMap.get(match.schedule_id);
      if (rev && rev.deal_id && companyId) {
        try {
          await onRevenueReceived({
            dealId: rev.deal_id,
            companyId,
            amount: Number(rev.amount || 0),
            userId: "system",
            revenueScheduleId: match.schedule_id,
          });
        } catch { /* non-blocking */ }
      }
    }

    setResults((prev) =>
      prev.map((r) =>
        r.transaction_id === match.transaction_id ? { ...r, status: "auto" as const } : r
      )
    );
    queryClient.invalidateQueries({ queryKey: ["match-transactions"] });
  }

  async function rejectMatch(match: MatchCandidate) {
    setResults((prev) =>
      prev.map((r) =>
        r.transaction_id === match.transaction_id
          ? { ...r, status: "unmatched" as const }
          : r
      )
    );
  }

  // ── 3-Way Matching ──
  async function executeThreeWay() {
    if (!companyId) return;
    setThreeWayRunning(true);
    try {
      const results = await threeWayMatch(companyId);
      setThreeWayResults(results);
    } finally {
      setThreeWayRunning(false);
    }
  }

  async function handleMarkMatched(invoiceId: string) {
    await markInvoiceMatched(invoiceId);
    setThreeWayResults((prev) =>
      prev.map((r) => r.invoiceId === invoiceId ? { ...r, fullMatch: true } : r)
    );
  }

  const filtered = results.filter((r) => r.status === tab);
  const autoCount = results.filter((r) => r.status === "auto").length;
  const reviewCount = results.filter((r) => r.status === "review").length;
  const unmatchedCount = results.filter((r) => r.status === "unmatched").length;

  const txMap = new Map(transactions.map((t) => [t.id, t]));
  const revMap = new Map(revenues.map((r) => [r.id, r]));
  const costMap = new Map(costs.map((c) => [c.id, c]));

  const fullMatchCount = threeWayResults.filter(r => r.fullMatch).length;
  const partialCount = threeWayResults.filter(r => !r.fullMatch && (r.amountMatch || r.paymentMatch)).length;
  const noMatchCount = threeWayResults.filter(r => !r.amountMatch && !r.paymentMatch).length;

  return (
    <div className="max-w-[1000px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">매칭 엔진</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            거래 자동 매칭 + 세금계산서 3-way 매칭 + 미수금 관리
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setMainTab("transaction")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === "transaction" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          거래 매칭
        </button>
        <button onClick={() => setMainTab("threeway")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === "threeway" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          3-way 매칭
        </button>
        <button onClick={() => setMainTab("receivables")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === "receivables" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          미수금 관리
        </button>
      </div>

      {/* ═══ Transaction Matching Tab ═══ */}
      {mainTab === "transaction" && (
        <>
          <div className="flex justify-end mb-6">
            <button
              onClick={executeMatching}
              disabled={running || transactions.length === 0}
              className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {running ? "매칭 중..." : "매칭 실행"}
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭 거래</div>
              <div className="text-lg font-bold mt-1">
                {transactions.filter((t) => !t.matched).length}건
              </div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">자동 매칭</div>
              <div className="text-lg font-bold text-green-400 mt-1">{autoCount}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">검토 필요</div>
              <div className="text-lg font-bold text-[var(--warning)] mt-1">{reviewCount}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭</div>
              <div className="text-lg font-bold text-red-400 mt-1">{unmatchedCount}건</div>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">🔗</div>
              <div className="text-lg font-bold mb-2">매칭을 실행하세요</div>
              <div className="text-sm text-[var(--text-muted)]">
                거래내역과 딜 스케줄을 비교하여 자동으로 매칭합니다.
              </div>
            </div>
          ) : (
            <>
              {/* Sub Tabs */}
              <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6">
                {([
                  { key: "auto" as Tab, label: `자동 (${autoCount})` },
                  { key: "review" as Tab, label: `검토 (${reviewCount})` },
                  { key: "unmatched" as Tab, label: `미매칭 (${unmatchedCount})` },
                ]).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      tab === t.key
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Results */}
              <div className="space-y-3">
                {filtered.length === 0 ? (
                  <div className="text-center py-10 text-sm text-[var(--text-muted)]">
                    해당 카테고리에 결과가 없습니다.
                  </div>
                ) : (
                  filtered.map((match) => {
                    const tx = txMap.get(match.transaction_id);
                    const schedule =
                      match.schedule_type === "revenue"
                        ? revMap.get(match.schedule_id)
                        : costMap.get(match.schedule_id);

                    return (
                      <div
                        key={match.transaction_id}
                        className={`bg-[var(--bg-card)] rounded-xl border p-5 ${
                          match.status === "auto"
                            ? "border-green-500/30"
                            : match.status === "review"
                            ? "border-yellow-500/30"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  tx?.type === "income"
                                    ? "bg-green-500/10 text-green-400"
                                    : "bg-red-500/10 text-red-400"
                                }`}
                              >
                                {tx?.type === "income" ? "입금" : "출금"}
                              </span>
                              <span className="text-sm font-medium">
                                ₩{Number(tx?.amount || 0).toLocaleString()}
                              </span>
                              <span className="text-xs text-[var(--text-dim)]">
                                {tx?.transaction_date || "—"}
                              </span>
                            </div>
                            <div className="text-xs text-[var(--text-muted)] mb-2">
                              {tx?.counterparty || "—"} · {tx?.description || "—"}
                            </div>

                            {schedule && (
                              <div className="bg-[var(--bg-surface)] rounded-lg p-3 mt-2">
                                <div className="text-[10px] text-[var(--text-dim)] mb-1">
                                  매칭 대상 ({match.schedule_type === "revenue" ? "수금" : "비용"})
                                </div>
                                <div className="text-sm">
                                  ₩{Number(schedule.amount || 0).toLocaleString()}
                                  <span className="text-xs text-[var(--text-muted)] ml-2">
                                    {schedule.due_date || "—"}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-2 mt-2">
                              <span
                                className={`text-xs font-bold ${
                                  match.score >= 90
                                    ? "text-green-400"
                                    : match.score >= 70
                                    ? "text-yellow-400"
                                    : "text-red-400"
                                }`}
                              >
                                {match.score}점
                              </span>
                              {match.reasons.map((r, i) => (
                                <span key={i} className="text-[10px] text-[var(--text-dim)]">
                                  {r}
                                </span>
                              ))}
                            </div>

                            {match.schedule_type === "cost" &&
                              schedule &&
                              "approved" in schedule &&
                              !schedule.approved && (
                                <div className="mt-2 px-3 py-1.5 bg-red-500/10 rounded-lg text-xs text-red-400 font-semibold">
                                  미승인 지출 — 승인 없이 집행된 비용입니다
                                </div>
                              )}
                          </div>

                          {match.status === "review" && (
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => confirmMatch(match)}
                                className="px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg text-xs font-semibold hover:bg-green-500/20 transition"
                              >
                                확인
                              </button>
                              <button
                                onClick={() => rejectMatch(match)}
                                className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/20 transition"
                              >
                                거부
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ Receivables Management Tab ═══ */}
      {mainTab === "receivables" && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">총 미수금</div>
              <div className="text-lg font-bold mt-1">
                ₩{Math.round(totalReceivable).toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{receivableItems.length}건</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-yellow-500/30 p-4">
              <div className="text-xs text-yellow-400">30일+ 미수금</div>
              <div className="text-lg font-bold text-yellow-400 mt-1">
                ₩{Math.round(over30Total).toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                {receivableItems.filter((i) => i.overdue_days >= 30).length}건
              </div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-red-500/30 p-4">
              <div className="text-xs text-red-400">90일+ 위험</div>
              <div className="text-lg font-bold text-red-400 mt-1">
                ₩{Math.round(over90Total).toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                {receivableItems.filter((i) => i.overdue_days >= 90).length}건
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6">
            {([
              { key: "all" as ReceivableFilter, label: "전체" },
              { key: "under30" as ReceivableFilter, label: "30일 이하" },
              { key: "30to60" as ReceivableFilter, label: "30-60일" },
              { key: "60to90" as ReceivableFilter, label: "60-90일" },
              { key: "over90" as ReceivableFilter, label: "90일+" },
            ]).map((f) => (
              <button
                key={f.key}
                onClick={() => setReceivableFilter(f.key)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  receivableFilter === f.key
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Receivables Table */}
          {filteredReceivables.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">&#x1f4b0;</div>
              <div className="text-lg font-bold mb-2">미수금이 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">
                해당 기간에 연체된 미수금이 없습니다.
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">거래처명</th>
                    <th className="text-left px-5 py-3 font-medium">문서명</th>
                    <th className="text-center px-5 py-3 font-medium">발행일</th>
                    <th className="text-center px-5 py-3 font-medium">만기일</th>
                    <th className="text-right px-5 py-3 font-medium">금액</th>
                    <th className="text-center px-5 py-3 font-medium">연체일수</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceivables.map((item) => {
                    const color = getOverdueColor(item.overdue_days);
                    return (
                      <tr key={`${item.type}-${item.id}`} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                        <td className="px-5 py-3 text-sm font-medium">{item.counterparty_name}</td>
                        <td className="px-5 py-3 text-sm text-[var(--text-muted)] max-w-[200px] truncate">{item.label}</td>
                        <td className="px-5 py-3 text-sm text-center text-[var(--text-muted)]">{item.issue_date}</td>
                        <td className="px-5 py-3 text-sm text-center text-[var(--text-muted)]">{item.due_date}</td>
                        <td className="px-5 py-3 text-sm text-right font-medium">
                          ₩{Math.round(item.total_amount).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${color.bg} ${color.text}`}>
                            {item.overdue_days}일
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {item.overdue_days > 0 && (
                            <button
                              onClick={() => sendPaymentReminder(item)}
                              disabled={sendingReminder === item.id}
                              className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-semibold hover:bg-red-500/20 transition disabled:opacity-50"
                            >
                              {sendingReminder === item.id ? "발송 중..." : "독촉장 발송"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ 3-Way Matching Tab ═══ */}
      {mainTab === "threeway" && (
        <>
          <div className="flex justify-end mb-6">
            <button onClick={executeThreeWay} disabled={threeWayRunning}
              className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
              {threeWayRunning ? "분석 중..." : "3-way 매칭 실행"}
            </button>
          </div>

          {/* 3-Way Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">완전 매칭</div>
              <div className="text-lg font-bold text-green-400 mt-1">{fullMatchCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">계약=계산서=입금</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">부분 매칭</div>
              <div className="text-lg font-bold text-yellow-400 mt-1">{partialCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">일부 항목만 일치</div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div className="text-xs text-[var(--text-dim)]">미매칭</div>
              <div className="text-lg font-bold text-red-400 mt-1">{noMatchCount}건</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">확인 필요</div>
            </div>
          </div>

          {threeWayResults.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">🔺</div>
              <div className="text-lg font-bold mb-2">3-way 매칭을 실행하세요</div>
              <div className="text-sm text-[var(--text-muted)]">
                계약금액 ↔ 세금계산서 ↔ 입금액을 비교합니다.
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">딜</th>
                    <th className="text-right px-5 py-3 font-medium">계약금액</th>
                    <th className="text-right px-5 py-3 font-medium">세금계산서</th>
                    <th className="text-right px-5 py-3 font-medium">입금액</th>
                    <th className="text-right px-5 py-3 font-medium">차이</th>
                    <th className="text-center px-5 py-3 font-medium">계약=계산서</th>
                    <th className="text-center px-5 py-3 font-medium">계산서=입금</th>
                    <th className="text-center px-5 py-3 font-medium">3-way</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {threeWayResults.map((r) => (
                    <tr key={r.invoiceId} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                      <td className="px-5 py-3 text-sm font-medium">{r.dealName || "—"}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.contractAmount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.invoiceAmount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-right">₩{r.receivedAmount.toLocaleString()}</td>
                      <td className={`px-5 py-3 text-sm text-right font-medium ${r.gap > 0 ? "text-red-400" : r.gap < 0 ? "text-yellow-400" : "text-green-400"}`}>
                        {r.gap > 0 ? "+" : ""}{r.gap.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs ${r.amountMatch ? "text-green-400" : "text-red-400"}`}>
                          {r.amountMatch ? "O" : "X"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs ${r.paymentMatch ? "text-green-400" : "text-red-400"}`}>
                          {r.paymentMatch ? "O" : "X"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.fullMatch ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        }`}>
                          {r.fullMatch ? "MATCH" : "GAP"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {r.fullMatch && (
                          <button onClick={() => handleMarkMatched(r.invoiceId)}
                            className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/20 transition">
                            매칭확인
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

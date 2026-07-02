"use client";

// /bank — 통장 자립 페이지(시안 그대로). 시안 portfolio 카드 + 시안 거래내역 표 직접 구현.
//   기존 BankAccountsOverview / TransactionsView 미사용 (그쪽은 /transactions 에서 그대로).
//   표시 전용 — 새 mutation·RPC 0. read-only 쿼리만.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { SiyanPageHeader } from "@/components/siyan";
import { DateField } from "@/components/date-field";
import { getBankAccountChanges, getDistinctBankAccountNos, setBankAccountAlias, mapBankTransaction, ignoreBankTransaction } from "@/lib/queries";
import { UpcomingAutoTransfersCard } from "@/components/upcoming-auto-transfers";
import { AutoTransferHistoryCard } from "@/components/auto-transfer-history";
import { TopExpensesThisMonth } from "@/components/top-expenses-month";
import { SortToolbar } from "@/components/sort-toolbar";

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

// 인라인 매핑용 분류(카테고리) 목록
const BANK_CATEGORIES = ["복리후생비", "소모품비", "통신비", "교통비", "광고선전비", "접대비", "보험료", "세금공과", "수수료", "임대료", "기타비용"];

export default function BankPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const bankCd = useSyncCooldown(companyId, "bank"); // 통장 연동 30분 쿨타임 (회사 공유 — 연속 클릭이 CODEF 오류·은행 이중로그인 유발)
  const userId = user?.id ?? null;
  const [tab, setTab] = useState<Tab>("accounts");
  const queryClient = useQueryClient();
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);
  const [mapCat, setMapCat] = useState("");
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  // 통장 카드 클릭 시 거래내역 필터 — accountNo + 표시 이름 동시 보관.
  const [selectedAccountNo, setSelectedAccountNo] = useState<string>("");
  const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>("");
  // 통장 거래 기간 — 연동 시 CODEF sync 범위 + 거래내역 표 필터에 공통 적용 (카드 페이지와 동일 패턴)
  const [bankTxFrom, setBankTxFrom] = useState<string>("");
  const [bankTxTo, setBankTxTo] = useState<string>("");
  // 거래내역 표 — 헤더 더블클릭 정렬 + 행 체크박스 다중선택 (UI 전용, DB 변경 없음)
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  // 같은 key 재더블클릭 시 방향 토글, 다른 key 면 key 설정 + 기본 방향(날짜·금액=desc, 그 외=asc).
  const onSortTx = (key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "transaction_date" || key === "amount" ? "desc" : "asc");
      return key;
    });
  };

  // 통장 이름 편집 — BankAccountsOverview 와 동일한 setBankAccountAlias 사용. 빈 문자열이면 별칭 해제.
  const handleEditAlias = async (accountNo: string, currentAlias: string | undefined, bankName: string | undefined, balance: number) => {
    if (typeof window === "undefined") return;
    const next = window.prompt("통장 이름(별칭)", currentAlias || "");
    if (next === null) return; // 취소
    try {
      await setBankAccountAlias(companyId!, accountNo, next.trim(), { bankName, balance });
      queryClient.invalidateQueries({ queryKey: ["bank-page-accounts-distinct"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts-distinct"] });
      toast(next.trim() ? `이름을 "${next.trim()}"으로 변경` : "별칭 해제 완료", "success");
    } catch (e: any) {
      toast(friendlyError(e, "이름 변경 실패"), "error");
    }
  };

  // 통장 거래 인라인 매핑 (미매핑 배지에서 바로 처리 — 거래매칭 페이지 불필요)
  //   고정비 체크: is_fixed_cost 저장 + 거래처 규칙 학습(learnRuleFromMapping) → 같은 거래처는 다음부터 자동 체크.
  const [mapFixed, setMapFixed] = useState(false);
  const mapMut = useMutation({
    mutationFn: async ({ id, category, isFixedCost }: { id: string; category: string; isFixedCost: boolean }) => {
      await mapBankTransaction(id, { category: category || null, classification: category || null, isFixedCost, mappedBy: userId || "" });
    },
    onSuccess: () => {
      toast("매핑 완료", "success");
      setMapOpenId(null);
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    },
    onError: (err: any) => toast(friendlyError(err, "매핑 실패"), "error"),
  });
  const ignoreMut = useMutation({
    mutationFn: async (id: string) => { await ignoreBankTransaction(id); },
    onSuccess: () => {
      toast("무시 처리됨", "success");
      setMapOpenId(null);
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    },
    onError: (err: any) => toast(friendlyError(err, "처리 실패"), "error"),
  });

  // 통장 연동(CODEF 은행 sync + 잔액 재계산) — /transactions 의 동일 흐름 재사용.
  //   기간 필수 — 미설정이면 서버 기본(최근 3개월)에 의존해 원하는 기간이 누락될 수 있음 (카드 연동과 동일 정책).
  //   CODEF 는 YYYYMMDD 형식만 받으므로 대시 제거 후 전달.
  const handleSyncBank = async () => {
    if (!companyId) return;
    if (!bankTxFrom || !bankTxTo) { toast("통장 거래 기간(시작일·종료일)을 먼저 설정한 뒤 연동하세요", "error"); return; }
    setSyncing(true);
    try {
      const { syncCodefData, syncBankBalances } = await import("@/lib/data-sync");
      const result = await syncCodefData(companyId, "bank", bankTxFrom.replace(/-/g, ""), bankTxTo.replace(/-/g, ""));
      if (!result.success && result.status !== "partial") {
        toast(result.error || "통장 연동 실패", "error");
        return;
      }
      try { localStorage.setItem(`codef-connected-${companyId}`, "1"); } catch { /* ignore */ }
      const synced = result.bankSynced ?? 0;
      const balResult = await syncBankBalances(companyId);
      // 통장·거래·잔액 모두 새로 받아오기
      queryClient.invalidateQueries({ queryKey: ["bank-page-accounts-distinct"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-changes"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-flow-v2"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts-distinct"] });
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      try { window.dispatchEvent(new CustomEvent("ownerview:codef-synced")); } catch { /* ignore */ }
      const balMsg = balResult.status === "success" ? ` · ${balResult.message}` : "";
      const blockerNote = [...(result.errors || []), ...(result.notes || [])].find((n: any) =>
        n.code === "NO_DEMAND_DEPOSIT" || n.code === "CF-00401" || n.code === "CF-00003" || n.code === "CF-13021",
      );
      if (synced > 0) {
        toast(`통장 거래 ${synced}건 불러옴${balMsg}`, "success");
      } else if (blockerNote) {
        toast(`통장 연동 — ${blockerNote.message}${blockerNote.hint ? ` · ${blockerNote.hint}` : ""}`, "info");
      } else {
        toast(`통장 연동 완료 — 새 거래 없음${balMsg}`, "info");
      }
    } catch (e: any) {
      toast(friendlyError(e, "통장 연동 오류"), "error");
    } finally {
      setSyncing(false);
    }
  };

  // 기간 — 이번 달 KST · 전월 동일(증감 계산용).
  //   QA 2026-06-12: +9h 후 로컬 getFullYear/getMonth 를 읽으면 KST 브라우저에선 이중 가산
  //   (월말 저녁에 다음 달로 넘어감) → UTC 게터로 교정.
  const ranges = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
    const cur = { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
    const prev = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
    return { curFrom: ymd(cur.from), curTo: ymd(cur.to), prevFrom: ymd(prev.from), prevTo: ymd(prev.to) };
  }, []);

  // 통장 목록 — BankAccountsOverview 와 동일 소스(`getDistinctBankAccountNos`).
  //   bank_accounts 테이블 직접 read 는 빈 회사가 많아 거래에서 derive 한 distinct 가 정합.
  //   반환 shape: { accountNo, count, balance, alias?, bankName? }
  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-page-accounts-distinct", companyId],
    queryFn: () => getDistinctBankAccountNos(companyId!),
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

  // 시안 거래내역 표 — 기간 미설정 시 최근 50건, 기간 설정 시 그 기간 전체(상한 2000) read-only.
  //   selectedAccountNo 있으면 그 계좌만.
  const hasTxRange = !!(bankTxFrom || bankTxTo);
  const { data: recentTx = [] } = useQuery({
    queryKey: ["bank-page-recent-tx", companyId, selectedAccountNo, bankTxFrom, bankTxTo],
    queryFn: async () => {
      // accountNo 는 client-side 필터 (raw_data->>accountNo PostgREST eq 불안정 — transactions 페이지와 동일 패턴)
      let q = db.from("bank_transactions")
        .select("id, transaction_date, type, amount, counterparty, description, classification, category, mapping_status, balance_after, raw_data, journal_entry_id, is_fixed_cost")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .limit(selectedAccountNo || hasTxRange ? 2000 : 50);
      if (bankTxFrom) q = q.gte("transaction_date", bankTxFrom);
      if (bankTxTo) q = q.lte("transaction_date", bankTxTo);
      const { data } = await q;
      const rows = (data || []) as any[];
      const filtered = selectedAccountNo ? rows.filter((r) => r.raw_data?.accountNo === selectedAccountNo) : rows;
      return hasTxRange ? filtered : filtered.slice(0, 50);
    },
    enabled: !!companyId && tab === "transactions",
  });

  // 전표처리용 계정과목 (일괄 전표 모달)
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["bank-page-coa-accounts", companyId],
    queryFn: async () => {
      const { data } = await db.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).order("code");
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // 일괄 전표처리 — 선택된 미처리 통장거래를 계정 1개로 순차 post_bank_voucher(방향 자동 분기).
  const [showBulkPost, setShowBulkPost] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState<string>("");
  const [bulkFixed, setBulkFixed] = useState(false); // 고정비로 표시 — 전표처리와 함께 is_fixed_cost 저장
  const [bulkPosting, setBulkPosting] = useState(false);
  const doBulkPostBank = async () => {
    if (!bulkAccountId || bulkPosting) { if (!bulkAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkPosting(true);
    let ok = 0, fail = 0, skip = 0;
    const okIds: string[] = [];
    try {
      const ids = Array.from(selectedTxIds);
      for (const id of ids) {
        const tx = (recentTx as any[]).find((t) => t.id === id);
        if (!tx || tx.journal_entry_id) { skip++; continue; } // 이미 처리된 건 skip
        const { error } = await db.rpc("post_bank_voucher", { p_bank_tx_id: id, p_account_id: bulkAccountId, p_remember: false });
        if (error) fail++; else { ok++; okIds.push(id); }
      }
      // 고정비 체크 시 처리된 거래를 일괄 마킹 → 경영흐름·고정비 리포트에 고정비로 집계 (실패해도 전표는 유지)
      if (bulkFixed && okIds.length > 0) {
        try { await db.from("bank_transactions").update({ is_fixed_cost: true }).in("id", okIds); } catch { /* best-effort */ }
      }
      toast(`${ok}건 전표처리 완료${bulkFixed && ok > 0 ? " · 고정비 표시" : ""}${fail > 0 ? ` · ${fail}건 실패` : ""}${skip > 0 ? ` · ${skip}건 건너뜀` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkPost(false); setBulkAccountId(""); setBulkFixed(false); setSelectedTxIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    } finally { setBulkPosting(false); }
  };

  // 정렬 적용 — 원본 쿼리 캐시 불변(복제 정렬). null/빈값은 항상 뒤로.
  const sortedTx = useMemo(() => {
    if (!sortKey) return recentTx;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (tx: any) => {
      switch (sortKey) {
        case "transaction_date": return tx.transaction_date || "";
        case "amount": return Math.abs(Number(tx.amount || 0));
        case "counterparty": return tx.counterparty || tx.description || "";
        case "classification": return tx.classification || tx.category || "";
        case "type": return tx.mapping_status || "";
        default: return "";
      }
    };
    const isEmpty = (v: any) => v === "" || v === null || v === undefined;
    return [...recentTx].sort((a, b) => {
      const va = get(a), vb = get(b);
      // 빈값은 방향과 무관하게 뒤로
      if (isEmpty(va) && isEmpty(vb)) return 0;
      if (isEmpty(va)) return 1;
      if (isEmpty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
  }, [recentTx, sortKey, sortDir]);

  // 탭·계좌·기간 필터 변경 시 선택 초기화 (다른 목록의 선택이 남지 않게)
  useEffect(() => { setSelectedTxIds(new Set()); }, [tab, selectedAccountNo, bankTxFrom, bankTxTo]);

  const toggleTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체선택/일괄은 미처리(journal_entry_id 없음) 건만 대상.
  const selectableTx = sortedTx.filter((tx) => !tx.journal_entry_id);
  const allTxSelected = selectableTx.length > 0 && selectableTx.every((tx) => selectedTxIds.has(tx.id));
  const someTxSelected = selectableTx.some((tx) => selectedTxIds.has(tx.id)) && !allTxSelected;
  const toggleAllTx = () => {
    setSelectedTxIds((prev) => {
      if (selectableTx.every((tx) => prev.has(tx.id))) return new Set();
      return new Set(selectableTx.map((tx) => tx.id));
    });
  };

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

  const Stat = ({ tone, icon, label, value, delta, sub, invertDeltaColor }: {
    tone: string;
    icon: React.ReactNode;
    label: string;
    value: string;
    delta?: number | null;
    sub?: string;
    invertDeltaColor?: boolean;
  }) => (
    <div className="glass-card p-6 group hover:shadow-xl transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg bg-gradient-to-br ${tone} group-hover:scale-105 transition-transform`}>
          {icon}
        </div>
        {delta != null ? (
          <span className={`text-sm font-semibold inline-flex items-center gap-1 ${(invertDeltaColor ? delta < 0 : delta >= 0) ? "text-emerald-500" : "text-red-500"}`}>
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
        actions={
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => bankCd.run(handleSyncBank)}
            disabled={syncing || !companyId || bankCd.disabled}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold text-sm shadow hover:shadow-lg hover:shadow-indigo-500/30 transition disabled:opacity-50 ${bankCd.disabled ? "!opacity-40 cursor-not-allowed" : ""}`}
            title={bankCd.disabled ? `30분 쿨타임 — ${bankCd.label}` : "통장 거래 기간을 설정한 뒤 CODEF 은행 연동으로 그 기간의 거래·잔액을 불러옵니다"}
          >
            {syncing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                연동 중...
              </>
            ) : bankCd.disabled ? (
              <>⏳ {bankCd.label}</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                통장 연동
              </>
            )}
          </button>
          </div>
        }
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
          invertDeltaColor
        />
        <Stat
          tone="from-purple-500 to-purple-600"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
          label="분류 완료율"
          value={mappingRate != null ? `${mappingRate}%` : "—"}
          sub={flow && flow.total > 0 ? `${flow.mapped}/${flow.total}건` : "거래 없음"}
        />
      </div>

      {/* 기간설정 — 카드 페이지와 통일 위치(제목 헤더 아래). 통장 연동 sync 범위 + 거래내역 표 필터 공통 적용 */}
      <div className="no-print flex items-center gap-2 mb-6 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-muted)]">통장 거래 기간</span>
        <DateField value={bankTxFrom} max={bankTxTo || undefined} onChange={(e) => setBankTxFrom(e.target.value)} title="시작일"
          className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
        <span className="text-[var(--text-dim)] text-xs">~</span>
        <DateField value={bankTxTo} min={bankTxFrom || undefined} onChange={(e) => setBankTxTo(e.target.value)} title="종료일"
          className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
        {(bankTxFrom || bankTxTo) && <button onClick={() => { setBankTxFrom(""); setBankTxTo(""); }} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1">기간 해제</button>}
        <span className="text-[10px] text-[var(--text-dim)] ml-auto hidden sm:block">통장 연동 시 이 기간의 거래를 불러오고, 거래내역 표에도 적용됩니다</span>
      </div>

      {/* Tabs — 시안 underline */}
      <div className="tab-bar mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`tab-item ${tab === t.key ? "tab-item-active" : ""}`}
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

      {/* 통장 — portfolio 카드(이름·잔액·이번달 증감). 2026-05-29 카드 크기 축소(p-4·3열). */}
      {tab === "accounts" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3 glass-card py-14 px-6 text-center">
              <div className="text-4xl mb-3">🏦</div>
              <p className="text-sm font-semibold text-[var(--text)] mb-1">통장이 아직 연동되지 않았습니다</p>
              <p className="text-xs text-[var(--text-muted)] mb-4">CODEF 은행 연동으로 통장과 거래내역을 자동으로 불러옵니다</p>
              <button
                type="button"
                onClick={handleSyncBank}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold text-xs shadow hover:shadow-lg transition disabled:opacity-50"
              >
                {syncing ? "연동 중..." : "🏦 통장 연동하기"}
              </button>
            </div>
          ) : accounts.map((a) => {
            const accNo = a.accountNo || "";
            const change = changeByAcct[accNo] || 0;
            const name = a.alias || (a.bankName ? `${a.bankName}${accNo.slice(-4) ? " " + accNo.slice(-4) : ""}` : accNo) || "계좌";
            const bal = Number(a.balance || 0);
            return (
              <div
                key={a.accountNo}
                role="button"
                tabIndex={0}
                onClick={() => { setSelectedAccountNo(accNo); setSelectedAccountLabel(name); setTab("transactions"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { setSelectedAccountNo(accNo); setSelectedAccountLabel(name); setTab("transactions"); } }}
                className="glass-card card-hover p-5 transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text)] truncate flex-1 min-w-0">{name}</h3>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* 통장 이름 편집(연필) — 카드 클릭과 분리(stopPropagation) */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleEditAlias(accNo, a.alias, a.bankName, bal); }}
                      className="opacity-0 group-hover:opacity-100 transition p-1 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)]"
                      title="이름 변경"
                      aria-label="이름 변경"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    {Math.round(change) !== 0 && (
                      change >= 0 ? (
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9-9m0 0H9m7 0v7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7l-9 9m0 0h7m-7 0V9" /></svg>
                      )
                    )}
                  </div>
                </div>
                <p className="text-lg font-bold text-[var(--text)] mb-1.5 mono-number">{fmtW(bal)}</p>
                {Math.round(change) !== 0 ? (
                  <div className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${change >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}>
                    {change >= 0 ? "+" : "-"}{fmtW(Math.abs(change))}
                  </div>
                ) : (
                  <div className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    변화 없음
                  </div>
                )}
                <p className="text-[10px] text-[var(--text-dim)] mt-2">클릭 → 이 통장 거래내역</p>
              </div>
            );
          })}
        </div>
      )}

      {/* 거래내역 — 시안 표 (거래/분류/금액/날짜/상태) 최근 50건. selectedAccountNo 있으면 그 통장만. */}
      {tab === "transactions" && (
        <>
          {selectedAccountNo && (
            <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30">
              <span className="text-sm text-[var(--text)]">
                <b className="text-[var(--primary)]">{selectedAccountLabel || selectedAccountNo}</b> 거래내역만 표시 중
              </span>
              <button
                type="button"
                onClick={() => { setSelectedAccountNo(""); setSelectedAccountLabel(""); }}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition"
              >
                ✕ 전체 보기
              </button>
            </div>
          )}
        {/* 선택 액션바 — 1건 이상 선택 시 sticky 노출. 전표처리는 자리표시(준비중) */}
        {selectedTxIds.size > 0 && (
          <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30">
            <span className="text-sm font-semibold text-[var(--text)]">
              <b className="text-[var(--primary)]">{selectedTxIds.size}건</b> 선택됨
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setBulkAccountId(""); setBulkFixed(false); setShowBulkPost(true); }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:brightness-110 transition"
              >
                전표처리({selectedTxIds.size})
              </button>
              <button
                type="button"
                onClick={() => setSelectedTxIds(new Set())}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition"
              >
                선택 해제
              </button>
            </div>
          </div>
        )}
        {/* 정렬 버튼 툴바 — 헤더 더블클릭 정렬과 동일 sortKey/sortDir 공유 */}
        <div className="mb-3">
          <SortToolbar
            options={[
              { key: "transaction_date", label: "날짜" },
              { key: "counterparty", label: "거래처" },
              { key: "amount", label: "금액" },
              { key: "type", label: "상태" },
            ]}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSortTx}
          />
        </div>
        <div className="glass-card overflow-hidden">
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full">
              <thead className="sticky-bar">
                <tr className="table-head-row">
                  <th className="w-10 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={allTxSelected}
                      ref={(el) => { if (el) el.indeterminate = someTxSelected; }}
                      onChange={toggleAllTx}
                      aria-label="전체 선택"
                      className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                    />
                  </th>
                  <th onDoubleClick={() => onSortTx("counterparty")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">예금주명{sortKey === "counterparty" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th className="text-left px-6 py-4 font-semibold select-none">거래내용</th>
                  <th onDoubleClick={() => onSortTx("classification")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">분류{sortKey === "classification" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("amount")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">금액{sortKey === "amount" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th className="text-right px-6 py-4 font-semibold select-none">잔액</th>
                  <th onDoubleClick={() => onSortTx("transaction_date")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">날짜{sortKey === "transaction_date" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("type")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">상태{sortKey === "type" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTx.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="text-4xl mb-3">📄</div>
                      <p className="text-sm font-semibold text-[var(--text)] mb-1">{hasTxRange ? "이 기간에 거래내역이 없습니다" : "최근 거래내역이 없습니다"}</p>
                      <p className="text-xs text-[var(--text-muted)]">상단에서 기간을 설정하고 &lsquo;통장 연동&rsquo;을 누르면 그 기간의 거래를 불러옵니다</p>
                    </td>
                  </tr>
                ) : sortedTx.map((tx) => {
                  const isIncome = tx.type === "income";
                  const m = MAPPING_META[tx.mapping_status as string] || MAPPING_META.unmapped;
                  const posted = !!tx.journal_entry_id;
                  const checked = selectedTxIds.has(tx.id);
                  return (
                    <tr key={tx.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition-colors ${checked ? "bg-[var(--primary)]/5" : ""}`}>
                      <td className="w-10 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={posted}
                          onChange={() => toggleTx(tx.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="거래 선택"
                          title={posted ? "전표처리됨" : undefined}
                          className="h-4 w-4 cursor-pointer accent-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isIncome ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                            <svg className={`w-5 h-5 ${isIncome ? "text-emerald-500" : "text-red-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isIncome ? "M7 17l9-9m0 0H9m7 0v7" : "M17 7l-9 9m0 0h7m-7 0V9"} />
                            </svg>
                          </div>
                          <span className="font-medium text-[var(--text)] truncate">{tx.counterparty || "—"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)] max-w-[240px]"><span className="block truncate" title={tx.description || undefined}>{tx.description || "—"}</span></td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{tx.classification || tx.category || "—"}</td>
                      <td className={`px-6 py-4 font-semibold mono-number ${isIncome ? "text-emerald-500" : "text-red-500"}`}>
                        {isIncome ? "+" : "-"}{fmtW(Math.abs(Number(tx.amount || 0)))}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)] mono-number text-right whitespace-nowrap">{tx.balance_after != null ? fmtW(Number(tx.balance_after)) : "—"}</td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-6 py-4 relative">
                        <button
                          type="button"
                          onClick={() => { setMapOpenId(mapOpenId === tx.id ? null : tx.id); setMapCat(tx.category || ""); setMapFixed(!!tx.is_fixed_cost); }}
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${m.bg} ${m.text} cursor-pointer hover:ring-1 hover:ring-current`}
                          title="클릭해서 바로 매핑/무시 처리"
                        >{m.label}</button>
                        {posted && <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500">전표처리됨</span>}
                        {mapOpenId === tx.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMapOpenId(null)} />
                            <div className="absolute z-50 mt-1 right-4 w-56 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl p-3 text-left">
                              <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">분류 선택 후 매핑 처리</div>
                              <select value={mapCat} onChange={(e) => setMapCat(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs mb-2 focus:outline-none focus:border-[var(--primary)]">
                                <option value="">(분류 없음)</option>
                                {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <label className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--text)] cursor-pointer" title="매월 반복되는 지출이면 체크 — 경영흐름·고정비 리포트에 고정비로 집계되고, 같은 거래처는 다음부터 자동 체크됩니다">
                                <input type="checkbox" checked={mapFixed} onChange={(e) => setMapFixed(e.target.checked)} className="accent-orange-500" />
                                고정비로 표시 <span className="text-[var(--text-dim)]">(매월 반복 지출)</span>
                              </label>
                              <div className="flex gap-1.5">
                                <button type="button" onClick={() => mapMut.mutate({ id: tx.id, category: mapCat, isFixedCost: mapFixed })} disabled={mapMut.isPending}
                                  className="flex-1 px-2 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 hover:brightness-110">매핑 완료</button>
                                <button type="button" onClick={() => ignoreMut.mutate(tx.id)} disabled={ignoreMut.isPending}
                                  className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]">무시</button>
                              </div>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* 일괄 전표처리 모달 — 선택된 미처리 통장거래를 계정 1개로 일괄 생성(입출금 방향 자동) */}
      {showBulkPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkPost(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedTxIds.size}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계정과목 *</label>
                <select value={bulkAccountId} onChange={(e) => setBulkAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                  <option value="">계정 선택</option>
                  {(coaAccounts as any[]).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                <input type="checkbox" checked={bulkFixed} onChange={(e) => setBulkFixed(e.target.checked)} className="accent-orange-500" />
                고정비로 표시 <span className="text-[var(--text-dim)]">— 매월 반복 지출이면 체크 (경영흐름·고정비 리포트에 고정비로 집계)</span>
              </label>
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">출금은 차) 선택 계정 / 대) 보통예금, 입금은 차) 보통예금 / 대) 선택 계정으로 방향이 자동 결정됩니다. 통장 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkPost(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={doBulkPostBank} disabled={bulkPosting || !bulkAccountId}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                {bulkPosting ? "처리 중..." : `${selectedTxIds.size}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

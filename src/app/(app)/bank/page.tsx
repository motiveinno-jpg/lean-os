"use client";

// /bank — 통장 자립 페이지(시안 그대로). 시안 portfolio 카드 + 시안 거래내역 표 직접 구현.
//   기존 BankAccountsOverview / TransactionsView 미사용 (그쪽은 /transactions 에서 그대로).
//   표시 전용 — 새 mutation·RPC 0. read-only 쿼리만.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DateField } from "@/components/date-field";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { SiyanPageHeader } from "@/components/siyan";
import { getBankAccountChanges, getDistinctBankAccountNos, setBankAccountAlias } from "@/lib/queries";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  // 통장 카드 클릭 시 거래내역 필터 — accountNo + 표시 이름 동시 보관.
  const [selectedAccountNo, setSelectedAccountNo] = useState<string>("");
  const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>("");
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

  // ── 영수증 스캔(OCR) → 지출 거래 등록 ──
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrSaving, setOcrSaving] = useState(false);
  const [ocrForm, setOcrForm] = useState<{ amount: string; merchant: string; date: string; category: string; memo: string } | null>(null);
  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setOcrScanning(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${companyId}/ocr/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      // Edge 가 서버에서 fetch 하므로 서명 URL(시간제한) 사용 — 버킷 public/private 무관 동작.
      const { data: signed, error: signErr } = await supabase.storage.from("receipts").createSignedUrl(path, 300);
      if (signErr || !signed?.signedUrl) throw signErr || new Error("이미지 URL 생성 실패");
      const { data, error } = await supabase.functions.invoke("ocr-receipt", { body: { image_url: signed.signedUrl } });
      if (error) throw error;
      if (!data?.success || !data.confidence) { toast("영수증을 인식하지 못했습니다. 다시 시도해주세요.", "error"); return; }
      const catMap: Record<string, string> = {
        "식대": "복리후생비", "교통": "교통비", "소모품": "소모품비", "사무용품": "소모품비",
        "접대": "접대비", "통신": "통신비", "기타": "기타비용",
      };
      setOcrForm({
        amount: data.amount ? String(data.amount) : "",
        merchant: data.merchant || "",
        date: data.date || ymd(new Date()),
        category: data.category ? (catMap[data.category] || "") : "",
        memo: Array.isArray(data.items) && data.items.length ? data.items.join(", ") : "",
      });
      toast(`영수증 인식 완료 (확신도 ${data.confidence}%) — 확인 후 등록하세요`, "success");
    } catch (err: any) {
      toast(friendlyError(err, "영수증 스캔 실패"), "error");
    } finally {
      setOcrScanning(false);
      if (ocrFileRef.current) ocrFileRef.current.value = "";
    }
  };
  const saveOcrTx = async () => {
    if (!ocrForm || !companyId || ocrSaving) return;
    const amount = Number(ocrForm.amount);
    if (!amount || amount <= 0) { toast("금액을 입력하세요", "error"); return; }
    if (!ocrForm.date) { toast("거래일을 입력하세요", "error"); return; }
    setOcrSaving(true);
    try {
      // /bank 표·통계·리포트(pnl)가 모두 bank_transactions 를 읽으므로 여기에 등록(금액 양수 + type 으로 수입/지출 구분).
      const externalId = `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await db.from("bank_transactions").insert({
        company_id: companyId,
        external_id: externalId,
        amount,
        type: "expense",
        description: ocrForm.merchant || "영수증",
        transaction_date: ocrForm.date,
        source: "manual",
        counterparty: ocrForm.merchant || null,
        category: ocrForm.category || null,
        memo: ocrForm.memo || null,
        mapping_status: ocrForm.category ? "manual_mapped" : "unmapped",
      });
      if (error) throw error;
      toast("지출 거래가 등록되었습니다", "success");
      setOcrForm(null);
      setTab("transactions");
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-flow-v2"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-changes"] });
    } catch (err: any) {
      toast(friendlyError(err, "등록 실패"), "error");
    } finally {
      setOcrSaving(false);
    }
  };

  // 통장 연동(CODEF 은행 sync + 잔액 재계산) — /transactions 의 동일 흐름 재사용.
  const handleSyncBank = async () => {
    if (!companyId) return;
    setSyncing(true);
    try {
      const { syncCodefData, syncBankBalances } = await import("@/lib/data-sync");
      const result = await syncCodefData(companyId, "bank");
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

  // 시안 거래내역 표 — 최근 50건 read-only (탭 클릭 시에만). selectedAccountNo 있으면 그 계좌만.
  const { data: recentTx = [] } = useQuery({
    queryKey: ["bank-page-recent-tx", companyId, selectedAccountNo],
    queryFn: async () => {
      // accountNo 는 client-side 필터 (raw_data->>accountNo PostgREST eq 불안정 — transactions 페이지와 동일 패턴)
      const q = db.from("bank_transactions")
        .select("id, transaction_date, type, amount, counterparty, description, classification, category, mapping_status, raw_data")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .limit(selectedAccountNo ? 2000 : 50);
      const { data } = await q;
      const rows = (data || []) as any[];
      return selectedAccountNo
        ? rows.filter((r) => r.raw_data?.accountNo === selectedAccountNo).slice(0, 50)
        : rows;
    },
    enabled: !!companyId && tab === "transactions",
  });

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

  // 탭·계좌 필터 변경 시 선택 초기화 (다른 목록의 선택이 남지 않게)
  useEffect(() => { setSelectedTxIds(new Set()); }, [tab, selectedAccountNo]);

  const toggleTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allTxSelected = sortedTx.length > 0 && sortedTx.every((tx) => selectedTxIds.has(tx.id));
  const someTxSelected = sortedTx.some((tx) => selectedTxIds.has(tx.id)) && !allTxSelected;
  const toggleAllTx = () => {
    setSelectedTxIds((prev) => {
      if (sortedTx.every((tx) => prev.has(tx.id))) return new Set();
      return new Set(sortedTx.map((tx) => tx.id));
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
            onClick={() => ocrFileRef.current?.click()}
            disabled={ocrScanning || !companyId}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)] font-semibold text-sm hover:border-[var(--primary)] transition disabled:opacity-50"
            title="영수증 사진으로 지출 거래를 자동 등록합니다"
          >
            {ocrScanning ? (
              <><span className="w-3.5 h-3.5 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" /> 분석 중...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg> 영수증 스캔</>
            )}
          </button>
          <button
            type="button"
            onClick={handleSyncBank}
            disabled={syncing || !companyId}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold text-sm shadow hover:shadow-lg hover:shadow-blue-500/30 transition disabled:opacity-50"
            title="CODEF 은행 연동으로 최근 거래·잔액을 불러옵니다"
          >
            {syncing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                연동 중...
              </>
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
      <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />

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

      {/* 통장 — portfolio 카드(이름·잔액·이번달 증감). 2026-05-29 카드 크기 축소(p-4·3열). */}
      {tab === "accounts" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3 glass-card p-10 text-center">
              <div className="text-3xl mb-2">🏦</div>
              <p className="text-sm font-medium text-[var(--text)] mb-1">통장이 아직 연동되지 않았습니다</p>
              <p className="text-xs text-[var(--text-muted)] mb-3">CODEF 은행 연동으로 통장과 거래내역을 자동으로 불러옵니다</p>
              <button
                type="button"
                onClick={handleSyncBank}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold text-xs shadow hover:shadow-lg transition disabled:opacity-50"
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
                className="glass-card p-4 hover:shadow-lg transition-all cursor-pointer group"
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
                disabled
                title="준비중"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
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
                  <th onDoubleClick={() => onSortTx("counterparty")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">거래{sortKey === "counterparty" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("classification")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">분류{sortKey === "classification" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("amount")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">금액{sortKey === "amount" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("transaction_date")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">날짜{sortKey === "transaction_date" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  <th onDoubleClick={() => onSortTx("type")} title="더블클릭하면 정렬" className="text-left px-6 py-4 font-semibold select-none cursor-pointer">상태{sortKey === "type" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTx.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">최근 거래내역이 없습니다</td></tr>
                ) : sortedTx.map((tx) => {
                  const isIncome = tx.type === "income";
                  const m = MAPPING_META[tx.mapping_status as string] || MAPPING_META.unmapped;
                  const checked = selectedTxIds.has(tx.id);
                  return (
                    <tr key={tx.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition-colors ${checked ? "bg-[var(--primary)]/5" : ""}`}>
                      <td className="w-10 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTx(tx.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="거래 선택"
                          className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                        />
                      </td>
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
        </>
      )}

      {/* 영수증 스캔 결과 확인·등록 모달 */}
      {ocrForm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setOcrForm(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold">영수증 인식 결과</h3>
              <button onClick={() => setOcrForm(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] mb-4">내용을 확인·수정한 뒤 <b className="text-[var(--text-muted)]">지출 거래</b>로 등록됩니다.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">금액 (원) *</label>
                <input type="text" inputMode="numeric" value={ocrForm.amount ? Number(ocrForm.amount).toLocaleString("ko-KR") : ""}
                  onChange={(e) => setOcrForm((f) => f && ({ ...f, amount: e.target.value.replace(/[^0-9]/g, "") }))}
                  placeholder="0" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">거래처</label>
                <input value={ocrForm.merchant} onChange={(e) => setOcrForm((f) => f && ({ ...f, merchant: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5">거래일 *</label>
                  <DateField value={ocrForm.date} onChange={(e) => setOcrForm((f) => f && ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5">카테고리</label>
                  <select value={ocrForm.category} onChange={(e) => setOcrForm((f) => f && ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                    <option value="">선택 안함</option>
                    <option value="복리후생비">복리후생비</option><option value="소모품비">소모품비</option><option value="통신비">통신비</option>
                    <option value="교통비">교통비</option><option value="광고선전비">광고선전비</option><option value="접대비">접대비</option>
                    <option value="보험료">보험료</option><option value="세금공과">세금공과</option><option value="수수료">수수료</option>
                    <option value="임대료">임대료</option><option value="기타비용">기타비용</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">메모 (품목)</label>
                <input value={ocrForm.memo} onChange={(e) => setOcrForm((f) => f && ({ ...f, memo: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button onClick={() => setOcrForm(null)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
              <button onClick={saveOcrTx} disabled={ocrSaving} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{ocrSaving ? "등록 중..." : "지출 거래 등록"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

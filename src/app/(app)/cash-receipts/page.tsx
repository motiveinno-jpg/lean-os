"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import {
  getCashReceipts,
  createCashReceipt,
  cancelCashReceipt,
  getCashReceiptSummary,
  bulkImportCashReceipts,
  parseHomeTaxCashReceipts,
  STATUS_LABELS,
  PURPOSE_LABELS,
} from "@/lib/cash-receipts";
import type { CashReceipt } from "@/lib/cash-receipts";
import * as XLSX from "xlsx";
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";

type Tab = "income" | "expense" | "register";

const SYNC_STORAGE_KEY = "cashreceipt-active-job-id";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const INITIAL_FORM = {
  type: "expense" as "income" | "expense",
  amount: "",
  counterpartyName: "",
  counterpartyBizno: "",
  issueDate: new Date().toISOString().split("T")[0],
  approvalNumber: "",
  identityNumber: "",
  identityType: "phone" as "phone" | "bizno" | "card",
  purpose: "expenditure_proof" as "expenditure_proof" | "income_deduction",
  memo: "",
};

export default function CashReceiptsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("expense");
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);

  // ─── 홈택스 sync (현금영수증 매출) ───
  const [syncFromMonth, setSyncFromMonth] = useState(thisMonth);
  const [syncToMonth, setSyncToMonth] = useState(thisMonth);
  const [syncStarting, setSyncStarting] = useState(false);
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(SYNC_STORAGE_KEY);
  });
  const setActiveJobId = (id: string | null) => {
    setActiveJobIdRaw(id);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(SYNC_STORAGE_KEY, id);
    else localStorage.removeItem(SYNC_STORAGE_KEY);
  };

  // Date range for filter
  const now = new Date();
  const [startDate, setStartDate] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
  );
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u?.company_id) setCompanyId(u.company_id);
    });
  }, []);

  // Receipts list
  const { data: receipts = [], isLoading, error } = useQuery({
    queryKey: ["cash-receipts", companyId, tab, startDate, endDate],
    queryFn: () =>
      getCashReceipts(companyId!, {
        type: tab === "register" ? undefined : tab,
        startDate,
        endDate,
      }),
    enabled: !!companyId && tab !== "register",
  });

  // Summary
  const { data: summary } = useQuery({
    queryKey: ["cash-receipt-summary", companyId, startDate, endDate],
    queryFn: () => getCashReceiptSummary(companyId!, startDate, endDate),
    enabled: !!companyId,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-for-cash", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("partners")
        .select("id, name, business_number")
        .eq("company_id", companyId!)
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const filteredPartners = useMemo(() =>
    partners.filter((p: any) =>
      !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      (p.business_number || "").includes(partnerSearch)
    ),
  [partners, partnerSearch]);

  // mount 시 진행 중 job 감지 — 사용자가 페이지 떠났다 와도 진행 표시.
  useEffect(() => {
    if (!companyId || activeJobId) return;
    (async () => {
      const db = supabase as any;
      const { data } = await db
        .from("hometax_sync_jobs")
        .select("id, status, updated_at")
        .eq("company_id", companyId)
        .eq("job_type", "cash_receipt")
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // active job polling — Realtime 보조.
  const { data: activeJob } = useQuery({
    queryKey: ["cashreceipt-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const db = supabase as any;
      const { data } = await db
        .from("hometax_sync_jobs")
        .select("*")
        .eq("id", activeJobId)
        .maybeSingle();
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,
  });

  // Realtime 구독.
  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const db = supabase as any;
    const ch = db.channel(`cashreceipt_sync_jobs:${activeJobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "hometax_sync_jobs", filter: `id=eq.${activeJobId}` }, (payload: any) => {
        queryClient.setQueryData(["cashreceipt-sync-job", activeJobId], payload.new);
        if (TERMINAL.has(payload.new.status)) {
          setActiveJobId(null);
          queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
          queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
          if (payload.new.status === "completed") {
            const synced = payload.new.total_synced || 0;
            const errs = payload.new.errors || [];
            const errSummary = errs.length > 0 ? ` (오류 ${errs.length}건: ${errs[0]?.hint || errs[0]?.message || ""})` : "";
            if (synced === 0 && errs.length === 0) {
              toast("동기화 완료 — 해당 기간에 발행한 매출 현금영수증이 없습니다. (홈택스에서 직접 확인 권장)", "info");
            } else {
              toast(`매출 현금영수증 ${synced}건 동기화${errSummary}`, synced > 0 ? "success" : "info");
            }
          } else {
            const e = payload.new.errors?.[0];
            toast(`동기화 실패: ${e?.hint || e?.message || "알 수 없는 오류"}`, "error");
          }
        }
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [activeJobId, companyId, queryClient, toast]);

  // 폴링 결과로 terminal 감지된 경우도 정리 (Realtime 누락 백업).
  useEffect(() => {
    if (!activeJob || !activeJobId) return;
    if (TERMINAL.has(activeJob.status)) {
      setActiveJobId(null);
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    }
  }, [activeJob, activeJobId, queryClient]);

  const startSync = async () => {
    if (!companyId || syncStarting || activeJobId) return;
    if (syncFromMonth > syncToMonth) {
      toast("시작 월이 종료 월보다 이전이어야 합니다", "error");
      return;
    }
    setSyncStarting(true);
    try {
      const startDate = `${syncFromMonth}-01`;
      const [ey, em] = syncToMonth.split("-").map(Number);
      const lastDay = new Date(ey, em, 0).getDate();
      const endDate = `${syncToMonth}-${String(lastDay).padStart(2, "0")}`;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast("세션이 만료되었습니다. 다시 로그인하세요.", "error");
        return;
      }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({
          companyId, action: "hometax-sync-async",
          startDate, endDate, jobType: "cash_receipt",
        }),
      });
      const result = await res.json();
      if (res.status === 409 && result.activeJobId) {
        setActiveJobId(result.activeJobId);
        toast(`이미 진행 중인 동기화가 있습니다 (${result.progress?.label || "진행 중"})`, "info");
        return;
      }
      if (!res.ok || !result.jobId) {
        toast(`동기화 시작 실패: ${result.error || "응답 없음"}`, "error");
        return;
      }
      setActiveJobId(result.jobId);
      toast("백그라운드 동기화 시작됨. 페이지 떠나도 됩니다.", "success");
    } catch (err: any) {
      toast(`동기화 실패: ${err.message}`, "error");
    } finally {
      setSyncStarting(false);
    }
  };

  const handleSave = async () => {
    if (!companyId || saving) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast("금액을 입력하세요", "error");
      return;
    }
    if (!form.issueDate) {
      toast("발행일을 선택하세요", "error");
      return;
    }
    setSaving(true);
    try {
      await createCashReceipt({
        companyId,
        type: form.type,
        amount,
        counterpartyName: form.counterpartyName || undefined,
        counterpartyBizno: form.counterpartyBizno || undefined,
        issueDate: form.issueDate,
        approvalNumber: form.approvalNumber || undefined,
        identityNumber: form.identityNumber || undefined,
        identityType: form.identityType,
        purpose: form.purpose,
        memo: form.memo || undefined,
      });
      toast("현금영수증이 등록되었습니다", "success");
      setForm({ ...INITIAL_FORM, type: form.type });
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(`등록 실패: ${err.message}`, "error");
    }
    setSaving(false);
  };

  const handleCancel = async (receipt: CashReceipt) => {
    if (!confirm(`${receipt.counterparty_name || "현금영수증"} ₩${Number(receipt.amount).toLocaleString()} 취소하시겠습니까?`)) return;
    try {
      await cancelCashReceipt(receipt.id);
      toast("현금영수증이 취소되었습니다", "success");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(`취소 실패: ${err.message}`, "error");
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const parsed = parseHomeTaxCashReceipts(rows);
      if (parsed.length === 0) {
        toast("파싱 가능한 현금영수증이 없습니다", "error");
        setUploading(false);
        return;
      }
      await bulkImportCashReceipts(companyId, parsed);
      toast(`${parsed.length}건 현금영수증 업로드 완료`, "success");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(`업로드 실패: ${err.message}`, "error");
    }
    setUploading(false);
    e.target.value = "";
  };

  return (
    <div className="space-y-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">현금영수증</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            매출/매입 현금영수증 관리 · 부가세 공제 자동 반영
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 홈택스 sync (현금영수증 매출) */}
          <input
            type="month"
            value={syncFromMonth}
            onChange={(e) => setSyncFromMonth(e.target.value)}
            disabled={syncStarting || !!activeJobId}
            className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text)] disabled:opacity-50"
            aria-label="동기화 시작 월"
          />
          <span className="text-[var(--text-dim)] text-xs">~</span>
          <input
            type="month"
            value={syncToMonth}
            onChange={(e) => setSyncToMonth(e.target.value)}
            disabled={syncStarting || !!activeJobId}
            className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text)] disabled:opacity-50"
            aria-label="동기화 종료 월"
          />
          <button
            onClick={startSync}
            disabled={syncStarting || !!activeJobId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="홈택스에서 현금영수증 매출(발행) 내역 가져오기. 매입 내역은 CODEF API 미지원."
          >
            <svg className={`w-3.5 h-3.5 ${(syncStarting || activeJobId) ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncStarting ? "시작 중..."
              : activeJobId
                ? `백그라운드 ${activeJob?.current_progress?.done || 0}/${activeJob?.current_progress?.total || 0} (${activeJob?.current_progress?.label || ""})`
                : "홈택스 매출 가져오기"}
          </button>
          <label className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-xs font-semibold cursor-pointer hover:bg-[var(--bg)] transition">
            {uploading ? "업로드 중..." : "엑셀 업로드"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleExcelUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
            <div className="text-[10px] text-[var(--text-dim)] font-medium">매출 발행</div>
            <div className="text-lg font-black text-blue-400 mt-1">
              {summary.incomeCount}건
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              ₩{summary.incomeTotal.toLocaleString()}
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
            <div className="text-[10px] text-[var(--text-dim)] font-medium">매입 수취</div>
            <div className="text-lg font-black text-green-400 mt-1">
              {summary.expenseCount}건
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              ₩{summary.expenseTotal.toLocaleString()}
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
            <div className="text-[10px] text-[var(--text-dim)] font-medium">매입세액 공제</div>
            <div className="text-lg font-black text-[var(--primary)] mt-1">
              ₩{summary.expenseTax.toLocaleString()}
            </div>
            <div className="text-xs text-[var(--text-muted)]">부가세 신고 시 공제</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
            <div className="text-[10px] text-[var(--text-dim)] font-medium">합계</div>
            <div className="text-lg font-black mt-1">
              {summary.incomeCount + summary.expenseCount}건
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              ₩{(summary.incomeTotal + summary.expenseTotal).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Date filter */}
      <div className="flex items-center gap-2 text-xs">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
        />
        <span className="text-[var(--text-dim)]">~</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] p-1 rounded-xl w-fit">
        {(
          [
            ["expense", "매입 (수취)"],
            ["income", "매출 (발행)"],
            ["register", "등록"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${
              tab === t
                ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <QueryErrorBanner error={error} />

      {/* Register tab */}
      {tab === "register" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 space-y-4">
          <h2 className="text-sm font-bold">현금영수증 수동 등록</h2>

          <div className="flex gap-2">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setForm((f) => ({ ...f, type: t }))}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                  form.type === t
                    ? t === "income"
                      ? "bg-blue-500 text-white"
                      : "bg-green-500 text-white"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]"
                }`}
              >
                {t === "income" ? "매출 (발행)" : "매입 (수취)"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                발행일 *
              </label>
              <input
                type="date"
                value={form.issueDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issueDate: e.target.value }))
                }
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                합계금액 (VAT포함) *
              </label>
              <CurrencyInput
                value={form.amount}
                onValueChange={(raw) => {
                  setForm((f) => ({ ...f, amount: raw }));
                }}
                placeholder="110,000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right font-mono focus:outline-none focus:border-[var(--primary)]"
              />
              {form.amount && Number(form.amount) > 0 && (
                <div className="text-[10px] text-[var(--text-dim)] mt-1">
                  공급가액: ₩
                  {Math.round(
                    Number(form.amount) / 1.1,
                  ).toLocaleString()}{" "}
                  / 세액: ₩
                  {(
                    Number(form.amount) -
                    Math.round(Number(form.amount) / 1.1)
                  ).toLocaleString()}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                거래처명
              </label>
              <input
                value={form.counterpartyName}
                onChange={(e) => {
                  setForm((f) => ({ ...f, counterpartyName: e.target.value }));
                  setPartnerSearch(e.target.value);
                  setShowPartnerDropdown(e.target.value.length > 0);
                }}
                onFocus={() => form.counterpartyName && setShowPartnerDropdown(true)}
                onBlur={() => setTimeout(() => setShowPartnerDropdown(false), 200)}
                placeholder="거래처명 검색"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
              {showPartnerDropdown && filteredPartners.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg max-h-40 overflow-y-auto">
                  {filteredPartners.slice(0, 8).map((p: any) => (
                    <button key={p.id} type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, counterpartyName: p.name, counterpartyBizno: p.business_number || "" }));
                        setShowPartnerDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-sm transition">
                      <span className="font-medium">{p.name}</span>
                      {p.business_number && <span className="text-xs text-[var(--text-dim)] ml-2">{p.business_number}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                사업자번호
              </label>
              <input
                value={form.counterpartyBizno}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    counterpartyBizno: e.target.value,
                  }))
                }
                placeholder="000-00-00000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                승인번호
              </label>
              <input
                value={form.approvalNumber}
                onChange={(e) =>
                  setForm((f) => ({ ...f, approvalNumber: e.target.value }))
                }
                placeholder="승인번호"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                용도 *
              </label>
              <select
                value={form.purpose}
                onChange={(e) => {
                  const purpose = e.target.value as any;
                  setForm((f) => ({
                    ...f,
                    purpose,
                    identityType: purpose === "income_deduction" ? "phone" : "bizno",
                    identityNumber: "",
                  }));
                }}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm"
              >
                <option value="expenditure_proof">지출증빙</option>
                <option value="income_deduction">소득공제</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {form.purpose === "income_deduction" ? "전화번호" : "사업자등록번호"}
              </label>
              <input
                value={form.identityNumber}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    identityNumber: e.target.value,
                  }))
                }
                placeholder={form.purpose === "income_deduction" ? "010-0000-0000" : "000-00-00000"}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
              <div className="text-[10px] text-[var(--text-dim)] mt-1">
                {form.purpose === "income_deduction"
                  ? "소득공제용: 소비자 전화번호 입력"
                  : "지출증빙용: 거래처 사업자등록번호 입력"}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                메모
              </label>
              <input
                value={form.memo}
                onChange={(e) =>
                  setForm((f) => ({ ...f, memo: e.target.value }))
                }
                placeholder="비고"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !companyId}
            className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {saving ? "저장 중..." : "현금영수증 등록"}
          </button>
        </div>
      )}

      {/* List tabs */}
      {tab !== "register" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {isLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : receipts.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🧾</div>
              <div className="text-sm font-medium text-[var(--text)]">
                {tab === "income"
                  ? "매출 현금영수증이 없습니다"
                  : "매입 현금영수증이 없습니다"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {tab === "income"
                  ? "상단의 '홈택스 매출 가져오기' 또는 등록 탭에서 직접 등록하세요"
                  : "매입은 CODEF 미지원 — 등록 탭에서 직접 등록하거나 홈택스 엑셀을 업로드하세요"}
              </div>
            </div>
          ) : (
            <div className="overflow-auto max-h-[560px] relative">
              <table className="w-full min-w-[700px]">
                <thead className="sticky top-0 z-10 bg-[var(--bg-card)] shadow-[0_1px_0_0_var(--border)]">
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">
                      발행일
                    </th>
                    <th className="text-left px-5 py-3 font-medium">
                      거래처
                    </th>
                    <th className="text-right px-5 py-3 font-medium">
                      합계금액
                    </th>
                    <th className="text-right px-5 py-3 font-medium">
                      공급가액
                    </th>
                    <th className="text-right px-5 py-3 font-medium">
                      세액
                    </th>
                    <th className="text-center px-5 py-3 font-medium">
                      용도
                    </th>
                    <th className="text-center px-5 py-3 font-medium">
                      상태
                    </th>
                    <th className="text-center px-5 py-3 font-medium">
                      작업
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => {
                    const st = STATUS_LABELS[r.status] || STATUS_LABELS.issued;
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition"
                      >
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                          {r.issue_date}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium">
                          {r.counterparty_name || "—"}
                          {r.approval_number && (
                            <span className="ml-2 text-[10px] text-[var(--text-dim)]">
                              #{r.approval_number}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-right font-semibold">
                          ₩{Number(r.amount).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">
                          ₩{Number(r.supply_amount || 0).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">
                          ₩{Number(r.tax_amount || 0).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-[10px] text-[var(--text-dim)]">
                            {r.purpose
                              ? PURPOSE_LABELS[r.purpose] || r.purpose
                              : "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {r.status === "issued" && (
                            <button
                              onClick={() => handleCancel(r)}
                              className="text-[10px] text-red-400 hover:text-red-300 transition"
                            >
                              취소
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
                  <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                    <td
                      colSpan={2}
                      className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]"
                    >
                      합계 ({receipts.length}건)
                    </td>
                    <td className="px-5 py-3 text-sm text-right font-bold">
                      ₩
                      {receipts
                        .reduce(
                          (s, r) => s + Number(r.amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">
                      ₩
                      {receipts
                        .reduce(
                          (s, r) => s + Number(r.supply_amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">
                      ₩
                      {receipts
                        .reduce(
                          (s, r) => s + Number(r.tax_amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, TokenField, AmountRange, amountHit, AppliedChips, QuickSearch, quickSearchHit, quickTerms,
  RowsPerPage, Pager, usePager, useSavedQueries, SelectionBar, defaultRange, periodQuicks,
  type AppliedChip,
} from "@/components/query-kit";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useRef, useState, useMemo } from "react";
import { DateField } from "@/components/date-field";
import { DateRangeField } from "@/components/date-range-field";
import { friendlyError } from "@/lib/friendly-error";
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
  issueCashReceiptNts,
  refreshCashReceiptNts,
  cancelCashReceiptNts,
  syncPurchaseCashReceipts,
  STATUS_LABELS,
  PURPOSE_LABELS,
  cashReceiptSign,
} from "@/lib/cash-receipts";
import type { CashReceipt } from "@/lib/cash-receipts";
import { getCashReceiptIssuanceStatus } from "@/lib/billing";
import * as XLSX from "xlsx";
import { QueryErrorBanner } from "@/components/query-status";
import { ToolbarPopover, ToolbarPopoverItem } from "@/components/toolbar-popover";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

type Tab = "income" | "expense" | "register";
/** 검색조건 (조회 화면 표준, 2026-08-18 Wave 1). ★ '조회'를 눌러야 반영. 기간·빠른검색은 즉시. */
type Cond = { status: string[]; purpose: string[]; partner: string[]; min: string; max: string; rows: number };
const EMPTY_COND: Cond = { status: [], purpose: [], partner: [], min: "", max: "", rows: 50 };
const condCount = (c: Cond) => c.status.length + c.purpose.length + c.partner.length + ((c.min || c.max) ? 1 : 0);

const SYNC_STORAGE_KEY = "cashreceipt-active-job-id";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const INITIAL_FORM = {
  type: "expense" as "income" | "expense",
  amount: "",
  counterpartyName: "",
  counterpartyBizno: "",
  issueDate: todayKst(),
  approvalNumber: "",
  identityNumber: "",
  identityType: "phone" as "phone" | "bizno" | "card",
  purpose: "expenditure_proof" as "expenditure_proof" | "income_deduction",
  memo: "",
};

export default function CashReceiptsPage() {
  const { toast } = useToast();
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  //   세금계산서 화면과 같이 매출부터 연다 — 탭 순서도 매출·매입으로 맞췄다 (2026-08-10)
  const [tab, setTab] = useState<Tab>("income");
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);

  // ─── 국세청 실발행 (CODEF ↔ 팝빌) ───
  const INITIAL_ISSUE_FORM = {
    amount: "",
    purpose: "income_deduction" as "expenditure_proof" | "income_deduction",
    identityNumber: "",
    identityType: "phone" as "phone" | "bizno" | "card",
    taxationType: "과세" as "과세" | "비과세",
    counterpartyName: "",
    itemName: "",
    memo: "",
  };
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState(INITIAL_ISSUE_FORM);
  const [issuing, setIssuing] = useState(false);
  const [ntsBusyId, setNtsBusyId] = useState<string | null>(null); // 행별 조회/취소 진행 중

  const handleNtsIssue = async () => {
    if (issuing) return;
    const amount = Number(issueForm.amount);
    if (!amount || amount <= 0) { toast("금액을 입력하세요", "error"); return; }
    const idDigits = issueForm.identityNumber.replace(/\D/g, "");
    if (idDigits.length < 10) { toast("식별번호(휴대폰/사업자/카드번호)를 확인하세요", "error"); return; }
    setIssuing(true);
    try {
      const result = await issueCashReceiptNts({
        amount,
        identityNum: issueForm.identityNumber,
        identityType: issueForm.identityType,
        purpose: issueForm.purpose,
        taxationType: issueForm.taxationType,
        counterpartyName: issueForm.counterpartyName || undefined,
        itemName: issueForm.itemName || undefined,
        memo: issueForm.memo || undefined,
      });
      toast(result.message || "현금영수증 발행 완료", "success");
      setShowIssueModal(false);
      setIssueForm(INITIAL_ISSUE_FORM);
      setTab("income");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(`발행 실패: ${err.message}${err.hint ? ` — ${err.hint}` : ""}`, "error");
    } finally { setIssuing(false); }
  };

  const handleNtsRefresh = async (receipt: CashReceipt) => {
    if (ntsBusyId) return;
    setNtsBusyId(receipt.id);
    try {
      const result = await refreshCashReceiptNts(receipt.id);
      toast(result.message || "상태 갱신 완료", "success");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
    } catch (err: any) {
      toast(`조회 실패: ${err.message}`, "error");
    } finally { setNtsBusyId(null); }
  };

  // ─── 홈택스 sync (현금영수증 매출) ───
  // 동기화 기간 = 헤더 조회기간(startDate~endDate) 공용 — 별도 월 피커 이원화 제거 (기준 통일)
  const [syncStarting, setSyncStarting] = useState(false);
  const [purchaseSyncing, setPurchaseSyncing] = useState(false);
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
  // 직원 QA #7 — 멈춘(hang) 백그라운드 job 을 failed 로 마킹(서버 409 잠금 해제) + 로컬 해제 → 다시 시도 가능 (CODEF 미접촉)
  const forceClearStuckJob = async (jid: string, silent = false) => {
    const db = supabase;
    try {
      await db.from("hometax_sync_jobs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", jid).in("status", ["pending", "running"]);
    } catch { /* best-effort */ }
    setActiveJobId(null);
    if (!silent) toast("멈춘 백그라운드 동기화를 해제했습니다. 다시 시도할 수 있습니다.", "info");
  };

  //   조회기간 — 기본 최근 1개월(조회 화면 표준). 이 기간이 곧 홈택스 수집 기간이기도 하다. ★ 조회값은 기억하지 않는다.
  const [startDate, setStartDate] = useState(() => defaultRange().from);
  const [endDate, setEndDate] = useState(() => defaultRange().to);
  //   ── 조회 화면 표준 — 수집·전표에서 확정한 뼈대 ──
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY_COND);
  const [live, setLive] = useState<Cond>(EMPTY_COND);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));

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

  // 승인번호 자동 채움 (2026-07-30 사장님 — 홈택스엔 올라갔는데 앱엔 승인번호가 비던 건):
  //   국세청 승인번호는 발행 당일 밤 일괄 전송 후 부여되는데, 사용자가 '승인번호 조회'를
  //   안 누르면 영영 빈 채로 남았다. 페이지 진입 시 어제 이전 발행분 중 승인번호 없는
  //   실발행 건(document_key 보유)을 자동 조회해 채운다 (최대 5건, 순차 — 과호출 방지).
  const autoRefreshDone = useRef(false);
  useEffect(() => {
    if (autoRefreshDone.current || !receipts.length) return;
    const today = todayKst();
    const targets = (receipts as CashReceipt[]).filter(
      (r) => r.document_key && !r.approval_number && r.status === "issued" && r.issue_date < today,
    ).slice(0, 5);
    if (targets.length === 0) return;
    autoRefreshDone.current = true;
    (async () => {
      let filled = 0;
      for (const r of targets) {
        try { await refreshCashReceiptNts(r.id); filled++; } catch { /* 개별 실패 무시 */ }
      }
      if (filled > 0) {
        queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
        toast(`국세청 승인번호 ${filled}건을 자동으로 불러왔습니다`, "success");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipts]);


  // 헤더 클릭 정렬 — 공용 부품(SortableTh). 기본 발행일 내림차순.
  type CrSortKey = "issue_date" | "counterparty_name" | "amount" | "supply_amount" | "tax_amount" | "purpose" | "status";
  const [sort, setSort] = useState<SortState<CrSortKey>>({ key: "issue_date", dir: "desc" });
  const onSort = (k: CrSortKey) => setSort((c) => nextSort(c, k, k === "issue_date" ? "desc" : "asc"));
  const crSortTh = (k: CrSortKey, label: string) => (
    <SortableTh label={label} sortKey={k} sort={sort} onSort={onSort} />
  );
  //   걸러서 정렬 — 빠른검색(거래처·승인번호·상대 번호·금액) + 검색조건(상태·용도·거래처·금액)
  const statusLabel = (r: any) => (STATUS_LABELS[r.status] || STATUS_LABELS.issued).label;
  const purposeLabel = (r: any) => PURPOSE_LABELS[r.purpose as keyof typeof PURPOSE_LABELS] || r.purpose || "";
  const rowHit = (r: any, c: Cond) => {
    if (c.status.length && !c.status.includes(statusLabel(r))) return false;
    if (c.purpose.length && !c.purpose.includes(purposeLabel(r))) return false;
    if (c.partner.length && !c.partner.includes(r.counterparty_name || "")) return false;
    if (!amountHit(Number(r.amount || 0), c.min, c.max)) return false;
    return true;
  };
  const filteredReceipts = useMemo(() => (receipts as any[]).filter((r) => rowHit(r, live) &&
    quickSearchHit(q, [r.counterparty_name, r.approval_number, r.identity_number, r.counterparty_bizno, r.memo], [Number(r.amount || 0), Number(r.supply_amount || 0)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipts, live, q]);
  const previewCount = (receipts as any[]).filter((r) => rowHit(r, draft)).length;
  const displayReceipts = useMemo(() => {
    const val = (r: any) => {
      switch (sort.key) {
        case "counterparty_name": return r.counterparty_name || "";
        case "amount": return Number(r.amount || 0);
        case "supply_amount": return Number(r.supply_amount || 0);
        case "tax_amount": return Number(r.tax_amount || 0);
        case "purpose": return purposeLabel(r);
        case "status": return statusLabel(r);
        default: return r.issue_date || "";
      }
    };
    const arr = [...filteredReceipts];
    arr.sort((a: any, b: any) => {
      const c = cmp(val(a), val(b));
      return (sort.dir === "asc" ? c : -c) || String(b.issue_date || "").localeCompare(String(a.issue_date || ""));
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredReceipts, sort]);
  const pager = usePager(displayReceipts, live.rows, `${tab}|${startDate}|${endDate}|${q}|${JSON.stringify(live)}`);
  const statusOpts = useMemo(() => [...new Set((receipts as any[]).map(statusLabel))].map((v) => ({ value: v, label: v })), [receipts]);
  const purposeOpts = useMemo(() => [...new Set((receipts as any[]).map(purposeLabel).filter(Boolean))].map((v) => ({ value: v, label: v })), [receipts]);
  const partnerOpts = useMemo(() => [...new Set((receipts as any[]).map((r) => r.counterparty_name).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })), [receipts]);
  //   내 조건 — ★ 하나가 이 화면의 기본값
  const saved = useSavedQueries("cash-receipts", companyId);
  const paramsNow = { tab, from: startDate, to: endDate, q, cond: live };
  const paramsBasic = { tab: "income", ...defaultRange(), q: "", cond: EMPTY_COND };
  const applySaved = (p: Record<string, unknown>) => {
    if (p.tab === "income" || p.tab === "expense") setTab(p.tab);
    if (typeof p.from === "string" && typeof p.to === "string") { setStartDate(p.from); setEndDate(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY_COND, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => [draft.partner[0], draft.status.join("·"), draft.purpose.join("·"), (draft.min || draft.max) ? "금액" : "", tab === "income" ? "매출" : "매입"].filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  const dropCond = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...live.status.map((v) => ({ group: "상태", label: v, onRemove: () => dropCond({ status: live.status.filter((x) => x !== v) }) })),
    ...live.purpose.map((v) => ({ group: "용도", label: v, onRemove: () => dropCond({ purpose: live.purpose.filter((x) => x !== v) }) })),
    ...live.partner.map((v) => ({ group: "거래처", label: v, onRemove: () => dropCond({ partner: live.partner.filter((x) => x !== v) }) })),
    ...((live.min || live.max) ? [{ group: "금액", label: `${Number(live.min || 0).toLocaleString("ko")} ~ ${live.max ? Number(live.max).toLocaleString("ko") : "제한없음"}`, onRemove: () => dropCond({ min: "", max: "" }) }] : []),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY_COND); setDraft(EMPTY_COND); };
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // ─── 체크박스 다중선택 + 일괄 전표처리 (post_cash_voucher) ───
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkPost, setShowBulkPost] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [bulkPosting, setBulkPosting] = useState(false);
  // 탭·기간 변경 시 선택 초기화
  useEffect(() => { setSelectedIds(new Set()); }, [tab, startDate, endDate]);

  //   고를 수 없는 건 = 이미 전표가 있거나, **없던 일이 된 건**(우리가 취소·무효 처리 → sign 0).
  //   홈택스 취소거래는 원본을 깎는 **마이너스 전표**가 필요하므로 고를 수 있다. (2026-08-12)
  //   post_cash_voucher 도 같은 기준으로 판정한다(sign 0 이면 CANCELLED_RECEIPT).
  const isPosted = (r: any) => !!r.journal_entry_id || cashReceiptSign(r) === 0;
  const selectableReceipts = displayReceipts.filter((r: any) => !isPosted(r));
  const selectedReceipts = selectableReceipts.filter((r: any) => selectedIds.has(r.id));
  const allSelected = selectableReceipts.length > 0 && selectableReceipts.every((r: any) => selectedIds.has(r.id));
  const someSelected = selectableReceipts.some((r: any) => selectedIds.has(r.id)) && !allSelected;
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (selectableReceipts.every((r: any) => prev.has(r.id))) return new Set();
      return new Set(selectableReceipts.map((r: any) => r.id));
    });
  };

  // 전표처리용 계정과목
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["cash-receipt-coa-accounts", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('cash-receipts/page:data', await db.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId ?? "").order("code"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  const doBulkPost = async () => {
    if (!bulkAccountId || bulkPosting) { if (!bulkAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkPosting(true);
    const db = supabase;
    let ok = 0, fail = 0, skip = 0;
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        const r = (receipts as any[]).find((x) => x.id === id);
        if (!r || isPosted(r)) { skip++; continue; }
        const { error } = await db.rpc("post_cash_voucher", { p_cash_receipt_id: id, p_account_id: bulkAccountId, p_remember: false });
        if (error) fail++; else ok++;
      }
      toast(`${ok}건 전표처리 완료${fail > 0 ? ` · ${fail}건 실패` : ""}${skip > 0 ? ` · ${skip}건 건너뜀` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkPost(false); setBulkAccountId(""); setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
    } finally { setBulkPosting(false); }
  };

  // Summary
  const { data: summary } = useQuery({
    queryKey: ["cash-receipt-summary", companyId, startDate, endDate],
    queryFn: () => getCashReceiptSummary(companyId!, startDate, endDate),
    enabled: !!companyId,
  });

  // 요금제별 현금영수증 국세청 발행 월간 한도 (프로=10건, 울트라=무제한)
  const { data: issuanceStatus } = useQuery({
    queryKey: ["cashbill-issuance-status", companyId],
    queryFn: () => getCashReceiptIssuanceStatus(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const issuanceLimitReached = !!issuanceStatus && issuanceStatus.limit !== null && (issuanceStatus.remaining ?? 0) <= 0;

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-for-cash", companyId],
    queryFn: async () => {
      const data = logRead('cash-receipts/page:data', await supabase
        .from("partners")
        .select("id, name, business_number")
        .eq("company_id", companyId!)
        .order("name"));
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
      const db = supabase;
      const data = logRead('cash-receipts/page:data', await db
        .from("hometax_sync_jobs")
        .select("id, status, updated_at")
        .eq("company_id", companyId ?? "")
        .eq("job_type", "cash_receipt")
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1));
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // active job polling — Realtime 보조.
  const { data: activeJob } = useQuery({
    queryKey: ["cashreceipt-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const db = supabase;
      const data = logRead('cash-receipts/page:data', await db
        .from("hometax_sync_jobs")
        .select("*")
        .eq("id", activeJobId)
        .maybeSingle());
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,
  });

  // Realtime 구독.
  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const db = supabase;
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
            toast(`동기화 실패: ${e?.hint || friendlyError(e, "알 수 없는 오류")}`, "error");
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
      return;
    }
    // 30분+ 진척 없으면 hang(CF-12200 등) 으로 간주 → 자동 해제해 버튼 잠금 풀기
    const upd = activeJob.updated_at ? new Date(activeJob.updated_at).getTime() : 0;
    if (upd && Date.now() - upd > 30 * 60 * 1000) { void forceClearStuckJob(activeJobId, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, activeJobId, queryClient]);

  const startSync = async () => {
    if (!companyId || syncStarting || activeJobId) return;
    if (startDate > endDate) {
      toast("시작일이 종료일보다 이전이어야 합니다", "error");
      return;
    }
    // 홈택스 연동 일시정지 중이면 시작하지 않음 (2026-07-30 — 세금계산서 탭 정지 버튼과 연동)
    const { getHometaxPausedUntil } = await import("@/lib/data-sync");
    const hometaxPaused = await getHometaxPausedUntil(companyId);
    if (hometaxPaused) {
      const t = new Date(hometaxPaused).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      toast(`홈택스 연동 일시정지 중 (${t}까지) — 세금계산서 화면의 정지 해제 후 다시 시도하세요.`, "info");
      return;
    }
    setSyncStarting(true);
    try {
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

  // 홈택스 매입 현금영수증 가져오기 — CODEF 매입내역 API(cashbill-purchase-sync 엣지, 동기 호출).
  //   매출 sync 와 달리 백그라운드 잡이 아니다 — 응답까지 대기 (기간이 길면 서버가 축소 재시도 안내).
  const startPurchaseSync = async () => {
    if (!companyId || purchaseSyncing) return;
    if (startDate > endDate) {
      toast("시작일이 종료일보다 이전이어야 합니다", "error");
      return;
    }
    setPurchaseSyncing(true);
    try {
      const result = await syncPurchaseCashReceipts(startDate, endDate);
      toast(result.message || `매입 ${result.inserted}건 가져오기 완료`, "success");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(friendlyError(err, "매입내역 가져오기 실패"), "error");
      if (err.hint) toast(err.hint, "info");
    } finally {
      setPurchaseSyncing(false);
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
    const isNts = receipt.source === "codef";
    const { ok } = await confirmDialog({
      title: isNts ? "현금영수증 발행취소 (국세청)" : "현금영수증 취소",
      desc: isNts
        ? `${receipt.counterparty_name || "현금영수증"} ₩${Number(receipt.amount).toLocaleString()} 을(를) 취소거래로 국세청에 신고합니다. 취소 후 되돌릴 수 없습니다.`
        : `${receipt.counterparty_name || "현금영수증"} ₩${Number(receipt.amount).toLocaleString()} 을(를) 취소합니다.`,
      confirmLabel: "취소 확정", danger: true,
    });
    if (!ok) return;
    try {
      if (isNts) {
        setNtsBusyId(receipt.id);
        const result = await cancelCashReceiptNts(receipt.id);
        toast(result.message || "발행취소 완료", "success");
        queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
        queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
        return;
      }
      await cancelCashReceipt(receipt.id);
      toast("현금영수증이 취소되었습니다", "success");
      queryClient.invalidateQueries({ queryKey: ["cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["cash-receipt-summary"] });
    } catch (err: any) {
      toast(`취소 실패: ${err.message}`, "error");
    } finally {
      setNtsBusyId(null);
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
        toast("읽을 수 있는 현금영수증이 없습니다", "error");
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
    <div className="qk-shell">
      <QueryErrorBanner error={error} />
      {/* ── 조회 화면 표준 — 탭 · 조회 줄 · 걸린 조건 · 결과 요약 · 표 · 쪽 넘김 · 확정 줄 (2026-08-18 Wave 1) ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["income", "매출 (발행)", summary?.incomeCount], ["expense", "매입 (수취)", summary?.expenseCount]] as [Tab, string, number | undefined][]).map(([t, label, n]) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={tab === t ? "collect-tab collect-tab-on" : "collect-tab"}>
                {label}{n != null && <span className="collect-tab-cnt">{n.toLocaleString()}</span>}
              </button>
            ))}
          </div>

          <QueryBar right={<>
          <ToolbarPopover label="가져오기" title="가져오기" width={230}>
            {(close) => (
              <>
                <ToolbarPopoverItem
                  onClick={() => { close(); startSync(); }}
                  disabled={syncStarting || !!activeJobId}
                  hint="조회기간 범위로 홈택스에서 현금영수증 매출(발행) 내역 가져오기">
                  <span aria-live="polite">
                    {syncStarting ? "시작 중…"
                      : activeJobId
                        ? `가져오는 중 ${(activeJob?.current_progress as any)?.done || 0}/${(activeJob?.current_progress as any)?.total || 0}`
                        : "홈택스 매출 가져오기"}
                  </span>
                </ToolbarPopoverItem>
                <ToolbarPopoverItem
                  onClick={() => { close(); startPurchaseSync(); }}
                  disabled={purchaseSyncing}
                  hint="조회기간 범위로 홈택스에서 현금영수증 매입(수취) 내역 가져오기 — 등록된 공동인증서로 조회합니다 (최근 37개월)">
                  {purchaseSyncing ? "매입 조회 중…" : "홈택스 매입 가져오기"}
                </ToolbarPopoverItem>
                <label className="toolbar-pop-item cursor-pointer">
                  {uploading ? "업로드 중…" : "엑셀 업로드"}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={(e) => { close(); handleExcelUpload(e); }} disabled={uploading} />
                </label>
                {activeJobId && (
                  <>
                    <div className="toolbar-pop-sep" />
                    <ToolbarPopoverItem danger onClick={() => { close(); forceClearStuckJob(activeJobId); }}
                      hint="백그라운드 동기화가 멈췄을 때 눌러 초기화 — 다시 시도할 수 있습니다">
                      동기화 취소
                    </ToolbarPopoverItem>
                  </>
                )}
              </>
            )}
          </ToolbarPopover>
          <button
            type="button"
            onClick={() => { setIssueForm(INITIAL_ISSUE_FORM); setShowIssueModal(true); }}
            disabled={issuanceLimitReached}
            title={issuanceLimitReached ? `이번 달 발행 한도(${issuanceStatus?.limit}건)를 모두 사용했습니다. 세금계산서와 현금영수증을 합산해 계산합니다.` : "CODEF 연동으로 현금영수증을 국세청에 실제 발행합니다"}
            className="cashbill-issue-open btn-primary btn-sm"
          >
            {issuanceLimitReached ? "발행 한도 소진" : "+ 발행"}
          </button>
          </>}>
            <DateRangeField label={null} parts="segments" from={startDate} to={endDate}
              onChange={(f, t) => { setStartDate(f); setEndDate(t); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)} anchorSel=".drf"
                  tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                    onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                    onBasic={() => { const b = defaultRange(); setTab("income"); setStartDate(b.from); setEndDate(b.to); clearAll(); }}
                    onRemove={saved.remove} onSetDefault={saved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft({ ...EMPTY_COND, rows: draft.rows })}>조건 지우기</button>
                    <ConditionSave suggest={suggestName}
                      onSave={(name, asDefault) => { saved.save(name, { tab, from: startDate, to: endDate, q, cond: draft }, asDefault); setLive(draft); setPanelOpen(false); }} />
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
                    <RowsPerPage value={draft.rows} onChange={setD("rows")} />
                    <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="조회기간" hint="홈택스 가져오기 기간이기도 합니다">
                    <span className="qk-range-txt">{startDate} ~ {endDate}</span>
                    <DateRangeField label={null} parts="calendar" confirm from={startDate} to={endDate}
                      onChange={(f, t) => { setStartDate(f); setEndDate(t); }} />
                    <span className="qk-quicks">
                      {periodQuicks().map((pq) => (
                        <button key={pq.key} type="button" onClick={() => { setStartDate(pq.from); setEndDate(pq.to); }}
                          className={startDate === pq.from && endDate === pq.to ? "qk-quick qk-quick-on" : "qk-quick"}>{pq.label}</button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="상태">
                    <span className="qk-quicks">
                      {statusOpts.map((o) => (
                        <button key={o.value} type="button" onClick={() => setD("status")(toggleIn(draft.status, o.value))}
                          className={draft.status.includes(o.value) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
                      ))}
                      {statusOpts.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">이 기간에 건이 없습니다</span>}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="용도">
                    <span className="qk-quicks">
                      {purposeOpts.map((o) => (
                        <button key={o.value} type="button" onClick={() => setD("purpose")(toggleIn(draft.purpose, o.value))}
                          className={draft.purpose.includes(o.value) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="거래처" hint="여러 곳">
                    <TokenField items={partnerOpts} value={draft.partner} onChange={setD("partner")} placeholder="거래처 이름 일부" />
                  </ConditionRow>
                  <ConditionRow label="합계 금액" hint="한쪽만 적어도 됩니다">
                    <AmountRange min={draft.min} max={draft.max} onMin={setD("min")} onMax={setD("max")} />
                  </ConditionRow>
                </ConditionPanel>
              } />
            <QuickSearch value={q} onApply={setQ} placeholder="거래처 · 승인번호 · 상대 번호 · 금액 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={clearAll} />

          <ResultStrip right={issuanceStatus ? (
            <span className="cash-receipt-issuance-badge"
              style={{
                background: issuanceLimitReached ? "color-mix(in srgb, #ef4444 12%, transparent)" : "var(--bg-surface)",
                borderColor: issuanceLimitReached ? "#ef4444" : "var(--border)",
                color: issuanceLimitReached ? "#ef4444" : "var(--text-muted)",
              }}
              title={issuanceStatus.limit !== null
                ? `${issuanceStatus.planName || "현재 요금제"} — 현금영수증은 월 ${issuanceStatus.limit}건까지 발행할 수 있습니다 (이번 달 ${issuanceStatus.used}/${issuanceStatus.limit}건 · 세금계산서 한도는 별도)`
                : `${issuanceStatus.planName || "현재 요금제"} — 현금영수증 발행 무제한 (이번 달 ${issuanceStatus.used}건 발행)`}>
              {issuanceStatus.limit !== null
                ? <>이번 달 발행 <b className="mono-number">{issuanceStatus.remaining ?? 0}건</b> 남음</>
                : <>이번 달 발행 <b className="mono-number">{issuanceStatus.used}건</b></>}
            </span>
          ) : undefined}>
            <Stat label="건수" value={`${displayReceipts.length.toLocaleString("ko")}건`} />
            <Stat label="합계" value={`₩${displayReceipts.reduce((s0: number, r: any) => s0 + cashReceiptSign(r) * Number(r.amount || 0), 0).toLocaleString()}`} />
            {summary && <>
              <Stat label={`매출 발행 ${summary.incomeCount.toLocaleString()}건`} value={`₩${summary.incomeTotal.toLocaleString()}`} />
              <Stat label={`매입 수취 ${summary.expenseCount.toLocaleString()}건`} value={`₩${summary.expenseTotal.toLocaleString()}`} />
              <Stat label="매입세액 공제" value={`₩${summary.expenseTax.toLocaleString()}`} />
            </>}
          </ResultStrip>
        </QueryHead>

        <QueryBody>
        {/* Register tab */}
        {tab === "register" && (
          <div className="cash-receipt-register-form">
            <h2 className="text-sm font-bold text-[var(--text)]">현금영수증 수동 등록</h2>

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
                <DateField
                  value={form.issueDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, issueDate: e.target.value }))
                  }
                  className="field-input"
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
                  className="field-input"
                />
                {showPartnerDropdown && filteredPartners.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-lg max-h-40 overflow-y-auto">
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
                  className="field-input"
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
                  className="field-input"
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
                  className="field-input"
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
                  className="field-input"
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !companyId}
              className="btn-primary w-full"
            >
              {saving ? "저장 중..." : "현금영수증 등록"}
            </button>
          </div>
        )}


        {tab !== "register" && (
          isLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : (receipts as any[]).length === 0 ? (
            <div className="collect-empty">
              {tab === "income"
                ? "이 기간에 매출 현금영수증이 없습니다 — 가져오기 ▾ 「홈택스 매출 가져오기」로 동기화하세요"
                : "이 기간에 매입 현금영수증이 없습니다 — 가져오기 ▾ 「홈택스 매입 가져오기」 또는 엑셀 업로드"}
            </div>
          ) : displayReceipts.length === 0 ? (
            <div className="collect-empty">이 조건에 맞는 현금영수증이 없습니다 — 검색조건을 풀어 보세요</div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table ev-lined cr-table">
                <thead>
                  <tr>
                    <th className="w-9">
                      <button type="button" aria-label="전체 선택" onClick={toggleSelectAll}
                        className={allSelected ? "collect-chk collect-chk-on" : "collect-chk"}>{allSelected ? "✓" : someSelected ? "–" : ""}</button>
                    </th>
                    {crSortTh("issue_date", "발행일")}
                    {crSortTh("counterparty_name", "거래처")}
                    {crSortTh("amount", "합계금액")}
                    {crSortTh("supply_amount", "공급가액")}
                    {crSortTh("tax_amount", "세액")}
                    {crSortTh("purpose", "용도")}
                    {crSortTh("status", "상태")}
                    <SortableTh label="작업" />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((r: any) => {
                    const st = STATUS_LABELS[r.status] || STATUS_LABELS.issued;
                    //   홈택스 취소거래는 원본을 깎는 **마이너스 건**이라 부호를 뒤집어 보여 준다.
                    //   우리가 취소·무효 처리한 건은 원 금액 그대로 보여 주되(발행 원장이므로)
                    //   아래 합계에서만 뺀다 — 상태 배지가 이미 '취소'/'무효'라고 말한다. (2026-08-12)
                    const neg = cashReceiptSign(r) === -1;
                    const amtCls = neg ? " text-[var(--danger)]" : "";
                    const show = (v: unknown) => (neg ? -Number(v || 0) : Number(v || 0)).toLocaleString();
                    const posted = !!r.journal_entry_id;
                    const selectable = !isPosted(r);
                    const checked = selectedIds.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        className={checked ? "cash-receipt-row ev-on" : "cash-receipt-row"}
                      >
                        <td>
                          {selectable ? (
                            <button type="button" onClick={() => toggleSelect(r.id)} aria-label="선택"
                              className={checked ? "collect-chk collect-chk-on" : "collect-chk"}>{checked ? "✓" : ""}</button>
                          ) : <span className="text-[9px] text-emerald-500 font-semibold" title="전표처리됨 또는 없던 일이 된 건">{posted ? "전표" : "—"}</span>}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)] mono-number whitespace-nowrap">
                          {r.issue_date}
                          {posted && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-500">전표</span>}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium text-[var(--text)]">
                          {r.counterparty_name || "—"}
                          {r.approval_number && (
                            <span className="ml-2 text-[10px] text-[var(--text-dim)]">
                              #{r.approval_number}
                            </span>
                          )}
                        </td>
                        <td className={`px-5 py-3 text-sm text-right font-semibold mono-number${amtCls}`}>
                          ₩{show(r.amount)}
                        </td>
                        <td className={`px-5 py-3 text-xs text-right mono-number${amtCls || " text-[var(--text-muted)]"}`}>
                          ₩{show(r.supply_amount)}
                        </td>
                        <td className={`px-5 py-3 text-xs text-right mono-number${amtCls || " text-[var(--text-muted)]"}`}>
                          ₩{show(r.tax_amount)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-surface)] border border-[var(--border)]/60 text-[var(--text-muted)] whitespace-nowrap">
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
                          {r.source === "codef" && r.status === "issued" && (
                            <div className={`mt-1 text-[9px] font-semibold ${
                              r.nts_state_code === "304" ? "text-emerald-500"
                                : r.nts_state_code === "305" ? "text-red-400"
                                : "text-[var(--text-dim)]"
                            }`}>
                              {r.nts_state_code === "304" ? "국세청 전송완료"
                                : r.nts_state_code === "305" ? "국세청 전송실패"
                                : "국세청 전송대기"}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-center whitespace-nowrap">
                          {r.source === "codef" && r.status === "issued" && !r.approval_number && (
                            <button
                              onClick={() => handleNtsRefresh(r)}
                              disabled={ntsBusyId === r.id}
                              className="mr-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition disabled:opacity-50"
                              title="국세청 승인번호는 발행 당일 밤 24시 일괄 전송 후 부여됩니다"
                            >
                              {ntsBusyId === r.id ? "조회 중..." : "승인번호 조회"}
                            </button>
                          )}
                          {r.status === "issued" && (
                            <button
                              onClick={() => handleCancel(r)}
                              disabled={ntsBusyId === r.id}
                              className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition disabled:opacity-50"
                            >
                              {r.source === "codef" ? "발행취소" : "취소"}
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
                      colSpan={3}
                      className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]"
                    >
                      합계 ({displayReceipts.length}건)
                    </td>
                    {/*   취소거래는 빼는 게 아니라 **마이너스로 더한다** — 빼면 원본 발행 건만 남아
                          매출이 부풀어 오른다. 우리가 취소·무효한 건은 0 이라 안 셈. (2026-08-12) */}
                    <td className="px-5 py-3 text-sm text-right font-bold mono-number">
                      ₩
                      {displayReceipts
                        .reduce(
                          (s, r) => s + cashReceiptSign(r) * Number(r.amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)] mono-number">
                      ₩
                      {displayReceipts
                        .reduce(
                          (s, r) => s + cashReceiptSign(r) * Number(r.supply_amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)] mono-number">
                      ₩
                      {displayReceipts
                        .reduce(
                          (s, r) => s + cashReceiptSign(r) * Number(r.tax_amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}

          {/* ── 3줄 · 고른 건으로 하는 일 — 파란(확정) 버튼은 여기 하나 ── */}
          {tab !== "register" && (
            <SelectionBar count={selectedReceipts.length} onClear={() => setSelectedIds(new Set())}
              summary={<>합계 <b className="mono-number">₩{selectedReceipts.reduce((s0: number, r: any) => s0 + cashReceiptSign(r) * Number(r.amount || 0), 0).toLocaleString()}</b></>}>
              <button type="button" onClick={() => { setBulkAccountId(""); setShowBulkPost(true); }} className="btn-primary btn-sm">
                전표처리 ({selectedReceipts.length})
              </button>
            </SelectionBar>
          )}
        </QueryBody>

        <Pager page={pager.page} pages={pager.pages} total={displayReceipts.length} size={live.rows}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>

      {/* 국세청 실발행 모달 — CODEF·팝빌 연동 즉시발행 */}
      {showIssueModal && (
        <div className="cash-receipt-issue-modal fixed inset-0 cashbill-issue-modal">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">현금영수증 국세청 발행</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">발행 즉시 효력이 생기며, 당일 밤 24시에 국세청으로 일괄 전송됩니다. 승인번호는 전송 후 부여됩니다. 홈택스 가맹점 신청을 따로 하지 않았어도 괜찮습니다 — 최초 발행 시 공인 발급사업자 등록이 자동 진행됩니다. 단, 설정 → 회사 정보에 상호·대표자·주소·전화·업태·종목이 입력돼 있어야 하며, 등록에 문제가 있으면 발행 실패 안내에 사유가 표시됩니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                {([["income_deduction", "소득공제 (개인)"], ["expenditure_proof", "지출증빙 (사업자)"]] as const).map(([v, label]) => (
                  <button key={v} type="button"
                    onClick={() => setIssueForm((f) => ({ ...f, purpose: v, identityType: v === "income_deduction" ? "phone" : "bizno", identityNumber: "" }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold transition ${issueForm.purpose === v ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">합계금액 (VAT포함) *</label>
                <CurrencyInput
                  value={issueForm.amount}
                  onValueChange={(raw) => setIssueForm((f) => ({ ...f, amount: raw }))}
                  placeholder="110,000"
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-right font-mono focus:outline-none focus:border-[var(--primary)]"
                />
                {issueForm.amount && Number(issueForm.amount) > 0 && issueForm.taxationType === "과세" && (
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">
                    공급가액 ₩{Math.round(Number(issueForm.amount) / 1.1).toLocaleString()} / 부가세 ₩{(Number(issueForm.amount) - Math.round(Number(issueForm.amount) / 1.1)).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">과세형태</label>
                  <select value={issueForm.taxationType} onChange={(e) => setIssueForm((f) => ({ ...f, taxationType: e.target.value as any }))} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                    <option value="과세">과세</option>
                    <option value="비과세">비과세</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">식별번호 유형</label>
                  <select value={issueForm.identityType} onChange={(e) => setIssueForm((f) => ({ ...f, identityType: e.target.value as any }))} className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                    <option value="phone">휴대폰번호</option>
                    <option value="bizno">사업자번호</option>
                    <option value="card">카드번호</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  식별번호 * {issueForm.purpose === "income_deduction" ? "(소비자 휴대폰/카드번호)" : "(거래처 사업자번호)"}
                </label>
                <input value={issueForm.identityNumber}
                  onChange={(e) => setIssueForm((f) => ({ ...f, identityNumber: e.target.value }))}
                  placeholder={issueForm.purpose === "income_deduction" ? "010-0000-0000" : "000-00-00000"}
                  className="field-input" />
                {issueForm.purpose === "income_deduction" && (
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">자진발급(번호 미확보 소비자)은 010-000-1234 입력</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{issueForm.purpose === "income_deduction" ? "고객명" : "거래처명"}</label>
                  <input value={issueForm.counterpartyName} onChange={(e) => setIssueForm((f) => ({ ...f, counterpartyName: e.target.value }))} placeholder="선택" className="field-input" />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">상품명</label>
                  <input value={issueForm.itemName} onChange={(e) => setIssueForm((f) => ({ ...f, itemName: e.target.value }))} placeholder="선택" className="field-input" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">메모</label>
                <input value={issueForm.memo} onChange={(e) => setIssueForm((f) => ({ ...f, memo: e.target.value }))} placeholder="관리용 메모 (선택)" className="field-input" />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowIssueModal(false)} disabled={issuing} className="btn-ghost text-xs">닫기</button>
              <button onClick={handleNtsIssue} disabled={issuing} className="btn-primary text-xs">
                {issuing ? "발행 중..." : "국세청 발행"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 전표처리 모달 — 선택된 미처리 현금영수증을 계정 1개로 일괄 생성 */}
      {showBulkPost && (
        <div className="cash-receipt-bulk-post-modal fixed inset-0" onClick={() => setShowBulkPost(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedReceipts.length}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
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
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">차) 선택 계정 / 대) 보통예금 으로 각 건 전표가 생성됩니다. 현금영수증 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
              {/*   취소거래를 같이 골랐으면 무슨 일이 일어나는지 미리 말해 준다 (2026-08-12) */}
              {selectedReceipts.some((r: any) => cashReceiptSign(r) === -1) && (
                <p className="text-[10px] text-[var(--warning)] leading-relaxed">
                  취소거래 {selectedReceipts.filter((r: any) => cashReceiptSign(r) === -1).length}건은 <b>반대 분개</b>(마이너스 전표)로 만들어져 원래 발행 건을 깎습니다.
                </p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkPost(false)} className="btn-ghost text-xs">취소</button>
              <button onClick={doBulkPost} disabled={bulkPosting || !bulkAccountId}
                className="btn-primary text-xs">
                {bulkPosting ? "처리 중..." : `${selectedReceipts.length}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmElement}
    </div>
  );
}

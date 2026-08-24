"use client";
import { todayKst, kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

import { useEffect, useState } from "react";
import { SortableTh } from "@/components/sortable-th";
import { SelectionBar, QueryScreen, QueryHead, QueryBody, Stat, ConditionPanel, ConditionRow, AppliedChips } from "@/components/query-kit";
import { SlotHead } from "@/components/slot-head";
import { useRouter } from "next/navigation";
import { DateField } from "@/components/date-field";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getPaymentQueue, getBankAccounts } from "@/lib/queries";
import { approvePayment, rejectPayment, executePayment, createQueueEntry, getPaymentQueueStats } from "@/lib/payment-queue";
import { getRecurringPayments, upsertRecurringPayment, deleteRecurringPayment, getPaymentBatches, refreshRecurringAmounts, stripInternalTag, type RefreshResult } from "@/lib/approval-center";
import { createFixedCostBatch, approveBatch, triggerBatchExecution, getBatchWithItems, type BatchSummary } from "@/lib/payment-batch";
import { runAllAutomation, type AutomationResult } from "@/lib/automation";
import { detectRecurringFromBankTx, registerDetectedRecurring, type DetectedRecurring, listRecurringDismissals, dismissRecurringCandidate, dismissRecurringCandidates, recurringMatchKey } from "@/lib/smart-setup";
import { SubscriptionsPanel } from "@/components/subscriptions-panel"; // 구독 흡수(2026-07-08)
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useMyPermissions } from "@/lib/permissions";
import { useConfirm } from "@/components/confirm-dialog";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useCanAccessTab } from "@/lib/tab-access";
import { supabase } from "@/lib/supabase";
import { useModalKeys } from "@/hooks/use-modal-keys";

// 2026-07-08 "정기 지출" 재편 — 자동 추천을 첫 화면으로. 지출결의→결재관리, 급여→인사, 구독 흡수(구독 탭).
type Tab = 'recommend' | 'recurring' | 'subscriptions' | 'fixed' | 'queue';

export default function PaymentsPage() {
  const { role } = useUser();
  const router = useRouter();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/payments");
  // 이관된 탭의 옛 딥링크 리다이렉트 — 지출결의→결재관리, 급여 일괄→인사(급여)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'expenses') router.replace('/approvals');
    else if (t === 'payroll') router.replace('/employees?tab=salary');
  }, [router]);
  // 권한 게이트에서 early return 한 뒤에 나머지 훅들이 이어지면 tabLoading 이 풀리는 순간
  // 렌더당 훅 개수가 달라져 React #310 크래시 — 본문을 별도 컴포넌트로 분리 (2026-08-03).
  if (tabLoading) return null;
  if (!tabAllowed) {
    return <AccessDenied detail="정기 지출 접근 권한이 없습니다. 마스터에게 권한을 요청하세요." />;
  }
  return <PaymentsPageInner />;
}

function PaymentsPageInner() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  //   ★ 첫 화면은 **메뉴 이름과 같은 것**(정기결제 목록)이다 (2026-08-12 UI 정리).
  //     예전 기본은 '자동 추천'이라, '정기 지출'을 누르면 정기 지출이 아니라 자동화 도구가 떴다.
  //     자동 추천은 없애지 않고 탭 맨 뒤 + 처리할 것 띠로 옮겼다.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'recurring';
    const t = new URLSearchParams(window.location.search).get('tab');
    const valid: Tab[] = ['recommend', 'recurring', 'subscriptions', 'fixed', 'queue'];
    return (valid as string[]).includes(t || '') ? (t as Tab) : 'recurring';
  });
  const [filter, setFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", description: "" });
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    }).finally(() => setIsInitLoading(false));
  }, []);

  const [isInitLoading, setIsInitLoading] = useState(true);

  const { data: queue = [], error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["payment-queue", companyId],
    queryFn: () => getPaymentQueue(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-queue"] });
    queryClient.invalidateQueries({ queryKey: ["payment-stats"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
    queryClient.invalidateQueries({ queryKey: ["detected-recurring"] });
  };

  //   본체(정기결제·구독·고정비·결제 내역)가 앞, 도구(자동 추천)가 뒤 (2026-08-12)
  //   띠에 쓸 건수 — 아직 등록 안 된 반복 지출만 센다. (자동 추천 패널이 쓰는 것과 같은 쿼리키라
  //   한 번만 받아 두 곳이 나눠 쓴다)
  const { data: detectedAll = [] } = useQuery({
    queryKey: ["detected-recurring", companyId],
    queryFn: () => detectRecurringFromBankTx(companyId!),
    enabled: !!companyId, staleTime: 60_000,
  });
  //   치운 후보(회사 공통)도 빼야 띠 숫자와 자동 추천 목록 건수가 같아진다.
  //   ★ 2026-08-24 사장님 지적 전에는 이 띠가 치운 것을 안 뺐다 — "처리할 것 5건"인데 열면 2건이었다.
  const { data: dismissedKeys } = useQuery({
    queryKey: ["recurring-dismissals", companyId],
    queryFn: () => listRecurringDismissals(companyId!),
    enabled: !!companyId, staleTime: 60_000,
  });
  const detectedCount = (detectedAll as any[]).filter((d: any) =>
    !d.alreadyRegistered && !(dismissedKeys?.has(recurringMatchKey(d.counterparty, d.amount)))).length;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'recurring', label: '정기결제' },
    { key: 'subscriptions', label: '구독' },
    { key: 'fixed', label: '고정비' },
    { key: 'queue', label: '결제 내역' },
    { key: 'recommend', label: '자동 추천' },
  ];

  if (isInitLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (mainError) return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;

  return (
    <div className="qk-shell pay-page">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* 조회 화면 표준 상자 (2026-08-19 자금 메뉴 확산) — 갈래 탭은 상자 안 맨 위 파란 밑줄, 갈래마다 조회 줄·결과 요약은 SlotHead 로 #pay-head-slot 에,
          본문만 스크롤. 예전엔 탭 상자 따로 + 제목·버튼이 상자 밖 + 큰 빈 카드 (사장님 2026-08-19 점검) */}
      <QueryScreen>
      <QueryHead>
        <div className="collect-tabs no-print">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
              {t.label}
            </button>
          ))}
        </div>
        <div id="pay-head-slot" />
      </QueryHead>
      <QueryBody>
      <div className="pay-scroll">

      {/* 처리할 것 — 통장에서 새로 잡힌 반복 지출이 있으면 본체 화면 위에서 알려 주고,
          누르면 자동 추천 탭으로 보낸다. 예전엔 이게 첫 화면 자체였다 (2026-08-12) */}
      {/* ⚠️ 정기결제 탭에는 이미 같은 내용의 파란 배너(전체 자동등록 버튼 포함)가 있다 —
          거기서는 띠를 빼야 같은 말이 두 번 안 나온다. 화면에서 보고 잡았다. */}
      {tab !== 'recommend' && tab !== 'recurring' && detectedCount > 0 && (
        <button type="button" onClick={() => setTab('recommend')} className="payments-todo-band">
          <b>처리할 것 {detectedCount.toLocaleString()}건</b>
          <span>통장에서 새로 잡힌 반복 지출 — 한 번에 검토</span>
          <span className="payments-todo-go">보러 가기 →</span>
        </button>
      )}

      {/* 자동 추천 (도구) — 통장·카드에서 2개월↑ 반복거래(동일 거래처·금액) 감지 → 정기결제 등록 추천 */}
      {tab === 'recommend' && companyId && (
        <SmartSetupBanner companyId={companyId} userId={userId} invalidate={invalidate} onRegistered={() => setTab('recurring')} />
      )}
      {tab === 'recurring' && companyId && (
        <RecurringPaymentsTab companyId={companyId} invalidate={invalidate} />
      )}
      {tab === 'subscriptions' && (
        <SubscriptionsPanel />
      )}
      {tab === 'fixed' && companyId && userId && (
        <FixedCostBatchTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === 'queue' && companyId && userId && (
        <PaymentQueueTab companyId={companyId} userId={userId} filter={filter} setFilter={setFilter}
          showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} invalidate={invalidate} />
      )}
      </div>
      </QueryBody>
      </QueryScreen>
    </div>
  );
}

// ── Tab 1: Payment Queue (기존) ──

function PaymentQueueTab({ companyId, userId, filter, setFilter, showForm, setShowForm, form, setForm, invalidate }: {
  companyId: string; userId: string; filter: string; setFilter: (f: string) => void;
  showForm: boolean; setShowForm: (s: boolean) => void;
  form: { amount: string; description: string }; setForm: (f: { amount: string; description: string }) => void;
  invalidate: () => void;
}) {
  const { data: queue = [] } = useQuery({
    queryKey: ["payment-queue", companyId],
    queryFn: () => getPaymentQueue(companyId),
    enabled: !!companyId,
  });

  const { data: stats } = useQuery({
    queryKey: ["payment-stats", companyId],
    queryFn: () => getPaymentQueueStats(companyId),
    enabled: !!companyId,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId),
    enabled: !!companyId,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 });
  const { toast: queueToast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const [receiptItem, setReceiptItem] = useState<any | null>(null);
  const [refundItem, setRefundItem] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundStep, setRefundStep] = useState<1 | 2>(1);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  function printReceipt() {
    const el = document.getElementById('receipt-printable');
    if (!el) return;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) { queueToast('팝업이 차단되었습니다. 팝업을 허용해주세요.', 'error'); return; }
    w.document.write(`<html><head><title>영수증</title><style>body{font-family:sans-serif;padding:20px;color:#000}.row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}.hr{border-top:1px solid #ccc;margin:12px 0}.center{text-align:center;margin-bottom:16px}.big{font-size:22px;font-weight:900}</style></head><body onload="window.print();window.close()">${el.innerHTML.replace(/var\(--[^)]+\)/g, '#333').replace(/text-\w+-\d+/g, '')}</body></html>`);
    w.document.close();
  }

  useModalKeys(!!receiptItem, () => setReceiptItem(null), printReceipt);
  useModalKeys(!!refundItem, () => { if (!refundSubmitting) setRefundItem(null); }, () => {
    if (refundSubmitting) return;
    if (refundStep === 1) { if (refundReason.trim()) setRefundStep(2); }
    else submitRefund();
  });

  async function submitRefund() {
    if (!refundItem || !refundReason.trim() || !userId) return;
    setRefundSubmitting(true);
    try {
      const db: any = supabase;
      const { error } = await db.from('payment_queue').update({
        status: 'refunded',
        refund_reason: refundReason.trim(),
        refunded_at: new Date().toISOString(),
        refunded_by: userId,
      }).eq('id', refundItem.id);
      if (error) throw error;

      // 실행 시 깎았던 통장 잔액과 프로젝트 원가 상태를 되돌린다 (2026-08-21 감사) —
      //   종전엔 상태만 'refunded' 로 바꿔서, 통장 총 잔고는 환불액만큼 계속 적게 나오고
      //   프로젝트 원가에는 지급 완료로 계속 잡혔다.
      const wasExecuted = ['completed', 'paid', 'executed'].includes(String(refundItem.status));
      if (wasExecuted) {
        if (refundItem.bank_account_id) {
          const { data: bank } = await db.from('bank_accounts').select('balance').eq('id', refundItem.bank_account_id).maybeSingle();
          if (bank) {
            const { error: balErr } = await db.from('bank_accounts')
              .update({ balance: Number(bank.balance || 0) + Number(refundItem.amount || 0) })
              .eq('id', refundItem.bank_account_id);
            if (balErr) throw balErr;
          }
        }
        if (refundItem.cost_schedule_id) {
          const { error: csErr } = await db.from('deal_cost_schedule')
            .update({ status: 'pending', approved: false, approved_at: null })
            .eq('id', refundItem.cost_schedule_id);
          if (csErr) throw csErr;
        }
      }
      await db.from('audit_logs').insert({
        company_id: companyId,
        user_id: userId,
        action: 'update',
        entity_type: 'payment',
        entity_id: refundItem.id,
        metadata: { action: 'refund', reason: refundReason.trim(), amount: refundItem.amount, entity_name: stripInternalTag(refundItem.description) || '결제' },
        created_at: new Date().toISOString(),
      });
      queueToast(`₩${Number(refundItem.amount).toLocaleString()} 환불 처리되었습니다`, 'success');
      setRefundItem(null);
      setRefundReason("");
      setRefundStep(1);
      invalidate();
    } catch (e: any) {
      queueToast('환불 처리 실패: ' + (e.message || '알 수 없는 오류'), 'error');
    } finally {
      setRefundSubmitting(false);
    }
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => approvePayment(id, userId),
    onSuccess: (result) => {
      invalidate();
      if (result && typeof result === 'object') {
        if (result.autoExecuted) queueToast("승인 + 자동이체 완료", "success");
        else if (result.notified) queueToast("승인됨 — 한도 초과로 대표 텔레그램 승인 요청 전송", "info");
        else if (result.error) queueToast("승인됨 (자동이체 실패: " + result.error + ")", "info");
        else queueToast("승인되었습니다", "success");
      } else {
        queueToast("승인되었습니다", "success");
      }
    },
    onError: (err: Error) => { queueToast("승인 실패: " + (err?.message || ""), "error"); },
  });
  const rejectMut = useMutation({ mutationFn: (id: string) => rejectPayment(id, userId), onSuccess: () => { invalidate(); queueToast("거부되었습니다", "success"); }, onError: (err: Error) => { queueToast("거부 실패: " + (err?.message || ""), "error"); } });
  const executeMut = useMutation({ mutationFn: (id: string) => executePayment(id), onSuccess: () => { invalidate(); queueToast("실행 완료", "success"); }, onError: (err: Error) => { queueToast("실행 실패: " + (err?.message || ""), "error"); } });
  const createMut = useMutation({
    mutationFn: () => createQueueEntry({ companyId, amount: Number(form.amount), description: form.description }),
    onSuccess: () => { invalidate(); setShowForm(false); setForm({ amount: "", description: "" }); queueToast("결제가 등록되었습니다", "success"); },
    onError: (err: Error) => { queueToast("등록 실패: " + (err?.message || ""), "error"); },
  });

  // 'executed' and legacy 'completed' are treated as the same bucket in filter and stats.
  //   상태 필터 — 검색조건 패널(다중, 쉼표로 이어 든다). 'all' 또는 '' 이면 전체 (2026-08-19 조회 표준: 값 필터는 검색조건)
  const filterSet = filter === "all" || !filter ? [] : filter.split(",");
  const filtered = filterSet.length === 0
    ? queue
    : queue.filter((q: any) => filterSet.includes(q.status === 'completed' ? 'executed' : q.status));
  const [statusPanel, setStatusPanel] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string[]>([]);
  //   'failed'(실행 실패) 를 필터에도 넣는다 — 없으면 실패 건만 따로 볼 방법이 없다 (2026-08-21)
  const STATUS_OPTS: [string, string][] = [["pending", "승인대기"], ["approved", "승인완료"], ["executed", "실행완료"], ["failed", "실행실패"], ["refunded", "환불"], ["rejected", "거부"]];

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllSelectable() {
    const selectable = filtered.filter((q: any) => q.status === 'pending' || q.status === 'approved').map((q: any) => q.id);
    setSelectedIds(prev => {
      const allSelected = selectable.length > 0 && selectable.every((id: string) => prev.has(id));
      return allSelected ? new Set() : new Set(selectable);
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function runBulk(action: 'approve' | 'reject' | 'execute') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // 액션별로 가능한 항목만 필터
    const candidates = filtered.filter((q: any) => {
      if (!selectedIds.has(q.id)) return false;
      if (action === 'approve' || action === 'reject') return q.status === 'pending';
      if (action === 'execute') return q.status === 'approved';
      return false;
    });
    if (candidates.length === 0) {
      queueToast(action === 'execute' ? '실행 가능한 항목이 없습니다 (승인완료 상태만 가능)' : '대기 중인 항목이 없습니다', 'info');
      return;
    }
    const verb = action === 'approve' ? '승인' : action === 'reject' ? '거부' : '실행';
    const { ok } = await confirm({ title: `일괄 ${verb}`, desc: `${candidates.length}건 ${verb}하시겠습니까?`, danger: true, confirmLabel: verb });
    if (!ok) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: candidates.length, failed: 0 });
    let failed = 0;
    // 실패 사유 보존 (2026-08-19 감사): 종전엔 catch 로 삼켜 "실패 8건"만 보이고
    //   어느 건이 왜 실패했는지(잔액 부족 등) 알 수 없었다.
    const failReasons: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      try {
        const id = candidates[i].id;
        if (action === 'approve') await approvePayment(id, userId);
        else if (action === 'reject') await rejectPayment(id, userId);
        else await executePayment(id);
      } catch (e: unknown) {
        failed++;
        const who = candidates[i].recipient_name || candidates[i].description || candidates[i].id;
        failReasons.push(`${who}: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
      }
      setBulkProgress({ done: i + 1, total: candidates.length, failed });
    }
    setBulkRunning(false);
    setSelectedIds(new Set());
    invalidate();
    const reasonNote = failReasons.length ? ` — ${failReasons.slice(0, 3).join(' · ')}${failReasons.length > 3 ? ` 외 ${failReasons.length - 3}건` : ''}` : '';
    queueToast(`${verb} 완료: ${candidates.length - failed}/${candidates.length}${failed > 0 ? ` (실패 ${failed}건)${reasonNote}` : ''}`, failed > 0 ? 'error' : 'success');
  }

  const selectableInView = filtered.filter((q: any) => q.status === 'pending' || q.status === 'approved');
  const allSelected = selectableInView.length > 0 && selectableInView.every((q: any) => selectedIds.has(q.id));
  const selectedSum = filtered.filter((q: any) => selectedIds.has(q.id)).reduce((s: number, q: any) => s + Number(q.amount || 0), 0);
  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: "승인대기", bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]" },
    approved: { label: "승인완료", bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]" },
    executed: { label: "실행완료", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
    completed: { label: "실행완료", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
    rejected: { label: "거부", bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]" },
    refunded: { label: "환불완료", bg: "bg-orange-500/10", text: "text-orange-400" },
    // 실행 실패(잔액 부족 등)는 배지 정의가 없어 '승인대기' 로 보였다 — 토스트가 사라지면
    //   실패 건을 화면에서 알 방법이 없었다 (2026-08-21 감사).
    failed: { label: "실행실패", bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]" },
  };

  return (
    <>
      {/* 조회 줄(상태 칩) ‖ 수동 결제 등록 · 결과 요약 — 상자 머리 슬롯 (2026-08-19, KPI 타일 4장 → Stat) */}
      <SlotHead slotId="pay-head-slot"
        bar={<>
          <ConditionPanel open={statusPanel} onOpenChange={(v) => { if (v) setDraftStatus(filterSet); setStatusPanel(v); }} activeCount={filterSet.length ? 1 : 0}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraftStatus([])}>기본으로</button>
              <span className="ml-auto" />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setFilter(draftStatus.length ? draftStatus.join(",") : "all"); setStatusPanel(false); }}>조회</button>
            </>}>
            <ConditionRow label="상태" hint="여러 개">
              <span className="qk-quicks">{STATUS_OPTS.map(([v, l]) => <button key={v} type="button" onClick={() => setDraftStatus((d) => d.includes(v) ? d.filter((x) => x !== v) : [...d, v])} className={draftStatus.includes(v) ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span>
            </ConditionRow>
          </ConditionPanel>
          <span className="text-[11px] text-[var(--text-dim)]">프로젝트 비용 스케줄·수동 등록에서 온 결제 건 — 승인 → 실행 순</span>
        </>}
        below={<AppliedChips chips={filterSet.length ? [{ group: "상태", label: filterSet.map((v) => STATUS_OPTS.find((o) => o[0] === v)?.[1] || v).join(" · "), onRemove: () => setFilter("all") }] : []} onClearAll={() => setFilter("all")} />}
        right={<button type="button" onClick={() => setShowForm(true)} className="btn-secondary btn-sm">+ 수동 결제 등록</button>}
        stats={<>
          <Stat label="승인 대기" value={<>{stats?.pendingCount ?? 0}건 <small className="mono-number font-normal text-[var(--text-dim)]">₩{(stats?.pendingAmount ?? 0).toLocaleString()}</small></>} tone="minus" />
          <Stat label="승인 완료" value={<>{stats?.approvedCount ?? 0}건 <small className="mono-number font-normal text-[var(--text-dim)]">₩{(stats?.approvedAmount ?? 0).toLocaleString()}</small></>} />
          <Stat label="실행 완료" value={<>{stats?.executedCount ?? 0}건 <small className="mono-number font-normal text-[var(--text-dim)]">₩{(stats?.executedAmount ?? 0).toLocaleString()}</small></>} tone="plus" />
          <Stat label="통장 총 잔고" value={<>₩{bankAccounts.reduce((s: number, a: any) => s + Number(a.balance || 0), 0).toLocaleString()} <small className="font-normal text-[var(--text-dim)]">{bankAccounts.length}개</small></>} />
        </>} />

      {showForm && (
        <div className="approval-detail-modal" onClick={() => setShowForm(false)}>
        <div className="pnl-drill pay-form-modal" onClick={(e) => e.stopPropagation()}>
          <div className="pnl-drill-head"><h3 className="text-sm font-bold">수동 결제 등록</h3><button type="button" className="btn-secondary btn-sm" onClick={() => setShowForm(false)}>닫기</button></div>
          <div className="pay-form-body">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <CurrencyInput value={form.amount} onValueChange={(raw) => setForm({ ...form, amount: raw })}
                placeholder="1000000"
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">설명</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="외주비 - A업체"
                className="field-input" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary btn-sm">취소</button>
            <button onClick={() => Number(form.amount) > 0 && createMut.mutate()}
              disabled={!form.amount || createMut.isPending}
              className="btn-primary btn-sm">등록</button>
          </div>
          </div>
        </div>
        </div>
      )}

      {/* 확정 줄 — 조회 표준 SelectionBar. 승인/거부/실행 중 파란 버튼은 '실행' 하나 */}
      <SelectionBar count={selectedIds.size} onClear={clearSelection}
        summary={<>합계 <b className="mono-number">₩{selectedSum.toLocaleString()}</b>{bulkRunning && <> · 처리 중 {bulkProgress.done}/{bulkProgress.total}{bulkProgress.failed > 0 && <span className="text-red-400"> · 실패 {bulkProgress.failed}</span>}</>}</>}>
        <button type="button" onClick={() => runBulk('reject')} disabled={bulkRunning} className="btn-secondary btn-sm text-[var(--danger)] disabled:opacity-50">일괄 거부</button>
        <button type="button" onClick={() => runBulk('approve')} disabled={bulkRunning} className="btn-secondary btn-sm disabled:opacity-50">일괄 승인</button>
        <button type="button" onClick={() => runBulk('execute')} disabled={bulkRunning} className="btn-primary btn-sm disabled:opacity-50">일괄 실행</button>
      </SelectionBar>

      {/* Queue */}
      <div className="payment-queue-table">
        {filtered.length === 0 ? (
          <div className="collect-empty">결제 내역이 없습니다 — 프로젝트 비용 스케줄에서 자동 생성되거나 위 '수동 결제 등록'으로 넣습니다</div>
        ) : (
          <div className="ev-scroll payments-scroll"><table className="ev-table ev-lined payments-table">
            <thead>
              <tr>
                <th className="w-9">
                  <button type="button" onClick={toggleAllSelectable} disabled={selectableInView.length === 0} aria-label="선택 가능 항목 전체 선택"
                    className={allSelected ? "collect-chk collect-chk-on" : "collect-chk"}>{allSelected ? "✓" : ""}</button>
                </th>
                <SortableTh label="설명" />
                <SortableTh label="금액" />
                <SortableTh label="통장" />
                <SortableTh label="상태" />
                <SortableTh label="등록일" />
                <SortableTh label="액션" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => {
                const sc = statusConfig[item.status] || statusConfig.pending;
                const selectable = item.status === 'pending' || item.status === 'approved';
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition ${isSelected ? 'bg-[var(--primary)]/5' : ''}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={isSelected} disabled={!selectable}
                        onChange={() => toggleOne(item.id)}
                        className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={selectable ? '선택' : '벌크 액션 불가 (실행/거부 완료)'} />
                    </td>
                    <td className="px-5 py-3 text-sm max-w-[240px]"><span className="block truncate" title={stripInternalTag(item.description) || undefined}>{stripInternalTag(item.description) || "—"}</span></td>
                    <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(item.amount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{item.bank_accounts?.alias || item.bank_accounts?.bank_name || "미지정"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                      {item.created_at ? kstDateStr(new Date(item.created_at)) : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {item.status === "pending" && (
                          <>
                            <button onClick={() => approveMut.mutate(item.id)} disabled={approveMut.isPending} className="btn-secondary btn-sm">승인</button>
                            <button onClick={() => rejectMut.mutate(item.id)} disabled={rejectMut.isPending} className="btn-secondary btn-sm text-[var(--danger)]">거부</button>
                          </>
                        )}
                        {item.status === "approved" && (
                          <button onClick={() => executeMut.mutate(item.id)} disabled={executeMut.isPending} className="btn-secondary btn-sm">실행</button>
                        )}
                        {item.status === "executed" && (
                          <>
                            <button onClick={() => setReceiptItem(item)} className="btn-secondary btn-sm">영수증</button>
                            <button onClick={() => { setRefundItem(item); setRefundReason(""); setRefundStep(1); }} className="btn-secondary btn-sm text-[var(--warning)]">환불</button>
                          </>
                        )}
                        {item.status === "refunded" && (
                          <button onClick={() => setReceiptItem(item)} className="btn-secondary btn-sm">영수증</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* 영수증 모달 */}
      {receiptItem && (
        <div className="payment-receipt-modal fixed inset-0" onClick={() => setReceiptItem(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div id="receipt-printable" className="p-6">
              <div className="text-center mb-4">
                <div className="text-xs text-[var(--text-dim)]">RECEIPT / 영수증</div>
                <div className="text-lg font-extrabold mt-1">오너뷰 결제 내역</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">#{receiptItem.id?.slice(0, 8).toUpperCase()}</div>
              </div>
              <div className="border-t border-b border-[var(--border)] py-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">결제일</span><span>{receiptItem.executed_at ? new Date(receiptItem.executed_at).toLocaleString('ko-KR') : (receiptItem.created_at ? new Date(receiptItem.created_at).toLocaleString('ko-KR') : '—')}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">설명</span><span className="text-right max-w-[60%]">{stripInternalTag(receiptItem.description) || '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">통장</span><span>{receiptItem.bank_accounts?.alias || receiptItem.bank_accounts?.bank_name || '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">상태</span><span className={receiptItem.status === 'refunded' ? 'text-orange-400 font-semibold' : 'text-green-400 font-semibold'}>{receiptItem.status === 'refunded' ? '환불완료' : '실행완료'}</span></div>
                {receiptItem.status === 'refunded' && receiptItem.refund_reason && (
                  <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">환불사유</span><span className="text-right max-w-[60%] text-orange-400">{receiptItem.refund_reason}</span></div>
                )}
              </div>
              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-[var(--text-dim)]">총 금액</span>
                <span className={`text-2xl font-extrabold ${receiptItem.status === 'refunded' ? 'line-through text-[var(--text-dim)]' : ''}`}>₩{Number(receiptItem.amount).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-[var(--border)]">
              <button onClick={() => setReceiptItem(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition">닫기</button>
              <button onClick={printReceipt} className="flex-1 btn-primary">PDF / 인쇄</button>
            </div>
          </div>
        </div>
      )}

      {/* 환불 모달 */}
      {refundItem && (
        <div className="refund-modal fixed inset-0">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-extrabold text-orange-400 mb-2">
                {refundStep === 1 ? '환불 요청' : '⚠️ 환불 최종 확인'}
              </h3>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                {refundStep === 1
                  ? '환불 사유를 입력하면 결제 상태가 환불 처리됩니다. (되돌릴 수 없습니다)'
                  : '한번 더 확인해주세요. 환불 후에는 상태를 되돌릴 수 없습니다.'}
              </p>
              <div className="bg-[var(--bg-surface)] rounded-xl p-3 mb-4">
                <div className="text-xs text-[var(--text-dim)] mb-1">대상</div>
                <div className="text-sm font-semibold">{stripInternalTag(refundItem.description) || '—'}</div>
                <div className="text-lg font-extrabold text-orange-400 mt-1">₩{Number(refundItem.amount).toLocaleString()}</div>
              </div>
              {refundStep === 1 ? (
                <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={3} placeholder="환불 사유 (필수) - 예: 서비스 취소, 중복결제, 고객 요청"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none mb-4" />
              ) : (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-4 shadow-sm">
                  <div className="text-xs text-[var(--text-dim)] mb-1">환불 사유</div>
                  <div className="text-sm">{refundReason}</div>
                </div>
              )}
              <div className="flex gap-2">
                <button disabled={refundSubmitting} onClick={() => { if (refundStep === 2) setRefundStep(1); else setRefundItem(null); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition disabled:opacity-50">
                  {refundStep === 2 ? '이전' : '취소'}
                </button>
                {refundStep === 1 ? (
                  <button disabled={!refundReason.trim()} onClick={() => setRefundStep(2)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700 transition disabled:opacity-50">다음</button>
                ) : (
                  <button disabled={refundSubmitting} onClick={submitRefund}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">
                    {refundSubmitting ? '처리 중...' : '환불 확정'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmElement}
    </>
  );
}


// ── Tab 3: Fixed Cost Batch ──

function FixedCostBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: batches = [] } = useQuery({
    queryKey: ["payment-batches", companyId, "fixed_cost"],
    queryFn: async () => {
      const all = await getPaymentBatches(companyId);
      return (all || []).filter((b: any) => b.batch_type === 'fixed_cost');
    },
    enabled: !!companyId,
  });

  const approveMut = useMutation({
    mutationFn: (batchId: string) => approveBatch(batchId, userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("고정비 배치가 승인되었습니다", "success"); },
    onError: (err: Error) => { toast("승인 실패: " + (err?.message || ""), "error"); },
  });

  const executeMut = useMutation({
    mutationFn: (batchId: string) => triggerBatchExecution(batchId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("이체가 실행되었습니다", "success"); },
    onError: (err: Error) => { toast("실행 실패: " + (err?.message || ""), "error"); },
  });

  async function handleGenerate() {
    setGenerating(true);
    try {
      await createFixedCostBatch(companyId);
      queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
      invalidate();
    } catch (err: any) {
      toast(friendlyError(err, '고정비 배치 생성 실패'), "error");
    }
    setGenerating(false);
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    draft: { label: '초안', color: 'text-gray-400' },
    approved: { label: '승인완료', color: 'text-blue-400' },
    executing: { label: '실행중', color: 'text-orange-400' },
    completed: { label: '완료', color: 'text-green-400' },
    failed: { label: '실패', color: 'text-red-400' },
  };

  return (
    <>
      <SlotHead slotId="pay-head-slot"
        bar={<span className="text-[11px] text-[var(--text-dim)]">반복결제(임대·보험·구독)를 달마다 배치로 묶어 → 대표 승인 → 일괄 이체</span>}
        right={<button type="button" onClick={handleGenerate} disabled={generating} className="btn-primary btn-sm">{generating ? '생성 중…' : '이번 달 고정비 배치 생성'}</button>}
        stats={<><Stat label="배치" value={`${batches.length}건`} /><Stat label="승인 대기" value={`${batches.filter((b: any) => b.status === "pending" || b.status === "draft").length}건`} /></>} />

      {selectedBatchId && (
        <BatchDetailModal
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
        />
      )}

      <div className="fixed-cost-batch-table">
        {batches.length === 0 ? (
          <div className="collect-empty">고정비 배치가 없습니다 — 반복결제를 먼저 등록하고 위에서 이번 달 배치를 만드세요</div>
        ) : (
          <div className="ev-scroll payments-scroll"><table className="ev-table ev-lined payments-table">
            <thead>
              <tr>
                <SortableTh label="배치명" />
                <SortableTh label="총액" />
                <SortableTh label="건수" />
                <SortableTh label="상태" />
                <SortableTh label="액션" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => {
                const sl = statusLabel[b.status] || statusLabel.draft;
                return (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                    className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer"
                  >
                    <td className="px-5 py-3 text-sm font-medium max-w-[240px]"><span className="block truncate" title={b.name || undefined}>{b.name}</span></td>
                    <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(b.total_amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-center">{b.item_count || 0}건</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-semibold ${sl.color}`}>{sl.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {(b.status === 'draft' || b.status === 'pending_approval') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); approveMut.mutate(b.id); }}
                            disabled={approveMut.isPending}
                            className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">승인</button>
                        )}
                        {b.status === 'approved' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); executeMut.mutate(b.id); }}
                            disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition">이체 실행</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ── 고정비 배치 상세 모달 (read-only) ──
// 계좌번호 마스킹 — 뒤 4자리만 (2026-08-19 감사: 급여 배치 상세에 직원 계좌 전체가 노출)
function maskAccount(acc?: string | null): string {
  const s = String(acc || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  return digits.length > 4 ? `••••${digits.slice(-4)}` : "••••";
}

function BatchDetailModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  // 급여 배치의 직원별 실수령액·계좌는 급여 권한자만 (2026-08-19 감사)
  const { hasPerm: batchHasPerm, isMaster: batchIsMaster } = useMyPermissions();
  const canSeeSalary = batchIsMaster || batchHasPerm("/employees:salary");
  const { data, isLoading } = useQuery({
    queryKey: ["batch-with-items", batchId],
    queryFn: () => getBatchWithItems(batchId),
    enabled: !!batchId,
  });

  useModalKeys(true, onClose);

  const batch: any = data?.batch;
  const items: any[] = data?.items || [];

  const statusLabel: Record<string, { label: string; color: string }> = {
    draft: { label: '초안', color: 'bg-gray-500/10 text-gray-400' },
    pending_approval: { label: '승인대기', color: 'bg-yellow-500/10 text-yellow-400' },
    approved: { label: '승인완료', color: 'bg-blue-500/10 text-blue-400' },
    executing: { label: '실행중', color: 'bg-orange-500/10 text-orange-400' },
    completed: { label: '완료', color: 'bg-green-500/10 text-green-400' },
    failed: { label: '실패', color: 'bg-red-500/10 text-red-400' },
  };
  const sl = batch ? (statusLabel[batch.status] || statusLabel.draft) : null;

  const categoryLabels: Record<string, string> = {
    rent: '임대료', insurance: '보험', loan: '대출상환', subscription: '구독', salary: '급여', utility: '공과금', other: '기타',
  };

  return (
    <div
      className="payment-batch-detail-modal fixed inset-0"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-2xl my-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold">{batch?.name || '배치 상세'}</h3>
            <p className="text-[11px] text-[var(--text-dim)] mt-0.5">조회 전용 — 수정하려면 반복결제 설정 탭에서 항목을 변경 후 배치 다시 생성</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : !batch ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)]">배치 정보를 불러올 수 없습니다.</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Batch summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <ReadOnlyField label="총액" value={`₩${Number(batch.total_amount || 0).toLocaleString()}`} />
              <ReadOnlyField label="건수" value={`${batch.item_count || items.length}건`} />
              <div>
                <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-1">상태</div>
                {sl && (
                  <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${sl.color}`}>{sl.label}</span>
                )}
              </div>
              <ReadOnlyField label="배치 종류" value={batch.batch_type === 'fixed_cost' ? '고정비' : (batch.batch_type === 'payroll' ? '급여' : batch.batch_type)} />
              <ReadOnlyField label="생성일" value={batch.created_at ? new Date(batch.created_at).toLocaleString('ko-KR') : '—'} />
              <ReadOnlyField label="승인자" value={batch.users?.name || '—'} />
            </div>

            {/* Items list */}
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-2">포함된 항목 ({items.length}건)</div>
              {items.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-xl">포함된 항목이 없습니다.</div>
              ) : batch?.batch_type === 'payroll' && !canSeeSalary ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-xl">
                  급여 항목 {items.length}건 · 합계 ₩{items.reduce((s, it) => s + Number(it.amount || 0), 0).toLocaleString()}
                  <div className="mt-1 text-[var(--text-dim)]">직원별 상세는 급여 권한이 있는 사용자만 볼 수 있습니다.</div>
                </div>
              ) : (
                <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] max-h-[400px] overflow-y-auto">
                  {items.map((it) => (
                    <div key={it.id} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs max-sm:flex max-sm:flex-col max-sm:items-start">
                      <div className="col-span-5">
                        <div className="font-medium text-sm">{stripInternalTag(it.description) || '(설명 없음)'}</div>
                        {it.recipient_name && (
                          <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                            {it.recipient_name}
                            {it.recipient_account && ` · ${it.recipient_bank || ''} ${maskAccount(it.recipient_account)}`}
                          </div>
                        )}
                      </div>
                      <div className="col-span-3 text-[var(--text-muted)]">
                        {it.category && <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)]">{categoryLabels[it.category] || it.category}</span>}
                      </div>
                      <div className="col-span-3 text-right font-bold text-sm">₩{Number(it.amount || 0).toLocaleString()}</div>
                      <div className="col-span-1 text-right text-[10px] text-[var(--text-dim)]">{it.status || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text)] rounded-lg text-sm font-semibold border border-[var(--border)] transition"
              >닫기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-1">{label}</div>
      <div className="text-sm font-medium px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] truncate">{value}</div>
    </div>
  );
}

// ── 반복결제 상세 모달 (read-only — 수정 form 과 같은 레이아웃, "수정" 버튼으로 편집 모드 전환) ──
function RecurringDetailModal({
  item,
  categories,
  bankAccounts,
  onClose,
  onEdit,
}: {
  item: any;
  categories: Record<string, string>;
  bankAccounts: any[];
  onClose: () => void;
  onEdit: () => void;
}) {
  useModalKeys(true, onClose, onEdit);

  const transferAccount = bankAccounts.find((a: any) => a.id === item.auto_transfer_account_id);
  const transferAccountLabel = transferAccount
    ? `${transferAccount.bank_name} ${transferAccount.alias || transferAccount.account_number}`
    : '미지정';

  return (
    <div
      className="recurring-detail-modal fixed inset-0"
      onClick={onClose}
    >
      <div
        className="glass-card w-full my-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold">{item.name}</h3>
            <p className="text-[11px] text-[var(--text-dim)] mt-0.5">조회 전용 — 수정하려면 하단의 "수정" 버튼을 누르세요.</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <ReadOnlyField label="명칭" value={item.name || '—'} />
            <ReadOnlyField label="금액" value={`₩${Number(item.amount || 0).toLocaleString()}`} />
            <ReadOnlyField label="카테고리" value={categories[item.category] || item.category || '—'} />
            <ReadOnlyField label="수취인명" value={item.recipient_name || '—'} />
            <ReadOnlyField label="계좌번호" value={item.recipient_account || '—'} />
            <ReadOnlyField label="이체일 (매월)" value={item.day_of_month ? `${item.day_of_month}일` : '25일'} />
          </div>

          <div className="bg-[var(--bg-surface)] rounded-xl p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">자동이체 설정</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ReadOnlyField label="자동이체 예약일" value={item.auto_transfer_date ? `매월 ${item.auto_transfer_date}일` : '미설정'} />
              <ReadOnlyField label="출금 계좌" value={transferAccountLabel} />
              <ReadOnlyField label="적요 (메모)" value={item.auto_transfer_memo || '—'} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <ReadOnlyField label="상태" value={item.is_active ? '활성' : '비활성'} />
            <ReadOnlyField label="등록일" value={item.created_at ? kstDateStr(new Date(item.created_at)) : '—'} />
            <ReadOnlyField label="마지막 배치 생성" value={item.last_generated_at ? new Date(item.last_generated_at).toLocaleString('ko-KR') : '—'} />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text)] rounded-lg text-sm font-semibold border border-[var(--border)] transition"
            >닫기</button>
            <button
              onClick={onEdit}
              className="btn-primary"
            >수정</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: Recurring Payments ──

function RecurringPaymentsTab({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const { toast: recurToast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId),
    enabled: !!companyId,
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25', autoTransferDate: '', autoTransferAccountId: '', autoTransferMemo: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResults, setRefreshResults] = useState<RefreshResult[] | null>(null);
  const queryClient = useQueryClient();

  const startEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      amount: String(r.amount || ''),
      category: r.category || 'rent',
      recipientName: r.recipient_name || '',
      recipientAccount: r.recipient_account || '',
      recipientBank: r.recipient_bank || '',
      dayOfMonth: String(r.day_of_month || 25),
      autoTransferDate: r.auto_transfer_date ? String(r.auto_transfer_date) : '',
      autoTransferAccountId: r.auto_transfer_account_id || '',
      autoTransferMemo: r.auto_transfer_memo || '',
    });
    setShowForm(true);
  };
  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25', autoTransferDate: '', autoTransferAccountId: '', autoTransferMemo: '' });
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRecurringPayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
      invalidate();
      recurToast("반복결제가 삭제되었습니다", "success");
    },
    onError: (err: Error) => recurToast("삭제 실패: " + (err?.message || ""), "error"),
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
  });

  const saveMut = useMutation({
    mutationFn: () => upsertRecurringPayment({
      id: editingId || undefined,
      companyId,
      name: form.name,
      amount: Number(form.amount),
      category: form.category,
      recipientName: form.recipientName || undefined,
      recipientAccount: form.recipientAccount || undefined,
      recipientBank: form.recipientBank || undefined,
      dayOfMonth: Number(form.dayOfMonth) || 25,
      isActive: true,
      autoTransferDate: form.autoTransferDate ? Number(form.autoTransferDate) : undefined,
      autoTransferAccountId: form.autoTransferAccountId || undefined,
      autoTransferMemo: form.autoTransferMemo || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
      invalidate();
      const isEdit = !!editingId;
      resetForm();
      recurToast(isEdit ? "반복결제가 수정되었습니다" : "반복결제가 등록되었습니다", "success");
    },
    onError: (err: Error) => { recurToast("저장 실패: " + (err?.message || ""), "error"); },
  });

  const toggleMut = useMutation({
    mutationFn: (item: any) => upsertRecurringPayment({
      id: item.id,
      companyId,
      name: item.name,
      amount: Number(item.amount),
      category: item.category,
      isActive: !item.is_active,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["recurring-payments"] }); recurToast("상태가 변경되었습니다", "success"); },
    onError: (err: Error) => { recurToast("상태 변경 실패: " + (err?.message || ""), "error"); },
  });

  const categories: Record<string, string> = {
    rent: '임대료', insurance: '보험', loan: '대출상환', subscription: '구독', salary: '급여', utility: '공과금', other: '기타',
  };

  const totalActive = recurring.filter((r: any) => r.is_active).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  // Get detected recurring for badge
  const { data: detected = [] } = useQuery({
    queryKey: ["detected-recurring", companyId],
    queryFn: () => detectRecurringFromBankTx(companyId),
    enabled: !!companyId,
  });
  const newDetected = detected.filter((d: DetectedRecurring) => !d.alreadyRegistered);

  return (
    <>
      {/* 조회 줄 ‖ 실행 · 결과 요약 — 상자 머리 슬롯으로 (2026-08-19). 제목 h2·큰 배너는 뺐다 */}
      <SlotHead slotId="pay-head-slot"
        bar={<span className="text-[11px] text-[var(--text-dim)]">임대료·보험·구독처럼 매달 나가는 돈을 등록해 두면 자금 전망·고정비 대조에 쓰입니다</span>}
        right={<>
          <button type="button" onClick={async () => {
              setRefreshing(true); setRefreshResults(null);
              try { const results = await refreshRecurringAmounts(companyId); setRefreshResults(results); if (results.length > 0) { queryClient.invalidateQueries({ queryKey: ["recurring-payments"] }); invalidate(); } }
              finally { setRefreshing(false); }
            }} disabled={refreshing} className="btn-secondary btn-sm">{refreshing ? '최신화 중…' : '금액 최신화'}</button>
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary btn-sm">+ 반복결제 추가</button>
        </>}
        stats={<>
          <Stat label="월 고정비 합계" value={`₩${totalActive.toLocaleString()}`} />
          <Stat label="활성" value={`${recurring.filter((r: any) => r.is_active).length}건`} />
          <Stat label="전체" value={`${recurring.length}건`} />
          {newDetected.length > 0 && <Stat label="통장에서 새로 잡힘" value={<span className="text-[var(--warning)]">{newDetected.length}건</span>} />}
        </>} />

      {/* 통장에서 잡힌 반복 지출 — 한 줄 안내 + 전체 자동등록 (검토는 자동 추천 탭에서) */}
      {newDetected.length > 0 && (
        <div className="pay-note">
          <b>통장에서 반복 지출 {newDetected.length}건이 잡혔습니다</b>
          <span>{newDetected.slice(0, 3).map((d: DetectedRecurring) => `${d.counterparty} ₩${d.amount.toLocaleString()}`).join(" · ")}{newDetected.length > 3 && ` … 외 ${newDetected.length - 3}건`}</span>
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={async () => { await registerDetectedRecurring(companyId, newDetected); queryClient.invalidateQueries({ queryKey: ["recurring-payments"] }); queryClient.invalidateQueries({ queryKey: ["detected-recurring"] }); }} className="btn-secondary btn-sm">전체 자동등록</button>
          </span>
        </div>
      )}

      {/* Refresh Results */}
      {refreshResults !== null && (
        <div className="pay-note pay-note-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              {refreshResults.length > 0
                ? `${refreshResults.length}건 금액 업데이트됨`
                : '모든 항목이 최신 상태입니다'
              }
            </div>
            <button onClick={() => setRefreshResults(null)} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">닫기</button>
          </div>
          {refreshResults.length > 0 && (
            <div className="space-y-1.5">
              {refreshResults.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      r.source === 'card' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {r.source === 'card' ? '카드' : '이체'}
                    </span>
                    <span>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-dim)] line-through">₩{r.oldAmount.toLocaleString()}</span>
                    <span className="text-[var(--text-dim)]">&rarr;</span>
                    <span className="font-bold text-green-500">₩{r.newAmount.toLocaleString()}</span>
                    <span className="caption">({r.lastTxDate})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="approval-detail-modal" onClick={resetForm}>
        <div className="pnl-drill pay-form-modal" onClick={(e) => e.stopPropagation()}>
          <div className="pnl-drill-head"><h3 className="text-sm font-bold">{editingId ? '반복결제 수정' : '반복결제 등록'}</h3><button type="button" className="btn-secondary btn-sm" onClick={resetForm}>닫기</button></div>
          <div className="pay-form-body">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">명칭 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 스파크플러스 임대료"
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <CurrencyInput value={form.amount} onValueChange={(raw) => setForm({ ...form, amount: raw })}
                placeholder="500000"
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="field-input">
                {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">수취인명</label>
              <input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">계좌번호</label>
              <input value={form.recipientAccount} onChange={(e) => setForm({ ...form, recipientAccount: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이체일 (매월)</label>
              <input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                className="field-input" />
            </div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">자동이체 설정 (선택)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">자동이체 예약일 (매월)</label>
                <input type="number" min="1" max="31" value={form.autoTransferDate} onChange={(e) => setForm({ ...form, autoTransferDate: e.target.value })}
                  placeholder="미설정"
                  className="field-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">출금 계좌</label>
                <select value={form.autoTransferAccountId} onChange={(e) => setForm({ ...form, autoTransferAccountId: e.target.value })}
                  className="field-input">
                  <option value="">미지정</option>
                  {bankAccounts.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.bank_name} {a.alias || a.account_number}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">적요 (메모)</label>
                <input value={form.autoTransferMemo} onChange={(e) => setForm({ ...form, autoTransferMemo: e.target.value })}
                  placeholder="자동이체 적요"
                  className="field-input" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="btn-secondary btn-sm">취소</button>
            <button onClick={() => form.name && form.amount && saveMut.mutate()}
              disabled={!form.name || !form.amount || saveMut.isPending}
              className="btn-primary btn-sm">{editingId ? '수정 저장' : '등록'}</button>
          </div>
          </div>
        </div>
        </div>
      )}

      {viewingItem && (
        <RecurringDetailModal
          item={viewingItem}
          categories={categories}
          bankAccounts={bankAccounts}
          onClose={() => setViewingItem(null)}
          onEdit={() => { startEdit(viewingItem); setViewingItem(null); }}
        />
      )}

      {/* List — 상자 안 상자 없이 표만 (2026-08-19) */}
      <div className="recurring-payments-table">
        {recurring.length === 0 ? (
          <div className="collect-empty">
            반복결제가 없습니다 — 임대료, 보험, 구독 등 매월 고정 지출을 등록하세요.
            {newDetected.length > 0 && <> 통장에서 <b>{newDetected.length}건</b>이 잡혀 있습니다 — 위 <b>전체 자동등록</b>을 누르면 한 번에 채워집니다.</>}
          </div>
        ) : (
          <div className="ev-scroll payments-scroll"><table className="ev-table ev-lined payments-table">
            <thead>
              <tr>
                <SortableTh label="명칭" />
                <SortableTh label="카테고리" />
                <SortableTh label="금액" />
                <SortableTh label="수취인" />
                <SortableTh label="이체일" />
                <SortableTh label="자동이체" />
                <SortableTh label="상태" />
                <SortableTh label="관리" />
              </tr>
            </thead>
            <tbody>
              {recurring.map((r: any) => (
                <tr
                  key={r.id}
                  onClick={() => setViewingItem(r)}
                  className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer ${!r.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-5 py-3 text-sm font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {categories[r.category] || r.category}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(r.amount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.recipient_name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-center">매월 {r.day_of_month || 25}일</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                    {r.auto_transfer_date ? (
                      <div>
                        <div>매월 {r.auto_transfer_date}일</div>
                        {r.auto_transfer_memo && <div className="caption">{r.auto_transfer_memo}</div>}
                      </div>
                    ) : <span className="text-[var(--text-dim)]">미설정</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMut.mutate(r); }}
                      disabled={toggleMut.isPending}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
                        r.is_active
                          ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                          : 'bg-gray-500/10 text-gray-400 hover:bg-gray-500/20'
                      }`}>
                      {r.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex gap-1.5 justify-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] transition"
                        title="수정"
                      >수정</button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { ok } = await confirm({ title: "반복결제 삭제", desc: `"${r.name}" 반복결제를 삭제하시겠습니까? 등록된 자동이체와 연결도 함께 끊깁니다.`, danger: true });
                          if (ok) deleteMut.mutate(r.id);
                        }}
                        disabled={deleteMut.isPending}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                        title="삭제"
                      >삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {confirmElement}
    </>
  );
}

// ── Smart Setup Banner (이체내역 분석 + 자동화 실행 + 진행 현황) ──

function SmartSetupBanner({ companyId, userId, invalidate, onRegistered }: { companyId: string; userId?: string | null; invalidate: () => void; onRegistered?: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [includeRisky, setIncludeRisky] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();

  const { data: stats } = useQuery({
    queryKey: ["payment-stats", companyId],
    queryFn: () => getPaymentQueueStats(companyId),
    enabled: !!companyId,
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
  });

  // 이체내역 분석: 탭 진입 시 자동 실행(읽기 전용·무비용) → 고정비 후보 패널 자동 노출.
  const { data: detected = [], refetch: refetchDetect, isFetching: detecting } = useQuery<DetectedRecurring[]>({
    queryKey: ["detected-recurring", companyId],
    queryFn: () => detectRecurringFromBankTx(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60 * 1000,
  });

  // 감지 후보 개별 등록/미등록 — 반복 이체라고 전부 정기결제는 아니므로 건별 판단.
  //   ★ 미등록 판단은 **회사 공통**이다 (2026-08-24 사장님 지적: "직원마다 다르게 뜸").
  //     예전엔 브라우저 localStorage 에만 남겨서 ①사장님이 치운 후보가 직원 화면엔 그대로 뜨고
  //     ②같은 사람도 PC 를 바꾸면 다시 봤다. 이제 recurring_dismissals 테이블에 남긴다.
  const { data: dismissed } = useQuery({
    queryKey: ["recurring-dismissals", companyId],
    queryFn: () => listRecurringDismissals(companyId),
    enabled: !!companyId, staleTime: 60_000,
  });
  const detKey = (d: DetectedRecurring) => recurringMatchKey(d.counterparty, d.amount);
  //   옛 localStorage 기록을 한 번만 DB 로 옮긴다 — 이미 치워 둔 것이 다시 나타나면 또 지적받는다.
  useEffect(() => {
    if (!companyId || !dismissed) return;
    const lsKey = `recurring-dismissed-${companyId}`;
    let old: string[] = [];
    try { old = JSON.parse(localStorage.getItem(lsKey) || "[]"); } catch { return; }
    const missing = old.filter((k) => typeof k === "string" && !dismissed.has(k));
    if (!missing.length) { try { localStorage.removeItem(lsKey); } catch { /* ignore */ } return; }
    dismissRecurringCandidates(companyId, missing, userId)
      .then(() => {
        try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
        queryClient.invalidateQueries({ queryKey: ["recurring-dismissals", companyId] });
      })
      .catch(() => { /* 실패하면 다음 진입에서 다시 시도한다 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, !!dismissed]);
  const dismissDetected = async (d: DetectedRecurring) => {
    try {
      await dismissRecurringCandidate(companyId, detKey(d), userId);
      queryClient.invalidateQueries({ queryKey: ["recurring-dismissals", companyId] });
      toast(`'${d.counterparty}'을(를) 정기결제가 아닌 것으로 두었습니다 — 회사 전체에서 다시 추천하지 않습니다`, "info");
    } catch (e: any) {
      toast("미등록 처리 실패: " + (e?.message || "오류"), "error");
    }
  };
  const [registeringKey, setRegisteringKey] = useState<string | null>(null);
  const registerOne = async (d: DetectedRecurring) => {
    if (registeringKey) return;
    setRegisteringKey(detKey(d));
    try {
      await registerDetectedRecurring(companyId, [d]);
      invalidate();
      refetchDetect();
      queryClient.invalidateQueries({ queryKey: ["recurring-payments", companyId] });
      toast(`'${d.suggestedName || d.counterparty}'을(를) 등록했습니다 — 아래 '반복 결제 설정' 탭에서 확인·수정하세요`, "success");
      onRegistered?.(); // 등록물이 어디 갔는지 바로 보이도록 반복 결제 설정 탭으로 전환
    } catch (e: any) {
      toast("등록 실패: " + (e?.message || "오류"), "error");
    } finally {
      setRegisteringKey(null);
    }
  };
  const freshDetected = detected.filter((d) => !d.alreadyRegistered && !(dismissed?.has(detKey(d))));

  async function handleRunAutomation() {
    setRunning(true);
    try {
      const res = await runAllAutomation(companyId, { includeRisky });
      setResult(res);
      invalidate();
      const total =
        res.recurringExpense.created + res.contractExpense.created +
        res.taxOnPayment.created + res.expenseApproval.approved + res.bankClassification.matched +
        res.threeWayMatch.autoMatched + res.dormantDeals.detected;
      const failed = res.errors?.length ?? 0;
      if (failed > 0) toast(`자동화 완료 — ${total}건 처리, ${failed}개 단계 실패 (아래 확인)`, "error");
      else toast(total > 0 ? `자동화 실행 완료 — 총 ${total}건 처리` : "자동화 실행 완료 — 처리할 항목이 없습니다", total > 0 ? "success" : "info");
    } catch (e: any) {
      toast("자동화 실행 실패: " + (e?.message || "오류"), "error");
    }
    setRunning(false);
  }

  async function handleDetect() {
    try {
      const data = logRead('payments/page:data', await refetchDetect());
      const res = data || [];
      const fresh = res.filter((d) => !d.alreadyRegistered).length;
      if (res.length === 0) toast("최근 3개월 이체내역에서 반복 결제 패턴을 찾지 못했습니다", "info");
      else toast(`반복 이체 ${res.length}건 감지 (신규 ${fresh}건 · 기등록 ${res.length - fresh}건)`, "success");
    } catch (e: any) {
      toast("이체내역 분석 실패: " + (e?.message || "오류"), "error");
    }
  }

  const activeRecurring = recurring.filter((r: any) => r.is_active).length;
  const pendingCount = stats?.pendingCount ?? 0;
  const approvedCount = stats?.approvedCount ?? 0;
  const executedCount = stats?.executedCount ?? 0;

  return (
    <div className="space-y-3">
      {/* 조회 줄 ‖ 이체내역 분석 · 자동화 실행 · 결과 요약(자동화 진행 현황 4단계) — 상자 머리 슬롯 (2026-08-19, 유리 카드 → Stat) */}
      <SlotHead slotId="pay-head-slot"
        bar={<span className="text-[11px] text-[var(--text-dim)]">통장·카드에서 2개월 이상 같은 거래처·금액으로 반복된 거래를 찾아 정기결제로 등록하길 <b>제안</b>합니다 — 등록은 사람이 고릅니다</span>}
        right={<>
          <button type="button" onClick={handleDetect} disabled={detecting} className="btn-secondary btn-sm">{detecting ? '분석 중…' : '이체내역 분석'}</button>
          <button type="button" onClick={handleRunAutomation} disabled={running} className="btn-primary btn-sm">{running ? '실행 중…' : '자동화 실행'}</button>
        </>}
        stats={<>
          <Stat label="반복설정" value={`${activeRecurring}건`} />
          <Stat label="승인대기" value={`${pendingCount}건`} tone="minus" />
          <Stat label="결제대기" value={`${approvedCount}건`} />
          <Stat label="완료" value={`${executedCount}건`} tone="plus" />
          <span className="text-[10.5px] text-[var(--text-dim)]">설정 → 지출결의 → 승인 → 결제 → 세금계산서</span>
        </>} />

      {/* 자동화 실행이 무엇을 하는지 — 위험 작업은 접어 둔다 (2026-08-12) */}
      <div className="pay-note pay-note-col">
        <span className="text-[11px]">자동화 실행 = 거래 자동분류·매칭, 결제큐 정리, 지출결의 드래프트 생성 (데이터 정리만, 돈/세무 변경 없음).</span>
        <details className="payment-risky-details" open={includeRisky}>
          <summary>고급 — 위험 작업 {includeRisky && <em>켜짐</em>}</summary>
          <label className="payment-risky-label">
            <input type="checkbox" checked={includeRisky} onChange={(e) => setIncludeRisky(e.target.checked)} className="mt-0.5 accent-[var(--danger)]" />
            <span>
              <span className="font-semibold text-[var(--danger)]">위험 작업 포함</span> — 소액 자동승인 · 결제→세금계산서 자동발행 · 환불→세금계산서 취소.
              실제 승인·세무 레코드를 자동 생성합니다. 내용을 이해한 경우에만 체크하세요.
            </span>
          </label>
        </details>
      </div>

      {/* Automation result */}
      {result && (
        <div className="pay-note pay-note-col">
          <div className="text-xs font-bold text-[var(--success)]">자동화 실행 완료</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            {result.recurringExpense.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.recurringExpense.created}건</div>
                <div className="text-[var(--text-dim)]">반복→지출결의</div>
              </div>
            )}
            {result.contractExpense.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.contractExpense.created}건</div>
                <div className="text-[var(--text-dim)]">계약→지출결의</div>
              </div>
            )}
            {result.taxOnPayment.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.taxOnPayment.created}건</div>
                <div className="text-[var(--text-dim)]">결제→세금계산서</div>
              </div>
            )}
            {result.expenseApproval.approved > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.expenseApproval.approved}건</div>
                <div className="text-[var(--text-dim)]">소액자동승인</div>
              </div>
            )}
            {result.bankClassification.matched > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.bankClassification.matched}건</div>
                <div className="text-[var(--text-dim)]">거래자동분류</div>
              </div>
            )}
            {result.threeWayMatch.autoMatched > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.threeWayMatch.autoMatched}건</div>
                <div className="text-[var(--text-dim)]">3-Way 매칭</div>
              </div>
            )}
            {result.dormantDeals.detected > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.dormantDeals.detected}건</div>
                <div className="text-[var(--text-dim)]">휴면 프로젝트 감지</div>
              </div>
            )}
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="mt-2 bg-red-500/5 border border-red-500/20 rounded-lg p-2">
              <div className="text-[11px] font-bold text-red-500 mb-1">실패한 단계 {result.errors.length}개</div>
              <ul className="space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-[10px] text-[var(--text-dim)] break-all">• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 통장에서 잡힌 반복 이체 — 건별 등록/미등록 (반복 이체 ≠ 전부 정기결제). 표로 (2026-08-19) */}
      {detected.length > 0 && (
        <div>
          <div className="pay-note">
            <b>이체내역에서 {freshDetected.length}건 신규 감지 · {detected.filter(d => d.alreadyRegistered).length}건 기등록</b>
            <span>건별로 등록 여부를 고르세요 — 미등록으로 둔 항목은 <b>회사 전체</b>에서 다시 추천하지 않습니다</span>
            {freshDetected.length > 1 && (
              <span className="ml-auto"><button type="button" className="btn-secondary btn-sm"
                onClick={async () => {
                  const { ok } = await confirm({ title: "전체 등록", desc: `감지된 ${freshDetected.length}건을 전부 고정비(반복결제)로 등록할까요? 반복 이체라도 정기결제가 아닐 수 있으니 목록을 확인한 뒤 진행하세요.`, danger: true, confirmLabel: "등록" });
                  if (!ok) return;
                  await registerDetectedRecurring(companyId, freshDetected);
                  invalidate(); refetchDetect();
                  queryClient.invalidateQueries({ queryKey: ["recurring-payments", companyId] });
                  toast(`${freshDetected.length}건을 등록했습니다 — '정기결제' 탭에서 확인·수정하세요`, "success");
                  onRegistered?.();
                }}>전체 등록</button></span>
            )}
          </div>
          {freshDetected.length === 0 ? (
            <div className="collect-empty">신규 후보가 없습니다 (미등록 처리한 항목은 다시 표시되지 않습니다)</div>
          ) : (
            <div className="ev-scroll"><table className="ev-table ev-lined pay-detect-table">
              <thead><tr><th>횟수</th><th className="text-left">거래처</th><th>추정 구분</th><th>금액 (월)</th><th>확신</th><th>동작</th></tr></thead>
              <tbody>
                {freshDetected.map((d) => (
                  <tr key={detKey(d)}>
                    <td className="text-center mono-number">{d.occurrences}회</td>
                    <td className="text-left font-semibold">{d.counterparty}</td>
                    <td className="text-center text-[var(--text-muted)]">{d.suggestedCategory}</td>
                    <td className="text-right mono-number font-bold">₩{d.amount.toLocaleString()}</td>
                    <td className="text-center"><span className={`ol-sure ${d.confidence === 'high' ? 'ol-sure-ok' : d.confidence === 'medium' ? 'ol-sure-est' : ''}`}>{d.confidence === 'high' ? '확실' : d.confidence === 'medium' ? '가능성' : '낮음'}</span></td>
                    <td className="text-center">
                      <span className="inline-flex gap-1.5">
                        <button type="button" onClick={() => registerOne(d)} disabled={!!registeringKey} className="btn-secondary btn-sm" title="이 항목만 고정비(반복결제)로 등록">{registeringKey === detKey(d) ? "등록 중…" : "등록"}</button>
                        <button type="button" onClick={() => dismissDetected(d)} disabled={!!registeringKey} className="btn-secondary btn-sm text-[var(--text-dim)]" title="정기결제가 아님 — 회사 전체에서 다시 추천하지 않습니다">미등록</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
      {confirmElement}
    </div>
  );
}

// ── Tab: 지출결의서/품의서 ──


"use client";

// PR3.5: 견적 품목 + 결제 단계 인라인 편집 컴포넌트.
//   슬라이드 패널 돈 탭에 임베드. saveQuoteAndPayment 와 동일한 데이터 모델
//   (deals.custom_scope JSONB { quoteItems, paymentStages, quoteContent }) 사용.
//   /deals/page.tsx 의 견적 품목/결제 단계 UI(L312~352) 와 동일 동작 + 같은 함수 호출.
//
// STEP 4 (PR-C): mode='edit' | 'preview' + SendBar + StatusBadge + RejectedCard + Realtime.
//   저장 성공 시 자동 preview 전환. preview 상태에서 발송/결과 보기.
//   다음 라운드에서 deals/page.tsx 도 이 컴포넌트로 통합.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { ContractStageCard } from "@/components/contract-stage-card";
import { ProgressReportStageCard } from "@/components/progress-report-stage-card";
import {
  createApproval,
  sendApproval,
  resendApproval,
  getLatestApproval,
  subscribeApprovalStatus,
  STATUS_LABEL,
  type ApprovalLite,
  type QuoteApprovalStage,
} from "@/lib/quote-approvals";

type QuoteItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  note?: string;
};
type PaymentStage = { label: string; ratio: number; condition: string; milestone_id?: string };

// 단계별 라벨·이메일 제목 매핑 — UI 텍스트 일관화
const STAGE_LABEL: Record<QuoteApprovalStage, string> = {
  estimate: "견적서",
  contract: "계약서",
  progress_report: "진척 보고서",
  completion: "완료 확인서",
  settlement: "정산 확인",
};

const STAGE_NEXT_HINT: Record<QuoteApprovalStage, string> = {
  estimate: "거래처가 승인하면 자동으로 계약 단계로 진행됩니다",
  contract: "거래처가 승인하면 자동으로 진행 중 단계로 전환됩니다",
  progress_report: "거래처 확인 후 완료 단계로 안내됩니다",
  completion: "거래처가 확인하면 정산 단계로 진행됩니다",
  settlement: "거래처가 정산을 확인하면 프로젝트가 완료됩니다",
};

interface Props {
  dealId: string;
  companyId: string;
  readonly?: boolean;
  /** deal.stage 값. 미지정 시 'estimate'. project-slide-over 가 deal.stage 그대로 전달. */
  stage?: QuoteApprovalStage;
}

type Mode = "edit" | "preview";

// completion / settlement 는 우선 stub — 견적·계약·진척보고서 본 흐름과 분리
// B 핸드오프: progress_report 는 ProgressReportStageCard 로 분기 (stub 제거).
const STUB_STAGES: ReadonlySet<QuoteApprovalStage> = new Set<QuoteApprovalStage>([
  "completion",
  "settlement",
]);

export function ProjectQuoteStages({ dealId, companyId, readonly, stage = "estimate" }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [stages, setStages] = useState<PaymentStage[]>([
    { label: "선금", ratio: 30, condition: "계약 후 7일 이내" },
    { label: "잔금", ratio: 70, condition: "납품 완료 후 14일 이내" },
  ]);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dealName, setDealName] = useState<string>("");
  const [contractTotal, setContractTotal] = useState<number>(0);
  const [partnerEmail, setPartnerEmail] = useState<string>("");
  const [partnerName, setPartnerName] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string | null>(null);

  // STEP 4 (PR-C): mode + approval state
  const [mode, setMode] = useState<Mode>("edit");
  const [approval, setApproval] = useState<ApprovalLite | null>(null);
  const [recipientEmailInput, setRecipientEmailInput] = useState("");
  const [sending, setSending] = useState(false);

  // 초기 로드 — custom_scope 에서 복원 + partner email + latest approval
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: deal } = await (supabase as any)
        .from("deals")
        .select("name, contract_total, custom_scope, partner_id, partners:partners!deals_partner_id_fkey(id, name, contact_email)")
        .eq("id", dealId)
        .maybeSingle();
      if (cancelled) return;
      if (deal) {
        setDealName(deal.name || "");
        setContractTotal(Number(deal.contract_total || 0));
        const scope = (deal.custom_scope as any) || {};
        const hasQuoteItems = Array.isArray(scope.quoteItems) && scope.quoteItems.length > 0;
        if (hasQuoteItems) setItems(scope.quoteItems);
        if (Array.isArray(scope.paymentStages) && scope.paymentStages.length) setStages(scope.paymentStages);
        if (typeof scope.quoteContent === "string") setContent(scope.quoteContent);
        const p = (deal as any).partners || null;
        if (p) {
          setPartnerId(p.id || null);
          setPartnerName(p.name || "");
          setPartnerEmail(p.contact_email || "");
          setRecipientEmailInput(p.contact_email || "");
        }
        // 데이터가 있으면 preview 모드, 없으면 edit
        if (hasQuoteItems) setMode("preview");
      }

      // 최신 approval 조회 (현재 stage)
      const latest = await getLatestApproval(dealId, stage);
      if (cancelled) return;
      if (latest) {
        setApproval(latest);
        // 이미 발송된 approval 있으면 preview 강제
        if (latest.status !== "draft") setMode("preview");
      }
      setLoading(false);
    })();

    // Realtime 구독 — 현재 stage
    const unsub = subscribeApprovalStatus(dealId, stage, (row) => {
      if (cancelled) return;
      if (row) {
        setApproval(row);
        // 외부 결정/뷰 들어오면 패널 갱신
        if (row.status === "approved") {
          toast(`거래처가 ${STAGE_LABEL[stage]}을(를) 승인했습니다!`, "success");
          // 다음 단계로 자동 전환된 deal 도 invalidate
          queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
          queryClient.invalidateQueries({ queryKey: ["deal-detail", dealId] });
          queryClient.invalidateQueries({ queryKey: ["deals"] });
        } else if (row.status === "rejected") {
          toast(`거래처가 ${STAGE_LABEL[stage]}을(를) 거절했습니다 — 사유 확인`, "error");
        } else if (row.status === "viewed") {
          toast(`거래처가 ${STAGE_LABEL[stage]}을(를) 봤습니다`, "info");
        }
      }
    });

    return () => {
      cancelled = true;
      try { unsub(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, stage]);

  async function save() {
    if (readonly) return;
    setSaving(true);
    try {
      const { data: deal } = await (supabase as any)
        .from("deals")
        .select("custom_scope")
        .eq("id", dealId)
        .maybeSingle();
      const scope = { ...((deal?.custom_scope as any) || {}), quoteItems: items, paymentStages: stages, quoteContent: content };
      const { error } = await (supabase as any).from("deals").update({ custom_scope: scope }).eq("id", dealId);
      if (error) throw error;

      // 2026-05-21 v5 Q1·Q2: 활동탭 파일 섹션에 저장 즉시 표시되도록 quote_approvals draft upsert
      //   기존 draft 있으면 payload 갱신, 없으면 createApproval (status='draft')
      //   stage 가 'estimate' 일 때만 동작 (이 컴포넌트의 책임). contract 는 contract-stage-card 가 처리.
      try {
        const payload = { items, paymentStages: stages, quoteContent: content };
        if (approval?.id && approval.status === 'draft') {
          await (supabase as any)
            .from('quote_approvals')
            .update({ payload })
            .eq('id', approval.id);
        } else if (!approval) {
          const created = await createApproval({ dealId, stage, payload, partnerId });
          // 신규 draft 가 만들어졌으니 상위에 알림 (activity / file 섹션 invalidate 후 노출)
          const latest = await getLatestApproval(dealId, stage);
          if (latest) setApproval(latest);
          void created;
        }
      } catch (e) {
        reportError("quote.save.draft.upsert", e);
        // draft upsert 실패해도 save 자체는 성공 (custom_scope 저장은 이미 완료)
      }

      toast("견적 품목 / 결제 단계가 저장되었습니다", "success");
      queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal-detail", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal-approvals", dealId] });
      // STEP 4: 저장 성공 시 자동 preview 전환
      setMode("preview");
    } catch (e: unknown) {
      toast(`저장 실패: ${friendlyError(e, "알 수 없는 오류")}`, "error");
    }
    setSaving(false);
  }

  async function handleSend() {
    if (readonly || sending) return;
    const email = recipientEmailInput.trim();
    if (!email) {
      toast("거래처 이메일을 입력해 주세요", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("올바른 이메일 형식이 아닙니다", "error");
      return;
    }
    setSending(true);
    try {
      // 1) 기존 approval 가져오거나 새로 생성
      const payload = { items, paymentStages: stages, quoteContent: content };
      let approvalId = approval?.id || null;
      let _token: string | null = null;
      if (!approvalId || approval?.status !== "draft") {
        // approval 없거나 이미 sent/viewed/decided 상태면 새로 생성
        const created = await createApproval({
          dealId,
          stage,
          payload,
          partnerId,
        });
        approvalId = created.id;
        _token = created.token;
      }
      // 안전망 (2026-05-21): 기존 draft 재사용 분기에서 _token 미할당 → 메일 링크 깨짐 회귀.
      //   어느 경로든 _token 확보. approval_token 컬럼은 RLS 상 작성자/회사구성원 select 허용.
      if (!_token && approvalId) {
        const { data: row } = await (supabase as any)
          .from('quote_approvals')
          .select('approval_token')
          .eq('id', approvalId)
          .maybeSingle();
        _token = row?.approval_token ?? null;
      }
      if (!_token) {
        throw new Error('서명 링크 생성 실패 — 잠시 후 다시 시도해 주세요');
      }

      // 2) status='sent' + sent_at + expires_at + recipient_*
      await sendApproval({
        approvalId: approvalId!,
        recipientEmail: email,
        recipientName: partnerName || undefined,
        expiresInDays: 14,
      });

      // 3) 이메일 발송 (PR-D edge 분기 — 미배포 시 RESEND_API_KEY fallback 으로 success 반환)
      //   엣지 배포 전엔 fallback 으로 패스 → 패널 StatusBadge 는 정상 발송됨 표시.
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote",
            stage,                       // 엣지가 stage 라벨로 메일 제목·본문·CTA 분기
            to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — ${STAGE_LABEL[stage]} 확인 요청` : `${STAGE_LABEL[stage]} 확인 요청`,
            // 절대 URL: PR-D 엣지가 받아서 본문에 노출. 환경변수 SITE_URL 폴백.
            signUrl: buildQuoteUrl(_token),
            companyName: undefined, // 엣지가 발신자 회사명 조회 (간단 fallback)
            amount: contractTotal || undefined,
            items: items.length > 0 ? items : undefined,
            paymentStages: stages.length > 0 ? stages : undefined,
          },
        });
      } catch (e) {
        // 엣지 실패해도 sendApproval 은 이미 완료 — Realtime + 패널은 sent 상태 표시
        reportError("quote-approvals.send.edge", e);
      }

      // 4) approval 상태 재조회
      const latest = await getLatestApproval(dealId, stage);
      if (latest) setApproval(latest);
      toast(`거래처에 발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`발송 실패: ${friendlyError(e, "거래처 발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  // 거절 후 재발송: 사용자가 수정→저장→[재발송] 버튼. 별도 resendApproval RPC 사용.
  async function handleResend() {
    if (!approval?.id || sending) return;
    const email = recipientEmailInput.trim() || partnerEmail;
    if (!email) {
      toast("거래처 이메일을 입력해 주세요", "error");
      return;
    }
    setSending(true);
    try {
      const payload = { items, paymentStages: stages, quoteContent: content };
      const { id: newId, token } = await resendApproval({ prevId: approval.id, payload });
      await sendApproval({
        approvalId: newId,
        recipientEmail: email,
        recipientName: partnerName || undefined,
        expiresInDays: 14,
      });
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote",
            stage,                       // 엣지가 stage 라벨로 분기
            to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — ${STAGE_LABEL[stage]} 확인 요청 (재발송)` : `${STAGE_LABEL[stage]} 확인 요청 (재발송)`,
            signUrl: buildQuoteUrl(token),
            amount: contractTotal || undefined,
            items: items.length > 0 ? items : undefined,
            paymentStages: stages.length > 0 ? stages : undefined,
          },
        });
      } catch (e) {
        reportError("quote-approvals.resend.edge", e);
      }
      const latest = await getLatestApproval(dealId, stage);
      if (latest) setApproval(latest);
      toast(`거래처에 재발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`재발송 실패: ${friendlyError(e, "재발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  function addItem() {
    setItems((prev) => prev.length === 0
      ? [{ name: dealName, quantity: 1, unitPrice: contractTotal, supplyAmount: contractTotal, taxAmount: Math.round(contractTotal * 0.1), totalAmount: Math.round(contractTotal * 1.1), note: "" }]
      : [...prev, { name: "", quantity: 1, unitPrice: 0, supplyAmount: 0, taxAmount: 0, totalAmount: 0, note: "" }]);
  }

  function updateItem(idx: number, patch: Partial<QuoteItem>) {
    setItems((prev) => {
      const arr = [...prev];
      const next = { ...arr[idx], ...patch };
      const q = Number(next.quantity || 0);
      const u = Number(next.unitPrice || 0);
      const supply = q * u;
      arr[idx] = { ...next, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) };
      return arr;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStage() {
    setStages((prev) => [...prev, { label: `${prev.length + 1}차`, ratio: 0, condition: "" }]);
  }

  function updateStage(idx: number, patch: Partial<PaymentStage>) {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeStage(idx: number) {
    setStages((prev) => prev.filter((_, i) => i !== idx));
  }

  const stageSum = stages.reduce((s, st) => s + (st.ratio || 0), 0);
  const supplyTotal = items.reduce((s, i) => s + Number(i.supplyAmount || 0), 0);
  const taxTotal = items.reduce((s, i) => s + Number(i.taxAmount || 0), 0);
  const grandTotal = items.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

  if (loading) {
    return <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-[11px] text-[var(--text-dim)] text-center">불러오는 중…</div>;
  }

  // 완료 확인서 / 정산 확인 — 우선 stub, 다음 라운드에서 본 폼 추가
  if (STUB_STAGES.has(stage)) {
    return <StageStubCard stage={stage} approval={approval} />;
  }

  // B 핸드오프: 진척 보고서 본 폼 (별도 카드 컴포넌트).
  if (stage === "progress_report") {
    return (
      <ProgressReportStageCard
        dealId={dealId}
        companyId={companyId}
        readonly={!!readonly}
        dealName={dealName}
        partnerId={partnerId}
        partnerName={partnerName}
        partnerEmail={partnerEmail}
        approval={approval}
        onApprovalChange={setApproval}
      />
    );
  }

  // L 계약: stage='contract' 는 견적 payload(items/paymentStages) 자동 inherit 후 양식 선택 모드.
  if (stage === "contract") {
    return (
      <ContractStageCard
        dealId={dealId}
        companyId={companyId}
        readonly={!!readonly}
        dealName={dealName}
        contractTotal={contractTotal}
        partnerId={partnerId}
        partnerName={partnerName}
        partnerEmail={partnerEmail}
        items={items}
        paymentStages={stages}
        approval={approval}
        onApprovalChange={setApproval}
      />
    );
  }

  // estimate 본 폼 — 견적 품목 / 결제 단계 / 견적 내용
  const sectionLabel = "견적 품목 / 결제 단계";

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">{sectionLabel}</h3>
        <div className="flex items-center gap-2">
          {/* STEP 4: StatusBadge — approval 존재 시 상태 노출 */}
          {approval && mode === "preview" && <StatusBadge approval={approval} />}
          {/* edit ↔ preview 전환 */}
          {!readonly && mode === "preview" && (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="text-[10px] px-2 py-1 rounded-lg bg-[var(--bg)] hover:bg-[var(--border)] text-[var(--text-muted)] font-semibold transition"
            >
              ✏️ 수정
            </button>
          )}
          {!readonly && mode === "edit" && (
            <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-semibold disabled:opacity-50 transition">
              {saving ? "저장 중…" : "💾 저장"}
            </button>
          )}
        </div>
      </div>

      {/* STEP 4: RejectedCard — 거절 사유 큼지막 */}
      {approval?.status === "rejected" && approval.decision_note && (
        <RejectedCard
          note={approval.decision_note}
          onEdit={() => setMode("edit")}
        />
      )}

      {/* STEP 4: Preview 모드 — read-only 카드 */}
      {mode === "preview" && (
        <PreviewCard
          dealName={dealName}
          items={items}
          stages={stages}
          content={content}
          supplyTotal={supplyTotal}
          taxTotal={taxTotal}
          grandTotal={grandTotal}
          stageSum={stageSum}
        />
      )}

      {/* STEP 4: SendBar — preview 모드 + (approval 없음 OR draft OR rejected 후 수정 완료)
          rejected 상태에선 RejectedCard 가 onEdit→edit→저장→다시 preview 로 와서 노출됨 */}
      {!readonly && mode === "preview" && (!approval || approval.status === "draft") && (
        <SendBar
          email={recipientEmailInput}
          onEmailChange={setRecipientEmailInput}
          onSend={handleSend}
          sending={sending}
          partnerName={partnerName}
          itemsCount={items.length}
          stage={stage}
        />
      )}

      {/* STEP 4: rejected 상태에서 사용자가 수정 안 하고 재발송만 원할 때 (수정 후 자동 preview 복귀하면 SendBar 가 안 보임 — approval.status='rejected' 라서)
          → 별도 ResendBar 노출: rejected + preview 모드 */}
      {!readonly && mode === "preview" && approval?.status === "rejected" && (
        <ResendBar
          email={recipientEmailInput}
          onEmailChange={setRecipientEmailInput}
          onResend={handleResend}
          sending={sending}
        />
      )}

      {/* edit 모드 — 기존 편집 UI */}
      {mode === "edit" && (
        <>
          {/* 결제 단계 */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[var(--text-dim)] font-medium">결제 단계 ({stages.length}단계)</span>
              <div className="flex items-center gap-2">
                <span className="caption">합계 {stageSum}%
                  {contractTotal > 0 && (
                    <span className="text-[var(--text)] font-semibold ml-1">
                      (₩{Math.round((contractTotal * stageSum) / 100).toLocaleString()} / 계약가 ₩{contractTotal.toLocaleString()})
                    </span>
                  )}
                  {stageSum !== 100 && <span className="text-red-400 ml-1">(100%가 아님)</span>}
                </span>
                {!readonly && (
                  <button onClick={addStage} className="text-[10px] text-[var(--primary)] hover:underline font-semibold">+ 단계 추가</button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              {stages.map((stage, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-1.5">
                  <input value={stage.label} onChange={(e) => updateStage(idx, { label: e.target.value })}
                    disabled={readonly} placeholder="단계명"
                    className="w-16 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)]" />
                  <input type="text" inputMode="numeric" value={stage.ratio === 0 ? "" : String(stage.ratio)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      const num = v === "" ? 0 : Math.min(100, parseInt(v, 10));
                      updateStage(idx, { ratio: num });
                    }}
                    disabled={readonly} placeholder="0"
                    className="w-12 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] text-right focus:outline-none focus:border-[var(--primary)]" />
                  <span className="caption">%</span>
                  {contractTotal > 0 && (
                    <span className="text-[10px] text-[var(--text)] font-semibold min-w-[70px]">
                      = ₩{Math.round((contractTotal * (stage.ratio || 0)) / 100).toLocaleString()}
                    </span>
                  )}
                  <input value={stage.condition} onChange={(e) => updateStage(idx, { condition: e.target.value })}
                    disabled={readonly} placeholder="지급 조건 (예: 계약 후 7일)"
                    className="flex-1 min-w-[100px] px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)]" />
                  {!readonly && stages.length > 1 && (
                    <button onClick={() => removeStage(idx)} className="text-red-400/70 hover:text-red-400 text-[10px]">✕</button>
                  )}
                </div>
              ))}
            </div>
            {stages.length > 0 && (
              <div className="mt-2 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden flex">
                {stages.map((stage, idx) => (
                  <div key={idx} className="h-full" style={{ width: `${stage.ratio}%`, backgroundColor: idx === 0 ? "#3B82F6" : idx === 1 ? "#22C55E" : idx === 2 ? "#EAB308" : "#8B5CF6", opacity: 0.8 }} title={`${stage.label} ${stage.ratio}%`} />
                ))}
              </div>
            )}
          </div>

          {/* 견적 품목 */}
          <div className="mb-3 pt-3 border-t border-[var(--border)]/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[var(--text-dim)] font-medium">견적 품목 ({items.length}건)</span>
              {!readonly && (
                <button onClick={addItem} className="text-[10px] text-[var(--primary)] hover:underline font-semibold">+ 품목 추가</button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="text-[11px] text-[var(--text-dim)] text-center py-3">품목을 추가하면 견적서 생성 시 자동 반영됩니다</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-[var(--text-dim)] border-b border-[var(--border)]/40">
                      <th className="text-left py-1 px-1 font-medium">품명</th>
                      <th className="text-right py-1 px-1 font-medium w-12">수량</th>
                      <th className="text-right py-1 px-1 font-medium w-20">단가</th>
                      <th className="text-right py-1 px-1 font-medium w-24">공급가액</th>
                      <th className="text-right py-1 px-1 font-medium w-20">세액(10%)</th>
                      <th className="text-right py-1 px-1 font-medium w-24">합계</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-[var(--border)]/30">
                        <td className="py-1 px-1">
                          <input value={item.name || ""} onChange={(e) => updateItem(idx, { name: e.target.value })}
                            disabled={readonly} placeholder="품목명"
                            className="w-full bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                        </td>
                        <td className="py-1 px-1 text-right">
                          <input type="number" value={item.quantity || 0} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                            disabled={readonly}
                            className="w-full text-right bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                        </td>
                        <td className="py-1 px-1 text-right">
                          <input type="text" inputMode="numeric" value={item.unitPrice ? Number(item.unitPrice).toLocaleString("ko-KR") : "0"}
                            onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                            disabled={readonly}
                            className="w-full text-right bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                        </td>
                        <td className="py-1 px-1 text-right text-[var(--text-muted)]">{Number(item.supplyAmount || 0).toLocaleString()}</td>
                        <td className="py-1 px-1 text-right text-[var(--text-muted)]">{Number(item.taxAmount || 0).toLocaleString()}</td>
                        <td className="py-1 px-1 text-right font-bold">{Number(item.totalAmount || 0).toLocaleString()}</td>
                        <td className="py-1 px-1 text-center">
                          {!readonly && items.length > 0 && (
                            <button onClick={() => removeItem(idx)} className="text-red-400/70 hover:text-red-400 text-[10px]">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--bg)]/40">
                      <td colSpan={3} className="py-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">합계</td>
                      <td className="py-1 px-1 text-right text-[10px] font-bold">{supplyTotal.toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-[10px] font-bold">{taxTotal.toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-[10px] font-black">{grandTotal.toLocaleString()}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* 견적 내용 / 비고 */}
          <div className="pt-3 border-t border-[var(--border)]/40">
            <label className="block text-[10px] text-[var(--text-dim)] font-medium mb-1.5">견적서 내용 / 비고</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={readonly}
              rows={2} placeholder="견적서에 포함할 내용, 조건, 비고 등"
              className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)] resize-none" />
          </div>
        </>
      )}
    </div>
  );
}

export default ProjectQuoteStages;

// ──────────────────────────────────────────────────────────
// STEP 4 helpers — Preview / StatusBadge / RejectedCard / SendBar / ResendBar
// ──────────────────────────────────────────────────────────

function buildQuoteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/quote/${encodeURIComponent(token)}`;
}

function StatusBadge({ approval }: { approval: ApprovalLite }) {
  const status = approval.status;
  const label =
    status === "sent" && approval.recipient_email
      ? `발송됨 (${approval.recipient_email})`
      : STATUS_LABEL[status] || status;
  const tone =
    status === "approved"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : status === "rejected"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : status === "viewed"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : status === "expired"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : status === "sent"
      ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
      : "bg-gray-500/15 text-gray-400 border-gray-500/30";
  const icon =
    status === "approved" ? "✅" : status === "rejected" ? "❌" : status === "viewed" ? "👁" : status === "expired" ? "⏰" : status === "sent" ? "📤" : "📝";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${tone}`}>
      <span>{icon}</span>
      <span className="truncate max-w-[180px]">{label}</span>
    </span>
  );
}

function RejectedCard({ note, onEdit }: { note: string; onEdit: () => void }) {
  return (
    <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-red-400">❌ 거래처가 거절했습니다</span>
        <button
          type="button"
          onClick={onEdit}
          className="text-[10px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold transition"
        >
          수정 후 재발송
        </button>
      </div>
      <div className="text-[11px] text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed">
        {note}
      </div>
    </div>
  );
}

function PreviewCard({
  dealName,
  items,
  stages,
  content,
  supplyTotal,
  taxTotal,
  grandTotal,
  stageSum,
}: {
  dealName: string;
  items: QuoteItem[];
  stages: PaymentStage[];
  content: string;
  supplyTotal: number;
  taxTotal: number;
  grandTotal: number;
  stageSum: number;
}) {
  if (items.length === 0 && stages.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-dim)] text-center py-4">
        견적 품목을 추가하려면 ‘수정’ 버튼을 눌러주세요
      </div>
    );
  }
  return (
    <div className="space-y-3 mb-3">
      {/* 결제 단계 */}
      {stages.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-[var(--text-dim)] font-medium">결제 단계 ({stages.length}단계)</span>
            <span className="caption">
              합계 {stageSum}%
              {stageSum !== 100 && <span className="text-red-400 ml-1">(100%가 아님)</span>}
            </span>
          </div>
          <div className="space-y-1">
            {stages.map((st, idx) => (
              <div key={idx} className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-[var(--text)]">
                  {st.label || `${idx + 1}차`} · {st.ratio}%
                </span>
                <span className="text-[var(--text-dim)]">{st.condition || "—"}</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden flex">
            {stages.map((stage, idx) => (
              <div
                key={idx}
                className="h-full"
                style={{
                  width: `${stage.ratio}%`,
                  backgroundColor:
                    idx === 0 ? "#3B82F6" : idx === 1 ? "#22C55E" : idx === 2 ? "#EAB308" : "#8B5CF6",
                  opacity: 0.8,
                }}
                title={`${stage.label} ${stage.ratio}%`}
              />
            ))}
          </div>
        </div>
      )}
      {/* 품목표 */}
      {items.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1.5">
            견적 품목 ({items.length}건) — {dealName || "(이름 없음)"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--text-dim)] border-b border-[var(--border)]/40">
                  <th className="text-left py-1 px-1 font-medium">품명</th>
                  <th className="text-right py-1 px-1 font-medium w-10">수량</th>
                  <th className="text-right py-1 px-1 font-medium w-20">단가</th>
                  <th className="text-right py-1 px-1 font-medium w-24">합계</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-b border-[var(--border)]/30">
                    <td className="py-1 px-1 text-[var(--text)]">{it.name || "—"}</td>
                    <td className="py-1 px-1 text-right text-[var(--text-muted)]">{Number(it.quantity || 0)}</td>
                    <td className="py-1 px-1 text-right text-[var(--text-muted)]">
                      {Number(it.unitPrice || 0).toLocaleString()}
                    </td>
                    <td className="py-1 px-1 text-right font-bold">
                      {Number(it.totalAmount || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-[var(--bg)]/40">
                  <td colSpan={2} className="py-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">
                    소계
                  </td>
                  <td className="py-1 px-1 text-right text-[10px] text-[var(--text-muted)]">
                    공급 {supplyTotal.toLocaleString()} · 세 {taxTotal.toLocaleString()}
                  </td>
                  <td className="py-1 px-1 text-right text-[10px] font-black">{grandTotal.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {/* 비고 */}
      {content && (
        <div className="pt-2 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1">비고</div>
          <div className="text-[10px] text-[var(--text)] whitespace-pre-wrap break-words">{content}</div>
        </div>
      )}
    </div>
  );
}

function SendBar({
  email,
  onEmailChange,
  onSend,
  sending,
  partnerName,
  itemsCount,
  stage,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  partnerName: string;
  itemsCount: number;
  stage: QuoteApprovalStage;
}) {
  const stageLabel = STAGE_LABEL[stage];
  return (
    <div className="mb-3 pt-3 border-t border-[var(--border)]/40">
      <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1.5">
        거래처에 {stageLabel} 발송 {partnerName ? `· ${partnerName}` : ""}
      </div>
      <div className="flex flex-col sm:flex-row gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="recipient@example.com"
          className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={sending || itemsCount === 0}
          className="px-3 py-1.5 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
        >
          {sending ? "발송 중…" : `📤 거래처에 ${stageLabel} 발송`}
        </button>
      </div>
      {itemsCount === 0 && (
        <div className="mt-1.5 text-[10px] text-amber-400">품목을 1개 이상 추가한 뒤 발송할 수 있습니다</div>
      )}
      <div className="mt-1.5 text-[10px] text-[var(--text-dim)]">
        만료: 14일 · {STAGE_NEXT_HINT[stage]}
      </div>
    </div>
  );
}

function StageStubCard({ stage, approval }: { stage: QuoteApprovalStage; approval: ApprovalLite | null }) {
  const label = STAGE_LABEL[stage];
  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">{label}</h3>
        {approval && <StatusBadge approval={approval} />}
      </div>
      <div className="text-[11px] text-[var(--text-dim)] py-6 text-center leading-relaxed">
        {label} 단계 본 폼은 다음 라운드에 추가됩니다.<br/>
        <span className="caption">현재 단계: <span className="text-[var(--text)] font-semibold">{label}</span> · {STAGE_NEXT_HINT[stage]}</span>
      </div>
    </div>
  );
}

function ResendBar({
  email,
  onEmailChange,
  onResend,
  sending,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  onResend: () => void;
  sending: boolean;
}) {
  return (
    <div className="mb-3 pt-3 border-t border-[var(--border)]/40">
      <div className="text-[10px] text-amber-400 font-medium mb-1.5">
        거절된 견적입니다 — 같은 내용으로 재발송 (수정하려면 ✏️ 수정)
      </div>
      <div className="flex flex-col sm:flex-row gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="recipient@example.com"
          className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
        />
        <button
          type="button"
          onClick={onResend}
          disabled={sending}
          className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
        >
          {sending ? "재발송 중…" : "🔁 재발송"}
        </button>
      </div>
    </div>
  );
}

"use client";

// L 계약: stage='contract' 전용 양식 선택·변수 치환·발송 카드
//
// project-quote-stages.tsx 가 stage='contract' 일 때 이 컴포넌트로 분기.
// 동일 quote_approvals 인프라(createApproval/sendApproval) + send-signature-email 엣지
// 재사용 (별도 RPC·테이블 없음). payload 만 양식 카탈로그 기반으로 구성:
//   { template_id, template_code, template_name, template_snapshot_html,
//     variables, contract_period, special_terms }
// /quote/<token> 외부 페이지가 stage='contract' 일 때 template_snapshot_html
// 그대로 렌더.

import Link from "next/link";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import {
  createApproval,
  sendApproval,
  resendApproval,
  getLatestApproval,
  type ApprovalLite,
} from "@/lib/quote-approvals";
import {
  listContractTemplates,
  renderTemplateWithVariables,
  buildContractVarsFromDeal,
  type ContractTemplate,
} from "@/lib/contract-templates";
import { SignatureCapture, type SignatureMethod } from "@/components/signature-capture";

type QuoteItem = {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  supplyAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  note?: string;
};
type PaymentStage = { label?: string; ratio?: number; condition?: string };

interface Props {
  dealId: string;
  companyId: string;
  readonly: boolean;
  dealName: string;
  contractTotal: number;
  partnerId: string | null;
  partnerName: string;
  partnerEmail: string;
  items: QuoteItem[];
  paymentStages: PaymentStage[];
  approval: ApprovalLite | null;
  onApprovalChange: (row: ApprovalLite | null) => void;
}

function buildQuoteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/quote/${encodeURIComponent(token)}`;
}

export function ContractStageCard({
  dealId,
  companyId,
  readonly,
  dealName,
  contractTotal,
  partnerId,
  partnerName,
  partnerEmail,
  paymentStages,
  approval,
  onApprovalChange,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [recipientEmailInput, setRecipientEmailInput] = useState(partnerEmail);
  const [sending, setSending] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<{ name: string; representative: string | null; business_number: string | null; seal_url: string | null }>({ name: "", representative: null, business_number: null, seal_url: null });
  const [partnerRep, setPartnerRep] = useState<string | null>(null);
  const [partnerBiz, setPartnerBiz] = useState<string | null>(null);

  // L 양방향: 갑(우리) 서명 모달 상태 — pending_our_signature → fully_signed 전환
  const [showOurSignModal, setShowOurSignModal] = useState(false);
  const [ourSignatureMethod, setOurSignatureMethod] = useState<SignatureMethod | null>(null);
  const [ourSignatureDataUrl, setOurSignatureDataUrl] = useState<string | null>(null);
  const [ourSubmitting, setOurSubmitting] = useState(false);
  const [ourErrMsg, setOurErrMsg] = useState<string | null>(null);

  // 양식 + 회사/거래처 정보 초기 로드
  useEffect(() => {
    (async () => {
      try {
        const list = await listContractTemplates(companyId);
        setTemplates(list);
        if (list.length > 0) {
          setSelectedTemplateId((cur) => cur || list[0].id);
        }
      } catch (e) { reportError("contract.templates.list", e); }
      try {
        const { data: co } = await (supabase as any).from("companies").select("name, representative, business_number, seal_url").eq("id", companyId).maybeSingle();
        if (co) setCompanyInfo({ name: co.name || "", representative: co.representative || null, business_number: co.business_number || null, seal_url: co.seal_url || null });
      } catch { /* ignore */ }
      if (partnerId) {
        try {
          const { data: p } = await (supabase as any).from("partners").select("representative, business_number").eq("id", partnerId).maybeSingle();
          if (p) { setPartnerRep(p.representative || null); setPartnerBiz(p.business_number || null); }
        } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, partnerId]);

  const selectedTemplate = useMemo<ContractTemplate | null>(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  // 양식 변경 시 자동 채움
  useEffect(() => {
    if (!selectedTemplate) return;
    // 결제단계 텍스트에 금액 합성 (% (₩금액) — 조건) — 핸드오프 A 매칭
    const paymentText = (paymentStages || [])
      .filter((s) => s.label || s.ratio || s.condition)
      .map((s, i) => {
        const ratio = s.ratio ?? 0;
        const amount = contractTotal > 0 ? ` (₩${Math.round((contractTotal * ratio) / 100).toLocaleString("ko-KR")})` : "";
        return `${s.label || `${i + 1}차`}: ${ratio}%${amount} — ${s.condition || ""}`;
      })
      .join("\n");
    const auto = buildContractVarsFromDeal({
      myCompanyName: companyInfo.name,
      myBusinessNumber: companyInfo.business_number,
      myRepresentative: companyInfo.representative,
      partnerName,
      partnerBusinessNumber: partnerBiz,
      partnerRepresentative: partnerRep,
      contractTotal,
      paymentStagesText: paymentText,
    });
    setVars((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const v of selectedTemplate.variables) {
        if (next[v] === undefined || next[v] === "") next[v] = auto[v] ?? "";
      }
      return next;
    });
  }, [selectedTemplate, companyInfo, partnerName, partnerRep, contractTotal, paymentStages]);

  const renderedHtml = useMemo<string>(() => {
    if (!selectedTemplate) return "";
    if (selectedTemplate.file_type === "pdf") return "";
    const body = selectedTemplate.body_html || selectedTemplate.body_markdown || "";
    return renderTemplateWithVariables(body, vars);
  }, [selectedTemplate, vars]);

  const missingVars = (selectedTemplate?.variables || []).filter((v) => !(vars[v] || "").trim());

  function buildPayload() {
    if (!selectedTemplate) throw new Error("양식이 선택되지 않았습니다");
    return {
      template_id: selectedTemplate.id,
      template_code: selectedTemplate.code,
      template_name: selectedTemplate.name,
      template_snapshot_html: renderedHtml,
      template_file_url: selectedTemplate.file_type === "pdf" ? selectedTemplate.file_url : null,
      template_file_type: selectedTemplate.file_type,
      variables: vars,
      contract_period: { start: vars["계약기간_시작"] || null, end: vars["계약기간_종료"] || null },
      special_terms: vars["특약"] || null,
    };
  }

  async function handleSend() {
    if (readonly || sending) return;
    if (!selectedTemplate) { toast("계약서 양식을 선택해 주세요", "error"); return; }
    const email = recipientEmailInput.trim();
    if (!email) { toast("거래처 이메일을 입력해 주세요", "error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("올바른 이메일 형식이 아닙니다", "error"); return; }
    // 본문 보장 가드 (2026-05-21): renderedHtml 비어있고 PDF 도 없으면 거래처가 빈 화면 받음
    const isPdf = selectedTemplate.file_type === "pdf" && !!selectedTemplate.file_url;
    if (!isPdf && !renderedHtml.trim()) {
      toast("계약서 본문이 비어있습니다. 양식 body 또는 변수 값을 확인해 주세요", "error");
      return;
    }
    setSending(true);
    try {
      const payload = buildPayload();
      let approvalId = approval?.id || null;
      let token: string | null = null;
      if (!approvalId || approval?.status !== "draft") {
        const created = await createApproval({ dealId, stage: "contract", payload, partnerId });
        approvalId = created.id;
        token = created.token;
      } else {
        // 기존 draft 재사용 시: 옛 payload 가 빈 양식일 수 있음 → 새 payload 로 강제 갱신.
        //   양식 변경·변수 채움·재발송 시 거래처가 옛 빈 본문 받는 회귀 차단.
        const { error: upErr } = await (supabase as any)
          .from('quote_approvals')
          .update({ payload })
          .eq('id', approvalId);
        if (upErr) throw upErr;
      }
      // 안전망: 어느 경로든 token 확보 (draft 재사용 분기에서 token=null 회귀 차단, d8f9aca7 estimate 와 동일 패턴)
      if (!token && approvalId) {
        const { data: row } = await (supabase as any)
          .from('quote_approvals')
          .select('approval_token')
          .eq('id', approvalId)
          .maybeSingle();
        token = row?.approval_token ?? null;
      }
      if (!token) {
        throw new Error('서명 링크 생성 실패 — 잠시 후 다시 시도해 주세요');
      }
      await sendApproval({ approvalId: approvalId!, recipientEmail: email, recipientName: partnerName || undefined, expiresInDays: 14 });
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote", stage: "contract", to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — 계약서 확인 요청` : "계약서 확인 요청",
            signUrl: buildQuoteUrl(token),
            companyName: companyInfo.name || undefined,
            amount: contractTotal || undefined,
            paymentStages: paymentStages || undefined,
          },
        });
      } catch (e) { reportError("contract.send.edge", e); }
      const latest = await getLatestApproval(dealId, "contract");
      if (latest) onApprovalChange(latest);
      queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
      toast(`거래처에 계약서가 발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`발송 실패: ${friendlyError(e, "계약서 발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  async function handleResend() {
    if (!approval?.id || sending || !selectedTemplate) return;
    const email = recipientEmailInput.trim() || partnerEmail;
    if (!email) { toast("거래처 이메일을 입력해 주세요", "error"); return; }
    setSending(true);
    try {
      const payload = buildPayload();
      const { id: newId, token } = await resendApproval({ prevId: approval.id, payload });
      await sendApproval({ approvalId: newId, recipientEmail: email, recipientName: partnerName || undefined, expiresInDays: 14 });
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote", stage: "contract", to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — 계약서 확인 요청 (재발송)` : "계약서 확인 요청 (재발송)",
            signUrl: buildQuoteUrl(token),
            companyName: companyInfo.name || undefined,
            amount: contractTotal || undefined,
            paymentStages: paymentStages || undefined,
          },
        });
      } catch (e) { reportError("contract.resend.edge", e); }
      const latest = await getLatestApproval(dealId, "contract");
      if (latest) onApprovalChange(latest);
      toast(`거래처에 계약서가 재발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`재발송 실패: ${friendlyError(e, "재발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">계약서 작성 / 발송</h3>
        {approval && <StatusBadgeMini approval={approval} />}
      </div>

      {approval?.status === "rejected" && approval.decision_note && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="text-[11px] font-bold text-red-400 mb-1">❌ 거래처가 계약서를 거절했습니다</div>
          <div className="text-[11px] text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed">{approval.decision_note}</div>
        </div>
      )}

      {/* L 양방향: 거래처 서명 완료 — 우리(갑) 서명 대기 */}
      {approval?.status === "pending_our_signature" && (
        <PendingOurSignatureCard
          approval={approval}
          onClick={() => { setOurErrMsg(null); setShowOurSignModal(true); }}
        />
      )}

      {/* L 계약 — 양측 서명 완료 (최종) 또는 우리 측 단방향 승인 완료 */}
      {(approval?.status === "fully_signed" || approval?.status === "approved") && (
        <SignedContractCard approval={approval} />
      )}

      {/* L 양방향: 우리(갑) 서명 모달 */}
      {showOurSignModal && approval && (
        <OurSignatureModal
          approval={approval}
          companyInfo={companyInfo}
          partnerName={partnerName}
          partnerRep={partnerRep}
          partnerBiz={partnerBiz}
          ourSignatureMethod={ourSignatureMethod}
          ourSignatureDataUrl={ourSignatureDataUrl}
          submitting={ourSubmitting}
          errMsg={ourErrMsg}
          onCapture={(m, u) => { setOurSignatureMethod(m); setOurSignatureDataUrl(u); }}
          onClose={() => setShowOurSignModal(false)}
          onSubmit={async () => {
            if (!ourSignatureMethod || !ourSignatureDataUrl) {
              setOurErrMsg("서명 또는 도장을 추가해 주세요");
              return;
            }
            setOurSubmitting(true); setOurErrMsg(null);
            try {
              // 양측 서명 합성 HTML — 기존 signed_contract_html (을 서명까지) 끝에 갑(우리) 서명 카드 append
              const baseHtml = await fetchSignedHtml(approval.id);
              const sealLabel = ourSignatureMethod === "draw" ? "손글씨 서명"
                              : ourSignatureMethod === "type" ? "타이핑 서명"
                              : "도장/사인";
              const signedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
              const ourBlock = `\n\n<div style="margin-top:16px;padding:20px;border:2px solid #16a34a;border-radius:12px;background:#f0fdf4">
  <div style="font-size:11px;color:#15803d;margin-bottom:8px;font-weight:bold">✍️ 우리(갑) 서명 / 날인</div>
  <div style="display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:13px;font-weight:bold;color:#111827">${companyInfo.name || "회사"}</div>
      ${companyInfo.business_number ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">사업자등록번호 ${companyInfo.business_number}</div>` : ""}
      ${companyInfo.representative ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">대표 ${companyInfo.representative}</div>` : ""}
      <div style="font-size:11px;color:#6b7280;margin-top:4px">${sealLabel} · ${signedAt} (KST)</div>
    </div>
    <div style="border:1px solid #d1fae5;background:white;padding:6px;border-radius:6px">
      <img src="${ourSignatureDataUrl}" alt="우리 서명" style="max-height:90px;max-width:200px;display:block" />
    </div>
  </div>
</div>`;
              const fullySignedHtml = (baseHtml || "") + ourBlock;
              const { data, error } = await (supabase as any).rpc("submit_our_signature", {
                p_approval_id: approval.id,
                p_signature_method: ourSignatureMethod,
                p_signature_data_url: ourSignatureDataUrl,
                p_signed_contract_html: fullySignedHtml,
                p_fully_signed_contract_url: null,
              });
              if (error) throw error;
              const res = (data || {}) as { ok?: boolean; code?: string };
              if (!res.ok) {
                const codeMap: Record<string, string> = {
                  forbidden: "권한이 없습니다. 회사 관리자만 서명 가능합니다.",
                  wrong_status: "이미 처리된 상태입니다.",
                  not_found: "계약서를 찾을 수 없습니다.",
                  unauth: "로그인이 필요합니다.",
                };
                setOurErrMsg(codeMap[res.code || ""] || "서명 처리에 실패했습니다.");
                setOurSubmitting(false);
                return;
              }
              const latest = await getLatestApproval(dealId, "contract");
              if (latest) onApprovalChange(latest);
              queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
              toast("계약 최종 성립 — 양측 서명 완료", "success");
              setShowOurSignModal(false);
              setOurSignatureMethod(null);
              setOurSignatureDataUrl(null);
            } catch (e: unknown) {
              setOurErrMsg(friendlyError(e, "서명 처리에 실패했습니다."));
            }
            setOurSubmitting(false);
          }}
        />
      )}

      {/* 양식 선택 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
            계약서 양식 선택
          </label>
          <Link href="/settings?tab=company" className="text-[10px] text-[var(--primary)] hover:underline">
            양식 관리 →
          </Link>
        </div>
        {templates.length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] py-3 text-center bg-[var(--bg)] rounded border border-dashed border-[var(--border)]">
            사용 가능한 양식이 없습니다. <Link href="/settings?tab=company" className="text-[var(--primary)] underline">양식 추가</Link>
          </div>
        ) : (
          <select
            value={selectedTemplateId}
            disabled={readonly}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.is_system ? "🔒 [시스템] " : "✏️ [자체] "}{t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 변수 입력 */}
      {selectedTemplate && selectedTemplate.file_type !== "pdf" && selectedTemplate.variables.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1.5">
            변수 입력 ({selectedTemplate.variables.length}개{missingVars.length > 0 ? ` · ${missingVars.length}개 비어있음` : ""})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {selectedTemplate.variables.map((v) => {
              const isLong = v === "특약" || v === "지급조건";
              const isDate = v.includes("기간");
              return (
                <div key={v} className={isLong ? "sm:col-span-2" : ""}>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-0.5 font-mono">{`{${v}}`}</label>
                  {isLong ? (
                    <textarea
                      value={vars[v] || ""}
                      disabled={readonly}
                      onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      rows={3}
                      placeholder={v}
                      className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)] resize-none"
                    />
                  ) : (
                    <input
                      type={isDate ? "date" : "text"}
                      value={vars[v] || ""}
                      disabled={readonly}
                      onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={v}
                      className="w-full px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 미리보기 */}
      {selectedTemplate && (
        <div>
          <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1.5">미리보기</div>
          {selectedTemplate.file_type === "pdf" ? (
            <div className="bg-white rounded p-3 text-[11px] text-gray-700 border border-[var(--border)]">
              📎 PDF 양식 — 발송 시 거래처에게 그대로 전송됩니다.{" "}
              {selectedTemplate.file_url && (
                <a href={selectedTemplate.file_url} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] underline">PDF 열기</a>
              )}
            </div>
          ) : (
            <div
              className="prose prose-sm max-w-none bg-white text-gray-900 p-4 rounded border border-[var(--border)] text-xs max-h-[300px] overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(renderedHtml) }}
            />
          )}
        </div>
      )}

      {/* 발송 */}
      {!readonly && (!approval || approval.status === "draft") && (
        <div className="pt-3 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1.5">
            거래처에 계약서 발송 {partnerName ? `· ${partnerName}` : ""}
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5">
            <input
              type="email"
              value={recipientEmailInput}
              onChange={(e) => setRecipientEmailInput(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !selectedTemplate}
              className="px-3 py-1.5 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
            >
              {sending ? "발송 중…" : "📤 거래처에 계약서 발송"}
            </button>
          </div>
          {missingVars.length > 0 && (
            <div className="mt-1.5 text-[10px] text-amber-400">⚠ {missingVars.length}개 변수가 비어있습니다 — 본문에 {"{변수명}"} 그대로 노출됩니다.</div>
          )}
          <div className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            만료: 14일 · 거래처가 승인하면 자동으로 진행 중 단계로 전환됩니다
          </div>
        </div>
      )}

      {/* 재발송 (거절 상태) */}
      {!readonly && approval?.status === "rejected" && (
        <div className="pt-3 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-amber-400 font-medium mb-1.5">거절된 계약서 — 양식·변수 수정 후 재발송</div>
          <div className="flex flex-col sm:flex-row gap-1.5">
            <input
              type="email"
              value={recipientEmailInput}
              onChange={(e) => setRecipientEmailInput(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={handleResend}
              disabled={sending}
              className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
            >
              {sending ? "재발송 중…" : "🔁 재발송"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// L 양방향: signed_contract_html fetch (RLS quote_approvals_select_admin_or_self 통과)
async function fetchSignedHtml(approvalId: string): Promise<string> {
  try {
    const { data } = await (supabase as any)
      .from("quote_approvals")
      .select("signed_contract_html")
      .eq("id", approvalId)
      .maybeSingle();
    return (data?.signed_contract_html as string) || "";
  } catch {
    return "";
  }
}

function PendingOurSignatureCard({ approval, onClick }: { approval: ApprovalLite; onClick: () => void }) {
  const partnerMethod = approval.signature_method;
  const partnerMethodLabel = partnerMethod === "draw" ? "손글씨 서명"
                            : partnerMethod === "type" ? "타이핑 서명"
                            : partnerMethod === "upload" || partnerMethod === "seal" ? "도장/사인"
                            : "서명";
  const signedAt = approval.signed_at_external
    ? new Date(approval.signed_at_external).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "—";
  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 space-y-2">
      <div className="text-[12px] font-bold text-orange-400">✍️ 거래처 서명 완료 — 우리(갑) 서명 대기</div>
      <div className="text-[11px] text-[var(--text)]">
        거래처가 {partnerMethodLabel}으로 승인했습니다 ({signedAt} KST).
        이제 우리 측 서명·도장 후 계약이 최종 성립됩니다.
      </div>
      <button
        type="button"
        onClick={onClick}
        className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition"
      >
        📝 우리 서명·도장 추가
      </button>
    </div>
  );
}

function OurSignatureModal({
  companyInfo, partnerName, partnerRep, partnerBiz,
  ourSignatureMethod, ourSignatureDataUrl, submitting, errMsg,
  onCapture, onClose, onSubmit,
}: {
  approval: ApprovalLite;
  companyInfo: { name: string; representative: string | null; business_number: string | null; seal_url: string | null };
  partnerName: string; partnerRep: string | null; partnerBiz: string | null;
  ourSignatureMethod: SignatureMethod | null;
  ourSignatureDataUrl: string | null;
  submitting: boolean;
  errMsg: string | null;
  onCapture: (m: SignatureMethod | null, u: string | null) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  // C: 회사 직인(companies.seal_url) 자동 채움 옵션
  const [usingDefaultSeal, setUsingDefaultSeal] = useState(false);
  function applyDefaultSeal() {
    if (!companyInfo.seal_url) return;
    setUsingDefaultSeal(true);
    // SignatureMethod 에 'seal' 없음 — 'upload' 로 표현 (이미 이미지 dataUrl/url 형식)
    onCapture("upload", companyInfo.seal_url);
  }
  void partnerName; void partnerRep; void partnerBiz;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">우리(갑) 서명 / 날인</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          서명·도장 추가 후 "최종 성립" 클릭 시 계약 stage 가 자동 전환됩니다.
          (회사: <strong>{companyInfo.name || "—"}</strong>{companyInfo.representative ? ` · 대표 ${companyInfo.representative}` : ""})
        </p>

        {companyInfo.seal_url && (
          <div className="mb-3 flex items-center gap-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={companyInfo.seal_url} alt="기본 직인" className="w-12 h-12 object-contain bg-white rounded" />
            <div className="flex-1 text-[11px] text-emerald-900">
              <div className="font-semibold">회사 기본 직인 등록됨</div>
              <div className="text-emerald-700">한 번 클릭으로 자동 적용</div>
            </div>
            <button
              type="button"
              onClick={applyDefaultSeal}
              className={`px-3 py-1.5 rounded text-[11px] font-bold transition ${
                usingDefaultSeal
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white"
              }`}
            >
              {usingDefaultSeal ? "✓ 적용됨" : "직인 자동 적용"}
            </button>
          </div>
        )}

        <SignatureCapture
          onChange={(m, u) => { setUsingDefaultSeal(false); onCapture(m, u); }}
        />

        {errMsg && <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{errMsg}</div>}

        <div className="mt-5 flex gap-2 justify-end pt-3 border-t border-gray-200">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-4 py-2 rounded-lg text-xs text-gray-600 hover:text-gray-900 transition">취소</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !ourSignatureDataUrl}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {submitting ? "처리 중…" : "✅ 최종 성립 (계약 완료)"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignedContractCard({ approval }: { approval: ApprovalLite }) {
  const { open: openDocViewer } = useDocumentViewer();
  const method = approval.signature_method || "none";
  const methodLabel = method === "draw" ? "✍️ 손글씨 서명"
                     : method === "type" ? "🖊 타이핑 서명"
                     : method === "upload" || method === "seal" ? "🟥 도장/사인"
                     : "서명 없음";
  const signedAt = approval.signed_at_external
    ? new Date(approval.signed_at_external).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : approval.decided_at
      ? new Date(approval.decided_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      : "—";
  const hasHtml = approval.has_signed_html === true;
  const hasPdfUrl = !!approval.signed_contract_url;

  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-emerald-400">✅ 계약 승인 완료 — 서명·날인 회수됨</div>
      </div>
      <div className="text-[11px] text-[var(--text)] space-y-0.5">
        <div>{methodLabel}{approval.recipient_name ? ` · ${approval.recipient_name}` : ""}</div>
        <div className="caption">{signedAt} (KST){approval.signer_ip ? ` · IP ${approval.signer_ip}` : ""}</div>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {hasHtml && (
          <button
            onClick={() => openDocViewer({ type: 'contract', id: approval.id })}
            className="px-3 py-1.5 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-semibold transition"
          >
            📄 서명된 계약서 보기
          </button>
        )}
        {hasPdfUrl && (
          <a
            href={approval.signed_contract_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-card)] text-[11px] font-semibold transition"
          >
            📎 PDF 다운로드
          </a>
        )}
        {!hasHtml && !hasPdfUrl && (
          <span className="caption">서명 본문이 회수되지 않았습니다.</span>
        )}
      </div>
    </div>
  );
}

function StatusBadgeMini({ approval }: { approval: ApprovalLite }) {
  const s = approval.status;
  const label = s === "sent" && approval.recipient_email ? `발송됨 (${approval.recipient_email})` : s;
  const tone =
    s === "approved" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : s === "rejected" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : s === "viewed" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
    : s === "expired" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : s === "sent" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
    : "bg-gray-500/15 text-gray-400 border-gray-500/30";
  const icon = s === "approved" ? "✅" : s === "rejected" ? "❌" : s === "viewed" ? "👁" : s === "expired" ? "⏰" : s === "sent" ? "📤" : "📝";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${tone}`}>
      <span>{icon}</span>
      <span className="truncate max-w-[180px]">{label}</span>
    </span>
  );
}

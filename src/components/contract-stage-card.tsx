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
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
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
  const [companyInfo, setCompanyInfo] = useState<{ name: string; representative: string | null }>({ name: "", representative: null });
  const [partnerRep, setPartnerRep] = useState<string | null>(null);

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
        const { data: co } = await (supabase as any).from("companies").select("name, representative").eq("id", companyId).maybeSingle();
        if (co) setCompanyInfo({ name: co.name || "", representative: co.representative || null });
      } catch { /* ignore */ }
      if (partnerId) {
        try {
          const { data: p } = await (supabase as any).from("partners").select("representative").eq("id", partnerId).maybeSingle();
          if (p) setPartnerRep(p.representative || null);
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
    const paymentText = (paymentStages || [])
      .filter((s) => s.label || s.ratio || s.condition)
      .map((s, i) => `${s.label || `${i + 1}차`}: ${s.ratio ?? 0}% — ${s.condition || ""}`)
      .join("\n");
    const auto = buildContractVarsFromDeal({
      myCompanyName: companyInfo.name,
      myRepresentative: companyInfo.representative,
      partnerName,
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
    setSending(true);
    try {
      const payload = buildPayload();
      let approvalId = approval?.id || null;
      let token: string | null = null;
      if (!approvalId || approval?.status !== "draft") {
        const created = await createApproval({ dealId, stage: "contract", payload, partnerId });
        approvalId = created.id;
        token = created.token;
      }
      await sendApproval({ approvalId: approvalId!, recipientEmail: email, recipientName: partnerName || undefined, expiresInDays: 14 });
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote", stage: "contract", to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — 계약서 확인 요청` : "계약서 확인 요청",
            signUrl: token ? buildQuoteUrl(token) : null,
            companyName: companyInfo.name || undefined,
            amount: contractTotal || undefined,
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
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
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

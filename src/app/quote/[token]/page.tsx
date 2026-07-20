"use client";

// STEP 4 (PR-A) — 외부 비로그인 견적/계약 승인 페이지.
//   URL: /quote/<token>
//   동선:
//     1) get_quote_approval_by_token RPC (anon+auth) — token 으로 1행 조회.
//        토큰 자체는 응답에 포함되지 않음 (서버측 select 에서 제외).
//     2) mark_quote_approval_viewed RPC (idempotent) — status='viewed' + viewed_at.
//     3) 승인/거절 결정 → submit_quote_decision RPC → notifications 자동 INSERT.
//
// 보안 (security-reviewer I1):
//   - referrer 0 노출: 페이지 metadata.referrer='no-referrer' (server segment).
//   - 외부 링크 0 (페이지에 외부 링크 자체 없음). 안내 텍스트만.
//   - 토큰은 URL 경로에만, 본문/로그/Sentry 0 노출.
//   - reportError 호출 시도 token 인자 미포함.
//
// 견적 단계 payload 가정: { items, paymentStages, quoteContent }
//   다른 stage(contract/progress_report/completion/settlement)는 다음 라운드.

import { useEffect, useMemo, useState } from "react";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { SignatureCapture, type SignatureMethod } from "@/components/signature-capture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

interface ApprovalRow {
  id: string;
  stage: string;
  status: string;
  payload: Record<string, unknown> | null;
  recipient_name: string | null;
  recipient_email: string | null;
  sent_at: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  deal_id: string;
  deal_name: string;
  contract_total: number | null;
  company_name: string;
  company_representative: string | null;
}

interface QuoteItem {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  supplyAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  note?: string;
}

interface PaymentStage {
  label?: string;
  ratio?: number;
  condition?: string;
}

type LoadState = "loading" | "ok" | "not_found" | "expired" | "already_decided";

// 2026-05-21 stage 라벨 분기 — 견적/계약/진척/완료/정산
const STAGE_LABEL_KO: Record<string, string> = {
  estimate: "견적서",
  contract: "계약서",
  progress_report: "진척 보고서",
  completion: "완료 확인서",
  settlement: "정산 확인",
};
function stageKo(stage: string | null | undefined): string {
  return STAGE_LABEL_KO[stage || "estimate"] || "견적서";
}

export default function QuoteApprovalPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || "");

  const [state, setState] = useState<LoadState>("loading");
  const [row, setRow] = useState<ApprovalRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decided, setDecided] = useState<{ decision: "approved" | "rejected"; stage_after?: string | null } | null>(
    null,
  );
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // L 계약 서명 모달 — stage='contract' 승인 흐름
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureMethod, setSignatureMethod] = useState<SignatureMethod | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  // 외부 서명자(을) 회사 정보 — 필수: 회사명/대표자, 선택: 사업자등록번호
  const [signerCompanyName, setSignerCompanyName] = useState("");
  const [signerBusinessNumber, setSignerBusinessNumber] = useState("");
  const [signerRepresentative, setSignerRepresentative] = useState("");

  useModalKeys(
    showSignatureModal,
    () => setShowSignatureModal(false),
    submitting || !signatureDataUrl ? undefined : () => submit("approved"),
  );

  // 1) 토큰으로 1회 fetch + viewed 처리
  useEffect(() => {
    if (!token) {
      setState("not_found");
      return;
    }
    (async () => {
      try {
        const { data, error } = await db.rpc("get_quote_approval_by_token", { p_token: token });
        if (error) {
          reportError("quote.token.fetch", { code: error.code });
          setState("not_found");
          return;
        }
        const list = Array.isArray(data) ? (data as ApprovalRow[]) : [];
        if (list.length === 0) {
          setState("not_found");
          return;
        }
        const r = list[0];
        setRow(r);

        // 만료 / 이미 결정됨 처리 — UI 분기
        if (r.status === "expired") {
          setState("expired");
          return;
        }
        if (r.status === "approved" || r.status === "rejected") {
          setState("already_decided");
          return;
        }

        setState("ok");

        // 2) viewed 마킹 (idempotent — 이미 viewed 면 no-op)
        if (r.status === "sent") {
          db.rpc("mark_quote_approval_viewed", { p_token: token }).then(
            ({ error: vErr }: { error: { code?: string } | null }) => {
              if (vErr) reportError("quote.token.viewed", { code: vErr.code });
            },
          );
        }
      } catch (e: unknown) {
        reportError("quote.token.fetch.catch", e);
        setState("not_found");
      }
    })();
    // token 변경시만 재실행 — db는 모듈 싱글톤
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 계약 단계 승인은 서명이 있어야 함 — 모달 → submit
  function handleApproveClick() {
    if (!row) return;
    if (row.stage === "contract") {
      setShowSignatureModal(true);
      return;
    }
    void submit("approved");
  }

  async function submit(decision: "approved" | "rejected") {
    if (!row || submitting) return;
    if (decision === "rejected" && !rejectNote.trim()) {
      setErrMsg("거절 사유를 입력해 주세요");
      return;
    }
    // 계약 승인 — 서명 + 을 회사 정보 필수
    const isContractApproval = decision === "approved" && row.stage === "contract";
    if (isContractApproval) {
      if (!signatureMethod || !signatureDataUrl) {
        setErrMsg("서명 또는 도장을 추가해 주세요");
        return;
      }
      if (!signerCompanyName.trim() || !signerRepresentative.trim()) {
        setErrMsg("회사명과 대표자명을 입력해 주세요");
        return;
      }
    }
    setSubmitting(true);
    setErrMsg(null);
    try {
      // 서명 합성 HTML 생성 (계약 승인 시)
      //   1) template_snapshot_html 의 {을_*} 변수 자리에 서명자 입력값 치환
      //   2) sig-box[data-role="을"] 있으면 그 안에 서명 이미지 삽입 (시스템 양식 71259ef7)
      //   3) sig-box 없으면 본문 그대로 — 페이지(/contracts/signed) 측 푸터가 별도 합성 (4eca444d)
      //   본문 끝 sig 카드 append 제거 (사용자 호소 중복 회귀 해소)
      let signedHtml: string | null = null;
      if (isContractApproval) {
        const p = (row.payload || {}) as { template_snapshot_html?: string };
        const baseHtml = typeof p.template_snapshot_html === "string" ? p.template_snapshot_html : "";
        const signerName = signerRepresentative.trim() || row.recipient_name || "거래처";
        const signerCo = signerCompanyName.trim();
        const signerBiz = signerBusinessNumber.trim();
        // 변수 치환 — 양식 본문의 {을_*} 자리 채움
        const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const subst = (html: string, key: string, val: string) =>
          html.replace(new RegExp(`\\{\\s*${escRe(key)}\\s*\\}`, "g"), val);
        let body = baseHtml;
        body = subst(body, "을_회사명", signerCo);
        body = subst(body, "을_사업자번호", signerBiz);
        body = subst(body, "을_대표자", signerName);
        // v1 alias 호환
        body = subst(body, "을사명", signerCo);
        body = subst(body, "대표자_을", signerName);

        // 시스템 양식 sig-box 안에 서명 삽입 (있을 때만). 옛 양식·자유 본문은 페이지 푸터가 처리.
        const sigBoxRe = /(<span class="sig-box"\s+data-role="을"[^>]*>)([\s\S]*?)(<\/span>)/;
        if (signatureDataUrl && sigBoxRe.test(body)) {
          const sigInline = signatureMethod === "type"
            ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font-family:'Nanum Pen Script',cursive;font-size:28px;color:#111">${signatureDataUrl}</span>`
            : `<img src="${signatureDataUrl}" alt="" style="width:100%;height:100%;object-fit:contain"/>`;
          body = body.replace(sigBoxRe, `$1${sigInline}$3`);
        }
        signedHtml = body;
      }

      const { data, error } = await db.rpc("submit_quote_decision", {
        p_token: token,
        p_decision: decision,
        p_note: decision === "rejected" ? rejectNote.trim() : undefined,
        p_signature_method: isContractApproval ? signatureMethod ?? undefined : undefined,
        p_signature_data_url: isContractApproval ? signatureDataUrl ?? undefined : undefined,
        p_signed_contract_url: undefined,  // PDF Storage 는 후속 라운드
        p_signed_contract_html: signedHtml ?? undefined,
        p_signer_ip: undefined,             // RLS 안에서 서버측 inet 추출은 RPC 한계 — 클라 미전달
        p_signer_user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : undefined,
        p_signer_company_name: isContractApproval ? signerCompanyName.trim() : undefined,
        p_signer_business_number: isContractApproval ? signerBusinessNumber.trim() || undefined : undefined,
        p_signer_representative: isContractApproval ? signerRepresentative.trim() : undefined,
      });
      if (error) {
        reportError("quote.token.submit", { code: error.code });
        setErrMsg(friendlyError(error, "결정 접수에 실패했습니다. 잠시 후 다시 시도해 주세요."));
        setSubmitting(false);
        return;
      }
      const res = (data || {}) as { ok?: boolean; code?: string; deal_stage_after?: string };
      if (!res.ok) {
        const codeMap: Record<string, string> = {
          expired: "이 링크는 만료되었습니다. 발송자에게 재발송을 요청해 주세요.",
          already_decided: "이미 결정이 접수된 요청입니다.",
          invalid: "유효하지 않은 요청입니다. 발송자에게 문의해 주세요.",
        };
        const msg = (res.code && codeMap[res.code]) || "결정 접수에 실패했습니다.";
        setErrMsg(msg);
        // 만료/이미결정 → 상태 갱신
        if (res.code === "expired") setState("expired");
        if (res.code === "already_decided") setState("already_decided");
        setSubmitting(false);
        return;
      }
      setDecided({ decision, stage_after: res.deal_stage_after ?? null });
      setShowSignatureModal(false);
      setSubmitting(false);
    } catch (e: unknown) {
      reportError("quote.token.submit.catch", e);
      setErrMsg(friendlyError(e, "결정 접수에 실패했습니다."));
      setSubmitting(false);
    }
  }

  // 만료일 계산
  const expiresLabel = useMemo(() => {
    if (!row?.expires_at) return null;
    try {
      const d = new Date(row.expires_at);
      return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return null;
    }
  }, [row?.expires_at]);

  // 견적 payload 파싱 (stage='estimate' 기준)
  const items = useMemo<QuoteItem[]>(() => {
    const p = (row?.payload || {}) as { items?: QuoteItem[]; quoteItems?: QuoteItem[] };
    return Array.isArray(p.items) ? p.items : Array.isArray(p.quoteItems) ? p.quoteItems : [];
  }, [row?.payload]);

  const stages = useMemo<PaymentStage[]>(() => {
    const p = (row?.payload || {}) as { paymentStages?: PaymentStage[]; paymentSchedule?: PaymentStage[] };
    return Array.isArray(p.paymentStages)
      ? p.paymentStages
      : Array.isArray(p.paymentSchedule)
      ? p.paymentSchedule
      : [];
  }, [row?.payload]);

  const quoteContent = useMemo(() => {
    const p = (row?.payload || {}) as { quoteContent?: string };
    return typeof p.quoteContent === "string" ? p.quoteContent : "";
  }, [row?.payload]);

  const grandTotal = items.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

  // L 계약: stage='contract' 의 payload — template_snapshot_html / PDF URL
  const contractSnapshot = useMemo<{ html: string | null; fileUrl: string | null; fileType: string | null; templateName: string | null }>(() => {
    const p = (row?.payload || {}) as {
      template_snapshot_html?: string;
      template_file_url?: string;
      template_file_type?: string;
      template_name?: string;
    };
    return {
      html: typeof p.template_snapshot_html === "string" && p.template_snapshot_html.trim() ? p.template_snapshot_html : null,
      fileUrl: typeof p.template_file_url === "string" ? p.template_file_url : null,
      fileType: typeof p.template_file_type === "string" ? p.template_file_type : null,
      templateName: typeof p.template_name === "string" ? p.template_name : null,
    };
  }, [row?.payload]);

  // ──────────────────────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────────────────────

  if (state === "loading") {
    return (
      <Shell>
        <div className="text-center text-sm text-gray-500 py-20">불러오는 중…</div>
      </Shell>
    );
  }

  if (state === "not_found") {
    return (
      <Shell>
        <Notice
          icon="🔒"
          title="요청을 찾을 수 없습니다"
          message="이 링크는 만료되었거나 유효하지 않습니다. 발송자에게 문의해 주세요."
        />
      </Shell>
    );
  }

  if (state === "expired") {
    return (
      <Shell>
        <Notice
          icon="⏰"
          title="링크가 만료되었습니다"
          message="발송자에게 재발송을 요청해 주세요. 보안을 위해 만료된 링크는 재사용할 수 없습니다."
        />
      </Shell>
    );
  }

  if (state === "already_decided") {
    return (
      <Shell>
        <Notice
          icon="✓"
          title="이미 결정이 접수된 요청입니다"
          message={
            row?.status === "approved"
              ? "승인 결정이 이미 접수되어 발송자에게 전달되었습니다."
              : "거절 결정이 이미 접수되어 발송자에게 전달되었습니다."
          }
        />
      </Shell>
    );
  }

  // 결정 완료 화면
  if (decided) {
    return (
      <Shell>
        <Notice
          icon={decided.decision === "approved" ? "✅" : "❌"}
          title={decided.decision === "approved" ? "승인이 접수되었습니다" : "거절이 접수되었습니다"}
          message={
            decided.decision === "approved"
              ? "발송자에게 결과가 전달되었습니다. 다음 단계(계약)로 자동 진행됩니다."
              : "발송자에게 사유와 함께 결과가 전달되었습니다."
          }
        />
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            화면 새로고침
          </button>
        </div>
      </Shell>
    );
  }

  // 메인 카드 — 결정 대기 상태
  if (!row) return null;
  const stageLabel = stageKo(row.stage);
  return (
    <Shell>
      <div className="quote-approval-card">
        {/* 헤더 */}
        <div className="quote-approval-header">
          <div className="text-xs opacity-80 mb-1">{row.company_name} 발송</div>
          <h1 className="text-xl font-bold">{stageLabel} 확인 요청</h1>
          {row.recipient_name && (
            <p className="text-xs opacity-90 mt-1">{row.recipient_name}님께</p>
          )}
        </div>

        {/* 본문 */}
        <div className="quote-approval-body">
          {/* 회사 정보 */}
          <section>
            <Label>발송 회사</Label>
            <div className="text-sm font-semibold text-gray-900">{row.company_name}</div>
            {row.company_representative && (
              <div className="text-xs text-gray-500 mt-0.5">대표 {row.company_representative}</div>
            )}
          </section>

          {/* 프로젝트 명 */}
          <section>
            <Label>프로젝트</Label>
            <div className="text-sm font-semibold text-gray-900">{row.deal_name}</div>
            {contractSnapshot.templateName && (
              <div className="text-[11px] text-gray-500 mt-1">양식: {contractSnapshot.templateName}</div>
            )}
          </section>

          {/* L 계약: stage='contract' — 양식 본문(template_snapshot_html) 또는 PDF 직접 노출.
              2026-05-21 보강: 둘 다 null 일 때 fallback 메시지 (옛 견적/공백 회귀 차단) */}
          {row.stage === "contract" && (
            <section className="contract-body-section">
              <Label>{stageLabel} 본문</Label>
              {contractSnapshot.html ? (
                <div
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50 text-xs max-h-[500px] overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(contractSnapshot.html) }}
                />
              ) : contractSnapshot.fileUrl ? (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-xs text-gray-700">
                  📎 PDF 양식 — <a href={contractSnapshot.fileUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline font-semibold">PDF 열어서 확인</a>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 text-xs text-gray-500 text-center">
                  계약서 본문이 등록되지 않았습니다. 발송자에게 문의하세요.
                </div>
              )}
            </section>
          )}

          {/* 진척/완료/정산 stage — 다음 라운드 정식 본문 양식. 우선 stub 으로 빈 화면 회귀 차단 */}
          {row.stage && !["estimate", "contract"].includes(row.stage) && (
            <section>
              <Label>{stageLabel}</Label>
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 text-xs text-gray-500 text-center">
                {stageLabel} 단계 본문은 준비 중입니다. 발송자에게 문의해 주세요.
              </div>
            </section>
          )}

          {/* 품목 표 — estimate 또는 contract 미상시 fallback */}
          {items.length > 0 && row.stage !== "contract" && (
            <section className="quote-items-table-section">
              <Label>{stageLabel} 품목 ({items.length}건)</Label>
              <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-gray-600">
                      <th className="text-left px-3 py-2 font-medium">품명</th>
                      <th className="text-right px-3 py-2 font-medium w-14">수량</th>
                      <th className="text-right px-3 py-2 font-medium w-20">단가</th>
                      <th className="text-right px-3 py-2 font-medium w-20">공급</th>
                      <th className="text-right px-3 py-2 font-medium w-16">세액</th>
                      <th className="text-right px-3 py-2 font-medium w-24">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-900">{it.name || "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{Number(it.quantity || 0)}</td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {Number(it.unitPrice || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {Number(it.supplyAmount || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {Number(it.taxAmount || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">
                          {Number(it.totalAmount || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-xs font-bold text-gray-700">
                        총액 (VAT 포함)
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-indigo-700">
                        ₩{grandTotal.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* 결제 단계 — estimate 또는 contract 미상시 fallback */}
          {stages.length > 0 && row.stage !== "contract" && (
            <section className="payment-stages-section">
              <Label>결제 단계 ({stages.length}단계)</Label>
              <div className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                {stages.map((st, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-800">
                      {st.label || `${idx + 1}차`} · {Number(st.ratio || 0)}%
                    </span>
                    <span className="text-gray-500">{st.condition || "—"}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 견적 내용 / 비고 */}
          {quoteContent && (
            <section>
              <Label>비고</Label>
              <div className="border border-gray-200 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap">
                {quoteContent}
              </div>
            </section>
          )}

          {/* 메타 */}
          <section className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <Label>발송일</Label>
              <div className="text-gray-800">
                {row.sent_at ? new Date(row.sent_at).toLocaleDateString("ko-KR") : "—"}
              </div>
            </div>
            <div>
              <Label>응답 기한</Label>
              <div className="text-gray-800">{expiresLabel || "—"}</div>
            </div>
          </section>

          {/* 결정 영역 */}
          <section className="decision-section">
            {errMsg && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/25 text-xs text-[var(--danger)]">
                {errMsg}
              </div>
            )}
            {!showRejectInput ? (
              <div className="decision-buttons-row">
                <button
                  type="button"
                  onClick={handleApproveClick}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition"
                >
                  {submitting ? "처리 중…" : row.stage === "contract" ? "✍️ 서명 후 승인" : "승인하기"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRejectInput(true)}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 transition"
                >
                  거절하기
                </button>
              </div>
            ) : (
              <div className="reject-note-form">
                <Label>거절 사유 (필수)</Label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={4}
                  placeholder="수정이 필요한 항목, 가격 협상 의견 등을 적어주세요"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 resize-none"
                  maxLength={500}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRejectInput(false)}
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 disabled:opacity-50 transition"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("rejected")}
                    disabled={submitting || !rejectNote.trim()}
                    className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition"
                  >
                    {submitting ? "처리 중…" : "거절 사유 보내기"}
                  </button>
                </div>
              </div>
            )}
            <p className="mt-3 text-[10px] text-gray-400 text-center">
              결정은 즉시 발송자에게 전달되며, 이후 변경할 수 없습니다.
            </p>
          </section>
        </div>
      </div>

      {/* L 계약: stage='contract' 승인 시 서명 모달 */}
      {showSignatureModal && (
        <div className="signature-modal-overlay fixed inset-0" onClick={() => setShowSignatureModal(false)}>
          <div
            className="signature-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">계약서 서명</h2>
              <button onClick={() => setShowSignatureModal(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>
            <p className="text-xs text-gray-600 mb-4">아래 회사 정보를 입력하고 서명/도장을 추가한 뒤 승인해 주세요. 서명이 합성된 계약서가 발송자에게 즉시 회수됩니다.</p>

            {/* 을(거래처) 정보 입력 — 계약서 갑/을 영역 자동 채움 */}
            <div className="mb-4 space-y-2">
              <div className="text-[11px] font-semibold text-gray-700">우리(을) 회사 정보</div>
              <input
                type="text"
                value={signerCompanyName}
                onChange={(e) => setSignerCompanyName(e.target.value)}
                placeholder="회사명 *"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                required
              />
              <input
                type="text"
                value={signerBusinessNumber}
                onChange={(e) => setSignerBusinessNumber(e.target.value)}
                placeholder="사업자등록번호 (예: 123-45-67890)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signerRepresentative}
                onChange={(e) => setSignerRepresentative(e.target.value)}
                placeholder="대표자명 *"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="text-[11px] font-semibold text-gray-700 mb-2">서명 / 도장</div>
            <SignatureCapture
              onChange={(m, url) => { setSignatureMethod(m); setSignatureDataUrl(url); }}
            />

            {errMsg && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/25 text-xs text-[var(--danger)]">{errMsg}</div>
            )}

            <div className="mt-5 flex gap-2 justify-end pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowSignatureModal(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-xs text-gray-600 hover:text-gray-900 transition"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => submit("approved")}
                disabled={submitting || !signatureDataUrl}
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {submitting ? "처리 중…" : "✅ 서명 완료 → 계약 승인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ──────────────────────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="quote-approval-shell">
      <div className="max-w-2xl mx-auto">{children}</div>
      <p className="text-[10px] text-gray-400 text-center mt-8">
        Powered by OwnerView · 본 페이지는 안전한 1회용 링크로 보호됩니다
      </p>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">{children}</div>;
}

function Notice({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="quote-notice-card">
      <div className="text-4xl mb-3">{icon}</div>
      <h1 className="text-lg font-bold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}

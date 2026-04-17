"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { getCurrentUser, getDocuments, getDocTemplates, getDeals, getTaxInvoices, getDocument, getDocRevisions, getDocApprovals } from "@/lib/queries";
import { createBlankDocument, createFromTemplate, DOC_TYPES, DOC_STATUS } from "@/lib/documents";
import { saveRevision, submitForReview, approveDocument, lockDocument } from "@/lib/documents";
import { createTaxInvoice, issueTaxInvoice, INVOICE_TYPES, INVOICE_STATUS } from "@/lib/tax-invoice";
import { forceApproveDocument } from "@/lib/deal-pipeline";
import { classifyDocument, getDocTypeInfo, DOC_INTEL_TYPES, saveDocumentIntelligence, extractContractFields } from "@/lib/doc-intelligence";
import { createSignatureRequest, getSignatureRequests, getDocumentSignatures, updateSignatureStatus, saveSignature, cancelSignature, getSignatureStatusInfo, SIGNATURE_STATUS, applyCompanySeal, sendSignatureEmail, createBulkSignatureRequests, sendSignatureReminder, bulkSendReminders, getDocumentSignatureAudit } from "@/lib/signatures";
import { createNotification } from "@/lib/notifications";
import { uploadFile, getFilesForDocument, createFolder, getFolders, deleteFolder, searchFiles, deleteFile } from "@/lib/file-storage";
import { generateDocumentPDF, generateQuotePDF, issueDocument } from "@/lib/document-generator";
import { FileUploadMulti } from "@/components/file-upload-multi";
import { FileList } from "@/components/file-list";
import { QueryErrorBanner } from "@/components/query-status";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/models";
import { useToast } from "@/components/toast";

const db = supabase as any;

// ── Document Detail (previously documents/[id]/client.tsx) ──

function DocumentDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [comment, setComment] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [showSignRequestForm, setShowSignRequestForm] = useState(false);
  const [signForm, setSignForm] = useState({ signerName: "", signerEmail: "", signerPhone: "" });
  const [bulkSigners, setBulkSigners] = useState<{ name: string; email: string; phone: string }[]>([{ name: "", email: "", phone: "" }]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [reminderSendingId, setReminderSendingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "revisions" | "approvals">("content");
  // 품목/결제조건/직인 상태
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editPaymentSchedule, setEditPaymentSchedule] = useState<any[]>([]);
  const [sealApplying, setSealApplying] = useState(false);
  const [showSelfSign, setShowSelfSign] = useState(false);
  const [selfSignName, setSelfSignName] = useState("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userName, setUserName] = useState<string>("");
  // 공유 이메일 입력 UI 상태
  const [showShareEmailInput, setShowShareEmailInput] = useState(false);
  const [shareEmailAddress, setShareEmailAddress] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareSending, setShareSending] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); setUserEmail(u.email || ""); setUserName(u.name || ""); }
    });
  }, []);

  const { data: docSignatures = [] } = useQuery({
    queryKey: ["doc-signatures", id],
    queryFn: () => getDocumentSignatures(id),
    enabled: !!id,
  });

  const signRequestMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("Not ready");
      const result = await createSignatureRequest({
        companyId,
        documentId: id,
        title: doc?.name || "서명 요청",
        signerName: signForm.signerName,
        signerEmail: signForm.signerEmail,
        signerPhone: signForm.signerPhone || undefined,
        createdBy: userId,
      });
      // Send signature email with sign link
      const emailResult = await sendSignatureEmail(result.id);
      if (emailResult.error) console.warn(emailResult.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
      setShowSignRequestForm(false);
      setSignForm({ signerName: "", signerEmail: "", signerPhone: "" });
    },
  });

  const bulkSignMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("Not ready");
      const valid = bulkSigners.filter((s) => s.name.trim() && s.email.trim());
      if (valid.length === 0) throw new Error("최소 1명의 서명자(이름+이메일) 필요");
      return createBulkSignatureRequests({
        companyId,
        documentId: id,
        title: doc?.name || "서명 요청",
        signers: valid,
        createdBy: userId,
        sendEmails: true,
      });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
      queryClient.invalidateQueries({ queryKey: ["doc-sign-audit", id] });
      setShowSignRequestForm(false);
      setBulkSigners([{ name: "", email: "", phone: "" }]);
      toast(`서명 요청 ${r.created}건 생성 · 메일 발송 ${r.sent}건${r.failed ? ` (실패 ${r.failed})` : ""}`, r.failed > 0 ? "error" : "success");
    },
    onError: (err: any) => toast(err.message, "error"),
  });

  const { data: signAudit = [] } = useQuery({
    queryKey: ["doc-sign-audit", id, companyId],
    queryFn: () => getDocumentSignatureAudit(companyId!, id),
    enabled: !!id && !!companyId && showAuditLog,
  });

  const sendReminder = async (sigId: string) => {
    setReminderSendingId(sigId);
    try {
      const r = await sendSignatureReminder(sigId);
      if (r.success) toast("리마인더가 발송되었습니다", "success");
      else toast(r.error || "리마인더 발송 실패", "error");
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
      queryClient.invalidateQueries({ queryKey: ["doc-sign-audit", id] });
    } finally {
      setReminderSendingId(null);
    }
  };

  const sendAllReminders = async () => {
    const pending = (docSignatures as any[]).filter((s) => s.status === "sent" || s.status === "viewed" || s.status === "pending");
    if (pending.length === 0) {
      toast("리마인더 보낼 진행 중 서명이 없습니다", "error");
      return;
    }
    const r = await bulkSendReminders(pending.map((s: any) => s.id));
    toast(`리마인더 발송: 성공 ${r.sent}건${r.failed ? ` / 실패 ${r.failed}건` : ""}`, r.failed > 0 ? "error" : "success");
    queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
    queryClient.invalidateQueries({ queryKey: ["doc-sign-audit", id] });
  };

  const { data: doc } = useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id, companyId!),
    enabled: !!id && !!companyId,
  });

  const { data: revisions = [] } = useQuery({
    queryKey: ["doc-revisions", id],
    queryFn: () => getDocRevisions(id),
    enabled: !!id,
  });

  const { data: approvals = [] } = useQuery({
    queryKey: ["doc-approvals", id],
    queryFn: () => getDocApprovals(id),
    enabled: !!id,
  });

  useEffect(() => {
    if (doc?.content_json) {
      const cj = doc.content_json as any;
      if (cj.body) {
        setEditContent(cj.body);
      } else if (cj.sections && Array.isArray(cj.sections)) {
        setEditContent(cj.sections.map((s: any) => `## ${s.title || ""}\n${s.content || ""}`).join("\n\n"));
      } else {
        setEditContent(JSON.stringify(cj, null, 2));
      }
      // Sync items & paymentSchedule
      if (Array.isArray(cj.items) && cj.items.length > 0) {
        setEditItems(cj.items);
      }
      if (Array.isArray(cj.paymentSchedule) && cj.paymentSchedule.length > 0) {
        setEditPaymentSchedule(cj.paymentSchedule);
      }
    }
  }, [doc?.content_json]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["document", id] });
    queryClient.invalidateQueries({ queryKey: ["doc-revisions", id] });
    queryClient.invalidateQueries({ queryKey: ["doc-approvals", id] });
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const cj = { ...(doc?.content_json as any || {}), body: editContent };
      // 품목 데이터 포함
      if (editItems.length > 0) cj.items = editItems;
      // 결제조건 데이터 포함
      if (editPaymentSchedule.length > 0) cj.paymentSchedule = editPaymentSchedule;
      return saveRevision({
        documentId: id,
        authorId: userId!,
        contentJson: cj as unknown as Json,
        comment: comment || undefined,
      });
    },
    onSuccess: () => { invalidate(); setComment(""); },
  });

  const submitMut = useMutation({
    mutationFn: () => submitForReview(id),
    onSuccess: invalidate,
  });

  const approveMut = useMutation({
    mutationFn: () => approveDocument(id, userId!, approvalComment || undefined),
    onSuccess: () => { invalidate(); setShowApprovalForm(false); setApprovalComment(""); },
  });

  const lockMut = useMutation({
    mutationFn: () => lockDocument(id, userId || undefined),
    onSuccess: invalidate,
  });

  if (!doc) {
    return (
      <div className="max-w-[900px] py-20 text-center text-sm text-[var(--text-muted)]">
        문서를 불러오는 중...
      </div>
    );
  }

  const status = doc.status || "draft";
  const sc = (DOC_STATUS as any)[status] || DOC_STATUS.draft;
  const isLocked = status === "locked" || status === "executed";
  const canEdit = status === "draft" || status === "review";
  const canSubmit = status === "draft";
  const canApprove = status === "review";
  const canLock = status === "approved";
  const canForceApprove = status === "draft" || status === "review";
  const contentType = (doc.content_json as any)?.type || "contract";

  // Auto-classification badge
  const autoType = (doc as any).auto_classified_type;
  const autoTypeInfo = autoType ? getDocTypeInfo(autoType) : null;

  return (
    <div className="max-w-[900px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition">
          &larr; 문서 목록
        </button>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold">{doc.name}</h1>
            <span className={`text-xs px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {autoTypeInfo && (
              <span className={`text-xs px-2.5 py-1 rounded-full ${autoTypeInfo.color}`}>
                {autoTypeInfo.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
            <span>v{doc.version}</span>
            <span>|</span>
            <span>{contentType}</span>
            {(doc as any).deals?.name && (
              <>
                <span>|</span>
                <span>딜: {(doc as any).deals.name}</span>
              </>
            )}
            {(doc as any).users?.name && (
              <>
                <span>|</span>
                <span>작성자: {(doc as any).users.name || (doc as any).users.email}</span>
              </>
            )}
            {doc.locked_at && (
              <>
                <span>|</span>
                <span>잠금: {new Date(doc.locked_at).toLocaleDateString("ko")}</span>
              </>
            )}
            {(doc as any).contract_start_date && (
              <>
                <span>|</span>
                <span>계약기간: {(doc as any).contract_start_date} ~ {(doc as any).contract_end_date || '미정'}</span>
              </>
            )}
            {(doc as any).contract_amount && (
              <>
                <span>|</span>
                <span>계약금액: ₩{Number((doc as any).contract_amount).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!companyId) return;
              try {
                const company = await db.from('companies').select('*').eq('id', companyId).single();
                const companyName = company.data?.name || '';
                const cType = (doc as any).content_type || '';
                const isQuote = cType === 'invoice' || cType === 'quote';
                let pdfBlob: Blob;

                if (isQuote) {
                  // 견적서 전용 PDF - 담당자/계좌 포함
                  const cj = (doc as any).content_json || {};
                  const rawItems = editItems.length > 0 ? editItems : (cj.items || []);
                  const items = rawItems.map((it: any) => ({
                    name: it.name || '',
                    spec: it.note || it.spec || '',
                    qty: Number(it.quantity) || 1,
                    unitPrice: Number(it.unitPrice) || 0,
                    amount: Number(it.supplyAmount) || (Number(it.quantity || 1) * Number(it.unitPrice || 0)),
                  }));
                  const supplyAmt = items.reduce((s: number, i: any) => s + i.amount, 0);
                  const taxAmt = Math.round(supplyAmt * 0.1);
                  // 회사 대표 계좌 가져오기
                  const { data: bankAcct } = await db.from('bank_accounts').select('bank_name, account_number, alias').eq('company_id', companyId).eq('is_primary', true).limit(1).single();
                  // 담당자: 현재 사용자 이름
                  const { data: currentUser } = await db.from('users').select('name, email').eq('id', userId).single();

                  pdfBlob = await generateQuotePDF({
                    documentNumber: (doc as any).document_number || '-',
                    companyInfo: {
                      name: companyName,
                      representative: company.data?.representative,
                      address: company.data?.address,
                      phone: company.data?.phone,
                      businessNumber: company.data?.business_number,
                    },
                    counterparty: cj.counterpartyName || cj.partnerName || '-',
                    items,
                    supplyAmount: supplyAmt,
                    taxAmount: taxAmt,
                    totalAmount: supplyAmt + taxAmt,
                    validUntil: cj.validUntil || '견적일로부터 30일',
                    notes: cj.notes || '',
                    sealUrl: (doc as any).seal_applied ? company.data?.seal_url : undefined,
                    managerName: currentUser?.name || undefined,
                    managerContact: currentUser?.email || company.data?.phone || undefined,
                    bankInfo: bankAcct ? { bankName: bankAcct.bank_name, accountNumber: bankAcct.account_number, accountHolder: bankAcct.alias || companyName } : undefined,
                    deliveryDate: cj.deliveryDate || undefined,
                  });
                } else {
                  pdfBlob = await generateDocumentPDF({
                    title: doc.name,
                    content: editContent,
                    companyName,
                    companyInfo: company.data ? {
                      representative: company.data.representative,
                      address: company.data.address,
                      businessNumber: company.data.business_number,
                    } : undefined,
                  });
                }
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${doc.name}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err: any) {
                toast('PDF 생성 실패: ' + (err?.message || err), "error");
              }
            }}
            className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-semibold hover:bg-red-500/20 transition">
            PDF 다운로드
          </button>
          <button
            onClick={async () => {
              if (!companyId || !userId) return;
              try {
                await issueDocument(id, userId, companyId);
                toast('문서번호가 발급되었습니다.', "success");
                invalidate();
              } catch (err: any) {
                toast('문서번호 발급 실패: ' + (err?.message || err), "error");
              }
            }}
            className="px-4 py-2 bg-teal-500/10 text-teal-500 rounded-lg text-xs font-semibold hover:bg-teal-500/20 transition">
            문서번호 발급
          </button>
          <button onClick={() => setShowSignRequestForm(!showSignRequestForm)}
            className="px-4 py-2 bg-indigo-500/10 text-indigo-500 rounded-lg text-xs font-semibold hover:bg-indigo-500/20 transition">
            서명 요청
          </button>
          <button
            onClick={async () => {
              if (!companyId || !userId) return;
              try {
                const { createDocumentShare } = await import("@/lib/document-sharing");
                const result = await createDocumentShare({
                  documentId: id,
                  companyId,
                  createdBy: userId,
                  allowFeedback: true,
                  expiresInDays: 30,
                });
                await navigator.clipboard.writeText(result.shareUrl);
                setShareUrl(result.shareUrl);
                setShowShareEmailInput(true);
                setShareEmailAddress("");
                invalidate();
              } catch (err: any) {
                toast('공유 링크 생성 실패: ' + (err?.message || err), "error");
              }
            }}
            className="px-4 py-2 bg-purple-500/10 text-purple-500 rounded-lg text-xs font-semibold hover:bg-purple-500/20 transition">
            공유 링크
          </button>
          {canSubmit && (
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="px-4 py-2 bg-yellow-500/10 text-yellow-400 rounded-lg text-xs font-semibold hover:bg-yellow-500/20 transition disabled:opacity-50">
              검토 요청
            </button>
          )}
          {canApprove && (
            <button onClick={() => setShowApprovalForm(!showApprovalForm)}
              className="px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-500/20 transition">
              승인
            </button>
          )}
          {canForceApprove && (
            <button
              onClick={async () => {
                if (!companyId || !userId) return;
                const reason = window.prompt('임의 승인 사유를 입력하세요:', '업체 미응답으로 임의 승인');
                if (reason === null) return;
                try {
                  await forceApproveDocument({ documentId: id, companyId, approverId: userId, reason });
                  invalidate();
                  toast('임의 승인이 완료되었습니다.', "success");
                } catch (err: any) {
                  toast('임의 승인 실패: ' + (err?.message || ''), "error");
                }
              }}
              className="px-4 py-2 bg-amber-500/10 text-amber-400 rounded-lg text-xs font-semibold hover:bg-amber-500/20 transition">
              임의 승인
            </button>
          )}
          {canLock && (
            <button onClick={() => lockMut.mutate()} disabled={lockMut.isPending}
              className="px-4 py-2 bg-purple-500/10 text-purple-400 rounded-lg text-xs font-semibold hover:bg-purple-500/20 transition disabled:opacity-50">
              잠금 (체결)
            </button>
          )}
        </div>
      </div>

      {showApprovalForm && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-blue-400 mb-3">문서 승인</h3>
          <textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)}
            placeholder="승인 코멘트 (선택)"
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-blue-500 mb-3 h-20 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              승인 확인
            </button>
            <button onClick={() => setShowApprovalForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button>
          </div>
        </div>
      )}

      {/* Inline Share Email Input */}
      {showShareEmailInput && shareUrl && (
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-purple-500">공유 링크 생성 완료</h3>
            <button onClick={() => { setShowShareEmailInput(false); setShareUrl(""); }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">
              닫기
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3 p-2.5 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
            <span className="text-xs text-[var(--text-muted)] truncate flex-1">{shareUrl}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(shareUrl); }}
              className="px-2 py-1 text-xs bg-purple-500/10 text-purple-500 rounded font-semibold hover:bg-purple-500/20 transition whitespace-nowrap">
              복사
            </button>
          </div>
          <div className="text-xs text-[var(--text-muted)] mb-2">이메일로 공유 링크를 발송하려면 수신자 이메일을 입력하세요.</div>
          <div className="flex gap-2 items-center">
            <input
              type="email"
              value={shareEmailAddress}
              onChange={(e) => setShareEmailAddress(e.target.value)}
              placeholder="recipient@example.com"
              onKeyDown={(e) => { if (e.key === 'Enter' && shareEmailAddress.trim()) { (e.target as HTMLInputElement).form?.requestSubmit(); } }}
              className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500"
            />
            <button
              disabled={!shareEmailAddress.trim() || shareSending}
              onClick={async () => {
                if (!shareEmailAddress.trim() || !companyId || !userId) return;
                setShareSending(true);
                try {
                  const { sendShareEmail } = await import("@/lib/document-sharing");
                  const company = await db.from('companies').select('name').eq('id', companyId).single();
                  const res = await sendShareEmail({
                    email: shareEmailAddress.trim(),
                    documentName: doc.name,
                    shareUrl,
                    senderName: userName || undefined,
                    companyName: company.data?.name || undefined,
                  });
                  if (res.success) {
                    setShareEmailAddress("");
                    setShowShareEmailInput(false);
                    setShareUrl("");
                    toast('이메일이 발송되었습니다.', "success");
                  } else {
                    toast('이메일 발송 실패: ' + (res.error || ''), "error");
                  }
                } catch (err: any) {
                  toast('이메일 발송 실패: ' + (err?.message || err), "error");
                } finally {
                  setShareSending(false);
                }
              }}
              className="px-4 py-2.5 bg-purple-500 text-white rounded-xl text-xs font-semibold disabled:opacity-50 hover:bg-purple-600 transition whitespace-nowrap">
              {shareSending ? '발송 중...' : '이메일 발송'}
            </button>
          </div>
        </div>
      )}

      {/* Signature Request Form (multi-signer) */}
      {showSignRequestForm && (
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-indigo-500">전자서명 요청 ({bulkSigners.length}명)</h3>
            <button
              onClick={() => setBulkSigners([...bulkSigners, { name: "", email: "", phone: "" }])}
              className="text-xs px-3 py-1.5 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 rounded-lg font-semibold transition"
            >
              + 서명자 추가
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mb-3">여러 명에게 동시에 서명 요청을 보낼 수 있습니다. 각 서명자는 개별 링크를 받습니다.</p>

          <div className="space-y-2 mb-4">
            {bulkSigners.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-12 sm:col-span-3">
                  <input
                    value={s.name}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].name = e.target.value; setBulkSigners(arr); }}
                    placeholder={`서명자 ${i + 1} 이름 *`}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="email"
                    value={s.email}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].email = e.target.value; setBulkSigners(arr); }}
                    placeholder="이메일 *"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="col-span-10 sm:col-span-3">
                  <input
                    type="tel"
                    value={s.phone}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].phone = e.target.value; setBulkSigners(arr); }}
                    placeholder="전화 (선택)"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  {bulkSigners.length > 1 && (
                    <button
                      onClick={() => setBulkSigners(bulkSigners.filter((_, idx) => idx !== i))}
                      className="text-xs px-2 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition"
                      title="삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => bulkSignMut.mutate()}
              disabled={bulkSignMut.isPending || bulkSigners.every((s) => !s.name.trim() || !s.email.trim())}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
            >
              {bulkSignMut.isPending ? "발송 중..." : `${bulkSigners.filter(s => s.name.trim() && s.email.trim()).length}명에게 일괄 발송`}
            </button>
            <button
              onClick={() => setShowSignRequestForm(false)}
              className="px-4 py-2 text-[var(--text-muted)] text-xs"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Signature history on document detail */}
      {docSignatures.length > 0 && (() => {
        const total = docSignatures.length;
        const signedCount = (docSignatures as any[]).filter((s) => s.status === "signed").length;
        const pendingCount = (docSignatures as any[]).filter((s) => s.status === "sent" || s.status === "viewed" || s.status === "pending").length;
        const pct = Math.round((signedCount / total) * 100);
        return (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-6">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h4 className="text-xs font-bold text-[var(--text-muted)]">서명 진행 ({signedCount}/{total})</h4>
                <div className="w-32 h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] font-semibold text-green-400">{pct}%</span>
              </div>
              <div className="flex gap-2">
                {pendingCount > 0 && (
                  <button onClick={sendAllReminders} className="text-[10px] px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-md font-semibold transition border border-amber-500/30">
                    🔔 전체 리마인더 ({pendingCount})
                  </button>
                )}
                <button onClick={() => setShowAuditLog(!showAuditLog)} className="text-[10px] px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded-md font-semibold transition border border-[var(--border)]">
                  📜 감사로그 {showAuditLog ? "닫기" : "보기"}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {docSignatures.map((sig: any) => {
                const si = getSignatureStatusInfo(sig.status);
                const isPending = sig.status === "sent" || sig.status === "viewed" || sig.status === "pending";
                const reminderCount = sig.reminder_count || 0;
                const lastReminded = sig.last_reminded_at ? new Date(sig.last_reminded_at).toLocaleString("ko") : null;
                return (
                  <div key={sig.id} className="flex items-center justify-between text-xs px-2 py-2 rounded-lg hover:bg-[var(--bg-surface)] transition">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${si.dot} flex-shrink-0`} />
                      <span className="font-medium truncate">{sig.signer_name}</span>
                      <span className="text-[var(--text-dim)] truncate">{sig.signer_email}</span>
                      {sig.viewed_at && !sig.signed_at && (
                        <span className="text-[10px] text-blue-400" title={new Date(sig.viewed_at).toLocaleString("ko")}>👁 열람</span>
                      )}
                      {reminderCount > 0 && (
                        <span className="text-[10px] text-amber-400" title={lastReminded || ""}>🔔 {reminderCount}회</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full ${si.bg} ${si.text}`}>{si.label}</span>
                      {sig.signed_at && (
                        <span className="text-[var(--text-dim)]">{new Date(sig.signed_at).toLocaleDateString("ko")}</span>
                      )}
                      {isPending && (
                        <button
                          onClick={() => sendReminder(sig.id)}
                          disabled={reminderSendingId === sig.id}
                          className="text-[10px] px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-md font-semibold transition disabled:opacity-50"
                        >
                          {reminderSendingId === sig.id ? "..." : "리마인더"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 감사 추적 로그 */}
            {showAuditLog && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <div className="text-[10px] font-semibold text-[var(--text-dim)] mb-2 uppercase tracking-wide">감사 추적 (Audit Trail)</div>
                {signAudit.length === 0 ? (
                  <div className="text-[11px] text-[var(--text-dim)] py-3">기록된 이벤트가 없습니다</div>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {(signAudit as any[]).map((log) => {
                      const ACTION_META: Record<string, { icon: string; color: string; label: string }> = {
                        create: { icon: "📝", color: "text-blue-400", label: "생성" },
                        sign: { icon: "✍️", color: "text-green-400", label: "서명" },
                        remind: { icon: "🔔", color: "text-amber-400", label: "리마인더" },
                        update: { icon: "🔄", color: "text-[var(--text-muted)]", label: "변경" },
                      };
                      const meta = ACTION_META[log.action] || { icon: "•", color: "text-[var(--text-muted)]", label: log.action };
                      return (
                        <div key={log.id} className="flex items-start gap-2 text-[11px] py-1.5 px-2 hover:bg-[var(--bg-surface)] rounded">
                          <span className="text-sm flex-shrink-0">{meta.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                              <span className="text-[var(--text)]">{log.signer_name || log.entity_name}</span>
                              <span className="text-[var(--text-dim)]">{log.signer_email}</span>
                            </div>
                            <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                              {new Date(log.created_at).toLocaleString("ko")}
                              {log.users?.name && ` · by ${log.users.name}`}
                              {log.ip_address && ` · ${log.ip_address}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Share Status */}
      <ShareStatusPanel documentId={id} />

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6">
        {(
          [
            { key: "content" as const, label: "내용" },
            { key: "revisions" as const, label: `수정이력 (${revisions.length})` },
            { key: "approvals" as const, label: `승인 (${approvals.length})` },
          ] as const
        ).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              tab === t.key ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "content" && (
        <div className="space-y-4">
          {isLocked && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 text-xs text-purple-400 font-semibold">
              이 문서는 잠금 상태입니다. 수정할 수 없습니다.
            </div>
          )}

          {/* ── 품목 편집 테이블 (견적서/계약서) ── */}
          {(contentType === 'invoice' || contentType === 'quote' || contentType === 'contract') && editItems.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs text-[var(--text-dim)] font-medium">품목 목록</span>
                {canEdit && (
                  <button onClick={() => setEditItems([...editItems, { name: '', quantity: 1, unitPrice: 0, supplyAmount: 0, taxAmount: 0, totalAmount: 0, note: '' }])}
                    className="text-xs text-[var(--primary)] hover:underline">+ 품목 추가</button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead>
                    <tr className="text-[var(--text-dim)] border-b border-[var(--border)]">
                      <th className="text-left px-3 py-2 font-medium">품명</th>
                      <th className="text-right px-3 py-2 font-medium w-20">수량</th>
                      <th className="text-right px-3 py-2 font-medium w-28">단가</th>
                      <th className="text-right px-3 py-2 font-medium w-28">공급가액</th>
                      <th className="text-right px-3 py-2 font-medium w-24">세액(10%)</th>
                      <th className="text-right px-3 py-2 font-medium w-28">합계</th>
                      <th className="text-left px-3 py-2 font-medium w-24">비고</th>
                      {canEdit && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {editItems.map((item: any, idx: number) => (
                      <tr key={idx} className="border-b border-[var(--border)]/50">
                        <td className="px-3 py-2">
                          {canEdit ? (
                            <input value={item.name || ''} onChange={(e) => {
                              const arr = [...editItems]; arr[idx] = { ...arr[idx], name: e.target.value }; setEditItems(arr);
                            }} className="w-full bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" />
                          ) : <span>{item.name}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canEdit ? (
                            <input type="number" value={item.quantity || 0} onChange={(e) => {
                              const arr = [...editItems]; const q = Number(e.target.value) || 0; const u = arr[idx].unitPrice || 0;
                              const supply = q * u; arr[idx] = { ...arr[idx], quantity: q, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) };
                              setEditItems(arr);
                            }} className="w-full text-right bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" />
                          ) : <span>{item.quantity}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canEdit ? (
                            <input type="number" value={item.unitPrice || 0} onChange={(e) => {
                              const arr = [...editItems]; const u = Number(e.target.value) || 0; const q = arr[idx].quantity || 0;
                              const supply = q * u; arr[idx] = { ...arr[idx], unitPrice: u, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) };
                              setEditItems(arr);
                            }} className="w-full text-right bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" />
                          ) : <span>{Number(item.unitPrice || 0).toLocaleString('ko')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--text-muted)]">{Number(item.supplyAmount || 0).toLocaleString('ko')}</td>
                        <td className="px-3 py-2 text-right text-[var(--text-dim)]">{Number(item.taxAmount || 0).toLocaleString('ko')}</td>
                        <td className="px-3 py-2 text-right font-semibold">{Number(item.totalAmount || 0).toLocaleString('ko')}</td>
                        <td className="px-3 py-2">
                          {canEdit ? (
                            <input value={item.note || ''} onChange={(e) => {
                              const arr = [...editItems]; arr[idx] = { ...arr[idx], note: e.target.value }; setEditItems(arr);
                            }} className="w-full bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" />
                          ) : <span className="text-[var(--text-dim)]">{item.note || ''}</span>}
                        </td>
                        {canEdit && (
                          <td className="px-2 py-2 text-center">
                            {editItems.length > 1 && (
                              <button onClick={() => setEditItems(editItems.filter((_: any, i: number) => i !== idx))}
                                className="text-red-400 hover:text-red-300 text-xs">X</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                      <td colSpan={3} className="px-3 py-2 text-xs font-bold text-[var(--text-muted)]">합계</td>
                      <td className="px-3 py-2 text-right text-xs font-bold">
                        {editItems.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0).toLocaleString('ko')}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold text-[var(--text-dim)]">
                        {editItems.reduce((s: number, i: any) => s + Number(i.taxAmount || 0), 0).toLocaleString('ko')}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-black">
                        {editItems.reduce((s: number, i: any) => s + Number(i.totalAmount || 0), 0).toLocaleString('ko')}
                      </td>
                      <td colSpan={canEdit ? 2 : 1} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 결제조건 편집 테이블 (계약서) ── */}
          {contentType === 'contract' && editPaymentSchedule.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs text-[var(--text-dim)] font-medium">결제조건</span>
                {canEdit && (
                  <button onClick={() => setEditPaymentSchedule([...editPaymentSchedule, { label: '기타', ratio: 0, amount: 0, condition: '' }])}
                    className="text-xs text-[var(--primary)] hover:underline">+ 조건 추가</button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-dim)] border-b border-[var(--border)]">
                      <th className="text-left px-4 py-2 font-medium w-28">구분</th>
                      <th className="text-right px-4 py-2 font-medium w-24">비율(%)</th>
                      <th className="text-right px-4 py-2 font-medium w-32">금액</th>
                      <th className="text-left px-4 py-2 font-medium">지급조건</th>
                      {canEdit && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {editPaymentSchedule.map((term: any, idx: number) => {
                      const contractTotal = Number((doc?.content_json as any)?.contractTotal || 0);
                      return (
                        <tr key={idx} className="border-b border-[var(--border)]/50">
                          <td className="px-4 py-2">
                            {canEdit ? (
                              <select value={term.label || '기타'} onChange={(e) => {
                                const arr = [...editPaymentSchedule]; arr[idx] = { ...arr[idx], label: e.target.value }; setEditPaymentSchedule(arr);
                              }} className="bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5">
                                <option value="선금">선금</option><option value="중도금">중도금</option><option value="잔금">잔금</option><option value="기타">기타</option>
                              </select>
                            ) : <span className="font-medium">{term.label}</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {canEdit ? (
                              <input type="number" value={term.ratio || 0} onChange={(e) => {
                                const arr = [...editPaymentSchedule]; const r = Number(e.target.value) || 0;
                                arr[idx] = { ...arr[idx], ratio: r, amount: Math.round(contractTotal * r / 100) };
                                setEditPaymentSchedule(arr);
                              }} className="w-full text-right bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" />
                            ) : <span>{term.ratio}%</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold">{Number(term.amount || 0).toLocaleString('ko')}</td>
                          <td className="px-4 py-2">
                            {canEdit ? (
                              <input value={term.condition || ''} onChange={(e) => {
                                const arr = [...editPaymentSchedule]; arr[idx] = { ...arr[idx], condition: e.target.value }; setEditPaymentSchedule(arr);
                              }} className="w-full bg-transparent border-b border-[var(--border)] focus:outline-none focus:border-[var(--primary)] px-1 py-0.5" placeholder="계약 후 7일 이내" />
                            ) : <span className="text-[var(--text-muted)]">{term.condition}</span>}
                          </td>
                          {canEdit && (
                            <td className="px-2 py-2 text-center">
                              {editPaymentSchedule.length > 1 && (
                                <button onClick={() => setEditPaymentSchedule(editPaymentSchedule.filter((_: any, i: number) => i !== idx))}
                                  className="text-red-400 hover:text-red-300 text-xs">X</button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                      <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)]">합계</td>
                      <td className={`px-4 py-2 text-right text-xs font-bold ${editPaymentSchedule.reduce((s: number, t: any) => s + (t.ratio || 0), 0) === 100 ? 'text-green-400' : 'text-red-400'}`}>
                        {editPaymentSchedule.reduce((s: number, t: any) => s + (t.ratio || 0), 0)}%
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-black">
                        {editPaymentSchedule.reduce((s: number, t: any) => s + Number(t.amount || 0), 0).toLocaleString('ko')}
                      </td>
                      <td colSpan={canEdit ? 2 : 1} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 직인/서명 패널 ── */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-xs font-bold text-[var(--text-dim)]">직인 / 서명</span>
              {(doc as any).seal_applied && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">직인 적용됨</span>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {/* 직인 적용 */}
              {!(doc as any).seal_applied && companyId && (
                <button
                  onClick={async () => {
                    if (!companyId || !userId) return;
                    setSealApplying(true);
                    try {
                      await applyCompanySeal({ documentId: id, companyId, appliedBy: userId });
                      invalidate();
                    } catch (err: any) {
                      toast(err?.message || '직인 적용 실패', "error");
                    } finally {
                      setSealApplying(false);
                    }
                  }}
                  disabled={sealApplying || isLocked}
                  className="px-4 py-2 bg-orange-500/10 text-orange-500 rounded-lg text-xs font-semibold hover:bg-orange-500/20 transition disabled:opacity-50">
                  {sealApplying ? '적용 중...' : '직인 적용하기'}
                </button>
              )}
              {/* 자체 서명 */}
              {!isLocked && (
                <button
                  onClick={() => setShowSelfSign(!showSelfSign)}
                  className="px-4 py-2 bg-indigo-500/10 text-indigo-500 rounded-lg text-xs font-semibold hover:bg-indigo-500/20 transition">
                  자체 서명
                </button>
              )}
            </div>
            {showSelfSign && !isLocked && (
              <div className="mt-4 p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
                <div className="text-xs text-[var(--text-muted)] mb-2">서명자 이름을 입력하고 서명하세요</div>
                <div className="flex gap-2 items-center">
                  <input value={selfSignName} onChange={(e) => setSelfSignName(e.target.value)}
                    placeholder="서명자 이름"
                    className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-indigo-500" />
                  <button
                    onClick={async () => {
                      if (!selfSignName.trim() || !companyId || !userId) return;
                      // 먼저 서명 요청 생성 → 바로 서명 완료
                      const req = await createSignatureRequest({
                        companyId, documentId: id, title: '자체 서명',
                        signerName: selfSignName, signerEmail: userEmail || 'self-sign@company.internal',
                        createdBy: userId,
                      });
                      await saveSignature(req.id, { type: 'type', data: selfSignName });
                      invalidate();
                      setShowSelfSign(false);
                      setSelfSignName('');
                    }}
                    disabled={!selfSignName.trim()}
                    className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                    서명 완료
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-xs text-[var(--text-dim)] font-medium">문서 내용</span>
              {canEdit && (
                <span className="text-[10px] text-[var(--text-dim)]">Markdown 지원</span>
              )}
            </div>
            <div className="p-5">
              {canEdit ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-[400px] bg-transparent text-sm leading-relaxed focus:outline-none resize-y font-mono"
                  placeholder="문서 내용을 작성하세요..."
                />
              ) : (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-[var(--text-muted)]">
                  {editContent || "(내용 없음)"}
                </pre>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <input value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder="변경 코멘트 (선택)"
                className="flex-1 px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {saveMut.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "revisions" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {revisions.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">수정 이력이 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {revisions.map((rev: any) => (
                <div key={rev.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--primary)]">v{rev.version}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {rev.users?.name || rev.users?.email || "\u2014"}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {rev.created_at ? new Date(rev.created_at).toLocaleString("ko") : "\u2014"}
                    </span>
                  </div>
                  {rev.comment && (
                    <div className="text-xs text-[var(--text-muted)] mt-1">{rev.comment}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "approvals" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {approvals.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">승인 기록이 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {approvals.map((appr: any) => (
                <div key={appr.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        appr.status === "approved"
                          ? "bg-green-500/10 text-green-400"
                          : appr.status === "rejected"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-gray-500/10 text-gray-400"
                      }`}>
                        {appr.status === "approved" ? "승인" : appr.status === "rejected" ? "거부" : "대기"}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {appr.users?.name || appr.users?.email || "\u2014"}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {appr.signed_at ? new Date(appr.signed_at).toLocaleString("ko") : "\u2014"}
                    </span>
                  </div>
                  {appr.comment && (
                    <div className="text-xs text-[var(--text-muted)] mt-1">{appr.comment}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Documents List ──

function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");
  const tabParam = searchParams.get("tab");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"docs" | "contracts" | "invoices" | "signatures" | "files" | "templates">("docs");
  const [showDocForm, setShowDocForm] = useState(false);
  const [showInvForm, setShowInvForm] = useState(false);
  const [showSignForm, setShowSignForm] = useState(false);
  const [signFormData, setSignFormData] = useState({ documentId: "", signerName: "", signerEmail: "", signerPhone: "" });
  const [selectedSignature, setSelectedSignature] = useState<any>(null);
  const [signStatusFilter, setSignStatusFilter] = useState<string>("all");
  const [docForm, setDocForm] = useState({ name: "", type: "contract", deal_id: "", template_id: "" });
  const [invForm, setInvForm] = useState({ type: "sales" as "sales" | "purchase", counterparty_name: "", supply_amount: "", issue_date: "", deal_id: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowDocForm(false); setShowInvForm(false); setShowSignForm(false); setShowArchiveForm(false); setSelectedSignature(null); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const { data: documents = [], error: mainError, refetch: mainRefetch, isLoading: mainLoading } = useQuery({
    queryKey: ["documents", companyId],
    queryFn: () => getDocuments(companyId!),
    enabled: !!companyId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["tax-invoices", companyId],
    queryFn: () => getTaxInvoices(companyId!),
    enabled: !!companyId,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });

  const { data: signatureRequests = [] } = useQuery({
    queryKey: ["signature-requests", companyId, signStatusFilter],
    queryFn: () => getSignatureRequests(companyId!, signStatusFilter === "all" ? undefined : signStatusFilter),
    enabled: !!companyId,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates", companyId],
    queryFn: () => getDocTemplates(companyId!),
    enabled: !!companyId,
  });

  // Contract Archives (계약서 보관함)
  const { data: contractArchives = [] } = useQuery({
    queryKey: ["contract-archives", companyId],
    queryFn: async () => {
      const { data } = await db.from('contract_archives')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });
  const [showArchiveForm, setShowArchiveForm] = useState(false);
  const [archiveForm, setArchiveForm] = useState({
    title: '', contract_type: 'service', counterparty: '', start_date: '', end_date: '',
    auto_renewal: false, renewal_notice_days: 30, amount: '', notes: '',
  });
  const [archiveFiles, setArchiveFiles] = useState<File[]>([]);

  // Handle tab param from URL
  useEffect(() => {
    if (tabParam === "signatures") setTab("signatures");
  }, [tabParam]);

  // Filtered documents based on search and type filter
  const filteredDocuments = useMemo(() => {
    let filtered = documents;

    // Full-text search across name, content, content_json fields
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((doc: any) => {
        if (doc.name?.toLowerCase().includes(term)) return true;
        if ((doc as any).full_text?.toLowerCase().includes(term)) return true;
        if ((doc as any).auto_classified_type?.toLowerCase().includes(term)) return true;
        if (doc.content?.toLowerCase().includes(term)) return true;
        if (doc.document_number?.toLowerCase().includes(term)) return true;
        // Deep search in content_json
        let cj = doc.content_json;
        if (typeof cj === 'string') { try { cj = JSON.parse(cj); } catch { cj = null; } }
        if (cj && typeof cj === 'object') {
          if (cj.content?.toLowerCase().includes(term)) return true;
          if (cj.notes?.toLowerCase().includes(term)) return true;
          if (cj.clientName?.toLowerCase().includes(term)) return true;
          if (cj.projectName?.toLowerCase().includes(term)) return true;
          // Search in items (quote/invoice line items)
          if (Array.isArray(cj.items)) {
            for (const item of cj.items) {
              if (item.name?.toLowerCase().includes(term)) return true;
              if (item.description?.toLowerCase().includes(term)) return true;
            }
          }
          // Search in payment schedule labels/conditions
          if (Array.isArray(cj.paymentSchedule)) {
            for (const ps of cj.paymentSchedule) {
              if (ps.label?.toLowerCase().includes(term)) return true;
              if (ps.condition?.toLowerCase().includes(term)) return true;
            }
          }
        }
        return false;
      });
    }

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((doc: any) => {
        const autoType = (doc as any).auto_classified_type;
        const contentType = (doc.content_json as any)?.type;
        return autoType === typeFilter || contentType === typeFilter;
      });
    }

    return filtered;
  }, [documents, searchTerm, typeFilter]);

  // Contract documents for the contracts tab
  const contractDocuments = useMemo(() => {
    return documents.filter((doc: any) => {
      const autoType = (doc as any).auto_classified_type;
      const contentType = (doc.content_json as any)?.type;
      return autoType === 'contract' || contentType === 'contract';
    });
  }, [documents]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["tax-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["signature-requests"] });
  };

  // Signature request mutation
  const createSignMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("Not ready");
      const result = await createSignatureRequest({
        companyId,
        documentId: signFormData.documentId,
        title: documents.find((d: any) => d.id === signFormData.documentId)?.name || "서명 요청",
        signerName: signFormData.signerName,
        signerEmail: signFormData.signerEmail,
        signerPhone: signFormData.signerPhone || undefined,
        createdBy: userId,
      });
      const emailResult = await sendSignatureEmail(result.id);
      if (emailResult.error) console.warn(emailResult.error);
      return result;
    },
    onSuccess: () => {
      invalidate();
      setShowSignForm(false);
      setSignFormData({ documentId: "", signerName: "", signerEmail: "", signerPhone: "" });
    },
  });

  // Cancel signature mutation
  const cancelSignMut = useMutation({
    mutationFn: (id: string) => cancelSignature(id),
    onSuccess: () => invalidate(),
  });

  // Sign (complete) mutation — 서명하기
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signTypeName, setSignTypeName] = useState("");
  const signCompleteMut = useMutation({
    mutationFn: async (id: string) => {
      const name = signTypeName.trim() || "서명 완료";
      await saveSignature(id, { type: 'type', data: name });
    },
    onSuccess: () => { invalidate(); setSigningId(null); setSignTypeName(""); },
  });

  const createDocMut = useMutation({
    mutationFn: async () => {
      let newDoc;
      if (docForm.template_id) {
        // Create from template
        newDoc = await createFromTemplate({
          companyId: companyId!,
          templateId: docForm.template_id,
          dealId: docForm.deal_id || undefined,
          name: docForm.name.trim(),
          createdBy: userId!,
        });
      } else {
        newDoc = await createBlankDocument({
          companyId: companyId!, dealId: docForm.deal_id || undefined,
          name: docForm.name.trim(), type: docForm.type, createdBy: userId!,
        });
      }

      // Auto-classify and save intelligence
      if (newDoc?.id) {
        const classified = classifyDocument(docForm.name);
        await saveDocumentIntelligence(newDoc.id, {
          autoClassifiedType: classified,
        });
      }

      return newDoc;
    },
    onSuccess: () => {
      invalidate();
      setShowDocForm(false);
      setDocForm({ name: "", type: "contract", deal_id: "", template_id: "" });
    },
  });

  const createInvMut = useMutation({
    mutationFn: () => createTaxInvoice({
      companyId: companyId!, dealId: invForm.deal_id || undefined,
      type: invForm.type, counterpartyName: invForm.counterparty_name,
      supplyAmount: Number(invForm.supply_amount), issueDate: invForm.issue_date,
    }),
    onSuccess: () => { invalidate(); setShowInvForm(false); setInvForm({ type: "sales", counterparty_name: "", supply_amount: "", issue_date: "", deal_id: "" }); },
  });

  // Auto-classification preview for new document form
  const docFormClassification = useMemo(() => {
    if (!docForm.name.trim()) return null;
    const classified = classifyDocument(docForm.name);
    return getDocTypeInfo(classified);
  }, [docForm.name]);

  if (selectedId) {
    return (
      <DocumentDetailView
        id={selectedId}
        onBack={() => router.push("/documents")}
      />
    );
  }

  if (!companyId || mainLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  return (
    <div className="max-w-[1100px]">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">문서/계약</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">계약서, 견적서, 세금계산서 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDocForm(!showDocForm)}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">
            + 문서 생성
          </button>
          <button onClick={() => setShowInvForm(!showInvForm)}
            className="px-4 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-[var(--text)] rounded-xl text-sm font-semibold transition border border-[var(--border)]">
            + 세금계산서
          </button>
        </div>
      </div>

      {/* Search bar + Type filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="문서명, 내용으로 검색..."
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text)] text-xs"
            >
              X
            </button>
          )}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] w-full sm:w-auto sm:min-w-[160px]"
        >
          <option value="all">전체 유형</option>
          {DOC_INTEL_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("docs")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "docs" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          문서 ({filteredDocuments.length})
        </button>
        <button onClick={() => setTab("contracts")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "contracts" ? "bg-blue-500/10 text-blue-400" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          계약서 ({contractDocuments.length})
        </button>
        <button onClick={() => setTab("invoices")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "invoices" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          세금계산서 ({invoices.length})
        </button>
        <button onClick={() => setTab("signatures")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "signatures" ? "bg-indigo-500/10 text-indigo-500" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          전자서명 ({signatureRequests.length})
        </button>
        <button onClick={() => setTab("files")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "files" ? "bg-emerald-500/10 text-emerald-500" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          파일 보관함
        </button>
        <button onClick={() => setTab("templates")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "templates" ? "bg-purple-500/10 text-purple-500" : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}>
          양식 관리 ({templates.length})
        </button>
      </div>

      {/* Doc Form */}
      {showDocForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">새 문서 생성</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">양식 선택</label>
              <select value={docForm.template_id} onChange={(e) => {
                const tpl = templates.find((t: any) => t.id === e.target.value);
                setDocForm({
                  ...docForm,
                  template_id: e.target.value,
                  name: tpl ? tpl.name : docForm.name,
                  type: tpl ? tpl.type : docForm.type,
                });
              }}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">빈 문서 (양식 없이)</option>
                {templates.filter((t: any) => !HR_CATEGORIES.includes(t.type)).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서명 *</label>
              <input value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                placeholder="수출바우처 계약서" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              {docFormClassification && docForm.name.trim() && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-[var(--text-dim)]">자동 분류:</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${docFormClassification.color}`}>
                    {docFormClassification.label}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 딜</label>
              <select value={docForm.deal_id} onChange={(e) => setDocForm({ ...docForm, deal_id: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">선택 안함</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => docForm.name && createDocMut.mutate()} disabled={!docForm.name || createDocMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">생성</button>
            <button onClick={() => setShowDocForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Invoice Form */}
      {showInvForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">세금계산서 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={invForm.type} onChange={(e) => setInvForm({ ...invForm, type: e.target.value as "sales" | "purchase" })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {INVOICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">거래처명 *</label>
              <input value={invForm.counterparty_name} onChange={(e) => setInvForm({ ...invForm, counterparty_name: e.target.value })}
                placeholder="A기업" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">공급가액 (원) *</label>
              <input type="number" value={invForm.supply_amount} onChange={(e) => setInvForm({ ...invForm, supply_amount: e.target.value })}
                placeholder="10000000" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">발행일 *</label>
              <input type="date" value={invForm.issue_date} onChange={(e) => setInvForm({ ...invForm, issue_date: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 딜</label>
              <select value={invForm.deal_id} onChange={(e) => setInvForm({ ...invForm, deal_id: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">선택 안함</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {Number(invForm.supply_amount) > 0 && (
              <div className="flex items-end pb-1">
                <div className="text-xs text-[var(--text-dim)]">
                  부가세: ₩{Math.round(Number(invForm.supply_amount) * 0.1).toLocaleString()} /
                  합계: ₩{Math.round(Number(invForm.supply_amount) * 1.1).toLocaleString()}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => invForm.counterparty_name && invForm.supply_amount && invForm.issue_date && createInvMut.mutate()}
              disabled={!invForm.counterparty_name || !invForm.supply_amount || !invForm.issue_date || createInvMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
            <button onClick={() => setShowInvForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Documents List */}
      {tab === "docs" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {filteredDocuments.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📄</div>
              <div className="text-sm font-medium text-[var(--text)]">
                {searchTerm || typeFilter !== "all" ? "검색 결과가 없습니다" : "계약서, NDA 등 문서를 만들어보세요"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {searchTerm || typeFilter !== "all" ? "다른 검색어나 필터를 시도하세요" : "계약서, 견적서, 제안서를 AI로 빠르게 생성할 수 있습니다"}
              </div>
              {!searchTerm && typeFilter === "all" && (
                <button onClick={() => setShowDocForm(true)} className="mt-4 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90">+ 새 문서</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">문서명</th>
                  <th className="text-left px-5 py-3 font-medium">유형</th>
                  <th className="text-left px-5 py-3 font-medium">AI 분류</th>
                  <th className="text-left px-5 py-3 font-medium">연결 딜</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                  <th className="text-left px-5 py-3 font-medium">생성일</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc: any) => {
                  const contentType = (doc.content_json as any)?.type || 'contract';
                  const typeLabel = DOC_TYPES.find(t => t.value === contentType)?.label || contentType;
                  const sc = (DOC_STATUS as any)[doc.status] || DOC_STATUS.draft;
                  const autoType = (doc as any).auto_classified_type;
                  const autoTypeInfo = autoType ? getDocTypeInfo(autoType) : null;
                  return (
                    <tr key={doc.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                      <td className="px-5 py-3">
                        <button
                          onClick={() => router.push(`/documents?id=${doc.id}`)}
                          className="text-sm font-medium hover:text-[var(--primary)] transition text-left"
                        >
                          {doc.name}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{typeLabel}</td>
                      <td className="px-5 py-3">
                        {autoTypeInfo ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${autoTypeInfo.color}`}>
                            {autoTypeInfo.label}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-dim)]">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{doc.deals?.name || "\u2014"}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko') : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* Contracts Tab */}
      {tab === "contracts" && (
        <div className="space-y-6">
          {/* 진행중 계약서 */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-bold">진행중 계약서</h2>
              <span className="text-xs text-[var(--text-dim)]">{contractDocuments.length}건</span>
            </div>
            {contractDocuments.length === 0 ? (
              <div className="p-12 text-center text-sm text-[var(--text-muted)]">딜에서 생성된 계약서가 여기에 표시됩니다</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">계약서명</th>
                    <th className="text-left px-5 py-3 font-medium">거래처</th>
                    <th className="text-left px-5 py-3 font-medium">시작일</th>
                    <th className="text-left px-5 py-3 font-medium">종료일</th>
                    <th className="text-right px-5 py-3 font-medium">계약금액</th>
                    <th className="text-center px-5 py-3 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {contractDocuments.map((doc: any) => {
                    const sc = (DOC_STATUS as any)[doc.status] || DOC_STATUS.draft;
                    const cj = doc.content_json || {};
                    const startDate = cj.contractStartDate || (doc as any).contract_start_date;
                    const endDate = cj.contractEndDate || (doc as any).contract_end_date;
                    const amount = cj.contractTotal || (doc as any).contract_amount;
                    const partnerName = cj.partnerName || (doc as any).partners?.name;
                    let isExpiringSoon = false;
                    if (endDate) {
                      const daysUntilEnd = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      isExpiringSoon = daysUntilEnd >= 0 && daysUntilEnd <= 30;
                    }
                    return (
                      <tr key={doc.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] ${isExpiringSoon ? 'bg-red-500/[.03]' : ''}`}>
                        <td className="px-5 py-3">
                          <button onClick={() => router.push(`/documents?id=${doc.id}`)} className="text-sm font-medium hover:text-[var(--primary)] transition text-left">
                            {doc.name}
                          </button>
                          {isExpiringSoon && <div className="text-[10px] text-red-400 mt-0.5">만료 임박</div>}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{partnerName || "\u2014"}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{startDate || "\u2014"}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{endDate ? <span className={isExpiringSoon ? 'text-red-400 font-medium' : ''}>{endDate}</span> : "\u2014"}</td>
                        <td className="px-5 py-3 text-sm text-right font-medium">{amount ? `₩${Number(amount).toLocaleString()}` : "\u2014"}</td>
                        <td className="px-5 py-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>

          {/* 계약서 보관함 */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">계약서 보관함</h2>
                <span className="text-xs text-[var(--text-dim)]">{contractArchives.length}건</span>
                {contractArchives.some((a: any) => {
                  if (!a.end_date) return false;
                  const days = Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000);
                  return a.status === 'active' && days >= 0 && days <= (a.renewal_notice_days || 30);
                }) && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-semibold">만료 예정</span>}
              </div>
              <button onClick={() => setShowArchiveForm(!showArchiveForm)} className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:bg-[var(--primary-hover)] transition">
                + 계약서 등록
              </button>
            </div>

            {showArchiveForm && (
              <div className="p-5 border-b border-[var(--border)] bg-[var(--bg-surface)]">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">계약서명 *</label>
                    <input value={archiveForm.title} onChange={(e) => setArchiveForm({ ...archiveForm, title: e.target.value })}
                      placeholder="사무실 임대차 계약서" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">유형 *</label>
                    <select value={archiveForm.contract_type} onChange={(e) => setArchiveForm({ ...archiveForm, contract_type: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                      <option value="lease">임대차</option><option value="service">용역</option><option value="nda">NDA</option>
                      <option value="purchase">구매</option><option value="other">기타</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">계약 상대방</label>
                    <input value={archiveForm.counterparty} onChange={(e) => setArchiveForm({ ...archiveForm, counterparty: e.target.value })}
                      placeholder="스파크플러스" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">계약금액</label>
                    <input type="number" value={archiveForm.amount} onChange={(e) => setArchiveForm({ ...archiveForm, amount: e.target.value })}
                      placeholder="0" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">시작일</label>
                    <input type="date" value={archiveForm.start_date} onChange={(e) => setArchiveForm({ ...archiveForm, start_date: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                    <input type="date" value={archiveForm.end_date} onChange={(e) => setArchiveForm({ ...archiveForm, end_date: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={archiveForm.auto_renewal} onChange={(e) => setArchiveForm({ ...archiveForm, auto_renewal: e.target.checked })} className="rounded" />
                    자동갱신
                  </label>
                  {archiveForm.auto_renewal && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--text-muted)]">갱신 알림:</span>
                      <input type="number" value={archiveForm.renewal_notice_days} onChange={(e) => setArchiveForm({ ...archiveForm, renewal_notice_days: Number(e.target.value) })}
                        className="w-16 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-center" />
                      <span className="text-xs text-[var(--text-muted)]">일 전</span>
                    </div>
                  )}
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">비고</label>
                  <textarea value={archiveForm.notes} onChange={(e) => setArchiveForm({ ...archiveForm, notes: e.target.value })}
                    rows={2} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">파일 첨부 (스캔본)</label>
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setArchiveFiles(Array.from(e.target.files || []))}
                    className="text-xs text-[var(--text-muted)]" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!archiveForm.title || !companyId || !userId) return;
                      const fileUrls: string[] = [];
                      for (const file of archiveFiles) {
                        const result = await uploadFile({ companyId, bucket: 'document-files', file, context: {}, category: 'contract', userId });
                        if (result?.fileUrl) fileUrls.push(result.fileUrl);
                      }
                      await db.from('contract_archives').insert({
                        company_id: companyId,
                        title: archiveForm.title,
                        contract_type: archiveForm.contract_type,
                        counterparty: archiveForm.counterparty || null,
                        start_date: archiveForm.start_date || null,
                        end_date: archiveForm.end_date || null,
                        auto_renewal: archiveForm.auto_renewal,
                        renewal_notice_days: archiveForm.renewal_notice_days,
                        amount: archiveForm.amount ? Number(archiveForm.amount) : null,
                        notes: archiveForm.notes || null,
                        file_urls: fileUrls,
                        created_by: userId,
                      });
                      setArchiveForm({ title: '', contract_type: 'service', counterparty: '', start_date: '', end_date: '', auto_renewal: false, renewal_notice_days: 30, amount: '', notes: '' });
                      setArchiveFiles([]);
                      setShowArchiveForm(false);
                      queryClient.invalidateQueries({ queryKey: ['contract-archives'] });
                    }}
                    className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold">등록</button>
                  <button onClick={() => setShowArchiveForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button>
                </div>
              </div>
            )}

            {contractArchives.length === 0 && !showArchiveForm ? (
              <div className="p-12 text-center text-sm text-[var(--text-muted)]">기존 계약서(임대차, 용역 등)를 스캔하여 등록하세요</div>
            ) : contractArchives.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">계약서명</th>
                    <th className="text-left px-5 py-3 font-medium">유형</th>
                    <th className="text-left px-5 py-3 font-medium">상대방</th>
                    <th className="text-left px-5 py-3 font-medium">기간</th>
                    <th className="text-right px-5 py-3 font-medium">금액</th>
                    <th className="text-center px-5 py-3 font-medium">상태</th>
                    <th className="text-center px-5 py-3 font-medium">파일</th>
                  </tr>
                </thead>
                <tbody>
                  {contractArchives.map((a: any) => {
                    const typeLabels: Record<string, string> = { lease: '임대차', service: '용역', nda: 'NDA', purchase: '구매', other: '기타' };
                    let isExpiring = false;
                    if (a.end_date && a.status === 'active') {
                      const days = Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000);
                      isExpiring = days >= 0 && days <= (a.renewal_notice_days || 30);
                    }
                    const isExpired = a.end_date && new Date(a.end_date) < new Date() && a.status === 'active';
                    return (
                      <tr key={a.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] ${isExpiring ? 'bg-amber-500/[.03]' : ''} ${isExpired ? 'bg-red-500/[.03]' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="text-sm font-medium">{a.title}</div>
                          {isExpiring && <div className="text-[10px] text-amber-400 mt-0.5">만료 {Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000)}일 전</div>}
                          {isExpired && <div className="text-[10px] text-red-400 mt-0.5">만료됨</div>}
                          {a.auto_renewal && <div className="text-[10px] text-blue-400 mt-0.5">자동갱신</div>}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{typeLabels[a.contract_type] || a.contract_type}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{a.counterparty || "\u2014"}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{a.start_date || '?'} ~ {a.end_date || '미정'}</td>
                        <td className="px-5 py-3 text-sm text-right font-medium">{a.amount ? `₩${Number(a.amount).toLocaleString()}` : "\u2014"}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'active' ? 'bg-green-500/10 text-green-400' : a.status === 'expired' ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'}`}>
                            {a.status === 'active' ? '유효' : a.status === 'expired' ? '만료' : '해지'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center text-xs text-[var(--text-muted)]">
                          {(a.file_urls || []).length > 0 ? `${a.file_urls.length}개` : '\u2014'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* Tax Invoices List */}
      {tab === "invoices" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🧾</div>
              <div className="text-lg font-bold mb-2">세금계산서가 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">매출/매입 세금계산서를 등록하세요</div>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">거래처</th>
                  <th className="text-center px-5 py-3 font-medium">유형</th>
                  <th className="text-right px-5 py-3 font-medium">공급가액</th>
                  <th className="text-right px-5 py-3 font-medium">부가세</th>
                  <th className="text-right px-5 py-3 font-medium">합계</th>
                  <th className="text-left px-5 py-3 font-medium">딜</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                  <th className="text-left px-5 py-3 font-medium">발행일</th>
                  <th className="text-center px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => {
                  const sc = (INVOICE_STATUS as any)[inv.status] || INVOICE_STATUS.draft;
                  return (
                    <tr key={inv.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                      <td className="px-5 py-3 text-sm font-medium">{inv.counterparty_name}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.type === 'sales' ? 'bg-green-500/10 text-green-400' : 'bg-orange-500/10 text-orange-400'
                        }`}>{inv.type === 'sales' ? '매출' : '매입'}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-right">₩{Number(inv.supply_amount).toLocaleString()}</td>
                      <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">₩{Number(inv.tax_amount).toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(inv.total_amount).toLocaleString()}</td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{inv.deals?.name || "\u2014"}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{inv.issue_date}</td>
                      <td className="px-5 py-3 text-center">
                        {inv.status === 'draft' && (
                          <button
                            onClick={async () => {
                              try {
                                await issueTaxInvoice(inv.id);
                                invalidate();
                              } catch { /* silent */ }
                            }}
                            className="text-[10px] px-2 py-1 bg-blue-500/10 text-blue-400 rounded-lg font-semibold hover:bg-blue-500/20 transition">
                            발행
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ═══ Electronic Signature Tab ═══ */}
      {tab === "signatures" && (
        <div className="space-y-6">
          {/* Signature Header Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {([ { value: "all", label: "전체" }, ...SIGNATURE_STATUS ] as const).map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSignStatusFilter(s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    signStatusFilter === s.value
                      ? "bg-indigo-500/10 text-indigo-500"
                      : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowSignForm(true)}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-sm font-semibold transition"
            >
              + 서명 요청
            </button>
          </div>

          {/* Signature Request Form Modal */}
          {showSignForm && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-indigo-500/20 p-6">
              <h3 className="text-sm font-bold mb-4 text-indigo-600">새 서명 요청</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">문서 선택 *</label>
                  <select
                    value={signFormData.documentId}
                    onChange={(e) => setSignFormData({ ...signFormData, documentId: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">문서를 선택하세요</option>
                    {documents.map((doc: any) => (
                      <option key={doc.id} value={doc.id}>{doc.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">서명자 이름 *</label>
                  <input
                    value={signFormData.signerName}
                    onChange={(e) => setSignFormData({ ...signFormData, signerName: e.target.value })}
                    placeholder="홍길동"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label>
                  <input
                    type="email"
                    value={signFormData.signerEmail}
                    onChange={(e) => setSignFormData({ ...signFormData, signerEmail: e.target.value })}
                    placeholder="signer@example.com"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">전화번호</label>
                  <input
                    type="tel"
                    value={signFormData.signerPhone}
                    onChange={(e) => setSignFormData({ ...signFormData, signerPhone: e.target.value })}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => signFormData.documentId && signFormData.signerName && signFormData.signerEmail && createSignMut.mutate()}
                  disabled={!signFormData.documentId || !signFormData.signerName || !signFormData.signerEmail || createSignMut.isPending}
                  className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {createSignMut.isPending ? "발송 중..." : "서명 요청 발송"}
                </button>
                <button onClick={() => setShowSignForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-xs">취소</button>
              </div>
            </div>
          )}

          {/* Signature Requests List */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            {signatureRequests.length === 0 ? (
              <div className="p-16 text-center">
                <svg className="w-12 h-12 mx-auto mb-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
                  <path d="M12 20h9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="text-lg font-bold mb-2">서명 요청이 없습니다</div>
                <div className="text-sm text-[var(--text-muted)]">문서에 전자서명을 요청하세요</div>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">문서</th>
                    <th className="text-left px-5 py-3 font-medium">서명자</th>
                    <th className="text-left px-5 py-3 font-medium">이메일</th>
                    <th className="text-center px-5 py-3 font-medium">상태</th>
                    <th className="text-left px-5 py-3 font-medium">발송일</th>
                    <th className="text-left px-5 py-3 font-medium">서명일</th>
                    <th className="text-left px-5 py-3 font-medium">만료일</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {signatureRequests.map((sig: any) => {
                    const si = getSignatureStatusInfo(sig.status);
                    const isExpired = sig.expires_at && new Date(sig.expires_at) < new Date() && sig.status !== 'signed';
                    return (
                      <tr key={sig.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                        <td className="px-5 py-3">
                          <button
                            onClick={() => {
                              setSelectedSignature(selectedSignature?.id === sig.id ? null : sig);
                            }}
                            className="text-sm font-medium hover:text-indigo-500 transition text-left"
                          >
                            {sig.title || sig.documents?.name || "--"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-sm">{sig.signer_name}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{sig.signer_email}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${si.bg} ${si.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                            {isExpired && sig.status !== 'expired' ? '만료' : si.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                          {sig.sent_at ? new Date(sig.sent_at).toLocaleDateString("ko") : "--"}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                          {sig.signed_at ? new Date(sig.signed_at).toLocaleDateString("ko") : "--"}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                          {sig.expires_at ? (
                            <span className={isExpired ? "text-red-400 font-medium" : ""}>
                              {new Date(sig.expires_at).toLocaleDateString("ko")}
                            </span>
                          ) : "--"}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {(sig.status === 'sent' || sig.status === 'viewed') && signingId !== sig.id && (
                              <button
                                onClick={() => { setSigningId(sig.id); setSignTypeName(sig.signer_name || ""); }}
                                className="text-xs text-green-600 hover:text-green-700 font-semibold transition"
                              >
                                서명하기
                              </button>
                            )}
                            {signingId === sig.id && (
                              <div className="flex items-center gap-1">
                                <input
                                  value={signTypeName}
                                  onChange={(e) => setSignTypeName(e.target.value)}
                                  placeholder="서명자 이름"
                                  className="w-20 px-2 py-1 text-xs border border-[var(--border)] rounded bg-[var(--bg)] focus:outline-none"
                                  autoFocus
                                  onKeyDown={(e) => e.key === 'Enter' && signCompleteMut.mutate(sig.id)}
                                />
                                <button
                                  onClick={() => signCompleteMut.mutate(sig.id)}
                                  disabled={signCompleteMut.isPending}
                                  className="text-xs text-green-600 font-semibold"
                                >
                                  {signCompleteMut.isPending ? '...' : '확인'}
                                </button>
                                <button
                                  onClick={() => { setSigningId(null); setSignTypeName(""); }}
                                  className="text-xs text-[var(--text-dim)]"
                                >
                                  취소
                                </button>
                              </div>
                            )}
                            {(sig.status === 'pending' || sig.status === 'sent') && signingId !== sig.id && (
                              <button
                                onClick={() => cancelSignMut.mutate(sig.id)}
                                disabled={cancelSignMut.isPending}
                                className="text-xs text-red-400 hover:text-red-500 font-medium transition"
                              >
                                취소
                              </button>
                            )}
                            {sig.status === 'signed' && sig.signature_data && (
                              <button
                                onClick={() => setSelectedSignature(selectedSignature?.id === sig.id ? null : sig)}
                                className="text-xs text-indigo-500 hover:text-indigo-600 font-medium transition"
                              >
                                상세
                              </button>
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

          {/* Signature Detail Panel */}
          {selectedSignature && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold">서명 상세 정보</h3>
                <button
                  onClick={() => setSelectedSignature(null)}
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  닫기
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Left: Info */}
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] text-[var(--text-dim)] uppercase">문서</span>
                    <p className="text-sm font-medium mt-0.5">{selectedSignature.title || selectedSignature.documents?.name}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-dim)] uppercase">서명자</span>
                    <p className="text-sm mt-0.5">{selectedSignature.signer_name} ({selectedSignature.signer_email})</p>
                    {selectedSignature.signer_phone && (
                      <p className="text-xs text-[var(--text-muted)]">{selectedSignature.signer_phone}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] text-[var(--text-dim)] uppercase">상태</span>
                      <div className="mt-1">
                        {(() => {
                          const si = getSignatureStatusInfo(selectedSignature.status);
                          return <span className={`text-xs px-2.5 py-1 rounded-full ${si.bg} ${si.text}`}>{si.label}</span>;
                        })()}
                      </div>
                    </div>
                    {selectedSignature.ip_address && (
                      <div>
                        <span className="text-[10px] text-[var(--text-dim)] uppercase">IP 주소</span>
                        <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">{selectedSignature.ip_address}</p>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <span className="text-[10px] text-[var(--text-dim)] uppercase">발송</span>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {selectedSignature.sent_at ? new Date(selectedSignature.sent_at).toLocaleString("ko") : "--"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--text-dim)] uppercase">열람</span>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {selectedSignature.viewed_at ? new Date(selectedSignature.viewed_at).toLocaleString("ko") : "--"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--text-dim)] uppercase">서명</span>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {selectedSignature.signed_at ? new Date(selectedSignature.signed_at).toLocaleString("ko") : "--"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right: Signature preview */}
                <div>
                  <span className="text-[10px] text-[var(--text-dim)] uppercase">서명 데이터</span>
                  {selectedSignature.signature_data ? (
                    <div className="mt-2 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
                      <div className="text-xs text-[var(--text-dim)] mb-2">
                        유형: {selectedSignature.signature_data.type === 'draw' ? '직접 서명' : selectedSignature.signature_data.type === 'type' ? '텍스트 서명' : '이미지 업로드'}
                      </div>
                      {selectedSignature.signature_data.type === 'draw' || selectedSignature.signature_data.type === 'upload' ? (
                        <div className="bg-white rounded-lg p-3 border border-[var(--border)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedSignature.signature_data.data}
                            alt="서명"
                            className="max-h-[120px] mx-auto"
                          />
                        </div>
                      ) : (
                        <div className="bg-white rounded-lg p-4 border border-[var(--border)] text-center">
                          <span className="text-2xl font-serif italic text-gray-800">
                            {selectedSignature.signature_data.data}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-8 text-center text-xs text-[var(--text-dim)]">
                      아직 서명되지 않았습니다
                    </div>
                  )}
                </div>
              </div>

              {/* Status Timeline */}
              <div className="mt-6 pt-4 border-t border-[var(--border)]">
                <span className="text-[10px] text-[var(--text-dim)] uppercase">진행 상태</span>
                <div className="flex items-center gap-0 mt-3">
                  {SIGNATURE_STATUS.filter(s => s.value !== 'rejected' && s.value !== 'expired').map((step, idx) => {
                    const stepOrder = ['pending', 'sent', 'viewed', 'signed'];
                    const currentIdx = stepOrder.indexOf(selectedSignature.status);
                    const thisIdx = stepOrder.indexOf(step.value);
                    const isActive = thisIdx <= currentIdx;
                    const isCurrent = step.value === selectedSignature.status;
                    return (
                      <div key={step.value} className="flex items-center flex-1">
                        <div className="flex flex-col items-center flex-1">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                            isActive
                              ? isCurrent ? 'bg-indigo-500 text-white' : 'bg-green-500 text-white'
                              : 'bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border)]'
                          }`}>
                            {isActive && !isCurrent ? (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              idx + 1
                            )}
                          </div>
                          <span className={`text-[10px] mt-1.5 ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-dim)]'}`}>
                            {step.label}
                          </span>
                        </div>
                        {idx < 3 && (
                          <div className={`h-0.5 flex-1 mx-1 rounded-full ${
                            thisIdx < currentIdx ? 'bg-green-500' : 'bg-[var(--border)]'
                          }`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ File Storage Tab ═══ */}
      {tab === "files" && companyId && userId && (
        <FileStorageTab companyId={companyId} userId={userId} />
      )}

      {/* ═══ Templates Tab ═══ */}
      {tab === "templates" && companyId && userId && (
        <TemplatesTab companyId={companyId} userId={userId} templates={templates} onInvalidate={invalidate} />
      )}
    </div>
  );
}

// ── File Storage Tab Component ──
function FileStorageTab({ companyId, userId }: { companyId: string; userId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fileSearchTerm, setFileSearchTerm] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewFolderForm, setShowNewFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Folders query
  const { data: folders = [] } = useQuery({
    queryKey: ["document-folders", companyId],
    queryFn: () => getFolders(companyId),
    enabled: !!companyId,
  });

  // Files query - search or folder-based
  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ["storage-files", companyId, selectedFolderId, fileSearchTerm],
    queryFn: async () => {
      if (fileSearchTerm.trim()) {
        return searchFiles(companyId, fileSearchTerm);
      }
      if (selectedFolderId) {
        const { data } = await (supabase as any)
          .from("document_files")
          .select("*")
          .eq("folder_id", selectedFolderId)
          .order("created_at", { ascending: false });
        return data || [];
      }
      const { data } = await (supabase as any)
        .from("document_files")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  // Filtered files by category
  const filteredFiles = useMemo(() => {
    if (categoryFilter === "all") return files;
    return files.filter((f: any) => f.category === categoryFilter);
  }, [files, categoryFilter]);

  // Create folder mutation
  const createFolderMut = useMutation({
    mutationFn: () => createFolder(companyId, newFolderName, selectedFolderId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      setShowNewFolderForm(false);
      setNewFolderName("");
    },
  });

  // Delete folder mutation
  const deleteFolderMut = useMutation({
    mutationFn: (folderId: string) => deleteFolder(folderId, userId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      if (selectedFolderId) setSelectedFolderId(null);
    },
  });

  // Upload files
  const handleFilesSelected = async (selectedFiles: File[]) => {
    for (const file of selectedFiles) {
      try {
        await uploadFile({
          companyId,
          bucket: "document-files",
          file,
          context: { folderId: selectedFolderId || undefined },
          category: categoryFilter !== "all" ? categoryFilter : undefined,
          userId,
        });
      } catch (err: any) {
        console.error("Upload failed:", err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["storage-files"] });
  };

  // Delete file
  const handleDeleteFile = async (fileId: string) => {
    try {
      await deleteFile(fileId, userId, companyId);
      queryClient.invalidateQueries({ queryKey: ["storage-files"] });
    } catch (err: any) {
      toast("삭제 실패: " + (err?.message || err), "error");
    }
  };

  // Toggle folder expand
  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Build folder tree
  const rootFolders = folders.filter((f: any) => !f.parent_id);
  const getChildren = (parentId: string) => folders.filter((f: any) => f.parent_id === parentId);

  const renderFolder = (folder: any, depth: number = 0) => {
    const children = getChildren(folder.id);
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition ${
            isSelected
              ? "bg-[var(--primary)]/10 text-[var(--primary)] font-semibold"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]"
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => setSelectedFolderId(isSelected ? null : folder.id)}
        >
          {children.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}
              className="w-4 h-4 flex items-center justify-center"
            >
              <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {children.length === 0 && <span className="w-4" />}
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 7a2 2 0 012-2h5l2 2h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
          </svg>
          <span className="truncate flex-1">{folder.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm(`"${folder.name}" 폴더를 삭제하시겠습니까?`)) deleteFolderMut.mutate(folder.id); }}
            className="opacity-0 group-hover:opacity-100 w-4 h-4 text-[var(--text-dim)] hover:text-red-400"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {isExpanded && children.map((child: any) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  const FILE_CATEGORIES = [
    { value: "all", label: "전체" },
    { value: "contract", label: "계약서" },
    { value: "invoice", label: "세금계산서" },
    { value: "report", label: "보고서" },
    { value: "certificate", label: "인증서" },
    { value: "general", label: "일반" },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      {/* Left: Folder Tree */}
      <div className="w-full md:w-[240px] shrink-0">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[var(--text)]">폴더</span>
            <button
              onClick={() => setShowNewFolderForm(!showNewFolderForm)}
              className="text-[10px] text-[var(--primary)] hover:text-[var(--primary-hover)] font-semibold"
            >
              + 새 폴더
            </button>
          </div>

          {showNewFolderForm && (
            <div className="flex gap-1.5 mb-3">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더명"
                className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              />
              <button
                onClick={() => newFolderName && createFolderMut.mutate()}
                disabled={!newFolderName}
                className="px-2 py-1.5 bg-[var(--primary)] text-white rounded-lg text-[10px] font-semibold disabled:opacity-50"
              >
                추가
              </button>
            </div>
          )}

          {/* All files button */}
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition mb-1 ${
              !selectedFolderId
                ? "bg-[var(--primary)]/10 text-[var(--primary)] font-semibold"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]"
            }`}
            onClick={() => setSelectedFolderId(null)}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span>전체 파일</span>
          </div>

          <div className="space-y-0.5">
            {rootFolders.map((f: any) => renderFolder(f))}
          </div>

          {folders.length === 0 && (
            <div className="text-[10px] text-[var(--text-dim)] text-center py-4">
              폴더가 없습니다
            </div>
          )}
        </div>
      </div>

      {/* Right: File list + Upload */}
      <div className="flex-1 space-y-4">
        {/* Search + Category filter */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={fileSearchTerm}
              onChange={(e) => setFileSearchTerm(e.target.value)}
              placeholder="파일명으로 검색..."
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] min-w-[140px]"
          >
            {FILE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Upload zone */}
        <FileUploadMulti
          onFilesSelect={handleFilesSelected}
          maxFiles={10}
          maxSize={50}
          label="파일을 드래그하거나 클릭하여 업로드"
        />

        {/* File list */}
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
          <FileList
            files={filteredFiles.map((f: any) => ({
              id: f.id,
              file_name: f.file_name,
              file_url: f.file_url,
              file_size: f.file_size || 0,
              mime_type: f.mime_type || "application/octet-stream",
              version: f.version || 1,
              created_at: f.created_at,
              uploaded_by: f.uploaded_by,
            }))}
            onDelete={handleDeleteFile}
            onDownload={(file) => window.open(file.file_url, "_blank")}
          />
        </div>
      </div>
    </div>
  );
}

// ── Share Status Panel ──
function ShareStatusPanel({ documentId }: { documentId: string }) {
  const { toast } = useToast();
  const { data: shares = [] } = useQuery({
    queryKey: ['document-shares', documentId],
    queryFn: async () => {
      const { getDocumentShares } = await import("@/lib/document-sharing");
      return getDocumentShares(documentId);
    },
    enabled: !!documentId,
  });

  const activeShares = shares.filter((s: any) => s.is_active);
  if (activeShares.length === 0) return null;

  const decisionLabel: Record<string, string> = { approved: '승인', hold: '보류', rejected: '거절' };
  const decisionColor: Record<string, string> = { approved: 'text-green-500', hold: 'text-yellow-500', rejected: 'text-red-500' };

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-6">
      <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3">공유 현황</h4>
      <div className="space-y-2">
        {activeShares.map((share: any) => {
          const feedback = share.document_share_feedback || [];
          return (
            <div key={share.id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-purple-500 font-semibold">🔗 공유 링크</span>
                <span className="text-[10px] text-[var(--text-dim)]">
                  {new Date(share.created_at).toLocaleDateString('ko-KR')} 생성
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[var(--text-muted)]">
                  조회 {share.view_count}회
                </span>
              </div>
              <div className="flex items-center gap-2">
                {feedback.length > 0 ? feedback.map((fb: any) => (
                  <span key={fb.id} className={`text-[10px] px-2 py-0.5 rounded font-semibold ${decisionColor[fb.decision] || ''}`}>
                    {decisionLabel[fb.decision] || fb.decision}
                    {fb.responder_name ? ` (${fb.responder_name})` : ''}
                  </span>
                )) : (
                  <span className="text-[10px] text-[var(--text-dim)]">피드백 대기</span>
                )}
                <button
                  onClick={async () => {
                    const base = window.location.origin;
                    await navigator.clipboard.writeText(`${base}/share?token=${share.share_token}`);
                    toast('링크 복사됨', "success");
                  }}
                  className="text-[10px] px-2 py-1 bg-purple-500/10 text-purple-500 rounded-lg hover:bg-purple-500/20 transition font-semibold"
                >
                  복사
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── HR categories to exclude from document creation ──
const HR_CATEGORIES = ['salary_contract', 'nda', 'non_compete', 'privacy_consent', 'comprehensive_labor', 'contract_labor'];

// ── Default Template Definitions ──
const DEFAULT_TEMPLATES = [
  {
    name: "마케팅대행 계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "거래처명", "거래처대표", "계약금액", "계약기간", "계약시작일", "계약종료일", "업무범위"],
    content_json: {
      title: "마케팅대행 계약서",
      sections: [
        { title: "제1조 (계약 당사자)", content: "갑 (위탁자): {{회사명}} (대표: {{대표자명}})\n을 (수탁자): {{거래처명}} (대표: {{거래처대표}})" },
        { title: "제2조 (계약 목적)", content: "갑은 을에게 마케팅 업무를 위탁하고, 을은 이를 성실히 수행한다." },
        { title: "제3조 (업무 범위)", content: "을이 수행할 마케팅 업무의 범위는 다음과 같다.\n{{업무범위}}\n\n구체적인 업무 내용 및 산출물은 별첨 SOW(작업범위서)에 따른다." },
        { title: "제4조 (계약 기간)", content: "계약기간: {{계약시작일}} ~ {{계약종료일}} ({{계약기간}})\n갑 또는 을이 계약 만료 30일 전까지 서면으로 해지 통보하지 않는 경우, 동일 조건으로 1년 자동 연장된다." },
        { title: "제5조 (대행 수수료)", content: "총 계약금액: {{계약금액}}원 (부가가치세 별도)\n지급 조건:\n- 계약금: 계약 체결 시 총액의 30%\n- 중도금: 중간 보고 후 총액의 40%\n- 잔금: 최종 납품 후 총액의 30%\n\n을은 세금계산서를 발행하고, 갑은 세금계산서 수령 후 7영업일 이내에 지급한다." },
        { title: "제6조 (산출물 및 보고)", content: "을은 월간 마케팅 실적 보고서를 갑에게 제출한다.\n모든 산출물의 저작권은 대금 완납 시 갑에게 귀속된다." },
        { title: "제7조 (비밀유지)", content: "갑과 을은 본 계약의 이행과정에서 알게 된 상대방의 경영상, 기술상 비밀을 제3자에게 누설하지 않는다.\n본 조항은 계약 종료 후 2년간 유효하다." },
        { title: "제8조 (계약 해지)", content: "일방이 본 계약을 위반한 경우, 상대방은 30일의 최고 기간을 두고 시정을 요구할 수 있으며, 시정되지 않을 경우 계약을 해지할 수 있다." },
      ],
    },
  },
  {
    name: "디자인용역 계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "거래처명", "거래처대표", "계약금액", "계약기간", "납품일", "프로젝트명"],
    content_json: {
      title: "디자인용역 계약서",
      sections: [
        { title: "제1조 (계약 당사자)", content: "갑 (발주자): {{회사명}} (대표: {{대표자명}})\n을 (수급자): {{거래처명}} (대표: {{거래처대표}})" },
        { title: "제2조 (프로젝트 개요)", content: "프로젝트명: {{프로젝트명}}\n갑은 을에게 상기 프로젝트의 디자인 용역을 의뢰하고, 을은 이를 수행한다." },
        { title: "제3조 (용역 범위 및 산출물)", content: "을이 갑에게 제공할 산출물은 다음과 같다.\n- 디자인 시안 (초안 포함 최대 3회 수정)\n- 최종 디자인 원본 파일\n- 스타일 가이드 문서\n\n상세 범위는 별첨 기획서에 따른다." },
        { title: "제4조 (용역 기간)", content: "용역 기간: {{계약기간}}\n최종 납품일: {{납품일}}\n갑의 사유로 일정이 지연될 경우, 을의 납품일은 동일 기간만큼 연장된다." },
        { title: "제5조 (용역 대금)", content: "총 용역 대금: {{계약금액}}원 (부가가치세 별도)\n- 착수금: 계약 체결 시 40%\n- 중도금: 디자인 시안 승인 시 30%\n- 잔금: 최종 납품 완료 후 30%\n\n을은 각 단계별 세금계산서를 발행한다." },
        { title: "제6조 (지식재산권)", content: "용역 대금 완납 시 산출물에 대한 저작재산권은 갑에게 양도된다.\n을은 포트폴리오 목적으로 산출물을 사용할 수 있다." },
        { title: "제7조 (하자 보수)", content: "을은 납품일로부터 3개월간 하자 보수 의무를 진다.\n하자 보수 범위는 계약 범위 내의 오류 수정에 한한다." },
      ],
    },
  },
  {
    name: "기본 용역계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "거래처명", "거래처대표", "계약금액", "계약시작일", "계약종료일", "용역내용"],
    content_json: {
      title: "용역계약서",
      sections: [
        { title: "제1조 (계약 당사자)", content: "갑 (위탁자): {{회사명}} (대표: {{대표자명}})\n을 (수탁자): {{거래처명}} (대표: {{거래처대표}})" },
        { title: "제2조 (용역 내용)", content: "갑은 을에게 다음 용역을 위탁하고, 을은 이를 성실히 이행한다.\n\n{{용역내용}}" },
        { title: "제3조 (계약 기간)", content: "계약 시작일: {{계약시작일}}\n계약 종료일: {{계약종료일}}\n기간 연장은 쌍방 합의에 의한다." },
        { title: "제4조 (용역 대금)", content: "총 용역 대금: {{계약금액}}원 (부가가치세 별도)\n지급 방법: 을이 세금계산서 발행 후 갑은 수령일로부터 14일 이내 지급한다." },
        { title: "제5조 (비밀유지)", content: "갑과 을은 계약 이행 과정에서 취득한 상대방의 비밀정보를 제3자에게 누설하지 아니한다.\n비밀유지 의무는 계약 종료 후 2년간 존속한다." },
        { title: "제6조 (손해배상)", content: "일방의 귀책사유로 상대방에게 손해가 발생한 경우 이를 배상한다." },
        { title: "제7조 (분쟁 해결)", content: "본 계약에 관한 분쟁은 갑의 주소지 관할법원을 전속관할로 한다." },
      ],
    },
  },
  {
    name: "견적서",
    type: "quote",
    variables: ["회사명", "대표자명", "거래처명", "견적일자", "유효기간", "납품조건", "결제조건"],
    content_json: {
      title: "견적서",
      sections: [
        { title: "견적 정보", content: "공급자: {{회사명}} (대표: {{대표자명}})\n수신: {{거래처명}}\n견적일자: {{견적일자}}\n유효기간: {{유효기간}}" },
        { title: "견적 품목", content: "[품목 테이블]\n\n※ 품목은 문서 생성 후 품목 편집 테이블에서 추가해 주세요.\n각 품목의 공급가액, 세액(10%), 합계가 자동 계산됩니다." },
        { title: "거래 조건", content: "납품 조건: {{납품조건}}\n결제 조건: {{결제조건}}\n\n※ 상기 금액은 부가가치세 별도 금액이며, 세금계산서를 발행합니다." },
        { title: "비고", content: "1. 본 견적서의 유효기간은 견적일로부터 {{유효기간}}입니다.\n2. 수량 및 사양 변경 시 단가가 변동될 수 있습니다.\n3. 기타 문의사항은 담당자에게 연락 바랍니다." },
      ],
    },
  },
  {
    name: "업무제휴 계약서 (MOU)",
    type: "agreement",
    variables: ["회사명", "대표자명", "거래처명", "거래처대표", "제휴목적", "제휴기간", "계약시작일", "계약종료일"],
    content_json: {
      title: "업무제휴 계약서 (MOU)",
      sections: [
        { title: "제1조 (계약 당사자)", content: "갑: {{회사명}} (대표: {{대표자명}})\n을: {{거래처명}} (대표: {{거래처대표}})" },
        { title: "제2조 (제휴 목적)", content: "갑과 을은 상호 발전과 시너지 창출을 위하여 다음의 분야에서 업무 제휴를 추진한다.\n\n{{제휴목적}}" },
        { title: "제3조 (제휴 기간)", content: "제휴 기간: {{계약시작일}} ~ {{계약종료일}} ({{제휴기간}})\n쌍방 합의에 의해 연장할 수 있다." },
        { title: "제4조 (상호 협력 사항)", content: "1. 갑과 을은 제휴 목적 달성을 위해 필요한 정보를 상호 제공한다.\n2. 공동 마케팅 및 판촉 활동에 협력한다.\n3. 각 사의 고객에게 상대방의 서비스를 상호 추천할 수 있다.\n4. 필요 시 공동 프로젝트를 추진할 수 있다." },
        { title: "제5조 (비밀유지)", content: "갑과 을은 본 계약 체결 사실 및 이행 과정에서 알게 된 상대방의 경영상, 기술상 정보를 제3자에게 누설하지 아니한다." },
        { title: "제6조 (비용 부담)", content: "제휴 활동에 소요되는 비용은 각 사가 부담함을 원칙으로 하며, 공동 사업의 비용 분담은 별도 합의한다." },
        { title: "제7조 (계약 해지)", content: "일방이 본 계약의 내용을 위반하거나 제휴 목적 달성이 곤란하다고 판단될 경우, 상대방에게 30일 전 서면 통보 후 계약을 해지할 수 있다." },
        { title: "제8조 (효력)", content: "본 계약은 양 당사자의 서명 날인 시 효력이 발생하며, 본 MOU에 명시되지 않은 세부 사항은 별도 계약으로 정한다." },
      ],
    },
  },
  {
    name: "비밀유지계약서 (NDA)",
    type: "nda",
    variables: ["회사명", "대표자명", "거래처명", "거래처대표", "계약목적", "계약시작일", "유효기간"],
    content_json: {
      title: "비밀유지계약서 (Non-Disclosure Agreement)",
      sections: [
        { title: "제1조 (계약 당사자)", content: "정보제공자(갑): {{회사명}} (대표: {{대표자명}})\n정보수령자(을): {{거래처명}} (대표: {{거래처대표}})" },
        { title: "제2조 (계약 목적)", content: "본 계약은 {{계약목적}} 과 관련하여 갑이 을에게 제공하는 정보의 비밀 유지에 관한 사항을 정함을 목적으로 한다." },
        { title: "제3조 (비밀정보의 정의)", content: "본 계약에서 \"비밀정보\"란 갑이 을에게 제공하는 모든 형태의 기술적·경영상 정보로서 다음 각 호를 포함한다.\n1. 사업계획, 재무정보, 고객/거래처 정보\n2. 기술자료, 설계도, 노하우, 소스코드\n3. 서면·구두·전자적 형태로 전달된 모든 자료\n4. 비밀로 표시되거나 합리적으로 비밀임이 인식 가능한 일체의 정보" },
        { title: "제4조 (비밀유지 의무)", content: "1. 을은 비밀정보를 오직 본 계약의 목적 수행을 위해서만 사용한다.\n2. 을은 갑의 사전 서면 동의 없이 비밀정보를 제3자에게 공개·제공·누설하지 아니한다.\n3. 을은 비밀정보를 업무상 필요한 자사 임직원에게만 공개하며, 해당 임직원에게 동일한 의무를 부과한다." },
        { title: "제5조 (예외)", content: "다음의 경우는 비밀정보에서 제외된다.\n1. 갑으로부터 제공받기 전에 이미 공지된 정보\n2. 을의 귀책사유 없이 공지된 정보\n3. 을이 제3자로부터 적법하게 취득한 정보\n4. 법원 또는 관계기관의 명령에 의해 공개가 요구되는 정보" },
        { title: "제6조 (계약 기간 및 유효기간)", content: "계약 시작일: {{계약시작일}}\n비밀유지 의무는 계약 종료 후 {{유효기간}} 동안 존속한다." },
        { title: "제7조 (자료 반환)", content: "계약 종료 또는 갑의 요구 시, 을은 제공받은 모든 비밀정보(사본 포함) 및 관련 자료를 즉시 반환하거나 폐기하고 그 사실을 갑에게 서면으로 확인한다." },
        { title: "제8조 (손해배상)", content: "을이 본 계약을 위반하여 갑에게 손해가 발생한 경우, 을은 갑이 입은 직접·간접 손해를 배상하며, 갑은 법원에 금지가처분을 신청할 수 있다." },
        { title: "제9조 (관할 및 준거법)", content: "본 계약의 해석 및 준거법은 대한민국 법을 따르며, 분쟁은 갑의 주소지 관할법원을 전속관할로 한다." },
      ],
    },
  },
  {
    name: "표준근로계약서",
    type: "employment",
    variables: ["회사명", "대표자명", "근로자명", "주민번호", "주소", "담당업무", "근무장소", "근로시작일", "계약종료일", "급여", "급여지급일", "근무시간"],
    content_json: {
      title: "표준근로계약서",
      sections: [
        { title: "제1조 (근로계약 당사자)", content: "사용자(갑): {{회사명}} (대표: {{대표자명}})\n근로자(을): {{근로자명}} (주민번호: {{주민번호}}, 주소: {{주소}})" },
        { title: "제2조 (근로계약 기간)", content: "근로 시작일: {{근로시작일}}\n계약 종료일: {{계약종료일}}\n※ 기간의 정함이 없는 경우 \"정함 없음\"으로 표기" },
        { title: "제3조 (근무 장소 및 업무)", content: "근무 장소: {{근무장소}}\n담당 업무: {{담당업무}}\n업무상 필요 시 상호 협의하에 변경될 수 있다." },
        { title: "제4조 (소정근로시간)", content: "1일 근로시간: {{근무시간}}\n주 5일 근무 (토·일요일 주휴일)\n휴게시간은 근로기준법에 따라 부여한다." },
        { title: "제5조 (임금)", content: "월 급여(세전): {{급여}}원\n급여 지급일: 매월 {{급여지급일}}일\n지급 방법: 근로자 명의 계좌 이체\n법정 제수당(연장·야간·휴일 근로수당 등)은 근로기준법에 따라 별도 지급한다." },
        { title: "제6조 (휴일 및 연차)", content: "1. 주휴일: 1주 개근 시 1일 유급 부여\n2. 법정공휴일 유급 휴일 (관공서 공휴일 규정 준용)\n3. 연차유급휴가: 근로기준법에 따라 부여" },
        { title: "제7조 (사회보험)", content: "국민연금, 건강보험, 고용보험, 산재보험에 가입하며, 법정 부담분에 따른다." },
        { title: "제8조 (취업규칙 준수)", content: "근로자는 회사의 취업규칙과 제반 규정을 준수하며, 직무상 알게 된 회사의 기밀을 퇴직 후에도 누설하지 아니한다." },
        { title: "제9조 (계약 해지)", content: "근로관계의 해지는 근로기준법 및 회사 취업규칙에 따르며, 일방은 최소 30일 전에 상대방에게 통보한다." },
        { title: "제10조 (기타)", content: "본 계약에 명시되지 않은 사항은 근로기준법 및 회사 취업규칙에 따른다.\n본 계약서는 2부를 작성하여 갑과 을이 각 1부씩 보관한다." },
      ],
    },
  },
  {
    name: "프리랜서 용역계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "프리랜서명", "주민번호", "담당업무", "계약시작일", "계약종료일", "용역비", "지급조건"],
    content_json: {
      title: "프리랜서 용역계약서",
      sections: [
        { title: "제1조 (계약 당사자)", content: "발주자(갑): {{회사명}} (대표: {{대표자명}})\n수급자(을): {{프리랜서명}} (주민번호: {{주민번호}})" },
        { title: "제2조 (계약 성격)", content: "본 계약은 근로계약이 아닌 독립적 사업자 간의 도급계약이며, 을은 갑의 지휘·감독을 받지 아니하고 자율적으로 업무를 수행한다." },
        { title: "제3조 (용역 내용)", content: "담당 업무: {{담당업무}}\n구체적인 산출물 및 일정은 별첨 작업범위서(SOW)에 따른다." },
        { title: "제4조 (계약 기간)", content: "계약 시작일: {{계약시작일}}\n계약 종료일: {{계약종료일}}" },
        { title: "제5조 (용역비 및 지급)", content: "총 용역비: {{용역비}}원 (부가가치세 별도 / 3.3% 사업소득세 원천징수)\n지급 조건: {{지급조건}}" },
        { title: "제6조 (지식재산권)", content: "용역 결과물의 저작재산권은 용역비 완납 시 갑에게 양도된다. 을은 포트폴리오 목적에 한해 사용할 수 있다." },
        { title: "제7조 (비밀유지)", content: "을은 계약 이행 과정에서 알게 된 갑의 기밀정보를 제3자에게 누설하지 아니하며, 본 의무는 계약 종료 후 2년간 존속한다." },
        { title: "제8조 (계약 해지)", content: "일방이 본 계약을 중대하게 위반한 경우 상대방은 서면 통지 후 즉시 계약을 해지할 수 있다." },
        { title: "제9조 (분쟁 해결)", content: "본 계약과 관련된 분쟁은 갑의 주소지 관할법원을 전속관할로 한다." },
      ],
    },
  },
  {
    name: "종합 용역계약서 (상세)",
    type: "contract",
    variables: ["회사명", "대표자명", "사업자번호", "주소", "거래처명", "거래처대표", "거래처사업자번호", "거래처주소", "용역내용", "계약시작일", "계약종료일", "계약금액", "전문인력"],
    content_json: {
      title: "용역계약서",
      sections: [
        { title: "제1조 총칙", content: "제1.1조  이 계약은 {{거래처명}}(이하 '갑'이라 한다)이 {{회사명}}(이하 '계약상대방'이라 한다)에게 {{용역내용}} 업무(이하 '용역업무'라 한다)를 의뢰하고, 계약상대방이 용역업무를 수행함에 있어서 상호 권리와 의무를 명확히 하고, 이를 성실하게 이행하기 위하여 관련 사항을 약정함을 목적으로 한다.\n\n제1.2조  계약상대방은 용역업무의 수행과 관련하여 자신이 가지고 있는 전문적 지식, 노하우, 경험을 최대한 활용하며, 관련 법규를 엄격히 준수한다." },
        { title: "제2조 용역업무의 범위", content: "제2.1조  계약상대방은 다음의 주제에 대하여 업무를 수행하며, 세부 주제, 일정 계획, 업무 범위, 결과물 등은 첨부 1 '업무 제안서'에 따른다.\n\n{{용역내용}}\n\n제2.2조  갑과 계약상대방은 서면으로 합의하여 용역업무의 범위를 변경할 수 있다." },
        { title: "제3조 업무의 수행", content: "제3.1조  계약상대방은 용역업무의 효율적인 수행을 위하여 전문인력을 투입하여 업무를 수행한다. 계약상대방은 갑의 사전 동의 없이 첨부 2 '전문인력 구성'에 기재된 전문인력을 변경할 수 없다. 단, 계약상대방은 필요한 경우 갑에게 사전 통지하고 전문인력을 추가로 투입하여 용역업무를 수행할 수 있으며, 이 경우 추가로 투입한 전문인력이 수행한 용역업무는 무상으로 한다.\n\n제3.2조  계약상대방은 용역업무의 수행과 관련하여 갑의 경영진, 실무팀과 협의를 할 수 있으며, 갑의 경영진, 실무팀의 건해 및 요구 사항을 성실히 청취, 참고하여 용역 수행에 반영한다.\n\n제3.3조  갑의 사무실, 공장, 기타 현장 등에서 용역을 수행하는 계약상대방의 전문인력은 갑의 근무규칙 또는 사내규정을 준수하여야 한다.\n\n제3.4조  계약상대방은 갑이 지정하는 기일 내에 용역업무의 수행을 완료하여야 한다.\n\n제3.5조  계약상대방은 용역업무의 결과물을 갑의 블로그 등에 게시, 배포, 적용 등을 하기 전에 갑의 검수를 받아야 하며, 갑은 검수한 결과 부적합한 사항에 대하여 수정 또는 보완을 요청할 수 있고 이 경우 계약상대방은 갑이 지정하는 기일 이내에 시정 또는 보완하여 재검수를 받아야 한다.\n\n제3.6조  계약상대방이 수행한 개별 용역업무의 결과물이 제3.5조의 검수에 합격하여 갑의 블로그에 게시, 배포, 적용 되는 경우 그 용역업무가 완료된 것으로 본다.\n\n제3.7조  갑은 계약상대방이 용역업무의 수행과 관련하여 필요한 자료를 요청하거나 관계자의 진술을 요청하는 경우 이에 성실히 협력한다." },
        { title: "제4조 용역비의 지급", content: "제4.1조  계약상대방이 수행하는 용역업무에 소요되는 비용(이하 '용역비'라 한다)은 수행한 용역업무의 종류에 따라 첨부 3 '견적서'에서 정하는 금액으로 한다.\n\n제4.2조  계약상대방은 계약기간 동안 매월 완료한 용역업무에 대하여 수행한 용역업무의 내역, 첨부 3 '견적서'에 따라 계산한 용역비 계산서를 다음달 5일까지 갑에게 제출하여 갑의 승인을 받아야 한다.\n\n제4.3조  제4.2조의 승인 이후 계약상대방은 다음달 10일까지 갑에게 세금계산서를 발행하는 방법으로 용역비를 청구하고, 갑은 다음달 30일까지 청구받은 용역비를 첨부 4 '지급계좌 정보'에 따라 계약상대방에게 현금으로 지급한다.\n\n제4.4조  갑은 계약상대방의 용역 업무 수행을 검수한 결과 부적합할 경우 용역비의 지급을 보류하거나 거절할 수 있다.\n\n제4.5조  용역비에 대한 부가가치세는 별도로 갑이 부담한다." },
        { title: "제5조 결과물의 귀속", content: "계약상대방이 갑에게 제공한 용역업무의 결과물 및 그와 관련하여 발생하는 모든 지식재산권은 갑의 독점적 소유로 한다." },
        { title: "제6조 전문인력의 고용책임", content: "제6.1조  계약상대방은 계약상대방의 전문인력이 갑의 고용인력이 아님을 인식하고, 이 계약의 이행을 위하여 계약상대방의 전문인력에 관련된 아래의 사항에 대하여 단독으로 책임을 지며, 갑에 대하여 어떠한 피해가 없도록 한다.\n(가) 근로기준법상의 근로조건, 임금, 퇴직금 등에 관한 모든 책임\n(나) 의료보험, 국민연금, 산재보험, 고용보험 등 법적 보험 및 기금에 관한 모든 책임\n(다) 노동쟁의에 관한 모든 책임\n(라) 전문인력의 임면에 관한 모든 책임\n(마) 복리후생에 관한 모든 책임\n(바) 사업운영과 관련되어 관련 법령의 위반으로 인하여 발생하는 모든 문제에 대한 법적 책임\n(사) 인원정리, 퇴직금 지급 등 계약 해지에 따라 발생하는 모든 법적, 사회통념상의 책임\n\n제6.2조  계약상대방은 계약상대방의 전문인력이 용역대상지역에서 시행되는 안전수칙을 준수하는데 최선을 다하여야 하며, 계약상대방의 전문인력이 근무기간 중 고의나 과실에 의해 발생한 사고에 대해서는 계약상대방의 책임으로 한다." },
        { title: "제7조 손해배상 등", content: "제7.1조  계약상대방이 다음 각호에 해당되는 경우 계약상대방은 갑에게 발생한 모든 손해를 배상하여야 한다.\n(가) 갑의 재산이 계약상대방 또는 전문인력의 근무 소홀 또는 기타 고의, 과실로 인하여 분실, 손과 또는 교환가치, 사용가치가 하락되었을 때\n(나) 계약상대방 또는 전문인력이 직접적 또는 간접적으로 갑의 재산의 부정 반출에 관련된 때\n(다) 전문인력의 무단 결근, 근무 태만 등으로 사업장 질서를 문란케 하여 갑의 업무에 차질이 발생한 때\n(라) 전문인력의 노동쟁의, 기타 이에 준하는 단체행동으로 갑에게 손해를 끼친 때\n(마) 계약상대방의 귀책사유로 인하여 갑의 시설물 등을 파손 및 훼손한 경우 또는 경상적인 계약의 지속이 불가능한 경우로 인하여 계약이 해지되었을 때\n(바) 기타 계약상대방이 이 계약을 위반함으로 갑에게 손해를 끼친 모든 경우\n\n제7.2조  제7.1조의 손해란 갑이 입을 수 있는 직접적, 간접적, 재산적, 신체적 피해 및 이로 인하여 갑이 입은 모든 손해를 말한다.\n\n제7.3조  계약상대방은 이 계약의 이행과 관련하여 제3자에게 손해를 끼친 경우 계약상대방의 책임과 비용으로 갑을 면책하고, 이를 배상하여야 한다.\n\n제7.4조  계약상대방은 갑에게 제공하는 결과물 등이 관계 법령 및 사회상규를 위반하지 아니하고 제3자의 지식재산권, 영업비밀, 초상권 등 권리를 침해하지 않는다는 것을 보증하며, 관계 법령 및 사회상규를 위반하거나 제3자의 권리를 침해할 가능성이 있는 경우 이를 회피하기 위하여 결과물 등을 수정 및 보완하여야 한다.\n\n제7.5조  갑은 계약상대방에게 지급할 용역비에서 위 조항에 따른 손해배상금에 상당하는 금액을 우선 공제할 수 있다." },
        { title: "제8조 계약기간", content: "이 계약의 계약기간은 {{계약시작일}}부터 {{계약종료일}}까지로 하되, 갑과 계약상대방의 서면 합의에 의하여 변경될 수 있다." },
        { title: "제9조 계약의 해제 또는 해지", content: "제9.1조  각 당사자는 다음 각 호의 사유가 발생하는 경우 상대방에 대한 서면통보를 통해 즉시 이 계약의 전부 또는 일부를 해제 또는 해지할 수 있다.\n(가) 각 당사자가 상대방의 업무수행을 방해하거나 기타 부정, 부당 행위를 행하여 이 계약의 목적 달성이 불가능한 경우\n(나) 각 당사자가 발행한 어음 또는 수표의 부도가 발생하는 경우 등 금융기관으로부터 거래정지처분을 받는 경우\n(다) 제3자로부터 가압류, 가처분, 강제집행 등을 받아 이 계약의 이행이 어려운 것으로 객관적으로 판단되는 경우\n(라) 파산 또는 채무자회생절차가 개시신청되는 경우\n\n제9.2조  각 당사자는 상대방이 이 계약, 개별계약 및 부수협정의 중대한 사항을 위반하는 경우 책임 있는 상대방에게 서면으로 시정 또는 계약이행을 통보하고, 이러한 서면통보가 상대방에게 도달된 시점부터 15일이 경과하여도 시정 또는 이 계약이 이행되지 않는 경우 서면 통보를 통해 즉시 이 계약의 전부 또는 일부를 해제 또는 해지할 수 있다.\n\n제9.3조  갑은 제9.1조, 제9.2조에 해당하지 않는 경우에도 계약상대방에게 1개월 이전에 서면통보를 하고 이 계약을 해지할 수 있다.\n\n제9.4조  본 계약이 제9.3조에 의하여 계약기간 중도에 해지되는 경우, 양 당사자는 제4.2조에 따라 계약해지일이 속하는 달이 수행한 용역업무에 관한 용역비를 정산한다.\n\n제9.5조  제9.1조, 제9.2조에 의한 계약의 해제 또는 해지의 경우 책임 있는 당사자는 자신의 귀책사유로 인하여 발생한 손해를 상대방에게 배상한다." },
        { title: "제10조 비밀준수의무", content: "제10.1조  계약상대방은 이 계약과 관련하여 갑으로부터 제공받거나 알게 된 정보, 용역업무의 수행에 따른 결과물 및 이 계약의 내용(이하, '비밀정보'라 한다)을 이 계약기간과 계약의 종료 후에도 엄격히 비밀로 유지 및 관리하여야 하며, 갑의 사전 서면동의 없이는 이를 제3자에게 제공하거나 공개하여서는 아니되며, 이 계약에 정한 목적 혹은 이 계약에 따른 업무의 수행을 위한 목적 이외의 목적으로 사용할 수 없다.\n\n제10.2조  계약상대방은 용역업무를 위하여 알아야 할 필요가 있는 계약상대방의 최소한의 임원 또는 직원을 제외한 어떠한 제3자에게도 비밀정보를 공개하여서는 아니 된다.\n\n제10.3조  계약상대방은 이 계약의 종료 후 그리고 계약기간 중이라도 갑의 요구가 있는 경우에는 비밀정보의 사용을 즉시 중단하여야 하고, 제공된 비밀정보의 원본, 복사본, 기타 갑으로부터 제공받은 모든 서류와 자료 및 이를 기초로 하여 생성된 자료를 갑의 지시에 따라 반환 또는 폐기하여야 한다." },
        { title: "제11조 비윤리적 행위의 금지", content: "제11.1조  양 당사자는 이 계약서의 체결, 이행, 유지에 있어서 거래의 공정성 확보가 중요한 전제 조건임을 인식하고, 거래의 공정성을 해할 수 있는 행위(이하 '비윤리적 행위'라 한다)를 하여서는 아니 된다. 비윤리적 행위의 예로는 다음 각 호에 열거되어 있는 바와 같다(단, 이에 한하지 아니한다).\n(가) 금전을 제공하는 행위\n(나) 사회통념 수준을 초과하는 선물 또는 식사를 제공하는 행위\n(다) 불건전업소, 오락, 골프, 스키 등의 향응 및 접대를 하는 행위\n(라) 출장 지원, 개인 휴가 지원, 사무실 비품 제공, 협찬/찬조 등의 편의를 제공하는 행위\n(마) 차용/매입/매도, 부채상환, 보증, 금전대차 등 금전 또는 부동산 관련 모든 거래행위\n(바) 공동투자 및 공동재산의 취득 기회를 제공하거나, 합작투자 또는 당사자에 겸직하도록 하는 행위\n(사) 당사자의 주식이나 기타 관련 업체의 주식을 제공 또는 투자하도록 하거나 기타 재산을 취득하도록 하는 행위\n(아) 고용보장, 취업알선의 약속 등 미래에 대한 보장을 하는 행위\n(자) 기타 상대방이 공정하게 업무를 수행하는데 지장을 초래하는 행위\n\n제11.2조  양 당사자는 거래의 공정성 확보를 위하여 다음 각 호의 사항을 협조한다.\n(가) 각 당사자(임직원 포함)에 의하여 이루어진 비윤리적 행위가 발견되거나 비윤리적 행위에 대한 의혹이 있는 경우 상대방은 비윤리적 행위에 관련된 당사자에게 그와 관련된 자료의 제출, 열람 및 사실관계 확인조사 등을 요구할 수 있으며 이 경우 비윤리적 행위에 관련된 당사자는 상대방의 요구에 적극 협조하여야 한다.\n(나) 각 당사자는 상대방(임조원 포함)으로부터 비윤리적 행위를 제의받거나 이러한 사실을 인지한 때에는 상대방의 관련 부서에 즉시 신고하여야 한다." },
        { title: "제12조 지체상금", content: "계약상대방이 갑이 지정한 일정 내에 용역업무를 완료하지 못한 경우 그 지연일수 1일당 지연된 용역업무와 관련한 용역비의 1000분의 3에 해당하는 금액을 갑에게 지급하여야 한다. 다만, 그 지연사유가 갑에게 있거나 갑이 인정하는 경우 또는 불가항력에 의한 경우는 예외로 한다." },
        { title: "제13조 일반 사항", content: "제13.1조  각 당사자는 천재지변, 폭동, 전쟁 등과 같은 불가항력(단, 대내외적 노동쟁의 기타 이에 준하는 단체행동은 불가항력으로 보지 아니한다)으로 인한 계약상 의무의 불이행이나 이행 지연에 대하여 책임을 지지 아니한다.\n\n제13.2조  이 계약에 대한 계약조건의 추가 또는 수정과 같은 내용 변경은 양 당사자의 서면 합의에 의하지 아니하면 이를 무효로 한다.\n\n제13.3조  갑은 계약상대방에 대하여 가지고 있는 채권을 자동채권으로 하여 계약상대방이 갑에 대하여 가지고 있는 채권과 상계할 수 있다.\n\n제13.4조  계약상대방은 갑의 사전 서면 동의 없이는 이 계약에 따른 어떠한 권리, 의무의 전부 또는 일부를 제3자에게 양도하거나 기타 여하한 처분을 할 수 없다.\n\n제13.5조  이 계약에 포함되지 아니한 사항은 일반 관례에 따른다." },
        { title: "제14조 관할법원", content: "이 계약과 관련하여 분쟁이 발생하는 경우 서울중앙지방법원을 전속적 제1심 관할법원으로 한다." },
        { title: "제15조 잔존효력", content: "이 계약이 종료된 이후에도 각 당사자의 이 계약상 채무가 모두 이행될 때까지 채무이행에 관련된 이 계약 각 규정의 효력이 존속한다." },
      ],
    },
  },
  {
    name: "콘텐츠 제작 계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "사업자번호", "주소", "거래처명", "거래처대표", "거래처사업자번호", "거래처주소", "계약금액", "계약시작일", "계약종료일", "콘텐츠내용", "납품기한", "보완횟수"],
    content_json: {
      title: "콘텐츠 제작 계약서",
      sections: [
        { title: "제1조 (목적)", content: "본 계약은 \"위탁자\"가 \"수탁자\"에게 콘텐츠(이하 \"콘텐츠\"라 하며, 사진, 이미지, 텍스트, 동영상, 마케팅 등 \"수탁자\"가 \"위탁자\"에게 납품하는 저작물 일체를 의미한다) 제작을 위탁함에 있어 양 당사자 간의 권리와 의무 및 제반사항을 규정하는 것을 목적으로 한다.\n\n위탁자(갑): {{거래처명}} (대표: {{거래처대표}})\n수탁자(을): {{회사명}} (대표: {{대표자명}})" },
        { title: "제2조 (콘텐츠의 제작 및 사용)", content: "① \"위탁자\"가 \"수탁자\"에게 제작을 의뢰하는 \"콘텐츠\"의 구체적인 내용은 [첨부1. 견적서]와 같다.\n\n② \"수탁자\"는 \"위탁자\"에게 상호 협의한 기한 내에 [첨부1. 견적서]에 명시된 \"콘텐츠\"를 납품한다.\n\n③ \"위탁자\"가 \"콘텐츠\"를 사용함에 있어 추가로 발생하는 각종 저작료(이미지, 사진, 음원, 서체 등) 및 모델의 초상권 사용료 등의 비용은 \"위탁자\"가 부담한다." },
        { title: "제3조 (의무사항)", content: "① \"위탁자\"는 \"수탁자\"가 본 계약을 이행하는데 필요한 정보, 상품, 이미지, 표지 등(이하 \"자료\"라 한다)을 제공한다.\n\n② \"수탁자\"는 \"위탁자\"와 협의한 기한 내에 \"콘텐츠\"를 제작하고, 납품하기 전 \"위탁자\"에게 검수를 요청한다.\n\n③ \"위탁자\"는 \"수탁자\"의 검수 요청에 지체없이 검수 결과를 회신하고, \"위탁자\"가 \"수탁자\"에게 검수 완료 회신을 한 때에 \"수탁자\"의 납품을 완료한 것으로 한다.\n\n④ \"위탁자\"는 \"콘텐츠\" 납품 전까지 \"콘텐츠\"의 세부 사항에 대한 수정 또는 보완을 {{보완횟수}}회까지 요청할 수 있으며, \"수탁자\"는 \"위탁자\"의 요청을 반영하는데 소요되는 비용을 추가로 청구할 수 있다." },
        { title: "제4조 (지식재산권 등)", content: "① \"콘텐츠\"에 대한 저작권 등 지식재산권은 이를 창작 및 제작한 \"수탁자\"에게 귀속된다.\n\n② \"수탁자\"는 \"위탁자\"에게 납품하는 \"콘텐츠\"가 제3자의 지식재산권을 침해하지 아니함을 보증한다. 다만, \"위탁자\"가 \"수탁자\"에게 제공한 \"자료\"로 인하여 제3자의 지식재산권 등의 권리를 침해하는 경우는 보증의 범위에서 제외한다.\n\n③ \"위탁자\"는 \"수탁자\"에게 제공한 \"자료\"가 제3자의 지식재산권을 침해하지 아니함을 보증한다.\n\n④ \"위탁자\"는 납품 받은 \"콘텐츠\"를 사용하는 과정에서 임의로 \"콘텐츠\"를 수정, 변형, 편집하는 등으로 \"콘텐츠\"에 대한 동일성을 침해하지 아니한다.\n\n⑤ 일방 당사자가 제2항 내지 제4항을 위반하여 제3자로부터 지식재산권 등 기타 권리를 침해한다는 이유로 이의 또는 분쟁이 발생할 경우 위반당사자는 상대방을 면책 시키고 자신의 비용과 책임으로 이를 해결하여야 한다.\n\n⑥ \"수탁자\"는 콘텐츠 제작 관련 서비스의 소개 및 영업을 목적으로 \"콘텐츠\"를 활용할 수 있다." },
        { title: "제5조 (콘텐츠제작비)", content: "① \"위탁자\"는 \"수탁자\"에게 \"콘텐츠\" 제작에 대한 대가(이하 \"콘텐츠제작비\"라 한다)를 지급하며, \"콘텐츠제작비\"의 구체적인 내용은 [첨부1. 견적서]에 따른다.\n\n② \"위탁자\"는 본 계약 체결일로부터 [10]일 이내에 \"콘텐츠제작비\"를 \"수탁자\"가 지정한 계좌로 입금한다.\n\n③ 본계약 제3조 제4항 등의 사유로 \"위탁자\"가 본조 제2항의 \"콘텐츠제작비\"를 입금한 이후 추가 비용이 발생할 경우, \"위탁자\"는 \"수탁자\"에게 \"콘텐츠\" 납품 완료일로부터 7일 이내에 해당 추가 비용을 지급하여야 한다." },
        { title: "제6조 (계약의 해지)", content: "① \"위탁자\" 또는 \"수탁자\"가 다음 각 호의 어느 하나에 해당되는 경우, 상대방은 별도의 최고 없이 서면의 통지로써 본 계약을 즉시 해지할 수 있다.\n  1. 주요 재산에 대하여 압류, 가압류, 가처분, 경매 기타 강제처분이 있는 경우\n  2. 회생, 파산, 금융기관의 거래정지 등 이에 준하는 사유가 발생한 경우\n  3. 영업취소 또는 영업정지 처분을 받아 본 계약을 지속하지 어렵다고 인정되는 경우\n  4. 본 계약을 불이행 또는 위반하여, 상대방으로부터 7일 이상의 기간을 정한 이행 또는 시정을 요구 받았으나 기간 내에 이행 또는 시정하지 아니한 경우\n\n② 본 조에 의하여 본 계약이 해지될 경우, \"위탁자\"는 계약해지일 전까지 \"수탁자\"가 수행한 업무에 대한 대가를 [첨부1. 견적서]에서 정한 단가를 기준으로 지급하여야 한다.\n\n③ 본 조에 의한 계약의 해지는 상대방에 대한 손해배상청구에 영향을 미치지 아니한다." },
        { title: "제7조 (손해배상)", content: "\"위탁자\" 또는 \"수탁자\"의 귀책으로 인하여 상대방 또는 제3자에게 손해가 발생하는 경우, 귀책당사자는 상대방 및 제3자의 손해를 전부 배상하여야 한다. 단, 천재지변, 비상사태, 법규상의 제한, 공공기관의 행정지도 또는 이에 준하는 부득이한 사정으로 인한 경우는 예외로 한다." },
        { title: "제8조 (양도금지)", content: "\"위탁자\" 또는 \"수탁자\"는 상대방의 사전 동의 없이 본 계약 상의 권리나 의무를 제3자에게 양도하거나 담보로 제공하지 아니한다." },
        { title: "제9조 (비밀유지)", content: "\"위탁자\" 또는 \"수탁자\"는 본 계약을 이행하는 과정에서 알게 된 상대방의 시장정보, 경영정보, 영업정보 등 일체의 정보(이하 \"비밀정보\"라 한다)를 상대방의 사전 서면 승낙 없이 제3자에게 제공 또는 누설하지 아니한다. 단, 관련법령, 법원의 명령 기타 정부기관의 적법한 요청에 따라 제공 또는 공개하는 경우는 예외로 한다." },
        { title: "제10조 (계약의 변경)", content: "\"위탁자\"와 \"수탁자\"는 상호 서면 합의로써 본 계약의 내용을 수정, 변경할 수 있다." },
        { title: "제11조 (분쟁의 해결)", content: "본 계약과 관련하여 당사자 간에 분쟁이 발생할 경우에는 관련법령 및 일반 상관례에 따라 상호 합의에 의하여 해결하되, 합의가 이루어지지 않을 경우에는 서울중앙지방법원을 제1심의 전속적 합의 관할로 하는 소송 절차에 따른다." },
        { title: "제12조 (계약기간)", content: "본 계약의 계약 기간은 {{계약시작일}}부터 {{계약종료일}}까지로 한다." },
      ],
    },
  },
  {
    name: "광고업무대행 계약서",
    type: "contract",
    variables: ["회사명", "대표자명", "사업자번호", "주소", "거래처명", "거래처대표", "거래처사업자번호", "거래처주소", "계약시작일", "계약종료일", "광고매체", "대행수수료율"],
    content_json: {
      title: "광고업무대행 계약서",
      sections: [
        { title: "제1조 (계약의 목적)", content: "본 계약은 \"갑\"이 \"을\"에게 광고업무대행을 위임함에 있어 상호 신뢰로서 업무를 진행하며 \"을\"은 \"갑\"의 업무를 성실히 수행, 동반자로서 양사간의 이익을 도모함을 목적으로 한다.\n\n광고주(갑): {{거래처명}} (대표: {{거래처대표}})\n대행사(을): {{회사명}} (대표: {{대표자명}})" },
        { title: "제2조 (업무 처리의 범위)", content: "\"을\"이 처리하는 온라인 광고 집행 업무 처리의 범위는 다음과 같다.\n1. 광고 운영 매체 : {{광고매체}}\n2. 광고 매체와 목적에 맞는 적절한 캠페인 운영 전략 도출 및 제안\n3. 광고 결과에 대한 데이터 제공에 관한 사항\n4. 기타 \"갑\"의 요청에 의한 온라인 광고 업무의 부대사항" },
        { title: "제3조 (전제조건)", content: "1. 광고업무를 효과적으로 수행하기 위하여 \"갑\"은 \"을\"이 필요한 정보 및 자료를 제공하고 \"을\"은 이를 일절 외부에 누설하지 아니한다.\n\n2. \"을\"은 광고업무 외에 \"갑\"의 기업PR및 홍보활동이나 각종조사 자료의 수집, 분석등 일반적인 서비스 업무에 대해 협조한다. (단, 이 경우에 소요되는 비용은 \"갑\"이 부담한다.)" },
        { title: "제4조 (광고비 및 광고 대행료의 지급)", content: "1. \"갑\"은 \"을\"에게 받는 견적서 상의 광고 집행비를 \"을\"이 세금계산서를 발행 이후 \"을\"지 지정한 계좌에 영업일 5일 이내 입금하기로 한다.\n\n2. \"을\"은 매 월 META(Facebook, Instagram)에서 사용하는 총 광고비용의 {{대행수수료율}}를 광고 대행료로 청구한다.\n\n3. 계약 사항 이외에 부득이한 추가 경비가 발생하는 경우 \"갑\"과 \"을\" 상호간 별도 서면 합의에 의해 정한다." },
        { title: "제5조 (기밀준수 및 독점관련)", content: "\"갑\"과 \"을\"은 이 계약서상의 업무와 관련하여 알게 된 상대방의 영업비밀 또는 고객정보에 대하여 계약기간에 관계없이 상대방의 서면동의 없이 제3자에게 유출하거나 계약서상의 업무 이외의 목적으로 이용하여서는 아니되며, 이를 위반하여 발생하는 모든 손해에 대해서는 그 위반 당사자가 모든 민·형사상의 책임을 진다." },
        { title: "제6조 (계약기간)", content: "본 계약의 유효기간은 {{계약시작일}}부터 1년간으로 하며, 유효기간 종료 1개월 전까지 어느 일방으로부터 서면에 의한 계약해지 통보가 없는 경우에는 자동적으로 1년 단위로 연장되는 것으로 본다." },
        { title: "제7조 (계약의 변경)", content: "1. 본 계약의 일부 또는 전부를 변경할 필요가 있는 경우에는 \"갑\"과 \"을\"의 서면합의에 의하여 이를 변경하고, 그 변경내용은 변경한 날 다음날로부터 효력을 가진다.\n\n2. 계약 기간 등 계약의 내용을 변경하고자 할 경우 해당 변경일로부터 15일 전에 서면 통보하여 합의한다." },
        { title: "제8조 (권리, 의무의 승계)", content: "본 계약상의 모든 권리와 의무는 \"갑\" 또는 \"을\"의 합병, 영업양도, 경영 위임 등의 경우에도 \"갑\" 또는 \"을\"의 합병회사, 영업양수인, 경영수임인 등에게 승계되며, \"갑\" 또는 \"을\"은 그들로 하여금 본 계약상의 권리와 의무를 승계하는 것에 동의하도록 할 의무를 진다." },
        { title: "제9조 (권리 등의 양도등 금지)", content: "\"갑\"과 \"을\"은 상대방의 서면 동의 없이 본 계약상의 일체의 권리, 의무 등을 제3자에게 양도, 증여, 대물변제, 대여하거나 담보로 제공할 수 없다." },
        { title: "제10조 (계약 해제 및 해지)", content: "1. \"갑\" 또는 \"을\"은 다음 각 호의 사유가 발생한 경우에는 계약기간에 관계없이 상대방에 대한 서면통지로써 본 계약을 해제 또는 해지할 수 있다.\n  1) 상대방이 정당한 사유 없이 본 계약 또는 본 계약에 따라 별도로 체결한 약정에서 정한 사항을 위반하고 서면으로 시정요구를 받은 날로부터 7일 이내에 해당 위반사항을 시정하지 않은 경우\n  2) 자신 또는 상대방에 대하여 주요재산에 대한 보전처분결정 및 강제집행, 국세 또는 지방세의 체납절차, 화의, 회사정리, 파산 등의 개시로 인하여 더 이상 계약유지가 곤란한 경우\n  3) 기타 본 계약을 수행하기 어려운 중대한 사유가 발생한 경우\n\n2. 제1항의 해제 또는 해지는 \"갑\"과 \"을\"의 손해배상 청구에 영향을 미치지 아니한다." },
        { title: "제11조 (계약의 유보사항)", content: "1. 본 계약에서 정하지 아니한 사항이나 해석상 내용이 불분명한 사항에 대해서는 관계 법령 및 상관습에 따라 상호 협의하여 결정한다.\n\n2. 제1항과 관련하여 필요한 경우 \"갑\"과 \"을\"은 별도의 약정을 할 수 있으며, 이는 본 계약의 일부를 이룬다." },
        { title: "제12조 (분쟁해결)", content: "본 계약과 관련하여 소송상의 분쟁이 발생한 때에는, \"갑\" 또는 \"을\"의 본사 소재지를 관할하는 법원을 통해 중재하기로 한다." },
      ],
    },
  },
];

// ── Templates Tab Component ──
function TemplatesTab({ companyId, userId, templates, onInvalidate }: {
  companyId: string; userId: string; templates: any[]; onInvalidate: () => void;
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      for (const tpl of DEFAULT_TEMPLATES) {
        await (supabase as any).from("doc_templates").insert({
          company_id: companyId,
          created_by: userId,
          name: tpl.name,
          type: tpl.type,
          content_json: tpl.content_json,
          variables: tpl.variables,
          is_active: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
    } finally {
      setSeeding(false);
    }
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", type: "contract", content_json: { title: "", sections: [{ title: "", content: "" }] }, variables: [] as string[],
  });
  const [newVar, setNewVar] = useState("");

  const resetForm = () => {
    setForm({ name: "", type: "contract", content_json: { title: "", sections: [{ title: "", content: "" }] }, variables: [] });
    setNewVar("");
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (tpl: any) => {
    const cj = tpl.content_json || { title: "", sections: [] };
    setForm({
      name: tpl.name,
      type: tpl.type || "contract",
      content_json: {
        title: cj.title || tpl.name,
        sections: Array.isArray(cj.sections) && cj.sections.length > 0 ? cj.sections : [{ title: "", content: "" }],
      },
      variables: Array.isArray(tpl.variables) ? tpl.variables : [],
    });
    setEditingId(tpl.id);
    setShowForm(true);
    setPreviewId(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        content_json: form.content_json,
        variables: form.variables,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await (supabase as any).from("doc_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("doc_templates").insert({
          ...payload,
          company_id: companyId,
          created_by: userId,
          is_active: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("doc_templates").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
    },
  });

  const addSection = () => {
    setForm({
      ...form,
      content_json: {
        ...form.content_json,
        sections: [...form.content_json.sections, { title: "", content: "" }],
      },
    });
  };

  const removeSection = (idx: number) => {
    setForm({
      ...form,
      content_json: {
        ...form.content_json,
        sections: form.content_json.sections.filter((_: any, i: number) => i !== idx),
      },
    });
  };

  const updateSection = (idx: number, field: "title" | "content", value: string) => {
    const sections = [...form.content_json.sections];
    sections[idx] = { ...sections[idx], [field]: value };
    setForm({ ...form, content_json: { ...form.content_json, sections } });
  };

  const addVariable = () => {
    const v = newVar.trim().replace(/\s+/g, "_");
    if (v && !form.variables.includes(v)) {
      setForm({ ...form, variables: [...form.variables, v] });
      setNewVar("");
    }
  };

  const removeVariable = (v: string) => {
    setForm({ ...form, variables: form.variables.filter((x: string) => x !== v) });
  };

  const previewTemplate = templates.find((t: any) => t.id === previewId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">문서 양식을 관리하고, 커스텀 양식을 등록하세요</p>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-sm font-semibold transition"
        >
          + 새 양식 등록
        </button>
      </div>

      {/* Template Form (Create / Edit) */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-purple-500/20 p-6">
          <h3 className="text-sm font-bold mb-4 text-purple-600">
            {editingId ? "양식 수정" : "새 양식 등록"}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">양식명 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="마케팅대행 계약서"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서 유형</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500">
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-1">제목</label>
            <input value={form.content_json.title}
              onChange={(e) => setForm({ ...form, content_json: { ...form.content_json, title: e.target.value } })}
              placeholder="문서 제목"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500" />
          </div>

          {/* Sections */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-muted)]">섹션</label>
              <button onClick={addSection} className="text-xs text-purple-500 hover:text-purple-600 font-medium">
                + 섹션 추가
              </button>
            </div>
            <div className="space-y-3">
              {form.content_json.sections.map((sec: any, idx: number) => (
                <div key={idx} className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-[var(--text-dim)] font-medium">섹션 {idx + 1}</span>
                    {form.content_json.sections.length > 1 && (
                      <button onClick={() => removeSection(idx)} className="text-[10px] text-red-400 hover:text-red-500">삭제</button>
                    )}
                  </div>
                  <input value={sec.title} onChange={(e) => updateSection(idx, "title", e.target.value)}
                    placeholder="섹션 제목 (예: 제1조 목적)"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-2 focus:outline-none focus:border-purple-500" />
                  <textarea value={sec.content} onChange={(e) => updateSection(idx, "content", e.target.value)}
                    placeholder="섹션 내용... {{변수명}} 형식으로 변수를 삽입할 수 있습니다"
                    rows={4}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-purple-500 resize-y font-mono" />
                </div>
              ))}
            </div>
          </div>

          {/* Variables */}
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-2">변수 (&#123;&#123;변수명&#125;&#125; 형식으로 본문에 사용)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.variables.map((v: string) => (
                <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 text-purple-500 rounded-full text-xs">
                  {`{{${v}}}`}
                  <button onClick={() => removeVariable(v)} className="text-purple-400 hover:text-red-400">&times;</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newVar} onChange={(e) => setNewVar(e.target.value)}
                placeholder="변수명 (예: employee_name)"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVariable())}
                className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-purple-500" />
              <button onClick={addVariable}
                className="px-3 py-2 bg-purple-500/10 text-purple-500 rounded-lg text-xs font-semibold hover:bg-purple-500/20 transition">
                추가
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => form.name && saveMut.mutate()} disabled={!form.name || saveMut.isPending}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saveMut.isPending ? "저장 중..." : editingId ? "수정" : "등록"}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {templates.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">📝</div>
            <div className="text-lg font-bold mb-2">등록된 양식이 없습니다</div>
            <div className="text-sm text-[var(--text-muted)] mb-4">기본 양식 8종을 한번에 등록하거나, 직접 만들 수 있습니다</div>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="px-5 py-2.5 bg-purple-500 text-white rounded-xl text-sm font-semibold hover:bg-purple-600 transition disabled:opacity-50"
            >
              {seeding ? "등록 중..." : "기본 양식 8종 등록하기"}
            </button>
            <p className="text-[10px] text-[var(--text-dim)] mt-2">마케팅대행 · 디자인용역 · 기본용역 · 견적서 · 업무제휴(MOU) · NDA · 표준근로계약서 · 프리랜서계약서</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {templates.map((tpl: any) => {
              const typeLabel = DOC_TYPES.find(t => t.value === tpl.type)?.label || tpl.type;
              const vars = Array.isArray(tpl.variables) ? tpl.variables : [];
              const isPreview = previewId === tpl.id;
              const sectionCount = Array.isArray(tpl.content_json?.sections) ? tpl.content_json.sections.length : 0;

              return (
                <div key={tpl.id}>
                  <div className="px-5 py-4 hover:bg-[var(--bg-surface)] transition">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tpl.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500">{typeLabel}</span>
                          {sectionCount > 0 && (
                            <span className="text-[10px] text-[var(--text-dim)]">{sectionCount}개 섹션</span>
                          )}
                        </div>
                        {vars.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {vars.slice(0, 6).map((v: string) => (
                              <span key={v} className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text-dim)] font-mono">
                                {`{{${v}}}`}
                              </span>
                            ))}
                            {vars.length > 6 && (
                              <span className="text-[10px] text-[var(--text-dim)]">+{vars.length - 6}개</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPreviewId(isPreview ? null : tpl.id)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">
                          {isPreview ? "접기" : "미리보기"}
                        </button>
                        <button onClick={() => startEdit(tpl)}
                          className="text-xs text-purple-500 hover:text-purple-600 font-medium transition">
                          수정
                        </button>
                        <button onClick={() => {
                          if (confirm(`"${tpl.name}" 양식을 삭제하시겠습니까?`)) deleteMut.mutate(tpl.id);
                        }}
                          className="text-xs text-red-400 hover:text-red-500 font-medium transition">
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Preview Panel */}
                  {isPreview && previewTemplate && (
                    <div className="px-5 pb-4">
                      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-5">
                        <h4 className="text-sm font-bold mb-3">{previewTemplate.content_json?.title || previewTemplate.name}</h4>
                        <div className="space-y-3">
                          {(previewTemplate.content_json?.sections || []).map((sec: any, idx: number) => (
                            <div key={idx}>
                              {sec.title && <div className="text-xs font-semibold text-[var(--text)] mb-1">{sec.title}</div>}
                              <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap font-mono leading-relaxed">{sec.content}</pre>
                            </div>
                          ))}
                        </div>
                        {vars.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-[var(--border)]">
                            <span className="text-[10px] text-[var(--text-dim)] uppercase">입력 필요 변수</span>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {vars.map((v: string) => (
                                <span key={v} className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-500 rounded-full font-mono">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <DocumentsPageInner />
    </Suspense>
  );
}

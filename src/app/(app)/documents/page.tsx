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

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((doc: any) =>
        doc.name?.toLowerCase().includes(term) ||
        (doc as any).full_text?.toLowerCase().includes(term) ||
        (doc as any).auto_classified_type?.toLowerCase().includes(term)
      );
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
      <div className="flex items-center justify-between mb-8">
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
      <div className="flex gap-3 mb-6">
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
          className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] min-w-[160px]"
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
              <div className="text-lg font-bold mb-2">
                {searchTerm || typeFilter !== "all" ? "검색 결과가 없습니다" : "문서가 없습니다"}
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                {searchTerm || typeFilter !== "all" ? "다른 검색어나 필터를 시도하세요" : "계약서, 견적서, 제안서를 생성하세요"}
              </div>
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
    <div className="flex gap-6">
      {/* Left: Folder Tree */}
      <div className="w-[240px] shrink-0">
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

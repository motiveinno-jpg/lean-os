"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { getCurrentUser, getDocuments, getDocTemplates, getDeals, getTaxInvoices, getDocument, getDocRevisions, getDocApprovals } from "@/lib/queries";
import { createBlankDocument, DOC_TYPES, DOC_STATUS } from "@/lib/documents";
import { saveRevision, submitForReview, approveDocument, lockDocument } from "@/lib/documents";
import { createTaxInvoice, INVOICE_TYPES, INVOICE_STATUS } from "@/lib/tax-invoice";
import { classifyDocument, getDocTypeInfo, DOC_INTEL_TYPES, saveDocumentIntelligence, extractContractFields } from "@/lib/doc-intelligence";
import { createSignatureRequest, getSignatureRequests, getDocumentSignatures, updateSignatureStatus, saveSignature, cancelSignature, getSignatureStatusInfo, SIGNATURE_STATUS } from "@/lib/signatures";
import { createNotification } from "@/lib/notifications";
import { uploadFile, getFilesForDocument, createFolder, getFolders, deleteFolder, searchFiles, deleteFile } from "@/lib/file-storage";
import { generateDocumentPDF, issueDocument } from "@/lib/document-generator";
import { FileUploadMulti } from "@/components/file-upload-multi";
import { FileList } from "@/components/file-list";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/models";

const db = supabase as any;

// ── Document Detail (previously documents/[id]/client.tsx) ──

function DocumentDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [comment, setComment] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [showSignRequestForm, setShowSignRequestForm] = useState(false);
  const [signForm, setSignForm] = useState({ signerName: "", signerEmail: "", signerPhone: "" });
  const [tab, setTab] = useState<"content" | "revisions" | "approvals">("content");

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); }
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
      // Send status to 'sent' immediately
      await updateSignatureStatus(result.id, 'sent');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
      setShowSignRequestForm(false);
      setSignForm({ signerName: "", signerEmail: "", signerPhone: "" });
    },
  });

  const { data: doc } = useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id),
    enabled: !!id,
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
    }
  }, [doc?.content_json]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["document", id] });
    queryClient.invalidateQueries({ queryKey: ["doc-revisions", id] });
    queryClient.invalidateQueries({ queryKey: ["doc-approvals", id] });
  };

  const saveMut = useMutation({
    mutationFn: () => saveRevision({
      documentId: id,
      authorId: userId!,
      contentJson: { ...(doc?.content_json as any || {}), body: editContent } as unknown as Json,
      comment: comment || undefined,
    }),
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
                const pdfBlob = await generateDocumentPDF({
                  title: doc.name,
                  content: editContent,
                  companyName,
                  companyInfo: company.data ? {
                    representative: company.data.representative,
                    address: company.data.address,
                    businessNumber: company.data.business_number,
                  } : undefined,
                });
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${doc.name}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err: any) {
                alert('PDF 생성 실패: ' + (err?.message || err));
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
                alert('문서번호가 발급되었습니다.');
                invalidate();
              } catch (err: any) {
                alert('문서번호 발급 실패: ' + (err?.message || err));
              }
            }}
            className="px-4 py-2 bg-teal-500/10 text-teal-500 rounded-lg text-xs font-semibold hover:bg-teal-500/20 transition">
            문서번호 발급
          </button>
          <button onClick={() => setShowSignRequestForm(!showSignRequestForm)}
            className="px-4 py-2 bg-indigo-500/10 text-indigo-500 rounded-lg text-xs font-semibold hover:bg-indigo-500/20 transition">
            서명 요청
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

      {/* Signature Request Form */}
      {showSignRequestForm && (
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-indigo-500 mb-3">전자서명 요청</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">서명자 이름 *</label>
              <input
                value={signForm.signerName}
                onChange={(e) => setSignForm({ ...signForm, signerName: e.target.value })}
                placeholder="홍길동"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이메일 *</label>
              <input
                type="email"
                value={signForm.signerEmail}
                onChange={(e) => setSignForm({ ...signForm, signerEmail: e.target.value })}
                placeholder="signer@example.com"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">전화번호</label>
              <input
                type="tel"
                value={signForm.signerPhone}
                onChange={(e) => setSignForm({ ...signForm, signerPhone: e.target.value })}
                placeholder="010-0000-0000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => signForm.signerName && signForm.signerEmail && signRequestMut.mutate()}
              disabled={!signForm.signerName || !signForm.signerEmail || signRequestMut.isPending}
              className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {signRequestMut.isPending ? "발송 중..." : "서명 요청 발송"}
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
      {docSignatures.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-6">
          <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3">서명 이력</h4>
          <div className="space-y-2">
            {docSignatures.map((sig: any) => {
              const si = getSignatureStatusInfo(sig.status);
              return (
                <div key={sig.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${si.dot}`} />
                    <span className="font-medium">{sig.signer_name}</span>
                    <span className="text-[var(--text-dim)]">{sig.signer_email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full ${si.bg} ${si.text}`}>{si.label}</span>
                    {sig.signed_at && (
                      <span className="text-[var(--text-dim)]">{new Date(sig.signed_at).toLocaleDateString("ko")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
  const [tab, setTab] = useState<"docs" | "contracts" | "invoices" | "signatures" | "files">("docs");
  const [showDocForm, setShowDocForm] = useState(false);
  const [showInvForm, setShowInvForm] = useState(false);
  const [showSignForm, setShowSignForm] = useState(false);
  const [signFormData, setSignFormData] = useState({ documentId: "", signerName: "", signerEmail: "", signerPhone: "" });
  const [selectedSignature, setSelectedSignature] = useState<any>(null);
  const [signStatusFilter, setSignStatusFilter] = useState<string>("all");
  const [docForm, setDocForm] = useState({ name: "", type: "contract", deal_id: "" });
  const [invForm, setInvForm] = useState({ type: "sales" as "sales" | "purchase", counterparty_name: "", supply_amount: "", issue_date: "", deal_id: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  const { data: documents = [] } = useQuery({
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
      await updateSignatureStatus(result.id, 'sent');
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

  const createDocMut = useMutation({
    mutationFn: async () => {
      // Create the document
      const newDoc = await createBlankDocument({
        companyId: companyId!, dealId: docForm.deal_id || undefined,
        name: docForm.name, type: docForm.type, createdBy: userId!,
      });

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
      setDocForm({ name: "", type: "contract", deal_id: "" });
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

  // If an ID is selected, show the detail view
  if (selectedId) {
    return (
      <DocumentDetailView
        id={selectedId}
        onBack={() => router.push("/documents")}
      />
    );
  }

  return (
    <div className="max-w-[1100px]">
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
      </div>

      {/* Doc Form */}
      {showDocForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">새 문서 생성</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {contractDocuments.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📋</div>
              <div className="text-lg font-bold mb-2">계약서가 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">계약서를 생성하면 여기에 표시됩니다</div>
            </div>
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
                  <th className="text-left px-5 py-3 font-medium">생성일</th>
                </tr>
              </thead>
              <tbody>
                {contractDocuments.map((doc: any) => {
                  const sc = (DOC_STATUS as any)[doc.status] || DOC_STATUS.draft;
                  const startDate = (doc as any).contract_start_date;
                  const endDate = (doc as any).contract_end_date;
                  const amount = (doc as any).contract_amount;
                  const partnerName = (doc as any).partners?.name;

                  // Check if contract is expiring soon (within 30 days)
                  let isExpiringSoon = false;
                  if (endDate) {
                    const daysUntilEnd = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    isExpiringSoon = daysUntilEnd >= 0 && daysUntilEnd <= 30;
                  }

                  return (
                    <tr key={doc.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] ${isExpiringSoon ? 'bg-red-500/[.03]' : ''}`}>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => router.push(`/documents?id=${doc.id}`)}
                          className="text-sm font-medium hover:text-[var(--primary)] transition text-left"
                        >
                          {doc.name}
                        </button>
                        {isExpiringSoon && (
                          <div className="text-[10px] text-red-400 mt-0.5">만료 임박</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{partnerName || "\u2014"}</td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{startDate || "\u2014"}</td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                        {endDate ? (
                          <span className={isExpiringSoon ? 'text-red-400 font-medium' : ''}>{endDate}</span>
                        ) : "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-sm text-right font-medium">
                        {amount ? `₩${Number(amount).toLocaleString()}` : "\u2014"}
                      </td>
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
                          {(sig.status === 'pending' || sig.status === 'sent') && (
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
    </div>
  );
}

// ── File Storage Tab Component ──
function FileStorageTab({ companyId, userId }: { companyId: string; userId: string }) {
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
      alert("삭제 실패: " + (err?.message || err));
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

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <DocumentsPageInner />
    </Suspense>
  );
}

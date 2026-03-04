"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { getCurrentUser, getDocuments, getDocTemplates, getDeals, getTaxInvoices, getDocument, getDocRevisions, getDocApprovals } from "@/lib/queries";
import { createBlankDocument, DOC_TYPES, DOC_STATUS } from "@/lib/documents";
import { saveRevision, submitForReview, approveDocument, lockDocument } from "@/lib/documents";
import { createTaxInvoice, INVOICE_TYPES, INVOICE_STATUS } from "@/lib/tax-invoice";
import { classifyDocument, getDocTypeInfo, DOC_INTEL_TYPES, saveDocumentIntelligence, extractContractFields } from "@/lib/doc-intelligence";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database";

const db = supabase as any;

// ── Document Detail (previously documents/[id]/client.tsx) ──

function DocumentDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [comment, setComment] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [tab, setTab] = useState<"content" | "revisions" | "approvals">("content");

  useEffect(() => {
    getCurrentUser().then((u) => u && setUserId(u.id));
  }, []);

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

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"docs" | "contracts" | "invoices">("docs");
  const [showDocForm, setShowDocForm] = useState(false);
  const [showInvForm, setShowInvForm] = useState(false);
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
  };

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
      </div>

      {/* Doc Form */}
      {showDocForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">새 문서 생성</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
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
          <div className="grid grid-cols-3 gap-4 mb-4">
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
            <table className="w-full">
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
            </table>
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
            <table className="w-full">
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
            </table>
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
            <table className="w-full">
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
            </table>
          )}
        </div>
      )}
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

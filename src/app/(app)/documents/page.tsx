"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import { DateField } from "@/components/date-field";
import { DEFAULT_DOC_TEMPLATES } from "@/lib/default-doc-templates";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { useTabParam } from "@/lib/use-tab-param";

// 2026-05-22 문서 본문에 글자 서식 + PDF 페이지 이미지 삽입 (사장님 요청).
const RichEditor = dynamic(() => import("@/components/rich-editor").then((m) => ({ default: m.RichEditor })), {
  ssr: false,
  loading: () => <div className="min-h-[400px] bg-[var(--bg-surface)] rounded-xl animate-pulse" />,
});
import { friendlyError } from "@/lib/friendly-error";
import { getCurrentUser, getDocuments, getDocTemplates, getDeals, getTaxInvoices, getDocument, getDocRevisions, getDocApprovals, deleteDocument } from "@/lib/queries";
import { createBlankDocument, createFromTemplate, DOC_TYPES, DOC_STATUS } from "@/lib/documents";
import { saveRevision, submitForReview, approveDocument, lockDocument } from "@/lib/documents";
import { createTaxInvoice, issueTaxInvoice, INVOICE_TYPES, INVOICE_STATUS, invoiceStatusMeta } from "@/lib/tax-invoice";
import { forceApproveDocument } from "@/lib/deal-pipeline";
import { classifyDocument, getDocTypeInfo, DOC_INTEL_TYPES, saveDocumentIntelligence, extractContractFields } from "@/lib/doc-intelligence";
import { createSignatureRequest, getSignatureRequests, getDocumentSignatures, updateSignatureStatus, saveSignature, cancelSignature, getSignatureStatusInfo, SIGNATURE_STATUS, applyCompanySeal, sendSignatureEmail, createBulkSignatureRequests, sendSignatureReminder, bulkSendReminders, getDocumentSignatureAudit } from "@/lib/signatures";
import { createNotification } from "@/lib/notifications";
import { uploadFile, getFilesForDocument, createFolder, getFolders, deleteFolder, searchFiles, deleteFile } from "@/lib/file-storage";
import { generateDocumentPDF, generateQuotePDF, issueDocument } from "@/lib/document-generator";
import { getActiveTemplate, downloadTemplateFile, buildQuoteValues } from "@/lib/form-templates";
import { fillFormTemplate } from "@/lib/pdf-overlay";
import { FileUploadMulti } from "@/components/file-upload-multi";
import { FileList } from "@/components/file-list";
import { CurrencyInput } from "@/components/currency-input";
import { QuoteItemsTable } from "./_components/QuoteItemsTable";
import { QuoteHeader, type QuoteHeaderData } from "./_components/QuoteHeader";
import { QueryErrorBanner } from "@/components/query-status";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/models";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";

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
  // 진행 리스트 각 행 클릭 → /contracts/signed dual mode 진입 (signature_requests.id 지원)
  const { open: openDocViewer } = useDocumentViewer();
  const [tab, setTab] = useState<"content" | "revisions" | "approvals">("content");
  // 품목/결제조건/직인 상태
  const [editItems, setEditItems] = useState<any[]>([]);
  const [isEditing, setIsEditing] = useState(false); // 문서 내용 편집 모드 — 기본은 보기(렌더), '수정하기'로 전환
  const [quoteHeader, setQuoteHeader] = useState<QuoteHeaderData>({}); // 견적서 헤더(거래처/거래유형/결제조건 등)
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
    onError: (err: any) => toast(`서명 요청 실패: ${err.message || err}`, "error"),
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
    onError: (err: any) => toast(friendlyError(err, "서명 요청 처리에 실패했습니다."), "error"),
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

  // 변수 치환용 — 회사 정보 + 연결 거래처명
  const { data: docCompanyInfo } = useQuery({
    queryKey: ["doc-company-info", companyId],
    queryFn: async () => (await (supabase as any).from("companies").select("name, representative").eq("id", companyId).maybeSingle()).data,
    enabled: !!companyId,
  });
  const { data: docPartnerName } = useQuery({
    queryKey: ["doc-deal-partner", (doc as any)?.deal_id],
    queryFn: async () => {
      const dealId = (doc as any)?.deal_id;
      if (!dealId) return null;
      const { data: deal } = await (supabase as any).from("deals").select("partner_id, name").eq("id", dealId).maybeSingle();
      if (deal?.partner_id) {
        const { data: p } = await (supabase as any).from("partners").select("name").eq("id", deal.partner_id).maybeSingle();
        return p?.name || deal?.name || null;
      }
      return deal?.name || null;
    },
    enabled: !!(doc as any)?.deal_id,
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
      if (cj.header && typeof cj.header === "object") {
        setQuoteHeader(cj.header);
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
      // 변수 하이라이트 토큰(data-doc-var) 제거 → 저장본은 값/텍스트만 깔끔하게
      const cleanBody = (editContent || "").replace(/<span[^>]*data-doc-var[^>]*>([\s\S]*?)<\/span>/gi, "$1");
      const cj = { ...(doc?.content_json as any || {}), body: cleanBody };
      // 품목 데이터 포함
      if (editItems.length > 0) cj.items = editItems;
      // 결제조건 데이터 포함
      if (editPaymentSchedule.length > 0) cj.paymentSchedule = editPaymentSchedule;
      // 견적서 헤더 포함
      cj.header = quoteHeader;
      return saveRevision({
        documentId: id,
        authorId: userId!,
        contentJson: cj as unknown as Json,
        comment: comment || undefined,
      });
    },
    onSuccess: () => { invalidate(); setComment(""); },
    onError: (err: any) => toast(`저장 실패: ${err.message || err}`, "error"),
  });

  const [savedModal, setSavedModal] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // 저장/전표 — 견적서 저장 + 품목 합계로 매출 세금계산서(초안) 자동 생성 (견적→매출 전표 연동)
  const saveAndInvoiceMut = useMutation({
    mutationFn: async () => {
      const supply = editItems.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0);
      if (!supply) throw new Error("품목 금액이 없습니다. 품목을 입력하세요.");
      const counterparty = quoteHeader.partnerName || docPartnerName || "";
      if (!counterparty) throw new Error("거래처를 입력하세요.");
      // 1) 견적서 저장
      const cleanBody = (editContent || "").replace(/<span[^>]*data-doc-var[^>]*>([\s\S]*?)<\/span>/gi, "$1");
      const cj = { ...(doc?.content_json as any || {}), body: cleanBody, header: quoteHeader };
      if (editItems.length > 0) cj.items = editItems;
      if (editPaymentSchedule.length > 0) cj.paymentSchedule = editPaymentSchedule;
      await saveRevision({ documentId: id, authorId: userId!, contentJson: cj as unknown as Json, comment: comment || "저장/전표" });
      // 저장만 — 세금계산서 발행 방식(품목 일괄/품목별 개별)은 저장 후 팝업에서 선택
      void counterparty;
    },
    onSuccess: () => {
      invalidate(); setComment("");
      setSavedModal(true);
      // 편집영역 대신 '생성된 견적서'(미리보기 결과물)로 스크롤
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    },
    onError: (err: any) => toast(`저장/전표 실패: ${err.message || err}`, "error"),
  });

  // 저장 후 세금계산서 발행 — 견적서 품목대로. bulk=합계 1건("품목 외 N건"), per-item=품목별 N건.
  const issueInvoices = async (mode: "bulk" | "per-item") => {
    const items = editItems.filter((i: any) => i && (i.name || Number(i.supplyAmount)));
    const counterparty = quoteHeader.partnerName || docPartnerName || "";
    const issueDate = new Date().toISOString().slice(0, 10);
    if (items.length === 0) { toast("발행할 품목이 없습니다", "error"); return; }
    if (!counterparty) { toast("거래처를 입력하세요", "error"); return; }
    setIssuing(true);
    try {
      if (mode === "per-item") {
        for (const it of items) {
          await createTaxInvoice({
            companyId: companyId!, dealId: (doc as any)?.deal_id || undefined, type: "sales",
            counterpartyName: counterparty, partnerId: quoteHeader.partnerId || undefined,
            supplyAmount: Number(it.supplyAmount || 0), issueDate, label: it.name || "품목",
          });
        }
        toast(`품목별 세금계산서 ${items.length}건을 생성했습니다`, "success");
      } else {
        const total = items.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0);
        const label = items.length === 1 ? (items[0].name || "품목") : `${items[0].name || "품목"} 외 ${items.length - 1}건`;
        await createTaxInvoice({
          companyId: companyId!, dealId: (doc as any)?.deal_id || undefined, type: "sales",
          counterpartyName: counterparty, partnerId: quoteHeader.partnerId || undefined,
          supplyAmount: total, issueDate, label,
        });
        toast("세금계산서(일괄)를 생성했습니다", "success");
      }
      setSavedModal(false);
      window.location.href = "/tax-invoices";
    } catch (e: any) { toast("발행 실패: " + (e?.message || ""), "error"); }
    finally { setIssuing(false); }
  };

  const submitMut = useMutation({
    mutationFn: () => submitForReview(id),
    onSuccess: invalidate,
    onError: (err: any) => toast(`제출 실패: ${err.message || err}`, "error"),
  });

  const approveMut = useMutation({
    mutationFn: () => approveDocument(id, userId!, approvalComment || undefined),
    onSuccess: () => { invalidate(); setShowApprovalForm(false); setApprovalComment(""); },
    onError: (err: any) => toast(`승인 실패: ${err.message || err}`, "error"),
  });

  const lockMut = useMutation({
    mutationFn: () => lockDocument(id, userId || undefined),
    onSuccess: invalidate,
    onError: (err: any) => toast(`잠금 실패: ${err.message || err}`, "error"),
  });

  if (!doc) {
    return (
      <div className="py-20 text-center text-sm text-[var(--text-muted)]">
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
  const contentType = (doc.content_json as any)?.type || (doc as any).content_type || "contract";

  // {{변수}} → 실제 값 치환 (모르는 변수는 빈칸 ____). 보기 모드에서 실제 견적서 내용으로 렌더.
  const docVarValues: Record<string, string> = {
    회사명: docCompanyInfo?.name || "",
    공급자: docCompanyInfo?.name || "",
    대표자명: docCompanyInfo?.representative || "",
    거래처명: quoteHeader.partnerName || docPartnerName || "",
    수신: quoteHeader.partnerName || docPartnerName || "",
    견적일자: doc.created_at ? new Date(doc.created_at).toLocaleDateString("ko-KR") : "",
    유효기간: quoteHeader.validUntil || "견적일로부터 30일",
    결제조건: quoteHeader.paymentTerms || "",
    납품조건: quoteHeader.deliveryTerms || "",
    참조: quoteHeader.reference || "",
  };
  const fillVars = (text: string) =>
    (text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => {
      const key = String(k).trim();
      const v = docVarValues[key];
      return v && v.length ? v : `[${key}]`; // 값 없는 변수는 [항목명] 자리표시(어디 채울지 보이게)
    });
  // 마크다운(##) + 변수 → 보기와 동일한 채워진 HTML (편집기에서 양식 그대로 수정)
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 변수 → 노란 하이라이트 토큰(수정하기에서 '여기가 변수'임을 직관적으로). 저장 시 제거됨.
  const varSpan = (display: string) => `<span data-doc-var="1" style="background:#fde68a;color:#92400e;border-radius:4px;padding:1px 6px;font-weight:700;white-space:nowrap;">${escHtml(display)}</span>`;
  const lineToHtml = (line: string) => {
    let html = "", last = 0;
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      html += escHtml(line.slice(last, m.index));
      const key = m[1].trim();
      const v = docVarValues[key];
      html += varSpan(v && v.length ? v : `[${key}]`);
      last = m.index + m[0].length;
    }
    html += escHtml(line.slice(last));
    return html;
  };
  const toRichHtml = (text: string) => {
    const raw = text || "";
    if (raw.trim().startsWith("<")) return raw; // 이미 HTML
    return raw.split("\n").map((ln) => {
      const t = ln.trim();
      if (!t) return "";
      if (t.startsWith("## ")) return `<h3>${lineToHtml(t.slice(3))}</h3>`;
      if (t.startsWith("# ")) return `<h2>${lineToHtml(t.slice(2))}</h2>`;
      if (t.startsWith("[") && t.includes("품목 테이블")) return ""; // 품목은 아래 품목표로 편집
      return `<p>${lineToHtml(t)}</p>`;
    }).filter(Boolean).join("");
  };

  // Auto-classification badge
  const autoType = (doc as any).auto_classified_type;
  const autoTypeInfo = autoType ? getDocTypeInfo(autoType) : null;

  return (
    <div className="">
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
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
            <span>v{doc.version}</span>
            <span>|</span>
            <span>{contentType}</span>
            {(doc as any).deals?.name && (
              <>
                <span>|</span>
                <span>프로젝트: {(doc as any).deals.name}</span>
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
                const company = await db.from('companies').select('*').eq('id', companyId).maybeSingle();
                const companyName = company.data?.name || '';
                const cj = (doc as any).content_json || {};
                const cType = cj.type || (doc as any).content_type || '';
                const isQuote = cType === 'invoice' || cType === 'quote';
                let pdfBlob: Blob;

                if (isQuote) {
                  // 견적서 전용 PDF - 담당자/계좌 포함
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
                  const { data: bankAcct } = await db.from('bank_accounts').select('bank_name, account_number, alias').eq('company_id', companyId).eq('is_primary', true).limit(1).maybeSingle();
                  const { data: currentUser } = await db.from('users').select('name, email').eq('id', userId).maybeSingle();

                  // 제안사 담당자 — 견적 헤더에서 선택한 담당자 우선(없으면 현재 사용자). 이메일은 이름으로 조회.
                  const mgrName = cj.header?.manager || quoteHeader.manager || '';
                  let mgrEmail = '';
                  if (mgrName) {
                    const { data: mgrRow } = await db.from('users').select('email').eq('company_id', companyId).eq('name', mgrName).limit(1).maybeSingle();
                    mgrEmail = mgrRow?.email || '';
                  }

                  // 견적 의뢰 기업(거래처) 상세 — partnerId 우선, 없으면 거래처명으로 company 범위 내 매칭
                  const cpName = cj.counterpartyName || cj.partnerName || cj.header?.partnerName || quoteHeader.partnerName || '';
                  const cpId = cj.header?.partnerId || quoteHeader.partnerId || null;
                  let partnerRow: any = null;
                  const pcols = 'name, representative, contact_name, contact_phone, contact_email, address';
                  if (cpId) {
                    partnerRow = (await db.from('partners').select(pcols).eq('id', cpId).maybeSingle()).data;
                  } else if (cpName) {
                    partnerRow = (await db.from('partners').select(pcols).eq('company_id', companyId).eq('name', cpName).limit(1).maybeSingle()).data;
                  }

                  // P3 — 회사 활성 견적 양식이 있으면 오버레이(실제 디자인 재현), 없으면 현행 generateQuotePDF 폴백(회귀 0).
                  const quoteTpl = companyId ? await getActiveTemplate(companyId, "quote").catch(() => null) : null;
                  if (quoteTpl) {
                    const bytes = await downloadTemplateFile(quoteTpl.file_path);
                    const filled = await fillFormTemplate(bytes, quoteTpl.fields, { values: buildQuoteValues({
                      myCompanyName: companyName,
                      myRepresentative: company.data?.representative,
                      partnerName: cpName,
                      partnerRepresentative: partnerRow?.representative,
                      projectName: (doc as any).name,
                      quoteNumber: (doc as any).document_number,
                      issueDate: new Date().toISOString().slice(0, 10),
                      validUntil: cj.header?.validUntil || quoteHeader.validUntil,
                      supplyAmount: supplyAmt,
                      taxAmount: taxAmt,
                      totalAmount: supplyAmt + taxAmt,
                      notes: cj.notes,
                    }), items: (items as any[]).map((it) => ({ name: it.name, quantity: it.qty, unitPrice: it.unitPrice, amount: it.amount })) });
                    pdfBlob = new Blob([filled as BlobPart], { type: "application/pdf" });
                  } else {
                  pdfBlob = await generateQuotePDF({
                    documentNumber: (doc as any).document_number || '-',
                    companyInfo: {
                      name: companyName,
                      representative: company.data?.representative,
                      address: company.data?.address,
                      phone: company.data?.phone,
                      businessNumber: company.data?.business_number,
                    },
                    counterparty: cpName || '-',
                    items,
                    supplyAmount: supplyAmt,
                    taxAmount: taxAmt,
                    totalAmount: supplyAmt + taxAmt,
                    validUntil: cj.header?.validUntil || quoteHeader.validUntil || cj.validUntil || '견적일로부터 30일',
                    notes: cj.notes || '',
                    sealUrl: (doc as any).seal_applied ? company.data?.seal_url : undefined,
                    managerName: mgrName || currentUser?.name || undefined,
                    managerContact: mgrName ? (mgrEmail || undefined) : (currentUser?.email || undefined),
                    paymentTerms: cj.header?.paymentTerms || quoteHeader.paymentTerms || undefined,
                    deliveryTerms: cj.header?.deliveryTerms || quoteHeader.deliveryTerms || undefined,
                    bankInfo: bankAcct ? { bankName: bankAcct.bank_name, accountNumber: bankAcct.account_number, accountHolder: bankAcct.alias || companyName } : undefined,
                    deliveryDate: cj.deliveryDate || undefined,
                    // 팩트시트 스타일 추가 — 제목(문서명)/견적의뢰기업 상세/제안사 사이트
                    title: (doc as any).name || undefined,
                    siteUrl: company.data?.website || company.data?.homepage || company.data?.site_url || undefined,
                    counterpartyInfo: partnerRow ? {
                      representative: partnerRow.representative || undefined,
                      contactName: partnerRow.contact_name || undefined,
                      contactPhone: partnerRow.contact_phone || undefined,
                      contactEmail: partnerRow.contact_email || undefined,
                      address: partnerRow.address || undefined,
                    } : undefined,
                  });
                  }
                } else if ((cType === 'contract' && editContent.trim().startsWith('<!DOCTYPE')) || editContent.includes('<img')) {
                  // 2026-05-22 이미지(PDF 페이지 삽입 등) 포함 문서는 브라우저 인쇄 PDF 로 변환 —
                  //   jspdf 경로는 <img> 를 제거하므로 그래프·표 이미지 보존을 위해 인쇄 경로 사용.
                  const isFullDoc = editContent.trim().startsWith('<!DOCTYPE') || editContent.trim().startsWith('<html');
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    const html = isFullDoc
                      ? editContent
                      : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${doc.name}</title>` +
                        `<style>body{font-family:'Noto Sans KR',sans-serif;padding:40px;max-width:820px;margin:0 auto;line-height:1.7;color:#111}` +
                        `img{max-width:100%;height:auto;display:block;margin:12px auto}h1{font-size:22px}@media print{body{padding:0}}</style></head>` +
                        `<body><h1>${doc.name}</h1>${editContent}</body></html>`;
                    printWindow.document.write(html);
                    printWindow.document.close();
                    printWindow.focus();
                    setTimeout(() => printWindow.print(), 400); // 이미지 로드 대기
                  } else {
                    toast('팝업 차단을 해제해주세요', 'error');
                  }
                  return;
                } else {
                  // HTML 태그가 섞인 내용이면 태그 제거 후 PDF 생성
                  let pdfContent = editContent;
                  if (pdfContent.includes('<') && pdfContent.includes('>')) {
                    pdfContent = pdfContent
                      .replace(/<br\s*\/?>/gi, '\n')
                      .replace(/<\/p>/gi, '\n')
                      .replace(/<\/div>/gi, '\n')
                      .replace(/<\/h[1-6]>/gi, '\n\n')
                      .replace(/<[^>]+>/g, '')
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/\n{3,}/g, '\n\n')
                      .trim();
                  }
                  pdfBlob = await generateDocumentPDF({
                    title: doc.name,
                    content: pdfContent,
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
                  const company = await db.from('companies').select('name').eq('id', companyId).maybeSingle();
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
          <div className="glass-card p-4 mb-6">
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
                  <div
                    key={sig.id}
                    onClick={() => openDocViewer({ type: 'contract', id: sig.id })}
                    className="flex items-center justify-between text-xs px-2 py-2 rounded-lg hover:bg-[var(--bg-surface)] transition cursor-pointer group"
                    title="이 계약서 보기 / PDF 다운로드"
                  >
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
                          onClick={(e) => { e.stopPropagation(); sendReminder(sig.id); }}
                          disabled={reminderSendingId === sig.id}
                          className="text-[10px] px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-md font-semibold transition disabled:opacity-50"
                        >
                          {reminderSendingId === sig.id ? "..." : "리마인더"}
                        </button>
                      )}
                      <span className="text-[var(--text-dim)] opacity-0 group-hover:opacity-100 transition">›</span>
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

          {/* ── 견적서 헤더 (거래처/거래유형/결제조건 등) — 견적/계산서면 항상 표시 ── */}
          {(contentType === 'invoice' || contentType === 'quote') && (
            <QuoteHeader header={quoteHeader} onChange={setQuoteHeader} companyId={companyId} editable={(canEdit && isEditing) || ((contentType === 'invoice' || contentType === 'quote') && !isLocked)} />
          )}

          {/* ── 품목 편집 테이블 (회사별 컬럼 커스터마이징) ── */}
          {((contentType === 'invoice' || contentType === 'quote') || (contentType === 'contract' && (editItems.length > 0 || (canEdit && isEditing)))) && (
            <div className="glass-card overflow-hidden p-4">
              <QuoteItemsTable
                items={editItems}
                onChange={setEditItems}
                companyId={companyId}
                editable={(canEdit && isEditing) || ((contentType === 'invoice' || contentType === 'quote') && !isLocked)}
                taxRate={quoteHeader.taxType === 'exempt' || quoteHeader.taxType === 'zero' ? 0 : 0.1}
                discount={Number((quoteHeader as any).discount) || 0}
                onDiscountChange={(n) => setQuoteHeader({ ...quoteHeader, discount: n } as any)}
                partnerName={quoteHeader.partnerName}
              />
            </div>
          )}

          {/* 저장 후 — 세금계산서 발행 방식(품목 일괄/품목별 개별) 팝업 */}
          {savedModal && (() => {
            const issItems = editItems.filter((i: any) => i && (i.name || Number(i.supplyAmount)));
            return (
              <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setSavedModal(false)}>
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="text-base font-bold text-[var(--text)] mb-1">✅ 견적서가 저장되었습니다</div>
                  <p className="text-sm text-[var(--text-muted)] mb-4 leading-relaxed">매출 세금계산서를 <b className="text-[var(--text)]">견적서 품목대로</b> 발행할까요? (품목 {issItems.length}개)</p>
                  <div className="space-y-2">
                    <button onClick={() => issueInvoices("bulk")} disabled={issuing} className="w-full py-2.5 px-3 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 text-left">
                      📄 품목 일괄 발행 <span className="text-white/80 text-xs">— 합계 1건{issItems.length > 1 ? ` (${issItems[0]?.name || "품목"} 외 ${issItems.length - 1}건)` : ""}</span>
                    </button>
                    {issItems.length > 1 && (
                      <button onClick={() => issueInvoices("per-item")} disabled={issuing} className="w-full py-2.5 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] text-sm font-semibold hover:border-[var(--primary)] disabled:opacity-50 text-left">
                        📑 품목별 개별 발행 <span className="text-[var(--text-muted)] text-xs">— {issItems.length}건 각각(예: 선금/중도금/잔금)</span>
                      </button>
                    )}
                    <button onClick={() => setSavedModal(false)} className="w-full py-2 rounded-lg text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)]">나중에</button>
                  </div>
                  {issuing && <div className="text-xs text-[var(--text-dim)] mt-2 text-center">발행 중…</div>}
                </div>
              </div>
            );
          })()}

          {/* ── 견적서 미리보기 (헤더·품목 값으로 구성된 결과물) ── */}
          {(contentType === 'invoice' || contentType === 'quote') && (() => {
            const validItems = editItems.filter((i: any) => i && (i.name || Number(i.supplyAmount)));
            const supplyTotal = editItems.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0);
            const taxTotal = editItems.reduce((s: number, i: any) => s + Number(i.taxAmount || 0), 0);
            const discountVal = Number((quoteHeader as any).discount) || 0;
            const grand = supplyTotal + taxTotal - discountVal;
            const w = (n: number) => `₩${(Number(n) || 0).toLocaleString('ko')}`;
            return (
              <div ref={previewRef} className="glass-card overflow-hidden scroll-mt-4">
                <div className="px-5 py-3 border-b border-[var(--border)] text-xs text-[var(--text-dim)] font-medium">견적서 미리보기 (저장된 결과물)</div>
                <div className="p-6 bg-white text-[#222]">
                  <div className="text-center text-2xl font-bold mb-5 tracking-[0.3em] text-[#222]">견 적 서</div>
                  <div className="flex justify-between text-xs mb-4 text-[#333]">
                    <div className="space-y-0.5">
                      <div><b>수신:</b> {quoteHeader.partnerName || '________'} 귀하</div>
                      <div className="text-[11px] text-[#777]">아래와 같이 견적합니다.</div>
                    </div>
                    <div className="space-y-0.5 text-right">
                      <div><b>공급자:</b> {docCompanyInfo?.name || ''}</div>
                      {docCompanyInfo?.representative && <div>대표: {docCompanyInfo.representative}</div>}
                      <div>견적일자: {doc.created_at ? new Date(doc.created_at).toLocaleDateString('ko-KR') : ''}</div>
                      <div>유효기간: {quoteHeader.validUntil || '견적일로부터 30일'}</div>
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse mb-3 text-[#333]">
                    <thead>
                      <tr className="bg-[#f3f4f6] border-y border-[#ddd]">
                        <th className="px-2 py-1.5 text-left">품목</th>
                        <th className="px-2 py-1.5 text-right w-16">수량</th>
                        <th className="px-2 py-1.5 text-right w-24">단가</th>
                        <th className="px-2 py-1.5 text-right w-28">공급가액</th>
                        <th className="px-2 py-1.5 text-right w-24">부가세</th>
                        <th className="px-2 py-1.5 text-right w-28">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validItems.length === 0 ? (
                        <tr><td colSpan={6} className="px-2 py-6 text-center text-[#999]">품목을 입력하면 여기에 표시됩니다</td></tr>
                      ) : validItems.map((it: any, i: number) => (
                        <tr key={i} className="border-b border-[#eee]">
                          <td className="px-2 py-1.5">{it.name}{it.spec ? ` (${it.spec})` : ''}</td>
                          <td className="px-2 py-1.5 text-right">{Number(it.quantity || 0).toLocaleString('ko')}</td>
                          <td className="px-2 py-1.5 text-right">{Number(it.unitPrice || 0).toLocaleString('ko')}</td>
                          <td className="px-2 py-1.5 text-right">{Number(it.supplyAmount || 0).toLocaleString('ko')}</td>
                          <td className="px-2 py-1.5 text-right">{Number(it.taxAmount || 0).toLocaleString('ko')}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{Number(it.totalAmount || 0).toLocaleString('ko')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end mb-4">
                    <div className="w-64 text-xs space-y-1 text-[#333]">
                      <div className="flex justify-between"><span>공급가액</span><span>{w(supplyTotal)}</span></div>
                      <div className="flex justify-between"><span>부가세</span><span>{w(taxTotal)}</span></div>
                      {discountVal > 0 && <div className="flex justify-between"><span>할인</span><span>-{w(discountVal)}</span></div>}
                      <div className="flex justify-between border-t border-[#ccc] pt-1 font-bold text-sm text-[#111]"><span>합계금액</span><span>{w(grand)}</span></div>
                    </div>
                  </div>
                  {(quoteHeader.paymentTerms || quoteHeader.deliveryTerms || quoteHeader.reference) && (
                    <div className="text-[11px] text-[#555] space-y-0.5 border-t border-[#eee] pt-3">
                      {quoteHeader.paymentTerms && <div>· 결제조건: {quoteHeader.paymentTerms}</div>}
                      {quoteHeader.deliveryTerms && <div>· 납품조건: {quoteHeader.deliveryTerms}</div>}
                      {quoteHeader.reference && <div>· 참조: {quoteHeader.reference}</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── 결제조건 편집 테이블 (계약서) ── */}
          {contentType === 'contract' && editPaymentSchedule.length > 0 && (
            <div className="glass-card overflow-hidden">
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
                  <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
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
          <div className="glass-card p-5">
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
                      toast(friendlyError(err, '직인 적용 실패'), "error");
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
                      try {
                        // 먼저 서명 요청 생성 → 바로 서명 완료
                        const req = await createSignatureRequest({
                          companyId, documentId: id, title: '자체 서명',
                          signerName: selfSignName, signerEmail: userEmail || 'self-sign@company.internal',
                          createdBy: userId,
                        });
                        await saveSignature(req.id, { type: 'type', data: selfSignName });
                        toast('서명이 완료되었습니다', 'success');
                        invalidate();
                        setShowSelfSign(false);
                        setSelfSignName('');
                      } catch (err: any) {
                        toast(friendlyError(err, '서명 처리 중 오류가 발생했습니다'), 'error');
                      }
                    }}
                    disabled={!selfSignName.trim()}
                    className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                    서명 완료
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 문서 내용(마크다운 본문) — 견적/계산서는 헤더·품목으로 대체하므로 숨김 */}
          {!(contentType === 'invoice' || contentType === 'quote') && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-xs text-[var(--text-dim)] font-medium">문서 내용</span>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={() => {
                      // 편집 진입 시: 원본 마크다운(##·{{변수}})이면 보기와 동일한 채워진 HTML 로 1회 변환
                      if (!isEditing && editContent && !editContent.trim().startsWith("<")) {
                        setEditContent(toRichHtml(editContent));
                      }
                      setIsEditing((v) => !v);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${isEditing ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--primary)]"}`}
                  >
                    {isEditing ? "✓ 보기" : "✏️ 수정하기"}
                  </button>
                )}
                {canEdit && isEditing && (
                  <span className="caption">서식 · PDF 삽입 지원</span>
                )}
              </div>
            </div>
            <div className="p-5">
              {canEdit && isEditing ? (
                <RichEditor
                  content={editContent}
                  onChange={setEditContent}
                  placeholder="문서 내용을 작성하세요... 📎 PDF 버튼으로 PDF 페이지를 그대로 삽입할 수 있습니다."
                  onUploadImage={async (file) => {
                    if (!companyId || !userId) throw new Error("회사 정보를 불러오는 중입니다");
                    const res = await uploadFile({ companyId, bucket: "company-assets", file, userId, context: { documentId: id } });
                    return res.fileUrl;
                  }}
                />
              ) : (() => {
                const filled = fillVars(editContent);
                const t = filled.trim();
                if (t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<div') || t.startsWith('<h') || t.startsWith('<p') || t.startsWith('<ul') || t.startsWith('<ol') || t.startsWith('<img') || t.startsWith('<blockquote')) {
                  return <div className="text-sm leading-relaxed text-[var(--text)] document-html-content [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2" dangerouslySetInnerHTML={{ __html: filled }} />;
                }
                if (!t) return <div className="text-sm text-[var(--text-dim)]">(내용 없음)</div>;
                // 마크다운식 렌더 — ## 제목, ※ 주석, [품목 테이블]은 위 품목표로 대체(숨김)
                return (
                  <div className="space-y-1.5 text-sm leading-relaxed">
                    {filled.split('\n').map((ln, i) => {
                      const line = ln.trim();
                      if (!line) return <div key={i} className="h-1" />;
                      if (line.startsWith('## ')) return <h4 key={i} className="text-sm font-bold text-[var(--text)] mt-4 first:mt-0 pb-1 border-b border-[var(--border)]/40">{line.slice(3)}</h4>;
                      if (line.startsWith('# ')) return <h3 key={i} className="text-base font-bold text-[var(--text)] mt-4 first:mt-0">{line.slice(2)}</h3>;
                      if (line.startsWith('[') && line.includes('품목 테이블')) return null;
                      if (line.startsWith('※')) return <p key={i} className="text-xs text-[var(--text-dim)]">{line}</p>;
                      return <p key={i} className="text-[var(--text-muted)] whitespace-pre-wrap">{line}</p>;
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
          )}

          {(canEdit || ((contentType === 'invoice' || contentType === 'quote') && !isLocked)) && (
            <div className="flex items-center gap-3">
              <input value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder="변경 코멘트 (선택)"
                className="flex-1 px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                {saveMut.isPending ? "저장 중..." : "저장"}
              </button>
              {(contentType === 'invoice' || contentType === 'quote') && (
                <button onClick={() => saveAndInvoiceMut.mutate()} disabled={saveAndInvoiceMut.isPending}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 whitespace-nowrap"
                  title="견적서를 저장하고, 품목 합계로 매출 세금계산서(초안)를 자동 생성합니다">
                  {saveAndInvoiceMut.isPending ? "처리 중..." : "💾 저장/전표"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "revisions" && (
        <div className="glass-card overflow-hidden">
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
                    <span className="caption">
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
        <div className="glass-card overflow-hidden">
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
                    <span className="caption">
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
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");
  const tabParam = searchParams.get("tab");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // 파일 보관함 전용으로 단순화 — 문서/계약서/세금계산서/전자계약/양식 관리는 각 전용 메뉴로 이전.
  //   (탭 타입은 호환 위해 유지하되 진입 시 항상 files 로 고정, 탭 전환 UI 제거)
  const [tab, setTab] = useTabParam<"docs" | "contracts" | "invoices" | "signatures" | "files" | "templates">("files", { valid: ["files"] });
  const [showDocForm, setShowDocForm] = useState(false);
  const [showInvForm, setShowInvForm] = useState(false);
  const [showSignForm, setShowSignForm] = useState(false);
  const [signFormData, setSignFormData] = useState({ documentId: "", signerName: "", signerEmail: "", signerPhone: "" });
  const [selectedSignature, setSelectedSignature] = useState<any>(null);
  const [signStatusFilter, setSignStatusFilter] = useState<string>("all");
  const [docForm, setDocForm] = useState({ name: "", type: "contract", deal_id: "", template_id: "" });
  // (구) ?create=quote 딥링크 자동 폼 오픈 — 문서 생성은 전자계약/프로젝트 메뉴로 이전돼 제거됨.
  const [invForm, setInvForm] = useState({ type: "sales" as "sales" | "purchase", counterparty_name: "", supply_amount: "", issue_date: "", deal_id: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  // U5 페이지네이션 — 10/25/50/all. 필터 변경 시 1페이지 리셋.
  const [docPageSize, setDocPageSize] = useState<number>(10);
  const [docPage, setDocPage] = useState<number>(1);
  useEffect(() => { setDocPage(1); }, [searchTerm, typeFilter, docPageSize]);
  // 2026-05-28 받는 사람 화면 테스트 모달 (split view 미리보기)
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

  const { data: templates = [], isSuccess: templatesLoaded } = useQuery({
    queryKey: ["doc-templates", companyId],
    queryFn: () => getDocTemplates(companyId!),
    enabled: !!companyId,
  });

  // 기본 양식(견적서/계약서 등) 자동 시드 — 회사에 비-HR 양식이 0건이면 1회 생성.
  //   기존: "양식 관리" 탭 버튼으로만 시드돼 견적서 작성 시 양식이 비어 보였음.
  const didSeedRef = useRef(false);
  useEffect(() => {
    if (!companyId || !userId || !templatesLoaded || didSeedRef.current) return;
    // 견적서/계약서 양식이 하나도 없으면 시드 (hr_contract 등 HR 양식만 있는 회사도 포함)
    const hasBiz = (templates as any[]).some((t: any) => t.type === "contract" || t.type === "quote");
    if (hasBiz) return;
    didSeedRef.current = true;
    (async () => {
      for (const tpl of DEFAULT_TEMPLATES) {
        await (supabase as any).from("doc_templates").insert({
          company_id: companyId,
          name: tpl.name,
          type: tpl.type,
          content_json: tpl.content_json,
          variables: tpl.variables,
          is_active: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
    })();
  }, [companyId, userId, templatesLoaded, templates, queryClient]);

  // 프로젝트 견적서 탭에서 ?create=quote 로 진입 시 — 견적서 양식 자동 선택(빈 문서 대신 견적서 폼).
  const didPrefillQuoteRef = useRef(false);
  useEffect(() => {
    if (didPrefillQuoteRef.current) return;
    if (searchParams.get("create") !== "quote" || !templatesLoaded) return;
    const q = (templates as any[]).find((t: any) => t.type === "quote");
    if (!q) return;
    didPrefillQuoteRef.current = true;
    setDocForm((f) => (f.template_id ? f : { ...f, template_id: q.id, name: f.name || q.name, type: "quote" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, templatesLoaded, templates]);

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

  // (구) ?tab=signatures 딥링크 — 전자계약 전용 메뉴(/signatures)로 이전돼 제거됨.

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

  // 문서 영구삭제 — 서명요청 있는 문서는 RPC 가 차단(예외 메시지 표시).
  const deleteDocMut = useMutation({
    mutationFn: (docId: string) => deleteDocument(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast("문서를 삭제했습니다.", "success");
    },
    onError: (err: any) => toast(err?.message || "문서 삭제에 실패했습니다.", "error"),
  });

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
    onError: (err: any) => toast("서명 요청 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Cancel signature mutation
  const cancelSignMut = useMutation({
    mutationFn: (id: string) => cancelSignature(id),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast("서명 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
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
    onError: (err: any) => toast("서명 완료 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
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
        onBack={() => {
          // 문서는 push(/documents?id=)로 열렸으므로 back() 으로 깨끗이 목록 복귀(히스토리 오염·재진입 방지).
          //   딥링크(직전 히스토리 없음)면 목록으로 fallback.
          if (typeof window !== "undefined" && window.history.length > 1) router.back();
          else router.push("/documents");
        }}
      />
    );
  }

  if (!companyId || mainLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  return (
    <div className="">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">파일 보관함</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">회사 문서·계약서·증빙 파일 보관</p>
        </div>
      </div>

      {/* Doc Form */}
      {showDocForm && (
        <div className="glass-card p-6 mb-6">
          <h3 className="section-title">새 문서 생성</h3>
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
                className="field-input">
                <option value="">빈 문서 (양식 없이)</option>
                {templates.filter((t: any) => !HR_CATEGORIES.includes(t.type)).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서명 *</label>
              <input value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                placeholder="수출바우처 계약서" className="field-input" />
              {docFormClassification && docForm.name.trim() && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="caption">자동 분류:</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${docFormClassification.color}`}>
                    {docFormClassification.label}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}
                className="field-input">
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 프로젝트</label>
              <select value={docForm.deal_id} onChange={(e) => setDocForm({ ...docForm, deal_id: e.target.value })}
                className="field-input">
                <option value="">선택 안함</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => docForm.name && createDocMut.mutate()} disabled={!docForm.name || createDocMut.isPending}
              className="btn-primary">생성</button>
            <button onClick={() => setShowDocForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Invoice Form */}
      {showInvForm && (
        <div className="glass-card p-6 mb-6">
          <h3 className="section-title">세금계산서 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={invForm.type} onChange={(e) => setInvForm({ ...invForm, type: e.target.value as "sales" | "purchase" })}
                className="field-input">
                {INVOICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">거래처명 *</label>
              <input value={invForm.counterparty_name} onChange={(e) => setInvForm({ ...invForm, counterparty_name: e.target.value })}
                placeholder="A기업" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">공급가액 (원) *</label>
              <CurrencyInput value={invForm.supply_amount} onValueChange={(raw) => setInvForm({ ...invForm, supply_amount: raw })}
                placeholder="10000000" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">발행일 *</label>
              <DateField value={invForm.issue_date} onChange={(e) => setInvForm({ ...invForm, issue_date: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 프로젝트</label>
              <select value={invForm.deal_id} onChange={(e) => setInvForm({ ...invForm, deal_id: e.target.value })}
                className="field-input">
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
              className="btn-primary">등록</button>
            <button onClick={() => setShowInvForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Documents List */}
      {tab === "docs" && (
        <div className="glass-card overflow-hidden">
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
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px] sticky-head">
              <thead>
                <tr className="table-head-row">
                  <th className="th-cell text-left">문서명</th>
                  <th className="th-cell text-left">유형</th>
                  <th className="th-cell text-left">AI 분류</th>
                  <th className="th-cell text-left">연결 프로젝트</th>
                  <th className="th-cell text-center">상태</th>
                  <th className="th-cell text-left">생성일</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.slice((docPage - 1) * docPageSize, docPage * docPageSize).map((doc: any) => {
                  const contentType = (doc.content_json as any)?.type || 'contract';
                  const typeLabel = DOC_TYPES.find(t => t.value === contentType)?.label || contentType;
                  const sc = (DOC_STATUS as any)[doc.status] || DOC_STATUS.draft;
                  const autoType = (doc as any).auto_classified_type;
                  const autoTypeInfo = autoType ? getDocTypeInfo(autoType) : null;
                  return (
                    <tr key={doc.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => router.push(`/documents?id=${doc.id}`)}
                            className="text-sm font-medium hover:text-[var(--primary)] transition text-left"
                          >
                            {doc.name}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (deleteDocMut.isPending) return;
                              if (confirm(`"${doc.name}" 문서를 영구 삭제하시겠습니까?\n\n편집 이력·승인 등 부속 데이터도 함께 삭제되며 되돌릴 수 없습니다.\n서명받은 계약서는 삭제되지 않고 보관됩니다 (전자계약 > 서명 목록에서 계속 확인 가능)`)) {
                                deleteDocMut.mutate(doc.id);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-red-400 hover:text-red-500 disabled:opacity-30"
                            disabled={deleteDocMut.isPending}
                            title="문서 삭제"
                            aria-label="문서 삭제"
                          >
                            🗑️
                          </button>
                        </div>
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
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-bold">진행중 계약서</h2>
              <span className="text-xs text-[var(--text-dim)]">{contractDocuments.length}건</span>
            </div>
            {contractDocuments.length === 0 ? (
              <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트에서 생성된 계약서가 여기에 표시됩니다</div>
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px] sticky-head">
                <thead>
                  <tr className="table-head-row">
                    <th className="th-cell text-left">계약서명</th>
                    <th className="th-cell text-left">거래처</th>
                    <th className="th-cell text-left">시작일</th>
                    <th className="th-cell text-left">종료일</th>
                    <th className="th-cell text-right">계약금액</th>
                    <th className="th-cell text-center">상태</th>
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
              </table>
              {/* U5 페이지네이션 푸터 */}
              {filteredDocuments.length > docPageSize && (() => {
                const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / docPageSize));
                const curPage = Math.min(docPage, totalPages);
                return (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] text-xs">
                    <div className="text-[var(--text-muted)]">
                      전체 {filteredDocuments.length}건 중 {(curPage - 1) * docPageSize + 1}–{Math.min(curPage * docPageSize, filteredDocuments.length)}
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        페이지당
                        <select value={docPageSize} onChange={(e) => setDocPageSize(Number(e.target.value))}
                          className="px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)]">
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                        </select>
                      </label>
                      <div className="flex items-center gap-1">
                        <button disabled={curPage === 1} onClick={() => setDocPage(curPage - 1)}
                          className="px-2 py-1 rounded bg-[var(--bg-surface)] disabled:opacity-30 hover:bg-[var(--border)]">←</button>
                        <span className="px-2 font-semibold">{curPage} / {totalPages}</span>
                        <button disabled={curPage === totalPages} onClick={() => setDocPage(curPage + 1)}
                          className="px-2 py-1 rounded bg-[var(--bg-surface)] disabled:opacity-30 hover:bg-[var(--border)]">→</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            )}
          </div>

          {/* 계약서 보관함 */}
          <div className="glass-card overflow-hidden">
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
                    <CurrencyInput value={archiveForm.amount} onValueChange={(raw) => setArchiveForm({ ...archiveForm, amount: raw })}
                      placeholder="0" className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">시작일</label>
                    <DateField value={archiveForm.start_date} onChange={(e) => setArchiveForm({ ...archiveForm, start_date: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
                    <DateField value={archiveForm.end_date} onChange={(e) => setArchiveForm({ ...archiveForm, end_date: e.target.value })}
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
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px] sticky-head">
                <thead>
                  <tr className="table-head-row">
                    <th className="th-cell text-left">계약서명</th>
                    <th className="th-cell text-left">유형</th>
                    <th className="th-cell text-left">상대방</th>
                    <th className="th-cell text-left">기간</th>
                    <th className="th-cell text-right">금액</th>
                    <th className="th-cell text-center">상태</th>
                    <th className="th-cell text-center">파일</th>
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
        <div className="glass-card overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🧾</div>
              <div className="text-lg font-bold mb-2">세금계산서가 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">매출/매입 세금계산서를 등록하세요</div>
            </div>
          ) : (
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px] sticky-head">
              <thead>
                <tr className="table-head-row">
                  <th className="th-cell text-left">거래처</th>
                  <th className="th-cell text-center">유형</th>
                  <th className="th-cell text-right">공급가액</th>
                  <th className="th-cell text-right">부가세</th>
                  <th className="th-cell text-right">합계</th>
                  <th className="th-cell text-left">프로젝트</th>
                  <th className="th-cell text-center">상태</th>
                  <th className="th-cell text-left">발행일</th>
                  <th className="th-cell text-center"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => {
                  const sc = invoiceStatusMeta(inv.status, inv.type);
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
          <div className="glass-card overflow-hidden">
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
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px] sticky-head">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">문서</th>
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">서명자</th>
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">이메일</th>
                    <th className="text-center px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">상태</th>
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">발송일</th>
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">서명일</th>
                    <th className="text-left px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">만료일</th>
                    <th className="text-center px-5 py-3 font-semibold whitespace-nowrap sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)] min-w-[150px]">액션</th>
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
                        <td className="px-5 py-3 text-sm whitespace-nowrap">{sig.signer_name}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">{sig.signer_email}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ring-black/[0.04] dark:ring-white/10 ${si.bg} ${si.text}`}>
                            {isExpired && sig.status !== 'expired' ? '만료' : si.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)] whitespace-nowrap">
                          {sig.sent_at ? new Date(sig.sent_at).toLocaleDateString("ko") : "--"}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)] whitespace-nowrap">
                          {sig.signed_at ? new Date(sig.signed_at).toLocaleDateString("ko") : "--"}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)] whitespace-nowrap">
                          {sig.expires_at ? (
                            <span className={isExpired ? "text-red-400 font-medium" : ""}>
                              {new Date(sig.expires_at).toLocaleDateString("ko")}
                            </span>
                          ) : "--"}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <div className="flex flex-nowrap items-center justify-center gap-2 whitespace-nowrap">
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
            <div className="glass-card p-6">
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

      {/* ═══ File Storage Tab (파일 보관함 전용) ═══ */}
      {companyId && userId && (
        <FileStorageTab companyId={companyId} userId={userId} />
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
    onError: (err: any) => toast("폴더 생성 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Delete folder mutation
  const deleteFolderMut = useMutation({
    mutationFn: (folderId: string) => deleteFolder(folderId, userId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      if (selectedFolderId) setSelectedFolderId(null);
    },
    onError: (err: any) => toast("폴더 삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
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
        <div className="glass-card p-4">
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
        <div className="glass-card p-4">
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
            maxHeight="calc(100vh - 320px)"
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
    <div className="glass-card p-4 mb-6">
      <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3">공유 현황</h4>
      <div className="space-y-2">
        {activeShares.map((share: any) => {
          const feedback = share.document_share_feedback || [];
          return (
            <div key={share.id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-purple-500 font-semibold">🔗 공유 링크</span>
                <span className="caption">
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
                  <span className="caption">피드백 대기</span>
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
const DEFAULT_TEMPLATES = DEFAULT_DOC_TEMPLATES;

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <DocumentsPageInner />
    </Suspense>
  );
}

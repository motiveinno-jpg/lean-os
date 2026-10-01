"use client";
import { appConfirm } from "@/components/global-confirm";
import { Ico } from "@/components/ui-icon";
import { todayKst, kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useState, useRef, Suspense } from "react";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";

// 2026-05-22 문서 본문에 글자 서식 + PDF 페이지 이미지 삽입.
const RichEditor = dynamic(() => import("@/components/rich-editor").then((m) => ({ default: m.RichEditor })), {
  ssr: false,
  loading: () => <div className="min-h-[400px] bg-[var(--bg-surface)] rounded-xl animate-pulse" />,
});
import { friendlyError } from "@/lib/friendly-error";
import { getCurrentUser, getDocument, getDocRevisions, getDocApprovals } from "@/lib/queries";
import { DOC_TYPES, DOC_STATUS } from "@/lib/documents";
import { saveRevision, submitForReview, approveDocument, lockDocument } from "@/lib/documents";
import { createTaxInvoice, INVOICE_STATUS } from "@/lib/tax-invoice";
import { forceApproveDocument } from "@/lib/deal-pipeline";
import { getDocTypeInfo, DOC_INTEL_TYPES, extractContractFields } from "@/lib/doc-intelligence";
import { createSignatureRequest, getDocumentSignatures, updateSignatureStatus, saveSignature, getSignatureStatusInfo, applyCompanySeal, sendSignatureEmail, createBulkSignatureRequests, sendSignatureReminder, bulkSendReminders, getDocumentSignatureAudit, resolveSealUrl } from "@/lib/signatures";
import { createNotification } from "@/lib/notifications";
import { uploadFile, getFilesForDocument, pruneUnreferencedDocumentFiles } from "@/lib/file-storage";
import { generateDocumentPDF, generateQuotePDF, issueDocument } from "@/lib/document-generator";
import { quoteTotals } from "@/lib/quote-total";
import { getActiveTemplate, downloadTemplateFile, buildQuoteValues } from "@/lib/form-templates";
import { fillFormTemplate } from "@/lib/pdf-overlay";
import { QuoteItemsTable } from "./_components/QuoteItemsTable";
import { VaultExplorer } from "./_components/VaultExplorer";
import { QuoteHeader, type QuoteHeaderData } from "./_components/QuoteHeader";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/models";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase;

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

  // 원클릭 발송 · 견적서 거래처(contact_email)에게 바로 서명요청+메일. 이메일 없으면 서명요청 폼 프리필.
  const sendToPartnerMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !userId) throw new Error("Not ready");
      const cj: any = doc?.content_json || {};
      const pid = (quoteHeader as any)?.partnerId || cj?.header?.partnerId;
      const pname = (quoteHeader as any)?.partnerName || cj?.header?.partnerName || "";
      let email = ""; let cname = pname;
      if (pid) {
        const p = logRead('documents/page:p', await (supabase).from("partners").select("contact_email, contact_name, name").eq("id", pid).maybeSingle());
        email = p?.contact_email || "";
        cname = p?.contact_name || p?.name || pname;
      }
      if (!email) { const e: any = new Error("NO_EMAIL"); e.pname = pname; throw e; }
      const result = await createSignatureRequest({ companyId, documentId: id, title: doc?.name || "견적서", signerName: cname || "거래처", signerEmail: email, createdBy: userId });
      const emailResult = await sendSignatureEmail(result.id);
      if (emailResult.error) throw new Error(emailResult.error);
      return { email, cname };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["doc-signatures", id] });
      toast(`${r.cname || "거래처"}(${r.email})에게 발송했습니다`, "success");
    },
    onError: (err: any) => {
      if (err?.message === "NO_EMAIL") {
        toast("거래처 이메일이 없습니다. 아래 서명 요청에서 직접 입력해 발송하세요", "info");
        setShowSignRequestForm(true);
        if (err.pname) setBulkSigners([{ name: err.pname, email: "", phone: "" }]);
      } else {
        toast("발송 실패: " + (err?.message || err), "error");
      }
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

  // 변수 치환용 · 회사 정보 + 연결 거래처명
  const  { data: docCompanyInfo } = useQuery({
    queryKey: ["doc-company-info", companyId],
    queryFn: async () => (await (supabase).from("companies").select("name, representative").eq("id", companyId ?? "").maybeSingle()).data,
    enabled: !!companyId,
  });
  const { data: docPartnerName } = useQuery({
    queryKey: ["doc-deal-partner", (doc as any)?.deal_id],
    queryFn: async () => {
      const dealId = (doc as any)?.deal_id;
      if (!dealId) return null;
      const deal = logRead('documents/page:deal', await (supabase).from("deals").select("partner_id, name").eq("id", dealId).maybeSingle());
      if (deal?.partner_id) {
        const p = logRead('documents/page:p', await (supabase).from("partners").select("name").eq("id", deal.partner_id).maybeSingle());
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
    mutationFn: async () => {
      // 변수 하이라이트 토큰(data-doc-var) 제거 → 저장본은 값/텍스트만 깔끔하게
      const cleanBody = (editContent || "").replace(/<span[^>]*data-doc-var[^>]*>([\s\S]*?)<\/span>/gi, "$1");
      const cj = { ...(doc?.content_json as any || {}), body: cleanBody };
      // 품목 데이터 포함
      if (editItems.length > 0) cj.items = editItems;
      // 결제조건 데이터 포함
      if (editPaymentSchedule.length > 0) cj.paymentSchedule = editPaymentSchedule;
      // 견적서 헤더 포함
      cj.header = quoteHeader;
      await saveRevision({
        documentId: id,
        authorId: userId!,
        contentJson: cj as unknown as Json,
        comment: comment || undefined,
      });
      // PDF 페이지 이미지 재삽입 등으로 본문에서 빠진 첨부(고아)를 정리 — 파일보관함에 안 쌓이게
      pruneUnreferencedDocumentFiles(id, cleanBody).catch(() => {});
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
      pruneUnreferencedDocumentFiles(id, cleanBody).catch(() => {});
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
    const issueDate = todayKst();
    if (items.length === 0) { toast("발행할 품목이 없습니다", "error"); return; }
    if (!counterparty) { toast("거래처를 입력하세요", "error"); return; }
    setIssuing(true);
    try {
      //   문서의 거래유형을 그대로 잇는다. 예전엔 taxKind·itemName·status 를 안 넘겨
      //   기본값(과세 10% · 품목 "용역" · 곧바로 발행)으로 떨어졌다 — 면세 견적서에도
      //   세액이 붙고, 국세청에 나가는 품목이 "용역" 으로 고정되고, 발행 대기를 건너뛰었다.
      //   프로젝트 쪽(BoardDocModal)은 넷 다 제대로 넘긴다.
      const taxKind: "taxable" | "exempt" | "zero_rated" =
        quoteHeader.taxType === "exempt" ? "exempt"
        : quoteHeader.taxType === "zero" ? "zero_rated"
        : "taxable";
      if (mode === "per-item") {
        for (const it of items) {
          await createTaxInvoice({
            companyId: companyId!, dealId: (doc as any)?.deal_id || undefined, type: "sales",
            counterpartyName: counterparty, partnerId: quoteHeader.partnerId || undefined,
            supplyAmount: Number(it.supplyAmount || 0), issueDate, label: it.name || "품목",
            itemName: it.name || undefined, taxKind, status: "draft",
          });
        }
        toast(`품목별 세금계산서 ${items.length}건을 발행 대기로 만들었습니다`, "success");
      } else {
        const total = items.reduce((s: number, i: any) => s + Number(i.supplyAmount || 0), 0);
        const label = items.length === 1 ? (items[0].name || "품목") : `${items[0].name || "품목"} 외 ${items.length - 1}건`;
        await createTaxInvoice({
          companyId: companyId!, dealId: (doc as any)?.deal_id || undefined, type: "sales",
          counterpartyName: counterparty, partnerId: quoteHeader.partnerId || undefined,
          supplyAmount: total, issueDate, label,
          itemName: label, taxKind, status: "draft",
        });
        toast("세금계산서(일괄)를 발행 대기로 만들었습니다", "success");
      }
      setSavedModal(false);
      window.location.href = "/tax-invoices";
    } catch (e: any) { toast("발행 실패: " + (e?.message || ""), "error"); }
    finally { setIssuing(false); }
  };

  useModalKeys(savedModal, () => setSavedModal(false), issuing ? undefined : () => issueInvoices("bulk"));

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
  //   발행(issued)·잠금 시각이 있는 문서도 잠긴 문서 — DB 트리거(documents_content_edit_guard R1·R2)와 같은 기준 (2026-09-30)
  const isLocked = status === "locked" || status === "executed" || status === "issued" || !!doc.locked_at;
  //   직인이 찍힌 문서도 내용은 못 고친다(2026-10-01 사장님) — DB 트리거 documents_sealed_content_guard 와 같은 기준.
  //   상태 진행(서명 요청·잠금)은 그대로. 고쳐야 하면 개정본.
  const isSealed = !!(doc as any).seal_applied;
  const contentFrozen = isLocked || isSealed;
  const canEdit = (status === "draft" || status === "review") && !contentFrozen;
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
    견적일자: doc.created_at ? kstDateStr(new Date(doc.created_at)) : "",
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
    <div className="document-detail-view">
      {/* Header */}
      <div className="document-detail-nav">
        <button onClick={onBack} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition">
          &larr; 문서 목록
        </button>
      </div>

      <div className="document-detail-header">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold">{doc.name}</h1>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
            {/* 내부 코드(quote·invoice 등) 대신 사람 말로. 견적 양식(quote·invoice)은 이 화면에서 둘 다 견적서로 그린다 */}
            <span>버전 {doc.version}</span>
            <span>|</span>
            <span>{contentType === "quote" || contentType === "invoice" ? "견적서" : (DOC_TYPES.find((t) => t.value === contentType)?.label || "문서")}</span>
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
                <span>잠금: {kstDateStr(new Date(doc.locked_at))}</span>
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

        <div className="document-actions-bar">
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
                  //   화면 요약·미리보기와 같은 계산을 쓴다. 예전엔 여기서만 공급가액 합계에
                  //   일률적으로 10% 를 붙이고 할인을 몰라서, 거래처가 받는 PDF 의 금액이
                  //   화면과 달랐다(할인 100만원이 그냥 빠지고, 면세 품목에도 세액이 붙었다).
                  const qTotals = quoteTotals(items as any[], (cj.header?.discount ?? quoteHeader.discount));
                  const supplyAmt = qTotals.supply;
                  const taxAmt = qTotals.tax;
                  const discountAmt = qTotals.discount;
                  const grandAmt = qTotals.total;
                  // 회사 대표 계좌 가져오기
                  const bankAcct = logRead('documents/page:bankAcct', await db.from('bank_accounts').select('bank_name, account_number, alias').eq('company_id', companyId ?? '').eq('is_primary', true).limit(1).maybeSingle());
                  const currentUser = logRead('documents/page:currentUser', await db.from('users').select('name, email').eq('id', userId ?? '').maybeSingle());

                  // 제안사 담당자 — 견적 헤더에서 선택한 담당자 우선(없으면 현재 사용자). 이메일은 이름으로 조회.
                  const mgrName = cj.header?.manager || quoteHeader.manager || '';
                  let mgrEmail = '';
                  if (mgrName) {
                    const mgrRow = logRead('documents/page:mgrRow', await db.from('users').select('email').eq('company_id', companyId).eq('name', mgrName).limit(1).maybeSingle());
                    mgrEmail = mgrRow?.email || '';
                  }

                  

                  // 견적 의뢰 기업(거래처) 상세 · partnerId 우선, 없으면 거래처명으로 company 범위 내 매칭
                  const cpName = cj.counterpartyName || cj.partnerName || cj.header?.partnerName || quoteHeader.partnerName || '';
                  const cpId = cj.header?.partnerId || quoteHeader.partnerId || null;
                  let partnerRow: any = null;
                  const pcols = 'name, representative, contact_name, contact_phone, contact_email, address';
                  if (cpId)  {
                    partnerRow = (await db.from('partners').select(pcols).eq('id', cpId).maybeSingle()).data;
                  } else if (cpName) {
                    partnerRow = (await db.from('partners').select(pcols).eq('company_id', companyId).eq('name', cpName).limit(1).maybeSingle()).data;
                  }

                  // P3 — 회사 활성 견적 양식이 있으면 오버레이(실제 디자인 재현), 없으면 현행 generateQuotePDF 폴백(회귀 0).
                  const quoteTpl = companyId ? await getActiveTemplate(companyId, "quote").catch(() => null) : null;
                  //   ⚠️ 텍스트 변환 양식은 아래 오버레이 경로로 보내면 안 된다. 그 양식은 채울 칸
                  //   목록(fields)이 비어 있어서, 업로드한 원본 PDF 가 값 하나 없이 그대로 떨어졌다.
                  //   프로젝트 쪽(quote-pdf)은 모드를 보고 본문에 값을 치환해 HTML→PDF 로 만든다.
                  //   같은 부품에 맡겨 두 화면이 같은 종이를 내보내게 한다.
                  if (quoteTpl && quoteTpl.template_mode === "text") {
                    const { buildQuoteBlobFromDoc } = await import("@/lib/quote-pdf");
                    pdfBlob = await buildQuoteBlobFromDoc(doc, companyId!, userId ?? null);
                  } else if (quoteTpl) {
                    const bytes = await downloadTemplateFile(quoteTpl.file_path);
                    const filled = await fillFormTemplate(bytes, quoteTpl.fields, { values: buildQuoteValues({
                      myCompanyName: companyName,
                      myRepresentative: company.data?.representative,
                      partnerName: cpName,
                      partnerRepresentative: partnerRow?.representative,
                      projectName: (doc as any).name,
                      quoteNumber: (doc as any).document_number,
                      issueDate: todayKst(),
                      validUntil: cj.header?.validUntil || quoteHeader.validUntil,
                      supplyAmount: supplyAmt,
                      taxAmount: taxAmt,
                      totalAmount: grandAmt,
                      notes: discountAmt > 0
                        ? `할인 -${discountAmt.toLocaleString('ko-KR')}원\n${cj.notes || ''}`.trim()
                        : cj.notes,
                    }), items: (items as any[]).map((it) => ({ name: it.name, quantity: it.qty, unitPrice: it.unitPrice, amount: it.amount })) });
                    pdfBlob = new Blob([filled as BlobPart], { type: "application/pdf" });
                  } else {
                  pdfBlob = await generateQuotePDF({
                    documentNumber: (doc as any).document_number || '-',
                    companyInfo: {
                      name: companyName,
                      representative: company.data?.representative ?? undefined,
                      address: company.data?.address ?? undefined,
                      phone: company.data?.phone ?? undefined,
                      businessNumber: company.data?.business_number ?? undefined,
                    },
                    counterparty: cpName || '-',
                    items,
                    supplyAmount: supplyAmt,
                    taxAmount: taxAmt,
                    totalAmount: grandAmt,
                    validUntil: cj.header?.validUntil || quoteHeader.validUntil || cj.validUntil || '견적일로부터 30일',
                    notes: cj.notes || '',
                    sealUrl: (doc as any).seal_applied ? (await resolveSealUrl(company.data?.seal_url)) ?? undefined : undefined,
                    managerName: mgrName || currentUser?.name || undefined,
                    managerContact: mgrName ? (mgrEmail || undefined) : (currentUser?.email || undefined),
                    paymentTerms: cj.header?.paymentTerms || quoteHeader.paymentTerms || undefined,
                    deliveryTerms: cj.header?.deliveryTerms || quoteHeader.deliveryTerms || undefined,
                    bankInfo: bankAcct ? { bankName: bankAcct.bank_name, accountNumber: bankAcct.account_number, accountHolder: bankAcct.alias || companyName } : undefined,
                    deliveryDate: cj.deliveryDate || undefined,
                    // 팩트시트 스타일 추가 — 제목(문서명)/견적의뢰기업 상세/제안사 사이트
                    title: (doc as any).name || undefined,
                    // companies 에 website/homepage/site_url 컬럼 없음 — 항상 undefined 였음 (동작 보존)
                    siteUrl: undefined,
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
                  //   ⚠️ 아래 인쇄·PDF 경로는 editContent 원문을 쓴다. 보기 모드는 fillVars 로 값을
                  //   채워 보여 주는데 여기만 안 채워서, 양식으로 만들고 한 번도 '수정하기→저장' 을
                  //   안 한 문서를 내보내면 {{회사명}}·{{거래처명}} 이 글자 그대로 인쇄됐다.
                  //   화면에는 정상으로 보이니 발견이 늦다 — 보기와 같은 값으로 채워서 내보낸다.
                  // 2026-05-22 이미지(PDF 페이지 삽입 등) 포함 문서는 브라우저 인쇄 PDF 로 변환 —
                  //   jspdf 경로는 <img> 를 제거하므로 그래프·표 이미지 보존을 위해 인쇄 경로 사용.
                  //   인쇄 창은 같은 출처(about:blank)라 여기 쓰는 HTML 은 앱 세션 권한으로 실행된다 —
                  //   화면 미리보기와 똑같이 정화하고 제목은 이스케이프한다(종전엔 원문 그대로 써 스크립트가 실행됐다).
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    const escText = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    const safeBody = sanitizeDocumentHtml(fillVars(editContent));
                    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escText(doc.name)}</title>` +
                        `<style>body{font-family:'Noto Sans KR',sans-serif;padding:40px;max-width:820px;margin:0 auto;line-height:1.7;color:#111}` +
                        `img{max-width:100%;height:auto;display:block;margin:12px auto}h1{font-size:22px}@media print{body{padding:0}}</style></head>` +
                        `<body><h1>${escText(doc.name)}</h1>${safeBody}</body></html>`;
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
                  //   보기 모드와 같은 값으로 채운다(위 주석 참조)
                  let pdfContent = fillVars(editContent);
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
                      representative: company.data.representative ?? undefined,
                      address: company.data.address ?? undefined,
                      businessNumber: company.data.business_number ?? undefined,
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
            className="btn-secondary btn-sm">
            PDF 다운로드
          </button>
          {/* 번호가 이미 있으면 숨긴다 — 전에는 다시 누르면 번호가 바뀌었다(2026-09-30) */}
          {!doc.document_number && (
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
              className="btn-secondary btn-sm">
              문서번호 발급
            </button>
          )}
          <button onClick={() => sendToPartnerMut.mutate()} disabled={sendToPartnerMut.isPending}
            className="btn-primary btn-sm"
            title="거래처에 서명 링크를 이메일로 보냅니다.">
            {sendToPartnerMut.isPending ? "발송 중..." : "거래처에게 발송"}
          </button>
          <button onClick={() => setShowSignRequestForm(!showSignRequestForm)}
            className="btn-secondary btn-sm"
            title="받는 사람을 직접 지정해 발송">
            직접 지정 발송
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
            className="btn-secondary btn-sm">
            공유 링크
          </button>
          {canSubmit && (
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="btn-secondary btn-sm">
              검토 요청
            </button>
          )}
          {canApprove && (
            <button onClick={() => setShowApprovalForm(!showApprovalForm)}
              className="btn-secondary btn-sm">
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
              className="btn-secondary btn-sm">
              임의 승인
            </button>
          )}
          {canLock && (
            <button onClick={() => lockMut.mutate()} disabled={lockMut.isPending}
              className="btn-secondary btn-sm">
              잠금 (체결)
            </button>
          )}
        </div>
      </div>

      {showApprovalForm && (
        <div className="document-approval-form glass-card">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">문서 승인</h3>
          <textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)}
            placeholder="승인 코멘트 (선택)"
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] mb-3 h-20 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}
              className="btn-primary">
              승인 확인
            </button>
            <button onClick={() => setShowApprovalForm(false)} className="btn-ghost">취소</button>
          </div>
        </div>
      )}

      {/* Inline Share Email Input */}
      {showShareEmailInput && shareUrl && (
        <div className="document-share-email-panel glass-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[var(--text)]">공유 링크 생성 완료</h3>
            <button onClick={() => { setShowShareEmailInput(false); setShareUrl(""); }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">
              닫기
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)]">
            <span className="text-xs text-[var(--text-muted)] truncate flex-1">{shareUrl}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(shareUrl); }}
              className="px-2 py-1 text-xs bg-[var(--primary)]/10 text-[var(--primary)] rounded font-semibold hover:bg-[var(--primary)]/20 transition whitespace-nowrap">
              복사
            </button>
          </div>
          <div className="text-xs text-[var(--text-muted)] mb-2">수신자 이메일을 입력하세요.</div>
          <div className="flex gap-2 items-center">
            <input
              type="email"
              value={shareEmailAddress}
              onChange={(e) => setShareEmailAddress(e.target.value)}
              placeholder="recipient@example.com"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && shareEmailAddress.trim()) { (e.target as HTMLInputElement).form?.requestSubmit(); } }}
              className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
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
              className="btn-primary whitespace-nowrap">
              {shareSending ? '발송 중...' : '이메일 발송'}
            </button>
          </div>
        </div>
      )}

      {/* Signature Request Form (multi-signer) */}
      {showSignRequestForm && (
        <div className="signature-request-form glass-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[var(--text)]">전자서명 요청 ({bulkSigners.length}명)</h3>
            <button
              onClick={() => setBulkSigners([...bulkSigners, { name: "", email: "", phone: "" }])}
              className="text-xs px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg font-semibold transition"
            >
              + 서명자 추가
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mb-3">서명자마다 개별 링크를 받습니다.</p>

          <div className="space-y-2 mb-4">
            {bulkSigners.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-12 sm:col-span-3">
                  <input
                    value={s.name}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].name = e.target.value; setBulkSigners(arr); }}
                    placeholder={`서명자 ${i + 1} 이름 *`}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="email"
                    value={s.email}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].email = e.target.value; setBulkSigners(arr); }}
                    placeholder="이메일 *"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div className="col-span-10 sm:col-span-3">
                  <input
                    type="tel"
                    value={s.phone}
                    onChange={(e) => { const arr = [...bulkSigners]; arr[i].phone = e.target.value; setBulkSigners(arr); }}
                    placeholder="전화 (선택)"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
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
              className="btn-primary"
            >
              {bulkSignMut.isPending ? "발송 중..." : `${bulkSigners.filter(s => s.name.trim() && s.email.trim()).length}명에게 일괄 발송`}
            </button>
            <button
              onClick={() => setShowSignRequestForm(false)}
              className="btn-ghost"
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
          <div className="signature-progress-panel glass-card">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h4 className="text-xs font-bold text-[var(--text-muted)]">서명 진행 ({signedCount}/{total})</h4>
                <div className="w-32 h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--success)] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] font-semibold text-[var(--success)]">{pct}%</span>
              </div>
              <div className="flex gap-2">
                {pendingCount > 0 && (
                  <button onClick={sendAllReminders} className="btn-warn-sm text-[10px]">
                    <Ico e="🔔" /> 전체 리마인더 ({pendingCount})
                  </button>
                )}
                <button onClick={() => setShowAuditLog(!showAuditLog)} className="text-[10px] px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded-md font-semibold transition border border-[var(--border)]">
                  <Ico e="📜" /> 감사로그 {showAuditLog ? "닫기" : "보기"}
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
                        <span className="text-[10px] text-blue-400" title={new Date(sig.viewed_at).toLocaleString("ko")}><Ico e="👁" /> 열람</span>
                      )}
                      {reminderCount > 0 && (
                        <span className="text-[10px] text-amber-400" title={lastReminded || ""}><Ico e="🔔" /> {reminderCount}회</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full ${si.bg} ${si.text}`}>{si.label}</span>
                      {sig.signed_at && (
                        <span className="text-[var(--text-dim)]">{kstDateStr(new Date(sig.signed_at))}</span>
                      )}
                      {isPending && (
                        <button
                          onClick={(e) => { e.stopPropagation(); sendReminder(sig.id); }}
                          disabled={reminderSendingId === sig.id}
                          className="btn-secondary btn-sm"
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
                  <div className="text-[11px] text-[var(--text-dim)] py-3">아직 기록이 없습니다.</div>
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
                          <span className="text-sm flex-shrink-0"><Ico e={meta.icon} /></span>
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
      {/*   2026-10-01 UI 점검 9순위: 본문 탭 seg-bar → 파란 밑줄 탭(collect-tabs). glass-card 판은 .document-detail-view 범위에서 평판으로 */}
      <div className="document-detail-tabs collect-tabs" role="tablist">
        {(
          [
            { key: "content" as const, label: "내용" },
            { key: "revisions" as const, label: `수정이력 (${revisions.length})` },
            { key: "approvals" as const, label: `승인 (${approvals.length})` },
          ] as const
        ).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "content" && (
        <div className="space-y-4">
          {isLocked && (
            <div className="kpi-callout warning">
              이 문서는 <b>잠금 상태</b>라 수정할 수 없습니다.
            </div>
          )}
          {!isLocked && isSealed && (
            <div className="kpi-callout warning">
              <b>직인이 찍힌 문서</b>라 내용을 고칠 수 없습니다. 고쳐야 하면 개정본(새 문서)을 만드세요.
            </div>
          )}

          {/* ── 견적서 헤더 (거래처/거래유형/결제조건 등) — 견적/계산서면 항상 표시 ── */}
          {(contentType === 'invoice' || contentType === 'quote') && (
            <QuoteHeader header={quoteHeader} onChange={setQuoteHeader} companyId={companyId} editable={(canEdit && isEditing) || ((contentType === 'invoice' || contentType === 'quote') && !contentFrozen)} />
          )}

          {/* ── 품목 편집 테이블 (회사별 컬럼 커스터마이징) ── */}
          {((contentType === 'invoice' || contentType === 'quote') || (contentType === 'contract' && (editItems.length > 0 || (canEdit && isEditing)))) && (
            <div className="document-items-table glass-card">
              <QuoteItemsTable
                items={editItems}
                onChange={setEditItems}
                companyId={companyId}
                editable={(canEdit && isEditing) || ((contentType === 'invoice' || contentType === 'quote') && !contentFrozen)}
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
              <div className="invoice-issue-modal fixed inset-0" onClick={() => setSavedModal(false)}>
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="text-base font-bold text-[var(--text)] mb-1"><Ico e="✅" /> 견적서가 저장되었습니다</div>
                  <p className="text-sm text-[var(--text-muted)] mb-4 leading-relaxed">매출 세금계산서를 <b className="text-[var(--text)]">견적서 품목대로</b> 발행할까요? (품목 {issItems.length}개)</p>
                  <ul className="invoice-issue-choices">
                    <li><b>품목 일괄 발행</b> — 합계 1건{issItems.length > 1 ? ` (${issItems[0]?.name || "품목"} 외 ${issItems.length - 1}건)` : ""}</li>
                    {issItems.length > 1 && <li><b>품목별 개별 발행</b> — {issItems.length}건을 각각 발행합니다.</li>}
                  </ul>
                  <div className="invoice-issue-actions">
                    <button type="button" onClick={() => setSavedModal(false)} className="btn-secondary btn-sm">나중에</button>
                    {issItems.length > 1 && (
                      <button type="button" onClick={() => issueInvoices("per-item")} disabled={issuing} className="btn-secondary btn-sm">품목별 개별 발행</button>
                    )}
                    <button type="button" onClick={() => issueInvoices("bulk")} disabled={issuing} className="btn-primary btn-sm">품목 일괄 발행</button>
                  </div>
                  {issuing && <div className="text-xs text-[var(--text-dim)] mt-2 text-center">발행 중…</div>}
                </div>
              </div>
            );
          })()}

          {/* ── 견적서 미리보기 (헤더·품목 값으로 구성된 결과물) ── */}
          {(contentType === 'invoice' || contentType === 'quote') && (() => {
            const validItems = editItems.filter((i: any) => i && (i.name || Number(i.supplyAmount)));
            const t = quoteTotals(editItems as any[], (quoteHeader as any).discount);
            const supplyTotal = t.supply;
            const taxTotal = t.tax;
            const discountVal = t.discount;
            const grand = t.total;
            const w = (n: number) => `₩${(Number(n) || 0).toLocaleString('ko')}`;
            return (
              <div ref={previewRef} className="quote-preview-panel glass-card">
                <div className="px-5 py-3 border-b border-[var(--border)] text-xs text-[var(--text-dim)] font-medium">견적서 미리보기</div>
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
                      <div>견적일자: {doc.created_at ? kstDateStr(new Date(doc.created_at)) : ''}</div>
                      <div>유효기간: {quoteHeader.validUntil || '견적일로부터 30일'}</div>
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse mb-3 text-[#333]">
                    <thead>
                      <tr className="bg-[#f3f4f6] border-y border-[#ddd]">
                        <th className="px-2 py-1.5 text-center">품목</th>
                        <th className="px-2 py-1.5 text-center w-16">수량</th>
                        <th className="px-2 py-1.5 text-center w-24">단가</th>
                        <th className="px-2 py-1.5 text-center w-28">공급가액</th>
                        <th className="px-2 py-1.5 text-center w-24">부가세</th>
                        <th className="px-2 py-1.5 text-center w-28">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validItems.length === 0 ? (
                        <tr><td colSpan={6} className="px-2 py-6 text-center text-[#999]">아직 품목이 없습니다.</td></tr>
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
                    <div className="w-64 max-w-full text-xs space-y-1 text-[#333]">
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
            <div className="contract-payment-schedule-table glass-card">
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
                      <th className="text-center px-4 py-2 font-medium w-28">구분</th>
                      <th className="text-center px-4 py-2 font-medium w-24">비율(%)</th>
                      <th className="text-center px-4 py-2 font-medium w-32">금액</th>
                      <th className="text-center px-4 py-2 font-medium">지급조건</th>
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
          <div className="document-seal-panel glass-card">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-xs font-bold text-[var(--text-dim)]">직인 / 서명</span>
              {(doc as any).seal_applied && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--success-dim)] text-[var(--success)] font-semibold">직인 적용됨</span>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {/* 직인 적용 */}
              {!(doc as any).seal_applied && companyId && (
                <button
                  onClick={async () => {
                    if (!companyId || !userId) return;
                    if (!(await appConfirm("직인을 찍으면 이 문서의 내용을 더 고칠 수 없습니다.\n고칠 곳이 없는지 확인한 뒤 찍어 주세요."))) return;
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
                  className="btn-secondary">
                  {sealApplying ? '적용 중...' : '직인 적용하기'}
                </button>
              )}
              {/* 자체 서명 */}
              {!isLocked && (
                <button
                  onClick={() => setShowSelfSign(!showSelfSign)}
                  className="btn-secondary">
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
                    className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
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
                    className="btn-primary">
                    서명 완료
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 문서 내용(마크다운 본문) — 견적/계산서는 헤더·품목으로 대체하므로 숨김 */}
          {!(contentType === 'invoice' || contentType === 'quote') && (
          <div className="document-content-panel glass-card">
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
                 
                  onUploadImage={async (file) => {
                    if (!companyId || !userId) throw new Error("회사 정보를 불러오는 중입니다");
                    // 문서 첨부는 원장에 남긴다(문서 삭제·정리 때 같이 지우려고) — document_id 가 있어 파일보관함 목록엔 안 보인다
                    const res = await uploadFile({ companyId, bucket: "company-assets", file, userId, context: { documentId: id }, register: true });
                    return res.fileUrl;
                  }}
                />
              ) : (() => {
                const filled = fillVars(editContent);
                const t = filled.trim();
                if (t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<div') || t.startsWith('<h') || t.startsWith('<p') || t.startsWith('<ul') || t.startsWith('<ol') || t.startsWith('<img') || t.startsWith('<blockquote')) {
                  return <div className="text-sm leading-relaxed text-[var(--text)] document-html-content [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2" dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(filled) }} />;
                }
                if (!t) return <div className="text-sm text-[var(--text-dim)]">(내용 없음)</div>;
                // 마크다운식 렌더 · ## 제목, ※ 주석, [품목 테이블]은 위 품목표로 대체(숨김)
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

          {(canEdit || ((contentType === 'invoice' || contentType === 'quote') && !contentFrozen)) && (
            <div className="document-save-bar">
              <input value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder="변경 코멘트 (선택)"
                className="flex-1 px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                className="btn-primary">
                {saveMut.isPending ? "저장 중..." : "저장"}
              </button>
              {(contentType === 'invoice' || contentType === 'quote') && (
                <button onClick={() => saveAndInvoiceMut.mutate()} disabled={saveAndInvoiceMut.isPending}
                  className="btn-secondary whitespace-nowrap"
                  title="저장하고 매출 세금계산서 초안을 만듭니다.">
                  {saveAndInvoiceMut.isPending ? "처리 중..." : "저장/전표"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "revisions" && (
        <div className="document-revisions-list glass-card">
          {revisions.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">아직 수정 이력이 없습니다.</div>
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
        <div className="document-approvals-list glass-card">
          {approvals.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">아직 승인 기록이 없습니다.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {approvals.map((appr: any) => (
                <div key={appr.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        appr.status === "approved"
                          ? "bg-[var(--success-dim)] text-[var(--success)]"
                          : appr.status === "rejected"
                          ? "bg-[var(--danger-dim)] text-[var(--danger)]"
                          : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
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

//   파일 종류 · 값이 고정이라 모듈 상수다. 컴포넌트 안에 있으면 위쪽(useMemo)에서 못 쓴다
//   (선언 전 참조 → "Cannot access 'FILE_CATEGORIES' before initialization" 으로 화면이 통째로 죽는다).
const FILE_CATEGORIES = [
  
  { value: "all", label: "전체" },
  { value: "contract", label: "계약서" },
  { value: "invoice", label: "세금계산서" },
  { value: "report", label: "보고서" },
  { value: "certificate", label: "인증서" },
  { value: "general", label: "일반" },
];

//   문서함 = 파일 보관함 전용(522713f8 이후 탭이 'files' 로 고정). 2026-10-01 사장님 지시로, 화면에서 열리지 않던
//   문서·계약·청구서·서명 탭과 새 문서·청구서 작성 폼, 그 상태·조회·버튼 코드를 걷어 냈다 — 그 기능은 각 전용 메뉴
//   (전자계약 /signatures · 계약 /contracts · 프로젝트 · 세금·증빙)에 있다. 문서 상세(?id=)는 DocumentDetailView 그대로.
function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

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

  if (!companyId || !userId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  return (
    <div className="documents-page-root">
      <VaultExplorer companyId={companyId} userId={userId} />
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
  const decisionColor: Record<string, string> = { approved: 'text-[var(--success)]', hold: 'text-[var(--warning)]', rejected: 'text-[var(--danger)]' };

  return (
    <div className="share-status-panel glass-card">
      <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3">공유 현황</h4>
      <div className="space-y-2">
        {activeShares.map((share: any) => {
          const feedback = share.document_share_feedback || [];
          return (
            <div key={share.id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--primary)] font-semibold"><Ico e="🔗" /> 공유 링크</span>
                <span className="caption">
                  {kstDateStr(new Date(share.created_at))} 생성
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">
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
                  className="text-[10px] px-2 py-1 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg hover:bg-[var(--primary)]/20 transition font-semibold"
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

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-[var(--text-muted)]">로딩 중...</div>}>
      <DocumentsPageInner />
    </Suspense>
  );
}

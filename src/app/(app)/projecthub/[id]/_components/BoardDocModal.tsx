"use client";

// 청구 한 줄의 문서 팝업 — 견적서 · 계약서 · 세금계산서 (2026-08-04).
//
//   1차 버전은 '요약 카드'였다. 사장님 지적: "견적서에는 어떤 품목인지 입력하고 실제 견적서
//   입력을 할 수 있어야 하는데 너무 많은 게 축소돼 있다. 보내기 버튼도 없고."
//   → 문서함에서 쓰는 **품목 테이블(QuoteItemsTable)을 그대로 재사용**해 실제 작성 화면으로 바꿨다.
//     같은 부품을 쓰므로 문서함과 견적서가 서로 다르게 동작할 일이 없다.
//
//   2026-08-10 (사장님 지시) — '＋ 견적서 / ＋ 계약서' 를 누른 첫 화면부터 **실제 입력화면**이다.
//     · 그전엔 품목표가 `doc?.id` 가 있을 때만 떠서, 새로 만들 때는 금액만 보였다(약식).
//       이제 저장 전 초안에서도 품목명·규격·수량·단가를 바로 넣는다.
//     · 견적서: 문서명 · 견적일자 · 유효기간 · 거래유형(과세/면세/영세) · 담당자 · 납품조건 ·
//       참조 · 품목표 · 비고까지 문서함과 같은 자리에 저장한다(content_json.header / notes).
//     · 계약서: 계약일 · 계약기간 · 계약 내역(품목) · 결제조건 · **계약 조항 본문**을 여기서 고친다.
//       연결된 견적서가 있으면 만들 때 자동으로 물려받고, '견적서 불러오기' 로 언제든 다시 당겨온다.
//
//   여기서 끝내는 일: 문서 작성 · 저장 · 검토 요청/승인 · 거래처 발송(메일) · 공유 링크 · 계산서 만들기.
//   문서 편집기로 넘어가는 일: PDF·전자서명 이력·버전 비교(드물어서 링크만 남긴다).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { createTaxInvoice } from "@/lib/tax-invoice";
import { todayKst, kstDateStr } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { QuoteItemsTable } from "@/app/(app)/documents/_components/QuoteItemsTable";
import { saveRevision, submitForReview, approveDocument } from "@/lib/documents";
import { createSignatureRequest, sendSignatureEmail } from "@/lib/signatures";
import { createDocumentShare } from "@/lib/document-sharing";

const db = supabase as any;
const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export type DocKind = "quote" | "contract" | "issue";
type PayMode = "full" | "two" | "three";
type TaxType = "taxable" | "exempt" | "zero";
type Clause = { title: string; content: string };

const DOC_LABEL: Record<DocKind, string> = { quote: "견적서", contract: "계약서", issue: "세금계산서" };
const STATUS_LABEL: Record<string, string> = {
  draft: "초안", review: "검토중", approved: "승인", executed: "체결", locked: "잠금",
};
const TAX_LABEL: [TaxType, string][] = [["taxable", "과세 (10%)"], ["exempt", "면세"], ["zero", "영세율"]];
const rateOf = (t: TaxType) => (t === "taxable" ? 0.1 : 0);

/** 세율이 바뀌면 이미 넣어 둔 줄의 공급가·세액도 같이 바뀐다 — 품목표와 같은 계산식 */
function recalc(row: any, taxRate: number) {
  const q = Number(row.quantity) || 0;
  const u = Number(row.unitPrice) || 0;
  const supply = q && u ? Math.round(q * u) : Number(row.supplyAmount) || 0;
  const tax = Math.round(supply * taxRate);
  return { ...row, supplyAmount: supply, taxAmount: tax, totalAmount: supply + tax, unitPriceVat: Math.round(u * (1 + taxRate)) };
}

export function BoardDocModal({
  kind, rowName, doc, draft, onCreate, amount, partnerName, partnerId, companyId, dealId, userId,
  quoteDoc, onClose, onIssued, onSent, onApproved,
}: {
  kind: DocKind;
  rowName: string;
  doc: any | null;
  /** 아직 만들지 않은 문서 — '만들기' 를 누르면 이 내용으로 열리고, **저장을 눌러야** 생긴다
   *  (2026-08-07 사장님 지시). 저장 전에는 보내기·검토 요청 같은 뒷일을 할 수 없다. */
  draft?: { name: string; content: any } | null;
  /** 저장 — 초안이면 이걸로 문서를 만든다. 성공하면 부모가 실제 문서로 바꿔 준다 */
  onCreate?: (contentJson: any, name?: string) => Promise<boolean>;
  /** 이 청구 건의 금액(공급가) — 품목이 없을 때의 기준값 */
  amount: number;
  partnerName: string;
  partnerId: string | null;
  companyId: string;
  dealId: string;
  userId?: string;
  /** 이 줄에 붙은 견적서 — 계약서에서 '견적서 불러오기' 로 품목·결제조건을 당겨온다 */
  quoteDoc?: any | null;
  onClose: () => void;
  /** 계산서를 만들면 행을 '발행' 단계로 */
  onIssued: () => void;
  /** 거래처에 보내면 행을 '견적' 단계로 */
  onSent?: () => void;
  /** 승인되면 행을 '계약' 단계로 */
  onApproved?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const cj = (doc?.content_json as any) || (draft?.content as any) || {};
  const [items, setItems] = useState<any[]>([]);
  const [issueDate, setIssueDate] = useState(todayKst());
  const [validUntil, setValidUntil] = useState("");
  const [dirty, setDirty] = useState(false);
  // 문서 자체의 항목 — 문서함(편집기)과 같은 자리(content_json)에 넣는다
  const [docName, setDocName] = useState("");
  const [docDate, setDocDate] = useState(todayKst());       // 견적일자 · 계약일
  const [periodStart, setPeriodStart] = useState("");        // 계약 기간
  const [periodEnd, setPeriodEnd] = useState("");
  const [taxType, setTaxType] = useState<TaxType>("taxable");
  const [manager, setManager] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [clauses, setClauses] = useState<Clause[]>([]);      // 계약 조항 본문

  const taxRate = rateOf(taxType);

  // 문서를 열 때 한 번만 채운다 — 편집 중에 되돌려지지 않게
  useEffect(() => {
    const c = (doc?.content_json as any) || (draft?.content as any) || {};
    const h = (c.header as any) || {};
    const tt: TaxType = h.taxType === "exempt" || h.taxType === "zero" ? h.taxType : "taxable";
    const rate = rateOf(tt);
    const rows = Array.isArray(c.items) && c.items.length > 0 ? c.items : (
      amount > 0
        // 품목이 없으면 행 이름·금액으로 한 줄 깔아 준다 — 빈 표 앞에서 막히지 않게
        ? [{ name: rowName || "품목", quantity: 1, unitPrice: amount, supplyAmount: amount, taxAmount: Math.round(amount * rate), totalAmount: Math.round(amount * (1 + rate)) }]
        : []
    );
    setItems(rows);
    setTaxType(tt);
    setValidUntil(c.validUntil || kstDateStr(new Date(Date.now() + 30 * 86_400_000)));
    setDocName(doc?.name || draft?.name || "");
    setDocDate(c.issueDate || todayKst());
    setPeriodStart(c.contractStart || "");
    setPeriodEnd(c.contractEnd || "");
    setManager(h.manager || "");
    setDeliveryTerms(h.deliveryTerms || "");
    setReference(h.reference || "");
    setNotes(c.notes || "");
    setClauses(Array.isArray(c.sections) ? c.sections.map((s: any) => ({ title: s?.title || "", content: s?.content || "" })) : []);
    setDirty(false);
  }, [doc?.id, draft?.name]);   // eslint-disable-line react-hooks/exhaustive-deps

  const existing: any[] = Array.isArray(cj.paymentSchedule) ? cj.paymentSchedule : [];
  const [payMode, setPayMode] = useState<PayMode>(
    existing.length >= 3 ? "three" : existing.length === 2 ? "two" : "full",
  );
  const [adv, setAdv] = useState<number>(Number(existing[0]?.ratio) || 30);
  const [mid, setMid] = useState<number>(existing.length >= 3 ? Number(existing[1]?.ratio) || 40 : 40);

  // 품목 합계 — 없으면 행 금액을 쓴다
  const supply = items.length > 0
    ? items.reduce((s, i) => s + (Number(i.supplyAmount) || 0), 0)
    : amount;
  const vat = items.length > 0
    ? items.reduce((s, i) => s + (Number(i.taxAmount) || 0), 0)
    : Math.round(amount * taxRate);

  // 이 문서의 발송 이력 — '보냈는지 안 보냈는지' 를 화면에서 알 수 있게(2026-08-04 실측:
  //   서명요청 779건 중 delivery_status 가 전부 비어 있어 발송 여부를 알 길이 없었다)
  const { data: sends = [] } = useQuery({
    queryKey: ["pb-doc-sends", doc?.id],
    queryFn: async () => {
      const data = logRead("BoardDocModal:sends", await db.from("signature_requests")
        .select("id, signer_name, signer_email, status, sent_at, viewed_at, signed_at, delivery_status, delivery_detail")
        .eq("document_id", doc.id).order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!doc?.id,
  });

  const terms = useMemo(() => {
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n || 0)));
    if (payMode === "full") return [{ label: "전액", ratio: 100, condition: "" }];
    if (payMode === "two") {
      const a = clamp(adv);
      return [{ label: "선금", ratio: a, condition: "계약 후 7일 이내" },
              { label: "잔금", ratio: 100 - a, condition: "납품 완료 후 14일 이내" }];
    }
    const a = clamp(adv), m = clamp(mid);
    return [{ label: "선금", ratio: a, condition: "계약 후 7일 이내" },
            { label: "중도금", ratio: m, condition: "중간 산출물 확인 후" },
            { label: "잔금", ratio: Math.max(0, 100 - a - m), condition: "납품 완료 후 14일 이내" }];
  }, [payMode, adv, mid]);
  const termAmount = (ratio: number) => Math.round((supply * ratio) / 100);

  const refreshDoc = () => {
    qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
    qc.invalidateQueries({ queryKey: ["pb-doc-sends", doc?.id] });
  };

  // 거래유형을 바꾸면 이미 넣은 줄의 세액도 같이 맞춘다 — 화면 합계와 저장본이 어긋나지 않게
  const changeTaxType = (t: TaxType) => {
    setTaxType(t);
    setItems((prev) => prev.map((r) => recalc(r, rateOf(t))));
    setDirty(true);
  };

  const setClause = (idx: number, patch: Partial<Clause>) => {
    setClauses((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    setDirty(true);
  };

  // ── 저장 — 문서함과 **같은 saveRevision** 을 쓴다(이력도 똑같이 남는다) ──
  const save = async (silent = false) => {
    if (!userId) return false;
    let allocated = 0;
    const schedule = terms.map((t, i) => {
      const amt = i === terms.length - 1 ? supply - allocated : termAmount(t.ratio);
      allocated += amt;
      return { label: t.label, ratio: t.ratio, amount: amt, condition: t.condition };
    });
    const withSchedule = kind === "contract" || existing.length > 0 || payMode !== "full";
    const termsText = schedule.map((s) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", ");
    const next = {
      ...cj,
      items,
      validUntil,
      issueDate: docDate,
      notes,
      header: {
        ...(cj.header || {}), partnerId, partnerName, taxType,
        manager, deliveryTerms, reference,
        ...(withSchedule ? { paymentTerms: termsText } : {}),
      },
      ...(clauses.length > 0 ? { sections: clauses } : {}),
      ...(kind === "contract" ? { contractStart: periodStart, contractEnd: periodEnd } : {}),
      ...(withSchedule ? { paymentSchedule: schedule, paymentTerms: termsText } : {}),
    };
    //   아직 없는 문서면 이때 만든다 — '만들기' 는 편집기를 열 뿐이고 저장이 실제 생성이다
    if (!doc?.id) {
      if (!onCreate) return false;
      const ok = await onCreate(next, docName.trim() || undefined);
      if (!ok) return false;
      setDirty(false);
      if (!silent) toast("저장했습니다.", "success");
      return true;
    }
    await saveRevision({ documentId: doc.id, authorId: userId, contentJson: next as any });
    //   문서명은 본문이 아니라 documents.name — 바뀐 때만 따로 고친다
    const nm = docName.trim();
    if (nm && nm !== doc.name) await db.from("documents").update({ name: nm }).eq("id", doc.id);
    setDirty(false);
    refreshDoc();
    if (!silent) toast("저장했습니다.", "success");
    return true;
  };

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (e: any) { toast(e?.message || "처리 실패", "error"); }
    finally { setBusy(false); }
  };

  // ── 견적서 → 계약서로 내용 당겨오기 (2026-08-10 사장님 지시) ──
  //   만들 때 자동으로 물려받지만, 견적을 나중에 고친 경우가 있어 언제든 다시 부를 수 있게 한다.
  const loadFromQuote = () => {
    const q = (quoteDoc?.content_json as any) || {};
    const qi = Array.isArray(q.items) ? q.items.filter((r: any) => r && (r.name || r.quantity || r.unitPrice)) : [];
    if (qi.length === 0) { toast("견적서에 품목이 없습니다. 견적서를 먼저 작성하세요.", "error"); return; }
    const hasRows = items.some((r) => r && (r.name || r.quantity || r.unitPrice));
    if (hasRows && !window.confirm("지금 계약 내역을 견적서 품목으로 바꿉니다. 계속할까요?")) return;
    const qh = (q.header as any) || {};
    const tt: TaxType = qh.taxType === "exempt" || qh.taxType === "zero" ? qh.taxType : "taxable";
    setTaxType(tt);
    setItems(qi.map((r: any) => recalc(r, rateOf(tt))));
    const sched: any[] = Array.isArray(q.paymentSchedule) ? q.paymentSchedule : [];
    if (sched.length >= 3) { setPayMode("three"); setAdv(Number(sched[0]?.ratio) || 30); setMid(Number(sched[1]?.ratio) || 40); }
    else if (sched.length === 2) { setPayMode("two"); setAdv(Number(sched[0]?.ratio) || 30); }
    setDirty(true);
    toast("견적서 내용을 불러왔습니다. 필요하면 고친 뒤 저장하세요.", "success");
  };

  // ── 거래처에 메일로 보내기 — 문서함의 '거래처에게 발송' 과 같은 경로 ──
  const sendToPartner = () => guard(async () => {
    if (!doc?.id || !userId) return;
    if (dirty) await save(true);
    if (!partnerId) throw new Error("거래처를 먼저 지정하세요");
    const p = logRead("BoardDocModal:partner", await db.from("partners")
      .select("contact_email, contact_name, name").eq("id", partnerId).maybeSingle());
    const email = p?.contact_email || "";
    if (!email) throw new Error(`'${partnerName}' 에 이메일이 없습니다 — 거래처 정보에 담당자 이메일을 넣어 주세요`);
    const req = await createSignatureRequest({
      companyId, documentId: doc.id, title: doc.name || DOC_LABEL[kind],
      signerName: p?.contact_name || p?.name || partnerName || "거래처",
      signerEmail: email, createdBy: userId,
    });
    const r = await sendSignatureEmail(req.id);
    // 발송 결과를 남긴다 — 안 남기면 보냈는지 알 길이 없다
    await db.from("signature_requests").update({
      delivery_status: r.error ? "failed" : "sent",
      delivery_detail: r.error ? String(r.error).slice(0, 300) : email,
      delivery_at: new Date().toISOString(),
    }).eq("id", req.id);
    refreshDoc();
    if (r.error) { toast(`메일 발송 실패: ${r.error} — 아래에서 재발송하거나 공유 링크를 쓰세요`, "error"); return; }
    onSent?.();
    toast(`${email} 로 보냈습니다.`, "success");
  });

  const resend = (reqId: string) => guard(async () => {
    const r = await sendSignatureEmail(reqId);
    await db.from("signature_requests").update({
      delivery_status: r.error ? "failed" : "sent",
      delivery_detail: r.error ? String(r.error).slice(0, 300) : null,
      delivery_at: new Date().toISOString(),
    }).eq("id", reqId);
    refreshDoc();
    toast(r.error ? `재발송 실패: ${r.error}` : "다시 보냈습니다.", r.error ? "error" : "success");
  });

  const copyShareLink = () => guard(async () => {
    if (!doc?.id || !userId) return;
    if (dirty) await save(true);
    const { shareUrl } = await createDocumentShare({ documentId: doc.id, companyId, createdBy: userId, expiresInDays: 30 });
    await navigator.clipboard.writeText(shareUrl);
    toast("공유 링크를 복사했습니다. 메신저로 붙여 넣어 보내세요.", "success");
  });

  const submit = () => guard(async () => {
    if (!doc?.id) return;
    if (dirty) await save(true);
    await submitForReview(doc.id);
    refreshDoc();
    toast("검토 요청했습니다.", "success");
  });

  const approve = () => guard(async () => {
    if (!doc?.id || !userId) return;
    await approveDocument(doc.id, userId);
    refreshDoc();
    onApproved?.();
    toast("승인했습니다.", "success");
  });

  // 계산서는 **발행 대기(초안)** 로만 만든다 — 국세청 발행은 세금계산서 화면에서 사람이 누른다.
  const makeInvoice = () => guard(async () => {
    if (!partnerName) throw new Error("거래처를 먼저 지정하세요");
    if (supply <= 0) throw new Error("금액을 먼저 입력하세요");
    await createTaxInvoice({
      companyId, dealId, type: "sales",
      counterpartyName: partnerName, partnerId: partnerId || undefined,
      supplyAmount: supply, issueDate, label: rowName || "청구", status: "draft",
    });
    qc.invalidateQueries({ queryKey: ["tax-invoices"] });
    toast("세금계산서를 발행 대기로 만들었습니다. 세금계산서 화면에서 발행하세요.", "success");
    onIssued();
    onClose();
  });

  const status = doc?.status || "draft";
  const canEdit = status === "draft" || status === "review";
  const lastSend = sends[0];
  //   편집기에서 서식(HTML 본문)으로 작성한 계약서는 조항 편집을 숨긴다 — 여기서 고치면 서식이 깨진다
  const richBody = kind === "contract" && !!cj.body;

  useModalKeys(true, onClose, busy ? undefined : kind === "issue" ? makeInvoice : () => save());

  const field = (label: string, node: React.ReactNode) => (
    <label className="pb-doc-field"><span>{label}</span>{node}</label>
  );

  return (
    <div className="pb-doc-modal" onClick={onClose}>
      <div className="pb-doc-box pb-doc-wide" onClick={(e) => e.stopPropagation()}>
        <header className="pb-doc-head">
          <div>
            <b>{rowName || "청구 건"}</b>
            <span>{DOC_LABEL[kind]}{doc?.document_number ? ` · ${doc.document_number}` : ""}</span>
            {!doc?.id && <em className="pb-doc-unsaved">아직 저장 전 — ‘저장’ 을 눌러야 만들어집니다</em>}
          </div>
          {kind !== "issue" && <span className={`pb-doc-st pb-doc-st-${status}`}>{STATUS_LABEL[status] || status}</span>}
          {dirty && <span className="pb-doc-dirty">저장 안 됨</span>}
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <div className="pb-doc-body">
          {/* 문서명 — 거래처가 받아 보는 제목이다(PDF 표지에도 그대로 쓰인다) */}
          {kind !== "issue" && (
            <label className="pb-doc-name">
              <span>{kind === "quote" ? "견적서명" : "계약서명"}</span>
              <input value={docName} disabled={!canEdit} placeholder={`예: ${rowName || "프로젝트"} ${DOC_LABEL[kind]}`}
                onChange={(e) => { setDocName(e.target.value); setDirty(true); }} />
            </label>
          )}

          <dl className="pb-doc-facts">
            <div><dt>거래처</dt><dd>{partnerName || <em>미지정 — 표에서 거래처를 고르세요</em>}</dd></div>
            {kind === "issue" && <div><dt>발행일</dt><dd><DateField value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></dd></div>}
            <div><dt>공급가</dt><dd className="pb-doc-num">{won(supply)}원</dd></div>
            <div><dt>합계</dt><dd className="pb-doc-num pb-doc-total">{won(supply + vat)}원 <em>(부가세 {won(vat)})</em></dd></div>
          </dl>

          {/* 문서 기본 정보 — 견적서·계약서가 서로 다른 칸을 쓴다 */}
          {kind === "quote" && (
            <section className="pb-doc-form">
              {field("견적일자", <DateField value={docDate} disabled={!canEdit} onChange={(e) => { setDocDate(e.target.value); setDirty(true); }} />)}
              {field("유효기간", <DateField value={validUntil} disabled={!canEdit} onChange={(e) => { setValidUntil(e.target.value); setDirty(true); }} />)}
              {field("거래유형", (
                <select className="pb-doc-in" value={taxType} disabled={!canEdit} onChange={(e) => changeTaxType(e.target.value as TaxType)}>
                  {TAX_LABEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ))}
              {field("담당자", <input className="pb-doc-in" value={manager} disabled={!canEdit} placeholder="우리 쪽 담당자"
                onChange={(e) => { setManager(e.target.value); setDirty(true); }} />)}
              {field("납품조건", <input className="pb-doc-in" value={deliveryTerms} disabled={!canEdit} placeholder="예: 계약 후 2주"
                onChange={(e) => { setDeliveryTerms(e.target.value); setDirty(true); }} />)}
              {field("참조", <input className="pb-doc-in" value={reference} disabled={!canEdit} placeholder="참조 사항"
                onChange={(e) => { setReference(e.target.value); setDirty(true); }} />)}
            </section>
          )}

          {kind === "contract" && (
            <section className="pb-doc-form">
              {field("계약일", <DateField value={docDate} disabled={!canEdit} onChange={(e) => { setDocDate(e.target.value); setDirty(true); }} />)}
              {field("거래유형", (
                <select className="pb-doc-in" value={taxType} disabled={!canEdit} onChange={(e) => changeTaxType(e.target.value as TaxType)}>
                  {TAX_LABEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ))}
              {field("시작일", <DateField value={periodStart} disabled={!canEdit} onChange={(e) => { setPeriodStart(e.target.value); setDirty(true); }} />)}
              {field("종료일", <DateField value={periodEnd} disabled={!canEdit} onChange={(e) => { setPeriodEnd(e.target.value); setDirty(true); }} />)}
            </section>
          )}

          {/* 품목 — 문서함과 같은 부품. 회사 컬럼 설정·My품목·과거 문서 불러오기가 그대로 붙는다.
              2026-08-10: 저장 전 초안에서도 띄운다 — '＋ 견적서' 첫 화면이 곧 입력화면이다 */}
          {kind !== "issue" && (
            <section className="pb-doc-items">
              <div className="pb-doc-items-head">
                <b>{kind === "quote" ? "견적 품목" : "계약 내역"}</b>
                {kind === "contract" && quoteDoc?.id && (
                  <button type="button" className="pb-doc-load" disabled={!canEdit} onClick={loadFromQuote}
                    title="연결된 견적서의 품목·결제조건을 그대로 가져옵니다">
                    견적서 불러오기{quoteDoc.document_number ? ` (${quoteDoc.document_number})` : ""}
                  </button>
                )}
              </div>
              <QuoteItemsTable
                items={items}
                onChange={(next) => { setItems(next); setDirty(true); }}
                companyId={companyId}
                editable={canEdit}
                taxRate={taxRate}
                partnerName={partnerName} />
            </section>
          )}

          {kind !== "issue" && (
            <section className="pb-doc-terms">
              <b>결제조건</b>
              <div className="pb-doc-modes">
                {([["full", "전액"], ["two", "선금·잔금"], ["three", "선금·중도금·잔금"]] as [PayMode, string][]).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => { setPayMode(m); setDirty(true); }} aria-pressed={payMode === m}
                    className={payMode === m ? "pb-doc-mode-on" : ""}>{label}</button>
                ))}
              </div>
              {payMode !== "full" && (
                <div className="pb-doc-ratios">
                  <label>선금 <input type="number" min={0} max={100} value={adv} onChange={(e) => { setAdv(Number(e.target.value)); setDirty(true); }} />%</label>
                  {payMode === "three" && (
                    <label>중도금 <input type="number" min={0} max={100} value={mid} onChange={(e) => { setMid(Number(e.target.value)); setDirty(true); }} />%</label>
                  )}
                </div>
              )}
              <ul className="pb-doc-termlist">
                {terms.map((t) => (
                  <li key={t.label}>
                    <span>{t.label} <em>{t.ratio}%</em></span>
                    <b className="pb-doc-num">{won(termAmount(t.ratio))}원</b>
                    <i>{t.condition || "협의"}</i>
                  </li>
                ))}
              </ul>
              {kind === "contract" && (
                <p className="pb-doc-hint">저장하면 표 위에서 이 회차대로 <b>청구 줄을 만들 수 있어요</b>.</p>
              )}
            </section>
          )}

          {/* 계약 조항 — 표준 본문을 그대로 고친다. 편집기에서 서식으로 만든 계약서는 건드리지 않는다 */}
          {kind === "contract" && !richBody && (
            <section className="pb-doc-terms">
              <b>계약 조항</b>
              {clauses.length === 0 && <p className="pb-doc-hint">조항이 없습니다. 아래에서 추가하세요.</p>}
              {clauses.map((c, i) => (
                <div key={i} className="pb-doc-clause">
                  <div className="pb-doc-clause-head">
                    <input value={c.title} disabled={!canEdit} placeholder={`제${i + 1}조 (제목)`}
                      onChange={(e) => setClause(i, { title: e.target.value })} />
                    <button type="button" disabled={!canEdit} title="이 조항 삭제"
                      onClick={() => { setClauses((prev) => prev.filter((_, x) => x !== i)); setDirty(true); }}>✕</button>
                  </div>
                  <textarea value={c.content} disabled={!canEdit} rows={3} placeholder="조항 내용"
                    onChange={(e) => setClause(i, { content: e.target.value })} />
                </div>
              ))}
              <button type="button" className="pb-doc-addclause" disabled={!canEdit}
                onClick={() => { setClauses((prev) => [...prev, { title: `제${prev.length + 1}조 ()`, content: "" }]); setDirty(true); }}>
                ＋ 조항 추가
              </button>
            </section>
          )}
          {kind === "contract" && richBody && (
            <p className="pb-doc-hint">이 계약서는 편집기에서 <b>서식(레이아웃)</b>으로 작성돼 있어요. 본문은 아래 ‘편집기’ 에서 고치세요.</p>
          )}

          {/* 비고 — 견적서 PDF 하단에 그대로 찍힌다 */}
          {kind === "quote" && (
            <section className="pb-doc-terms">
              <b>비고</b>
              <textarea className="pb-doc-notes" value={notes} disabled={!canEdit} rows={3}
                placeholder="예: 상기 금액은 부가세 별도입니다. / 일정은 착수일 기준입니다."
                onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
            </section>
          )}

          {/* 발송 이력 — 보냈는지 · 열어봤는지 · 실패했는지 */}
          {kind !== "issue" && sends.length > 0 && (
            <section className="pb-doc-terms">
              <b>보낸 기록</b>
              {sends.slice(0, 3).map((s) => (
                <div key={s.id} className="pb-doc-send">
                  <span className={`pb-doc-sendst ${s.delivery_status === "failed" ? "pb-doc-sendst-bad" : ""}`}>
                    {s.delivery_status === "failed" ? "발송 실패" : s.signed_at ? "서명 완료" : s.viewed_at ? "열어봄" : "보냄"}
                  </span>
                  <span className="pb-doc-sendto">{s.signer_name} · {s.signer_email}</span>
                  <span className="pb-doc-sendwhen">{String(s.sent_at || "").slice(5, 16).replace("T", " ")}</span>
                  <button type="button" onClick={() => resend(s.id)} disabled={busy}>다시 보내기</button>
                </div>
              ))}
            </section>
          )}

          {kind === "issue" && (
            <p className="pb-doc-hint">
              <b>발행 대기</b>로만 만듭니다. 국세청 실제 발행은 세금계산서 화면에서 확인하고 누르세요.
            </p>
          )}
        </div>

        <footer className="pb-doc-foot">
          {doc?.id && <Link href={`/documents?id=${doc.id}`} className="pb-doc-link" title="PDF · 서명 이력 · 버전 비교">편집기 ↗</Link>}
          {kind === "issue" && <Link href="/tax-invoices" className="pb-doc-link">세금계산서 화면 ↗</Link>}
          <span className="pb-doc-spacer" />
          {kind !== "issue" && (<>
            <button type="button" className="pb-doc-sub" disabled={busy || !canEdit} onClick={() => save()}>저장</button>
            {status === "draft" && <button type="button" className="pb-doc-sub" disabled={busy || !doc?.id}
              title={doc?.id ? undefined : "먼저 저장하세요"} onClick={submit}>검토 요청</button>}
            {status === "review" && <button type="button" className="pb-doc-sub" disabled={busy} onClick={approve}>승인</button>}
            <button type="button" className="pb-doc-sub" disabled={busy || !doc?.id}
              title={doc?.id ? undefined : "먼저 저장하세요"} onClick={copyShareLink}>공유 링크</button>
            <button type="button" className="pb-doc-go" disabled={busy || !doc?.id}
              title={doc?.id ? undefined : "먼저 저장하세요"} onClick={sendToPartner}>
              {busy ? "…" : lastSend ? "다시 보내기" : "거래처에 보내기"}
            </button>
          </>)}
          {kind === "issue" && (
            <button type="button" className="pb-doc-go" disabled={busy} onClick={makeInvoice}>{busy ? "만드는 중…" : "발행 대기로 만들기"}</button>
          )}
        </footer>
      </div>
    </div>
  );
}

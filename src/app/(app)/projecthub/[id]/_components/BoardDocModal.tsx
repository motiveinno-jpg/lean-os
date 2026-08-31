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
//   2026-08-10 (2차) — 숫자가 세 군데(표 행 금액 · 견적 · 계약)에 따로 살던 것을 정리했다.
//     ① **표 행 금액은 문서를 저장할 때 자동으로 맞춘다** (계약 > 견적 우선). 매출 집계·잔금이
//        보는 값이 문서와 갈리면 어느 쪽이 맞는지 알 길이 없다.
//     ② **견적↔계약이 달라지면**: 아직 안 보낸 견적이면 저장할 때 "견적서도 맞출까요?" 를 묻고,
//        이미 보낸 견적이면 **절대 덮어쓰지 않는다** — '견적과 다름' 배지 + 비교 보기 +
//        '개정 견적서 만들기'(새 문서, 원본은 그대로). 보낸 견적을 사후에 바꾸면 거래처가 받은
//        문서와 기록이 달라져 분쟁 때 근거가 무너진다.
//     ③ **＋ 발행은 계약을 승계한다** — 선금/중도금/잔금 회차를 골라 그 금액으로, 품목명·
//        과세유형(면세·영세면 세액 0)·사업자번호까지 넘긴다. 이미 발행한 회차는 표시한다.
//
//   여기서 끝내는 일: 문서 작성 · 저장 · 검토 요청/승인 · 거래처 발송(메일) · 공유 링크 · 계산서 만들기.
//   문서 편집기로 넘어가는 일: PDF·전자서명 이력·버전 비교(드물어서 링크만 남긴다).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateTaxInvoiceReaders } from "@/lib/tax-invoice-invalidate";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { createTaxInvoice } from "@/lib/tax-invoice";
import { todayKst, kstDateStr } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { QuoteItemsTable } from "@/app/(app)/documents/_components/QuoteItemsTable";
import { saveRevision, submitForReview, approveDocument, insertDocument } from "@/lib/documents";
import { createSignatureRequest, sendSignatureEmail } from "@/lib/signatures";
import { createDocumentShare } from "@/lib/document-sharing";
import { payTermsOf } from "@/lib/project-boards";
import { buildQuoteBlobFromDoc, buildContractBlobFromDoc } from "@/lib/quote-pdf";

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
//   세금계산서의 과세유형 — 면세·영세는 세액 0 으로 발행된다(문서의 거래유형을 그대로 잇는다)
const TAX_KIND: Record<TaxType, "taxable" | "exempt" | "zero_rated"> = {
  taxable: "taxable", exempt: "exempt", zero: "zero_rated",
};
const rateOf = (t: TaxType) => (t === "taxable" ? 0.1 : 0);
const isFilled = (r: any) => !!r && (r.name || r.quantity || r.unitPrice);

/** 세율이 바뀌면 이미 넣어 둔 줄의 공급가·세액도 같이 바뀐다 — 품목표와 같은 계산식 */
function recalc(row: any, taxRate: number) {
  const q = Number(row.quantity) || 0;
  const u = Number(row.unitPrice) || 0;
  const supply = q && u ? Math.round(q * u) : Number(row.supplyAmount) || 0;
  const tax = Math.round(supply * taxRate);
  return { ...row, supplyAmount: supply, taxAmount: tax, totalAmount: supply + tax, unitPriceVat: Math.round(u * (1 + taxRate)) };
}

/** 두 문서가 같은 내용인지 볼 때 쓰는 지문 — 품목명·수량·단가만 본다(적요·비고는 무시) */
const itemsKey = (rows: any[]) => rows.filter(isFilled)
  .map((r) => `${String(r.name || "").trim()}/${Number(r.quantity) || 0}/${Number(r.unitPrice) || 0}`).join("|");
const termsKey = (rows: { label: string; ratio?: number }[]) => rows.map((t) => `${t.label}:${t.ratio ?? ""}`).join("|");

export function BoardDocModal({
  kind, rowName, doc, draft, onCreate, amount, partnerName, partnerId, partnerBizno, companyId, dealId, userId,
  quoteDoc, hasContract, onAmountChange, onQuoteReplaced, onClose, onIssued, onSent, onApproved,
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
  /** 사업자번호 — 세금계산서에 그대로 실린다(홈택스 발행에 필요) */
  partnerBizno?: string | null;
  companyId: string;
  dealId: string;
  userId?: string;
  /** 이 줄에 붙은 견적서 — 계약서에서 '견적서 불러오기'·차이 비교에 쓴다 */
  quoteDoc?: any | null;
  /** 이 줄에 계약서가 이미 있나 — 있으면 견적을 저장해도 행 금액은 안 건드린다(계약 우선) */
  hasContract?: boolean;
  /** 저장 성공 시 그 줄의 금액 칸을 문서 합계로 맞춘다 */
  onAmountChange?: (supply: number) => void;
  /** 개정 견적서를 만들면 그 줄의 견적 연결을 새 문서로 바꾼다 */
  onQuoteReplaced?: (doc: { id: string; no: string }) => void;
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
  const [issueTerm, setIssueTerm] = useState("");            // 발행할 회차(라벨). 빈 값 = 전액
  const [showDiff, setShowDiff] = useState(false);           // 견적 ↔ 계약 비교 보기
  // 미리보기 — **저장 안 해도** 지금 화면 내용 그대로 실제 인쇄될 PDF 를 만들어 보여준다
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
  //   회차 예정일 — 적어 두면 그날 새벽 발행 대기(초안)가 자동으로 생긴다 (2026-08-27 ERP ③). 순서로 맞춘다(선금·중도금·잔금).
  const [termDates, setTermDates] = useState<string[]>(existing.map((x: any) => (x?.dueDate ? String(x.dueDate) : "")));
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

  //   견적서를 이미 거래처에 보냈나 — 보냈으면 계약과 달라져도 **덮어쓰지 않는다**
  const { data: quoteSent } = useQuery({
    queryKey: ["pb-quote-sent", quoteDoc?.id],
    queryFn: async () => {
      const data = logRead("BoardDocModal:quoteSent", await db.from("signature_requests")
        .select("id").eq("document_id", quoteDoc.id).limit(1));
      return (data || []).length > 0;
    },
    enabled: kind === "contract" && !!quoteDoc?.id,
  });

  //   이 줄에서 이미 만든 계산서 — 회차를 두 번 발행하지 않게 표시한다
  const { data: madeInvoices = [] } = useQuery({
    queryKey: ["pb-doc-invoices", dealId],
    queryFn: async () => {
      const data = logRead("BoardDocModal:invoices", await db.from("tax_invoices")
        .select("id, label, supply_amount, status, issue_date").eq("deal_id", dealId).eq("type", "sales"));
      return (data || []) as any[];
    },
    enabled: kind === "issue" && !!dealId,
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

  // ── 발행(세금계산서) — 계약서의 회차를 그대로 잇는다 ──
  //   회차 금액은 비율로 다시 계산한다(계약 금액이 바뀌었어도 합계가 공급가와 맞게).
  const issueTerms = useMemo(() => {
    if (kind !== "issue") return [];
    const list = payTermsOf(doc);
    if (list.length === 0) return [];
    let allocated = 0;
    return list.map((t, i) => {
      const amt = i === list.length - 1
        ? supply - allocated
        : (t.ratio ? Math.round((supply * t.ratio) / 100) : Number(t.amount) || 0);
      allocated += amt;
      return { label: t.label, ratio: t.ratio, condition: t.condition, amount: amt, dueDate: t.dueDate, invoiceId: t.invoiceId };
    });
  }, [kind, doc, supply]);
  //   계산서 이름 — 회차까지 적어 두면 세금계산서 화면에서도 어느 회차인지 바로 보인다
  const invLabel = (t: string) => (!t || t === "전액" ? (rowName || "청구") : `${rowName || "청구"} ${t}`);
  //   자동으로 만든 초안은 라벨이 다를 수 있어 회차에 적힌 invoiceId 로도 찾는다 (2026-08-27)
  const issuedOf = (t: string) => {
    const term = issueTerms.find((x) => x.label === t);
    return (madeInvoices as any[]).find((v) => v.label === invLabel(t) || (term?.invoiceId && v.id === term.invoiceId)) || null;
  };
  const issueSupply = issueTerm ? (issueTerms.find((t) => t.label === issueTerm)?.amount || 0) : supply;
  const issueVat = TAX_KIND[taxType] === "taxable" ? Math.round(issueSupply * 0.1) : 0;
  const alreadyIssued = issueTerms.length > 0 ? issuedOf(issueTerm) : issuedOf("");
  //   품목명 — 홈택스에 나가는 이름이다(비우면 "용역" 으로 나간다)
  const itemName = (() => {
    const filled = items.filter(isFilled);
    if (filled.length === 0) return rowName || "";
    const first = String(filled[0].name || rowName || "").trim();
    return filled.length > 1 ? `${first} 외 ${filled.length - 1}건` : first;
  })();

  //   발행할 회차는 '아직 안 만든 첫 회차' 를 기본으로 고른다
  useEffect(() => {
    if (kind !== "issue" || issueTerms.length === 0) return;
    const next = issueTerms.find((t) => !issuedOf(t.label)) || issueTerms[0];
    setIssueTerm(next.label);
  }, [kind, doc?.id, issueTerms.length, (madeInvoices as any[]).length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 견적 ↔ 계약 차이 — 계약을 고쳐서 견적과 달라졌는지 ──
  const quoteCj = (quoteDoc?.content_json as any) || {};
  const quoteItems: any[] = Array.isArray(quoteCj.items) ? quoteCj.items : [];
  const quoteSupply = quoteItems.reduce((s, i) => s + (Number(i.supplyAmount) || 0), 0);
  const quoteTerms: any[] = Array.isArray(quoteCj.paymentSchedule) ? quoteCj.paymentSchedule : [];
  const diff = useMemo(() => {
    if (kind !== "contract" || !quoteDoc?.id) return null;
    const amountDiff = supply - quoteSupply;
    const itemsDiff = itemsKey(quoteItems) !== itemsKey(items);
    const termsDiff = termsKey(quoteTerms as any) !== termsKey(terms);
    if (!amountDiff && !itemsDiff && !termsDiff) return null;
    return { amountDiff, itemsDiff, termsDiff };
  }, [kind, quoteDoc?.id, supply, quoteSupply, items, quoteItems, terms, quoteTerms]);

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

  //   결제조건을 회차 배열로 — 저장본·견적 맞춤·비교 보기가 모두 이걸 쓴다
  const buildSchedule = () => {
    let allocated = 0;
    return terms.map((t, i) => {
      const amt = i === terms.length - 1 ? supply - allocated : termAmount(t.ratio);
      allocated += amt;
      const prev: any = existing[i] || {};
      return { label: t.label, ratio: t.ratio, amount: amt, condition: t.condition, ...(termDates[i] ? { dueDate: termDates[i] } : {}), ...(prev.invoiceId ? { invoiceId: prev.invoiceId } : {}) };
    });
  };

  //   지금 화면 그대로의 저장본 — 저장과 미리보기가 **같은 내용**을 쓴다(보이는 것과 인쇄물이 같게)
  const buildContent = (schedule = buildSchedule()) => {
    const withSchedule = kind === "contract" || existing.length > 0 || payMode !== "full";
    const termsText = schedule.map((s) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", ");
    return {
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
  };

  // ── 저장 — 문서함과 **같은 saveRevision** 을 쓴다(이력도 똑같이 남는다) ──
  const save = async (silent = false) => {
    if (!userId) return false;
    const schedule = buildSchedule();
    const next = buildContent(schedule);
    //   아직 없는 문서면 이때 만든다 — '만들기' 는 편집기를 열 뿐이고 저장이 실제 생성이다
    if (!doc?.id) {
      if (!onCreate) return false;
      const ok = await onCreate(next, docName.trim() || undefined);
      if (!ok) return false;
      setDirty(false);
    } else {
      await saveRevision({ documentId: doc.id, authorId: userId, contentJson: next as any });
      //   문서명은 본문이 아니라 documents.name — 바뀐 때만 따로 고친다
      const nm = docName.trim();
      if (nm && nm !== doc.name) await db.from("documents").update({ name: nm }).eq("id", doc.id);
      setDirty(false);
      refreshDoc();
    }
    //   ① 표 행 금액은 문서를 따라간다 (계약 > 견적 — 계약이 있으면 견적을 고쳐도 안 건드린다)
    //      ↓ 아래 두 가지는 **처음 만들 때도 똑같이** 걸린다(초안 생성에서 빠지면 반쪽이 된다)
    if (supply > 0 && (kind === "contract" || !hasContract)) onAmountChange?.(supply);
    //   ② 아직 안 보낸 견적이면 같이 맞출지 묻는다. 보낸 견적은 여기서 절대 안 건드린다.
    if (!silent && diff && quoteDoc?.id && quoteSent === false) {
      const no = quoteDoc.document_number ? `견적 ${quoteDoc.document_number}` : "견적서";
      if (window.confirm(`${no} 도 이 계약 내용으로 맞출까요?\n아직 거래처에 보내지 않은 견적입니다.`)) {
        await syncQuote(schedule);
      }
    }
    if (!silent) toast("저장했습니다.", "success");
    return true;
  };

  //   견적서를 계약 내용으로 맞춘다 — **미발송 견적에만** 쓴다
  const syncQuote = async (schedule?: any[]) => {
    if (!quoteDoc?.id || !userId) return;
    const base = (quoteDoc.content_json as any) || {};
    const sched = schedule || buildSchedule();
    await saveRevision({
      documentId: quoteDoc.id, authorId: userId,
      contentJson: {
        ...base, items,
        header: { ...(base.header || {}), partnerId, partnerName, taxType },
        paymentSchedule: sched,
        paymentTerms: sched.map((s: any) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", "),
      } as any,
    });
    qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
    toast("견적서도 계약 내용으로 맞췄습니다.", "success");
  };

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (e: any) { toast(e?.message || "처리 실패", "error"); }
    finally { setBusy(false); }
  };

  // ── 미리보기 — 실제 인쇄될 PDF 를 그대로 띄운다. 저장 전 초안도 된다(화면 내용으로 만든다) ──
  //   회사에 올린 양식(PDF·텍스트변환)이 있으면 그 양식으로, 없으면 기본 서식으로 나온다.
  const previewName = docName.trim() || rowName || DOC_LABEL[kind];
  const openPreview = () => guard(async () => {
    setShowPreview(true);
    setPreviewLoading(true);
    setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setPreviewBlob(null);
    try {
      const synthetic = { ...(doc || {}), name: previewName, document_number: doc?.document_number || null, content_json: buildContent() };
      const blob = kind === "contract"
        ? await buildContractBlobFromDoc(synthetic, companyId, userId)
        : await buildQuoteBlobFromDoc(synthetic, companyId, userId);
      setPreviewBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
    } finally {
      setPreviewLoading(false);
    }
  });
  const closePreview = () => {
    setShowPreview(false);
    setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setPreviewBlob(null);
  };
  //   팝업이 닫힐 때 만들어 둔 blob URL 을 반드시 놓아 준다(안 놓으면 메모리에 남는다)
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const printPreview = () => {
    const f = document.getElementById("pb-doc-preview-iframe") as HTMLIFrameElement | null;
    f?.contentWindow?.focus();
    f?.contentWindow?.print();
  };
  const downloadPreview = () => {
    if (!previewBlob) return;
    const a = document.createElement("a");
    const u = URL.createObjectURL(previewBlob);
    a.href = u;
    a.download = `${previewName.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  //   이미 보낸 견적은 고치지 않고 **개정본을 새로 만든다** — 거래처가 받은 문서는 그대로 남는다
  const makeRevisedQuote = () => guard(async () => {
    if (!quoteDoc?.id || !userId) return;
    if (dirty) await save(true);
    const base = (quoteDoc.content_json as any) || {};
    const sched = buildSchedule();
    const created = await insertDocument({
      companyId, dealId, userId,
      name: `${quoteDoc.name || `${rowName || "프로젝트"} 견적서`} (개정)`,
      contentType: "invoice",
      contentJson: {
        ...base, items, notes, validUntil,
        header: { ...(base.header || {}), partnerId, partnerName, taxType },
        paymentSchedule: sched,
        paymentTerms: sched.map((s) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", "),
      },
      sourceDocumentId: quoteDoc.id,
    });
    //   이 계약의 근거를 개정 견적으로 옮긴다(원본 견적은 개정본의 source 로 계속 이어진다)
    if (doc?.id) await db.from("documents").update({ source_document_id: created.id }).eq("id", doc.id);
    onQuoteReplaced?.({ id: created.id, no: created.document_number || "견적서" });
    qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
    setShowDiff(false);
    toast("개정 견적서를 만들었습니다. 견적 칸에서 열어 거래처에 다시 보내세요.", "success");
  });

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

  // ── 견적서 → 계약서로 내용 당겨오기 (2026-08-10 사장님 지시) ──
  //   만들 때 자동으로 물려받지만, 견적을 나중에 고친 경우가 있어 언제든 다시 부를 수 있게 한다.
  const loadFromQuote = () => {
    const qi = quoteItems.filter(isFilled);
    if (qi.length === 0) { toast("견적서에 품목이 없습니다. 견적서를 먼저 작성하세요.", "error"); return; }
    const hasRows = items.some(isFilled);
    if (hasRows && !window.confirm("지금 계약 내역을 견적서 품목으로 바꿉니다. 계속할까요?")) return;
    const qh = (quoteCj.header as any) || {};
    const tt: TaxType = qh.taxType === "exempt" || qh.taxType === "zero" ? qh.taxType : "taxable";
    setTaxType(tt);
    setItems(qi.map((r: any) => recalc(r, rateOf(tt))));
    if (quoteTerms.length >= 3) { setPayMode("three"); setAdv(Number(quoteTerms[0]?.ratio) || 30); setMid(Number(quoteTerms[1]?.ratio) || 40); }
    else if (quoteTerms.length === 2) { setPayMode("two"); setAdv(Number(quoteTerms[0]?.ratio) || 30); }
    setDirty(true);
    setShowDiff(false);
    toast("견적서 내용을 불러왔습니다. 필요하면 고친 뒤 저장하세요.", "success");
  };

  // 계산서는 **발행 대기(초안)** 로만 만든다 — 국세청 발행은 세금계산서 화면에서 사람이 누른다.
  //   계약의 회차·품목명·과세유형·사업자번호를 그대로 잇는다(2026-08-10).
  const makeInvoice = () => guard(async () => {
    if (!partnerName) throw new Error("거래처를 먼저 지정하세요");
    if (issueSupply <= 0) throw new Error("금액을 먼저 입력하세요");
    if (alreadyIssued) throw new Error(`'${invLabel(issueTerm)}' 는 이미 만들었습니다`);
    await createTaxInvoice({
      companyId, dealId, type: "sales",
      counterpartyName: partnerName, partnerId: partnerId || undefined,
      counterpartyBizno: partnerBizno || undefined,
      supplyAmount: issueSupply, issueDate, label: invLabel(issueTerm), status: "draft",
      itemName: itemName || undefined, taxKind: TAX_KIND[taxType],
    });
    invalidateTaxInvoiceReaders(qc);   //   (2026-08-31) /tax-invoices 메인 목록 포함 파생 화면 일괄
    qc.invalidateQueries({ queryKey: ["pb-doc-invoices", dealId] });
    toast(`${invLabel(issueTerm)} ${won(issueSupply)}원을 발행 대기로 만들었습니다. 세금계산서 화면에서 발행하세요.`, "success");
    onIssued();
    onClose();
  });

  const status = doc?.status || "draft";
  const canEdit = status === "draft" || status === "review";
  const lastSend = sends[0];
  //   편집기에서 서식(HTML 본문)으로 작성한 계약서는 조항 편집을 숨긴다 — 여기서 고치면 서식이 깨진다
  const richBody = kind === "contract" && !!cj.body;

  useModalKeys(true,
    showPreview ? closePreview : showDiff ? () => setShowDiff(false) : onClose,
    busy ? undefined : showPreview ? printPreview : showDiff ? undefined : kind === "issue" ? makeInvoice : () => save());

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
          {/* 견적과 달라졌다 — 어디가 다른지 보고, 견적을 어떻게 할지 여기서 정한다 */}
          {diff && (
            <button type="button" className="pb-doc-warn" onClick={() => setShowDiff(true)}>
              <b>견적과 다름</b>
              <span>
                {diff.amountDiff !== 0 && `금액 ${diff.amountDiff > 0 ? "+" : "−"}${won(Math.abs(diff.amountDiff))}원`}
                {diff.amountDiff !== 0 && (diff.itemsDiff || diff.termsDiff) && " · "}
                {diff.itemsDiff && "품목"}
                {diff.itemsDiff && diff.termsDiff && " · "}
                {diff.termsDiff && "결제조건"}
              </span>
              <em>비교 보기 →</em>
            </button>
          )}

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
            <div><dt>공급가</dt><dd className="pb-doc-num">{won(kind === "issue" ? issueSupply : supply)}원</dd></div>
            <div><dt>합계</dt><dd className="pb-doc-num pb-doc-total">
              {won(kind === "issue" ? issueSupply + issueVat : supply + vat)}원{" "}
              <em>(부가세 {won(kind === "issue" ? issueVat : vat)})</em></dd></div>
          </dl>

          {/* 발행 — 계약서의 품목·과세유형·회차를 그대로 잇는다 */}
          {kind === "issue" && (
            <section className="pb-doc-terms">
              <b>계약에서 가져온 내용</b>
              <dl className="pb-doc-facts">
                <div><dt>품목</dt><dd>{itemName || <em>계약에 품목이 없습니다</em>}</dd></div>
                <div><dt>과세유형</dt><dd>{TAX_LABEL.find(([v]) => v === taxType)?.[1]}</dd></div>
                <div><dt>사업자번호</dt><dd>{partnerBizno || <em>거래처에 없음</em>}</dd></div>
                <div><dt>계약 금액</dt><dd className="pb-doc-num">{won(supply)}원</dd></div>
              </dl>
              {issueTerms.length > 0 ? (<>
                <b>어느 회차를 발행할까요</b>
                <div className="pb-doc-picks">
                  {issueTerms.map((t) => {
                    const made = issuedOf(t.label);
                    return (
                      <button key={t.label} type="button" aria-pressed={issueTerm === t.label}
                        className={`pb-doc-pick ${issueTerm === t.label ? "pb-doc-pick-on" : ""} ${made ? "pb-doc-pick-done" : ""}`}
                        onClick={() => setIssueTerm(t.label)}
                        title={made ? "이미 만든 회차입니다" : t.condition || undefined}>
                        <span>{t.label}{t.ratio ? ` ${t.ratio}%` : ""}</span>
                        <b className="pb-doc-num">{won(t.amount)}원</b>
                        {made && <i>만듦</i>}
                      </button>
                    );
                  })}
                </div>
              </>) : (
                <p className="pb-doc-hint">계약서에 결제 회차가 없어 <b>전액</b>으로 만듭니다. 회차로 나누려면 계약서에서 결제조건을 먼저 정하세요.</p>
              )}
              <p className="pb-doc-hint">
                <b>발행 대기</b>로만 만듭니다. 국세청 실제 발행은 세금계산서 화면에서 확인하고 누르세요.
              </p>
            </section>
          )}

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
                {terms.map((t, i) => (
                  <li key={t.label}>
                    <span>{t.label} <em>{t.ratio}%</em></span>
                    <b className="pb-doc-num">{won(termAmount(t.ratio))}원</b>
                    <i>{t.condition || "협의"}</i>
                    {kind === "contract" && (
                      <input type="date" className="pb-doc-due" value={termDates[i] || ""} title="예정일 — 적어 두면 그날 새벽 발행 대기가 자동으로 생깁니다(승인만 누르면 발행)"
                        onChange={(e) => { const v = e.target.value; setTermDates((d) => { const n = [...d]; n[i] = v; return n; }); setDirty(true); }} />
                    )}
                  </li>
                ))}
              </ul>
              {kind === "contract" && <p className="pb-doc-hint">회차 옆 <b>예정일</b>을 적으면 그날 아침 <b>발행 대기</b>(초안)가 저절로 생기고 알림이 옵니다 — 세금·증빙에서 승인(발행)만 누르면 됩니다. 비우면 ‘＋ 발행’으로 직접 만듭니다.</p>}
              {kind === "contract" && (
                <p className="pb-doc-hint">저장하면 표 위에서 이 회차대로 <b>청구 줄을 만들 수 있습니다</b>. ‘＋ 발행’ 은 이 회차를 그대로 씁니다.</p>
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
            <p className="pb-doc-hint">이 계약서는 편집기에서 <b>서식(레이아웃)</b>으로 작성돼 있습니다. 본문은 아래 ‘편집기’ 에서 고치세요.</p>
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
        </div>

        <footer className="pb-doc-foot">
          {doc?.id && <Link href={`/documents?id=${doc.id}`} className="pb-doc-link" title="PDF · 서명 이력 · 버전 비교">편집기 ↗</Link>}
          {kind === "issue" && <Link href="/tax-invoices" className="pb-doc-link">세금계산서 화면 ↗</Link>}
          <span className="pb-doc-spacer" />
          {kind !== "issue" && (<>
            <button type="button" className="pb-doc-sub" disabled={busy || !canEdit} onClick={() => save()}>저장</button>
            <button type="button" className="pb-doc-sub" disabled={busy} onClick={openPreview}
              title="실제 인쇄될 PDF 를 그대로 봅니다 — 저장 전에도 됩니다">미리보기</button>
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
            <button type="button" className="pb-doc-go" disabled={busy || !!alreadyIssued} onClick={makeInvoice}
              title={alreadyIssued ? "이미 만든 회차입니다" : undefined}>
              {busy ? "만드는 중…" : alreadyIssued ? "이미 만든 회차" : "발행 대기로 만들기"}
            </button>
          )}
        </footer>
      </div>

      {/* 미리보기 — 실제 인쇄될 PDF. 문서함 미리보기와 같은 껍데기를 쓴다(화면이 달라 보이지 않게).
          body 포털이라 이 팝업 위(z-100)에 뜬다.
          ⚠️ 포털이라도 React 이벤트는 부모(팝업)로 올라간다 — 배경 클릭을 안 막으면 문서 팝업까지 닫힌다 */}
      {showPreview && typeof document !== "undefined" && createPortal(
        <div className="quote-preview-modal" onClick={(e) => { e.stopPropagation(); closePreview(); }}>
          <div className="quote-preview-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--text)]">
                {previewName} <span className="text-xs font-normal text-[var(--text-dim)]">미리보기{dirty ? " · 저장 안 된 내용 그대로" : ""}</span>
              </h2>
              <button type="button" onClick={closePreview} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
            </div>
            <div className="quote-preview-body">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{DOC_LABEL[kind]} 만드는 중…</div>
              ) : previewUrl ? (
                <iframe id="pb-doc-preview-iframe" src={previewUrl} title={`${DOC_LABEL[kind]} 미리보기`} className="w-full h-full border-0" />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">미리보기를 불러오지 못했습니다.</div>
              )}
            </div>
            <div className="quote-preview-footer">
              <button type="button" onClick={closePreview}
                className="px-4 py-2 text-sm text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-surface)]">닫기</button>
              <button type="button" disabled={!previewBlob} onClick={downloadPreview}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-surface)] disabled:opacity-50">PDF 저장</button>
              <button type="button" disabled={!previewUrl} onClick={printPreview} className="btn-primary">인쇄</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 견적 ↔ 계약 비교 — 어디가 달라졌는지 보고, 견적을 어떻게 할지 정한다 */}
      {showDiff && diff && (
        <div className="pb-doc-diff" onClick={(e) => { e.stopPropagation(); setShowDiff(false); }}>
          <div className="pb-doc-diff-box" onClick={(e) => e.stopPropagation()}>
            <header className="pb-doc-head">
              <div>
                <b>견적 ↔ 계약 비교</b>
                <span>{quoteDoc?.document_number ? `견적 ${quoteDoc.document_number}` : "견적서"} · {rowName || "청구 건"}</span>
              </div>
              <button type="button" onClick={() => setShowDiff(false)} title="닫기">✕</button>
            </header>
            <div className="pb-doc-diff-body">
              <div className="pb-doc-diff-grid">
                <span />
                <b>견적서</b>
                <b>계약서 (지금)</b>

                <span>공급가</span>
                <em className="pb-doc-num">{won(quoteSupply)}원</em>
                <em className={`pb-doc-num ${diff.amountDiff ? "pb-doc-diff-hit" : ""}`}>{won(supply)}원</em>

                <span>품목</span>
                <em>{quoteItems.filter(isFilled).length}건</em>
                <em className={diff.itemsDiff ? "pb-doc-diff-hit" : ""}>{items.filter(isFilled).length}건</em>

                <span>결제조건</span>
                <em>{quoteTerms.length ? quoteTerms.map((t: any) => `${t.label} ${t.ratio}%`).join(" · ") : "전액"}</em>
                <em className={diff.termsDiff ? "pb-doc-diff-hit" : ""}>{terms.map((t) => `${t.label} ${t.ratio}%`).join(" · ")}</em>
              </div>

              {diff.itemsDiff && (
                <div className="pb-doc-diff-items">
                  <div>
                    <b>견적 품목</b>
                    {quoteItems.filter(isFilled).map((r: any, i: number) => (
                      <p key={i}>{r.name || "(이름 없음)"} <span>{Number(r.quantity) || 0} × {won(Number(r.unitPrice) || 0)}</span></p>
                    ))}
                    {quoteItems.filter(isFilled).length === 0 && <p><span>품목 없음</span></p>}
                  </div>
                  <div>
                    <b>계약 내역</b>
                    {items.filter(isFilled).map((r: any, i: number) => (
                      <p key={i}>{r.name || "(이름 없음)"} <span>{Number(r.quantity) || 0} × {won(Number(r.unitPrice) || 0)}</span></p>
                    ))}
                    {items.filter(isFilled).length === 0 && <p><span>품목 없음</span></p>}
                  </div>
                </div>
              )}

              <p className="pb-doc-hint">
                {quoteSent
                  ? <>이 견적서는 <b>이미 거래처에 보냈습니다</b>. 보낸 문서를 사후에 바꾸면 거래처가 가진 견적서와 기록이 달라져요 — 대신 <b>개정 견적서</b>를 새로 만들어 다시 보내세요. 원본 견적은 그대로 남습니다.</>
                  : <>이 견적서는 <b>아직 보내지 않았습니다</b>. 계약 내용으로 맞춰도 안전합니다.</>}
              </p>
            </div>
            <footer className="pb-doc-foot">
              <button type="button" className="pb-doc-sub" onClick={loadFromQuote} disabled={busy || !canEdit}
                title="계약 내역을 견적서 내용으로 되돌립니다">계약을 견적대로 되돌리기</button>
              <span className="pb-doc-spacer" />
              {quoteSent
                ? <button type="button" className="pb-doc-go" disabled={busy} onClick={makeRevisedQuote}>
                    {busy ? "만드는 중…" : "개정 견적서 만들기"}
                  </button>
                : <button type="button" className="pb-doc-go" disabled={busy || !doc?.id}
                    title={doc?.id ? undefined : "계약서를 먼저 저장하세요"}
                    onClick={() => guard(async () => { await syncQuote(); setShowDiff(false); })}>
                    {busy ? "맞추는 중…" : "견적서도 이 내용으로 맞추기"}
                  </button>}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

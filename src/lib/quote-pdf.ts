// 저장된 견적 문서(content_json)로 실제 견적서 PDF Blob 생성 — projecthub 미리보기/인쇄 공용.
//   documents 편집기 인라인 생성과 동일 로직(데이터 출처만 cj 고정: 저장본 기준).
//   활성 견적 양식 있으면 오버레이, 없으면 generateQuotePDF 폴백.

import { supabase } from "@/lib/supabase";
import { generateQuotePDF } from "@/lib/document-generator";
import { getActiveTemplate, downloadTemplateFile, buildQuoteValues, fillTextTemplate, wrapTemplatePrintHtml } from "@/lib/form-templates";
import { fillFormTemplate } from "@/lib/pdf-overlay";

const db = supabase as any;

export async function buildQuoteBlobFromDoc(doc: any, companyId: string, userId?: string | null): Promise<Blob> {
  const company = await db.from("companies").select("*").eq("id", companyId).maybeSingle();
  const companyName = company.data?.name || "";
  const cj = doc?.content_json || {};

  const rawItems: any[] = Array.isArray(cj.items) ? cj.items : [];
  const items = rawItems.map((it: any) => ({
    name: it.name || "",
    spec: it.note || it.spec || "",
    qty: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice) || 0,
    amount: Number(it.supplyAmount) || (Number(it.quantity || 1) * Number(it.unitPrice || 0)),
  }));
  const supplyAmt = items.reduce((s, i) => s + i.amount, 0);
  const taxAmt = Math.round(supplyAmt * 0.1);

  const { data: bankAcct } = await db.from("bank_accounts").select("bank_name, account_number, alias").eq("company_id", companyId).eq("is_primary", true).limit(1).maybeSingle();
  const { data: currentUser } = userId ? await db.from("users").select("name, email").eq("id", userId).maybeSingle() : { data: null };

  const mgrName = cj.header?.manager || "";
  let mgrEmail = "";
  if (mgrName) {
    const { data: mgrRow } = await db.from("users").select("email").eq("company_id", companyId).eq("name", mgrName).limit(1).maybeSingle();
    mgrEmail = mgrRow?.email || "";
  }

  const cpName = cj.counterpartyName || cj.partnerName || cj.header?.partnerName || "";
  const cpId = cj.header?.partnerId || null;
  let partnerRow: any = null;
  const pcols = "name, representative, contact_name, contact_phone, contact_email, address, business_number";
  if (cpId) partnerRow = (await db.from("partners").select(pcols).eq("id", cpId).maybeSingle()).data;
  else if (cpName) partnerRow = (await db.from("partners").select(pcols).eq("company_id", companyId).eq("name", cpName).limit(1).maybeSingle()).data;

  // 활성 견적 양식 — 텍스트변환 양식이면 content_html 에 값 치환 → HTML→PDF (직원 QA)
  const quoteTpl = await getActiveTemplate(companyId, "quote").catch(() => null);
  if (quoteTpl && quoteTpl.template_mode === "text" && quoteTpl.content_html) {
    const values: Record<string, string> = {
      거래처명: cpName,
      사업자번호: partnerRow?.business_number || "",
      대표자: partnerRow?.representative || "",
      작성일자: new Date().toISOString().slice(0, 10),
      품목: items.map((i) => i.name).filter(Boolean).join(", "),
      수량: items.map((i) => String(i.qty)).join(", "),
      단가: items.map((i) => i.unitPrice.toLocaleString("ko-KR")).join(", "),
      공급가액: supplyAmt.toLocaleString("ko-KR"),
      세액: taxAmt.toLocaleString("ko-KR"),
      합계금액: (supplyAmt + taxAmt).toLocaleString("ko-KR"),
    };
    const filledHtml = wrapTemplatePrintHtml(fillTextTemplate(quoteTpl.content_html, values));
    try {
      const res = await fetch("/api/html-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: filledHtml }) });
      if (res.ok) return await res.blob();
    } catch { /* 실패 시 아래 폴백으로 진행 */ }
  }
  if (quoteTpl) {
    const bytes = await downloadTemplateFile(quoteTpl.file_path);
    const filled = await fillFormTemplate(bytes, quoteTpl.fields, {
      values: buildQuoteValues({
        myCompanyName: companyName,
        myRepresentative: company.data?.representative,
        partnerName: cpName,
        partnerRepresentative: partnerRow?.representative,
        projectName: doc?.name,
        quoteNumber: doc?.document_number,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil: cj.header?.validUntil,
        supplyAmount: supplyAmt,
        taxAmount: taxAmt,
        totalAmount: supplyAmt + taxAmt,
        notes: cj.notes,
      }),
      items: items.map((it) => ({ name: it.name, quantity: it.qty, unitPrice: it.unitPrice, amount: it.amount })),
    });
    return new Blob([filled as BlobPart], { type: "application/pdf" });
  }

  return generateQuotePDF({
    documentNumber: doc?.document_number || "-",
    companyInfo: {
      name: companyName,
      representative: company.data?.representative,
      address: company.data?.address,
      phone: company.data?.phone,
      businessNumber: company.data?.business_number,
    },
    counterparty: cpName || "-",
    items,
    supplyAmount: supplyAmt,
    taxAmount: taxAmt,
    totalAmount: supplyAmt + taxAmt,
    validUntil: cj.header?.validUntil || cj.validUntil || "견적일로부터 30일",
    notes: cj.notes || "",
    sealUrl: doc?.seal_applied ? company.data?.seal_url : undefined,
    managerName: mgrName || currentUser?.name || undefined,
    managerContact: mgrName ? (mgrEmail || undefined) : (currentUser?.email || undefined),
    paymentTerms: cj.header?.paymentTerms || undefined,
    deliveryTerms: cj.header?.deliveryTerms || undefined,
    bankInfo: bankAcct ? { bankName: bankAcct.bank_name, accountNumber: bankAcct.account_number, accountHolder: bankAcct.alias || companyName } : undefined,
    deliveryDate: cj.deliveryDate || undefined,
    title: doc?.name || undefined,
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

import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
// 저장된 견적 문서(content_json)로 실제 견적서 PDF Blob 생성 — projecthub 미리보기/인쇄 공용.
//   documents 편집기 인라인 생성과 동일 로직(데이터 출처만 cj 고정: 저장본 기준).
//   활성 견적 양식 있으면 오버레이, 없으면 generateQuotePDF 폴백.

import { supabase } from "@/lib/supabase";
import { generateQuotePDF, generateDocumentPDF } from "@/lib/document-generator";
import { getActiveTemplate, downloadTemplateFile, buildQuoteValues, fillTextTemplate, wrapTemplatePrintHtml } from "@/lib/form-templates";
import { fillFormTemplate } from "@/lib/pdf-overlay";

const db = supabase;

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

  const bankAcct = logRead('lib/quote-pdf:bankAcct', await db.from("bank_accounts").select("bank_name, account_number, alias").eq("company_id", companyId).eq("is_primary", true).limit(1).maybeSingle());
  const { data: currentUser } = userId ? await db.from("users").select("name, email").eq("id", userId).maybeSingle() : { data: null };

  const mgrName = cj.header?.manager || "";
  let mgrEmail = "";
  if (mgrName) {
    const mgrRow = logRead('lib/quote-pdf:mgrRow', await db.from("users").select("email").eq("company_id", companyId).eq("name", mgrName).limit(1).maybeSingle());
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
      작성일자: todayKst(),
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
        issueDate: todayKst(),
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
      representative: company.data?.representative ?? undefined,
      address: company.data?.address ?? undefined,
      phone: company.data?.phone ?? undefined,
      businessNumber: company.data?.business_number ?? undefined,
    },
    counterparty: cpName || "-",
    items,
    supplyAmount: supplyAmt,
    taxAmount: taxAmt,
    totalAmount: supplyAmt + taxAmt,
    validUntil: cj.header?.validUntil || cj.validUntil || "견적일로부터 30일",
    notes: cj.notes || "",
    sealUrl: doc?.seal_applied ? company.data?.seal_url ?? undefined : undefined,
    managerName: mgrName || currentUser?.name || undefined,
    managerContact: mgrName ? (mgrEmail || undefined) : (currentUser?.email || undefined),
    paymentTerms: cj.header?.paymentTerms || undefined,
    deliveryTerms: cj.header?.deliveryTerms || undefined,
    bankInfo: bankAcct ? { bankName: bankAcct.bank_name, accountNumber: bankAcct.account_number, accountHolder: bankAcct.alias || companyName } : undefined,
    deliveryDate: cj.deliveryDate || undefined,
    title: doc?.name || undefined,
    // companies 에 website/homepage/site_url 컬럼이 전부 없어 항상 undefined 였음 — 동작 보존
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

// ── 계약서 PDF (2026-08-10) ──
//   매출흐름 계약서 팝업의 '미리보기 → 인쇄 · PDF 저장' 이 쓴다. 견적서와 같은 순서로 고른다:
//   회사 활성 계약 양식(텍스트변환 → 오버레이) → 없으면 표준 본문을 그대로 PDF 로.
//   본문의 {{회사명}}·{{계약금액}} 같은 자리표시는 실제 값으로 채우고, 값이 없으면 [항목] 로 남긴다
//   (어디를 더 채워야 하는지 종이에서도 보이게).
const stripHtml = (s: string) => String(s || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, "\n\n").trim();

export async function buildContractBlobFromDoc(doc: any, companyId: string, _userId?: string | null): Promise<Blob> {
  const company = await db.from("companies").select("*").eq("id", companyId).maybeSingle();
  const companyName = company.data?.name || "";
  const cj = doc?.content_json || {};

  const rawItems: any[] = Array.isArray(cj.items) ? cj.items : [];
  const items = rawItems
    .filter((it: any) => it && (it.name || it.quantity || it.unitPrice))
    .map((it: any) => ({
      name: it.name || "",
      qty: Number(it.quantity) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      amount: Number(it.supplyAmount) || (Number(it.quantity || 1) * Number(it.unitPrice || 0)),
      tax: Number(it.taxAmount) || 0,
    }));
  const supplyAmt = items.reduce((s, i) => s + i.amount, 0);
  const taxAmt = items.reduce((s, i) => s + i.tax, 0);
  const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

  const cpName = cj.header?.partnerName || cj.counterpartyName || cj.partnerName || "";
  const cpId = cj.header?.partnerId || null;
  let partnerRow: any = null;
  const pcols = "name, representative, contact_name, contact_phone, contact_email, address, business_number";
  if (cpId) partnerRow = (await db.from("partners").select(pcols).eq("id", cpId).maybeSingle()).data;
  else if (cpName) partnerRow = (await db.from("partners").select(pcols).eq("company_id", companyId).eq("name", cpName).limit(1).maybeSingle()).data;

  const schedule: any[] = Array.isArray(cj.paymentSchedule) ? cj.paymentSchedule : [];
  const workText = items.length > 0
    ? (items.length > 1 ? `${items[0].name} 외 ${items.length - 1}건` : items[0].name)
    : "";

  const vars: Record<string, string> = {
    회사명: companyName,
    공급자: companyName,
    대표자명: company.data?.representative || "",
    거래처명: cpName,
    수신: cpName,
    거래처대표: partnerRow?.representative || "",
    계약금액: supplyAmt ? won(supplyAmt) : "",
    계약일: cj.issueDate || "",
    계약시작일: cj.contractStart || "",
    계약종료일: cj.contractEnd || "",
    용역내용: workText,
    업무범위: workText,
    결제조건: cj.paymentTerms || cj.header?.paymentTerms || "",
  };
  const fill = (t: string) => String(t || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => {
    const key = String(k).trim();
    return vars[key] && vars[key].length ? vars[key] : `[${key}]`;
  });

  // 활성 계약 양식 — 텍스트변환 양식이면 content_html 에 값 치환 → HTML→PDF
  const tpl = await getActiveTemplate(companyId, "contract").catch(() => null);
  if (tpl && tpl.template_mode === "text" && tpl.content_html) {
    const values: Record<string, string> = {
      ...vars,
      사업자번호: partnerRow?.business_number || "",
      작성일자: cj.issueDate || todayKst(),
      공급가액: won(supplyAmt),
      세액: won(taxAmt),
      합계금액: won(supplyAmt + taxAmt),
      품목: items.map((i) => i.name).filter(Boolean).join(", "),
      수량: items.map((i) => String(i.qty)).join(", "),
      단가: items.map((i) => won(i.unitPrice)).join(", "),
    };
    const filledHtml = wrapTemplatePrintHtml(fillTextTemplate(tpl.content_html, values));
    try {
      const res = await fetch("/api/html-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: filledHtml }) });
      if (res.ok) return await res.blob();
    } catch { /* 실패 시 아래 폴백으로 진행 */ }
  }
  if (tpl) {
    const bytes = await downloadTemplateFile(tpl.file_path);
    const filled = await fillFormTemplate(bytes, tpl.fields, {
      values: buildQuoteValues({
        myCompanyName: companyName,
        myRepresentative: company.data?.representative,
        partnerName: cpName,
        partnerRepresentative: partnerRow?.representative,
        projectName: doc?.name,
        issueDate: cj.issueDate || todayKst(),
        supplyAmount: supplyAmt,
        taxAmount: taxAmt,
        totalAmount: supplyAmt + taxAmt,
        notes: cj.notes,
      }),
      items: items.map((it) => ({ name: it.name, quantity: it.qty, unitPrice: it.unitPrice, amount: it.amount })),
    });
    return new Blob([filled as BlobPart], { type: "application/pdf" });
  }

  // 폴백 — 조항 본문(sections) 또는 편집기 서식(body) + 계약 내역·결제 조건 요약
  const bodyText = Array.isArray(cj.sections) && cj.sections.length > 0
    ? cj.sections.map((s: any) => `${s?.title || ""}\n${s?.content || ""}`).join("\n\n")
    : stripHtml(cj.body || "");
  const blocks: string[] = [];
  const head = [
    cpName ? `갑 (발주자): ${cpName}${partnerRow?.representative ? ` (대표: ${partnerRow.representative})` : ""}` : "",
    companyName ? `을 (수급자): ${companyName}${company.data?.representative ? ` (대표: ${company.data.representative})` : ""}` : "",
    cj.contractStart || cj.contractEnd ? `계약 기간: ${cj.contractStart || "[시작일]"} ~ ${cj.contractEnd || "[종료일]"}` : "",
  ].filter(Boolean).join("\n");
  if (head) blocks.push(head);
  if (bodyText) blocks.push(fill(bodyText));
  if (items.length > 0) {
    blocks.push([
      "■ 계약 내역",
      ...items.map((i) => `· ${i.name || "품목"}   ${i.qty} × ${won(i.unitPrice)}원 = ${won(i.amount)}원`),
      `합계: 공급가 ${won(supplyAmt)}원 · 부가세 ${won(taxAmt)}원 · 총액 ${won(supplyAmt + taxAmt)}원`,
    ].join("\n"));
  }
  if (schedule.length > 0) {
    blocks.push([
      "■ 결제 조건",
      ...schedule.map((t: any) => `· ${t.label} ${t.ratio ? `${t.ratio}% ` : ""}${won(Number(t.amount) || 0)}원${t.condition ? ` — ${t.condition}` : ""}`),
    ].join("\n"));
  }

  return generateDocumentPDF({
    title: doc?.name || "계약서",
    content: blocks.join("\n\n"),
    companyName,
    companyInfo: company.data ? {
      representative: company.data.representative ?? undefined,
      address: company.data.address ?? undefined,
      businessNumber: company.data.business_number ?? undefined,
    } : undefined,
    documentNumber: doc?.document_number || undefined,
  });
}

// 핸드오프 → 적용 경로: src/lib/form-templates.ts  (2026-06-29, P2)
//
// pdf_form_templates CRUD + storage(form-templates) 업로드 + pdfjs 래스터화 + parse-form-template edge 호출.
// 패턴: contract-templates.ts(supabase as any), rich-editor.tsx(pdfjs dynamic import) 재사용.

import { supabase } from "@/lib/supabase";
import type { OverlayField } from "@/lib/pdf-overlay";
export type { OverlayField } from "@/lib/pdf-overlay"; // 에디터 등 form-templates 경유 import 호환

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DocType = "quote" | "contract";

export interface PdfFormTemplate {
  id: string;
  company_id: string;
  name: string;
  doc_type: DocType;
  file_path: string;
  page_count: number;
  page_sizes: { w: number; h: number }[];
  fields: OverlayField[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const BUCKET = "form-templates";

// ──────────────────────────────────────────
// 1. 업로드 + 래스터화 + 인식
// ──────────────────────────────────────────

/** PDF File 을 pdfjs 로 페이지별 PNG(base64, data 부분만) + page_sizes(pt) 로 변환. */
export async function rasterizePdf(
  file: File,
  scale = 2
): Promise<{ pages: string[]; pageSizes: { w: number; h: number }[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  const pageSizes: { w: number; h: number }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 }); // pt 단위 크기
    pageSizes.push({ w: baseViewport.width, h: baseViewport.height });

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context 없음");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    pages.push(dataUrl.split(",")[1]); // base64 본문만
  }
  return { pages, pageSizes };
}

/** parse-form-template edge 호출 → 자동 인식 필드(초안). 실패해도 빈 배열로(매핑은 사람이 보정). */
export async function detectFields(
  docType: DocType,
  pages: string[]
): Promise<OverlayField[]> {
  const { data, error } = await db.functions.invoke("parse-form-template", {
    body: { doc_type: docType, pages },
  });
  if (error) {
    console.warn("parse-form-template 실패 — 빈 양식으로 시작:", error);
    return [];
  }
  // edge 는 page/x/y/w/h/key/label/kind 반환. align/font_size 기본값 부여.
  return ((data?.fields as OverlayField[]) || []).map((f) => ({
    ...f,
    align: f.align ?? "left",
    font_size: f.font_size ?? 10,
  }));
}

/** 원본 PDF 를 storage 에 업로드. 경로 = {company_id}/{uuid}.pdf (RLS: 첫 세그먼트=company_id). */
export async function uploadTemplateFile(
  companyId: string,
  file: File
): Promise<string> {
  const path = `${companyId}/${crypto.randomUUID()}.pdf`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** storage 에서 원본 PDF bytes 다운로드 (오버레이 생성 시). */
export async function downloadTemplateFile(filePath: string): Promise<ArrayBuffer> {
  const { data, error } = await db.storage.from(BUCKET).download(filePath);
  if (error) throw error;
  return await (data as Blob).arrayBuffer();
}

// ──────────────────────────────────────────
// 2. CRUD
// ──────────────────────────────────────────

export async function listFormTemplates(docType?: DocType): Promise<PdfFormTemplate[]> {
  let q = db
    .from("pdf_form_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (docType) q = q.eq("doc_type", docType);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as PdfFormTemplate[];
}

/** 회사·doc_type 당 활성 1개 — 견적/계약 생성 시 폴백 판정에 사용. */
export async function getActiveTemplate(
  companyId: string,
  docType: DocType
): Promise<PdfFormTemplate | null> {
  const { data, error } = await db
    .from("pdf_form_templates")
    .select("*")
    .eq("company_id", companyId)
    .eq("doc_type", docType)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as PdfFormTemplate) || null;
}

export async function saveFormTemplate(input: {
  companyId: string;
  name: string;
  docType: DocType;
  filePath: string;
  pageCount: number;
  pageSizes: { w: number; h: number }[];
  fields: OverlayField[];
}): Promise<PdfFormTemplate> {
  const { data, error } = await db
    .from("pdf_form_templates")
    .insert({
      company_id: input.companyId,
      name: input.name.trim(),
      doc_type: input.docType,
      file_path: input.filePath,
      page_count: input.pageCount,
      page_sizes: input.pageSizes,
      fields: input.fields,
      is_active: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PdfFormTemplate;
}

export async function updateFormTemplateFields(
  id: string,
  fields: OverlayField[]
): Promise<void> {
  const { error } = await db
    .from("pdf_form_templates")
    .update({ fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** 활성 지정 — 같은 doc_type 의 기존 활성은 해제(부분 유니크 인덱스 충돌 방지). */
export async function setActiveTemplate(
  companyId: string,
  docType: DocType,
  id: string
): Promise<void> {
  await db
    .from("pdf_form_templates")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("doc_type", docType)
    .eq("is_active", true);
  const { error } = await db
    .from("pdf_form_templates")
    .update({ is_active: true })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteFormTemplate(id: string, filePath?: string): Promise<void> {
  if (filePath) {
    await db.storage.from(BUCKET).remove([filePath]).catch(() => {});
  }
  const { error } = await db.from("pdf_form_templates").delete().eq("id", id);
  if (error) throw error;
}

// 견적용 값 매핑 — pdf_form_templates(doc_type='quote').fields 의 key(한글, edge KEYS 와 동일)와 일치.
//   kind=amount 는 pdf-overlay 가 콤마 포맷, kind=date 는 YYYY.MM.DD 포맷.
export function buildQuoteValues(input: {
  myCompanyName?: string | null;
  myRepresentative?: string | null;
  partnerName?: string | null;
  partnerRepresentative?: string | null;
  projectName?: string | null;
  quoteNumber?: string | null;
  issueDate?: string | null;     // YYYY-MM-DD
  validUntil?: string | null;
  supplyAmount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  notes?: string | null;
  signaturePng?: string | null;  // 공급자 직인/서명 dataURL
}): Record<string, string | number | null | undefined> {
  return {
    회사명: input.myCompanyName ?? "",
    대표자명: input.myRepresentative ?? "",
    거래처명: input.partnerName ?? "",
    거래처대표: input.partnerRepresentative ?? "",
    프로젝트명: input.projectName ?? "",
    견적번호: input.quoteNumber ?? "",
    작성일: input.issueDate ?? "",
    유효기간: input.validUntil ?? "",
    공급가액: input.supplyAmount ?? "",
    부가세: input.taxAmount ?? "",
    합계금액: input.totalAmount ?? "",
    비고: input.notes ?? "",
    서명_공급자: input.signaturePng ?? "",
  };
}

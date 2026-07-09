// 핸드오프 → 적용 경로: src/lib/form-templates.ts  (2026-06-29, P2)
//
// pdf_form_templates CRUD + storage(form-templates) 업로드 + pdfjs 래스터화 + parse-form-template edge 호출.
// 패턴: contract-templates.ts(supabase as any), rich-editor.tsx(pdfjs dynamic import) 재사용.

import { supabase } from "@/lib/supabase";
import type { OverlayField } from "@/lib/pdf-overlay";
export type { OverlayField } from "@/lib/pdf-overlay"; // 에디터 등 form-templates 경유 import 호환

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DocType = "quote" | "contract" | "hr_form";

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
  // 텍스트변환 양식(직원 QA) — template_mode='text' 이면 content_html(변수 {{키}} 포함)을 렌더
  content_html?: string | null;
  template_mode?: "overlay" | "text";
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

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** content_html 의 {{키}} 를 values 로 치환. 값이 없으면 강조 표시(미리보기용) 또는 빈칸(발급용). */
export function fillTextTemplate(
  contentHtml: string,
  values: Record<string, string | number | null | undefined>,
  opts?: { highlightMissing?: boolean }
): string {
  return contentHtml.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
    const v = values[key.trim()];
    if (v !== undefined && v !== null && String(v) !== "") return escapeHtml(String(v));
    return opts?.highlightMissing
      ? `<mark style="background:rgba(99,102,241,.15);color:#6366f1;padding:0 2px;border-radius:3px">{{${escapeHtml(key.trim())}}}</mark>`
      : "";
  });
}

/** 텍스트변환 양식 본문(content_html, 변수 치환됨) → 인쇄용 A4 HTML. 한글은 Pretendard(CDN, headless CSP 미적용). */
export function wrapTemplatePrintHtml(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard', sans-serif; color: #111827; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tpl-body { padding: 18mm 16mm; font-size: 13px; line-height: 1.75; }
  .tpl-body p { margin: 2px 0; }
  .tpl-body hr.tpl-page-break { border: none; page-break-after: always; margin: 0; }
</style></head>
<body><div class="tpl-body">${bodyHtml}</div></body></html>`;
}

/** 편집한 평문 텍스트(줄바꿈+{{변수}}) → content_html 로 변환. 페이지 구분선은 <hr>. */
export function templateTextToHtml(text: string): string {
  return text.split("\n").map((line) => {
    if (/^─{3,}.*─{3,}$/.test(line.trim()) || line.trim() === "") {
      return line.trim() === "" ? "<p><br/></p>" : '<hr class="tpl-page-break"/>';
    }
    return `<p>${escapeHtml(line)}</p>`;
  }).join("\n");
}

/** PDF File 을 pdfjs 로 페이지별 편집 가능한 평문 텍스트로 추출 — 텍스트변환 양식용.
 *  y좌표로 줄을 묶고 x순 정렬해 원문 레이아웃을 최대한 보존. 페이지는 구분선으로 나눔. */
export async function extractPdfText(file: File): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pageHtml: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // y좌표(반올림)로 줄 그룹핑 → 각 줄은 x순 정렬 후 합침
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as any[]) {
      const s = String(it.str || "");
      if (!s.trim()) continue;
      const y = Math.round(it.transform[5]);
      lines.has(y) || lines.set(y, []);
      lines.get(y)!.push({ x: it.transform[4], s });
    }
    const ys = [...lines.keys()].sort((a, b) => b - a); // y 큰 값이 위 → 위에서 아래로
    const rows = ys
      .map((y) => lines.get(y)!.sort((a, b) => a.x - b.x).map((t) => t.s).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    pageHtml.push(rows.join("\n"));
  }
  return pageHtml.join("\n\n──────── 페이지 구분 ────────\n\n");
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
  contentHtml?: string;                    // 텍스트변환 양식 본문(변수 {{키}} 포함)
  templateMode?: "overlay" | "text";       // 기본 overlay
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
      content_html: input.contentHtml ?? null,
      template_mode: input.templateMode ?? "overlay",
    })
    .select()
    .single();
  if (error) throw error;
  return data as PdfFormTemplate;
}

/** 텍스트변환 양식 본문 갱신 */
export async function updateFormTemplateContent(id: string, contentHtml: string): Promise<void> {
  const { error } = await db
    .from("pdf_form_templates")
    .update({ content_html: contentHtml, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
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

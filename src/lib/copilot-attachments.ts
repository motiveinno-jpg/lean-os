// AI 참모 첨부문서 텍스트 추출 — 원본 파일은 브라우저 안에서만 읽고,
// 엣지에는 길이를 제한한 평문과 파일 메타만 전달한다.

export const COPILOT_ATTACHMENT_ACCEPT = [
  ".hwp", ".hwpx", ".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt",
].join(",");

export const COPILOT_MAX_ATTACHMENTS = 3;
export const COPILOT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const COPILOT_MAX_TEXT_CHARS = 50_000;
export const COPILOT_MAX_TOTAL_TEXT_CHARS = 70_000;

export type CopilotAttachment = {
  name: string;
  mimeType: string;
  size: number;
  text: string;
  originalCharacters: number;
  truncated: boolean;
};

function extOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function normalizeCopilotDocumentText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** DOCX의 word/document.xml을 문단·표 셀 경계를 보존한 평문으로 바꾼다. */
export function extractDocxXmlText(xml: string): string {
  const withBoundaries = xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:tc>/gi, "\t")
    .replace(/<\/w:tr>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normalizeCopilotDocumentText(decodeXmlEntities(withBoundaries));
}

async function extractHwp(bytes: Uint8Array): Promise<string> {
  const { detectFormat, hwpToText } = await import("@ssabrojs/hwpxjs");
  const format = detectFormat(bytes);
  if (format === "hwp3") throw new Error("한글 3.0 형식은 지원하지 않습니다. HWP 5.x 또는 HWPX로 다시 저장해 주세요.");
  if (format !== "hwp") throw new Error("정상적인 HWP 5.x 파일이 아닙니다.");
  return await hwpToText(bytes, { paragraphSeparator: "\n", sectionSeparator: "\n\n" });
}

async function extractHwpx(buffer: ArrayBuffer): Promise<string> {
  const { HwpxReader } = await import("@ssabrojs/hwpxjs");
  const reader = new HwpxReader();
  await reader.loadFromArrayBuffer(buffer);
  return await reader.extractText();
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = (content.items as { str?: string; hasEOL?: boolean }[])
      .map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`)
      .join("");
    pages.push(`[${pageNo}페이지]\n${text}`);
  }
  return pages.join("\n\n");
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("DOCX 본문을 찾을 수 없습니다.");
  return extractDocxXmlText(documentXml);
}

async function extractSpreadsheet(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `[시트: ${name}]\n${csv}`;
  }).join("\n\n");
}

function friendlyHwpError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/encrypt|password|암호/i.test(raw)) {
    return new Error("암호화된 한글 파일은 읽을 수 없습니다. 암호를 해제한 뒤 다시 첨부해 주세요.");
  }
  if (/viewtext|distribution|배포/i.test(raw)) {
    return new Error("배포용 한글 문서는 읽을 수 없습니다. 편집 가능한 HWP/HWPX로 다시 저장해 주세요.");
  }
  return error instanceof Error ? error : new Error("한글 파일을 읽지 못했습니다.");
}

export async function extractCopilotAttachment(file: File): Promise<CopilotAttachment> {
  if (file.size <= 0) throw new Error("빈 파일은 첨부할 수 없습니다.");
  if (file.size > COPILOT_MAX_FILE_BYTES) throw new Error("파일은 10MB 이하만 첨부할 수 있습니다.");

  const ext = extOf(file.name);
  const supported = ["hwp", "hwpx", "pdf", "docx", "xlsx", "xls", "csv", "txt"];
  if (!supported.includes(ext)) {
    throw new Error("HWP·HWPX·PDF·DOCX·XLSX·XLS·CSV·TXT 파일만 첨부할 수 있습니다.");
  }

  const buffer = await file.arrayBuffer();
  let text = "";
  try {
    if (ext === "hwp") text = await extractHwp(new Uint8Array(buffer));
    else if (ext === "hwpx") text = await extractHwpx(buffer);
    else if (ext === "pdf") text = await extractPdf(buffer);
    else if (ext === "docx") text = await extractDocx(buffer);
    else if (ext === "xlsx" || ext === "xls") text = await extractSpreadsheet(buffer);
    else text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } catch (error) {
    if (ext === "hwp" || ext === "hwpx") throw friendlyHwpError(error);
    throw error;
  }

  text = normalizeCopilotDocumentText(text);
  if (!text) {
    throw new Error(ext === "pdf"
      ? "PDF에서 읽을 수 있는 글자를 찾지 못했습니다. 스캔 PDF는 텍스트 PDF로 변환해 주세요."
      : "문서에서 읽을 수 있는 글자를 찾지 못했습니다.");
  }
  const originalCharacters = text.length;
  const truncated = originalCharacters > COPILOT_MAX_TEXT_CHARS;
  if (truncated) text = `${text.slice(0, COPILOT_MAX_TEXT_CHARS)}\n\n[이하 내용은 길이 제한으로 생략됨]`;

  return {
    name: file.name.slice(0, 180),
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    text,
    originalCharacters,
    truncated,
  };
}

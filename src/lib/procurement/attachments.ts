import { extractDocumentText } from "@/lib/copilot-attachments";
import { ProcurementError, parseNotice } from "./validation";
import type { Notice } from "./types";
export function allowedNoticeAttachment(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["www.g2b.go.kr", "g2b.go.kr", "nwww.g2b.go.kr"].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export async function boundedAttachment(url: string, fetcher = fetch) {
  const res = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (
    !res.ok ||
    Number(res.headers.get("content-length") || 0) > 10 * 1024 * 1024
  )
    throw new ProcurementError(
      "공고 첨부 다운로드 실패 또는 10MB 한도 초과",
      502,
    );
  if ((res.headers.get("content-type") || "").includes("text/html"))
    throw new ProcurementError(
      "첨부 대신 로그인·오류 웹페이지가 반환되었습니다. 원본 파일을 직접 등록하세요.",
      422,
    );
  const reader = res.body?.getReader();
  if (!reader) throw new ProcurementError("첨부 본문이 없습니다.", 502);
  const parts: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      count += r.value.length;
      if (count > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new ProcurementError("공고 첨부가 10MB를 넘습니다.", 413);
      }
      parts.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(count);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
export async function acquireNoticeDocuments(notice: Notice, fetcher = fetch) {
  const documents = [...notice.documents];
  const issues: string[] = [];
  // 한 작업은 누락 첨부 최대 3개씩 처리한다. 나머지는 다음 작업으로 이어간다.
  const missing = notice.attachments.filter(
    (a) => !documents.some((d) => d.name === a.name),
  );
  for (const a of missing.slice(0, 3)) {
    if (!allowedNoticeAttachment(a.url)) {
      issues.push(
        `${a.name}: 공식 나라장터 호스트 외 첨부입니다. 직접 원문을 등록하세요.`,
      );
      continue;
    }
    try {
      const bytes = await boundedAttachment(a.url, fetcher);
      const name = /\.(pdf|hwp|hwpx|docx|xlsx|xls|csv|txt)$/i.test(a.name)
        ? a.name
        : null;
      if (!name)
        throw new ProcurementError(
          "지원되지 않는 형식 또는 확장자 미확인",
          422,
        );
      const text = await extractDocumentText(name, bytes.buffer as ArrayBuffer);
      if (!text.replace(/\[\d+페이지\]/g, "").trim())
        throw new ProcurementError(
          "스캔·표·이미지 문서입니다. 글자가 추출되지 않아 원본 대조/OCR이 필요합니다.",
          422,
        );
      if (text.length > 200000)
        throw new ProcurementError(
          "문서 전문이 20만자를 넘습니다. 문서를 나누어 등록하세요.",
          413,
        );
      documents.push({
        id: crypto.randomUUID(),
        name: a.name,
        text,
        complete: false,
        location: a.url,
      });
    } catch (e) {
      issues.push(
        `${a.name}: ${e instanceof ProcurementError ? e.message : "추출 실패. 스캔·암호·파일 형식을 확인하세요."}`,
      );
    }
  }
  if (missing.length > 3)
    issues.push(
      `추가 첨부 ${missing.length - 3}개는 다음 원문 확보 작업에서 이어서 처리합니다.`,
    );
  return { notice: parseNotice({ ...notice, documents }), issues };
}

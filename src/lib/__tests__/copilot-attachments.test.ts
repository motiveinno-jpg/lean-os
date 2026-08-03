import { describe, expect, it } from "vitest";
import { HwpxWriter } from "@ssabrojs/hwpxjs";
import {
  extractCopilotAttachment,
  extractDocxXmlText,
  normalizeCopilotDocumentText,
} from "@/lib/copilot-attachments";

function fileLike(name: string, type: string, bytes: Uint8Array): File {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as File;
}

describe("copilot attachments", () => {
  it("HWPX 문서의 한글 본문을 추출한다", async () => {
    const bytes = await new HwpxWriter().createFromPlainText(
      "용역계약서\n계약기간은 2026년 8월 1일부터입니다.\n대금은 월 1,000,000원입니다.",
      { title: "계약서" },
    );

    const result = await extractCopilotAttachment(
      fileLike("계약서.hwpx", "application/owpml", bytes),
    );

    expect(result.text).toContain("용역계약서");
    expect(result.text).toContain("1,000,000원");
    expect(result.truncated).toBe(false);
  });

  it("DOCX XML의 문단과 표 셀 경계를 보존한다", () => {
    const xml = [
      "<w:document><w:body>",
      "<w:p><w:r><w:t>계약 조건 &amp; 특약</w:t></w:r></w:p>",
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>기간</w:t></w:r></w:p></w:tc>",
      "<w:tc><w:p><w:r><w:t>1년</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
      "</w:body></w:document>",
    ].join("");

    const text = extractDocxXmlText(xml);

    expect(text).toContain("계약 조건 & 특약");
    expect(text).toContain("기간");
    expect(text).toContain("1년");
    expect(text).toMatch(/기간\s+1년/);
  });

  it("NUL과 과도한 빈 줄을 제거한다", () => {
    expect(normalizeCopilotDocumentText("계약\u0000\r\n\r\n\r\n\r\n조건  \r\n"))
      .toBe("계약\n\n\n조건");
  });
});

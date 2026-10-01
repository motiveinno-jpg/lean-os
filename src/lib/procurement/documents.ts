import JSZip from "jszip";
import type { Proposal } from "./ai";
import type { Notice, Workspace } from "./types";
export function proposalMarkdown(p: Proposal, n: Notice, ws: Workspace) {
  const members = ws.workforce?.members || [];
  return [
    `# ${p.title}`,
    `상태: AI 작성 검토본 · 최종 제출 전 원문·기관 지정 양식·가격·인력·날인 검수 필요`,
    `공고: ${n.noticeNo}/${n.revision} · ${n.agency}\n마감: ${n.deadline || "확인 필요"}`,
    ...p.sections.map(
      (s) =>
        `## ${s.heading}\n${s.body}\n${s.citations.map((c) => `원문 근거: ${c.location} / ${c.quote}`).join("\n")}\n${s.evidenceIds.map((id) => `회사 근거: ${ws.evidence.find((e) => e.id === id)?.title || "미확인"}`).join("\n")}`,
    ),
    `## 인력 배치 제안\n${p.staffing.map((s) => `- ${s.role}: ${members.find((e) => e.id === s.employeeId)?.name || "담당 확정 필요"} / ${s.plan}`).join("\n")}`,
    `## 예산 검토안\n${p.budget.map((b) => `- ${b.item}: ${b.amount === null ? "금액 확인 필요" : b.amount.toLocaleString() + "원"} / ${b.basis}`).join("\n")}`,
    `## 사람이 발급·확정·서명해야 하는 서류\n${p.manualDocuments.map((d) => `- ${d.name}\n  준비 이유: ${d.reason}\n  발급처: ${d.issuer}\n  담당: ${d.owner}\n  기한: ${d.deadline}\n  원문: ${d.citation ? d.citation.location + " / " + d.citation.quote : "공고 요구 여부 확인 제안"}`).join("\n")}`,
    `## 부족한 자료·확인 사항\n${p.missingInputs.map((q) => `- ${q}`).join("\n")}`,
    `## 최종 제출 전 점검\n- 최신 정정·취소·마감 확인\n- 공고 지정 목차·분량·익명성·파일형식·서식 적용\n- 직접 발급 증명서의 유효기간·회사명·코드·실적금액 대조\n- 실제 가격과 투입인력 확정\n- 서명·날인·전자제출·접수 완료 확인`,
  ].join("\n\n");
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function proposalDocx(markdown: string) {
  const paragraphs = markdown
    .split("\n")
    .map((line) => {
      const heading = line.startsWith("# ")
        ? "Title"
        : line.startsWith("## ")
          ? "Heading1"
          : "Normal";
      return `<w:p><w:pPr><w:pStyle w:val="${heading}"/></w:pPr><w:r><w:t xml:space="preserve">${escape(line.replace(/^#{1,2} /, ""))}</w:t></w:r></w:p>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
export function proposalPrintHtml(markdown: string) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>입찰 제안서 검토본</title><style>@page{size:A4;margin:20mm}body{font-family:"Malgun Gothic",sans-serif;color:#172033;line-height:1.7;font-size:11pt;max-width:780px;margin:30px auto}h1{font-size:22pt}h2{font-size:15pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{button{display:none}}</style><body>${markdown
    .split("\n")
    .map((l) =>
      l.startsWith("# ")
        ? `<h1>${escape(l.slice(2))}</h1>`
        : l.startsWith("## ")
          ? `<h2>${escape(l.slice(3))}</h2>`
          : `<p>${escape(l) || "&nbsp;"}</p>`,
    )
    .join("")}</body></html>`;
}

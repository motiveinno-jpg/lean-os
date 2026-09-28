// 연차유급휴가 사용 촉진 통보서 PDF (2026-09-28, 인사 촉진 후속) — 근로기준법 §61 의 '서면 촉구·통보' 를 종이로도 남길 수 있게.
//   이메일 통보(send-leave-promotion-email)와 같은 값(대상 연도·미사용 일수·기한)을 쓰고, 통보 기록(leave_promotion_notices) 한 줄에서 만든다.
//   재직증명서(lib/certificates.ts)와 같은 부품: jsPDF + NanumGothic + 직인 오버레이. 새 표는 만들지 않는다 — 이력 표에서 내려받기만.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { loadKoreanFont, setKoreanFont } from "./pdf-korean-font";

export type PromotionNoticePdfInput = {
  noticeType: "first" | "second";
  year: number;
  unusedDays: number;
  sentAt: string | null;          // ISO — 통보일
  deadline: string | null;        // YYYY-MM-DD — 1차: 사용 시기 회신 기한 · 2차: 사용 기한
  employee: { name: string; department?: string | null; position?: string | null };
  company: { name: string; representative?: string | null; address?: string | null; business_number?: string | null; sealDataUrl?: string | null };
};

const kdate = (d: Date) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
const kdateStr = (s: string | null) => (s ? kdate(new Date(s)) : "-");

export async function generateLeavePromotionNoticePdf(input: PromotionNoticePdfInput): Promise<Blob> {
  const { noticeType, year, unusedDays, employee, company } = input;
  const first = noticeType === "first";
  const doc = new jsPDF("p", "mm", "a4");
  await loadKoreanFont(doc);
  setKoreanFont(doc, "normal");
  const pageW = doc.internal.pageSize.getWidth();
  let y = 30;

  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.text(`연차유급휴가 사용 촉진 통보서 (${first ? "1차" : "2차"})`, pageW / 2, y, { align: "center" });
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(first ? "근로기준법 제61조 제1항 제1호 — 사용 시기 지정 촉구" : "근로기준법 제61조 제1항 제2호 — 사용 시기 지정 통보", pageW / 2, y, { align: "center" });
  y += 10;
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.8);
  doc.line(14, y, pageW - 14, y);
  y += 8;

  const rows: string[][] = [
    ["수    신", `${employee.name}${employee.department ? `  (${employee.department}${employee.position ? ` · ${employee.position}` : ""})` : ""}`],
    ["대상 연도", `${year}년 발생 연차유급휴가`],
    ["미사용 일수", `${unusedDays}일`],
    ["통 보 일", kdateStr(input.sentAt)],
    [first ? "회신 기한" : "사용 기한", kdateStr(input.deadline)],
  ];
  autoTable(doc, {
    startY: y,
    body: rows,
    theme: "grid",
    styles: { font: "NanumGothic", fontSize: 11, cellPadding: { top: 4.5, bottom: 4.5, left: 8, right: 8 }, textColor: [40, 40, 40], lineColor: [200, 200, 200], lineWidth: 0.3 },
    columnStyles: { 0: { cellWidth: 40, fontStyle: "bold", fillColor: [245, 247, 250], textColor: [60, 60, 60], halign: "center" }, 1: { cellWidth: pageW - 68 } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  doc.setFontSize(11.5);
  doc.setTextColor(30, 30, 30);
  const body = first
    ? [
      `귀하의 ${year}년 연차유급휴가 중 ${unusedDays}일이 사용되지 않았습니다.`,
      `근로기준법 제61조에 따라 미사용 연차의 사용 시기를 정하여 ${kdateStr(input.deadline)}까지 회사에 통보해 주시기 바랍니다.`,
      "기한 안에 사용 시기를 통보하지 않으면 회사가 사용 시기를 지정하여 다시 통보합니다.",
      "위 절차를 모두 거친 뒤에도 사용하지 않은 연차에 대해서는 회사의 보상 의무가 소멸됩니다.",
    ]
    : [
      `귀하가 ${year}년 미사용 연차유급휴가 ${unusedDays}일의 사용 시기를 통보하지 않아, 근로기준법 제61조에 따라 회사가 사용 시기를 아래와 같이 지정합니다.`,
      `사용 기간: 통보일부터 ${kdateStr(input.deadline)}까지. 구체적인 사용일은 위 기간 안에서 부서장과 협의하여 정합니다.`,
      "지정된 기간 안에 사용하지 않은 연차에 대해서는 회사의 보상 의무가 소멸됩니다.",
    ];
  for (const para of body) {
    const lines = doc.splitTextToSize(para, pageW - 40);
    doc.text(lines, 20, y);
    y += 7 * lines.length + 3;
  }
  y += 10;

  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  doc.text(kdate(input.sentAt ? new Date(input.sentAt) : new Date()), pageW / 2 + 30, y, { align: "center" });
  y += 18;

  const labelX = 34, valueX = 68;
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  doc.text("회 사 명 :", labelX, y); doc.text(company.name, valueX, y); y += 8;
  if (company.business_number) { doc.text("사업자번호 :", labelX, y); doc.text(company.business_number, valueX, y); y += 8; }
  if (company.address) { doc.text("회사주소 :", labelX, y); const a = doc.splitTextToSize(company.address, pageW - valueX - 24); doc.text(a, valueX, y); y += 8 * a.length; }
  let repY = y;
  if (company.representative) { doc.text("대표이사 :", labelX, y); doc.text(`${company.representative}  (인)`, valueX, y); repY = y; y += 8; }
  if (company.sealDataUrl) {
    try {
      const sealSize = 26;
      const nameW = company.representative ? doc.getTextWidth(company.representative) : 0;
      doc.addImage(company.sealDataUrl, "PNG", valueX + nameW + 4, repY - sealSize / 2 - 4, sealSize, sealSize);
    } catch { /* 직인 없이 낸다 */ }
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(`OwnerView  |  ${company.name}  |  연차 사용 촉진 통보서`, pageW / 2, pageH - 8, { align: "center" });
  return doc.output("blob");
}

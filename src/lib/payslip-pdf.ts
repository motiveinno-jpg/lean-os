import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { NotoSansKR_Regular } from '@/assets/fonts/NotoSansKR-Regular';
import type { PayrollItem } from './payment-batch';

function setupKoreanFont(doc: jsPDF) {
  doc.addFileToVFS('NotoSansKR-Regular.otf', NotoSansKR_Regular);
  doc.addFont('NotoSansKR-Regular.otf', 'NotoSansKR', 'normal');
  doc.setFont('NotoSansKR');
}

export interface PayslipParams {
  item: PayrollItem;
  companyName: string;
  representative?: string;
  periodLabel: string;
  department?: string;
  position?: string;
  paymentDate?: string;
}

const fmt = (n: number) => `₩${Math.round(n).toLocaleString()}`;

export function generatePayslipPDF(params: PayslipParams): jsPDF {
  const { item, companyName, representative, periodLabel, department, position, paymentDate } = params;
  const doc = new jsPDF('p', 'mm', 'a4');
  setupKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const today = paymentDate || new Date().toISOString().slice(0, 10);
  let y = 22;

  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`발행일: ${today}`, pageW - 14, 14, { align: 'right' });

  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  doc.text('급 여 명 세 서', pageW / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(`(${periodLabel})`, pageW / 2, y, { align: 'center' });
  y += 8;
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.6);
  doc.line(14, y, pageW - 14, y);
  y += 6;

  // 인적사항
  autoTable(doc, {
    startY: y,
    body: [
      ['회사명', companyName, '발행일', today],
      ['성명', item.employeeName, '소속', `${department || '-'} / ${position || '-'}`],
    ],
    theme: 'grid',
    styles: { font: 'NotoSansKR', fontSize: 9, cellPadding: 3, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 25, fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { cellWidth: (pageW - 28 - 50) / 2 },
      2: { cellWidth: 25, fontStyle: 'bold', fillColor: [245, 247, 250] },
      3: { cellWidth: (pageW - 28 - 50) / 2 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // 지급내역 / 공제내역 좌우 배치
  const colW = (pageW - 28 - 4) / 2;

  autoTable(doc, {
    startY: y,
    head: [['지급내역', '금액']],
    body: [
      ['기본급', fmt(item.baseSalary - item.nonTaxableAmount)],
      ['비과세', fmt(item.nonTaxableAmount)],
      ['과세대상', fmt(item.taxableIncome)],
      [{ content: '지급액 합계', styles: { fontStyle: 'bold', fillColor: [240, 247, 255] } }, { content: fmt(item.baseSalary), styles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 247, 255] } }],
    ],
    theme: 'grid',
    styles: { font: 'NotoSansKR', fontSize: 9, cellPadding: 3, lineColor: [220, 220, 220], lineWidth: 0.2 },
    headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: colW - 30, halign: 'right' } },
    margin: { left: 14, right: pageW - 14 - colW },
    tableWidth: colW,
  });
  const leftEndY = (doc as any).lastAutoTable.finalY;

  autoTable(doc, {
    startY: y,
    head: [['공제내역', '금액']],
    body: [
      ['국민연금 (4.5%)', fmt(item.nationalPension)],
      ['건강보험 (3.545%)', fmt(item.healthInsurance)],
      ['고용보험 (0.9%)', fmt(item.employmentInsurance)],
      ['소득세', fmt(item.incomeTax)],
      ['지방소득세', fmt(item.localIncomeTax)],
      [{ content: '공제액 합계', styles: { fontStyle: 'bold', fillColor: [255, 240, 240] } }, { content: fmt(item.deductionsTotal), styles: { fontStyle: 'bold', halign: 'right', fillColor: [255, 240, 240], textColor: [200, 50, 50] } }],
    ],
    theme: 'grid',
    styles: { font: 'NotoSansKR', fontSize: 9, cellPadding: 3, lineColor: [220, 220, 220], lineWidth: 0.2 },
    headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: colW - 35, halign: 'right' } },
    margin: { left: 14 + colW + 4, right: 14 },
    tableWidth: colW,
  });
  const rightEndY = (doc as any).lastAutoTable.finalY;
  y = Math.max(leftEndY, rightEndY) + 8;

  // 실수령액 큰 박스
  doc.setDrawColor(34, 197, 94);
  doc.setFillColor(240, 253, 244);
  doc.setLineWidth(0.8);
  doc.roundedRect(14, y, pageW - 28, 18, 3, 3, 'FD');
  doc.setFontSize(11);
  doc.setTextColor(40, 100, 60);
  doc.text('실 수 령 액', 22, y + 11);
  doc.setFontSize(16);
  doc.setTextColor(20, 130, 60);
  doc.text(fmt(item.netPay), pageW - 22, y + 12, { align: 'right' });
  y += 26;

  // 사업주 부담분
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `※ 사업주 부담 4대보험: 국민연금 ${fmt(item.employerCosts.nationalPension)} · 건강 ${fmt(item.employerCosts.healthInsurance)} · 고용 ${fmt(item.employerCosts.employmentInsurance)} · 산재 ${fmt(item.employerCosts.industrialAccident)} (합계 ${fmt(item.employerCosts.total)})`,
    14, y, { maxWidth: pageW - 28 }
  );
  y += 8;
  doc.text('※ 본 명세서는 근로기준법 제48조에 따라 발급되었습니다. 원천세 신고 자료로 사용 가능합니다.', 14, y, { maxWidth: pageW - 28 });

  // 회사 정보 푸터
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const footY = doc.internal.pageSize.getHeight() - 18;
  doc.text(`${companyName}${representative ? `  /  대표 ${representative}` : ''}`, pageW / 2, footY, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  doc.text('Generated by OwnerView', pageW / 2, footY + 5, { align: 'center' });

  return doc;
}

export function downloadPayslipPDF(params: PayslipParams) {
  const doc = generatePayslipPDF(params);
  const safeName = params.item.employeeName.replace(/[^\w가-힣]/g, '_');
  doc.save(`급여명세서_${safeName}_${params.periodLabel.replace(/[^\w]/g, '')}.pdf`);
}

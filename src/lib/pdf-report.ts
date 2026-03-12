/**
 * OwnerView PDF Report Generator
 * 월간 손익 리포트 PDF 다운로드
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont } from './pdf-korean-font';

interface MonthlyPLData {
  month: string;
  companyName: string;
  revenue: number;
  expense: number;
  netIncome: number;
  items: Array<{
    name: string;
    category: string;
    amount: number;
    counterparty?: string;
  }>;
  bankBalance: number;
  fixedCost: number;
  runwayMonths: number;
  dealBreakdown: Array<{
    dealName: string;
    classification: string;
    revenue: number;
    cost: number;
    margin: number;
  }>;
}

function fmtKRW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}${abs.toLocaleString()}`;
}

export async function generateMonthlyPLReport(data: MonthlyPLData) {
  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  let y = 15;

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont('NanumGothic', 'normal');
  doc.text(`월간 손익 리포트`, 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`${data.companyName}  |  ${data.month}  |  생성일: ${new Date().toLocaleDateString('ko-KR')}`, 14, y);
  y += 10;

  // ── Summary Box ──
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(14, y, pageW - 28, 28, 3, 3, 'F');

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('매출', 24, y + 8);
  doc.text('비용', 74, y + 8);
  doc.text('순이익', 124, y + 8);
  doc.text('런웨이', 168, y + 8);

  doc.setFontSize(14);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(59, 130, 246);
  doc.text(`${fmtKRW(data.revenue)}`, 24, y + 18);
  doc.setTextColor(239, 68, 68);
  doc.text(`${fmtKRW(data.expense)}`, 74, y + 18);
  doc.setTextColor(data.netIncome >= 0 ? 34 : 239, data.netIncome >= 0 ? 197 : 68, data.netIncome >= 0 ? 94 : 68);
  doc.text(`${fmtKRW(data.netIncome)}`, 124, y + 18);
  doc.setTextColor(60, 60, 60);
  doc.text(`${data.runwayMonths < 999 ? `${data.runwayMonths}개월` : '안전'}`, 168, y + 18);

  y += 36;

  // ── Deal Breakdown Table ──
  if (data.dealBreakdown.length > 0) {
    doc.setFontSize(11);
    doc.setFont('NanumGothic', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text('딜별 손익', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['딜명', '유형', '매출', '비용', '마진율']],
      body: data.dealBreakdown.map(d => [
        d.dealName,
        d.classification,
        fmtKRW(d.revenue),
        fmtKRW(d.cost),
        `${d.margin.toFixed(1)}%`,
      ]),
      styles: { fontSize: 8, cellPadding: 3, font: 'NanumGothic' },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Revenue Items ──
  const revenueItems = data.items.filter(i => i.category === 'income' || i.category === 'receivable' || i.category === 'revenue');
  const expenseItems = data.items.filter(i => i.category !== 'income' && i.category !== 'receivable' && i.category !== 'revenue');

  if (revenueItems.length > 0) {
    doc.setFontSize(11);
    doc.setFont('NanumGothic', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text('매출 항목', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['항목명', '거래처', '금액']],
      body: revenueItems.map(i => [i.name, i.counterparty || '-', fmtKRW(i.amount)]),
      styles: { fontSize: 8, cellPadding: 3, font: 'NanumGothic' },
      headStyles: { fillColor: [34, 197, 94], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Expense Items ──
  if (expenseItems.length > 0) {
    if (y > 240) { doc.addPage(); y = 15; }

    doc.setFontSize(11);
    doc.setFont('NanumGothic', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text('비용 항목', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['항목명', '분류', '금액']],
      body: expenseItems.map(i => [i.name, i.category, fmtKRW(i.amount)]),
      styles: { fontSize: 8, cellPadding: 3, font: 'NanumGothic' },
      headStyles: { fillColor: [239, 68, 68], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Footer ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `OwnerView 재무 리포트  |  ${data.companyName}  |  ${i}/${pageCount} 페이지`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' },
    );
  }

  doc.save(`PL_Report_${data.month}_${data.companyName.replace(/\s/g, '_')}.pdf`);
}

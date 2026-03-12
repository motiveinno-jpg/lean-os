/**
 * Korean Tax Form PDF Generators
 * 부가세 신고서, 원천세 신고서, 급여대장 PDF 생성
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont } from './pdf-korean-font';

// ─── Shared Types ───────────────────────────────────────────────────────────

interface CompanyInfo {
  name: string;          // 상호
  brn: string;           // 사업자등록번호 (000-00-00000)
  representative: string; // 대표자
  address: string;       // 사업장 주소
}

// ─── VAT Return Types ───────────────────────────────────────────────────────

interface VATInvoiceTotals {
  supplyAmount: number;  // 공급가액
  taxAmount: number;     // 세액
}

interface VATReturnParams {
  companyInfo: CompanyInfo;
  period: {
    year: number;
    half: 1 | 2;         // 1기 (1~6월) or 2기 (7~12월)
  };
  salesInvoices: VATInvoiceTotals;    // 세금계산서 매출
  purchaseInvoices: VATInvoiceTotals; // 세금계산서 매입
  cardPurchaseVAT: number;            // 카드매입세액
  otherSales?: VATInvoiceTotals;      // 기타 매출 (카드/현금영수증 등)
  otherPurchases?: VATInvoiceTotals;  // 기타 매입
}

// ─── Withholding Tax Types ──────────────────────────────────────────────────

interface EmployeeTaxInfo {
  name: string;
  salary: number;       // 총지급액
  taxWithheld: number;  // 소득세
}

interface OtherIncomeInfo {
  name: string;            // 프리랜서 성명
  payment: number;         // 지급액
  withholdingRate?: number; // 원천징수율 (default 3.3%)
}

interface WithholdingTaxParams {
  companyInfo: CompanyInfo;
  month: {
    year: number;
    month: number; // 1~12
  };
  employees: EmployeeTaxInfo[];
  otherIncome: OtherIncomeInfo[];
}

// ─── Payroll Ledger Types ───────────────────────────────────────────────────

interface PayrollEmployee {
  name: string;
  baseSalary: number;          // 기본급
  overtimePay: number;         // 연장근로수당
  bonusPay: number;            // 상여금
  mealAllowance: number;       // 식대
  otherAllowance: number;      // 기타수당
  nationalPension: number;     // 국민연금
  healthInsurance: number;     // 건강보험
  longTermCare: number;        // 장기요양보험
  employmentInsurance: number; // 고용보험
  incomeTax: number;           // 소득세
  localIncomeTax: number;      // 지방소득세
}

interface PayrollLedgerParams {
  companyInfo: CompanyInfo;
  month: {
    year: number;
    month: number;
  };
  employees: PayrollEmployee[];
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

function addPageFooter(doc: jsPDF, companyName: string, title: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `OwnerView  |  ${companyName}  |  ${title}  |  ${i}/${pageCount} 페이지`,
      pageW / 2,
      pageH - 8,
      { align: 'center' },
    );
  }
}

function drawCompanyInfoSection(doc: jsPDF, info: CompanyInfo, y: number): number {
  doc.setFontSize(9);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(60, 60, 60);

  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(14, y, pageW - 28, 30, 2, 2, 'F');

  const col1X = 20;
  const col2X = pageW / 2 + 10;
  const rowH = 7;

  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('상호:', col1X, y + rowH);
  doc.text('대표자:', col2X, y + rowH);
  doc.text('사업자등록번호:', col1X, y + rowH * 2);
  doc.text('사업장주소:', col2X, y + rowH * 2);

  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text(info.name, col1X + 18, y + rowH);
  doc.text(info.representative, col2X + 22, y + rowH);
  doc.text(info.brn, col1X + 46, y + rowH * 2);
  doc.text(info.address, col2X + 32, y + rowH * 2);

  return y + 36;
}

// ─── 1. VAT Return (부가세 신고서) ──────────────────────────────────────────

export async function generateVATReturn(params: VATReturnParams): Promise<jsPDF> {
  const { companyInfo, period, salesInvoices, purchaseInvoices, cardPurchaseVAT } = params;
  const otherSales = params.otherSales ?? { supplyAmount: 0, taxAmount: 0 };
  const otherPurchases = params.otherPurchases ?? { supplyAmount: 0, taxAmount: 0 };

  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  let y = 15;

  const halfLabel = period.half === 1 ? '1기 확정' : '2기 확정';
  const periodRange = period.half === 1
    ? `${period.year}.01.01 ~ ${period.year}.06.30`
    : `${period.year}.07.01 ~ ${period.year}.12.31`;

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(`부가가치세 ${halfLabel} 신고서`, 14, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`과세기간: ${periodRange}  |  생성일: ${new Date().toLocaleDateString('ko-KR')}`, 14, y);
  y += 8;

  // ── Company Info ──
  y = drawCompanyInfoSection(doc, companyInfo, y);

  // ── 매출세액 Section ──
  const totalSalesTax = salesInvoices.taxAmount + otherSales.taxAmount;
  const totalSalesSupply = salesInvoices.supplyAmount + otherSales.supplyAmount;

  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('매출세액', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['구분', '공급가액', '세액']],
    body: [
      ['세금계산서 매출', fmt(salesInvoices.supplyAmount), fmt(salesInvoices.taxAmount)],
      ['기타 매출 (카드/현금영수증 등)', fmt(otherSales.supplyAmount), fmt(otherSales.taxAmount)],
      ['매출 합계', fmt(totalSalesSupply), fmt(totalSalesTax)],
    ],
    styles: { fontSize: 9, cellPadding: 4, font: 'NanumGothic', halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: 80 } },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    // Bold the totals row
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 240, 255];
      }
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── 매입세액 Section ──
  const totalPurchaseTax = purchaseInvoices.taxAmount + cardPurchaseVAT + otherPurchases.taxAmount;
  const totalPurchaseSupply = purchaseInvoices.supplyAmount + otherPurchases.supplyAmount;

  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('매입세액', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['구분', '공급가액', '세액']],
    body: [
      ['세금계산서 매입', fmt(purchaseInvoices.supplyAmount), fmt(purchaseInvoices.taxAmount)],
      ['카드매입세액', '-', fmt(cardPurchaseVAT)],
      ['기타 매입', fmt(otherPurchases.supplyAmount), fmt(otherPurchases.taxAmount)],
      ['매입 합계', fmt(totalPurchaseSupply), fmt(totalPurchaseTax)],
    ],
    styles: { fontSize: 9, cellPadding: 4, font: 'NanumGothic', halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: 80 } },
    headStyles: { fillColor: [34, 197, 94], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === 3) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 255, 240];
      }
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── 차감납부세액 Summary ──
  const netTax = totalSalesTax - totalPurchaseTax;

  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('납부세액 계산', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['항목', '금액 (원)']],
    body: [
      ['매출세액 합계', fmt(totalSalesTax)],
      ['(-)  매입세액 합계', fmt(totalPurchaseTax)],
      ['차감납부세액(환급세액)', fmt(netTax)],
    ],
    styles: { fontSize: 10, cellPadding: 5, font: 'NanumGothic', halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: 100 } },
    headStyles: { fillColor: [50, 50, 50], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [30, 30, 30] },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 11;
        data.cell.styles.fillColor = netTax >= 0 ? [255, 245, 235] : [235, 245, 255];
      }
    },
    margin: { left: 14, right: 14 },
  });

  // ── Footer ──
  addPageFooter(doc, companyInfo.name, '부가가치세 신고서');

  const filename = `VAT_${period.year}_${period.half}기_${companyInfo.name.replace(/\s/g, '_')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─── 2. Withholding Tax Return (원천세 신고서) ──────────────────────────────

export async function generateWithholdingTax(params: WithholdingTaxParams): Promise<jsPDF> {
  const { companyInfo, month, employees, otherIncome } = params;

  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  let y = 15;

  const monthStr = `${month.year}년 ${String(month.month).padStart(2, '0')}월`;
  const attributionMonth = monthStr;  // 귀속연월
  const paymentMonth = monthStr;      // 지급연월

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('원천징수이행상황신고서', 14, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(
    `귀속연월: ${attributionMonth}  |  지급연월: ${paymentMonth}  |  생성일: ${new Date().toLocaleDateString('ko-KR')}`,
    14, y,
  );
  y += 8;

  // ── Company Info ──
  y = drawCompanyInfoSection(doc, companyInfo, y);

  // ── 근로소득 Section ──
  const totalEmployeeSalary = employees.reduce((sum, e) => sum + e.salary, 0);
  const totalIncomeTax = employees.reduce((sum, e) => sum + e.taxWithheld, 0);
  const totalLocalTax = Math.floor(totalIncomeTax * 0.1); // 지방소득세 = 소득세의 10%

  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('근로소득 원천징수', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['성명', '총지급액', '소득세', '지방소득세']],
    body: [
      ...employees.map(e => [
        e.name,
        fmt(e.salary),
        fmt(e.taxWithheld),
        fmt(Math.floor(e.taxWithheld * 0.1)),
      ]),
      [
        `합계 (${employees.length}명)`,
        fmt(totalEmployeeSalary),
        fmt(totalIncomeTax),
        fmt(totalLocalTax),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 4, font: 'NanumGothic', halign: 'right' },
    columnStyles: { 0: { halign: 'left' } },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === employees.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 240, 255];
      }
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── 사업소득 Section (3.3% withholding) ──
  if (otherIncome.length > 0) {
    doc.setFontSize(11);
    doc.setFont('NanumGothic', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text('사업소득 원천징수 (3.3%)', 14, y);
    y += 4;

    const otherRows = otherIncome.map(o => {
      const rate = o.withholdingRate ?? 3.3;
      const totalWithholding = Math.floor(o.payment * rate / 100);
      const incomeTaxPortion = Math.floor(o.payment * 3 / 100);
      const localTaxPortion = totalWithholding - incomeTaxPortion;
      return {
        name: o.name,
        payment: o.payment,
        rate,
        incomeTax: incomeTaxPortion,
        localTax: localTaxPortion,
        total: totalWithholding,
      };
    });

    const totalOtherPayment = otherRows.reduce((s, r) => s + r.payment, 0);
    const totalOtherIncomeTax = otherRows.reduce((s, r) => s + r.incomeTax, 0);
    const totalOtherLocalTax = otherRows.reduce((s, r) => s + r.localTax, 0);
    const totalOtherWithholding = otherRows.reduce((s, r) => s + r.total, 0);

    autoTable(doc, {
      startY: y,
      head: [['성명', '지급액', '세율', '소득세', '지방소득세', '원천징수합계']],
      body: [
        ...otherRows.map(r => [
          r.name,
          fmt(r.payment),
          `${r.rate}%`,
          fmt(r.incomeTax),
          fmt(r.localTax),
          fmt(r.total),
        ]),
        [
          `합계 (${otherIncome.length}명)`,
          fmt(totalOtherPayment),
          '-',
          fmt(totalOtherIncomeTax),
          fmt(totalOtherLocalTax),
          fmt(totalOtherWithholding),
        ],
      ],
      styles: { fontSize: 9, cellPadding: 4, font: 'NanumGothic', halign: 'right' },
      columnStyles: { 0: { halign: 'left' }, 2: { halign: 'center' } },
      headStyles: { fillColor: [168, 85, 247], textColor: 255, halign: 'center' },
      bodyStyles: { textColor: [30, 30, 30] },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      didParseCell(data) {
        if (data.section === 'body' && data.row.index === otherIncome.length) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [245, 235, 255];
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── 납부세액 합계 ──
  const totalOtherWithholdingAll = otherIncome.reduce((s, o) => {
    const rate = o.withholdingRate ?? 3.3;
    return s + Math.floor(o.payment * rate / 100);
  }, 0);
  const totalOtherIncomeTaxAll = otherIncome.reduce((s, o) => s + Math.floor(o.payment * 3 / 100), 0);
  const totalOtherLocalTaxAll = totalOtherWithholdingAll - totalOtherIncomeTaxAll;
  const grandTotalTax = totalIncomeTax + totalLocalTax + totalOtherWithholdingAll;

  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('납부세액 합계', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['구분', '소득세', '지방소득세', '합계']],
    body: [
      ['근로소득', fmt(totalIncomeTax), fmt(totalLocalTax), fmt(totalIncomeTax + totalLocalTax)],
      ['사업소득', fmt(totalOtherIncomeTaxAll), fmt(totalOtherLocalTaxAll), fmt(totalOtherWithholdingAll)],
      ['납부세액 합계', '-', '-', fmt(grandTotalTax)],
    ],
    styles: { fontSize: 10, cellPadding: 5, font: 'NanumGothic', halign: 'right' },
    columnStyles: { 0: { halign: 'left', cellWidth: 60 } },
    headStyles: { fillColor: [50, 50, 50], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [30, 30, 30] },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 11;
        data.cell.styles.fillColor = [255, 245, 235];
      }
    },
    margin: { left: 14, right: 14 },
  });

  // ── Footer ──
  addPageFooter(doc, companyInfo.name, '원천징수이행상황신고서');

  const filename = `WHT_${month.year}${String(month.month).padStart(2, '0')}_${companyInfo.name.replace(/\s/g, '_')}.pdf`;
  doc.save(filename);
  return doc;
}

// ─── 3. Payroll Ledger (급여대장) ───────────────────────────────────────────

export async function generatePayrollLedger(params: PayrollLedgerParams): Promise<jsPDF> {
  const { companyInfo, month, employees } = params;

  // Landscape for wide payroll table
  const doc = new jsPDF('l', 'mm', 'a4');
  await loadKoreanFont(doc);
  let y = 12;

  const monthStr = `${month.year}년 ${String(month.month).padStart(2, '0')}월`;

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('NanumGothic', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('급여대장', 14, y);

  doc.setFontSize(10);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(monthStr, 50, y);
  y += 6;

  doc.setFontSize(9);
  doc.text(
    `${companyInfo.name}  |  사업자등록번호: ${companyInfo.brn}  |  대표: ${companyInfo.representative}  |  생성일: ${new Date().toLocaleDateString('ko-KR')}`,
    14, y,
  );
  y += 6;

  // ── Payroll Table ──
  const computeGross = (e: PayrollEmployee) =>
    e.baseSalary + e.overtimePay + e.bonusPay + e.mealAllowance + e.otherAllowance;

  const computeDeductions = (e: PayrollEmployee) =>
    e.nationalPension + e.healthInsurance + e.longTermCare +
    e.employmentInsurance + e.incomeTax + e.localIncomeTax;

  const computeNet = (e: PayrollEmployee) => computeGross(e) - computeDeductions(e);

  const bodyRows = employees.map((e, idx) => [
    String(idx + 1),
    e.name,
    fmt(e.baseSalary),
    fmt(e.overtimePay),
    fmt(e.bonusPay),
    fmt(e.mealAllowance),
    fmt(e.otherAllowance),
    fmt(computeGross(e)),
    fmt(e.nationalPension),
    fmt(e.healthInsurance),
    fmt(e.longTermCare),
    fmt(e.employmentInsurance),
    fmt(e.incomeTax),
    fmt(e.localIncomeTax),
    fmt(computeDeductions(e)),
    fmt(computeNet(e)),
  ]);

  // Totals row
  const totals: PayrollEmployee = {
    name: '',
    baseSalary: 0,
    overtimePay: 0,
    bonusPay: 0,
    mealAllowance: 0,
    otherAllowance: 0,
    nationalPension: 0,
    healthInsurance: 0,
    longTermCare: 0,
    employmentInsurance: 0,
    incomeTax: 0,
    localIncomeTax: 0,
  };
  for (const e of employees) {
    totals.baseSalary += e.baseSalary;
    totals.overtimePay += e.overtimePay;
    totals.bonusPay += e.bonusPay;
    totals.mealAllowance += e.mealAllowance;
    totals.otherAllowance += e.otherAllowance;
    totals.nationalPension += e.nationalPension;
    totals.healthInsurance += e.healthInsurance;
    totals.longTermCare += e.longTermCare;
    totals.employmentInsurance += e.employmentInsurance;
    totals.incomeTax += e.incomeTax;
    totals.localIncomeTax += e.localIncomeTax;
  }

  bodyRows.push([
    '',
    `합계 (${employees.length}명)`,
    fmt(totals.baseSalary),
    fmt(totals.overtimePay),
    fmt(totals.bonusPay),
    fmt(totals.mealAllowance),
    fmt(totals.otherAllowance),
    fmt(computeGross(totals)),
    fmt(totals.nationalPension),
    fmt(totals.healthInsurance),
    fmt(totals.longTermCare),
    fmt(totals.employmentInsurance),
    fmt(totals.incomeTax),
    fmt(totals.localIncomeTax),
    fmt(computeDeductions(totals)),
    fmt(computeNet(totals)),
  ]);

  autoTable(doc, {
    startY: y,
    head: [[
      { content: 'No', rowSpan: 2 },
      { content: '성명', rowSpan: 2 },
      { content: '지급항목', colSpan: 6 },
      { content: '공제항목', colSpan: 7 },
      { content: '실수령액', rowSpan: 2 },
    ], [
      '기본급', '연장근로', '상여금', '식대', '기타수당', '지급합계',
      '국민연금', '건강보험', '장기요양', '고용보험', '소득세', '지방소득세', '공제합계',
    ]],
    body: bodyRows,
    styles: {
      fontSize: 7,
      cellPadding: 2,
      font: 'NanumGothic',
      halign: 'right',
      lineWidth: 0.1,
      lineColor: [200, 200, 200],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { halign: 'left', cellWidth: 22 },
    },
    headStyles: {
      fillColor: [50, 50, 50],
      textColor: 255,
      halign: 'center',
      fontSize: 7,
    },
    bodyStyles: { textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    didParseCell(data) {
      // Highlight totals row
      if (data.section === 'body' && data.row.index === employees.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 240, 255];
      }
      // Highlight 지급합계 column (index 7) and 공제합계 column (index 14)
      if (data.section === 'body' && (data.column.index === 7 || data.column.index === 14)) {
        data.cell.styles.fontStyle = 'bold';
      }
      // Highlight 실수령액 column (index 15)
      if (data.section === 'body' && data.column.index === 15) {
        data.cell.styles.fontStyle = 'bold';
        if (data.row.index === employees.length) {
          data.cell.styles.fillColor = [255, 245, 235];
        }
      }
    },
    margin: { left: 8, right: 8 },
  });

  // ── Footer ──
  addPageFooter(doc, companyInfo.name, '급여대장');

  const filename = `Payroll_${month.year}${String(month.month).padStart(2, '0')}_${companyInfo.name.replace(/\s/g, '_')}.pdf`;
  doc.save(filename);
  return doc;
}

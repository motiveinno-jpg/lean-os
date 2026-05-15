import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont, setKoreanFont } from './pdf-korean-font';
import type { PayrollItem } from './payment-batch';

async function setupKoreanFont(doc: jsPDF) {
  await loadKoreanFont(doc);
  setKoreanFont(doc, 'normal');
}

export interface PayslipParams {
  item: PayrollItem;
  companyName: string;
  representative?: string;
  periodLabel: string;
  department?: string;
  position?: string;
  paymentDate?: string;
  /** 사원코드 — 더존 Smart-A 양식의 좌상단 사원코드 */
  employeeCode?: string;
  /** 생년월일 YYYY-MM-DD */
  birthDate?: string;
  /** 호봉 */
  payGrade?: string;
  /** 연장근로시간 */
  overtimeHours?: number;
  /** 야간근로시간 */
  nightHours?: number;
  /** 휴일근로시간 */
  holidayHours?: number;
  /** 통상시급(원) */
  hourlyWage?: number;
  /** 추가 지급 항목 (지급내역 6칸 그리드의 추가) */
  extraEarnings?: { label: string; amount: number }[];
  /** 추가 공제 항목 */
  extraDeductions?: { label: string; amount: number }[];
  /** PDF 비밀번호 (생년월일 YYYYMMDD 권장). 설정 시 PDF 열 때 입력 필요. */
  password?: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** YYYY-MM-DD → YYYYMMDD (직원 생년월일을 PDF 비밀번호로 변환) */
export function birthDateToPassword(birthDate: string | null | undefined): string | undefined {
  if (!birthDate) return undefined;
  const digits = String(birthDate).replace(/[^0-9]/g, '');
  if (digits.length < 6) return undefined;
  return digits.slice(0, 8); // YYYYMMDD
}

function formatBirthDate(d: string | undefined): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

function formatPaymentDate(d: string | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  return d.replace(/-/g, '.');
}

// 더존 Smart-A 양식 색상
const COLOR_HEADER_BG: [number, number, number] = [248, 248, 248];      // #f8f8f8 라이트 헤더
const COLOR_LABEL_BG: [number, number, number] = [206, 223, 247];       // #cedff7 좌측 라벨 (지급내역/공제내역)
const COLOR_BORDER: [number, number, number] = [234, 234, 234];          // #eaeaea
const COLOR_DARK_BORDER: [number, number, number] = [177, 197, 219];     // #b1c5db
const COLOR_TEXT: [number, number, number] = [25, 25, 25];
const COLOR_TEXT_DIM: [number, number, number] = [74, 74, 74];
const COLOR_BLUE: [number, number, number] = [28, 144, 251];             // #1c90fb 실수령액 강조

export async function generatePayslipPDF(params: PayslipParams): Promise<jsPDF> {
  const {
    item, companyName, periodLabel, department, position, paymentDate,
    employeeCode, birthDate, payGrade,
    overtimeHours, nightHours, holidayHours, hourlyWage,
    extraEarnings, extraDeductions, password,
  } = params;

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
    ...(password
      ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print', 'modify', 'copy', 'annot-forms'] } }
      : {}),
  } as any);
  await setupKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 18;

  // ── 1) 제목 ──
  doc.setFontSize(15);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(...COLOR_TEXT);
  doc.text(`${periodLabel} 급여명세서`, pageW / 2, y, { align: 'center' });
  y += 8;

  // ── 2) 회사명 + 지급일 (좌/우) ──
  doc.setFontSize(9);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(...COLOR_TEXT_DIM);
  doc.text(`회사명칭  ${companyName}`, margin, y);
  doc.text(`지급일  ${formatPaymentDate(paymentDate)}`, pageW - margin, y, { align: 'right' });
  y += 4;

  // ── 3) 사원정보 박스 ──
  autoTable(doc, {
    startY: y,
    body: [
      [
        { content: '· 사원코드', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        employeeCode || '-',
        { content: '· 사원명', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        item.employeeName,
        { content: '· 생년월일', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        formatBirthDate(birthDate),
      ],
      [
        { content: '· 부서', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        department || '-',
        { content: '· 직급', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        position || '-',
        { content: '· 호봉', styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } },
        payGrade || '-',
      ],
    ],
    theme: 'plain',
    styles: { font: 'NanumGothic', fontSize: 9, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, textColor: COLOR_TEXT_DIM, lineColor: [238, 238, 238], lineWidth: 0.4 },
    columnStyles: {
      0: { cellWidth: 22, textColor: COLOR_TEXT },
      1: { cellWidth: (contentW - 66) / 3 },
      2: { cellWidth: 18, textColor: COLOR_TEXT },
      3: { cellWidth: (contentW - 66) / 3 },
      4: { cellWidth: 22, textColor: COLOR_TEXT },
      5: { cellWidth: (contentW - 66) / 3 },
    },
    margin: { left: margin, right: margin },
    didDrawCell: () => { /* outer border drawn by table */ },
  });
  y = (doc as any).lastAutoTable.finalY + 2;

  // ── 4) 근무시간 / 통상시급 박스 ──
  autoTable(doc, {
    startY: y,
    head: [['연장근로시간', '야간근로시간', '휴일근로시간', '통상시급(원)', '']],
    body: [[
      overtimeHours != null ? `${overtimeHours}` : '',
      nightHours != null ? `${nightHours}` : '',
      holidayHours != null ? `${holidayHours}` : '',
      hourlyWage != null ? fmt(hourlyWage) : '',
      '',
    ]],
    theme: 'grid',
    styles: { font: 'NanumGothic', fontSize: 9, cellPadding: 2.5, halign: 'center', textColor: COLOR_TEXT, lineColor: COLOR_BORDER, lineWidth: 0.2 },
    headStyles: { fillColor: COLOR_HEADER_BG, textColor: COLOR_TEXT_DIM, fontStyle: 'normal' },
    columnStyles: {
      0: { cellWidth: contentW / 5 },
      1: { cellWidth: contentW / 5 },
      2: { cellWidth: contentW / 5 },
      3: { cellWidth: contentW / 5, halign: 'right' },
      4: { cellWidth: contentW / 5 },
    },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 5) 지급내역 / 공제내역 표 (6칸 그리드) ──
  // 지급내역 항목 구성 — 기본급, 식대(비과세 분리) + 추가
  const earnings: { label: string; amount: number }[] = [];
  const taxableBase = item.baseSalary - item.nonTaxableAmount;
  earnings.push({ label: '기본급', amount: taxableBase });
  if (item.nonTaxableAmount > 0) {
    earnings.push({ label: '식대', amount: item.nonTaxableAmount });
  }
  if (extraEarnings) {
    for (const e of extraEarnings) {
      if (e.amount > 0) earnings.push(e);
    }
  }
  // 지급내역 6칸씩 채워서 빈 칸 자동 패딩
  function padToGrid<T extends { label: string; amount: number }>(rows: T[], gridSize = 6): Array<Array<{ label: string; amount: number } | null>> {
    const grid: Array<Array<{ label: string; amount: number } | null>> = [];
    for (let i = 0; i < Math.max(2, Math.ceil(rows.length / gridSize)) * gridSize; i += gridSize) {
      const slice = rows.slice(i, i + gridSize);
      const padded: Array<{ label: string; amount: number } | null> = [];
      for (let j = 0; j < gridSize; j++) padded.push(slice[j] || null);
      grid.push(padded);
    }
    return grid;
  }
  const earningsGrid = padToGrid(earnings);

  // 공제내역
  const deductions: { label: string; amount: number }[] = [];
  if (item.nationalPension > 0) deductions.push({ label: '국민연금', amount: item.nationalPension });
  if (item.healthInsurance > 0) deductions.push({ label: '건강보험', amount: item.healthInsurance });
  if (item.longTermCareInsurance && item.longTermCareInsurance > 0) deductions.push({ label: '장기요양', amount: item.longTermCareInsurance });
  if (item.employmentInsurance > 0) deductions.push({ label: '고용보험', amount: item.employmentInsurance });
  if (item.incomeTax > 0) deductions.push({ label: '소득세', amount: item.incomeTax });
  if (item.localIncomeTax > 0) deductions.push({ label: '지방소득세', amount: item.localIncomeTax });
  if (extraDeductions) {
    for (const d of extraDeductions) {
      if (d.amount > 0) deductions.push(d);
    }
  }
  const deductionsGrid = padToGrid(deductions);

  // 통합 body: 좌측 라벨 셀(rowSpan), 항목명 행 + 금액 행 반복
  function buildSection(label: string, grid: Array<Array<{ label: string; amount: number } | null>>) {
    const rows: any[] = [];
    grid.forEach((row, rowIdx) => {
      // 항목명 행
      const labelRow: any[] = [];
      if (rowIdx === 0) {
        labelRow.push({
          content: label,
          rowSpan: grid.length * 2,
          styles: {
            fillColor: COLOR_LABEL_BG,
            textColor: [51, 51, 85] as [number, number, number],
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle',
            fontSize: 10,
          },
        });
      }
      for (const cell of row) {
        labelRow.push({
          content: cell?.label || '',
          styles: {
            fillColor: COLOR_HEADER_BG,
            textColor: [102, 102, 119] as [number, number, number],
            halign: 'center',
            fontSize: 8.5,
          },
        });
      }
      rows.push(labelRow);
      // 금액 행
      const amountRow: any[] = [];
      for (const cell of row) {
        amountRow.push({
          content: cell ? fmt(cell.amount) : '',
          styles: { halign: 'center', fontSize: 9, textColor: COLOR_TEXT },
        });
      }
      rows.push(amountRow);
    });
    return rows;
  }

  const detailBody = [
    ...buildSection('지급내역', earningsGrid),
    [{ content: '', colSpan: 7, styles: { fillColor: [255, 255, 255], lineWidth: 0, minCellHeight: 1 } }],
    ...buildSection('공제내역', deductionsGrid),
  ];

  autoTable(doc, {
    startY: y,
    body: detailBody,
    theme: 'grid',
    styles: { font: 'NanumGothic', fontSize: 9, cellPadding: 2, lineColor: COLOR_BORDER, lineWidth: 0.15 },
    columnStyles: {
      0: { cellWidth: contentW * 0.16 },
      1: { cellWidth: contentW * 0.14 },
      2: { cellWidth: contentW * 0.14 },
      3: { cellWidth: contentW * 0.14 },
      4: { cellWidth: contentW * 0.14 },
      5: { cellWidth: contentW * 0.14 },
      6: { cellWidth: contentW * 0.14 },
    },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 6) 합계 표 ──
  const earningsTotal = item.baseSalary + (extraEarnings || []).reduce((s, e) => s + (e.amount || 0), 0);
  const deductionsTotal = item.deductionsTotal + (extraDeductions || []).reduce((s, d) => s + (d.amount || 0), 0);
  const netPay = earningsTotal - deductionsTotal;

  autoTable(doc, {
    startY: y,
    body: [
      [
        { content: '합계', rowSpan: 2, styles: { fillColor: [168, 189, 211], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle' as const, fontSize: 10 } },
        { content: '', styles: { fillColor: [231, 231, 231] } },
        { content: '', styles: { fillColor: [231, 231, 231] } },
        { content: '지급총액', styles: { fillColor: [231, 231, 231], textColor: [85, 85, 85], halign: 'center' as const, fontSize: 9 } },
        { content: '공제총액', styles: { fillColor: [231, 231, 231], textColor: [85, 85, 85], halign: 'center' as const, fontSize: 9 } },
        { content: '', styles: { fillColor: [231, 231, 231] } },
        { content: '차인지급액', styles: { fillColor: [231, 231, 231], textColor: [85, 85, 85], halign: 'center' as const, fontSize: 9 } },
      ],
      [
        '', '',
        { content: fmt(earningsTotal), styles: { halign: 'center', fontSize: 10, textColor: COLOR_TEXT } },
        { content: fmt(deductionsTotal), styles: { halign: 'center', fontSize: 10, textColor: COLOR_TEXT } },
        '',
        { content: fmt(netPay), styles: { halign: 'center', fontSize: 11, textColor: COLOR_BLUE, fontStyle: 'bold' } },
      ],
    ],
    theme: 'grid',
    styles: { font: 'NanumGothic', fontSize: 9, cellPadding: 2.5, lineColor: [127, 157, 185], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: contentW * 0.16 },
      1: { cellWidth: contentW * 0.14 },
      2: { cellWidth: contentW * 0.14 },
      3: { cellWidth: contentW * 0.14 },
      4: { cellWidth: contentW * 0.14 },
      5: { cellWidth: contentW * 0.14 },
      6: { cellWidth: contentW * 0.14 },
    },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── 7) 계산방법 (간단히 기본급 + 식대만) ──
  if (taxableBase > 0 || item.nonTaxableAmount > 0) {
    doc.setFontSize(9);
    setKoreanFont(doc, 'bold');
    doc.setTextColor(...COLOR_TEXT);
    doc.text('· 계산방법', margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [['구분', '산출식 또는 산출방법', '지급액']],
      body: [
        ...(taxableBase > 0 ? [['기본급', '월 기본급', fmt(taxableBase)]] : []),
        ...(item.nonTaxableAmount > 0 ? [['식대', '비과세 식대', fmt(item.nonTaxableAmount)]] : []),
      ],
      theme: 'grid',
      styles: { font: 'NanumGothic', fontSize: 9, cellPadding: 2.5, lineColor: COLOR_BORDER, lineWidth: 0.2, textColor: COLOR_TEXT },
      headStyles: { fillColor: COLOR_HEADER_BG, textColor: COLOR_TEXT_DIM, fontStyle: 'normal', halign: 'center' },
      columnStyles: {
        0: { cellWidth: contentW * 0.3, halign: 'center' },
        1: { cellWidth: contentW * 0.4 },
        2: { cellWidth: contentW * 0.3, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── 8) 하단 글 ──
  doc.setFontSize(10);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(...COLOR_TEXT);
  doc.text('귀하의 노고에 감사드립니다.', pageW / 2, y + 5, { align: 'center' });

  return doc;
}

export async function downloadPayslipPDF(params: PayslipParams) {
  const doc = await generatePayslipPDF(params);
  const safeName = params.item.employeeName.replace(/[^\w가-힣]/g, '_');
  doc.save(`급여명세서_${safeName}_${params.periodLabel.replace(/[^\w]/g, '')}.pdf`);
}

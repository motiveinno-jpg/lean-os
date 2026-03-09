/**
 * OwnerView Document Generation Engine
 * PDF 렌더링 + 템플릿 변수 + 문서번호 채번 + 직인 오버레이
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';
import { logAudit } from './audit';
import { loadKoreanFont, setKoreanFont } from './pdf-korean-font';

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface CompanyInfo {
  name: string;
  representative?: string;
  address?: string;
  phone?: string;
  businessNumber?: string;
}

export interface QuoteItem {
  name: string;
  spec?: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface DocTemplate {
  id: string;
  name: string;
  type: string;
  content: string;
  variables: string[];
}

// ────────────────────────────────────────────
// 1. 문서번호 채번
// ────────────────────────────────────────────

/**
 * 문서번호를 자동 채번합니다.
 * Format: {prefix}-YYYYMM-XXXX (예: DOC-202603-0001)
 */
export async function generateDocumentNumber(
  companyId: string,
  prefix = 'DOC',
): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const like = `${prefix}-${ym}-%`;

  const { data } = await db
    .from('documents')
    .select('document_number')
    .eq('company_id', companyId)
    .like('document_number', like)
    .order('document_number', { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0 && data[0].document_number) {
    const last: string = data[0].document_number;
    const parts = last.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}-${ym}-${String(seq).padStart(4, '0')}`;
}

// ────────────────────────────────────────────
// 2. 템플릿 변수 치환
// ────────────────────────────────────────────

/**
 * {{variable_name}} 패턴을 실제 값으로 치환합니다.
 * 지원 변수: company_name, representative, address, business_number,
 *           date, employee_name, department, position 등
 */
export function renderTemplate(
  templateContent: string,
  variables: Record<string, string>,
): string {
  let result = templateContent;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }
  return result;
}

// ────────────────────────────────────────────
// 3. 일반 문서 PDF 생성
// ────────────────────────────────────────────

/**
 * 일반 문서(공문, 확인서, 증명서 등)를 A4 PDF로 생성합니다.
 *
 * NOTE: jsPDF의 기본 helvetica 폰트는 한글을 직접 렌더링하지 못합니다.
 * autoTable을 활용해 테이블 셀에 텍스트를 배치하면 한글이 비교적 잘 표현됩니다.
 * 향후 Pretendard/NotoSansKR 커스텀 폰트를 Base64로 임베드하여 완벽한 한글 렌더링을
 * 지원하는 것을 권장합니다.
 */
export async function generateDocumentPDF(params: {
  title: string;
  content: string;
  companyName: string;
  companyInfo?: {
    address?: string;
    phone?: string;
    businessNumber?: string;
    representative?: string;
  };
  sealUrl?: string;
  applyStamp?: boolean;
  documentNumber?: string;
  issueDate?: string;
}): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 20;

  // ── Header: 회사명 ──
  doc.setFontSize(12);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(params.companyName, 14, y);

  // ── Header: 문서번호 (우측) ──
  if (params.documentNumber) {
    doc.setFontSize(9);
    doc.text(params.documentNumber, pageW - 14, y, { align: 'right' });
  }
  y += 12;

  // ── Title ──
  doc.setFontSize(18);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(params.title, pageW / 2, y, { align: 'center' });
  y += 14;

  // ── 구분선 ──
  doc.setDrawColor(200, 200, 200);
  doc.line(14, y, pageW - 14, y);
  y += 10;

  // ── Body: content를 autoTable로 렌더링 (한글 호환) ──
  const contentLines = params.content.split('\n');
  const bodyRows = contentLines.map((line) => [line]);

  autoTable(doc, {
    startY: y,
    body: bodyRows,
    theme: 'plain',
    styles: {
      fontSize: 10,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      textColor: [40, 40, 40],
      lineWidth: 0,
      font: 'NanumGothic',
    },
    columnStyles: { 0: { cellWidth: pageW - 28 } },
    margin: { left: 14, right: 14 },
    tableLineColor: [255, 255, 255],
    tableLineWidth: 0,
  });

  y = (doc as any).lastAutoTable.finalY + 15;

  // ── 발행일 + 회사 정보 ──
  const issueDate = params.issueDate || new Date().toLocaleDateString('ko-KR');

  // 발행일이 페이지 하단 근처면 새 페이지 추가
  if (y > pageH - 80) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(10);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(60, 60, 60);
  doc.text(issueDate, pageW / 2, y, { align: 'center' });
  y += 10;

  // 회사 정보 블록
  const info = params.companyInfo;
  if (info) {
    const infoLines: string[] = [];
    infoLines.push(params.companyName);
    if (info.address) infoLines.push(info.address);
    if (info.businessNumber) infoLines.push(`사업자등록번호: ${info.businessNumber}`);
    if (info.phone) infoLines.push(`TEL: ${info.phone}`);
    if (info.representative) infoLines.push(`대표이사: ${info.representative}`);

    doc.setFontSize(9);
    for (const line of infoLines) {
      doc.text(line, pageW / 2, y, { align: 'center' });
      y += 5;
    }
  }

  // ── 직인 오버레이 ──
  if (params.applyStamp && params.sealUrl) {
    try {
      const img = await loadImage(params.sealUrl);
      // 직인: 우측 하단 약 30x30mm
      const sealSize = 30;
      const sealX = pageW - 14 - sealSize;
      const sealY = y - 10;
      doc.addImage(img, 'PNG', sealX, sealY, sealSize, sealSize);
    } catch {
      // 직인 이미지 로드 실패 — PDF 생성은 계속 진행
      console.warn('Seal image load failed, skipping stamp overlay');
    }
  }

  // ── 페이지 번호 ──
  addPageNumbers(doc, params.companyName);

  return doc.output('blob');
}

// ────────────────────────────────────────────
// 4. 견적서 PDF 생성
// ────────────────────────────────────────────

/**
 * 한국 표준 견적서 양식의 PDF를 생성합니다.
 */
export async function generateQuotePDF(params: {
  documentNumber: string;
  companyInfo: CompanyInfo;
  counterparty: string;
  items: QuoteItem[];
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  validUntil?: string;
  notes?: string;
  sealUrl?: string;
  managerName?: string;
  managerContact?: string;
  bankInfo?: { bankName: string; accountNumber: string; accountHolder?: string };
  deliveryDate?: string;
}): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  let y = 15;

  // ── Title ──
  doc.setFontSize(20);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('견 적 서', pageW / 2, y, { align: 'center' });
  y += 12;

  // ── 문서번호 + 일자 ──
  doc.setFontSize(9);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text(`No. ${params.documentNumber}`, 14, y);
  doc.text(`Date: ${new Date().toLocaleDateString('ko-KR')}`, pageW - 14, y, { align: 'right' });
  y += 8;

  // ── 발신/수신 정보 ──
  const infoRows: string[][] = [
    ['수 신', `${params.counterparty} 귀하`],
    ['발 신', params.companyInfo.name],
    ['대표이사', params.companyInfo.representative || '-'],
    ['사업자번호', params.companyInfo.businessNumber || '-'],
    ['주 소', params.companyInfo.address || '-'],
    ['연락처', params.companyInfo.phone || '-'],
  ];
  if (params.managerName) infoRows.push(['담 당 자', params.managerName + (params.managerContact ? ` (${params.managerContact})` : '')]);
  autoTable(doc, {
    startY: y,
    body: infoRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, font: 'NanumGothic' },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { cellWidth: pageW - 58 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 합계 금액 강조 ──
  doc.setFillColor(59, 130, 246);
  doc.roundedRect(14, y, pageW - 28, 12, 2, 2, 'F');
  doc.setFontSize(12);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(
    `합계금액:  ${fmtKRW(params.totalAmount)} 원 (VAT 포함)`,
    pageW / 2,
    y + 8,
    { align: 'center' },
  );
  y += 18;

  // ── 품목 테이블 ──
  const tableHead = [['No', '품 명', '규 격', '수 량', '단 가', '금 액']];
  const tableBody = params.items.map((item, idx) => [
    String(idx + 1),
    item.name,
    item.spec || '-',
    fmtNumber(item.qty),
    fmtKRW(item.unitPrice),
    fmtKRW(item.amount),
  ]);

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, halign: 'center', font: 'NanumGothic' },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', font: 'NanumGothic' },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 50, halign: 'left' },
      2: { cellWidth: 30 },
      3: { cellWidth: 20 },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 35, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    alternateRowStyles: { fillColor: [248, 249, 250] },
  });
  y = (doc as any).lastAutoTable.finalY + 2;

  // ── 소계/세액/합계 ──
  autoTable(doc, {
    startY: y,
    body: [
      ['공급가액', `${fmtKRW(params.supplyAmount)} 원`],
      ['부가세 (10%)', `${fmtKRW(params.taxAmount)} 원`],
      ['합계금액', `${fmtKRW(params.totalAmount)} 원`],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, font: 'NanumGothic' },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: 'bold', fillColor: [245, 247, 250], halign: 'center' },
      1: { halign: 'right' },
    },
    margin: { left: pageW - 14 - 100, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 유효기간 + 납품일 + 비고 + 입금계좌 ──
  const noteBody: string[][] = [];
  if (params.validUntil) noteBody.push(['유효기간', params.validUntil]);
  if (params.deliveryDate) noteBody.push(['납품일', params.deliveryDate]);
  if (params.bankInfo) {
    const holder = params.bankInfo.accountHolder ? ` (${params.bankInfo.accountHolder})` : '';
    noteBody.push(['입금계좌', `${params.bankInfo.bankName} ${params.bankInfo.accountNumber}${holder}`]);
  }
  if (params.notes) noteBody.push(['비 고', params.notes]);

  if (noteBody.length > 0) {
    autoTable(doc, {
      startY: y,
      body: noteBody,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3, font: 'NanumGothic' },
      columnStyles: {
        0: { cellWidth: 30, fontStyle: 'bold', fillColor: [245, 247, 250] },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── 직인 오버레이 ──
  if (params.sealUrl) {
    try {
      const img = await loadImage(params.sealUrl);
      const sealSize = 30;
      doc.addImage(img, 'PNG', pageW - 14 - sealSize - 5, y, sealSize, sealSize);
    } catch {
      console.warn('Seal image load failed, skipping stamp overlay');
    }
  }

  // ── 페이지 번호 ──
  addPageNumbers(doc, params.companyInfo.name);

  return doc.output('blob');
}

// ────────────────────────────────────────────
// 5. 문서 발행 (issued 상태 + 잠금)
// ────────────────────────────────────────────

/**
 * 문서를 발행 처리합니다.
 * - 문서번호 자동 채번
 * - status = 'issued', issued_at 기록
 * - 문서 잠금 (locked_at)
 * - 감사 로그 기록
 */
export async function issueDocument(
  documentId: string,
  userId: string,
  companyId: string,
): Promise<void> {
  // 문서번호 채번
  const docNumber = await generateDocumentNumber(companyId);
  const now = new Date().toISOString();

  const { error } = await db
    .from('documents')
    .update({
      document_number: docNumber,
      status: 'issued',
      issued_at: now,
      locked_at: now,
    })
    .eq('id', documentId);

  if (error) throw error;

  await logAudit({
    companyId,
    userId,
    entityType: 'document',
    entityId: documentId,
    action: 'issue',
    afterJson: {
      document_number: docNumber,
      status: 'issued',
      issued_at: now,
      locked_at: now,
    },
  });
}

// ────────────────────────────────────────────
// 6. 기본 제공 템플릿
// ────────────────────────────────────────────

/**
 * OwnerView 기본 제공 문서 템플릿 5종을 반환합니다.
 */
export function getBuiltInTemplates(): DocTemplate[] {
  return [
    // ─ (a) 재직증명서 ─
    {
      id: 'builtin-employment-cert',
      name: '재직증명서',
      type: 'certificate',
      content: `재 직 증 명 서

성    명: {{employee_name}}
소    속: {{department}}
직    위: {{position}}
입 사 일: {{hire_date}}
사원번호: {{employee_number}}
용    도: {{purpose}}

위 사실을 증명합니다.

{{date}}

{{company_name}}
대표이사 {{representative}} (직인)
사업자등록번호: {{business_number}}
주소: {{address}}`,
      variables: [
        'employee_name',
        'department',
        'position',
        'hire_date',
        'employee_number',
        'purpose',
        'date',
        'company_name',
        'representative',
        'business_number',
        'address',
      ],
    },

    // ─ (b) 경력증명서 ─
    {
      id: 'builtin-career-cert',
      name: '경력증명서',
      type: 'certificate',
      content: `경 력 증 명 서

성    명: {{employee_name}}
소    속: {{department}}
직    위: {{position}}
입 사 일: {{hire_date}}
퇴 사 일: {{end_date}}
사원번호: {{employee_number}}
담당업무: {{duties}}
용    도: {{purpose}}

위 사실을 증명합니다.

{{date}}

{{company_name}}
대표이사 {{representative}} (직인)
사업자등록번호: {{business_number}}
주소: {{address}}`,
      variables: [
        'employee_name',
        'department',
        'position',
        'hire_date',
        'end_date',
        'employee_number',
        'duties',
        'purpose',
        'date',
        'company_name',
        'representative',
        'business_number',
        'address',
      ],
    },

    // ─ (c) 견적서 ─
    {
      id: 'builtin-quote',
      name: '견적서',
      type: 'quote',
      content: `견 적 서

수 신: {{counterparty}} 귀하
발 신: {{company_name}}
문서번호: {{document_number}}
견적일자: {{date}}

아래와 같이 견적합니다.

합계금액: {{total_amount}} 원 (VAT 포함)

유효기간: {{valid_until}}
비    고: {{notes}}

{{company_name}}
대표이사 {{representative}} (직인)`,
      variables: [
        'counterparty',
        'company_name',
        'document_number',
        'date',
        'total_amount',
        'valid_until',
        'notes',
        'representative',
      ],
    },

    // ─ (d) 표준계약서 ─
    {
      id: 'builtin-contract',
      name: '표준계약서',
      type: 'contract',
      content: `표 준 계 약 서

계약번호: {{document_number}}
계약일자: {{date}}

"갑" {{company_name}} (사업자등록번호: {{business_number}})
     대표이사: {{representative}}
     주소: {{address}}

"을" {{counterparty_name}} (사업자등록번호: {{counterparty_business_number}})
     대표이사: {{counterparty_representative}}
     주소: {{counterparty_address}}

제1조 (목적)
본 계약은 {{contract_subject}}에 관하여 갑과 을 사이의 권리 의무를 규정함을 목적으로 한다.

제2조 (계약기간)
{{contract_start_date}} ~ {{contract_end_date}}

제3조 (계약금액)
금 {{contract_amount}} 원정 (부가가치세 별도)

제4조 (대금지급)
{{payment_terms}}

제5조 (기밀유지)
계약 당사자는 본 계약의 이행과정에서 취득한 상대방의 기밀정보를 제3자에게 누설하지 아니한다.

제6조 (분쟁해결)
본 계약에 관한 분쟁은 갑의 소재지 관할법원을 제1심 법원으로 한다.

본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하고, 갑·을이 각각 서명 날인한 후 각 1통씩 보관한다.

{{date}}

"갑" {{company_name}}  대표이사 {{representative}} (인)
"을" {{counterparty_name}}  대표이사 {{counterparty_representative}} (인)`,
      variables: [
        'document_number',
        'date',
        'company_name',
        'business_number',
        'representative',
        'address',
        'counterparty_name',
        'counterparty_business_number',
        'counterparty_representative',
        'counterparty_address',
        'contract_subject',
        'contract_start_date',
        'contract_end_date',
        'contract_amount',
        'payment_terms',
      ],
    },

    // ─ (e) 지출결의서 ─
    {
      id: 'builtin-expense-report',
      name: '지출결의서',
      type: 'expense',
      content: `지 출 결 의 서

결의번호: {{document_number}}
결 의 일: {{date}}
부    서: {{department}}
작 성 자: {{employee_name}}
직    위: {{position}}

지출 목적: {{expense_purpose}}
지출 금액: {{expense_amount}} 원
지급 방법: {{payment_method}}
지급 대상: {{payee}}
비    고: {{notes}}

위와 같이 지출을 결의합니다.

작성자: {{employee_name}} (서명)
부서장: {{approver_name}} (서명)
대표이사: {{representative}} (서명)

{{company_name}}`,
      variables: [
        'document_number',
        'date',
        'department',
        'employee_name',
        'position',
        'expense_purpose',
        'expense_amount',
        'payment_method',
        'payee',
        'notes',
        'approver_name',
        'representative',
        'company_name',
      ],
    },
  ];
}

// ────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────

/** 이미지 URL을 HTMLImageElement 또는 data URL로 로드 */
async function loadImage(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 숫자를 한국 원화 형식으로 포맷 */
function fmtKRW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}${abs.toLocaleString('ko-KR')}`;
}

/** 숫자를 천 단위 콤마로 포맷 */
function fmtNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

/** 모든 페이지에 페이지 번호 추가 */
function addPageNumbers(doc: jsPDF, companyName: string) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    setKoreanFont(doc, 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(
      `OwnerView Document  |  ${companyName}  |  Page ${i}/${pageCount}`,
      pageW / 2,
      pageH - 8,
      { align: 'center' },
    );
  }
}

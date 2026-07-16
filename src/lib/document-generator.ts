import { logRead } from "@/lib/log-read";
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
const db = supabase;

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

  const data = logRead('lib/document-generator:data', await db
    .from('documents')
    .select('document_number')
    .eq('company_id', companyId)
    .like('document_number', like)
    .order('document_number', { ascending: false })
    .limit(1));

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
  // 서명 정보 — 본문 끝에 서명자명 + 서명 이미지(또는 타이핑된 이름) 렌더
  signatures?: Array<{
    signerName: string;
    signatureType: 'draw' | 'type';
    signatureData: string; // 'draw' 면 base64 PNG dataURL, 'type' 면 이름 문자열
    signedAt: string;
    documentTitle?: string;
  }>;
  // Flex 서명 푸터에 표시할 추가 정보
  signerBirthDate?: string; // YYYY-MM-DD
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

  // ── 서명 블록 (Flex 스타일 가로 5열) ──
  if (params.signatures && params.signatures.length > 0) {
    let sealImg: string | null = null;
    if (params.sealUrl) {
      try { sealImg = await loadImage(params.sealUrl); } catch { sealImg = null; }
    }
    for (const sig of params.signatures) {
      // 푸터 약 50mm 높이 — 페이지 끝이면 새 페이지
      if (y > pageH - 70) {
        doc.addPage();
        y = 20;
      }

      // 구분선
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(14, y, pageW - 14, y);
      y += 8;

      // 5 컬럼 폭 정의
      const colW = (pageW - 28) / 5;
      const colX = (i: number) => 14 + colW * i;

      // 날짜 포맷
      const fmtDate = (d: string): string => {
        const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : new Date(d).toLocaleDateString('ko-KR');
      };

      const labelColor: [number, number, number] = [120, 120, 120];
      const valueColor: [number, number, number] = [30, 30, 30];

      // 1열 — 계약일
      doc.setFontSize(9);
      setKoreanFont(doc, 'normal');
      doc.setTextColor(...valueColor);
      doc.text(fmtDate(sig.signedAt), colX(0), y + 4);

      // 2열 — 회사 라벨 (회사명/직위·성명/서명)
      doc.setFontSize(8.5);
      doc.setTextColor(...labelColor);
      doc.text('회사명(A)', colX(1), y + 4);
      doc.text('직위/성명(A)', colX(1), y + 10);
      doc.text('서명(인)', colX(1), y + 25);

      // 3열 — 회사 값 + 직인
      doc.setFontSize(9);
      setKoreanFont(doc, 'bold');
      doc.setTextColor(...valueColor);
      doc.text(params.companyName || '', colX(2) + colW / 2 - 5, y + 4, { align: 'center', maxWidth: colW });
      setKoreanFont(doc, 'normal');
      // 대표자 — 옵션. companyInfo.representative 가 있다면 사용.
      const rep = (params.companyInfo as { representative?: string } | undefined)?.representative;
      doc.text(rep ? `대표 / ${rep}` : '대표 / —', colX(2) + colW / 2 - 5, y + 10, { align: 'center', maxWidth: colW });
      if (sealImg) {
        try {
          const sealSize = 20;
          doc.addImage(sealImg, 'PNG', colX(2) + colW / 2 - sealSize / 2 - 5, y + 16, sealSize, sealSize);
        } catch (e) {
          console.warn('Seal embed failed:', e);
        }
      }

      // 4열 — 사원 라벨
      doc.setFontSize(8.5);
      doc.setTextColor(...labelColor);
      doc.text('생년월일(B)', colX(3), y + 4);
      doc.text('성명(B)', colX(3), y + 10);
      doc.text('서명(인)', colX(3), y + 25);

      // 5열 — 사원 값 + 서명
      const empBirth = params.signerBirthDate || '';
      doc.setFontSize(9);
      setKoreanFont(doc, 'bold');
      doc.setTextColor(...valueColor);
      doc.text(empBirth ? fmtDate(empBirth) : '—', colX(4) + colW - 4, y + 4, { align: 'right' });
      doc.text(sig.signerName, colX(4) + colW - 4, y + 10, { align: 'right' });

      // 서명 이미지/텍스트
      if (sig.signatureType === 'draw' && sig.signatureData?.startsWith('data:image')) {
        try {
          const sigW = 32;
          const sigH = 18;
          doc.addImage(sig.signatureData, 'PNG', colX(4) + colW - sigW - 4, y + 16, sigW, sigH);
        } catch (e) {
          console.warn('Signature image embed failed:', e);
        }
      } else if (sig.signatureType === 'type') {
        doc.setFontSize(14);
        setKoreanFont(doc, 'bold');
        doc.setTextColor(...valueColor);
        doc.text(sig.signatureData, colX(4) + colW - 4, y + 30, { align: 'right' });
      }

      y += 44;
    }
  }

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
  counterpartyInfo?: {
    representative?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    address?: string;
  };
  items: QuoteItem[];
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  validUntil?: string;
  notes?: string;
  sealUrl?: string;
  managerName?: string;
  managerContact?: string;
  siteUrl?: string;
  title?: string;
  bankInfo?: { bankName: string; accountNumber: string; accountHolder?: string };
  deliveryDate?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
}): Promise<Blob> {
  // 참조 양식(팩트시트 마케팅 견적서) 스타일 — 가로 A4, 주황/살구 테마, 양자 헤더 + 견적가 박스 + 안내 박스
  const doc = new jsPDF('l', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();   // 297mm
  const M = 14;                                      // 좌우 여백
  const usableW = pageW - M * 2;                     // 269mm
  const ORANGE: [number, number, number] = [237, 125, 49];   // 섹션 헤더(견적 의뢰 기업/제안사/견적가)
  const PEACH: [number, number, number] = [252, 228, 214];   // 라벨 셀 / 품목 헤더 / Total
  const PEACH_LT: [number, number, number] = [253, 242, 236]; // 하단 안내 박스
  const DARK: [number, number, number] = [40, 40, 40];       // 본문 텍스트
  const baseStyles: any = { fontSize: 9, cellPadding: 2.2, font: 'NanumGothic', lineColor: [205, 205, 205], lineWidth: 0.1, textColor: DARK };
  let y = 12;

  // ── 제목 박스 ──
  const titleText = params.title || '견 적 서';
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.6);
  doc.rect(M, y, usableW, 14);
  doc.setFontSize(18);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(titleText, pageW / 2, y + 9.5, { align: 'center' });
  y += 14 + 4;

  // ── 견적No. (우측 정렬) — 문서함·목록과 동일한 고정 채번. 혼동 방지 ──
  if (params.documentNumber && params.documentNumber !== '-') {
    doc.setFontSize(9);
    setKoreanFont(doc, 'normal');
    doc.setTextColor(90, 90, 90);
    doc.text(`견적No. ${params.documentNumber}`, pageW - M, y, { align: 'right' });
    y += 5;
  }

  // ── 양자 헤더 (견적 의뢰 기업 | 제안사) ──
  const colGap = 7;
  const halfW = (usableW - colGap) / 2;
  const labelW = 26;
  const headerStartY = y;
  const ci = params.counterpartyInfo || {};

  // 좌: 견적 의뢰 기업 (거래처) — 값이 빈 칸은 행 자체를 그리지 않는다
  const ciRows: any[] = [['회사명', params.counterparty || '-']];
  if (ci.representative) ciRows.push(['대표자', ci.representative]);
  if (ci.contactName) ciRows.push(['담당자', ci.contactName]);
  if (ci.contactPhone) ciRows.push(['전화번호', ci.contactPhone]);
  if (ci.contactEmail) ciRows.push(['이메일', ci.contactEmail]);
  if (ci.address) ciRows.push(['회사주소', ci.address]);
  autoTable(doc, {
    startY: headerStartY,
    margin: { left: M },
    tableWidth: halfW,
    head: [[{ content: '견적 의뢰 기업', colSpan: 2, styles: { fillColor: ORANGE, textColor: 255, halign: 'center', fontStyle: 'bold' } }]],
    body: ciRows,
    theme: 'grid',
    styles: baseStyles,
    columnStyles: {
      0: { cellWidth: labelW, fillColor: PEACH, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: halfW - labelW },
    },
  });
  const leftFinalY = (doc as any).lastAutoTable.finalY;

  // 우: 제안사 (자사)
  const rightX = M + halfW + colGap;
  const supRows: any[] = [['회사명', params.companyInfo.name || '-']];
  if (params.companyInfo.representative) supRows.push(['대표자', params.companyInfo.representative]);
  if (params.siteUrl) supRows.push(['사이트 URL', params.siteUrl]);
  if (params.managerName) supRows.push(['담당자', params.managerName]);
  if (params.companyInfo.phone) supRows.push(['전화번호', params.companyInfo.phone]);
  if (params.managerContact) supRows.push(['이메일', params.managerContact]);
  if (params.companyInfo.address) supRows.push(['회사주소', params.companyInfo.address]);
  autoTable(doc, {
    startY: headerStartY,
    margin: { left: rightX },
    tableWidth: halfW,
    head: [[{ content: '제안사', colSpan: 2, styles: { fillColor: ORANGE, textColor: 255, halign: 'center', fontStyle: 'bold' } }]],
    body: supRows,
    theme: 'grid',
    styles: baseStyles,
    columnStyles: {
      0: { cellWidth: labelW, fillColor: PEACH, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: halfW - labelW },
    },
  });
  const rightFinalY = (doc as any).lastAutoTable.finalY;

  // 직인 오버레이 (제안사 영역 우상단)
  if (params.sealUrl) {
    try {
      const img = await loadImage(params.sealUrl);
      const s = 24;
      doc.addImage(img, 'PNG', pageW - M - s - 2, headerStartY + 9, s, s);
    } catch {
      console.warn('Seal image load failed, skipping stamp overlay');
    }
  }

  y = Math.max(leftFinalY, rightFinalY) + 6;

  // ── 품목 테이블 (수량·단가 유지) ──
  const tableHead = [['구분', '품 목', '규 격', '수 량', '단 가', '공급가액']];
  const tableBody = params.items.map((item, idx) => [
    String(idx + 1),
    item.name || '',
    item.spec || '',
    fmtNumber(item.qty),
    fmtKRW(item.unitPrice),
    fmtKRW(item.amount),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: tableHead,
    body: tableBody,
    foot: [[
      { content: 'Total', colSpan: 5, styles: { fillColor: PEACH, fontStyle: 'bold', halign: 'center', textColor: DARK } },
      { content: fmtKRW(params.supplyAmount), styles: { fillColor: PEACH, fontStyle: 'bold', halign: 'right', textColor: DARK } },
    ]],
    theme: 'grid',
    styles: { ...baseStyles, halign: 'center' },
    headStyles: { fillColor: PEACH, textColor: DARK, fontStyle: 'bold', halign: 'center', font: 'NanumGothic' },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { halign: 'left' },
      2: { halign: 'left', cellWidth: 52 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 40, halign: 'right' },
      5: { cellWidth: 44, halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 견적가 박스 (우측 정렬) ──
  const boxW = 95;
  autoTable(doc, {
    startY: y,
    margin: { left: pageW - M - boxW },
    tableWidth: boxW,
    head: [[{ content: '견 적 가', colSpan: 2, styles: { fillColor: ORANGE, textColor: 255, halign: 'center', fontStyle: 'bold' } }]],
    body: [
      [{ content: '공 급 가', styles: { fillColor: PEACH, fontStyle: 'bold', halign: 'center' } }, { content: fmtKRW(params.supplyAmount), styles: { halign: 'right' } }],
      [{ content: '부 가 세', styles: { fillColor: PEACH, fontStyle: 'bold', halign: 'center' } }, { content: fmtKRW(params.taxAmount), styles: { halign: 'right' } }],
      [{ content: '최종금액', styles: { fillColor: PEACH, fontStyle: 'bold', halign: 'center' } }, { content: fmtKRW(params.totalAmount), styles: { halign: 'right', fontStyle: 'bold' } }],
    ],
    theme: 'grid',
    styles: baseStyles,
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: boxW - 40 } },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 하단 안내(비고) 박스 ──
  const noteLines: string[] = [];
  if (params.notes) params.notes.split('\n').forEach((l) => { if (l.trim()) noteLines.push(l.trim()); });
  if (params.validUntil) noteLines.push(`유효기간: ${params.validUntil}`);
  if (params.paymentTerms) noteLines.push(`결제조건: ${params.paymentTerms}`);
  if (params.deliveryTerms) noteLines.push(`납품조건: ${params.deliveryTerms}`);
  if (params.deliveryDate) noteLines.push(`납품일: ${params.deliveryDate}`);
  if (params.bankInfo) {
    const holder = params.bankInfo.accountHolder ? ` (${params.bankInfo.accountHolder})` : '';
    noteLines.push(`입금계좌: ${params.bankInfo.bankName} ${params.bankInfo.accountNumber}${holder}`);
  }
  if (noteLines.length > 0) {
    const lineH = 5;
    const boxH = noteLines.length * lineH + 5;
    doc.setFillColor(PEACH_LT[0], PEACH_LT[1], PEACH_LT[2]);
    doc.setDrawColor(230, 200, 180);
    doc.setLineWidth(0.2);
    doc.rect(M, y, usableW, boxH, 'FD');
    doc.setFontSize(8.5);
    setKoreanFont(doc, 'normal');
    doc.setTextColor(90, 70, 55);
    noteLines.forEach((l, i) => doc.text(l, M + 3, y + 5.5 + i * lineH));
    y += boxH;
  }

  // ── 페이지 번호 ──
  addPageNumbers(doc, params.companyInfo.name);

  return doc.output('blob');
}

// ────────────────────────────────────────────
// 4-B. 세금계산서 PDF 생성 (한국 표준 양식)
// ────────────────────────────────────────────

export interface TaxInvoicePdfParams {
  invoiceNumber: string;
  issueDate: string;
  type: 'sales' | 'purchase';
  // 공급자
  supplier: {
    name: string;
    representative?: string;
    businessNumber?: string;
    address?: string;
    businessType?: string;
    businessCategory?: string;
  };
  // 공급받는자
  buyer: {
    name: string;
    representative?: string;
    businessNumber?: string;
    address?: string;
    businessType?: string;
    businessCategory?: string;
  };
  // 금액
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  // 품목 (선택)
  items?: {
    date: string;
    name: string;
    spec?: string;
    qty: number;
    unitPrice: number;
    amount: number;
    taxAmount: number;
  }[];
  // 비고
  notes?: string;
  sealUrl?: string;
}

export async function generateTaxInvoicePdf(params: TaxInvoicePdfParams): Promise<Blob> {
  const doc = new jsPDF('l', 'mm', 'a4'); // 가로 방향 (한국 세금계산서 표준)
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 12;

  // ── 제목 ──
  doc.setFontSize(18);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(30, 30, 30);
  const title = params.type === 'sales' ? '세 금 계 산 서 (공급자 보관용)' : '세 금 계 산 서 (공급받는자 보관용)';
  doc.text(title, pageW / 2, y, { align: 'center' });
  y += 10;

  // ── 등록번호 + 발행일 ──
  doc.setFontSize(9);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text(`No. ${params.invoiceNumber}`, 14, y);
  doc.text(`발행일: ${params.issueDate}`, pageW - 14, y, { align: 'right' });
  y += 6;

  // ── 공급자 / 공급받는자 정보 (좌우 분할) ──
  const halfW = (pageW - 28) / 2 - 2;

  // 공급자 (좌)
  const supplierRows: string[][] = [
    ['사업자번호', params.supplier.businessNumber || '-'],
    ['상 호', params.supplier.name],
    ['대 표 자', params.supplier.representative || '-'],
    ['주 소', params.supplier.address || '-'],
    ['업 태', params.supplier.businessType || '-'],
    ['종 목', params.supplier.businessCategory || '-'],
  ];

  autoTable(doc, {
    startY: y,
    head: [['공 급 자', '']],
    body: supplierRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, font: 'NanumGothic' },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', font: 'NanumGothic', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { cellWidth: halfW - 28 },
    },
    margin: { left: 14, right: pageW - 14 - halfW },
    tableWidth: halfW,
  });

  // 공급받는자 (우)
  const buyerRows: string[][] = [
    ['사업자번호', params.buyer.businessNumber || '-'],
    ['상 호', params.buyer.name],
    ['대 표 자', params.buyer.representative || '-'],
    ['주 소', params.buyer.address || '-'],
    ['업 태', params.buyer.businessType || '-'],
    ['종 목', params.buyer.businessCategory || '-'],
  ];

  autoTable(doc, {
    startY: y,
    head: [['공급받는자', '']],
    body: buyerRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, font: 'NanumGothic' },
    headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold', font: 'NanumGothic', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { cellWidth: halfW - 28 },
    },
    margin: { left: 14 + halfW + 4, right: 14 },
    tableWidth: halfW,
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 합계 금액 ──
  autoTable(doc, {
    startY: y,
    body: [
      ['공급가액', `${fmtKRW(params.supplyAmount)} 원`, '세 액', `${fmtKRW(params.taxAmount)} 원`, '합계금액', `${fmtKRW(params.totalAmount)} 원`],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, halign: 'center', font: 'NanumGothic' },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 25 },
      1: { halign: 'right', cellWidth: (pageW - 28 - 75) / 3 },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 25 },
      3: { halign: 'right', cellWidth: (pageW - 28 - 75) / 3 },
      4: { fontStyle: 'bold', fillColor: [59, 130, 246], textColor: [255, 255, 255], cellWidth: 25 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: (pageW - 28 - 75) / 3 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 품목 테이블 ──
  const items = params.items && params.items.length > 0
    ? params.items
    : [{ date: params.issueDate, name: '용역', spec: '-', qty: 1, unitPrice: params.supplyAmount, amount: params.supplyAmount, taxAmount: params.taxAmount }];

  const itemHead = [['월/일', '품 목', '규 격', '수 량', '단 가', '공급가액', '세 액', '비 고']];
  const itemBody = items.map(item => [
    item.date.length > 7 ? item.date.slice(5) : item.date,
    item.name,
    item.spec || '-',
    fmtNumber(item.qty),
    fmtKRW(item.unitPrice),
    fmtKRW(item.amount),
    fmtKRW(item.taxAmount),
    '',
  ]);

  autoTable(doc, {
    startY: y,
    head: itemHead,
    body: itemBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5, halign: 'center', font: 'NanumGothic' },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', font: 'NanumGothic' },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 55, halign: 'left' },
      2: { cellWidth: 25 },
      3: { cellWidth: 18 },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 35, halign: 'right' },
      6: { cellWidth: 30, halign: 'right' },
      7: { halign: 'left' },
    },
    margin: { left: 14, right: 14 },
    alternateRowStyles: { fillColor: [248, 249, 250] },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── 비고 ──
  if (params.notes) {
    doc.setFontSize(8);
    setKoreanFont(doc, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`비고: ${params.notes}`, 14, y);
    y += 6;
  }

  // ── 직인 ──
  if (params.sealUrl) {
    try {
      const img = await loadImage(params.sealUrl);
      const sealSize = 25;
      doc.addImage(img, 'PNG', pageW / 4 - sealSize / 2, y, sealSize, sealSize);
    } catch {
      // skip
    }
  }

  // ── 하단 안내 ──
  doc.setFontSize(7);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text('이 세금계산서는 OwnerView에서 발행되었습니다. 법적 효력이 있는 전자세금계산서는 국세청 홈택스를 통해 발행하세요.', pageW / 2, pageH - 8, { align: 'center' });

  addPageNumbers(doc, params.supplier.name);
  return doc.output('blob');
}

// ────────────────────────────────────────────
// 4.5 결재 문서 PDF (승인 완료 결재 요청)
// ────────────────────────────────────────────

export interface ApprovalPdfParams {
  title: string;
  requestTypeLabel: string;
  statusLabel: string;
  requesterName: string;
  amount: number;
  description?: string;
  createdAt: string; // yyyy-mm-dd 또는 ISO
  companyName?: string;
  formFields?: { label: string; value: string }[]; // 커스텀 결재 양식 구조화 필드 — 화면과 동일 순서로 표시
  attachments?: { name: string; url: string }[]; // url: 클릭 시 열람 가능한(서명된) 링크
  steps: {
    stage: number;
    stageName: string;
    approverName: string;
    statusLabel: string;
    comment?: string;
    decidedAt: string | null; // 표시용 포맷 완료 문자열
  }[];
}

export async function generateApprovalPdf(params: ApprovalPdfParams): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 16;

  // ── 제목 ──
  doc.setFontSize(18);
  setKoreanFont(doc, 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('결 재 문 서', pageW / 2, y, { align: 'center' });
  y += 10;

  // ── 기본 정보 테이블 ──
  autoTable(doc, {
    startY: y,
    body: [
      ['문서종류', params.requestTypeLabel, '상태', params.statusLabel],
      ['제목', params.title, '기안자', params.requesterName],
      ['기안일', params.createdAt, '금액', params.amount ? `${fmtKRW(params.amount)} 원` : '-'],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, font: 'NanumGothic' },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 24 },
      1: { cellWidth: 72 },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 24 },
      3: { cellWidth: 62 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ── 구조화 필드 (커스텀 결재 양식) — 화면 표시와 동일하게 내용보다 먼저 ──
  if (params.formFields && params.formFields.length > 0) {
    autoTable(doc, {
      startY: y,
      body: params.formFields.map((f) => [f.label, f.value]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3, font: 'NanumGothic' },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 32 },
        1: { cellWidth: pageW - 28 - 32 },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── 내용 (줄간격 넓게 — 가독성) ──
  if (params.description) {
    doc.setFontSize(9);
    setKoreanFont(doc, 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('내용', 14, y);
    y += 6;
    setKoreanFont(doc, 'normal');
    doc.setTextColor(40, 40, 40);
    const lineHeight = 6; // mm — 기본보다 넓은 줄간격
    const lines: string[] = doc.splitTextToSize(params.description, pageW - 28);
    lines.forEach((line, i) => doc.text(line, 14, y + i * lineHeight));
    y += lines.length * lineHeight + 6;
  }

  // ── 첨부파일 (클릭 시 열람 가능한 링크) ──
  if (params.attachments && params.attachments.length > 0) {
    doc.setFontSize(9);
    setKoreanFont(doc, 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('첨부파일', 14, y);
    y += 6;
    setKoreanFont(doc, 'normal');
    doc.setTextColor(37, 99, 235);
    const lineHeight = 6;
    params.attachments.forEach((att, i) => {
      const label = `📎 ${att.name}`;
      doc.textWithLink(label, 14, y + i * lineHeight, { url: att.url });
    });
    y += params.attachments.length * lineHeight + 4;
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('* 첨부파일 링크는 문서 생성 시점 기준 1시간 동안 유효합니다.', 14, y);
    y += 6;
  }

  // ── 결재 라인 ──
  if (params.steps.length > 0) {
    doc.setFontSize(9);
    setKoreanFont(doc, 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('결재 라인', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['단계', '결재자', '상태', '의견', '처리일시']],
      body: params.steps.map((s) => [
        `${s.stage}. ${s.stageName}`,
        s.approverName,
        s.statusLabel,
        s.comment || '-',
        s.decidedAt || '대기 중',
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, font: 'NanumGothic' },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', font: 'NanumGothic', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 28 },
        2: { cellWidth: 20, halign: 'center' },
        3: { cellWidth: 58 },
        4: { cellWidth: 36 },
      },
      margin: { left: 14, right: 14 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── 하단 안내 ──
  doc.setFontSize(7);
  setKoreanFont(doc, 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text('이 문서는 OwnerView 결재 시스템에서 생성되었습니다.', pageW / 2, pageH - 8, { align: 'center' });

  addPageNumbers(doc, params.companyName || '');
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

    // ─ (d) 표준계약서 (16조 상세) ─
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

갑과 을은 아래 사항에 대하여 상호 합의하에 본 계약을 체결한다.

제1조 (계약목적)
본 계약은 {{contract_subject}}(이하 "본 건"이라 한다)에 관하여 갑과 을 사이의 권리·의무 관계를 명확히 규정함을 목적으로 한다.

제2조 (계약기간)
① 본 계약의 유효기간은 {{contract_start_date}}부터 {{contract_end_date}}까지로 한다.
② 계약기간 만료 1개월 전까지 쌍방 이의가 없는 경우 동일 조건으로 1년간 자동 연장되며, 이후에도 같다.

제3조 (계약금액)
① 본 계약의 대금은 금 {{contract_amount}} 원정(부가가치세 별도)으로 한다.
② 부가가치세는 관련 법령에 따라 별도 청구하며, 세금계산서 발행을 원칙으로 한다.

제4조 (납품 및 인도)
① 을은 {{delivery_deadline}}까지 본 건의 결과물(이하 "납품물"이라 한다)을 갑에게 납품·인도한다.
② 납품 장소는 갑이 지정한 장소로 하며, 납품에 소요되는 비용은 을이 부담한다.
③ 을은 납품 시 납품명세서를 첨부하여야 한다.

제5조 (검수)
① 갑은 납품일로부터 {{inspection_period}} 이내에 납품물의 수량·품질·규격 등을 검수하여야 한다.
② 검수 결과 하자가 발견된 경우 갑은 을에게 보완, 교체 또는 재납품을 요구할 수 있으며, 을은 지체 없이 이에 응하여야 한다.
③ 검수 기간 내 갑이 별도의 이의를 제기하지 아니한 경우 검수에 합격한 것으로 본다.

제6조 (대금지급)
① {{payment_terms}}
② 갑은 을이 적법한 세금계산서를 발행한 날로부터 30일 이내에 대금을 지급한다.
③ 갑의 귀책사유로 지급이 지연되는 경우 연 이율 5%의 지연이자를 가산하여 지급한다.

제7조 (하자보수)
① 을은 납품물에 대하여 검수 완료일로부터 {{warranty_period}} 동안 하자보수 책임을 진다.
② 하자보수 기간 중 을의 귀책사유로 발생한 하자에 대하여 을은 무상으로 보수 또는 교체하여야 한다.
③ 을이 하자보수 요청을 받은 날로부터 7영업일 이내에 보수를 개시하지 않는 경우 갑은 제3자에게 보수를 의뢰하고 그 비용을 을에게 청구할 수 있다.

제8조 (지체상금)
① 을이 납품기한을 초과하여 이행하는 경우 지체일수 1일당 계약금액의 {{late_penalty_rate}}%에 해당하는 금액을 지체상금으로 갑에게 납부하여야 한다.
② 지체상금의 총액은 계약금액의 10%를 초과하지 아니한다.
③ 불가항력 사유에 해당하는 경우에는 지체상금을 면제한다.

제9조 (손해배상)
① 갑 또는 을이 본 계약상의 의무를 위반하여 상대방에게 손해를 끼친 경우 이를 배상하여야 한다.
② 손해배상의 범위는 통상 손해에 한하되, 특별한 사정으로 인한 손해는 채무자가 그 사정을 알았거나 알 수 있었을 때에 한하여 배상한다.
③ 본 조의 손해배상 청구권은 손해 발생 사실을 안 날로부터 1년, 손해 발생일로부터 3년 이내에 행사하여야 한다.

제10조 (권리·의무의 양도 금지)
갑과 을은 상대방의 사전 서면 동의 없이 본 계약상의 권리·의무의 전부 또는 일부를 제3자에게 양도하거나 담보로 제공할 수 없다.

제11조 (불가항력)
① 천재지변, 전쟁, 내란, 법령의 개폐, 정부의 행위, 전염병, 파업 기타 당사자의 통제 범위를 벗어나는 사유(이하 "불가항력"이라 한다)로 인하여 본 계약을 이행할 수 없는 경우 그 책임을 면한다.
② 불가항력 사유가 발생한 당사자는 즉시 상대방에게 서면으로 통지하고, 그 사유가 종료된 후 지체 없이 계약 이행을 재개하여야 한다.

제12조 (비밀유지)
① 갑과 을은 본 계약의 체결 및 이행과정에서 취득한 상대방의 기밀정보(기술정보, 영업정보, 고객정보 등)를 제3자에게 누설하거나 본 계약 목적 외의 용도로 사용하지 아니한다.
② 비밀유지 의무는 본 계약 종료 후에도 3년간 존속한다.
③ 법령에 의한 공개 의무가 있는 경우 또는 상대방의 서면 동의를 얻은 경우에는 예외로 한다.

제13조 (계약해지)
① 갑 또는 을이 다음 각 호에 해당하는 경우 상대방은 서면 통지로써 본 계약을 해지할 수 있다.
  1. 본 계약상의 중대한 의무를 위반하고 서면 최고 후 14일 이내에 시정하지 않는 경우
  2. 파산, 회생 절차 개시, 해산 결의 등으로 정상적인 계약 이행이 곤란한 경우
  3. 어음·수표의 부도 등으로 지급불능 상태에 빠진 경우
② 계약 해지 시 기 수행된 부분에 대하여는 상호 정산하여 처리한다.
③ 계약 해지는 이미 발생한 손해배상 청구권에 영향을 미치지 아니한다.

제14조 (분쟁해결)
① 본 계약에 관한 분쟁은 갑과 을이 성실히 협의하여 해결한다.
② 협의가 이루어지지 아니하는 경우 갑의 본점 소재지를 관할하는 법원을 제1심 관할법원으로 한다.

제15조 (기타)
① 본 계약에 정하지 아니한 사항은 상관례 및 민법, 상법 등 관련 법령에 따른다.
② 본 계약의 변경은 갑과 을의 서면 합의에 의하여야 하며, 구두 합의는 효력이 없다.
③ 본 계약의 어느 조항이 무효 또는 집행 불가능하더라도 나머지 조항의 유효성에는 영향을 미치지 아니한다.

제16조 (특약사항)
{{special_terms}}

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
        'delivery_deadline',
        'inspection_period',
        'warranty_period',
        'late_penalty_rate',
        'payment_terms',
        'special_terms',
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
// 7. 계약서 PDF (HTML 렌더링 방식)
// ────────────────────────────────────────────

export interface ContractPartyInfo {
  name: string;
  representative?: string;
  businessNumber?: string;
  address?: string;
  phone?: string;
}

export interface ContractPDFParams {
  documentNumber: string;
  date: string;
  partyA: ContractPartyInfo;
  partyB: ContractPartyInfo;
  contractAmount: number;
  taxAmount: number;
  totalAmount: number;
  items: Array<{ name: string; spec?: string; qty: number; unitPrice: number; amount: number }>;
  contractSubject: string;
  contractStartDate: string;
  contractEndDate: string;
  paymentTerms: string;
  deliveryDeadline: string;
  inspectionPeriod: string;
  warrantyPeriod: string;
  latePenaltyRate: string;
  specialTerms?: string;
  sealUrlA?: string;
  sealUrlB?: string;
}

/**
 * A4 계약서 HTML을 생성합니다.
 *
 * 정적 내보내기 환경(Next.js static export)에서는 서버 사이드 PDF 라이브러리를
 * 사용할 수 없으므로, 인쇄/PDF 변환이 가능한 완전한 HTML 문서를 반환합니다.
 * 브라우저에서 window.print() 또는 html2pdf.js 등으로 PDF 변환이 가능합니다.
 *
 * 16조 상세 계약 조항 포함:
 * 1.계약목적 2.계약기간 3.계약금액 4.납품인도 5.검수 6.대금지급
 * 7.하자보수 8.지체상금 9.손해배상 10.권리의무양도금지 11.불가항력
 * 12.비밀유지 13.계약해지 14.분쟁해결 15.기타 16.특약사항
 */
export function generateContractPDF(params: ContractPDFParams): string {
  const {
    documentNumber,
    date,
    partyA,
    partyB,
    contractAmount,
    taxAmount,
    totalAmount,
    items,
    contractSubject,
    contractStartDate,
    contractEndDate,
    paymentTerms,
    deliveryDeadline,
    inspectionPeriod,
    warrantyPeriod,
    latePenaltyRate,
    specialTerms,
    sealUrlA,
    sealUrlB,
  } = params;

  const fmt = (n: number) => n.toLocaleString('ko-KR');

  // Build items table rows
  const itemRows = items.length > 0
    ? items.map((item, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${escapeHtml(item.name)}</td>
          <td style="text-align:center;">${escapeHtml(item.spec || '-')}</td>
          <td style="text-align:right;">${fmt(item.qty)}</td>
          <td style="text-align:right;">${fmt(item.unitPrice)}</td>
          <td style="text-align:right;">${fmt(item.amount)}</td>
        </tr>`).join('\n')
    : `<tr><td colspan="6" style="text-align:center;color:#999;">품목 없음</td></tr>`;

  const sealImgA = sealUrlA
    ? `<img src="${escapeHtml(sealUrlA)}" alt="갑 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`
    : '<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>';

  const sealImgB = sealUrlB
    ? `<img src="${escapeHtml(sealUrlB)}" alt="을 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`
    : '<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>';

  const endDateText = contractEndDate || '프로젝트 완료 시';
  const deliveryText = deliveryDeadline || '별도 협의';
  const specialTermsHtml = specialTerms
    ? escapeHtml(specialTerms).replace(/\n/g, '<br/>')
    : '해당 없음';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>계약서 - ${escapeHtml(documentNumber)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 10pt;
    line-height: 1.7;
    color: #222;
    background: #fff;
  }
  .contract-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 15mm;
    background: #fff;
  }
  @media print {
    body { background: #fff; }
    .contract-page { padding: 0; margin: 0; width: 100%; }
  }
  .contract-title {
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 12px;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 2px solid #333;
  }
  .doc-meta {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #666;
    margin-bottom: 20px;
  }
  .party-section {
    margin-bottom: 20px;
    padding: 12px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .party-section .party-label {
    font-weight: 700;
    font-size: 11pt;
    color: #1a56db;
    margin-bottom: 4px;
  }
  .party-section .party-detail {
    font-size: 9.5pt;
    color: #444;
    line-height: 1.8;
  }
  .amount-box {
    text-align: center;
    background: #1a56db;
    color: #fff;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13pt;
    font-weight: 700;
    margin: 16px 0;
    letter-spacing: 1px;
  }
  .items-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 20px;
    font-size: 9pt;
  }
  .items-table th {
    background: #1a56db;
    color: #fff;
    padding: 6px 8px;
    font-weight: 600;
    text-align: center;
    border: 1px solid #1a56db;
  }
  .items-table td {
    padding: 5px 8px;
    border: 1px solid #ddd;
  }
  .items-table tr:nth-child(even) td {
    background: #f8f9fa;
  }
  .amount-summary {
    text-align: right;
    margin: 8px 0 20px;
    font-size: 9.5pt;
  }
  .amount-summary .row {
    margin-bottom: 2px;
  }
  .amount-summary .total {
    font-weight: 700;
    font-size: 10.5pt;
    border-top: 1px solid #333;
    padding-top: 4px;
    margin-top: 4px;
  }
  .article {
    margin-bottom: 12px;
    page-break-inside: avoid;
  }
  .article-title {
    font-weight: 700;
    font-size: 10.5pt;
    margin-bottom: 4px;
    color: #1a1a1a;
  }
  .article-body {
    padding-left: 8px;
    font-size: 9.5pt;
    color: #333;
  }
  .article-body p {
    margin-bottom: 3px;
  }
  .signature-block {
    margin-top: 40px;
    page-break-inside: avoid;
  }
  .signature-date {
    text-align: center;
    font-size: 11pt;
    font-weight: 600;
    margin-bottom: 32px;
  }
  .signature-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  .signature-party {
    width: 45%;
  }
  .signature-party .sig-label {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 8px;
  }
  .signature-party .sig-detail {
    font-size: 9pt;
    color: #555;
    line-height: 1.8;
    margin-bottom: 12px;
  }
  .signature-party .sig-line {
    display: flex;
    align-items: center;
    margin-top: 8px;
  }
  .signature-party .sig-line .label {
    font-weight: 600;
    white-space: nowrap;
  }
  .signature-party .sig-line .stamp-area {
    display: inline-block;
    margin-left: 8px;
  }
  .closing-text {
    text-align: center;
    font-size: 9.5pt;
    color: #555;
    margin-top: 24px;
    line-height: 1.8;
  }
  .footer {
    text-align: center;
    font-size: 7pt;
    color: #aaa;
    margin-top: 32px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }
</style>
</head>
<body>
<div class="contract-page">

  <!-- Header -->
  <div class="contract-title">계 약 서</div>
  <div class="doc-meta">
    <span>계약번호: ${escapeHtml(documentNumber)}</span>
    <span>계약일자: ${escapeHtml(date)}</span>
  </div>

  <!-- Party Info -->
  <div class="party-section">
    <div class="party-label">"갑" (위탁자)</div>
    <div class="party-detail">
      상호: ${escapeHtml(partyA.name)}<br/>
      대표이사: ${escapeHtml(partyA.representative || '')}<br/>
      사업자등록번호: ${escapeHtml(partyA.businessNumber || '')}<br/>
      주소: ${escapeHtml(partyA.address || '')}<br/>
      ${partyA.phone ? `연락처: ${escapeHtml(partyA.phone)}<br/>` : ''}
    </div>
  </div>
  <div class="party-section">
    <div class="party-label">"을" (수탁자)</div>
    <div class="party-detail">
      상호: ${escapeHtml(partyB.name)}<br/>
      대표이사: ${escapeHtml(partyB.representative || '')}<br/>
      사업자등록번호: ${escapeHtml(partyB.businessNumber || '')}<br/>
      주소: ${escapeHtml(partyB.address || '')}<br/>
      ${partyB.phone ? `연락처: ${escapeHtml(partyB.phone)}<br/>` : ''}
    </div>
  </div>

  <!-- Contract Amount -->
  <div class="amount-box">
    합계금액: ₩${fmt(totalAmount)} 원 (VAT 포함)
  </div>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:8%;">No</th>
        <th style="width:32%;">품명</th>
        <th style="width:16%;">규격</th>
        <th style="width:10%;">수량</th>
        <th style="width:16%;">단가</th>
        <th style="width:18%;">금액</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <div class="amount-summary">
    <div class="row">공급가액: ₩${fmt(contractAmount)}</div>
    <div class="row">부가가치세(10%): ₩${fmt(taxAmount)}</div>
    <div class="total">합계: ₩${fmt(totalAmount)}</div>
  </div>

  <!-- Contract Articles (16조) -->
  <div class="article">
    <div class="article-title">제1조 (계약목적)</div>
    <div class="article-body">
      <p>본 계약은 "${escapeHtml(contractSubject)}"(이하 "본 건"이라 한다)에 관하여 갑과 을 사이의 권리·의무 관계를 명확히 규정함을 목적으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제2조 (계약기간)</div>
    <div class="article-body">
      <p>① 본 계약의 유효기간은 ${escapeHtml(contractStartDate)}부터 ${escapeHtml(endDateText)}까지로 한다.</p>
      <p>② 계약기간 만료 1개월 전까지 쌍방 이의가 없는 경우 동일 조건으로 1년간 자동 연장되며, 이후에도 같다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제3조 (계약금액)</div>
    <div class="article-body">
      <p>① 본 계약의 대금은 금 ${fmt(contractAmount)} 원정(부가가치세 별도)으로 한다.</p>
      <p>② 부가가치세는 관련 법령에 따라 별도 청구하며, 세금계산서 발행을 원칙으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제4조 (납품 및 인도)</div>
    <div class="article-body">
      <p>① 을은 ${escapeHtml(deliveryText)}까지 본 건의 결과물(이하 "납품물"이라 한다)을 갑에게 납품·인도한다.</p>
      <p>② 납품 장소는 갑이 지정한 장소로 하며, 납품에 소요되는 비용은 을이 부담한다.</p>
      <p>③ 을은 납품 시 납품명세서를 첨부하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제5조 (검수)</div>
    <div class="article-body">
      <p>① 갑은 납품일로부터 ${escapeHtml(inspectionPeriod)} 이내에 납품물의 수량·품질·규격 등을 검수하여야 한다.</p>
      <p>② 검수 결과 하자가 발견된 경우 갑은 을에게 보완, 교체 또는 재납품을 요구할 수 있으며, 을은 지체 없이 이에 응하여야 한다.</p>
      <p>③ 검수 기간 내 갑이 별도의 이의를 제기하지 아니한 경우 검수에 합격한 것으로 본다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제6조 (대금지급)</div>
    <div class="article-body">
      <p>① ${escapeHtml(paymentTerms || '별도 협의')}</p>
      <p>② 갑은 을이 적법한 세금계산서를 발행한 날로부터 30일 이내에 대금을 지급한다.</p>
      <p>③ 갑의 귀책사유로 지급이 지연되는 경우 연 이율 5%의 지연이자를 가산하여 지급한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제7조 (하자보수)</div>
    <div class="article-body">
      <p>① 을은 납품물에 대하여 검수 완료일로부터 ${escapeHtml(warrantyPeriod)} 동안 하자보수 책임을 진다.</p>
      <p>② 하자보수 기간 중 을의 귀책사유로 발생한 하자에 대하여 을은 무상으로 보수 또는 교체하여야 한다.</p>
      <p>③ 을이 하자보수 요청을 받은 날로부터 7영업일 이내에 보수를 개시하지 않는 경우 갑은 제3자에게 보수를 의뢰하고 그 비용을 을에게 청구할 수 있다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제8조 (지체상금)</div>
    <div class="article-body">
      <p>① 을이 납품기한을 초과하여 이행하는 경우 지체일수 1일당 계약금액의 ${escapeHtml(latePenaltyRate)}%에 해당하는 금액을 지체상금으로 갑에게 납부하여야 한다.</p>
      <p>② 지체상금의 총액은 계약금액의 10%를 초과하지 아니한다.</p>
      <p>③ 불가항력 사유에 해당하는 경우에는 지체상금을 면제한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제9조 (손해배상)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 본 계약상의 의무를 위반하여 상대방에게 손해를 끼친 경우 이를 배상하여야 한다.</p>
      <p>② 손해배상의 범위는 통상 손해에 한하되, 특별한 사정으로 인한 손해는 채무자가 그 사정을 알았거나 알 수 있었을 때에 한하여 배상한다.</p>
      <p>③ 본 조의 손해배상 청구권은 손해 발생 사실을 안 날로부터 1년, 손해 발생일로부터 3년 이내에 행사하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제10조 (권리·의무의 양도 금지)</div>
    <div class="article-body">
      <p>갑과 을은 상대방의 사전 서면 동의 없이 본 계약상의 권리·의무의 전부 또는 일부를 제3자에게 양도하거나 담보로 제공할 수 없다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제11조 (불가항력)</div>
    <div class="article-body">
      <p>① 천재지변, 전쟁, 내란, 법령의 개폐, 정부의 행위, 전염병, 파업 기타 당사자의 통제 범위를 벗어나는 사유(이하 "불가항력"이라 한다)로 인하여 본 계약을 이행할 수 없는 경우 그 책임을 면한다.</p>
      <p>② 불가항력 사유가 발생한 당사자는 즉시 상대방에게 서면으로 통지하고, 그 사유가 종료된 후 지체 없이 계약 이행을 재개하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제12조 (비밀유지)</div>
    <div class="article-body">
      <p>① 갑과 을은 본 계약의 체결 및 이행과정에서 취득한 상대방의 기밀정보(기술정보, 영업정보, 고객정보 등)를 제3자에게 누설하거나 본 계약 목적 외의 용도로 사용하지 아니한다.</p>
      <p>② 비밀유지 의무는 본 계약 종료 후에도 3년간 존속한다.</p>
      <p>③ 법령에 의한 공개 의무가 있는 경우 또는 상대방의 서면 동의를 얻은 경우에는 예외로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제13조 (계약해지)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 다음 각 호에 해당하는 경우 상대방은 서면 통지로써 본 계약을 해지할 수 있다.</p>
      <p style="padding-left:12px;">1. 본 계약상의 중대한 의무를 위반하고 서면 최고 후 14일 이내에 시정하지 않는 경우</p>
      <p style="padding-left:12px;">2. 파산, 회생 절차 개시, 해산 결의 등으로 정상적인 계약 이행이 곤란한 경우</p>
      <p style="padding-left:12px;">3. 어음·수표의 부도 등으로 지급불능 상태에 빠진 경우</p>
      <p>② 계약 해지 시 기 수행된 부분에 대하여는 상호 정산하여 처리한다.</p>
      <p>③ 계약 해지는 이미 발생한 손해배상 청구권에 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제14조 (분쟁해결)</div>
    <div class="article-body">
      <p>① 본 계약에 관한 분쟁은 갑과 을이 성실히 협의하여 해결한다.</p>
      <p>② 협의가 이루어지지 아니하는 경우 갑의 본점 소재지를 관할하는 법원을 제1심 관할법원으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제15조 (기타)</div>
    <div class="article-body">
      <p>① 본 계약에 정하지 아니한 사항은 상관례 및 민법, 상법 등 관련 법령에 따른다.</p>
      <p>② 본 계약의 변경은 갑과 을의 서면 합의에 의하여야 하며, 구두 합의는 효력이 없다.</p>
      <p>③ 본 계약의 어느 조항이 무효 또는 집행 불가능하더라도 나머지 조항의 유효성에는 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제16조 (특약사항)</div>
    <div class="article-body">
      <p>${specialTermsHtml}</p>
    </div>
  </div>

  <!-- Closing + Signature -->
  <div class="closing-text">
    본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하고,<br/>
    갑·을이 각각 서명 날인한 후 각 1통씩 보관한다.
  </div>

  <div class="signature-block">
    <div class="signature-date">${escapeHtml(date)}</div>
    <div class="signature-row">
      <div class="signature-party">
        <div class="sig-label">"갑"</div>
        <div class="sig-detail">
          ${escapeHtml(partyA.name)}<br/>
          ${partyA.address ? escapeHtml(partyA.address) + '<br/>' : ''}
          ${partyA.businessNumber ? '사업자등록번호: ' + escapeHtml(partyA.businessNumber) + '<br/>' : ''}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${escapeHtml(partyA.representative || '_______________')}</span>
          <span class="stamp-area">${sealImgA}</span>
        </div>
      </div>
      <div class="signature-party">
        <div class="sig-label">"을"</div>
        <div class="sig-detail">
          ${escapeHtml(partyB.name)}<br/>
          ${partyB.address ? escapeHtml(partyB.address) + '<br/>' : ''}
          ${partyB.businessNumber ? '사업자등록번호: ' + escapeHtml(partyB.businessNumber) + '<br/>' : ''}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${escapeHtml(partyB.representative || '_______________')}</span>
          <span class="stamp-area">${sealImgB}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    OwnerView Document System | ${escapeHtml(documentNumber)} | Generated: ${new Date().toISOString().split('T')[0]}
  </div>

</div>
</body>
</html>`;
}

// ────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────

/** HTML 특수문자를 이스케이프 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

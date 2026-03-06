/**
 * Reflect Employee Certificate Generator
 * 재직증명서 + 경력증명서 PDF 생성 + 발급 이력 관리
 *
 * NOTE: jsPDF의 기본 helvetica 폰트는 한글을 직접 렌더링하지 못합니다.
 * 이 파일에서는 autoTable을 활용하여 테이블 셀 기반으로 한글 텍스트를 배치합니다.
 * autoTable은 내부적으로 텍스트를 이미지화하는 방식으로 한글을 비교적 잘 처리합니다.
 *
 * [향후 개선] Pretendard 또는 NotoSansKR 폰트를 Base64로 임베드하면
 * doc.text()에서도 완벽한 한글 렌더링이 가능합니다.
 * → doc.addFileToVFS('Pretendard.ttf', base64String);
 * → doc.addFont('Pretendard.ttf', 'Pretendard', 'normal');
 * → doc.setFont('Pretendard');
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';
import { logAudit } from './audit';

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface CertificateEmployee {
  name: string;
  department?: string;
  position?: string;
  hire_date: string;
  end_date?: string;
  employee_number?: string;
  birth_date?: string;
}

export interface CertificateCompany {
  name: string;
  representative?: string;
  address?: string;
  business_number?: string;
  seal_url?: string;
}

export interface CertificateResult {
  pdf: Blob;
  certificateNumber: string;
}

// ────────────────────────────────────────────
// 1. 재직증명서 생성
// ────────────────────────────────────────────

/**
 * 한국 표준 재직증명서 PDF를 생성합니다.
 *
 * 구성:
 *  - 제목: "재 직 증 명 서" (중앙, 대문자)
 *  - 인적사항 테이블: 성명, 생년월일, 소속, 직위, 입사일, 재직기간
 *  - 용도: (기본값: "제출용")
 *  - 증명 문구: "위 사실을 증명합니다."
 *  - 발행일 + 회사명 + 대표이사 + 직인
 *  - 증명서번호: CERT-EMP-YYYYMM-XXXX
 */
export async function generateEmploymentCertificate(params: {
  employee: CertificateEmployee;
  company: CertificateCompany;
  purpose?: string;
}): Promise<CertificateResult> {
  const { employee, company } = params;
  const purpose = params.purpose || '제출용';
  const certNumber = await generateCertificateNumber('CERT-EMP');
  const today = new Date();
  const todayStr = formatKoreanDate(today);

  // 재직기간 계산
  const hireDate = new Date(employee.hire_date);
  const tenure = calculateTenure(hireDate, today);

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  let y = 25;

  // ── 증명서 번호 (우측 상단) ──
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 140);
  doc.text(`No. ${certNumber}`, pageW - 14, 15, { align: 'right' });

  // ── 제목 ──
  // autoTable로 제목 렌더링 (한글 호환)
  autoTable(doc, {
    startY: y,
    body: [['재 직 증 명 서']],
    theme: 'plain',
    styles: {
      fontSize: 22,
      fontStyle: 'bold',
      halign: 'center',
      textColor: [30, 30, 30],
      cellPadding: { top: 5, bottom: 8, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── 구분선 ──
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.8);
  doc.line(14, y, pageW - 14, y);
  y += 10;

  // ── 인적사항 테이블 ──
  const personalInfo: string[][] = [
    ['성    명', employee.name],
  ];
  if (employee.birth_date) {
    personalInfo.push(['생년월일', employee.birth_date]);
  }
  if (employee.employee_number) {
    personalInfo.push(['사원번호', employee.employee_number]);
  }
  personalInfo.push(
    ['소    속', employee.department || '-'],
    ['직    위', employee.position || '-'],
    ['입 사 일', formatKoreanDate(hireDate)],
    ['재직기간', tenure],
    ['용    도', purpose],
  );

  autoTable(doc, {
    startY: y,
    body: personalInfo,
    theme: 'grid',
    styles: {
      fontSize: 11,
      cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
      textColor: [40, 40, 40],
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: {
        cellWidth: 40,
        fontStyle: 'bold',
        fillColor: [245, 247, 250],
        textColor: [60, 60, 60],
        halign: 'center',
      },
      1: { cellWidth: pageW - 68 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 25;

  // ── 증명 문구 ──
  autoTable(doc, {
    startY: y,
    body: [['위 사실을 증명합니다.']],
    theme: 'plain',
    styles: {
      fontSize: 14,
      fontStyle: 'bold',
      halign: 'center',
      textColor: [30, 30, 30],
      cellPadding: { top: 3, bottom: 3, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // ── 발행일 ──
  autoTable(doc, {
    startY: y,
    body: [[todayStr]],
    theme: 'plain',
    styles: {
      fontSize: 12,
      halign: 'center',
      textColor: [60, 60, 60],
      cellPadding: { top: 2, bottom: 2, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── 회사 정보 ──
  const companyBlock: string[][] = [];
  companyBlock.push([company.name]);
  if (company.representative) {
    companyBlock.push([`대표이사  ${company.representative}`]);
  }
  if (company.business_number) {
    companyBlock.push([`사업자등록번호: ${company.business_number}`]);
  }
  if (company.address) {
    companyBlock.push([company.address]);
  }

  autoTable(doc, {
    startY: y,
    body: companyBlock,
    theme: 'plain',
    styles: {
      fontSize: 11,
      halign: 'center',
      textColor: [50, 50, 50],
      cellPadding: { top: 1.5, bottom: 1.5, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // ── 직인 오버레이 ──
  if (company.seal_url) {
    try {
      const img = await loadImage(company.seal_url);
      const sealSize = 30;
      // 대표이사 이름 우측에 직인 배치
      const sealX = pageW / 2 + 30;
      const sealY = y - 30;
      doc.addImage(img, 'PNG', sealX, sealY, sealSize, sealSize);
    } catch {
      console.warn('Seal image load failed, skipping stamp overlay');
    }
  }

  // ── 페이지 번호 ──
  addFooter(doc, company.name);

  return {
    pdf: doc.output('blob'),
    certificateNumber: certNumber,
  };
}

// ────────────────────────────────────────────
// 2. 경력증명서 생성
// ────────────────────────────────────────────

/**
 * 한국 표준 경력증명서 PDF를 생성합니다.
 *
 * 재직증명서와 동일한 구조이나 다음이 추가됩니다:
 *  - 퇴사일 (end_date)
 *  - 담당업무 (duties) 섹션
 *  - 증명서번호: CERT-CAR-YYYYMM-XXXX
 */
export async function generateCareerCertificate(params: {
  employee: CertificateEmployee;
  company: CertificateCompany;
  duties?: string[];
}): Promise<CertificateResult> {
  const { employee, company } = params;
  const certNumber = await generateCertificateNumber('CERT-CAR');
  const today = new Date();
  const todayStr = formatKoreanDate(today);

  // 재직/경력기간 계산
  const hireDate = new Date(employee.hire_date);
  const endDate = employee.end_date ? new Date(employee.end_date) : today;
  const tenure = calculateTenure(hireDate, endDate);

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  let y = 25;

  // ── 증명서 번호 (우측 상단) ──
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 140);
  doc.text(`No. ${certNumber}`, pageW - 14, 15, { align: 'right' });

  // ── 제목 ──
  autoTable(doc, {
    startY: y,
    body: [['경 력 증 명 서']],
    theme: 'plain',
    styles: {
      fontSize: 22,
      fontStyle: 'bold',
      halign: 'center',
      textColor: [30, 30, 30],
      cellPadding: { top: 5, bottom: 8, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── 구분선 ──
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.8);
  doc.line(14, y, pageW - 14, y);
  y += 10;

  // ── 인적사항 테이블 ──
  const personalInfo: string[][] = [
    ['성    명', employee.name],
  ];
  if (employee.birth_date) {
    personalInfo.push(['생년월일', employee.birth_date]);
  }
  if (employee.employee_number) {
    personalInfo.push(['사원번호', employee.employee_number]);
  }
  personalInfo.push(
    ['소    속', employee.department || '-'],
    ['직    위', employee.position || '-'],
    ['입 사 일', formatKoreanDate(hireDate)],
    ['퇴 사 일', employee.end_date ? formatKoreanDate(new Date(employee.end_date)) : '재직중'],
    ['경력기간', tenure],
  );

  autoTable(doc, {
    startY: y,
    body: personalInfo,
    theme: 'grid',
    styles: {
      fontSize: 11,
      cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
      textColor: [40, 40, 40],
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: {
        cellWidth: 40,
        fontStyle: 'bold',
        fillColor: [245, 247, 250],
        textColor: [60, 60, 60],
        halign: 'center',
      },
      1: { cellWidth: pageW - 68 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── 담당업무 섹션 ──
  if (params.duties && params.duties.length > 0) {
    autoTable(doc, {
      startY: y,
      body: [['담당업무']],
      theme: 'plain',
      styles: {
        fontSize: 12,
        fontStyle: 'bold',
        textColor: [40, 40, 40],
        cellPadding: { top: 2, bottom: 4, left: 2, right: 0 },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 2;

    const dutyRows = params.duties.map((duty, idx) => [
      String(idx + 1),
      duty,
    ]);

    autoTable(doc, {
      startY: y,
      head: [['No', '업무 내용']],
      body: dutyRows,
      theme: 'grid',
      styles: {
        fontSize: 10,
        cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
        textColor: [40, 40, 40],
        lineColor: [200, 200, 200],
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center' },
        1: { cellWidth: pageW - 43 },
      },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 15;
  } else {
    y += 15;
  }

  // ── 증명 문구 ──
  autoTable(doc, {
    startY: y,
    body: [['위 사실을 증명합니다.']],
    theme: 'plain',
    styles: {
      fontSize: 14,
      fontStyle: 'bold',
      halign: 'center',
      textColor: [30, 30, 30],
      cellPadding: { top: 3, bottom: 3, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // ── 발행일 ──
  autoTable(doc, {
    startY: y,
    body: [[todayStr]],
    theme: 'plain',
    styles: {
      fontSize: 12,
      halign: 'center',
      textColor: [60, 60, 60],
      cellPadding: { top: 2, bottom: 2, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── 회사 정보 ──
  const companyBlock: string[][] = [];
  companyBlock.push([company.name]);
  if (company.representative) {
    companyBlock.push([`대표이사  ${company.representative}`]);
  }
  if (company.business_number) {
    companyBlock.push([`사업자등록번호: ${company.business_number}`]);
  }
  if (company.address) {
    companyBlock.push([company.address]);
  }

  autoTable(doc, {
    startY: y,
    body: companyBlock,
    theme: 'plain',
    styles: {
      fontSize: 11,
      halign: 'center',
      textColor: [50, 50, 50],
      cellPadding: { top: 1.5, bottom: 1.5, left: 0, right: 0 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // ── 직인 오버레이 ──
  if (company.seal_url) {
    try {
      const img = await loadImage(company.seal_url);
      const sealSize = 30;
      const sealX = pageW / 2 + 30;
      const sealY = y - 30;
      doc.addImage(img, 'PNG', sealX, sealY, sealSize, sealSize);
    } catch {
      console.warn('Seal image load failed, skipping stamp overlay');
    }
  }

  // ── 페이지 번호 ──
  addFooter(doc, company.name);

  return {
    pdf: doc.output('blob'),
    certificateNumber: certNumber,
  };
}

// ────────────────────────────────────────────
// 3. 발급 이력 저장
// ────────────────────────────────────────────

/**
 * 증명서 발급 이력을 certificate_logs 테이블에 기록합니다.
 */
export async function saveCertificateLog(params: {
  companyId: string;
  employeeId: string;
  certificateType: string;
  certificateNumber: string;
  issuedBy: string;
  purpose?: string;
  pdfUrl?: string;
}): Promise<void> {
  const { error } = await db.from('certificate_logs').insert({
    company_id: params.companyId,
    employee_id: params.employeeId,
    certificate_type: params.certificateType,
    certificate_number: params.certificateNumber,
    issued_by: params.issuedBy,
    purpose: params.purpose || null,
    pdf_url: params.pdfUrl || null,
  });

  if (error) throw error;

  await logAudit({
    companyId: params.companyId,
    userId: params.issuedBy,
    entityType: 'certificate',
    entityId: params.certificateNumber,
    action: 'issue_certificate',
    afterJson: {
      certificate_type: params.certificateType,
      certificate_number: params.certificateNumber,
      employee_id: params.employeeId,
      purpose: params.purpose,
    },
  });
}

// ────────────────────────────────────────────
// 4. 발급 이력 조회
// ────────────────────────────────────────────

/**
 * 증명서 발급 이력을 조회합니다.
 * employeeId를 지정하면 해당 직원의 이력만 반환합니다.
 */
export async function getCertificateLogs(
  companyId: string,
  employeeId?: string,
): Promise<any[]> {
  let query = db
    .from('certificate_logs')
    .select('*, employees:employee_id(name, department, position), issuer:issued_by(name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────

/**
 * 증명서 번호를 채번합니다.
 * Format: {prefix}-YYYYMM-XXXX (예: CERT-EMP-202603-0001)
 */
async function generateCertificateNumber(prefix: string): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const like = `${prefix}-${ym}-%`;

  const { data } = await db
    .from('certificate_logs')
    .select('certificate_number')
    .like('certificate_number', like)
    .order('certificate_number', { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0 && data[0].certificate_number) {
    const last: string = data[0].certificate_number;
    const parts = last.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}-${ym}-${String(seq).padStart(4, '0')}`;
}

/** 한국어 날짜 포맷 (YYYY년 MM월 DD일) */
function formatKoreanDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}년 ${m}월 ${d}일`;
}

/** 재직기간/경력기간 계산 */
function calculateTenure(from: Date, to: Date): string {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();

  if (days < 0) {
    months -= 1;
    // 이전 달의 마지막 일
    const prevMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (days > 0 && years === 0) parts.push(`${days}일`); // 1년 이상이면 일수 생략

  return parts.length > 0 ? parts.join(' ') : '0일';
}

/** 이미지 URL을 data URL로 변환 */
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

/** 페이지 하단 푸터 (페이지 번호 포함) */
function addFooter(doc: jsPDF, companyName: string) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `OwnerView Certificate  |  ${companyName}  |  Page ${i}/${pageCount}`,
      pageW / 2,
      pageH - 8,
      { align: 'center' },
    );
  }
}

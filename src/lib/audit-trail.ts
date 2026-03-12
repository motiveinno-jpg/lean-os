/**
 * OwnerView Audit Trail Certificate Engine
 * 전자서명 감사추적인증서 — 생성, 기록, 조회, HTML 인증서 생성
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export type AuditAction =
  | 'document_created'
  | 'signing_requested'
  | 'email_sent'
  | 'document_opened'
  | 'document_viewed'
  | 'signature_drawn'
  | 'signature_typed'
  | 'signature_submitted'
  | 'document_completed'
  | 'document_locked';

export interface AuditTrailEntry {
  action: AuditAction;
  timestamp: string; // ISO 8601
  actor: string; // name or email
  ip?: string;
  userAgent?: string;
  details?: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  document_created: '문서 생성',
  signing_requested: '서명 요청',
  email_sent: '이메일 발송',
  document_opened: '문서 열람',
  document_viewed: '문서 확인',
  signature_drawn: '서명 입력 (직접 그리기)',
  signature_typed: '서명 입력 (텍스트)',
  signature_submitted: '서명 제출',
  document_completed: '서명 완료',
  document_locked: '문서 잠금',
};

// ── Log Audit Trail ──

export async function logAuditTrail(
  packageId: string,
  entry: AuditTrailEntry,
): Promise<void> {
  // 1. Fetch current package record
  const { data: pkg, error: fetchError } = await db
    .from('hr_contract_packages')
    .select('id, notes')
    .eq('id', packageId)
    .single();

  if (fetchError) {
    throw new Error(`감사추적 기록 실패 — 패키지 조회 오류: ${fetchError.message}`);
  }

  if (!pkg) {
    throw new Error(`감사추적 기록 실패 — 패키지를 찾을 수 없습니다: ${packageId}`);
  }

  // 2. Parse existing notes as JSON — may contain { audit_trail: [...], ...other }
  let notesObj: Record<string, unknown> = {};
  if (pkg.notes) {
    try {
      const parsed = JSON.parse(pkg.notes);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        notesObj = parsed;
      } else if (Array.isArray(parsed)) {
        // Legacy: notes was a plain array — migrate into keyed object
        notesObj = { audit_trail: parsed };
      } else {
        // Primitive value (string/number) — preserve as "text"
        notesObj = { text: String(parsed) };
      }
    } catch {
      // Not valid JSON — preserve raw string
      notesObj = { text: pkg.notes };
    }
  }

  // 3. Append entry
  const trail: AuditTrailEntry[] = Array.isArray(notesObj.audit_trail)
    ? (notesObj.audit_trail as AuditTrailEntry[])
    : [];

  trail.push({
    action: entry.action,
    timestamp: entry.timestamp || new Date().toISOString(),
    actor: entry.actor,
    ...(entry.ip ? { ip: entry.ip } : {}),
    ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
    ...(entry.details ? { details: entry.details } : {}),
  });

  notesObj.audit_trail = trail;

  // 4. Update DB
  const { error: updateError } = await db
    .from('hr_contract_packages')
    .update({ notes: JSON.stringify(notesObj) })
    .eq('id', packageId);

  if (updateError) {
    throw new Error(`감사추적 기록 실패 — DB 업데이트 오류: ${updateError.message}`);
  }
}

// ── Get Audit Trail ──

export async function getAuditTrail(packageId: string): Promise<AuditTrailEntry[]> {
  const { data: pkg, error } = await db
    .from('hr_contract_packages')
    .select('notes')
    .eq('id', packageId)
    .single();

  if (error) {
    throw new Error(`감사추적 조회 실패: ${error.message}`);
  }

  if (!pkg?.notes) return [];

  try {
    const parsed = JSON.parse(pkg.notes);
    if (Array.isArray(parsed)) {
      return parsed as AuditTrailEntry[];
    }
    if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.audit_trail)) {
      return parsed.audit_trail as AuditTrailEntry[];
    }
  } catch {
    // notes is not JSON — no audit trail
  }

  return [];
}

// ── Generate Audit Trail Certificate HTML ──

export function generateAuditTrailCertificateHTML(params: {
  packageTitle: string;
  companyName: string;
  employeeName: string;
  signerEmail: string;
  documentNames: string[];
  auditEntries: AuditTrailEntry[];
  documentHash: string;
}): string {
  const {
    packageTitle,
    companyName,
    employeeName,
    signerEmail,
    documentNames,
    auditEntries,
    documentHash,
  } = params;

  const generatedAt = new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const formatTimestamp = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return iso;
    }
  };

  const escapeHtml = (str: string): string =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const timelineRows = auditEntries
    .map(
      (entry, idx) => `
      <tr${idx % 2 === 1 ? ' class="alt"' : ''}>
        <td class="seq">${idx + 1}</td>
        <td class="ts">${escapeHtml(formatTimestamp(entry.timestamp))}</td>
        <td class="action">${escapeHtml(ACTION_LABELS[entry.action] || entry.action)}</td>
        <td class="actor">${escapeHtml(entry.actor)}</td>
        <td class="ip">${entry.ip ? escapeHtml(entry.ip) : '-'}</td>
        <td class="details">${entry.details ? escapeHtml(entry.details) : '-'}</td>
      </tr>`,
    )
    .join('\n');

  const documentList = documentNames
    .map((name, idx) => `<li>${idx + 1}. ${escapeHtml(name)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>감사추적인증서 — ${escapeHtml(packageTitle)}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
                   'Noto Sans KR', sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      line-height: 1.6;
      background: #f5f5f5;
    }

    .certificate {
      max-width: 210mm;
      margin: 0 auto;
      background: #fff;
      padding: 40px 36px;
    }

    /* ── Header ── */
    .header {
      text-align: center;
      border-bottom: 3px double #1a1a1a;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }

    .header h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .header .subtitle {
      font-size: 13px;
      color: #666;
      font-weight: 400;
    }

    /* ── Section ── */
    .section {
      margin-bottom: 24px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
      border-left: 4px solid #2563eb;
      padding-left: 10px;
      margin-bottom: 12px;
    }

    /* ── Info Grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
    }

    .info-row {
      display: flex;
      gap: 8px;
    }

    .info-label {
      font-weight: 600;
      color: #555;
      min-width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      color: #1a1a1a;
      word-break: break-all;
    }

    /* ── Document List ── */
    .doc-list {
      list-style: none;
      padding: 0;
    }

    .doc-list li {
      padding: 6px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }

    /* ── Timeline Table ── */
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }

    .timeline-table th {
      background: #1e293b;
      color: #fff;
      padding: 8px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
    }

    .timeline-table th:first-child { border-radius: 6px 0 0 0; }
    .timeline-table th:last-child { border-radius: 0 6px 0 0; }

    .timeline-table td {
      padding: 7px 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }

    .timeline-table tr.alt td {
      background: #f8fafc;
    }

    .timeline-table .seq { width: 30px; text-align: center; color: #94a3b8; }
    .timeline-table .ts { width: 140px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .timeline-table .action { width: 140px; font-weight: 600; color: #1e40af; }
    .timeline-table .actor { width: 120px; }
    .timeline-table .ip { width: 110px; color: #64748b; font-family: monospace; font-size: 10px; }
    .timeline-table .details { color: #475569; }

    /* ── Hash Section ── */
    .hash-box {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 14px 16px;
    }

    .hash-label {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .hash-value {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      color: #1e293b;
      word-break: break-all;
      line-height: 1.5;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
    }

    .legal-notice {
      font-size: 11px;
      color: #475569;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .generated-at {
      font-size: 10px;
      color: #94a3b8;
    }

    .system-name {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <!-- Header -->
    <div class="header">
      <h1>감사추적인증서</h1>
      <div class="subtitle">Audit Trail Certificate</div>
    </div>

    <!-- Document Info -->
    <div class="section">
      <div class="section-title">문서 정보</div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">계약명</span>
          <span class="info-value">${escapeHtml(packageTitle)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회사명</span>
          <span class="info-value">${escapeHtml(companyName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">서명자</span>
          <span class="info-value">${escapeHtml(employeeName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">${escapeHtml(signerEmail)}</span>
        </div>
        <div class="info-row" style="grid-column: span 2;">
          <span class="info-label">문서 수</span>
          <span class="info-value">${documentNames.length}건</span>
        </div>
      </div>
    </div>

    <!-- Document List -->
    <div class="section">
      <div class="section-title">포함 문서</div>
      <ul class="doc-list">
        ${documentList}
      </ul>
    </div>

    <!-- Audit Timeline -->
    <div class="section">
      <div class="section-title">감사 추적 이력</div>
      <table class="timeline-table">
        <thead>
          <tr>
            <th>#</th>
            <th>일시</th>
            <th>활동</th>
            <th>수행자</th>
            <th>IP 주소</th>
            <th>상세</th>
          </tr>
        </thead>
        <tbody>
          ${timelineRows}
        </tbody>
      </table>
    </div>

    <!-- Document Integrity -->
    <div class="section">
      <div class="section-title">문서 무결성 검증</div>
      <div class="hash-box">
        <div class="hash-label">SHA-256 해시값</div>
        <div class="hash-value">${escapeHtml(documentHash)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="legal-notice">
        본 인증서는 전자서명법 제3조에 따라 전자서명의 진정성을 증명합니다
      </p>
      <p class="generated-at">생성일시: ${escapeHtml(generatedAt)}</p>
      <p class="system-name">OwnerView 전자서명 시스템</p>
    </div>
  </div>
</body>
</html>`;
}

// 계약서 HTML (순수 함수 — 브라우저·서버 공용). 2026-10-01 document-generator.ts 에서 옮김:
//   계약 보관본을 서버(/api/documents/archive-contract)가 직접 렌더링하도록. jspdf·브라우저 DB 연결에 기대지 않는다.
import { todayKst } from "@/lib/kst";

/** HTML 특수문자를 이스케이프 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    OwnerView Document System | ${escapeHtml(documentNumber)} | Generated: ${todayKst()}
  </div>

</div>
</body>
</html>`;
}

/** 승인된 계약서 본문(content_json) + 회사 정보 → 보관본 HTML. deal-pipeline 이 브라우저에서 하던 매핑 그대로(서버가 쓴다). */
export function buildContractArchiveHtml(params: {
  dealId: string | null;
  content: any;
  company: { name?: string | null; representative?: string | null; business_number?: string | null; address?: string | null; phone?: string | null } | null;
}): string {
  const { content, company } = params;
  const items = (content?.items || []).map((it: any) => ({
    name: it.name || '',
    spec: it.spec || '',
    qty: Number(it.quantity || it.qty || 1),
    unitPrice: Number(it.unitPrice || 0),
    amount: Number(it.supplyAmount || it.amount || it.totalAmount || 0),
  }));
  const contractTotal = Number(content?.contractTotal || content?.supplyAmount || 0);
  return generateContractPDF({
    documentNumber: content?.documentNumber || `CTR-${String(params.dealId || '').slice(0, 8).toUpperCase()}`,
    date: new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),
    partyA: {
      name: company?.name || '',
      representative: company?.representative || '',
      businessNumber: company?.business_number || '',
      address: company?.address || '',
      phone: company?.phone || '',
    },
    partyB: {
      name: content?.partnerName || '',
      representative: content?.counterpartyRepresentative || '',
      businessNumber: content?.partnerBizNo || '',
      address: content?.counterpartyAddress || '',
    },
    contractAmount: contractTotal,
    taxAmount: Math.round(contractTotal * 0.1),
    totalAmount: Math.round(contractTotal * 1.1),
    items,
    contractSubject: content?.dealName || '',
    contractStartDate: content?.contractStartDate || todayKst(),
    contractEndDate: content?.contractEndDate || '',
    paymentTerms: content?.paymentTerms || '',
    deliveryDeadline: content?.deliveryDeadline || '',
    inspectionPeriod: content?.inspectionPeriod || '7영업일',
    warrantyPeriod: content?.warrantyPeriod || '납품 후 1년',
    latePenaltyRate: content?.latePenaltyRate || '0.1',
    specialTerms: content?.specialTerms || '',
  });
}

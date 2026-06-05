/**
 * 서명완료 계약서 인쇄용 self-contained HTML 빌더 (2026-06-05)
 *
 * ContractViewer 의 `.print-area` 렌더(본문 + 갑/을 서명 푸터 합성)를 정적 HTML 로 재현한다.
 * headless Chrome(/api/contract-pdf)에서 이 HTML 을 네이티브 인쇄 → 단건 인쇄/PDF 저장과
 * 동일한 벡터 품질의 PDF 를 업체별로 생성하기 위함.
 *
 * - 본문(signed_contract_html)은 완전 인라인 스타일이라 그대로 렌더 가능.
 * - 본문에 박힌 거래처 서명 inline-block 블록은 헤드리스 페이지의 실DOM 에서 strip(중복 방지) →
 *   STRIP_BODY_SIGNATURE 참조 (ContractViewer 의 stripBodySignatureArea branch1 과 동일 의미).
 * - 미설치 한글 폰트(휴먼명조·HY헤드라인 등)는 Pretendard 로 폴백(tofu 방지).
 */

// Pretendard(한글 웹폰트) — headless 페이지엔 우리 사이트 CSP 미적용이라 CDN 직접 로드 가능
const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css";

export type ContractPrintData = {
  bodyHtml: string;
  company: {
    name?: string | null;
    business_number?: string | null;
    representative?: string | null;
    seal_url?: string | null;
  } | null;
  partner: {
    name?: string | null;
    business_number?: string | null;
    representative?: string | null;
  } | null;
  ourSignatureDataUrl?: string | null; // 갑 서명 (signature_requests 는 null → seal_url 사용)
  ourSignedAt?: string | null;
  signerSignatureDataUrl?: string | null; // 을 서명
  signedAtExternal?: string | null; // 을 서명 시각
  recipientName?: string | null; // 을 회사명 fallback
};

function esc(s: string | null | undefined): string {
  return String(s ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtKST(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  } catch {
    return "";
  }
}

// 본문 인라인 font-family 에 Pretendard 폴백 주입 — 미설치 한글 폰트가 헤드리스에서 tofu 되지 않게.
function injectFontFallback(html: string): string {
  return html.replace(/font-family:\s*([^;"]+)/gi, (_m, fam) => {
    const f = String(fam).trim().replace(/,?\s*$/, "");
    if (/pretendard/i.test(f)) return `font-family: ${f}`;
    return `font-family: ${f}, 'Pretendard', sans-serif`;
  });
}

// ContractViewer 의 SignatureBox(80×80 dashed box, contain 이미지 / "서명 대기")
function sigBox(dataUrl: string | null | undefined): string {
  const box =
    "display:inline-block;width:80px;height:80px;border:1px dashed #d1d5db;border-radius:4px;" +
    "background:#f9fafb;vertical-align:middle;overflow:hidden;position:relative;flex-shrink:0;";
  if (dataUrl) {
    return `<span style="${box}"><img src="${esc(dataUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:4px;" /></span>`;
  }
  return `<span style="${box}"><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af;">서명 대기</span></span>`;
}

// 갑/을 서명 푸터 (본문에 sig-box 가 없을 때만). ContractViewer 푸터와 동일 구성.
function footerHtml(d: ContractPrintData): string {
  const labelRow = (label: string, value: string) =>
    `<div style="margin-top:6px;">${label}: ${value}</div>`;
  const repRow = (rep: string, box: string) =>
    `<div style="display:flex;align-items:center;gap:12px;margin-top:4px;"><span>대표자: ${rep} (인)</span>${box}</div>`;
  const tsRow = (iso: string | null | undefined) => {
    const t = fmtKST(iso);
    return t ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;">${esc(t)}</div>` : "";
  };

  const gap = d.ourSignatureDataUrl || d.company?.seal_url || null;
  const eul = d.signerSignatureDataUrl || null;

  return `<div style="margin-top:48px;padding-top:24px;border-top:1px solid #e5e7eb;display:grid;grid-template-columns:1fr 1fr;gap:48px;page-break-inside:avoid;">
    <div>
      <div style="font-size:14px;font-weight:700;margin-bottom:8px;">갑</div>
      <div style="font-size:12px;line-height:1.5;">
        ${labelRow("회사명", esc(d.company?.name))}
        ${labelRow("사업자등록번호", esc(d.company?.business_number))}
        ${repRow(esc(d.company?.representative), sigBox(gap))}
        ${tsRow(d.ourSignedAt)}
      </div>
    </div>
    <div>
      <div style="font-size:14px;font-weight:700;margin-bottom:8px;">을</div>
      <div style="font-size:12px;line-height:1.5;">
        ${labelRow("회사명", esc(d.partner?.name || d.recipientName))}
        ${labelRow("사업자등록번호", esc(d.partner?.business_number))}
        ${repRow(esc(d.partner?.representative), sigBox(eul))}
        ${tsRow(d.signedAtExternal)}
      </div>
    </div>
  </div>`;
}

export function buildSignedContractPrintHtml(d: ContractPrintData): string {
  const raw = d.bodyHtml || "";
  const hasSigBox = /class="sig-box"/.test(raw);
  const body = injectFontFallback(raw);
  const footer = hasSigBox ? "" : footerHtml(d);

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<link rel="stylesheet" href="${PRETENDARD_CSS}" />
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { font-family: 'Pretendard', sans-serif; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pa { background: #ffffff; color: #111827; }
  .pa img { max-width: 100%; }
</style></head>
<body><div class="pa">${body}${footer}</div></body></html>`;
}

// 헤드리스 페이지에서 실DOM 으로 본문 내 거래처 서명 inline-block 블록 제거.
// ContractViewer stripBodySignatureArea 의 branch1 과 동일 의미(중복 푸터 방지).
// page.evaluate(string) 은 표현식 "평가"만 하므로 IIFE 로 즉시 실행되게 한다.
export const STRIP_BODY_SIGNATURE_FN = `(() => {
  const pa = document.querySelector('.pa');
  if (!pa) return;
  const wraps = pa.querySelectorAll('div[style*="display:inline-block"], div[style*="display: inline-block"]');
  wraps.forEach((el) => {
    const hasDataImg = !!el.querySelector('img[src^="data:image"]');
    const hasSealImg = !!el.querySelector('img[alt="직인"]');
    const hasSigText = /거래처\\s*서명/.test(el.textContent || '');
    if (hasDataImg || hasSealImg || hasSigText) {
      const p = el.parentElement;
      if (p && /text-align:\\s*right/i.test(p.getAttribute('style') || '')) p.remove();
      else el.remove();
    }
  });
})()`;

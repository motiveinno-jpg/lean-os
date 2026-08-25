// @vitest-environment jsdom
//   실제 실행 환경과 맞춘다 — 화면용 sanitize 는 브라우저에서만 도는 코드다(2026-08-05).
// PDF 렌더 보안 회귀 — SSRF(자산 페치 allowlist) + XSS(sanitize).
import { describe, it, expect } from "vitest";
import { isAllowedAssetUrl } from "@/lib/pdf-fetch-guard";
import { sanitizeAiContractHtml, sanitizeDocumentHtml } from "@/lib/sanitize-html";
import DOMPurify from "dompurify";
import { PDF_SANITIZE_CONFIG, PDF_SANITIZE_URI_REGEXP_SOURCE } from "@/lib/pdf-sanitize-config";

// api/html-pdf 가 headless Chrome 안에서 돌리는 정제와 동일 구성 — 설정을 공유해 회귀를 잡는다
//   (jsdom 기반 sanitize-html.server 는 프로덕션 모듈 로드 사고로 제거, 2026-08-25)
const sanitizePdfHtml = (dirty: string) =>
  DOMPurify.sanitize(dirty, {
    ...PDF_SANITIZE_CONFIG,
    ALLOWED_URI_REGEXP: new RegExp(PDF_SANITIZE_URI_REGEXP_SOURCE, "i"),
  });

const OV = "https://njbvdkuvtdtkxyylwngn.supabase.co";

describe("isAllowedAssetUrl — SSRF 가드", () => {
  it("자사 Supabase Storage object URL 허용", () => {
    expect(isAllowedAssetUrl(`${OV}/storage/v1/object/public/seals/a.png`, OV)).toBe(true);
  });
  it("자사 호스트라도 storage 경로가 아니면 차단", () => {
    expect(isAllowedAssetUrl(`${OV}/rest/v1/users`, OV)).toBe(false);
  });
  it("임의 외부 호스트 차단", () => {
    expect(isAllowedAssetUrl("https://evil.com/x.png", OV)).toBe(false);
  });
  it("내부망/메타데이터 IP 차단", () => {
    expect(isAllowedAssetUrl("http://169.254.169.254/latest/meta-data/", OV)).toBe(false);
    expect(isAllowedAssetUrl("http://127.0.0.1:5432/", OV)).toBe(false);
    expect(isAllowedAssetUrl("http://localhost/", OV)).toBe(false);
  });
  it("http(비-https) 차단", () => {
    expect(isAllowedAssetUrl(`http://njbvdkuvtdtkxyylwngn.supabase.co/storage/v1/object/x`, OV)).toBe(false);
  });
  it("file:/gopher: 등 위험 스킴 차단", () => {
    expect(isAllowedAssetUrl("file:///etc/passwd", OV)).toBe(false);
    expect(isAllowedAssetUrl("gopher://x", OV)).toBe(false);
  });
  it("깨진 URL 차단", () => {
    expect(isAllowedAssetUrl("not a url", OV)).toBe(false);
  });
});

describe("sanitize — XSS 가드", () => {
  it("script 태그·on* 핸들러 제거 (문서용)", () => {
    const out = sanitizeDocumentHtml('<p>hi</p><script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).toContain("hi");
  });
  it("PDF용은 <style> 는 보존하되 script/iframe 은 제거", () => {
    const out = sanitizePdfHtml('<style>.a{color:red}</style><p>x</p><script>steal()</script><iframe src=//evil></iframe>');
    expect(out).toContain("<style");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<iframe");
  });
  it("javascript: URL 제거", () => {
    const out = sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
  it("AI 계약서 초안은 외부 요청 태그와 임의 스타일을 제거", () => {
    const out = sanitizeAiContractHtml(
      '<h1 style="background:url(https://evil.example/x)">계약서</h1><img src="https://evil.example/pixel"><a href="https://evil.example">링크</a><p>본문</p>',
    );
    expect(out).toContain("계약서");
    expect(out).toContain("본문");
    expect(out).not.toContain("style=");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("href=");
  });
});

// PDF 렌더 보안 회귀 — SSRF(자산 페치 allowlist) + XSS(sanitize).
import { describe, it, expect } from "vitest";
import { isAllowedAssetUrl } from "@/lib/pdf-fetch-guard";
import { sanitizeDocumentHtml, sanitizePdfHtml } from "@/lib/sanitize-html";

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
});

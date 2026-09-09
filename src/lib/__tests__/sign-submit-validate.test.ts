// 외부 서명 제출 입력 검증 — 서명자가 계약 본문·스크립트를 끼워 넣지 못하게 (S04)
import { describe, it, expect } from "vitest";
import { validateSignatureData, validateSignerInputs } from "../sign-submit-validate";
import { buildSignedContractHtml } from "../signatures";

const PNG = "data:image/png;base64," + "A".repeat(200) + "==";

describe("validateSignatureData", () => {
  it("PNG/JPEG data URL 만 받는다", () => {
    expect(validateSignatureData({ type: "draw", data: PNG }).ok).toBe(true);
    expect(validateSignatureData({ type: "upload", data: "data:image/jpeg;base64,QUJD" }).ok).toBe(true);
    expect(validateSignatureData({ type: "draw", data: "data:image/svg+xml;base64,QUJD" }).ok).toBe(false);
    expect(validateSignatureData({ type: "draw", data: "https://evil.example/x.png" }).ok).toBe(false);
    expect(validateSignatureData({ type: "draw", data: "data:text/html;base64,QUJD" }).ok).toBe(false);
  });
  it("타이핑 서명은 짧은 글자만, 꺾쇠 금지", () => {
    expect(validateSignatureData({ type: "type", data: "홍길동" }).ok).toBe(true);
    expect(validateSignatureData({ type: "type", data: "<img src=x onerror=alert(1)>" }).ok).toBe(false);
    expect(validateSignatureData({ type: "type", data: "x".repeat(41) }).ok).toBe(false);
  });
  it("모르는 방식·빈 값은 거부", () => {
    expect(validateSignatureData({ type: "html", data: "<b>x</b>" }).ok).toBe(false);
    expect(validateSignatureData(null).ok).toBe(false);
  });
});

describe("validateSignerInputs", () => {
  it("문자열 키/값만, 길이·개수 제한", () => {
    expect(validateSignerInputs({ 옵션: "예" })).toEqual({ ok: true, value: { 옵션: "예" } });
    expect(validateSignerInputs(null)).toEqual({ ok: true, value: null });
    expect(validateSignerInputs({ a: "x".repeat(501) }).ok).toBe(false);
    expect(validateSignerInputs(["a"]).ok).toBe(false);
    expect(validateSignerInputs({ a: { nested: true } }).ok).toBe(false);
  });
});

describe("buildSignedContractHtml — 서버 합성", () => {
  it("입력값과 타이핑 서명은 이스케이프되어 본문에 들어간다", () => {
    const snapshot = '<p>계약 {{?텍스트:비고}}</p><span class="sig-box" data-role="을"></span>';
    const html = buildSignedContractHtml(snapshot, { type: "type", data: "홍길동" }, "홍길동", { 비고: "<script>alert(1)</script>" })!;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("홍길동");
  });
  it("서명자가 보낸 HTML 이 아니라 스냅샷에서만 만든다 (스냅샷이 없으면 null)", () => {
    expect(buildSignedContractHtml(null, { type: "type", data: "x" })).toBeNull();
  });
});

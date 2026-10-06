import { describe, it, expect } from "vitest";
import { contractViewState } from "../contract-view-state";
import { canResendSignature } from "../signatures";

const now = new Date("2026-09-29T00:00:00Z");

describe("contractViewState", () => {
  it("만료된 전자계약 요청: 서명 불가·다시 보내기", () => {
    const v = contractViewState({ source: "signature_request", status: "expired", now });
    expect(v.kind).toBe("expired");
    expect(v.title).not.toContain("서명된");
    expect(v.canOurSign).toBe(false);
    expect(v.resend?.action).toBe("resend_request");
    expect(v.notice).not.toContain("발송자에게");
  });
  it("기한 지난 발송 건도 만료로 본다", () => {
    const v = contractViewState({ source: "signature_request", status: "sent", expiresAt: "2026-09-01T00:00:00Z", now });
    expect(v.kind).toBe("expired");
    expect(v.canOurSign).toBe(false);
  });
  it("상대 서명 끝·우리 서명 전이면 우리 서명 가능", () => {
    const v = contractViewState({ source: "signature_request", status: "signed", now });
    expect(v.kind).toBe("awaiting_ours");
    expect(v.canOurSign).toBe(true);
  });
  it("양측 서명 끝이면 완료·버튼 없음", () => {
    const v = contractViewState({ source: "signature_request", status: "signed", ourSignedAt: "2026-09-02", now });
    expect(v.kind).toBe("fully_signed");
    expect(v.canOurSign).toBe(false);
  });
  it("서명 대기·거절은 우리 서명 불가", () => {
    expect(contractViewState({ source: "signature_request", status: "viewed", now }).canOurSign).toBe(false);
    expect(contractViewState({ source: "signature_request", status: "rejected", now }).canOurSign).toBe(false);
    expect(contractViewState({ source: "quote_approval", status: "rejected", now }).canOurSign).toBe(false);
  });
  it("단건 계약: 서버가 받는 approved·pending_our_signature 에서만 우리 서명", () => {
    expect(contractViewState({ source: "quote_approval", status: "pending_our_signature", now }).canOurSign).toBe(true);
    expect(contractViewState({ source: "quote_approval", status: "approved", now }).canOurSign).toBe(true);
    expect(contractViewState({ source: "quote_approval", status: "fully_signed", now }).canOurSign).toBe(false);
    expect(contractViewState({ source: "quote_approval", status: "expired", now }).canOurSign).toBe(false);
    expect(contractViewState({ source: "quote_approval", status: "sent", now }).canOurSign).toBe(false);
  });
});

describe("canResendSignature", () => {
  const t = new Date("2026-10-06T00:00:00Z").getTime();
  it("만료·취소(expired)는 다시 보낼 수 있다", () => {
    expect(canResendSignature({ status: "expired" }, t)).toBe(true);
  });
  it("기한 지난 발송·열람 건도 다시 보낼 수 있다", () => {
    expect(canResendSignature({ status: "sent", expires_at: "2026-10-01T00:00:00Z" }, t)).toBe(true);
    expect(canResendSignature({ status: "viewed", expires_at: "2026-10-01T00:00:00Z" }, t)).toBe(true);
  });
  it("아직 기한 안의 발송 건·서명 완료·거절은 안 된다", () => {
    expect(canResendSignature({ status: "sent", expires_at: "2026-10-20T00:00:00Z" }, t)).toBe(false);
    expect(canResendSignature({ status: "signed", signed_at: "2026-10-01T00:00:00Z" }, t)).toBe(false);
    expect(canResendSignature({ status: "rejected" }, t)).toBe(false);
  });
});

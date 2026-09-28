import { describe, expect, it } from "vitest";
import { resolveNotificationHref, type NotificationRow } from "@/lib/notification-routes";

const row = (p: Partial<NotificationRow>): NotificationRow => ({
  id: "n1", type: "system", title: "t", message: null, entity_type: null, entity_id: null,
  is_read: false, created_at: "2026-09-28T00:00:00Z", ...p,
});

describe("resolveNotificationHref", () => {
  it("만든 쪽이 정한 link 로 간다 — 재고 점검 알림이 대시보드로 떨어지던 것", () => {
    expect(resolveNotificationHref(row({ type: "inventory", link: "/inventory/status" }), {})).toBe("/inventory/status");
  });

  it("외부 주소·프로토콜 상대 주소는 link 로 받지 않는다", () => {
    expect(resolveNotificationHref(row({ type: "inventory", link: "https://evil.example" }), {})).toBe("/dashboard");
    expect(resolveNotificationHref(row({ type: "inventory", link: "//evil.example" }), {})).toBe("/dashboard");
  });

  it("결재 요청은 내 결재함에서 그 건을 연다", () => {
    expect(resolveNotificationHref(row({ type: "approval_request", entity_type: "approval_request", entity_id: "r1" }), {}))
      .toBe("/approvals?tab=my-approvals&request=r1");
  });

  it("결재 결과는 내 요청에서 그 건을 연다(기존 규칙 유지)", () => {
    expect(resolveNotificationHref(row({ type: "approval_approved", entity_type: "approval_request", entity_id: "r1" }), {}))
      .toBe("/approvals?tab=my-requests&request=r1");
  });

  it("link 가 없으면 기존 entity 매핑", () => {
    expect(resolveNotificationHref(row({ type: "signature_request", entity_type: "signature", entity_id: "s1" }), {})).toBe("/contracts/signed/s1");
  });
});

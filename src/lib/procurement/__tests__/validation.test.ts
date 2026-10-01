import { describe, it, expect } from "vitest";
import {
  parseNotice,
  parseReview,
  parseSettings,
  parseEvidence,
  iso,
  safeUrl,
} from "../validation";
import { DEFAULT_SETTINGS } from "../types";
import { notice, review, evidence } from "./fixtures";
describe("입찰 입력 검증", () => {
  it("정상 입력은 구조화해서 저장한다", () => {
    expect(parseNotice(notice).title).toBe(notice.title);
    expect(parseReview(review).scores).toHaveLength(5);
    expect(parseEvidence(evidence[0]).verifiedAt).toBeNull();
  });
  it.each([
    "2026-09-30",
    "2026-09-30T08:00",
    "2026-02-30T08:00:00+09:00",
    "2026-09-30T24:01:00Z",
  ])("잘못된 일시 %s를 거부한다", (v) =>
    expect(() => iso(v, "마감일")).toThrow(),
  );
  it("한국시간을 UTC로 정확히 변환한다", () =>
    expect(iso("2026-09-30T08:00:00+09:00", "시간")).toBe(
      "2026-09-29T23:00:00.000Z",
    ));
  it.each([
    "javascript:alert(1)",
    "http://g2b.go.kr",
    "https://user:pw@g2b.go.kr",
  ])("위험한 URL %s 거부", (v) => expect(() => safeUrl(v)).toThrow());
  it("과도한 본문과 중복 원문을 거부한다", () => {
    expect(() =>
      parseNotice({
        ...notice,
        documents: [...notice.documents, ...notice.documents],
      }),
    ).toThrow();
    expect(() =>
      parseNotice({
        ...notice,
        documents: [{ ...notice.documents[0], text: "x".repeat(200001) }],
      }),
    ).toThrow();
  });
  it("NaN·소수·문자열 점수와 중복 평가 항목을 거부한다", () => {
    for (const points of [NaN, 1.5, "10", 31])
      expect(() =>
        parseReview({
          ...review,
          scores: [{ ...review.scores[0], points }, ...review.scores.slice(1)],
        }),
      ).toThrow();
    expect(() =>
      parseReview({
        ...review,
        scores: [review.scores[1], ...review.scores.slice(1)],
      }),
    ).toThrow();
  });
  it("수신자 없이 자동발송을 켤 수 없다", () => {
    expect(() =>
      parseSettings({
        ...DEFAULT_SETTINGS,
        collectionEnabled: true,
        digestEnabled: true,
      }),
    ).toThrow();
    expect(() =>
      parseSettings({ ...DEFAULT_SETTINGS, recipients: ["bad"] }),
    ).toThrow();
  });
  it("검색어·수신자 중복을 정리하고 시간 범위를 확인한다", () => {
    expect(
      parseSettings({
        ...DEFAULT_SETTINGS,
        keywords: ["홍보", "홍보"],
        recipients: ["A@example.com", "a@example.com"],
      }),
    ).toMatchObject({ keywords: ["홍보"], recipients: ["a@example.com"] });
    expect(() =>
      parseSettings({ ...DEFAULT_SETTINGS, digestHour: 24 }),
    ).toThrow();
  });
});

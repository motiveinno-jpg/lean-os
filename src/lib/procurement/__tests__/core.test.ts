import { describe, it, expect } from "vitest";
import { evaluate, draftPlan, citationValid } from "../core";
import { emptyReview } from "../types";
import { evidenceHash, noticeHash } from "../fingerprint";
import { notice, evidence, review, now, fixtureWorkspace } from "./fixtures";

describe("입찰 검토의 확정 조건", () => {
  it("회사 자료가 없으면 점수와 자격을 만들지 않는다", () => {
    const a = evaluate(notice, emptyReview(), [], 75, now);
    expect(a.total).toBeNull();
    expect(a.eligibility).toBe("unknown");
    expect(a.recommendation).toBe("hold");
  });
  it("원문·자격·5개 항목 근거와 서류 목록이 갖춰져야 추천한다", () => {
    expect(evaluate(notice, review, evidence, 75, now)).toMatchObject({
      total: 100,
      eligibility: "eligible",
      recommendation: "recommend",
      blockers: [],
    });
  });
  it("0점과 미확정을 구분한다", () => {
    const r = structuredClone(review);
    r.scores[0].points = 0;
    expect(evaluate(notice, r, evidence, 75, now).total).toBe(70);
    r.scores[0].points = null;
    expect(evaluate(notice, r, evidence, 75, now).total).toBeNull();
  });
  it("필수 자격 하나라도 미충족이면 높은 점수로 덮지 않는다", () => {
    const r = structuredClone(review);
    r.requirements[0].status = "unmet";
    expect(evaluate(notice, r, evidence, 75, now)).toMatchObject({
      total: null,
      eligibility: "ineligible",
      recommendation: "exclude",
    });
  });
  it("원문에 없는 인용과 잘못된 문서 ID를 거부한다", () => {
    expect(
      citationValid(
        {
          ...review.requirements[0].citation!,
          quote: "존재하지 않는 홍보 수행 조건",
        },
        notice,
      ),
    ).toBe(false);
    const r = structuredClone(review);
    r.scores[1].citation!.documentId = "another-company";
    expect(evaluate(notice, r, evidence, 75, now).total).toBeNull();
  });
  it.each(["unverified", "expired", "foreign", "future"])(
    "%s 회사 증빙은 확정 점수에서 제외한다",
    (kind) => {
      const es = structuredClone(evidence);
      if (kind === "unverified") es[1].verified = false;
      if (kind === "expired") es[1].expiresAt = "2026-09-29T00:00:00Z";
      if (kind === "foreign") es[1].id = "foreign";
      if (kind === "future") es[1].verifiedAt = "2028-01-01T00:00:00Z";
      expect(evaluate(notice, review, es, 75, now).total).toBeNull();
    },
  );
  it("항목과 무관한 증빙을 연결해서 점수를 채울 수 없다", () => {
    const r = structuredClone(review);
    r.scores[2].evidenceIds = ["evidence-1"];
    expect(evaluate(notice, r, evidence, 75, now).total).toBeNull();
  });
  it("첨부가 빠졌거나 추출 전체 확인이 안 됐으면 보류한다", () => {
    expect(
      evaluate(
        {
          ...notice,
          attachments: [
            { name: "누락첨부.pdf", url: "https://www.g2b.go.kr/a.pdf" },
          ],
        },
        review,
        evidence,
        75,
        now,
      ).recommendation,
    ).toBe("hold");
    const n = structuredClone(notice);
    n.documents[0].complete = false;
    expect(evaluate(n, review, evidence, 75, now).total).toBeNull();
  });
  it.each(["closed", "cancelled", "missing"])(
    "%s 마감·공고 상태를 점수보다 우선한다",
    (kind) => {
      const n = structuredClone(notice);
      if (kind === "closed") n.deadline = now.toISOString();
      if (kind === "cancelled") n.status = "cancelled";
      if (kind === "missing") n.deadline = null;
      expect(evaluate(n, review, evidence, 75, now).recommendation).toBe(
        kind === "missing" ? "hold" : "exclude",
      );
    },
  );
  it("중복 점수와 초과 점수로 100점을 만들 수 없다", () => {
    const r = structuredClone(review);
    r.scores[0].points = 31;
    expect(evaluate(notice, r, evidence, 75, now).total).toBeNull();
    r.scores[0] = r.scores[1];
    expect(evaluate(notice, r, evidence, 75, now).total).toBeNull();
  });
  it("서류 준비 부족은 구체적인 제출 전 경고로 남긴다", () => {
    const r = structuredClone(review);
    r.deliverables[0].status = "missing";
    expect(evaluate(notice, r, evidence, 75, now).warnings).toContain(
      "실적증명서: 제출 전 준비·검수 필요",
    );
  });
});
describe("평가 이력과 문서 초안", () => {
  it("정정 공고·회사정보·증빙·추천 기준 변경을 탐지한다", () => {
    const w = fixtureWorkspace();
    expect(noticeHash({ ...notice, id: "new" })).toBe(noticeHash(notice));
    expect(noticeHash({ ...notice, deadline: null })).not.toBe(
      noticeHash(notice),
    );
    expect(
      evidenceHash(evidence, { ...w.company, address: "변경주소" }, w.settings),
    ).not.toBe(w.reviews[0].evidence_hash);
    expect(
      evidenceHash(evidence, w.company, { ...w.settings, minimumScore: 80 }),
    ).not.toBe(w.reviews[0].evidence_hash);
  });
  it("회사 기본정보를 넣고 미확인 내용은 빈칸으로 남긴다", () => {
    const w = fixtureWorkspace();
    const d = draftPlan(
      w.company,
      notice,
      review,
      evaluate(notice, review, evidence, 75, now),
    );
    expect(d).toContain(w.company.name);
    expect(d).toContain("[작성 필요]");
    expect(d).toContain("제출 완료와 접수 확인");
    expect(d).not.toContain("모티브는 10년간");
  });
});

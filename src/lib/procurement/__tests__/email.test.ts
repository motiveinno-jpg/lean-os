import { describe, it, expect } from "vitest";
import { buildDigest, kstDay } from "../email";
import { evidenceHash } from "../fingerprint";
import { fixtureWorkspace, now } from "./fixtures";
describe("아침 검토 메일", () => {
  it("실적 기반 분류를 자격·종합점수와 별도로 설명한다", () => {
    const w = fixtureWorkspace();
    const mail = buildDigest(
      w,
      evidenceHash(w.evidence, w.company, w.settings),
      now,
    );
    expect(mail.html).toContain("실적 기반 사전 분류: 추가 확인 필요");
    expect(mail.html).toContain(
      "입찰 자격·수행 확정·종합점수를 대신하지 않습니다",
    );
  });
  it("입력 점수가 높아도 근거가 무효면 항목 점수는 미확정으로 보낸다", () => {
    const w = fixtureWorkspace();
    w.reviews[0].review.scores[0].citation!.quote =
      "원문에 없는 점수 근거 문장입니다";
    const m = buildDigest(
      w,
      evidenceHash(w.evidence, w.company, w.settings),
      now,
    );
    expect(m.html).toContain("유사 실적: 미확정");
    expect(m.html).not.toContain("유사 실적: 30/30점");
  });
  it("미수집 상태와 점수 한계를 명시한다", () => {
    const w = fixtureWorkspace();
    const mail = buildDigest(
      w,
      evidenceHash(w.evidence, w.company, w.settings),
      now,
    );
    expect(mail.html).toContain("아직 실행하지 않았습니다");
    expect(mail.html).toContain("낙찰 확률");
    expect(mail.html).toContain("100/100점");
    expect(kstDay(new Date("2026-09-29T23:00:00Z"))).toBe("2026-09-30");
  });
  it("공고·회사 자료가 변경됐으면 옛 점수를 보내지 않는다", () => {
    const w = fixtureWorkspace();
    const mail = buildDigest(w, "new-basis", now);
    expect(mail.html).toContain("재평가 필요");
    expect(mail.html).not.toContain("100/100점");
  });
  it("HTML·속성 주입을 막는다", () => {
    const w = fixtureWorkspace();
    w.notices[0].payload.title = '<img src=x onerror="alert(1)">';
    const mail = buildDigest(w, "new", now);
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img");
  });
  it("빈 목록을 신규공고 0건으로 단정하지 않는다", () => {
    const w = fixtureWorkspace();
    w.notices = [];
    const mail = buildDigest(w, "new", now);
    expect(mail.html).toContain("수집 상태와 검색 범위");
  });
});

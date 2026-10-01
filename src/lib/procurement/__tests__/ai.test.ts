import { describe, it, expect, vi, afterEach } from "vitest";
import { validateAnalysis, callProcurementAI } from "../ai";
import { workforceHash } from "../fingerprint";
import { notice, review, fixtureWorkspace } from "./fixtures";
const analysis = () => ({
  summary: "원문 확인",
  fit: "confirm",
  questions: [],
  tasks: [],
  review: structuredClone(review),
});
afterEach(() => vi.unstubAllEnvs());
describe("AI 근거 검증", () => {
  it("원본 확인은 AI가 완료로 표시할 수 없다", () => {
    const result = validateAnalysis(analysis(), notice, fixtureWorkspace());
    expect(result.review.sourceReviewed).toBe(false);
    expect(result.review.requirementsComplete).toBe(false);
  });
  it("없는 문구와 타 회사 증빙 참조를 거부한다", () => {
    const a = analysis();
    a.review.requirements[0].citation!.quote =
      "원문에는 존재하지 않는 허구의 자격 요건";
    expect(() => validateAnalysis(a, notice, fixtureWorkspace())).toThrow(
      "인용",
    );
    const b = analysis();
    b.review.requirements[0].evidenceIds = ["foreign"];
    expect(() => validateAnalysis(b, notice, fixtureWorkspace())).toThrow(
      "증빙",
    );
  });
  it("실제 짧은 연속 인용은 유일한 원문 문장으로 확장한다", () => {
    const a = analysis();
    a.review.scores[2].citation!.quote = "적정 원가";
    const result = validateAnalysis(a, notice, fixtureWorkspace());
    expect(result.review.scores[2].citation!.quote).toBe(
      "적정 원가와 실제 수행 일정을 제안하여야 합니다.",
    );
  });
  it("중단된 AI 응답은 부분 문서로 저장하지 않는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    await expect(
      callProcurementAI(
        "analysis",
        notice,
        fixtureWorkspace(),
        "",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ stop_reason: "max_tokens", content: [] }),
          ),
      ),
    ).rejects.toThrow("중단");
  });
  it("회사 코드 프로필 변경도 결과를 무효화한다", () => {
    const ws = fixtureWorkspace();
    const before = workforceHash(ws);
    ws.profile = {
      open_date: null,
      size_class: null,
      certifications: [],
      ...ws.profile,
      ksic_main: "changed",
    };
    expect(workforceHash(ws)).not.toBe(before);
  });
});

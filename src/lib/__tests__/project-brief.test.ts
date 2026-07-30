// 주간 체크인 초안 — 없는 숫자를 만들지 않는지, 신호등 규칙이 맞는지.
//   초안이 한 번이라도 틀리면 아무도 안 쓰므로 문장 조립 규칙을 여기서 고정한다.
import { describe, it, expect } from "vitest";

import { buildCheckinDraft, suggestStatus, overallOf } from "@/lib/project-brief";

describe("overallOf — 계산 가능한 KPI 평균", () => {
  it("두 KPI 평균", () => {
    expect(overallOf([{ label: "a", achievement: 0.8 }, { label: "b", achievement: 0.6 }])).toBeCloseTo(0.7);
  });
  it("계산 불가(null)는 평균에서 제외", () => {
    expect(overallOf([{ label: "a", achievement: 0.8 }, { label: "b", achievement: null }])).toBeCloseTo(0.8);
  });
  it("전부 계산 불가면 null — 0% 가 아니다", () => {
    expect(overallOf([{ label: "a", achievement: null }])).toBeNull();
  });
  it("KPI 가 없으면 null", () => {
    expect(overallOf([])).toBeNull();
  });
});

describe("suggestStatus — 모르는 상태를 정상이라 하지 않는다", () => {
  it("달성률 계산 불가 → 주의", () => {
    expect(suggestStatus(null).status).toBe("yellow");
  });
  it("70% 미만 → 위험", () => {
    expect(suggestStatus(0.69).status).toBe("red");
  });
  it("90% 이상 + 지연 없음 → 정상", () => {
    expect(suggestStatus(0.95, 0).status).toBe("green");
  });
  it("숫자가 좋아도 지연된 할 일이 있으면 주의", () => {
    const r = suggestStatus(0.98, 3);
    expect(r.status).toBe("yellow");
    expect(r.reason).toContain("지연된 할 일 3건");
  });
  it("70~90% → 주의", () => {
    expect(suggestStatus(0.84).status).toBe("yellow");
  });
});

describe("buildCheckinDraft — 문장 조립", () => {
  it("지난 기록이 있으면 증감을 쓴다", () => {
    const d = buildCheckinDraft({
      periodLabel: "7월 4주",
      kpis: [{ label: "계약 매출", achievement: 0.84 }, { label: "무재해일", achievement: 0.71 }],
      prevOverall: 0.7,
      overdueTasks: 3,
    });
    // (0.84+0.71)/2 = 0.775 → 부동소수점상 77.4999… → 77% (경계값 그대로 검증)
    expect(d.body).toContain("7월 4주 종합 달성률 77%");
    expect(d.body).toContain("지난 체크인 70% → +7%p");
    expect(d.body).toContain("계약 매출 84% · 무재해일 71%");
    expect(d.body).toContain("지연된 할 일 3건");
    expect(d.status).toBe("yellow");
    expect(d.overall).toBeCloseTo(0.775, 2);
  });

  it("지난 기록이 없으면 증감 문장을 만들지 않는다", () => {
    const d = buildCheckinDraft({ kpis: [{ label: "매출", achievement: 0.9 }] });
    expect(d.body).toContain("종합 달성률 90%");
    expect(d.body).not.toContain("지난 체크인");
  });

  it("계산 불가 KPI 는 문장에서 빠진다", () => {
    const d = buildCheckinDraft({ kpis: [{ label: "매출", achievement: 0.5 }, { label: "미설정", achievement: null }] });
    expect(d.body).toContain("매출 50%");
    expect(d.body).not.toContain("미설정");
  });

  it("실적이 하나도 없으면 그렇다고 적는다", () => {
    const d = buildCheckinDraft({ kpis: [] });
    expect(d.body).toContain("아직 집계할 실적이 없어요");
    expect(d.status).toBe("yellow");
  });

  it("미수는 1원 이하면 언급하지 않는다", () => {
    const zero = buildCheckinDraft({ kpis: [{ label: "매출", achievement: 1 }], outstanding: 0 });
    expect(zero.body).not.toContain("미수");
    const some = buildCheckinDraft({ kpis: [{ label: "매출", achievement: 1 }], outstanding: 12_600_000 });
    expect(some.body).toContain("미수 12,600,000원");
  });

  it("본문 끝에 사람이 채울 자리를 남긴다", () => {
    const d = buildCheckinDraft({ kpis: [{ label: "매출", achievement: 1 }] });
    expect(d.body.trimEnd().endsWith("판단:")).toBe(true);
  });

  it("KPI 가 많아도 4개까지만 나열한다", () => {
    const d = buildCheckinDraft({
      kpis: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `K${n}`, achievement: 0.5 })),
    });
    expect(d.body).toContain("K4");
    expect(d.body).not.toContain("K5");
  });
});

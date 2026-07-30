// 자리 노출 판정 · 대표 지표 자동 선택 — 유형 3분할을 대체한 규칙.
//   이 규칙이 깨지면 "프로젝트를 열었는데 있어야 할 자리가 없다"가 되므로 여기서 먼저 막는다.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  getVisibleSections,
  getDormantSections,
  pickHeadlineKind,
  getHeadline,
  normalizeListView,
  viewStorageKey,
  SECTION_ORDER,
  SECTION_VIEWS,
  READY_LIST_VIEWS,
} from "@/lib/project-sections";

describe("getVisibleSections — 데이터가 생기면 자리가 열린다", () => {
  it("방금 만든 프로젝트: 할 일 자리만 (흐름도 아직 없음)", () => {
    expect(getVisibleSections({})).toEqual(["todo"]);
  });

  it("견적을 넣으면 흐름·돈이 열린다", () => {
    expect(getVisibleSections({ hasMoney: true })).toEqual(["todo", "flow", "money"]);
  });

  it("할 일만 적어도 흐름이 열린다 (내부 프로젝트)", () => {
    expect(getVisibleSections({ hasWork: true })).toEqual(["todo", "flow", "work"]);
  });

  it("KPI만 있으면 성과는 열리지만 흐름은 안 열린다 (보여줄 단계가 없음)", () => {
    expect(getVisibleSections({ hasGoal: true })).toEqual(["todo", "goal"]);
  });

  it("전부 있으면 여섯 자리 모두 — 순서는 항상 SECTION_ORDER", () => {
    const all = getVisibleSections({ hasMoney: true, hasWork: true, hasGoal: true, hasTeam: true });
    expect(all).toEqual(SECTION_ORDER);
  });

  it("자리 순서는 신호 조합이 달라도 뒤바뀌지 않는다", () => {
    const a = getVisibleSections({ hasTeam: true, hasGoal: true, hasMoney: true });
    expect(a).toEqual(["todo", "flow", "money", "goal", "team"]);
  });
});

describe("getDormantSections — 아직 안 열린 자리(＋ 제안 대상)", () => {
  it("빈 프로젝트는 돈·일·성과·팀을 제안한다", () => {
    expect(getDormantSections({})).toEqual(["money", "work", "goal", "team"]);
  });

  it("돈만 있으면 일·성과·팀을 제안한다", () => {
    expect(getDormantSections({ hasMoney: true })).toEqual(["work", "goal", "team"]);
  });

  it("다 열려 있으면 제안이 없다", () => {
    expect(getDormantSections({ hasMoney: true, hasWork: true, hasGoal: true, hasTeam: true })).toEqual([]);
  });

  it("할 일·흐름은 제안 대상이 아니다(끌 수 없는 자리)", () => {
    const d = getDormantSections({});
    expect(d).not.toContain("todo");
    expect(d).not.toContain("flow");
  });
});

describe("pickHeadlineKind — 대표 지표는 있는 데이터에서 고른다", () => {
  it("돈이 걸린 프로젝트는 마진이 먼저", () => {
    expect(pickHeadlineKind({ hasMoney: true, hasWork: true, hasGoal: true })).toBe("margin");
  });
  it("돈이 없고 목표가 있으면 달성률", () => {
    expect(pickHeadlineKind({ hasGoal: true, hasWork: true })).toBe("achievement");
  });
  it("할 일만 있으면 진행률", () => {
    expect(pickHeadlineKind({ hasWork: true })).toBe("progress");
  });
  it("아무 데이터도 없으면 지표 없음", () => {
    expect(pickHeadlineKind({})).toBe("none");
  });
});

describe("getHeadline — 산식은 기존 getHeroMetric 재사용", () => {
  it("마진율: 매출 42,000,000 · 원가 27,300,000 → 35%", () => {
    const h = getHeadline({ hasMoney: true }, { revenue: 42_000_000, cost: 27_300_000 });
    expect(h.kind).toBe("margin");
    expect(h.name).toBe("마진율");
    expect(h.label).toBe("35%");
    expect(h.risk).toBe(false);
  });

  it("마진 적자는 risk 로 표시되고 막대는 0으로 클램프", () => {
    const h = getHeadline({ hasMoney: true }, { revenue: 10_000_000, cost: 12_000_000 });
    expect(h.risk).toBe(true);
    expect(h.pct).toBe(0);
  });

  it("매출이 0이면 계산 불가 — 0% 가 아니라 '—'", () => {
    const h = getHeadline({ hasMoney: true }, { revenue: 0, cost: 0 });
    expect(h.raw).toBeNull();
    expect(h.label).toBe("—");
  });

  it("달성률: 종합 0.84 → 84%", () => {
    const h = getHeadline({ hasGoal: true }, { achievement: 0.84 });
    expect(h.kind).toBe("achievement");
    expect(h.label).toBe("84%");
    expect(h.pct).toBe(84);
  });

  it("달성률 100% 초과도 막대는 100 으로 클램프", () => {
    const h = getHeadline({ hasGoal: true }, { achievement: 1.4 });
    expect(h.pct).toBe(100);
  });

  it("KPI 가 있어도 실적 계산이 안 되면 '—'", () => {
    const h = getHeadline({ hasGoal: true }, { achievement: null });
    expect(h.label).toBe("—");
  });

  it("진행률: 태스크 21/34 → 62%", () => {
    const h = getHeadline({ hasWork: true }, { taskTotal: 34, taskDone: 21 });
    expect(h.kind).toBe("progress");
    expect(h.label).toBe("62%");
  });

  it("신호가 없으면 지표 이름도 '—'", () => {
    const h = getHeadline({}, {});
    expect(h.kind).toBe("none");
    expect(h.name).toBe("—");
    expect(h.label).toBe("—");
  });
});

describe("보기(뷰) 정의", () => {
  it("모든 자리에 보기가 1개 이상 있고 첫 항목이 기본 보기", () => {
    for (const k of SECTION_ORDER) {
      expect(SECTION_VIEWS[k].length).toBeGreaterThan(0);
    }
    expect(SECTION_VIEWS.work[0].key).toBe("tasks"); // 처음 쓰는 사람 기준 = 가장 단순한 보기
    expect(SECTION_VIEWS.money[0].key).toBe("ledger");
  });

  it("목록 기본 보기는 카드 — 저장값이 깨졌거나 미구현 뷰면 카드로 폴백", () => {
    expect(normalizeListView("board")).toBe("board");
    expect(normalizeListView("timeline")).toBe("timeline");
    expect(normalizeListView(null)).toBe("card");
    expect(normalizeListView("몰라요")).toBe("card");
    expect(READY_LIST_VIEWS[0].key).toBe("card");
  });

  it("보기 저장 키는 사람별로 갈린다", () => {
    expect(viewStorageKey("list", "u1")).not.toBe(viewStorageKey("list", "u2"));
    expect(viewStorageKey("list", null)).toBe("ov.view.list.anon");
  });
});

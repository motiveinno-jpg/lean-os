// 정리(요약)·목록 집계 — 시연 데이터 6종 템플릿을 넣어 보고 드러난 3가지를 고정한다.
//   ① 끝난 행은 '기한 지남'에서 뺀다   ② 시작일은 기한이 아니다
//   ③ 단위가 다른 숫자 둘은 빼지 않는다 (수주·매출: 금액(원) − 확률(%))
import { describe, it, expect } from "vitest";
import { buildBoardSummary, terminalOptionId, flowColumnOf, type BoardColumn, type BoardGroup, type BoardItem } from "@/lib/project-boards";
import { rollupProject, listStatusOf } from "@/lib/project-list-summary";

const TODAY = "2026-08-03";
const nameOf = (id: string) => ({ u1: "김혜진", u2: "최송이" }[id] || "");

const col = (o: Partial<BoardColumn> & { id: string; name: string; type: any }): BoardColumn =>
  ({ board_id: "b1", settings: {}, position: 0, ...o } as BoardColumn);
const item = (id: string, group_id: string | null, values: Record<string, any>): BoardItem =>
  ({ id, board_id: "b1", group_id, parent_item_id: null, name: id, values, position: 0 });

const PROGRESS = { options: [
  { id: "todo", label: "대기", color: "#C4C4C4" },
  { id: "doing", label: "진행 중", color: "#FDAB3D" },
  { id: "done", label: "완료", color: "#00C875" },
] };

describe("buildBoardSummary — 집행·성과(목록형 + 상태 컬럼)", () => {
  // 시작 2026-07-01(과거) / 종료 2026-07-31(과거) 인데 상태가 '완료' 인 행
  const cols = [
    col({ id: "c_start", name: "시작", type: "date" }),
    col({ id: "c_end", name: "종료", type: "date" }),
    col({ id: "c_budget", name: "예산", type: "number", settings: { unit: "원" } }),
    col({ id: "c_spent", name: "집행", type: "number", settings: { unit: "원" } }),
    col({ id: "c_st", name: "상태", type: "status", settings: PROGRESS }),
  ];
  const groups: BoardGroup[] = [{ id: "g1", board_id: "b1", name: "집행 목록", color: "#5559DF", position: 0 }];
  const items = [
    item("done1", "g1", { c_start: "2026-07-01", c_end: "2026-07-31", c_budget: 5_000_000, c_spent: 4_820_000, c_st: "done" }),
    item("open1", "g1", { c_start: "2026-07-10", c_end: "2026-08-10", c_budget: 4_000_000, c_spent: 2_100_000, c_st: "doing" }),
    item("open2", "g1", { c_start: "2026-08-05", c_end: "2026-08-25", c_budget: 3_000_000, c_spent: 0, c_st: "todo" }),
  ];
  const cards = buildBoardSummary(cols, items, groups, nameOf, TODAY);
  const dateCard = (label: string) => cards.find((c) => c.kind === "date" && c.label === label) as any;

  it("완료된 행의 지난 마감은 지연이 아니다", () => {
    expect(dateCard("종료").late).toBe(0);
  });
  it("시작일이 과거인 건 지연으로 세지 않는다", () => {
    expect(dateCard("시작").late).toBe(0);
    expect(dateCard("시작").soon).toBe(0);
  });
  it("같은 단위 숫자 둘은 차이 카드를 만든다 (예산 − 집행)", () => {
    const diff = cards.find((c) => c.kind === "diff") as any;
    expect(diff.label).toBe("예산 − 집행");
    expect(diff.value).toBe(12_000_000 - 6_920_000);
  });
});

describe("buildBoardSummary — 수주·매출(단위가 다른 숫자 둘)", () => {
  const cols = [
    col({ id: "c_amt", name: "금액", type: "number", settings: { unit: "원" } }),
    col({ id: "c_prob", name: "확률", type: "number", settings: { unit: "%" } }),
  ];
  const groups: BoardGroup[] = [
    { id: "g1", board_id: "b1", name: "검토", color: "#C4C4C4", position: 0 },
    { id: "g2", board_id: "b1", name: "계약", color: "#00C875", position: 1 },
  ];
  const items = [
    item("a", "g2", { c_amt: 48_000_000, c_prob: 100 }),
    item("b", "g1", { c_amt: 7_000_000, c_prob: 30 }),
  ];
  const cards = buildBoardSummary(cols, items, groups, nameOf, TODAY);

  it("원 − % 차이 카드는 만들지 않는다", () => {
    expect(cards.find((c) => c.kind === "diff")).toBeUndefined();
  });
  it("% 는 합계가 아니라 평균으로 본다", () => {
    const pct = cards.find((c) => c.kind === "number" && c.label === "확률") as any;
    expect(pct.mode).toBe("avg");
    expect(pct.avg).toBe(65);
  });
  it("금액 × 확률 = 가중 금액 카드", () => {
    const w = cards.find((c) => c.kind === "weighted") as any;
    expect(w.value).toBe(48_000_000 * 1 + 7_000_000 * 0.3);
  });
  it("그룹이 여럿이면 그룹 분포 카드를 만든다", () => {
    const g = cards.find((c) => c.kind === "group") as any;
    expect(g.parts.map((p: any) => p.label)).toEqual(["검토", "계약"]);
  });
});

describe("rollupProject — 목록 집계도 같은 규칙", () => {
  const boards = [{ id: "b1", deal_id: "d1", name: "할 일 · 진행", template_key: "todo" }];
  const columns = [
    { id: "c_due", board_id: "b1", type: "date", name: "마감" },
    { id: "c_start", board_id: "b1", type: "date", name: "시작" },
  ];
  const groups = [
    { id: "g1", board_id: "b1", name: "할 일", position: 0 },
    { id: "g2", board_id: "b1", name: "완료", position: 1 },
  ];
  const at = "2026-08-02T00:00:00.000Z";
  const items = [
    // 완료 그룹 — 마감이 지났어도 지연 아님
    { board_id: "b1", group_id: "g2", values: { c_due: "2026-07-15", c_start: "2026-07-01" }, updated_at: at },
    // 진행 중 — 마감 지남 → 지연 1
    { board_id: "b1", group_id: "g1", values: { c_due: "2026-07-30", c_start: "2026-07-20" }, updated_at: at },
    // 이번 주 마감 → 임박 1
    { board_id: "b1", group_id: "g1", values: { c_due: "2026-08-06", c_start: "2026-08-01" }, updated_at: at },
  ];
  const r = rollupProject(boards, columns, groups, items, TODAY);

  it("완료 행과 시작일을 빼고 센다", () => {
    expect(r.lateCount).toBe(1);
    expect(r.soonCount).toBe(1);
  });
  it("완료 그룹 비율로 진행률을 낸다", () => {
    expect(r.doneRate).toBe(33);
  });
  it("지연이 있으면 목록 상태는 '기한 지남'", () => {
    expect(listStatusOf(r)).toBe("late");
  });
});

describe("단계는 라벨 — 종착 옵션은 '마지막에 걸리는 것'", () => {
  // '매출 · 청구' 는 견적 → 계약 → 발행 → 입금. '계약' 도 완료류 낱말이지만 끝은 '입금' 이다.
  const stage = col({ id: "c_stage", name: "단계", type: "status", settings: { flow: true, options: [
    { id: "quote", label: "견적", color: "#C4C4C4" },
    { id: "contract", label: "계약", color: "#5559DF" },
    { id: "issued", label: "발행", color: "#A25DDC" },
    { id: "paid", label: "입금", color: "#00C875" },
  ] } });
  const groups: BoardGroup[] = [{ id: "g1", board_id: "b1", name: "청구 목록", color: "#5559DF", position: 0 }];
  const items = [
    item("a", "g1", { c_stage: "paid" }),
    item("b", "g1", { c_stage: "contract" }),
    item("c", "g1", { c_stage: "quote" }),
    item("d", "g1", { c_stage: "issued" }),
  ];

  it("종착은 '입금' 이지 '계약' 이 아니다", () => {
    expect(terminalOptionId(stage)).toBe("paid");
  });
  it("완료율은 입금 기준 25%", () => {
    const cards = buildBoardSummary([stage], items, groups, nameOf, TODAY);
    const st = cards.find((c) => c.kind === "status") as any;
    expect(st.doneRate).toBe(25);
  });
  it("흐름 컬럼을 칸반 열로 고른다", () => {
    const plain = col({ id: "c_pri", name: "우선순위", type: "status", settings: PROGRESS });
    expect(flowColumnOf([plain, stage])?.id).toBe("c_stage");
  });
  it("목록 완료율도 라벨에서 낸다 — 그룹이 하나여도", () => {
    const r = rollupProject(
      [{ id: "b1", deal_id: "d1", name: "매출 · 청구", template_key: "billing" }],
      [{ id: "c_stage", board_id: "b1", type: "status", name: "단계", settings: stage.settings }],
      [{ id: "g1", board_id: "b1", name: "청구 목록", position: 0 }],
      items.map((i) => ({ board_id: "b1", group_id: "g1", values: i.values, updated_at: "2026-08-02T00:00:00.000Z" })),
      TODAY,
    );
    expect(r.doneRate).toBe(25);
  });
});

describe("listStatusOf — 표가 비면 '정상'이라고 하지 않는다", () => {
  it("표가 없으면 empty", () => {
    expect(listStatusOf({ boardCount: 0, boardNames: [], itemCount: 0, quietDays: null, lateCount: 0, soonCount: 0, doneRate: null })).toBe("empty");
  });
  it("표는 있는데 행이 없으면 empty", () => {
    expect(listStatusOf({ boardCount: 2, boardNames: ["a", "b"], itemCount: 0, quietDays: null, lateCount: 0, soonCount: 0, doneRate: null })).toBe("empty");
  });
});

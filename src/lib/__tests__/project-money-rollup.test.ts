// 돈 집계 — 숫자가 한 번이라도 틀리면 화면 전체를 못 믿는다. 규칙을 여기서 못박는다.
import { describe, it, expect } from "vitest";
import { rollupMoney, stageOfLabel, weeklyCashflow, type MoneyBoard } from "@/lib/project-money-rollup";
import type { BoardColumn, BoardItem } from "@/lib/project-boards";

const TODAY = "2026-08-05";

const col = (o: { id: string; board_id: string; name: string; type: any; settings?: any }): BoardColumn =>
  ({ position: 0, settings: {}, ...o } as BoardColumn);
const item = (id: string, board_id: string, name: string, values: Record<string, any>): BoardItem =>
  ({ id, board_id, group_id: "g", parent_item_id: null, name, values, position: 0 });

const FLOW_BILL = { flow: true, options: [
  { id: "quote", label: "견적", color: "#C4C4C4" },
  { id: "contract", label: "계약", color: "#5559DF" },
  { id: "issued", label: "발행", color: "#A25DDC" },
  { id: "paid", label: "입금", color: "#00C875" },
] };
const PROGRESS = { options: [
  { id: "todo", label: "대기", color: "#C4C4C4" },
  { id: "doing", label: "진행 중", color: "#FDAB3D" },
  { id: "done", label: "완료", color: "#00C875" },
] };

describe("stageOfLabel — 라벨 낱말로 단계를 읽는다", () => {
  it("입금·지급·완료는 끝(paid)", () => {
    ["입금", "지급", "수금", "완료"].forEach((l) => expect(stageOfLabel(l)).toBe("paid"));
  });
  it("발행·증빙·계산서는 billed", () => {
    ["발행", "증빙", "계산서"].forEach((l) => expect(stageOfLabel(l)).toBe("billed"));
  });
  it("계약·확정·진행은 fixed", () => {
    ["계약", "확정", "진행 중"].forEach((l) => expect(stageOfLabel(l)).toBe("fixed"));
  });
  it("나머지는 계획(plan)", () => {
    ["견적", "대기", "검토"].forEach((l) => expect(stageOfLabel(l)).toBe("plan"));
  });
});

describe("rollupMoney — 매출·청구 단계별", () => {
  const boards: MoneyBoard[] = [{ id: "b1", name: "매출 · 청구", template_key: "billing" }];
  const cols = [
    col({ id: "c_st", board_id: "b1", name: "단계", type: "status", settings: FLOW_BILL }),
    col({ id: "c_amt", board_id: "b1", name: "금액", type: "number", settings: { unit: "원" } }),
    col({ id: "c_due", board_id: "b1", name: "예정일", type: "date" }),
  ];
  const items = [
    item("i1", "b1", "착수금", { c_st: "paid", c_amt: 24_000_000, c_due: "2026-07-20" }),
    item("i2", "b1", "중도금", { c_st: "issued", c_amt: 18_000_000, c_due: "2026-07-10" }),
    item("i3", "b1", "잔금", { c_st: "contract", c_amt: 18_000_000, c_due: "2026-09-05" }),
    item("i4", "b1", "추가 건", { c_st: "quote", c_amt: 6_000_000, c_due: "2026-08-18" }),
  ];
  const r = rollupMoney(boards, cols, items, { today: TODAY });

  it("단계별로 나뉘고 합계가 맞는다", () => {
    expect(r.income.byStage.paid).toBe(24_000_000);
    expect(r.income.byStage.billed).toBe(18_000_000);
    expect(r.income.byStage.fixed).toBe(18_000_000);
    expect(r.income.byStage.plan).toBe(6_000_000);
    expect(r.income.total).toBe(66_000_000);
  });
  it("확정 기준은 계획을 뺀다", () => {
    expect(r.margin).toBe(60_000_000);   // 지출 0
  });
  it("현금 기준은 실제 오간 돈만", () => {
    const cash = rollupMoney(boards, cols, items, { basis: "cash", today: TODAY });
    expect(cash.margin).toBe(24_000_000);
  });
  it("기한이 지났는데 안 끝난 건을 '막힌 것' 으로 집는다", () => {
    // 중도금: 발행 상태로 예정일 07-10 이 지났다
    expect(r.stuck.some((s) => s.name === "중도금" && s.stage === "billed")).toBe(true);
    // 입금된 착수금은 기한이 지났어도 막힌 게 아니다
    expect(r.stuck.some((s) => s.name === "착수금")).toBe(false);
  });
});

describe("rollupMoney — 지출은 '비용 · 지출' 만 센다(이중 계상 방지)", () => {
  const boards: MoneyBoard[] = [
    { id: "cost", name: "비용 · 지출", template_key: "cost" },
    { id: "bud", name: "집행 · 성과", template_key: "budget" },
  ];
  const cols = [
    col({ id: "k_st", board_id: "cost", name: "상태", type: "status", settings: PROGRESS }),
    col({ id: "k_plan", board_id: "cost", name: "예상", type: "number", settings: { unit: "원" } }),
    col({ id: "k_fix", board_id: "cost", name: "확정", type: "number", settings: { unit: "원" } }),
    col({ id: "b_plan", board_id: "bud", name: "예산", type: "number", settings: { unit: "원" } }),
    col({ id: "b_spent", board_id: "bud", name: "집행", type: "number", settings: { unit: "원" } }),
  ];
  const items = [
    item("c1", "cost", "인스타 광고비 (7월)", { k_st: "done", k_plan: 5_000_000, k_fix: 4_820_000 }),
    item("c2", "cost", "전단 인쇄", { k_st: "done", k_plan: 800_000, k_fix: 760_000 }),
    item("c3", "cost", "인플루언서 수수료", { k_st: "todo", k_plan: 3_000_000, k_fix: 0 }),
    // 같은 지출이 예산표에도 있다 — 더하면 이중 계상
    item("b1", "bud", "여름 프로모션 인스타 광고", { b_plan: 5_000_000, b_spent: 4_820_000 }),
    item("b2", "bud", "오프라인 전단 배포", { b_plan: 800_000, b_spent: 760_000 }),
  ];
  const r = rollupMoney(boards, cols, items, { today: TODAY });

  it("총 지출에 예산표(집행)를 더하지 않는다", () => {
    // 지급 4,820,000 + 760,000, 계획 3,000,000 = 8,580,000
    expect(r.spend.total).toBe(8_580_000);
    expect(r.spend.byStage.paid).toBe(5_580_000);
    expect(r.spend.byStage.plan).toBe(3_000_000);
  });
  it("예산은 소진율로만 따로 낸다", () => {
    expect(r.budget).toEqual({ planned: 5_800_000, spent: 5_580_000, rate: 96 });
  });
  it("같은 금액이 두 표에 있으면 겹침으로 알려 준다", () => {
    expect(r.overlaps.map((o) => o.amount).sort((a, b) => a - b)).toEqual([760_000, 4_820_000]);
  });
  it("확정 금액이 없으면 예상액을 '계획' 으로 둔다", () => {
    // 인플루언서 수수료는 확정 0 → 예상 3,000,000 이 계획 단계
    expect(r.spend.byStage.plan).toBe(3_000_000);
  });
});

describe("weeklyCashflow — 언제 자금이 비나", () => {
  // 2026-08-05(수)가 오늘. 그 주 월요일은 2026-08-03.
  const boards: MoneyBoard[] = [
    { id: "bill", name: "매출 · 청구", template_key: "billing" },
    { id: "cost", name: "비용 · 지출", template_key: "cost" },
    { id: "bud", name: "집행 · 성과", template_key: "budget" },
  ];
  const cols = [
    col({ id: "i_st", board_id: "bill", name: "단계", type: "status", settings: FLOW_BILL }),
    col({ id: "i_amt", board_id: "bill", name: "금액", type: "number", settings: { unit: "원" } }),
    col({ id: "i_due", board_id: "bill", name: "예정일", type: "date" }),
    col({ id: "s_st", board_id: "cost", name: "상태", type: "status", settings: PROGRESS }),
    col({ id: "s_fix", board_id: "cost", name: "확정", type: "number", settings: { unit: "원" } }),
    col({ id: "s_due", board_id: "cost", name: "결제일", type: "date" }),
    col({ id: "b_spent", board_id: "bud", name: "집행", type: "number", settings: { unit: "원" } }),
    col({ id: "b_due", board_id: "bud", name: "종료", type: "date" }),
  ];
  const items = [
    item("a", "bill", "이번 주 입금 예정", { i_st: "issued", i_amt: 10_000_000, i_due: "2026-08-07" }),
    item("b", "bill", "다음 주", { i_st: "contract", i_amt: 5_000_000, i_due: "2026-08-12" }),
    item("c", "bill", "이미 받음", { i_st: "paid", i_amt: 9_000_000, i_due: "2026-08-06" }),
    item("d", "bill", "지난 건", { i_st: "issued", i_amt: 3_000_000, i_due: "2026-07-20" }),
    item("e", "cost", "이번 주 지급", { s_st: "doing", s_fix: 12_000_000, s_due: "2026-08-06" }),
    item("f", "cost", "먼 미래", { s_st: "todo", s_fix: 1_000_000, s_due: "2027-01-01" }),
    item("g", "bud", "예산 건", { b_spent: 8_000_000, b_due: "2026-08-07" }),
  ];
  const w = weeklyCashflow(boards, cols, items, TODAY, 8);
  const byKey = (k: string) => w.find((x) => x.key === k)!;

  it("이번 주는 들어올 1,000만 · 나갈 1,200만 → 순액 마이너스", () => {
    const t = byKey("2026-08-03");
    expect(t.income).toBe(10_000_000);
    expect(t.spend).toBe(12_000_000);
    expect(t.net).toBe(-2_000_000);
  });
  it("이미 오간 돈(입금 완료)은 앞날 계획에 안 넣는다", () => {
    expect(w.reduce((s, x) => s + x.income, 0)).toBe(18_000_000);   // 10 + 5 + 지난 3
  });
  it("기한 지난 미완료 건은 '지남' 칸에 모은다", () => {
    expect(byKey("past").income).toBe(3_000_000);
  });
  it("예산 표는 예정 자금이 아니다", () => {
    expect(w.every((x) => x.spend !== 8_000_000)).toBe(true);
  });
  it("8주 밖은 안 그린다", () => {
    expect(w.reduce((s, x) => s + x.spend, 0)).toBe(12_000_000);
  });
});

describe("rollupMoney — 수주는 확률로 가중해 '예상' 에만 넣는다", () => {
  const boards: MoneyBoard[] = [{ id: "p", name: "수주 · 매출", template_key: "pipeline" }];
  const cols = [
    col({ id: "p_st", board_id: "p", name: "단계", type: "status", settings: { flow: true, options: [
      { id: "review", label: "검토", color: "#C4C4C4" },
      { id: "won", label: "계약", color: "#00C875" },
    ] } }),
    col({ id: "p_amt", board_id: "p", name: "금액", type: "number", settings: { unit: "원" } }),
    col({ id: "p_pct", board_id: "p", name: "확률", type: "number", settings: { unit: "%" } }),
  ];
  const items = [
    item("q1", "p", "검토 건", { p_st: "review", p_amt: 10_000_000, p_pct: 30 }),
    item("q2", "p", "계약 건", { p_st: "won", p_amt: 20_000_000, p_pct: 100 }),
  ];
  const r = rollupMoney(boards, cols, items, { today: TODAY });

  it("검토 건은 확률 가중, 계약 건은 액면 그대로", () => {
    expect(r.income.byStage.plan).toBe(3_000_000);
    expect(r.income.byStage.fixed).toBe(20_000_000);
  });
});

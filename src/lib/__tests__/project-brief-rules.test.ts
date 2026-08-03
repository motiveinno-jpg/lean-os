import { describe, it, expect } from "vitest";
import { buildProjectBrief, type BriefFacts } from "@/lib/project-brief-rules";

const base: BriefFacts = {
  contractNet: 0, contractInc: 0, billed: 0, paid: 0, outstanding: 0, oldestUnpaidDays: null,
  costNet: 0, goalAmount: 0, taskCount: 0, taskDone: 0, overdueCount: 0,
  daysToEnd: null, quietDays: null, finished: false, partnerName: null,
};

describe("buildProjectBrief — 사실만으로 브리핑을 만든다(AI 없이)", () => {
  it("빈 프로젝트: 없는 숫자를 지어내지 않고 시작 안내만 준다", () => {
    const b = buildProjectBrief(base);
    expect(b.headline).toBe("아직 쌓인 기록이 없어요");
    expect(b.issues).toEqual([]);
    expect(b.nexts).toContain("견적서를 만들면 금액이 잡혀요");
  });

  it("마감 초과 + 미수금: 급한 두 가지가 한 줄에 온다", () => {
    const b = buildProjectBrief({ ...base, daysToEnd: -3, billed: 13_200_000, paid: 12_173_000, outstanding: 1_027_000, oldestUnpaidDays: 62, partnerName: "포블럭스" });
    expect(b.headline).toBe("마감 3일 초과 · 미수금 1,027,000원 · 62일 경과");
    expect(b.nexts).toContain("포블럭스에 입금 일정 확인");
  });

  it("60일 이하 미수는 경과일을 붙이지 않는다", () => {
    const b = buildProjectBrief({ ...base, billed: 1_000_000, paid: 0, outstanding: 1_000_000, oldestUnpaidDays: 10 });
    expect(b.issues[0]).toBe("미수금 1,000,000원");
  });

  it("지연 업무가 있으면 문제와 다음 할 일이 짝을 이룬다", () => {
    const b = buildProjectBrief({ ...base, taskCount: 6, taskDone: 2, overdueCount: 2 });
    expect(b.issues).toContain("기한 지난 업무 2건");
    expect(b.nexts).toContain("지연된 업무 2건 기한 조정");
  });

  it("전액 입금·목표 달성은 잘된 점으로 잡힌다", () => {
    const b = buildProjectBrief({ ...base, contractInc: 22_000_000, billed: 22_000_000, paid: 22_000_000, goalAmount: 20_000_000 });
    expect(b.goods).toContain("발행액 전액 입금 완료");
    expect(b.goods).toContain("목표 110% 달성");
    expect(b.headline).toContain("특별한 문제 없어요");
  });

  it("마진 적자는 문제로, 흑자 30%+ 는 잘된 점으로", () => {
    const bad = buildProjectBrief({ ...base, billed: 11_000_000, costNet: 12_000_000 });
    expect(bad.issues.some((s) => s.startsWith("마진 적자"))).toBe(true);
    const good = buildProjectBrief({ ...base, billed: 11_000_000, costNet: 5_000_000 });
    expect(good.goods.some((s) => s.startsWith("마진율"))).toBe(true);
  });

  it("비용이 없으면 '비용을 등록하면 마진이 계산돼요'를 안내한다", () => {
    const b = buildProjectBrief({ ...base, billed: 5_000_000, paid: 5_000_000 });
    expect(b.nexts).toContain("비용을 등록하면 마진이 계산돼요");
  });

  it("2주 넘게 조용하면 문제로 잡고 한 줄 기록을 권한다", () => {
    const b = buildProjectBrief({ ...base, quietDays: 21, contractInc: 1_000_000 });
    expect(b.issues).toContain("21일째 변동 없음");
    expect(b.nexts).toContain("이번 주 한 줄 기록 남기기");
  });

  it("완료된 프로젝트는 완료로 요약한다", () => {
    const b = buildProjectBrief({ ...base, finished: true, daysToEnd: -30, billed: 1_000_000, paid: 1_000_000 });
    expect(b.headline).toBe("완료된 프로젝트예요");
    expect(b.issues).toEqual([]);
  });

  it("목표 대비 수주가 절반 미만이면 문제로 잡는다", () => {
    const b = buildProjectBrief({ ...base, goalAmount: 20_000_000, contractInc: 5_000_000 });
    expect(b.issues).toContain("목표의 25%만 수주");
  });

  it("항목 수 상한 — 잘된 점 2 · 문제 3 · 다음 3", () => {
    const b = buildProjectBrief({
      ...base, daysToEnd: -10, overdueCount: 3, outstanding: 9_000_000, oldestUnpaidDays: 90,
      billed: 10_000_000, costNet: 9_800_000, goalAmount: 50_000_000, contractInc: 10_000_000, quietDays: 30,
    });
    expect(b.goods.length).toBeLessThanOrEqual(2);
    expect(b.issues.length).toBeLessThanOrEqual(3);
    expect(b.nexts.length).toBeLessThanOrEqual(3);
  });
});

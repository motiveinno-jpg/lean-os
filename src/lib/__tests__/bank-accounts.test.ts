import { describe, it, expect } from "vitest";
import { isAutoBankAccount, splitBankAccounts, sumBankBalance, BANK_GROUP_LABEL, AUTO_BANK_SOURCE } from "@/lib/bank-accounts";

//   2026-09-11 사장님 제보: 모티브 통장 8개가 전부 자동 수집인데 은행연동 탭의 '직접 등록한 통장'
//   칸이 8개·합계 3,379만원으로 세고 있었다. 원인은 갈래를 나누지 않은 전체 목록을 그 칸이 쓴 것.
//   판정과 합계를 이 한 벌로 모았으니, 여기서 갈래가 어긋나면 두 탭이 같이 틀린다.
const acc = (source: string, balance: number) => ({ source, balance }) as any;

describe("통장 갈래", () => {
  it("source 가 codef 면 연동 통장", () => {
    expect(AUTO_BANK_SOURCE).toBe("codef");
    expect(isAutoBankAccount(acc("codef", 0))).toBe(true);
    expect(isAutoBankAccount(acc("manual", 0))).toBe(false);
    //   컬럼 기본값이 'manual' 이지만 값이 비어 오더라도 연동으로 오인하지 않는다
    expect(isAutoBankAccount(null)).toBe(false);
    expect(isAutoBankAccount({ source: null } as any)).toBe(false);
  });

  it("모두 자동 수집이면 직접 등록한 통장은 0개다 (모티브에서 난 일)", () => {
    const list = Array.from({ length: 8 }, () => acc("codef", 4_224_389));
    const { auto, manual } = splitBankAccounts(list);
    expect(auto).toHaveLength(8);
    expect(manual).toHaveLength(0);
    expect(sumBankBalance(manual)).toBe(0);
  });

  it("섞여 있으면 각자 제 갈래로 가고 합계가 나뉜다", () => {
    const { auto, manual } = splitBankAccounts([acc("codef", 100), acc("manual", 30), acc("codef", 70), acc("manual", 5)]);
    expect(sumBankBalance(auto)).toBe(170);
    expect(sumBankBalance(manual)).toBe(35);
  });

  it("빈 목록·잔고 없음도 0 으로 센다", () => {
    expect(splitBankAccounts([]).manual).toHaveLength(0);
    expect(sumBankBalance([])).toBe(0);
    expect(sumBankBalance([acc("manual", null as any), acc("manual", undefined as any)])).toBe(0);
  });

  it("이름은 한 개념에 하나", () => {
    expect(BANK_GROUP_LABEL.auto).toBe("연동 통장");
    expect(BANK_GROUP_LABEL.manual).toBe("직접 등록한 통장");
  });
});

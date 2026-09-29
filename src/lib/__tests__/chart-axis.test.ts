import { describe, it, expect } from "vitest";
import { fmtAxisKrw, niceStep, niceTicks, monotonePath, tipEdge } from "@/lib/chart-axis";

describe("fmtAxisKrw", () => {
  it("0 은 단위 없이", () => { expect(fmtAxisKrw(0)).toBe("0"); });
  it("억·만·원 단위", () => {
    expect(fmtAxisKrw(250_000_000)).toBe("2.5억");
    expect(fmtAxisKrw(500_000_000)).toBe("5억");
    expect(fmtAxisKrw(50_000_000)).toBe("5,000만");
    expect(fmtAxisKrw(25_000)).toBe("2.5만");
    expect(fmtAxisKrw(9_000)).toBe("9,000");
  });
  it("음수는 앞에 −", () => { expect(fmtAxisKrw(-30_000_000)).toBe("−3,000만"); });
});

describe("niceTicks", () => {
  it("간격은 1·2·2.5·5 계열", () => {
    expect(niceStep(2520_0000)).toBe(5000_0000);
    expect(niceStep(1.9e7)).toBe(2e7);
    expect(niceStep(2.3e7)).toBe(2.5e7);
  });
  it("0 을 포함하고 끝이 눈금에 맞는다", () => {
    const t = niceTicks(0, 226_000_000, 4);
    expect(t.ticks[0]).toBe(0);
    expect(t.hi).toBeGreaterThanOrEqual(226_000_000);
    expect(t.ticks.every((v) => v % t.step === 0)).toBe(true);
    expect(t.ticks.map(fmtAxisKrw)).toEqual(["0", "1억", "2억", "3억"]);
  });
  it("음수 범위도 덮는다", () => {
    const t = niceTicks(-12_000_000, 40_000_000, 4);
    expect(t.lo).toBeLessThan(0);
    expect(t.ticks).toContain(0);
  });
});

describe("monotonePath", () => {
  //   경로의 제어점 y 가 이웃 두 점 y 사이에 있으면 곡선이 넘치지 않는다
  const ctrlYs = (d: string) => [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[2]), Number(m[4])]);
  it("급등 뒤 급락에서 0 아래로 내려가지 않는다", () => {
    //   화면 좌표 — y 가 클수록 아래. 0 선 = y 200
    const pts = [{ x: 0, y: 200 }, { x: 50, y: 200 }, { x: 100, y: 20 }, { x: 150, y: 200 }, { x: 200, y: 190 }];
    for (const [c1, c2] of ctrlYs(monotonePath(pts))) {
      expect(c1).toBeLessThanOrEqual(200);
      expect(c2).toBeLessThanOrEqual(200);
    }
  });
  it("점 한두 개", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(monotonePath([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe("M0,0 L1,1");
  });
});

describe("tipEdge", () => {
  it("끝 점은 안쪽 정렬", () => {
    expect(tipEdge(0)).toBe("viz-tip-at-l");
    expect(tipEdge(50)).toBe("");
    expect(tipEdge(100)).toBe("viz-tip-at-r");
  });
});

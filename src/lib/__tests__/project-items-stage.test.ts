// 프로젝트 업무의 "완료" 판정 — 단계 목록의 마지막 단계. 표·간트·프로젝트 목록·내 담당 업무가 같은 함수를 쓴다.
import { describe, it, expect } from "vitest";
import { lastStageId, stagesOf, DEFAULT_STAGES } from "../project-items";

describe("lastStageId", () => {
  it("단계 목록의 마지막 id", () => {
    expect(lastStageId([{ id: "g1", label: "진행 중" }, { id: "g2", label: "완료" }])).toBe("g2");
    expect(lastStageId([{ id: "g1", label: "할 것" }, { id: "g2", label: "하는 중" }, { id: "g3", label: "완료" }])).toBe("g3");
  });
  it("목록이 없거나 비면 기본 3단계의 done", () => {
    expect(lastStageId(null)).toBe("done");
    expect(lastStageId([])).toBe("done");
    expect(lastStageId(undefined)).toBe("done");
    expect(lastStageId(stagesOf(null))).toBe(DEFAULT_STAGES[DEFAULT_STAGES.length - 1].id);
  });
});

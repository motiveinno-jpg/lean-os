import { describe, it, expect } from "vitest";
import {
  workforceSummary,
  type StaffRecord,
  type WorkRecord,
} from "../workforce";
const now = new Date("2026-10-01T00:00:00Z");
const member: StaffRecord = {
  id: "employee",
  name: "검증용 직원",
  user_id: "user",
  department: "마케팅",
  position: "팀장",
  job_role: null,
  job_title: null,
  status: "joined",
  hire_date: "2025-01-01",
  resignation_date: null,
  contract_end_date: null,
};
const task: WorkRecord = {
  id: "task",
  deal_id: "project",
  title: "검증용 업무",
  status: "todo",
  assignee_id: "user",
  due_date: "2026-09-30",
  archived_at: null,
};
const project = {
  id: "project",
  name: "검증용 프로젝트",
  item_stages: [{ id: "open" }, { id: "finished" }],
  archived_at: null,
};
describe("오너뷰 인력·업무 참고", () => {
  it("재직·가입완료만 명단에 넣고 퇴사·미입사·계약종료를 구분한다", () => {
    const all = [
      member,
      { ...member, id: "left", status: "inactive" },
      { ...member, id: "future", hire_date: "2026-10-02" },
      { ...member, id: "resigned", resignation_date: "2026-10-01" },
      { ...member, id: "ended", contract_end_date: "2026-09-30" },
    ];
    const result = workforceSummary(all, [], [], [], now);
    expect(result.members).toHaveLength(1);
    expect(result.excludedCount).toBe(4);
  });
  it("공동 담당도 대조하고 중복 담당 ID로 업무를 중복 세지 않는다", () => {
    const result = workforceSummary(
      [member],
      [],
      [
        {
          ...task,
          kind: "todo",
          assignee_id: "other",
          assignee_ids: ["user", "user"],
        },
      ],
      [project],
      now,
    );
    expect(result.members[0].assignments).toHaveLength(1);
    expect(result.members[0].assignments[0].overdue).toBe(true);
  });
  it("프로젝트 사용자 지정 완료 단계와 보관한 업무를 제외한다", () => {
    const result = workforceSummary(
      [member],
      [{ ...task, status: "done" }],
      [
        { ...task, kind: "todo", status: "finished" },
        { ...task, kind: "todo", archived_at: "2026-09-30" },
      ],
      [project],
      now,
    );
    expect(result.members[0].assignments).toHaveLength(0);
  });
  it("보관 프로젝트와 회의 메모는 미완료 업무 수에 섞지 않는다", () => {
    expect(
      workforceSummary(
        [member],
        [task],
        [{ ...task, kind: "note" }],
        [{ ...project, archived_at: "2026-09-30" }],
        now,
      ).members[0].assignments,
    ).toHaveLength(0);
  });
  it("사용자 미연결을 여유 인력으로 표시하지 않는다", () => {
    const result = workforceSummary(
      [{ ...member, user_id: null }],
      [task],
      [],
      [project],
      now,
    );
    expect(result.members[0].linked).toBe(false);
    expect(result.caveat).toContain("여유 인력으로 단정하지 않습니다");
  });
});

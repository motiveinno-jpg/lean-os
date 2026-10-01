import { lastStageId } from "@/lib/project-items";
export type StaffRecord = {
  id: string;
  name: string;
  user_id: string | null;
  department: string | null;
  position: string | null;
  job_role: string | null;
  job_title: string | null;
  status: string | null;
  hire_date: string | null;
  resignation_date: string | null;
  contract_end_date: string | null;
};
export type WorkRecord = {
  id: string;
  deal_id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  assignee_ids?: string[];
  due_date: string | null;
  archived_at: string | null;
  kind?: string;
};
export type StaffProject = {
  id: string;
  name: string;
  item_stages: unknown;
  archived_at: string | null;
};
export function workforceSummary(
  employees: StaffRecord[],
  tasks: WorkRecord[],
  items: WorkRecord[],
  projects: StaffProject[],
  now = new Date(),
) {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const activeProjects = new Map(
    projects.filter((p) => !p.archived_at).map((p) => [p.id, p]),
  );
  const work = [
    ...tasks
      .filter((t) => t.status !== "done")
      .map((t) => ({ ...t, source: "project_tasks" })),
    ...items
      .filter(
        (t) =>
          t.kind === "todo" &&
          t.status !== lastStageId(activeProjects.get(t.deal_id)?.item_stages),
      )
      .map((t) => ({ ...t, source: "project_items" })),
  ].filter((t) => !t.archived_at && activeProjects.has(t.deal_id));
  const current = employees.filter(
    (e) =>
      ["active", "joined"].includes(e.status || "") &&
      (!e.hire_date || e.hire_date <= day) &&
      (!e.resignation_date || e.resignation_date > day) &&
      (!e.contract_end_date || e.contract_end_date >= day),
  );
  return {
    source: "오너뷰 직원·프로젝트 업무",
    observedAt: now.toISOString(),
    members: current.map((e) => {
      const assignments = e.user_id
        ? work.filter((t) =>
            new Set([t.assignee_id, ...(t.assignee_ids || [])]).has(e.user_id!),
          )
        : [];
      return {
        id: e.id,
        name: e.name,
        department: e.department,
        position: e.position,
        role: e.job_role || e.job_title || null,
        linked: !!e.user_id,
        assignments: assignments.map((t) => ({
          id: t.id,
          title: t.title,
          project: activeProjects.get(t.deal_id)!.name,
          dealId: t.deal_id,
          dueDate: t.due_date,
          source: t.source,
          overdue: !!t.due_date && t.due_date < day,
        })),
      };
    }),
    excludedCount: employees.length - current.length,
    unassignedCount: work.filter(
      (t) => !t.assignee_id && !t.assignee_ids?.length,
    ).length,
    caveat:
      "오너뷰 재직 상태·입사/퇴사/계약 종료일로 현재 명단을 확인합니다. 부서·직책은 전문 역량 증명을 대신하지 않습니다. 미완료 배정 업무는 업무 부하 참고이며, 기록이 없다고 여유 인력으로 단정하지 않습니다. 가용 시간·동시 수행률은 아직 확정하지 않습니다.",
  };
}

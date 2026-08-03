// 내가 담당인 프로젝트 업무 — 개인 할 일 화면(대시보드 위젯·일정 › 할 일)에서 같이 보여준다.
//
// 배경 (2026-08-03 실측):
//   project_tasks 62건 중 담당자가 지정된 건 60건(97%)인데, 그 담당자의 "내 할일" 어디에도
//   뜨지 않았다. 프로젝트에 직접 들어가야만 자기 일을 볼 수 있어서, 할 일을 잘 쓰는 사람도
//   프로젝트를 안 열면 놓친다. 반대로 개인 할 일(schedule_todos)은 6건뿐이라 두 곳이 따로 놀았다.
//   → 읽기를 합치고(이 파일), 개인 할 일은 프로젝트로 올릴 수 있게 한다(일정 › 할 일).
//
// 절대규칙: 조회만 한다. 완료·수정은 각 화면이 기존 경로(project_tasks 업데이트)로 처리한다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type MyProjectTask = {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  deal_id: string;
  dealName: string;
};

/** 내가 담당(단일 담당·다중 담당 모두)인 미완료 프로젝트 업무. 마감일 빠른 순. */
export async function getMyProjectTasks(companyId: string, userId: string): Promise<MyProjectTask[]> {
  //   담당 필터는 서버가 아니라 여기서 건다 — assignee_ids 가 jsonb 라 PostgREST 배열 문법이
  //   먹지 않고, 단일 담당(assignee_id)과 다중 담당을 한 번에 거르려면 조건이 지저분해진다.
  const rows = logRead('my-project-tasks:rows', await supabase
    .from("project_tasks")
    .select("id, title, due_date, status, deal_id, assignee_id, assignee_ids")
    .eq("company_id", companyId)
    .is("archived_at", null)
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300)) as any[] | null;
  const tasks = ((rows || []) as any[]).filter((t) => {
    if (t.assignee_id === userId) return true;
    const many = Array.isArray(t.assignee_ids) ? t.assignee_ids : [];
    return many.includes(userId);
  });
  if (!tasks.length) return [];

  // 프로젝트명은 별도 조회 — 조인 이름에 기대지 않는다(관계명이 바뀌면 화면이 통째로 빈다).
  const dealIds = [...new Set(tasks.map((t) => t.deal_id).filter(Boolean))];
  const deals = dealIds.length
    ? ((logRead('my-project-tasks:deals', await supabase
        .from("deals").select("id, name").in("id", dealIds)) as any[] | null) || [])
    : [];
  const nameOf: Record<string, string> = {};
  for (const d of deals as any[]) nameOf[d.id] = d.name;

  return tasks
    .filter((t) => t.deal_id && nameOf[t.deal_id])   // 삭제된 프로젝트의 잔여 업무는 제외
    .map((t) => ({
      id: t.id, title: t.title, due_date: t.due_date || null,
      status: t.status, deal_id: t.deal_id, dealName: nameOf[t.deal_id],
    }));
}

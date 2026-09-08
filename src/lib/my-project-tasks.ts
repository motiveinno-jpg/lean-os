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
import { lastStageId } from "@/lib/project-items";

export type MyProjectTask = {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  deal_id: string;
  dealName: string;
  /** item: 프로젝트 표(project_items) · task: 옛 태스크(project_tasks) */
  source: "item" | "task";
};

/**
 * 내가 담당(단일 담당·다중 담당 모두)인 미완료 프로젝트 업무. 마감일 빠른 순.
 *   프로젝트 화면이 쓰는 표(project_items)가 본체다. 완료 여부는 그 프로젝트 단계의 마지막 단계인지로 본다.
 *   옛 태스크(project_tasks)를 아직 쓰는 회사를 위해 그것도 합친다.
 */
export async function getMyProjectTasks(companyId: string, userId: string): Promise<MyProjectTask[]> {
  const [itemRows, taskRows] = await Promise.all([
    logRead('my-project-tasks:items', await supabase
      .from("project_items")
      .select("id, name, due_date, status, deal_id")
      .eq("company_id", companyId)
      .eq("kind", "todo")
      .is("archived_at", null)
      .or(`assignee_id.eq.${userId},assignee_ids.cs.{${userId}}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500)) as any[] | null,
    //   assignee_ids 가 jsonb 라 서버 필터가 지저분해 여기서 거른다.
    logRead('my-project-tasks:rows', await supabase
      .from("project_tasks")
      .select("id, title, due_date, status, deal_id, assignee_id, assignee_ids")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(300)) as any[] | null,
  ]);
  const items = (itemRows || []) as any[];
  const tasks = ((taskRows || []) as any[]).filter((t) => {
    if (t.assignee_id === userId) return true;
    const many = Array.isArray(t.assignee_ids) ? t.assignee_ids : [];
    return many.includes(userId);
  });
  if (!items.length && !tasks.length) return [];

  // 프로젝트명·단계는 별도 조회 — 조인 이름에 기대지 않는다(관계명이 바뀌면 화면이 통째로 빈다).
  const dealIds = [...new Set([...items, ...tasks].map((t) => t.deal_id).filter(Boolean))];
  const deals = dealIds.length
    ? ((logRead('my-project-tasks:deals', await supabase
        .from("deals").select("id, name, item_stages").in("id", dealIds)) as any[] | null) || [])
    : [];
  const nameOf: Record<string, string> = {};
  const doneOf: Record<string, string> = {};
  for (const d of deals as any[]) { nameOf[d.id] = d.name; doneOf[d.id] = lastStageId(d.item_stages); }

  const out: MyProjectTask[] = [
    ...items
      .filter((t) => t.deal_id && nameOf[t.deal_id] && t.status !== doneOf[t.deal_id])
      .map((t) => ({ id: t.id, title: t.name, due_date: t.due_date || null, status: t.status, deal_id: t.deal_id, dealName: nameOf[t.deal_id], source: "item" as const })),
    ...tasks
      .filter((t) => t.deal_id && nameOf[t.deal_id])   // 삭제된 프로젝트의 잔여 업무는 제외
      .map((t) => ({ id: t.id, title: t.title, due_date: t.due_date || null, status: t.status, deal_id: t.deal_id, dealName: nameOf[t.deal_id], source: "task" as const })),
  ];
  return out.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
}

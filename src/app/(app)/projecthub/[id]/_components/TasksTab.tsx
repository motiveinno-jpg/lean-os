"use client";

// 실행형 '태스크' 탭 — 칸반(4컬럼) + 간트 토글.
//   칸반: HTML5 native draggable 로 컬럼 이동 → project_tasks.status(+position) update.
//   간트: start_date~due_date 막대를 일 타임라인에 커스텀 div 로 렌더(의존성 화살표 제외, today 라인).
//   진행률 = done/전체(archived 제외). 지연 = due_date<today && status!='done'.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { uploadTaskAttachment, taskAttachmentUrl, taskAttachmentDownloadUrl, removeTaskAttachment, isImageAtt, type TaskAttachment } from "@/lib/task-attachments";

const db = supabase as any;
const todayStr = () => new Date().toISOString().slice(0, 10);

type TaskStatus = "todo" | "doing" | "review" | "done";
const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "todo", label: "할 일", color: "text-[var(--text-muted)]" },
  { key: "doing", label: "진행", color: "text-amber-500" },
  { key: "review", label: "검토", color: "text-blue-400" },
  { key: "done", label: "완료", color: "text-green-500" },
];

const isDelayed = (t: any) => t.due_date && t.status !== "done" && String(t.due_date).slice(0, 10) < todayStr();

// ── 태스크 라벨 (색상+텍스트 자유 태그) — project_tasks.labels jsonb (태스크엔 스냅샷 저장, 사전은 task_labels 테이블) ──
interface TaskLabel { text: string; color: string }
const LABEL_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#64748b"];
const taskLabels = (t: any): TaskLabel[] => (Array.isArray(t?.labels) ? t.labels : []).filter((l: any) => l && l.text);
// 다중 담당자 — assignee_ids jsonb 우선, 없으면 기존 단일 assignee_id 로 폴백(하위호환)
const taskAssignees = (t: any): string[] =>
  Array.isArray(t?.assignee_ids) && t.assignee_ids.length > 0 ? t.assignee_ids : t?.assignee_id ? [t.assignee_id] : [];
const LabelChip = ({ l }: { l: TaskLabel }) => (
  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-none"
    style={{ backgroundColor: `${l.color}24`, color: l.color }}>{l.text}</span>
);

export function TasksTab({ dealId, companyId, users }: { dealId: string; companyId: string; users: any[] }) {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "gantt" | "report">("kanban");
  const [editTask, setEditTask] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  // 직원 QA #프로젝트 테스크 검색 — 제목·담당자·라벨 검색 + 담당자 필터
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_tasks")
        .select("id, title, description, status, assignee_id, assignee_ids, start_date, due_date, progress, position, attachments, labels, sprint_id, story_points, updated_at, parent_task_id")
        .eq("deal_id", dealId).is("archived_at", null)
        .order("position", { ascending: true }).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  // 스프린트 — 있으면 스크럼 모드(백로그↔스프린트 보드). 없으면 기존 단순 칸반.
  const { data: sprints = [] } = useQuery({
    queryKey: ["project-sprints", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_sprints").select("id, name, goal, status, start_date, end_date, completed_points, sort_order").eq("deal_id", dealId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  const hasSprints = (sprints as any[]).length > 0;
  const activeSprint = (sprints as any[]).find((s) => s.status === "active") || null;
  // 보드 스코프 — "all"(스프린트 없음) | "backlog" | sprintId
  const [scope, setScope] = useState<string>("all");
  useEffect(() => {
    if (!hasSprints) { setScope("all"); return; }
    setScope((cur) => (cur === "all" ? (activeSprint?.id || "backlog") : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSprints, activeSprint?.id]);
  const [showSprintMgr, setShowSprintMgr] = useState(false);

  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.name;
    return m;
  }, [users]);
  // 에픽 — 다른 태스크의 parent_task_id 로 참조되는 태스크. 제목 조회용 맵.
  const taskTitle = useMemo(() => { const m: Record<string, string> = {}; for (const t of tasks as any[]) m[t.id] = t.title; return m; }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasks as any[]).filter((t) => {
      // 스크럼 스코프 — 백로그(sprint 없음) / 특정 스프린트 / all(스프린트 미사용)
      if (hasSprints) {
        if (scope === "backlog" && t.sprint_id) return false;
        if (scope !== "backlog" && scope !== "all" && t.sprint_id !== scope) return false;
      }
      if (assigneeFilter) {
        const ids = [t.assignee_id, ...(t.assignee_ids || [])].filter(Boolean);
        if (!ids.includes(assigneeFilter)) return false;
      }
      if (!q) return true;
      const names = [t.assignee_id, ...(t.assignee_ids || [])].filter(Boolean).map((id: string) => userName[id] || "");
      const hay = [t.title, t.description, ...taskLabels(t).map((l) => l.text), ...names].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, search, assigneeFilter, userName, hasSprints, scope]);

  // 스프린트 조작 — 생성/시작(활성 1개만)/완료(미완료 백로그 복귀)/삭제
  const invalidateSprints = () => { qc.invalidateQueries({ queryKey: ["project-sprints", dealId] }); qc.invalidateQueries({ queryKey: ["project-tasks", dealId] }); };
  const createSprint = async (name: string, goal: string, startD: string, endD: string) => {
    const { data, error } = await db.from("project_sprints").insert({ company_id: companyId, deal_id: dealId, name: name.trim() || `Sprint ${(sprints as any[]).length + 1}`, goal: goal.trim() || null, start_date: startD || null, end_date: endD || null, sort_order: (sprints as any[]).length, created_by: user?.id || null }).select("id").single();
    if (error) { toast(error.message, "error"); return null; }
    invalidateSprints(); toast("스프린트를 생성했습니다", "success");
    if (data?.id) setScope(data.id);
    return data?.id;
  };
  const startSprint = async (id: string) => {
    // 기존 active → completed 없이, 다른 active 를 planned 로 되돌리고 이 스프린트만 active
    if (activeSprint && activeSprint.id !== id) { await db.from("project_sprints").update({ status: "planned", updated_at: new Date().toISOString() }).eq("id", activeSprint.id); }
    const { error } = await db.from("project_sprints").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    invalidateSprints(); setScope(id); toast("스프린트를 시작했습니다", "success");
  };
  const completeSprint = async (id: string) => {
    const inSprint = (tasks as any[]).filter((t) => t.sprint_id === id);
    const donePts = inSprint.filter((t) => t.status === "done").reduce((a, t) => a + Number(t.story_points || 0), 0);
    // 완료 스냅샷 + 미완료 태스크는 백로그로 복귀(sprint_id=null)
    await db.from("project_sprints").update({ status: "completed", completed_points: donePts, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    const unfinished = inSprint.filter((t) => t.status !== "done").map((t) => t.id);
    if (unfinished.length) await db.from("project_tasks").update({ sprint_id: null, updated_at: new Date().toISOString() }).in("id", unfinished);
    invalidateSprints(); setScope("backlog"); toast(`스프린트 완료 — 완료 ${donePts}pt, 미완료 ${unfinished.length}건 백로그 복귀`, "success");
  };
  const deleteSprint = async (id: string) => {
    await db.from("project_tasks").update({ sprint_id: null, updated_at: new Date().toISOString() }).eq("sprint_id", id);
    const { error } = await db.from("project_sprints").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    invalidateSprints(); setScope("backlog"); toast("스프린트를 삭제했습니다(태스크는 백로그로)", "info");
  };
  // 스프린트별 포인트 합/완료
  const sprintPts = (id: string) => {
    const inS = (tasks as any[]).filter((t) => t.sprint_id === id);
    return { total: inS.reduce((a, t) => a + Number(t.story_points || 0), 0), done: inS.filter((t) => t.status === "done").reduce((a, t) => a + Number(t.story_points || 0), 0), count: inS.length };
  };

  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, any[]> = { todo: [], doing: [], review: [], done: [] };
    for (const t of filteredTasks) {
      const s = (["todo", "doing", "review", "done"].includes(t.status) ? t.status : "todo") as TaskStatus;
      m[s].push(t);
    }
    return m;
  }, [filteredTasks]);

  const total = (tasks as any[]).length;
  const doneCount = (tasks as any[]).filter((t) => t.status === "done").length;
  const delayedCount = (tasks as any[]).filter(isDelayed).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const moveTask = async (taskId: string, newStatus: TaskStatus) => {
    const t = (tasks as any[]).find((x) => x.id === taskId);
    if (!t || t.status === newStatus) return;
    // 낙관적 갱신
    qc.setQueryData(["project-tasks", dealId], (old: any[] = []) => old.map((x) => x.id === taskId ? { ...x, status: newStatus } : x));
    try {
      const maxPos = Math.max(0, ...byStatus[newStatus].map((x) => Number(x.position || 0)));
      const { error } = await db.from("project_tasks").update({ status: newStatus, position: maxPos + 1, updated_at: new Date().toISOString() }).eq("id", taskId);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-tasks", dealId] });
    } catch (e: any) {
      toast(e?.message || "이동 실패", "error");
      qc.invalidateQueries({ queryKey: ["project-tasks", dealId] });
    }
  };

  const openNew = () => { setEditTask(null); setShowForm(true); };
  const openEdit = (t: any) => { setEditTask(t); setShowForm(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-xs text-[var(--text-muted)]">진행률 <b className="text-[var(--text)] mono-number">{pct}%</b> <span className="text-[var(--text-dim)]">({doneCount}/{total})</span></div>
          {delayedCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-semibold">지연 {delayedCount}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="제목·담당자·라벨 검색"
            className="h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs w-36 sm:w-44" />
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-8 px-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs">
            <option value="">담당자 전체</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div className="seg-bar">
            <button onClick={() => setView("kanban")} className={`seg-item ${view === "kanban" ? "seg-item-active" : ""}`}>칸반</button>
            <button onClick={() => setView("gantt")} className={`seg-item ${view === "gantt" ? "seg-item-active" : ""}`}>간트</button>
            {hasSprints && <button onClick={() => setView("report")} className={`seg-item ${view === "report" ? "seg-item-active" : ""}`}>리포트</button>}
          </div>
          <button onClick={openNew} className="btn-primary text-xs hover:opacity-90">+ 태스크</button>
        </div>
      </div>

      {/* 스프린트 바 — 백로그 / 스프린트 칩 + 관리. 스프린트 없으면 '스프린트 시작' 버튼만. */}
      {hasSprints ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setScope("backlog")} className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition ${scope === "backlog" ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>백로그</button>
            {(sprints as any[]).map((s) => {
              const p = sprintPts(s.id);
              return (
                <button key={s.id} onClick={() => setScope(s.id)} className={`text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition ${scope === s.id ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                  {s.status === "active" && <span className="text-[var(--success)]">●</span>} {s.name}
                  {s.status === "completed" && <span className="opacity-60"> ✓</span>}
                  <span className="ml-1 opacity-70">{p.total}pt</span>
                </button>
              );
            })}
            <button onClick={() => setShowSprintMgr(true)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">＋ 스프린트 관리</button>
          </div>
          {/* 선택 스프린트 헤더 */}
          {scope !== "backlog" && scope !== "all" && (() => {
            const s = (sprints as any[]).find((x) => x.id === scope); if (!s) return null;
            const p = sprintPts(s.id); const prog = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            const dLeft = s.end_date ? Math.ceil((new Date(s.end_date).getTime() - Date.now()) / 86400000) : null;
            return (
              <div className="glass-card p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--text)]">{s.name} {s.goal && <span className="font-normal text-[var(--text-muted)]">· {s.goal}</span>}</div>
                  <div className="text-[11px] text-[var(--text-dim)] mono-number">{s.start_date || "?"} ~ {s.end_date || "?"}{dLeft != null && s.status === "active" && <span className={dLeft < 0 ? "text-[var(--danger)]" : ""}> · {dLeft < 0 ? `${-dLeft}일 초과` : `D-${dLeft}`}</span>} · {p.done}/{p.total}pt ({prog}%)</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.status === "planned" && <button onClick={() => startSprint(s.id)} className="btn-primary text-xs">▶ 시작</button>}
                  {s.status === "active" && <button onClick={() => { if (confirm(`${s.name}를 완료할까요? 미완료 태스크는 백로그로 돌아갑니다.`)) completeSprint(s.id); }} className="btn-secondary text-xs">스프린트 완료</button>}
                  {s.status === "completed" && <span className="text-[11px] text-[var(--success)] font-semibold">완료 {s.completed_points ?? p.done}pt</span>}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <button onClick={() => setShowSprintMgr(true)} className="text-xs font-semibold text-[var(--primary)] hover:underline">＋ 스프린트로 관리하기 (백로그·스프린트 보드)</button>
      )}

      {view === "kanban" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {COLUMNS.map((col) => (
            <div key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); if (dragId) moveTask(dragId, col.key); setDragId(null); setDragOver(null); }}
              className={`rounded-xl p-2.5 min-h-[120px] transition border ${dragOver === col.key ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-transparent bg-[var(--bg-surface)]"}`}>
              <div className="flex items-center justify-between px-1 mb-2">
                <span className={`text-xs font-bold ${col.color}`}>{col.label}</span>
                <span className="text-[10px] text-[var(--text-dim)] mono-number">{byStatus[col.key].length}</span>
              </div>
              <div className="space-y-2">
                {byStatus[col.key].map((t) => (
                  <div key={t.id} draggable
                    onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    onClick={() => openEdit(t)}
                    className={`rounded-lg border bg-[var(--bg-card)] p-2.5 cursor-grab active:cursor-grabbing hover:border-[var(--primary)]/40 transition ${dragId === t.id ? "opacity-50" : ""} ${isDelayed(t) ? "border-red-500/40" : "border-[var(--border)]"}`}>
                    {taskLabels(t).length > 0 && (
                      <div className="flex items-center gap-1 mb-1 flex-wrap">
                        {taskLabels(t).map((l, i) => <LabelChip key={i} l={l} />)}
                      </div>
                    )}
                    {t.parent_task_id && taskTitle[t.parent_task_id] && <div className="text-[10px] text-[var(--text-dim)] truncate mb-0.5">🗂 {taskTitle[t.parent_task_id]}</div>}
                    <div className="text-sm font-medium text-[var(--text)] break-words">{t.title}</div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {t.story_points != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-bold mono-number">{t.story_points}pt</span>}
                      {taskAssignees(t).length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]"
                          title={taskAssignees(t).map((id) => userName[id] || "담당").join(", ")}>
                          {userName[taskAssignees(t)[0]] || "담당"}{taskAssignees(t).length > 1 ? ` 외 ${taskAssignees(t).length - 1}` : ""}
                        </span>
                      )}
                      {t.due_date && <span className={`text-[10px] mono-number ${isDelayed(t) ? "text-red-500 font-semibold" : "text-[var(--text-dim)]"}`}>~{String(t.due_date).slice(5, 10)}</span>}
                      {isDelayed(t) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-semibold">지연</span>}
                      {Array.isArray(t.attachments) && t.attachments.length > 0 && <span className="text-[10px] text-[var(--text-dim)]">📎 {t.attachments.length}</span>}
                    </div>
                  </div>
                ))}
                {byStatus[col.key].length === 0 && <div className="text-[11px] text-[var(--text-dim)] text-center py-3">비어 있음</div>}
              </div>
            </div>
          ))}
        </div>
      ) : view === "gantt" ? (
        <GanttChart tasks={tasks as any[]} userName={userName} onTaskClick={openEdit} />
      ) : (
        <SprintReport sprints={sprints as any[]} tasks={tasks as any[]} scope={scope} />
      )}

      {showForm && (
        <TaskFormModal
          dealId={dealId} companyId={companyId} users={users}
          task={editTask} userId={user?.id || null}
          existingCount={total}
          sprints={sprints as any[]}
          allTasks={tasks as any[]}
          defaultSprintId={scope !== "backlog" && scope !== "all" ? scope : null}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ["project-tasks", dealId] }); }}
        />
      )}

      {showSprintMgr && (
        <SprintManager
          sprints={sprints as any[]} sprintPts={sprintPts}
          onCreate={createSprint} onStart={startSprint} onComplete={completeSprint} onDelete={deleteSprint}
          onClose={() => setShowSprintMgr(false)}
        />
      )}
    </div>
  );
}

// 스프린트 리포트 — 번다운(선택 스프린트) + 속도(완료 스프린트별 pt).
function SprintReport({ sprints, tasks, scope }: { sprints: any[]; tasks: any[]; scope: string }) {
  // 대상 스프린트 — 스코프가 스프린트면 그것, 아니면 활성/최근
  const target = sprints.find((s) => s.id === scope) || sprints.find((s) => s.status === "active") || sprints[sprints.length - 1] || null;
  const completed = sprints.filter((s) => s.status === "completed");
  const maxVel = Math.max(1, ...completed.map((s) => Number(s.completed_points || 0)));
  const avgVel = completed.length ? Math.round(completed.reduce((a, s) => a + Number(s.completed_points || 0), 0) / completed.length) : null;

  // 번다운 계산
  const bd = (() => {
    if (!target || !target.start_date || !target.end_date) return null;
    const inS = tasks.filter((t) => t.sprint_id === target.id);
    const total = inS.reduce((a, t) => a + Number(t.story_points || 0), 0);
    if (total === 0) return null;
    const days: string[] = [];
    const d = new Date(target.start_date + "T00:00:00"); const end = new Date(target.end_date + "T00:00:00");
    let guard = 0;
    while (d <= end && guard < 400) { days.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); guard++; }
    const n = days.length; if (n < 2) return null;
    const today = todayStr();
    const doneList = inS.filter((t) => t.status === "done").map((t) => ({ pts: Number(t.story_points || 0), date: String(t.updated_at || "").slice(0, 10) }));
    const ideal = days.map((_, i) => (total * (n - 1 - i)) / (n - 1));
    const actual = days.map((day) => (day > today ? null : total - doneList.filter((x) => x.date && x.date <= day).reduce((a, x) => a + x.pts, 0)));
    return { days, ideal, actual, total };
  })();

  return (
    <div className="space-y-5">
      {/* 번다운 */}
      <section className="glass-card p-4">
        <h3 className="text-sm font-bold text-[var(--text)] mb-1">번다운 {target && <span className="font-normal text-[var(--text-dim)] text-xs">· {target.name}</span>}</h3>
        {!bd ? (
          <div className="text-xs text-[var(--text-dim)] py-6 text-center">번다운은 스프린트에 <b>기간(시작·종료일)</b>과 <b>스토리 포인트</b>가 있어야 표시됩니다.</div>
        ) : (() => {
          const W = 560, H = 180, P = 30; const n = bd.days.length;
          const x = (i: number) => P + (i / (n - 1)) * (W - P * 2);
          const y = (v: number) => H - P - (v / bd.total) * (H - P * 2);
          const idealPts = bd.ideal.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          const actualPts = bd.actual.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
          return (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" style={{ maxHeight: 200 }}>
                <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--border)" />
                <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--border)" />
                <text x={P - 4} y={y(bd.total) + 3} textAnchor="end" fontSize="9" fill="var(--text-dim)">{bd.total}</text>
                <text x={P - 4} y={y(0) + 3} textAnchor="end" fontSize="9" fill="var(--text-dim)">0</text>
                <polyline points={idealPts} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="4 3" />
                {actualPts && <polyline points={actualPts} fill="none" stroke="var(--primary)" strokeWidth="2" />}
                <text x={W - P} y={P - 6} textAnchor="end" fontSize="9" fill="var(--text-dim)">— — 이상선 · <tspan fill="var(--primary)">실제 잔여</tspan></text>
              </svg>
              <div className="flex justify-between text-[10px] text-[var(--text-dim)] px-6 mono-number"><span>{bd.days[0]?.slice(5)}</span><span>{bd.days[n - 1]?.slice(5)}</span></div>
            </div>
          );
        })()}
      </section>

      {/* 속도 */}
      <section className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[var(--text)]">속도 <span className="font-normal text-[var(--text-dim)] text-xs">완료 스프린트별 pt</span></h3>
          {avgVel != null && <span className="text-xs text-[var(--text-muted)]">평균 <b className="text-[var(--text)] mono-number">{avgVel}pt</b>/스프린트</span>}
        </div>
        {completed.length === 0 ? (
          <div className="text-xs text-[var(--text-dim)] py-4 text-center">완료된 스프린트가 없습니다. 스프린트를 완료하면 속도가 누적됩니다.</div>
        ) : (
          <div className="space-y-2">
            {completed.map((s) => {
              const v = Number(s.completed_points || 0);
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] w-24 truncate shrink-0">{s.name}</span>
                  <div className="flex-1 h-4 rounded bg-[var(--bg-surface)] overflow-hidden"><div className="h-full rounded bg-[var(--primary)]" style={{ width: `${(v / maxVel) * 100}%` }} /></div>
                  <span className="text-xs font-bold mono-number text-[var(--text)] w-12 text-right shrink-0">{v}pt</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// 스프린트 관리 모달 — 목록 + 생성.
function SprintManager({ sprints, sprintPts, onCreate, onStart, onComplete, onDelete, onClose }: {
  sprints: any[]; sprintPts: (id: string) => { total: number; done: number; count: number };
  onCreate: (name: string, goal: string, s: string, e: string) => Promise<any>; onStart: (id: string) => void; onComplete: (id: string) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(""); const [goal, setGoal] = useState(""); const [s, setS] = useState(""); const [e, setE] = useState(""); const [busy, setBusy] = useState(false);
  const ST: Record<string, string> = { planned: "예정", active: "진행중", completed: "완료" };
  const create = async () => { setBusy(true); await onCreate(name, goal, s, e); setName(""); setGoal(""); setS(""); setE(""); setBusy(false); };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[88vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-base font-bold">스프린트 관리</h3><button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button></div>
        <div className="glass-card p-3 mb-4 space-y-2">
          <div className="text-xs font-bold text-[var(--text-muted)]">+ 새 스프린트</div>
          <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="이름 (예: Sprint 1)" className="w-full h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
          <input value={goal} onChange={(ev) => setGoal(ev.target.value)} placeholder="스프린트 목표 (선택)" className="w-full h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
          <div className="flex items-center gap-2">
            <DateField value={s} onChange={(ev) => setS(ev.target.value)} className="flex-1 h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
            <span className="text-xs text-[var(--text-dim)]">~</span>
            <DateField value={e} onChange={(ev) => setE(ev.target.value)} className="flex-1 h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
            <button onClick={create} disabled={busy} className="btn-primary text-xs disabled:opacity-50 whitespace-nowrap">생성</button>
          </div>
        </div>
        <div className="space-y-1.5">
          {sprints.length === 0 ? <div className="text-xs text-[var(--text-dim)] text-center py-4">스프린트가 없습니다. 위에서 첫 스프린트를 만드세요.</div>
            : sprints.map((sp) => {
              const p = sprintPts(sp.id);
              return (
                <div key={sp.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border)]/50">
                  <span className="text-sm font-medium text-[var(--text)] flex-1 truncate">{sp.name} <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{ST[sp.status] || sp.status}</span> <span className="text-[11px] text-[var(--text-dim)] mono-number">{p.done}/{p.total}pt · {p.count}건</span></span>
                  {sp.status === "planned" && <button onClick={() => onStart(sp.id)} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">시작</button>}
                  {sp.status === "active" && <button onClick={() => { if (confirm(`${sp.name} 완료?`)) onComplete(sp.id); }} className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)]">완료</button>}
                  <button onClick={() => { if (confirm(`${sp.name} 삭제? 태스크는 백로그로 이동합니다.`)) onDelete(sp.id); }} className="text-[11px] font-semibold text-[var(--danger)] hover:underline">삭제</button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── 간트 (커스텀 경량 div, 무의존) ──
function GanttChart({ tasks, userName, onTaskClick }: { tasks: any[]; userName: Record<string, string>; onTaskClick: (t: any) => void }) {
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  const range = useMemo(() => {
    const dates: number[] = [];
    for (const t of dated) {
      if (t.start_date) dates.push(new Date(String(t.start_date)).getTime());
      if (t.due_date) dates.push(new Date(String(t.due_date)).getTime());
    }
    const now = Date.now();
    dates.push(now);
    if (dates.length === 0) return null;
    let min = Math.min(...dates), max = Math.max(...dates);
    // 좌우 2일 패딩
    min -= 2 * 86400000; max += 2 * 86400000;
    const totalDays = Math.max(1, Math.round((max - min) / 86400000));
    return { min, max, totalDays };
  }, [dated]);

  if (!range || dated.length === 0) {
    return <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">기간(시작일·마감일)이 설정된 태스크가 없습니다. 태스크에 날짜를 추가하면 간트에 표시됩니다.</div>;
  }

  const pctOf = (ms: number) => ((ms - range.min) / (range.max - range.min)) * 100;
  const todayPct = pctOf(Date.now());
  // 주 단위 눈금 (약 8개)
  const ticks: { left: number; label: string }[] = [];
  const tickStep = Math.max(1, Math.round(range.totalDays / 8));
  for (let d = 0; d <= range.totalDays; d += tickStep) {
    const ms = range.min + d * 86400000;
    ticks.push({ left: pctOf(ms), label: new Date(ms).toISOString().slice(5, 10) });
  }

  return (
    <div className="glass-card p-4 overflow-x-auto">
      <div className="min-w-[600px]">
        {/* 눈금 */}
        <div className="relative h-5 mb-2 border-b border-[var(--border)]">
          {ticks.map((tk, i) => (
            <span key={i} className="absolute text-[9px] text-[var(--text-dim)] mono-number -translate-x-1/2" style={{ left: `${tk.left}%` }}>{tk.label}</span>
          ))}
        </div>
        <div className="relative space-y-1.5">
          {/* today 라인 */}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10" style={{ left: `${todayPct}%` }} title="오늘">
              <span className="absolute -top-1 -translate-x-1/2 text-[8px] text-red-500 font-bold">오늘</span>
            </div>
          )}
          {(() => {
            // 에픽(parent_task_id)별 그룹 — 에픽 먼저, '기타'는 마지막. 헤더 행 + 자식 막대.
            const groups: Record<string, any[]> = {};
            for (const t of dated) { const k = t.parent_task_id || "__none"; (groups[k] ||= []).push(t); }
            const keys = Object.keys(groups).sort((a, b) => (a === "__none" ? 1 : b === "__none" ? -1 : 0));
            const renderBar = (t: any) => {
              const s = t.start_date ? new Date(String(t.start_date)).getTime() : new Date(String(t.due_date)).getTime();
              const e = t.due_date ? new Date(String(t.due_date)).getTime() : s;
              const left = pctOf(Math.min(s, e));
              const width = Math.max(1.5, pctOf(Math.max(s, e)) - left);
              const barColor = t.status === "done" ? "bg-green-500" : isDelayed(t) ? "bg-red-500" : "bg-[var(--primary)]";
              return (
                <div key={t.id} className="relative h-7 flex items-center">
                  <div className="absolute inset-0 flex items-center">
                    <div onClick={() => onTaskClick(t)}
                      className={`absolute h-5 rounded ${barColor} opacity-85 hover:opacity-100 cursor-pointer flex items-center px-1.5 overflow-hidden`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${t.title} · ${t.start_date ? String(t.start_date).slice(0, 10) : "?"} ~ ${t.due_date ? String(t.due_date).slice(0, 10) : "?"}${taskAssignees(t).length > 0 ? ` · ${taskAssignees(t).map((id) => userName[id] || "").filter(Boolean).join(", ")}` : ""}`}>
                      <span className="text-[10px] text-white font-medium truncate">{t.title}</span>
                    </div>
                  </div>
                </div>
              );
            };
            const hasEpics = keys.some((k) => k !== "__none");
            return keys.map((k) => (
              <div key={k} className="space-y-1.5">
                {k !== "__none" ? <div className="text-[11px] font-bold text-[var(--text-muted)] pt-1 relative z-[5]">🗂 {tasks.find((t) => t.id === k)?.title || "에픽"}</div>
                  : hasEpics && <div className="text-[11px] font-bold text-[var(--text-dim)] pt-1 relative z-[5]">기타</div>}
                {groups[k].map(renderBar)}
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ── 태스크 댓글 — 설명에 대한 답글 스레드. task_comments(parent_id 자기참조)로 답글의 답글 무한 중첩 ──
function TaskComments({ taskId, companyId, userId, users }: { taskId: string; companyId: string; userId: string | null; users: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: comments = [] } = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: async () => {
      const { data } = await db.from("task_comments")
        .select("id, parent_id, body, created_by, created_at")
        .eq("task_id", taskId).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!taskId,
  });
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name || "구성원";
  const fmtAt = (ts: string) => String(ts).slice(0, 16).replace("T", " ");

  const add = async (parentId: string | null, body: string) => {
    const t = body.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const { error } = await db.from("task_comments").insert({ company_id: companyId, task_id: taskId, parent_id: parentId, body: t, created_by: userId });
      if (error) throw new Error(error.message);
      setText(""); setReplyText(""); setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["task-comments", taskId] });
    } catch (e: any) { toast(e?.message || "댓글 등록 실패", "error"); } finally { setBusy(false); }
  };
  const del = async (c: any) => {
    if (!confirm("이 댓글을 삭제할까요? 아래 달린 답글도 함께 삭제됩니다.")) return;
    try {
      const { error } = await db.from("task_comments").delete().eq("id", c.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["task-comments", taskId] });
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };

  // parent_id → 자식 목록 (created_at asc 유지)
  const children = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const c of comments as any[]) (m[c.parent_id || "root"] ||= []).push(c);
    return m;
  }, [comments]);

  // 재귀 렌더 — depth 만큼 들여쓰기 + 세로 가이드라인. (컴포넌트가 아닌 함수라 입력 포커스 안전)
  const renderNode = (c: any, depth: number): React.ReactNode => (
    <div key={c.id} className={depth > 0 ? "ml-3 pl-3 border-l-2 border-[var(--border)]" : ""}>
      <div className="py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-dim)]">
          <b className="text-[var(--text-muted)]">{nameOf(c.created_by)}</b>
          <span className="mono-number">{fmtAt(c.created_at)}</span>
          <button type="button" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); }}
            className="font-semibold hover:text-[var(--primary)]">{replyTo === c.id ? "답글 취소" : "답글"}</button>
          {c.created_by === userId && <button type="button" onClick={() => del(c)} className="hover:text-[var(--danger)]">삭제</button>}
        </div>
        <div className="text-sm text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed mt-0.5">{c.body}</div>
        {replyTo === c.id && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <input value={replyText} onChange={(e) => setReplyText(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(c.id, replyText); } }}
              placeholder={`${nameOf(c.created_by)}님에게 답글 (Enter로 등록)`}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--primary)]" />
            <button type="button" onClick={() => add(c.id, replyText)} disabled={!replyText.trim() || busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-40 hover:opacity-90">등록</button>
          </div>
        )}
      </div>
      {(children[c.id] || []).map((ch) => renderNode(ch, depth + 1))}
    </div>
  );

  return (
    <div>
      <div className="text-xs text-[var(--text-muted)] mb-1">💬 댓글{comments.length > 0 ? ` ${comments.length}` : ""} <span className="font-normal text-[var(--text-dim)]">— 답글에 계속 답글을 달 수 있습니다</span></div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]/40 px-4 py-1.5 max-h-[38vh] overflow-y-auto">
        {(children["root"] || []).length === 0 ? (
          <div className="py-3 text-xs text-[var(--text-dim)]">아직 댓글이 없습니다. 아래에 첫 댓글을 남겨보세요.</div>
        ) : (children["root"] || []).map((c) => renderNode(c, 0))}
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(null, text); } }}
          placeholder="댓글 입력 (Enter로 등록)"
          className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]" />
        <button type="button" onClick={() => add(null, text)} disabled={!text.trim() || busy}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white disabled:opacity-40 hover:opacity-90">등록</button>
      </div>
    </div>
  );
}

function TaskFormModal({ dealId, companyId, users, task, userId, existingCount, sprints, allTasks, defaultSprintId, onClose, onSaved }: {
  dealId: string; companyId: string; users: any[]; task: any | null; userId: string | null; existingCount: number; sprints: any[]; allTasks: any[]; defaultSprintId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(task?.title || "");
  // 다중 담당자 — 기존 단일 assignee_id 는 첫 담당자로 흡수(하위호환)
  const [assignees, setAssignees] = useState<string[]>(() => taskAssignees(task));
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const toggleAssignee = (id: string) => setAssignees((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [status, setStatus] = useState<TaskStatus>((task?.status as TaskStatus) || "todo");
  const [sprintId, setSprintId] = useState<string>(task ? (task.sprint_id || "") : (defaultSprintId || ""));
  const [points, setPoints] = useState<string>(task?.story_points != null ? String(task.story_points) : "");
  const [epicId, setEpicId] = useState<string>(task?.parent_task_id || "");
  const [start, setStart] = useState((task?.start_date || "").slice(0, 10));
  const [due, setDue] = useState((task?.due_date || "").slice(0, 10));
  const [desc, setDesc] = useState(task?.description || "");
  const [descBig, setDescBig] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEdit = !!task;
  // 저장된 태스크는 보기 모드로 열림 — '수정' 버튼을 눌러야 편집 가능. 새 태스크는 바로 편집.
  const [editing, setEditing] = useState(!task);

  // ── 라벨 — 회사 공용 사전(task_labels)에서 선택. 태스크엔 {text,color} 스냅샷 저장(사전 삭제돼도 유지) ──
  const [labels, setLabels] = useState<TaskLabel[]>(Array.isArray(task?.labels) ? task.labels.filter((l: any) => l && l.text) : []);
  const { data: dictLabels = [] } = useQuery({
    queryKey: ["task-labels-dict", companyId],
    queryFn: async () => {
      const { data } = await db.from("task_labels").select("id, name, color").eq("company_id", companyId).order("created_at", { ascending: true });
      return (data || []) as { id: string; name: string; color: string }[];
    },
    enabled: !!companyId,
  });
  const hasLabel = (name: string) => labels.some((l) => l.text === name);
  const toggleLabel = (dl: { name: string; color: string }) =>
    setLabels((p) => (hasLabel(dl.name) ? p.filter((l) => l.text !== dl.name) : [...p, { text: dl.name, color: dl.color }]));
  // 새 라벨 만들기(사전 등록 + 즉시 선택)
  const [showLabelMaker, setShowLabelMaker] = useState(false);
  const [labelText, setLabelText] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[4]);
  const [labelSaving, setLabelSaving] = useState(false);
  const createLabel = async () => {
    const name = labelText.trim();
    if (!name || labelSaving) return;
    const exists = dictLabels.find((d) => d.name === name);
    if (exists) { if (!hasLabel(name)) toggleLabel(exists); setLabelText(""); return; }
    setLabelSaving(true);
    try {
      const { error } = await db.from("task_labels").insert({ company_id: companyId, name, color: labelColor });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["task-labels-dict", companyId] });
      setLabels((p) => [...p, { text: name, color: labelColor }]);
      setLabelText("");
      toast(`'${name}' 라벨을 만들었습니다`, "success");
    } catch (e: any) { toast(e?.message || "라벨 생성 실패", "error"); } finally { setLabelSaving(false); }
  };
  const deleteDictLabel = async (dl: { id: string; name: string }) => {
    if (!confirm(`'${dl.name}' 라벨을 목록에서 삭제할까요?\n(이미 태스크에 붙어 있는 라벨은 그대로 유지됩니다)`)) return;
    try {
      const { error } = await db.from("task_labels").delete().eq("id", dl.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["task-labels-dict", companyId] });
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };

  // ── 첨부(이미지·파일) + 클립보드 붙여넣기 ──
  const [atts, setAtts] = useState<TaskAttachment[]>(Array.isArray(task?.attachments) ? task.attachments : []);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const a of atts) {
        if (isImageAtt(a) && !urls[a.path]) {
          const u = await taskAttachmentUrl(a.path);
          if (alive && u) setUrls((m) => ({ ...m, [a.path]: u }));
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || !companyId) return;
    setUploading(true);
    try {
      for (const f of files) {
        const a = await uploadTaskAttachment(companyId, f);
        setAtts((p) => [...p, a]);
        if (isImageAtt(a)) { const u = await taskAttachmentUrl(a.path); if (u) setUrls((m) => ({ ...m, [a.path]: u })); }
      }
    } catch (e: any) { toast(e?.message || "첨부 업로드 실패", "error"); }
    finally { setUploading(false); }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
    }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };
  const removeAtt = (a: TaskAttachment) => { setAtts((p) => p.filter((x) => x.id !== a.id)); removeTaskAttachment(a.path); };
  const downloadAtt = async (a: TaskAttachment) => {
    try {
      const url = await taskAttachmentDownloadUrl(a.path, a.name);
      if (!url) throw new Error("다운로드 URL 생성 실패");
      const link = document.createElement("a");
      link.href = url; link.download = a.name; link.rel = "noopener";
      document.body.appendChild(link); link.click(); link.remove();
    } catch (e: any) { toast(e?.message || "다운로드 실패", "error"); }
  };

  const save = async () => {
    if (!title.trim()) { toast("태스크명을 입력하세요", "error"); return; }
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(), description: desc.trim() || null, status,
        assignee_ids: assignees, assignee_id: assignees[0] || null, start_date: start || null, due_date: due || null,
        attachments: atts, labels,
        sprint_id: sprintId || null, story_points: points.trim() === "" ? null : Number(points.replace(/[^0-9]/g, "")) || null,
        parent_task_id: epicId || null,
        updated_at: new Date().toISOString(),
      };
      if (isEdit) {
        const { error } = await db.from("project_tasks").update(payload).eq("id", task.id);
        if (error) throw new Error(error.message);
        toast("태스크를 수정했습니다", "success");
      } else {
        const { error } = await db.from("project_tasks").insert({
          company_id: companyId, deal_id: dealId, ...payload, progress: status === "done" ? 100 : 0, position: existingCount + 1, created_by: userId,
        });
        if (error) throw new Error(error.message);
        toast("태스크를 추가했습니다", "success");
      }
      onSaved();
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!isEdit || !confirm("이 태스크를 삭제할까요?")) return;
    setSaving(true);
    try {
      const { error } = await db.from("project_tasks").update({ archived_at: new Date().toISOString() }).eq("id", task.id);
      if (error) throw new Error(error.message);
      toast("태스크를 삭제했습니다", "info");
      onSaved();
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); } finally { setSaving(false); }
  };

  const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">{!isEdit ? "+ 태스크 추가" : editing ? "태스크 수정" : "태스크"}</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        {/* ── 보기 모드 — 저장된 태스크 클릭 시 기본. 넓은 설명 영역으로 가독성 우선 ── */}
        {isEdit && !editing && (
          <>
            <div className="p-5 space-y-4">
              {labels.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {labels.map((l, i) => <LabelChip key={i} l={l} />)}
                </div>
              )}
              <h3 className="text-lg font-bold text-[var(--text)] break-words leading-snug">{title || "(제목 없음)"}</h3>
              <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs text-[var(--text-muted)]">
                <span>담당 <b className="text-[var(--text)]">{assignees.length === 0 ? "미지정" : assignees.map((id) => users.find((u) => u.id === id)?.name || "구성원").join(", ")}</b></span>
                <span>상태 <b className={COLUMNS.find((c) => c.key === status)?.color || "text-[var(--text)]"}>{COLUMNS.find((c) => c.key === status)?.label || status}</b></span>
                {(start || due) && <span className="mono-number">기간 <b className="text-[var(--text)]">{start || "?"} ~ {due || "?"}</b></span>}
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)] mb-1">설명</div>
                <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap break-words min-h-[96px] max-h-[45vh] overflow-y-auto">
                  {desc.trim() ? desc : <span className="text-[var(--text-dim)]">설명이 없습니다.</span>}
                </div>
              </div>
              {/* 설명에 대한 댓글·답글 스레드 (무한 중첩) */}
              <TaskComments taskId={task.id} companyId={companyId} userId={userId} users={users} />
              {atts.length > 0 && (
                <div>
                  <div className="text-xs text-[var(--text-muted)] mb-1">첨부 {atts.length}개 <span className="text-[var(--text-dim)]">— 이미지는 클릭해 크게 보기, 파일명 클릭 시 다운로드</span></div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {atts.map((a) => (
                      <div key={a.id} className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
                        {isImageAtt(a) && urls[a.path] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <button type="button" onClick={() => setLightbox(urls[a.path])} className="block w-full"><img src={urls[a.path]} alt={a.name} className="w-full h-20 object-cover cursor-zoom-in" /></button>
                        ) : (
                          <button type="button" onClick={() => downloadAtt(a)} title={`${a.name} 다운로드`} className="w-full h-20 flex items-center justify-center text-2xl hover:bg-[var(--bg-card)] transition">📄</button>
                        )}
                        <button type="button" onClick={() => downloadAtt(a)} title={`${a.name} 다운로드`}
                          className="block w-full px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline truncate text-left">{a.name}</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-between gap-2">
              <button onClick={remove} disabled={saving} className="px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg">삭제</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">닫기</button>
                <button onClick={() => setEditing(true)} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">✏️ 수정</button>
              </div>
            </div>
          </>
        )}

        {/* ── 편집 모드 — 새 태스크 또는 '수정' 클릭 후 ── */}
        {(!isEdit || editing) && (<>
        <div className="p-5 space-y-3" onPaste={onPaste}>
          <div>
            <label className={LB}>태스크명 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할 일" className={IN} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className={LB}>담당 <span className="font-normal text-[var(--text-dim)]">(여러 명)</span></label>
              <button type="button" onClick={() => setAssigneeOpen((v) => !v)} className={`${IN} text-left truncate`}>
                {assignees.length === 0
                  ? <span className="text-[var(--text-dim)]">미지정</span>
                  : assignees.map((id) => users.find((u) => u.id === id)?.name || "구성원").join(", ")}
              </button>
              {assigneeOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAssigneeOpen(false)} />
                  <div className="absolute z-40 mt-1 w-full max-h-52 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl p-1.5">
                    {users.length === 0 ? (
                      <div className="px-2 py-2 text-xs text-[var(--text-dim)]">구성원이 없습니다</div>
                    ) : users.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer text-sm text-[var(--text)]">
                        <input type="checkbox" checked={assignees.includes(u.id)} onChange={() => toggleAssignee(u.id)} className="accent-[var(--primary)]" />
                        {u.name}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div>
              <label className={LB}>상태</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={IN}>
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>시작일</label>
              <DateField value={start} onChange={(e) => setStart(e.target.value)} className={`${IN} mono-number`} />
            </div>
            <div>
              <label className={LB}>마감일</label>
              <DateField value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={`${IN} mono-number`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>스프린트</label>
              <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className={IN}>
                <option value="">백로그 (미배정)</option>
                {sprints.filter((s) => s.status !== "completed").map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (진행중)" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={LB}>스토리 포인트 <span className="font-normal text-[var(--text-dim)]">(추정)</span></label>
              <input value={points} onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="예: 3" className={`${IN} text-right mono-number`} />
            </div>
          </div>
          <div>
            <label className={LB}>상위 에픽 <span className="font-normal text-[var(--text-dim)]">(선택 · 상위 작업으로 묶기)</span></label>
            <select value={epicId} onChange={(e) => setEpicId(e.target.value)} className={IN}>
              <option value="">없음</option>
              {allTasks.filter((t) => t.id !== task?.id && !t.parent_task_id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={LB}>설명 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
              <button type="button" onClick={() => setDescBig((v) => !v)} className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)]">{descBig ? "▲ 작게" : "▼ 크게"}</button>
            </div>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onDoubleClick={() => setDescBig(true)} rows={descBig ? 16 : 5} title="더블클릭하거나 '크게'를 누르면 넓어집니다" className={`${IN} leading-relaxed`} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={LB}>라벨 <span className="font-normal text-[var(--text-dim)]">(클릭해서 선택/해제)</span></label>
              <button type="button" onClick={() => setShowLabelMaker((v) => !v)}
                className="text-[10px] font-semibold text-[var(--primary)] hover:underline">{showLabelMaker ? "닫기 ▲" : "+ 새 라벨 만들기"}</button>
            </div>
            {showLabelMaker && (
              <div className="flex items-center gap-1.5 mb-2 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/50">
                <input value={labelText} onChange={(e) => setLabelText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createLabel(); } }}
                  placeholder="새 라벨 이름" className={`${IN} flex-1 min-w-0`} />
                <div className="flex items-center gap-1 shrink-0">
                  {LABEL_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setLabelColor(c)} aria-label={`라벨 색상 ${c}`}
                      className={`w-[18px] h-[18px] rounded-full transition ${labelColor === c ? "ring-2 ring-offset-1 ring-[var(--primary)] ring-offset-[var(--bg-card)]" : "opacity-60 hover:opacity-100"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button type="button" onClick={createLabel} disabled={!labelText.trim() || labelSaving}
                  className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">{labelSaving ? "…" : "만들기"}</button>
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              {dictLabels.map((dl) => {
                const sel = hasLabel(dl.name);
                return (
                  <button key={dl.id} type="button" onClick={() => toggleLabel(dl)}
                    title={sel ? "클릭하면 이 태스크에서 해제" : "클릭하면 이 태스크에 추가"}
                    className={`group inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-semibold leading-none transition ${sel ? "" : "opacity-50 hover:opacity-100"}`}
                    style={{ backgroundColor: `${dl.color}${sel ? "33" : "14"}`, color: dl.color, boxShadow: sel ? `inset 0 0 0 1.5px ${dl.color}` : undefined }}>
                    {sel && <span aria-hidden>✓</span>}{dl.name}
                    <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); deleteDictLabel(dl); }}
                      className="hidden group-hover:inline leading-none opacity-60 hover:opacity-100" title="라벨 목록에서 삭제">×</span>
                  </button>
                );
              })}
              {/* 사전에 없는(과거 자유입력) 라벨 — 선택된 상태로 표시, ×로 해제 */}
              {labels.filter((l) => !dictLabels.some((d) => d.name === l.text)).map((l, i) => (
                <span key={`legacy-${i}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-semibold leading-none"
                  style={{ backgroundColor: `${l.color}33`, color: l.color, boxShadow: `inset 0 0 0 1.5px ${l.color}` }}>
                  ✓ {l.text}
                  <button type="button" onClick={() => setLabels((p) => p.filter((x) => x.text !== l.text))} className="hover:opacity-70 leading-none" aria-label="라벨 해제">×</button>
                </span>
              ))}
              {dictLabels.length === 0 && labels.length === 0 && (
                <span className="text-[11px] text-[var(--text-dim)]">아직 라벨이 없습니다 — ‘+ 새 라벨 만들기’로 등록하면 다음부터 클릭만으로 붙일 수 있습니다</span>
              )}
            </div>
          </div>
          <div>
            <label className={LB}>첨부 <span className="font-normal text-[var(--text-dim)]">(이미지·파일 · Ctrl+V 붙여넣기)</span></label>
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">파일 선택</button>
              <span className="text-[11px] text-[var(--text-dim)]">{uploading ? "업로드 중…" : "이미지는 캡처 후 Ctrl+V로 바로 붙여넣기"}</span>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
            </div>
            {atts.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {atts.map((a) => (
                  <div key={a.id} className="relative group rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--bg-surface)]">
                    <button type="button" onClick={() => removeAtt(a)} className="absolute top-0.5 right-0.5 z-10 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition" aria-label="첨부 삭제">×</button>
                    {isImageAtt(a) && urls[a.path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <button type="button" onClick={() => setLightbox(urls[a.path])} className="block w-full"><img src={urls[a.path]} alt={a.name} className="w-full h-16 object-cover cursor-zoom-in" /></button>
                    ) : (
                      <button type="button" onClick={() => downloadAtt(a)} title={`${a.name} 다운로드`} className="w-full h-16 flex items-center justify-center text-2xl hover:bg-[var(--bg-card)] transition">📄</button>
                    )}
                    <button type="button" onClick={() => downloadAtt(a)} title={`${a.name} 다운로드`}
                      className="block w-full px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline truncate text-left">{a.name}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-between gap-2">
          {isEdit ? <button onClick={remove} disabled={saving} className="px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg">삭제</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
            <button onClick={save} disabled={saving || !title.trim()} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "저장 중..." : isEdit ? "저장" : "추가"}
            </button>
          </div>
        </div>
        </>)}
        {lightbox && (
          <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
            <button type="button" onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none">✕</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox} alt="첨부 이미지" className="max-w-full max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

// 실행형 '태스크' 탭 — 칸반(4컬럼) + 간트 토글.
//   칸반: HTML5 native draggable 로 컬럼 이동 → project_tasks.status(+position) update.
//   간트: start_date~due_date 막대를 일 타임라인에 커스텀 div 로 렌더(의존성 화살표 제외, today 라인).
//   진행률 = done/전체(archived 제외). 지연 = due_date<today && status!='done'.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";

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

export function TasksTab({ dealId, companyId, users }: { dealId: string; companyId: string; users: any[] }) {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "gantt">("kanban");
  const [editTask, setEditTask] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_tasks")
        .select("id, title, description, status, assignee_id, start_date, due_date, progress, position")
        .eq("deal_id", dealId).is("archived_at", null)
        .order("position", { ascending: true }).order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.name;
    return m;
  }, [users]);

  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, any[]> = { todo: [], doing: [], review: [], done: [] };
    for (const t of tasks as any[]) {
      const s = (["todo", "doing", "review", "done"].includes(t.status) ? t.status : "todo") as TaskStatus;
      m[s].push(t);
    }
    return m;
  }, [tasks]);

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
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
            <button onClick={() => setView("kanban")} className={`px-3 py-1.5 font-semibold ${view === "kanban" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>칸반</button>
            <button onClick={() => setView("gantt")} className={`px-3 py-1.5 font-semibold ${view === "gantt" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>간트</button>
          </div>
          <button onClick={openNew} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 태스크</button>
        </div>
      </div>

      {view === "kanban" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {COLUMNS.map((col) => (
            <div key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
              onDrop={(e) => { e.preventDefault(); if (dragId) moveTask(dragId, col.key); setDragId(null); setDragOver(null); }}
              className={`rounded-xl border p-2.5 min-h-[120px] transition ${dragOver === col.key ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--bg-surface)]/30"}`}>
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
                    <div className="text-sm font-medium text-[var(--text)] break-words">{t.title}</div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {t.assignee_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{userName[t.assignee_id] || "담당"}</span>}
                      {t.due_date && <span className={`text-[10px] mono-number ${isDelayed(t) ? "text-red-500 font-semibold" : "text-[var(--text-dim)]"}`}>~{String(t.due_date).slice(5, 10)}</span>}
                      {isDelayed(t) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-semibold">지연</span>}
                    </div>
                  </div>
                ))}
                {byStatus[col.key].length === 0 && <div className="text-[11px] text-[var(--text-dim)] text-center py-3">비어 있음</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <GanttChart tasks={tasks as any[]} userName={userName} onTaskClick={openEdit} />
      )}

      {showForm && (
        <TaskFormModal
          dealId={dealId} companyId={companyId} users={users}
          task={editTask} userId={user?.id || null}
          existingCount={total}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ["project-tasks", dealId] }); }}
        />
      )}
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
          {dated.map((t) => {
            const s = t.start_date ? new Date(String(t.start_date)).getTime() : new Date(String(t.due_date)).getTime();
            const e = t.due_date ? new Date(String(t.due_date)).getTime() : s;
            const left = pctOf(Math.min(s, e));
            const width = Math.max(1.5, pctOf(Math.max(s, e)) - left);
            const delayed = isDelayed(t);
            const done = t.status === "done";
            const barColor = done ? "bg-green-500" : delayed ? "bg-red-500" : "bg-[var(--primary)]";
            return (
              <div key={t.id} className="relative h-7 flex items-center">
                <div className="absolute inset-0 flex items-center">
                  <div onClick={() => onTaskClick(t)}
                    className={`absolute h-5 rounded ${barColor} opacity-85 hover:opacity-100 cursor-pointer flex items-center px-1.5 overflow-hidden`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${t.title} · ${t.start_date ? String(t.start_date).slice(0, 10) : "?"} ~ ${t.due_date ? String(t.due_date).slice(0, 10) : "?"}${t.assignee_id ? ` · ${userName[t.assignee_id] || ""}` : ""}`}>
                    <span className="text-[10px] text-white font-medium truncate">{t.title}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({ dealId, companyId, users, task, userId, existingCount, onClose, onSaved }: {
  dealId: string; companyId: string; users: any[]; task: any | null; userId: string | null; existingCount: number; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(task?.title || "");
  const [assignee, setAssignee] = useState(task?.assignee_id || "");
  const [status, setStatus] = useState<TaskStatus>((task?.status as TaskStatus) || "todo");
  const [start, setStart] = useState((task?.start_date || "").slice(0, 10));
  const [due, setDue] = useState((task?.due_date || "").slice(0, 10));
  const [desc, setDesc] = useState(task?.description || "");
  const [saving, setSaving] = useState(false);
  const isEdit = !!task;

  const save = async () => {
    if (!title.trim()) { toast("태스크명을 입력하세요", "error"); return; }
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(), description: desc.trim() || null, status,
        assignee_id: assignee || null, start_date: start || null, due_date: due || null,
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
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">{isEdit ? "태스크 수정" : "+ 태스크 추가"}</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={LB}>태스크명 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할 일" className={IN} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LB}>담당</label>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={IN}>
                <option value="">미지정</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
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
          <div>
            <label className={LB}>설명 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className={IN} />
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
      </div>
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

import type { DealNode } from "@/types/models";

// ── Types ──

type BoardView = "list" | "kanban" | "timeline";

type UserInfo = { id: string; name: string | null; email: string | null };
interface NodeWithUser extends DealNode {
  users?: UserInfo | UserInfo[] | null;
}

interface ProjectBoardProps {
  dealId: string;
  nodes: NodeWithUser[];
  revenue?: any[];
  milestones?: any[];
  assignments?: any[];
  onRefresh: () => void;
}

interface AddTaskForm {
  name: string;
  description: string;
  priority: string;
  deadline: string;
  assignee_id: string;
  group_name: string;
}

// ── Constants ──

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: { label: "대기", color: "text-gray-400", bgColor: "bg-gray-500/10" },
  in_progress: { label: "진행", color: "text-blue-400", bgColor: "bg-blue-500/10" },
  completed: { label: "완료", color: "text-green-400", bgColor: "bg-green-500/10" },
  blocked: { label: "차단", color: "text-red-400", bgColor: "bg-red-500/10" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  high: { label: "높음", color: "text-red-400", bgColor: "bg-red-500/15" },
  medium: { label: "중간", color: "text-yellow-400", bgColor: "bg-yellow-500/15" },
  low: { label: "낮음", color: "text-green-400", bgColor: "bg-green-500/15" },
};

const KANBAN_COLUMNS = [
  { key: "pending", label: "대기", icon: "⏳", color: "border-gray-500/30" },
  { key: "in_progress", label: "진행중", icon: "🔄", color: "border-blue-500" },
  { key: "blocked", label: "블록", icon: "🚫", color: "border-red-500" },
  { key: "completed", label: "완료", icon: "✅", color: "border-green-500" },
];

const EMPTY_FORM: AddTaskForm = { name: "", description: "", priority: "medium", deadline: "", assignee_id: "", group_name: "" };

// ── Helpers ──

function getDaysLeft(deadline: string | null): { text: string; className: string } | null {
  if (!deadline) return null;
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `D+${Math.abs(days)}`, className: "text-red-400 font-bold" };
  if (days <= 3) return { text: `D-${days}`, className: "text-yellow-400 font-bold" };
  if (days <= 7) return { text: `D-${days}`, className: "text-[var(--text-muted)]" };
  return { text: new Date(deadline).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }), className: "text-[var(--text-dim)]" };
}

function getUser(node: NodeWithUser): UserInfo | null {
  if (!node.users) return null;
  return Array.isArray(node.users) ? node.users[0] ?? null : node.users;
}

function getAvatar(node: NodeWithUser) {
  const u = getUser(node);
  const name = u?.name || u?.email;
  if (!name) return null;
  return name[0].toUpperCase();
}

function getProgressPercent(nodes: NodeWithUser[]): number {
  if (nodes.length === 0) return 0;
  const done = nodes.filter(n => n.status === "completed").length;
  return Math.round((done / nodes.length) * 100);
}

// ── Main Component ──

export default function ProjectBoard({ dealId, nodes, revenue = [], milestones = [], assignments = [], onRefresh }: ProjectBoardProps) {
  const [view, setView] = useState<BoardView>("list");
  const [showAddTask, setShowAddTask] = useState(false);
  const [form, setForm] = useState<AddTaskForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const progress = useMemo(() => getProgressPercent(nodes), [nodes]);

  // Group nodes by group_name for list view
  const groups = useMemo(() => {
    const map = new Map<string, NodeWithUser[]>();
    nodes.forEach(n => {
      const g = n.group_name || "기본";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(n);
    });
    return Array.from(map.entries());
  }, [nodes]);

  // ── Mutations ──

  const addNodeMut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) return;
      await supabase.from("deal_nodes").insert({
        deal_id: dealId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        priority: form.priority || "medium",
        deadline: form.deadline || null,
        assignee_id: form.assignee_id || null,
        group_name: form.group_name.trim() || null,
        status: "pending",
        sort_order: nodes.length,
      });
    },
    onSuccess: () => { setForm(EMPTY_FORM); setShowAddTask(false); onRefresh(); },
  });

  const updateNodeMut = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DealNode> }) => {
      if (updates.status === "completed") updates.completed_at = new Date().toISOString();
      if (updates.status && updates.status !== "completed") updates.completed_at = null;
      await supabase.from("deal_nodes").update(updates as any).eq("id", id);
    },
    onSuccess: () => { onRefresh(); setEditingId(null); },
  });

  const deleteNodeMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("deal_nodes").delete().eq("id", id);
    },
    onSuccess: onRefresh,
  });

  const cycleStatus = useCallback((node: NodeWithUser) => {
    const order = ["pending", "in_progress", "completed"];
    const idx = order.indexOf(node.status || "pending");
    const next = order[(idx + 1) % order.length];
    updateNodeMut.mutate({ id: node.id, updates: { status: next } });
  }, [updateNodeMut]);

  // ── Upcoming Events (revenue + milestones merged) ──
  const upcomingEvents = useMemo(() => {
    const events: { type: "revenue" | "milestone"; label: string; date: string; amount?: number }[] = [];
    revenue.filter(r => r.status !== "received").forEach(r => {
      events.push({ type: "revenue", label: r.label || "입금 예정", date: r.due_date, amount: Number(r.amount) });
    });
    milestones.filter((m: any) => m.status !== "completed").forEach((m: any) => {
      events.push({ type: "milestone", label: m.name, date: m.due_date });
    });
    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 4);
  }, [revenue, milestones]);

  // ── Render ──

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden mb-6">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">📋 프로젝트 보드</h2>
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
            <span>{nodes.length}개 작업</span>
            <span>·</span>
            <span className={progress >= 80 ? "text-green-400" : progress >= 50 ? "text-yellow-400" : "text-[var(--text-muted)]"}>{progress}%</span>
            <div className="w-16 h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: progress >= 80 ? "#4ade80" : progress >= 50 ? "#fbbf24" : "#818cf8" }} />
            </div>
          </div>
        </div>
        <button onClick={() => setShowAddTask(!showAddTask)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">+ 작업 추가</button>
      </div>

      {/* View Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-surface)]">
        {([["list", "📋", "리스트"], ["kanban", "📌", "칸반"], ["timeline", "📅", "타임라인"]] as const).map(([key, icon, label]) => (
          <button key={key} onClick={() => setView(key)} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition ${view === key ? "text-[var(--primary)] border-[var(--primary)] bg-[var(--bg-card)]" : "text-[var(--text-dim)] border-transparent hover:text-[var(--text-muted)]"}`}>
            <span className="mr-1.5">{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* Add Task Form */}
      {showAddTask && (
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]/50">
          <div className="flex flex-wrap gap-2 items-center">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} onKeyDown={e => e.key === "Enter" && form.name.trim() && addNodeMut.mutate()} placeholder="작업명 *" className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" autoFocus />
            <input value={form.group_name} onChange={e => setForm({ ...form, group_name: e.target.value })} placeholder="그룹 (선택)" className="w-28 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" aria-label="우선순위">
              <option value="high">높음</option>
              <option value="medium">중간</option>
              <option value="low">낮음</option>
            </select>
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
            {assignments.length > 0 && (
              <select value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })} className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" aria-label="담당자">
                <option value="">담당자 선택</option>
                {assignments.map((a: any) => (
                  <option key={a.user_id || a.id} value={a.user_id || a.users?.id}>{a.users?.name || a.users?.email || "미지정"}</option>
                ))}
              </select>
            )}
            <button onClick={() => form.name.trim() && addNodeMut.mutate()} disabled={!form.name.trim() || addNodeMut.isPending} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">추가</button>
            <button onClick={() => { setShowAddTask(false); setForm(EMPTY_FORM); }} className="text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)]">취소</button>
          </div>
        </div>
      )}

      {/* Views */}
      {view === "list" && <ListView nodes={nodes} groups={groups} assignments={assignments} cycleStatus={cycleStatus} updateNode={updateNodeMut.mutate} deleteNode={deleteNodeMut.mutate} editingId={editingId} setEditingId={setEditingId} />}
      {view === "kanban" && <KanbanView nodes={nodes} cycleStatus={cycleStatus} updateNode={updateNodeMut.mutate} />}
      {view === "timeline" && <TimelineView nodes={nodes} revenue={revenue} milestones={milestones} />}

      {/* Upcoming Events Bar */}
      {upcomingEvents.length > 0 && (
        <div className="px-5 py-2.5 border-t border-[var(--border)] flex items-center gap-4 overflow-x-auto">
          <span className="text-[10px] text-[var(--text-dim)] font-semibold flex-shrink-0">다가오는 이벤트</span>
          {upcomingEvents.map((ev, i) => {
            const dl = getDaysLeft(ev.date);
            return (
              <span key={i} className="text-[11px] flex items-center gap-1 flex-shrink-0">
                <span>{ev.type === "revenue" ? "💰" : "🏁"}</span>
                <span className="text-[var(--text-muted)]">{ev.label}</span>
                {ev.amount && <span className="text-green-400 font-semibold">₩{ev.amount.toLocaleString()}</span>}
                {dl && <span className={dl.className}>{dl.text}</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && !showAddTask && (
        <div className="p-10 text-center">
          <div className="text-sm text-[var(--text-muted)] mb-2">작업이 없습니다</div>
          <button onClick={() => setShowAddTask(true)} className="text-xs text-[var(--primary)] font-semibold hover:underline">+ 첫 작업 추가하기</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════

function ListView({ nodes, groups, assignments, cycleStatus, updateNode, deleteNode, editingId, setEditingId }: {
  nodes: NodeWithUser[];
  groups: [string, NodeWithUser[]][];
  assignments: any[];
  cycleStatus: (n: NodeWithUser) => void;
  updateNode: (args: { id: string; updates: Record<string, any> }) => void;
  deleteNode: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <div>
      {/* Column headers */}
      <div className="grid grid-cols-[32px_1fr_72px_80px_80px_56px_64px_28px] items-center px-5 py-2 text-[10px] text-[var(--text-dim)] font-semibold uppercase tracking-wider border-b border-[var(--border)]/50">
        <span />
        <span>작업명</span>
        <span className="text-center">담당자</span>
        <span className="text-center">기한</span>
        <span className="text-right">비용</span>
        <span className="text-center">우선</span>
        <span className="text-center">상태</span>
        <span />
      </div>

      {groups.map(([groupName, groupNodes]) => (
        <div key={groupName}>
          {/* Group header */}
          {groups.length > 1 && (
            <div className="px-5 py-1.5 text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider border-b border-[var(--border)]/30 bg-[var(--bg-surface)]/50">
              {groupName} <span className="font-normal ml-1">({groupNodes.length})</span>
            </div>
          )}

          {groupNodes.map(node => {
            const st = STATUS_CONFIG[node.status || "pending"] || STATUS_CONFIG.pending;
            const pr = PRIORITY_CONFIG[node.priority || "medium"] || PRIORITY_CONFIG.medium;
            const dl = getDaysLeft(node.deadline);
            const avatar = getAvatar(node);
            const isActive = node.status === "in_progress";
            const isDone = node.status === "completed";

            return (
              <div key={node.id} className={`grid grid-cols-[32px_1fr_72px_80px_80px_56px_64px_28px] items-center px-5 py-2.5 border-b border-[var(--border)]/20 transition hover:bg-[var(--bg-surface)]/30 ${isActive ? "bg-[var(--primary)]/[0.02]" : ""}`}>
                {/* Checkbox */}
                <button onClick={() => cycleStatus(node)} className={`w-[18px] h-[18px] rounded flex items-center justify-center border-2 transition text-[10px] ${isDone ? "border-green-400 bg-green-400/20 text-green-400" : isActive ? "border-blue-400 bg-blue-400/10" : "border-[var(--border)] hover:border-[var(--primary)]"}`} aria-label={`상태 변경: ${node.name}`}>
                  {isDone && "✓"}
                  {isActive && <span className="w-2 h-2 rounded-full bg-blue-400" />}
                </button>

                {/* Name + description */}
                <div className="min-w-0 pr-2">
                  <div className={`text-[13px] font-medium truncate ${isDone ? "line-through text-[var(--text-dim)]" : isActive ? "text-[var(--primary)]" : ""}`}>{node.name}</div>
                  {node.description && <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">{node.description}</div>}
                </div>

                {/* Assignee */}
                <div className="flex justify-center">
                  {avatar ? (
                    <div className="w-6 h-6 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[10px] font-bold" title={(() => { const u = getUser(node); return u?.name || u?.email || ""; })()}>{avatar}</div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[10px] text-[var(--text-dim)]">?</div>
                  )}
                </div>

                {/* Deadline */}
                <div className="text-center">
                  {dl ? <span className={`text-[11px] ${dl.className}`}>{dl.text}</span> : <span className="text-[11px] text-[var(--text-dim)]">—</span>}
                </div>

                {/* Cost */}
                <div className="text-right text-[12px] text-[var(--text-muted)]">
                  {(node.expected_cost || 0) > 0 ? `₩${Number(node.expected_cost).toLocaleString()}` : "—"}
                </div>

                {/* Priority */}
                <div className="flex justify-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.bgColor} ${pr.color} font-semibold`}>{pr.label}</span>
                </div>

                {/* Status */}
                <div className="flex justify-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.bgColor} ${st.color} font-semibold cursor-pointer`} onClick={() => cycleStatus(node)}>{st.label}</span>
                </div>

                {/* Delete */}
                <button onClick={() => { if (confirm(`"${node.name}" 삭제?`)) deleteNode(node.id); }} className="text-[var(--text-dim)] hover:text-red-400 text-[10px] transition" aria-label="삭제">✕</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
// KANBAN VIEW
// ═══════════════════════════════════════════

function KanbanView({ nodes, cycleStatus, updateNode }: {
  nodes: NodeWithUser[];
  cycleStatus: (n: NodeWithUser) => void;
  updateNode: (args: { id: string; updates: Record<string, any> }) => void;
}) {
  const columns = KANBAN_COLUMNS.map(col => ({
    ...col,
    items: nodes.filter(n => (n.status || "pending") === col.key),
  }));

  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      {columns.map(col => (
        <div key={col.key} className={`bg-[var(--bg)] rounded-xl p-3 border-l-2 ${col.color}`}>
          {/* Column header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-bold">{col.icon} {col.label}</span>
            <span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] px-2 py-0.5 rounded-full">{col.items.length}</span>
          </div>

          {/* Cards */}
          {col.items.map(node => {
            const pr = PRIORITY_CONFIG[node.priority || "medium"] || PRIORITY_CONFIG.medium;
            const dl = getDaysLeft(node.deadline);
            const avatar = getAvatar(node);
            const isDone = node.status === "completed";

            return (
              <div key={node.id} className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 mb-2 transition hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${isDone ? "opacity-60" : ""}`}>
                <div className={`text-[13px] font-semibold mb-1.5 ${isDone ? "line-through text-[var(--text-dim)]" : ""}`}>{node.name}</div>
                {node.description && <div className="text-[11px] text-[var(--text-dim)] mb-2 line-clamp-2">{node.description}</div>}

                {/* Progress bar for in_progress */}
                {node.status === "in_progress" && node.expected_cost && node.actual_cost && (
                  <div className="h-1 bg-[var(--bg)] rounded-full mb-2 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (Number(node.actual_cost) / Number(node.expected_cost)) * 100)}%` }} />
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {avatar && <div className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold">{avatar}</div>}
                    {dl && <span className={`text-[10px] ${dl.className}`}>{dl.text}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.bgColor} ${pr.color} font-semibold`}>{pr.label}</span>
                    {(node.expected_cost || 0) > 0 && <span className="text-[10px] text-green-400 font-semibold">₩{Number(node.expected_cost).toLocaleString()}</span>}
                  </div>
                </div>

                {/* Status change buttons */}
                <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--border)]/30">
                  {KANBAN_COLUMNS.filter(c => c.key !== node.status).map(c => (
                    <button key={c.key} onClick={() => updateNode({ id: node.id, updates: { status: c.key } })} className="flex-1 text-[9px] py-1 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition font-medium">
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {col.items.length === 0 && (
            <div className="text-center py-6 text-[11px] text-[var(--text-dim)]">비어 있음</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
// TIMELINE VIEW (Gantt-style)
// ═══════════════════════════════════════════

function TimelineView({ nodes, revenue = [], milestones = [] }: {
  nodes: NodeWithUser[];
  revenue?: any[];
  milestones?: any[];
}) {
  // Calculate date range
  const allDates = [
    ...nodes.filter(n => n.start_date).map(n => new Date(n.start_date!)),
    ...nodes.filter(n => n.deadline).map(n => new Date(n.deadline!)),
    ...nodes.filter(n => n.created_at).map(n => new Date(n.created_at!)),
    ...revenue.filter(r => r.due_date).map(r => new Date(r.due_date)),
    ...milestones.filter((m: any) => m.due_date).map((m: any) => new Date(m.due_date)),
    new Date(),
  ].filter(d => !isNaN(d.getTime()));

  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

  // Ensure at least 6 weeks range
  const rangeMs = maxDate.getTime() - minDate.getTime();
  const minRangeMs = 42 * 86400000;
  if (rangeMs < minRangeMs) {
    maxDate.setTime(minDate.getTime() + minRangeMs);
  }

  // Add 1 week padding on each side
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);

  function dateToPercent(dateStr: string): number {
    const d = new Date(dateStr);
    const days = (d.getTime() - minDate.getTime()) / 86400000;
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  }

  // Generate week labels
  const weeks: { label: string; left: number }[] = [];
  const cursor = new Date(minDate);
  cursor.setDate(cursor.getDate() - cursor.getDay() + 1); // Monday
  while (cursor <= maxDate) {
    const pct = dateToPercent(cursor.toISOString());
    if (pct >= 0 && pct <= 100) {
      weeks.push({ label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, left: pct });
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  const barColors = ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500", "bg-pink-500", "bg-cyan-500"];

  return (
    <div className="px-5 py-4 overflow-x-auto">
      {/* Week headers */}
      <div className="grid grid-cols-[180px_1fr] mb-1">
        <span className="text-[10px] text-[var(--text-dim)] font-semibold">작업명</span>
        <div className="relative h-5">
          {weeks.map((w, i) => (
            <span key={i} className="absolute text-[9px] text-[var(--text-dim)] -translate-x-1/2" style={{ left: `${w.left}%` }}>{w.label}</span>
          ))}
        </div>
      </div>

      {/* Grid lines + task bars */}
      {nodes.map((node, i) => {
        const isDone = node.status === "completed";
        const startPct = dateToPercent(node.start_date || node.created_at || new Date().toISOString());
        const endPct = node.deadline ? dateToPercent(node.deadline) : startPct + 8;
        const width = Math.max(3, endPct - startPct);
        const barColor = barColors[i % barColors.length];

        return (
          <div key={node.id} className="grid grid-cols-[180px_1fr] items-center py-1.5 border-b border-[var(--border)]/20">
            <div className="flex items-center gap-2 pr-2 min-w-0">
              <span className={`w-3 h-3 rounded flex items-center justify-center text-[8px] flex-shrink-0 ${isDone ? "bg-green-400/20 text-green-400" : node.status === "in_progress" ? "bg-blue-400/10 border border-blue-400" : "border border-[var(--border)]"}`}>
                {isDone && "✓"}
              </span>
              <span className={`text-[12px] truncate ${isDone ? "line-through text-[var(--text-dim)]" : node.status === "in_progress" ? "text-[var(--primary)] font-medium" : ""}`}>{node.name}</span>
            </div>
            <div className="relative h-6">
              {/* Grid lines */}
              {weeks.map((w, wi) => (
                <div key={wi} className="absolute top-0 bottom-0 w-px bg-[var(--border)]/20" style={{ left: `${w.left}%` }} />
              ))}
              {/* Bar */}
              <div className={`absolute top-1 h-4 rounded ${barColor} ${isDone ? "opacity-40" : ""}`} style={{ left: `${startPct}%`, width: `${width}%` }} title={`${node.name}: ${node.start_date || "시작미정"} → ${node.deadline || "종료미정"}`} />
              {/* Today marker */}
              <div className="absolute top-0 bottom-0 w-0.5 bg-red-400/50" style={{ left: `${dateToPercent(new Date().toISOString())}%` }} />
            </div>
          </div>
        );
      })}

      {/* Events row */}
      {(revenue.length > 0 || milestones.length > 0) && (
        <div className="grid grid-cols-[180px_1fr] items-center pt-3 mt-2 border-t border-[var(--border)]">
          <span className="text-[10px] text-[var(--text-dim)] font-semibold">이벤트</span>
          <div className="relative h-6">
            {revenue.filter(r => r.due_date).map((r, i) => (
              <div key={`r-${i}`} className="absolute top-0 flex items-center gap-0.5" style={{ left: `${dateToPercent(r.due_date)}%` }}>
                <span className="text-[11px]">💰</span>
                <span className="text-[9px] text-green-400 font-semibold whitespace-nowrap">₩{Number(r.amount).toLocaleString()}</span>
              </div>
            ))}
            {milestones.filter((m: any) => m.due_date).map((m: any, i: number) => (
              <div key={`m-${i}`} className="absolute top-0 flex items-center gap-0.5" style={{ left: `${dateToPercent(m.due_date)}%` }}>
                <span className="text-[11px]">🏁</span>
                <span className="text-[9px] text-yellow-400 font-semibold whitespace-nowrap">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-5 pt-3 text-[10px] text-[var(--text-dim)]">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-400 mr-1 align-middle" /> 💰 매출 스케줄</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-400 mr-1 align-middle" /> 🏁 마일스톤</span>
        <span className="ml-auto"><span className="inline-block w-2.5 h-0.5 bg-red-400/50 mr-1 align-middle" /> 오늘</span>
      </div>
    </div>
  );
}

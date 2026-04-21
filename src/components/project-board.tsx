"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  parent_id: string;
}

// ── Constants ──

const STATUS_OPTIONS = [
  { key: "pending", label: "대기", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
  { key: "in_progress", label: "진행", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  { key: "completed", label: "완료", color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
  { key: "blocked", label: "차단", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
];

const PRIORITY_OPTIONS = [
  { key: "high", label: "높음", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  { key: "medium", label: "중간", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  { key: "low", label: "낮음", color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
];

const KANBAN_COLUMNS = [
  { key: "pending", label: "대기", icon: "⏳", color: "border-gray-500/30" },
  { key: "in_progress", label: "진행중", icon: "🔄", color: "border-blue-500" },
  { key: "blocked", label: "블록", icon: "🚫", color: "border-red-500" },
  { key: "completed", label: "완료", icon: "✅", color: "border-green-500" },
];

const EMPTY_FORM: AddTaskForm = { name: "", description: "", priority: "medium", deadline: "", assignee_id: "", group_name: "", parent_id: "" };

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

// ── Inline Cell Components ──

function CellDropdown({ value, options, onSelect, onClose }: {
  value: string;
  options: { key: string; label: string; color: string; bg: string }[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[100px]">
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => { onSelect(opt.key); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition ${opt.key === value ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--bg-surface)]/50"}`}
        >
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: opt.color }} />
          <span style={{ color: opt.color }} className="font-semibold">{opt.label}</span>
          {opt.key === value && <span className="ml-auto text-[var(--primary)] text-[10px]">✓</span>}
        </button>
      ))}
    </div>
  );
}

function AssigneePopover({ value, assignments, onSelect, onClose }: {
  value: string | null;
  assignments: any[];
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[140px]">
      <button onClick={() => { onSelect(null); onClose(); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-surface)]/50 ${!value ? "bg-[var(--bg-surface)]" : ""}`}>
        <span className="w-5 h-5 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[9px] text-[var(--text-dim)]">?</span>
        <span className="text-[var(--text-muted)]">미지정</span>
      </button>
      {assignments.map((a: any) => {
        const uid = a.user_id || a.users?.id;
        const name = a.users?.name || a.users?.email || "?";
        return (
          <button key={uid} onClick={() => { onSelect(uid); onClose(); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-surface)]/50 ${value === uid ? "bg-[var(--bg-surface)]" : ""}`}>
            <span className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold">{name[0].toUpperCase()}</span>
            <span className="truncate">{name}</span>
            {value === uid && <span className="ml-auto text-[var(--primary)] text-[10px]">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function InlineDateInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const dl = getDaysLeft(value);

  if (editing) {
    return (
      <input
        type="date"
        defaultValue={value || ""}
        autoFocus
        className="w-full px-1 py-0.5 bg-[var(--bg)] border border-[var(--primary)] rounded text-[11px] focus:outline-none"
        onBlur={e => { onChange(e.target.value || null); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter") { onChange((e.target as HTMLInputElement).value || null); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="w-full text-center text-[11px] py-0.5 rounded hover:bg-[var(--bg-surface)] transition cursor-pointer" title="클릭하여 날짜 변경">
      {dl ? <span className={dl.className}>{dl.text}</span> : <span className="text-[var(--text-dim)]">—</span>}
    </button>
  );
}

function InlineTextInput({ value, onSave, placeholder, className: cls }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        autoFocus
        className={`w-full px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--primary)] rounded text-[13px] focus:outline-none ${cls || ""}`}
        placeholder={placeholder}
        onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter") { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); } if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      />
    );
  }

  return (
    <button onClick={() => { setDraft(value); setEditing(true); }} className={`text-left w-full truncate cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--bg-surface)] transition ${cls || ""}`} title="클릭하여 수정">
      {value || <span className="text-[var(--text-dim)] italic">{placeholder || "입력"}</span>}
    </button>
  );
}

function InlineCostInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value || ""));

  if (editing) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft ? Number(draft).toLocaleString() : ""}
        onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        autoFocus
        className="w-full px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--primary)] rounded text-[12px] text-right focus:outline-none"
        placeholder="0"
        onBlur={() => { const n = Number(draft) || 0; if (n !== value) onSave(n); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter") { const n = Number(draft) || 0; if (n !== value) onSave(n); setEditing(false); } if (e.key === "Escape") { setDraft(String(value || "")); setEditing(false); } }}
      />
    );
  }

  return (
    <button onClick={() => { setDraft(String(value || "")); setEditing(true); }} className="w-full text-right text-[12px] py-0.5 rounded hover:bg-[var(--bg-surface)] transition cursor-pointer px-1" title="클릭하여 비용 수정">
      {value > 0 ? <span className="text-[var(--text-muted)]">₩{value.toLocaleString()}</span> : <span className="text-[var(--text-dim)]">—</span>}
    </button>
  );
}

// ── Main Component ──

export default function ProjectBoard({ dealId, nodes, revenue = [], milestones = [], assignments = [], onRefresh }: ProjectBoardProps) {
  const [view, setView] = useState<BoardView>("list");
  const [showAddTask, setShowAddTask] = useState(false);
  const [addToGroup, setAddToGroup] = useState<string | null>(null);
  const [addToParent, setAddToParent] = useState<string | null>(null);
  const [form, setForm] = useState<AddTaskForm>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Separate top-level and sub-items
  const topNodes = useMemo(() => nodes.filter(n => !n.parent_id), [nodes]);
  const childMap = useMemo(() => {
    const m = new Map<string, NodeWithUser[]>();
    nodes.filter(n => n.parent_id).forEach(n => {
      if (!m.has(n.parent_id!)) m.set(n.parent_id!, []);
      m.get(n.parent_id!)!.push(n);
    });
    return m;
  }, [nodes]);

  const progress = useMemo(() => getProgressPercent(nodes), [nodes]);

  // Group top-level nodes by group_name
  const groups = useMemo(() => {
    const map = new Map<string, NodeWithUser[]>();
    topNodes.forEach(n => {
      const g = n.group_name || "기본";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(n);
    });
    return Array.from(map.entries());
  }, [topNodes]);

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
        group_name: (addToGroup || form.group_name.trim()) || null,
        parent_id: addToParent || null,
        status: "pending",
        sort_order: nodes.length,
      });
    },
    onSuccess: () => { setForm(EMPTY_FORM); setShowAddTask(false); setAddToGroup(null); setAddToParent(null); onRefresh(); },
  });

  const updateNodeMut = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<DealNode> }) => {
      if (updates.status === "completed") updates.completed_at = new Date().toISOString();
      if (updates.status && updates.status !== "completed") updates.completed_at = null;
      await supabase.from("deal_nodes").update(updates as any).eq("id", id);
    },
    onSuccess: onRefresh,
  });

  const deleteNodeMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("deal_nodes").delete().eq("id", id);
    },
    onSuccess: onRefresh,
  });

  const bulkUpdateMut = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Partial<DealNode> }) => {
      if (updates.status === "completed") updates.completed_at = new Date().toISOString();
      if (updates.status && updates.status !== "completed") updates.completed_at = null;
      await supabase.from("deal_nodes").update(updates as any).in("id", ids);
    },
    onSuccess: () => { setSelectedIds(new Set()); onRefresh(); },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await supabase.from("deal_nodes").delete().in("id", ids);
    },
    onSuccess: () => { setSelectedIds(new Set()); onRefresh(); },
  });

  const updateNode = useCallback((id: string, updates: Partial<DealNode>) => {
    updateNodeMut.mutate({ id, updates });
  }, [updateNodeMut]);

  // ── Selection ──

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === topNodes.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(topNodes.map(n => n.id)));
  }, [topNodes, selectedIds]);

  // ── Upcoming Events ──
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

  // open add-task form for a specific group or parent
  function openAddTask(groupName?: string, parentId?: string) {
    setAddToGroup(groupName || null);
    setAddToParent(parentId || null);
    setForm(EMPTY_FORM);
    setShowAddTask(true);
  }

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
        <button onClick={() => openAddTask()} className="text-xs text-[var(--primary)] hover:text-[var(--text)] transition font-semibold">+ 작업 추가</button>
      </div>

      {/* View Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-surface)]">
        {([["list", "📋", "리스트"], ["kanban", "📌", "칸반"], ["timeline", "📅", "타임라인"]] as const).map(([key, icon, label]) => (
          <button key={key} onClick={() => setView(key)} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition ${view === key ? "text-[var(--primary)] border-[var(--primary)] bg-[var(--bg-card)]" : "text-[var(--text-dim)] border-transparent hover:text-[var(--text-muted)]"}`}>
            <span className="mr-1.5">{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="px-5 py-2 border-b border-[var(--primary)]/30 bg-[var(--primary)]/5 flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--primary)]">{selectedIds.size}건 선택</span>
          <div className="flex items-center gap-1.5">
            {STATUS_OPTIONS.map(s => (
              <button key={s.key} onClick={() => bulkUpdateMut.mutate({ ids: Array.from(selectedIds), updates: { status: s.key } })} className="px-2 py-1 rounded text-[10px] font-semibold transition hover:opacity-80" style={{ backgroundColor: s.bg, color: s.color }}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            {PRIORITY_OPTIONS.map(p => (
              <button key={p.key} onClick={() => bulkUpdateMut.mutate({ ids: Array.from(selectedIds), updates: { priority: p.key } })} className="px-2 py-1 rounded text-[10px] font-semibold transition hover:opacity-80" style={{ backgroundColor: p.bg, color: p.color }}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={() => { if (confirm(`${selectedIds.size}건을 삭제하시겠습니까?`)) bulkDeleteMut.mutate(Array.from(selectedIds)); }} className="ml-auto px-2 py-1 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition">삭제</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text-muted)]">취소</button>
        </div>
      )}

      {/* Add Task Inline */}
      {showAddTask && (
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]/50">
          {(addToGroup || addToParent) && (
            <div className="text-[10px] text-[var(--text-dim)] mb-2">
              {addToParent ? "▸ 서브 작업 추가" : `▸ "${addToGroup}" 그룹에 추가`}
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} onKeyDown={e => e.key === "Enter" && form.name.trim() && addNodeMut.mutate()} placeholder="작업명 *" className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" autoFocus />
            {!addToGroup && !addToParent && (
              <input value={form.group_name} onChange={e => setForm({ ...form, group_name: e.target.value })} placeholder="그룹명" className="w-28 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]" />
            )}
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
            <button onClick={() => { setShowAddTask(false); setAddToGroup(null); setAddToParent(null); setForm(EMPTY_FORM); }} className="text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)]">취소</button>
          </div>
        </div>
      )}

      {/* Views */}
      {view === "list" && (
        <SpreadsheetView
          nodes={topNodes}
          childMap={childMap}
          groups={groups}
          assignments={assignments}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          updateNode={updateNode}
          deleteNode={(id) => { if (confirm("삭제하시겠습니까?")) deleteNodeMut.mutate(id); }}
          onAddToGroup={(g) => openAddTask(g)}
          onAddSubItem={(parentId) => openAddTask(undefined, parentId)}
        />
      )}
      {view === "kanban" && <KanbanView nodes={nodes} updateNode={(id, updates) => updateNode(id, updates)} />}
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
          <button onClick={() => openAddTask()} className="text-xs text-[var(--primary)] font-semibold hover:underline">+ 첫 작업 추가하기</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// SPREADSHEET VIEW (Monday.com Style)
// ═══════════════════════════════════════════

function SpreadsheetView({ nodes, childMap, groups, assignments, selectedIds, toggleSelect, toggleSelectAll, updateNode, deleteNode, onAddToGroup, onAddSubItem }: {
  nodes: NodeWithUser[];
  childMap: Map<string, NodeWithUser[]>;
  groups: [string, NodeWithUser[]][];
  assignments: any[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  updateNode: (id: string, updates: Partial<DealNode>) => void;
  deleteNode: (id: string) => void;
  onAddToGroup: (groupName: string) => void;
  onAddSubItem: (parentId: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());

  const toggleGroup = (g: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const toggleSubExpand = (id: string) => {
    setExpandedSubs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (nodes.length === 0) return null;

  const COL_GRID = "grid-cols-[28px_28px_1fr_80px_90px_80px_64px_64px_28px]";

  return (
    <div className="overflow-x-auto">
      {/* Column Headers */}
      <div className={`hidden sm:grid ${COL_GRID} items-center px-4 py-2 text-[10px] text-[var(--text-dim)] font-semibold uppercase tracking-wider border-b border-[var(--border)] bg-[var(--bg-surface)]/70 sticky top-0 z-10`}>
        <span className="flex justify-center">
          <input
            type="checkbox"
            checked={selectedIds.size === nodes.length && nodes.length > 0}
            onChange={toggleSelectAll}
            className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--bg)] accent-[var(--primary)]"
            aria-label="전체 선택"
          />
        </span>
        <span />
        <span className="pl-1">작업명</span>
        <span className="text-center">담당자</span>
        <span className="text-center">기한</span>
        <span className="text-right pr-2">비용</span>
        <span className="text-center">우선순위</span>
        <span className="text-center">상태</span>
        <span />
      </div>

      {groups.map(([groupName, groupNodes]) => {
        const isCollapsed = collapsedGroups.has(groupName);
        const groupCost = groupNodes.reduce((s, n) => s + Number(n.expected_cost || 0), 0);
        const groupDone = groupNodes.filter(n => n.status === "completed").length;
        const groupProgress = groupNodes.length > 0 ? Math.round((groupDone / groupNodes.length) * 100) : 0;

        return (
          <div key={groupName}>
            {/* Group Header — Monday.com style colored bar */}
            <div
              className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] cursor-pointer select-none hover:bg-[var(--bg-surface)]/50 transition"
              onClick={() => toggleGroup(groupName)}
            >
              <span className={`text-[10px] transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
              <span className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
              <span className="text-xs font-bold">{groupName}</span>
              <span className="text-[10px] text-[var(--text-dim)]">{groupNodes.length}개 작업</span>
              <div className="flex items-center gap-1.5 ml-2">
                <div className="w-12 h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${groupProgress}%`, background: groupProgress >= 80 ? "#4ade80" : groupProgress >= 50 ? "#fbbf24" : "#818cf8" }} />
                </div>
                <span className="text-[10px] text-[var(--text-dim)]">{groupProgress}%</span>
              </div>
              {groupCost > 0 && <span className="text-[10px] text-[var(--text-muted)] ml-auto">합계 ₩{groupCost.toLocaleString()}</span>}
            </div>

            {/* Group Rows */}
            {!isCollapsed && (
              <>
                {groupNodes.map(node => (
                  <SpreadsheetRow
                    key={node.id}
                    node={node}
                    childMap={childMap}
                    assignments={assignments}
                    isSelected={selectedIds.has(node.id)}
                    toggleSelect={toggleSelect}
                    updateNode={updateNode}
                    deleteNode={deleteNode}
                    onAddSubItem={onAddSubItem}
                    expandedSubs={expandedSubs}
                    toggleSubExpand={toggleSubExpand}
                    colGrid={COL_GRID}
                    depth={0}
                  />
                ))}

                {/* Group Summary Row */}
                <div className={`hidden sm:grid ${COL_GRID} items-center px-4 py-1.5 border-b border-[var(--border)] bg-[var(--bg-surface)]/40`}>
                  <span /><span />
                  <button onClick={() => onAddToGroup(groupName)} className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-medium pl-1 text-left transition">+ 작업 추가</button>
                  <span />
                  <span className="text-center text-[10px] text-[var(--text-dim)]">{groupDone}/{groupNodes.length}</span>
                  <span className="text-right pr-2 text-[11px] font-bold text-[var(--text-muted)]">{groupCost > 0 ? `₩${groupCost.toLocaleString()}` : ""}</span>
                  <span /><span /><span />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Single Row (recursive for sub-items) ──

function SpreadsheetRow({ node, childMap, assignments, isSelected, toggleSelect, updateNode, deleteNode, onAddSubItem, expandedSubs, toggleSubExpand, colGrid, depth }: {
  node: NodeWithUser;
  childMap: Map<string, NodeWithUser[]>;
  assignments: any[];
  isSelected: boolean;
  toggleSelect: (id: string) => void;
  updateNode: (id: string, updates: Partial<DealNode>) => void;
  deleteNode: (id: string) => void;
  onAddSubItem: (parentId: string) => void;
  expandedSubs: Set<string>;
  toggleSubExpand: (id: string) => void;
  colGrid: string;
  depth: number;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const st = STATUS_OPTIONS.find(s => s.key === (node.status || "pending")) || STATUS_OPTIONS[0];
  const pr = PRIORITY_OPTIONS.find(p => p.key === (node.priority || "medium")) || PRIORITY_OPTIONS[1];
  const avatar = getAvatar(node);
  const user = getUser(node);
  const isDone = node.status === "completed";
  const isActive = node.status === "in_progress";
  const children = childMap.get(node.id) || [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedSubs.has(node.id);

  return (
    <>
      {/* Mobile Card */}
      <div className={`sm:hidden flex items-start gap-3 px-4 py-3 border-b border-[var(--border)]/20 ${isActive ? "bg-[var(--primary)]/[0.02]" : ""}`} style={{ paddingLeft: `${16 + depth * 24}px` }}>
        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(node.id)} className="mt-1 w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)]" />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isDone ? "line-through text-[var(--text-dim)]" : isActive ? "text-[var(--primary)]" : ""}`}>{node.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <button onClick={() => setStatusOpen(!statusOpen)} className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</button>
            <button onClick={() => setPriorityOpen(!priorityOpen)} className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: pr.bg, color: pr.color }}>{pr.label}</button>
            {node.deadline && (() => { const dl = getDaysLeft(node.deadline); return dl ? <span className={`text-[10px] ${dl.className}`}>{dl.text}</span> : null; })()}
            {avatar && <div className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold">{avatar}</div>}
          </div>
        </div>
      </div>

      {/* Desktop Row */}
      <div className={`hidden sm:grid ${colGrid} items-center px-4 py-1.5 border-b border-[var(--border)]/20 transition group ${isActive ? "bg-[var(--primary)]/[0.02]" : "hover:bg-[var(--bg-surface)]/30"} ${isSelected ? "bg-[var(--primary)]/[0.04]" : ""}`}>
        {/* Checkbox */}
        <span className="flex justify-center">
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(node.id)} className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--bg)] accent-[var(--primary)]" />
        </span>

        {/* Expand / Sub-item indicator */}
        <span className="flex justify-center">
          {hasChildren ? (
            <button onClick={() => toggleSubExpand(node.id)} className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-[var(--text-dim)] hover:bg-[var(--bg-surface)] transition">
              {isExpanded ? "▼" : "▶"}
            </button>
          ) : (
            <button onClick={() => onAddSubItem(node.id)} className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-surface)] transition" title="서브 작업 추가">
              +
            </button>
          )}
        </span>

        {/* Name — inline editable */}
        <div className="min-w-0 pr-2" style={{ paddingLeft: `${depth * 20}px` }}>
          <InlineTextInput
            value={node.name}
            onSave={v => updateNode(node.id, { name: v })}
            className={`text-[13px] font-medium ${isDone ? "line-through text-[var(--text-dim)]" : isActive ? "text-[var(--primary)]" : ""}`}
          />
          {node.description && <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5 px-1">{node.description}</div>}
        </div>

        {/* Assignee — click popover */}
        <div className="flex justify-center relative">
          <button onClick={() => setAssigneeOpen(!assigneeOpen)} className="hover:ring-2 hover:ring-[var(--primary)]/30 rounded-full transition" title={user?.name || user?.email || "담당자 지정"}>
            {avatar ? (
              <div className="w-6 h-6 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[10px] font-bold">{avatar}</div>
            ) : (
              <div className="w-6 h-6 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[10px] text-[var(--text-dim)] hover:border-[var(--primary)] transition">+</div>
            )}
          </button>
          {assigneeOpen && (
            <AssigneePopover
              value={node.assignee_id}
              assignments={assignments}
              onSelect={id => updateNode(node.id, { assignee_id: id })}
              onClose={() => setAssigneeOpen(false)}
            />
          )}
        </div>

        {/* Deadline — inline date picker */}
        <div className="px-1">
          <InlineDateInput value={node.deadline} onChange={v => updateNode(node.id, { deadline: v })} />
        </div>

        {/* Cost — inline number */}
        <div className="pr-2">
          <InlineCostInput value={Number(node.expected_cost || 0)} onSave={v => updateNode(node.id, { expected_cost: v })} />
        </div>

        {/* Priority — dropdown */}
        <div className="flex justify-center relative">
          <button onClick={() => setPriorityOpen(!priorityOpen)} className="text-[10px] px-2 py-0.5 rounded font-semibold cursor-pointer hover:ring-1 hover:ring-[var(--border)] transition" style={{ backgroundColor: pr.bg, color: pr.color }}>
            {pr.label}
          </button>
          {priorityOpen && (
            <CellDropdown value={node.priority || "medium"} options={PRIORITY_OPTIONS} onSelect={k => updateNode(node.id, { priority: k })} onClose={() => setPriorityOpen(false)} />
          )}
        </div>

        {/* Status — dropdown */}
        <div className="flex justify-center relative">
          <button onClick={() => setStatusOpen(!statusOpen)} className="text-[10px] px-2 py-0.5 rounded font-semibold cursor-pointer hover:ring-1 hover:ring-[var(--border)] transition" style={{ backgroundColor: st.bg, color: st.color }}>
            {st.label}
          </button>
          {statusOpen && (
            <CellDropdown value={node.status || "pending"} options={STATUS_OPTIONS} onSelect={k => updateNode(node.id, { status: k })} onClose={() => setStatusOpen(false)} />
          )}
        </div>

        {/* Delete */}
        <button onClick={() => deleteNode(node.id)} className="text-[var(--text-dim)] hover:text-red-400 text-[10px] transition opacity-0 group-hover:opacity-100" aria-label="삭제">✕</button>
      </div>

      {/* Sub-items (recursive) */}
      {hasChildren && isExpanded && children.map(child => (
        <SpreadsheetRow
          key={child.id}
          node={child}
          childMap={childMap}
          assignments={assignments}
          isSelected={false}
          toggleSelect={() => {}}
          updateNode={updateNode}
          deleteNode={deleteNode}
          onAddSubItem={onAddSubItem}
          expandedSubs={expandedSubs}
          toggleSubExpand={toggleSubExpand}
          colGrid={colGrid}
          depth={depth + 1}
        />
      ))}
      {hasChildren && isExpanded && (
        <div className={`hidden sm:grid ${colGrid} items-center px-4 py-1 border-b border-[var(--border)]/10`}>
          <span /><span />
          <button onClick={() => onAddSubItem(node.id)} className="text-[10px] text-[var(--primary)] hover:text-[var(--text)] font-medium text-left transition" style={{ paddingLeft: `${(depth + 1) * 20}px` }}>+ 서브 작업 추가</button>
          <span /><span /><span /><span /><span /><span />
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════
// KANBAN VIEW
// ═══════════════════════════════════════════

function KanbanView({ nodes, updateNode }: {
  nodes: NodeWithUser[];
  updateNode: (id: string, updates: Record<string, any>) => void;
}) {
  const columns = KANBAN_COLUMNS.map(col => ({
    ...col,
    items: nodes.filter(n => (n.status || "pending") === col.key),
  }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4">
      {columns.map(col => (
        <div key={col.key} className={`bg-[var(--bg)] rounded-xl p-3 border-l-2 ${col.color}`}>
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-bold">{col.icon} {col.label}</span>
            <span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] px-2 py-0.5 rounded-full">{col.items.length}</span>
          </div>

          {col.items.map(node => {
            const pr = PRIORITY_OPTIONS.find(p => p.key === (node.priority || "medium")) || PRIORITY_OPTIONS[1];
            const dl = getDaysLeft(node.deadline);
            const avatar = getAvatar(node);
            const isDone = node.status === "completed";

            return (
              <div key={node.id} className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 mb-2 transition hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${isDone ? "opacity-60" : ""}`}>
                <div className={`text-[13px] font-semibold mb-1.5 ${isDone ? "line-through text-[var(--text-dim)]" : ""}`}>{node.name}</div>
                {node.description && <div className="text-[11px] text-[var(--text-dim)] mb-2 line-clamp-2">{node.description}</div>}

                {node.status === "in_progress" && node.expected_cost && node.actual_cost && (
                  <div className="h-1 bg-[var(--bg)] rounded-full mb-2 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (Number(node.actual_cost) / Number(node.expected_cost)) * 100)}%` }} />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {avatar && <div className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold">{avatar}</div>}
                    {dl && <span className={`text-[10px] ${dl.className}`}>{dl.text}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: pr.bg, color: pr.color }}>{pr.label}</span>
                    {(node.expected_cost || 0) > 0 && <span className="text-[10px] text-green-400 font-semibold">₩{Number(node.expected_cost).toLocaleString()}</span>}
                  </div>
                </div>

                <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--border)]/30">
                  {KANBAN_COLUMNS.filter(c => c.key !== node.status).map(c => (
                    <button key={c.key} onClick={() => updateNode(node.id, { status: c.key })} className="flex-1 text-[9px] py-1 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition font-medium">
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

  const rangeMs = maxDate.getTime() - minDate.getTime();
  const minRangeMs = 42 * 86400000;
  if (rangeMs < minRangeMs) maxDate.setTime(minDate.getTime() + minRangeMs);

  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);

  function dateToPercent(dateStr: string): number {
    const d = new Date(dateStr);
    const days = (d.getTime() - minDate.getTime()) / 86400000;
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  }

  const weeks: { label: string; left: number }[] = [];
  const cursor = new Date(minDate);
  cursor.setDate(cursor.getDate() - cursor.getDay() + 1);
  while (cursor <= maxDate) {
    const pct = dateToPercent(cursor.toISOString());
    if (pct >= 0 && pct <= 100) weeks.push({ label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, left: pct });
    cursor.setDate(cursor.getDate() + 7);
  }

  const barColors = ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500", "bg-pink-500", "bg-cyan-500"];

  return (
    <div className="px-5 py-4 overflow-x-auto">
      <div className="grid grid-cols-[180px_1fr] mb-1">
        <span className="text-[10px] text-[var(--text-dim)] font-semibold">작업명</span>
        <div className="relative h-5">
          {weeks.map((w, i) => (
            <span key={i} className="absolute text-[9px] text-[var(--text-dim)] -translate-x-1/2" style={{ left: `${w.left}%` }}>{w.label}</span>
          ))}
        </div>
      </div>

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
              {weeks.map((w, wi) => (
                <div key={wi} className="absolute top-0 bottom-0 w-px bg-[var(--border)]/20" style={{ left: `${w.left}%` }} />
              ))}
              <div className={`absolute top-1 h-4 rounded ${barColor} ${isDone ? "opacity-40" : ""}`} style={{ left: `${startPct}%`, width: `${width}%` }} title={`${node.name}: ${node.start_date || "시작미정"} → ${node.deadline || "종료미정"}`} />
              <div className="absolute top-0 bottom-0 w-0.5 bg-red-400/50" style={{ left: `${dateToPercent(new Date().toISOString())}%` }} />
            </div>
          </div>
        );
      })}

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

      <div className="flex gap-5 pt-3 text-[10px] text-[var(--text-dim)]">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-400 mr-1 align-middle" /> 💰 매출 스케줄</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-400 mr-1 align-middle" /> 🏁 마일스톤</span>
        <span className="ml-auto"><span className="inline-block w-2.5 h-0.5 bg-red-400/50 mr-1 align-middle" /> 오늘</span>
      </div>
    </div>
  );
}

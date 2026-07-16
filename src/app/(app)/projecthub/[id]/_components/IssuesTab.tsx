"use client";

// 이슈 트래커 — 목표형 프로젝트의 문제점·이슈를 제목·심각도·담당·기한·상태·해결메모로 관리.
//   테이블: project_issues (RLS: company_id = get_my_company_id()). updated_at 트리거 없음 → 앱에서 명시 갱신.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase as any;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type Issue = {
  id: string; title: string; description: string | null; severity: string; status: string;
  assignee_id: string | null; due_date: string | null; resolution: string | null; resolved_at: string | null; created_at: string | null;
};

const SEVERITY = [
  { v: "low", label: "낮음", cls: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
  { v: "medium", label: "보통", cls: "bg-blue-500/10 text-blue-500" },
  { v: "high", label: "높음", cls: "bg-amber-500/10 text-amber-500" },
  { v: "critical", label: "심각", cls: "bg-red-500/10 text-red-500" },
];
const STATUS = [
  { v: "open", label: "열림", cls: "bg-red-500/10 text-red-500" },
  { v: "in_progress", label: "진행", cls: "bg-blue-500/10 text-blue-500" },
  { v: "resolved", label: "해결", cls: "bg-green-500/10 text-green-500" },
];
const sevMeta = (v: string) => SEVERITY.find((s) => s.v === v) || SEVERITY[1];
const stMeta = (v: string) => STATUS.find((s) => s.v === v) || STATUS[0];
const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const emptyForm = () => ({ id: "", title: "", description: "", severity: "medium", status: "open", assignee_id: "", due_date: "", resolution: "" });

export function IssuesTab({ dealId, companyId, users }: { dealId: string; companyId: string; users: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ["project-issues", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_issues").select("id, title, description, severity, status, assignee_id, due_date, resolution, resolved_at, created_at").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as Issue[];
    },
    enabled: !!dealId,
  });
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name || "—" : "—");

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("이슈 제목을 입력하세요");
      const resolving = form.status === "resolved";
      const base: any = {
        title: form.title.trim(), description: form.description.trim() || null,
        severity: form.severity, status: form.status,
        assignee_id: form.assignee_id || null, due_date: form.due_date || null,
        resolution: form.resolution.trim() || null,
      };
      if (form.id) {
        base.updated_at = new Date().toISOString();
        base.resolved_at = resolving ? new Date().toISOString() : null;
        const { error } = await db.from("project_issues").update(base).eq("id", form.id);
        if (error) throw new Error(error.message);
      } else {
        base.company_id = companyId; base.deal_id = dealId; base.created_by = user?.id || null;
        if (resolving) base.resolved_at = new Date().toISOString();
        const { error } = await db.from("project_issues").insert(base);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-issues", dealId] }); qc.invalidateQueries({ queryKey: ["project-issues-open", dealId] }); setShowForm(false); toast(form.id ? "이슈를 수정했습니다" : "이슈를 등록했습니다", "success"); },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });
  const delMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("project_issues").delete().eq("id", id); if (error) throw new Error(error.message); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-issues", dealId] }); qc.invalidateQueries({ queryKey: ["project-issues-open", dealId] }); toast("이슈를 삭제했습니다", "info"); },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });
  // 이슈 → 실행 과제 생성 ('실행' 탭 project_tasks). 제목·상세·담당·기한 이월.
  const taskMut = useMutation({
    mutationFn: async (iss: Issue) => {
      const { count } = await db.from("project_tasks").select("id", { count: "exact", head: true }).eq("deal_id", dealId).eq("status", "todo");
      const desc = [iss.description, `※ 이슈에서 생성 · 심각도 ${sevMeta(iss.severity).label}`].filter(Boolean).join("\n\n");
      const { error } = await db.from("project_tasks").insert({
        company_id: companyId, deal_id: dealId, title: iss.title, description: desc, status: "todo",
        assignee_id: iss.assignee_id || null, assignee_ids: iss.assignee_id ? [iss.assignee_id] : [],
        due_date: iss.due_date || null, progress: 0, position: (count || 0) + 1, created_by: user?.id || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-tasks", dealId] }); qc.invalidateQueries({ queryKey: ["goal-overview-overdue-tasks", dealId] }); toast("실행 과제를 생성했습니다. ‘실행’ 탭에서 확인하세요.", "success"); },
    onError: (e: any) => toast(e?.message || "과제 생성 실패", "error"),
  });
  // 상태 빠른 변경(행에서)
  const quickStatus = async (iss: Issue, status: string) => {
    const patch: any = { status, updated_at: new Date().toISOString() };
    patch.resolved_at = status === "resolved" ? new Date().toISOString() : null;
    const { error } = await db.from("project_issues").update(patch).eq("id", iss.id);
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["project-issues", dealId] });
    qc.invalidateQueries({ queryKey: ["project-issues-open", dealId] });
  };

  const openCreate = () => { setForm(emptyForm()); setShowForm(true); };
  const openEdit = (iss: Issue) => {
    setForm({ id: iss.id, title: iss.title, description: iss.description || "", severity: iss.severity, status: iss.status, assignee_id: iss.assignee_id || "", due_date: iss.due_date || "", resolution: iss.resolution || "" });
    setShowForm(true);
  };

  const shown = useMemo(() => {
    const list = filter === "all" ? issues : (issues as Issue[]).filter((i) => i.status === filter);
    // 미해결 우선 + 심각도 우선 + 기한 임박
    return [...list].sort((a, b) => {
      const ra = a.status === "resolved" ? 1 : 0, rb = b.status === "resolved" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      const sv = (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
      if (sv !== 0) return sv;
      return (a.due_date || "9999").localeCompare(b.due_date || "9999");
    });
  }, [issues, filter]);

  const counts = useMemo(() => {
    const c = { all: issues.length, open: 0, in_progress: 0, resolved: 0 } as Record<string, number>;
    for (const i of issues as Issue[]) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [issues]);
  const todayStr = new Date().toISOString().slice(0, 10);

  useModalKeys(showForm, () => setShowForm(false), (saveMut.isPending || !form.title.trim()) ? undefined : () => saveMut.mutate());

  return (
    <div className="issues-tab">
      <div className="issues-toolbar">
        <div className="seg-bar flex-wrap max-w-full">
          {([["all", "전체"], ["open", "열림"], ["in_progress", "진행"], ["resolved", "해결"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`seg-item ${filter === k ? "seg-item-active" : ""}`}>{l} <span className="text-[var(--text-dim)]">{counts[k] ?? 0}</span></button>
          ))}
        </div>
        <button onClick={openCreate} className="btn-primary text-xs hover:opacity-90">+ 이슈 등록</button>
      </div>

      {isLoading ? (
        <div className="issues-loading-state glass-card">불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="issues-empty-state glass-card">
          {filter === "all" ? "등록된 이슈가 없습니다. 문제점·리스크를 ‘+ 이슈 등록’으로 기록하고 해결까지 추적하세요." : "해당 상태의 이슈가 없습니다."}
        </div>
      ) : (
        <div className="issues-table-wrap glass-card">
          <table className="w-full text-sm border-collapse min-w-[720px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold border-b border-[var(--border)]">이슈</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[70px]">심각도</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold border-b border-[var(--border)] w-[110px]">담당</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[110px]">기한</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[150px]">상태</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[150px]">관리</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((iss) => {
                const overdue = iss.due_date && iss.status !== "resolved" && iss.due_date < todayStr;
                return (
                  <tr key={iss.id} className="issues-row">
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40">
                      <button onClick={() => openEdit(iss)} className={`text-left font-medium hover:text-[var(--primary)] hover:underline ${iss.status === "resolved" ? "text-[var(--text-muted)] line-through" : "text-[var(--text)]"}`}>{iss.title}</button>
                      {iss.description && <div className="text-[11px] text-[var(--text-dim)] truncate max-w-[360px]">{iss.description}</div>}
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sevMeta(iss.severity).cls}`}>{sevMeta(iss.severity).label}</span></td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)] truncate">{nameOf(iss.assignee_id)}</td>
                    <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-center text-[11px] mono-number ${overdue ? "text-[var(--danger)] font-semibold" : "text-[var(--text-muted)]"}`}>{fmtDate(iss.due_date)}{overdue ? " ⚠" : ""}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center">
                      <select value={iss.status} onChange={(e) => quickStatus(iss, e.target.value)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded-lg border-0 focus:outline-none cursor-pointer ${stMeta(iss.status).cls}`}>
                        {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                      <button onClick={() => taskMut.mutate(iss)} disabled={taskMut.isPending} className="px-2 py-1 text-[11px] font-semibold rounded text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-50" title="이 이슈로 실행 과제 생성">→과제</button>
                      <button onClick={() => openEdit(iss)} className="px-2 py-1 text-[11px] font-semibold rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]">수정</button>
                      <button onClick={() => { if (confirm(`'${iss.title}' 이슈를 삭제할까요?`)) delMut.mutate(iss.id); }} className="px-2 py-1 text-[11px] font-semibold rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록/수정 모달 */}
      {showForm && (
        <div className="issues-modal-overlay fixed inset-0" onClick={() => setShowForm(false)}>
          <div className="issues-modal" onClick={(e) => e.stopPropagation()}>
            <div className="issues-modal-header">
              <h3 className="text-base font-bold">{form.id ? "이슈 수정" : "이슈 등록"}</h3>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">제목 *</label>
                <input autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="예: 광고 승인 지연으로 캠페인 시작 밀림"
                  className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">상세 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="배경·영향·원인 등"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">심각도</label>
                  <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {SEVERITY.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">상태</label>
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">담당자</label>
                  <select value={form.assignee_id} onChange={(e) => setForm((f) => ({ ...f, assignee_id: e.target.value }))} className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    <option value="">미지정</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">해결 기한</label>
                  <DateField value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
              </div>
              {form.status === "resolved" && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">해결 메모 <span className="font-normal text-[var(--text-dim)]">(어떻게 해결했는지)</span></label>
                  <textarea value={form.resolution} onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))} rows={2} placeholder="해결 방법·결과"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
                </div>
              )}
            </div>
            <div className="issues-modal-footer">
              {form.id ? (
                <button onClick={() => { const iss = (issues as Issue[]).find((x) => x.id === form.id); if (iss) taskMut.mutate(iss); }} disabled={taskMut.isPending}
                  className="text-[13px] font-semibold text-[var(--primary)] hover:underline disabled:opacity-50" title="이 이슈로 실행 과제 생성">→ 실행 과제로 만들기</button>
              ) : <span />}
              <div className="flex items-center gap-2.5">
                <button onClick={() => setShowForm(false)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
                <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.title.trim()} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110">{saveMut.isPending ? "저장 중…" : "저장"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

// 부서 마스터 관리 (2026-06-29) — 목표형 성과 입력 부서 귀속용.
//   추가 / 이름변경 / 정렬(sort_order) / 보관(archived_at soft delete). 회사스코프 RLS.
//   보관 부서는 신규 선택지에서 제외(기존 entry 참조는 유지).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase as any;
type Dept = { id: string; name: string; sort_order: number; archived_at: string | null };

export function DepartmentsTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data: depts = [] } = useQuery({
    queryKey: ["settings-departments", companyId],
    queryFn: async () => {
      const { data } = await db.from("departments").select("id, name, sort_order, archived_at")
        .eq("company_id", companyId).order("sort_order", { ascending: true }).order("name", { ascending: true });
      return (data || []) as Dept[];
    },
    enabled: !!companyId,
  });
  const active = (depts as Dept[]).filter((d) => !d.archived_at);
  const archived = (depts as Dept[]).filter((d) => d.archived_at);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["settings-departments", companyId] }); qc.invalidateQueries({ queryKey: ["departments", companyId] }); };

  const addMut = useMutation({
    mutationFn: async (name: string) => {
      const nextOrder = active.reduce((m, d) => Math.max(m, d.sort_order), -1) + 1;
      const { error } = await db.from("departments").insert({ company_id: companyId, name: name.trim(), sort_order: nextOrder });
      if (error) throw error;
    },
    onSuccess: () => { setNewName(""); refresh(); toast("부서를 추가했습니다", "success"); },
    onError: (e: any) => toast(e?.message?.includes("uq_departments") || e?.code === "23505" ? "이미 같은 이름의 부서가 있습니다" : (e?.message || "추가 실패"), "error"),
  });
  const renameMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await db.from("departments").update({ name: name.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { setEditId(null); refresh(); toast("이름을 변경했습니다", "success"); },
    onError: (e: any) => toast(e?.code === "23505" ? "이미 같은 이름의 부서가 있습니다" : (e?.message || "변경 실패"), "error"),
  });
  const moveMut = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: -1 | 1 }) => {
      const idx = active.findIndex((d) => d.id === id);
      const swap = active[idx + dir];
      if (!swap) return;
      const a = active[idx];
      await db.from("departments").update({ sort_order: swap.sort_order }).eq("id", a.id);
      await db.from("departments").update({ sort_order: a.sort_order }).eq("id", swap.id);
    },
    onSuccess: refresh,
    onError: (e: any) => toast(e?.message || "정렬 실패", "error"),
  });
  const archiveMut = useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const { error } = await db.from("departments").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: any) => toast(e?.message || "보관 처리 실패", "error"),
  });

  if (!companyId) return null;

  return (
    <div className="glass-card p-5">
      <h2 className="text-base font-bold text-[var(--text)] mb-1">부서 관리</h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">목표형 프로젝트 성과 입력 시 선택하는 부서 목록입니다. 보관하면 새 입력 선택지에서 빠지고, 기존 기록은 유지됩니다.</p>

      <div className="flex gap-2 mb-4">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) addMut.mutate(newName); }}
          placeholder="새 부서 이름 (예: 마케팅팀)" className="flex-1 h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
        <button onClick={() => newName.trim() && addMut.mutate(newName)} disabled={!newName.trim() || addMut.isPending}
          className="px-4 h-9 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold disabled:opacity-50">추가</button>
      </div>

      {active.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)] py-6 text-center">등록된 부서가 없습니다. 위에서 추가하세요.</div>
      ) : (
        <div className="space-y-1.5">
          {active.map((d, i) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveMut.mutate({ id: d.id, dir: -1 })} disabled={i === 0} className="text-[10px] leading-none text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30">▲</button>
                <button onClick={() => moveMut.mutate({ id: d.id, dir: 1 })} disabled={i === active.length - 1} className="text-[10px] leading-none text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30">▼</button>
              </div>
              {editId === d.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && editName.trim()) renameMut.mutate({ id: d.id, name: editName }); if (e.key === "Escape") setEditId(null); }}
                    className="flex-1 h-8 px-2.5 rounded-md bg-[var(--bg)] border border-[var(--primary)]/40 text-sm" />
                  <button onClick={() => editName.trim() && renameMut.mutate({ id: d.id, name: editName })} className="text-xs px-2 py-1 rounded bg-[var(--primary)] text-white">저장</button>
                  <button onClick={() => setEditId(null)} className="text-xs px-2 py-1 text-[var(--text-muted)]">취소</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-[var(--text)] font-medium">{d.name}</span>
                  <button onClick={() => { setEditId(d.id); setEditName(d.name); }} className="text-xs px-2 py-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]">이름변경</button>
                  <button onClick={() => archiveMut.mutate({ id: d.id, archive: true })} className="text-xs px-2 py-1 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">보관</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowArchived((v) => !v)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
            {showArchived ? "▾" : "▸"} 보관된 부서 ({archived.length})
          </button>
          {showArchived && (
            <div className="space-y-1.5 mt-2">
              {archived.map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border)] opacity-70">
                  <span className="flex-1 text-sm text-[var(--text-muted)] line-through">{d.name}</span>
                  <button onClick={() => archiveMut.mutate({ id: d.id, archive: false })} className="text-xs px-2 py-1 rounded text-[var(--primary)] hover:bg-[var(--primary)]/10">복원</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

// 서비스 운영자 판별 — @mo-tive.com 이메일이면 글쓰기 가능 (RLS 와 동일 기준)
function isPlatformOperator(email?: string | null): boolean {
  return !!email && /@mo-tive\.com$/i.test(email.trim());
}

type Announcement = {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  notice: { label: "공지", color: "bg-blue-500/10 text-blue-500" },
  update: { label: "업데이트", color: "bg-emerald-500/10 text-emerald-500" },
  maintenance: { label: "점검", color: "bg-amber-500/10 text-amber-500" },
  event: { label: "이벤트", color: "bg-purple-500/10 text-purple-500" },
};

export default function AnnouncementsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = isPlatformOperator(user?.email);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "notice", pinned: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("announcements")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      return (data || []) as Announcement[];
    },
  });

  const resetForm = () => {
    setForm({ title: "", content: "", category: "notice", pinned: false });
    setEditing(null);
    setShowForm(false);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.content.trim()) throw new Error("제목과 내용을 입력하세요.");
      if (editing) {
        const { error } = await (supabase as any)
          .from("announcements")
          .update({
            title: form.title.trim(),
            content: form.content.trim(),
            category: form.category,
            pinned: form.pinned,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("announcements").insert({
          title: form.title.trim(),
          content: form.content.trim(),
          category: form.category,
          pinned: form.pinned,
          author_email: user?.email || null,
          author_name: user?.name || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast(editing ? "공지가 수정되었습니다." : "공지가 등록되었습니다.", "success");
      resetForm();
    },
    onError: (e: any) => toast("저장 실패: " + (e?.message || e?.code || ""), "error"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast("삭제되었습니다.", "success");
    },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ title: a.title, content: a.content, category: a.category, pinned: a.pinned });
    setShowForm(true);
  };

  const pinnedRows = useMemo(() => rows.filter((r) => r.pinned), [rows]);
  const normalRows = useMemo(() => rows.filter((r) => !r.pinned), [rows]);

  return (
    <div className="">
      {canWrite && !showForm && (
        <div className="page-sticky-header flex flex-wrap items-center justify-end gap-2 mb-6">
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="btn-primary"
          >
            + 공지 작성
          </button>
        </div>
      )}

      {/* 작성/수정 폼 (운영자만) */}
      {canWrite && showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-5 mb-6">
          <h3 className="section-title">{editing ? "공지 수정" : "새 공지 작성"}</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {Object.entries(CATEGORY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="제목"
                className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="공지 내용을 입력하세요"
              rows={6}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-y"
            />
            <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                className="rounded"
              />
              상단 고정
            </label>
            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <button
                onClick={resetForm}
                className="btn-secondary"
              >
                취소
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || !form.title.trim() || !form.content.trim()}
                className="btn-primary"
              >
                {saveMut.isPending ? "저장 중..." : editing ? "수정 저장" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="glass-card py-16 text-center">
          <div className="text-4xl mb-3">📢</div>
          <div className="text-sm font-semibold text-[var(--text)]">등록된 공지가 없습니다</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1.5">서비스 공지·업데이트 소식이 등록되면 여기에 표시됩니다.</div>
        </div>
      ) : (
        <div className="glass-card overflow-hidden divide-y divide-[var(--border)]">
          {[...pinnedRows, ...normalRows].map((a) => {
            const cat = CATEGORY_META[a.category] || CATEGORY_META.notice;
            const expanded = expandedId === a.id;
            return (
              <div key={a.id} className={a.pinned ? "bg-[var(--primary)]/[0.03]" : ""}>
                <button
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-[var(--bg-surface)]/60 transition"
                >
                  <div className="w-9 h-9 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-sm font-bold shrink-0">
                    {(a.author_name || a.author_email || "운")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {a.pinned && <span className="text-[10px]">📌</span>}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span>
                      <span className="text-sm font-bold text-[var(--text)] truncate">{a.title}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      {a.author_name || a.author_email || "운영자"} · {new Date(a.created_at).toLocaleString("ko-KR")}
                      {a.updated_at !== a.created_at && " (수정됨)"}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 shrink-0 text-[var(--text-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {expanded && (
                  <div className="px-5 pb-4">
                    <div className="text-sm text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed border-t border-[var(--border)] pt-3">
                      {a.content}
                    </div>
                    {canWrite && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => startEdit(a)}
                          className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] transition"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => { if (confirm("이 공지를 삭제하시겠습니까?")) delMut.mutate(a.id); }}
                          className="text-xs px-3 py-1.5 text-red-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition"
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

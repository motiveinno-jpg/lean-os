"use client";

// 운영자 — 서비스 공지사항 작성·수정·삭제 (2026-08-06 사장님 지시).
//   여기서 쓴 공지는 전 고객사가 /announcements 에서 열람만 한다.
//   쓰기 권한은 DB announcements_*_operator 정책(is_platform_operator())이 최종 게이트다.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

type Announcement = {
  id: string;
  company_id: string | null;
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
  notice: { label: "공지", color: "bg-[var(--info-dim)] text-[var(--info)]" },
  update: { label: "업데이트", color: "bg-[var(--success-dim)] text-[var(--success)]" },
  maintenance: { label: "점검", color: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  event: { label: "이벤트", color: "bg-[var(--primary-light)] text-[var(--primary)]" },
};

const EMPTY_FORM = { title: "", content: "", category: "notice", pinned: false };

export default function PlatformAnnouncementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["op-announcements"],
    queryFn: async () => {
      const data = logRead('platform/announcements:data', await supabase
        .from("announcements")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }));
      return (data || []) as Announcement[];
    },
  });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setShowForm(false);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const title = form.title.trim();
      const content = form.content.trim();
      if (!title || !content) throw new Error("제목과 내용을 입력하세요.");
      if (editing) {
        const { error } = await supabase
          .from("announcements")
          .update({ title, content, category: form.category, pinned: form.pinned, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        // company_id 를 비워 전 고객사 공지로 등록한다(회사별 공지는 레거시 2건만 존재).
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const { error } = await supabase.from("announcements").insert({
          title,
          content,
          category: form.category,
          pinned: form.pinned,
          author_email: authUser?.email || null,
          author_name: "OwnerView 운영팀",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-announcements"] });
      toast(editing ? "공지를 수정했습니다." : "공지를 등록했습니다.", "success");
      resetForm();
    },
    onError: (e: any) => toast("저장 실패: " + (e?.message || e?.code || ""), "error"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-announcements"] });
      toast("공지를 삭제했습니다.", "success");
    },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ title: a.title, content: a.content, category: a.category, pinned: a.pinned });
    setShowForm(true);
  };

  const pinnedCount = useMemo(() => rows.filter((r) => r.pinned).length, [rows]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="op-announce-header">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">공지사항</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            전 고객사에 노출되는 서비스 공지 — 총 {rows.length}건{pinnedCount > 0 ? ` · 상단 고정 ${pinnedCount}건` : ""}
          </p>
        </div>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
            + 공지 작성
          </button>
        )}
      </div>

      {showForm && (
        <div className="op-announce-form">
          <h3 className="section-title">{editing ? "공지 수정" : "새 공지 작성"}</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="field-input max-w-[140px]"
              >
                {Object.entries(CATEGORY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="제목"
                className="field-input flex-1"
              />
            </div>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="공지 내용을 입력하세요"
              rows={8}
              className="field-input w-full resize-y"
            />
            <label className="op-announce-pin-toggle">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                className="rounded"
              />
              상단 고정
            </label>
            <div className="op-announce-form-footer">
              <button onClick={resetForm} className="btn-secondary">취소</button>
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

      <div className="op-announce-list glass-card">
        {isLoading ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">등록된 공지가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((a) => {
              const cat = CATEGORY_META[a.category] || CATEGORY_META.notice;
              return (
                <div key={a.id} className="op-announce-row">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {a.pinned && <span className="text-[11px]"><Ico e="📌" /></span>}
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${cat.color}`}>{cat.label}</span>
                        <span className="font-semibold text-[var(--text)]">{a.title}</span>
                        {a.company_id && (
                          <span className="op-announce-scope-tag">특정 회사 전용</span>
                        )}
                      </div>
                      <div className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed whitespace-pre-wrap">{a.content}</div>
                      <div className="text-xs text-[var(--text-dim)] mt-2">
                        {a.author_name || a.author_email || "운영자"} · {new Date(a.created_at).toLocaleString("ko-KR")}
                        {a.updated_at !== a.created_at && " (수정됨)"}
                      </div>
                    </div>
                    <div className="op-announce-actions">
                      <button onClick={() => startEdit(a)} className="btn-ghost btn-sm">수정</button>
                      <button
                        onClick={async () => { if (await appConfirm("이 공지를 삭제하시겠습니까?", { danger: true })) delMut.mutate(a.id); }}
                        className="btn-danger btn-sm"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

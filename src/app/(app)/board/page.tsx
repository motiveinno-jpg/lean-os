"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

const db = supabase as any;

type Post = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  title: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};
type Comment = {
  id: string;
  post_id: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
};

export default function BoardPage() {
  const { user, role } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const companyId = user?.company_id ?? null;
  const canPin = role === "owner" || role === "admin";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState({ title: "", content: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["board-posts", companyId],
    queryFn: async () => {
      const { data } = await db
        .from("board_posts")
        .select("*")
        .eq("company_id", companyId!)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      return (data || []) as Post[];
    },
    enabled: !!companyId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["board-comments", openId],
    queryFn: async () => {
      const { data } = await db
        .from("board_comments")
        .select("*")
        .eq("post_id", openId!)
        .order("created_at", { ascending: true });
      return (data || []) as Comment[];
    },
    enabled: !!openId,
  });

  const resetForm = () => { setForm({ title: "", content: "" }); setEditing(null); setShowForm(false); };

  const savePost = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.content.trim()) throw new Error("제목과 내용을 입력하세요.");
      if (editing) {
        const { error } = await db.from("board_posts").update({
          title: form.title.trim(), content: form.content.trim(), updated_at: new Date().toISOString(),
        }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("board_posts").insert({
          company_id: companyId, author_id: user?.id || null,
          author_name: user?.name || null, author_email: user?.email || null,
          title: form.title.trim(), content: form.content.trim(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board-posts"] }); toast(editing ? "글이 수정되었습니다." : "글이 등록되었습니다.", "success"); resetForm(); },
    onError: (e: any) => toast("저장 실패: " + (e?.message || e?.code || ""), "error"),
  });

  const delPost = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("board_posts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board-posts"] }); toast("삭제되었습니다.", "success"); },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const togglePin = useMutation({
    mutationFn: async (p: Post) => { const { error } = await db.from("board_posts").update({ pinned: !p.pinned }).eq("id", p.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-posts"] }),
    onError: (e: any) => toast("고정 실패: " + (e?.message || ""), "error"),
  });

  const addComment = useMutation({
    mutationFn: async (postId: string) => {
      const text = (commentDraft[postId] || "").trim();
      if (!text) throw new Error("댓글 내용을 입력하세요.");
      const { error } = await db.from("board_comments").insert({
        post_id: postId, company_id: companyId, author_id: user?.id || null,
        author_name: user?.name || user?.email || null, content: text,
      });
      if (error) throw error;
    },
    onSuccess: (_d, postId) => { setCommentDraft((s) => ({ ...s, [postId]: "" })); qc.invalidateQueries({ queryKey: ["board-comments"] }); },
    onError: (e: any) => toast("댓글 등록 실패: " + (e?.message || ""), "error"),
  });

  const delComment = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("board_comments").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-comments"] }),
    onError: (e: any) => toast("댓글 삭제 실패: " + (e?.message || ""), "error"),
  });

  const mine = (authorId: string | null) => authorId && authorId === user?.id;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">게시판</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">회사 구성원 누구나 글·댓글을 쓸 수 있습니다. {canPin && <span className="text-emerald-500">· 관리자: 상단 고정 가능</span>}</p>
        </div>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition">
            + 글쓰기
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-5 mb-6">
          <h3 className="text-sm font-bold mb-3">{editing ? "글 수정" : "새 글 작성"}</h3>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="제목"
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-2 focus:outline-none focus:border-[var(--primary)]" />
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="내용" rows={6}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm resize-y focus:outline-none focus:border-[var(--primary)]" />
          <div className="flex gap-2 mt-3">
            <button onClick={resetForm} className="px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl text-sm hover:text-[var(--text)]">취소</button>
            <button onClick={() => savePost.mutate()} disabled={savePost.isPending || !form.title.trim() || !form.content.trim()}
              className="px-5 py-2 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">
              {savePost.isPending ? "저장 중..." : editing ? "수정 저장" : "등록"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : posts.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-4xl mb-3">📝</div>
          <div className="text-sm text-[var(--text-muted)]">등록된 글이 없습니다. 첫 글을 작성해보세요.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => {
            const open = openId === p.id;
            const isMine = mine(p.author_id);
            return (
              <div key={p.id} className={`bg-[var(--bg-card)] rounded-2xl border transition ${p.pinned ? "border-[var(--primary)]/30" : "border-[var(--border)]"}`}>
                <button onClick={() => setOpenId(open ? null : p.id)} className="w-full text-left px-5 py-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {p.pinned && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">📌 고정</span>}
                      <span className="text-sm font-bold text-[var(--text)] truncate">{p.title}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      {p.author_name || p.author_email || "익명"} · {new Date(p.created_at).toLocaleString("ko-KR")}
                      {p.updated_at !== p.created_at && " (수정됨)"}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {open && (
                  <div className="px-5 pb-4">
                    <div className="text-sm text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed border-t border-[var(--border)] pt-3">{p.content}</div>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {canPin && (
                        <button onClick={() => togglePin.mutate(p)} className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] transition">
                          {p.pinned ? "고정 해제" : "📌 상단 고정"}
                        </button>
                      )}
                      {(isMine || canPin) && (
                        <>
                          <button onClick={() => { setEditing(p); setForm({ title: p.title, content: p.content }); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                            className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] transition">수정</button>
                          <button onClick={() => { if (confirm("이 글을 삭제하시겠습니까?")) delPost.mutate(p.id); }}
                            className="text-xs px-3 py-1.5 text-red-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition">삭제</button>
                        </>
                      )}
                    </div>

                    {/* 댓글 */}
                    <div className="mt-4 border-t border-[var(--border)] pt-3">
                      <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">댓글 {comments.length}</div>
                      <div className="space-y-2 mb-3">
                        {comments.map((c) => (
                          <div key={c.id} className="flex items-start gap-2 text-sm">
                            <div className="flex-1 min-w-0 bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                              <div className="text-[11px] text-[var(--text-dim)] mb-0.5">
                                {c.author_name || "익명"} · {new Date(c.created_at).toLocaleString("ko-KR")}
                              </div>
                              <div className="text-[var(--text)] whitespace-pre-wrap">{c.content}</div>
                            </div>
                            {(mine(c.author_id) || canPin) && (
                              <button onClick={() => delComment.mutate(c.id)} className="text-[var(--text-dim)] hover:text-red-400 text-xs shrink-0 mt-1">×</button>
                            )}
                          </div>
                        ))}
                        {comments.length === 0 && <div className="text-xs text-[var(--text-dim)]">첫 댓글을 남겨보세요.</div>}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={commentDraft[p.id] || ""}
                          onChange={(e) => setCommentDraft((s) => ({ ...s, [p.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment.mutate(p.id); } }}
                          placeholder="댓글 입력 후 Enter"
                          className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                        />
                        <button onClick={() => addComment.mutate(p.id)} disabled={addComment.isPending || !(commentDraft[p.id] || "").trim()}
                          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
                      </div>
                    </div>
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

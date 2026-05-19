"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { FileUploadMulti } from "@/components/file-upload-multi";

const db = supabase as any;

type Attachment = {
  name: string;
  url: string;
  type: string;
  size: number;
  storage_path: string;
};

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
  // 확장 필드 (DB 적용 전엔 undefined → 안전 처리)
  event_date?: string | null;
  poll_question?: string | null;
  poll_options?: string[] | null;
  poll_multi?: boolean | null;
  poll_anonymous?: boolean | null;
  attachments?: Attachment[] | null;
};
type Comment = {
  id: string;
  post_id: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
};

const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";
const FILE_TYPES =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain,application/zip,application/x-zip-compressed";

const BOARD_BUCKET = "board-files";

function isImage(type: string) {
  return type.startsWith("image/");
}

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

  // 작업2 — 확장 입력 상태
  const [eventDate, setEventDate] = useState<string>("");
  const [pollQuestion, setPollQuestion] = useState<string>("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState<boolean>(false);       // R13: 복수 선택 허용
  const [pollAnonymous, setPollAnonymous] = useState<boolean>(false); // R14: 익명 투표
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

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

  // R13/R14: 투표 집계는 SECURITY DEFINER RPC get_poll_results 우선
  //   (익명 폴은 투표자 신원 비노출 — 클라이언트가 user_id 를 직접 못 읽음).
  //   마이그레이션 미적용 환경에서는 RPC 부재 → 레거시 select 집계로 폴백.
  const { data: pollAgg } = useQuery({
    queryKey: ["board-poll-results", openId],
    queryFn: async () => {
      const counts: Record<number, number> = {};
      try {
        const { data, error } = await db.rpc("get_poll_results", { p_post_id: openId });
        if (error) throw error;
        let total = 0;
        for (const r of (data || []) as any[]) {
          counts[Number(r.option_index)] = Number(r.vote_count || 0);
          total += Number(r.vote_count || 0);
        }
        return { counts, total };
      } catch {
        const { data } = await db
          .from("board_poll_votes")
          .select("option_index")
          .eq("post_id", openId!);
        for (const v of (data || []) as any[]) {
          const k = Number(v.option_index);
          counts[k] = (counts[k] || 0) + 1;
        }
        return { counts, total: (data || []).length };
      }
    },
    enabled: !!openId,
  });
  const voteCounts: Record<number, number> = pollAgg?.counts ?? {};
  const totalVotes = pollAgg?.total ?? 0;

  // 내 표 — 본인 행만 조회(익명이어도 본인 선택 표시는 가능, RLS 본인범위).
  const { data: myVotes = [] } = useQuery({
    queryKey: ["board-my-poll-votes", openId, user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as number[];
      const { data } = await db
        .from("board_poll_votes")
        .select("option_index")
        .eq("post_id", openId!)
        .eq("user_id", user.id);
      return ((data || []) as any[]).map((v) => Number(v.option_index));
    },
    enabled: !!openId && !!user?.id,
  });

  const resetForm = () => {
    setForm({ title: "", content: "" });
    setEditing(null);
    setShowForm(false);
    setEventDate("");
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollMulti(false);
    setPollAnonymous(false);
    setPhotoFiles([]);
    setDocFiles([]);
  };

  // Supabase Storage 업로드 (file-storage.ts 와 동일 경로 규칙: {companyId}/board/{ts}_{rand}.{ext})
  async function uploadAttachments(files: File[]): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() || "bin";
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);
      const storagePath = `${companyId}/board/${ts}_${rand}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BOARD_BUCKET)
        .upload(storagePath, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage
        .from(BOARD_BUCKET)
        .getPublicUrl(storagePath);
      out.push({
        name: file.name,
        url: urlData.publicUrl,
        type: file.type,
        size: file.size,
        storage_path: storagePath,
      });
    }
    return out;
  }

  const savePost = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.content.trim())
        throw new Error("제목과 내용을 입력하세요.");

      const cleanPollOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (pollQuestion.trim() && cleanPollOptions.length < 2)
        throw new Error("투표는 선택지를 2개 이상 입력하세요.");

      setUploading(true);
      let attachments: Attachment[] = [];
      try {
        const allFiles = [...photoFiles, ...docFiles];
        if (allFiles.length > 0) {
          attachments = await uploadAttachments(allFiles);
        }
      } finally {
        setUploading(false);
      }

      const ext: Record<string, unknown> = {
        event_date: eventDate || null,
        poll_question: pollQuestion.trim() || null,
        poll_options: pollQuestion.trim() ? cleanPollOptions : [],
        poll_multi: pollQuestion.trim() ? pollMulti : false,
        poll_anonymous: pollQuestion.trim() ? pollAnonymous : false,
        attachments,
      };

      if (editing) {
        // 수정 시: 기존 첨부 유지 + 신규 추가
        const merged = [...(editing.attachments || []), ...attachments];
        const { error } = await db
          .from("board_posts")
          .update({
            title: form.title.trim(),
            content: form.content.trim(),
            updated_at: new Date().toISOString(),
            ...ext,
            attachments: merged,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("board_posts").insert({
          company_id: companyId,
          author_id: user?.id || null,
          author_name: user?.name || null,
          author_email: user?.email || null,
          title: form.title.trim(),
          content: form.content.trim(),
          ...ext,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board-posts"] });
      toast(editing ? "글이 수정되었습니다." : "글이 등록되었습니다.", "success");
      resetForm();
    },
    onError: (e: any) =>
      toast("저장 실패: " + (e?.message || e?.code || ""), "error"),
  });

  const delPost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("board_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board-posts"] });
      toast("삭제되었습니다.", "success");
    },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const togglePin = useMutation({
    mutationFn: async (p: Post) => {
      const { error } = await db
        .from("board_posts")
        .update({ pinned: !p.pinned })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-posts"] }),
    onError: (e: any) => toast("고정 실패: " + (e?.message || ""), "error"),
  });

  const addComment = useMutation({
    mutationFn: async (postId: string) => {
      const text = (commentDraft[postId] || "").trim();
      if (!text) throw new Error("댓글 내용을 입력하세요.");
      const { error } = await db.from("board_comments").insert({
        post_id: postId,
        company_id: companyId,
        author_id: user?.id || null,
        author_name: user?.name || user?.email || null,
        content: text,
      });
      if (error) throw error;
    },
    onSuccess: (_d, postId) => {
      setCommentDraft((s) => ({ ...s, [postId]: "" }));
      qc.invalidateQueries({ queryKey: ["board-comments"] });
    },
    onError: (e: any) =>
      toast("댓글 등록 실패: " + (e?.message || ""), "error"),
  });

  const delComment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("board_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-comments"] }),
    onError: (e: any) =>
      toast("댓글 삭제 실패: " + (e?.message || ""), "error"),
  });

  // 투표 — onConflict 미사용(구 (post_id,user_id) / 신 (post_id,user_id,
  //   option_index) UNIQUE 양쪽에서 안전). 단일=기존 표 교체, 복수=옵션 토글.
  const castVote = useMutation({
    mutationFn: async ({ postId, optionIndex, multi }: { postId: string; optionIndex: number; multi: boolean }) => {
      if (!user?.id) throw new Error("로그인이 필요합니다.");
      if (multi) {
        const { data: existing } = await db
          .from("board_poll_votes")
          .select("id")
          .eq("post_id", postId)
          .eq("user_id", user.id)
          .eq("option_index", optionIndex)
          .limit(1);
        if (existing && existing.length > 0) {
          const { error } = await db
            .from("board_poll_votes")
            .delete()
            .eq("post_id", postId)
            .eq("user_id", user.id)
            .eq("option_index", optionIndex);
          if (error) throw error;
        } else {
          const { error } = await db
            .from("board_poll_votes")
            .insert({ post_id: postId, company_id: companyId, user_id: user.id, option_index: optionIndex });
          if (error) throw error;
        }
      } else {
        await db.from("board_poll_votes").delete().eq("post_id", postId).eq("user_id", user.id);
        const { error } = await db
          .from("board_poll_votes")
          .insert({ post_id: postId, company_id: companyId, user_id: user.id, option_index: optionIndex });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board-poll-results"] });
      qc.invalidateQueries({ queryKey: ["board-my-poll-votes"] });
      toast("투표 완료", "success");
    },
    onError: (e: any) => toast("투표 실패: " + (e?.message || ""), "error"),
  });

  const mine = (authorId: string | null) =>
    authorId && authorId === user?.id;

  const setOption = (idx: number, val: string) =>
    setPollOptions((o) => o.map((x, i) => (i === idx ? val : x)));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">게시판</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            회사 구성원 누구나 글·댓글·일정·투표·첨부를 쓸 수 있습니다.{" "}
            {canPin && (
              <span className="text-emerald-500">· 관리자: 상단 고정 가능</span>
            )}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition"
          >
            + 글쓰기
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-5 mb-6 space-y-3">
          <h3 className="text-sm font-bold">
            {editing ? "글 수정" : "새 글 작성"}
          </h3>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="제목"
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="내용"
            rows={6}
            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm resize-y focus:outline-none focus:border-[var(--primary)]"
          />

          {/* ① 일정 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              📅 일정 (선택)
            </div>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>

          {/* ② 투표 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              🗳️ 투표 (선택)
            </div>
            <input
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="투표 질문 (비우면 투표 없음)"
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-2 focus:outline-none focus:border-[var(--primary)]"
            />
            {pollQuestion.trim() && (
              <div className="space-y-2">
                {pollOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                      placeholder={`선택지 ${i + 1}`}
                      className="flex-1 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() =>
                          setPollOptions((o) => o.filter((_, idx) => idx !== i))
                        }
                        className="px-2 text-[var(--text-dim)] hover:text-red-400"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setPollOptions((o) => [...o, ""])}
                  className="text-xs text-[var(--primary)] font-semibold"
                >
                  + 선택지 추가
                </button>
                <div className="flex flex-wrap gap-4 pt-2 mt-1 border-t border-[var(--border)]">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pollMulti}
                      onChange={(e) => setPollMulti(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    복수 선택 허용
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pollAnonymous}
                      onChange={(e) => setPollAnonymous(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    익명 투표 (투표자 비공개)
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ③ 사진 첨부 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              🖼️ 사진 첨부 (선택)
            </div>
            <FileUploadMulti
              onFilesSelect={setPhotoFiles}
              accept={IMAGE_TYPES}
              maxSize={10}
              maxFiles={10}
              label="사진을 드래그하거나 클릭하여 선택"
              disabled={uploading}
            />
          </div>

          {/* ④ 파일 첨부 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              📎 파일 첨부 (선택)
            </div>
            <FileUploadMulti
              onFilesSelect={setDocFiles}
              accept={FILE_TYPES}
              maxSize={50}
              maxFiles={10}
              label="파일을 드래그하거나 클릭하여 선택"
              disabled={uploading}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={resetForm}
              className="px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl text-sm hover:text-[var(--text)]"
            >
              취소
            </button>
            <button
              onClick={() => savePost.mutate()}
              disabled={
                savePost.isPending ||
                uploading ||
                !form.title.trim() ||
                !form.content.trim()
              }
              className="px-5 py-2 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {uploading
                ? "첨부 업로드 중..."
                : savePost.isPending
                ? "저장 중..."
                : editing
                ? "수정 저장"
                : "등록"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">
          불러오는 중...
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
          <div className="text-4xl mb-3">📝</div>
          <div className="text-sm text-[var(--text-muted)]">
            등록된 글이 없습니다. 첫 글을 작성해보세요.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => {
            const open = openId === p.id;
            const isMine = mine(p.author_id);
            const opts = p.poll_options || [];
            const isMulti = !!p.poll_multi;
            return (
              <div
                key={p.id}
                className={`bg-[var(--bg-card)] rounded-2xl border transition ${
                  p.pinned
                    ? "border-[var(--primary)]/30"
                    : "border-[var(--border)]"
                }`}
              >
                <button
                  onClick={() => setOpenId(open ? null : p.id)}
                  className="w-full text-left px-5 py-4 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {p.pinned && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                          📌 고정
                        </span>
                      )}
                      {p.event_date && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-semibold">
                          📅 {new Date(p.event_date).toLocaleDateString("ko-KR")}
                        </span>
                      )}
                      {p.poll_question && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 font-semibold">
                          🗳️ 투표
                        </span>
                      )}
                      {(p.attachments?.length ?? 0) > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-semibold">
                          📎 {p.attachments!.length}
                        </span>
                      )}
                      <span className="text-sm font-bold text-[var(--text)] truncate">
                        {p.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      {p.author_name || p.author_email || "익명"} ·{" "}
                      {new Date(p.created_at).toLocaleString("ko-KR")}
                      {p.updated_at !== p.created_at && " (수정됨)"}
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 shrink-0 text-[var(--text-dim)] transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {open && (
                  <div className="px-5 pb-4">
                    <div className="text-sm text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed border-t border-[var(--border)] pt-3">
                      {p.content}
                    </div>

                    {/* 일정 표시 */}
                    {p.event_date && (
                      <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-blue-500/5 text-blue-500">
                        <span>📅</span>
                        <span className="font-semibold">
                          일정: {new Date(p.event_date).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                    )}

                    {/* 투표 */}
                    {p.poll_question && opts.length > 0 && (
                      <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
                        <div className="text-sm font-semibold text-[var(--text)] mb-2">
                          🗳️ {p.poll_question}
                        </div>
                        <div className="space-y-2">
                          {opts.map((opt, idx) => {
                            const count = voteCounts[idx] || 0;
                            const pct =
                              totalVotes > 0
                                ? Math.round((count / totalVotes) * 100)
                                : 0;
                            const voted = myVotes.includes(idx);
                            return (
                              <button
                                key={idx}
                                onClick={() =>
                                  castVote.mutate({
                                    postId: p.id,
                                    optionIndex: idx,
                                    multi: isMulti,
                                  })
                                }
                                disabled={castVote.isPending}
                                className={`w-full text-left relative overflow-hidden rounded-lg border px-3 py-2 transition ${
                                  voted
                                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                                    : "border-[var(--border)] hover:border-[var(--primary)]/40"
                                }`}
                              >
                                <div
                                  className="absolute inset-y-0 left-0 bg-[var(--primary)]/10"
                                  style={{ width: `${pct}%` }}
                                />
                                <div className="relative flex items-center justify-between text-xs">
                                  <span className="text-[var(--text)] font-medium">
                                    {voted && "✓ "}
                                    {opt}
                                  </span>
                                  <span className="text-[var(--text-muted)]">
                                    {count}표 · {pct}%
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-2">
                          총 {totalVotes}표 · {isMulti ? "복수 선택 가능" : "1인 1표 (변경 가능)"}
                          {p.poll_anonymous && " · 🔒 익명"}
                        </div>
                      </div>
                    )}

                    {/* 첨부 (사진/파일) */}
                    {(p.attachments?.length ?? 0) > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                          첨부 {p.attachments!.length}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {p.attachments!.map((a, i) =>
                            isImage(a.type) ? (
                              <a
                                key={i}
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={a.url}
                                  alt={a.name}
                                  className="w-24 h-24 object-cover rounded-lg border border-[var(--border)]"
                                />
                              </a>
                            ) : (
                              <a
                                key={i}
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--primary)]/40 transition"
                              >
                                <span>📎</span>
                                <span className="max-w-[160px] truncate">
                                  {a.name}
                                </span>
                              </a>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 mt-3 flex-wrap">
                      {canPin && (
                        <button
                          onClick={() => togglePin.mutate(p)}
                          className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                        >
                          {p.pinned ? "고정 해제" : "📌 상단 고정"}
                        </button>
                      )}
                      {(isMine || canPin) && (
                        <>
                          <button
                            onClick={() => {
                              setEditing(p);
                              setForm({ title: p.title, content: p.content });
                              setEventDate(p.event_date || "");
                              setPollQuestion(p.poll_question || "");
                              setPollOptions(
                                p.poll_options && p.poll_options.length >= 2
                                  ? p.poll_options
                                  : ["", ""]
                              );
                              setPollMulti(!!p.poll_multi);
                              setPollAnonymous(!!p.poll_anonymous);
                              setPhotoFiles([]);
                              setDocFiles([]);
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] transition"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("이 글을 삭제하시겠습니까?"))
                                delPost.mutate(p.id);
                            }}
                            className="text-xs px-3 py-1.5 text-red-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>

                    {/* 댓글 */}
                    <div className="mt-4 border-t border-[var(--border)] pt-3">
                      <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                        댓글 {comments.length}
                      </div>
                      <div className="space-y-2 mb-3">
                        {comments.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <div className="flex-1 min-w-0 bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                              <div className="text-[11px] text-[var(--text-dim)] mb-0.5">
                                {c.author_name || "익명"} ·{" "}
                                {new Date(c.created_at).toLocaleString("ko-KR")}
                              </div>
                              <div className="text-[var(--text)] whitespace-pre-wrap">
                                {c.content}
                              </div>
                            </div>
                            {(mine(c.author_id) || canPin) && (
                              <button
                                onClick={() => delComment.mutate(c.id)}
                                className="text-[var(--text-dim)] hover:text-red-400 text-xs shrink-0 mt-1"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        {comments.length === 0 && (
                          <div className="text-xs text-[var(--text-dim)]">
                            첫 댓글을 남겨보세요.
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={commentDraft[p.id] || ""}
                          onChange={(e) =>
                            setCommentDraft((s) => ({
                              ...s,
                              [p.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              addComment.mutate(p.id);
                            }
                          }}
                          placeholder="댓글 입력 후 Enter"
                          className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                        />
                        <button
                          onClick={() => addComment.mutate(p.id)}
                          disabled={
                            addComment.isPending ||
                            !(commentDraft[p.id] || "").trim()
                          }
                          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                          등록
                        </button>
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

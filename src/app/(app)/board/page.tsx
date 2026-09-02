"use client";
import { kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

import type { ReactNode } from "react";
import { DateTimeField } from "@/components/datetime-field";
import { DateField } from "@/components/date-field";
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertStorageQuotaMany } from "@/lib/storage-quota";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { useToast } from "@/components/toast";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, QuickSearch, quickSearchHit, ConditionPanel, ConditionRow, TokenField,
  AppliedChips, ResultStrip, Stat, RowsPerPage, Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
import { FileUploadMulti } from "@/components/file-upload-multi";
import { RichEditor } from "@/components/rich-editor";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { MentionDropdown } from "@/components/mention-dropdown";
import { getCompanyUsers } from "@/lib/queries";
import { friendlyError } from "@/lib/friendly-error";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase;

type MentionUser = { id: string; name: string | null; email: string };

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
  poll_deadline?: string | null; // v4 B2
  attachments?: Attachment[] | null;
  category?: string | null; // 결정 147(드팜므 문의) — 공지/매뉴얼/교육자료/자유, null=미분류(옛 글)
};

//   카테고리 — 사내 매뉴얼 저장소 요구(결정 147). 회사별 사전은 2차, 지금은 고정 4종
const POST_CATS = ["공지", "매뉴얼", "교육자료", "자유"] as const;
type Comment = {
  id: string;
  post_id: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
  // v4 B1
  parent_comment_id?: string | null;
  mentioned_user_ids?: string[] | null;
  attachments?: Attachment[] | null;
};

const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";
const FILE_TYPES =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain,application/zip,application/x-zip-compressed";

const BOARD_BUCKET = "board-files";

function isImage(type: string) {
  return type.startsWith("image/");
}

// ── 서식 본문 (2026-07-31 사장님: 글 작성에 서식 추가) ──
//   새 글은 RichEditor HTML 로 저장, 기존 글은 평문 그대로 — 렌더 시 둘을 구분한다
//   (approvals 의 description 처리와 동일 규칙).
const isHtmlContent = (s?: string | null) => !!s && /^\s*</.test(String(s).trim());

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 평문(기존 글) → RichEditor 초기값 HTML. 이미 HTML 이면 그대로. */
function plainToHtml(text: string): string {
  if (!text) return "";
  if (isHtmlContent(text)) return text;
  return text.split("\n").map((line) => (line.trim() === "" ? "<p><br/></p>" : `<p>${escapeHtmlText(line)}</p>`)).join("");
}

/** RichEditor 빈 문서(<p></p> 등) 판별 — 텍스트·이미지·표 전부 없으면 빈 것 */
function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  if (/<(img|table)/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/** 검색용 — HTML 태그를 걷어내고 텍스트만 */
function stripHtml(s: string): string {
  return isHtmlContent(s) ? s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : s;
}

export default function BoardPage() {
  const { user, role } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const companyId = user?.company_id ?? null;
  // 상단 고정·해제는 마스터(또는 '/board:pin' 위임자)만 — 아무나 남의 글까지 고정·해제하던 문제
  //   (2026-08-05 사장님). 화면 게이트와 별개로 DB 트리거에서도 강제한다.
  const { isMaster, hasPerm } = useMyPermissions();
  const canPin = role !== "partner" && (isMaster || hasPerm("/board:pin"));

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState({ title: "", content: "" });
  const [postCat, setPostCat] = useState<string>(""); // "" = 미분류
  const [openId, setOpenId] = useState<string | null>(null);
  //   ?post=<id> 로 들어오면 그 글을 바로 펼친다 — 메신저에서 붙인 게시판 링크가 여기로 온다
  //   (2026-08-10). useSearchParams 대신 주소를 직접 읽는다 — 이 페이지엔 Suspense 경계가 없다.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("post");
      if (p) setOpenId(p);
    } catch { /* 무시 */ }
  }, []);
  // 플렉스/슬랙식 2단 — 좌측 필터/검색
  //   보기(전체/내 글)는 조회 줄, 종류·작성자·기간은 검색조건 (2026-08-18 규칙: 값 필터는 검색조건)
  const [view, setView] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  type BCond = { kinds: string[]; cats: string[]; authors: string[]; from: string; to: string; rows: number };
  const BEMPTY: BCond = { kinds: [], cats: [], authors: [], from: "", to: "", rows: 50 };
  const [panelOpen, setPanelOpen] = useState(false);
  const [bDraft, setBDraft] = useState<BCond>(BEMPTY);
  const [bLive, setBLive] = useState<BCond>(BEMPTY);
  const bCount = (c: BCond) => c.kinds.length + c.cats.length + c.authors.length + ((c.from || c.to) ? 1 : 0);
  type BSort = "title" | "author" | "created";
  const [bSort, setBSort] = useState<SortState<BSort>>({ key: "created", dir: "desc" });
  const onBSort = (k: BSort) => setBSort((c) => nextSort(c, k));
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("board-colw-v1", { title: 560, author: 140, created: 170 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  // 사진 첨부 라이트박스 (팝업 보기 + 넘기기 + 드래그)
  const [lightbox, setLightbox] = useState<{ images: { url: string; name: string }[]; index: number } | null>(null);
  // 댓글 사진 첨부 (draftKey별 업로드된 첨부 목록)
  const [commentFiles, setCommentFiles] = useState<Record<string, Attachment[]>>({});
  const [commentUploadingKey, setCommentUploadingKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  // v4 B1: 멘션 자동완성 상태 — postId 또는 reply key 별로 분리
  // key = root: postId, reply key: `reply:${parentCommentId}`
  const [mentionQuery, setMentionQuery] = useState<{ key: string; q: string } | null>(null);
  const [draftMentions, setDraftMentions] = useState<Record<string, string[]>>({});
  // v4 B1: 답글 — 현재 reply 입력 펼친 root comment id 와 그 draft 본문
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});

  // 작업2 — 확장 입력 상태
  const [eventDate, setEventDate] = useState<string>("");
  const [pollQuestion, setPollQuestion] = useState<string>("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState<boolean>(false);       // R13: 복수 선택 허용
  const [pollAnonymous, setPollAnonymous] = useState<boolean>(false); // R14: 익명 투표
  const [pollDeadline, setPollDeadline] = useState<string>("");      // v4 B2: 투표 마감 (datetime-local)
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // v4 B1: 회사 사용자 목록 (멘션 자동완성용)
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["board-mention-users", companyId],
    queryFn: async () => {
      const list = await getCompanyUsers(companyId!);
      return (list || []).map((u: any) => ({ id: u.id, name: u.name, email: u.email })) as MentionUser[];
    },
    enabled: !!companyId,
  });

  // v4 B1: 알림 라우팅용 — URL ?id= 가 있으면 자동 펼침
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("id");
    if (id) setOpenId(id);
  }, []);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["board-posts", companyId],
    queryFn: async () => {
      const data = logRead('board/page:data', await db
        .from("board_posts")
        .select("*")
        .eq("company_id", companyId!)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }));
      return (data || []) as Post[];
    },
    enabled: !!companyId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["board-comments", openId],
    queryFn: async () => {
      const data = logRead('board/page:data', await db
        .from("board_comments")
        .select("*")
        .eq("post_id", openId!)
        .order("created_at", { ascending: true }));
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
      // 실명 폴이면 RPC 가 옵션별 voter_user_ids 를 함께 준다 — 이걸 버리면
      //   실명으로 만들어도 화면상 익명처럼 보인다 (2026-08-05 사장님 제보).
      const voterIds: Record<number, string[]> = {};
      try {
        const { data, error } = await db.rpc("get_poll_results", { p_post_id: openId as string });
        if (error) throw error;
        let total = 0;
        for (const r of (data || []) as any[]) {
          const k = Number(r.option_index);
          counts[k] = Number(r.vote_count || 0);
          total += Number(r.vote_count || 0);
          if (Array.isArray(r.voter_user_ids)) voterIds[k] = r.voter_user_ids as string[];
        }
        return { counts, total, voterIds };
      } catch {
        const data = logRead('board/page:data', await db
          .from("board_poll_votes")
          .select("option_index")
          .eq("post_id", openId!));
        for (const v of (data || []) as any[]) {
          const k = Number(v.option_index);
          counts[k] = (counts[k] || 0) + 1;
        }
        return { counts, total: (data || []).length, voterIds };
      }
    },
    enabled: !!openId,
  });
  const voteCounts: Record<number, number> = pollAgg?.counts ?? {};
  const totalVotes = pollAgg?.total ?? 0;
  const voterIdsByOption: Record<number, string[]> = useMemo(() => pollAgg?.voterIds ?? {}, [pollAgg]);

  // 실명 폴의 투표자 이름 — RPC 가 준 user_id 를 회사 구성원 이름으로 바꾼다.
  const voterIdList = useMemo(
    () => Array.from(new Set(Object.values(voterIdsByOption).flat())),
    [voterIdsByOption],
  );
  // 회사 구성원 — 투표 현황 팝업의 '항목별 투표자'와 '미참여 멤버'를 만든다.
  const { data: companyMembers = [] } = useQuery({
    queryKey: ["board-company-members", companyId],
    queryFn: async () => {
      const data = logRead('board/page:members', await db
        .from("users").select("id, name, email").eq("company_id", companyId!).order("name"));
      return (data || []) as { id: string; name: string | null; email: string | null }[];
    },
    enabled: !!companyId,
  });
  const voterNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of companyMembers) map[u.id] = u.name || u.email || "이름 없음";
    // 목록에 없는(퇴사 등) 투표자도 자리는 지킨다
    for (const id of voterIdList) if (!map[id]) map[id] = "알 수 없음";
    return map;
  }, [companyMembers, voterIdList]);

  // 투표 현황 팝업 (2026-08-06 사장님 시안) — 본문에는 투표자를 노출하지 않고 여기서만 본다.
  const [pollStatusPost, setPollStatusPost] = useState<Post | null>(null);

  // 내 표 — 본인 행만 조회(익명이어도 본인 선택 표시는 가능, RLS 본인범위).
  const { data: myVotes = [] } = useQuery({
    queryKey: ["board-my-poll-votes", openId, user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as number[];
      const data = logRead('board/page:data', await db
        .from("board_poll_votes")
        .select("option_index")
        .eq("post_id", openId!)
        .eq("user_id", user.id));
      return ((data || []) as any[]).map((v) => Number(v.option_index));
    },
    enabled: !!openId && !!user?.id,
  });

  const resetForm = () => {
    setForm({ title: "", content: "" });
    setPostCat("");
    setEditing(null);
    setShowForm(false);
    setEventDate("");
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollMulti(false);
    setPollAnonymous(false);
    setPollDeadline("");
    setPhotoFiles([]);
    setDocFiles([]);
  };

  // Supabase Storage 업로드 (file-storage.ts 와 동일 경로 규칙: {companyId}/board/{ts}_{rand}.{ext})
  async function uploadAttachments(files: File[]): Promise<Attachment[]> {
    const out: Attachment[] = [];
    await assertStorageQuotaMany(companyId, files); // 회사 저장공간 한도 — 합계로 1회 (2026-09-02)
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

  // RichEditor 본문 삽입 이미지 — dataURL 인라인 대신 board-files 스토리지 업로드
  //   (본문이 DB text 컬럼이라 대용량 dataURL 이 그대로 저장되는 것 방지)
  async function uploadEditorImage(file: File): Promise<string> {
    const ext = file.name.split(".").pop() || "png";
    const storagePath = `${companyId}/board/editor/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const { error } = await supabase.storage.from(BOARD_BUCKET).upload(storagePath, file);
    if (error) throw error;
    return supabase.storage.from(BOARD_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }

  const savePost = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || isEmptyHtml(form.content))
        throw new Error("제목과 내용을 입력하세요.");
      // 수정은 작성자 본인만 (2026-07-31 사장님) — 버튼 노출 조건과 이중 방어
      if (editing && editing.author_id !== user?.id)
        throw new Error("작성자 본인만 수정할 수 있습니다.");

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
        category: postCat || null,
        event_date: eventDate || null,
        poll_question: pollQuestion.trim() || null,
        poll_options: pollQuestion.trim() ? cleanPollOptions : [],
        poll_multi: pollQuestion.trim() ? pollMulti : false,
        poll_anonymous: pollQuestion.trim() ? pollAnonymous : false,
        // v4 B2: 투표 기한. datetime-local → ISO. 비우면 NULL (무제한).
        poll_deadline:
          pollQuestion.trim() && pollDeadline
            ? new Date(pollDeadline).toISOString()
            : null,
        attachments,
      };

      if (editing) {
        // 수정 시: 기존 첨부 유지 + 신규 추가
        const merged = [...(editing.attachments || []), ...attachments];
        const { error } = await db
          .from("board_posts")
          .update({
            title: form.title.trim(),
            content: form.content,
            updated_at: new Date().toISOString(),
            ...ext,
            attachments: merged,
          })
          .eq("id", editing.id)
          .eq("author_id", user!.id);
        if (error) throw error;
      } else {
        const { data: created, error } = await db.from("board_posts").insert({
          company_id: companyId as string,
          author_id: user?.id || null,
          author_name: user?.name || null,
          author_email: user?.email || null,
          title: form.title.trim(),
          content: form.content,
          ...ext,
        }).select("id").single();
        if (error) throw error;

        // 새 글 알림 — 회사 전원에게 (2026-08-06 사장님 요청: "누가 무슨 제목의 글을
        //   게시판에 등록했다는 알림"). 오너뷰 안의 알림만, 메일은 보내지 않는다.
        //   entity_type=board_post 라 알림을 누르면 그 글로 바로 열린다(notification-routes).
        //   작성자 본인은 제외. 실패해도 글 등록은 이미 끝났으므로 막지 않는다.
        try {
          const members = logRead('board/page:notify-members', await db
            .from("users").select("id").eq("company_id", companyId as string));
          const rows = (members || [])
            .map((m: { id: string }) => m.id)
            .filter((id: string) => id && id !== user?.id)
            .map((id: string) => ({
              company_id: companyId as string,
              user_id: id,
              type: "board_post",
              title: `새 게시글: ${form.title.trim()}`,
              message: `${user?.name || user?.email || "누군가"}님이 글을 등록했습니다.`,
              entity_type: "board_post",
              entity_id: (created as { id: string }).id,
              is_read: false,
            }));
          if (rows.length > 0) await db.from("notifications").insert(rows);
        } catch { /* 알림 실패가 글 등록을 되돌리지 않는다 */ }
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
      // 삭제는 작성자 본인만 (2026-07-31 사장님) — 버튼 노출 조건과 이중 방어
      if (!user?.id) throw new Error("작성자 본인만 삭제할 수 있습니다.");
      // 첨부 경로를 먼저 확보 (행이 사라지면 못 찾는다). 삭제가 성공한 뒤에 파일을 지운다.
      //   종전엔 행만 지워 사진·문서가 board-files 에 영구히 남았다 (2026-08-20 감사).
      const doomed = (posts as Post[]).find((p) => p.id === id);
      const { error } = await db
        .from("board_posts")
        .delete()
        .eq("id", id)
        .eq("author_id", user.id);
      if (error) throw error;
      const paths = (doomed?.attachments || [])
        .map((a) => String(a?.url || "").match(/\/object\/(?:public|sign|authenticated)\/board-files\/([^?]+)/))
        .filter(Boolean)
        .map((m) => decodeURIComponent((m as RegExpMatchArray)[1]));
      if (paths.length > 0) await db.storage.from("board-files").remove(paths).catch(() => {});
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
    onError: (e: any) =>
      // DB 트리거가 권한 없는 고정을 막으면 42501 — 원문 대신 안내 문구로
      toast(
        e?.code === "42501" || String(e?.message || "").includes("관리자만")
          ? "게시글 상단 고정·해제는 관리자만 할 수 있습니다."
          : "고정 실패: " + (e?.message || ""),
        "error",
      ),
  });

  // v4 B1: 댓글/답글 통합 — parentCommentId 가 있으면 답글, 없으면 root 댓글.
  //   멘션 알림: mentioned_user_ids 가 비어있지 않으면 notifications 일괄 INSERT (본인 제외).
  //   type='chat' (notifications_type_check enum 안 — 'mention' 신규 추가 X).
  const addComment = useMutation({
    mutationFn: async ({
      postId,
      parentCommentId,
    }: {
      postId: string;
      parentCommentId: string | null;
    }) => {
      const draftKey = parentCommentId ? `reply:${parentCommentId}` : postId;
      const text = parentCommentId
        ? (replyDraft[parentCommentId] || "").trim()
        : (commentDraft[postId] || "").trim();
      const commentAtts = commentFiles[draftKey] || [];
      if (!text && commentAtts.length === 0) throw new Error("댓글 내용이나 사진을 입력하세요.");
      // 드롭다운 선택 id + 본문에 직접 타이핑한 @이름 도 매칭 (멘션 알림 누락 방지)
      const textIds = companyUsers
        .filter((u) => { const n = u.name || u.email; return n && text.includes(`@${n}`); })
        .map((u) => u.id);
      const allMentioned = Array.from(new Set([...(draftMentions[draftKey] || []), ...textIds]));
      const mentioned = allMentioned.filter(
        (uid) => uid && uid !== user?.id, // 본인 멘션은 알림 대상 아님
      );
      const { data: inserted, error } = await db
        .from("board_comments")
        .insert({
          post_id: postId,
          company_id: companyId as string,
          author_id: user?.id || null,
          author_name: user?.name || user?.email || null,
          content: text,
          parent_comment_id: parentCommentId,
          mentioned_user_ids: allMentioned,
          attachments: commentAtts,
        })
        .select("id")
        .single();
      if (error) throw error;

      // 멘션 알림 INSERT (실패해도 댓글 자체는 성공 — best-effort)
      if (mentioned.length > 0) {
        const post = posts.find((p) => p.id === postId);
        const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
        const rows = mentioned.map((uid) => ({
          company_id: companyId as string,
          user_id: uid,
          type: "chat" as const,
          title: "게시판 멘션",
          message: `${user?.name || user?.email || "누군가"} 님이 「${post?.title || "게시글"}」에서 회원님을 멘션했습니다: ${preview}`,
          entity_type: "board_post",
          entity_id: postId,
          is_read: false,
        }));
        const { error: notifErr } = await db.from("notifications").insert(rows);
        if (notifErr) {
          // best-effort: 콘솔이 아닌 sentry 라인은 friendlyError 영역 — 토스트 X
          // (댓글은 이미 들어갔으므로 사용자엔 성공으로 보여야 함)
        }
      }

      // 글 작성자 알림 — 댓글이 달리면 게시글 작성자에게 (본인 댓글 제외 · 이미 멘션 알림 받은 경우 중복 방지)
      {
        const post = posts.find((p) => p.id === postId);
        const authorId = post?.author_id;
        if (authorId && authorId !== user?.id && !mentioned.includes(authorId)) {
          const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
          await db.from("notifications").insert({
            company_id: companyId as string,
            user_id: authorId,
            type: "chat" as const,
            title: "내 게시글에 새 댓글",
            message: `${user?.name || user?.email || "누군가"} 님이 「${post?.title || "게시글"}」에 댓글을 남겼습니다: ${preview}`,
            entity_type: "board_post",
            entity_id: postId,
            is_read: false,
          }); // best-effort — 실패해도 댓글 자체는 성공
        }
      }

      // 대댓글 알림 — 내 댓글에 답글이 달리면 원 댓글 작성자에게 (본인·멘션·글작성자와 중복 제외)
      if (parentCommentId) {
        const parent = logRead('board/page:parent', await db.from("board_comments").select("author_id").eq("id", parentCommentId).maybeSingle());
        const parentAuthorId = parent?.author_id as string | undefined;
        const postAuthorId = posts.find((p) => p.id === postId)?.author_id;
        if (parentAuthorId && parentAuthorId !== user?.id && !mentioned.includes(parentAuthorId) && parentAuthorId !== postAuthorId) {
          const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
          await db.from("notifications").insert({
            company_id: companyId as string,
            user_id: parentAuthorId,
            type: "chat" as const,
            title: "내 댓글에 답글",
            message: `${user?.name || user?.email || "누군가"} 님이 회원님의 댓글에 답글을 남겼습니다: ${preview}`,
            entity_type: "board_post",
            entity_id: postId,
            is_read: false,
          }); // best-effort
        }
      }

      return { postId, parentCommentId, draftKey, insertedId: inserted?.id };
    },
    onSuccess: (res) => {
      const { postId, parentCommentId, draftKey } = res as any;
      setCommentFiles((s) => { const n = { ...s }; delete n[draftKey]; return n; });
      if (parentCommentId) {
        setReplyDraft((s) => ({ ...s, [parentCommentId]: "" }));
        setReplyTo(null);
      } else {
        setCommentDraft((s) => ({ ...s, [postId]: "" }));
      }
      setDraftMentions((s) => ({ ...s, [draftKey]: [] }));
      qc.invalidateQueries({ queryKey: ["board-comments"] });
    },
    onError: (e: any) => toast(friendlyError(e, "댓글 등록 실패"), "error"),
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

  // 투표 — 옵션 클릭은 '선택'까지만, 확인 버튼을 눌러야 서버에 반영한다
  //   (2026-08-05 사장님 제보: 누르는 즉시 투표돼 오투표가 났다).
  //   pendingVote: 아직 제출 안 한 선택. null 이면 내 기존 표(myVotes)를 그대로 표시.
  const [pendingVote, setPendingVote] = useState<{ postId: string; options: number[] } | null>(null);
  const pickOption = (postId: string, optionIndex: number, multi: boolean) => {
    setPendingVote((prev) => {
      const base = prev && prev.postId === postId ? prev.options : myVotes;
      if (!multi) return { postId, options: [optionIndex] };
      const next = base.includes(optionIndex)
        ? base.filter((i) => i !== optionIndex)
        : [...base, optionIndex];
      return { postId, options: next };
    });
  };

  // 확정 저장 — onConflict 미사용(구 (post_id,user_id) / 신 (post_id,user_id,
  //   option_index) UNIQUE 양쪽에서 안전). 선택한 옵션 집합으로 통째 교체.
  const castVote = useMutation({
    mutationFn: async ({ postId, optionIndexes }: { postId: string; optionIndexes: number[] }) => {
      if (!user?.id) throw new Error("로그인이 필요합니다.");
      await db.from("board_poll_votes").delete().eq("post_id", postId).eq("user_id", user.id);
      if (optionIndexes.length === 0) return; // 전체 해제 = 기권
      const { error } = await db.from("board_poll_votes").insert(
        optionIndexes.map((optionIndex) => ({
          post_id: postId,
          company_id: companyId as string,
          user_id: user.id,
          option_index: optionIndex,
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board-poll-results"] });
      qc.invalidateQueries({ queryKey: ["board-my-poll-votes"] });
      setPendingVote(null);
      toast("투표 완료", "success");
    },
    onError: (e: any) => toast("투표 실패: " + (e?.message || ""), "error"),
  });

  const mine = (authorId: string | null) =>
    authorId && authorId === user?.id;

  const setOption = (idx: number, val: string) =>
    setPollOptions((o) => o.map((x, i) => (i === idx ? val : x)));

  // ── v4 B1 helpers ────────────────────────────────────────────────
  // 댓글 본문 안의 @이름 패턴을 chip 으로 변환해 렌더.
  //   companyUsers.name + email 을 후보로 비교(긴 매칭 우선).
  function renderMentionContent(text: string) {
    if (!text) return null;
    // 후보를 길이 내림차순으로 정렬 (긴 이름 우선 매칭)
    const names = companyUsers
      .flatMap((u) => [u.name, u.email].filter(Boolean) as string[])
      .filter((n, i, a) => a.indexOf(n) === i)
      .sort((a, b) => b.length - a.length);
    if (names.length === 0) return text;
    // 정규식 이스케이프
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@(${names.map(esc).join("|")})`, "g");
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        <span
          key={`m${key++}`}
          className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--info-dim)] text-[var(--info)] text-[12px] font-semibold mx-0.5"
        >
          @{m[1]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // textarea/input 변경 시 @멘션 트리거 감지.
  function handleMentionChange(
    key: string,
    el: HTMLTextAreaElement | HTMLInputElement,
  ) {
    const val = el.value;
    const cursorPos = el.selectionStart ?? val.length;
    const before = val.slice(0, cursorPos);
    const match = before.match(/@([\w가-힣]*)$/);
    if (match && companyUsers.length > 0) {
      setMentionQuery({ key, q: match[1] });
    } else {
      setMentionQuery((m) => (m && m.key === key ? null : m));
    }
  }

  function handleMentionSelect(key: string, u: MentionUser) {
    const el = inputRefs.current[key];
    const isReply = key.startsWith("reply:");
    const targetVal = isReply
      ? replyDraft[key.slice("reply:".length)] || ""
      : commentDraft[key] || "";
    const cursorPos = el?.selectionStart ?? targetVal.length;
    const before = targetVal.slice(0, cursorPos);
    const after = targetVal.slice(cursorPos);
    const display = u.name || u.email;
    const newBefore = before.replace(/@[\w가-힣]*$/, `@${display} `);
    const newText = newBefore + after;
    if (isReply) {
      const parentId = key.slice("reply:".length);
      setReplyDraft((s) => ({ ...s, [parentId]: newText }));
    } else {
      setCommentDraft((s) => ({ ...s, [key]: newText }));
    }
    setDraftMentions((s) => ({
      ...s,
      [key]: Array.from(new Set([...(s[key] || []), u.id])),
    }));
    setMentionQuery(null);
    setTimeout(() => el?.focus(), 0);
  }

  // 댓글 트리 — root + replies map.
  const { rootComments, replyMap } = useMemo(() => {
    const roots: Comment[] = [];
    const map: Record<string, Comment[]> = {};
    for (const c of comments) {
      if (!c.parent_comment_id) {
        roots.push(c);
      } else {
        (map[c.parent_comment_id] = map[c.parent_comment_id] || []).push(c);
      }
    }
    return { rootComments: roots, replyMap: map };
  }, [comments]);

  // 투표 마감 — 클라이언트 시각 기준. 서버측은 RLS 제약 X (B2 마이그 명시).
  function pollExpiry(deadline?: string | null): {
    expired: boolean;
    label: string | null;
  } {
    if (!deadline) return { expired: false, label: null };
    const dl = new Date(deadline).getTime();
    const now = Date.now();
    if (Number.isNaN(dl)) return { expired: false, label: null };
    if (now >= dl) return { expired: true, label: "마감됨" };
    const diff = dl - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor(diff / (1000 * 60));
    if (days >= 1) return { expired: false, label: `D-${days}` };
    if (hours >= 1) return { expired: false, label: `마감 ${hours}시간 전` };
    return { expired: false, label: `마감 ${Math.max(1, mins)}분 전` };
  }

  // HR 서비스식 필터 + 검색
  const KINDS = [{ key: "pinned", label: "고정" }, { key: "event", label: "일정" }, { key: "poll", label: "투표" }, { key: "file", label: "첨부" }];
  const authorOf = (p: any) => p.author_name || p.author_email || "익명";
  const kindHit = (p: any, k: string) => k === "pinned" ? !!p.pinned : k === "event" ? !!p.event_date : k === "poll" ? !!p.poll_question : k === "file" ? (p.attachments?.length ?? 0) > 0 : true;
  const bHit = (p: any, c: BCond) => {
    if (c.kinds.length && !c.kinds.some((k) => kindHit(p, k))) return false;
    if (c.cats.length && !c.cats.includes(p.category || "")) return false;
    if (c.authors.length && !c.authors.includes(authorOf(p))) return false;
    const d = String(p.created_at || "").slice(0, 10);
    if (c.from && d < c.from) return false;
    if (c.to && d > c.to) return false;
    return true;
  };
  const filteredPosts = posts.filter((p) => {
    if (view === "mine" && p.author_id !== user?.id) return false;
    if (!bHit(p, bLive)) return false;
    if (!quickSearchHit(search, [p.title, stripHtml(p.content), authorOf(p)])) return false;
    return true;
  }).sort((a, b) => {
    //   고정 글은 항상 위, 그 안에서 정렬
    const d = bSort.dir === "asc" ? 1 : -1;
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin) return pin;
    if (bSort.key === "title") return cmp(a.title || "", b.title || "") * d;
    if (bSort.key === "author") return cmp(authorOf(a), authorOf(b)) * d;
    return cmp(String(a.created_at || ""), String(b.created_at || "")) * d;
  });
  const pager = usePager(filteredPosts, bLive.rows, `${view}|${search}|${JSON.stringify(bLive)}|${JSON.stringify(bSort)}`);
  const authorOpts = [...new Set(posts.map(authorOf))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v }));
  const bDrop = (patch: Partial<BCond>) => { const c = { ...bLive, ...patch }; setBLive(c); setBDraft(c); };
  const bChips: AppliedChip[] = [
    ...(search ? [{ group: "빠른검색", label: search, onRemove: () => setSearch("") }] : []),
    ...bLive.kinds.map((k) => ({ group: "종류", label: KINDS.find((x) => x.key === k)?.label || k, onRemove: () => bDrop({ kinds: bLive.kinds.filter((x) => x !== k) }) })),
    ...bLive.cats.map((k) => ({ group: "카테고리", label: k || "미분류", onRemove: () => bDrop({ cats: bLive.cats.filter((x) => x !== k) }) })),
    ...bLive.authors.map((a) => ({ group: "작성자", label: a, onRemove: () => bDrop({ authors: bLive.authors.filter((x) => x !== a) }) })),
    ...((bLive.from || bLive.to) ? [{ group: "기간", label: `${bLive.from || "처음"} ~ ${bLive.to || "오늘"}`, onRemove: () => bDrop({ from: "", to: "" }) }] : []),
  ];

  // 글쓰기/수정 모달 — ESC 닫기, Enter 저장(제목·내용 미입력·업로드/저장 중엔 비활성)
  const canSavePost =
    !savePost.isPending && !uploading && !!form.title.trim() && !isEmptyHtml(form.content);
  useModalKeys(showForm, resetForm, canSavePost ? () => savePost.mutate() : undefined);

  return (
    <div className="qk-shell">
      <QueryScreen>
      <QueryHead>
      {/* 조회 줄 — 2026-08-18 조회 표준: [검색조건(종류·작성자·기간·줄 수) ▾ · 빠른검색 · 보기(전체/내 글)] ‖ + 글쓰기 */}
        <QueryBar right={!showForm ? (
          <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm">+ 글쓰기</button>
        ) : undefined}>
          <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setBDraft(bLive); setPanelOpen(v); }} activeCount={bCount(bLive)}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={bCount(bDraft) === 0} onClick={() => setBDraft({ ...BEMPTY, rows: bDraft.rows })}>조건 지우기</button>
              <span className="ml-auto text-[11px] text-[var(--text-dim)]">{posts.filter((p) => bHit(p, bDraft)).length}건</span>
              <RowsPerPage value={bDraft.rows} onChange={(n) => setBDraft((c) => ({ ...c, rows: n }))} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setBLive(bDraft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="종류" hint="여러 개 · 하나라도 맞으면">
              <span className="qk-quicks">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => setBDraft((c) => ({ ...c, kinds: c.kinds.includes(k.key) ? c.kinds.filter((x) => x !== k.key) : [...c.kinds, k.key] }))}
                    className={bDraft.kinds.includes(k.key) ? "qk-quick qk-quick-on" : "qk-quick"}>{k.label}</button>
                ))}
              </span>
            </ConditionRow>
            <ConditionRow label="카테고리" hint="여러 개 · 매뉴얼만 골라 보기">
              <span className="qk-quicks">
                {[...POST_CATS, ""].map((k) => (
                  <button key={k || "none"} type="button"
                    onClick={() => setBDraft((c) => ({ ...c, cats: c.cats.includes(k) ? c.cats.filter((x) => x !== k) : [...c.cats, k] }))}
                    className={bDraft.cats.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{k || "미분류"}</button>
                ))}
              </span>
            </ConditionRow>
            <ConditionRow label="작성자" hint="여러 명">
              <TokenField items={authorOpts} value={bDraft.authors} onChange={(v) => setBDraft((c) => ({ ...c, authors: v }))} placeholder="이름 일부" />
            </ConditionRow>
            <ConditionRow label="기간" hint="비우면 전체">
              <DateRangeField label={null} from={bDraft.from} to={bDraft.to} onChange={(f, t) => setBDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setBDraft((c) => ({ ...c, from: "", to: "" }))} />
            </ConditionRow>
          </ConditionPanel>
          <QuickSearch value={search} onApply={setSearch} placeholder="제목 · 내용 · 작성자 — 쉼표로 여러 개, Enter" />
          <ChipGroup value={view} onChange={setView} options={[{ value: "all", label: "전체" }, { value: "mine", label: "내 글" }] as const} />
        </QueryBar>
        <AppliedChips chips={bChips} onClearAll={() => { setSearch(""); setBLive(BEMPTY); setBDraft(BEMPTY); setView("all"); }} />
        <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{filteredPosts.length}</b>건</span>}>
          <Stat label="글" value={`${posts.length}건`} />
          <Stat label="고정" value={`${posts.filter((p) => p.pinned).length}건`} />
          <Stat label="투표" value={`${posts.filter((p) => p.poll_question).length}건`} />
          <Stat label="첨부" value={`${posts.filter((p) => (p.attachments?.length ?? 0) > 0).length}건`} />
        </ResultStrip>
      </QueryHead>

      {showForm && (
        <div className="board-post-form-overlay fixed inset-0">
        <div className="board-post-form-modal glass-card" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold">
              {editing ? "글 수정" : "새 글 작성"}
            </h3>
            <button onClick={resetForm} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-lg" aria-label="닫기">×</button>
          </div>
          <div className="flex gap-2">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="제목"
              className="field-input flex-1"
            />
            {/* 카테고리(결정 147) — 매뉴얼·교육자료를 골라 볼 수 있게. 한 줄 셀렉트 표준 */}
            <select value={postCat} onChange={(e) => setPostCat(e.target.value)}
              className="field-input !w-32 flex-none" aria-label="카테고리" title="카테고리 — 검색조건에서 골라 볼 수 있습니다">
              <option value="">미분류</option>
              {POST_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* 본문 — 서식 편집기 (2026-07-31 사장님: 작성칸 확대 + 서식). 기존 평문 글은 plainToHtml 로 초기화 */}
          <div className="board-content-editor">
            <RichEditor
              content={form.content}
              onChange={(html) => setForm((f) => ({ ...f, content: html }))}
              placeholder="내용"
              maxHeight="46vh"
              onUploadImage={uploadEditorImage}
            />
          </div>

          {/* ① 일정 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              <Ico e="📅" /> 일정 (선택)
            </div>
            <DateField
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>

          {/* ② 투표 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
              <Ico e="🗳" /> 투표 (선택)
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
                        className="px-2 text-[var(--text-dim)] hover:text-[var(--danger)]"
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
                {/* v4 B2: 투표 마감 */}
                <div className="mt-2 pt-2 border-t border-[var(--border)]">
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">
                    ⏰ 투표 마감 (선택) — 비우면 무제한
                  </label>
                  <DateTimeField
                    value={pollDeadline}
                    onChange={(e) => setPollDeadline(e.target.value)}
                    className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ③④ 사진·파일 첨부 — 컴팩트 2열 (2026-07-31 사장님: 첨부 영역 축소, 작성칸 확대) */}
          <div className="board-attach-grid">
            <div className="board-attach-block">
              <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                <Ico e="🖼" /> 사진 첨부 (선택)
              </div>
              <FileUploadMulti
                onFilesSelect={setPhotoFiles}
                accept={IMAGE_TYPES}
                maxSize={10}
                maxFiles={10}
                label="사진 선택 / 드래그"
                disabled={uploading}
                compact
              />
            </div>
            <div className="board-attach-block">
              <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                <Ico e="📎" /> 파일 첨부 (선택)
              </div>
              <FileUploadMulti
                onFilesSelect={setDocFiles}
                accept={FILE_TYPES}
                maxSize={50}
                maxFiles={10}
                label="파일 선택 / 드래그"
                disabled={uploading}
                compact
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              onClick={resetForm}
              className="btn-secondary"
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
              className="btn-primary"
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
        </div>
      )}

      <QueryBody>
      {isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : filteredPosts.length === 0 ? (
        <div className="collect-empty board-empty-state">
          <div className="text-4xl mb-3"><Ico e="📝" /></div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {posts.length === 0
              ? "등록된 글이 없습니다. 첫 글을 작성해보세요."
              : "조건에 맞는 글이 없습니다."}
          </div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1.5">
            {posts.length === 0
              ? "글쓰기 버튼으로 공지·일정·투표·첨부를 공유할 수 있습니다."
              : "필터나 검색어를 바꿔서 다시 시도해보세요."}
          </div>
          {posts.length === 0 && !showForm && (
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="btn-primary mt-5"
            >
              + 글쓰기
            </button>
          )}
        </div>
      ) : (
        <div className="ev-scroll">
        <table ref={tableRef} className="ev-table ev-lined board-table">
          <thead>
            <tr>
              <SortableTh label="제목" sortKey="title" sort={bSort} onSort={onBSort} resize={thResize("title", 1)} />
              <SortableTh label="작성자" sortKey="author" sort={bSort} onSort={onBSort} resize={thResize("author", 2)} />
              <SortableTh label="등록" sortKey="created" sort={bSort} onSort={onBSort} resize={thResize("created", 3)} />
            </tr>
          </thead>
          <tbody>
          {(pager.view as Post[]).map((p) => {
            const open = openId === p.id;
            const isMine = mine(p.author_id);
            const opts = p.poll_options || [];
            const isMulti = !!p.poll_multi;
            return (
              <Fragment key={p.id}>
                <tr className={open ? "board-row board-row-open" : "board-row"} onClick={() => setOpenId(open ? null : p.id)}>
                  <td className="text-left">
                    <div className="board-post-badges">
                      {p.category && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-dim)] font-semibold">
                          {p.category}
                        </span>
                      )}
                      {p.pinned && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                          <Ico e="📌" tone="mono" /> 고정
                        </span>
                      )}
                      {p.event_date && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--info-dim)] text-[var(--info)] font-semibold">
                          <Ico e="📅" tone="mono" /> {kstDateStr(new Date(p.event_date))}
                        </span>
                      )}
                      {p.poll_question && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                          <Ico e="🗳" tone="mono" /> 투표
                        </span>
                      )}
                      {(p.attachments?.length ?? 0) > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-semibold">
                          <Ico e="📎" /> {p.attachments!.length}
                        </span>
                      )}
                      <span className="text-sm font-bold text-[var(--text)] truncate">
                        {p.title}
                      </span>
                      <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-6 h-6 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] inline-flex items-center justify-center text-[10px] font-bold shrink-0">{(p.author_name || p.author_email || "?")[0].toUpperCase()}</span>
                      {p.author_name || p.author_email || "익명"}
                    </span>
                  </td>
                  <td className="text-center mono-number whitespace-nowrap">{new Date(p.created_at).toLocaleString("ko-KR")}{p.updated_at !== p.created_at && <span className="text-[10px] text-[var(--text-dim)]"> (수정됨)</span>}</td>
                </tr>
                {open && (
                  <tr className="board-detail-row" onClick={(e) => e.stopPropagation()}>
                  <td colSpan={3}>
                  <div className="board-post-detail">
                    {/* 본문 — 새 글(HTML 서식)은 sanitize 후 렌더, 기존 평문 글은 pre-wrap 유지 */}
                    {isHtmlContent(p.content) ? (
                      <div
                        className="board-desc-html"
                        dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(p.content) }}
                      />
                    ) : (
                      <div className="text-sm text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed border-t border-[var(--border)] pt-3">
                        {p.content}
                      </div>
                    )}

                    {/* 일정 표시 */}
                    {p.event_date && (
                      <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-[var(--info-dim)] text-[var(--info)]">
                        <span><Ico e="📅" /></span>
                        <span className="font-semibold">
                          일정: {kstDateStr(new Date(p.event_date))}
                        </span>
                      </div>
                    )}

                    {/* 투표 */}
                    {p.poll_question && opts.length > 0 && (() => {
                      const { expired, label } = pollExpiry(p.poll_deadline);
                      return (
                      <div className="board-poll-block">
                        <div className="text-sm font-semibold text-[var(--text)] mb-2 flex items-center gap-2 flex-wrap">
                          <span><Ico e="🗳" /> {p.poll_question}</span>
                          {label && (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                expired
                                  ? "bg-[var(--text-dim)]/15 text-[var(--text-dim)]"
                                  : "bg-[var(--warning-dim)] text-[var(--warning)]"
                              }`}
                            >
                              {expired ? "투표 마감" : label}
                            </span>
                          )}
                        </div>
                        {/* 투표 전에는 결과를 감춘다 — 남의 표에 끌려가지 않게 (2026-08-06 사장님 시안).
                            마감됐거나 이미 투표한 사람에게만 막대·표수를 보여준다. */}
                        {(() => {
                          const showResults = myVotes.length > 0 || expired;
                          return (
                        <div className="space-y-2">
                          {opts.map((opt, idx) => {
                            const count = voteCounts[idx] || 0;
                            const pct =
                              totalVotes > 0
                                ? Math.round((count / totalVotes) * 100)
                                : 0;
                            // 아직 제출 안 한 선택이 있으면 그걸, 없으면 확정된 내 표를 표시
                            const picked = pendingVote?.postId === p.id ? pendingVote.options : myVotes;
                            const voted = picked.includes(idx);
                            return (
                              <button
                                key={idx}
                                onClick={() => pickOption(p.id, idx, isMulti)}
                                disabled={castVote.isPending || expired}
                                className={`board-poll-option ${
                                  voted
                                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                                    : "border-[var(--border)] hover:border-[var(--primary)]/40"
                                } ${expired ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                {showResults && (
                                  <div
                                    className="absolute inset-y-0 left-0 bg-[var(--primary)]/10"
                                    style={{ width: `${pct}%` }}
                                  />
                                )}
                                <div className="relative flex items-center justify-between text-xs">
                                  <span className="text-[var(--text)] font-medium">
                                    {voted && "✓ "}
                                    {opt}
                                  </span>
                                  {showResults && (
                                    <span className="text-[var(--text-muted)]">
                                      {count}표 · {pct}%
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                          );
                        })()}
                        {/* 확인을 눌러야 반영 — 클릭 즉시 투표되던 오투표 방지 */}
                        {!expired && (() => {
                          const picked = pendingVote?.postId === p.id ? pendingVote.options : myVotes;
                          const dirty = pendingVote?.postId === p.id &&
                            (picked.length !== myVotes.length || picked.some((i) => !myVotes.includes(i)));
                          return (
                            <div className="board-poll-confirm-bar">
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {dirty
                                  ? picked.length === 0
                                    ? "선택 해제됨 — 확인하면 내 표가 취소됩니다"
                                    : `선택: ${picked.map((i) => opts[i]).filter(Boolean).join(", ")}`
                                  : myVotes.length > 0
                                    ? "투표함 — 다시 선택하면 변경할 수 있습니다"
                                    : "선택 후 '투표하기'를 눌러야 반영됩니다"}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                {dirty && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingVote(null)}
                                    className="btn-ghost btn-sm"
                                  >
                                    취소
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => castVote.mutate({ postId: p.id, optionIndexes: picked })}
                                  disabled={!dirty || castVote.isPending}
                                  className="btn-primary btn-sm disabled:opacity-40"
                                >
                                  {castVote.isPending ? "반영 중..." : myVotes.length > 0 ? "투표 변경" : "투표하기"}
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                        {/* 참여 인원 — 클릭하면 항목별 투표자·미참여 멤버 팝업 */}
                        {(myVotes.length > 0 || expired) && (
                          <div className="board-poll-participation">
                            <button type="button" onClick={() => setPollStatusPost(p)} className="board-poll-participation-link">
                              {new Set(Object.values(voterIdsByOption).flat()).size || totalVotes}명 참여 &rsaquo;
                            </button>
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--text-dim)] mt-2">
                          총 {totalVotes}표 · {isMulti ? "복수 선택 가능" : "1인 1표 (변경 가능)"}
                          {p.poll_anonymous ? " · 🔒 익명 투표" : " · 👤 실명 투표(투표자 공개)"}
                          {p.poll_deadline && !expired && (
                            <> · 마감 {new Date(p.poll_deadline).toLocaleString("ko-KR")}</>
                          )}
                          {expired && p.poll_deadline && (
                            <> · 마감일 {new Date(p.poll_deadline).toLocaleString("ko-KR")}</>
                          )}
                        </div>
                      </div>
                      );
                    })()}

                    {/* 첨부 (사진/파일) */}
                    {(p.attachments?.length ?? 0) > 0 && (
                      <div className="board-attachments">
                        <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                          첨부 {p.attachments!.length}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {p.attachments!.map((a, i) =>
                            isImage(a.type) ? (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  const imgs = p.attachments!.filter((x) => isImage(x.type)).map((x) => ({ url: x.url, name: x.name }));
                                  const idx = imgs.findIndex((x) => x.url === a.url);
                                  setLightbox({ images: imgs, index: idx < 0 ? 0 : idx });
                                }}
                                className="block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={a.url}
                                  alt={a.name}
                                  className="w-24 h-24 object-cover rounded-lg border border-[var(--border)] cursor-zoom-in"
                                />
                              </button>
                            ) : (
                              <a
                                key={i}
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--primary)]/40 transition"
                              >
                                <span><Ico e="📎" /></span>
                                <span className="max-w-[160px] truncate">
                                  {a.name}
                                </span>
                              </a>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    <div className="board-post-actions">
                      {canPin && (
                        <button
                          onClick={() => togglePin.mutate(p)}
                          className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                        >
                          {p.pinned ? "고정 해제" : "상단 고정"}
                        </button>
                      )}
                      {/* 수정·삭제 모두 작성자 본인만 (2026-07-31 사장님) */}
                      {isMine && (
                          <button
                            onClick={() => {
                              setEditing(p);
                              setForm({ title: p.title, content: plainToHtml(p.content) });
                              setPostCat(p.category || "");
                              setEventDate(p.event_date || "");
                              setPollQuestion(p.poll_question || "");
                              setPollOptions(
                                p.poll_options && p.poll_options.length >= 2
                                  ? p.poll_options
                                  : ["", ""]
                              );
                              setPollMulti(!!p.poll_multi);
                              setPollAnonymous(!!p.poll_anonymous);
                              // v4 B2: poll_deadline ISO → datetime-local 입력 형식 ("YYYY-MM-DDTHH:mm") 로 역변환
                              setPollDeadline(
                                p.poll_deadline
                                  ? new Date(p.poll_deadline)
                                      .toISOString()
                                      .slice(0, 16)
                                  : "",
                              );
                              setPhotoFiles([]);
                              setDocFiles([]);
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="text-xs px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] transition"
                          >
                            수정
                          </button>
                      )}
                      {isMine && (
                          <button
                            onClick={async () => {
                              if (await appConfirm("이 글을 삭제하시겠습니까?", { danger: true }))
                                delPost.mutate(p.id);
                            }}
                            className="text-xs px-3 py-1.5 text-[var(--danger)] rounded-lg hover:bg-[var(--danger-dim)] transition"
                          >
                            삭제
                          </button>
                      )}
                    </div>

                    {/* 댓글 (v4 B1: 트리 + 답글 + @멘션) */}
                    <div className="board-comments-section">
                      <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                        댓글 {comments.length}
                      </div>
                      <div className="space-y-2 mb-3">
                        {rootComments.map((c) => {
                          const replies = replyMap[c.id] || [];
                          const replyKey = `reply:${c.id}`;
                          const replyOpen = replyTo === c.id;
                          return (
                            <div key={c.id}>
                              <div className="board-comment-item">
                                <div className="flex-1 min-w-0 bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                                  <div className="text-[11px] text-[var(--text-dim)] mb-0.5">
                                    {c.author_name || "익명"} ·{" "}
                                    {new Date(c.created_at).toLocaleString("ko-KR")}
                                  </div>
                                  <div className="text-[var(--text)] whitespace-pre-wrap">
                                    {renderMentionContent(c.content)}
                                  </div>
                                  {Array.isArray(c.attachments) && (c.attachments as Attachment[]).some((a) => isImage(a.type)) && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {(c.attachments as Attachment[]).filter((a) => isImage(a.type)).map((a, i) => (
                                        <button key={i} type="button"
                                          onClick={() => {
                                            const imgs = (c.attachments as Attachment[]).filter((x) => isImage(x.type)).map((x) => ({ url: x.url, name: x.name }));
                                            const idx = imgs.findIndex((x) => x.url === a.url);
                                            setLightbox({ images: imgs, index: idx < 0 ? 0 : idx });
                                          }}>
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={a.url} alt={a.name} className="w-20 h-20 object-cover rounded-lg border border-[var(--border)] cursor-zoom-in" />
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <div className="mt-1 flex items-center gap-3">
                                    <button
                                      onClick={() => {
                                        setReplyTo(replyOpen ? null : c.id);
                                        setMentionQuery(null);
                                      }}
                                      className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] transition"
                                    >
                                      {replyOpen ? "답글 취소" : "↩ 답글"}
                                    </button>
                                    {replies.length > 0 && (
                                      <span className="text-[11px] text-[var(--text-dim)]">
                                        답글 {replies.length}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {(mine(c.author_id) || canPin) && (
                                  <button
                                    onClick={() => delComment.mutate(c.id)}
                                    className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs shrink-0 mt-1"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>

                              {/* 답글 목록 (depth-1) */}
                              {replies.length > 0 && (
                                <div className="ml-6 mt-2 space-y-2 border-l-2 border-[var(--border)] pl-3">
                                  {replies.map((r) => (
                                    <div key={r.id} className="board-reply-item">
                                      <div className="flex-1 min-w-0 bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                                        <div className="text-[11px] text-[var(--text-dim)] mb-0.5">
                                          ↳ {r.author_name || "익명"} ·{" "}
                                          {new Date(r.created_at).toLocaleString("ko-KR")}
                                        </div>
                                        <div className="text-[var(--text)] whitespace-pre-wrap">
                                          {renderMentionContent(r.content)}
                                        </div>
                                      </div>
                                      {(mine(r.author_id) || canPin) && (
                                        <button
                                          onClick={() => delComment.mutate(r.id)}
                                          className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs shrink-0 mt-1"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* 답글 입력 — root 댓글에만 (depth-1 강제) */}
                              {replyOpen && (
                                <div className="board-reply-form">
                                  <div className="flex gap-2">
                                    <div className="relative flex-1">
                                      <textarea
                                        ref={(el) => { inputRefs.current[replyKey] = el; }}
                                        value={replyDraft[c.id] || ""}
                                        onChange={(e) => {
                                          setReplyDraft((s) => ({ ...s, [c.id]: e.target.value }));
                                          handleMentionChange(replyKey, e.currentTarget);
                                        }}
                                        onKeyDown={(e) => {
                                          if ((e.nativeEvent as KeyboardEvent).isComposing) return;   // 한글 조합 중 Enter 는 전송 아님 (2026-08-20)
                                          if (e.key === "Enter" && !e.shiftKey && mentionQuery?.key !== replyKey) {
                                            e.preventDefault();
                                            addComment.mutate({ postId: p.id, parentCommentId: c.id });
                                          }
                                          if (e.key === "Escape") setMentionQuery(null);
                                        }}
                                        rows={2}
                                        placeholder="답글을 입력하세요. @이름 으로 멘션 가능"
                                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm resize-y focus:outline-none focus:border-[var(--primary)]"
                                      />
                                      {mentionQuery?.key === replyKey && (
                                        <MentionDropdown
                                          users={companyUsers}
                                          filter={mentionQuery.q}
                                          onSelect={(u) => handleMentionSelect(replyKey, u)}
                                          onClose={() => setMentionQuery(null)}
                                        />
                                      )}
                                    </div>
                                    <button
                                      onClick={() => addComment.mutate({ postId: p.id, parentCommentId: c.id })}
                                      disabled={
                                        addComment.isPending ||
                                        !(replyDraft[c.id] || "").trim()
                                      }
                                      className="btn-primary self-start"
                                    >
                                      답글
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {rootComments.length === 0 && (
                          <div className="text-center py-4 text-xs text-[var(--text-dim)]">
                            <Ico e="💬" /> <span className="font-medium">첫 댓글을 남겨보세요.</span>
                          </div>
                        )}
                      </div>
                      {(commentFiles[p.id]?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {commentFiles[p.id].map((a, i) => (
                            <div key={i} className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} className="w-14 h-14 object-cover rounded-lg border border-[var(--border)]" />
                              <button type="button" onClick={() => setCommentFiles((s) => ({ ...s, [p.id]: (s[p.id] || []).filter((_, j) => j !== i) }))}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none flex items-center justify-center">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="board-comment-input-row">
                        <div className="relative flex-1">
                          <textarea
                            ref={(el) => { inputRefs.current[p.id] = el; }}
                            value={commentDraft[p.id] || ""}
                            onChange={(e) => {
                              setCommentDraft((s) => ({ ...s, [p.id]: e.target.value }));
                              handleMentionChange(p.id, e.currentTarget);
                            }}
                            onKeyDown={(e) => {
                              if ((e.nativeEvent as KeyboardEvent).isComposing) return;   // 한글 조합 중 Enter 는 전송 아님 (2026-08-20)
                              if (e.key === "Enter" && !e.shiftKey && mentionQuery?.key !== p.id) {
                                e.preventDefault();
                                addComment.mutate({ postId: p.id, parentCommentId: null });
                              }
                              if (e.key === "Escape") setMentionQuery(null);
                            }}
                            rows={2}
                            placeholder="댓글 입력 후 Enter. @이름 으로 멘션 가능"
                            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm resize-y focus:outline-none focus:border-[var(--primary)]"
                          />
                          {mentionQuery?.key === p.id && (
                            <MentionDropdown
                              users={companyUsers}
                              filter={mentionQuery.q}
                              onSelect={(u) => handleMentionSelect(p.id, u)}
                              onClose={() => setMentionQuery(null)}
                            />
                          )}
                        </div>
                        <label title="사진 첨부"
                          className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] ${commentUploadingKey === p.id ? "opacity-50 pointer-events-none" : ""}`}>
                          <span className="text-base"><Ico e="🖼" /></span>
                          <input type="file" accept="image/*" multiple className="hidden"
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []).filter((f) => isImage(f.type));
                              e.target.value = "";
                              if (!files.length) return;
                              setCommentUploadingKey(p.id);
                              try { const atts = await uploadAttachments(files); setCommentFiles((s) => ({ ...s, [p.id]: [...(s[p.id] || []), ...atts] })); }
                              catch { toast("사진 업로드 실패", "error"); }
                              finally { setCommentUploadingKey(null); }
                            }} />
                        </label>
                        <button
                          onClick={() => addComment.mutate({ postId: p.id, parentCommentId: null })}
                          disabled={
                            addComment.isPending ||
                            (!(commentDraft[p.id] || "").trim() && !(commentFiles[p.id]?.length))
                          }
                          className="btn-primary self-start"
                        >
                          등록
                        </button>
                      </div>
                    </div>
                  </div>
                  </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          </tbody>
        </table>
        </div>
      )}
      </QueryBody>
      <Pager page={pager.page} pages={pager.pages} total={filteredPosts.length} size={bLive.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>
      {lightbox && (
        <BoardLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(i) => setLightbox((s) => (s ? { ...s, index: i } : null))}
          onClose={() => setLightbox(null)}
        />
      )}
      {pollStatusPost && (
        <PollStatusDialog
          post={pollStatusPost}
          voterIdsByOption={voterIdsByOption}
          voterNames={voterNames}
          members={companyMembers}
          onClose={() => setPollStatusPost(null)}
        />
      )}
    </div>
  );
}

/** 투표 현황 — 항목별 투표자와 미참여 멤버 (2026-08-06 사장님 시안).
 *  본문에는 투표자를 노출하지 않고 이 팝업에서만 본다.
 *  익명 투표는 서버(get_poll_results)가 신원을 아예 주지 않으므로 인원 수만 보여준다.
 *  — 미참여 명단도 감춘다. 참여자를 역산할 수 있기 때문. */
function PollStatusDialog({ post, voterIdsByOption, voterNames, members, onClose }: {
  post: Post;
  voterIdsByOption: Record<number, string[]>;
  voterNames: Record<string, string>;
  members: { id: string; name: string | null; email: string | null }[];
  onClose: () => void;
}) {
  useModalKeys(true, onClose);
  const opts = (post.poll_options || []) as string[];
  const anonymous = !!post.poll_anonymous;
  const votedIds = new Set(Object.values(voterIdsByOption).flat());
  const notVoted = members.filter((m) => !votedIds.has(m.id));
  return (
    <div className="poll-status-overlay" onClick={onClose}>
      <div className="poll-status-panel glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--text)] truncate">{post.poll_question || "투표 현황"}</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
              {votedIds.size}명 참여{anonymous ? " · 🔒 익명 투표(투표자 비공개)" : ` · 미참여 ${notVoted.length}명`}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm shrink-0">닫기</button>
        </div>

        <div className="poll-status-body">
          <div className="poll-status-section-title">항목별 투표자</div>
          <div className="space-y-2">
            {opts.map((opt, idx) => {
              const ids = voterIdsByOption[idx] || [];
              return (
                <div key={idx} className="poll-status-option">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{opt}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0">{ids.length}명</span>
                  </div>
                  <div className="poll-status-names">
                    {anonymous
                      ? <span className="text-[var(--text-dim)]">익명 투표라 투표자를 공개하지 않습니다</span>
                      : ids.length
                        ? ids.map((id) => voterNames[id] || "알 수 없음").join(", ")
                        : <span className="text-[var(--text-dim)]">아직 없음</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {!anonymous && (
            <>
              <div className="poll-status-section-title mt-4">미참여 멤버 ({notVoted.length}명)</div>
              <div className="poll-status-option">
                <div className="poll-status-names">
                  {notVoted.length
                    ? notVoted.map((m) => m.name || m.email || "이름 없음").join(", ")
                    : <span className="text-[var(--text-dim)]">전원 참여했습니다</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 게시판 사진 라이트박스 — 팝업 크게 보기 + 이전/다음 넘기기 + 드래그 이동(패닝) + 휠/더블클릭 확대. ESC·바깥클릭 닫힘.
function BoardLightbox({ images, index, onIndex, onClose }: {
  images: { url: string; name: string }[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const cur = images[index];

  const reset = () => { setScale(1); setOff({ x: 0, y: 0 }); };
  const go = (dir: number) => { onIndex((index + dir + images.length) % images.length); reset(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOff({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => { drag.current = null; };

  if (!cur) return null;
  return (
    <div className="board-lightbox fixed inset-0" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center" aria-label="닫기">✕</button>
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-white/10 text-white text-xs">{index + 1} / {images.length}</div>
      )}
      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center" aria-label="이전">‹</button>
          <button onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center" aria-label="다음">›</button>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cur.url}
        alt={cur.name}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => { e.stopPropagation(); setScale((s) => (s > 1 ? 1 : 2)); setOff({ x: 0, y: 0 }); }}
        onWheel={(e) => setScale((s) => Math.min(5, Math.max(1, s - e.deltaY * 0.0015)))}
        draggable={false}
        style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${scale})`, cursor: drag.current ? "grabbing" : "grab", transition: drag.current ? "none" : "transform 0.1s", touchAction: "none" }}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-white/10 text-white/90 text-xs max-w-[80vw] truncate">{cur.name}</div>
    </div>
  );
}

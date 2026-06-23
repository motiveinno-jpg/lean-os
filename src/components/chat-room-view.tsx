"use client";

// chat/page.tsx 에서 추출 (2026-06-22) — /chat 풀페이지와 플로팅 메신저(floating-messenger)가
// 동일한 채팅방 뷰를 공유하기 위해 ChatRoomView + 의존 헬퍼(파일갤러리/미리보기/인라인편집)를 분리.
// 동작 무변경: 코드 이동만, 로직 수정 없음.
import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser, getChannel, getMessagesPaginated, getParticipants, getChannelEvents,
  searchChannelMessages, getBatchReactions, getActionCards, getChannelFiles, getCompanyUsers,
} from "@/lib/queries";
import { sendMessage, togglePin, markAsRead, uploadChatFile, sendMessageWithMentions, addReaction, removeReaction, editMessage, deleteMessage, inviteParticipant, getOrCreateInviteToken, getChatInviteUrl, sendSystemMessage } from "@/lib/chat";
import { subscribeToMessages, subscribeToMessageUpdates, subscribeToReactions, unsubscribe, type RealtimeStatus } from "@/lib/realtime";
import { useToast } from "@/components/toast";
import { ChatBubble } from "@/components/chat-bubble";
import { ChatInput } from "@/components/chat-input";
import { ChatSearch } from "@/components/chat-search";

function FilesGalleryView({ files }: { files: any[] }) {
  const [preview, setPreview] = useState<any | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "pdf" | "doc">("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const isImg = (f: any) => f.mime_type?.startsWith("image/");
  const isPdf = (f: any) => f.mime_type?.includes("pdf");
  const isVideo = (f: any) => f.mime_type?.startsWith("video/");
  const isAudio = (f: any) => f.mime_type?.startsWith("audio/");
  const fileIcon = (f: any) => {
    if (isImg(f)) return "🖼";
    if (isPdf(f)) return "📕";
    if (isVideo(f)) return "🎬";
    if (isAudio(f)) return "🎵";
    if (/(word|doc)/i.test(f.mime_type || "")) return "📝";
    if (/(sheet|excel|csv)/i.test(f.mime_type || "")) return "📊";
    if (/zip|archive/i.test(f.mime_type || "")) return "🗜";
    return "📎";
  };
  const fmtSize = (n: number) => {
    if (!n) return "";
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
  };

  const visible = files.filter((f: any) => {
    if (filter === "all") return true;
    if (filter === "image") return isImg(f);
    if (filter === "pdf") return isPdf(f);
    if (filter === "doc") return !isImg(f) && !isPdf(f);
    return true;
  });

  const imgs = files.filter(isImg);
  const pdfs = files.filter(isPdf);
  const others = files.filter((f) => !isImg(f) && !isPdf(f));

  return (
    <div className="glass-card overflow-hidden flex-1 overflow-y-auto">
      {files.length === 0 ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">파일이 없습니다</div>
      ) : (
        <>
          {/* Filter + Layout Toolbar */}
          <div className="sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)] px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {[
                { key: "all", label: `전체 (${files.length})` },
                { key: "image", label: `이미지 (${imgs.length})` },
                { key: "pdf", label: `PDF (${pdfs.length})` },
                { key: "doc", label: `기타 (${others.length})` },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key as any)}
                  className={`px-3 py-2 rounded-md text-[11px] font-medium min-h-[44px] transition ${
                    filter === t.key
                      ? "bg-[var(--primary)] text-white"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setLayout("grid")}
                className={`p-2.5 rounded-md transition ${layout === "grid" ? "bg-[var(--bg-surface)] text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
                title="그리드 보기"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 6h6v6H4zM14 6h6v6h-6zM4 16h6v4H4zM14 16h6v4h-6z" /></svg>
              </button>
              <button
                onClick={() => setLayout("list")}
                className={`p-2.5 rounded-md transition ${layout === "list" ? "bg-[var(--bg-surface)] text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
                title="리스트 보기"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
          </div>

          {layout === "grid" ? (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {visible.map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => setPreview(f)}
                  className="group text-left bg-[var(--bg-surface)] rounded-lg border border-[var(--border)]/60 overflow-hidden hover:border-[var(--primary)]/50 hover:shadow-lg transition"
                >
                  <div className="aspect-square bg-[var(--bg)] flex items-center justify-center overflow-hidden relative">
                    {isImg(f) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.file_url}
                        alt={f.file_name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : isPdf(f) ? (
                      <div className="flex flex-col items-center gap-1 text-red-400">
                        <span className="text-4xl">📕</span>
                        <span className="text-[9px] font-semibold tracking-widest">PDF</span>
                      </div>
                    ) : isVideo(f) ? (
                      <span className="text-4xl">🎬</span>
                    ) : (
                      <span className="text-4xl">{fileIcon(f)}</span>
                    )}
                    {isPdf(f) && (
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
                        미리보기
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-medium truncate">{f.file_name}</div>
                    <div className="text-[9px] text-[var(--text-dim)] truncate mt-0.5">
                      {(f.users as any)?.name || (f.users as any)?.email || "—"}
                      {f.file_size ? ` · ${fmtSize(f.file_size)}` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {visible.map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => setPreview(f)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--bg-surface)] transition text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isImg(f) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.file_url} alt="" className="w-10 h-10 object-cover rounded border border-[var(--border)]" />
                    ) : (
                      <span className="text-xl w-10 text-center">{fileIcon(f)}</span>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{f.file_name}</div>
                      <div className="caption">
                        {(f.users as any)?.name || (f.users as any)?.email || "—"}
                        {f.file_size ? ` · ${fmtSize(f.file_size)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] shrink-0">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString("ko") : "—"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Preview Modal */}
      {preview && (
        <FilePreviewModal
          file={preview}
          files={visible}
          onClose={() => setPreview(null)}
          onNavigate={(f) => setPreview(f)}
          isImg={isImg}
          isPdf={isPdf}
          isVideo={isVideo}
          isAudio={isAudio}
          fileIcon={fileIcon}
          fmtSize={fmtSize}
        />
      )}
    </div>
  );
}

function FilePreviewModal({
  file, files, onClose, onNavigate, isImg, isPdf, isVideo, isAudio, fileIcon, fmtSize,
}: {
  file: any;
  files: any[];
  onClose: () => void;
  onNavigate: (f: any) => void;
  isImg: (f: any) => boolean;
  isPdf: (f: any) => boolean;
  isVideo: (f: any) => boolean;
  isAudio: (f: any) => boolean;
  fileIcon: (f: any) => string;
  fmtSize: (n: number) => string;
}) {
  const idx = files.findIndex((f) => f.id === file.id);
  const prev = idx > 0 ? files[idx - 1] : null;
  const next = idx >= 0 && idx < files.length - 1 ? files[idx + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && prev) onNavigate(prev);
      if (e.key === "ArrowRight" && next) onNavigate(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, prev, next]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-white/10 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl">{fileIcon(file)}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{file.file_name}</div>
            <div className="text-[11px] text-white/60">
              {(file.users as any)?.name || (file.users as any)?.email || "—"}
              {file.file_size ? ` · ${fmtSize(file.file_size)}` : ""}
              {file.created_at ? ` · ${new Date(file.created_at).toLocaleString("ko")}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={file.file_url}
            download={file.file_name}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition"
          >
            다운로드
          </a>
          <a
            href={file.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition"
          >
            새 탭에서 열기
          </a>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-lg transition"
            title="닫기 (Esc)"
          >
            ×
          </button>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
        {prev && (
          <button
            onClick={() => onNavigate(prev)}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full transition flex items-center justify-center"
            title="이전 (←)"
          >
            ‹
          </button>
        )}
        {next && (
          <button
            onClick={() => onNavigate(next)}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full transition flex items-center justify-center"
            title="다음 (→)"
          >
            ›
          </button>
        )}

        <div className="max-w-[92vw] max-h-full w-full flex items-center justify-center p-4">
          {isImg(file) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.file_url} alt={file.file_name} className="max-h-[82vh] max-w-full object-contain rounded shadow-2xl" />
          ) : isPdf(file) ? (
            <iframe
              src={`${file.file_url}#toolbar=1&navpanes=0`}
              title={file.file_name}
              className="w-[92vw] h-[82vh] bg-white rounded shadow-2xl"
            />
          ) : isVideo(file) ? (
            <video src={file.file_url} controls autoPlay className="max-h-[82vh] max-w-full rounded shadow-2xl bg-black" />
          ) : isAudio(file) ? (
            <div className="bg-[var(--bg-card)] rounded-2xl p-8 min-w-[280px] sm:min-w-[420px] text-center">
              <div className="text-5xl mb-4">🎵</div>
              <div className="text-sm font-semibold mb-4 text-[var(--text)]">{file.file_name}</div>
              <audio src={file.file_url} controls autoPlay className="w-full" />
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl p-10 text-center max-w-md">
              <div className="text-6xl mb-4">{fileIcon(file)}</div>
              <div className="text-base font-semibold text-[var(--text)] mb-2">{file.file_name}</div>
              <div className="text-xs text-[var(--text-muted)] mb-5">
                브라우저에서 직접 미리볼 수 없는 파일 형식입니다
              </div>
              <div className="flex gap-2 justify-center">
                <a
                  href={file.file_url}
                  download={file.file_name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-sm font-semibold transition"
                >
                  다운로드
                </a>
                <a
                  href={file.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-lg text-sm font-semibold transition border border-[var(--border)]"
                >
                  새 탭에서 열기
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer: thumb strip for images */}
      {files.filter(isImg).length > 1 && isImg(file) && (
        <div
          className="border-t border-white/10 px-4 py-2 overflow-x-auto flex gap-2 bg-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          {files.filter(isImg).map((f) => (
            <button
              key={f.id}
              onClick={() => onNavigate(f)}
              className={`shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition ${
                f.id === file.id ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.file_url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline edit component ──
function EditInline({ content, onSave, onCancel }: { content: string; onSave: (c: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(content);
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-surface)] rounded-xl my-1">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(text); if (e.key === 'Escape') onCancel(); }}
        className="flex-1 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
        autoFocus
      />
      <button onClick={() => onSave(text)} className="text-xs text-[var(--primary)] font-semibold">저장</button>
      <button onClick={onCancel} className="text-xs text-[var(--text-dim)]">취소</button>
    </div>
  );
}

// ── Chat Room View (previously chat/[channelId]/client.tsx) ──
//   embedded=true: 슬랙식 2단 레이아웃의 우측 대화 패널로 렌더 (전체화면 대신 부모 높이 채움).
export function ChatRoomView({ channelId, onBack, embedded, compact }: { channelId: string; onBack: () => void; embedded?: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "participants" | "events" | "files">("chat");
  const [showSearch, setShowSearch] = useState(false);
  const [showPinnedAll, setShowPinnedAll] = useState(false);
  const [replyTo, setReplyTo] = useState<{ messageId: string; senderName: string; content: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteTab, setInviteTab] = useState<"internal" | "external">("internal");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLink, setInviteLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [extContact, setExtContact] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('connecting');
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); }
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (showInvite) setShowInvite(false); else if (showSearch) setShowSearch(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showInvite, showSearch]);

  const { data: channel } = useQuery({
    queryKey: ["chat-channel", channelId],
    queryFn: () => getChannel(channelId, companyId!),
    enabled: !!channelId && !!companyId,
  });

  // Initial load: fetch latest 50 messages
  useEffect(() => {
    if (!channelId) return;
    isInitialLoad.current = true;
    (async () => {
      const result = await getMessagesPaginated(channelId, 50);
      setAllMessages(result.data);
      setHasOlderMessages(result.hasMore);
      isInitialLoad.current = false;
    })();
  }, [channelId]);

  // Load older messages
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages || allMessages.length === 0) return;
    setLoadingOlder(true);
    const scrollEl = scrollContainerRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight || 0;
    try {
      const oldest = allMessages[0];
      const result = await getMessagesPaginated(channelId, 50, oldest.created_at);
      setAllMessages(prev => [...result.data, ...prev]);
      setHasOlderMessages(result.hasMore);
      // Preserve scroll position after prepending older messages
      requestAnimationFrame(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, loadingOlder, hasOlderMessages, allMessages]);

  // Alias for rest of component
  const messages = allMessages;

  const { data: participants = [] } = useQuery({
    queryKey: ["chat-participants", channelId],
    queryFn: () => getParticipants(channelId),
    enabled: !!channelId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["chat-events", channelId],
    queryFn: () => getChannelEvents(channelId),
    enabled: !!channelId,
  });

  const { data: reactionsMap } = useQuery({
    queryKey: ["chat-reactions", channelId, messages.length],
    queryFn: () => getBatchReactions(messages.map((m: any) => m.id)),
    enabled: messages.length > 0,
  });

  const { data: actionCards = [] } = useQuery({
    queryKey: ["chat-action-cards", channelId],
    queryFn: () => getActionCards(channelId),
    enabled: !!channelId,
  });

  const { data: files = [] } = useQuery({
    queryKey: ["chat-files", channelId],
    queryFn: () => getChannelFiles(channelId),
    enabled: !!channelId && tab === 'files',
  });

  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  // Realtime: sole mechanism for live updates (no polling)
  useEffect(() => {
    if (!channelId) return;
    setRtStatus('connecting');
    const subs = [
      subscribeToMessages(channelId, async () => {
        // Fetch only new messages since the last message we have
        const lastMsg = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
        if (lastMsg) {
          const result = await getMessagesPaginated(channelId, 50);
          // Merge: keep any older messages already loaded, append genuinely new ones
          setAllMessages(prev => {
            const existingIds = new Set(prev.map((m: any) => m.id));
            const newMsgs = result.data.filter((m: any) => !existingIds.has(m.id));
            return [...prev, ...newMsgs];
          });
        } else {
          const result = await getMessagesPaginated(channelId, 50);
          setAllMessages(result.data);
          setHasOlderMessages(result.hasMore);
        }
      }, (status) => {
        setRtStatus(status);
      }),
      subscribeToMessageUpdates(channelId, async () => {
        // Refetch latest page to pick up edits/deletes/pins
        const result = await getMessagesPaginated(channelId, 50);
        setAllMessages(prev => {
          const olderMessages = prev.filter((m: any) =>
            !result.data.some((r: any) => r.id === m.id) &&
            new Date(m.created_at) < new Date(result.data[0]?.created_at || 0)
          );
          return [...olderMessages, ...result.data];
        });
      }),
      subscribeToReactions(channelId, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-reactions", channelId] });
      }),
    ];
    return () => { subs.forEach(unsubscribe); setRtStatus('connecting'); };
  }, [channelId, queryClient]);

  useEffect(() => {
    if (channelId && userId) {
      markAsRead(channelId, userId).then(() => {
        queryClient.invalidateQueries({ queryKey: ["chat-unread"] });
        window.dispatchEvent(new Event("sidebar-refresh-badges"));
      });
    }
  }, [channelId, userId, allMessages.length]);

  // Auto-scroll on new messages (skip during initial load — handled separately)
  //   ⚠️ scrollIntoView 는 스크롤 가능한 모든 "조상"을 스크롤 → 플로팅 팝업에서 패널 자체가 스크롤되어
  //   헤더가 위로 밀려 사라지던 버그. 메시지 컨테이너 내부만 스크롤하도록 scrollTop 사용.
  useEffect(() => {
    if (isInitialLoad.current) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [allMessages.length]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!isInitialLoad.current && allMessages.length > 0) {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [channelId]);

  const actionCardMap = new Map<string, any>();
  actionCards.forEach((ac: any) => actionCardMap.set(ac.message_id, ac));

  function getReactionsForMessage(msgId: string) {
    const raw = reactionsMap?.get(msgId) || [];
    const grouped = new Map<string, { count: number; hasOwn: boolean }>();
    raw.forEach((r: any) => {
      const existing = grouped.get(r.emoji) || { count: 0, hasOwn: false };
      existing.count++;
      if (r.user_id === userId) existing.hasOwn = true;
      grouped.set(r.emoji, existing);
    });
    return Array.from(grouped.entries()).map(([emoji, data]) => ({ emoji, ...data }));
  }

  function getReplyInfo(msg: any) {
    if (!msg.reply_to_id) return null;
    const original = messages.find((m: any) => m.id === msg.reply_to_id);
    if (!original) return null;
    return {
      senderName: (original as any).users?.name || (original as any).users?.email || '—',
      content: original.content?.slice(0, 60) || '',
    };
  }

  const [sendError, setSendError] = useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: (params: { content: string; mentionedUserIds?: string[]; replyToId?: string }) => {
      if (!userId) throw new Error("Not authenticated");
      return params.mentionedUserIds?.length
        ? sendMessageWithMentions({
            channelId,
            senderId: userId,
            content: params.content,
            mentionedUserIds: params.mentionedUserIds,
            replyToId: params.replyToId,
          })
        : sendMessage({
            channelId,
            senderId: userId,
            content: params.content,
            replyToId: params.replyToId,
          });
    },
    onSuccess: (data: any) => {
      setSendError(null);
      const currentUser = companyUsers.find((u: any) => u.id === userId);
      setAllMessages(prev => {
        if (prev.some((m: any) => m.id === data.id)) return prev;
        return [...prev, { ...data, users: { name: currentUser?.name || currentUser?.email, email: currentUser?.email } }];
      });
    },
    onError: (err: any) => {
      setSendError(err?.message || '메시지 전송에 실패했습니다. 다시 시도해주세요.');
      setTimeout(() => setSendError(null), 5000);
    },
  });

  const fileMut = useMutation({
    mutationFn: (file: File) => {
      if (!userId) throw new Error("Not authenticated");
      return uploadChatFile({ channelId, senderId: userId, file });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      queryClient.invalidateQueries({ queryKey: ["chat-files", channelId] });
    },
    onError: (err: any) => {
      setSendError(err?.message || '파일 업로드에 실패했습니다.');
      setTimeout(() => setSendError(null), 5000);
    },
  });

  const pinMut = useMutation({
    mutationFn: ({ msgId, pinned }: { msgId: string; pinned: boolean }) => togglePin(msgId, pinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] }),
    onError: (err: any) => { setSendError(err?.message || "고정 처리 실패"); setTimeout(() => setSendError(null), 5000); },
  });

  const reactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) => {
      const existing = reactionsMap?.get(msgId) || [];
      const hasOwn = existing.some((r: any) => r.user_id === userId && r.emoji === emoji);
      if (!userId) throw new Error("Not authenticated");
      return hasOwn ? removeReaction(msgId, userId, emoji) : addReaction(msgId, userId, emoji);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-reactions", channelId] }),
    onError: (err: any) => { setSendError(err?.message || "반응 처리 실패"); setTimeout(() => setSendError(null), 5000); },
  });

  const editMut = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) => editMessage(msgId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
      setEditingId(null);
    },
    onError: (err: any) => { setSendError(err?.message || "메시지 수정 실패"); setTimeout(() => setSendError(null), 5000); },
  });

  const deleteMut = useMutation({
    mutationFn: (msgId: string) => deleteMessage(msgId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] }),
    onError: (err: any) => { setSendError(err?.message || "메시지 삭제 실패"); setTimeout(() => setSendError(null), 5000); },
  });

  const handleSearch = useCallback(async (query: string) => {
    return await searchChannelMessages(channelId, query);
  }, [channelId]);

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const EVENT_LABELS: Record<string, string> = {
    channel_created: "채널 생성",
    user_joined: "멤버 참가",
    user_left: "멤버 퇴장",
    contract_executed: "계약 체결",
    payment_received: "입금 확인",
    milestone_completed: "마일스톤 완료",
    assignment_changed: "담당자 변경",
    document_approved: "문서 승인",
    document_locked: "문서 잠금",
    deal_status_changed: "프로젝트 상태 변경",
  };

  const pinnedMessages = messages.filter((m: any) => m.pinned);

  // DM 채널은 저장명이 "DM-<timestamp>" → 상대 참가자 이름으로 표시
  const isDMChannel = !!(channel as any)?.is_dm;
  const dmPeer = isDMChannel ? participants.find((p: any) => p.user_id !== userId) : null;
  const headerName = isDMChannel
    ? ((dmPeer as any)?.users?.name || (dmPeer as any)?.users?.email || "1:1 대화")
    : (channel?.name || "...");

  return (
    <div
      className={embedded ? "flex flex-col h-full min-h-0 min-w-0" : "max-w-[900px] flex flex-col"}
      style={!embedded ? { height: "calc(100dvh - 60px)" } : undefined}
    >
      {/* compact(플로팅 팝업): 팝업이 자체 헤더(채널명/뒤로/닫기)를 제공하므로 내부 헤더 숨김 — 중복·짤림 방지 */}
      {!compact && (
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition ${embedded ? "lg:hidden" : ""}`}>
            &larr; 채널 목록
          </button>
          <div>
            <h1 className="text-lg font-extrabold">{headerName}</h1>
            <div className="text-xs text-[var(--text-dim)]">
              {isDMChannel ? "1:1 대화" : ((channel as any)?.deals?.name ? `프로젝트: ${(channel as any).deals.name}` : channel?.type || "")}
              {" · "}
              {participants.length}명 참가
            </div>
          </div>
        </div>
        <button onClick={() => setShowSearch(!showSearch)}
          className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] rounded-lg transition">
          검색
        </button>
      </div>
      )}

      {showSearch && (
        <ChatSearch
          onSearch={handleSearch}
          onResultClick={(id) => {
            const el = document.getElementById(`msg-${id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.classList.add('ring-2', 'ring-[var(--primary)]');
            setTimeout(() => el?.classList.remove('ring-2', 'ring-[var(--primary)]'), 2000);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {pinnedMessages.length > 0 && tab === 'chat' && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2 mb-2 shrink-0">
          <button
            onClick={() => setShowPinnedAll(v => !v)}
            className="flex items-center justify-between w-full text-[10px] font-semibold text-yellow-400 mb-1"
          >
            <span>📌 고정 메시지 ({pinnedMessages.length})</span>
            <span className="text-[var(--text-dim)]">{showPinnedAll ? '접기 ▴' : '펼치기 ▾'}</span>
          </button>
          {!showPinnedAll ? (
            <button
              onClick={() => {
                const id = (pinnedMessages[0] as any).id;
                const el = document.getElementById(`msg-${id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.classList.add('ring-2', 'ring-yellow-400');
                setTimeout(() => el?.classList.remove('ring-2', 'ring-yellow-400'), 2000);
              }}
              className="text-xs text-[var(--text-muted)] truncate text-left w-full hover:text-[var(--text)]"
            >
              {(pinnedMessages[0] as any).content}
            </button>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {pinnedMessages.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => {
                      const el = document.getElementById(`msg-${m.id}`);
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el?.classList.add('ring-2', 'ring-yellow-400');
                      setTimeout(() => el?.classList.remove('ring-2', 'ring-yellow-400'), 2000);
                    }}
                    className="flex-1 text-left text-xs text-[var(--text-muted)] truncate hover:text-[var(--text)]"
                  >
                    <span className="text-[var(--text-dim)] mr-1">{m.users?.name || m.users?.email || '—'}:</span>
                    {m.content}
                  </button>
                  <button
                    onClick={() => pinMut.mutate({ msgId: m.id, pinned: false })}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-dim)] hover:text-red-400"
                    title="고정 해제"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 rounded-xl p-1 mb-3 shrink-0 bg-[var(--bg-surface)]">
        {([
          { key: "chat" as const, label: `채팅 (${messages.length})` },
          { key: "participants" as const, label: `참가자 (${participants.length})` },
          { key: "files" as const, label: `파일` },
          { key: "events" as const, label: `이벤트 (${events.length})` },
        ]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.key ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Realtime connection status banner */}
          {rtStatus !== 'SUBSCRIBED' && (
            <div className={`px-4 py-2 text-xs font-medium flex items-center justify-between rounded-t-2xl ${
              rtStatus === 'connecting' ? 'bg-yellow-500/10 text-yellow-500' :
              rtStatus === 'CHANNEL_ERROR' || rtStatus === 'TIMED_OUT' ? 'bg-red-500/10 text-red-400' :
              'bg-gray-500/10 text-gray-400'
            }`}>
              <span className="flex items-center gap-2">
                {rtStatus === 'connecting' && <><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> 실시간 연결 중...</>}
                {rtStatus === 'CHANNEL_ERROR' && <><span className="w-2 h-2 rounded-full bg-red-400" /> 실시간 연결 오류 — 5초마다 자동 갱신 중</>}
                {rtStatus === 'TIMED_OUT' && <><span className="w-2 h-2 rounded-full bg-red-400" /> 연결 시간 초과</>}
                {rtStatus === 'CLOSED' && <><span className="w-2 h-2 rounded-full bg-gray-400" /> 연결 종료됨</>}
              </span>
              {(rtStatus === 'CHANNEL_ERROR' || rtStatus === 'TIMED_OUT' || rtStatus === 'CLOSED') && (
                <button onClick={() => window.location.reload()} className="px-3 py-1 bg-white/10 rounded-lg hover:bg-white/20 transition text-xs font-semibold">
                  새로고침
                </button>
              )}
            </div>
          )}
          <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto ${compact ? 'bg-transparent p-3' : `bg-[var(--bg-card)] border border-b-0 border-[var(--border)] p-5 ${rtStatus === 'SUBSCRIBED' ? 'rounded-t-2xl' : ''}`}`}>
            {/* Load older messages button */}
            {hasOlderMessages && (
              <div className="text-center mb-3">
                <button
                  onClick={loadOlderMessages}
                  disabled={loadingOlder}
                  className="px-4 py-1.5 text-xs font-semibold text-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 rounded-lg transition disabled:opacity-50"
                >
                  {loadingOlder ? '불러오는 중...' : '이전 메시지 불러오기'}
                </button>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="text-center py-20 text-sm text-[var(--text-muted)]">첫 메시지를 보내세요</div>
            ) : (
              messages.map((msg: any) => {
                const ac = actionCardMap.get(msg.id);
                return (
                  <div key={msg.id} id={`msg-${msg.id}`} className="transition-all duration-300 rounded-lg">
                    {editingId === msg.id ? (
                      <EditInline
                        content={msg.content}
                        onSave={(c) => editMut.mutate({ msgId: msg.id, content: c })}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <ChatBubble
                        glass={compact}
                        senderName={msg.users?.name || msg.users?.email || "—"}
                        content={msg.content}
                        time={formatTime(msg.created_at)}
                        isOwn={msg.sender_id === userId}
                        type={msg.type}
                        pinned={msg.pinned}
                        editedAt={msg.edited_at}
                        deletedAt={msg.deleted_at}
                        replyTo={getReplyInfo(msg)}
                        reactions={getReactionsForMessage(msg.id)}
                        metadata={msg.metadata}
                        actionCard={ac ? { cardType: ac.card_type, status: ac.status, summaryJson: ac.summary_json } : null}
                        onPin={() => pinMut.mutate({ msgId: msg.id, pinned: !msg.pinned })}
                        onReply={() => setReplyTo({
                          messageId: msg.id,
                          senderName: msg.users?.name || msg.users?.email || '—',
                          content: msg.content?.slice(0, 60) || '',
                        })}
                        onReact={(emoji) => reactionMut.mutate({ msgId: msg.id, emoji })}
                        onEdit={msg.sender_id === userId ? () => setEditingId(msg.id) : undefined}
                        onDelete={msg.sender_id === userId ? () => { if (confirm('메시지를 삭제하시겠습니까?')) deleteMut.mutate(msg.id); } : undefined}
                      />
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          {sendError && (
            <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs font-medium">{sendError}</div>
          )}
          <div className={compact ? "rounded-b-3xl" : "rounded-b-2xl border border-t-0 border-[var(--border)]"}>
            <ChatInput
              glass={compact}
              onSend={(content, mentionedUserIds, replyToId) =>
                sendMut.mutate({ content, mentionedUserIds, replyToId: replyToId || replyTo?.messageId })
              }
              onFileUpload={(file) => fileMut.mutate(file)}
              disabled={sendMut.isPending || fileMut.isPending || !userId}
              users={companyUsers}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </div>
        </div>
      )}

      {tab === "participants" && (
        <div className="glass-card overflow-hidden flex-1 overflow-y-auto">
          {/* 초대 버튼 */}
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <button
              onClick={() => { setShowInvite(true); setInviteLink(""); setLinkCopied(false); setExtContact(""); }}
              className="w-full py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              멤버 초대
            </button>
          </div>

          {/* 참가자 목록 */}
          {participants.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">참가자가 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {participants.map((p: any) => (
                <div key={p.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                      {(p.users?.name || p.users?.email || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{p.users?.name || p.users?.email || "—"}</div>
                      <div className="caption">
                        {p.invited_at ? new Date(p.invited_at).toLocaleDateString("ko") : ""} 참가
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    p.role === 'OWNER' ? 'bg-yellow-500/10 text-yellow-600' :
                    p.role === 'INTERNAL_MANAGER' ? 'bg-blue-500/10 text-blue-600' :
                    p.role === 'CLIENT' ? 'bg-green-500/10 text-green-600' :
                    p.role === 'VENDOR' ? 'bg-purple-500/10 text-purple-600' :
                    p.role === 'GUEST' ? 'bg-orange-500/10 text-orange-600' :
                    'bg-gray-500/10 text-gray-500'
                  }`}>
                    {p.role === 'OWNER' ? '오너' : p.role === 'INTERNAL_MANAGER' ? '담당자' : p.role === 'CLIENT' ? '클라이언트' : p.role === 'VENDOR' ? '외주사' : p.role === 'GUEST' ? '게스트' : '멤버'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 초대 모달 */}
          {showInvite && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
              <div className="glass-card w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* 모달 헤더 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                  <h3 className="text-base font-bold text-[var(--text)]">멤버 초대</h3>
                  <button onClick={() => setShowInvite(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 탭 */}
                <div className="flex gap-1 mx-6 mt-4 bg-[var(--bg-surface)] rounded-xl p-1">
                  {([
                    { key: "internal" as const, label: "내부 멤버" },
                    { key: "external" as const, label: "외부 초대" },
                  ]).map((t) => (
                    <button key={t.key} onClick={() => setInviteTab(t.key)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        inviteTab === t.key ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="px-6 py-4">
                  {/* 내부 멤버 초대 */}
                  {inviteTab === "internal" && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">역할</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-3 focus:outline-none focus:border-[var(--primary)]"
                      >
                        <option value="member">멤버</option>
                        <option value="INTERNAL_MANAGER">담당자</option>
                        <option value="CLIENT">클라이언트</option>
                        <option value="VENDOR">외주사</option>
                      </select>

                      <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">멤버 선택</label>
                      <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-xl">
                        {companyUsers
                          .filter((u: any) => !participants.some((p: any) => p.user_id === u.id))
                          .map((u: any) => (
                            <button
                              key={u.id}
                              onClick={async () => {
                                try {
                                  await inviteParticipant({ channelId, userId: u.id, role: inviteRole });
                                  if (userId) await sendSystemMessage(channelId, userId, `${u.name || u.email}님이 채널에 참가했습니다.`);
                                  queryClient.invalidateQueries({ queryKey: ["chat-participants", channelId] });
                                  queryClient.invalidateQueries({ queryKey: ["chat-messages", channelId] });
                                } catch {}
                              }}
                              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-surface)] transition text-left"
                            >
                              <div className="w-8 h-8 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                                {(u.name || u.email || "?")[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-[var(--text)]">{u.name || "—"}</div>
                                <div className="caption">{u.email}</div>
                              </div>
                            </button>
                          ))}
                        {companyUsers.filter((u: any) => !participants.some((p: any) => p.user_id === u.id)).length === 0 && (
                          <div className="p-6 text-center text-xs text-[var(--text-muted)]">추가할 멤버가 없습니다</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 외부 초대 */}
                  {inviteTab === "external" && (
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-4">
                        초대 링크를 문자 또는 이메일로 보내 외부 인원을 채팅방에 초대합니다.
                      </p>

                      {/* 링크 생성 */}
                      {!inviteLink ? (
                        <button
                          onClick={async () => {
                            const token = await getOrCreateInviteToken(channelId);
                            setInviteLink(getChatInviteUrl(token));
                          }}
                          className="w-full py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm font-semibold text-[var(--text)] hover:bg-[var(--border)] transition mb-3"
                        >
                          초대 링크 생성
                        </button>
                      ) : (
                        <>
                          {/* 링크 표시 */}
                          <div className="flex items-center gap-2 mb-4">
                            <input
                              readOnly
                              value={inviteLink}
                              className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] truncate"
                            />
                            <button
                              onClick={() => { navigator.clipboard.writeText(inviteLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }}
                              className={`px-3 py-2 rounded-lg text-xs font-semibold transition shrink-0 ${linkCopied ? 'bg-green-100 text-green-700' : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'}`}
                            >
                              {linkCopied ? "복사됨!" : "복사"}
                            </button>
                          </div>

                          {/* 연락처 입력 */}
                          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">전화번호 또는 이메일</label>
                          <input
                            type="text"
                            value={extContact}
                            onChange={(e) => setExtContact(e.target.value)}
                            placeholder="010-1234-5678 또는 guest@company.com"
                            className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mb-4 focus:outline-none focus:border-[var(--primary)]"
                          />

                          {/* 발송 버튼 */}
                          <div className="grid grid-cols-2 gap-2">
                            <a
                              href={`sms:${extContact.includes('@') ? '' : extContact.replace(/-/g, '')}?body=${encodeURIComponent(`[OwnerView] "${channel?.name || '채팅방'}" 에 초대되었습니다.\n아래 링크를 눌러 참가하세요:\n${inviteLink}`)}`}
                              className="flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              문자 보내기
                            </a>
                            <a
                              href={`mailto:${extContact.includes('@') ? extContact : ''}?subject=${encodeURIComponent(`[OwnerView] 채팅방 초대`)}&body=${encodeURIComponent(`안녕하세요,\n\n"${channel?.name || '채팅방'}" 에 초대되었습니다.\n아래 링크를 클릭하여 참가하세요:\n\n${inviteLink}\n\nOwnerView`)}`}
                              className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              이메일 보내기
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "files" && (
        <FilesGalleryView files={files} />
      )}

      {tab === "events" && (
        <div className="glass-card overflow-hidden flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">이벤트가 없습니다</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {events.map((ev: any) => (
                <div key={ev.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {EVENT_LABELS[ev.event_type] || ev.event_type}
                    </span>
                    {ev.data_json && (
                      <span className="caption">
                        {JSON.stringify(ev.data_json).slice(0, 60)}
                      </span>
                    )}
                  </div>
                  <span className="caption">
                    {ev.created_at ? new Date(ev.created_at).toLocaleString("ko") : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

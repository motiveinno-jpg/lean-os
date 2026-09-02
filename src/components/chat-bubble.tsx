"use client";

import { useState } from "react";
import { Ico } from "@/components/ui-icon";
import { ActionCard } from "./action-card";

interface Reaction {
  emoji: string;
  count: number;
  hasOwn: boolean;
}

interface ReplyInfo {
  senderName: string;
  content: string;
}

interface ChatBubbleProps {
  senderName: string;
  content: string;
  time: string;
  isOwn: boolean;
  type?: string;
  pinned?: boolean;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyTo?: ReplyInfo | null;
  reactions?: Reaction[];
  metadata?: Record<string, any> | null;
  actionCard?: { cardType: string; status?: string; summaryJson?: Record<string, any> } | null;
  onPin?: () => void;
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  glass?: boolean; // 플로팅 메신저 팝업의 글래스모피즘 변형 (기본 false → /chat 풀페이지 무영향)
  /** 아직 안 읽은 사람 수 — 내 메시지에만, 0이면 표시 없음(=모두 읽음). 카톡 문법(드팜므 문의발, 2026-09-02) */
  unreadCount?: number;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

// Parse @mentions and **bold** in content; return JSX with highlighted mentions
//   본문에서 살려 낼 것 — 오너뷰 링크 `[제목](/경로)` 와 @멘션.
//   ⚠️ 경로는 '/'로 시작하는 **앱 안 주소만** 받는다 — 남이 보낸 글로 바깥 사이트를 열어 주지 않는다.
const CONTENT_RE = /(\[[^\]\n]+\]\(\/[^)\s]*\)|@[\w가-힣.\-_]+)/g;
const APP_LINK_RE = /^\[([^\]\n]+)\]\((\/[^)\s]*)\)$/;

function renderContent(text: string, isOwn: boolean, glass?: boolean) {
  if (!text) return null;
  const parts = text.split(CONTENT_RE);
  return parts.map((part, i) => {
    const link = APP_LINK_RE.exec(part || "");
    if (link) {
      //   새 탭으로 연다 — 메신저가 새 창일 때 그 창이 다른 화면으로 바뀌어 버리지 않게
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer"
          className={`chat-bubble-applink ${isOwn ? "chat-bubble-applink-own" : ""}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
          {link[1]}
        </a>
      );
    }
    if (part.startsWith('@')) {
      return (
        <span
          key={i}
          className={`font-semibold px-1 rounded ${
            isOwn ? 'bg-white/20 text-white' : 'bg-[var(--primary)]/15 text-[var(--primary)]'
          }`}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function ChatBubble({
  senderName, content, time, isOwn, type, pinned,
  editedAt, deletedAt, replyTo, reactions, metadata, actionCard,
  onPin, onReply, onReact, onEdit, onDelete, glass, unreadCount,
}: ChatBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);

  // 액션 툴바 버튼 공통 스타일 (카카오/인스타식 원형 아이콘 버튼). 테마 토큰 → 라이트/다크 자동 대응.
  const actionBtnCls = "w-7 h-7 rounded-full flex items-center justify-center transition text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]";

  // Deleted message
  if (deletedAt) {
    return (
      <div className="chat-bubble-deleted">
        <div className="px-3 py-1.5 bg-[var(--bg-surface)] rounded-full text-[10px] text-[var(--text-dim)] italic">
          삭제된 메시지
        </div>
      </div>
    );
  }

  // System message
  if (type === "system") {
    return (
      <div className="chat-bubble-system">
        <div className="px-3 py-1.5 bg-[var(--bg-surface)] rounded-full text-[10px] text-[var(--text-dim)]">
          {content}
        </div>
      </div>
    );
  }

  // File message
  const isFile = type === 'file' && metadata;
  const isImage = isFile && metadata?.mime_type?.startsWith('image/');

  return (
    <div className={`chat-bubble-row ${isOwn ? "justify-end" : "justify-start"} group`}>
      <div className={`chat-bubble-column ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <div className="chat-bubble-sender-name">{senderName}</div>
        )}

        {/* Reply indicator */}
        {replyTo && (
          <div className="chat-bubble-reply">
            <div className="w-0.5 h-4 bg-[var(--primary)]/40 rounded-full" />
            <div className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">
              <span className="font-semibold">{replyTo.senderName}</span>: {replyTo.content}
            </div>
          </div>
        )}

        <div className="chat-bubble-content-row">
          {isOwn && (
            <span className="mb-1 flex flex-col items-end">
              {/* 안 읽은 사람 수 — 사라지면 모두 읽음(카톡 문법). 숫자를 누르면 이유를 알 수 있게 title */}
              {typeof unreadCount === "number" && unreadCount > 0 && (
                <span className="mb-0.5 text-[9px] font-bold leading-none text-amber-500"
                  title={`아직 안 읽은 사람 ${unreadCount}명`}>{unreadCount}</span>
              )}
              <span className="text-[9px] text-[var(--text-dim)]">
                {time}
              </span>
            </span>
          )}

          {/* Hover action bar — 카카오/인스타식 플로팅 툴바 (버블 상단 모서리에 떠서 표시) */}
          <div className={`chat-bubble-toolbar ${isOwn ? 'right-1' : 'left-1'}`}>
            {onReact && (
              <button onClick={() => setShowReactions(!showReactions)} className={actionBtnCls} title="공감">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
            )}
            {onReply && (
              <button onClick={onReply} className={actionBtnCls} title="답장">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
              </button>
            )}
            {onPin && (
              <button onClick={onPin} className={`${actionBtnCls} ${pinned ? 'text-yellow-500' : ''}`} title={pinned ? '고정 해제' : '고정'}>
                <svg className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
              </button>
            )}
            {isOwn && onEdit && (
              <button onClick={onEdit} className={actionBtnCls} title="편집">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
            )}
            {isOwn && onDelete && (
              <button onClick={onDelete} className={`${actionBtnCls} hover:text-red-400`} title="삭제">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            )}
          </div>

          {/* Quick reactions popup — 툴바 위에 뜨는 이모지 피커 */}
          {showReactions && onReact && (
            <div className={`chat-bubble-reactions-popup ${isOwn ? 'right-1' : 'left-1'}`}>
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} onClick={() => { onReact(emoji); setShowReactions(false); }}
                  className="text-lg leading-none hover:scale-[1.35] transition-transform">
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div
            className={`chat-bubble-bubble ${
              isOwn
                ? (glass ? "bg-[var(--primary)] text-white rounded-br-md" : "bg-[#3B82F6] text-white rounded-br-md")
                /* 받은 말풍선은 테마 토큰만 쓴다 — bg-white/dark: 조합은 OS 설정을 따라가
                   앱 테마와 어긋나면 어두운 말풍선에 검은 글씨가 됐다 (2026-08-20 사장님 제보) */
                : (glass ? "bg-[var(--bg-surface)]/85 backdrop-blur-md text-[var(--text)] border border-[var(--border)] rounded-bl-md" : "bg-[var(--bg-card)] text-[var(--text)] rounded-bl-md border border-[var(--border)]")
            } ${pinned ? "ring-1 ring-yellow-500/50" : ""}`}
          >
            {/* File content */}
            {isFile ? (
              <div className="chat-bubble-file">
                {isImage ? (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer">
                    <img src={metadata.file_url} alt={metadata.file_name}
                      className="chat-bubble-file-image" />
                  </a>
                ) : (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer"
                    className="chat-bubble-file-link">
                    <span className="text-lg"><Ico e="📎" /></span>
                    <div>
                      <div className="text-xs font-medium">{metadata.file_name}</div>
                      <div className="text-[10px] opacity-70">
                        {metadata.file_size ? `${(metadata.file_size / 1024).toFixed(0)}KB` : ''}
                      </div>
                    </div>
                  </a>
                )}
              </div>
            ) : (
              <span className="whitespace-pre-wrap break-words">{renderContent(content, isOwn, glass)}</span>
            )}

            {/* Action card inline */}
            {actionCard && (
              <div className="mt-2">
                <ActionCard
                  cardType={actionCard.cardType}
                  status={actionCard.status}
                  summaryJson={actionCard.summaryJson}
                />
              </div>
            )}

            {/* Edited indicator */}
            {editedAt && (
              <span className="text-[9px] opacity-50 ml-1">(편집됨)</span>
            )}
          </div>

          {!isOwn && (
            <span className="text-[9px] mb-1 text-[var(--text-dim)]">
              {time}
            </span>
          )}
        </div>

        {/* Reactions row */}
        {reactions && reactions.length > 0 && (
          <div className="chat-bubble-reactions-row">
            {reactions.map(r => (
              <button key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className={`chat-bubble-reaction-chip ${
                  r.hasOwn
                    ? 'bg-[var(--primary)]/15 border border-[var(--primary)]/30'
                    : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/80'
                }`}>
                <span><Ico e={r.emoji} /></span>
                <span className="text-[9px] font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

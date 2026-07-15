"use client";

import { useState } from "react";
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
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

// Parse @mentions and **bold** in content; return JSX with highlighted mentions
function renderContent(text: string, isOwn: boolean, glass?: boolean) {
  if (!text) return null;
  const parts = text.split(/(@[\w가-힣.\-_]+)/g);
  return parts.map((part, i) => {
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
  onPin, onReply, onReact, onEdit, onDelete, glass,
}: ChatBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);

  // 액션 툴바 버튼 공통 스타일 (카카오/인스타식 원형 아이콘 버튼). 테마 토큰 → 라이트/다크 자동 대응.
  const actionBtnCls = "w-7 h-7 rounded-full flex items-center justify-center transition text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]";

  // Deleted message
  if (deletedAt) {
    return (
      <div className="chat-bubble-deleted flex justify-center my-2">
        <div className="px-3 py-1.5 bg-[var(--bg-surface)] rounded-full text-[10px] text-[var(--text-dim)] italic">
          삭제된 메시지
        </div>
      </div>
    );
  }

  // System message
  if (type === "system") {
    return (
      <div className="chat-bubble-system flex justify-center my-2">
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
    <div className={`chat-bubble-row flex ${isOwn ? "justify-end" : "justify-start"} mb-3 group`}>
      <div className={`chat-bubble-column max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <div className="chat-bubble-sender-name text-[10px] mb-1 px-1 text-[var(--text-dim)]">{senderName}</div>
        )}

        {/* Reply indicator */}
        {replyTo && (
          <div className="chat-bubble-reply flex items-center gap-1 px-3 mb-1">
            <div className="w-0.5 h-4 bg-[var(--primary)]/40 rounded-full" />
            <div className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">
              <span className="font-semibold">{replyTo.senderName}</span>: {replyTo.content}
            </div>
          </div>
        )}

        <div className="chat-bubble-content-row flex items-end gap-2 relative">
          {isOwn && (
            <span className="text-[9px] mb-1 text-[var(--text-dim)]">
              {time}
            </span>
          )}

          {/* Hover action bar — 카카오/인스타식 플로팅 툴바 (버블 상단 모서리에 떠서 표시) */}
          <div className={`chat-bubble-toolbar absolute -top-4 ${isOwn ? 'right-1' : 'left-1'} z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 p-1 rounded-full shadow-lg bg-[var(--bg-card)] border border-[var(--border)]`}>
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
            <div className={`chat-bubble-reactions-popup absolute ${isOwn ? 'right-1' : 'left-1'} -top-14 flex gap-1 rounded-full px-2 py-1.5 shadow-xl z-20 bg-[var(--bg-card)] border border-[var(--border)]`}>
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} onClick={() => { onReact(emoji); setShowReactions(false); }}
                  className="text-lg leading-none hover:scale-[1.35] transition-transform">
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div
            className={`chat-bubble-bubble px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              isOwn
                ? (glass ? "bg-[var(--primary)] text-white rounded-br-md" : "bg-[#3B82F6] text-white rounded-br-md")
                : (glass ? "bg-[var(--bg-surface)]/85 backdrop-blur-md text-[var(--text)] border border-[var(--border)] rounded-bl-md" : "bg-white dark:bg-[#2A2A2E] text-[var(--text)] rounded-bl-md border border-gray-100 dark:border-[var(--border)]")
            } ${pinned ? "ring-1 ring-yellow-500/50" : ""}`}
          >
            {/* File content */}
            {isFile ? (
              <div className="chat-bubble-file">
                {isImage ? (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer">
                    <img src={metadata.file_url} alt={metadata.file_name}
                      className="chat-bubble-file-image max-w-[240px] max-h-[180px] rounded-lg object-cover" />
                  </a>
                ) : (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer"
                    className="chat-bubble-file-link flex items-center gap-2 hover:underline">
                    <span className="text-lg">📎</span>
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
          <div className="chat-bubble-reactions-row flex flex-wrap gap-1 mt-1 px-1">
            {reactions.map(r => (
              <button key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className={`chat-bubble-reaction-chip flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] transition ${
                  r.hasOwn
                    ? 'bg-[var(--primary)]/15 border border-[var(--primary)]/30'
                    : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/80'
                }`}>
                <span>{r.emoji}</span>
                <span className="text-[9px] font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

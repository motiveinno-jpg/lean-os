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
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

export function ChatBubble({
  senderName, content, time, isOwn, type, pinned,
  editedAt, deletedAt, replyTo, reactions, metadata, actionCard,
  onPin, onReply, onReact, onEdit, onDelete,
}: ChatBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);

  // Deleted message
  if (deletedAt) {
    return (
      <div className="flex justify-center my-2">
        <div className="px-3 py-1.5 bg-[var(--bg-surface)] rounded-full text-[10px] text-[var(--text-dim)] italic">
          삭제된 메시지
        </div>
      </div>
    );
  }

  // System message
  if (type === "system") {
    return (
      <div className="flex justify-center my-2">
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
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-3 group`}>
      <div className={`max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <div className="text-[10px] text-[var(--text-dim)] mb-1 px-1">{senderName}</div>
        )}

        {/* Reply indicator */}
        {replyTo && (
          <div className="flex items-center gap-1 px-3 mb-1">
            <div className="w-0.5 h-4 bg-[var(--primary)]/40 rounded-full" />
            <div className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">
              <span className="font-semibold">{replyTo.senderName}</span>: {replyTo.content}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 relative">
          {isOwn && (
            <span className="text-[9px] text-[var(--text-dim)] mb-1">
              {time}
            </span>
          )}

          {/* Hover action bar */}
          <div className={`absolute ${isOwn ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} top-0 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 px-1`}>
            {onReply && (
              <button onClick={onReply} className="p-1 hover:bg-[var(--bg-surface)] rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]" title="답장">
                ↩
              </button>
            )}
            {onReact && (
              <button onClick={() => setShowReactions(!showReactions)} className="p-1 hover:bg-[var(--bg-surface)] rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]" title="리액션">
                +
              </button>
            )}
            {onPin && (
              <button onClick={onPin} className="p-1 hover:bg-[var(--bg-surface)] rounded text-[10px] text-[var(--text-dim)] hover:text-yellow-400" title={pinned ? 'Unpin' : 'Pin'}>
                {pinned ? '📌' : '📍'}
              </button>
            )}
            {isOwn && onEdit && (
              <button onClick={onEdit} className="p-1 hover:bg-[var(--bg-surface)] rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]" title="편집">
                ✏
              </button>
            )}
            {isOwn && onDelete && (
              <button onClick={onDelete} className="p-1 hover:bg-[var(--bg-surface)] rounded text-[10px] text-[var(--text-dim)] hover:text-red-400" title="삭제">
                ×
              </button>
            )}
          </div>

          {/* Quick reactions popup */}
          {showReactions && onReact && (
            <div className={`absolute ${isOwn ? 'right-0' : 'left-0'} -top-8 flex gap-0.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-full px-1.5 py-0.5 shadow-xl z-10`}>
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} onClick={() => { onReact(emoji); setShowReactions(false); }}
                  className="text-sm hover:scale-125 transition-transform p-0.5">
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              isOwn
                ? "bg-[#3B82F6] text-white rounded-br-md"
                : "bg-white dark:bg-[#2A2A2E] text-[var(--text)] rounded-bl-md border border-gray-100 dark:border-[var(--border)]"
            } ${pinned ? "ring-1 ring-yellow-500/50" : ""}`}
          >
            {/* File content */}
            {isFile ? (
              <div>
                {isImage ? (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer">
                    <img src={metadata.file_url} alt={metadata.file_name}
                      className="max-w-[240px] max-h-[180px] rounded-lg object-cover" />
                  </a>
                ) : (
                  <a href={metadata.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:underline">
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
              content
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
            <span className="text-[9px] text-[var(--text-dim)] mb-1">
              {time}
            </span>
          )}
        </div>

        {/* Reactions row */}
        {reactions && reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 px-1">
            {reactions.map(r => (
              <button key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] transition ${
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

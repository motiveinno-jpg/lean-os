"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FileUploadZone } from "./file-upload-zone";
import { MentionDropdown, filterMentionUsers } from "./mention-dropdown";

interface MentionUser {
  id: string;
  name: string | null;
  email: string;
}

interface ReplyInfo {
  messageId: string;
  senderName: string;
  content: string;
}

interface ChatInputProps {
  onSend: (message: string, mentionedUserIds?: string[], replyToId?: string) => void;
  onFileUpload?: (file: File) => void;
  disabled?: boolean;
  placeholder?: string;
  users?: MentionUser[];
  replyTo?: ReplyInfo | null;
  onCancelReply?: () => void;
  glass?: boolean; // 플로팅 메신저 팝업의 글래스모피즘 변형 (기본 false → /chat 풀페이지 무영향)
}

export function ChatInput({ onSend, onFileUpload, disabled, placeholder, users, replyTo, onCancelReply, glass }: ChatInputProps) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 전송 중 disabled(=sendMut.isPending) 가 되면 textarea 가 비활성→포커스 상실.
  //   전송 완료로 다시 활성화되면 재포커스 → 마우스 클릭 없이 연속 전송 가능.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  // 멘션 드롭다운 후보(드롭다운과 동일 필터 공유) + 키보드 화살표 선택용 인덱스
  const mentionCandidates = useMemo(
    () => (mentionQuery !== null && users ? filterMentionUsers(users, mentionQuery) : []),
    [mentionQuery, users]
  );
  useEffect(() => { setMentionIndex(0); }, [mentionQuery]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    // 드롭다운으로 고른 id + 본문에 직접 타이핑한 @이름 도 매칭해 멘션 알림 누락 방지.
    const ids = new Set(mentionedIds);
    if (users) {
      for (const u of users) {
        const name = u.name || u.email;
        if (name && trimmed.includes(`@${name}`)) ids.add(u.id);
      }
    }
    const idArr = Array.from(ids);
    onSend(trimmed, idArr.length > 0 ? idArr : undefined, replyTo?.messageId);
    setText("");
    setMentionedIds([]);
    setMentionQuery(null);
    onCancelReply?.();
    inputRef.current?.focus();
  }, [text, disabled, onSend, mentionedIds, replyTo, onCancelReply, users]);

  function handleKeyDown(e: React.KeyboardEvent) {
    // 멘션 드롭다운 열림 시: ↑/↓ 이동, Enter·Tab 선택, Esc 닫기 (전송보다 우선)
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleMentionSelect(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && mentionQuery !== null) {
      setMentionQuery(null);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);

    // Detect @mention
    const cursorPos = e.target.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);
    // \w 는 한글(CJK)을 매칭 못 해 한글 이름 멘션 시 드롭다운이 안 열리던 버그 → 공백·@ 제외 모든 문자 허용.
    const match = beforeCursor.match(/@([^\s@]*)$/);
    if (match && users && users.length > 0) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  }

  function handleMentionSelect(user: MentionUser) {
    const cursorPos = inputRef.current?.selectionStart || text.length;
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);
    const newBefore = beforeCursor.replace(/@[^\s@]*$/, `@${user.name || user.email} `);
    setText(newBefore + afterCursor);
    setMentionedIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  return (
    <div className={`chat-input ${glass ? "border-t border-[var(--border)] bg-transparent rounded-b-3xl" : "border-t border-[var(--border)] bg-[var(--bg-card)] rounded-b-2xl"}`}>
      {/* Reply preview */}
      {replyTo && (
        <div className="chat-reply-preview">
          <div className="w-0.5 h-5 bg-[var(--primary)] rounded-full" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-[var(--primary)]">{replyTo.senderName}</span>
            <span className="text-[10px] text-[var(--text-dim)] ml-1 truncate">{replyTo.content}</span>
          </div>
          <button onClick={onCancelReply} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xs">
            ✕
          </button>
        </div>
      )}

      <div className="chat-input-body">
        <div className="chat-input-row">
          {/* File upload button */}
          {onFileUpload && (
            <FileUploadZone onFileSelect={onFileUpload} disabled={disabled} />
          )}

          {/* Mention dropdown */}
          {mentionQuery !== null && users && (
            <MentionDropdown
              users={users}
              filter={mentionQuery}
              activeIndex={mentionIndex}
              onHoverIndex={setMentionIndex}
              onSelect={handleMentionSelect}
              onClose={() => setMentionQuery(null)}
            />
          )}

          <textarea
            ref={inputRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "메시지를 입력하세요... (@멘션 가능)"}
            disabled={disabled}
            rows={1}
            className={`flex-1 px-4 py-2.5 text-sm resize-none focus:outline-none disabled:opacity-50 max-h-32 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-dim)] focus:border-[var(--primary)] ${
              glass ? "rounded-full" : "rounded-xl"
            }`}
            style={{ minHeight: "42px" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || disabled}
            className={`px-4 py-2.5 bg-[var(--primary)] hover:opacity-90 text-white text-sm font-semibold transition disabled:opacity-30 shrink-0 ${
              glass ? "rounded-full" : "rounded-xl"
            }`}
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}

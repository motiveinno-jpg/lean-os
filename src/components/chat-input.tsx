"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FileUploadZone } from "./file-upload-zone";
import { MentionDropdown, filterMentionUsers } from "./mention-dropdown";
import { ChatEmojiPicker } from "./chat-emoji-picker";
import { ChatLinkPicker } from "./chat-link-picker";
import { growTextarea } from "@/lib/textarea";

//   입력칸 최대 높이 — 여기까지 늘어나고 그 뒤로는 상자 안에서 스크롤한다.
const MAX_H = 200;

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
  /** 오너뷰 링크 붙이기(프로젝트·게시판·전자계약)에 필요 — 없으면 그 단추를 감춘다 */
  companyId?: string | null;
}

export function ChatInput({ onSend, onFileUpload, disabled, placeholder, users, replyTo, onCancelReply, glass, companyId }: ChatInputProps) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [picker, setPicker] = useState<null | "emoji" | "link">(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 전송 중 disabled(=sendMut.isPending) 가 되면 textarea 가 비활성→포커스 상실.
  //   전송 완료로 다시 활성화되면 재포커스 → 마우스 클릭 없이 연속 전송 가능.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  //   쓰는 만큼 늘어난다 — 타이핑·멘션 삽입·전송 후 비우기까지 한 곳에서 처리(2026-08-10 사장님 지시)
  useEffect(() => { growTextarea(inputRef.current, MAX_H); }, [text]);

  //   커서 자리에 끼워 넣기 — 이모지·오너뷰 링크가 같이 쓴다. 끝이 아니라 **쓰던 자리**에 들어간다.
  const insertAtCaret = (snippet: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    setText(text.slice(0, start) + snippet + text.slice(end));
    const pos = start + snippet.length;
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };

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

      {/* 작성 상자 — 글 영역이 위, 단추는 상자 **안** 오른쪽 아래 (2026-08-10 사장님 지시: Teams 형태) */}
      <div className="chat-input-body">
        <div className="chat-input-row">
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

          {/* 이모지 · 오너뷰 링크 고르기 — 작성 상자 위에 뜬다 */}
          {picker === "emoji" && (
            <ChatEmojiPicker onClose={() => setPicker(null)}
              onPick={(e) => { insertAtCaret(e); setPicker(null); }} />
          )}
          {picker === "link" && (
            <ChatLinkPicker companyId={companyId ?? null} onClose={() => setPicker(null)}
              onPick={({ label, href }) => { insertAtCaret(`[${label}](${href}) `); setPicker(null); }} />
          )}

          <div className={`chat-composer ${glass ? "chat-composer-glass" : ""}`}
            onClick={() => inputRef.current?.focus()}>
            <textarea
              ref={inputRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || "메시지를 입력하세요... (@멘션 가능)"}
              disabled={disabled}
              rows={1}
              className="chat-input-text chat-composer-text"
              style={{ minHeight: "24px", maxHeight: `${MAX_H}px` }}
            />
            <div className="chat-composer-tools" onClick={(e) => e.stopPropagation()}>
              {onFileUpload && (
                <FileUploadZone onFileSelect={onFileUpload} disabled={disabled} />
              )}
              {/* 이모지 — 고르면 쓰던 자리에 그대로 들어간다 */}
              <button
                type="button"
                onClick={() => setPicker((p) => (p === "emoji" ? null : "emoji"))}
                disabled={disabled}
                aria-label="이모지"
                title="이모지"
                className={`chat-composer-tool ${picker === "emoji" ? "chat-composer-tool-on" : ""}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" />
                </svg>
              </button>
              {/* 오너뷰 링크 — 프로젝트 · 게시판 글 · 전자계약으로 가는 링크를 붙인다 */}
              {companyId && (
                <button
                  type="button"
                  onClick={() => setPicker((p) => (p === "link" ? null : "link"))}
                  disabled={disabled}
                  aria-label="오너뷰 링크 붙이기"
                  title="오너뷰 링크 — 프로젝트 · 게시판 글 · 전자계약"
                  className={`chat-composer-tool ${picker === "link" ? "chat-composer-tool-on" : ""}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim() || disabled}
                aria-label="보내기"
                title="보내기 (Enter)"
                className="chat-composer-send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <p className="chat-input-hint"><b>Shift+Enter</b> 새 줄을 시작합니다.</p>
      </div>
    </div>
  );
}

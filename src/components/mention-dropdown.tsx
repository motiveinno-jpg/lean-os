"use client";

import { useEffect, useRef } from "react";

interface MentionUser {
  id: string;
  name: string | null;
  email: string;
}

// 멘션 후보 필터 — ChatInput(키보드 탐색)과 드롭다운이 동일 목록을 쓰도록 공유.
export function filterMentionUsers(users: MentionUser[], filter: string): MentionUser[] {
  const q = filter.toLowerCase();
  return users
    .filter((u) => u.name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .slice(0, 8);
}

interface MentionDropdownProps {
  users: MentionUser[];
  filter: string;
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
  activeIndex?: number; // 키보드 화살표로 선택된 인덱스 (옵셔널 — 미전달 시 하이라이트 없음, board 호환)
  onHoverIndex?: (i: number) => void; // 마우스 호버 시 활성 인덱스 동기화
}

export function MentionDropdown({ users, filter, onSelect, onClose, activeIndex, onHoverIndex }: MentionDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  const filtered = filterMentionUsers(users, filter);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div ref={ref}
      className="mention-dropdown">
      <div className="mention-dropdown-header">
        멘션 — @{filter}
      </div>
      {filtered.map((u, i) => (
        <button key={u.id}
          onClick={() => onSelect(u)}
          onMouseEnter={() => onHoverIndex?.(i)}
          className={`mention-dropdown-item ${i === activeIndex ? 'bg-[var(--bg-surface)]' : 'hover:bg-[var(--bg-surface)]'}`}>
          <div className="w-6 h-6 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--primary)]">
            {(u.name || u.email)[0].toUpperCase()}
          </div>
          <div>
            <div className="text-xs font-medium">{u.name || u.email}</div>
            {u.name && <div className="caption">{u.email}</div>}
          </div>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

interface MentionUser {
  id: string;
  name: string | null;
  email: string;
}

interface MentionDropdownProps {
  users: MentionUser[];
  filter: string;
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
}

export function MentionDropdown({ users, filter, onSelect, onClose }: MentionDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  const filtered = users.filter(u => {
    const q = filter.toLowerCase();
    return (u.name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }).slice(0, 8);

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
      className="absolute bottom-full left-0 mb-1 w-64 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden z-50">
      <div className="px-3 py-1.5 text-[9px] text-[var(--text-dim)] uppercase tracking-wider font-semibold border-b border-[var(--border)]">
        멘션 — @{filter}
      </div>
      {filtered.map(u => (
        <button key={u.id}
          onClick={() => onSelect(u)}
          className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] transition flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--primary)]">
            {(u.name || u.email)[0].toUpperCase()}
          </div>
          <div>
            <div className="text-xs font-medium">{u.name || u.email}</div>
            {u.name && <div className="text-[10px] text-[var(--text-dim)]">{u.email}</div>}
          </div>
        </button>
      ))}
    </div>
  );
}

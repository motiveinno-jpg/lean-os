"use client";

import { useState } from "react";

interface SearchResult {
  id: string;
  content: string;
  created_at: string | null;
  users?: { name: string | null; email: string } | null;
}

interface ChatSearchProps {
  onSearch: (query: string) => Promise<SearchResult[]>;
  onResultClick: (messageId: string) => void;
  onClose: () => void;
}

export function ChatSearch({ onSearch, onResultClick, onClose }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await onSearch(query.trim());
      setResults(data);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="메시지 검색..."
          className="flex-1 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
          autoFocus
        />
        <button onClick={handleSearch} disabled={searching || !query.trim()}
          className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
          {searching ? '...' : '검색'}
        </button>
        <button onClick={onClose}
          className="px-2 py-2 text-[var(--text-dim)] hover:text-[var(--text)] text-xs">
          닫기
        </button>
      </div>
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {results.map(r => (
            <button key={r.id} onClick={() => onResultClick(r.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)] transition">
              <div className="text-xs font-medium truncate">{r.content}</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                {(r.users as any)?.name || (r.users as any)?.email || '—'} · {r.created_at ? new Date(r.created_at).toLocaleString('ko') : ''}
              </div>
            </button>
          ))}
        </div>
      )}
      {query && !searching && results.length === 0 && (
        <div className="text-xs text-[var(--text-dim)] text-center py-3">검색 결과 없음</div>
      )}
    </div>
  );
}

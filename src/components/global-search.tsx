"use client";

import { globalSearch, type GlobalSearchResult } from "@/lib/search";
import { getCurrentUser } from "@/lib/queries";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";

const TYPE_LABELS: Record<string, string> = {
  deals: "딜", documents: "문서", partners: "거래처", taxInvoices: "세금계산서",
  bankTransactions: "거래내역", chatMessages: "채팅", employees: "인력",
};
const TYPE_ROUTES: Record<string, string> = {
  deals: "/deals", documents: "/documents", partners: "/partners",
  taxInvoices: "/transactions", bankTransactions: "/transactions",
  chatMessages: "/chat", employees: "/employees",
};
const ENTITY_TYPES = ["deals","documents","partners","taxInvoices","bankTransactions","chatMessages","employees"] as const;

function getDisplayText(type: string, item: any): { primary: string; secondary: string } {
  switch (type) {
    case "deals":
      return { primary: item.name, secondary: item.status ?? item.classification ?? "" };
    case "documents":
      return { primary: item.name, secondary: item.status ?? "" };
    case "partners":
      return { primary: item.name, secondary: item.contact_name ?? item.type ?? "" };
    case "taxInvoices":
      return { primary: item.counterparty_name, secondary: [item.type, item.issue_date].filter(Boolean).join(" · ") };
    case "bankTransactions":
      return { primary: item.counterparty, secondary: [item.type, item.transaction_date].filter(Boolean).join(" · ") };
    case "chatMessages": {
      const c = item.content ?? "";
      return { primary: c.length > 60 ? c.slice(0, 60) + "…" : c, secondary: item.created_at?.slice(0, 10) ?? "" };
    }
    case "employees":
      return { primary: item.name, secondary: item.status ?? "" };
    default:
      return { primary: String(item.name ?? item.id), secondary: "" };
  }
}

let externalOpen: (() => void) | null = null;
export function openGlobalSearch() { externalOpen?.(); }

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { externalOpen = () => setOpen(true); return () => { externalOpen = null; }; }, []);

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen((p) => !p); }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(""); setResults(null); }
  }, [open]);

  const doSearch = useCallback((q: string) => {
    if (!companyId || q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    globalSearch(companyId, q).then((r) => { setResults(r); setLoading(false); });
  }, [companyId]);

  const onInputChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value), 300);
  };

  const navigate = (type: string) => { setOpen(false); router.push(TYPE_ROUTES[type] ?? "/"); };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <svg className="w-5 h-5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input ref={inputRef} type="text" value={query}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            placeholder="검색... (딜, 문서, 거래처, 세금계산서...)"
            className="flex-1 bg-transparent text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none text-sm" />
          <kbd className="hidden sm:inline-block text-[10px] text-[var(--text-dim)] border border-[var(--border)] rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && results && results.totalCount === 0 && query.length >= 2 && (
            <p className="text-center text-[var(--text-muted)] text-sm py-8">검색 결과 없음</p>
          )}
          {!loading && results && results.totalCount > 0 && ENTITY_TYPES.map((type) => {
            const items = results[type];
            if (!items || items.length === 0) return null;
            return (
              <div key={type} className="mb-2">
                <p className="text-[var(--text-dim)] text-xs uppercase font-semibold px-3 py-1.5">{TYPE_LABELS[type]}</p>
                {items.map((item: any) => {
                  const { primary, secondary } = getDisplayText(type, item);
                  return (
                    <button key={item.id} onClick={() => navigate(type)}
                      className="w-full text-left hover:bg-[var(--bg-surface)] rounded-lg px-3 py-2 cursor-pointer flex items-center justify-between gap-2 transition-colors">
                      <span className="text-sm text-[var(--text-main)] truncate">{primary}</span>
                      {secondary && <span className="text-xs text-[var(--text-muted)] shrink-0">{secondary}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!loading && !results && query.length < 2 && (
            <p className="text-center text-[var(--text-muted)] text-sm py-8">2글자 이상 입력하세요</p>
          )}
        </div>
      </div>
    </div>
  );
}
